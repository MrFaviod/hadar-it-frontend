'use strict';
// Phase 6 UI integration: the real components talk to the real API surface in
// the browser. These tests mount the shipped components, stub only the network
// and assert the exact HTTP the server contract requires. No demo fallback file,
// sheet or profile is allowed to appear in the flow.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

// Every surface mounted here is released after its test: an unfinished poll
// timer or a pending read would otherwise keep the file alive after a failure
// and hide the real result behind a runner timeout.
const cleanups = [];
test.afterEach(() => {
  while (cleanups.length) {
    const dispose = cleanups.pop();
    try {
      dispose();
    } catch (_) {
      /* The test result already carries the failure. */
    }
  }
});
function setup(entry) {
  const scoped = harness.setup(entry);
  const mount = scoped.mount;
  scoped.mount = (name, props) => {
    const view = mount(name, props);
    cleanups.push(() => view.unmount());
    return view;
  };
  cleanups.push(() => scoped.app.clearPhase6State());
  return scoped;
}

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';
const OPERATION_ID = '22222222-3333-4444-5555-666666666666';
const PROFILE_ID = '33333333-4444-5555-6666-777777777777';

function response(payload, status) {
  const code = status || 200;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: () => Promise.resolve(payload),
    blob: () => Promise.resolve(payload)
  };
}
function empty(status) {
  return { ok: true, status: status || 204, json: () => Promise.resolve(null), blob: () => Promise.resolve(null) };
}
function stubFetch(c, handler) {
  const calls = [];
  c.fetch = (url, init) => {
    const call = { url: String(url), init: init || {}, body: init && init.body };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length));
  };
  return calls;
}
function analyzePayload(rows, overrides) {
  return Object.assign({
    id: OPERATION_ID,
    kind: 'import',
    state: 'preview',
    jobId: null,
    approved: false,
    total: rows.length,
    processed: 0,
    summary: { created: 0, modified: 0, omitted: 0, failed: 0 },
    rows,
    hasMore: false
  }, overrides || {});
}
function importRow(index, values, extra) {
  return Object.assign({
    index,
    sheet: 'Notebooks',
    line: index + 2,
    values,
    errors: [],
    assetId: '',
    version: '',
    classification: 'new',
    candidates: [],
    action: 'create',
    reason: '',
    result: null
  }, extra || {});
}
function file(name) {
  return { name: name || 'inventario.xlsx', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
}
// The browser download is the product's own path: the view hands the server
// blob to a link and reports the result. These stubs replace only the browser
// capability, never the product decision.
function stubDownload(c) {
  const downloads = [];
  c.document.body = { appendChild() {}, removeChild() {} };
  c.document.createElement = () => ({
    href: '',
    download: '',
    rel: '',
    click() {
      downloads.push({ href: this.href, filename: this.download });
    }
  });
  c.URL = class extends URL {
    static createObjectURL(blob) {
      downloads.push({ blob });
      return 'blob:phase6-test';
    }
    static revokeObjectURL() {}
  };
  return downloads;
}

test('the importer analyzes the real file and shows the server rows', async () => {
  const { c, app, mount } = setup();
  const rows = [importRow(0, { name: 'Notebook HP', serial: 'SN-1' })];
  const calls = stubFetch(c, () => response(analyzePayload(rows)));
  const view = mount('Phase6DataTransfer');

  assert.equal(app.phase6.operation.rows.length, 0, 'no demo rows before the server answers');
  view.instance.file = file('inventario.xlsx');
  await view.instance.runAnalysis();

  const analyze = calls.find((call) => call.url.indexOf('/api/v1/imports/analyze') === 0);
  assert.ok(analyze, 'the file is uploaded to the real analyze endpoint');
  assert.match(analyze.url, /filename=inventario\.xlsx/);
  assert.equal(analyze.init.method, 'POST');
  assert.ok(analyze.body instanceof ArrayBuffer, 'raw bytes are uploaded, not a JSON description');
  assert.equal(view.instance.step, 2);
  assert.equal(app.phase6.operation.id, OPERATION_ID);
  assert.equal(view.instance.rows.length, 1);
  assert.equal(view.instance.rows[0].values.name, 'Notebook HP');
});

test('approval stays blocked until every ambiguous conflict is resolved by the server', async () => {
  const { c, app, mount } = setup();
  const conflict = importRow(1, { name: 'Notebook dudoso' }, {
    classification: 'possible_duplicate',
    candidates: [{ assetId: OTHER_ID, score: 1 }],
    action: 'review'
  });
  const resolved = importRow(1, { name: 'Notebook dudoso' }, {
    classification: 'omitted',
    action: 'skip'
  });
  const approved = analyzePayload([conflict], { state: 'approved', approved: true });
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/resolve') !== -1) return response(analyzePayload([resolved]));
    if (call.url.indexOf('/approve') !== -1) return response(approved);
    return response(analyzePayload([conflict]));
  });
  const view = mount('Phase6DataTransfer');
  view.instance.file = file('inventario.csv');
  await view.instance.runAnalysis();

  assert.equal(view.instance.canApprove, false, 'an ambiguous row requires a decision');

  await view.instance.resolve(view.instance.conflicts[0], 'skip');
  const resolveCall = calls.find((call) => call.url.indexOf('/resolve') !== -1);
  assert.deepEqual(JSON.parse(resolveCall.body), { row: 1, action: 'skip' });
  assert.equal(view.instance.canApprove, true);

  await view.instance.approve();
  assert.ok(calls.find((call) => call.url === '/api/v1/operations/' + OPERATION_ID + '/approve'));
  assert.equal(view.instance.approved, true);
});

