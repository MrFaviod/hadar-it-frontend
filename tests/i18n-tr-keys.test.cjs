'use strict';
// D3 guard: `tests/i18n-catalogs.test.cjs` only proves the keys used through
// `$t(...)` and `ItsmI18n.t(...)`. Most non-template copy resolves through a
// module-local helper (`tr`, `T`, `t`, `translate`, `label`) that wraps the same
// runtime, so a literal key there could reach the user as "text unavailable"
// without any test noticing. This suite reads those calls too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { helperKeys, scanRepository } = require('./i18n-helper-keys.cjs');

const ROOT = path.join(__dirname, '..');
const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/i18n/es.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/i18n/en.json'), 'utf8'));

test('the scan detects a helper key that the catalogs do not declare', () => {
  // A fixture, not a real key: the guard must fail on an injected miss instead of
  // silently passing because nothing was parsed.
  const fixture = [
    "function tr(key, params) { return window.ItsmI18n.t(key, params); }",
    "tr('ui.fixture.injected_missing_key');",
    "T('ui.fixture.injected_missing_key', { count: 1 });",
    "t('ui.relations.toast.created_generic');",
    "this.$t('ui.not.a.helper');",
    "window.ItsmI18n.t('ui.not.a.helper');",
    "translate('ui.fixture.injected_missing_key');"
  ].join('\n');
  const keys = helperKeys(fixture).map((entry) => entry.key);
  assert.ok(keys.includes('ui.fixture.injected_missing_key'), 'the injected key was not detected');
  assert.ok(keys.includes('ui.relations.toast.created_generic'), 'a declared helper key was not detected');
  assert.deepEqual(keys.filter((key) => key === 'ui.not.a.helper'), [], '$t and ItsmI18n.t are already covered by the catalog test');
  assert.ok(!('ui.fixture.injected_missing_key' in es), 'the fixture key must not exist in assets/i18n/es.json');
});

test('every literal module-local helper key exists in both catalogs', () => {
  const missing = [];
  for (const [key, files] of scanRepository()) {
    if (key in es && key in en) continue;
    const declared = key in es ? 'en.json' : (key in en ? 'es.json' : 'es.json and en.json');
    missing.push(key + ' (missing from ' + declared + '; used in ' + Array.from(files).join(', ') + ')');
  }
  assert.deepEqual(missing, [], 'these helper-rendered keys are not declared by the catalogs');
});
