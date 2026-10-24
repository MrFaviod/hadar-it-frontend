'use strict';
// Phase 10 infrastructure explorer: canonical positions are presentation data,
// the bounded asset pool keeps unpositioned devices associated with their floor,
// floor plans are authenticated bytes drawn as a MapLibre image source, camera
// field of view comes from the asset image endpoint, and the graph reads the
// canonical source state instead of the prototype application.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const SITE = '5a1e0c10-0001-4f10-9a10-000000000001';
const BUILDING = '5a1e0c10-0002-4f10-9a10-000000000002';
const FLOOR = '5a1e0c10-0003-4f10-9a10-000000000003';
const ROOM = '5a1e0c10-0004-4f10-9a10-000000000004';
const PLACED = '11111111-2222-3333-4444-555555555555';
const LOOSE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function location(id, level, parentId, name) {
  return {
    id, level, parentId, name, description: '', latitude: null, longitude: null,
    planRef: '', planPage: '', active: true
  };
}

function asset(id, code, name, category, locationId) {
  return {
    id, quickCode: code, name, category, type: category, brand: '', model: '',
    serial: '', ip: '', site: 'Sede Norte', location: 'Piso 2', responsible: '',
    siteId: SITE, locationId, responsiblePersonId: '', responsibleLabel: '',
    positionX: null, positionY: null, status: 'in_use', description: '', cost: '',
    technical: category === 'camaras' ? { fovAngle: '90' } : {},
    archived: false, images: category === 'camaras' ? { fov: '/api/v1/assets/' + id + '/images/fov' } : {},
    createdAt: '', updatedAt: ''
  };
}

function locationsPayload() {
  return [location(SITE, 'site', null, 'Sede Norte'), location(BUILDING, 'building', SITE, 'Edificio A'),
    location(FLOOR, 'floor', BUILDING, 'Piso 2'), location(ROOM, 'room_zone', FLOOR, 'Sala de cámaras')];
}

function mapPayload() {
  return {
    sites: [{ id: SITE, name: 'Sede Norte', latitude: '-25.28', longitude: '-57.63' }],
    positions: [{ assetId: PLACED, quickCode: 'CAM-001', name: 'Cámara de acceso', siteId: SITE, locationId: ROOM, x: 0.25, y: 0.5 }],
    limit: 200, offset: 0, truncated: false
  };
}

function explorerApp() {
  const session = setup();
  const { c, app } = session;
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  app.csrfToken = 'csrf-phase10';
  app.can = () => true;
  ['can', 'canConfig', 'requirePermission', 'accessRoute'].forEach((name) => {
    app[name] = c.options.methods[name].bind(app);
  });
  return session;
}

function explorerFetch(floorPlan) {
  return async (url, init) => {
    const options = init || {};
    if (url.indexOf('/api/v1/locations/' + FLOOR + '/plan/meta') === 0) {
      return json({ locationId: FLOOR, planRef: 'Piso 2', planPage: '1600x1000', contentType: 'image/png', width: 1600, height: 1000, size: 68, planUrl: '/locations/' + FLOOR + '/plan' });
    }
    if (url.indexOf('/api/v1/locations/' + FLOOR + '/plan') === 0) {
      assert.equal(options.responseType, 'blob', 'the raster must be read as authenticated bytes');
      return { ok: true, status: 200, blob: async () => floorPlan || new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) };
    }
    if (url.indexOf('/api/v1/locations') === 0) {
      return json({ items: locationsPayload(), total: 4, limit: 200, offset: 0 });
    }
    if (url.indexOf('/api/v1/map') === 0) return json(mapPayload());
    if (url.indexOf('/api/v1/assets/search') === 0) {
      return json({
        items: [asset(PLACED, 'CAM-001', 'Cámara de acceso', 'camaras', ROOM), asset(LOOSE, 'NVR-002', 'Grabador de la planta', 'virtual', FLOOR)],
        total: 2, limit: 200, offset: 0
      });
    }
    if (url.indexOf('/api/v1/assets/' + PLACED) === 0) return json(asset(PLACED, 'CAM-001', 'Cámara de acceso', 'camaras', ROOM));
    return json({ items: [], total: 0, limit: 200, offset: 0 });
  };
}

