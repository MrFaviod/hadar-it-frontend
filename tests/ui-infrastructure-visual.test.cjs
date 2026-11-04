/* Visual coverage unit U7 (map/floor/graph) component contracts.
 *
 * The browser pass in `ui-infrastructure-visual.browser.py` renders the real
 * server-backed surfaces; these Node checks pin the presentation rules that the
 * rendered inspection found, so a regression fails without a browser run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');

const EMPTY_FILTERS = { categories: [], sites: [], states: [], locations: [], search: '' };

/* A canonical server-mode source: rooms come from the directory and carry no
 * plan geometry of their own (only prototype plans author x/y/w/h). */
function sourceWith(rooms) {
  return {
    sites: [{ id: 'site-1', label: 'Sede U7' }],
    assets: [
      { id: 'asset-srv', code: 'SRV-U7', name: 'Servidor U7', category: 'servidores', site: 'site-1', locationId: 'room-a', status: 'in_use' },
      { id: 'asset-sw', code: 'SW-U7', name: 'Switch U7', category: 'switches', site: 'site-1', locationId: 'room-a', status: 'in_use' },
      { id: 'asset-cam', code: 'CAM-U7', name: 'Cámara U7', category: 'camaras', site: 'site-1', locationId: 'room-b', status: 'in_use' },
      { id: 'asset-nb', code: 'NB-U7', name: 'Notebook U7', category: 'otros', site: 'site-1', locationId: 'floor-1', status: 'in_use' }
    ],
    maps: {
      sites: [{ id: 'site-1', label: 'Sede U7' }],
      buildings: [{ id: 'bld-1', site: 'site-1', name: 'Edificio U7' }],
      floors: [{ id: 'floor-1', building: 'bld-1', site: 'site-1', name: 'Planta baja U7' }],
      rooms: rooms,
      plans: [],
      positions: {},
      geo: {},
      serverMap: true
    }
  };
}

function floorOf(c, source) {
  return c.AssetMapEngine.floorView(source, EMPTY_FILTERS, 'floor-1');
}

function chipsOf(c, floorView) {
  return c.AssetMapFloorLogic.computed.roomChips.call({ floorView: floorView });
}

function looseGroupsOf(c, floorView, chips) {
  const computed = c.options.components.MapExplorer.computed;
  return computed.floorLooseGroups.call({ floorView: floorView, roomChips: chips });
}

test('a room without plan geometry never becomes a canvas chip', () => {
  const { c } = setup();
  const floorView = floorOf(c, sourceWith([{ id: 'room-a', floor: 'floor-1', name: 'Sala de servidores' }]));
  assert.equal(floorView.rooms[0].count, 2, 'the room still owns its two assets');

  const chips = chipsOf(c, floorView);
  assert.equal(chips.length, 0, 'a server room has no authored position, so it draws no chip');
  chips.forEach((chip) => {
    assert.ok(Number.isFinite(chip.x) && Number.isFinite(chip.y), 'chip centre must be a real coordinate: ' + JSON.stringify(chip));
  });
});

test('assets of a geometry-less room stay reachable through the loose panel', () => {
  const { c } = setup();
  const floorView = floorOf(c, sourceWith([{ id: 'room-a', floor: 'floor-1', name: 'Sala de servidores' }]));
  const chips = chipsOf(c, floorView);
  const groups = looseGroupsOf(c, floorView, chips);

  assert.equal(groups.map((group) => group.id).join(','), 'room-a,floor-orphans', 'the room keeps its own group');
  const roomGroup = groups.find((group) => group.id === 'room-a');
  assert.equal(roomGroup.assets.map((asset) => asset.code).join(','), 'SRV-U7,SW-U7');
});

