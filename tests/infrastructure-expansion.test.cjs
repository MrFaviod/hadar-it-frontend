'use strict';
// T6: the map and graph canvases are the primary infrastructure workspace.
// Both owners gain an in-app full-window expanded state that must keep the
// incumbent state alive: filters, selection, camera/zoom, the MapLibre instance
// and the running force simulation. Expanding is a layout change, never a
// remount, so none of those objects may be recreated or re-fitted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const COLLAPSE_MAP = 'Salir del mapa ampliado';
const EXPAND_MAP = 'Ampliar el mapa a ventana completa';
const COLLAPSE_GRAPH = 'Salir del grafo ampliado';

class FakeMap {
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.sources = {};
    this.layers = {};
    this.layout = {};
    this.paint = {};
    this.zoom = 8.4;
    this.center = { lat: -25.28, lng: -57.63 };
    this.resizes = 0;
    this.cameras = [];
    this.removed = false;
    FakeMap.last = this;
  }

  on(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); }
  emit(type) { (this.handlers[type] || []).forEach((handler) => handler({ type: type })); }
  resize() { this.resizes += 1; }
  getZoom() { return this.zoom; }
  getCenter() { return this.center; }
  easeTo(options) { this.cameras.push(options); }
  fitBounds(options) { this.cameras.push(options); }
  zoomIn() {}
  zoomOut() {}
  project(point) { return { x: Number(point[0]) / 8 + 40, y: Number(point[1]) / -8 + 90 }; }
  addSource(id, source) { this.sources[id] = source; }
  addLayer(layer) { this.layers[layer.id] = layer; }
  setLayoutProperty(id, key, value) { this.layout[id + '.' + key] = value; }
  setPaintProperty(id, key, value) { this.paint[id + '.' + key] = value; }
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
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function findById(root, id) {
  return walk(root).filter((node) => node.props && node.props['data-od-id'] === id);
}

function findByClass(root, token) {
  return walk(root).filter((node) => classesOf(node).indexOf(token) !== -1);
}

function stubBody(session) {
  const tokens = new Set();
  session.c.document.body = {
    style: {},
    classList: {
      add: (name) => tokens.add(name),
      remove: (name) => tokens.delete(name),
      toggle: (name, force) => {
        const on = force === undefined ? !tokens.has(name) : !!force;
        if (on) tokens.add(name); else tokens.delete(name);
        return on;
      },
      contains: (name) => tokens.has(name)
    }
  };
  return tokens;
}

async function mountMap() {
  const session = setup();
  stubBody(session);
  session.c.window.maplibregl = { Map: FakeMap };
  session.app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  const mounted = session.mount('MapExplorer', { app: session.app, focusId: '' });
  await session.tick();
  await session.tick();
  const map = mounted.instance;
  const fake = FakeMap.last;
  fake.emit('load');
  await session.tick();
  return { session, map, fake, mounted };
}

async function mountGraph() {
  const session = setup();
  stubBody(session);
  session.app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: '' };
  const mounted = session.mount('GraphExplorer', { app: session.app, focusId: '' });
  await session.tick();
  await session.tick();
  return { session, graph: mounted.instance, mounted };
}

test('the map canvas expands into a full-window workspace and resizes MapLibre without moving it', async () => {
  const { session, map, fake, mounted } = await mountMap();
  const asset = (session.app.assets || [])[0];
  map.filters.categories = ['computadoras'];
  map.selectedId = asset ? asset.id : '';
  const before = { zoom: fake.getZoom(), center: Object.assign({}, fake.getCenter()), cameras: fake.cameras.length, resizes: fake.resizes };

  map.toggleExpand();
  await session.tick();
  await session.tick();

  assert.equal(map.expanded, true, 'the map reports its expanded state');
  assert.ok(fake.resizes > before.resizes, 'MapLibre is resized after the container grows');
  assert.equal(fake.cameras.length, before.cameras, 'expanding does not re-position or re-fit the camera');
  assert.equal(fake.getZoom(), before.zoom, 'the zoom level survives the expansion');
  assert.deepEqual(Object.assign({}, fake.getCenter()), before.center, 'the centre survives the expansion');
  assert.deepEqual(Array.from(map.filters.categories), ['computadoras'], 'filters survive the expansion');
  assert.equal(map.selectedId, asset ? asset.id : '', 'the selected asset survives the expansion');
  assert.ok(findByClass(mounted.root, 'is-expanded').length > 0, 'the page renders the expanded layout state');
  const toggles = findById(mounted.root, 'map-expand');
  assert.equal(toggles.length, 1, 'one expand control exists on the map');
  assert.equal(toggles[0].props['aria-pressed'], 'true');
  assert.equal(toggles[0].props['aria-label'], COLLAPSE_MAP, 'the control names the exit action once expanded');
  assert.ok(session.c.document.body.classList.contains('map-workspace-expanded'), 'the expanded workspace locks the page behind it');
});

