'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const c = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, AbortController, localStorage: storage, sessionStorage: storage });
  c.window = c;
  for (const file of ['workspace-engine', 'dashboard-preferences', 'phase10-api']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/' + file + '.js'), 'utf8'), c, { filename: file + '.js' });
  }
  for (const file of ['dashboard-model']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/' + file + '.js'), 'utf8'), c, { filename: file + '.js' });
  }
  return c;
}
// Canonical GET /dashboard fixture. The client only normalizes this DTO; every
// aggregate, window and availability value is owned by the dashboard service.
function summary(overrides = {}) {
  const rows = [
    { assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', category: 'pc', siteId: 'central', locationId: 'l1', status: 'down', monitored: true, reason: 'Probe failed', uptimePct: 91.2, latencyMs: 12, lastCheckAt: '2026-10-23T09:59:00Z', target: { kind: 'asset', id: 'x1' } },
    { assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', category: 'server', siteId: 'central', locationId: 'l2', status: 'up', monitored: true, reason: '', uptimePct: 99.9, latencyMs: 4, lastCheckAt: '2026-10-23T09:58:00Z', target: { kind: 'asset', id: 'x2' } },
    { assetId: 'x3', assetName: 'Equipo Z', assetCode: 'AM-3', category: 'pc', siteId: 'branch', locationId: 'l3', status: 'unknown', monitored: false, reason: 'Sin datos', uptimePct: null, latencyMs: null, lastCheckAt: '', target: { kind: 'asset', id: 'x3' } }
  ];
  return {
    generatedAt: '2026-10-23T10:00:00Z',
    stats: { total: 3, monitored: 2, up: 1, degraded: 0, down: 1, unmonitored: 1, unknown: 0, criticalAlerts: 1, unacknowledged: 1, activeIncidents: 1 },
    availability: { current: 96.5, configured: true, samples: [{ at: '2026-10-23T09:00:00Z', label: '24h', value: 96.5 }, { at: '2026-10-22T09:00:00Z', label: '24h', value: null }], samplesCount: 1, lastCheckAt: '2026-10-23T09:59:00Z' },
    latency: { current: 12 },
    distribution: [{ id: 'up', label: 'Disponibles', count: 1 }, { id: 'down', label: 'Fuera de línea', count: 1 }, { id: 'unknown', label: 'Sin datos', count: 1 }],
    severity: [{ id: 'critical', label: 'Crítica', count: 1 }],
    activeAlerts: [{ id: 'a1', title: 'Disco lleno', severity: 'critical', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', acknowledged: false, target: { kind: 'alert', id: 'a1' } }],
    rows,
    activity: [
      { id: 'e1', at: '2026-10-23T09:00:00Z', kind: 'recovery', title: 'Conectividad recuperada', detail: 'Volvió a responder', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', target: { kind: 'asset', id: 'x1' } },
      { id: 'e2', at: '2026-10-23T08:00:00Z', kind: 'alert', title: 'Equipo sin respuesta', detail: 'Timeout', assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', target: { kind: 'asset', id: 'x2' } },
      { id: 'e3', at: '2026-10-23T07:00:00Z', kind: 'inventory', title: 'Asignación actualizada', detail: 'Puesto', assetId: 'x3', assetName: 'Equipo Z', assetCode: 'AM-3' }
    ],
    maintenance: [{ planId: 'p1', assetId: 'x1', assetName: 'Equipo X', label: 'Limpieza', status: 'overdue', statusTone: 'down', dueAt: '2026-10-22T00:00:00Z' }],
    warranties: [
      { assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', until: '2026-10-23', days: 0, coverage: 'expiring' },
      { assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', until: '2026-01-21', days: 90, coverage: 'expiring' }
    ],
    inventory: { total: 3, active: 2, unassigned: 1, attention: [{ assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', status: 'down' }] },
    incidents: [{ id: 'i1', title: 'Sin acceso', assetId: 'x1', assetName: 'Equipo X', severity: 'high', status: 'open', target: { kind: 'incident', id: 'i1' } }],
    ...overrides
  };
}
test('dashboard filters canonical summary rows by status, location and search without rewriting the DTO', () => {
  const c = context(), M = c.AssetDashboardModel, dto = summary(), before = JSON.stringify(dto);
  const all = M.fromSummary(dto, { period: '24h' });
  assert.equal(all.assets.length, 3);
  assert.equal(all.stats.monitored, 2);
  assert.equal(all.stats.up + all.stats.down + all.stats.degraded, 2);
  assert.equal(all.availability.length, 1, 'empty samples are not chart points');
  assert.equal(all.distribution.reduce((total, row) => total + row.count, 0), 3);
  const down = M.fromSummary(dto, { status: 'down' });
  assert.deepEqual(Array.from(down.assets, asset => asset.id), ['x1']);
  assert.equal(down.rows[0].href, '#/activo/x1');
  assert.deepEqual(Array.from(M.fromSummary(dto, { location: 'l2' }).assets, asset => asset.id), ['x2']);
  assert.deepEqual(Array.from(M.fromSummary(dto, { search: 'AM-3' }).assets, asset => asset.id), ['x3']);
  assert.equal(down.alerts[0].asset.name, 'Equipo X', 'alerts reuse the normalized canonical asset');
  assert.equal(JSON.stringify(dto), before, 'normalization never mutates the server DTO');
  const missing = M.build({ dashboard: { summary: null } }, { period: '30d' });
  assert.equal(missing.available, false);
  assert.equal(missing.assets.length, 0);
  assert.equal(missing.stats.availability, null);
  assert.equal(missing.activity.length, 0);
});
test('warranty rows keep the service window, days and coverage without local date recalculation', () => {
  const c = context(), M = c.AssetDashboardModel, m = M.fromSummary(summary(), { period: '24h' });
  assert.deepEqual(Array.from(m.warranties, row => row.days), [0, 90], 'server-provided window bounds survive untouched');
  assert.deepEqual(Array.from(m.warranties, row => row.asset.id), ['x2', 'x1']);
  assert.equal(m.warranties[0].until, '2026-10-23');
  assert.equal(m.warranties[0].coverage, 'expiring');
});
test('additional metrics require a canonical value and no-probe equipment receives no invented values', () => {
  const c = context(), M = c.AssetDashboardModel;
  const m = M.fromSummary(summary({ latency: { current: null }, availability: { current: null, configured: false, samples: [], samplesCount: 0 } }), { period: '24h' });
  assert.equal(m.latency.length, 0);
  assert.equal(m.availability.length, 0);
  assert.equal(m.stats.availability, null);
  assert.equal(m.widgetAvailable('latency'), true, 'real per-device readings remain usable without an aggregate');
  const missing = summary({ latency: { current: null } });
  missing.rows.forEach(row => { row.latencyMs = null; });
  assert.equal(M.fromSummary(missing).widgetAvailable('latency'), false, 'no aggregate and no measured rows is unavailable');
  assert.equal(m.widgetAvailable('availability'), false);
  assert.equal(m.distribution.find(row => row.id === 'unknown').count, 1, 'unknown stays the server-reported count');
  assert.equal(m.rows.find(row => row.asset.id === 'x3').latencyMs, null);
});
test('recovery events preserve their real text and the activity filter exposes them', () => {
  const c = context(), M = c.AssetDashboardModel, m = M.fromSummary(summary(), { period: '24h' });
  const recovery = m.activity.find(event => event.id === 'e1');
  assert.equal(recovery.kind, 'recovery');
  assert.equal(recovery.title, 'Conectividad recuperada');
  assert.equal(recovery.detail, 'Volvió a responder');
  assert.deepEqual(Array.from(m.outages, event => event.id), ['e1', 'e2']);
  assert.equal(m.activity.at(0).id, 'e1', 'newest event first');
  assert.equal(m.activity.filter(event => event.kind === 'recovery').length, 1);
});
test('widget visibility and order are per-user, temporary widgets never alter the saved layout', () => {
  const c = context();
  assert.ok(c.AssetDashboardPrefs, 'Dashboard preferences API must exist');
  const P = c.AssetDashboardPrefs, s = P.createState();
  const original = JSON.stringify(P.layoutFor(s, 'a'));
  P.setWidgetVisible(s, 'a', 'alerts', false);
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), false);
  assert.equal(P.visibleWidgets(s, 'b').includes('alerts'), true);
  P.addTemporary(s, 'a', 'alerts');
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), true);
  assert.equal(P.layoutFor(s, 'a').includes('alerts'), false);
  P.clearTemporary(s, 'a');
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), false);
  P.moveWidget(s, 'a', 'inventory', -1);
  assert.equal(P.layoutFor(s, 'a').at(-2), 'inventory');
  P.resetLayout(s, 'a');
  assert.equal(JSON.stringify(P.layoutFor(s, 'a')), original);
});
test('custom link CRUD validates before transport and surfaces server ownership denials', async () => {
  const c = context();
  const requests = [], saved = new Map();
  let user = 'a', shared = false, sequence = 0;
  c.AssetAccess = { request(_vm, url, options = {}) {
    requests.push({ url, method: options.method || 'GET', body: options.body });
    if (url === '/workspace/shortcuts' && options.method === 'POST') {
      const shortcut = { id: 'shortcut-' + (++sequence), scope: 'personal', ownerId: user, ...options.body };
      saved.set(shortcut.id, shortcut);
      return Promise.resolve({ shortcut });
    }
    const id = decodeURIComponent(url.split('/').pop());
    if (url.startsWith('/workspace/shortcuts/') && options.method === 'PATCH') {
      const existing = saved.get(id);
      if (!existing || (existing.scope === 'shared' ? !shared : existing.ownerId !== user)) return Promise.reject(new Error('No autorizado.'));
      const shortcut = { ...existing, ...options.body };
      saved.set(id, shortcut);
      return Promise.resolve({ shortcut });
    }
    if (url.startsWith('/workspace/shortcuts/') && options.method === 'DELETE') {
      const existing = saved.get(id);
      if (!existing || (existing.scope === 'shared' ? !shared : existing.ownerId !== user)) return Promise.reject(new Error('No autorizado.'));
      saved.delete(id);
      return Promise.resolve({ id, deleted: true });
    }
    return Promise.reject(new Error('unexpected ' + url));
  } };
  const app = { authenticated: true, get currentUser() { return { id: user }; }, can: () => shared,
    workspaceState: c.AssetPhase10Api.createWorkspaceState(), dashboard: c.AssetPhase10Api.createDashboardState() };
  const invalid = await c.AssetPhase10Api.saveShortcut(app, { name: 'Unsafe', url: 'javascript:alert(1)', scope: 'personal', icon: 'server' });
  assert.equal(invalid.ok, false);
  assert.equal(requests.length, 0, 'invalid destinations never reach the transport');
  const personal = await c.AssetPhase10Api.saveShortcut(app, { name: 'Internal', url: 'https://example.com', scope: 'personal', icon: 'server', category: 'Red' });
  assert.equal(personal.ok, true);
  const visible = owner => app.dashboard.links.filter(link => link.scope === 'shared' || link.ownerId === owner);
  assert.equal(visible('a').length, 1);
  assert.equal(visible('b').length, 0);
  user = 'b';
  const hijack = await c.AssetPhase10Api.saveShortcut(app, { id: personal.link.id, name: 'Hijack', url: 'https://example.org', scope: 'personal' });
  assert.equal(hijack.ok, false);
  assert.equal(requests.filter(request => request.method === 'PATCH').length, 0);
  const sharedDenied = await c.AssetPhase10Api.saveShortcut(app, { name: 'Shared', url: 'https://example.org', scope: 'shared' });
  assert.equal(sharedDenied.ok, false);
  user = 'a'; shared = true;
  const sharedSaved = await c.AssetPhase10Api.saveShortcut(app, { name: 'Shared', url: 'https://example.org', scope: 'shared' });
  assert.equal(sharedSaved.ok, true);
  assert.equal(visible('b').length, 1);
  user = 'b'; shared = false;
  assert.equal((await c.AssetPhase10Api.deleteShortcut(app, personal.link.id)).ok, false, 'server denial is surfaced, not simulated');
  user = 'a';
  assert.equal((await c.AssetPhase10Api.deleteShortcut(app, personal.link.id)).ok, true);
  assert.equal(visible('a').length, 1);
});
