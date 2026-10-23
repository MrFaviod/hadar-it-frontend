'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const DEVICE = {
  assetId: '5a1e0c10-0001-4f10-9a10-000000000001',
  quickCode: 'SRV-01', name: 'Servidor de fichajes', category: 'servers', site: 'Sede', siteId: 'site-1',
  monitoringEnabled: true, status: 'up', reason: null, checkType: 'icmp', target: '10.0.0.10',
  intervalSeconds: 60, lastCheckAt: '2026-10-23T10:00:00Z', latencyMs: 12.5, activeAlerts: 1,
  severity: 'warning', uptime: { percent: 99.5, samples: 120 }
};
const STATUSES = ['unmonitored', 'unavailable', 'no_data', 'up', 'degraded', 'down'];

function device(status, index, extra) {
  return Object.assign({}, DEVICE, {
    assetId: DEVICE.assetId.slice(0, -1) + index,
    quickCode: 'DEV-0' + index,
    name: 'Equipo ' + index,
    status,
    reason: status === 'unavailable' ? 'prometheus_unavailable' : (status === 'unmonitored' ? 'target_missing' : null),
    uptime: status === 'up' || status === 'degraded' ? { percent: 99.5, samples: 120 } : null,
    latencyMs: status === 'no_data' ? null : 10 + index
  }, extra || {});
}

const ALERT = {
  id: 'alert-1', fingerprint: 'fp-1', alertName: 'ProbeFailed', severity: 'critical',
  assetId: DEVICE.assetId, assetName: DEVICE.name, quickCode: DEVICE.quickCode,
  state: 'firing', silenced: false, acknowledged: false, acknowledgedAt: null, acknowledgedBy: null,
  notes: '', startsAt: '2026-10-23T09:00:00Z', endsAt: null, lastSeenAt: '2026-10-23T10:00:00Z',
  source: 'prometheus', groupKey: '{}', summary: 'No responde a ICMP', description: '',
  incident: { id: 'inc-1', status: 'open', suggestedClose: false }, maintenanceWindow: null,
  labels: { alertname: 'ProbeFailed' }, annotations: {}
};
const ALERT_DETAIL = Object.assign({}, ALERT, {
  events: [
    { id: 'ev-1', action: 'opened', fromState: null, toState: 'firing', note: '', actor: 'prometheus', source: 'prometheus', createdAt: '2026-10-23T09:00:00Z' }
  ],
  silences: []
});
const DETAIL = {
  asset: { id: DEVICE.assetId, name: DEVICE.name, quickCode: DEVICE.quickCode, category: 'servers', site: 'Sede', siteId: 'site-1' },
  config: {
    enabled: true, checkType: 'http', target: 'https://fichajes.example/health', targetPresent: true,
    intervalSeconds: 60, metrics: ['latency', 'cpu'], thresholds: { latency: { warning: 1, critical: 3 } },
    minimumDurationSeconds: 300, exporterId: 'exporter-1', snmpModule: null, snmpAuthRef: null,
    profileCategory: 'servers', overridden: ['target', 'intervalSeconds']
  },
  status: 'degraded', reason: null,
  provenance: { source: 'prometheus', prometheusConfigured: true, period: { preset: '7d', from: '2026-10-16T00:00:00Z', to: '2026-10-23T00:00:00Z', stepSeconds: 300 } },
  uptime: { percent: 99.5, samples: 120 },
  latency: { averageMs: 20, p95Ms: 30, currentMs: 22 },
  series: [
    { metric: 'latency', unit: 'seconds', points: [{ at: '2026-10-16T00:00:00Z', value: 0.02 }, { at: '2026-10-16T00:05:00Z', value: 0.03 }], pointCount: 2 },
    { metric: 'cpu', unit: 'percent', points: [], pointCount: 0 }
  ],
  checks: [{ checkType: 'http', module: 'http_2xx', state: 'up', lastCheckAt: '2026-10-23T10:00:00Z', latencyMs: 12 }],
  alerts: { active: 1, lastRecoveryAt: null, recent: [ALERT] }
};

function listResponse(items, extra) {
  return Object.assign({ items, total: items.length, limit: 100, offset: 0 }, extra || {});
}

