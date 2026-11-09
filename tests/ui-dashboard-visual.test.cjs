'use strict';
// Individual dashboard visual pass (U2). The browser run in
// tests/ui-dashboard-visual.browser.py captures the screens and this file pins
// the copy and state mappings those screens depend on: a localized period
// label instead of the raw `24h` id, an expired warranty that reads as expired,
// alert severities that keep the tones the stylesheet defines, one sentence per
// alert row even when the asset is outside the filtered rows, the canonical
// category catalogue for the dashboard filter, and Spanish copy that names the
// screen the same way the navigation does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = file => JSON.parse(read('assets/i18n/' + file + '.json'));
const CATALOGS = { es: load('es'), en: load('en') };
const CONTEXT = load('context');

// Mirrors the runtime catalogue: `one | other` plurals and {named} parameters.
function translate(catalog) {
  return (key, params) => {
    const value = catalog[key];
    if (typeof value !== 'string') return key;
    const forms = value.split(' | ');
    // Without `count` the runtime picks the first form, not the plural one; the
    // mirror has to do the same or a missing count hides a truncated label.
    const count = params && params.count;
    const form = forms.length > 1
      ? (count === undefined ? forms[0] : (Number(count) === 1 ? forms[0] : forms[forms.length - 1]))
      : value;
    return form.replace(/\{(\w+)\}/g, (all, name) => (
      params && params[name] !== undefined ? String(params[name]) : all));
  };
}

function context(locale = 'es') {
  const catalog = CATALOGS[locale];
  const c = vm.createContext({ console, Date, Number, String, Math, JSON, setTimeout, clearTimeout });
  c.window = c;
  c.Views = { MonChart: {}, MonStatusPill: {} };
  c.AppIcon = {};
  c.AssetMonitorEngine = { severityRank: () => 0 };
  c.ItsmI18n = {
    t: translate(catalog),
    number: value => String(value),
    formatDate: () => '',
    formatBytes: value => String(value)
  };
  for (const file of ['dashboard-model', 'dashboard-preferences', 'dashboard-charts', 'dashboard-views', 'panel']) {
    vm.runInContext(read('assets/js/' + file + '.js'), c, { filename: file + '.js' });
  }
  return c;
}

test('every period label the dashboard paints comes from the catalogue, never the raw id', () => {
  for (const locale of ['es', 'en']) {
    const views = context(locale).AssetDashboardViews;
    for (const [period, key] of [['24h', 'ui.panel.period_24h'], ['7d', 'ui.panel.period_7d'], ['30d', 'ui.panel.period_30d']]) {
      const label = views.periodLabel(period);
      assert.equal(label, CATALOGS[locale][key], locale + ' ' + period);
      assert.ok(!label.includes(period), period + ' leaked into ' + label);
    }
    assert.equal(views.periodLabel(''), CATALOGS[locale]['ui.panel.period_current']);
    assert.equal(views.periodLabel('bogus'), CATALOGS[locale]['ui.panel.period_current']);
  }
});

test('the panel header, report bar and widget chips reuse that same period label', () => {
  const c = context('es');
  const panel = c.AssetPanel.PanelOverview;
  const periodLabel = panel.computed.periodLabel.call({ filters: { period: '7d' } });
  assert.equal(periodLabel, '7 días');
  assert.equal(panel.computed.periodLabel.call({ filters: { period: '24h' } }), '24 horas');
});

test('expired warranty coverage reads as expired instead of negative days ahead', () => {
  const expected = {
    es: { '-435': 'Vencida hace 435 días', '-1': 'Vencida hace 1 día', '0': 'Hoy', '5': 'En 5 días' },
    en: { '-435': 'Expired 435 days ago', '-1': 'Expired 1 day ago', '0': 'Today', '5': 'In 5 days' }
  };
  for (const locale of ['es', 'en']) {
    const widget = context(locale).AssetDashboardViews.DashboardWidget.methods;
    for (const days of Object.keys(expected[locale])) {
      assert.equal(widget.warrantyLabel(Number(days)), expected[locale][days], locale + ' ' + days);
    }
  }
  for (const locale of ['es', 'en']) {
    assert.equal(typeof CONTEXT['ui.dashboard.warranty_expired'], 'string');
    assert.ok(CATALOGS[locale]['ui.dashboard.warranty_expired'].includes('{days}'), locale);
  }
});