test('Escape leaves the expanded map, resizes back and returns focus to the control', async () => {
  const { session, map, fake, mounted } = await mountMap();
  map.filters.states = ['in_use'];
  const asset = (session.app.assets || [])[0];
  map.selectedId = asset ? asset.id : '';
  map.toggleExpand();
  await session.tick();
  let focused = 0;
  let prevented = 0;
  map.$refs.expandToggle = { focus: () => { focused += 1; } };
  const resizes = fake.resizes;

  map.onStageKeydown({ key: 'Escape', preventDefault: () => { prevented += 1; } });
  await session.tick();
  await session.tick();

  assert.equal(prevented, 1, 'Escape is handled by the expanded workspace');
  assert.equal(map.expanded, false);
  assert.ok(fake.resizes > resizes, 'MapLibre is resized again when the canvas shrinks');
  assert.equal(focused, 1, 'focus returns to the expand control');
  assert.deepEqual(Array.from(map.filters.states), ['in_use'], 'filters survive the exit');
  assert.equal(map.selectedId, asset ? asset.id : '', 'the selection survives the exit');
  assert.ok(!session.c.document.body.classList.contains('map-workspace-expanded'), 'the page scroll lock is released');
  const toggles = findById(mounted.root, 'map-expand');
  assert.equal(toggles[0].props['aria-pressed'], 'false');
  assert.equal(toggles[0].props['aria-label'], EXPAND_MAP, 'the control names the expand action again');
});

test('Escape outside the expanded workspace is left to the rest of the page', async () => {
  const { map } = await mountMap();
  let focused = 0;
  let prevented = 0;
  map.$refs.expandToggle = { focus: () => { focused += 1; } };

  map.onStageKeydown({ key: 'Escape', preventDefault: () => { prevented += 1; } });
  map.onStageKeydown({ key: 'Tab', preventDefault: () => { prevented += 1; } });

  assert.equal(map.expanded, false);
  assert.equal(prevented, 0, 'a collapsed map does not swallow Escape or Tab');
  assert.equal(focused, 0);
});

test('the graph canvas expands into a full-window workspace without rebuilding the layout', async () => {
  const { session, graph, mounted } = await mountGraph();
  const asset = (session.app.assets || [])[0];
  graph.selectedId = asset ? asset.id : '';
  const sim = graph.sim;
  const zoom = graph.view.k;
  const nodes = graph.stats.nodes;

  graph.toggleExpand();
  await session.tick();
  await session.tick();

  assert.equal(graph.expanded, true);
  assert.equal(graph.sim, sim, 'expanding reuses the running simulation instead of rebuilding it');
  assert.equal(graph.view.k, zoom, 'the zoom level survives the expansion');
  assert.equal(graph.stats.nodes, nodes, 'the visible node set is unchanged');
  assert.equal(graph.selectedId, asset ? asset.id : '', 'the selection survives the expansion');
  assert.ok(findByClass(mounted.root, 'is-expanded').length > 0, 'the page renders the expanded layout state');
  const toggles = findById(mounted.root, 'graph-expand');
  assert.equal(toggles.length, 1, 'one expand control exists on the graph');
  assert.equal(toggles[0].props['aria-pressed'], 'true');
  assert.equal(toggles[0].props['aria-label'], COLLAPSE_GRAPH);
  assert.ok(session.c.document.body.classList.contains('graph-workspace-expanded'), 'the expanded workspace locks the page behind it');
});

test('a real canvas size change keeps the graph world centre and the same simulation', async () => {
  const { graph } = await mountGraph();
  graph.toggleExpand();
  await graph.$nextTick();
  const sim = graph.sim;
  const before = graph.toWorld(480, 280);
  const zoomBefore = graph.view.k;
  graph.$refs.canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });

  graph.handleResize();

  const after = graph.toWorld(720, 450);
  assert.equal(graph.sim, sim, 'resizing never recreates the simulation');
  assert.ok(Math.abs(after.x - before.x) < 0.5 && Math.abs(after.y - before.y) < 0.5, 'the same world point stays centred');
  assert.equal(graph.view.k, zoomBefore, 'the zoom level is not reset by the resize');
});

test('Escape leaves the expanded graph and keeps the selection the user was reading', async () => {
  const { graph } = await mountGraph();
  const nodes = graph.visibleNodes;
  graph.selectedId = nodes.length ? nodes[0].id : '';
  const selected = graph.selectedId;
  graph.toggleExpand();
  await graph.$nextTick();

  graph.onKeydown({ key: 'Escape', preventDefault: () => {} });
  assert.equal(graph.expanded, false, 'Escape leaves the expanded workspace');
  assert.equal(graph.selectedId, selected, 'leaving the workspace does not drop the selection');

  graph.onKeydown({ key: 'Escape', preventDefault: () => {} });
  assert.equal(graph.selectedId, '', 'a second Escape still clears the selection, as before');
});