function server(app, c, overrides) {
  const calls = [];
  c.AssetAccess.request = async (vm, path, options) => {
    calls.push({ path, options: options || {} });
    const method = (options && options.method) || 'GET';
    const custom = overrides && overrides(path, method, options);
    if (custom !== undefined) return custom;
    if (method === 'GET' && path.startsWith('/monitoring/devices/')) return DETAIL;
    if (method === 'GET' && path.startsWith('/monitoring/devices')) return listResponse(STATUSES.map((status, index) => device(status, index + 1)));
    if (method === 'GET' && path.startsWith('/monitoring/alerts/') && path.includes('/history')) return listResponse([ALERT_DETAIL.events[0]]);
    if (method === 'GET' && path.startsWith('/monitoring/alerts/')) return ALERT_DETAIL;
    if (method === 'GET' && path.startsWith('/monitoring/alerts')) return listResponse([ALERT]);
    if (method === 'GET' && path === '/monitoring/config') {
      return {
        prometheus: { configured: true }, alertmanager: { configured: false },
        presets: {
          periods: ['24h', '7d', '30d'], intervals: [30, 60, 300], minimumDurations: [0, 60, 300, 900],
          metrics: [{ id: 'latency', label: 'Latencia', unit: 'seconds' }],
          checkTypes: [{ id: 'icmp', label: 'ICMP' }, { id: 'http', label: 'HTTP' }]
        },
        profiles: [{ category: 'servers', enabled: true, checkType: 'icmp', intervalSeconds: 60, metrics: ['latency'], thresholds: {}, minimumDurationSeconds: 300 }],
        exporters: [{ id: 'exporter-1', name: 'SNMP sede', kind: 'snmp', module: 'if_mib', enabled: true }],
        windows: [], sources: [{ id: 'prometheus', configured: true, label: 'Prometheus' }]
      };
    }
    if (method === 'GET' && path === '/monitoring/windows') return listResponse([]);
    if (method === 'GET' && path.startsWith('/notifications/inbox')) return listResponse([{
      id: 'n-1', alertId: 'alert-1', eventKey: 'alert-1:firing:default-operations:u1:internal', eventType: 'firing',
      severity: 'critical', assetId: DEVICE.assetId, title: 'ProbeFailed', body: 'No responde',
      url: 'http://localhost:18080/#/supervision/alerta/alert-1', createdAt: '2026-10-23T09:00:00Z', readAt: null, unread: true
    }]);
    if (path === '/notifications/inbox/n-1/read' && method === 'POST') {
      return { id: 'n-1', alertId: 'alert-1', eventKey: 'k', eventType: 'firing', severity: 'critical', assetId: DEVICE.assetId, title: 'ProbeFailed', body: 'No responde', url: '', createdAt: '2026-10-23T09:00:00Z', readAt: '2026-10-23T10:05:00Z', unread: false };
    }
    if (method === 'GET' && path === '/notifications/config') {
      return {
        channels: [
          { id: 'internal-default', kind: 'internal', name: 'Avisos internos', enabled: true, secretRef: null, configured: true, config: {}, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
          { id: 'smtp-ops', kind: 'smtp', name: 'Correo operaciones', enabled: true, secretRef: 'monitoring_smtp_ops', configured: true, config: { subjectPrefix: '[ITMS]' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
        ],
        rules: [{
          id: 'default-operations', name: 'Operaciones', enabled: true, minimumSeverity: 'warning', recipientIds: [], channelIds: ['internal-default'],
          escalationRecipientIds: [], schedule: null, acknowledgeAfterSeconds: 900, retryIntervalSeconds: 60,
          escalateAfterSeconds: 0, maxAttempts: 3, builtIn: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z'
        }],
        retentionDays: 90,
        defaults: { internalChannelId: 'internal-default', defaultRuleId: 'default-operations' }
      };
    }
    if (method === 'GET' && path.startsWith('/identity/state')) return { users: [], roles: [], sessionMinutes: 60 };
    if (method === 'POST' && path === '/notifications/channels') return { id: 'smtp-new', kind: 'smtp', name: 'Nuevo', enabled: true, secretRef: 'monitoring_smtp_new', configured: true, config: {}, createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z' };
    if (method === 'POST' && path === '/notifications/rules') return { id: 'rule-new', name: 'Nueva', enabled: true, minimumSeverity: 'warning', recipientIds: ['u-1'], channelIds: ['internal-default'], escalationRecipientIds: [], schedule: null, acknowledgeAfterSeconds: 900, retryIntervalSeconds: 60, escalateAfterSeconds: 0, maxAttempts: 3, builtIn: false, createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z' };
    if (method === 'POST' && path === '/notifications/channels/smtp-ops/test') return { channelId: 'smtp-ops', outboxId: 'out-1', state: 'pending' };
    if (method === 'PATCH' && path.startsWith('/monitoring/assets/')) return DETAIL;
    if (method === 'PUT' && path.startsWith('/monitoring/profiles/')) return { category: 'servers', enabled: true };
    if (method === 'POST' && path === '/monitoring/exporters') return { id: 'exporter-2', name: 'Nuevo', kind: 'blackbox', module: 'icmp', enabled: true };
    if (method === 'POST' && path.startsWith('/monitoring/alerts/') && path.endsWith('/acknowledge')) return Object.assign({}, ALERT_DETAIL, { acknowledged: true, acknowledgedAt: '2026-10-23T10:10:00Z', acknowledgedBy: 'u-1' });
    if (method === 'POST' && path.startsWith('/monitoring/alerts/') && path.endsWith('/incident')) return Object.assign({}, ALERT_DETAIL, { incident: { id: 'inc-2', status: 'open', suggestedClose: false } });
    if (method === 'POST' && path.startsWith('/monitoring/alerts/') && path.endsWith('/maintenance')) return { suggested: { name: 'Mantenimiento ProbeFailed', assetIds: [DEVICE.assetId], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '22:00', endTime: '23:00', timezone: 'Europe/Madrid' }, existingWindow: null };
    if (method === 'POST' && path === '/monitoring/silences') return { id: 'silence-1', alertId: 'alert-1', comment: 'Revisión', endsAt: '2026-10-24T10:00:00Z', active: true };
    if (method === 'POST' && path === '/monitoring/windows') return { id: 'window-1', name: 'Mantenimiento', assetIds: [DEVICE.assetId], daysOfWeek: [1], startTime: '22:00', endTime: '23:00', timezone: 'Europe/Madrid', enabled: true, active: false, nextOccurrence: null };
    if (method === 'PUT' && path.startsWith('/monitoring/windows/')) return { id: path.split('/').pop(), name: 'Mantenimiento', assetIds: [DEVICE.assetId], daysOfWeek: [1], startTime: '22:00', endTime: '23:00', timezone: 'Europe/Madrid', enabled: true, active: false, nextOccurrence: null };
    return listResponse([]);
  };
  return calls;
}

function jsonBody(call) {
  if (call.options.body === undefined) return undefined;
  return JSON.parse(JSON.stringify(call.options.body));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('phase 8 monitoring stays empty and makes no request while signed out', async () => {
  const { app, c } = setup();
  let requests = 0;
  c.AssetAccess.request = async () => { requests += 1; return listResponse([]); };
  app.authenticated = false;
  assert.equal(app.monitoringAvailable, false);
  assert.equal(app.monitoringDevices.length, 0);
  assert.equal(app.monitoringConfig, null);
  assert.equal(await app.loadMonitoringDevices(), false);
  assert.equal(requests, 0);
  assert.equal(app.monitoringDevices.length, 0, 'no prototype fallback while signed out');
});

test('device list keeps all six server states, nullable uptime and the selected period', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMonitoringDevices({ period: '7d' }), true);
  const path = calls.find((call) => call.path.startsWith('/monitoring/devices?')).path;
  const params = new URLSearchParams(path.split('?')[1]);
  assert.equal(params.get('period'), '7d');
  assert.equal(params.get('limit'), '100');
  assert.equal(app.monitoringDevices.length, 6);
  assert.deepEqual(app.monitoringDevices.map((row) => row.status), STATUSES);
  assert.equal(app.monitoringDevices[0].monitored, false);
  assert.equal(app.monitoringDevices[1].reason, 'prometheus_unavailable');
  assert.equal(app.monitoringDevices[2].uptimePct, null, 'no_data uptime is null, never a fabricated zero');
  assert.equal(app.monitoringDevices[3].uptimePct, 99.5);
  assert.equal(app.monitoringStats.up, 1);
  assert.equal(app.monitoringStats.degraded, 1);
  assert.equal(app.monitoringStats.down, 1);
  assert.equal(app.monitoringStats.unmonitored, 1);
  assert.equal(app.monitoringStats.noData, 1);
  assert.equal(app.monitoringStats.unavailable, 1);
  assert.deepEqual(app.monitoringAvailabilityPoints.map((point) => point.value), [99.5, 99.5]);
  assert.deepEqual(app.monitoringLatencyPoints.map((point) => point.value), [11, 12, 14, 15, 16]);
});

test('device detail maps canonical series, checks and config without inventing samples', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMonitoringDevice(DEVICE.assetId, '30d'), true);
  const call = calls.find((item) => item.path.startsWith('/monitoring/devices/' + DEVICE.assetId));
  assert.ok(call);
  assert.ok(call.path.endsWith('?period=30d'));
  const record = app.monitoringDeviceRecord;
  assert.equal(record.assetId, DEVICE.assetId);
  assert.equal(record.asset.name, DEVICE.name);
  assert.equal(record.status, 'degraded');
  assert.equal(record.uptime.percent, 99.5);
  assert.equal(record.config.target, 'https://fichajes.example/health');
  assert.equal(record.config.minimumDurationSeconds, 300);
  assert.deepEqual(record.config.overridden, ['target', 'intervalSeconds']);
  assert.equal(record.series[0].points.length, 2);
  assert.deepEqual(record.series[0].points.map((point) => point.value), [0.02, 0.03]);
  assert.ok(record.series[0].points[0].label, 'points carry a visible time label');
  assert.equal(record.series[1].points.length, 0, 'empty series stays empty');
  assert.equal(record.checks[0].checkType, 'http');
  assert.equal(record.checks[0].latencyMs, 12);
  assert.equal(app.monitoringDeviceLatency.length, 2);
  assert.equal(app.monitoringDeviceAvailability.length, 0, 'availability is not fabricated from uptime');
});

test('stale device replies cannot replace newer data and logout clears live state', async () => {
  const { app, c } = setup();
  const pending = [];
  c.AssetAccess.request = (vm, path) => new Promise((resolve, reject) => {
    if (path.startsWith('/monitoring/devices/one')) pending.push({ resolve, value: Object.assign({}, DETAIL, { asset: Object.assign({}, DETAIL.asset, { id: 'one', name: 'Uno' }) }) });
    else pending.push({ resolve, value: Object.assign({}, DETAIL, { asset: Object.assign({}, DETAIL.asset, { id: 'two', name: 'Dos' }) }) });
    setTimeout(() => { if (!pending.length) reject(new Error('unexpected')); }, 0);
  });
  const first = app.loadMonitoringDevice('one', '24h');
  const second = app.loadMonitoringDevice('two', '24h');
  pending[1].resolve(pending[1].value);
  assert.equal(await second, true);
  pending[0].resolve(pending[0].value);
  await first;
  assert.equal(app.monitoringDeviceRecord.asset.name, 'Dos');
  app.clearMonitoringState();
  assert.equal(app.monitoringDeviceRecord, null);
  assert.equal(app.monitoringDeviceMissing, false);
  assert.equal(app.monitoringDeviceError, '');
  assert.equal(app.monitoringDevices.length, 0);
});

test('a late reply after logout cannot restore monitoring data', async () => {
  const { app, c } = setup();
  let resolveRequest;
  c.AssetAccess.request = () => new Promise((resolve) => { resolveRequest = resolve; });
  const loading = app.loadMonitoringDevices();
  app.clearMonitoringState();
  resolveRequest(listResponse([DEVICE]));
  assert.equal(await loading, false);
  assert.equal(app.monitoringDevices.length, 0);
});

test('asset override sends only the documented keys and keeps denied writes local', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  const values = {
    enabled: true, checkType: 'http', target: 'https://fichajes.example/health', intervalSeconds: 60,
    metrics: ['latency', 'cpu'], thresholds: { latency: { warning: 1, critical: 2 } }, minimumDurationSeconds: 300,
    exporterId: 'exporter-1', snmpModule: null, snmpAuthRef: null,
    unknown: 'discard', password: 'never'
  };
  const result = await app.updateMonitoringAsset(DEVICE.assetId, values);
  assert.equal(result.ok, true);
  const call = calls.find((item) => item.options.method === 'PATCH');
  assert.equal(call.path, '/monitoring/assets/' + DEVICE.assetId);
  assert.deepEqual(Object.keys(jsonBody(call)).sort(), ['checkType', 'enabled', 'exporterId', 'intervalSeconds', 'metrics', 'minimumDurationSeconds', 'snmpAuthRef', 'snmpModule', 'target', 'thresholds'].sort());
  assert.equal(jsonBody(call).password, undefined);
  app.can = () => false;
  const denied = await app.updateMonitoringAsset(DEVICE.assetId, { enabled: false });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /permis/i);
  assert.equal(calls.filter((item) => item.options.method === 'PATCH').length, 1, 'denied writes never reach the server');
});

