'use strict';
// Phase 5 host move (S12). The operative blocker B7 left the canonical move
// adapter-correct but without a rendered consumer: the panel offered «Cambiar
// host» and nothing opened. These tests mount the real component, drive the
// real Vue controls and observe the effects the browser must produce:
//   1 the action opens a dialog that names the canonical child (edge source)
//   2 the destination list is a bounded server search bound to its own input
//   3 choosing a host and confirming posts the canonical payload and refreshes
//     relations, the open asset detail/history and the graph
//   4 a server rejection keeps the dialog, the factual message and the old edge
//   5 the server's reason minimum is never bypassed by the client
//   6 a move resolved after logout reports no success and revives nothing
// Permissions come from the real AssetAccess.can/requirePermission; the harness
// always-true lambda is replaced, never used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PERSON_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const SITE_ID = '5a1e0c10-0001-4f10-9a10-000000000001';
const FLOOR_ID = '5a1e0c10-0003-4f10-9a10-000000000003';
const CHILD_ID = '11111111-2222-3333-4444-555555555555';
const OLD_HOST_ID = '99999999-8888-7777-6666-555555555555';
const NEW_HOST_ID = '22222222-3333-4444-5555-666666666666';
const EDGE_ID = 'ffffffff-1111-2222-3333-444444444444';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function failure(message, status) {
  const code = status || 409;
  return { ok: false, status: code, json: async () => ({ error: { code: 'conflict', message } }) };
}

