'use strict';
// Built-in catalogs load per language: the active one at boot (plus the Spanish
// source that English falls back to), and any other one only when it is chosen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readCatalog = (tag) => JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'i18n', tag + '.json'), 'utf8'));
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

function boot(storedLocale) {
  const requested = [];
  const store = new Map(storedLocale ? [['itsm.locale', storedLocale]] : []);
  const window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    },
    fetch: async (url) => {
      const target = String(url);
      const match = target.match(/^assets\/i18n\/([a-z]{2})\.json$/);
      if (match) {
        requested.push(match[1]);
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => readCatalog(match[1]) };
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    }
  };
  window.window = window;
  const document = { title: '', createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), documentElement: { setAttribute() {}, getAttribute() { return null; } } };
  const sandbox = { window, document, console, Date, JSON, Intl, Object, Array, Map, Set, Number, String, Boolean, Error, Promise, Symbol, Math, Reflect, Proxy, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  for (const file of ['vue.global.prod.js', 'vue-i18n.global.prod.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'vendor', file), 'utf8'), sandbox);
  }
  window.Vue = sandbox.Vue;
  window.VueI18n = sandbox.VueI18n;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8'), sandbox);
  return { api: window.ItsmI18n, requested };
}

const KEY = 'ui.i18n.text_unavailable';

test('a Spanish visitor downloads only the Spanish catalog at boot', async () => {
  const { api, requested } = boot(null);
  await api.ready;
  assert.deepEqual(requested.sort(), ['es']);
  assert.equal(api.i18n.global.t(KEY), readCatalog('es')[KEY]);
});

test('an English visitor downloads English and the Spanish source it falls back to', async () => {
  const { api, requested } = boot('en');
  await api.ready;
  assert.deepEqual(requested.sort(), ['en', 'es']);
  assert.equal(api.i18n.global.t(KEY), readCatalog('en')[KEY]);
});

test('switching to English later downloads its catalog once and shows it', async () => {
  const { api, requested } = boot(null);
  await api.ready;
  assert.equal(requested.includes('en'), false);
  api.setLocale('en', { persist: true });
  await flush();
  assert.equal(requested.filter((tag) => tag === 'en').length, 1);
  assert.equal(api.i18n.global.t(KEY), readCatalog('en')[KEY]);
  api.setLocale('es', { persist: true });
  await flush();
  assert.equal(requested.filter((tag) => tag === 'en').length, 1, 'switching back reuses the loaded catalog');
  assert.equal(api.i18n.global.t(KEY), readCatalog('es')[KEY]);
});
