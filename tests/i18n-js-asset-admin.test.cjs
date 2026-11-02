'use strict';
// S3/S4/S10: the asset administration copy (validation errors, toasts, history
// entries, retired reasons, dialogs) comes from the catalog. Spanish stays
// byte-for-byte; stable ids and stored values never change with the locale.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

test('asset admin validation, labels and toasts render the Spanish source', async () => {
  const s = harness.setup();
  const app = s.app;
  const errors = app.validateAssetDraft({ name: ' ', category: '' });
  assert.equal(errors.name, 'El nombre del activo es obligatorio.');
  assert.equal(errors.category, 'Selecciona una categoría.');
  assert.equal(app.assetToneLabel('hold'), 'Sin asignar');
  assert.equal(app.assetToneLabel('desconocido'), 'Sin asignar');
  assert.equal(app.assetFieldValue({ tech: { poe: true } }, { key: 'poe', type: 'boolean' }), 'Sí');
  assert.equal(app.assetFieldTypeLabel('text'), 'Texto');
  assert.equal(app.assetWarrantyState(null).label, 'Sin garantía registrada');
  assert.equal(app.retireReasons.length, 5, 'the retired reason vocabulary stays complete');
  assert.deepEqual(Array.from(app.retireReasons, (reason) => reason.id)[0], 'end_of_life');
  assert.equal(app.retireReasons[0].label, 'Fin de vida útil');
  assert.equal(app.assetAdmin.statuses[0].id, 'asignado', 'the stable status id is untouched');
});

test('asset admin copy follows the locale and never leaks Spanish', async () => {
  const s = harness.setup();
  const app = s.app;
  await switchTo(s, 'en');

  const errors = app.validateAssetDraft({ name: '', category: '' });
  assert.equal(errors.name, 'The asset name is required.');
  assert.equal(errors.category, 'Select a category.');
  assert.equal(app.assetToneLabel('hold'), 'Unassigned');
  assert.equal(app.assetFieldValue({ tech: { poe: false } }, { key: 'poe', type: 'boolean' }), 'No');
  assert.equal(app.assetFieldTypeLabel('text'), 'Text');
  assert.equal(app.assetWarrantyState(null).label, 'No warranty recorded');
  assert.equal(app.retireReasons[0].label, 'End of life');
  assert.doesNotMatch(Array.from(app.retireReasons, (reason) => reason.label).join(' '), /vida útil|Avería|Robo|Sustitución|motivo/);

  await switchTo(s, 'es');
  assert.equal(app.validateAssetDraft({ name: '', category: '' }).name, 'El nombre del activo es obligatorio.');
  assert.equal(app.retireReasons[0].label, 'Fin de vida útil', 'the Spanish reason returns after the switch');
});

test('the retirement reason is a stable id and the record keeps human text', async () => {
  const s = harness.setup();
  const app = s.app;
  // The select value is the stable key suffix, so a stored record no longer
  // depends on the language that was active when the dialog was open.
  assert.deepEqual(Array.from(app.retireReasons, (reason) => reason.id), [
    'end_of_life', 'irreparable', 'theft', 'renewal', 'other'
  ]);
  assert.equal(app.retireReasons[0].label, 'Fin de vida útil');
  // A stored value that is a known id is translated; free text is shown verbatim.
  assert.equal(app.retireReasonText('end_of_life'), 'Fin de vida útil');
  assert.equal(app.retireReasonText('Fin de vida útil'), 'Fin de vida útil');

  const asset = app.assets[0];
  app.openRetireDialog(asset);
  assert.equal(app.retireDialog.reason, 'end_of_life', 'the dialog holds the id, not the visible label');
  app.retireDialog.acknowledged = true;
  app.confirmRetire();
  assert.equal(asset.retired.reason, 'Fin de vida útil', 'the record stores the translated text');

  await switchTo(s, 'en');
  app.retireDialog = Object.assign(app.retireDialog, { open: false });
  assert.equal(app.retireReasons[0].id, 'end_of_life', 'the id is locale independent');
  assert.equal(app.retireReasons[0].label, 'End of life');
  assert.equal(app.retireReasonText('theft'), 'Theft or loss');

  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const select = html.slice(html.indexOf('id="asset-retire-reason"'), html.indexOf('</select>', html.indexOf('id="asset-retire-reason"')));
  assert.ok(select.includes(':value="reason.id"'), 'the option value must be the stable id');
  assert.ok(select.includes('{{ reason.label }}'), 'the option label must be the translated text');
  assert.ok(html.includes('retireReasonText(currentAsset.retired.reason)'), 'a stored record is displayed through the resolver');
});

test('the server receives the translated text of a chosen retirement reason id', async () => {
  const s = harness.setup();
  const methods = s.c.AssetInventory.methods;
  const app = {
    inventoryLifecycle: null,
    openInventoryLifecycle() { this.inventoryLifecycle = { reason: '' }; return true; },
    confirmInventoryLifecycle() { return 'sent'; }
  };
  const asset = { id: 'asset-1' };
  await methods.retireInventoryAsset.call(app, asset, 'theft');
  assert.equal(app.inventoryLifecycle.reason, 'Robo o extravío', 'the id is translated before it leaves the browser');
  await switchTo(s, 'en');
  await methods.retireInventoryAsset.call(app, asset, 'theft');
  assert.equal(app.inventoryLifecycle.reason, 'Theft or loss');
  await methods.archiveInventoryAsset.call(app, asset, 'end_of_life');
  assert.equal(app.inventoryLifecycle.reason, 'End of life');
  // A free-text reason that the server already holds passes through untouched.
  await methods.archiveInventoryAsset.call(app, asset, 'Retirado por el proveedor');
  assert.equal(app.inventoryLifecycle.reason, 'Retirado por el proveedor');
});
