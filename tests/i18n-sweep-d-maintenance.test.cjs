'use strict';
// T3d sweep D (maintenance and incidents): every rendered label, empty state,
// dialog title and adapter message comes from the `ui.maintenance.*` /
// `ui.incidents.*` catalogs. Each test mounts the real component or calls the
// real adapter, checks the Spanish source text and then switches the shipped
// runtime to `en`, so a hard-coded literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PLAN = {
  id: 'plan-1', assetId: 'asset-1', siteId: 'site-1', site: 'Sede',
  maintenanceType: 'preventive', intervalMonths: 6, tasks: ['Limpiar'],
  responsiblePersonId: 'person-1', responsibleLabel: 'Ana Canónica', status: 'active',
  scheduledOn: '2026-01-10', lastCompletedOn: '2026-01-10', dueOn: '2026-07-10', persisted: true
};
const INTERVENTION = {
  id: 'int-1', assetId: 'asset-1', assetName: 'Portátil', assetQuickCode: 'A-001', type: 'corrective',
  description: 'Cambio de disco', technicianPersonId: 'person-1', technicianName: 'Ana', occurredOn: '2026-10-01',
  status: 'completed', notes: '', parts: [{ name: 'SSD', quantity: 1, unitCost: '50.00' }],
  laborCost: '20.00', partsCost: '50.00', totalCost: '70.00', attachmentIds: [], attachments: []
};
const INCIDENT = {
  id: 'inc-1', primaryAssetId: 'asset-1', primaryAssetName: 'Portátil', primaryAssetQuickCode: 'A-001',
  description: 'No arranca', priority: 'high', status: 'open', responsiblePersonId: 'person-1',
  responsibleName: 'Ana', openedOn: '2026-10-02', revision: 1, affectedAssetIds: [], affectedAssets: [],
  events: [{ id: 'ev-1', action: 'created', createdAt: '2026-10-02T10:00:00Z', actorUsername: 'ana' }],
  interventions: [], interventionsTotal: 0, costs: null
};

function listResponse(items) {
  return { items, total: items.length, limit: 25, offset: 0 };
}

function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

function server(context, overrides) {
  const extra = overrides || {};
  context.AssetAccess.request = async (vm, path, options) => {
    const method = (options && options.method) || 'GET';
    for (const [match, answer] of Object.entries(extra)) {
      if (String(path).startsWith(match)) return answer(path, method);
    }
    if (method === 'GET' && (path === '/maintenance/plans' || path.startsWith('/maintenance/plans?'))) return listResponse([PLAN]);
    if (path.startsWith('/interventions/costs')) return { totalCost: '70.00', countedInterventions: 1 };
    if (method === 'GET' && path.startsWith('/interventions?')) return listResponse([INTERVENTION]);
    if (method === 'GET' && path.startsWith('/incidents?')) return listResponse([INCIDENT]);
    if (method === 'GET' && path === '/incidents/inc-1') return INCIDENT;
    if (method === 'GET' && path.startsWith('/maintenance/templates')) return listResponse([]);
    if (method === 'GET' && path.startsWith('/maintenance/plans/')) return PLAN;
    return listResponse([]);
  };
}

async function inLocales(s, render, assertSpanish, assertEnglish) {
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  assertSpanish(await render());
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  assertEnglish(await render());
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
}

