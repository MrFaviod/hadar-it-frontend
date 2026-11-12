'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function context() {
  const c = vm.createContext({ console, Date, JSON, Promise, URL, AbortController, setTimeout, clearTimeout });
  c.window = c;
  for (const file of ['phase10-api.js', 'workspace-engine.js', 'dashboard-preferences.js']) vm.runInContext(read('assets/js/' + file), c, { filename: file });
  return c;
}
const stateDTO = (overrides = {}) => ({
  widgets: ['availability', 'alerts'], favorites: [{ key: 'asset:x1', type: 'Activos', id: 'x1', label: 'Equipo X', subtitle: 'AM-1', icon: 'box', target: { kind: 'asset', id: 'x1' } }],
  usage: { 'asset:x1': 3 }, lastViews: { inventory: { search: 'x' } }, themeMode: 'dark', shortcuts: [], views: [], ...overrides
});
function fakeServer(c) {
  const server = { state: stateDTO({ widgets: null, favorites: [] }), calls: [], puts: [] };
  c.AssetAccess = {
    request(_vm, url, options = {}) {
      server.calls.push({ url, method: options.method || 'GET', body: options.body });
      if (['POST', 'PATCH'].includes(options.method) && /^\/workspace\/(views|shortcuts)(\/|$)/.test(url)) {
        const allowed = url.includes('/views') ? ['name', 'route', 'snapshot', 'scope'] : ['name', 'url', 'icon', 'category', 'scope'];
        if (Object.keys(options.body).some(key => !allowed.includes(key))) return Promise.reject(new Error('unsupported fields'));
      }
      if (url === '/workspace/state' && (!options.method || options.method === 'GET')) return Promise.resolve(JSON.parse(JSON.stringify(server.state)));
      if (url === '/workspace/state' && options.method === 'PUT') {
        server.puts.push(JSON.parse(JSON.stringify(options.body)));
        server.state = { ...server.state, ...options.body };
        return Promise.resolve(JSON.parse(JSON.stringify(server.state)));
      }
      if (url === '/workspace/shortcuts' && options.method === 'POST') {
        const shortcut = { id: 's1', scope: 'personal', ownerId: 'ana', ...options.body };
        server.state.shortcuts = server.state.shortcuts.concat(shortcut);
        return Promise.resolve({ shortcut });
      }
      if (url.startsWith('/workspace/shortcuts/') && options.method === 'PATCH') {
        const id = url.split('/').pop(); const shortcut = { ...server.state.shortcuts.find(s => s.id === id), ...options.body };
        server.state.shortcuts = server.state.shortcuts.map(s => s.id === id ? shortcut : s);
        return Promise.resolve({ shortcut });
      }
      if (url.startsWith('/workspace/shortcuts/') && options.method === 'DELETE') {
        server.state.shortcuts = server.state.shortcuts.filter(s => s.id !== url.split('/').pop());
        return Promise.resolve({ id: url.split('/').pop(), deleted: true });
      }
      if (url === '/workspace/views' && options.method === 'POST') {
        const view = { id: 'v1', ownerId: 'ana', ...options.body };
        server.state.views = server.state.views.concat(view);
        return Promise.resolve({ view });
      }
      if (url.startsWith('/workspace/views/') && options.method === 'PATCH') {
        const id = url.split('/').pop();
        const view = { ...server.state.views.find(row => row.id === id), ...options.body };
        server.state.views = server.state.views.map(row => row.id === id ? view : row);
        return Promise.resolve({ view });
      }
      if (url.startsWith('/workspace/views/') && options.method === 'DELETE') {
        server.state.views = server.state.views.filter(v => v.id !== url.split('/').pop());
        return Promise.resolve({ id: url.split('/').pop(), deleted: true });
      }
      return Promise.reject(new Error('unexpected ' + url));
    }
  };
  return server;
}
const app = () => ({ authenticated: true, activeUserId: 'ana', currentUser: { id: 'ana' }, config: {}, dashboard: {}, workspaceState: null });

