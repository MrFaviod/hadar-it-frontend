'use strict';
// Follow-up corrections for the blind review (JD-S1, JD-I1, JD-I2).
//
// Each case reproduces one reported public defect against the shipped scripts
// and stylesheet:
//   JD-S1  the graph canvas swallows Enter/Space pressed on its own controls,
//          so expanding the workspace opens the selected asset instead;
//   JD-I1  the favorite reset/44 px rule lost its class dot and no longer
//          matches the rendered button;
//   JD-I2  a restored inventory location keeps filtering the export while the
//          inventory page shows no control that reveals or clears it.
// The cases assert public behaviour (rendered control, navigation, stylesheet
// selector, export payload), not internal call order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');

const FRONTEND = path.resolve(__dirname, '..');
const EXPANDED_GRAPH = 'Salir del grafo ampliado';

function walk(node, out) {
  const list = out || [];
  if (!node) return list;
  list.push(node);
  (node.children || []).forEach((child) => walk(child, list));
  return list;
}

function classesOf(node) {
  const value = node && node.props ? node.props.class : '';
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(' ').split(/\s+/).filter(Boolean);
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
      }
    }
  };
  return tokens;
}

async function mountGraph() {
  const session = setup();
  stubBody(session);
  session.app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: '' };
  // The canonical graph reads the server directory; give it two records so the
  // components under test render real nodes instead of an empty canvas.
  session.app.organization.graph.nodes = [
    { id: 'node-a', name: 'Servidor A', quickCode: 'SRV-A', category: 'servidores', siteId: 'central', status: 'in_use', type: 'Servidor' },
    { id: 'node-b', name: 'Switch B', quickCode: 'SW-B', category: 'switches', siteId: 'central', status: 'in_use', type: 'Switch' }
  ];
  session.app.organization.graph.edges = [
    { id: 'edge-1', fromAssetId: 'node-a', toAssetId: 'node-b', type: 'depends_on', label: 'Depende de' }
  ];
  const mounted = session.mount('GraphExplorer', { app: session.app, focusId: '' });
  mounted.instance.filters.includeIsolated = true;
  await session.tick();
  await session.tick();
  return { session, graph: mounted.instance, mounted };
}

// The browser delivers one keydown that bubbles from the focused element to the
// canvas. The event contract used here is the same one the handler receives.
function keyEvent(key, target) {
  const event = { key, target, prevented: 0 };
  event.preventDefault = () => { event.prevented += 1; };
  return event;
}

// Selecting returns the node currently drawn on the canvas so the expectation
// comes from what the user can actually reach.
function selectFirst(graph) {
  const node = graph.visibleNodes[0];
  assert.ok(node, 'the canvas draws the fixture nodes');
  graph.selectedId = node.id;
  return node;
}

test('Enter and Space on the graph expand control are owned by the control', async () => {
  const { session, graph, mounted } = await mountGraph();
  selectFirst(graph);
  const toggle = findById(mounted.root, 'graph-expand')[0];
  assert.ok(toggle, 'the expand control is rendered');
  assert.equal(toggle.tag, 'button', 'the control is a native button');
  assert.equal(toggle.props.type, 'button', 'a native button activates on Enter and Space');
  assert.equal(typeof toggle.props.onClick, 'function', 'the browser click reaches the expand action');

  for (const key of ['Enter', ' ']) {
    const event = keyEvent(key, toggle);
    graph.onKeydown(event);
    assert.equal(event.prevented, 0, key + ' pressed on the control is not swallowed by the canvas');
    assert.equal(session.app.lastHash, undefined, key + ' on the control must not open the selected asset');
    assert.equal(graph.expanded, false, key + ' on the control does not expand behind the button');
  }

  toggle.props.onClick();
  await session.tick();
  assert.equal(graph.expanded, true, 'the control still expands the workspace through its own click');
});

test('a graph node activation selects instead of opening the record', async () => {
  const { session, graph, mounted } = await mountGraph();
  const asset = selectFirst(graph);
  const node = findByClass(mounted.root, 'gnode')[0];
  assert.ok(node, 'a node is rendered');

  const event = keyEvent('Enter', node);
  graph.onKeydown(event);
  assert.equal(event.prevented, 0, 'the node button owns its Enter activation');
  assert.equal(session.app.lastHash, undefined, 'activating a node never opens ' + asset.id);
});

