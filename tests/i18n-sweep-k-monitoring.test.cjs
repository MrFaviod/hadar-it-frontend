'use strict';
// T3d sweep K: the phase-10 monitoring prototype catalog (`ASSET_MONITOR`) and
// its engine (`AssetMonitorEngine`) must read every visible label from the
// `ui.*` catalog at read time. Each test boots the shipped runtime, runs the
// real module and switches the locale, so a literal frozen at load fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setup } = require('./i18n-harness.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function boot() {
  const harness = setup();
  const c = harness.c;
  await c.ItsmI18n.ready;
  vm.runInContext(read('assets/js/monitoring-data.js'), c);
  vm.runInContext(read('assets/js/monitoring-engine.js'), c);
  return { c, I18n: c.ItsmI18n, Data: c.ASSET_MONITOR, engine: c.AssetMonitorEngine };
}

const NOW = Date.parse('2026-09-15T12:00:00Z');
// Errors and other collections come from the sandbox realm, so they are copied
// into a host array before a strict comparison.
const errorsOf = (result) => Array.from(result.errors || []);
const ES_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

test('monitoring data labels are enumerable getters over the catalog', async () => {
  const { I18n, Data } = await boot();
  const check = Data.CHECKS[0];
  const descriptor = Object.getOwnPropertyDescriptor(check, 'label');
  assert.equal(typeof descriptor.get, 'function', 'the check label is a getter');
  assert.equal(descriptor.enumerable, true, 'the getter stays enumerable for the views');

  I18n.setLocale('es');
  assert.equal(check.label, 'Disponibilidad');
  assert.equal(check.short, 'Dispo.');
  assert.equal(check.hint, 'Respuesta al ping y al puerto de gestión del equipo.');
  assert.equal(Data.CHECKS[4].label, 'Almacenamiento');
  assert.equal(Data.CHECKS[4].short, 'Disco');
  assert.equal(Data.STATUSES[0].label, 'Disponible');
  assert.equal(Data.STATUSES[0].hint, 'Responde y todas las comprobaciones están dentro de rango.');
  assert.equal(Data.RANGES[1].label, '7 días');
  assert.equal(Data.RANGES[1].hint, 'Última semana');
  assert.equal(Data.NOTIFICATION_KINDS[2].label, 'Mantenimiento');
  assert.equal(Data.PRIORITIES[3].label, 'Baja');
  assert.equal(Data.CHANNELS.smtp.fromName, 'Supervisión TI');

  I18n.setLocale('en');
  assert.equal(check.label, 'Availability');
  assert.equal(check.short, 'Avail.');
  assert.equal(check.hint, 'Response to the ping and the device management port.');
  assert.equal(Data.CHECKS[4].label, 'Storage');
  assert.equal(Data.CHECKS[4].short, 'Disk');
  assert.equal(Data.STATUSES[0].label, 'Available');
  assert.equal(Data.STATUSES[0].hint, 'It responds and every check is within range.');
  assert.equal(Data.RANGES[1].label, '7 days');
  assert.equal(Data.RANGES[1].hint, 'Last week');
  assert.equal(Data.NOTIFICATION_KINDS[2].label, 'Maintenance');
  assert.equal(Data.PRIORITIES[3].label, 'Low');
  assert.equal(Data.CHANNELS.smtp.fromName, 'IT monitoring');
});

test('monitoring engine chart labels follow the locale', async () => {
  const { I18n, engine } = await boot();

  I18n.setLocale('es');
  const esWeek = engine.pointsFor('7d', NOW);
  const esDay = esWeek.points[0].label.slice(0, 3);
  assert.ok(ES_DAYS.indexOf(esDay) !== -1, 'the Spanish weekday abbreviation is shown: ' + esWeek.points[0].label);
  assert.match(esWeek.points[0].label, /^[a-záéíóú]{3} \d{2}h$/);
  const esMonth = engine.pointsFor('30d', NOW).points[0].label;
  assert.match(esMonth, /^\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/);

  I18n.setLocale('en');
  const enWeek = engine.pointsFor('7d', NOW);
  assert.ok(EN_DAYS.indexOf(enWeek.points[0].label.slice(0, 3)) !== -1, 'the English weekday abbreviation is shown: ' + enWeek.points[0].label);
  assert.match(enWeek.points[0].label, /^[A-Z][a-z]{2} \d{2}h$/);
  assert.match(engine.pointsFor('30d', NOW).points[0].label, /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/);
  assert.equal(engine.rangeMeta('7d').label, '7 days');
});