test('an approved import is queued as a real job and polled to completion', async () => {
  const { c, app, mount } = setup();
  const queued = analyzePayload([importRow(0, { name: 'Notebook' })], {
    state: 'approved',
    approved: true
  });
  const running = analyzePayload([importRow(0, { name: 'Notebook' })], {
    state: 'queued',
    approved: true,
    jobId: 'job-1'
  });
  const complete = analyzePayload([importRow(0, { name: 'Notebook', }, { result: 'created', action: 'create' })], {
    state: 'complete',
    approved: true,
    jobId: 'job-1',
    processed: 1,
    summary: { created: 1, modified: 0, omitted: 0, failed: 0 }
  });
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/enqueue') !== -1) return response(running, 202);
    if (call.url === '/api/v1/operations/' + OPERATION_ID) return response(complete);
    return response(queued);
  });
  const view = mount('Phase6DataTransfer');
  view.instance.file = file('inventario.csv');
  await view.instance.runAnalysis();

  await view.instance.enqueue();

  const enqueue = calls.find((call) => call.url.indexOf('/enqueue') !== -1);
  assert.equal(enqueue.init.method, 'POST');
  assert.equal(app.phase6.operation.state, 'queued');
  assert.equal(app.phase6.operation.jobId, 'job-1');
  assert.equal(view.instance.step, 4);

  assert.equal(await app.pollPhase6Operation(), true);
  assert.equal(app.phase6.operation.state, 'complete');
  assert.deepEqual(Object.assign({}, app.phase6.operation.summary), { created: 1, modified: 0, omitted: 0, failed: 0 });
  assert.equal(app.phase6OperationPolling, false);
});

test('export asks the server for a CSV blob instead of building it in the browser', async () => {
  const { c, app, mount } = setup();
  const blob = new Blob(['id,nombre\n'], { type: 'text/csv' });
  const calls = stubFetch(c, () => response(blob));
  const downloads = stubDownload(c);
  const view = mount('Phase6DataTransfer');
  view.instance.tab = 'export';
  view.instance.exportFields = ['id', 'name'];
  view.instance.exportSelection = 'filters';
  view.instance.exportFilters = { category: 'Notebooks', status: '', site_id: '', location_id: '', archived: '' };

  await view.instance.runExport();

  const call = calls.find((item) => item.url === '/api/v1/assets/export');
  assert.ok(call, 'export posts to the server route');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.responseType, 'blob');
  assert.deepEqual(JSON.parse(call.body), { filters: { category: 'Notebooks' }, fields: ['id', 'name'] });
  assert.ok(downloads.some((entry) => entry.blob === blob), 'the server blob is the file the browser receives');
  assert.deepEqual(downloads.filter((entry) => entry.filename), [{ href: 'blob:phase6-test', filename: 'assets.csv' }]);
  assert.equal(view.instance.message, 'La exportación se ha descargado.');
});