test('the canvas keeps its own Enter shortcut for the selected asset', async () => {
  const { session, graph, mounted } = await mountGraph();
  const asset = selectFirst(graph);
  const canvas = graph.$refs.canvas || findByClass(mounted.root, 'graph-canvas')[0];
  assert.ok(canvas, 'the canvas is rendered');

  const event = keyEvent('Enter', canvas);
  graph.onKeydown(event);
  assert.equal(event.prevented, 1, 'the canvas owns Enter while it has focus');
  assert.equal(session.app.lastHash, '#/activo/' + encodeURIComponent(asset.id),
    'canvas Enter still opens the selected asset');
});

test('Escape pressed on the expand control still leaves the workspace and keeps the selection', async () => {
  const { graph, mounted } = await mountGraph();
  const nodes = graph.visibleNodes;
  graph.selectedId = nodes.length ? nodes[0].id : '';
  const selected = graph.selectedId;
  graph.toggleExpand();
  await graph.$nextTick();
  assert.equal(graph.expanded, true);
  let focused = 0;
  graph.$refs.expandToggle = { focus: () => { focused += 1; } };
  const toggle = findById(mounted.root, 'graph-expand')[0];

  const event = keyEvent('Escape', toggle);
  graph.onKeydown(event);
  await graph.$nextTick();

  assert.equal(event.prevented, 1, 'the expanded workspace still dismisses on Escape');
  assert.equal(graph.expanded, false, 'Escape leaves the expanded workspace');
  assert.equal(graph.selectedId, selected, 'leaving the workspace keeps the selection the user was reading');
  assert.equal(focused, 1, 'focus returns to the expand control');
  assert.equal(findById(mounted.root, 'graph-expand')[0].props['aria-label'],
    'Ampliar el grafo a ventana completa', 'the control names the expand action again');
});

// ---------------------------------------------------------------- stylesheet
function cssRules(source) {
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(source);
  while (match) {
    rules.push({
      selectors: match[1].split(',').map((item) => item.trim()).filter(Boolean),
      body: match[2]
    });
    match = pattern.exec(source);
  }
  return rules;
}

function declarations(body) {
  const out = {};
  body.split(';').forEach((line) => {
    const index = line.indexOf(':');
    if (index === -1) return;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  });
  return out;
}

test('the favorite control keeps its class selector, 44 px target and reset styles', () => {
  const styles = cssRules(fs.readFileSync(path.join(FRONTEND, 'assets/css/workspace.css'), 'utf8'));
  const rule = styles.find((item) => item.selectors.indexOf('.workspace-favorite') !== -1);
  assert.ok(rule, 'a .workspace-favorite rule exists: an element selector never matches the rendered button');
  const declarationsOfRule = declarations(rule.body);
  assert.equal(declarationsOfRule.width, '44px', 'the icon control keeps its 44 px target');
  assert.equal(declarationsOfRule.height, '44px');
  assert.equal(declarationsOfRule.border, '0', 'the reset removes the default button chrome');
  assert.equal(declarationsOfRule.background, 'transparent');
  assert.equal(declarationsOfRule['border-radius'], '6px');
  assert.equal(declarationsOfRule['font-size'], '24px');
  const straySelector = styles.find((item) => item.selectors.indexOf('workspace-favorite') !== -1);
  assert.equal(straySelector, undefined, 'no rule depends on a non-existent workspace-favorite element');
});

// ---------------------------------------------------------------- inventory
const LOCATION = '5a1e0c10-0003-4f10-9a10-0000000000aa';

function inventorySnapshot(location) {
  return {
    prefs: { category: 'all', site: 'all', search: '', view: 'table', sort: 'name-asc' },
    inventory: { status: 'all', location: location, columns: ['model', 'location', 'assignee', 'ip', 'remote'] },
    selection: []
  };
}

