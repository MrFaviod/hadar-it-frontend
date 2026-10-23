'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

/*
 * The incumbent four-step bulk editor keeps its template, but every change it
 * shows and applies comes from the server: preview (fixed targets and values),
 * human approval, then execution. These tests mount the real component and
 * drive the same controls an operator uses, so they fail if the view returns to
 * computing or persisting changes in the browser.
 */

const plain = (value) => JSON.parse(JSON.stringify(value));

function serverAsset(overrides) {
  return Object.assign({
    id: 'asset-1',
    code: 'IMP-1',
    name: 'Impresora',
    category: 'printer',
    categoryText: 'Impresora',
    type: 'Impresora',
    brand: 'HP',
    model: 'M404',
    serial: 'SN-1',
    ip: '10.0.0.11',
    siteId: 'site-a',
    site: 'Sede Norte',
    locationId: 'loc-a',
    location: 'Planta baja',
    responsible: 'Ana Canónica',
    responsiblePersonId: 'person-a',
    statusId: 'in_use',
    status: 'En uso',
    tech: { color: false },
    serverAsset: true
  }, overrides || {});
}

function fixture(t, options = {}) {
  const { c, app, mount } = harness.setup();
  // Estado real del adaptador de inventario: la vista lee la colección
  // canónica y las opciones se derivan del catálogo, nunca de colecciones
  // locales del prototipo.
  const assets = (options.assets || []).slice();
  app.inventory.items = assets;
  app.inventory.total = assets.length;
  app.inventory.loaded = true;
  app.assetSiteLocations = (siteId) => siteId === 'site-a'
    ? [{ id: 'loc-a', label: 'Planta baja' }, { id: 'loc-b', label: 'Almacén' }]
    : [];
  app.inventoryCatalog.statuses = [
    { id: 'in_use', label: 'En uso', active: true, final: false },
    { id: 'maintenance', label: 'Mantenimiento', active: true, final: false },
    { id: 'retired', label: 'De baja', active: true, final: true }
  ];
  app.organization = Object.assign({}, app.organization, {
    locations: Object.assign({}, app.organization.locations, {
      items: [
        { id: 'site-a', level: 'site', parentId: null, name: 'Sede Norte', active: true, levelLabel: 'Sede' },
        { id: 'site-b', level: 'site', parentId: null, name: 'Sede Sur', active: true, levelLabel: 'Sede' }
      ],
      total: 2,
      loaded: true,
      loading: false,
      error: ''
    }),
    people: {
      items: [
        { id: 'person-a', name: 'Ana Canónica', active: true },
        { id: 'person-b', name: 'Luis Canónico', active: true }
      ]
    }
  });
  app.inventoryTechnicalFields = (category) => category === 'printer'
    ? [{ key: 'color', label: 'Color', type: 'boolean', options: [], active: true }]
    : [];
  app.assetImage = () => '';
  app.phase6.operation = { id: '', state: '', rows: [], summary: { created: 0, modified: 0, omitted: 0, failed: 0 } };
  let inventoryReloads = 0;
  app.loadInventory = () => { inventoryReloads += 1; };
  const mounted = mount('BulkEditor', { open: true, ids: options.ids || [] });
  t.after(() => mounted.unmount());
  return { c, app, mount, view: mounted.instance, root: mounted.root, reloads: () => inventoryReloads };
}

function safeRows(ids) {
  return ids.map((id, index) => ({
    index: index,
    assetId: id,
    version: 'v1',
    values: {},
    action: 'update',
    classification: 'safe',
    errors: []
  }));
}

