'use strict';
// S3/S10: the label vocabulary resolves every visible label through the catalog.
// Spanish is the source locale, so removing the runtime must never leave a
// hard-coded Spanish label behind in the module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./universal-harness.cjs');

const ROOT = path.join(__dirname, '..');

function engineWithoutRuntime() {
  const c = vm.createContext({ console });
  c.window = c;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/label-engine.js'), 'utf8'), c);
  return c.AssetLabelEngine;
}

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

test('the label vocabulary carries no Spanish of its own', () => {
  const engine = engineWithoutRuntime();
  assert.ok(engine, 'the label engine is loaded');
  assert.equal(engine.publicFieldOf('name').label, '', 'the catalog is the only source of the visible label');
  assert.equal(engine.publicFieldOf('id').label, '', 'the catalog is the only source of the visible label');
  assert.equal(engine.LABEL_FIELDS.length, 8, 'the field vocabulary stays complete');
  assert.equal(engine.FORMATS[0].label, '', 'the format label comes from the catalog only');
  assert.equal(engine.formatOf('custom').detail, '', 'the format detail comes from the catalog only');
  assert.equal(engine.FORMATS[0].id, 'a4-24', 'the stable format id never changes');
  assert.deepEqual(Array.from(engine.LABEL_FIELDS, (field) => field.key), ['logo', 'name', 'id', 'code', 'qr', 'site', 'location', 'serial']);
});

test('the label vocabulary renders both locales through the runtime', async () => {
  const s = harness.setup();
  const engine = s.c.AssetLabelEngine;
  assert.equal(engine.publicFieldOf('name').label, 'Nombre', 'Spanish stays the source');
  assert.equal(engine.FORMATS[0].label, 'A4 · 24 etiquetas', 'Spanish format label is unchanged');

  await switchTo(s, 'en');
  assert.equal(engine.publicFieldOf('name').label, 'Name', 'the English field label is shown');
  assert.equal(engine.FORMATS[0].label, 'A4 · 24 labels', 'the English format label is shown');
  assert.deepEqual(Array.from(engine.LABEL_FIELDS, (field) => field.key), ['logo', 'name', 'id', 'code', 'qr', 'site', 'location', 'serial'], 'the stable ids never change');

  await switchTo(s, 'es');
  assert.equal(engine.publicFieldOf('name').label, 'Nombre', 'the Spanish label returns after the switch');
});
