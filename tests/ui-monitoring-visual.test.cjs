'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/* Regression guards for visible monitoring behaviour. Browser prerequisites
 * and commands live in docs/development.md. */

const VIEWS = 'assets/js/monitoring-views.js';
const SETTINGS = 'assets/js/monitoring-settings.js';
const CSS = 'assets/css/monitoring.css';
const SOURCE = fs.readFileSync(VIEWS, 'utf8');
const SETTINGS_SOURCE = fs.readFileSync(SETTINGS, 'utf8');
const STYLES = fs.readFileSync(CSS, 'utf8');
const ES = JSON.parse(fs.readFileSync('assets/i18n/es.json', 'utf8'));
const EN = JSON.parse(fs.readFileSync('assets/i18n/en.json', 'utf8'));
const CONTEXT = JSON.parse(fs.readFileSync('assets/i18n/context.json', 'utf8'));

function placeholders(value) {
  return Array.from(String(value).matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

const REQUIRED_KEYS = [
  'ui.monitoring.reason.prometheus_not_configured',
  'ui.monitoring.alert.by',
  'ui.monitoring.center.provenance_error',
  'ui.monitoring.config.thresholds',
  'ui.monitoring.devices.empty_install',
  'ui.notifications.empty_install'
];

test('every catalog key added by the monitoring pass exists in both locales with the same placeholders', () => {
  for (const key of REQUIRED_KEYS) {
    assert.ok(ES[key], 'missing Spanish copy for ' + key);
    assert.ok(EN[key], 'missing English copy for ' + key);
    assert.deepEqual(placeholders(ES[key]), placeholders(EN[key]), 'placeholder mismatch for ' + key);
    assert.ok(CONTEXT[key], 'missing context note for ' + key);
  }
});

test('no monitoring copy claims a filter narrowed an installation that has nothing to filter', () => {
  assert.match(SOURCE, /devicesEmptyKey/, 'the devices list must choose its empty copy from the filters in force');
  assert.match(SOURCE, /inboxEmptyKey/, 'the inbox must choose its empty copy from the active filter');
  assert.match(SOURCE, /\$t\(devicesEmptyKey\)/);
  assert.match(SOURCE, /value !== 'all'/, "'all' must count as no filter when the empty copy is chosen");
  assert.match(SOURCE, /\$t\(inboxEmptyKey\)/);
  assert.ok(ES['ui.monitoring.devices.empty_install'] !== ES['ui.monitoring.devices.empty']);
  assert.ok(ES['ui.notifications.empty_install'] !== ES['ui.notifications.empty']);
});

test('a device reason or an override key never reaches the page as a raw server code', () => {
  for (const code of ['target_missing', 'prometheus_unavailable', 'prometheus_not_configured']) {
    assert.match(SOURCE, new RegExp('^\\s*' + code + ': ', 'm'), 'reason ' + code + ' has no catalog sentence');
  }
  assert.match(SOURCE, /function reasonCopy\([\s\S]*?return key \? tr\(key\) : '';/, 'an unknown reason must be withheld, not painted');
  assert.match(SOURCE, /const OVERRIDE_LABELS = \{[\s\S]*?thresholds:/, 'the override labels must come from the catalog');
  assert.doesNotMatch(SOURCE, /overridden\.join\(/, 'the override list must not print raw API field names');
});

test('timeline entries are rendered from the catalog and the alert states, not from raw transition ids', () => {
  assert.match(SOURCE, /EVENT_LABEL_KEYS/);
  assert.match(SOURCE, /eventText\(event\)/);
  assert.doesNotMatch(SOURCE, /\(event\.fromState \|\| '—'\)/, 'raw state ids must not be concatenated');
  assert.match(SOURCE, /\$t\('ui\.monitoring\.error\.record_missing'\)/, 'the missing notice resolves its copy when it renders');
  assert.match(SOURCE, /this\.alertStateMeta\(event\.fromState\)/, 'component methods are reached through this, never as free identifiers');
  assert.match(SOURCE, /this\.alertStateMeta\(this\.alert\.state\)/);
  assert.doesNotMatch(SOURCE, /: alertStateMeta\(/, 'a bare helper call would throw while rendering');
});

test('a failed device or alert read offers a retry instead of a dead notice', () => {
  const occurrences = SOURCE.match(/@click="refresh">\{\{ \$t\('ui\.common\.retry'\) \}\}/g) || [];
  assert.ok(occurrences.length >= 4, 'device, alert, devices and alerts tab failures must offer a retry');
  assert.ok(ES['ui.common.retry'] && EN['ui.common.retry']);
});

const VIEWS_SOURCE_ALIAS = SOURCE;

test('category labels come from the canonical inventory catalog, matched by id', () => {
  assert.match(SETTINGS_SOURCE, /app\.inventoryConfigCategories\(\)/, 'the server owns the category labels');
  assert.match(VIEWS_SOURCE_ALIAS, /app\.inventoryConfigCategories\(\)/, 'the monitoring views read the same catalog');
  assert.doesNotMatch(SETTINGS_SOURCE, /this\.app\.categories/, 'a stale local category must not win over the catalog');
  assert.doesNotMatch(VIEWS_SOURCE_ALIAS, /this\.app\.categories/, 'the views must not fall back to prototype categories');
  assert.match(SETTINGS_SOURCE, /function categoryLabel\(/, 'an id the catalog does not translate still has a bounded fallback');
  assert.match(SETTINGS_SOURCE, /this\.profiles \|\| \[\]\)\.forEach/, 'profiles supply categories the catalog does not list');
  assert.match(SETTINGS_SOURCE, /mon-window-form__assets/, 'the asset group spans the window form');
});

test('the settings forms keep their own layout instead of scattering fields and checkboxes', () => {
  assert.match(STYLES, /\.mon-exception-form \{\n  grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(STYLES, /input:not\(\.mon-input\):not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/, 'checkbox toggles must not inherit the field width');
  assert.match(STYLES, /\.mon-window-form > \.mon-window-form__assets/, 'the asset group must span the form');
});

test('the notification panel scrolls its list, the empty cards do not nest and the asset panel does not collapse', () => {
  assert.match(STYLES, /\.notif__list \{\n  min-height: 0;/);
  assert.match(STYLES, /\.mon-panel \.empty-state,/);
  assert.match(STYLES, /\.mon-panel\.mon-device-mini \{/);
});

test('the settings controls share one styled shape instead of browsing defaults', () => {
  assert.match(STYLES, /\.mon-settings \.field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.mon-input\)/, 'bare monitoring inputs must be styled');
  assert.match(STYLES, /\.mon-settings \.field select:focus-visible/, 'the styled controls must keep a focus ring');
});

test('the profile list localizes its category, check type and metric ids', () => {
  assert.match(SETTINGS_SOURCE, /checkLabel\(id\)/, 'check types need a catalog label');
  assert.match(SETTINGS_SOURCE, /metrics: \(profile\.metrics \|\| \[\]\)\.map\(id => metricLabel\(id\)\)/, 'metric ids must be painted through their catalog label');
});

test('the device page hides a broken category thumbnail and shows a full metric picker', () => {
  assert.match(SOURCE, /@error="thumbMissing = true"/, 'a 404 category image must not leave an empty box');
  assert.match(SOURCE, /class="field mon-series-select"/, 'the metric picker is not a compact threshold box');
  assert.match(STYLES, /\.mon-series-select \{/, 'the picker needs a width that fits its option label');
});

test('panel-level actions and the window form keep their intended geometry', () => {
  assert.match(STYLES, /\.mon-panel > \.btn \{[^}]*justify-self: start;/, 'a bare panel action must not stretch');
  assert.match(STYLES, /\.mon-window-form > \.mon-window-form__days/, 'the day group spans the form instead of wrapping a lone day');
  assert.match(STYLES, /\.mon-thresholds \.mon-settings-table__name \{[^}]*overflow-wrap: anywhere;/, 'a long metric name must wrap instead of sliding under the input');
});

test('the browser script still captures both installations and every scenario family', () => {
  const script = fs.readFileSync('tests/ui-monitoring-visual.browser.py', 'utf8');
  for (const name of ['run_center', 'run_devices', 'run_real_unconfigured', 'run_alert_page', 'run_inbox', 'run_bell', 'run_dialogs', 'run_settings', 'run_marked', 'run_ordinary']) {
    assert.match(script, new RegExp('def ' + name + '\\('), 'missing scenario ' + name);
  }
  const docs = fs.readFileSync('docs/development.md', 'utf8');
  assert.match(docs, /python3 tests\/ui-monitoring-visual\.browser\.py/, 'the docs must name the run command');
  assert.match(docs, /node --test tests\/ui-monitoring-visual\.test\.cjs/);
});

test('the counters state their population and the list states what it hides', () => {
  assert.match(SOURCE, /counts_loaded', \{ loaded, visible, total \}/, 'counters describe the loaded page, not the filtered list');
  assert.match(SOURCE, /counts_visible/, 'a local filter narrows the list and says so');
  const expected = {
    'ui.monitoring.center.counts_loaded': ['loaded', 'total', 'visible'],
    'ui.monitoring.center.counts_visible': ['loaded', 'visible'],
  };
  for (const [key, names] of Object.entries(expected)) {
    for (const [tag, catalog] of [['es', ES], ['en', EN]]) {
      assert.ok(catalog[key], key + ' missing in ' + tag);
      const found = [...new Set([...catalog[key].matchAll(/\{(\w+)\}/g)].map((item) => item[1]))].sort();
      assert.deepEqual(found, names, key + ' placeholders in ' + tag);
      assert.ok((CONTEXT[key] || '').length > 0, 'a context note is required for ' + key);
    }
  }
  assert.doesNotMatch(ES['ui.monitoring.center.counts_loaded'], /ver todo/, 'the copy must not promise that local filters show everything');
  assert.doesNotMatch(EN['ui.monitoring.center.counts_loaded'], /see everything/);
});

test('one failed monitoring read paints one notice, with the retry inside it', () => {
  const notices = SOURCE.match(/ui\.monitoring\.center\.error_title/g) || [];
  assert.equal(notices.length, 1, 'the page-level notice is the single report of a failed read');
  assert.match(SOURCE, /role="region" tabindex="0"/, 'the scrollable device table is reachable from the keyboard');
});

test('monitoring dialogs reuse the settings control shape', () => {
  assert.match(SOURCE, /class="form-stack mon-dialog"/);
  assert.match(STYLES, /\.mon-dialog \.field input:not\(\[type="checkbox"\]\)/);
});

test('the device page withholds a thumbnail that cannot be read', () => {
  assert.match(SOURCE, /other\\\.svg\$\/\.test\(this\.asset\.image\)/);
  assert.match(SOURCE, /v-if="thumb\(\)"/);
});

test('server category ids print as readable labels, never as slugs in the head', () => {
  assert.match(SOURCE, /function fallbackLabel\(id\)/);
  assert.match(SOURCE, /fallbackLabel\(key\) \|\| '—'/);
  assert.match(SOURCE, /\{\{ categoryName\(asset\.category\) \|\| \$t\('ui\.monitoring\.device\.no_category'\) \}\}/,
    'the device head resolves its category id through the catalog');
});

test('a long inbox id or name wraps inside its card instead of past the edge', () => {
  // The body was an implicit grid track sized by its widest child, so on a phone
  // the title, the tags and the canonical asset id painted 31 px past the card.
  assert.match(STYLES, /\.mon-inbox__body \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
    'the inbox body pins its track to the card box');
  assert.match(STYLES, /\.mon-inbox__title \{[^}]*overflow-wrap: anywhere/,
    'a long alert name wraps');
  assert.match(STYLES, /\.mon-inbox__text \{[^}]*overflow-wrap: anywhere/,
    'a long body line wraps');
  assert.match(STYLES, /\.mon-inbox__meta > span \{\s*white-space: nowrap;/,
    'the date and the relative time stay unbroken');
  assert.match(STYLES, /\.mon-inbox__meta > span\.mono:last-child:not\(:only-child\) \{[^}]*white-space: normal/,
    'the canonical asset id is the token that gives way');
  const script = fs.readFileSync('tests/ui-monitoring-visual.browser.py', 'utf8');
  assert.match(script, /def assert_inbox_paint_fits\(page\)/);
  assert.match(script, /range\.selectNodeContents\(node\)/,
    'the check measures painted text ranges, not only element boxes');
  assert.match(script, /assert_inbox_paint_fits\(page\)/, 'the check runs on the captured inbox cells');
});
