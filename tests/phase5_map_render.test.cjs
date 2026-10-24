'use strict';
// Phase 5 server map: the infrastructure explorer must render the canonical
// organization payload of an authenticated session, while its cartographic
// preferences (base, labels, clusters, camera) stay local presentation state.
// Each test fails if the mounted component cannot render the server map, if it
// reads preferences from the server payload, if it invents prototype records,
// or if the prototype map mode changes behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const SITE_ID = '5a1e0c10-0001-4f10-9a10-000000000001';
const BUILDING_ID = '5a1e0c10-0002-4f10-9a10-000000000002';
const FLOOR_ID = '5a1e0c10-0003-4f10-9a10-000000000003';
const ASSET_ID = '11111111-2222-3333-4444-555555555555';

const BASE_TOGGLE = 'Alternar detalle cartográfico';
const EMPTY_MAP = 'No hay sedes registradas.';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function stub(c, handler) {
  c.fetch = async (url, init) => handler({ url, init: init || {} });
}

function locationDto(id, level, parentId, name) {
  return { id, level, parentId, name, description: '', latitude: null, longitude: null, planRef: '', planPage: '', active: true };
}

function locations(siteName) {
  return [
    locationDto(SITE_ID, 'site', null, siteName),
    locationDto(BUILDING_ID, 'building', SITE_ID, 'Edificio Norte'),
    locationDto(FLOOR_ID, 'floor', BUILDING_ID, 'Piso 2')
  ];
}

function mapPayload(siteName) {
  return {
    sites: [{ id: SITE_ID, name: siteName, latitude: '-25.28', longitude: '-57.63' }],
    positions: [{
      assetId: ASSET_ID,
      quickCode: 'NB-CEN-001',
      name: 'Notebook de dirección',
      siteId: SITE_ID,
      locationId: FLOOR_ID,
      x: 0.125,
      y: 0.5
    }],
    limit: 200,
    offset: 0,
    truncated: false
  };
}

function mapResponder(siteName) {
  return (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: locations(siteName), total: 3, limit: 200, offset: 0 });
    if (call.url.indexOf('/api/v1/map') === 0) return json(mapPayload(siteName));
    return json({}, 404);
  };
}

function sessionApp() {
  const session = setup();
  const { c, app } = session;
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  app.csrfToken = 'csrf-test-token';
  app.can = () => true;
  ['can', 'canConfig', 'requirePermission', 'accessRoute'].forEach((name) => {
    app[name] = c.options.methods[name].bind(app);
  });
  return session;
}

function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  for (const child of node.children || []) walk(child, out);
  return out;
}

// The harness host stores static text through `setElementText` (`node.text`) and
// interpolated text through `setText` on text nodes, so both are read here.
function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

function nodeByLabel(root, label) {
  return walk(root).find((node) => node.props && node.props['aria-label'] === label) || null;
}

function mountExplorer(session) {
  const result = session.mount('MapExplorer', { app: session.app, focusId: '' });
  return Object.assign({}, result, {
    errors: () => session.errors.map((error) => (error && error.name) + ': ' + (error && error.message))
  });
}