test('the maintenance center renders its copy from the catalog in both locales', async () => {
  const s = setup();
  server(s.c);
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(center.root), (es) => {
    assert.match(es, /Mantenimiento e incidentes/, 'the Spanish title is unchanged');
    assert.match(es, /Preventivos vencidos/, 'the Spanish KPI label is unchanged');
    assert.match(es, /Registrar intervención/, 'the Spanish action is unchanged');
  }, (en) => {
    assert.match(en, /Maintenance and incidents/, 'the English title is shown');
    assert.match(en, /Overdue preventive work/, 'the English KPI label is shown');
    assert.match(en, /Log intervention/, 'the English action is shown');
    assert.doesNotMatch(en, /Mantenimiento e incidentes|Preventivos vencidos|Nuevo incidente/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('maintenance metadata, relative dates and amounts follow the active locale', async () => {
  const s = setup();
  const Engine = s.c.AssetMaintEngine;
  const Data = s.c.ASSET_MAINT;
  const helpers = s.c.AssetMaintViews.helpers;
  s.c.ItsmI18n.applySession({ installation: { defaultLocale: 'es', timezone: 'America/Asuncion', currency: 'USD' } });
  await s.settle();
  s.c.ItsmI18n.setLocale('es');
  assert.equal(Engine.STATUS_META.overdue.label, 'Vencido');
  assert.equal(Data.PRIORITIES[0].label, 'Crítica');
  assert.equal(Data.INTERVENTION_TYPES[0].label, 'Preventivo');
  assert.equal(helpers.relLabel(3), 'En 3 días');
  assert.equal(helpers.relLabel(0), 'Hoy');
  assert.match(helpers.money(1234), /US\$|\$/, 'the amount uses the installation currency');
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  assert.equal(Engine.STATUS_META.overdue.label, 'Overdue');
  assert.equal(Data.PRIORITIES[0].label, 'Critical');
  assert.equal(Data.INTERVENTION_TYPES[0].label, 'Preventive');
  assert.equal(helpers.relLabel(3), 'In 3 days');
  assert.equal(helpers.relLabel(-2), '2 days ago');
  assert.equal(helpers.relLabel(0), 'Today');
  assert.equal(helpers.fmtDay('2026-01-10'), 'Jan 10, 2026', 'dates use Intl in the active locale');
  assert.doesNotMatch(helpers.money(1234), /€|EUR/, 'currency never falls back to the hard-coded EUR');
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
});

test('the asset maintenance panel renders its copy from the catalog in both locales', async () => {
  const s = setup();
  server(s.c);
  const asset = Object.assign({}, s.app.assets[0], { id: 'asset-1', name: 'Portátil Canónico', quickCode: 'A-001', category: 'notebooks' });
  s.app.assets = [asset];
  const panel = s.mount('AssetMaintenancePanel', { asset, app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(panel.root), (es) => {
    assert.match(es, /Mantenimiento/, 'the Spanish heading is unchanged');
    assert.match(es, /Registrar intervención/, 'the Spanish action is unchanged');
    assert.match(es, /Intervenciones abiertas/, 'the Spanish list heading is unchanged');
  }, (en) => {
    assert.match(en, /Maintenance/, 'the English heading is shown');
    assert.match(en, /Log intervention/, 'the English action is shown');
    assert.match(en, /Open interventions/, 'the English list heading is shown');
    assert.doesNotMatch(en, /Registrar intervención|Intervenciones abiertas|Historial técnico/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  panel.unmount();
});

test('the maintenance settings screen renders its copy from the catalog in both locales', async () => {
  const s = setup();
  server(s.c);
  const settings = s.mount('MaintenanceSettings', { app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(settings.root), (es) => {
    assert.match(es, /Plantillas preventivas/, 'the Spanish section heading is unchanged');
    assert.match(es, /Nueva plantilla/, 'the Spanish action is unchanged');
  }, (en) => {
    assert.match(en, /Preventive templates/, 'the English section heading is shown');
    assert.match(en, /New template/, 'the English action is shown');
    assert.doesNotMatch(en, /Plantillas preventivas|Nueva plantilla|Tipos de intervención/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  settings.unmount();
});

test('the maintenance dialogs render their copy from the catalog in both locales', async () => {
  const s = setup();
  server(s.c);
  const asset = Object.assign({}, s.app.assets[0], { id: 'asset-1', name: 'Portátil Canónico', quickCode: 'A-001', category: 'notebooks' });
  s.app.assets = [asset];
  const intervention = s.mount('QuickIntervention', { open: true, assetId: 'asset-1', app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(intervention.root), (es) => {
    assert.match(es, /Tipo de trabajo/, 'the Spanish field label is unchanged');
    assert.match(es, /Guardar intervención/, 'the Spanish dialog action is unchanged');
  }, (en) => {
    assert.match(en, /Work type/, 'the English field label is shown');
    assert.match(en, /Save intervention/, 'the English dialog action is shown');
    assert.doesNotMatch(en, /Registrar intervención|Tipo de trabajo|Repuestos/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  intervention.unmount();

  const incident = s.mount('QuickIncident', { open: true, primaryAssetId: 'asset-1', app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(incident.root), (es) => {
    assert.match(es, /Otros dispositivos afectados/, 'the Spanish incident dialog copy is unchanged');
  }, (en) => {
    assert.match(en, /Other affected devices/, 'the English incident dialog copy is shown');
    assert.doesNotMatch(en, /Nuevo incidente|Activo principal|Prioridad/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  incident.unmount();

  const panel = s.mount('AssetMaintenancePanel', { asset, app: s.app });
  await s.settle();
  panel.instance.dialogs.complete = true;
  await s.settle();
  await inLocales(s, async () => textContent(panel.root), (es) => {
    assert.match(es, /Completar preventivo/, 'the Spanish completion dialog is unchanged');
  }, (en) => {
    assert.match(en, /Complete preventive work/, 'the English completion dialog is shown');
    assert.doesNotMatch(en, /Completar preventivo|Fecha de realización/, 'no Spanish copy leaks into English');
  });
  panel.instance.dialogs.complete = false;
  panel.instance.dialogs.postpone = true;
  await s.settle();
  await inLocales(s, async () => textContent(panel.root), (es) => {
    assert.match(es, /Nuevo vencimiento/, 'the Spanish postponement dialog is unchanged');
  }, (en) => {
    assert.match(en, /New due date/, 'the English postponement dialog is shown');
    assert.doesNotMatch(en, /Posponer preventivo|Nuevo vencimiento/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  panel.unmount();
});

test('the maintenance adapter reports permission and event messages in the active locale', async () => {
  const s = setup();
  server(s.c);
  await s.settle();
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  s.app.can = () => false;
  const denied = await s.app.saveMaintenancePlan({ assetId: 'asset-1' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'No tienes permiso para editar mantenimiento.');
  s.app.can = () => true;
  assert.equal(await s.app.loadMaintenanceIncident('inc-1'), true);
  assert.equal(s.app.maintenanceApi.incidentDetail.record.events[0].label, 'Incidente creado');
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  s.app.can = () => false;
  const deniedEnglish = await s.app.saveMaintenancePlan({ assetId: 'asset-1' });
  assert.equal(deniedEnglish.error, 'You do not have permission to edit maintenance.');
  s.app.can = () => true;
  assert.equal(s.app.maintenanceApi.incidentDetail.record.events[0].label, 'Incident created', 'a mapped event label follows the active locale');
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  assert.deepEqual(s.errors, []);
});

test('the incident detail renders its copy from the catalog in both locales', async () => {
  const s = setup();
  server(s.c);
  s.app.route.incidentId = 'inc-1';
  const detail = s.mount('IncidentDetail', { app: s.app });
  await s.settle();
  await inLocales(s, async () => textContent(detail.root), (es) => {
    assert.match(es, /Actuaciones/, 'the Spanish follow-up heading is unchanged');
    assert.match(es, /Preparar y confirmar la resolución/, 'the Spanish resolution panel is unchanged');
  }, (en) => {
    assert.match(en, /Activity/, 'the English follow-up heading is shown');
    assert.match(en, /Prepare and confirm the resolution/, 'the English resolution panel is shown');
    assert.doesNotMatch(en, /Actuaciones|Preparar y confirmar la resolución|Migas de pan/, 'no Spanish copy leaks into English');
  });
  assert.deepEqual(s.errors, []);
  detail.unmount();
});
