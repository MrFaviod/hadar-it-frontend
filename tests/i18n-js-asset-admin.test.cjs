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
  assert.equal(app.retireReasons[0], 'Fin de vida útil');
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
  assert.equal(app.retireReasons[0], 'End of life');
  assert.doesNotMatch(app.retireReasons.join(' '), /vida útil|Avería|Robo|Sustitución|motivo/);

  await switchTo(s, 'es');
  assert.equal(app.validateAssetDraft({ name: '', category: '' }).name, 'El nombre del activo es obligatorio.');
  assert.equal(app.retireReasons[0], 'Fin de vida útil', 'the Spanish reason returns after the switch');
});
