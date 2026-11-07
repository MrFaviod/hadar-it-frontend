'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function context() {
  const c = vm.createContext({ console, Date, JSON, Promise, URL, AbortController, setTimeout, clearTimeout, document: { activeElement: null, body: { style: { overflow: '' } } } });
  c.window = c;
  for (const file of ['phase10-api.js', 'workspace-engine.js', 'dashboard-preferences.js', 'search-engine.js', 'search-views.js']) vm.runInContext(read('assets/js/' + file), c, { filename: file });
  return c;
}
function app() {
  return { authenticated: true, activeUserId: 'ana', currentUser: { id: 'ana' }, assets: [], currentAsset: null, route: { name: 'panel' }, can: () => true,
    settings: { anydeskEnabled: false, rmmEnabled: false }, workspaceState: windowlessWorkspace(), config: {} };
}
function windowlessWorkspace() { return { users: { ana: { favorites: [{ key: 'asset:x1', type: 'Activos', id: 'x1', label: 'Equipo X', subtitle: 'AM-1', icon: 'box', target: { kind: 'asset', id: 'x1' } }], usage: { 'asset:x1': 2 }, lastViews: {} } }, views: [], widgets: null, themeMode: 'auto', shortcuts: [], loaded: true, loading: false, error: '', epoch: 1 }; }
const serverItem = (overrides = {}) => ({ key: 'asset:x1', type: 'asset', id: 'x1', label: 'Equipo X', subtitle: 'AM-1 · 10.0.0.1', icon: 'box', target: { kind: 'asset', id: 'x1' }, ...overrides });

test('async search returns server DTO and an exact ID even when no asset is loaded', async () => {
  const c = context(); const calls = [];
  c.AssetAccess = { request: (_vm, url, options) => { calls.push({ url, options }); return Promise.resolve({ items: [serverItem(), serverItem({ key: 'section:inventory', type: 'section', id: 'inventory', label: 'Inventario', subtitle: 'Sección', icon: 'inventory', target: { kind: 'section', route: { name: 'inventory' } } })], total: 2, limit: 20, offset: 0, engine: 'meilisearch', fallback: false }); } };
  const vmApp = app();
  const result = await c.AssetPhase10Api.search(vmApp, 'x1', { limit: 20, offset: 0 });
  assert.match(calls[0].url, /^\/search\?q=x1/);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].key, 'asset:x1');
  assert.equal(result.records[0].type, 'Activos');
  assert.equal(result.records[1].type, 'Secciones');
  assert.equal(result.engine, 'meilisearch');
  assert.equal(result.fallback, false);
  assert.equal(result.records[0].target.id, 'x1');
  assert.equal(vmApp.assets.length, 0);
});

test('search scope maps to kind and server fallback is exposed', async () => {
  const c = context(); let requested = '';
  c.AssetAccess = { request: (_vm, url) => { requested = url; return Promise.resolve({ items: [], total: 0, limit: 20, offset: 0, engine: 'sql', fallback: true }); } };
  const result = await c.AssetPhase10Api.search(app(), 'ana', { scope: 'views' });
  assert.match(requested, /kind=view/);
  assert.equal(result.engine, 'sql');
  assert.equal(result.fallback, true);
});