test('acknowledging keeps the alert firing and never resolves it', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadMonitoringAlert('alert-1');
  const result = await app.acknowledgeMonitoringAlert('alert-1', 'Revisado');
  assert.equal(result.ok, true);
  const call = calls.find((item) => item.path === '/monitoring/alerts/alert-1/acknowledge');
  assert.deepEqual(jsonBody(call), { notes: 'Revisado' });
  assert.equal(app.monitoringAlertRecord.state, 'firing');
  assert.equal(app.monitoringAlertRecord.acknowledged, true);
  assert.equal(app.monitoringAlertRecord.acknowledgedBy, 'u-1');
});

test('incident linking and assisted maintenance preparation never auto-close or persist a window', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadMonitoringAlert('alert-1');
  const linked = await app.linkMonitoringIncident('alert-1', '');
  assert.equal(linked.ok, true);
  const link = calls.find((item) => item.path === '/monitoring/alerts/alert-1/incident');
  assert.deepEqual(jsonBody(link), { incidentId: null });
  assert.equal(app.monitoringAlertRecord.incident.id, 'inc-2');
  assert.equal(app.monitoringAlertRecord.state, 'firing', 'linking an incident does not resolve the alert');
  const prepared = await app.prepareMonitoringMaintenance('alert-1');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.suggested.startTime, '22:00');
  assert.equal(calls.filter((item) => item.path === '/monitoring/windows' && item.options.method === 'POST').length, 0, 'prepare is a draft, not a persisted window');
  const saved = await app.saveMonitoringWindow(prepared.suggested);
  assert.equal(saved.ok, true);
  const windowCall = calls.find((item) => item.path === '/monitoring/windows' && item.options.method === 'POST');
  assert.deepEqual(jsonBody(windowCall), prepared.suggested);
});

