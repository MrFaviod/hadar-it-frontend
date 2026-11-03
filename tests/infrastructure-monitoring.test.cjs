'use strict';
// T7 (S9, S14-S16): the infrastructure canvas shows the operational state the
// monitoring API already publishes, joined to the loaded canvas by canonical
// assetId. Administrative inventory status stays a separate fact: a device the
// bounded monitoring page did not return keeps no availability claim at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ASSET_A = '0a000000-0000-4000-8000-00000000000a';
const ASSET_B = '0b000000-0000-4000-8000-00000000000b';
const LIST_PATH = '/monitoring/devices?limit=200&offset=0&period=24h';
const DETAIL_PATH = (id) => '/monitoring/devices/' + id + '?period=24h';

function deviceA(overrides) {
  return Object.assign({
    assetId: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores',
    site: 'Sede', siteId: 's1', monitoringEnabled: true, status: 'down', reason: 'probe_failed',
    checkType: 'icmp', target: '10.0.0.5', intervalSeconds: 60,
    lastCheckAt: '2026-09-11T10:00:00Z', latencyMs: null,
    uptime: { percent: 98.4, samples: 120 }, activeAlerts: 1, severity: 'warning'
  }, overrides || {});
}

function detailA(overrides) {
  return Object.assign({
    asset: { id: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores', site: 'Sede', siteId: 's1' },
    config: { enabled: true, checkType: 'icmp', target: '10.0.0.5', targetPresent: true, intervalSeconds: 60, metrics: [], thresholds: {} },
    status: 'up', reason: null,
    provenance: { source: 'prometheus', prometheusConfigured: true, period: { preset: '24h', from: '', to: '', stepSeconds: 300 } },
    uptime: { percent: 99.5, samples: 288 },
    latency: { averageMs: 12, p95Ms: 20, currentMs: 14 },
    series: [],
    checks: [{ checkType: 'icmp', module: '', state: 'success', lastCheckAt: '2026-09-11T10:05:00Z', latencyMs: 14 }],
    alerts: {
      active: 2, lastRecoveryAt: '2026-09-11T09:00:00Z',
      recent: [{ id: 'al-1', state: 'firing', severity: 'critical', alertName: 'Latencia alta', assetId: ASSET_A, startsAt: '2026-09-11T09:30:00Z' }]
    }
  }, overrides || {});
}

class FakeMap {
  constructor() { FakeMap.last = this; this.handlers = {}; this.zoom = 8.4; this.resizes = 0; this.removed = false; }
  on(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); }
  emit(type) { (this.handlers[type] || []).forEach((handler) => handler({ type })); }
  resize() { this.resizes += 1; }
  getZoom() { return this.zoom; }
  getCenter() { return { lat: -25.28, lng: -57.63 }; }
  easeTo() {}
  fitBounds() {}
  zoomIn() {}
  zoomOut() {}
  project(point) { return { x: Number(point[0]) / 8 + 40, y: Number(point[1]) / -8 + 90 }; }
  addSource() {}
  addLayer() {}
  setLayoutProperty() {}
  setPaintProperty() {}
  remove() { this.removed = true; }
}

function walk(node, out) {
  const list = out || [];
  if (!node) return list;
  list.push(node);
  (node.children || []).forEach((child) => walk(child, list));
  return list;
}

function classesOf(node) {
  const value = node && node.props ? node.props.class : '';
  if (Array.isArray(value)) return value.filter((token) => typeof token === 'string');
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function findByClass(root, token) {
  return walk(root).filter((node) => classesOf(node).indexOf(token) !== -1);
}

function findById(root, id) {
  return walk(root).filter((node) => node.props && node.props['data-od-id'] === id);
}

function stubBody(session) {
  const tokens = new Set();
  session.c.document.body = {
    style: {},
    classList: {
      add: (name) => tokens.add(name),
      remove: (name) => tokens.delete(name),
      toggle: (name, force) => {
        const next = force === undefined ? !tokens.has(name) : !!force;
        if (next) tokens.add(name);
        else tokens.delete(name);
        return next;
      },
      contains: (name) => tokens.has(name)
    }
  };
  return tokens;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

// Minimal server boundary: only the monitoring reads exist, and each one is
// scripted so a test can hold it open, fail it or replay a late answer.
function telemetry(session, script) {
  const calls = [];
  const plan = script || {};
  session.c.fetch = async (url, init = {}) => {
    const target = String(url).replace(/^\/api\/v1/, '');
    calls.push({ url: target, method: init.method || 'GET' });
    const entry = Object.keys(plan)
      .filter((pattern) => target.startsWith(pattern))
      .map((pattern) => plan[pattern])
      .pop();
    const step = typeof entry === 'function' ? entry({ url: target, call: calls.length, calls }) : entry;
    if (!step) return { ok: false, status: 404, json: async () => ({ error: { code: 'not_found' } }) };
    if (step.pending) {
      const answer = await step.pending.shift().promise;
      const status = answer.status || (answer.fail ? 500 : 200);
      return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(answer.body)) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(step)) };
  };
  return calls;
}