test('monitoring engine validation errors follow the locale', async () => {
  const { I18n, engine } = await boot();
  const state = engine.normalize(null, [], [], []);

  I18n.setLocale('es');
  assert.deepEqual(errorsOf(engine.acknowledge(state, { alerts: [] }, 'ALT-1')), ['La alerta ya no está disponible.']);
  assert.deepEqual(errorsOf(engine.saveThresholds(state, { id: 'nope' })), ['La comprobación ya no está disponible.']);
  assert.deepEqual(errorsOf(engine.saveWindow(state, {})), ['La ventana necesita un nombre.']);
  assert.deepEqual(errorsOf(engine.saveEscalation(state, { label: 'Regla', channels: [] })), ['Selecciona al menos un canal.']);
  assert.deepEqual(errorsOf(engine.markNotificationRead(state, 'nope')), ['La notificación ya no está disponible.']);
  assert.deepEqual(
    errorsOf(engine.saveThresholds(state, { id: 'cpu', warn: 90, crit: 80 })),
    ['El umbral crítico debe ser mayor que el umbral de aviso.']
  );

  I18n.setLocale('en');
  assert.deepEqual(errorsOf(engine.acknowledge(state, { alerts: [] }, 'ALT-1')), ['This alert is no longer available.']);
  assert.deepEqual(errorsOf(engine.saveThresholds(state, { id: 'nope' })), ['This check is no longer available.']);
  assert.deepEqual(errorsOf(engine.saveWindow(state, {})), ['The window needs a name.']);
  assert.deepEqual(errorsOf(engine.saveEscalation(state, { label: 'Rule', channels: [] })), ['Select at least one channel.']);
  assert.deepEqual(errorsOf(engine.markNotificationRead(state, 'nope')), ['This notification is no longer available.']);
  assert.deepEqual(
    errorsOf(engine.saveThresholds(state, { id: 'cpu', warn: 90, crit: 80 })),
    ['The critical threshold must be higher than the warning threshold.']
  );
});

test('monitoring engine alert, history and notification copy follows the locale', async () => {
  const { I18n, engine } = await boot();
  const state = engine.normalize(null, [], [], []);
  const makeAlert = () => ({
    id: 'ALT-1',
    assetId: 'AM-1',
    kind: 'cpu',
    severity: 'critica',
    message: 'CPU en 97 % supera el umbral crítico de 90 %.',
    detectedAt: NOW,
    state: 'open',
    incidentId: '',
    threshold: { checkId: 'cpu', value: 97, limit: 90, unit: '%' },
    events: []
  });

  I18n.setLocale('es');
  const esAlert = makeAlert();
  assert.equal(engine.thresholdText(esAlert), '97 % · umbral por encima de 90 %');
  assert.equal(engine.notify(state, {}).title, 'Aviso de supervisión');
  assert.equal(engine.acknowledge(state, { alerts: [esAlert] }, 'ALT-1').alert.events[0].text,
    'Reconocida por Administrador. El problema continúa bajo seguimiento.');
  const esContext = engine.templateContext(esAlert, []);
  assert.equal(esContext.incident, 'Sin incidente');
  assert.equal(esContext.severity, 'Crítica');
  assert.match(esContext.detectedAt, /\d/);

  I18n.setLocale('en');
  const enAlert = makeAlert();
  assert.equal(engine.thresholdText(enAlert), '97 % · threshold above 90 %');
  assert.equal(engine.notify(state, {}).title, 'Monitoring notice');
  assert.equal(engine.acknowledge(state, { alerts: [enAlert] }, 'ALT-1').alert.events[0].text,
    'Acknowledged by Administrator. The issue remains under watch.');
  const enContext = engine.templateContext(enAlert, []);
  assert.equal(enContext.incident, 'No incident');
  assert.equal(enContext.severity, 'Critical');
});

