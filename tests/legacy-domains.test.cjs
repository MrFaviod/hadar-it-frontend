'use strict';
// FR-02 executable regression. RED against the eager loader, GREEN once the
// production host loads only the login shell and resolves operational views
// through the ordered, cached domain loader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tags = [...html.matchAll(/<script src="([^"]+)"([^>]*)>/g)].map((match) => ({
  src: match[1],
  attrs: match[2]
}));
const loaderSource = (() => {
  try { return fs.readFileSync(path.join(root, 'assets', 'js', 'loader.js'), 'utf8'); }
  catch (_) { return null; }
})();

function browser(files = {}, exec = {}) {
  const appended = [];
  const fail = new Set(files.fail || []);
  const document = {
    baseURI: 'http://localhost/',
    querySelectorAll() { return []; },
    createElement() { return { attrs: {}, set src(value) { this._src = value; }, get src() { return this._src; } }; },
    head: {
      append(element) {
        const url = new URL(element._src, 'http://localhost/').pathname;
        appended.push(url);
        setImmediate(() => {
          if (fail.has(url)) { if (element.onerror) element.onerror(new Error('404 ' + url)); return; }
          if (exec[url]) exec[url](context);
          if (element.onload) element.onload();
        });
      }
    }
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout, Promise, URL, Error, String, Object, Array, JSON, Date, setImmediate });
  context.window = context;
  const listeners = Object.create(null);
  context.addEventListener = (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); };
  context.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((entry) => entry !== fn); };
  context.__dispatchError = (event) => { (listeners.error || []).slice().forEach((fn) => fn(event)); };
  context.document = document;
  context.location = { href: 'http://localhost/' };
  context.Vue = {
    defineAsyncComponent(options) { options.__stubAsync = true; (context.__asyncComponents || (context.__asyncComponents = [])).push(options); return options; },
    h(component, props, slots) { context.__vnode = { component, props, slots }; return { component, props, slots }; }
  };
  context.AssetLoaderGroups = files.groups || {};
  vm.runInContext(loaderSource, context, { filename: 'assets/js/loader.js' });
  return { context, appended, groups: context.AssetLoaderGroups };
}

test('login layer keeps the shell and excludes operational view bundles', () => {
  assert.ok(loaderSource, 'assets/js/loader.js exists');
  const eager = tags.filter((tag) => !tag.attrs.includes('data-domain')).map((tag) => tag.src);
  const deferred = tags.filter((tag) => tag.attrs.includes('data-domain'));
  assert.ok(eager.includes('assets/js/app.js'), 'app.js stays in the blocking login layer');
  assert.ok(eager.includes('assets/js/loader.js'), 'loader ships with the login layer');
  assert.ok(eager.indexOf('assets/js/loader.js') < eager.indexOf('assets/js/app.js'), 'loader is evaluated before app.js');
  for (const src of ['assets/js/map-views.js', 'assets/js/monitoring-views.js', 'assets/js/report-views.js', 'assets/js/warranty-views.js', 'assets/js/conversation.js']) {
    assert.ok(!eager.includes(src), src + ' is not downloaded at login');
    assert.ok(deferred.some((tag) => tag.src === src), src + ' is declared as a deferred domain script');
  }
  assert.ok(deferred.length >= 30, 'the deferred operational set is material');
  assert.ok(html.includes('<asset-editor v-if="$root.authenticated"'), 'the asset editor only mounts after login');
  const order = tags.map((tag) => tag.src);
  for (const domain of new Set(deferred.map((tag) => (tag.attrs.match(/data-domain="([^"]+)"/) || [])[1]))) {
    const list = deferred.filter((tag) => tag.attrs.includes('data-domain="' + domain + '"'));
    const indexes = list.map((tag) => order.indexOf(tag.src));
    assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b), domain + ' keeps document order');
  }
});

