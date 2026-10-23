'use strict';
// Phase 6 workflow contract for the frontend adapter. The adapter is loaded in
// the same VM shape the browser uses and every request goes through a stub of
// AssetAccess.request, so these tests prove the exact HTTP shape the real
// session transport will send.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ASSET_ID = '99999999-8888-7777-6666-555555555555';
const OPERATION_ID = '22222222-3333-4444-5555-666666666666';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function load(handler) {
  const calls = [];
  const toasts = [];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    ArrayBuffer,
    Uint8Array,
    Blob,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Promise,
    JSON,
    Date,
    localStorage: {
      getItem() {
        throw new Error('phase 6 must not read localStorage');
      },
      setItem() {
        throw new Error('phase 6 must not write localStorage');
      },
      removeItem() {
        throw new Error('phase 6 must not remove localStorage');
      }
    },
    sessionStorage: {
      getItem() {
        throw new Error('phase 6 must not read sessionStorage');
      },
      setItem() {
        throw new Error('phase 6 must not write sessionStorage');
      }
    }
  });
  context.window = context;
  context.AssetAccess = {
    request(vmRef, path, init) {
      const call = { path, init: Object.assign({}, init || {}) };
      calls.push(call);
      return Promise.resolve().then(() => handler(call, calls.length));
    }
  };
  vm.runInContext(fs.readFileSync('assets/js/phase6-api.js', 'utf8'), context, {
    filename: 'assets/js/phase6-api.js'
  });
  const api = context.AssetPhase6;
  const app = {
    authenticated: true,
    activeUserId: 'user-1',
    csrfToken: 'csrf-token',
    route: { name: 'datos' },
    can: () => true,
    showToast(message, tone) {
      toasts.push({ message, tone });
    }
  };
  Object.assign(app, api.data());
  Object.keys(api.methods).forEach((key) => {
    app[key] = api.methods[key];
  });
  Object.keys(api.computed || {}).forEach((key) => {
    Object.defineProperty(app, key, { get: () => api.computed[key].call(app), configurable: true });
  });
  return { c: context, app, calls, toasts };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function operation(overrides) {
  return Object.assign(
    {
      id: OPERATION_ID,
      state: 'preview',
      jobId: null,
      approved: false,
      total: 2,
      processed: 0,
      summary: { created: 0, modified: 0, omitted: 0, failed: 0 },
      rows: [
        {
          index: 0,
          sheet: 'Notebooks',
          line: 2,
          values: { name: 'Notebook de dirección', serial: 'SN-1' },
          errors: [],
          classification: 'new'
        },
        {
          index: 1,
          sheet: 'Notebooks',
          line: 3,
          values: { name: 'Notebook de soporte' },
          errors: [],
          classification: 'safe'
        }
      ],
      hasMore: false
    },
    overrides
  );
}