function seedGraph(session) {
  session.app.organization.graph.nodes = [
    { id: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores', status: 'in_use', siteId: 's1' },
    { id: ASSET_B, quickCode: 'SW-B', name: 'Switch B', category: 'switches', status: 'in_use', siteId: 's1' }
  ];
  session.app.organization.graph.edges = [];
}

function seedMap(session) {
  session.app.organization.map.assets = [
    { id: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores', status: 'in_use', siteId: 's1' }
  ];
  session.app.organization.map.positions = [];
}

async function mountGraph() {
  const session = setup();
  stubBody(session);
  session.app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: '' };
  seedGraph(session);
  const mounted = session.mount('GraphExplorer', { app: session.app, focusId: '' });
  await session.tick();
  await session.tick();
  // The component boots one bounded read on mount; let it settle so a test
  // starts from a quiet canvas instead of racing the no-overlap guard.
  await session.settle();
  return { session, graph: mounted.instance, mounted };
}

async function mountMap() {
  const session = setup();
  stubBody(session);
  session.c.window.maplibregl = { Map: FakeMap };
  session.app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  seedMap(session);
  const mounted = session.mount('MapExplorer', { app: session.app, focusId: '' });
  await session.tick();
  await session.tick();
  const map = mounted.instance;
  await session.settle();
  if (map.$refs && map.$refs.mapCanvas) {
    // MapLibre is only initialised in a real container; the fake keeps the
    // camera assertions available for the expansion test.
    FakeMap.last = FakeMap.last || new FakeMap();
  }
  return { session, map, fake: FakeMap.last || null, mounted };
}

test('the canvas join reads one bounded monitoring page and matches canonical asset ids', async () => {
  const { session, graph } = await mountGraph();
  const calls = telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 40, limit: 200, offset: 0, period: '24h' } });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B] });
  await session.settle();

  assert.equal(calls.filter((call) => call.url === LIST_PATH).length, 1, 'one bounded page, not one request per asset');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down');
  assert.equal(graph.infraMonitorRow(ASSET_A).uptimePct, 98.4);
  assert.equal(graph.infraMonitorRow(ASSET_A).activeAlerts, 1);
  assert.equal(graph.infraMonitoring.list.total, 40, 'the server total is disclosed, not implied coverage');
  assert.equal(graph.infraMonitoring.list.examined, 1);
});

test('an asset outside the loaded monitoring page keeps no availability claim', async () => {
  const { session, graph } = await mountGraph();
  telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 40, limit: 200, offset: 0, period: '24h' } });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B] });
  await session.settle();

  assert.equal(graph.infraMonitorRow(ASSET_B), null);
  assert.equal(graph.infraMonitorStatus(ASSET_B), null, 'no badge is invented for an unloaded id');
  const panel = graph.infraMonitorPanel(ASSET_B);
  assert.equal(panel.known, false);
  assert.notEqual(panel.status, 'unmonitored', 'a missing page is not the same as unmonitored');
  assert.notEqual(panel.status, 'up');
  assert.match(panel.note, /1 de 40/, 'the panel discloses the bounded page: ' + panel.note);
});

test('unmonitored and status-less devices stay honest instead of reading as up', async () => {
  const { session, graph } = await mountGraph();
  telemetry(session, {
    '/monitoring/devices?': {
      items: [
        deviceA({ status: 'unmonitored', monitoringEnabled: false, activeAlerts: 0, uptime: { percent: null, samples: 0 }, lastCheckAt: '' }),
        deviceA({ assetId: ASSET_B, status: null, uptime: null, lastCheckAt: null, activeAlerts: null })
      ],
      total: 2, limit: 200, offset: 0, period: '24h'
    }
  });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B] });
  await session.settle();

  const unmonitored = graph.infraMonitorPanel(ASSET_A);
  assert.equal(unmonitored.status, 'unmonitored');
  assert.equal(unmonitored.values.length, 0, 'an unmonitored device shows no uptime or latency');
  assert.equal(graph.infraMonitorStatus(ASSET_A), null, 'unmonitored is not an alert tone');

  const unknown = graph.infraMonitorPanel(ASSET_B);
  assert.equal(unknown.status, 'no_data');
  assert.equal(unknown.known, true, 'the row exists, its measurement does not');
  assert.equal(unknown.values.length, 0);
});