test('silences target exactly one server resource with an ISO end', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadMonitoringAlert('alert-1');
  const silenceCalls = () => calls.filter((item) => item.path === '/monitoring/silences').length;
  const rejected = await app.silenceMonitoringAlert('alert-1', { hours: 4, comment: '   ' });
  assert.equal(rejected.ok, false);
  assert.equal(silenceCalls(), 0);
  const result = await app.silenceMonitoringAlert('alert-1', { hours: 4, comment: 'Revisión física' });
  assert.equal(result.ok, true);
  const call = calls.find((item) => item.path === '/monitoring/silences');
  const body = jsonBody(call);
  assert.equal(body.alertId, 'alert-1');
  assert.equal(body.assetId, undefined);
  assert.equal(body.comment, 'Revisión física');
  assert.ok(!Number.isNaN(Date.parse(body.endsAt)));
  assert.ok(Date.parse(body.endsAt) > Date.now());
  const rejectedAsset = await app.silenceMonitoringAsset(DEVICE.assetId, { hours: 1, comment: '' });
  assert.equal(rejectedAsset.ok, false);
  assert.equal(silenceCalls(), 1);
  const assetSilence = await app.silenceMonitoringAsset(DEVICE.assetId, { hours: 1, comment: 'Obra' });
  assert.equal(assetSilence.ok, true);
  const assetBody = jsonBody(calls.filter((item) => item.path === '/monitoring/silences')[1]);
  assert.equal(assetBody.assetId, DEVICE.assetId);
  assert.equal(assetBody.alertId, undefined);
});