test('normalized monitoring state keeps live labels across a locale switch', async () => {
  const { I18n, engine } = await boot();

  I18n.setLocale('es');
  const state = engine.normalize(null, [], [], []);
  assert.equal(state.checks[0].label, 'Disponibilidad');
  assert.equal(state.channels.smtp.fromName, 'Supervisión TI');
  assert.equal(
    state.channels.smtp.template,
    'Se ha detectado una incidencia en {asset} ({site}).\n\n{message}\n\nSeveridad: {severity}\nDetectada: {detectedAt}\nEstado: {state}\n\nAbrir la alerta: {link}'
  );

  I18n.setLocale('en');
  assert.equal(state.checks[0].label, 'Availability', 'the normalized check is not frozen in Spanish');
  assert.equal(state.checks[0].hint, 'Response to the ping and the device management port.');
  assert.equal(state.channels.smtp.fromName, 'IT monitoring');
  assert.equal(
    state.channels.smtp.template,
    'An issue has been detected on {asset} ({site}).\n\n{message}\n\nSeverity: {severity}\nDetected: {detectedAt}\nState: {state}\n\nOpen the alert: {link}'
  );

  I18n.setLocale('es');
  engine.saveChannel(state, 'smtp', { enabled: true, host: 'smtp.local', from: 'noc@local', recipients: 'ops@local', fromName: 'NOC' });
  I18n.setLocale('en');
  assert.equal(state.channels.smtp.fromName, 'NOC', 'a saved override wins over the catalog default');
});

test('monitoring engine channel copy and channel names follow the locale', async () => {
  const { I18n, engine } = await boot();
  const state = engine.normalize(null, [], [], []);

  I18n.setLocale('es');
  assert.equal(engine.channelMeta('smtp').label, 'Correo SMTP');
  engine.saveChannel(state, 'smtp', { enabled: true, host: 'smtp.local', from: 'noc@local', recipients: 'ops@local' });
  engine.testChannel(state, 'smtp');
  assert.equal(state.notifications[0].title, 'Prueba de Correo SMTP enviada');
  assert.equal(state.notifications[0].body, 'Mensaje de prueba simulado a ops@local.');

  I18n.setLocale('en');
  assert.equal(engine.channelMeta('smtp').label, 'SMTP email');
  engine.testChannel(state, 'smtp');
  assert.equal(state.notifications[0].title, 'SMTP email test sent');
  assert.equal(state.notifications[0].body, 'Simulated test message to ops@local.');
});

test('a channel save keeps the catalog body live unless the form sends one', async () => {
  const { I18n, engine } = await boot();
  const state = engine.normalize(null, [], [], []);
  const form = { enabled: true, host: 'smtp.local', from: 'noc@local', recipients: 'ops@local' };

  I18n.setLocale('es');
  engine.saveChannel(state, 'smtp', form);
  assert.match(state.channels.smtp.template, /^Se ha detectado una incidencia/);

  I18n.setLocale('en');
  assert.match(
    state.channels.smtp.template,
    /^An issue has been detected/,
    'saving the form without a body must not freeze the catalog default'
  );

  engine.saveChannel(state, 'smtp', Object.assign({}, form, { template: 'Aviso: {message}' }));
  I18n.setLocale('es');
  assert.equal(state.channels.smtp.template, 'Aviso: {message}', 'an edited body is the stored value');
});

