'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PLAN = {
  id: 'plan-1', assetId: 'asset-1',
  siteId: 'site-1', site: 'Sede', maintenanceType: 'preventive', intervalMonths: 6, tasks: ['Limpiar'],
  responsiblePersonId: 'person-1', responsibleLabel: 'Ana Canónica', status: 'active', scheduledOn: '2026-01-10',
  lastCompletedOn: '2026-01-10', dueOn: '2026-07-10', persisted: true
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
  events: [], interventions: [], interventionsTotal: 0, costs: null
};

function listResponse(items) {
  return { items, total: items.length, limit: 25, offset: 0 };
}

function textContent(node) {
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

function server(app, context) {
  const calls = [];
  context.AssetAccess.request = async (vm, path, options) => {
    calls.push({ path, options: options || {} });
    const method = (options && options.method) || 'GET';
    if (method === 'GET' && (path === '/maintenance/plans' || path.startsWith('/maintenance/plans?'))) return listResponse([PLAN]);
    if (path.startsWith('/interventions/costs')) return { totalCost: '70.00', countedInterventions: 1 };
    if (method === 'GET' && path.startsWith('/interventions?')) return listResponse([INTERVENTION]);
    if (method === 'GET' && path.startsWith('/incidents?')) return listResponse([INCIDENT]);
    if (path === '/incidents' && method === 'POST') return Object.assign({}, INCIDENT, { id: 'inc-new' });
    if (path.startsWith('/maintenance/plans/') && path.endsWith('/complete')) return Object.assign({}, PLAN, { lastCompletedOn: '2026-10-23', dueOn: '2027-04-23' });
    if (path.startsWith('/assets/') && path.includes('/attachments')) return { id: 'att-1', filename: 'parte.pdf', category: 'document' };
    return listResponse([]);
  };
  return calls;
}

test('phase7 adapter exposes no prototype maintenance data before authorization', () => {
  const { app } = setup();
  app.authenticated = false;
  assert.equal(app.maintenanceAvailable, false, 'maintenance is unavailable while signed out');
  assert.equal(app.maintenancePlanning.templates.length, 0, 'no template fallback while signed out');
  assert.equal(app.maintenancePlanning.plans.length, 0, 'no plan fallback while signed out');
  assert.equal(app.maintenancePlanning.interventions.length, 0, 'no intervention fallback while signed out');
  assert.equal(app.maintenancePlanning.incidents.length, 0, 'no incident fallback while signed out');
});

test('phase7 plan, intervention and incident lists are canonical server DTOs and preserve server errors', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMaintenancePlans({ reset: true }), true);
  assert.equal(await app.loadMaintenanceInterventions({ reset: true }), true);
  assert.equal(await app.loadMaintenanceIncidents({ reset: true }), true);
  assert.equal(app.maintenancePlanning.plans[0].dueOn, '2026-07-10');
  assert.equal(app.maintenancePlanning.plans[0].asset.id, 'asset-1');
  assert.equal(app.maintenancePlanning.interventions[0].status, 'completed');
  assert.equal(app.maintenancePlanning.interventions[0].totalCost, '70.00');
  assert.equal(app.maintenancePlanning.incidents[0].status, 'open');
  assert.equal(await app.loadMaintenanceCosts({
    filters: {
      category: 'notebooks', siteId: 'site-1', status: 'completed', type: 'corrective', assetId: 'asset-1',
      technicianPersonId: 'person-1', incidentId: 'inc-1', planId: 'plan-1',
      occurredFrom: '2026-01-01', occurredTo: '2026-01-31'
    }
  }), true);
  assert.equal(app.maintenanceCosts.total, 70, 'costs use the backend totalCost field');
  assert.equal(app.maintenanceCosts.count, 1, 'costs use the backend countedInterventions field');
  const costPath = calls.find((call) => call.path.startsWith('/interventions/costs')).path;
  const costParams = new URLSearchParams(costPath.split('?')[1]);
  assert.equal(costParams.get('category'), 'notebooks');
  assert.equal(costParams.get('siteId'), 'site-1');
  assert.equal(costParams.get('status'), 'completed');
  assert.equal(costParams.get('type'), 'corrective');
  assert.equal(costParams.get('assetId'), 'asset-1');
  assert.equal(costParams.get('technicianPersonId'), 'person-1');
  assert.equal(costParams.get('incidentId'), 'inc-1');
  assert.equal(costParams.get('planId'), 'plan-1');
  assert.equal(costParams.get('from'), '2026-01-01');
  assert.equal(costParams.get('to'), '2026-01-31');
  assert.equal(costParams.has('site'), false, 'siteId is forwarded canonically instead of translated to site text');
  assert.equal(await app.loadMaintenanceInterventions({ reset: true, filters: {
    status: 'completed', type: 'corrective', category: 'notebooks', siteId: 'site-1',
    occurredFrom: '2026-01-01', occurredTo: '2026-01-31'
  } }), true);
  const interventionPath = calls.filter((call) => call.path.startsWith('/interventions?')).slice(-1)[0].path;
  const interventionParams = new URLSearchParams(interventionPath.split('?')[1]);
  assert.equal(interventionParams.get('status'), 'completed');
  assert.equal(interventionParams.get('type'), 'corrective');
  assert.equal(interventionParams.get('category'), 'notebooks');
  assert.equal(interventionParams.get('siteId'), 'site-1');
  assert.equal(interventionParams.get('from'), '2026-01-01');
  assert.equal(interventionParams.get('to'), '2026-01-31');
  assert.equal(await app.loadMaintenanceIncidents({ reset: true, filters: {
    status: 'open', priority: 'high', category: 'notebooks', siteId: 'site-1', responsiblePersonId: 'person-1',
    openedFrom: '2026-01-01', openedTo: '2026-01-31'
  } }), true);
  const incidentPath = calls.filter((call) => call.path.startsWith('/incidents?')).slice(-1)[0].path;
  const incidentParams = new URLSearchParams(incidentPath.split('?')[1]);
  assert.equal(incidentParams.get('status'), 'open');
  assert.equal(incidentParams.get('priority'), 'high');
  assert.equal(incidentParams.get('category'), 'notebooks');
  assert.equal(incidentParams.get('siteId'), 'site-1');
  assert.equal(incidentParams.get('responsiblePersonId'), 'person-1');
  assert.equal(incidentParams.get('from'), '2026-01-01');
  assert.equal(incidentParams.get('to'), '2026-01-31');
  assert.ok(calls.some((call) => call.path.startsWith('/maintenance/plans')));
  assert.ok(calls.some((call) => call.path.startsWith('/interventions?')));
  assert.ok(calls.some((call) => call.path.startsWith('/incidents?')));

  c.AssetAccess.request = async () => { throw Object.assign(new Error('Servidor no disponible'), { status: 500 }); };
  assert.equal(await app.loadMaintenancePlans({ reset: true }), false);
  assert.equal(app.maintenanceApi.plans.error, 'Servidor no disponible');
  assert.equal(app.maintenancePlanning.plans.length, 1, 'a failed reload keeps the last canonical page');
});