test('the canonical map source keeps the bounded pool, unpositioned floor context and camera media', async () => {
  const session = explorerApp();
  const { app, c } = session;
  c.fetch = explorerFetch();
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  const source = app.organizationMapSource;
  const placed = source.assets.find((item) => item.id === PLACED);
  const loose = source.assets.find((item) => item.id === LOOSE);
  assert.ok(placed && loose, 'both the positioned and the unpositioned canonical asset are present');
  assert.equal(placed.positionX, '0.25');
  assert.equal(placed.positionY, '0.5');
  assert.equal(placed.category, 'camaras');
  assert.equal(placed.images.fov, '/api/v1/assets/' + PLACED + '/images/fov');
  assert.equal(placed.technical.fovAngle, '90');
  assert.equal(loose.positionX, '');
  assert.equal(c.AssetMapEngine.floorOfAsset(source, loose), FLOOR,
    'a device assigned to a floor remains on that floor without individual coordinates');
});

test('the canonical map pool reads every bounded page without dropping unpositioned assets', async () => {
  const session = explorerApp();
  const { app, c } = session;
  const pages = [];
  const fallback = explorerFetch();
  c.fetch = async (url, init) => {
    if (url.indexOf('/api/v1/assets/search') === 0) {
      const query = new URL(url, 'http://explorer.test').searchParams;
      const offset = Number(query.get('offset'));
      const limit = Number(query.get('limit'));
      pages.push({ offset, limit });
      const total = 205;
      const items = [];
      for (let index = offset; index < Math.min(offset + limit, total); index += 1) {
        items.push(asset('pool-' + index, 'POOL-' + index, 'Equipo ' + index, 'virtual', FLOOR));
      }
      return json({ items, total, limit, offset });
    }
    return fallback(url, init);
  };
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  assert.deepEqual(pages, [{ offset: 0, limit: 200 }, { offset: 200, limit: 200 }],
    'the pool follows the canonical total with bounded pages');
  const source = app.organizationMapSource;
  assert.equal(source.assets.length, 205, 'devices beyond the first page remain in the map pool');
  assert.equal(app.organization.map.assetsTruncated, false);
  const last = source.assets.find((item) => item.id === 'pool-204');
  assert.ok(last, 'the last canonical page is present');
  assert.equal(last.positionX, '');
  assert.equal(c.AssetMapEngine.floorOfAsset(source, last), FLOOR,
    'a device beyond the first page keeps its floor association');
});

class FakeMap {
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.sources = {};
    this.layers = {};
    this.layout = {};
    this.paint = {};
    this.zoom = 4;
    FakeMap.last = this;
  }
  on(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); }
  emit(type) { (this.handlers[type] || []).forEach((handler) => handler({ type })); }
  addSource(id, source) { this.sources[id] = source; }
  removeSource(id) { delete this.sources[id]; }
  getSource(id) { return this.sources[id] || null; }
  addLayer(layer) { this.layers[layer.id] = layer; }
  removeLayer(id) { delete this.layers[id]; }
  setLayoutProperty(id, key, value) { this.layout[id + '.' + key] = value; }
  setPaintProperty(id, key, value) { this.paint[id + '.' + key] = value; }
  project(point) { return { x: point[0] / 8 + 40, y: (1000 - point[1]) / 8 + 40 }; }
  fitBounds() {}
  getZoom() { return this.zoom; }
  easeTo() {}
  remove() { this.removed = true; }
}