function stub(c, handler) {
  const calls = [];
  c.fetch = async (url, init) => {
    const call = { url, init: init || {}, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  };
  return calls;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function settle() {
  return new Promise((done) => setTimeout(done, 0));
}

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function route(name, extra) {
  return Object.assign({ name, personId: '', assetId: '', section: '', focusId: '' }, extra || {});
}

// Authenticated session whose authorization methods are the real ones.
function serverApp(permissions) {
  const session = setup();
  const { c, app } = session;
  app.serverPermissions = permissions.slice();
  app.csrfToken = 'csrf-test-token';
  ['can', 'canConfig', 'requirePermission', 'accessRoute'].forEach((name) => {
    app[name] = c.options.methods[name].bind(app);
  });
  return session;
}

// The real session teardown the root component runs: logout request, identity
// reset and the authenticated watcher.
async function logout(session) {
  const { c, app } = session;
  assert.equal(await app.logout(), true, 'the fixture logs out through the real method');
  assert.equal(app.authenticated, false);
  const watcher = c.options.watch.authenticated;
  assert.equal(typeof watcher, 'function');
  watcher.call(app, false);
  await c.Vue.nextTick();
}

function assetDto(overrides) {
  return Object.assign({
    id: CHILD_ID,
    quickCode: 'SRV-CHILD-001',
    name: 'Servidor de aplicaciones',
    category: 'Servidores',
    type: 'Servidor',
    brand: 'Dell',
    model: 'R650',
    serial: 'SN-CHILD',
    ip: '10.0.0.21',
    site: 'Sede Central',
    location: 'Piso 2',
    siteId: SITE_ID,
    locationId: FLOOR_ID,
    responsiblePersonId: null,
    responsibleLabel: '',
    positionX: null,
    positionY: null,
    status: 'in_use',
    description: '',
    archived: false,
    images: [],
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-06T11:30:00Z'
  }, overrides || {});
}

function typeDto(overrides) {
  return Object.assign({
    key: 'hosted_in',
    forwardLabel: 'Alojado en',
    inverseLabel: 'Aloja',
    containment: true,
    active: true
  }, overrides || {});
}

function edgeDto(overrides) {
  return Object.assign({
    id: EDGE_ID,
    typeKey: 'hosted_in',
    forwardLabel: 'Alojado en',
    inverseLabel: 'Aloja',
    containment: true,
    typeActive: true,
    sourceId: CHILD_ID,
    targetId: OLD_HOST_ID,
    reason: 'Reubicación',
    notes: '',
    effectiveAt: null,
    createdAt: '2026-01-02T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    direction: 'outgoing',
    label: 'Alojado en'
  }, overrides || {});
}

function hostDto(overrides) {
  return assetDto(Object.assign({
    id: NEW_HOST_ID,
    quickCode: 'HOST-NEW-002',
    name: 'Host alternativo',
    type: 'Host',
    category: 'Servidores'
  }, overrides || {}));
}

/* ------------------------------------------------------------ render helpers */

function walk(node, out) {
  const list = out || [];
  if (!node || typeof node !== 'object') return list;
  list.push(node);
  for (const child of node.children || []) walk(child, list);
  return list;
}

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

function nodesWhere(root, predicate) {
  return walk(root).filter(predicate);
}

function nodeByProp(root, prop, value) {
  return walk(root).find((node) => node.props && node.props[prop] === value) || null;
}

function buttonsWithText(root, text) {
  return nodesWhere(root, (node) => node.tag === 'button' && textOf(node).indexOf(text) !== -1);
}

// Drives a real native `v-model` input through the listener the mounted
// template registered, so the assertion covers the shipped binding.
function typeInto(node, value) {
  assert.ok(node, 'the input is rendered');
  assert.equal(typeof (node.listeners || {}).input, 'function', 'the input keeps its native input listener');
  node.value = value;
  node.listeners.input({ target: node });
}

function requireErrors(session, label) {
  const errors = session.errors.map((error) => (error && error.name) + ': ' + (error && error.message));
  assert.deepEqual(errors, [], label + ' renders without error');
}

// One authenticated asset page with one hosted_in relation on the child and a
// server asset page for the destination search.
function relationSession(options) {
  const settings = options || {};
  const session = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const { c, app } = session;
  app.route = route('detail', { assetId: CHILD_ID });
  app.organization.types.items = [typeDto()];
  app.organization.types.loaded = true;
  app.organization.relations.assetId = CHILD_ID;
  app.organization.relations.total = 1;
  app.organization.relations.loaded = true;
  app.organization.assetSearch.items = [];
  app.inventoryDetail = { id: CHILD_ID, asset: assetDto(), loading: false, error: '', epoch: 0 };
  app.inventoryHistory = { id: CHILD_ID, items: [], total: 0, limit: 25, offset: 0, loading: false, error: '', epoch: 0 };
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/relationships?') === 0) {
      return json({ items: [edgeDto()], total: 1, limit: 50, offset: 0 });
    }
    if (call.url.indexOf('/api/v1/relationship-types') === 0) return json([typeDto()]);
    if (call.url.indexOf('/api/v1/assets/search') === 0) {
      if (settings.onSearch) return settings.onSearch(call);
      return json({ items: [hostDto()], total: 1, limit: 50, offset: 0 });
    }
    if (call.url === '/api/v1/auth/logout') return json({}, 200);
    if (call.url === '/api/v1/assets/' + CHILD_ID) return json(assetDto());
    if (call.url.indexOf('/api/v1/assets/' + CHILD_ID + '/history') === 0) {
      return json({ items: [], total: 0, limit: 25, offset: 0 });
    }
    if (call.url.indexOf('/api/v1/infrastructure/graph') === 0) {
      return json({ nodes: [], edges: [], limit: 50, offset: 0, truncated: false });
    }
    if (call.url === '/api/v1/relationships/host-move') {
      if (settings.onMove) return settings.onMove(call);
      return json({
        childId: CHILD_ID,
        oldRelationship: edgeDto(),
        newRelationship: edgeDto({ id: 'edge-moved', targetId: NEW_HOST_ID }),
        effectiveAt: null
      });
    }
    return json({}, 404);
  });
  return { session, c, app, calls };
}

async function mountRelations(session) {
  const { c, app } = session;
  const mounted = session.mount('OrganizationRelations', {
    app,
    asset: { id: CHILD_ID, name: 'Servidor de aplicaciones' }
  });
  await c.Vue.nextTick();
  await settle();
  return mounted;
}

function openHostDialog(mounted) {
  const actions = buttonsWithText(mounted.root, 'Cambiar host');
  assert.equal(actions.length, 1, 'the hosted_in relation offers the host action');
  actions[0].props.onClick();
}

/* -------------------------------------------------------------------- tests */