test('settings load profiles, exporters and presets with category/integration permissions', async () => {
  const { app, c } = setup();
  server(app, c);
  assert.equal(await app.loadMonitoringConfig(), true);
  assert.equal(app.monitoringConfig.prometheus.configured, true);
  assert.equal(app.monitoringProfiles[0].category, 'servers');
  assert.equal(app.monitoringExporters[0].module, 'if_mib');
  assert.deepEqual(app.monitoringPresets.minimumDurations, [0, 60, 300, 900]);
  assert.equal(app.monitoringConfigurable, true);
  assert.equal(app.monitoringIntegrations, true);
  app.can = (permission) => permission === 'assets.view';
  assert.equal(app.monitoringConfigurable, false);
  assert.equal(app.monitoringIntegrations, false);
});

test('notification channels only transmit a deployment reference and never raw secrets', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadNotificationConfig();
  const result = await app.saveNotificationChannel({
    kind: 'smtp', name: 'Correo nuevo', enabled: true, secretRef: 'monitoring_smtp_new',
    config: { subjectPrefix: '[ITMS]' }
  });
  assert.equal(result.ok, true);
  const body = jsonBody(calls.find((item) => item.path === '/notifications/channels'));
  assert.deepEqual(body, { kind: 'smtp', name: 'Correo nuevo', enabled: true, secretRef: 'monitoring_smtp_new', config: { subjectPrefix: '[ITMS]' } });
  assert.equal(body.password, undefined);
  assert.equal(body.token, undefined);
  assert.equal(body.url, undefined);
  const before = calls.length;
  const rejected = await app.saveNotificationChannel({ kind: 'telegram', name: 'Bot', token: '123:secret', password: 'x' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /secreto|credencial/i);
  assert.equal(calls.length, before, 'raw secrets never reach the network');
});

test('channel test 202 is pending, not delivered, and recipient labels never invent people', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadNotificationConfig();
  app.security.users = [{ id: 'u-1', name: 'Ana Canónica', roleId: 'r', active: true }];
  assert.equal(app.notificationRecipientLabel('u-1'), 'Ana Canónica');
  assert.equal(app.notificationRecipientLabel('u-unknown'), 'Identidad u-unknown');
  const result = await app.testNotificationChannel('smtp-ops');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'pending');
  assert.equal(app.notificationTestStates['smtp-ops'].state, 'pending');
  assert.doesNotMatch(app.lastToast || '', /enviad[oa]|entregad[oa]/i);
  assert.match(app.lastToast || '', /cola|pendiente/i);
  assert.deepEqual(jsonBody(calls.find((item) => item.path.endsWith('/test'))), {});
});

test('notification rules send canonical ids, schedule and retry fields without invented recipients', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  await app.loadNotificationConfig();
  const result = await app.saveNotificationRule({
    name: 'Guardia', enabled: true, minimumSeverity: 'critical', recipientIds: ['u-1'],
    channelIds: ['internal-default'], escalationRecipientIds: ['u-2'],
    schedule: { timezone: 'Europe/Madrid', start: '22:00', end: '06:00' },
    acknowledgeAfterSeconds: 900, retryIntervalSeconds: 120, escalateAfterSeconds: 3600, maxAttempts: 4
  });
  assert.equal(result.ok, true);
  const body = jsonBody(calls.find((item) => item.path === '/notifications/rules'));
  assert.deepEqual(body.recipientIds, ['u-1']);
  assert.deepEqual(body.channelIds, ['internal-default']);
  assert.deepEqual(body.schedule, { timezone: 'Europe/Madrid', start: '22:00', end: '06:00' });
  assert.equal(body.acknowledgeAfterSeconds, 900);
  assert.equal(body.retryIntervalSeconds, 120);
  assert.equal(body.escalateAfterSeconds, 3600);
  assert.equal(body.maxAttempts, 4);
  assert.equal(body.recipients, undefined);
});