test('alert severities keep the tones the stylesheet defines for the dots', () => {
  const views = context('es').AssetDashboardViews;
  assert.equal(views.severityTone('critical'), 'critica');
  assert.equal(views.severityTone('warning'), 'alta');
  assert.equal(views.severityTone('critica'), 'critica');
  assert.equal(views.severityTone('alta'), 'alta');
  assert.equal(views.severityTone('info'), 'baja');
  assert.equal(views.severityTone(''), 'baja');
  assert.equal(views.severityTone(undefined), 'baja');
  const css = read('assets/css/dashboard.css');
  assert.match(css, /\.noc-alert-dot--critica\b/);
  assert.match(css, /\.noc-alert-dot--alta\b/);
});

test('an alert whose asset is outside the filtered rows still reads as one sentence', () => {
  const widget = context('es').AssetDashboardViews.DashboardWidget.methods;
  const withoutAsset = widget.alertContext.call({ assetName: () => '' },
    { acknowledgedAt: '2026-11-01T10:00:00Z' });
  assert.equal(withoutAsset, 'Reconocida · problema activo');
  assert.ok(!withoutAsset.startsWith('·'), withoutAsset);
  const pending = widget.alertContext.call({ assetName: () => '' }, { acknowledgedAt: '' });
  assert.equal(pending, 'Pendiente de atención');
  const withAsset = widget.alertContext.call({ assetName: () => 'Equipo Z' }, { acknowledgedAt: '' });
  assert.equal(withAsset, 'Equipo Z · Pendiente de atención');
});

test('the tools form ties a rejected URL to the address field', () => {
  const { AssetDashboardPrefs } = context('es');
  const { DashboardLinks } = AssetDashboardPrefs;
  const messages = {
    protocol: translate(CATALOGS.es)('ui.dashboard.error_link_protocol'),
    url: translate(CATALOGS.es)('ui.dashboard.error_link_url'),
    other: translate(CATALOGS.es)('ui.dashboard.error_link_save')
  };
  const flag = error => DashboardLinks.computed.urlInvalid.call({ error });
  assert.equal(flag(messages.protocol), true);
  assert.equal(flag(messages.url), true);
  assert.equal(flag(messages.other), false);
  assert.equal(flag(''), false);
  const template = DashboardLinks.template;
  assert.ok(template.includes('aria-describedby'), 'the address field does not reference the message');
  assert.ok(template.includes('aria-invalid'), 'the address field is not marked invalid');
  assert.ok(template.includes('id="dashboard-link-error"'), 'the message has no id to reference');
});

test('the dashboard does not ask again for sources another view is already loading', () => {
  const calls = [];
  const app = {
    can: () => true,
    organization: { locations: { loaded: false, loading: true } },
    inventoryCatalog: { loaded: false, loading: true },
    inventoryCatalogReady: false,
    loadOrganizationLocations: () => calls.push('locations'),
    loadInventoryCatalog: () => calls.push('catalog')
  };
  context('es').AssetPanel.PanelOverview.methods.ensureFilterSources.call({ app });
  assert.deepEqual(calls, []);
  const blocked = { can: () => false, loadOrganizationLocations: () => calls.push('locations'), loadInventoryCatalog: () => calls.push('catalog') };
  context('es').AssetPanel.PanelOverview.methods.ensureFilterSources.call({ app: blocked });
  assert.deepEqual(calls, []);
});

