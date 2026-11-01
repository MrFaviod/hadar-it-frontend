'use strict';
// S3/S10 sweep G, labels: the label vocabulary, the label center and the QR/
// public-link surfaces render their copy from `ui.labels.*` / `ui.qr.*`.
// Stable field ids never change with the locale; only the visible label does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');

const ROOT = path.join(__dirname, '..');

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

async function switchTo(s, tag) {
  // The runtime only switches once the target bundle is loaded.
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

test('the label vocabulary translates while the field ids stay stable', async () => {
  const s = setup();
  const label = s.c.AssetLabelEngine;
  assert.equal(label.publicFieldOf('name').label, 'Nombre', 'Spanish stays the source');
  assert.equal(label.FORMATS[0].label, 'A4 · 24 etiquetas', 'Spanish format label is unchanged');
  assert.equal(label.formatOf('custom').detail, 'Define tamaño, márgenes y columnas');

  await switchTo(s, 'en');
  assert.equal(label.publicFieldOf('name').label, 'Name', 'the English field label is shown');
  assert.equal(label.FORMATS[0].label, 'A4 · 24 labels', 'the English format label is shown');
  assert.equal(label.formatOf('custom').detail, 'Set size, margins and columns');
  assert.deepEqual(Array.from(label.LABEL_FIELDS, (field) => field.key), ['logo', 'name', 'id', 'code', 'qr', 'site', 'location', 'serial']);
  assert.deepEqual(Array.from(label.PUBLIC_FIELDS, (field) => field.key), ['id', 'quickCode', 'name', 'category', 'site', 'location', 'status']);

  await switchTo(s, 'es');
  assert.equal(label.publicFieldOf('name').label, 'Nombre', 'the source label returns after the switch');
});

test('the label settings section renders English and keeps the Spanish source', async () => {
  const s = setup();
  const view = s.mount('LabelSettings', { app: s.app });
  await s.settle();
  const spanish = textOf(view.root);
  assert.match(spanish, /Formatos y valores de etiquetas/, 'the Spanish heading is unchanged');
  assert.match(spanish, /Guardar valores/, 'the Spanish action is unchanged');

  await switchTo(s, 'en');
  const english = textOf(view.root);
  assert.match(english, /Label formats and defaults/, 'the English heading is shown');
  assert.match(english, /Save values/, 'the English action is shown');
  assert.doesNotMatch(english, /Formatos y valores de etiquetas|Guardar valores/, 'no Spanish copy leaks into English');

  await switchTo(s, 'es');
  assert.match(textOf(view.root), /Formatos y valores de etiquetas/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the QR settings section renders English and keeps the Spanish source', async () => {
  const s = setup();
  const view = s.mount('QrSettings', { app: s.app });
  await s.settle();
  assert.match(textOf(view.root), /URL base y códigos QR/, 'the Spanish heading is unchanged');
  assert.match(textOf(view.root), /Guardar URL base/);

  await switchTo(s, 'en');
  const english = textOf(view.root);
  assert.match(english, /Base URL and QR codes/, 'the English heading is shown');
  assert.match(english, /Save base URL/);
  assert.doesNotMatch(english, /códigos QR|Guardar/, 'no Spanish copy leaks into English');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the labels center source carries no hard-coded copy', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/label-views.js'), 'utf8');
  assert.ok(source.includes("$t('ui.labels."), 'the labels center reads catalog keys');
  assert.ok(!source.includes('Etiquetas de inventario'), 'the old Spanish title literal is gone');
  assert.ok(!source.includes('Hoja de etiquetas'), 'the old Spanish preview literal is gone');
});

test('the label engine source carries no hard-coded copy', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/label-engine.js'), 'utf8');
  assert.ok(source.includes('ui.labels.field.'), 'the field vocabulary reads catalog keys');
  assert.ok(!source.includes("label: 'Código rápido'"), 'the old Spanish field labels are gone');
});
