'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

/* Focused regression checks for the maintenance and incident states corrected
 * during the individual visual pass (U5). Each test names the painted
 * behaviour that was wrong, not the internal implementation. */

const PLAN = {
  id: 'plan-1', assetId: 'asset-1', assetName: 'Portátil', assetQuickCode: 'A-001',
  siteId: 'site-1', site: 'Sede', maintenanceType: 'preventive', intervalMonths: 6, tasks: ['Limpiar'],
  responsiblePersonId: 'person-1', responsibleLabel: 'Ana Canónica', status: 'active',
  scheduledOn: '2026-01-10', lastCompletedOn: '2026-01-10', dueOn: '2026-10-01', persisted: true
};
const INTERVENTION = {
  id: 'int-1', assetId: 'asset-1', assetName: 'Portátil', assetQuickCode: 'A-001', type: 'corrective',
  description: 'Cambio de disco', technicianPersonId: 'person-1', technicianName: 'Ana',
  occurredOn: '2026-10-01', status: 'completed', notes: '',
  parts: [{ name: 'SSD', quantity: 1, unitCost: '50.00' }],
  laborCost: '20.00', partsCost: '50.00', totalCost: '70.00', attachmentIds: [], attachments: []
};
const INCIDENT = {
  id: 'inc-1', primaryAssetId: 'asset-1', primaryAssetName: 'Portátil', primaryAssetQuickCode: 'A-001',
  description: 'No arranca', priority: 'high', status: 'open', responsiblePersonId: 'person-1',
  responsibleName: 'Ana', openedOn: '2026-10-02', revision: 1, affectedAssetIds: [], affectedAssets: [],
  events: [
    { id: 'ev-1', action: 'created', note: 'Incidente creado', createdAt: '2026-10-02T08:00:00Z', actorUsername: 'admin' }
    , { id: 'ev-2', action: 'status_changed', fromStatus: 'open', toStatus: 'open', createdAt: '2026-10-02T09:00:00Z', actorUsername: 'admin' }
  ],
  interventions: [], interventionsTotal: 0, costs: null
};

function listResponse(items) {
  return { items, total: items.length, limit: 25, offset: 0 };
}