test('a selection mutes unrelated nodes and edges without changing the relation data', async () => {
  const session = setup();
  const graph = session.c.options.components.GraphExplorer;
  const context = {
    selectedId: 'a',
    baseEdges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'c', to: 'd' }],
    neighbourIds: graph.methods.neighbourIds
  };

  assert.equal(graph.methods.isRelated.call(context, 'a'), true);
  assert.equal(graph.methods.isRelated.call(context, 'b'), true, 'a direct neighbour stays at full weight');
  assert.equal(graph.methods.isRelated.call(context, 'c'), false, 'an unrelated node is muted');
  context.selectedId = '';
  assert.equal(graph.methods.isRelated.call(context, 'c'), true, 'without a selection every node keeps its weight');
});

test('inventory status keeps its administrative label instead of the stored code', () => {
  const session = setup();
  const map = session.c.options.components.MapExplorer.methods;
  const graph = session.c.options.components.GraphExplorer.methods;
  const bare = { app: {} };

  assert.equal(map.statusLabel.call(bare, { status: 'in_use' }), 'Asignado', 'the built-in state reads in the active locale');
  assert.equal(map.statusLabel.call(bare, { status: 'retired' }), 'Dado de baja');
  assert.equal(graph.statusLabel.call(bare, { status: 'in_use' }), 'Asignado', 'both inspectors share the contract');
  assert.equal(map.statusLabel.call(bare, { status: '' }), '', 'an unspecified status stays empty');
});

test('a status configured on the server keeps its own label and custom ids are never invented', () => {
  const session = setup();
  const map = session.c.options.components.MapExplorer.methods;
  const renamed = { app: { assetAdmin: { statuses: [{ id: 'in_use', label: 'En producción' }] } } };
  const custom = { app: { assetAdmin: { statuses: [{ id: 'loaned', label: 'Prestado' }] } } };

  assert.equal(map.statusLabel.call(renamed, { status: 'in_use' }), 'En producción',
    'the server catalog wins over the built-in text');
  assert.equal(map.statusLabel.call(custom, { status: 'loaned' }), 'Prestado',
    'a custom status keeps the label the server stores');
  assert.equal(map.statusLabel.call({ app: {} }, { status: 'loaned' }), 'loaned',
    'without a catalog entry the stored value is shown, never a fabricated label');
});

test('the family legend follows the active locale and never invents a label', () => {
  const session = setup();
  const c = session.c;
  const map = c.options.components.MapExplorer.computed;
  const graph = c.options.components.GraphExplorer.computed;
  const mapContext = {
    filters: { categories: [] },
    source: { assets: [{ category: 'servidores' }, { category: 'switches' }] }
  };
  const graphContext = { visibleNodes: [{ category: 'servidores' }, { category: 'switches' }] };
  const labels = (computed, context) => Array.from(computed.legend.call(context), (item) => item.label);

  c.ItsmI18n.setLocale('en');
  assert.deepEqual(labels(map, mapContext), ['Servers and storage', 'Network and surveillance'],
    'the map legend reads the built-in families in English');
  assert.deepEqual(labels(graph, graphContext), ['Servers and storage', 'Network and surveillance'],
    'the graph legend reads the built-in families in English');

  c.ItsmI18n.setLocale('es');
  assert.deepEqual(labels(map, mapContext), ['Servidores y almacenamiento', 'Red y vigilancia'],
    'the map legend reads the same families in Spanish');
  assert.deepEqual(labels(graph, graphContext), ['Servidores y almacenamiento', 'Red y vigilancia'],
    'the graph legend reads the same families in Spanish');

  assert.equal(c.AssetRelationsData.familyLabel('custom_family'), 'custom_family',
    'an unknown family id is shown as stored, never replaced by a built-in label');

  const runtime = c.ItsmI18n;
  c.ItsmI18n = null;
  assert.equal(c.AssetRelationsData.familyLabel('server'), 'Servidores y almacenamiento',
    'without an installed catalog the authored text is still readable');
  c.ItsmI18n = runtime;
});

test('a server category label wins over the imported prototype placeholder table', () => {
  const session = setup();
  const graph = session.c.options.components.GraphExplorer.methods;
  const serverFirst = { app: { assetAdmin: { statuses: [] } }, categories: [{ id: 'camaras', label: 'Cámaras IP' }] };

  assert.equal(graph.categoryLabel.call(serverFirst, 'camaras'), 'Cámaras IP',
    'the catalog label is authoritative for a server category id');
  assert.equal(graph.categoryLabel.call({ categories: [] }, 'computadoras'), 'Computadoras',
    'ids without catalog data still resolve through the prototype table');
});
