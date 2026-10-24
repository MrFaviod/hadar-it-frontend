'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const values = new Map([['asset-manager.theme', 'dark']]);
  const listeners = new Map();
  const context = vm.createContext({
    document: { documentElement: { dataset: {} }, querySelector: () => null },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    dispatchEvent() {}, CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } }
  });
  context.window = context;
  vm.runInContext(fs.readFileSync('assets/js/theme.js', 'utf8'), context);
  return { theme: context.AssetTheme, values, listeners };
}

test('account preferences cannot overwrite or inherit another account or guest mode', () => {
  const { theme, values } = setup();
  assert.equal(theme.getPreference(), 'dark');
  theme.setScope('one');
  assert.equal(theme.getPreference(), 'system');
  theme.set('light');
  theme.setScope('two');
  assert.equal(theme.getPreference(), 'system');
  theme.set('dark');
  theme.setScope('one');
  assert.equal(theme.getPreference(), 'light');
  theme.setScope(null);
  assert.equal(theme.getPreference(), 'dark');
  assert.equal(values.get('asset-manager.theme'), 'dark');
});

test('cross-tab theme events only affect the current account scope', () => {
  const { theme, listeners } = setup();
  theme.setScope('one');
  theme.set('light');
  const storage = listeners.get('storage');
  storage({ key: 'asset-manager.theme.user.two', newValue: 'dark' });
  assert.equal(theme.getPreference(), 'light');
  storage({ key: 'asset-manager.theme.user.one', newValue: 'dark' });
  assert.equal(theme.getPreference(), 'dark');
});