test('a failed refresh reports the error and keeps the last observed state', async () => {
  const { session, graph } = await mountGraph();
  const failure = deferred();
  const calls = telemetry(session, {
    '/monitoring/devices?': () => (calls.filter((call) => call.url === LIST_PATH).length === 1
      ? { items: [deviceA()], total: 2, limit: 200, offset: 0, period: '24h' }
      : { pending: [failure] })
  });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  const second = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  failure.resolve({ fail: true, body: { error: { code: 'internal' } } });
  await second;
  await session.settle();

  assert.equal(calls.filter((call) => call.url === LIST_PATH).length, 2);
  assert.equal(graph.infraMonitoring.list.error.length > 0, true, 'the failure is not silent');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down', 'the last observation survives the failure');
  assert.match(graph.infraMonitorPanel(ASSET_A).note, /Actualizado/);
});

test('the selected asset detail carries uptime, alerts and its last check', async () => {
  const { session, graph } = await mountGraph();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    ['/monitoring/devices/' + ASSET_A]: detailA()
  });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();

  assert.equal(calls.filter((call) => call.url === DETAIL_PATH(ASSET_A)).length, 1);
  const panel = graph.infraMonitorPanel(ASSET_A);
  assert.equal(panel.status, 'up');
  assert.equal(panel.statusLabel, 'Disponible');
  assert.equal(panel.alerts, 2);
  assert.equal(panel.uptime, 99.5);
  assert.equal(panel.values.map((fact) => fact.key).join(','), 'uptime,lastCheck,alerts,latency');
  assert.ok(panel.values.find((fact) => fact.key === 'lastCheck').value.length > 0);
  assert.equal(panel.detailLoaded, true);
  assert.match(panel.note, /Supervisión de 1 de 1/);
});

test('the refresh never overlaps an in-flight read', async () => {
  const { session, graph } = await mountGraph();
  const first = deferred();
  const body = { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' };
  const calls = telemetry(session, {
    '/monitoring/devices?': ({ call }) => (call === 1 ? { pending: [first] } : { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' })
  });

  const run = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  const skipped = await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(calls.filter((call) => call.url === LIST_PATH).length, 1,
    'the second request never opens a parallel read');
  first.resolve({ body });
  await run;
  await session.settle();

  assert.equal(skipped, false, 'a concurrent refresh is refused as an immediate read');
  assert.equal(calls.filter((call) => call.url === LIST_PATH).length, 2,
    'the refused request runs once the open read settles');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down');
});

test('disposing or losing the session cancels the read and ignores the late answer', async () => {
  const { session, graph, mounted } = await mountGraph();
  const late = deferred();
  telemetry(session, { '/monitoring/devices?': { pending: [late] } });

  const run = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(graph.infraMonitoring.list.loading, true);
  graph.infraMonitorDispose();
  late.resolve({ body: { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' } });
  await run;
  await session.settle();
  assert.equal(graph.infraMonitoring.list.loading, false);
  assert.equal(graph.infraMonitorRow(ASSET_A), null, 'a late answer cannot revive monitoring after a cancel');

  const calls = telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' } });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down');
  session.app.authenticated = false;
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A), null, 'logout clears the join');
  const before = calls.length;
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  assert.equal(calls.length, before, 'no read survives the session');
  mounted.unmount();
  assert.equal(graph.infraMonitoring.timer, 0, 'nothing reschedules after unmount');
});

test('the canvas does not read monitoring without the assets.view guard', async () => {
  const session = setup();
  stubBody(session);
  session.app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: '' };
  session.app.can = () => false;
  const mounted = session.mount('GraphExplorer', { app: session.app, focusId: '' });
  await session.tick();
  const calls = telemetry(session, { '/monitoring/devices': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' } });

  const applied = await mounted.instance.infraMonitorRefresh({ assetIds: [ASSET_A] });
  assert.equal(applied, false);
  assert.equal(calls.length, 0, 'the existing permission boundary is not bypassed');
  assert.equal(mounted.instance.infraMonitorPanel(ASSET_A).available, false);
});

test('the graph node marker only marks actionable device states', async () => {
  const { session, graph, mounted } = await mountGraph();
  telemetry(session, {
    '/monitoring/devices?': {
      items: [deviceA(), deviceA({ assetId: ASSET_B, status: 'up', activeAlerts: 0, uptime: { percent: 99.9, samples: 300 } })],
      total: 2, limit: 200, offset: 0, period: '24h'
    }
  });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B] });
  await session.settle();

  assert.equal(graph.infraMonitorStatus(ASSET_B), null, 'a healthy device adds no badge');
  const node = graph.nodeViews.find((view) => view.id === ASSET_A);
  assert.equal(node.monitoring.tone, 'down');
  await session.tick();
  assert.equal(findByClass(mounted.root, 'gnode__state').length, 1, 'exactly the actionable node carries a marker');
});

test('the map inspector renders the monitoring panel with a manual refresh', async () => {
  const { session, map, mounted } = await mountMap();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    ['/monitoring/devices/' + ASSET_A]: detailA()
  });
  await map.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  map.selectedId = ASSET_A;
  await session.tick();
  await session.settle();

  assert.equal(findByClass(mounted.root, 'infra-monitor').length, 1, 'the inspector owns one concise operational block');
  const refresh = findById(mounted.root, 'map-monitor-refresh');
  assert.equal(refresh.length, 1, 'the manual refresh is reachable');
  assert.equal(refresh[0].props.disabled, false);
  const before = calls.length;
  refresh[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
  await session.settle();
  assert.ok(calls.length > before, 'the button reads the server again');
  assert.equal(findByClass(mounted.root, 'infra-monitor__error').length, 0);
  assert.equal(map.infraMonitorConstants.REFRESH_MS, 60000, 'automatic refresh stays at one minute or slower');
});