test('analyze posts the raw file with filename and options on the query string', async () => {
  const { app, calls } = load(() => operation());
  const file = new Blob([new Uint8Array([80, 75, 3, 4])]);

  const result = await app.analyzeImport(file, { delimiter: ';', category: 'Notebooks' });

  assert.deepEqual(plain(result), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  const [path, query] = calls[0].path.split('?');
  assert.equal(path, '/imports/analyze');
  const params = new URLSearchParams(query);
  assert.equal(params.get('filename'), 'import.csv');
  assert.deepEqual(JSON.parse(params.get('options')), { delimiter: ';', category: 'Notebooks' });
  assert.ok(calls[0].init.body instanceof ArrayBuffer, 'file bytes travel as raw binary');
  assert.equal(calls[0].init.headers, undefined, 'no JSON header is invented for binary bodies');
  assert.equal(app.phase6.operation.id, OPERATION_ID);
  assert.equal(app.phase6.operation.rows.length, 2);
});

test('analyze uses the uploaded file name, never a client-side parse', async () => {
  const { app, calls } = load(() => operation());
  const file = { name: 'inventario sedes.xlsx', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };

  await app.analyzeImport(file, {});

  const params = new URLSearchParams(calls[0].path.split('?')[1]);
  assert.equal(params.get('filename'), 'inventario sedes.xlsx');
});

test('a late analyze response cannot revive a cleared session', async () => {
  const pending = deferred();
  const { app } = load(() => pending.promise);
  const file = new Blob([new Uint8Array([1])]);

  const result = app.analyzeImport(file, {});
  app.clearPhase6State();
  pending.resolve(operation());

  assert.deepEqual(plain(await result), { ok: false, cancelled: true });
  assert.equal(app.phase6.operation.id, '');
  assert.equal(app.phase6.operation.rows.length, 0);
});

test('a successful warranty save after logout reports cancellation and keeps no state', async () => {
  const pending = deferred();
  const { app, toasts } = load(() => pending.promise);
  const pendingCall = app.saveAssetWarranty(ASSET_ID, { supplier: 'HP' });
  app.authenticated = false;
  app.clearPhase6State();
  pending.resolve({ assetId: ASSET_ID, supplier: 'HP' });

  const result = await pendingCall;
  assert.deepEqual(plain(result), { ok: false, cancelled: true });
  assert.equal(app.phase6.warranty.item, null);
  assert.equal(app.phase6.warranty.assetId, '');
  assert.equal(toasts.length, 0, 'an ended session must not announce a late save');
});

test('rejecting a stale write does not toast or clear the newer state', async () => {
  const pending = deferred();
  const { app, toasts } = load(() => pending.promise);
  app.phase6.warranty.item = { assetId: ASSET_ID, supplier: 'Lenovo' };
  const write = app.saveAssetWarranty(ASSET_ID, { supplier: 'HP' });

  app.activeUserId = 'user-2';
  app.identityChangedPhase6();
  pending.resolve({ assetId: ASSET_ID, supplier: 'HP' });

  const result = await write;
  assert.equal(result.cancelled, true);
  assert.equal(toasts.length, 0);
  assert.equal(app.phase6.warranty.item, null);
});

test('an aborted read leaves the previous rows untouched and reports nothing', async () => {
  const { app } = load(() => {
    const error = new Error('Solicitud cancelada.');
    error.name = 'AbortError';
    throw error;
  });
  app.phase6.attachments = Object.assign(app.phase6.attachments, {
    assetId: ASSET_ID,
    items: [{ id: 'a', filename: 'manual.pdf' }],
    loaded: true
  });

  assert.equal(await app.loadAssetAttachments(ASSET_ID), false);
  assert.equal(app.phase6.attachments.items.length, 1);
  assert.equal(app.phase6.attachments.error, '');
});

test('export asks for the CSV blob instead of JSON and keeps the server filename', async () => {
  const blob = new Blob(['id,quick_code\n'], { type: 'text/csv' });
  const { app, calls } = load(() => blob);
  app.phase6.exportRun.filename = 'assets.csv';

  const result = await app.exportPhase6Assets({ assetIds: [ASSET_ID], fields: ['id', 'name'] });

  assert.equal(result.ok, true);
  assert.equal(result.blob, blob);
  assert.equal(result.filename, 'assets.csv');
  assert.equal(calls[0].path, '/assets/export');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.responseType, 'blob');
  assert.deepEqual(plain(calls[0].init.body), { assetIds: [ASSET_ID], fields: ['id', 'name'] });
});

test('bulk preview sends the explicit action, filters and bounded changes', async () => {
  const { app, calls } = load(() => operation({ state: 'preview' }));

  const result = await app.bulkPreviewPhase6({
    filters: { category: 'Notebooks', status: 'in_use' },
    changes: { status: 'maintenance' },
    action: 'update'
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].path, '/bulk/preview');
  assert.deepEqual(plain(calls[0].init.body), {
    filters: { category: 'Notebooks', status: 'in_use' },
    changes: { status: 'maintenance' },
    action: 'update'
  });
  assert.equal(app.phase6.operation.id, OPERATION_ID);
});

test('conflicts are resolved row by row and approval is a separate human request', async () => {
  const { app, calls } = load((call) => {
    if (call.path.indexOf('/resolve') !== -1) return operation({ state: 'preview' });
    return operation({ state: 'approved', approved: true });
  });
  app.phase6.operation = Object.assign(app.phase6.operation, operation());

  assert.deepEqual(plain(await app.resolvePhase6Row(1, 'update', { assetId: ASSET_ID })), { ok: true });
  assert.equal(calls[0].path, '/operations/' + OPERATION_ID + '/resolve');
  assert.deepEqual(plain(calls[0].init.body), { row: 1, action: 'update', assetId: ASSET_ID });

  assert.deepEqual(plain(await app.approvePhase6Operation()), { ok: true });
  assert.equal(calls[1].path, '/operations/' + OPERATION_ID + '/approve');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(app.phase6.operation.approved, true);
});