function mountExplorer(session) {
  session.c.window.maplibregl = { Map: FakeMap };
  const result = session.mount('MapExplorer', { app: session.app, focusId: '' });
  return Object.assign({}, result, {
    errors: () => session.errors.map((error) => (error && error.name) + ': ' + (error && error.message))
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('the floor plan is authenticated bytes in a MapLibre image layer with visibility and opacity', async () => {
  const session = explorerApp();
  const { app, c } = session;
  c.fetch = explorerFetch();
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  const mounted = mountExplorer(session);
  const map = mounted.instance;
  map.activeFloorId = FLOOR;
  map.loadFloorPlan(FLOOR);
  for (let attempt = 0; attempt < 20 && map.floorPlanState !== 'ready'; attempt += 1) await settle();
  assert.equal(map.floorPlanState, 'ready', map.floorPlanError);
  assert.match(map.floorPlanSrc, /^blob:/);
  assert.equal(map.plan.width, 1600);
  assert.equal(map.plan.height, 1000);

  const fake = FakeMap.last;
  fake.emit('load');
  const source = fake.sources['floor-plan'];
  assert.equal(source.type, 'image');
  assert.equal(source.url, map.floorPlanSrc);
  assert.equal(JSON.stringify(source.coordinates), JSON.stringify([[0, 1], [1.6, 1], [1.6, 0], [0, 0]]));
  assert.equal(map.floorTop(0), 0, 'plan top-left maps to the overlay top');
  assert.equal(map.floorTop(1000), 100, 'plan bottom-left maps to the overlay bottom');
  assert.equal(fake.layers['floor-plan-layer'].source, 'floor-plan');

  map.togglePlan(map.plan);
  assert.equal(fake.layout['floor-plan-layer.visibility'], 'none');
  map.setPlanOpacity(0.4);
  assert.equal(map.prefs.planOpacity, 0.4);
  assert.equal(fake.layout['floor-plan-layer.visibility'], 'none', 'opacity does not silently re-show a hidden plan');
  assert.equal(fake.paint['floor-plan-layer.raster-opacity'], 0.4);

  map.selectAsset(PLACED);
  for (let attempt = 0; attempt < 20 && !map.camera; attempt += 1) await settle();
  assert.equal(map.selectedAsset.name, 'Cámara de acceso');
  assert.equal(map.camera.src, '/api/v1/assets/' + PLACED + '/images/fov');
  assert.equal(mounted.root.children.length > 0, true);
  assert.equal(mounted.errors().length, 0, mounted.errors().join('\n'));
  map.releaseFloorPlan();
  assert.equal(fake.removed, true);
});

test('the graph reads categories, types, sites, counts and opening from its canonical source', () => {
  const session = explorerApp();
  const graph = session.c.options.components.GraphExplorer;
  const canonical = {
    assets: [{ id: PLACED, name: 'Cámara de acceso', site: SITE, category: 'camera' },
      { id: LOOSE, name: 'Grabador de la planta', site: SITE, category: 'virtual' }],
    categories: [{ id: 'camaras', label: 'Cámaras' }],
    sites: [{ id: SITE, label: 'Sede Norte' }],
    relations: { types: [{ id: 'hosts', label: 'Aloja' }], links: [{ id: 'r1', from: LOOSE, to: PLACED }] }
  };
  const opened = [];
  const context = {
    source: canonical,
    selectedId: PLACED,
    app: {
      categories: [{ id: 'wrong', label: 'Prototipo' }],
      sites: [{ id: 'wrong', label: 'Prototipo' }],
      relations: { types: [], links: [] },
      openAsset: (item) => opened.push(item)
    }
  };
  assert.deepEqual(graph.computed.categories.call(context), canonical.categories);
  assert.deepEqual(graph.computed.types.call(context), canonical.relations.types);
  assert.deepEqual(graph.computed.sites.call(context), canonical.sites);
  assert.equal(graph.computed.totalRelations.call(context).links, 1);
  assert.equal(graph.computed.selectedAsset.call(context).id, PLACED);
  graph.methods.openAsset.call(context, PLACED);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].id, PLACED);
  context.selectedId = '';
  graph.watch['app.explorerSelection'].call(context, PLACED);
  assert.equal(context.selectedId, PLACED, 'a canonical map selection survives the graph switch');
  context.selectedId = '';
  context.hiddenIds = [];
  context.$nextTick = () => {};
  graph.watch.focusId.call(context, PLACED);
  assert.equal(context.selectedId, PLACED, 'focused routes select from the canonical graph pool');
});

test('canonical focused explorer routes do not depend on the paginated inventory list', () => {
  const { app } = explorerApp();
  let applied;
  app.parseRoute = () => ({ name: 'graph', focusId: PLACED });
  app.applyRoute = route => { applied = route; };
  app.ensureHash = () => {};
  app.showToast = () => {};
  app.assets = [];
  app.handleHashChange();
  assert.equal(applied.focusId, PLACED, 'the canonical graph endpoint resolves the requested asset');
});
