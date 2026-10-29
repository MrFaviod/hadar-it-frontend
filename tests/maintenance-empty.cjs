'use strict';
// Rendered empty-state contract for the maintenance center: an empty list is only
// a filtered result when the user actually has active filters. Zero records,
// loading and server errors must not be blamed on filters.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const INCIDENT = {
  id: 'inc-1', primaryAssetId: 'asset-1', primaryAssetName: 'Portátil', primaryAssetQuickCode: 'A-001',
  description: 'No arranca', priority: 'high', status: 'open', responsiblePersonId: 'person-1',
  responsibleName: 'Ana', openedOn: '2026-10-02', revision: 1, affectedAssetIds: [], affectedAssets: [],
  events: [], interventions: [], interventionsTotal: 0, costs: null
};

function page(items) {
  return { items, total: items.length, limit: 25, offset: 0 };
}

function textContent(node) {
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

function emptyServer(c, incidents = []) {
  c.AssetAccess.request = async (vm, path) => {
    const target = String(path);
    if (target.startsWith('/incidents') && (!target.includes('?') || target.split('?')[0] === '/incidents')) return page(incidents);
    return page([]);
  };
}

async function mountEmpty(s, view) {
  emptyServer(s.c);
  s.app.maintenanceApi.prefs.defaultView = view;
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  return center;
}

test('an incident list without records or filters reports no records and offers no filter reset', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'incidents');
  const rendered = textContent(center.root);
  assert.match(rendered, /Todavía no hay incidentes registrados\./, 'the empty incident list explains that no incident exists yet');
  assert.doesNotMatch(rendered, /coincide con los filtros activos/, 'no incident is blamed on filters that are not active');
  assert.doesNotMatch(rendered, /Quitar filtros/, 'there is no filter reset to offer without active filters');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('an intervention list without records or filters reports no records and offers no filter reset', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'interventions');
  const rendered = textContent(center.root);
  assert.match(rendered, /Todavía no hay intervenciones registradas\./, 'the empty intervention list explains that no intervention exists yet');
  assert.doesNotMatch(rendered, /coinciden con los filtros activos/, 'no intervention is blamed on filters that are not active');
  assert.doesNotMatch(rendered, /Quitar filtros/, 'there is no filter reset to offer without active filters');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('an empty preventive agenda without filters reports no scheduled work and offers no filter reset', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'agenda');
  const rendered = textContent(center.root);
  assert.match(rendered, /Todavía no hay trabajos preventivos programados\./, 'the empty agenda explains that no preventive work is scheduled');
  assert.doesNotMatch(rendered, /con estos filtros/, 'no preventive work is blamed on filters that are not active');
  assert.doesNotMatch(rendered, /Ver toda la agenda/, 'there is no agenda reset to offer without active filters');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a filtered incident list keeps the filter message and a visible reset action', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'incidents');
  center.instance.filters.query = 'portátil';
  await s.tick();
  const rendered = textContent(center.root);
  assert.match(rendered, /Ningún incidente coincide con los filtros activos\./, 'an active filter still explains the empty result');
  assert.match(rendered, /Quitar filtros/, 'an active filter keeps its reset action');
  assert.doesNotMatch(rendered, /Todavía no hay incidentes registrados\./, 'a filtered result is not reported as an empty installation');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a filtered preventive agenda keeps the filter message and a visible reset action', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'agenda');
  center.instance.filters.planStatus = 'active';
  await s.tick();
  const rendered = textContent(center.root);
  assert.match(rendered, /No hay trabajos preventivos con estos filtros\./, 'an active filter still explains the empty agenda');
  assert.match(rendered, /Ver toda la agenda/, 'an active filter keeps its agenda reset action');
  assert.doesNotMatch(rendered, /Todavía no hay trabajos preventivos programados\./, 'a filtered agenda is not reported as an empty installation');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a filtered intervention list keeps the filter message and a visible reset action', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'interventions');
  center.instance.filters.type = 'corrective';
  await s.tick();
  const rendered = textContent(center.root);
  assert.match(rendered, /Ninguna intervención coincide con los filtros activos\./, 'an active filter still explains the empty result');
  assert.match(rendered, /Quitar filtros/, 'an active filter keeps its reset action');
  assert.doesNotMatch(rendered, /Todavía no hay intervenciones registradas\./, 'a filtered result is not reported as an empty installation');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a loading incident list does not render an empty state', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'incidents');
  s.app.maintenanceApi.incidents.loading = true;
  await s.tick();
  const rendered = textContent(center.root);
  assert.doesNotMatch(rendered, /Todavía no hay incidentes registrados\./, 'loading is not reported as no records');
  assert.doesNotMatch(rendered, /coincide con los filtros activos/, 'loading is not reported as a filtered result');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a failed incident request keeps the server error and does not render an empty state', async () => {
  const s = setup();
  const center = await mountEmpty(s, 'incidents');
  s.app.maintenanceApi.incidents.error = 'Servidor no disponible';
  await s.tick();
  const rendered = textContent(center.root);
  assert.match(rendered, /Servidor no disponible/, 'the server error is still shown');
  assert.doesNotMatch(rendered, /Todavía no hay incidentes registrados\./, 'a server error is not reported as no records');
  assert.doesNotMatch(rendered, /Ningún incidente coincide con los filtros activos\./, 'a server error is not reported as a filtered result');
  assert.deepEqual(s.errors, []);
  center.unmount();
});

test('a populated incident list still renders its records without an empty state', async () => {
  const s = setup();
  emptyServer(s.c, [INCIDENT]);
  s.app.maintenanceApi.prefs.defaultView = 'incidents';
  const center = s.mount('MaintenanceCenter', { app: s.app });
  await s.settle();
  const rendered = textContent(center.root);
  assert.match(rendered, /No arranca/, 'the canonical incident is rendered');
  assert.doesNotMatch(rendered, /Todavía no hay incidentes registrados\./, 'a populated list shows no empty message');
  assert.deepEqual(s.errors, []);
  center.unmount();
});