test('attachments upload raw bytes, download the stored blob and delete by id', async () => {
  const { c, app, mount } = setup();
  const metadata = {
    id: 'att-1',
    assetId: ASSET_ID,
    filename: 'factura.pdf',
    category: 'receipt',
    contentType: 'application/pdf',
    size: 120,
    createdAt: '2026-01-02T10:00:00'
  };
  const stored = new Blob(['pdf'], { type: 'application/pdf' });
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/download') !== -1) return response(stored);
    if (call.init.method === 'POST') return response(metadata, 201);
    if (call.init.method === 'DELETE') return empty(204);
    return response({ items: [], hasMore: false, offset: 0, limit: 50 });
  });
  const downloads = stubDownload(c);
  const view = mount('Phase6Attachments', { asset: { id: ASSET_ID, name: 'Notebook HP' } });
  assert.equal(await app.loadAssetAttachments(ASSET_ID), true);

  view.instance.category = 'receipt';
  await view.instance.upload({ target: { files: [file('factura.pdf')], value: 'factura.pdf' } });
  const upload = calls.find((call) => call.init.method === 'POST');
  assert.match(upload.url, /filename=factura\.pdf/);
  assert.match(upload.url, /category=receipt/);
  assert.ok(upload.body instanceof ArrayBuffer);
  assert.equal(view.instance.items.length, 1);

  await view.instance.download(view.instance.items[0]);
  const download = calls.find((call) => call.url.indexOf('/download') !== -1);
  assert.equal(download.init.responseType, 'blob');
  assert.ok(downloads.some((entry) => entry.blob === stored), 'the stored bytes reach the browser download');

  await view.instance.remove(view.instance.items[0]);
  assert.equal(view.instance.confirmId, 'att-1');
  await view.instance.remove(view.instance.items[0]);
  assert.equal(calls.find((call) => call.init.method === 'DELETE').url, '/api/v1/assets/' + ASSET_ID + '/attachments/att-1');
  assert.equal(view.instance.items.length, 0);
});

test('the warranty list loads real coverage and opens the receipt-backed editor', async () => {
  const { c, app, mount } = setup();
  const item = {
    assetId: ASSET_ID,
    supplier: 'HP',
    purchaseDate: '2026-01-02',
    durationMonths: 24,
    expiresOn: '2028-01-02',
    status: 'active',
    receiptId: 'att-1',
    notes: '',
    coverage: 'current'
  };
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    if (call.init.method === 'PUT') return response(item);
    return response({ items: [item], hasMore: false, offset: 0 });
  });
  const view = mount('Phase6WarrantyCenter');
  await app.loadWarranties();

  assert.deepEqual(view.instance.items.map((row) => row.assetId), [ASSET_ID]);
  view.instance.setCoverage('expiring');
  await app.loadWarranties({ coverage: 'expiring' });
  assert.match(calls[calls.length - 1].url, /coverage=expiring/);

  view.instance.openEditor(view.instance.items[0]);
  assert.equal(view.instance.editor.supplier, 'HP');
  assert.equal(view.instance.editor.receiptId, 'att-1');
  view.instance.editor.notes = 'Ampliada';
  await view.instance.save();
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/assets/' + ASSET_ID + '/warranty');
  assert.equal(JSON.parse(put.body).notes, 'Ampliada');
});

test('the asset warranty panel tolerates a missing warranty and saves the edited one', async () => {
  const { c, app, mount } = setup();
  const saved = { assetId: ASSET_ID, supplier: 'Dell', status: 'active', coverage: 'unknown' };
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'PUT') return response(saved);
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [] });
    return response({ error: { code: 'not_found' } }, 404);
  });
  const view = mount('Phase6AssetWarranty', { asset: { id: ASSET_ID, name: 'Notebook HP' } });
  await app.loadAssetWarranty(ASSET_ID);
  assert.equal(view.instance.item, null);

  view.instance.startEdit();
  view.instance.form.supplier = 'Dell';
  view.instance.form.purchaseDate = '2026-02-01';
  view.instance.form.durationMonths = 12;
  await view.instance.save();

  const put = calls.find((call) => call.init.method === 'PUT');
  const payload = JSON.parse(put.body);
  assert.equal(payload.supplier, 'Dell');
  assert.equal(payload.purchaseDate, '2026-02-01');
  assert.equal(payload.durationMonths, 12);
  assert.equal(payload.status, 'active');
  assert.ok(payload.expiresOn == null, 'an emptied expiry carries no value');
  assert.ok(payload.notes == null, 'an emptied notes field carries no value');
  assert.ok(payload.receiptId == null, 'an emptied receipt carries no value');
  assert.equal(view.instance.item.supplier, 'Dell');
});

