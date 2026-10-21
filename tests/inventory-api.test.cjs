'use strict';
// Server-authority contract for the F3 inventory adapter.
// Each test fails if the browser falls back to localStorage/prototype assets,
// filters only the current page, or invents fields the API does not accept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';

function dto(overrides) {
  return Object.assign(
    {
      id: ASSET_ID,
      quickCode: 'NB-CEN-001',
      name: 'Notebook de dirección',
      category: 'Notebooks',
      type: 'Notebook',
      brand: 'Lenovo',
      model: 'T14',
      serial: 'SN-1',
      ip: '10.0.0.15',
      site: 'Sede Central',
      location: 'Piso 4 · Dirección',
      responsible: 'Ana Benítez',
      status: 'in_use',
      description: '',
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-06T11:30:00Z'
    },
    overrides
  );
}

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function stubFetch(c, handler) {
  const calls = [];
  c.fetch = async (url, init) => {
    const call = { url, init: init || {}, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  };
  return calls;
}

test('inventory reads the server collection instead of the prototype assets', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, () => json({ items: [dto()], total: 41, limit: 25, offset: 0 }));
  const demoCount = app.assets.length;

  assert.equal(await app.loadInventory(), true);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/v1\/assets\/search\?/);
  assert.match(calls[0].url, /limit=25/);
  assert.match(calls[0].url, /offset=0/);
  assert.equal(app.inventory.total, 41);
  assert.equal(app.inventory.items.length, 1);
  assert.equal(app.inventory.items[0].id, ASSET_ID);
  assert.equal(app.inventory.items[0].code, 'NB-CEN-001');
  assert.equal(app.inventory.items[0].status, 'Asignado');
  assert.equal(app.assets.length, demoCount, 'prototype collection must not be replaced');
  assert.equal(app.assets.some((asset) => asset.id === ASSET_ID), false);
});

test('search asks the server for the query and filters of the whole collection', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, () => json({ items: [], total: 0, limit: 25, offset: 0 }));
  app.inventoryFilters.query = 'matriz';
  app.inventoryFilters.category = 'servidores';
  app.inventoryFilters.status = 'in_storage';

  await app.loadInventory();

  assert.match(calls[0].url, /query=matriz/);
  assert.match(calls[0].url, /category=Servidores/);
  assert.match(calls[0].url, /status=in_storage/);
});

test('pagination is bounded and asks for the next server offset', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, (call) => {
    const offset = Number((call.url.match(/offset=(\d+)/) || [])[1] || 0);
    return json({ items: [dto()], total: 60, limit: 25, offset });
  });
  await app.loadInventory();

  assert.equal(app.inventoryPages, 3);
  assert.equal(app.inventoryPage, 1);
  assert.equal(app.inventoryHasPrev, false);
  assert.equal(app.inventoryHasNext, true);

  await app.nextInventoryPage();

  assert.match(calls[1].url, /offset=25/);
  await app.prevInventoryPage();
  assert.match(calls[2].url, /offset=0/);
});

test('detail is fetched by permanent id even when the asset is outside the current page', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, (call) => {
    if (call.url.startsWith('/api/v1/assets/')) {
      return json(dto({ id: OTHER_ID, quickCode: 'SRV-DC-004', name: 'Servidor de base de datos', category: 'Servidores' }));
    }
    return json({ items: [dto()], total: 41, limit: 25, offset: 0 });
  });
  await app.loadInventory();
  app.route = { name: 'detail', assetId: OTHER_ID };

  assert.equal(await app.loadInventoryDetail(OTHER_ID), true);

  assert.equal(calls[1].url, '/api/v1/assets/' + OTHER_ID);
  assert.equal(app.currentAsset.id, OTHER_ID);
  assert.equal(app.currentAsset.code, 'SRV-DC-004');
  assert.equal(app.currentAsset.serverAsset, true);
  assert.equal(app.serverAssetMode, true);
});

test('create posts only the fields the inventory API accepts', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'POST') return json(dto({ quickCode: 'SW-CEN-001', name: 'Switch Aruba' }), 201);
    return json({ items: [dto({ quickCode: 'SW-CEN-001', name: 'Switch Aruba' })], total: 1, limit: 25, offset: 0 });
  });

  app.openAssetCreate();
  app.assetEditor.draft.name = 'Switch Aruba';
  app.assetEditor.draft.category = 'switches';
  app.assetEditor.draft.site = 'Example Site';
  app.assetEditor.draft.responsible = 'Marta Ríos';
  app.assetEditor.draft.quickCode = '';

  assert.ok(await app.saveAsset());

  const post = calls[0];
  assert.equal(post.url, '/api/v1/assets');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.body.name, 'Switch Aruba');
  assert.equal(post.body.category, 'Switches');
  assert.equal(post.body.site, 'Example Site');
  assert.equal(post.body.responsible, 'Marta Ríos');
  assert.equal(post.body.status, 'in_use');
  assert.equal('quickCode' in post.body, false, 'blank quick code must be filled by the server');
  for (const unsupported of ['id', 'code', 'image', 'cost', 'warranty', 'tech', 'assigneeId', 'statusId', 'history', 'retired']) {
    assert.equal(unsupported in post.body, false, unsupported + ' is not part of the API contract');
  }
  assert.equal(calls[1].url.indexOf('/api/v1/assets/search?'), 0, 'inventory is reloaded from the server');
});