test('workspace reload hydrates real per-user widgets, favorites, views and theme', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  server.state = stateDTO({ shortcuts: [{ id: 's1', name: 'Consola', url: 'https://x.local', icon: 'server', category: '', scope: 'personal', ownerId: 'ana' }] });
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  assert.equal(vmApp.workspaceState.loaded, true);
  assert.equal(vmApp.workspaceState.themeMode, 'dark');
  assert.equal(c.AssetWorkspace.user(vmApp.workspaceState, 'ana').favorites[0].key, 'asset:x1');
  assert.equal(c.AssetDashboardPrefs.layoutFor(vmApp.dashboard, 'ana').length, 2);
  assert.equal(vmApp.dashboard.links[0].id, 's1');
  assert.equal(vmApp.config.integrations, undefined, 'workspace load does not invent integrations');
});

test('account change drops previous session data and ignores its late response', async () => {
  const c = context();
  const pending = [];
  c.AssetAccess = { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  const vmApp = app();
  const old = c.AssetPhase10Api.loadWorkspace(vmApp);
  c.AssetPhase10Api.clear(vmApp);
  vmApp.activeUserId = 'luis'; vmApp.currentUser = { id: 'luis' };
  const next = c.AssetPhase10Api.loadWorkspace(vmApp);
  pending[1].resolve(stateDTO({ themeMode: 'auto', favorites: [] }));
  await next;
  assert.equal(vmApp.workspaceState.themeMode, 'auto');
  pending[0].resolve(stateDTO({ themeMode: 'dark' }));
  await old;
  assert.equal(vmApp.workspaceState.themeMode, 'auto', 'ana response did not leak into luis');
});

test('serialized state patches merge widgets, favorites and theme without clobbering', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  await Promise.all([
    c.AssetPhase10Api.patchState(vmApp, { themeMode: 'light' }),
    c.AssetPhase10Api.patchState(vmApp, { widgets: ['alerts'] }),
    c.AssetPhase10Api.patchState(vmApp, { favorites: [] })
  ]);
  assert.equal(server.puts.length, 3);
  assert.equal(server.state.themeMode, 'light');
  assert.deepEqual(server.state.widgets, ['alerts']);
  assert.deepEqual(server.state.favorites, []);
  assert.equal(vmApp.workspaceState.themeMode, 'light');
  assert.equal(c.AssetDashboardPrefs.layoutFor(vmApp.dashboard, 'ana').length, 1);
});

test('favorites, shortcuts and views persist through canonical endpoints', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  const favorite = { key: 'person:p1', type: 'Personas', id: 'p1', label: 'Ana', subtitle: '', icon: 'user', target: { kind: 'person', id: 'p1' } };
  await c.AssetPhase10Api.toggleFavorite(vmApp, favorite);
  assert.equal(server.state.favorites.length, 1);
  await c.AssetPhase10Api.toggleFavorite(vmApp, favorite);
  assert.equal(server.state.favorites.length, 0);

  const saved = await c.AssetPhase10Api.saveShortcut(vmApp, { name: 'Consola', url: 'https://server.local', icon: 'server', category: 'Red', scope: 'personal' });
  assert.equal(saved.ok, true);
  assert.equal(server.state.shortcuts[0].url, 'https://server.local/');
  assert.equal(vmApp.dashboard.links[0].id, 's1');
  assert.equal((await c.AssetPhase10Api.saveShortcut(vmApp, { ...saved.link, name: 'Consola actualizada' })).ok, true);
  assert.equal(server.state.shortcuts[0].name, 'Consola actualizada');
  const removed = await c.AssetPhase10Api.deleteShortcut(vmApp, 's1');
  assert.equal(removed.ok, true);
  assert.equal(vmApp.dashboard.links.length, 0);

  const view = await c.AssetPhase10Api.saveView(vmApp, { name: 'Mi panel', scope: 'personal', route: 'panel', snapshot: { filters: { period: '7d' } } });
  assert.equal(view.ok, true);
  assert.equal(server.state.views[0].name, 'Mi panel');
  assert.equal(vmApp.workspaceState.views.length, 1);
  assert.equal((await c.AssetPhase10Api.saveView(vmApp, { ...view.view, name: 'Panel actualizado' })).ok, true);
  assert.equal(server.state.views[0].name, 'Panel actualizado');
  assert.equal((await c.AssetPhase10Api.deleteView(vmApp, 'v1')).ok, true);
  assert.equal(vmApp.workspaceState.views.length, 0);
});