test('large imports are queued and polled until the job reaches a final state', async () => {
  const { app, calls } = load((call, index) => {
    if (call.path.indexOf('/enqueue') !== -1) {
      return operation({ state: 'queued', jobId: 'job-7', approved: true });
    }
    return operation({
      state: 'complete',
      jobId: 'job-7',
      approved: true,
      processed: 2,
      summary: { created: 1, modified: 1, omitted: 0, failed: 0 }
    });
  });
  app.phase6.operation = Object.assign(app.phase6.operation, operation({ state: 'approved', approved: true }));

  assert.equal((await app.enqueuePhase6Operation()).ok, true);
  assert.equal(calls[0].path, '/operations/' + OPERATION_ID + '/enqueue');
  assert.equal(app.phase6.operation.state, 'queued');
  assert.equal(app.phase6.operation.jobId, 'job-7');

  assert.equal(await app.pollPhase6Operation(), true);
  assert.equal(calls[1].path, '/operations/' + OPERATION_ID);
  assert.equal(app.phase6.operation.state, 'complete');
  assert.deepEqual(plain(app.phase6.operation.summary), { created: 1, modified: 1, omitted: 0, failed: 0 });
  assert.equal(app.phase6OperationPolling, false, 'a final state stops polling');
});

test('polling stops when the session ends and a late job view is ignored', async () => {
  const pending = deferred();
  const { app } = load(() => pending.promise);
  app.phase6.operation = Object.assign(app.phase6.operation, operation({ state: 'queued', jobId: 'job-9' }));

  const tick = app.pollPhase6Operation();
  app.clearPhase6State();
  pending.resolve(operation({ state: 'complete' }));

  assert.equal(await tick, false);
  assert.equal(app.phase6.operation.state, '');
  assert.equal(app.phase6OperationPolling, false);
});

test('warranty reads keep the coverage filter and tolerate an absent warranty', async () => {
  const missing = Object.assign(new Error('El registro no está disponible.'), { status: 404 });
  const { app, calls } = load((call) => {
    if (call.path.indexOf('/warranties?') === 0) {
      return { items: [{ assetId: ASSET_ID, supplier: 'HP', coverage: 'expiring' }], hasMore: false, offset: 0 };
    }
    throw missing;
  });

  assert.equal(await app.loadWarranties({ coverage: 'expiring', offset: 0, limit: 50 }), true);
  assert.match(calls[0].path, /\/warranties\?.*coverage=expiring/);
  assert.equal(app.phase6.warranties.items.length, 1);

  assert.equal(await app.loadAssetWarranty(ASSET_ID), true);
  assert.equal(app.phase6.warranty.item, null);
  assert.equal(app.phase6.warranty.error, '');
  assert.equal(app.phase6.warranty.loaded, true);
});

test('warranty preferences are read and written with the bounded day count', async () => {
  const { app, calls } = load((call) => {
    if (call.init.method === 'PUT') return { expiringDays: 45 };
    return { expiringDays: 30 };
  });

  assert.equal(await app.loadWarrantyPreferences(), true);
  assert.equal(app.phase6.warrantyPrefs.expiringDays, 30);

  assert.deepEqual(plain(await app.saveWarrantyPreferences(45)), { ok: true });
  assert.equal(calls[1].path, '/warranty-preferences');
  assert.deepEqual(plain(calls[1].init.body), { expiringDays: 45 });
  assert.equal(app.phase6.warrantyPrefs.expiringDays, 45);
});

test('attachments upload raw bytes with filename and category, then download the blob', async () => {
  const metadata = { id: 'att-1', assetId: ASSET_ID, filename: 'manual.pdf', size: 12 };
  const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
  const { app, calls } = load((call) => {
    if (call.path.indexOf('/download') !== -1) return blob;
    if (call.init.method === 'DELETE') return null;
    if (call.init.method === 'POST') return metadata;
    return { items: [metadata], hasMore: false, offset: 0 };
  });
  const file = { name: 'manual.pdf', arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };

  assert.equal(await app.loadAssetAttachments(ASSET_ID), true);
  assert.equal(calls[0].path, '/assets/' + ASSET_ID + '/attachments?limit=50&offset=0');
  assert.equal(app.phase6.attachments.items.length, 1);

  assert.equal((await app.uploadAssetAttachment(ASSET_ID, file, 'manual')).ok, true);
  const upload = calls[1];
  assert.equal(upload.init.method, 'POST');
  const params = new URLSearchParams(upload.path.split('?')[1]);
  assert.equal(params.get('filename'), 'manual.pdf');
  assert.equal(params.get('category'), 'manual');
  assert.ok(upload.init.body instanceof ArrayBuffer);

  const download = await app.downloadAssetAttachment({ id: 'att-1', filename: 'manual.pdf' });
  assert.equal(download.ok, true);
  assert.equal(download.blob, blob);
  assert.equal(calls[2].path, '/assets/' + ASSET_ID + '/attachments/att-1/download');
  assert.equal(calls[2].init.responseType, 'blob');

  assert.deepEqual(plain(await app.deleteAssetAttachment('att-1')), { ok: true });
  assert.equal(calls[3].init.method, 'DELETE');
  assert.equal(app.phase6.attachments.items.length, 0);
});