test('the mounted host action opens a dialog for the canonical child and its destination search', async () => {
  const { session, c, app } = relationSession();
  const mounted = await mountRelations(session);
  requireErrors(session, 'the relation panel');

  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();
  requireErrors(session, 'the host move dialog');

  const dialog = app.organization.dialogs.hostMove;
  assert.equal(dialog.open, true, 'the action opens the dialog');
  assert.equal(dialog.childId, CHILD_ID, 'the child is the edge source, not the viewed host');

  assert.ok(nodeByProp(mounted.root, 'id', 'server-host-search'), 'the destination search input is rendered');
  assert.ok(nodeByProp(mounted.root, 'id', 'server-host-reason'), 'the required reason field is rendered');
  assert.ok(nodeByProp(mounted.root, 'id', 'server-host-notes'), 'the notes field is rendered');
  assert.ok(nodeByProp(mounted.root, 'id', 'server-host-effective'), 'the effective timestamp field is rendered');

  const text = textOf(mounted.root);
  assert.match(text, /Servidor de aplicaciones/, 'the dialog names the asset that changes host');
  assert.match(text, new RegExp(CHILD_ID), 'the dialog shows the canonical child identifier');
  assert.match(text, /Host alternativo/, 'the bounded server page is offered as the destination');

  const confirm = buttonsWithText(mounted.root, 'Guardar cambio de host')[0];
  assert.ok(confirm, 'the dialog has a confirmation action');
  assert.equal(confirm.props.disabled, true, 'nothing can be confirmed before a destination is chosen');

  mounted.unmount();
});

test('the dialog destination input asks one bounded server page instead of filtering a list', async () => {
  const { session, c, app, calls } = relationSession();
  const mounted = await mountRelations(session);
  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();

  const opened = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(opened.length, 1, 'opening the dialog reads one bounded page');
  assert.match(opened[0].url, /limit=50/);
  assert.match(opened[0].url, /offset=0/);
  assert.equal(app.organization.assetSearch.items[0].id, NEW_HOST_ID);

  const search = nodeByProp(mounted.root, 'id', 'server-host-search');
  typeInto(search, 'host alternativo');
  await c.Vue.nextTick();
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0).length, 1,
    'the typed term waits for the debounce instead of a request per keystroke');
  await wait(320);

  const queries = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(queries.length, 2, 'the typed term asks the server once');
  assert.match(queries[1].url, /query=host%20alternativo/);
  assert.match(queries[1].url, /limit=50/);
  assert.match(queries[1].url, /offset=0/);
  assert.equal(app.organization.assetSearch.query, 'host alternativo');
  assert.equal(app.organization.assetSearch.items.length, 1, 'the server page is what the dialog offers');
  assert.equal(app.organization.assetSearch.items[0].id, NEW_HOST_ID);

  mounted.unmount();
});

test('choosing a destination and confirming posts the canonical move and refreshes the server surfaces', async () => {
  const { session, c, app, calls } = relationSession();
  app.organization.graph.loaded = true;
  const mounted = await mountRelations(session);
  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();

  const option = nodesWhere(mounted.root, (node) => node.tag === 'button' && node.props && node.props['aria-pressed'] === false
    && textOf(node).indexOf('Host alternativo') !== -1)[0];
  assert.ok(option, 'the server destination is selectable');
  option.props.onClick();
  await c.Vue.nextTick();
  assert.equal(app.organization.dialogs.hostMove.newHostId, NEW_HOST_ID, 'the option selects the server UUID');

  typeInto(nodeByProp(mounted.root, 'id', 'server-host-reason'), 'Cambio de host');
  typeInto(nodeByProp(mounted.root, 'id', 'server-host-notes'), 'Rack 4');
  typeInto(nodeByProp(mounted.root, 'id', 'server-host-effective'), '2026-04-01T08:00');
  await c.Vue.nextTick();

  const confirm = buttonsWithText(mounted.root, 'Guardar cambio de host')[0];
  assert.equal(confirm.props.disabled, false, 'a chosen destination enables the confirmation');
  confirm.props.onClick();
  await settle();

  const move = calls.find((call) => call.url === '/api/v1/relationships/host-move');
  assert.ok(move, 'the rendered form posts the canonical host move');
  assert.equal(move.body.childId, CHILD_ID, 'the payload keeps the edge source as child');
  assert.equal(move.body.newHostId, NEW_HOST_ID, 'the payload carries the chosen host');
  assert.equal(move.body.reason, 'Cambio de host');
  assert.equal(move.body.notes, 'Rack 4');
  assert.match(move.body.effectiveAt, /^2026-04-01T\d\d:\d\d/);
  assert.match(move.body.effectiveAt, /(Z|[+-]\d\d:\d\d)$/, 'the effective time keeps its timezone');

  assert.equal(app.organization.dialogs.hostMove.open, false, 'a successful move closes the dialog');
  const relationReads = calls.filter((call) => call.url.indexOf('/api/v1/relationships?') === 0);
  assert.ok(relationReads.length >= 2, 'the relation list is reloaded from the server');
  const historyReads = calls.filter((call) => call.url.indexOf('/api/v1/assets/' + CHILD_ID + '/history') === 0);
  assert.equal(historyReads.length, 1, 'the open asset history is refreshed from the server');
  const graphReads = calls.filter((call) => call.url.indexOf('/api/v1/infrastructure/graph') === 0);
  assert.equal(graphReads.length, 1, 'a loaded graph is refreshed from the server');

  mounted.unmount();
});

