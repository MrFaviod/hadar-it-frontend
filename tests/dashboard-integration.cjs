'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
// Composed-shell suite: defaults to this worktree; ASSET_FRONTEND_ROOT runs the
// same tests against an integrated checkout without copying test files.
const root = process.env.ASSET_FRONTEND_ROOT ? path.resolve(process.env.ASSET_FRONTEND_ROOT) : path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
// Canonical GET /dashboard fixture: every number comes from the service DTO.
function summary(overrides = {}) {
  return {
    generatedAt: '2026-10-23T10:00:00Z', period: '24h',
    stats: { total: 2, monitored: 2, up: 1, degraded: 0, down: 1, unmonitored: 0, unknown: 0, criticalAlerts: 1, unacknowledged: 1, activeIncidents: 0 },
    availability: { current: 97.5, configured: true, samples: [{ at: '2026-10-23T09:00:00Z', label: '24h', value: 97.5 }, { at: '2026-10-22T09:00:00Z', label: '24h', value: 99.1 }], samplesCount: 2, lastCheckAt: '2026-10-23T09:59:00Z' },
    latency: { current: 14 },
    distribution: [{ id: 'up', label: 'Disponibles', count: 1 }, { id: 'down', label: 'Fuera de línea', count: 1 }],
    severity: [{ id: 'critical', label: 'Crítica', count: 1 }],
    activeAlerts: [{ id: 'a1', title: 'Disco lleno', severity: 'critical', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', acknowledged: false, target: { kind: 'alert', id: 'a1' } }],
    rows: [
      { assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', category: 'pc', siteId: 'central', locationId: 'l1', status: 'down', monitored: true, reason: 'Probe failed', uptimePct: 91.2, latencyMs: 14, lastCheckAt: '2026-10-23T09:59:00Z', target: { kind: 'asset', id: 'x1' } },
      { assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', category: 'server', siteId: 'central', locationId: 'l2', status: 'up', monitored: true, reason: '', uptimePct: 99.9, latencyMs: 4, lastCheckAt: '2026-10-23T09:58:00Z', target: { kind: 'asset', id: 'x2' } }
    ],
    activity: [{ id: 'e1', at: '2026-10-23T09:00:00Z', kind: 'recovery', title: 'Conectividad recuperada', detail: 'Volvió a responder', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', target: { kind: 'asset', id: 'x1' } }],
    maintenance: [{ planId: 'p1', assetId: 'x1', assetName: 'Equipo X', label: 'Limpieza', status: 'overdue', statusTone: 'down', dueAt: '2026-10-22T00:00:00Z' }],
    warranties: [{ assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', until: '2026-11-01', days: 9, coverage: 'expiring' }],
    inventory: { total: 2, active: 2, unassigned: 0, attention: [] },
    incidents: [{ id: 'i1', title: 'Sin acceso', assetId: 'x1', assetName: 'Equipo X', severity: 'high', status: 'open', target: { kind: 'incident', id: 'i1' } }],
    ...overrides
  };
}
function canonicalServer(c) {
  const server = { dashboardCalls: [], workspaceCalls: [], shortcuts: [], nextShortcut: 1 };
  server.dashboard = params => {
    const dto = summary();
    const category = params.get('category'), siteId = params.get('siteId');
    if (category) dto.rows = dto.rows.filter(row => row.category === category);
    if (siteId) dto.rows = dto.rows.filter(row => row.siteId === siteId);
    dto.period = params.get('period') || '24h';
    return dto;
  };
  c.AssetAccess = { ...c.AssetAccess, request(_vm, url, options = {}) {
    const parsed = new URL(url, 'http://fixture');
    const method = options.method || 'GET';
    server.dashboardCalls.push({ path: parsed.pathname, params: parsed.searchParams, method });
    if (parsed.pathname === '/dashboard') return Promise.resolve(clone(server.dashboard(parsed.searchParams)));
    server.workspaceCalls.push({ path: parsed.pathname, method, body: options.body });
    if (parsed.pathname === '/workspace/state') {
      if (method === 'PUT') server.state = { ...server.state, ...clone(options.body || {}) };
      return Promise.resolve(clone(server.state || { widgets: null, favorites: [], usage: {}, lastViews: {}, themeMode: 'auto', shortcuts: [], views: [] }));
    }
    if (parsed.pathname === '/workspace/shortcuts' && method === 'POST') {
      const shortcut = { id: 'shortcut-' + server.nextShortcut++, ownerId: 'admin', scope: 'personal', ...clone(options.body || {}) };
      server.shortcuts.push(shortcut);
      return Promise.resolve({ shortcut: clone(shortcut) });
    }
    return Promise.reject(new Error('unexpected ' + method + ' ' + url));
  } };
  return server;
}
async function setup() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const c = vm.createContext({ console, Date, URL, URLSearchParams, Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, atob, btoa, setTimeout, clearTimeout, AbortController, AbortSignal, localStorage: storage, sessionStorage: storage, location: { hash: '#/panel' }, history: { replaceState() {} }, navigator: {} }); c.window = c;
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/vendor/vue.global.prod.js'), 'utf8'), c);
  const decode = text => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity] || String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))));
  c.document = { createElement() { return { children: [], set innerHTML(v) { this.textContent = decode(v); this.children = [{ getAttribute: () => decode((v.match(/foo="([\s\S]*)"/) || [])[1] || '') }]; } }; }, title: '' };
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/vendor/vue-i18n.global.prod.js'), 'utf8'), c);
  const catalog = tag => JSON.parse(fs.readFileSync(path.join(root, 'assets/i18n/' + tag + '.json'), 'utf8'));
  // The runtime boots from the shipped catalogs; the server bundle stays absent here.
  c.__ITSM_I18N_CATALOGS__ = { catalogs: { es: catalog('es'), en: catalog('en') }, context: catalog('context') };
  c.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if (src.includes('/vendor/') || /theme|sidebar|app\.js/.test(src)) continue;
    vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), c, { filename: src });
  }
  c.ItsmI18n.primeBundle('es');
  const server = canonicalServer(c);
  const realVue = c.Vue;
  c.Vue = { ...realVue, createApp(options) { c.rootOptions = options; return { mount() {} }; } };
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8'), c);
  c.Vue = realVue;
  const app = realVue.reactive(Object.assign({}, c.AssetAccess.data(), ...(c.rootOptions.mixins || []).filter(mixin => mixin && typeof mixin === 'object').map(mixin => typeof mixin.data === 'function' ? mixin.data() : {}), c.rootOptions.data()));
  for (const mixin of (c.rootOptions.mixins || []).filter(mixin => mixin && typeof mixin === 'object')) for (const [key, fn] of Object.entries(mixin.methods || {})) app[key] = fn.bind(app);
  for (const [key, fn] of Object.entries(c.rootOptions.methods || {})) app[key] = fn.bind(app);
  app.authenticated = true; app.activeUserId = 'admin'; app.security.users = [{ id: 'admin', name: 'Admin fixture', roleId: 'fixture', active: true }]; app.serverPermissions = []; app.can = () => true; app.showToast = message => { app.lastToast = message; }; app.openAssetCreate = () => { app.createOpened = true; }; app.openAsset = asset => { app.openedAsset = asset.id; };
  const computed = Object.assign({}, ...(c.rootOptions.mixins || []).filter(mixin => mixin && typeof mixin === 'object').map(mixin => mixin.computed || {}), c.AssetAccess.computed, c.rootOptions.computed);
  for (const [name, fn] of Object.entries(computed)) Object.defineProperty(app, name, { get: () => fn.call(app), configurable: true });
  // Access state is owned by its existing mixin; no auth logic is replaced in production.
  const host = {
    createElement: tag => ({ tag, tagName: tag.toUpperCase(), props: {}, children: [], parent: null, addEventListener() {}, removeEventListener() {}, get options() { return this.children; }, get value() { return this.props.value; }, set value(v) { this.props.value = v; }, selected: false, multiple: false }), createText: text => ({ tag: '#text', text, children: [] }), createComment: text => ({ tag: '#comment', text, children: [] }),
    setText: (n, t) => { n.text = t; }, setElementText: (n, t) => { n.text = t; n.children = []; }, patchProp: (n, k, o, v) => { n.props[k] = v; },
    insert(n, p, anchor) { if (n.parent) { const i = n.parent.children.indexOf(n); if (i >= 0) n.parent.children.splice(i, 1); } const i = anchor ? p.children.indexOf(anchor) : -1; if (i >= 0) p.children.splice(i, 0, n); else p.children.push(n); n.parent = p; },
    remove(n) { if (n.parent) { const i = n.parent.children.indexOf(n); if (i >= 0) n.parent.children.splice(i, 1); } }, parentNode: n => n.parent, nextSibling(n) { if (!n.parent) return null; return n.parent.children[n.parent.children.indexOf(n) + 1] || null; }
  };
  const container = { children: [] };
  // Transition hooks use a DOM renderer; their visual behavior is checked by static motion rules, not emulated here.
  const component = { ...c.AssetPanel.PanelOverview, template: c.AssetPanel.PanelOverview.template.replace(/<transition name="fade">/g, '<template>').replace(/<\/transition>/g, '</template>') };
  const errors = [];
  const renderer = realVue.createRenderer(host), mountedApp = renderer.createApp(component, { app });
  mountedApp.use(c.ItsmI18n.i18n);
  mountedApp.config.errorHandler = error => { errors.push(error); };
  const instance = mountedApp.mount(container);
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await realVue.nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await realVue.nextTick(); };
  await settle();
  function all(predicate, node = container, out = []) { if (predicate(node)) out.push(node); for (const child of node.children || []) all(predicate, child, out); return out; }
  const byId = id => all(n => n.props && n.props['data-od-id'] === id)[0];
  return { c, app, html, instance, server, all, byId, errors, settle, tick: realVue.nextTick };
}
test('all current component templates and root compile with the project Vue compiler', async () => {
  const s = await setup(); const seen = new Set(); let count = 0;
  function compile(comp) { if (!comp || typeof comp !== 'object' || seen.has(comp)) return; seen.add(comp); if (comp.template) { const f = s.c.Vue.compile(comp.template); assert.equal(typeof f, 'function'); count++; } for (const child of Object.values(comp.components || {})) compile(child); }
  for (const component of Object.values(s.c.rootOptions.components)) compile(component);
  const start = s.html.indexOf('<div id="app"'); const open = s.html.indexOf('>', start) + 1; const end = s.html.lastIndexOf('</div>', s.html.indexOf('<script src="assets/vendor/vue'));
  assert.equal(typeof s.c.Vue.compile(s.html.slice(open, end)), 'function');
  assert.deepEqual(s.errors, [], 'No component runtime errors against the canonical transport');
  console.log('Compiled component templates:', count, 'and root');
});
test('home interaction flow filters, switches period, explores samples and opens reports', async () => {
  const s = await setup();
  assert.ok(s.byId('dashboard-operativo'));
  assert.equal(s.all(n => n.props && String(n.props['data-od-id'] || '').startsWith('dashboard-widget-')).length, 8, 'default layout keeps the eight canonical widgets');
  s.byId('dashboard-new-asset').props.onClick(); assert.equal(s.app.createOpened, true);
  s.byId('dashboard-period-7d').props.onClick(); await s.settle();
  assert.equal(s.instance.filters.period, '7d');
  assert.ok(s.server.dashboardCalls.some(call => call.params.get('period') === '7d'), 'period is sent to GET /dashboard');
  s.instance.filters.category = 'not-found'; await s.settle();
  assert.equal(s.instance.model.assets.length, 0, 'empty summary rows stay empty, no local derivation');
  s.instance.clearFilters(); await s.settle();
  assert.equal(s.instance.model.assets.length, 2);
  const sample = s.byId('dashboard-chart-sample'); assert.ok(sample, 'availability samples render as chart inputs');
  sample.props.onInput({ target: { value: '0' } }); await s.settle();
  s.byId('dashboard-reports').props.onClick(); await s.settle(); assert.ok(s.byId('dashboard-report-panel'));
  assert.deepEqual(s.errors, [], 'interaction flow raises no component errors');
});
test('personalization interaction adds temporary widget and saves a link with a new-tab destination', async () => {
  const s = await setup();
  assert.equal(s.byId('dashboard-widget-latency'), undefined, 'latency is not in the durable default layout');
  s.byId('dashboard-customize').props.onClick(); await s.tick(); assert.ok(s.byId('dashboard-preferences'));
  s.c.AssetDashboardPrefs.addTemporary(s.app.dashboard, 'admin', 'latency'); await s.tick();
  assert.ok(s.byId('dashboard-widget-latency'), 'temporary widget appears in the session');
  const saved = JSON.stringify(s.c.AssetDashboardPrefs.layoutFor(s.app.dashboard, 'admin'));
  s.instance.clearTemporary(); await s.tick();
  assert.equal(s.byId('dashboard-widget-latency'), undefined);
  assert.equal(JSON.stringify(s.c.AssetDashboardPrefs.layoutFor(s.app.dashboard, 'admin')), saved, 'temporary additions never persist');
  s.byId('dashboard-customize').props.onClick(); await s.tick();
  s.byId('dashboard-add-link').props.onClick(); await s.tick();
  const form = s.byId('dashboard-link-form'); assert.ok(form);
  const input = s.all(n => n.tag === 'input' && n.props.placeholder === 'Consola de administración')[0]; input.props['onUpdate:modelValue']('Consola de prueba');
  const url = s.all(n => n.tag === 'input' && n.props.type === 'url')[0]; url.props['onUpdate:modelValue']('https://example.com');
  form.props.onSubmit({ preventDefault() {}, stopPropagation() {} }); await s.settle();
  assert.equal(s.server.workspaceCalls.filter(call => call.path === '/workspace/shortcuts' && call.method === 'POST').length, 1, 'the server owns shortcut persistence');
  assert.equal(s.app.dashboard.links.length, 1);
  const link = s.all(n => n.tag === 'a' && n.props.href === 'https://example.com/')[0];
  assert.ok(link, 'saved link renders');
  assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer');
  assert.deepEqual(s.errors, [], 'personalization flow raises no component errors');
});