test('expansion keeps the selection, camera and filters with monitoring loaded', async () => {
  const { session, map, fake } = await mountMap();
  telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' } });
  await map.infraMonitorRefresh({ assetIds: [ASSET_A] });
  map.selectedId = ASSET_A;
  map.filters.categories = ['servidores'];
  const zoom = fake ? fake.getZoom() : null;
  map.toggleExpand();
  await session.tick();
  assert.equal(map.expanded, true);
  assert.equal(map.selectedId, ASSET_A);
  assert.deepEqual(map.filters.categories, ['servidores']);
  assert.equal(map.infraMonitorRow(ASSET_A).status, 'down');
  if (fake) assert.equal(fake.getZoom(), zoom);
});


test('a cold map deep link reads its device when the inventory and session land late', async () => {
  const session = setup();
  stubBody(session);
  session.c.window.maplibregl = { Map: FakeMap };
  session.app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: ASSET_A };
  session.app.organization.map.assets = [];
  session.app.organization.map.positions = [];
  session.app.authenticated = false;
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_A)]: detailA()
  });

  const mounted = session.mount('MapExplorer', { app: session.app, focusId: ASSET_A });
  await session.tick();
  await session.tick();
  await session.settle();

  // The route resolved before the inventory or the session existed.
  assert.equal(calls.length, 0, 'nothing is read before the session exists');

  seedMap(session);
  session.app.authenticated = true;
  session.app.activeUserId = 'domain-fixture';
  await session.settle();
  await session.settle();

  const map = mounted.instance;
  assert.equal(map.selectedId, ASSET_A, 'the deep link resolves once the asset is known');
  const details = calls.filter((call) => call.url.startsWith(DETAIL_PATH(ASSET_A)));
  assert.equal(details.length > 0, true, 'the resolved selection reads its own device');
  assert.equal(map.infraMonitorPanel(ASSET_A).detailLoaded, true, 'the block paints the device reading');
});

test('replacing the inventory keeps the asset the person selected', async () => {
  const session = setup();
  stubBody(session);
  session.c.window.maplibregl = { Map: FakeMap };
  session.app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: ASSET_A };
  const assetA = { id: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores', status: 'in_use', siteId: 's1' };
  const assetB = { id: ASSET_B, quickCode: 'SW-B', name: 'Switch B', category: 'switches', status: 'in_use', siteId: 's1' };
  session.app.organization.map.assets = [assetA, assetB];
  session.app.organization.map.positions = [];
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_A)]: detailA(),
    [DETAIL_PATH(ASSET_B)]: detailA({ assetId: ASSET_B, uptime: { percent: 99, samples: 12 } })
  });
  const mounted = session.mount('MapExplorer', { app: session.app, focusId: ASSET_A });
  await session.tick();
  await session.tick();
  await session.settle();
  const map = mounted.instance;
  assert.equal(map.selectedId, ASSET_A, 'the deep link opens its asset');

  map.selectAsset(ASSET_B);
  await session.settle();
  assert.equal(map.selectedId, ASSET_B, 'the click selects the other asset');

  // A canonical inventory refresh replaces the asset objects, same identity.
  session.app.organization.map.assets = [Object.assign({}, assetA), Object.assign({}, assetB)];
  await session.settle();
  await session.settle();
  assert.equal(map.selectedId, ASSET_B, 'a replaced inventory does not take the choice back');
});

