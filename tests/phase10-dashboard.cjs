'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function context(extra = {}) {
  const c = vm.createContext({ console, Date, JSON, Promise, URL, AbortController, setTimeout, clearTimeout, ...extra });
  c.window = c;
  return c;
}

function loadModel() {
  const c = context();
  vm.runInContext(read('assets/js/dashboard-model.js'), c, { filename: 'dashboard-model.js' });
  return { c, model: c.AssetDashboardModel };
}

function summary(overrides = {}) {
  return {
    generatedAt: '2026-10-23T10:00:00Z', period: '24h', category: null, siteId: null,
    stats: { total: 42, monitored: 30, up: 24, degraded: 3, down: 2, unmonitored: 12, unknown: 1, criticalAlerts: 2, unacknowledged: 4, activeIncidents: 3 },
    availability: { current: 97.5, configured: true, samples: [{ at: '2026-10-23T09:00:00Z', label: '24h', value: 97.5 }, { at: '2026-10-20T09:00:00Z', label: '7d', value: 98.1 }], samplesCount: 2, lastCheckAt: '2026-10-23T09:59:00Z' },
    latency: { current: 14 },
    distribution: [{ id: 'up', label: 'Disponibles', count: 24 }, { id: 'degraded', label: 'Degradados', count: 3 }, { id: 'down', label: 'Fuera de línea', count: 2 }, { id: 'unmonitored', label: 'Sin supervisión', count: 12 }, { id: 'unknown', label: 'Sin datos', count: 1 }],
    severity: [{ id: 'critical', label: 'Crítica', count: 2 }, { id: 'warning', label: 'Alta', count: 1 }, { id: 'info', label: 'Media', count: 1 }],
    byCategory: [{ id: 'pc', label: 'Puestos', total: 20, up: 18, degraded: 1, down: 1, other: 0 }],
    bySite: [{ id: 'central', label: 'Central', total: 42, up: 24, degraded: 3, down: 2, other: 13 }],
    activeAlerts: [{ id: 'a1', title: 'Disco lleno', description: 'Disco lleno', severity: 'critical', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', state: 'open', acknowledged: false, createdAt: '2026-10-23T08:00:00Z', acknowledgedAt: null, target: { kind: 'alert', id: 'a1' } }],
    rows: [
      { assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', category: 'pc', siteId: 'central', locationId: 'l1', status: 'down', monitored: true, reason: 'Probe failed', uptimePct: 91.2, latencyMs: 14, lastCheckAt: '2026-10-23T09:59:00Z', target: { kind: 'asset', id: 'x1' } },
      { assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', category: 'server', siteId: 'central', locationId: 'l2', status: 'up', monitored: true, reason: '', uptimePct: 99.9, latencyMs: 4, lastCheckAt: '2026-10-23T09:58:00Z', target: { kind: 'asset', id: 'x2' } }
    ],
    activity: [{ id: 'e1', at: '2026-10-23T09:00:00Z', kind: 'recovery', title: 'Equipo recuperado', detail: 'Volvió a responder', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', target: { kind: 'asset', id: 'x1' } }],
    maintenance: [{ planId: 'p1', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', label: 'Limpieza', status: 'overdue', statusTone: 'down', dueAt: '2026-10-22T00:00:00Z' }],
    warranties: [{ assetId: 'x2', assetName: 'Equipo Y', assetCode: 'AM-2', until: '2026-11-01', days: 9, coverage: 'expiring' }],
    inventory: { total: 42, active: 40, unassigned: 5, attention: [{ assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', status: 'down' }] },
    incidents: [{ id: 'i1', title: 'Sin acceso', assetId: 'x1', assetName: 'Equipo X', assetCode: 'AM-1', severity: 'high', status: 'open', openedAt: '2026-10-23T07:00:00Z', target: { kind: 'incident', id: 'i1' } }],
    ...overrides
  };
}

test('canonical dashboard summary maps real aggregates, activity and drilldown targets', () => {
  const { model: M } = loadModel();
  const m = M.fromSummary(summary(), { period: '24h' });
  assert.equal(m.stats.total, 42);
  assert.equal(m.stats.down, 2);
  assert.equal(m.availability.length, 2);
  assert.equal(m.stats.availability, 97.5);
  assert.equal(m.latency[0].value, 14);
  assert.equal(m.activeAlerts[0].asset.name, 'Equipo X');
  assert.equal(m.activity[0].href, '#/activo/x1');
  assert.equal(m.maintenance[0].statusMeta.tone, 'down');
  assert.equal(m.maintenance[0].template.label, 'Limpieza');
  assert.equal(m.warranties[0].asset.name, 'Equipo Y');
  assert.equal(m.inventory.unassigned, 5);
  assert.equal(m.incidents.length, 1);
  assert.equal(m.outages.length, 1);
  assert.equal(m.rows[0].href, '#/activo/x1');
  assert.equal(m.lastCheck, '2026-10-23T09:59:00Z');
});

test('dashboard has no fabricated data without a summary and exposes unavailable widgets', () => {
  const { model: M } = loadModel();
  const empty = M.empty('24h');
  assert.equal(empty.stats.total, 0);
  assert.equal(empty.stats.monitored, 0);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.available, false);
  assert.equal(M.fromSummary(summary({ incidents: undefined })).widgetAvailable('incidents'), false);
  assert.equal(M.fromSummary(summary({ availability: { current: null, configured: false, samples: [], samplesCount: 0 } })).widgetAvailable('availability'), false);
  assert.equal(M.fromSummary(summary({ latency: { current: null } })).widgetAvailable('latency'), false);
});

test('dashboard API keeps only the latest monotonic response and clears on failure', async () => {
  const c = context();
  vm.runInContext(read('assets/js/phase10-api.js'), c);
  const pending = [];
  c.AssetAccess = { request: (_vm, url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) };
  const app = { authenticated: true, activeUserId: 'ana', currentUser: { id: 'ana' }, config: {}, dashboard: {} };
  const first = c.AssetPhase10Api.loadDashboard(app, { period: '24h' });
  const second = c.AssetPhase10Api.loadDashboard(app, { period: '7d', category: 'pc' });
  assert.equal(pending.length, 2);
  assert.match(pending[1].url, /period=7d/);
  assert.match(pending[1].url, /category=pc/);
  pending[1].resolve(summary({ period: '7d' }));
  await second;
  assert.equal(app.dashboard.summary.period, '7d');
  pending[0].resolve(summary({ period: '24h' }));
  await first;
  assert.equal(app.dashboard.summary.period, '7d', 'stale response ignored');

  const failed = c.AssetPhase10Api.loadDashboard(app, { period: '30d' });
  pending[2].reject(new Error('Servicio no disponible'));
  await failed;
  assert.equal(app.dashboard.summary, null);
  assert.equal(app.dashboard.meta.error, 'Servicio no disponible');
  assert.equal(app.dashboard.meta.loading, false);
});

test('dashboard temporary widgets stay session-only and empty layout is intentional', () => {
  const c = context();
  vm.runInContext(read('assets/js/dashboard-preferences.js'), c);
  const P = c.AssetDashboardPrefs;
  const state = P.createState();
  assert.deepEqual(P.layoutFor(state, 'ana'), P.DEFAULTS.slice());
  assert.equal(P.DEFAULTS.length, 8);
  assert.ok(P.addTemporary(state, 'ana', 'latency'));
  assert.deepEqual(P.layoutFor(state, 'ana'), P.DEFAULTS.slice(), 'temporary does not alter normal layout');
  assert.ok(P.visibleWidgets(state, 'ana').includes('latency'));
  P.clearTemporary(state, 'ana');
  state.widgets = [];
  assert.equal(P.visibleWidgets(state, 'ana').length, 0, 'empty server layout hides every widget');
  assert.equal(state.temporary.ana.length, 0);
});