test('the four-step bulk editor previews fixed server values, then approves and executes', async (t) => {
  const assets = [
    serverAsset({ id: 'asset-1' }),
    serverAsset({ id: 'asset-2', code: 'IMP-2', name: 'Impresora 2', serial: 'SN-2' })
  ];
  const { app, c, view, reloads } = fixture(t, { assets: assets, ids: ['asset-1', 'asset-2'] });

  const previews = [];
  const order = [];
  let engineCalls = 0;
  let persisted = 0;
  app.bulkPreviewPhase6 = async (input) => {
    previews.push(plain(input));
    app.phase6.operation = {
      id: 'op-1',
      state: 'preview',
      approved: false,
      total: 2,
      processed: 0,
      rows: safeRows(['asset-1', 'asset-2']),
      summary: { created: 0, modified: 0, omitted: 0, failed: 0 }
    };
    return { ok: true };
  };
  app.approvePhase6Operation = async () => { order.push('approve'); return { ok: true }; };
  app.executePhase6Operation = async () => {
    order.push('execute');
    app.phase6.operation.state = 'complete';
    app.phase6.operation.rows = app.phase6.operation.rows.map((row) => Object.assign({}, row, { result: 'modified' }));
    app.phase6.operation.summary = { created: 0, modified: 2, omitted: 0, failed: 0 };
    return { ok: true, jobId: '' };
  };
  // The prototype engine and its browser persistence must stay out of this path.
  app.persistAssets = () => { persisted += 1; };
  app.persistAssignments = () => { persisted += 1; };
  const originalApply = c.AssetOpsEngine.applyBulk;
  const originalCompute = c.AssetOpsEngine.computeBulk;
  c.AssetOpsEngine.applyBulk = () => { engineCalls += 1; return []; };
  c.AssetOpsEngine.computeBulk = () => { engineCalls += 1; return []; };
  t.after(() => {
    c.AssetOpsEngine.applyBulk = originalApply;
    c.AssetOpsEngine.computeBulk = originalCompute;
  });

  assert.equal(view.selectedCount, 2);
  assert.equal(view.steps.length, 4);
  assert.match(c.options.components.BulkEditor.template, /flow-steps--four/);

  view.toggleField('statusId');
  view.toggleField('assigneeId');
  view.setValue('assigneeId', 'person-b');
  view.toggleField('site');
  view.toggleField('locationId');
  view.setValue('locationId', 'loc-b');
  view.toggleField('brand');
  view.setValue('brand', 'Kyocera');
  view.toggleField('tech.color');
  assert.equal(view.values.statusId, 'maintenance');
  assert.equal(view.values.site, 'site-a');
  assert.equal(view.values['tech.color'], 'true');

  await view.toPreview();

  // Exact canonical payload: only the marked fields, never the whole asset.
  assert.deepEqual(previews[0], {
    assetIds: ['asset-1', 'asset-2'],
    changes: {
      status: 'maintenance',
      responsible_person_id: 'person-b',
      site_id: 'site-a',
      location_id: 'loc-b',
      brand: 'Kyocera',
      technical: { color: true }
    },
    action: 'update'
  });
  assert.equal(view.step, 3);
  assert.deepEqual(plain(view.counts), { applied: 2, unchanged: 0, skipped: 0 });
  assert.deepEqual(plain(view.rows[0].changes), [
    { field: 'status', label: 'Estado', before: 'En uso', after: 'Mantenimiento' },
    { field: 'assigneeId', label: 'Responsable', before: 'Ana Canónica', after: 'Luis Canónico' },
    { field: 'locationId', label: 'Ubicación', before: 'Planta baja', after: 'Almacén' },
    { field: 'brand', label: 'Marca', before: 'HP', after: 'Kyocera' },
    { field: 'tech.color', label: 'Color', before: 'No', after: 'Sí' }
  ]);

  await view.apply();

  assert.deepEqual(order, ['approve', 'execute']);
  assert.equal(view.step, 4);
  assert.equal(view.result.applied.length, 2);
  assert.deepEqual(plain(view.result.summary), { created: 0, modified: 2, omitted: 0, failed: 0 });
  assert.match(app.lastToast, /2 modificados/);
  assert.match(app.lastToast, /0 con error/);
  assert.equal(reloads(), 1);
  assert.equal(engineCalls, 0);
  assert.equal(persisted, 0);
});