test('phase7 clearing a list filter never resends the previous adapter value', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMaintenanceInterventions({ reset: true, filters: { category: 'computadoras', type: 'preventive' } }), true);
  assert.equal(await app.loadMaintenanceInterventions({ reset: true, filters: { type: 'corrective' } }), true);
  const interventionPath = calls.filter((call) => call.path.startsWith('/interventions?')).slice(-1)[0].path;
  const interventionParams = new URLSearchParams(interventionPath.split('?')[1]);
  assert.equal(interventionParams.get('type'), 'corrective');
  assert.equal(interventionParams.has('category'), false, 'a cleared category is removed from the next request');
  assert.equal(await app.loadMaintenanceIncidents({ reset: true, filters: { category: 'computadoras', priority: 'high' } }), true);
  assert.equal(await app.loadMaintenanceIncidents({ reset: true, filters: { priority: 'normal' } }), true);
  const incidentPath = calls.filter((call) => call.path.startsWith('/incidents?')).slice(-1)[0].path;
  const incidentParams = new URLSearchParams(incidentPath.split('?')[1]);
  assert.equal(incidentParams.get('priority'), 'normal');
  assert.equal(incidentParams.has('category'), false, 'cleared incident filters are removed from the next request');
});

test('phase7 a late list response after the session is cleared never repopulates the surface', async () => {
  const { app, c } = setup();
  let release;
  c.AssetAccess.request = () => new Promise((resolve) => { release = resolve; });
  const pending = app.loadMaintenancePlans({ reset: true });
  app.clearMaintenanceState();
  release(listResponse([PLAN]));
  assert.equal(await pending, false, 'the stale request reports cancellation, not success');
  assert.equal(app.maintenancePlanning.plans.length, 0, 'late server data is discarded');
  assert.equal(app.maintenanceApi.plans.error, '', 'a cancelled request does not surface as an error');
});

test('phase7 denied writes preserve populated canonical state and never reach the server', async () => {
  const { app, c } = setup();
  const calls = server(app, c);
  assert.equal(await app.loadMaintenancePlans({ reset: true }), true);
  assert.equal(await app.loadMaintenanceInterventions({ reset: true }), true);
  const before = calls.length;
  app.can = () => false;
  const denied = await app.saveMaintenanceIntervention({ assetId: 'asset-1', type: 'corrective', description: 'Cambio de disco', occurredOn: '2026-10-23', status: 'completed', parts: [], attachmentIds: [] });
  const deniedPlan = await app.completeMaintenancePlan('plan-1', { completedOn: '2026-10-23' });
  assert.equal(denied.ok, false);
  assert.equal(deniedPlan.ok, false);
  assert.equal(calls.length, before, 'unauthorized writes never reach the server');
  assert.equal(app.maintenancePlanning.plans.length, 1);
  assert.equal(app.maintenancePlanning.plans[0].dueOn, '2026-07-10');
  assert.equal(app.maintenancePlanning.interventions.length, 1);
});

