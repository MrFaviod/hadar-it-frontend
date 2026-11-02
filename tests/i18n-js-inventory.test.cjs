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