test('a failed device read keeps the reading and reports the failure', async () => {
  const { session, graph } = await mountGraph();
  const failing = deferred();
  let detailCalls = 0;
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_A)]: () => {
      detailCalls += 1;
      return detailCalls === 1 ? detailA() : { pending: [failing] };
    }
  });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  const good = graph.infraMonitorPanel(ASSET_A);
  assert.equal(good.uptime, 99.5, 'the device uptime is shown, not the page row');
  assert.equal(good.error, '', 'a successful read reports nothing');

  const refresh = graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  failing.resolve({ fail: true, body: { error: { code: 'internal' } } });
  await refresh;
  await session.settle();

  const pane = graph.infraMonitorPanel(ASSET_A);
  assert.equal(pane.uptime, 99.5, 'the last good reading stays visible after a failed device read');
  assert.equal(pane.error !== '', true, 'the failed device read is reported next to the reading');
});

test('the map inspector reports a failed device read next to the reading', async () => {
  const { session, map } = await mountMap();
  const failing = deferred();
  let detailCalls = 0;
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_A)]: () => {
      detailCalls += 1;
      return detailCalls === 1 ? detailA() : { pending: [failing] };
    }
  });
  map.selectAsset(ASSET_A);
  await session.settle();
  assert.equal(map.infraMonitorPane.uptime, 99.5, 'the device reading paints the block');

  const refresh = map.refreshSelectedMonitoring();
  await session.settle();
  failing.resolve({ fail: true, body: { error: { code: 'internal' } } });
  await refresh;
  await session.settle();

  assert.equal(map.infraMonitorPane.uptime, 99.5, 'the reading survives the failure');
  assert.equal(map.infraMonitorPane.error !== '', true, 'the map reports the failed read');
});

test('a read queued while a selection read is open runs once when it settles', async () => {
  const { session, graph } = await mountGraph();
  const held = deferred();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_A)]: { pending: [held] }
  });
  const listReads = () => calls.filter((call) => call.url.startsWith('/monitoring/devices?')).length;

  const selection = graph.infraMonitorSelect(ASSET_A);
  await session.settle();
  graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  const during = listReads();

  held.resolve({ body: detailA() });
  await selection;
  await session.settle();
  await session.settle();

  assert.equal(listReads(), during + 1, 'the queued read runs exactly once, after the held read settled '
    + '(during=' + during + ' after=' + listReads() + ')');
});

test('a cancelled response cannot populate a restarted monitoring generation', async () => {
  const { session, graph } = await mountGraph();
  const old = deferred();
  telemetry(session, { '/monitoring/devices?': { pending: [old] } });
  const obsolete = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  graph.infraMonitorDispose();
  telemetry(session, { '/monitoring/devices?': { items: [deviceA({ status: 'up' })], total: 1 } });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  old.resolve({ body: { items: [deviceA({ status: 'down' })], total: 1 } });
  await obsolete;
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'up', 'old generation must not overwrite the restarted observation');
});


test('switching to a missing device never reuses the previous selected detail', async () => {
  const { session, graph } = await mountGraph();
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1 },
    ['/monitoring/devices/' + ASSET_A]: detailA()
  });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  assert.equal(graph.infraMonitorPanel(ASSET_A).detailLoaded, true);
  await graph.infraMonitorSelect(ASSET_B);
  const panel = graph.infraMonitorPanel(ASSET_B);
  assert.equal(panel.known, false, 'a 404 must not relabel the previous device as the new selection');
  assert.equal(panel.detailLoaded, false);
  assert.equal(panel.values.length, 0);
});


test('replacing the signed-in identity clears the join and reads it again', async () => {
  const { session, graph } = await mountGraph();
  const calls = telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1 } });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down');
  const reads = calls.filter((call) => call.url === LIST_PATH).length;

  // A different signed-in person replaces the previous one without a logout:
  // the previous person's observations must not survive that replacement.
  session.app.activeUserId = 'second-fixture';
  await session.settle();
  await session.settle();

  assert.equal(calls.filter((call) => call.url === LIST_PATH).length, reads + 1, 'the replacement starts its own bounded read');
  assert.equal(graph.infraMonitoring.identity, 'second-fixture', 'the join follows the current identity');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down', 'the replacement read is the one on screen');
});