test('inbox is server owned, unread count is honest and marking read uses the canonical endpoint', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMonitoringInbox({ unread: true }), true);
  assert.equal(app.monitoringInbox.length, 1);
  assert.equal(app.monitoringUnreadCount, 1);
  const listCall = calls.find((item) => item.path.startsWith('/notifications/inbox'));
  const params = new URLSearchParams(listCall.path.split('?')[1]);
  assert.equal(params.get('unread'), 'true');
  assert.equal(await app.markMonitoringNotificationRead('n-1'), true);
  assert.equal(calls.find((item) => item.path === '/notifications/inbox/n-1/read').options.method, 'POST');
  assert.equal(app.monitoringInbox[0].unread, false);
  assert.equal(app.monitoringUnreadCount, 0);
});

test('route handling loads a canonical UUID without treating the loading list as a 404', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  app.assets = [];
  app.authenticated = true;
  assert.equal(await app.handleMonitoringRoute({ name: 'monitorDevice', assetId: DEVICE.assetId }), true);
  assert.ok(calls.some((item) => item.path.startsWith('/monitoring/devices/' + DEVICE.assetId)));
  assert.equal(app.monitoringDeviceRecord.assetId, DEVICE.assetId);
  c.location.hash = '#/supervision/activo/' + DEVICE.assetId;
  app.$nextTick = (fn) => fn();
  app.accessRoute = (route) => route;
  app.applyRoute = function (next) { this.route = next; };
  app.ensureHash = (hash) => { app.lastEnsureHash = hash; };
  app.handleHashChange();
  assert.equal(app.route.name, 'monitorDevice');
  assert.equal(app.lastEnsureHash, undefined, 'the canonical UUID is not redirected while its detail loads');
});

test('unknown alert ids stay an honest empty state and a 401 clears monitoring state', async () => {
  const { app, c } = setup();
  server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/monitoring/alerts/missing')) {
      const error = new Error('El registro no está disponible.');
      error.status = 404;
      throw error;
    }
    return undefined;
  });
  await app.loadMonitoringAlert('missing');
  assert.equal(app.monitoringAlertMissing, true);
  assert.equal(app.monitoringAlertRecord, null);
  assert.match(app.monitoringAlertError, /no está disponible/i);
  await app.loadMonitoringDevices();
  c.AssetAccess.request = async () => { const error = new Error('La sesión ha vencido.'); error.status = 401; throw error; };
  await app.loadMonitoringDevices();
  assert.equal(app.monitoringDevices.length, 0);
  assert.equal(app.monitoringApi.identity, app.activeUserId);
});

test('a valid last check without latency shows its freshness, not "sin muestra"', async () => {
  const { app, c, mount } = setup();
  const detail = JSON.parse(JSON.stringify(DETAIL));
  detail.checks[0].latencyMs = null;
  server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/monitoring/devices/')) return detail;
    return undefined;
  });
  await app.loadMonitoringDevice(DEVICE.assetId);
  const { instance } = mount('MonitorDevice', { app });
  await c.Vue.nextTick();
  const card = instance.metrics.find((item) => item.label === 'Última comprobación');
  assert.match(card.value, /\d/);
  assert.notEqual(card.hint, 'Sin muestra');
  assert.match(card.hint, /hace|ahora mismo|de /);
});

const CANONICAL_ASSETS = [
  { id: DEVICE.assetId, name: 'Phase8 HTTP', quickCode: 'P8-HTTP' },
  { id: '5a1e0c10-0002-4f10-9a10-000000000002', name: 'Phase8 ICMP', quickCode: 'P8-ICMP' },
  { id: '5a1e0c10-0003-4f10-9a10-000000000003', name: 'Phase8 Node', quickCode: 'P8-NODE' }
];

test('the maintenance asset chooser reads canonical server assets instead of prototype ids', async () => {
  const { app, c, mount } = setup();
  const calls = server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/assets/search')) return listResponse(CANONICAL_ASSETS, { total: CANONICAL_ASSETS.length });
    return undefined;
  });
  app.assets = [{ id: 'AM-1042', name: 'Notebook de diseño', quickCode: 'AM-1042' }];
  app.inventory.items = [{ id: 'AM-1069', name: 'Reloj biométrico de recepción', quickCode: 'AM-1069' }];
  assert.equal(await app.loadMonitoringAssetDirectory(), true);
  const call = calls.find((item) => item.path.startsWith('/assets/search'));
  const params = new URLSearchParams(call.path.split('?')[1]);
  assert.equal(params.get('limit'), '200');
  assert.equal(params.get('offset'), '0');
  assert.deepEqual(app.monitoringAssets.map((asset) => asset.id), CANONICAL_ASSETS.map((asset) => asset.id));
  assert.equal(app.monitoringAssetsTotal, CANONICAL_ASSETS.length);

  const { instance } = mount('AlertSettings', { app });
  await c.Vue.nextTick();
  assert.deepEqual(instance.assets.map((asset) => asset.id), CANONICAL_ASSETS.map((asset) => asset.id));
  assert.ok(instance.assets.every((asset) => !/^AM-\d+$/.test(asset.id)), 'prototype ids never reach the chooser');
});