test('a restored inventory location stays visible and clearable in the workspace', async () => {
  const session = setup();
  const app = session.app;
  app.route = { name: 'inventory', personId: '', assetId: '', section: '', focusId: '' };

  app.restoreWorkspaceView({ id: 'view-1', name: 'Planta baja', route: 'inventory', snapshot: inventorySnapshot(LOCATION) });
  await session.tick();

  assert.equal(app.workspaceInventory.location, LOCATION, 'the saved view still restores its location filter');
  assert.ok(Array.isArray(app.workspaceInventoryChips),
    'the inventory page surfaces the restored location so it can be seen and cleared');
  const chips = JSON.parse(JSON.stringify(app.workspaceInventoryChips));
  assert.equal(chips.length, 1, 'exactly one filter the inventory page cannot show is surfaced');
  assert.equal(chips[0].kind, 'location');
  assert.equal(chips[0].id, LOCATION);

  app.removeWorkspaceFilter(chips[0]);
  await session.tick();
  assert.equal(app.workspaceInventory.location, 'all', 'clearing the visible chip clears the applied filter');
  assert.equal(JSON.parse(JSON.stringify(app.workspaceInventoryChips)).length, 0, 'the chip disappears with the filter');
});

test('the surfaced inventory filters carry the catalog labels', () => {
  const session = setup();
  const surface = session.c.AssetWorkspaceRuntime.computed.workspaceInventoryChips;
  assert.ok(surface, 'the runtime exposes the inventory filter surface');
  const surfaced = JSON.parse(JSON.stringify(surface.call({
    route: { name: 'inventory' },
    workspaceInventory: { status: 'in_use', location: LOCATION },
    inventoryStatusChoices: [{ value: 'in_use', label: 'En uso' }],
    workspaceLocations: [{ id: LOCATION, label: 'Sala 1', siteId: 'site-1', fullLabel: 'Sede Norte · Sala 1' }]
  })));
  assert.equal(surfaced.length, 2, 'every restored inventory filter the page cannot show is surfaced');
  assert.equal(surfaced[0].kind, 'status');
  assert.equal(surfaced[0].label, 'En uso', 'the status chip uses the catalog label');
  assert.equal(surfaced[1].kind, 'location');
  assert.equal(surfaced[1].label, 'Sala 1', 'the location chip names the location with the catalog label the user chose');

  // Real server records: the canonical page row already carries the display label.
  const fromPage = JSON.parse(JSON.stringify(surface.call({
    route: { name: 'inventory' },
    workspaceInventory: { location: LOCATION },
    inventoryStatusChoices: [],
    workspaceLocations: [],
    inventoryItems: [{ id: 'asset-1', locationId: LOCATION, location: 'Sala 1' }]
  })));
  assert.equal(fromPage[0].label, 'Sala 1', 'the chip names the location through the loaded inventory row');

  const unknown = JSON.parse(JSON.stringify(surface.call({
    route: { name: 'inventory' },
    workspaceInventory: { location: LOCATION },
    inventoryStatusChoices: [],
    workspaceLocations: []
  })));
  assert.equal(unknown[0].label, LOCATION, 'an unknown id is shown as stored, never invented');
  const other = surface.call({
    route: { name: 'map' },
    workspaceInventory: { location: LOCATION },
    inventoryStatusChoices: [],
    workspaceLocations: []
  });
  assert.equal(other.length, 0, 'only the inventory route needs the extra chips');
});

test('export keeps canonical inventory filters and only drops the cleared location', () => {
  const session = setup();
  const exportFilters = session.c.AssetTransferViews.TransferExport.computed.exportFilters;
  const withLocation = JSON.parse(JSON.stringify(exportFilters.call({
    app: { inventoryFilters: { category: 'camaras', status: 'in_use' }, workspaceInventory: { location: LOCATION } }
  })));
  assert.equal(withLocation.category, 'camaras', 'the canonical category filter is untouched');
  assert.equal(withLocation.status, 'in_use', 'the canonical status filter is untouched');
  assert.equal(withLocation.location_id, LOCATION, 'an applied location still narrows the export');

  const cleared = JSON.parse(JSON.stringify(exportFilters.call({
    app: { inventoryFilters: { category: 'camaras', status: 'in_use' }, workspaceInventory: { location: 'all' } }
  })));
  assert.equal(cleared.category, 'camaras', 'clearing the location keeps the ordinary filters');
  assert.equal(cleared.status, 'in_use');
  assert.equal(Object.hasOwn(cleared, 'location_id'), false, 'clearing the visible chip removes the export filter');
});