test('update patches the permanent id and keeps the quick code mutable', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'PATCH') return json(dto({ quickCode: 'NB-CEN-999' }));
    return json({ items: [dto({ quickCode: 'NB-CEN-999' })], total: 1, limit: 25, offset: 0 });
  });
  app.inventoryDetail = { id: ASSET_ID, asset: app.inventoryMapAsset(dto()), loading: false, error: '', requestId: 0 };

  app.openAssetEdit(app.inventoryDetail.asset);
  app.assetEditor.draft.quickCode = 'NB-CEN-999';
  assert.ok(await app.saveAsset());

  const patch = calls[0];
  assert.equal(patch.url, '/api/v1/assets/' + ASSET_ID);
  assert.equal(patch.init.method, 'PATCH');
  assert.equal(patch.body.quickCode, 'NB-CEN-999');
  assert.equal('id' in patch.body, false, 'the immutable id must never be patched');
});

test('validation blocks the request and marks the field', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, () => json({ items: [], total: 0, limit: 25, offset: 0 }));

  app.openAssetCreate();
  app.assetEditor.draft.name = '   ';
  assert.equal(await app.saveAsset(), false);
  assert.equal(calls.length, 0);
  assert.ok(app.assetEditorErrors.name);

  app.assetEditor.draft.name = 'Switch Aruba';
  app.assetEditor.draft.responsible = 'x'.repeat(121);
  assert.equal(await app.saveAsset(), false);
  assert.equal(calls.length, 0);
  assert.ok(app.assetEditorErrors.responsible);
});

test('a conflicting quick code is reported without writing local state', async () => {
  const { c, app } = setup();
  stubFetch(c, () => json({ error: { code: 'conflict', message: 'quick code already exists' } }, 409));

  app.openAssetCreate();
  app.assetEditor.draft.name = 'Switch Aruba';
  app.assetEditor.draft.quickCode = 'SW-DUP-001';

  assert.equal(await app.saveAsset(), false);
  assert.match(app.assetEditor.error, /código rápido/i);
  assert.ok(app.assetEditorErrors.quickCode);
  assert.equal(app.assets.some((asset) => asset.code === 'SW-DUP-001'), false);
});

test('server categories map to the existing illustration and keep the server label', async () => {
  const { app } = setup();
  const mapped = app.inventoryMapAsset(dto({ category: 'Notebooks' }));
  assert.equal(mapped.image, 'assets/svg/devices/notebook.svg');
  assert.equal(mapped.category, 'notebooks');

  const unknown = app.inventoryMapAsset(dto({ category: 'Kioscos' }));
  assert.equal(unknown.categoryText, 'Kioscos');
  assert.equal(app.inventoryCategoryLabel(unknown), 'Kioscos');
});

test('clearing the session drops inventory state and stale responses cannot restore it', async () => {
  const { c, app } = setup();
  let resolvePending;
  stubFetch(c, () => new Promise((resolve) => { resolvePending = resolve; }));

  const pending = app.loadInventory();
  app.clearInventoryState();
  resolvePending(json({ items: [dto()], total: 1, limit: 25, offset: 0 }));
  await pending;

  assert.equal(app.inventory.items.length, 0);
  assert.equal(app.inventory.total, 0);
  assert.equal(app.inventory.loaded, false);
  assert.equal(app.inventoryDetail.asset, null);
});

test('a permission without assets.view never calls the API', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, () => json({ items: [], total: 0, limit: 25, offset: 0 }));
  app.can = () => false;

  assert.equal(await app.loadInventory(), false);
  assert.equal(calls.length, 0);
});

test('a response started before a session clear never revives the old list', async () => {
  const { c, app } = setup();
  const pending = [];
  c.AssetAccess.request = (vm, path, options) => new Promise((resolve) => pending.push({ resolve, options }));

  const first = app.loadInventory();
  app.clearInventoryState();
  const second = app.loadInventory();

  pending[1].resolve({ items: [dto({ id: OTHER_ID, name: 'Nuevo' })], total: 1, limit: 25, offset: 0 });
  await second;
  pending[0].resolve({ items: [dto({ name: 'Viejo' })], total: 99, limit: 25, offset: 0 });
  await first;

  assert.equal(app.inventory.total, 1);
  assert.equal(app.inventory.items.length, 1);
  assert.equal(app.inventory.items[0].id, OTHER_ID);
});

test('a save that resolves after logout does not report success', async () => {
  const { c, app } = setup();
  let release = null;
  c.AssetAccess.request = () => new Promise((resolve) => { release = resolve; });

  app.openAssetCreate();
  app.assetEditor.draft.name = 'Servidor nuevo';
  const saving = app.saveAsset();

  app.authenticated = false;
  app.clearInventoryState();
  release(dto());

  assert.equal(await saving, false);
  assert.equal(app.lastToast, undefined);
  assert.equal(app.inventory.items.length, 0);
  assert.equal(app.inventory.total, 0);
  assert.equal(app.inventoryDetail.asset, null);
});

test('the responsible field stays read-only without assets.assign', async () => {
  const { app } = setup();
  app.can = (permission) => permission !== 'assets.assign';

  assert.equal(app.assetFieldLocked('responsible'), true);
  assert.equal(app.assetFieldLocked('name'), false);

  app.openAssetEdit(app.inventoryMapAsset(dto()));
  assert.equal(app.inventoryPayload(app.assetEditor.draft).responsible, undefined);

  app.can = () => true;
  assert.equal(app.assetFieldLocked('responsible'), false);
  assert.equal(app.inventoryPayload(app.assetEditor.draft).responsible, 'Ana Benítez');
});