test('a floor mixes authored plan rooms with geometry-less directory rooms', () => {
  const { c } = setup();
  const floorView = floorOf(c, sourceWith([
    { id: 'room-a', floor: 'floor-1', name: 'Sala de servidores' },
    { id: 'room-b', floor: 'floor-1', name: 'Oficina técnica', x: 120, y: 80, w: 400, h: 260 }
  ]));
  const chips = chipsOf(c, floorView);

  assert.equal(chips.map((chip) => chip.id).join(','), 'room-b', 'only the authored room is drawn on the plan');
  assert.equal([chips[0].x, chips[0].y].join(','), '320,210', 'the authored centre is unchanged');

  const groups = looseGroupsOf(c, floorView, chips);
  assert.equal(groups.map((group) => group.id).join(','), 'room-a,floor-orphans');
  assert.equal(groups[0].name, 'Sala de servidores');
});

test('an unassigned asset still groups under the floor orphan bucket', () => {
  const { c } = setup();
  const floorView = floorOf(c, sourceWith([
    { id: 'room-a', floor: 'floor-1', name: 'Sala de servidores' },
    { id: 'room-b', floor: 'floor-1', name: 'Oficina técnica' }
  ]));
  const groups = looseGroupsOf(c, floorView, chipsOf(c, floorView));
  const orphans = groups.find((group) => group.id === 'floor-orphans');

  assert.ok(orphans, 'the notebook sits on the floor with no room');
  assert.equal(orphans.assets.map((asset) => asset.code).join(','), 'NB-U7');
  assert.equal(orphans.name, 'Sin sala asignada en esta planta');
});

function floorEmptyMessage(c, source, floorId) {
  return c.AssetMapFloorLogic.computed.floorEmptyMessage.call({
    source: source,
    activeFloorId: floorId
  });
}

test('the floor empty state only blames filters when a filter hides the assets', () => {
  const { c } = setup();
  const bare = {
    sites: [],
    assets: [],
    maps: {
      sites: [], buildings: [], rooms: [], plans: [], positions: {}, geo: {},
      floors: [{ id: 'floor-1', building: 'bld-1', site: 'site-1', name: 'Planta baja U7' }]
    }
  };

  assert.equal(floorEmptyMessage(c, bare, 'floor-1'), 'ui.map.floor.empty',
    'a floor with no assets at all must not claim a filter mismatch');
  assert.equal(floorEmptyMessage(c, sourceWith([]), 'floor-1'), 'ui.map.floor.no_match',
    'a floor whose assets are filtered out keeps the filter message');
});

test('the graph empty state distinguishes an empty inventory from filtered-out assets', () => {
  const { c } = setup();
  const computed = c.options.components.GraphExplorer.computed;
  const message = (assets) => computed.emptyMessage.call({ source: { assets: assets } });

  assert.equal(message([]), 'ui.graph.empty.no_assets',
    'an empty inventory must not claim the active filters exclude everything');
  assert.equal(message([{ id: 'asset-1' }]), 'ui.graph.empty.no_match',
    'assets hidden by filters keep the filter message');
});

function dragContext(c) {
  const methods = c.AssetMapFloorLogic.methods;
  const context = {
    $refs: {
      paper: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }) },
      floorCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }) }
    },
    serverMapMode: false,
    canEdit: true,
    drag: null,
    announce: '',
    activeFloorId: 'floor-1',
    source: {
      assets: [{ id: 'asset-srv', code: 'SRV-U7', name: 'Servidor U7', locationId: 'floor-1' }],
      maps: { positions: { 'asset-srv': { floor: 'floor-1', x: 300, y: 200 } } }
    },
    app: { serverMapMode: false },
    persisted: [],
    persistServerPosition(id, floorId) {
      this.persisted.push([id, floorId]);
    }
  };
  context.maps = context.source.maps;
  return context;
}

function down(c, context) {
  const methods = c.AssetMapFloorLogic.methods;
  methods.startMarkerDrag.call(context, { asset: { id: 'asset-srv' }, count: 1 }, {
    button: 0, clientX: 100, clientY: 100, preventDefault() {}
  });
}

