'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(hash) {
  const context = { window: { AssetStore: { KEYS: {} }, location: { hash } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/methods.js'), 'utf8'), context);
  return context.window;
}
// Catches the unknown-route fallback silently sending a help link to Panel.
test('help is a round-trip route without changing existing inventory routing', () => {
  const w = load('#/ayuda');
  const route = w.AssetMethods.parseRoute.call({ authenticated: true });
  assert.equal(route.name, 'help');
  assert.equal(w.AssetMethods.hashFor(route), '#/ayuda');
  w.location.hash = '#/inventario';
  assert.equal(w.AssetMethods.parseRoute.call({ authenticated: true }).name, 'inventory');
  assert.equal(w.AssetMethods.hashFor({ name: 'inventory' }), '#/inventario');
});
// Catches accent-sensitive search hiding the warranty guide for normal typing.
test('help search finds Spanish topics regardless of accents and case', () => {
  const w = load('#/ayuda');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/help.js'), 'utf8'), { window: w });
  const Help = w.AssetHelp;
  assert.deepEqual(Array.from(Help.search(' GARANTIAS '), t => t.id), ['warranties']);
  assert.equal(Help.search('sin coincidencia alguna').length, 0);
  assert.equal(Help.search('').length, 9);
  assert.equal(Help.search('permisos').some(t => t.id === 'extensions'), true);
});
