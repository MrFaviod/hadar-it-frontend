'use strict';
// Sweep M: the inventory adapter resolves its status fallbacks, history titles,
// editor validation, lifecycle/media failures and configuration toasts through
// `ui.inventory.*` at call time. Spanish stays the source copy; the English
// bundle only changes the vocabulary, never the server contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function inLocale(s, tag, run) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
  return run();
}

test('inventory adapter copy follows the active locale', async () => {
  const s = setup();
  try {
    await inLocale(s, 'es', async () => {
      assert.equal(s.app.inventoryStatusMeta('in_use').label, 'Asignado');
      assert.equal(s.app.inventoryStatusMeta('retired').label, 'Dado de baja');
      assert.equal(s.app.inventoryHistoryTitle('created'), 'Alta en el inventario');
      assert.equal(s.app.inventoryHistoryTitle('nope'), 'Cambio registrado');
      assert.equal(s.app.assetCommonField('location').label, 'Ubicación');
      assert.equal(s.app.inventoryEnvironmentLabel(), 'sin informar');
      assert.equal(s.app.assetSiteText({ serverAsset: true, site: '' }), 'Sin sede');
      assert.equal(s.app.validateInventoryDraft({ name: '', category: '' }).name, 'El nombre del activo es obligatorio.');
      assert.equal(s.app.inventoryFieldValue({ technical: { rack: true } }, { key: 'rack', type: 'boolean' }), 'Sí');
      s.app.inventoryConfigUnavailable();
      assert.equal(
        s.app.inventoryConfigError,
        'La configuración del inventario no está disponible en el servidor. Reintenta cuando la conexión se restablezca.'
      );
      assert.equal(s.app.lastToast, s.app.inventoryConfigError);
      s.app.inventoryConfigError = '';
    });
    await inLocale(s, 'en', async () => {
      assert.equal(s.app.inventoryStatusMeta('in_use').label, 'Assigned');
      assert.equal(s.app.inventoryStatusMeta('retired').label, 'Retired');
      assert.equal(s.app.inventoryHistoryTitle('created'), 'Created in the inventory');
      assert.equal(s.app.inventoryHistoryTitle('nope'), 'Recorded change');
      assert.equal(s.app.assetCommonField('location').label, 'Location');
      assert.equal(s.app.inventoryEnvironmentLabel(), 'not reported');
      assert.equal(s.app.assetSiteText({ serverAsset: true, site: '' }), 'No site');
      assert.equal(s.app.validateInventoryDraft({ name: '', category: '' }).name, 'The asset name is required.');
      assert.equal(s.app.inventoryFieldValue({ technical: { rack: true } }, { key: 'rack', type: 'boolean' }), 'Yes');
      s.app.inventoryConfigUnavailable();
      assert.equal(
        s.app.inventoryConfigError,
        'The inventory configuration is not available on the server. Retry when the connection is restored.'
      );
      assert.equal(s.app.lastToast, s.app.inventoryConfigError);
      s.app.inventoryConfigError = '';
    });
    await inLocale(s, 'es', async () => {
      assert.equal(s.app.inventoryStatusMeta('in_use').label, 'Asignado', 'the Spanish source copy returns');
    });
  } finally {
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});

// The server history list is loaded once and later re-rendered by the mounted
// template. The eager `title` stays for consumers that read the mapped record;
// the additive `titleKey` lets the asset history row follow the active locale.
const HISTORY_ITEMS = [
  {
    id: 'h-created', sequence: 1, assetId: 'asset-1', action: 'created',
    reason: '', notes: 'Alta manual', actorId: 'u1', actorUsername: 'ana',
    source: 'rest', entityType: 'asset', effectiveAt: '',
    quickCodeOld: '', quickCodeNew: 'DC-0002', statusOld: '', statusNew: 'in_use',
    archivedOld: null, archivedNew: false, changes: {}, createdAt: '2026-02-01T10:00:00Z'
  },
  {
    id: 'h-unknown', sequence: 2, assetId: 'asset-1', action: 'mystery_batch',
    reason: 'Lote heredado', notes: 'Texto libre', actorId: 'u2', actorUsername: 'luis',
    source: 'import', entityType: 'asset', effectiveAt: '',
    quickCodeOld: '', quickCodeNew: '', statusOld: '', statusNew: '',
    archivedOld: null, archivedNew: null, changes: {}, createdAt: '2026-02-02T10:00:00Z'
  }
];

function stubHistory(c) {
  const calls = [];
  c.fetch = async (url, init) => {
    calls.push({ url: url, init: init || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ assetId: 'asset-1', items: HISTORY_ITEMS, total: 2, limit: 50, offset: 0 })
    };
  };
  return calls;
}

test('an already loaded asset history follows the active locale', async () => {
  const s = setup();
  try {
    const calls = stubHistory(s.c);
    await inLocale(s, 'es', async () => {
      assert.equal(await s.app.loadInventoryHistory('asset-1'), true);
    });
    assert.equal(calls[0].url, '/api/v1/assets/asset-1/history?limit=50&offset=0');

    const [created, unknown] = s.app.inventoryHistory.items;
    // The semantic key is additive; the load-time title string is unchanged.
    assert.equal(created.titleKey, 'ui.inventory.history.created');
    assert.equal(unknown.titleKey, 'ui.inventory.history.fallback');
    assert.equal(created.title, 'Alta en el inventario');
    assert.equal(unknown.title, 'Cambio registrado');
    assert.equal(s.c.ItsmI18n.t(created.titleKey), 'Alta en el inventario');
    assert.equal(s.c.ItsmI18n.t(unknown.titleKey), 'Cambio registrado');

    // Every other mapped field of the pre-existing contract is still there.
    const { titleKey: _key, title: _title, ...rest } = created;
    assert.deepEqual(JSON.parse(JSON.stringify(rest)), {
      id: 'h-created', sequence: 1, action: 'created',
      reason: '', notes: 'Alta manual', actor: 'ana', actorId: 'u1', source: 'rest',
      entityType: 'asset', entityId: 'asset-1', effectiveAt: '',
      quickCodeOld: '', quickCodeNew: 'DC-0002', statusOld: '', statusNew: 'in_use',
      archivedOld: null, archivedNew: false, changes: {},
      recordedAt: '2026-02-01T10:00:00Z', createdAt: '2026-02-01T10:00:00Z'
    });
    assert.equal(unknown.actor, 'luis');
    assert.equal(unknown.notes, 'Texto libre');
    assert.equal(unknown.reason, 'Lote heredado');

    await inLocale(s, 'en', async () => {
      // The row re-renders through `$t(entry.titleKey)`, without a reload.
      assert.equal(s.c.ItsmI18n.t(created.titleKey), 'Created in the inventory');
      assert.equal(s.c.ItsmI18n.t(unknown.titleKey), 'Recorded change');
      assert.equal(created.title, 'Alta en el inventario', 'the load-time string stays for direct consumers');
      assert.equal(unknown.title, 'Cambio registrado');
      assert.equal(created.notes, 'Alta manual', 'free server text is never translated');
      assert.equal(unknown.reason, 'Lote heredado');
      assert.equal(created.action, 'created');
      assert.equal(unknown.action, 'mystery_batch');
    });
    await inLocale(s, 'es', async () => {
      assert.equal(s.c.ItsmI18n.t(created.titleKey), 'Alta en el inventario');
      assert.equal(s.c.ItsmI18n.t(unknown.titleKey), 'Cambio registrado');
    });
  } finally {
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