test('server-classified rows are shown as omissions and skipped before approval', async (t) => {
  const assets = [
    serverAsset({ id: 'asset-1' }),
    serverAsset({ id: 'asset-2', code: 'IMP-2', name: 'Impresora 2' })
  ];
  const { app, view } = fixture(t, { assets: assets, ids: ['asset-1', 'asset-2'] });
  const order = [];
  app.bulkPreviewPhase6 = async () => {
    app.phase6.operation = {
      id: 'op-2',
      state: 'preview',
      approved: false,
      total: 2,
      processed: 0,
      rows: [
        { index: 0, assetId: 'asset-1', version: 'v1', values: {}, action: 'update', classification: 'safe', errors: [] },
        { index: 1, assetId: 'asset-2', version: 'v1', values: {}, action: 'update', classification: 'error', errors: ['La categoría no admite el campo «color».'] }
      ],
      summary: { created: 0, modified: 0, omitted: 0, failed: 0 }
    };
    return { ok: true };
  };
  app.resolvePhase6Row = async (index, action) => { order.push('resolve:' + index + ':' + action); return { ok: true }; };
  app.approvePhase6Operation = async () => { order.push('approve'); return { ok: true }; };
  app.executePhase6Operation = async () => {
    order.push('execute');
    app.phase6.operation.state = 'complete';
    app.phase6.operation.rows = [
      Object.assign({}, app.phase6.operation.rows[0], { result: 'modified' }),
      Object.assign({}, app.phase6.operation.rows[1], { result: 'omitted' })
    ];
    app.phase6.operation.summary = { created: 0, modified: 1, omitted: 1, failed: 0 };
    return { ok: true };
  };

  view.toggleField('statusId');
  await view.toPreview();

  assert.equal(view.step, 3);
  assert.equal(view.rows[1].skipped, true);
  assert.deepEqual(plain(view.rows[1].changes), []);
  assert.match(view.rows[1].skipReason, /no admite el campo/);
  assert.deepEqual(plain(view.counts), { applied: 1, unchanged: 0, skipped: 1 });

  await view.apply();

  assert.deepEqual(order, ['resolve:1:skip', 'approve', 'execute']);
  assert.equal(view.step, 4);
  assert.equal(view.result.applied.length, 1);
  assert.deepEqual(plain(view.result.summary), { created: 0, modified: 1, omitted: 1, failed: 0 });
  assert.match(app.lastToast, /1 modificados · 0 creados · 1 omitidos · 0 con error\./);
});

test('a rejected preview stays on the field step with the server error', async (t) => {
  const { app, view } = fixture(t, { assets: [serverAsset({})], ids: ['asset-1'] });
  let approved = 0;
  app.bulkPreviewPhase6 = async () => ({ ok: false, error: 'El activo ya no existe en el inventario.' });
  app.approvePhase6Operation = async () => { approved += 1; return { ok: true }; };
  app.executePhase6Operation = async () => { approved += 1; return { ok: true }; };

  view.toggleField('statusId');
  await view.toPreview();

  assert.equal(view.step, 1);
  assert.deepEqual(plain(view.rows), []);
  assert.equal(view.errors.general, 'El activo ya no existe en el inventario.');
  assert.equal(approved, 0);
});

test('retired and unloaded assets stay out of the previewed targets', async (t) => {
  const assets = [
    serverAsset({ id: 'asset-1' }),
    serverAsset({ id: 'asset-2', statusId: 'retired', status: 'De baja', retired: { at: '2026-01-02', reason: 'Fin de vida', note: '' } })
  ];
  const { app, view } = fixture(t, { assets: assets, ids: ['asset-1', 'asset-2', 'asset-404'] });
  const previews = [];
  app.bulkPreviewPhase6 = async (input) => {
    previews.push(plain(input));
    app.phase6.operation = {
      id: 'op-3', state: 'preview', approved: false, total: 1, processed: 0,
      rows: safeRows(['asset-1']),
      summary: { created: 0, modified: 0, omitted: 0, failed: 0 }
    };
    return { ok: true };
  };

  view.toggleField('statusId');
  await view.toPreview();

  assert.deepEqual(previews[0].assetIds, ['asset-1']);
  assert.deepEqual(plain(previews[0].changes), { status: 'maintenance' });
  assert.equal(view.rows[1].skipped, true);
  assert.match(view.rows[1].skipReason, /dado de baja/);
  assert.equal(view.rows[2].skipped, true);
  assert.match(view.rows[2].skipReason, /página cargada del inventario/);
  assert.deepEqual(plain(view.counts), { applied: 1, unchanged: 0, skipped: 2 });
});