test('a rejected move keeps the dialog, the server answer and the existing host edge', async () => {
  // A self/current host is never pre-rejected by the client: the backend is the
  // final authority. The shared access layer renders its canonical message for
  // the server error code (`conflict`), which is what every write surface shows.
  const message = 'La operación no se puede completar con el estado actual.';
  const { session, c, app, calls } = relationSession({
    onMove: () => failure('an asset cannot be hosted in itself', 409)
  });
  const mounted = await mountRelations(session);
  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();

  // The child is offered by the server page; the client never pre-authorizes
  // the move, so the backend remains the final authority on it.
  const option = nodesWhere(mounted.root, (node) => node.tag === 'button' && node.props
    && textOf(node).indexOf('Host alternativo') !== -1)[0];
  option.props.onClick();
  typeInto(nodeByProp(mounted.root, 'id', 'server-host-reason'), 'Mismo activo');
  await c.Vue.nextTick();
  buttonsWithText(mounted.root, 'Guardar cambio de host')[0].props.onClick();
  await settle();

  const dialog = app.organization.dialogs.hostMove;
  assert.equal(dialog.open, true, 'a rejection keeps the dialog open');
  assert.equal(dialog.busy, false, 'the form leaves its busy state');
  assert.ok(textOf(mounted.root).indexOf(message) !== -1, 'the server rejection is shown to the operator');
  assert.equal(app.organization.relations.items.length, 1, 'the existing relation is not removed locally');
  assert.equal(app.organization.relations.items[0].to, OLD_HOST_ID, 'the old host edge stays on screen');
  assert.equal(calls.filter((call) => call.url === '/api/v1/relationships/host-move').length, 1,
    'a rejection is not retried automatically');
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/relationships?') === 0).length, 1,
    'a rejection refreshes nothing');

  mounted.unmount();
});

test('the server reason minimum is enforced before the request leaves the client', async () => {
  const { session, c, app, calls } = relationSession();
  const mounted = await mountRelations(session);
  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();

  nodesWhere(mounted.root, (node) => node.tag === 'button' && node.props
    && textOf(node).indexOf('Host alternativo') !== -1)[0].props.onClick();
  typeInto(nodeByProp(mounted.root, 'id', 'server-host-reason'), 'abc');
  await c.Vue.nextTick();
  buttonsWithText(mounted.root, 'Guardar cambio de host')[0].props.onClick();
  await settle();

  assert.equal(calls.filter((call) => call.url === '/api/v1/relationships/host-move').length, 0,
    'a too short reason never reaches the API');
  assert.match(textOf(mounted.root), /al menos 4 caracteres/, 'the dialog explains the server minimum');
  assert.equal(app.organization.dialogs.hostMove.open, true);

  mounted.unmount();
});

test('a move resolved after logout reports no success and revives nothing', async () => {
  const pending = deferred();
  const { session, c, app, calls } = relationSession({ onMove: () => pending.promise });
  const mounted = await mountRelations(session);
  openHostDialog(mounted);
  await c.Vue.nextTick();
  await settle();

  nodesWhere(mounted.root, (node) => node.tag === 'button' && node.props
    && textOf(node).indexOf('Host alternativo') !== -1)[0].props.onClick();
  typeInto(nodeByProp(mounted.root, 'id', 'server-host-reason'), 'Cambio de host');
  await c.Vue.nextTick();
  app.lastToast = '';
  buttonsWithText(mounted.root, 'Guardar cambio de host')[0].props.onClick();
  await settle();
  assert.equal(app.organization.dialogs.hostMove.busy, true, 'the move is in flight');

  await logout(session);

  pending.resolve(json({
    childId: CHILD_ID,
    oldRelationship: edgeDto(),
    newRelationship: edgeDto({ id: 'edge-moved', targetId: NEW_HOST_ID }),
    effectiveAt: null
  }));
  await settle();
  await c.Vue.nextTick();

  assert.equal(app.lastToast, '', 'a late move reports no success');
  assert.equal(app.organization.dialogs.hostMove.open, false, 'the cleared dialog is not revived');
  assert.equal(app.organization.relations.items.length, 0, 'no relation row is revived after logout');
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/relationships?') === 0).length, 1,
    'a late move triggers no follow-up read');

  mounted.unmount();
});