test('a restarted generation never reuses an epoch still on the wire', async () => {
  const { session, graph } = await mountGraph();
  const stale = deferred();
  telemetry(session, { '/monitoring/devices?': { pending: [stale] } });
  const discarded = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  const discardedEpoch = graph.infraMonitoring.epoch;
  assert.ok(discardedEpoch > 0);

  graph.infraMonitorDispose();
  telemetry(session, { '/monitoring/devices?': { items: [deviceA({ status: 'up', activeAlerts: 0 })], total: 1 } });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'up');
  while (graph.infraMonitoring.epoch < discardedEpoch) {
    await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
    await session.settle();
  }

  stale.resolve({ body: { items: [deviceA({ status: 'down' })], total: 1 } });
  await discarded;
  await session.settle();

  assert.ok(graph.infraMonitoring.epoch > discardedEpoch, 'a new generation starts above the discarded one');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'up', 'a discarded read cannot repaint the restarted generation');
});

test('a superseded detail answer cannot repaint the same selection', async () => {
  const { session, graph } = await mountGraph();
  const firstA = deferred();
  const secondA = deferred();
  const heldB = deferred();
  let aCalls = 0;
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA(), deviceA({ assetId: ASSET_B, status: 'up' })], total: 2 },
    ['/monitoring/devices/' + ASSET_A]: () => ({ pending: [aCalls++ === 0 ? firstA : secondA] }),
    ['/monitoring/devices/' + ASSET_B]: { pending: [heldB] }
  });

  graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B], selectedId: ASSET_A });
  await session.settle();
  graph.infraMonitorSelect(ASSET_B);
  await session.settle();
  graph.infraMonitorSelect(ASSET_A);
  await session.settle();

  secondA.resolve({ body: detailA({ status: 'up' }) });
  await session.settle();
  assert.equal(graph.infraMonitorPanel(ASSET_A).status, 'up', 'the newest answer is the one shown');

  firstA.resolve({ body: detailA({ status: 'down', alerts: { active: 0, recent: [] } }) });
  await session.settle();
  assert.equal(graph.infraMonitorPanel(ASSET_A).status, 'up', 'a superseded answer for the same asset must not repaint it');
});

test('hiding the tab pauses the join and discards reads already in flight', async () => {
  const { session, graph } = await mountGraph();
  const held = deferred();
  telemetry(session, { '/monitoring/devices?': { pending: [held] } });
  const run = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  assert.equal(graph.infraMonitoring.list.loading, true);

  session.c.document.hidden = true;
  graph.infraMonitorVisibility();
  assert.equal(graph.infraMonitoring.list.loading, false, 'no read stays pending while the tab is hidden');
  assert.equal(graph.infraMonitoring.timer, 0, 'the automatic refresh stops while the tab is hidden');

  held.resolve({ body: { items: [deviceA()], total: 1 } });
  await run;
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A), null, 'an answer that lands while hidden is not painted');

  telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1 } });
  session.c.document.hidden = false;
  graph.infraMonitorVisibility();
  await session.settle();
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down', 'becoming visible reads the current state again');
  assert.ok(graph.infraMonitoring.timer, 'the automatic refresh resumes when the tab is visible again');
});

test('a session restored after mount still starts the join', async () => {
  const session = setup();
  stubBody(session);
  session.app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: '' };
  seedGraph(session);
  session.app.authenticated = false;
  session.app.activeUserId = null;
  const mounted = session.mount('GraphExplorer', { app: session.app, focusId: '' });
  await session.tick();
  const calls = telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1 } });
  assert.equal(calls.length, 0, 'nothing is read before the session exists');

  session.app.activeUserId = 'domain-fixture';
  session.app.authenticated = true;
  await session.settle();
  await session.settle();

  assert.ok(calls.filter((call) => call.url === LIST_PATH).length >= 1, 'the restored session starts the bounded read');
  assert.equal(mounted.instance.infraMonitorRow(ASSET_A).status, 'down');
});

test('measured availability is announced on the canvas, not only painted', async () => {
  const { session, graph, mounted } = await mountGraph();
  telemetry(session, { '/monitoring/devices?': { items: [deviceA()], total: 1 } });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  await session.settle();
  await session.tick();

  const node = findByClass(mounted.root, 'gnode')
    .find((element) => /Servidor A/.test(String(element.props && element.props['aria-label'])));
  assert.ok(node, 'the actionable node is rendered');
  const state = graph.infraMonitorRow(ASSET_A).statusLabel;
  assert.ok(String(node.props['aria-label']).endsWith('Supervisión: ' + state), 'the node name carries the measured state: ' + node.props['aria-label']);
});