test('ordered group load shares in-flight requests and keeps one script per URL', async () => {
  const { appended } = browser({ groups: { docs: ['/assets/js/a.js', '/assets/js/b.js', '/assets/js/c.js'] } });
  const first = browser({ groups: { docs: ['/assets/js/a.js', '/assets/js/b.js', '/assets/js/c.js'] } });
  const one = first.context.AssetLoader.loadGroup('docs');
  const two = first.context.AssetLoader.loadGroup('docs');
  await Promise.all([one, two]);
  assert.deepEqual(first.appended, ['/assets/js/a.js', '/assets/js/b.js', '/assets/js/c.js']);
  assert.equal(one, two, 'the in-flight promise is shared');
  assert.ok(appended.length === 0);
});

test('a failed request is cleared for retry while successes stay cached', async () => {
  const files = { groups: { probe: ['/assets/js/ok.js', '/assets/js/bad.js'] }, fail: ['/assets/js/bad.js'] };
  const page = browser(files);
  await assert.rejects(page.context.AssetLoader.loadGroup('probe'));
  assert.deepEqual(page.appended, ['/assets/js/ok.js', '/assets/js/bad.js']);
  page.context.AssetLoaderGroups.probe[1] = '/assets/js/good.js';
  await page.context.AssetLoader.loadGroup('probe');
  assert.deepEqual(page.appended, ['/assets/js/ok.js', '/assets/js/bad.js', '/assets/js/good.js']);
});

test('component registration is an accessor that exposes the real view through a public ref', async () => {
  const page = browser({
    groups: { views: ['/assets/js/view.js'] }
  }, {
    '/assets/js/view.js': (ctx) => { ctx.Widget = { Panel: { name: 'Panel' } }; }
  });
  const wrapper = page.context.AssetLoader.component('views', 'Widget.Panel');
  assert.equal(page.appended.length, 0, 'registration does not download');
  assert.equal(wrapper.name, 'AssetDeferredView', 'registration returns a render-time wrapper');
  assert.equal(wrapper.data().isAssetDeferredView, true, 'the wrapper declares its public marker');
  const vm = Object.assign(wrapper.data(), { $attrs: { svg: '<svg></svg>' }, $slots: { default: [] } });
  for (const [key, fn] of Object.entries(wrapper.methods)) vm[key] = fn.bind(vm);
  Object.defineProperty(vm, 'realView', { get: () => wrapper.computed.realView.call(vm) });
  const loading = wrapper.render.call(vm);
  assert.equal(loading.component.name, 'AssetDomainLoading', 'the wrapper renders a loading state before the group resolves');
  await vm.loadView();
  assert.deepEqual(page.appended, ['/assets/js/view.js']);
  const tree = wrapper.render.call(vm);
  assert.equal(tree.component.name, 'Panel', 'the resolved global is rendered');
  assert.equal(tree.props.svg, '<svg></svg>', 'attrs survive the wrapper');
  assert.equal(tree.slots, vm.$slots, 'slots survive the wrapper');
  const child = { name: 'PanelInstance', filters: { site: 's1' } };
  tree.props.ref(child);
  assert.equal(page.context.AssetLoader.realView(vm), child, 'realView unwraps the mounted child');
  assert.equal(page.context.AssetLoader.component('views', 'Widget.Panel').name, 'Panel', 'loaded global is reused');
  assert.equal(page.appended.length, 1, 'a cached success is not requested twice');
});