test('the email preview keeps the Spanish bytes and switches the whole message', async () => {
  const { I18n, engine } = await boot();
  const assets = [{ id: 'AM-1', name: 'Servidor', site: 'Sede Norte' }];
  const alert = {
    id: 'ALT-9', assetId: 'AM-1', kind: 'cpu', severity: 'critica', message: 'Sin respuesta.',
    detectedAt: '2026-09-15T12:34:00Z', state: 'open', incidentId: ''
  };
  const state = engine.normalize(null, assets, [], []);

  I18n.setLocale('es');
  const esPreview = engine.preview(state, 'smtp', alert, assets);
  assert.equal(esPreview.from, 'Supervisión TI <noc@example.invalid>');
  assert.equal(esPreview.subject, '[Crítica] Servidor · cpu');
  assert.equal(
    esPreview.body,
    'Se ha detectado una incidencia en Servidor (Sede Norte).\n\nSin respuesta.\n\nSeveridad: Crítica\nDetectada: 15/9/26, 9:34\nEstado: open\n\nAbrir la alerta: #/supervision/alerta/ALT-9'
  );
  assert.equal(
    engine.templateContext(alert, assets).detectedAt,
    new Date(alert.detectedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
    'the Spanish timestamp keeps its existing format'
  );

  I18n.setLocale('en');
  const enPreview = engine.preview(state, 'smtp', alert, assets);
  assert.equal(enPreview.from, 'IT monitoring <noc@example.invalid>');
  assert.equal(enPreview.subject, '[Critical] Servidor · cpu');
  assert.match(enPreview.body, /^An issue has been detected on Servidor \(Sede Norte\)\./);
  assert.match(enPreview.body, /Open the alert: #\/supervision\/alerta\/ALT-9$/);
  assert.doesNotMatch(enPreview.body, /Se ha detectado|Severidad|Abrir la alerta/);
});

test('derived rows and escalation plans keep live labels across a locale switch', async () => {
  const { I18n, engine } = await boot();
  const assets = [{ id: 'AM-1', name: 'Servidor', site: 'Sede Norte' }];
  const alert = {
    id: 'ALT-9', assetId: 'AM-1', kind: 'cpu', severity: 'critica', message: 'Sin respuesta.',
    detectedAt: '2026-09-15T12:34:00Z', state: 'open', incidentId: ''
  };
  const state = engine.normalize(null, assets, [], []);

  I18n.setLocale('es');
  const row = engine.deviceRow(state, assets[0], [], Date.parse(alert.detectedAt));
  const plan = engine.escalationPlan(state, alert, assets, Date.parse(alert.detectedAt));
  assert.equal(row.statusMeta.label, 'Sin supervisión');

  I18n.setLocale('en');
  assert.equal(row.statusMeta.label, 'Unmonitored', 'a derived device row is not frozen in Spanish');
  assert.equal(row.statusMeta.hint, 'The device has no configured checks.');
  assert.equal(plan.items[0].channels[0].label, 'SMTP email', 'an escalation plan label is live');
});

test('monitoring messages select the plural form of the active locale', async () => {
  const { I18n } = await boot();

  I18n.setLocale('es');
  assert.equal(I18n.t('ui.monitoring.notice.recovered_body', { count: 1 }),
    'Se recuperó 1 alerta. La resolución sigue pendiente de confirmación.');
  assert.equal(I18n.t('ui.monitoring.notice.recovered_body', { count: 3 }),
    'Se recuperaron 3 alertas. La resolución sigue pendiente de confirmación.');
  assert.equal(I18n.t('ui.monitoring.log.silenced', { hours: 4, actor: 'NOC' }), 'Silenciada 4 h por NOC.');

  I18n.setLocale('en');
  assert.equal(I18n.t('ui.monitoring.notice.recovered_body', { count: 1 }),
    '1 alert was recovered. Resolution still needs confirmation.');
  assert.equal(I18n.t('ui.monitoring.notice.recovered_body', { count: 3 }),
    '3 alerts were recovered. Resolution still needs confirmation.');
  assert.equal(I18n.t('ui.monitoring.log.silenced', { hours: 4, actor: 'NOC' }), 'Silenced for 4 h by NOC.');
});