test('clicking a floor marker selects it without writing a new position', () => {
  const { c } = setup();
  const methods = c.AssetMapFloorLogic.methods;
  const context = dragContext(c);

  down(c, context);
  methods.onMarkerUp.call(context);

  assert.equal(context.persisted.length, 0,
    'a pointer that never moved is a click, not a reposition, so no write is issued');
  assert.equal(context.announce, '', 'no move means no position announcement');
});

test('dragging a floor marker still persists the new position once', () => {
  const { c } = setup();
  const methods = c.AssetMapFloorLogic.methods;
  const context = dragContext(c);

  down(c, context);
  methods.onMarkerMove.call(context, { clientX: 180, clientY: 140 });
  methods.onMarkerUp.call(context);

  assert.equal(context.persisted.map((entry) => entry.join('@')).join(','), 'asset-srv@floor-1',
    'a real drag writes the position for the active floor');
  assert.equal(context.announce.indexOf('Servidor U7') !== -1, true, 'the move is announced');
});

test('the map status filter lists the administrative label, not the stored code', () => {
  // The rendered filter panel showed `in_use` next to a "Asignado" inspector:
  // both read the same administrative status, so both must use its label.
  const { c } = setup();
  const ctx = {
    source: {
      assets: [
        { id: 'a', status: 'in_use' },
        { id: 'b', status: 'in_use' },
        { id: 'c', status: 'retired_custom' }
      ]
    },
    app: { assetAdmin: { statuses: [{ id: 'in_use', label: 'Asignado' }] } }
  };
  const methods = c.options.components.MapExplorer.methods;
  ctx.statusLabel = function statusLabel(asset) {
    return methods.statusLabel.call(ctx, asset);
  };
  const labels = c.options.components.MapExplorer.computed.statuses.call(ctx);
  assert.equal(labels.join(','), 'Asignado,retired_custom');
});

test('the site metrics agree with the number they count', () => {
  const { c } = setup();
  c.ItsmI18n.setLocale('es');
  assert.equal(c.ItsmI18n.t('ui.map.metric.cameras', 1), 'cámara');
  assert.equal(c.ItsmI18n.t('ui.map.metric.cameras', 3), 'cámaras');
  assert.equal(c.ItsmI18n.t('ui.map.metric.floors', 1), 'planta');
  assert.equal(c.ItsmI18n.t('ui.map.metric.filtered', 1), 'activo con filtros');
  assert.equal(c.ItsmI18n.t('ui.map.floor.asset_count', 1), 'activo');
  assert.equal(c.ItsmI18n.t('ui.map.floor.asset_count', 5), 'activos');
  c.ItsmI18n.setLocale('en');
  assert.equal(c.ItsmI18n.t('ui.map.floor.asset_count', 1), 'asset');
  assert.equal(c.ItsmI18n.t('ui.map.metric.cameras', 1), 'camera');
  assert.equal(c.ItsmI18n.t('ui.map.metric.cameras', 2), 'cameras');
});

test('the page summary and the floor header agree with their counts', () => {
  // The rendered header read "1 activos · 1 sedes · 3 plantas · 1 planos": each
  // count now carries its own plural form instead of one fixed sentence.
  const { c } = setup();
  const computed = c.options.components.MapExplorer.computed;
  const methods = c.options.components.MapExplorer.methods;
  c.ItsmI18n.setLocale('es');
  const ctx = { counts: { assets: 1, sites: 1, floors: 3, plans: 1 } };
  assert.equal(computed.metaSegments.call(ctx), '1 activo · 1 sede · 3 plantas · 1 plano');
  assert.equal(methods.floorMeta.call(ctx, 1, 0), '1 activo · 0 posicionados');
  assert.equal(methods.floorMeta.call(ctx, 5, 2), '5 activos · 2 posicionados');
  c.ItsmI18n.setLocale('en');
  assert.equal(computed.metaSegments.call(ctx), '1 asset · 1 site · 3 floors · 1 plan');
  assert.equal(methods.floorMeta.call(ctx, 1, 1), '1 asset · 1 positioned');
});

