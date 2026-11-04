'use strict';
// Individual inventory visual pass (U3). The browser run in
// tests/ui-inventory-visual.browser.py captures the screens and this file pins
// the markup and stylesheet decisions those screens depend on: one column
// vocabulary shared by the picker and the table headers, no column control that
// changes nothing, a result count that stays silent when the read failed, one
// clear action in the filtered empty state, a shell counter that reports the
// inventory size instead of the filtered subset, loading that keeps the shape of
// the list, stacked cards that hide the first-cell label by position instead of
// by a Spanish string, an 11px floor on the dense labels, and lifecycle copy
// that names the asset rather than one asset kind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const HTML = read('index.html');
const VIEWS = read('assets/css/views.css');
const MOBILE = read('assets/css/mobile-responsive.css');
const API = read('assets/js/inventory-api.js');
const ES = JSON.parse(read('assets/i18n/es.json'));
const EN = JSON.parse(read('assets/i18n/en.json'));
const CONTEXT = JSON.parse(read('assets/i18n/context.json'));

function cssBlock(css, selector, from) {
  const start = css.indexOf(selector, from || 0);
  assert.ok(start > -1, 'missing selector ' + selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

function fontSize(block) {
  const match = /font-size:\s*([\d.]+)px/.exec(block);
  return match ? Number(match[1]) : null;
}

test('the column picker names the columns the table paints', () => {
  const details = /<details[^>]*class="inventory-columns"[>]([\s\S]*?)<\/details>/.exec(HTML);
  assert.ok(details, 'the inventory column picker is missing');
  const picker = details[1];
  assert.ok(!/remote/.test(picker), 'the picker still offers a column no row renders');
  assert.ok(!/ui\.shell\.filter_column_/.test(picker), 'the picker uses shell column copy');
  for (const column of ['model', 'location', 'assignee', 'ip']) {
    assert.ok(picker.includes("ui.inventory.column_" + column), 'missing column ' + column);
  }
  // Header labels and picker labels must come from the same catalogue keys.
  for (const column of ['model', 'location', 'assignee', 'ip']) {
    assert.ok(HTML.includes('<th v-if="workspaceInventory.columns.includes(\'' + column + '\')'),
      'header binding missing for ' + column);
  }
  assert.equal(EN['ui.inventory.column_assignee'], 'Responsible');
  assert.equal(EN['ui.shell.filter_column_assignee'], 'Owner',
    'the shell vocabulary is shared by other routes and stays untouched');
});

test('a failed read reports no result count and no duplicate clear action', () => {
  const bar = /<div v-if="!inventory\.error" class="results-bar"[\s\S]*?<\/div>/.exec(HTML);
  assert.ok(bar, 'the results bar is not gated on a failed read');
  assert.ok(/v-if="inventoryFiltersActive && inventoryItems\.length"/.test(bar[0]),
    'the results bar still offers a second clear action next to the empty state');
  const empty = /<div v-else-if="!inventoryItems\.length" class="empty-state">[\s\S]*?<\/div>/.exec(HTML);
  assert.ok(empty, 'the empty state is missing');
  assert.ok(empty[0].includes('clearInventoryFilters'), 'the empty state lost its clear action');
});

test('the shell counter reports the inventory size, not the filtered subset', () => {
  const link = /<a[^>]*class="nav-link"[^>]*href="#\/inventario"[\s\S]*?<\/a>/.exec(HTML);
  assert.ok(link, 'the inventory navigation link is missing');
  assert.ok(/v-if="!serverInventory \|\| !inventoryFiltersActive"/.test(link[0]),
    'the navigation counter still follows the server filter');
});

test('loading keeps the shape of the list it replaces', () => {
  const loading = /<div v-if="inventory\.loading"[\s\S]*?<\/div>/.exec(HTML);
  assert.ok(loading, 'the loading surface is missing');
  assert.ok(loading[0].includes('skeleton-table'), 'loading paints no skeleton');
  assert.ok(loading[0].includes('aria-busy="true"'), 'loading lost its busy state');
  assert.ok(loading[0].includes("ui.inventory.loading"), 'loading lost its status sentence');
  assert.ok(VIEWS.includes('.skeleton-row'), 'the skeleton has no style');
  const skeleton = cssBlock(VIEWS, '.skeleton-block {');
  assert.ok(!/animation/.test(skeleton), 'the skeleton animates; keep it still');
});

test('stacked cards hide the first-cell label by position, not by a Spanish string', () => {
  assert.ok(!/data-label="Activo"/.test(VIEWS), 'a locale-specific label selector survives');
  assert.ok(/td:first-child::before\s*\{\s*display:\s*none/.test(VIEWS),
    'the stacked first-cell label is not hidden by position');
  const mobile = cssBlock(MOBILE, '.asset-table .asset-code {');
  assert.match(mobile, /white-space:\s*normal/, 'the stacked code line still clips');
  assert.match(cssBlock(MOBILE, '.asset-table .asset-code__id::before {'), /content:\s*none/,
    'the separator survives the stacked layout');
});

test('the dense inventory labels stay above the 11px floor', () => {
  const floors = [
    ['.asset-table th {', VIEWS],
    ['.asset-table .type-tag {', VIEWS],
    ['.asset-code {', VIEWS],
    ['.cell-note {', VIEWS],
    ['.quick-action {', VIEWS],
    ['.asset-card__status {', VIEWS],
    ['.asset-card__category {', VIEWS],
    ['.asset-card__title span {', VIEWS],
    ['.asset-table td::before {', VIEWS],
  ];
  for (const [selector, source] of floors) {
    const size = fontSize(cssBlock(source, selector));
    assert.ok(size !== null, 'no explicit size for ' + selector);
    assert.ok(size >= 11, selector + ' is ' + size + 'px');
  }
});

test('the code line breaks deliberately and the owner cell is not clipped', () => {
  assert.match(cssBlock(VIEWS, '.asset-table .asset-code__id {'), /display:\s*block/,
    'the identifier still shares the code line');
  assert.match(cssBlock(VIEWS, '.asset-table .asset-code__id::before {'), /content:\s*none/,
    'the separator still leads the identifier line');
  assert.match(cssBlock(VIEWS, '.asset-table .asset-code__id {'), /white-space:\s*normal/,
    'the identifier still clips silently');
  assert.match(cssBlock(VIEWS, '.asset-table tbody td .cell-strong {'), /white-space:\s*normal/,
    'a long owner name is still clipped mid-word');
  assert.ok(HTML.includes(':title="asset.id"'), 'the full identifier has no readable fallback');
});

test('the lifecycle dialog names the asset instead of one asset kind', () => {
  assert.equal(ES['ui.asset.lifecycle.eyebrow'], 'Ciclo de vida del activo');
  assert.equal(EN['ui.asset.lifecycle.eyebrow'], 'Asset lifecycle');
  assert.equal(CONTEXT['ui.asset.lifecycle.eyebrow'], 'Eyebrow of the asset lifecycle dialog.');
});

test('the detail breadcrumb names the record', () => {
  const crumbs = /<nav class="breadcrumbs" :aria-label="\$t\('ui\.asset\.detail\.breadcrumb_aria'\)"[\s\S]*?<\/nav>/.exec(HTML);
  assert.ok(crumbs, 'the detail breadcrumb is missing');
  assert.ok(crumbs[0].includes('currentAsset.name'), 'the breadcrumb still prints the raw id');
});

test('a card title wraps to two lines instead of being cut mid-name', () => {
  const block = cssBlock(VIEWS, '.asset-card__title h2 {');
  assert.match(block, /-webkit-line-clamp:\s*2/, 'the card title is still one clipped line');
  assert.match(block, /white-space:\s*normal/, 'the card title still refuses to wrap');
  assert.doesNotMatch(block, /white-space:\s*nowrap/, 'the card title still clips at the card edge');
});

test('the detail surfaces describe the record, not the server', () => {
  assert.equal(ES['ui.asset.detail.history_title'], 'Historial del activo');
  assert.equal(EN['ui.asset.detail.history_title'], 'Asset history');
  assert.equal(CONTEXT['ui.asset.detail.history_title'], 'Title of the asset history panel.');
  for (const id of ['archive-asset', 'retire-asset']) {
    const tag = new RegExp('<button [^>]*data-od-id="' + id + '"');
    const found = tag.exec(HTML);
    assert.ok(found, id + ' is missing');
    assert.match(found[0], /btn--secondary/, id + ' uses a borderless affordance next to bordered siblings');
  }
});

test('the lifecycle dialog prints a separator only when a quick code exists', () => {
  const ident = /<div v-if="inventoryLifecycle\.asset" class="delete-identity">([\s\S]*?)<\/div>/.exec(HTML);
  assert.ok(ident, 'the lifecycle identity block is missing');
  assert.match(ident[1], /<template v-if="inventoryLifecycle\.asset\.quickCode">/, 'the separator is still unconditional');
  assert.doesNotMatch(ident[1], /quickCode \|\| ''/, 'the separator can still dangle after the id');
});

test('narrow screens stack the editor identity strip and wrap the selected id', () => {
  const ident = /\/\* The asset editor identity strip[\s\S]*$/.exec(MOBILE);
  assert.ok(ident, 'the narrow editor override is missing');
  assert.match(MOBILE, /\.delete-identity \.mono \{[\s\S]*?overflow-wrap:\s*anywhere/,
    'the selected id can still be clipped');
  assert.match(ident[0], /\.editor-ident \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
    'the editor identity strip keeps multiple columns on a phone');
});

test('the category request carries the stored id, not the catalog label', () => {
  const query = /inventoryQueryString\(\)[\s\S]*?return url\.search;/.exec(API);
  assert.ok(query, 'the canonical inventory query string is missing');
  assert.match(query[0], /this\.inventoryCategoryId\(filters\.category\)/,
    'the category parameter is still built from the display label');
  assert.doesNotMatch(query[0], /set\('category', this\.inventoryCategoryText/,
    'the label can still reach the raw column comparison');
});

// Behavioural guard for the inventory filter chips: these call the public
// workspace component methods (the same ones the chip buttons invoke) in a VM
// sandbox, so a broken chip label or a surviving hidden filter fails here.
function workspaceApp(overrides) {
  const stub = () => ({$options: {workspaceFields: []}});
  const sandbox = {console, JSON, URL, Promise, setTimeout, clearTimeout, Object, Array, String, Math};
  sandbox.window = sandbox;
  sandbox.ItsmI18n = {t: (key) => key};
  sandbox.AssetMapViews = {MapExplorer: stub()};
  sandbox.AssetGraphView = stub();
  sandbox.AssetPanel = {PanelOverview: stub()};
  sandbox.AssetReportViews = {ReportsCenter: stub()};
  sandbox.AssetMaintViews = {MaintenanceCenter: stub()};
  sandbox.AssetPhase10Api = {
    patchState: () => Promise.resolve({ok: true}),
    saveView: () => Promise.resolve({ok: true}),
    deleteView: () => Promise.resolve({ok: true}),
  };
  vm.createContext(sandbox);
  for (const file of ['workspace-engine.js', 'workspace-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), sandbox, {filename: file});
  }
  const {computed, methods} = sandbox.AssetWorkspaceRuntime;
  const app = Object.assign({
    route: {name: 'inventory'},
    $refs: {},
    explorerFilters: {categories: [], sites: [], states: [], locations: [], search: ''},
    explorerSelection: '',
    workspaceState: sandbox.AssetWorkspace.createState(),
    workspaceUserId: 'user-1',
    workspaceInventory: {status: 'all', location: 'all', columns: ['model']},
    inventoryFilters: {query: '', category: 'all', status: 'all', limit: 25, offset: 0},
    inventoryItems: [],
    inventoryStatusChoices: [
      {value: 'in_use', label: 'Asignado'},
      {value: 'in_storage', label: 'En resguardo'},
      {value: 'maintenance', label: 'Mantenimiento'},
    ],
    sites: [{id: 'site-1', label: 'Campus', locations: [{id: 'oficina-sur', label: 'Oficina Sur'}]}],
    assets: [],
    bulk: {ids: []},
    prefs: {category: 'all', site: 'all', search: '', view: 'table', sort: 'name'},
    organization: {locations: {items: []}},
    assetAdmin: {statuses: []},
    serverInventory: true,
    authenticated: true,
    patchWorkspaceState: () => Promise.resolve({ok: true}),
    navigateWorkspace() {},
    showToast() {},
    setHash() {},
    hashFor: () => '#/inventario',
  }, overrides || {});
  sandbox.AssetWorkspace.user(app.workspaceState, app.workspaceUserId);
  for (const key of Object.keys(computed)) {
    Object.defineProperty(app, key, {get: computed[key].bind(app), configurable: true});
  }
  Object.assign(app, methods);
  // Owned by inventory-api.js in the browser; the chip labels only need identity here.
  app.inventoryCategoryText = app.inventoryCategoryText || ((value) => String(value));
  return app;
}

const statusChips = (app) => app.workspaceInventoryChips.filter((chip) => chip.kind === 'status');

test('a legacy saved snapshot restores one status chip and removing it clears the filter', () => {
  const app = workspaceApp();
  app.restoreWorkspaceView({id: 'view-1', name: 'Legacy', route: 'inventory', snapshot: {
    prefs: {category: 'all', site: 'all', search: '', view: 'table', sort: 'name'},
    inventory: {status: 'in_use', location: 'all', columns: ['model']},
    selection: [],
  }});
  assert.equal(app.inventoryFilters.status, 'in_use', 'the restored snapshot did not reach the canonical filter');
  assert.equal(statusChips(app).length, 1, 'the restored snapshot paints more than one status chip');
  app.removeWorkspaceFilter(statusChips(app)[0]);
  assert.equal(app.inventoryFilters.status, 'all', 'the chip removal left the canonical status filter');
  assert.equal(app.workspaceInventory.status, 'all', 'the chip removal left the legacy status filter');
  assert.equal(statusChips(app).length, 0, 'a status chip survived its own removal');
});

test('a legacy and a canonical status that disagree paint one chip and clear together', () => {
  const app = workspaceApp();
  app.workspaceInventory.status = 'in_use';
  app.inventoryFilters.status = 'in_storage';
  const chips = statusChips(app);
  assert.equal(chips.length, 1, 'one effective status filter paints two chips');
  assert.equal(chips[0].id, 'in_storage', 'the chip label hides which status is actually applied');
  app.removeWorkspaceFilter(chips[0]);
  assert.equal(app.inventoryFilters.status, 'all');
  assert.equal(app.workspaceInventory.status, 'all', 'the legacy status survived as a hidden filter');
  assert.equal(statusChips(app).length, 0);
});

test('a canonical-only status paints one chip and clears completely', () => {
  const app = workspaceApp();
  app.inventoryFilters.status = 'maintenance';
  assert.equal(statusChips(app).length, 1);
  assert.equal(statusChips(app)[0].label, 'Mantenimiento');
  app.removeWorkspaceFilter(statusChips(app)[0]);
  assert.equal(app.inventoryFilters.status, 'all');
  assert.equal(app.workspaceInventory.status, 'all');
  assert.equal(statusChips(app).length, 0);
});

test('removing the location chip clears the export scope, not only the display', () => {
  const app = workspaceApp();
  app.workspaceInventory.location = 'oficina-sur';
  const chip = app.workspaceInventoryChips.find((item) => item.kind === 'location');
  assert.ok(chip, 'the location scope paints no chip');
  assert.equal(chip.label, 'Oficina Sur');
  app.removeWorkspaceFilter(chip);
  assert.equal(app.workspaceInventory.location, 'all', 'the export location scope survived the chip removal');
  assert.equal(app.workspaceInventoryChips.filter((item) => item.kind === 'location').length, 0);
});

test('resetting every filter leaves no chip and no hidden scope', () => {
  const app = workspaceApp();
  app.workspaceInventory.status = 'in_use';
  app.workspaceInventory.location = 'oficina-sur';
  app.inventoryFilters.status = 'in_use';
  app.inventoryFilters.category = 'camaras';
  app.inventoryFilters.query = 'router';
  app.prefs.search = 'router';
  assert.ok(app.workspaceInventoryChips.length >= 3, 'the reset scenario painted no chips');
  app.resetWorkspaceFilters();
  assert.equal(app.workspaceInventoryChips.length, 0, 'chips survived the reset');
  assert.equal(app.workspaceInventory.status, 'all');
  assert.equal(app.workspaceInventory.location, 'all');
  assert.equal(app.inventoryFilters.status, 'all');
  assert.equal(app.inventoryFilters.category, 'all');
  assert.equal(app.inventoryFilters.query, '');
});