test('the bulk editor previews, approves and executes the exact server operation', async () => {
  const { c, app, mount } = setup();
  const previewRows = [
    importRow(0, { name: 'Notebook HP' }, { assetId: ASSET_ID, classification: 'safe', action: 'update', version: 'v1' }),
    importRow(1, { name: 'Notebook Dell' }, { assetId: OTHER_ID, classification: 'safe', action: 'update', version: 'v1' })
  ];
  const preview = analyzePayload(previewRows, { kind: 'bulk', state: 'preview' });
  const approved = analyzePayload(previewRows, { kind: 'bulk', state: 'approved', approved: true });
  const complete = analyzePayload(previewRows, {
    kind: 'bulk',
    state: 'complete',
    approved: true,
    processed: 2,
    summary: { created: 0, modified: 2, omitted: 0, failed: 0 }
  });
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/approve') !== -1) return response(approved);
    if (call.url.indexOf('/execute') !== -1) return response(complete);
    return response(preview);
  });
  const view = mount('Phase6BulkEditor', { open: true, ids: [ASSET_ID, OTHER_ID] });
  view.instance.changes.status = 'in_storage';
  view.instance.reason = 'Traslado de sala';

  await view.instance.preview();
  const request = JSON.parse(calls[0].body);
  assert.equal(calls[0].url, '/api/v1/bulk/preview');
  assert.deepEqual(request.assetIds, [ASSET_ID, OTHER_ID]);
  assert.equal(request.action, 'update');
  assert.deepEqual(request.changes, { status: 'in_storage' });
  assert.equal(view.instance.step, 2);

  await view.instance.approve();
  assert.ok(calls.find((call) => call.url.indexOf('/approve') !== -1));
  assert.equal(view.instance.step, 3);

  await view.instance.execute();
  assert.ok(calls.find((call) => call.url.indexOf('/execute') !== -1));
  assert.equal(view.instance.step, 4);
  assert.equal(app.phase6.operation.summary.modified, 2);
});

test('clearing the identity cancels pending reads and keeps no late server rows', async () => {
  const { c, app, mount } = setup();
  let release = null;
  const calls = stubFetch(c, () => new Promise((resolve) => { release = () => resolve(response({ items: [], hasMore: false })); }));
  const view = mount('Phase6Attachments', { asset: { id: ASSET_ID, name: 'Notebook HP' } });
  const pending = app.loadAssetAttachments(ASSET_ID, { offset: 0, limit: 50 });
  app.activeUserId = 'someone-else';
  app.identityChangedPhase6();
  release();

  assert.equal(await pending, false);
  assert.equal(app.phase6.attachments.assetId, '');
  assert.equal(app.phase6.attachments.items.length, 0);
  assert.ok(calls.length >= 1);
});

test('an unmounted surface cannot publish a read into the session that replaced it', async () => {
  const { c, app, mount } = setup();
  const pending = [];
  const calls = stubFetch(c, () => new Promise((resolve) => pending.push(resolve)));
  const view = mount('Phase6Attachments', { asset: { id: ASSET_ID, name: 'Notebook HP' } });
  const previousIndex = pending.length;
  const previousAsset = app.loadAssetAttachments(ASSET_ID, { offset: 0, limit: 50 });
  view.unmount();
  app.clearPhase6State();

  const currentIndex = pending.length;
  const current = app.loadAssetAttachments(OTHER_ID, { offset: 0, limit: 50 });
  pending[currentIndex](response({ items: [{ id: 'n-1', assetId: OTHER_ID, filename: 'vigente.pdf' }] }));
  assert.equal(await current, true);

  pending[previousIndex](response({ items: [{ id: 'old-1', assetId: ASSET_ID, filename: 'anterior.pdf' }] }));
  assert.equal(await previousAsset, false, 'the unmounted surface cannot publish its read');
  assert.equal(app.phase6.attachments.assetId, OTHER_ID);
  assert.deepEqual(app.phase6.attachments.items.map((item) => item.id), ['n-1']);
  assert.ok(calls.length >= 2);
});