test('integration responses from a previous account never reach the current session', async () => {
  const c = context(); const pending = [];
  c.AssetAccess = { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  const vmApp = app();
  const load = c.AssetPhase10Api.loadIntegrations(vmApp);
  c.AssetPhase10Api.clear(vmApp);
  vmApp.activeUserId = 'luis'; vmApp.currentUser = { id: 'luis' };
  pending[0].resolve({ anydeskEnabled: true, anydeskUrl: 'https://old.local', rmmEnabled: false, rmmUrl: '' });
  assert.equal(await load, null);
  assert.equal(vmApp.config.integrations, undefined, 'old account read is dropped');

  const save = c.AssetPhase10Api.saveIntegrations(vmApp, { anydesk: { enabled: true, url: 'https://luis.local' }, rmm: { enabled: false, url: '' } });
  c.AssetPhase10Api.clear(vmApp);
  vmApp.activeUserId = 'ana'; vmApp.currentUser = { id: 'ana' };
  pending[1].resolve({ anydeskEnabled: true, anydeskUrl: 'https://luis.local', rmmEnabled: false, rmmUrl: '' });
  const stale = await save;
  assert.equal(stale.ok, false);
  assert.equal(vmApp.config.integrations, undefined, 'old account write is dropped');

  c.AssetAccess = { request: () => Promise.resolve({ anydeskEnabled: true, anydeskUrl: 'https://soporte.local', rmmEnabled: false, rmmUrl: '' }) };
  const ok = await c.AssetPhase10Api.saveIntegrations(vmApp, { anydesk: { enabled: true, url: 'https://soporte.local' }, rmm: { enabled: false, url: '' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.integrations.anydesk.url, 'https://soporte.local');
  assert.equal(ok.integrations.rmm.enabled, false);
});

test('workspace errors are explicit and temporary widgets never write', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  c.AssetAccess = { request: () => Promise.reject(new Error('Sin conexión')) };
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  assert.equal(vmApp.workspaceState.error, 'Sin conexión');
  assert.equal(vmApp.workspaceState.loaded, false);

  const c2 = context(); const server2 = fakeServer(c2); const vm2 = app();
  await c2.AssetPhase10Api.loadWorkspace(vm2);
  const before = server2.calls.length;
  c2.AssetDashboardPrefs.addTemporary(vm2.dashboard, 'ana', 'latency');
  assert.ok(c2.AssetDashboardPrefs.visibleWidgets(vm2.dashboard, 'ana').includes('latency'));
  assert.equal(server2.calls.length, before, 'temporary widget is session-only');
  c2.AssetDashboardPrefs.clearTemporary(vm2.dashboard, 'ana');
  assert.ok(!c2.AssetDashboardPrefs.visibleWidgets(vm2.dashboard, 'ana').includes('latency'));
});

test('inventory and restored views keep sibling last views on the server', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  Object.assign(c, {
    AssetMapViews: { MapExplorer: {} }, AssetGraphView: {}, AssetPanel: { PanelOverview: {} },
    AssetReportViews: { ReportsCenter: {} }, AssetMaintViews: { MaintenanceCenter: { created() {} } }
  });
  vm.runInContext(read('assets/js/workspace-runtime.js'), c, { filename: 'workspace-runtime.js' });
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  await c.AssetPhase10Api.rememberLastView(vmApp, 'map', { filters: { search: 'bomba' } });

  vmApp.prefs = { category: 'all', site: 'all', search: '', view: 'table', sort: 'name' };
  vmApp.workspaceInventory = { status: 'up', location: '' };
  vmApp.bulk = { ids: ['a1'] };
  vmApp.route = { name: 'inventory' };
  vmApp.patchWorkspaceState = patch => c.AssetPhase10Api.patchState(vmApp, patch);
  vmApp.captureWorkspaceView = c.AssetWorkspaceRuntime.methods.captureWorkspaceView;
  await c.AssetWorkspaceRuntime.methods.rememberWorkspaceInventory.call(vmApp);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(server.state.lastViews.map.filters.search, 'bomba', 'inventory snapshot keeps map last view');
  assert.equal(server.state.lastViews.inventory.selection[0], 'a1');

  vmApp.route = { name: 'panel' };
  vmApp.explorerFilters = { categories: [], sites: [], states: [], locations: [], search: '' };
  vmApp.explorerSelection = ''; vmApp.assets = []; vmApp.navigateWorkspace = () => {}; vmApp.showToast = () => {};
  c.AssetWorkspaceRuntime.methods.restoreWorkspaceView.call(vmApp, {
    id: 'v1', name: 'Mapa', route: 'map', snapshot: { filters: { search: 'planta' } }
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(server.state.lastViews.inventory.selection[0], 'a1', 'restored view keeps sibling last views');
  assert.equal(server.state.lastViews.map.filters.search, 'planta');

  const puts = server.puts.length;
  vmApp.route = { name: 'inventory' };
  vmApp.phase10RememberLastView = (route, snapshot) => c.AssetPhase10Api.rememberLastView(vmApp, route, snapshot);
  c.AssetWorkspaceRuntime.methods.handleWorkspaceRoute.call(vmApp, { name: 'map' }, { name: 'inventory' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(server.puts.length, puts + 1, 'route hook persists inventory snapshot');
  assert.equal(server.state.lastViews.map.filters.search, 'planta', 'route hook keeps map last view');
});

test('dashboard layout changes persist only through the serialized state queue', async () => {
  const c = context(); const server = fakeServer(c); const vmApp = app();
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  c.AssetDashboardPrefs.setWidgetVisible(vmApp.dashboard, 'ana', 'alerts', false);
  vmApp.patchWorkspaceState = patch => c.AssetPhase10Api.patchState(vmApp, patch);
  await vmApp.patchWorkspaceState({ widgets: c.AssetDashboardPrefs.layoutFor(vmApp.dashboard, 'ana') });
  assert.ok(!server.state.widgets.includes('alerts'));
  assert.ok(server.state.widgets.includes('availability'));
});

test('remembered explorer routes survive later inventory updates and workspace reload', async () => {
  const c = context(), server = fakeServer(c), vmApp = app();
  server.state.lastViews = { map: { activeFloorId: 'floor-1' }, graph: { filters: { search: 'core' } } };
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  await c.AssetPhase10Api.patchState(vmApp, { lastViews: { inventory: { prefs: { view: 'cards' } } } });
  await c.AssetPhase10Api.loadWorkspace(vmApp);
  const restored = c.AssetWorkspace.user(vmApp.workspaceState, 'ana').lastViews;
  assert.equal(restored.map.activeFloorId, 'floor-1');
  assert.equal(restored.graph.filters.search, 'core');
  assert.equal(restored.inventory.prefs.view, 'cards');
});

test('late saved-view and shortcut deletions cannot mutate the next account', async () => {
  const c = context(), vmApp = app(), pending = [];
  c.AssetAccess = { request: () => new Promise(resolve => pending.push(resolve)) };
  c.AssetPhase10Api.hydrateWorkspace(vmApp, stateDTO({
    views: [{ id: 'v1', ownerId: 'ana', scope: 'personal', name: 'Ana vista', route: 'inventory', snapshot: {} }],
    shortcuts: [{ id: 's1', ownerId: 'ana', scope: 'personal', name: 'Ana consola', url: 'https://ana.example/', icon: 'server' }]
  }));
  const view = c.AssetPhase10Api.deleteView(vmApp, 'v1');
  const shortcut = c.AssetPhase10Api.deleteShortcut(vmApp, 's1');
  await new Promise(resolve => setTimeout(resolve, 10));
  c.AssetPhase10Api.clear(vmApp);
  vmApp.activeUserId = 'luis'; vmApp.currentUser = { id: 'luis' };
  c.AssetPhase10Api.hydrateWorkspace(vmApp, stateDTO({
    views: [{ id: 'v1', ownerId: 'luis', scope: 'personal', name: 'Luis vista', route: 'panel', snapshot: {} }],
    shortcuts: [{ id: 's1', ownerId: 'luis', scope: 'personal', name: 'Luis consola', url: 'https://luis.example/', icon: 'server' }]
  }));
  pending.forEach(resolve => resolve({ id: 'shared', deleted: true }));
  const [viewResult, shortcutResult] = await Promise.all([view, shortcut]);
  assert.equal(viewResult.ok, false, 'stale view deletion is not reported as applied');
  assert.equal(shortcutResult.ok, false, 'stale shortcut deletion is not reported as applied');
  assert.deepEqual(Array.from(vmApp.workspaceState.views, item => item.name), ['Luis vista']);
  assert.deepEqual(Array.from(vmApp.workspaceState.shortcuts, item => item.name), ['Luis consola']);
});

test('explorer switches keep live shared filters and selection over stale saved views', () => {
  const c = runtimeContext(), vmApp = app();
  c.AssetPhase10Api.hydrateWorkspace(vmApp, stateDTO({ lastViews: { graph: {
    filters: { categories: ['notebooks'], sites: [], states: [], locations: [], types: ['network'], search: 'old' },
    selectedId: 'old', view: { x: 10, y: 20, k: 1.5 }
  } } }));
  vmApp.workspaceUserId = 'ana';
  vmApp.explorerFilters = { categories: ['computadoras'], sites: [], states: ['asignado'], locations: [], search: '' };
  vmApp.explorerSelection = 'asset:x1';
  const child = { app: vmApp, filters: { categories: ['computadoras'], sites: [], states: ['asignado'], locations: [], search: '' }, selectedId: 'asset:x1', view: { x: 0, y: 0, k: 1 } };
  c.AssetGraphView.created.call(child);
  assert.deepEqual(Array.from(child.filters.categories), ['computadoras']);
  assert.deepEqual(Array.from(child.filters.states), ['asignado']);
  assert.equal(child.selectedId, 'asset:x1');
  assert.equal(child.view.k, 1.5, 'graph-only preferences still restore from the saved view');
});

test('explorer opened in this session keeps cleared shared filters authoritative', () => {
  const c = runtimeContext(), vmApp = app();
  c.AssetPhase10Api.hydrateWorkspace(vmApp, stateDTO({ lastViews: { graph: {
    filters: { categories: ['notebooks'], sites: [], states: [], locations: [], search: 'old' }, selectedId: 'old'
  } } }));
  vmApp.workspaceUserId = 'ana';
  vmApp.explorerActive = true;
  vmApp.explorerFilters = { categories: [], sites: [], states: [], locations: [], search: '' };
  vmApp.explorerSelection = '';
  const child = { app: vmApp, filters: { categories: [], sites: [], states: [], locations: [], search: '' }, selectedId: '' };
  c.AssetGraphView.created.call(child);
  assert.deepEqual(Array.from(child.filters.categories), []);
  assert.equal(child.selectedId, '', 'cleared shared selection wins over the stale saved view');
});

function runtimeContext() {
  const c = context(), stub = () => ({});
  Object.assign(c, {
    AssetMapViews: { MapExplorer: stub() }, AssetGraphView: stub(), AssetPanel: { PanelOverview: stub() },
    AssetReportViews: { ReportsCenter: stub() }, AssetMaintViews: { MaintenanceCenter: stub() }, AssetSearch: {}
  });
  vm.runInContext(read('assets/js/workspace-runtime.js'), c, { filename: 'workspace-runtime.js' });
  return c;
}