test('a failed group renders a retry card and retrying continues in order', async () => {
  const files = { groups: { views: ['/assets/js/view.js'] }, fail: ['/assets/js/view.js'] };
  const page = browser(files, {
    '/assets/js/good.js': (ctx) => { ctx.Widget = { Panel: { name: 'Panel' } }; }
  });
  const wrapper = page.context.AssetLoader.component('views', 'Widget.Panel');
  const vm = Object.assign(wrapper.data(), { $attrs: {}, $slots: {} });
  for (const [key, fn] of Object.entries(wrapper.methods)) vm[key] = fn.bind(vm);
  await vm.loadView();
  const card = wrapper.render.call(vm);
  assert.equal(card.component.name, 'AssetDomainError', 'a failed group shows the error card');
  assert.equal(card.props.error, vm.loadError);
  assert.equal(typeof card.props.onRetry, 'function', 'a safe network failure offers retry');
  assert.equal(vm.loadError.unrecoverable, undefined);
  page.context.AssetLoaderGroups.views[0] = '/assets/js/good.js';
  await vm.retry();
  assert.deepEqual(page.appended, ['/assets/js/view.js', '/assets/js/good.js'], 'retry requests the failed URL once more');
  assert.equal(wrapper.render.call(vm).component.name, 'Panel', 'retry mounts the real view');
});

test('a real static definition is returned unchanged', () => {
  const page = browser({ groups: {} });
  page.context.Widget = { Panel: { name: 'Static' } };
  assert.equal(page.context.AssetLoader.component('views', 'Widget.Panel').name, 'Static');
  assert.equal(page.appended.length, 0);
});

test('workspace runtime keeps its eager computed surface and wires views when they arrive', () => {
  const source = fs.readFileSync(path.join(root, 'assets', 'js', 'workspace-runtime.js'), 'utf8');
  const context = vm.createContext({ console, Object, Array, String, Promise, JSON, Date });
  context.window = context;
  context.AssetWorkspace = {};
  context.AssetSearch = {};
  vm.runInContext(source, context, { filename: 'assets/js/workspace-runtime.js' });
  assert.equal(typeof context.AssetWorkspaceRuntime.computed.workspaceFavorites, 'function', 'eager computed survives missing views');
  assert.equal(typeof context.AssetWorkspaceRuntime.methods.restoreWorkspaceView, 'function');
  context.AssetPanel = { PanelOverview: { created() {} } };
  context.AssetWorkspaceRuntime.wirePendingViews();
  assert.deepEqual(Array.from(context.AssetPanel.PanelOverview.workspaceFields), ['filters'], 'late view gets its workspace wiring');
});

test('a failed prerequisite stops every dependent script and retry continues in order', async () => {
  const files = { groups: { probe: ['/assets/js/a.js', '/assets/js/b.js', '/assets/js/c.js'] }, fail: ['/assets/js/b.js'] };
  const page = browser(files);
  await assert.rejects(page.context.AssetLoader.loadGroup('probe'));
  assert.deepEqual(page.appended, ['/assets/js/a.js', '/assets/js/b.js'], 'c never evaluates without b');
  page.context.AssetLoaderGroups.probe[1] = '/assets/js/b2.js';
  await page.context.AssetLoader.loadGroup('probe');
  assert.deepEqual(page.appended, ['/assets/js/a.js', '/assets/js/b.js', '/assets/js/b2.js', '/assets/js/c.js'], 'retry reuses a, re-requests b and only then evaluates c');
});

test('an evaluation error is never cached as success and requires a page reload', async () => {
  const page = browser({
    groups: { probe: ['/assets/js/a.js', '/assets/js/broken.js', '/assets/js/c.js'] }
  }, {
    '/assets/js/broken.js': (ctx) => {
      ctx.__dispatchError({ filename: 'http://localhost/assets/js/broken.js', error: new Error('boom') });
    }
  });
  await assert.rejects(page.context.AssetLoader.loadGroup('probe'), (error) => {
    assert.equal(error.unrecoverable, true, 'a partially evaluated script is marked unrecoverable');
    return true;
  });
  assert.deepEqual(page.appended, ['/assets/js/a.js', '/assets/js/broken.js'], 'c is not evaluated after the broken script');
  await assert.rejects(page.context.AssetLoader.loadGroup('probe'));
  assert.deepEqual(page.appended, ['/assets/js/a.js', '/assets/js/broken.js'], 'retry never re-executes side effects');
});