// The rendered explorer of an authenticated session whose canonical map is
// loaded from the API. Before the composition fix, `prefs` was undefined in the
// server payload and the base toggle threw before Vue patched the tree.
test('the map explorer renders the server map and toggles only local display preferences', async () => {
  const session = sessionApp();
  const { c, app } = session;
  const writes = [];
  const write = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return write(key, value); };
  stub(c, mapResponder('Sede Central'));
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  assert.equal(app.serverMapMode, true, 'the fixture must be the server map route');

  const domainState = () => JSON.stringify({
    sites: app.organization.map.sites,
    positions: app.organization.map.positions,
    loaded: app.organization.map.loaded,
    truncated: app.organization.map.truncated
  });
  const before = domainState();

  const mounted = mountExplorer(session);
  await c.Vue.nextTick();

  assert.deepEqual(mounted.errors(), [], 'the server map render raises no error');
  const explorer = walk(mounted.root).find((node) => node.props && node.props['data-od-id'] === 'infra-explorer');
  assert.ok(explorer, 'the infrastructure explorer is rendered');
  assert.match(textOf(mounted.root), /Sede Central/, 'the server site is rendered');

  const toggle = nodeByLabel(mounted.root, BASE_TOGGLE);
  assert.ok(toggle, 'the cartographic base toggle is rendered');
  assert.equal(toggle.props['aria-pressed'], 'false', 'the default base is the schematic one');

  mounted.instance.setPref('base', 'detalle');
  await c.Vue.nextTick();
  assert.equal(nodeByLabel(mounted.root, BASE_TOGGLE).props['aria-pressed'], 'true', 'the toggle reflects the preference');
  assert.equal(app.maps.prefs.base, 'detalle', 'the local display preference object is updated');
  // The merged model is what every Engine call receives through `source`, so a
  // fix that only patched the component getter would still fail here.
  const engineMaps = c.AssetMapEngine.mapsOf(mounted.instance.source);
  assert.equal(engineMaps.prefs.base, 'detalle', 'the engine map input carries the local preference');
  assert.notEqual(engineMaps, app.maps, 'the server map model is not replaced by the client map model');
  assert.deepEqual(engineMaps.sites.map((site) => site.label), ['Sede Central'], 'the engine map input keeps server sites only');
  assert.equal(engineMaps.buildings.length, 1, 'the engine map input keeps the server building');
  assert.equal(engineMaps.floors.length, 1, 'the engine map input keeps the server floor');
  assert.deepEqual(Object.keys(engineMaps.positions), [ASSET_ID], 'the engine map input keeps the server asset placement');
  assert.equal(engineMaps.positions[ASSET_ID].floor, FLOOR_ID, 'the placement keeps its canonical floor');
  assert.equal(engineMaps.locationIndex[FLOOR_ID].id, FLOOR_ID, 'the engine map input keeps the canonical location index');

  // The preference object is replaced by Engine.setPrefs; the render must follow.
  c.AssetMapEngine.setPrefs(app, { base: 'esquema' });
  await c.Vue.nextTick();
  assert.equal(nodeByLabel(mounted.root, BASE_TOGGLE).props['aria-pressed'], 'false', 'a replaced preference object is reactive');
  c.AssetMapEngine.setPrefs(app, { base: 'detalle' });
  await c.Vue.nextTick();

  assert.equal(domainState(), before, 'canonical map state is never written by the explorer');

  // A fresh canonical payload replaces the server map without resetting the
  // client's cartographic preference.
  stub(c, mapResponder('Sede Norte'));
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  await c.Vue.nextTick();
  assert.deepEqual(mounted.errors(), [], 'the replacement payload renders without error');
  assert.match(textOf(mounted.root), /Sede Norte/, 'the replacement payload is rendered');
  assert.doesNotMatch(textOf(mounted.root), /Sede Central/, 'the previous payload is gone, not merged');
  assert.equal(nodeByLabel(mounted.root, BASE_TOGGLE).props['aria-pressed'], 'true', 'the local preference survives the payload replacement');
  assert.equal(app.maps.prefs.base, 'detalle');

  assert.equal(app.organization.map.sites[0].name, 'Sede Norte', 'the canonical map keeps the server payload');
  assert.equal(app.organizationMapSource.maps.prefs, undefined, 'no preference is invented in the server payload');
  assert.deepEqual(writes, [], 'the server map render performs no direct localStorage write');

  mounted.unmount();
});

// An unloaded canonical map still renders the component: the empty state is
// factual and the presentation preferences remain available, so no prototype
// site, floor or position can leak in.
test('an unloaded server map renders the factual empty state without prototype records', async () => {
  const session = sessionApp();
  const { c, app } = session;
  stub(c, () => json({}, 404));
  assert.equal(app.organization.map.loaded, false, 'the fixture starts with no canonical map');

  const mounted = mountExplorer(session);
  await c.Vue.nextTick();

  assert.deepEqual(mounted.errors(), [], 'the empty server map renders without error');
  const explorer = walk(mounted.root).find((node) => node.props && node.props['data-od-id'] === 'infra-explorer');
  assert.ok(explorer, 'the infrastructure explorer is rendered');
  const empty = walk(mounted.root).find((node) => node.props && node.props.class === 'map-empty');
  assert.ok(empty, 'the empty state is rendered');
  assert.equal(textOf(empty).trim(), EMPTY_MAP, 'the empty state is factual');

  const markers = walk(mounted.root).filter((node) => node.props && /\bmap-marker\b/.test(String(node.props.class || '')));
  assert.equal(markers.length, 0, 'no prototype site marker is drawn');

  const toggle = nodeByLabel(mounted.root, BASE_TOGGLE);
  assert.ok(toggle, 'the base toggle still renders with presentation preferences');
  assert.equal(toggle.props['aria-pressed'], 'false');

  mounted.instance.setPref('base', 'detalle');
  await c.Vue.nextTick();
  assert.equal(nodeByLabel(mounted.root, BASE_TOGGLE).props['aria-pressed'], 'true');
  assert.equal(app.organization.map.loaded, false, 'display preferences never touch canonical state');

  mounted.unmount();
});

// Prototype mode keeps its own normalized map model, including preferences.
test('prototype map mode keeps its normalized map preferences', async () => {
  const session = setup();
  const { c, app } = session;
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  app.authenticated = false;
  assert.equal(app.serverMapMode, false, 'the fixture must be the prototype map route');
  assert.equal(app.maps.prefs.base, 'esquema', 'the prototype map normalizes its preferences');

  const mounted = mountExplorer(session);
  await c.Vue.nextTick();

  assert.deepEqual(mounted.errors(), [], 'the prototype map renders without error');
  const explorer = walk(mounted.root).find((node) => node.props && node.props['data-od-id'] === 'infra-explorer');
  assert.ok(explorer, 'the infrastructure explorer is rendered');
  assert.equal(c.AssetMapEngine.mapsOf(app), app.maps, 'the prototype map model is still the store map model');

  const toggle = nodeByLabel(mounted.root, BASE_TOGGLE);
  assert.equal(toggle.props['aria-pressed'], 'false');
  mounted.instance.setPref('base', 'detalle');
  await c.Vue.nextTick();
  assert.equal(nodeByLabel(mounted.root, BASE_TOGGLE).props['aria-pressed'], 'true');
  assert.equal(app.maps.prefs.base, 'detalle');

  mounted.unmount();
});