test('the graph explains the server boundary without dropping loaded isolates', () => {
  const { c } = setup();
  const graph = c.options.components.GraphExplorer;
  const filters = { ...EMPTY_FILTERS, types: [], includeIsolated: true };

  // The canonical global payload is edge-derived, so the filter hint says so.
  const serverHint = graph.computed.filterHint.call({ app: { serverGraphMode: true } });
  const prototypeHint = graph.computed.filterHint.call({ app: { serverGraphMode: false } });
  assert.equal(serverHint, 'ui.graph.filter.hint_server');
  assert.equal(prototypeHint, 'ui.graph.filter.hint');

  // An isolate that a payload does carry is still rendered and still filterable:
  // the note explains the backend contract, it never hides loaded assets.
  const source = {
    assets: [
      { id: 'asset-srv', code: 'SRV-U7', name: 'Servidor U7', category: 'servidores', status: 'in_use' },
      { id: 'asset-sw', code: 'SW-U7', name: 'Switch U7', category: 'switches', status: 'in_use' },
      { id: 'asset-lonely', code: 'LONELY-U7', name: 'Equipo suelto', category: 'otros', status: 'in_use' }
    ],
    relations: {
      types: [{ id: 'depends_on', forward: 'Depende de', inverse: 'Sostiene', tone: 'dependency' }],
      links: [{ id: 'link-1', from: 'asset-srv', to: 'asset-sw', type: 'depends_on' }]
    },
    sites: [],
    categories: []
  };
  const context = {
    source,
    filters: { ...filters },
    mode: 'global',
    focusAssetId: '',
    prefs: { depth: 2, group: 'category' },
    hiddenIds: [],
    app: { serverGraphMode: true }
  };
  const ids = (data) => data.nodes.map((node) => node.id).sort().join(',');
  assert.equal(ids(graph.computed.baseData.call(context)), 'asset-lonely,asset-srv,asset-sw');
  context.filters = { ...filters, includeIsolated: false };
  assert.equal(ids(graph.computed.baseData.call(context)), 'asset-srv,asset-sw');
});

test('the graph page summary never prints a count twice', () => {
  const { c } = setup();
  const template = c.options.components.GraphExplorer.template;
  const meta = template.slice(template.indexOf('page-head__meta'));
  const head = meta.slice(0, meta.indexOf('</div>'));
  assert.equal(head.includes('class="mono"'), false,
    'the plural messages carry the count, so the summary prints no bare number beside them');
});

test('the server graph notice names every truncation reason it can receive', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('ui.organization.config.graph_truncated_prefix');
  assert.ok(start > 0, 'the notice still exists');
  const notice = html.slice(start, start + 1400);
  assert.match(notice, /graph_truncated_depth/,
    'a depth cut has its own reason instead of an empty notice');
  assert.match(notice, /graph_truncated_unknown/,
    'an unknown future reason still produces a truthful bounded notice');
  assert.match(notice, /graph_truncated_nodes/, 'node truncation keeps its reason');
  assert.match(notice, /graph_truncated_edges/, 'edge truncation keeps its reason');
});

test('the server graph notice pluralizes the counts it prints', () => {
  const { c } = setup();
  const t = (key, count) => c.ItsmI18n.t(key, count);
  c.ItsmI18n.setLocale('es');
  assert.equal(t('ui.organization.config.graph_count_nodes', 1), 'nodo');
  assert.equal(t('ui.organization.config.graph_count_nodes', 2), 'nodos');
  assert.equal(t('ui.organization.config.graph_count_edges', 1), 'relación');
  assert.equal(t('ui.organization.config.graph_count_edges', 2), 'relaciones');
  c.ItsmI18n.setLocale('en');
  assert.equal(t('ui.organization.config.graph_count_nodes', 1), 'node');
  assert.equal(t('ui.organization.config.graph_count_edges', 1), 'relationship');
  assert.equal(t('ui.organization.config.graph_count_edges', 2), 'relationships');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(html.includes("ui.organization.config.graph_counts'"), false,
    'the notice no longer prints a fixed plural through a placeholder');
});