test('declared cross-domain prerequisites load before map, graph and dashboard', async () => {
  const page = browser({ groups: { map: ['/assets/js/map.js'], monitor: ['/assets/js/monitor.js'] } });
  await page.context.AssetLoader.loadGroup('map');
  assert.deepEqual(page.appended, ['/assets/js/monitor.js', '/assets/js/map.js']);
  assert.deepEqual(Array.from(page.context.AssetLoader.dependencies.graph), ['monitor']);
  assert.deepEqual(Array.from(page.context.AssetLoader.dependencies.dashboard), ['monitor']);
});

test('transfer data stays eager so a dashboard-only session can export CSV', () => {
  const transfer = tags.find((tag) => tag.src === 'assets/js/transfer-data.js');
  assert.ok(transfer, 'transfer-data.js is still declared');
  assert.ok(!transfer.attrs.includes('data-domain'), 'the pure data helper is not behind the transfer UI bundle');
  const transferViews = tags.find((tag) => tag.src === 'assets/js/transfer-views.js');
  assert.ok(transferViews && transferViews.attrs.includes('data-domain="transfer"'), 'the transfer UI stays deferred');
});

test('a saved view keeps its snapshot before its bundle is ever loaded', () => {
  const context = vm.createContext({ console, Object, Array, String, Promise, JSON, Date });
  context.window = context;
  context.AssetWorkspace = {
    clone: (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
    user: (state, id) => state.users[id] || (state.users[id] = { favorites: [], usage: {}, lastViews: {} }),
    rememberView() {}, visibleViews: () => []
  };
  context.AssetSearch = { record: () => ({ key: 'section:map' }) };
  context.ItsmI18n = { t: (key) => key };
  vm.runInContext(fs.readFileSync(path.join(root, 'assets', 'js', 'workspace-runtime.js'), 'utf8'), context);
  const app = {
    route: { name: 'panel' }, $refs: {}, workspaceState: { users: {} }, workspaceUserId: 'u1',
    explorerFilters: { categories: [], sites: [], states: [], locations: [], search: '' }, explorerSelection: '',
    workspacePending: null, assetAdmin: { statuses: [] },
    patchWorkspaceState() { return Promise.resolve({ ok: true }); },
    navigateWorkspace(route) { this.navigated = route; }, showToast() {}
  };
  const saved = { filters: { categories: ['cat-1'], sites: ['site-1'], states: [], locations: [], search: 'ups' }, level: 'floor', activeSiteId: 'site-1', activeFloorId: 'floor-1', selectedId: 'asset-1', selectedRoom: 'room-1', floorZoom: 2, ignored: 'no' };
  context.AssetWorkspaceRuntime.methods.restoreWorkspaceView.call(app, { name: 'Saved map', route: 'map', snapshot: saved });
  assert.deepEqual(JSON.parse(JSON.stringify(app.workspacePending.snapshot)), {
    filters: saved.filters, level: 'floor', activeSiteId: 'site-1', activeFloorId: 'floor-1', selectedId: 'asset-1', selectedRoom: 'room-1', floorZoom: 2
  }, 'the eager schema keeps only admitted fields before the view exists');
  assert.equal(app.workspacePending.route, 'map');
});

test('cold ia and sistema links parse as their own config sections', () => {
  const context = vm.createContext({ console, Object, Array, String, JSON, Date, URLSearchParams });
  context.window = context;
  context.AssetStore = { KEYS: {} };
  context.location = { hash: '' };
  vm.runInContext(fs.readFileSync(path.join(root, 'assets', 'js', 'methods.js'), 'utf8'), context);
  assert.equal(context.AssetMethods.parseRoute.call({ authenticated: true }, '#/configuracion/sistema').section, 'sistema');
  assert.equal(context.AssetMethods.parseRoute.call({ authenticated: true }, '#/configuracion/ia').section, 'ia');
  assert.equal(context.AssetMethods.parseRoute.call({ authenticated: true }, '#/configuracion/desconocida').section, 'general');
});
