'use strict';
// User-visible copy that was hardcoded in the engines and views now comes from
// the shared packs; the Spanish source stays in the catalogs, not in code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('operation change labels are translated, not Spanish literals', () => {
  const src = read('assets/js/operations-engine.js');
  assert.doesNotMatch(src, /label: 'Sede'|'site', 'Sede'|label: 'Responsable'|label: 'Coste'/);
  assert.match(src, /tr\('ui\.operations\.field\.responsible'\)/);
});

test('the dashboard latency chart uses the unit key instead of a literal', () => {
  assert.doesNotMatch(read('assets/js/dashboard-views.js'), /'availability' \? '%' : 'ms'/);
});

test('duplicating an appearance preset uses the translated suffix', () => {
  const src = read('assets/js/appearance-engine.js');
  assert.doesNotMatch(src, / · Copia/);
  assert.match(src, /tr\('ui\.appearance\.preset\.copy_suffix'\)/);
});

test('the new copy keys exist in all three catalogs', () => {
  for (const file of ['en', 'es', 'context']) {
    const catalog = JSON.parse(read('assets/i18n/' + file + '.json'));
    assert.ok('ui.operations.field.responsible' in catalog, file + ' is missing ui.operations.field.responsible');
    assert.ok('ui.appearance.preset.copy_suffix' in catalog, file + ' is missing ui.appearance.preset.copy_suffix');
  }
});