test('import profiles are listed, saved and deleted through their own routes', async () => {
  const { app, calls } = load((call) => {
    if (call.init.method === 'DELETE') return null;
    if (call.init.method === 'POST' || call.init.method === 'PUT') {
      return { id: 'p1', name: 'Proveedor', options: { delimiter: ';' } };
    }
    return { items: [{ id: 'csv-standard', name: 'CSV standard', options: {} }] };
  });

  assert.equal(await app.loadImportProfiles(), true);
  assert.equal(app.phase6.profiles.items.length, 1);

  assert.equal((await app.saveImportProfile('Proveedor', { delimiter: ';' })).ok, true);
  assert.equal(calls[1].path, '/import-profiles');
  assert.deepEqual(plain(calls[1].init.body), { name: 'Proveedor', options: { delimiter: ';' } });

  assert.equal((await app.saveImportProfile('Proveedor', { delimiter: ',' }, 'p1')).ok, true);
  assert.equal(calls[2].path, '/import-profiles/p1');
  assert.equal(calls[2].init.method, 'PUT');

  assert.deepEqual(plain(await app.deleteImportProfile('p1')), { ok: true });
  assert.equal(calls[3].init.method, 'DELETE');
  assert.equal(app.phase6.profiles.items.some((item) => item.id === 'p1'), false);
});

test('write failures keep the actionable server message and field errors', async () => {
  const failure = Object.assign(new Error('Revisa los campos indicados.'), {
    status: 422,
    fieldErrors: { expiringDays: 'Revisa este campo.' }
  });
  const { app, toasts } = load(() => {
    throw failure;
  });

  const result = await app.saveWarrantyPreferences(0);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Revisa los campos indicados.');
  assert.deepEqual(plain(result.fieldErrors), { expiringDays: 'Revisa este campo.' });
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tone, 'error');
});

test('permission gates stop requests before they reach the server', async () => {
  const { app, calls } = load(() => operation());
  app.can = (permission) => permission !== 'assets.edit';

  assert.equal(await app.analyzeImport(new Blob([new Uint8Array([1])]), {}), false);
  assert.equal(await app.bulkPreviewPhase6({ assetIds: [ASSET_ID], changes: {} }), false);
  assert.equal(calls.length, 0);
});

test('a 401 read clears workflow state instead of presenting stale data', async () => {
  const unauthorized = Object.assign(new Error('La sesión ha vencido. Inicia sesión de nuevo.'), { status: 401 });
  const { app } = load(() => {
    throw unauthorized;
  });
  app.phase6.warrantyPrefs.expiringDays = 90;

  assert.equal(await app.loadWarrantyPreferences(), false);
  assert.equal(app.phase6.warrantyPrefs.expiringDays, 30);
  assert.equal(app.phase6.warrantyPrefs.loaded, false);
});

// The four tests below cover the leak surface: a request that belongs to a
// session, asset or surface that is no longer current must not publish its
// result, clear a newer busy flag or reach the server at all.
test('a superseded profile read never populates the session that replaced it', async () => {
  const pending = deferred();
  const { app } = load(() => pending.promise);

  const read = app.loadImportProfiles();
  app.activeUserId = 'user-2';
  app.identityChangedPhase6();
  pending.resolve({ items: [{ id: 'p1', name: 'Perfil heredado', options: {} }] });

  assert.equal(await read, false, 'the read belongs to the ended session');
  assert.equal(app.phase6.profiles.items.length, 0, 'no profile revives in the new session');
  assert.equal(app.phase6.profiles.loaded, false);
});