test('phase7 an upload resolved after the session is cleared is rejected as cancelled', async () => {
  const { app, c } = setup();
  let release;
  c.AssetAccess.request = () => new Promise((resolve) => { release = resolve; });
  const bytes = new Uint8Array([37, 80, 68, 70]).buffer;
  const pending = app.uploadMaintenanceAttachment('asset-1', { name: 'parte.pdf', arrayBuffer: async () => bytes });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, 'function', 'the upload reached the request after reading the file bytes');
  app.clearMaintenanceState();
  release({ id: 'att-1', filename: 'parte.pdf', category: 'document' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true, 'the upload cannot attach itself to a cleared session');
  assert.equal(result.attachment, undefined);
});

test('phase7 clearing a session drops populated canonical pages and keeps monitoring alerts explicitly demo', async () => {
  const { app, c } = setup();
  server(app, c);
  assert.equal(await app.loadMaintenancePlans({ reset: true }), true);
  assert.equal(await app.loadMaintenanceInterventions({ reset: true }), true);
  assert.equal(await app.loadMaintenanceIncidents({ reset: true }), true);
  assert.equal(app.maintenancePlanning.plans.length, 1);
  assert.equal(app.maintenancePlanning.interventions.length, 1);
  assert.equal(app.maintenancePlanning.incidents.length, 1);
  app.clearMaintenanceState();
  assert.equal(app.maintenancePlanning.plans.length, 0);
  assert.equal(app.maintenancePlanning.interventions.length, 0);
  assert.equal(app.maintenancePlanning.incidents.length, 0);
  assert.ok(app.maintenancePlanning.alerts.length > 0, 'monitoring preview remains separate demo data');
});

test('phase7 mounted quick dialogs apply their preset asset context', async () => {
  const s = setup();
  const asset = s.app.assets[0];
  const incident = s.mount('QuickIncident', { open: true, primaryAssetId: asset.id });
  assert.equal(incident.instance.form.primaryAssetId, asset.id);
  assert.equal(incident.instance.primaryAsset.id, asset.id);
  incident.unmount();
  const intervention = s.mount('QuickIntervention', { open: true, assetId: asset.id });
  assert.equal(intervention.instance.form.assetId, asset.id);
  assert.equal(intervention.instance.selectedAsset.id, asset.id);
  assert.equal(intervention.instance.selectedAsset.name, asset.name);
  intervention.unmount();
  await s.tick();
  assert.deepEqual(s.errors, []);
});

test('phase7 mounted plan dialog remains open after its plan and template requests settle', async () => {
  const s = setup();
  server(s.app, s.c);
  const asset = Object.assign({}, s.app.assets[0], { id: 'asset-1', name: 'Portátil Canónico', quickCode: 'A-001', category: 'notebooks' });
  s.app.assets = [asset];
  const panel = s.mount('AssetMaintenancePanel', { asset, app: s.app });
  panel.instance.dialogs.plan = true;
  await s.tick();
  await new Promise((resolve) => setImmediate(resolve));
  await s.tick();
  const rendered = textContent(panel.root);
  assert.equal(panel.instance.dialogs.plan, true, 'the dialog stays open after loading');
  assert.equal(panel.instance.plan && panel.instance.plan.id, 'plan-1');
  assert.match(rendered, /Intervalo \(meses\)/, 'the loaded plan form is rendered');
  assert.match(rendered, /Tareas/, 'the loaded tasks field is rendered');
  assert.doesNotMatch(rendered, /Cargando plan…/, 'the loading placeholder is gone');
  assert.match(rendered, /A-001 · Portátil Canónico/, 'the caller supplies the canonical asset label');
  assert.doesNotMatch(rendered, /asset-1 · asset-1/, 'the dialog never duplicates the asset UUID');
  assert.match(rendered, /Último preventivo: 10 ene 2026 · Estado: Activo/, 'date and plan state use Spanish presentation');
  assert.doesNotMatch(rendered, /2026-01-10 · Estado: active/, 'raw API date/status never reach the dialog');
  assert.match(rendered, /Ana Canónica/, 'the loaded owner label is shown');
  assert.match(rendered, /ResponsableAna CanónicaQuitar/, 'the owner is rendered as the canonical searchable picker');
  assert.doesNotMatch(rendered, /Laura Méndez/, 'demo people never appear in the plan owner picker');
  assert.deepEqual(s.errors, [], 'the loaded plan form renders without a template error');
  panel.instance.dialogs.plan = false;
  panel.instance.dialogs.intervention = true;
  await s.tick();
  const intervention = textContent(panel.root);
  assert.match(intervention, /Registrar intervención/);
  assert.match(intervention, /A-001 · Portátil Canónico/, 'the intervention dialog inherits the canonical asset label');
  assert.doesNotMatch(intervention, /asset-1 · asset-1/, 'the intervention dialog never duplicates the asset UUID');
  assert.deepEqual(s.errors, []);
  panel.unmount();
});