test('a prepared alert window keeps its canonical asset preselected until it is saved', async () => {
  const { app, c, mount } = setup();
  const preparedAsset = '5a1e0c10-0009-4f10-9a10-000000000009';
  const calls = server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/assets/search')) return listResponse(CANONICAL_ASSETS, { total: CANONICAL_ASSETS.length });
    if (method === 'POST' && path === '/monitoring/alerts/alert-1/maintenance') {
      return {
        assetId: preparedAsset,
        suggested: { name: 'Mantenimiento: Phase8 HTTP', assetIds: [preparedAsset], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '22:00', endTime: '23:00', timezone: 'Europe/Madrid' },
        existingWindow: null
      };
    }
    return undefined;
  });
  await app.loadMonitoringAlert('alert-1');
  const prepared = await app.prepareMonitoringMaintenance('alert-1');
  assert.equal(prepared.ok, true);
  assert.deepEqual(app.monitoringApi.prepared.assetIds, [preparedAsset]);

  const { instance } = mount('AlertSettings', { app });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await c.Vue.nextTick();
  assert.equal(instance.window.name, 'Mantenimiento: Phase8 HTTP');
  assert.deepEqual(instance.window.assetIds, [preparedAsset], 'the prepared asset survives the navigation into settings');
  assert.deepEqual(instance.window.daysOfWeek, [0, 1, 2, 3, 4, 5, 6], 'every suggested weekday stays checked');
  assert.ok(instance.assets.some((asset) => asset.id === preparedAsset), 'a prepared asset outside the bounded directory stays visible');

  await instance.saveWindow();
  const post = calls.find((item) => item.path === '/monitoring/windows' && item.options.method === 'POST');
  assert.ok(post, 'the reviewed draft is persisted only when the operator saves it');
  assert.deepEqual(jsonBody(post).assetIds, [preparedAsset]);
  assert.deepEqual(jsonBody(post).daysOfWeek, [0, 1, 2, 3, 4, 5, 6], 'server weekday ids are sent unchanged');
  assert.equal(app.monitoringApi.prepared, null, 'the consumed draft does not linger');
});

test('weekday toggles use the server 0-6 ids so Monday and Sunday persist', async () => {
  const { app, c, mount } = setup();
  const calls = server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/assets/search')) return listResponse(CANONICAL_ASSETS);
    return undefined;
  });
  const { instance } = mount('AlertSettings', { app });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await c.Vue.nextTick();
  assert.deepEqual(Array.from(instance.days).map((day) => day.label), ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  assert.deepEqual(Array.from(instance.days).map((day) => day.id), [0, 1, 2, 3, 4, 5, 6]);
  instance.resetWindow();
  assert.deepEqual(Array.from(instance.window.daysOfWeek), [0, 1, 2, 3, 4], 'a new window defaults to Monday through Friday');

  instance.window.daysOfWeek = [];
  instance.toggleDay(0);
  instance.toggleDay(6);
  instance.window.name = 'Fin de semana';
  instance.window.assetIds = [CANONICAL_ASSETS[0].id];
  await instance.saveWindow();
  assert.equal(instance.error, '');
  const post = calls.find((item) => item.path === '/monitoring/windows' && item.options.method === 'POST');
  assert.deepEqual(jsonBody(post).daysOfWeek, [0, 6], 'Monday is 0 and Sunday is 6 in the request payload');
});

test('the overview alert list never inherits the scope of a visited device', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.handleMonitoringRoute({ name: 'monitorDevice', assetId: DEVICE.assetId }), true);
  assert.equal(calls.filter((item) => item.path.startsWith('/monitoring/alerts?')).length, 0,
    'the device page reads its alerts from the canonical device detail, not from the shared list');
  calls.length = 0;
  assert.equal(await app.handleMonitoringRoute({ name: 'monitoring', section: 'estado' }), true);
  const listCall = calls.find((item) => item.path.startsWith('/monitoring/alerts?') && item.path.includes('limit=100'));
  assert.ok(listCall, 'the overview reloads its own alert page');
  const params = new URLSearchParams(listCall.path.split('?')[1]);
  assert.equal(params.get('assetId'), null, 'no device filter reaches the overview request');
  assert.equal(params.get('state'), 'firing', 'the overview request matches the "Activas" control');
  assert.equal(params.get('severity'), null, 'the overview request matches the "Todas" severity control');
  assert.deepEqual(plain(app.monitoringApi.alertFilters), { state: 'firing', severity: '', assetId: '' });
  assert.equal(app.monitoringAlerts.length, 1);
});

