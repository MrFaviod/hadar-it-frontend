'use strict';
// T3 JS-string follow-up: the search index composes record types, section names
// and subtitles in JavaScript. They must resolve through `ui.search.*` and
// `ui.workspace.*` with no Spanish fallback baked into the module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setup } = require('./universal-harness.cjs');

function indexFixture() {
  const s = setup();
  const app = {
    can: () => true,
    assets: [],
    people: [],
    maintenance: {},
    phase9: { templates: { items: [{ id: 'inventory-list', name: 'Listado', family: 'inventory' }] } }
  };
  return { s, search: s.c.AssetSearch, i18n: s.c.ItsmI18n, app };
}

test('search record types and section labels follow the active locale', () => {
  const { search, i18n, app } = indexFixture();
  i18n.setLocale('es');
  assert.equal(search.types.asset, 'Activos');
  assert.equal(search.types.action, 'Acciones');
  const spanish = search.buildIndex(app);
  const inventory = spanish.find((record) => record.key === 'section:inventory');
  assert.equal(inventory.label, 'Inventario');
  assert.equal(inventory.type, 'Secciones');
  assert.equal(inventory.subtitle, 'Sección de la aplicación');

  i18n.setLocale('en');
  assert.equal(search.types.asset, 'Assets');
  assert.equal(search.types.action, 'Actions');
  const english = search.buildIndex(app);
  const inventoryEn = english.find((record) => record.key === 'section:inventory');
  assert.equal(inventoryEn.label, 'Inventory');
  assert.equal(inventoryEn.type, 'Sections');
  assert.equal(inventoryEn.subtitle, 'Application section');
  i18n.setLocale('es');
});

test('the module carries no Spanish fallback copy of its own', () => {
  // Some harnesses evaluate the engine without the runtime; the catalog is the
  // only source of copy, so a bare module must show nothing instead of Spanish.
  const c = vm.createContext({});
  c.window = c;
  vm.runInContext(fs.readFileSync('assets/js/search-engine.js', 'utf8'), c);
  assert.equal(c.AssetSearch.types.asset, '');
  const section = c.AssetSearch.buildIndex({ can: () => true, assets: [], people: [], maintenance: {}, phase9: { templates: { items: [] } } })
    .find((record) => record.key === 'section:inventory');
  // Without the runtime a record falls back to its stable id, never to Spanish.
  assert.equal(section.label, 'inventory');
  assert.equal(section.subtitle, '');
});

test('a report template subtitle names its family in the active locale', () => {
  const { search, i18n, app } = indexFixture();
  i18n.setLocale('es');
  const spanish = search.buildIndex(app).find((record) => record.key === 'report:inventory-list');
  assert.equal(spanish.subtitle, 'Plantilla · Inventario');
  i18n.setLocale('en');
  const english = search.buildIndex(app).find((record) => record.key === 'report:inventory-list');
  assert.equal(english.subtitle, 'Template · Inventory');
  i18n.setLocale('es');
});