test('a failed page read leaves no pending detail flag and can be retried', async () => {
  const { session, graph } = await mountGraph();
  const failing = deferred();
  failing.resolve({ fail: true, body: { error: { code: 'internal' } } });
  const calls = telemetry(session, {
    '/monitoring/devices?': ({ call }) => (call === 1
      ? { pending: [failing] }
      : { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' })
  });

  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();

  assert.equal(graph.infraMonitoring.list.loading, false, 'the page read finished');
  assert.equal(graph.infraMonitoring.list.error.length > 0, true, 'the failure is reported');
  assert.equal(graph.infraMonitoring.detail.loading, false,
    'a device that was never read must not stay marked as loading');

  const before = calls.length;
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  assert.equal(calls.length > before, true, 'the failed read can be retried instead of locking the control');
  assert.equal(graph.infraMonitoring.list.error, '', 'the retry clears the reported failure');
  assert.equal(graph.infraMonitorRow(ASSET_A).status, 'down');
});

test('a language change relabels the measured state without another read', async () => {
  const { session, graph } = await mountGraph();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' }
  });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  const monitorReads = () => calls.filter((call) => call.url.startsWith('/monitoring/')).length;
  const reads = monitorReads();

  assert.equal(graph.infraMonitorPanel(ASSET_A).statusLabel, 'No disponible', 'the Spanish label comes from the catalog');
  session.c.ItsmI18n.setLocale('en');
  await session.tick();

  assert.equal(graph.infraMonitorPanel(ASSET_A).statusLabel, 'Unavailable',
    'the reading itself is language neutral; only its label changes');
  assert.equal(graph.infraMonitorStatus(ASSET_A).label, 'Unavailable', 'the canvas announcement is translated too');
  assert.equal(monitorReads(), reads, 'relabelling never re-reads the transport');
});

test('a selection made during the page read is read when that read lands', async () => {
  const { session, graph } = await mountGraph();
  const held = deferred();
  const calls = telemetry(session, {
    '/monitoring/devices?': ({ call }) => (call === 1
      ? { pending: [held] }
      : { items: [deviceA(), deviceA({ assetId: ASSET_B, quickCode: 'SW-B', name: 'Switch B', status: 'up', activeAlerts: 0 })], total: 2, limit: 200, offset: 0, period: '24h' })
  });

  const inflight = graph.infraMonitorRefresh({ assetIds: [ASSET_A, ASSET_B] });
  // The canvas can move the selection while the page read is still open: the
  // click handler, a deep link or a restored route all land here.
  graph.infraMonitoring.selectedId = ASSET_B;
  await session.settle();
  held.resolve({ body: { items: [deviceA(), deviceA({ assetId: ASSET_B, quickCode: 'SW-B', name: 'Switch B', status: 'up', activeAlerts: 0 })], total: 2, limit: 200, offset: 0, period: '24h' } });
  await inflight;
  await session.settle();

  const detail = calls.filter((call) => call.url.startsWith('/monitoring/devices/' + ASSET_B));
  assert.equal(detail.length > 0, true, 'the reading that landed still fetches the new selection');
});

test('the page read registers the selection the view was opened with', async () => {
  const { session, graph } = await mountGraph();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' }
  });

  // A deep link initialises the component selection before any click exists.
  graph.selectedId = ASSET_A;
  graph.infraMonitorSync();
  await session.settle();

  const detail = calls.filter((call) => call.url.startsWith('/monitoring/devices/' + ASSET_A));
  assert.equal(detail.length > 0, true, 'the opening selection reads its device');
  assert.equal(graph.infraMonitorRow(ASSET_A) !== null, true, 'the page read still lands');
});