test('acknowledging from a list updates the visible row and keeps it firing', async () => {
  const { app, c } = setup();
  server(app, c);
  await app.loadMonitoringAlerts({});
  assert.equal(app.monitoringAlerts[0].acknowledged, false);
  const result = await app.acknowledgeMonitoringAlert(ALERT.id, '');
  assert.equal(result.ok, true);
  const row = app.monitoringAlerts.find((alert) => alert.id === ALERT.id);
  assert.ok(row, 'the acknowledged alert stays in the active list instead of disappearing');
  assert.equal(row.acknowledged, true);
  assert.equal(row.acknowledgedAt, '2026-10-23T10:10:00Z');
  assert.equal(row.state, 'firing', 'acknowledging never resolves the alert');
  assert.equal(app.monitoringAlertCounts.loaded, true);
});

test('an acknowledgement that finishes after logout cannot repopulate monitoring state', async () => {
  const { app, c } = setup();
  server(app, c);
  await app.loadMonitoringAlerts({});
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  c.AssetAccess.request = async (vm, path) => {
    if (path.endsWith('/acknowledge')) {
      await gate;
      return Object.assign({}, ALERT_DETAIL, { acknowledged: true, acknowledgedAt: '2026-10-23T10:10:00Z' });
    }
    return listResponse([ALERT]);
  };
  const pending = app.acknowledgeMonitoringAlert(ALERT.id, '');
  app.authenticated = false;
  app.clearMonitoringState();
  release();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(app.monitoringApi.alerts.loaded, false);
  assert.equal(app.monitoringAlerts.length, 0);
});

const INCIDENT = {
  id: 'inc-open-1', status: 'open', priority: 'high', description: 'Fallo de red del edificio',
  openedOn: '2026-10-22', primaryAssetId: DEVICE.assetId, primaryAssetName: DEVICE.name
};

function incidentsPage(items) {
  return { items, total: items.length, limit: 50, offset: 0 };
}

test('opening the incident chooser on a direct alert link loads canonical incidents', async () => {
  const { app, c, mount } = setup();
  const calls = server(app, c, (path, method) => {
    if (method === 'GET' && path.startsWith('/incidents')) return incidentsPage([INCIDENT]);
    return undefined;
  });
  await app.loadMonitoringAlert('alert-1');
  assert.equal(app.maintenanceApi.incidents.loaded, false);
  const { instance } = mount('MonitorAlert', { app });
  await c.Vue.nextTick();
  instance.askConvert();
  await c.Vue.nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await c.Vue.nextTick();
  assert.ok(calls.some((item) => item.path.startsWith('/incidents')), 'the chooser asks the canonical maintenance service');
  assert.equal(app.maintenanceApi.incidents.loaded, true);
  assert.deepEqual(plain(app.maintenanceApi.incidents.items[0].id), INCIDENT.id);
});

test('the incident chooser distinguishes loading, failure and retry', async () => {
  const { app, c, mount } = setup();
  let fail = true;
  let requests = 0;
  c.AssetAccess.request = async (vm, path) => {
    if (path.startsWith('/incidents')) {
      requests += 1;
      if (fail) {
        const error = new Error('No se pudo consultar mantenimiento.');
        error.status = 500;
        throw error;
      }
      return incidentsPage([INCIDENT]);
    }
    return listResponse([]);
  };
  const { instance } = mount('MonConvertDialog', { open: true, alert: ALERT, app });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await c.Vue.nextTick();
  assert.equal(instance.incidentsLoading, false);
  assert.equal(instance.incidentsError, 'No se pudo consultar mantenimiento.');
  assert.equal(instance.incidents.length, 0, 'a failed load never pretends the canonical list is empty');
  fail = false;
  await instance.retryIncidents();
  await c.Vue.nextTick();
  assert.equal(instance.incidentsError, '');
  assert.equal(instance.incidents.length, 1);
  assert.equal(requests, 2, 'retry asks the server again');
});

test('the incident chooser shows a loading state while the canonical list is pending', async () => {
  const { app, c, mount } = setup();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  c.AssetAccess.request = async (vm, path) => {
    if (path.startsWith('/incidents')) {
      await gate;
      return incidentsPage([INCIDENT]);
    }
    return listResponse([]);
  };
  const { instance } = mount('MonConvertDialog', { open: true, alert: ALERT, app });
  await c.Vue.nextTick();
  assert.equal(instance.incidentsLoading, true);
  assert.equal(instance.incidentsLoaded, false);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await c.Vue.nextTick();
  assert.equal(instance.incidentsLoading, false);
  assert.equal(instance.incidentsLoaded, true);
  assert.equal(instance.incidents.length, 1);
});