test('stale search and identity clear never deliver prior account results', async () => {
  const c = context(); const pending = [];
  c.AssetAccess = { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  const vmApp = app();
  const first = c.AssetPhase10Api.search(vmApp, 'x1');
  const second = c.AssetPhase10Api.search(vmApp, 'y2');
  pending[1].resolve({ items: [serverItem({ key: 'asset:y2', id: 'y2', label: 'Equipo Y' })], total: 1, limit: 20, offset: 0, engine: 'sql', fallback: true });
  assert.equal((await second).records[0].key, 'asset:y2');
  pending[0].resolve({ items: [serverItem()], total: 1, limit: 20, offset: 0, engine: 'sql', fallback: true });
  assert.equal(await first, null, 'stale response is dropped');
  const third = c.AssetPhase10Api.search(vmApp, 'third');
  c.AssetPhase10Api.clear(vmApp);
  pending[2].resolve({ items: [serverItem({ key: 'asset:third', id: 'third' })], total: 1, limit: 20, offset: 0, engine: 'sql', fallback: true });
  assert.equal(await third, null, 'logout clears in-flight search');
});

test('search failures are explicit', async () => {
  const c = context();
  c.AssetAccess = { request: () => Promise.reject(new Error('Búsqueda no disponible')) };
  await assert.rejects(() => c.AssetPhase10Api.search(app(), 'x'), /Búsqueda no disponible/);
});

test('palette groups server results, preserves quick actions and keyboard interaction', async () => {
  const c = context();
  c.AssetAccess = { request: () => Promise.resolve({ items: [serverItem()], total: 1, limit: 20, offset: 0, engine: 'sql', fallback: false }) };
  const methods = c.AssetSearchViews.SearchPalette.methods;
  const emitted = [];
  const palette = {
    query: 'x1', scope: 'all', remote: [], loading: false, error: '', engine: '', fallback: false, total: 0, requestId: 0, timer: null,
    $root: app(), $emit: (...args) => emitted.push(args), $nextTick: fn => fn && fn(), $refs: {},
    results: [serverItem(), serverItem({ key: 'section:inventory', type: 'section', label: 'Inventario', typeLabel: 'Secciones', icon: 'inventory' })]
  };
  await methods.runSearch.call(palette, 'x1');
  assert.equal(palette.remote[0].key, 'asset:x1');
  assert.equal(palette.error, '');
  const grouped = c.AssetSearchViews.SearchPalette.computed.groups.call({ results: [{ ...serverItem(), type: 'Activos' }, { ...serverItem({ key: 'person:p1', type: 'Personas', icon: 'user' }), type: 'Personas' }] });
  assert.deepEqual(grouped.map(g => g.label), ['Activos', 'Personas']);

  methods.onKey.call(palette, { key: 'Escape', preventDefault() {}, isComposing: false });
  assert.equal(emitted.at(-1)[0], 'close');
  palette.results = [serverItem()]; palette.active = 0;
  methods.onKey.call(palette, { key: 'Enter', target: { tagName: 'INPUT' }, preventDefault() {}, isComposing: false });
  assert.equal(emitted.at(-1)[0], 'select');
  assert.equal(emitted.at(-1)[1].key, 'asset:x1');
  palette.results = [serverItem(), serverItem({ key: 'asset:x2', id: 'x2' })];
  palette.active = 1;
  methods.onKey.call(palette, { key: 'ArrowDown', preventDefault() {}, isComposing: false });
  assert.equal(palette.active, 0, 'arrow wraps');
  const actions = c.AssetSearch.actions(app());
  assert.ok(actions.some(r => r.target.action === 'create-asset'), 'quick actions preserved');
});

test('palette exposes loading, empty and error states without stale rows', async () => {
  const c = context(); const methods = c.AssetSearchViews.SearchPalette.methods;
  c.AssetAccess = { request: () => Promise.resolve({ items: [], total: 0, limit: 20, offset: 0, engine: 'sql', fallback: false }) };
  const palette = { query: 'zz', scope: 'all', remote: [serverItem()], loading: false, error: '', engine: '', fallback: false, total: 0, requestId: 0, timer: null, $root: app(), $emit() {}, $nextTick: fn => fn && fn(), $refs: {} };
  await methods.runSearch.call(palette, 'zz');
  assert.deepEqual(palette.remote, []);
  assert.equal(palette.total, 0);
  c.AssetAccess = { request: () => Promise.reject(new Error('Sin conexión')) };
  await methods.runSearch.call(palette, 'zz');
  assert.equal(palette.error, 'Sin conexión');
  assert.deepEqual(palette.remote, []);
  assert.equal(palette.loading, false);
});