test('a read requested while another is in flight runs when it settles', async () => {
  const { session, graph } = await mountGraph();
  const held = deferred();
  const calls = telemetry(session, {
    '/monitoring/devices?': ({ call }) => (call === 1
      ? { pending: [held] }
      : { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' })
  });

  const first = graph.infraMonitorRefresh({ assetIds: [ASSET_A] });
  // A deep link or an identity change lands while the page read is open.
  graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  held.resolve({ body: { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' } });
  await first;
  await session.settle();

  assert.equal(calls.filter((call) => call.url.startsWith('/monitoring/devices?')).length, 2,
    'the queued read is not dropped');
  assert.equal(calls.filter((call) => call.url.startsWith('/monitoring/devices/' + ASSET_A)).length > 0, true,
    'the queued read still fetches the selection');
});

test('a selection that resolves before the session is read once the session is ready', async () => {
  const { session, graph } = await mountGraph();
  session.app.authenticated = false;
  graph.infraMonitorDispose();
  const calls = telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' }
  });

  // A deep link restores in front of the identity envelope.
  graph.infraMonitorSelect(ASSET_A);
  session.app.authenticated = true;
  graph.infraMonitorBoot();
  await session.settle();

  const detail = calls.filter((call) => call.url.startsWith('/monitoring/devices/' + ASSET_A));
  assert.equal(detail.length > 0, true, 'the remembered selection is read when the session arrives');
  assert.equal(graph.infraMonitorRow(ASSET_A) !== null, true, 'the page read still lands');
});

test('an unresolved route focus never overrides the asset the person picked', async () => {
  const session = setup();
  stubBody(session);
  session.c.window.maplibregl = { Map: FakeMap };
  const assetA = { id: ASSET_A, quickCode: 'SRV-A', name: 'Servidor A', category: 'servidores', status: 'in_use', siteId: 's1' };
  const assetB = { id: ASSET_B, quickCode: 'SW-B', name: 'Switch B', category: 'switches', status: 'in_use', siteId: 's1' };
  session.app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: ASSET_A };
  // The route names A, but only B is in the inventory yet: the focus stays
  // unresolved, exactly as on a cold deep link.
  session.app.organization.map.assets = [assetB];
  session.app.organization.map.positions = [];
  telemetry(session, {
    '/monitoring/devices?': { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' },
    [DETAIL_PATH(ASSET_B)]: detailA({ assetId: ASSET_B, uptime: { percent: 99, samples: 12 } })
  });
  const mounted = session.mount('MapExplorer', { app: session.app, focusId: ASSET_A });
  await session.tick();
  await session.tick();
  await session.settle();
  const map = mounted.instance;
  assert.equal(map.focusPending, ASSET_A, 'the route focus is still waiting for its asset');
  map.selectAsset(ASSET_B);
  await session.settle();
  assert.equal(map.selectedId, ASSET_B, 'the person opened B');
  // The inventory lands with fresh objects for both assets.
  session.app.organization.map.assets = [{ ...assetA }, { ...assetB }];
  await session.settle();
  await session.settle();
  assert.equal(map.selectedId, ASSET_B,
    'an inventory that finally contains the route asset must not reopen it over the person');
});

test('a device that disappears falls back to its list row, not the last reading', async () => {
  const { session, graph } = await mountGraph();
  const gone = deferred();
  let detailCalls = 0;
  const unmonitoredRow = {
    assetId: ASSET_A,
    quickCode: 'SRV-A',
    name: 'Servidor A',
    category: 'servidores',
    site: 'Sede 1',
    siteId: 's1',
    monitoringEnabled: false,
    status: 'unmonitored',
    reason: 'not_configured',
    checkType: null,
    target: null,
    intervalSeconds: null,
    lastCheckAt: null,
    latencyMs: null,
    uptime: { percent: null, samples: 0 },
    activeAlerts: 0,
    severity: null
  };
  telemetry(session, {
    '/monitoring/devices?': ({ call }) => (call === 1
      ? { items: [deviceA()], total: 1, limit: 200, offset: 0, period: '24h' }
      : { items: [unmonitoredRow], total: 1, limit: 200, offset: 0, period: '24h' }),
    [DETAIL_PATH(ASSET_A)]: () => {
      detailCalls += 1;
      return detailCalls === 1 ? detailA() : { pending: [gone] };
    }
  });
  await graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  assert.equal(graph.infraMonitorPanel(ASSET_A).detailLoaded, true, 'the device answered first');
  const refresh = graph.infraMonitorRefresh({ assetIds: [ASSET_A], selectedId: ASSET_A });
  await session.settle();
  gone.resolve({ status: 404, body: { error: { code: 'not_found' } } });
  await refresh;
  await session.settle();
  const pane = graph.infraMonitorPanel(ASSET_A);
  assert.equal(pane.detailLoaded, false, 'the vanished device reading must not stay cached');
  assert.equal(pane.status, 'unmonitored', 'the panel falls back to what the page still reports');
  assert.equal(pane.uptime, null, 'no stale uptime is painted for a device that no longer answers');
  assert.equal(pane.error, '', 'a missing device is not a read failure');
});