test('a file read that resolves after logout never sends the upload', async () => {
  const bytes = deferred();
  const { app, calls, toasts } = load(() => ({ id: 'att-1', assetId: ASSET_ID, filename: 'manual.pdf' }));
  const file = { name: 'manual.pdf', arrayBuffer: () => bytes.promise };

  const upload = app.uploadAssetAttachment(ASSET_ID, file, 'manual');
  app.authenticated = false;
  app.clearPhase6State();
  bytes.resolve(new ArrayBuffer(4));

  const result = await upload;
  assert.deepEqual(plain(result), { ok: false, cancelled: true });
  assert.equal(calls.length, 0, 'no write is sent after the session ended');
  assert.equal(toasts.length, 0);
  assert.equal(app.phase6.attachments.busy, false);
});

test('an upload that finishes after a session change cannot clear the next session busy flag', async () => {
  const firstBytes = deferred();
  const secondBytes = deferred();
  const { app, calls, toasts } = load(() => ({
    id: 'att-2',
    assetId: ASSET_ID,
    filename: 'segundo.pdf',
    category: 'document',
    size: 4
  }));

  const first = app.uploadAssetAttachment(
    ASSET_ID,
    { name: 'primero.pdf', arrayBuffer: () => firstBytes.promise },
    'document'
  );
  app.authenticated = false;
  app.clearPhase6State();
  app.authenticated = true;
  app.activeUserId = 'user-2';

  const second = app.uploadAssetAttachment(
    ASSET_ID,
    { name: 'segundo.pdf', arrayBuffer: () => secondBytes.promise },
    'document'
  );
  assert.equal(app.phase6.attachments.busy, true, 'the live upload owns the busy state');

  firstBytes.resolve(new ArrayBuffer(4));
  assert.equal((await first).cancelled, true);
  assert.equal(app.phase6.attachments.busy, true, 'the ended session cannot clear the newer busy state');

  secondBytes.resolve(new ArrayBuffer(4));
  assert.equal((await second).ok, true);
  assert.equal(app.phase6.attachments.busy, false);
  assert.equal(calls.length, 1, 'only the live upload reaches the server');
  assert.equal(toasts.length, 0);
});

test('a late attachment read for the previous asset keeps the current asset rows', async () => {
  const older = deferred();
  const newer = deferred();
  const { app } = load((call, index) => (index === 1 ? older.promise : newer.promise));

  const previous = app.loadAssetAttachments(ASSET_ID, { offset: 0, limit: 50 });
  const current = app.loadAssetAttachments(OTHER_ASSET_ID, { offset: 0, limit: 50 });
  newer.resolve({ items: [{ id: 'b-1', assetId: OTHER_ASSET_ID, filename: 'nuevo.pdf' }], hasMore: false });
  assert.equal(await current, true);

  older.resolve({ items: [{ id: 'a-1', assetId: ASSET_ID, filename: 'viejo.pdf' }], hasMore: false });
  assert.equal(await previous, false, 'the previous asset read is superseded');
  assert.equal(app.phase6.attachments.assetId, OTHER_ASSET_ID);
  assert.deepEqual(plain(app.phase6.attachments.items.map((item) => item.id)), ['b-1']);
});

for (const kind of ['import', 'bulk']) {
  for (const outcome of ['abort', 'late-success']) {
    test(`superseded ${kind} ${outcome} cannot publish, announce or clear a newer preview`, async () => {
      const first = deferred();
      const second = deferred();
      let dispatched = 0;
      const { app, calls, toasts } = load(() => ++dispatched === 1 ? first.promise : second.promise);
      const start = () => kind === 'import'
        ? app.analyzeImport({ name: 'assets.csv', arrayBuffer: async () => new ArrayBuffer(0) }, {})
        : app.bulkPreviewPhase6({ assetIds: [ASSET_ID], changes: { brand: 'New' } });
      const old = start();
      while (calls.length < 1) await Promise.resolve();
      const live = start();
      while (calls.length < 2) await Promise.resolve();
      const run = kind === 'import' ? app.phase6.importRun : app.phase6.bulkRun;
      const controller = run.controller;
      if (outcome === 'abort') {
        const error = new Error('This operation was aborted'); error.name = 'AbortError';
        first.reject(error);
      } else first.resolve(operation({ id: 'old-operation' }));
      const result = await old;
      assert.equal(result.cancelled, true);
      assert.equal(run.busy, true, 'the live request owns its busy state');
      assert.equal(run.controller, controller);
      assert.notEqual(app.phase6.operation.id, 'old-operation');
      assert.equal(toasts.length, 0);
      second.resolve(operation({ id: 'live-operation' }));
      assert.equal((await live).ok, true);
      assert.equal(app.phase6.operation.id, 'live-operation');
      assert.equal(run.busy, false);
    });
  }
}