test('an installed dashboard never offers prototype categories while the catalogue loads or fails', () => {
  const prototype = [{ id: 'computadoras', label: 'Computadoras' }, { id: 'ups', label: 'UPS' }];
  const installedLoading = {
    can: () => true,
    serverInventory: () => true,
    inventoryCatalog: { loaded: false, loading: true, error: '', categories: [] },
    inventoryCatalogReady: false,
    inventoryCategoryChoices: [],
    categories: prototype
  };
  const installedFailed = {
    can: () => true,
    serverInventory: () => true,
    inventoryCatalog: { loaded: false, loading: false, error: 'boom', categories: [] },
    inventoryCatalogReady: false,
    inventoryCategoryChoices: [],
    categories: prototype
  };
  const installedLoaded = {
    can: () => true,
    serverInventory: () => true,
    inventoryCatalog: { loaded: true, loading: false, error: '', categories: [{ id: 'routers', label: 'Routers' }] },
    inventoryCatalogReady: true,
    inventoryCategoryChoices: [{ id: 'routers', label: 'Routers' }],
    categories: prototype
  };
  const demo = { categories: prototype, inventoryCatalogReady: false, inventoryCategoryChoices: [] };
  for (const app of [installedLoading, installedFailed]) {
    const length = context('es').AssetPanel.PanelOverview.computed.categoryChoices.call({ app }).length;
    assert.equal(length, 0, 'prototype categories leaked into an installed dashboard');
  }
  const loaded = context('es').AssetPanel.PanelOverview.computed.categoryChoices.call({ app: installedLoaded });
  assert.equal(Array.from(loaded).map(item => item.id).join(','), 'routers');
  const demoChoices = context('es').AssetPanel.PanelOverview.computed.categoryChoices.call({ app: demo });
  assert.equal(Array.from(demoChoices).map(item => item.id).join(','), 'computadoras,ups');
});

test('the dashboard filter offers the categories the service groups by, not the prototype list', () => {
  const computed = context('es').AssetPanel.PanelOverview.computed;
  const server = {
    inventoryCatalogReady: true,
    inventoryCategoryChoices: [{ id: 'routers', label: 'routers' }, { id: 'servidores', label: 'servidores' }],
    categories: [{ id: 'computadoras', label: 'Computadoras' }]
  };
  assert.deepEqual(computed.categoryChoices.call({ app: server }).map(item => item.id), ['routers', 'servidores']);
  const prototype = { inventoryCatalogReady: false, inventoryCategoryChoices: [], categories: [{ id: 'computadoras' }] };
  assert.deepEqual(computed.categoryChoices.call({ app: prototype }).map(item => item.id), ['computadoras']);
  // Arrays created inside the vm realm are not reference-equal to host arrays.
  assert.equal(computed.categoryChoices.call({ app: {} }).length, 0);
  assert.deepEqual(Array.from(computed.siteChoices.call({ app: { sites: [{ id: 'norte', label: 'Norte' }] } })), [{ id: 'norte', label: 'Norte' }]);
  assert.equal(computed.siteChoices.call({ app: {} }).length, 0);
});

test('the panel loads the directory and catalogue its own filters need', () => {
  const called = [];
  const app = {
    can: () => true,
    organization: { locations: { loaded: false, loading: false } },
    inventoryCatalogReady: false,
    loadOrganizationLocations: () => called.push('locations'),
    loadInventoryCatalog: () => called.push('catalogue')
  };
  context('es').AssetPanel.PanelOverview.methods.ensureFilterSources.call({ app });
  assert.deepEqual(called, ['locations', 'catalogue']);
  const loaded = {
    can: () => true,
    organization: { locations: { loaded: true, loading: false } },
    inventoryCatalogReady: true,
    loadOrganizationLocations: () => called.push('locations again'),
    loadInventoryCatalog: () => called.push('catalogue again')
  };
  called.length = 0;
  context('es').AssetPanel.PanelOverview.methods.ensureFilterSources.call({ app: loaded });
  assert.deepEqual(called, [], 'loaded sources are not read twice');
  const forbidden = { can: () => false, organization: { locations: {} }, loadOrganizationLocations: () => called.push('x') };
  called.length = 0;
  context('es').AssetPanel.PanelOverview.methods.ensureFilterSources.call({ app: forbidden });
  assert.deepEqual(called, [], 'a reader without assets.view asks for nothing');
});

test('the Spanish dashboard copy names the screen Panel, as the navigation does', () => {
  assert.equal(CATALOGS.es['ui.nav.panel'], 'Panel');
  assert.equal(CATALOGS.es['ui.dashboard.prefs_title'], 'Panel');
  for (const key of ['ui.panel.empty', 'ui.panel.error_title', 'ui.panel.period_aria']) {
    assert.ok(!/Dashboard/.test(CATALOGS.es[key]), key + ': ' + CATALOGS.es[key]);
    assert.match(CATALOGS.es[key], /Panel/, key);
  }
  assert.equal(CATALOGS.en['ui.panel.error_title'], 'The dashboard could not be loaded');
});