function textContent(node) {
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

function nodes(root, predicate, found = []) {
  if (!root) return found;
  if (predicate(root)) found.push(root);
  (root.children || []).forEach((child) => nodes(child, predicate, found));
  return found;
}

function server(context) {
  const calls = [];
  context.AssetAccess.request = async (vm, path, options) => {
    calls.push({ path, options: options || {} });
    const method = (options && options.method) || 'GET';
    if (method === 'GET' && (path === '/maintenance/plans' || path.startsWith('/maintenance/plans?'))) {
      return listResponse([PLAN]);
    }
    if (path.startsWith('/interventions/costs')) return { totalCost: '70.00', countedInterventions: 1 };
    if (method === 'GET' && path.startsWith('/interventions?')) return listResponse([INTERVENTION]);
    if (method === 'GET' && path.startsWith('/incidents?')) return listResponse([INCIDENT]);
    if (method === 'GET' && path === '/incidents/inc-1') return INCIDENT;
    if (method === 'GET' && path === '/incidents/inc-2') {
      const error = new Error('incident id must be a UUID');
      error.status = 422;
      throw error;
    }
    if (method === 'GET' && path === '/incidents/inc-3') {
      return { ...INCIDENT, id: 'inc-3', status: 'resolved' };
    }
    return listResponse([]);
  };
  return calls;
}

async function debounce(ms = 340) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('the interventions view requests the accumulated cost with its own filters', async () => {
  const s = setup();
  const calls = server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  center.instance.setView('interventions');
  await s.settle();
  await debounce();
  await s.settle();
  const costCall = calls.find((call) => call.path.startsWith('/interventions/costs'));
  assert.ok(costCall, 'entering the view requests the cost read instead of hiding it');
  assert.match(textContent(center.root), /Coste acumulado/, 'the painted strip shows the server cost');
  assert.equal(center.instance.view, 'interventions');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a failed estate count is painted as unknown instead of as the filtered client figure', async () => {
  const s = setup();
  server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();
  for (const key of ['overdue', 'upcoming', 'inProgress', 'openInterventions', 'openIncidents', 'criticalIncidents', 'plans']) {
    s.app.maintenanceApi.overview[key] = null;
  }
  await s.settle();
  const values = nodes(center.root, (node) => {
    const className = (node.props && node.props.class) || node.class || '';
    return typeof className === 'string' && className.split(' ').includes('maint-kpi__value');
  }).map(textContent);
  assert.equal(values.length, 4);
  for (const value of values) assert.equal(value, '—', 'an unknown count is marked, not invented');
  for (const value of values) assert.doesNotMatch(value, /null|NaN|undefined|^\d+$/);
  const overdue = center.instance.kpis.find((item) => item.id === 'overdue');
  assert.equal(overdue.value, null, 'no filtered client count stands in for the estate count');
  assert.equal(overdue.tone, 'neutral', 'an unknown count does not use an alarm tone');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a partial estate count failure is reported and retryable, not silently kept', async () => {
  const s = setup();
  server(s.c);
  let failUpcoming = true;
  s.c.AssetAccess.request = async (vm, path, options) => {
    if (failUpcoming && path.startsWith('/maintenance/plans?state=upcoming')) {
      throw Object.assign(new Error('upstream unavailable'), { status: 503 });
    }
    return s.c.AssetAccess.request.__healthy(vm, path, options);
  };
  s.c.AssetAccess.request.__healthy = async (vm, path, options) => {
    const method = (options && options.method) || 'GET';
    if (method === 'GET' && (path === '/maintenance/plans' || path.startsWith('/maintenance/plans?'))) {
      return listResponse([PLAN]);
    }
    if (path.startsWith('/interventions/costs')) return { totalCost: '70.00', countedInterventions: 1 };
    if (method === 'GET' && path.startsWith('/interventions?')) return listResponse([INTERVENTION]);
    if (method === 'GET' && path.startsWith('/incidents?')) return listResponse([INCIDENT]);
    return listResponse([]);
  };
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();

  const overview = s.app.maintenanceApi.overview;
  assert.equal(overview.loaded, false, 'an incomplete overview is not treated as complete');
  assert.equal(overview.errorKey, 'ui.errors.unavailable',
    'the failure is reported as the catalogue key the surface resolves on render');
  assert.doesNotMatch(overview.errorKey, /upstream unavailable/,
    'raw server text is never stored, let alone painted');
  assert.equal(center.instance.kpis.find((item) => item.id === 'soon').display, '—');
  assert.equal(center.instance.kpis.find((item) => item.id === 'overdue').display, '01',
    'a count that did arrive is still painted');
  const alert = s.c.ItsmI18n.t('ui.errors.unavailable');
  assert.ok(textContent(center.root).includes(alert),
    'the surface says the counts are unavailable');

  failUpcoming = false;
  assert.equal(await s.app.loadMaintenanceOverview(), true, 'a retry that succeeds reports success');
  await s.settle();
  assert.equal(overview.loaded, true);
  assert.equal(overview.error, '');
  assert.equal(overview.errorKey, '');
  assert.equal(center.instance.kpis.find((item) => item.id === 'soon').display, '01');
  assert.ok(!textContent(center.root).includes(alert), 'the alert clears once the counts arrive');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a failed estate count is reported in the active locale after a language switch', async () => {
  const s = setup();
  server(s.c);
  const healthy = s.c.AssetAccess.request;
  s.c.AssetAccess.request = async (vm, path, options) => {
    if (path.startsWith('/maintenance/plans?state=upcoming')) {
      throw Object.assign(new Error('upstream unavailable'), { status: 503 });
    }
    return healthy(vm, path, options);
  };
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();
  const spanish = s.c.ItsmI18n.t('ui.errors.unavailable');
  assert.ok(textContent(center.root).includes(spanish), 'the Spanish capture reports the unavailable counts');
  // The alert is a catalogue key resolved on render, so switching the language while
  // it is already on screen repaints it instead of freezing the locale of the failure.
  s.c.ItsmI18n.setLocale('en');
  // Read the computed straight after the switch, before any other state mutation
  // can invalidate it: a catalogue key must track the locale by itself.
  const english = s.c.ItsmI18n.t('ui.errors.unavailable');
  assert.equal(center.instance.error, english, 'the alert computed tracks the locale version');
  await s.settle();
  const painted = textContent(center.root);
  assert.ok(painted.includes(english), 'the alert follows the active locale');
  assert.ok(!painted.includes(spanish), 'no sentence from the previous locale survives');
  assert.doesNotMatch(painted, /upstream unavailable/, 'raw server text is never painted');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('an unmapped estate failure keeps the maintenance fallback in both locales', async () => {
  const s = setup();
  server(s.c);
  const healthy = s.c.AssetAccess.request;
  s.c.AssetAccess.request = async (vm, path, options) => {
    if (path.startsWith('/maintenance/plans?state=overdue')) {
      throw Object.assign(new Error('upstream unavailable'), { status: 500 });
    }
    return healthy(vm, path, options);
  };
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();
  assert.equal(s.app.maintenanceApi.overview.errorKey, 'ui.maintenance.error.fallback',
    'a status without its own catalog entry keeps the maintenance fallback key');
  assert.ok(textContent(center.root).includes(s.c.ItsmI18n.t('ui.maintenance.error.fallback')));
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  const painted = textContent(center.root);
  assert.ok(painted.includes(s.c.ItsmI18n.t('ui.maintenance.error.fallback')), 'the fallback follows the locale too');
  assert.doesNotMatch(painted, /upstream unavailable/);
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a failed plan list is reported in the active locale after a language switch', async () => {
  const s = setup();
  server(s.c);
  const healthy = s.c.AssetAccess.request;
  s.c.AssetAccess.request = async (vm, path, options) => {
    if (path.startsWith('/maintenance/plans?limit=')) {
      throw Object.assign(new Error('upstream unavailable'), { status: 503 });
    }
    return healthy(vm, path, options);
  };
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();
  assert.ok(textContent(center.root).includes(s.c.ItsmI18n.t('ui.errors.unavailable')),
    'the Spanish capture reports the failed list');
  // The list alert is stored as a catalogue key too: the strip already on screen
  // must follow the language switch instead of keeping the locale of the failure.
  s.c.ItsmI18n.setLocale('en');
  assert.equal(center.instance.listError, s.c.ItsmI18n.t('ui.errors.unavailable'),
    'the list alert follows the active locale');
  await s.settle();
  assert.doesNotMatch(textContent(center.root), /upstream unavailable/);
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('the KPI cards keep the whole-estate counts while a view filter is applied', async () => {
  const s = setup();
  server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await debounce();
  await s.settle();
  const kpi = () => nodes(center.root, (node) => {
    const className = (node.props && node.props.class) || node.class || '';
    return typeof className === 'string' && className.split(' ').includes('maint-kpi');
  })[0];
  assert.match(textContent(kpi()), /01/, 'the estate count is painted before filtering');
  s.app.maintenanceApi.plans.items = [];
  s.app.maintenanceApi.interventions.items = [];
  s.app.maintenanceApi.incidents.items = [];
  await s.settle();
  assert.match(textContent(kpi()), /01/, 'a filtered empty page does not rewrite the estate count');
  assert.equal(center.instance.kpis.find((item) => item.id === 'overdue').value, 1);
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a KPI click keeps the due filter it asked for and paints as selected', async () => {
  const s = setup();
  const calls = server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  center.instance.filterByKpi({ id: 'overdue' });
  await s.settle();
  assert.equal(center.instance.filters.state, 'overdue', 'the filter survives the view change');
  assert.equal(center.instance.activeKpi, 'overdue', 'the KPI reads as the active filter');
  const pressed = nodes(center.root, (node) => node.props && node.props['aria-pressed'] === true);
  assert.equal(pressed.length, 1, 'exactly one KPI is announced as pressed');
  await debounce();
  await s.settle();
  const planCall = calls.filter((call) => call.path.startsWith('/maintenance/plans?')).pop();
  assert.match(planCall.path, /state=overdue/, 'the server read carries the requested due state');
  center.instance.setView('interventions');
  await s.settle();
  assert.equal(center.instance.filters.state, '', 'switching tabs still clears the KPI filter');
  assert.equal(center.instance.activeKpi, '');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('an in-flight maintenance read is announced instead of a blank surface', async () => {
  const s = setup();
  server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  s.app.maintenanceApi.plans.loading = true;
  await s.settle();
  assert.match(textContent(center.root), /Cargando mantenimiento…/, 'the loading state is named');
  const busy = nodes(center.root, (node) => node.props && node.props['aria-busy'] === 'true');
  assert.equal(busy.length, 1, 'the painted panel is announced as busy');
  s.app.maintenanceApi.plans.loading = false;
  await s.settle();
  assert.doesNotMatch(textContent(center.root), /Cargando mantenimiento…/);
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('an incident id the server rejects never paints the previously opened incident', async () => {
  const s = setup();
  server(s.c);
  s.app.route.incidentId = 'inc-1';
  const detail = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  assert.match(textContent(detail.root), /No arranca/, 'the routed incident is painted');
  s.app.route.incidentId = 'inc-2';
  await s.settle();
  await s.settle();
  const text = textContent(detail.root);
  assert.doesNotMatch(text, /No arranca/, 'the record of another id is not reused');
  assert.doesNotMatch(text, /Incident unavailable|must be a UUID/, 'no raw server detail is painted');
  assert.match(text, /El incidente solicitado no existe/, 'the body comes from the catalogue');
  assert.deepEqual(s.errors, []);
  detail.unmount();
});

test('an incident card whose description repeats its title prints it once', async () => {
  const s = setup();
  server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  center.instance.setView('incidents');
  await s.settle();
  await debounce();
  await s.settle();
  const occurrences = textContent(center.root).split('No arranca').length - 1;
  assert.equal(occurrences, 1, 'the repeated description is not printed twice in the card');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a timeline entry whose note repeats its label prints the label once', async () => {
  const s = setup();
  server(s.c);
  s.app.route.incidentId = 'inc-1';
  const detail = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(detail.root);
  const occurrences = text.split('Incidente creado').length - 1;
  assert.equal(occurrences, 1, 'the repeated note is not printed under its own label');
  assert.doesNotMatch(text, /\u2192/, 'internal state codes are not painted as the note');
  assert.deepEqual(s.errors, []);
  detail.unmount();
});

test('an incident whose description repeats its title paints the text once', async () => {
  const s = setup();
  server(s.c);
  s.app.route.incidentId = 'inc-1';
  const detail = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const subtitles = nodes(detail.root, (node) => (node.props && node.props.class === 'page-sub') || node.class === 'page-sub');
  assert.equal(subtitles.length, 0, 'a repeated description is not printed a second time');
  const headings = nodes(detail.root, (node) => (node.props && node.props.id === 'incident-title') || node.id === 'incident-title');
  assert.equal(headings.length, 1, 'the incident title is still painted');
  assert.deepEqual(s.errors, []);
  detail.unmount();
});

test('a resolved incident offers its close action as the primary one', async () => {
  const s = setup();
  server(s.c);
  s.app.route.incidentId = 'inc-3';
  const detail = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const primaries = nodes(detail.root, (node) => {
    const className = (node.props && node.props.class) || node.class || '';
    return typeof className === 'string' && className.split(' ').includes('btn--primary');
  });
  assert.equal(primaries.length, 1, 'the resolved view has one primary action');
  assert.match(textContent(primaries[0]), /Cerrar incidente/, 'closing is the action that finishes the work');
  assert.deepEqual(s.errors, []);
  detail.unmount();
});

/* ---------------------------------------------------------------------------
 * Incident read ownership, missing-versus-retryable errors and the retry path.
 * The routed id owns the panel: an unfinished or failed read for a new id must
 * never paint or keep the previous incident, and a server failure must be told
 * apart from a record that does not exist.
 * ------------------------------------------------------------------------- */

function incidentStub(context, handlers) {
  const calls = [];
  context.AssetAccess.request = async (vm, path) => {
    calls.push(path);
    const handler = handlers[path];
    if (!handler) return listResponse([]);
    return handler();
  };
  return calls;
}

function statusError(status, message, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

test('a new incident id drops the previous record before its read settles', async () => {
  const s = setup();
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  incidentStub(s.c, {
    '/incidents/inc-1': () => INCIDENT,
    '/incidents/inc-3': async () => {
      await slow;
      throw statusError(503, 'upstream incident store unavailable', 'unavailable');
    }
  });
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), true);
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(detail.record.description, 'No arranca');

  const pending = s.app.loadMaintenanceIncident('inc-3');
  await debounce(20);
  assert.equal(detail.id, 'inc-3', 'the routed id owns the panel before the read settles');
  assert.equal(detail.record, null, 'the previous incident must not stay painted under a new id');

  releaseSlow();
  assert.equal(await pending, false);
  assert.equal(detail.record, null, 'a failed read leaves no record behind');
  assert.equal(detail.missing, false, 'a server failure is not a missing record');
  assert.equal(detail.retryable, true, 'a 5xx read can be retried');
  assert.equal(detail.errorKey, 'ui.incidents.detail.error_retryable', 'the failure is a catalog key');
  assert.equal(detail.error, '', 'no translated or raw string is frozen at failure time');
});

test('a missing incident is announced as missing, not as a retryable failure', async () => {
  const s = setup();
  const handlers = {
    '/incidents/inc-1': () => INCIDENT,
    '/incidents/inc-404': () => { throw statusError(404, 'Incident not found', 'not_found'); },
    '/incidents/inc-500': () => { throw statusError(500, 'internal failure', 'internal_error'); }
  };
  incidentStub(s.c, handlers);
  const detail = s.app.maintenanceApi.incidentDetail;

  assert.equal(await s.app.loadMaintenanceIncident('inc-404'), false);
  assert.equal(detail.missing, true, 'a 404 record is missing');
  assert.equal(detail.retryable, false, 'retrying the same missing id cannot succeed');
  assert.equal(detail.record, null);

  assert.equal(await s.app.loadMaintenanceIncident('inc-500'), false);
  assert.equal(detail.missing, false, 'a 500 is not a missing record');
  assert.equal(detail.retryable, true);
  assert.doesNotMatch(detail.error, /internal failure/, 'raw server text is not painted');

  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), true);
  assert.equal(detail.record.description, 'No arranca', 'a later read restores the record');
  assert.equal(detail.missing, false);
  assert.equal(detail.error, '');
  assert.equal(detail.retryable, false);
});

test('a slower earlier incident read never overwrites the latest one', async () => {
  const s = setup();
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  incidentStub(s.c, {
    '/incidents/inc-1': async () => { await firstGate; return INCIDENT; },
    '/incidents/inc-3': () => ({ ...INCIDENT, id: 'inc-3', description: 'Fallo del switch', status: 'resolved' })
  });
  const first = s.app.loadMaintenanceIncident('inc-1');
  await debounce(10);
  assert.equal(await s.app.loadMaintenanceIncident('inc-3'), true);
  releaseFirst();
  assert.equal(await first, false);
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(detail.id, 'inc-3');
  assert.equal(detail.record.description, 'Fallo del switch', 'the latest request owns the panel');
});

test('a retryable incident failure offers a localised retry that restores the record', async () => {
  const s = setup();
  let attempts = 0;
  incidentStub(s.c, {
    '/incidents/inc-1': () => {
      attempts += 1;
      if (attempts === 1) throw statusError(503, 'service unavailable', 'unavailable');
      return INCIDENT;
    }
  });
  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const failing = textContent(view.root);
  assert.doesNotMatch(failing, /service unavailable/, 'no raw server text is painted');
  assert.match(failing, /Vuelve a intentarlo/i, 'the retryable failure is localised');
  assert.doesNotMatch(failing, /El incidente solicitado no existe/, 'a 503 is not a missing record');
  // The failure message is a catalog key, so it follows a locale switch made while
  // it is already on screen instead of freezing the locale of the failed request.
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  const english = textContent(view.root);
  assert.match(english, /could not be loaded/i, 'the message follows the current locale');
  assert.doesNotMatch(english, /Vuelve a intentarlo/i);
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  const retry = nodes(view.root, (node) => node.props && node.props['data-maint-action'] === 'retry');
  assert.equal(retry.length, 1, 'a retryable failure offers exactly one retry action');

  retry[0].props.onClick();
  await s.settle();
  await s.settle();
  const recovered = textContent(view.root);
  assert.match(recovered, /No arranca/, 'the retry paints the record it fetched');
  assert.doesNotMatch(recovered, /Vuelve a intentarlo/i);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a forbidden incident read explains the permission instead of claiming the record is missing', async () => {
  const s = setup();
  incidentStub(s.c, {
    '/incidents/inc-1': () => { throw statusError(403, 'forbidden by policy', 'forbidden'); }
  });
  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(view.root);
  const forbidden = s.c.ItsmI18n.t('ui.errors.forbidden');
  assert.match(text, new RegExp(forbidden.slice(0, 24)), 'the permission failure keeps its own localized explanation');
  assert.doesNotMatch(text, /El incidente solicitado no existe/, 'a denied read is not a record that does not exist');
  assert.doesNotMatch(text, /Incidente no disponible/, 'the missing heading is not painted for a denied read');
  assert.doesNotMatch(text, /forbidden by policy/, 'no raw server text is painted');
  const retry = nodes(view.root, (node) => node.props && node.props['data-maint-action'] === 'retry');
  assert.equal(retry.length, 0, 'a denied read offers no retry: repeating it unchanged cannot succeed');
  assert.equal(s.app.maintenanceApi.incidentDetail.retryable, false, 'the adapter keeps a 403 non-retryable');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a conflict on an incident read is not reported as a missing record', async () => {
  const s = setup();
  incidentStub(s.c, {
    '/incidents/inc-1': () => { throw statusError(409, 'revision conflict', 'conflict'); }
  });
  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(view.root);
  const conflict = s.c.ItsmI18n.t('ui.errors.conflict');
  assert.match(text, new RegExp(conflict.slice(0, 24)), 'the conflict keeps its own localized explanation');
  assert.doesNotMatch(text, /El incidente solicitado no existe/, 'a conflict is not a missing record');
  assert.doesNotMatch(text, /revision conflict/, 'no raw server text is painted');
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(detail.missing, false, 'the adapter does not classify a conflict as missing');
  assert.equal(detail.retryable, false, 'retrying a conflict unchanged cannot succeed');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('an explicit 400 on an incident read is still a missing record', async () => {
  const s = setup();
  incidentStub(s.c, {
    '/incidents/inc-1': () => { throw statusError(400, 'malformed incident reference', 'validation_error'); }
  });
  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(detail.missing, true, 'an id the server rejects as invalid cannot be retried into existence');
  assert.equal(detail.retryable, false);
  assert.match(textContent(view.root), /El incidente solicitado no existe/, 'the missing body is painted');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a retryable failure after a missing read replaces the missing state', async () => {
  const s = setup();
  let attempt = 0;
  incidentStub(s.c, {
    '/incidents/inc-1': () => {
      attempt += 1;
      if (attempt === 1) throw statusError(404, 'Incident not found', 'not_found');
      throw statusError(500, 'internal failure', 'internal_error');
    }
  });
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), false);
  assert.equal(detail.missing, true, 'the first read is a missing record');
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), false);
  assert.equal(detail.missing, false, 'the fresh failure classification replaces the old one');
  assert.equal(detail.retryable, true, 'the second read can be retried');
  assert.equal(detail.errorKey, 'ui.incidents.detail.error_retryable');

  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(view.root);
  assert.match(text, /Vuelve a intentarlo/, 'the retryable sentence is painted');
  assert.doesNotMatch(text, /El incidente solicitado no existe/, 'no missing body is mixed into the retryable state');
  assert.doesNotMatch(text, /Incidente no disponible/, 'no missing heading survives the fresh failure');
  const retry = nodes(view.root, (node) => node.props && node.props['data-maint-action'] === 'retry');
  assert.equal(retry.length, 1, 'the retryable state offers its retry action');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a missing read after a successful one drops the cached record', async () => {
  const s = setup();
  let attempt = 0;
  incidentStub(s.c, {
    '/incidents/inc-1': () => {
      attempt += 1;
      if (attempt === 1) return INCIDENT;
      throw statusError(404, 'Incident not found', 'not_found');
    }
  });
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), true);
  assert.equal(detail.record.description, 'No arranca');
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), false);
  assert.equal(detail.record, null, 'the record the server no longer has is dropped');
  assert.equal(detail.missing, true, 'the reread is classified as missing');

  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(view.root);
  assert.doesNotMatch(text, /No arranca/, 'the vanished record is not painted');
  assert.match(text, /El incidente solicitado no existe/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a same-id reload failure keeps the last good record visible with its explanation', async () => {
  const s = setup();
  let attempt = 0;
  incidentStub(s.c, {
    '/incidents/inc-1': () => {
      attempt += 1;
      if (attempt === 1) return INCIDENT;
      throw statusError(500, 'internal failure', 'internal_error');
    }
  });
  const detail = s.app.maintenanceApi.incidentDetail;
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), true);
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), false);
  assert.equal(detail.record.description, 'No arranca', 'a failed reload does not erase the record already shown');
  assert.equal(detail.missing, false, 'a failed reload is not a missing record');
  assert.equal(detail.retryable, true);

  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const text = textContent(view.root);
  assert.match(text, /No arranca/, 'the record stays painted');
  assert.match(text, /Vuelve a intentarlo/, 'the failed reload is explained');
  assert.doesNotMatch(text, /El incidente solicitado no existe/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a denied incident read follows a locale switch instead of freezing its message', async () => {
  const s = setup();
  incidentStub(s.c, {
    '/incidents/inc-1': () => { throw statusError(403, 'forbidden by policy', 'forbidden'); }
  });
  s.app.route.incidentId = 'inc-1';
  const view = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await s.settle();
  const spanish = textContent(view.root);
  assert.match(spanish, /No tienes permisos para realizar esta acción/, 'the denied read is explained in Spanish');
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  const english = textContent(view.root);
  assert.match(english, /You do not have permission/, 'the sentence follows the locale the page is painted in');
  assert.doesNotMatch(english, /No tienes permisos/, 'the failed locale is not frozen into the page');
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  assert.deepEqual(s.errors, []);
  view.unmount();
});
