'use strict';
// Phase 5 localized review regressions (B1–B7). Every test reproduces one
// produced blocker with observable effects:
//   B1 a write that resolves after logout revives client rows, dialogs, toasts
//   B2 the authenticated assignment modal hides the server asset picker
//   B3 the server searches are not bound to the real inputs/route cleanup
//   B4 relationship-type configuration is gated by the wrong permission
//   B5 the canonical floor reads the prototype map model instead of its source
//   B6 a null canonical position is turned into a 0,0 placement
//   B7 the host-move child and the hosted_in type alias are lost on that edge
// The fixtures mount the real vendored Vue, the real extracted index.html
// template regions and the real components; permissions are evaluated by the
// real AssetAccess.can/canConfig, never by an always-true lambda.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup } = require('./universal-harness.cjs');

const PERSON_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_PERSON_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const DEPARTMENT_ID = 'cccccccc-1111-2222-3333-444444444444';
const SITE_ID = '5a1e0c10-0001-4f10-9a10-000000000001';
const BUILDING_ID = '5a1e0c10-0002-4f10-9a10-000000000002';
const FLOOR_ID = '5a1e0c10-0003-4f10-9a10-000000000003';
const ROOM_ID = '5a1e0c10-0004-4f10-9a10-000000000004';
const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const REMOTE_ASSET_ID = '22222222-3333-4444-5555-666666666666';
const HOST_ID = '99999999-8888-7777-6666-555555555555';
const EDGE_ID = 'ffffffff-1111-2222-3333-444444444444';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
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

// A started authenticated session: the harness already provides every bound
// method, so only the authorization methods are rebound to their real
// implementations instead of the always-true fixture lambda.
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

// The cleanup the root component performs when the session ends: the real
// logout request, the real identity reset and the real auth watcher handler.
async function logout(session) {
  const { c, app } = session;
  assert.equal(await app.logout(), true, 'the fixture logs out through the real method');
  assert.equal(app.authenticated, false);
  const watcher = c.options.watch.authenticated;
  assert.equal(typeof watcher, 'function');
  watcher.call(app, false);
  await c.Vue.nextTick();
}

function personDto(overrides) {
  return Object.assign({
    id: PERSON_ID,
    name: 'Ana Benítez',
    label: 'Ana Benítez (Analista)',
    jobTitle: 'Analista',
    departmentId: DEPARTMENT_ID,
    siteId: SITE_ID,
    contactEmail: 'ana@example.test',
    contactPhone: '',
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z'
  }, overrides || {});
}

function assetDto(overrides) {
  return Object.assign({
    id: ASSET_ID,
    quickCode: 'NB-CEN-001',
    name: 'Notebook de dirección',
    category: 'Notebooks',
    type: 'Notebook',
    brand: 'Lenovo',
    model: 'T14',
    serial: 'SN-1',
    ip: '10.0.0.15',
    site: 'Sede Central',
    location: 'Piso 2',
    siteId: SITE_ID,
    locationId: FLOOR_ID,
    responsiblePersonId: PERSON_ID,
    responsibleLabel: 'Ana Benítez',
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
    sourceId: ASSET_ID,
    targetId: HOST_ID,
    reason: 'Reubicación',
    notes: '',
    effectiveAt: null,
    createdAt: '2026-01-02T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    direction: 'outgoing',
    label: 'Alojado en'
  }, overrides || {});
}

function locationDto(id, level, parentId, name) {
  return { id, level, parentId, name, description: '', latitude: null, longitude: null, planRef: '', planPage: '', active: true };
}

function canonicalLocations() {
  return [
    locationDto(SITE_ID, 'site', null, 'Sede Central'),
    locationDto(BUILDING_ID, 'building', SITE_ID, 'Edificio Norte'),
    locationDto(FLOOR_ID, 'floor', BUILDING_ID, 'Piso 2'),
    locationDto(ROOM_ID, 'room_zone', FLOOR_ID, 'Sala Canónica')
  ];
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

// One template region of the real index.html, so a mounted test reads the same
// markup the browser ships. No copy of the region lives in this file.
function indexRegion(startMarker, endMarker) {
  const html = fs.readFileSync('index.html', 'utf8');
  const from = html.indexOf(startMarker);
  assert.ok(from !== -1, 'index.html still contains ' + startMarker);
  const to = endMarker ? html.indexOf(endMarker, from) : -1;
  assert.ok(!endMarker || to > from, 'index.html still contains ' + endMarker);
  return html.slice(from, endMarker ? to : undefined);
}

function indexBlock(innerMarker, openTag, closeTag) {
  const html = fs.readFileSync('index.html', 'utf8');
  const at = html.indexOf(innerMarker);
  assert.ok(at !== -1, 'index.html still contains ' + innerMarker);
  const start = html.lastIndexOf(openTag, at);
  assert.ok(start !== -1, 'index.html still opens ' + openTag);
  const end = html.indexOf(closeTag, at);
  assert.ok(end !== -1, 'index.html still closes ' + closeTag);
  return html.slice(start, end + closeTag.length);
}

// Every own binding of the harness app exposed to a mounted template region,
// so the real markup resolves the same names it resolves on the root component.
function bindings(app) {
  const options = { computed: {}, methods: {} };
  Object.getOwnPropertyNames(app).forEach((key) => {
    if (key === 'app' || key.charAt(0) === '_') return;
    const value = app[key];
    if (typeof value === 'function') {
      options.methods[key] = function () { return value.apply(app, arguments); };
    } else {
      options.computed[key] = function () { return app[key]; };
    }
  });
  return options;
}

function mountTemplate(session, name, markup, extra) {
  const { c, app } = session;
  const options = Object.assign(
    { name, props: { app: { type: Object, required: true } }, components: Object.assign({}, c.options.components) },
    bindings(app),
    extra || {},
    { template: '<div>' + markup + '</div>' }
  );
  c.options.components[name] = options;
  const mounted = session.mount(name, { app });
  return Object.assign(mounted, { errors: () => session.errors });
}

/* ------------------------------------------------------------------------ B1 */

test('B1 a person save resolved after logout revives no row, dialog or success toast', async () => {
  const session = serverApp(['people.view', 'people.create']);
  const { c, app } = session;
  app.route = route('people');
  app.personDialog = {
    open: true, mode: 'create', id: '', name: 'Persona tardía', role: '',
    departmentId: '', siteId: '', email: '', phone: '', active: true
  };
  const gate = deferred();
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/auth/logout') return json({});
    if (call.url === '/api/v1/people' && call.init.method === 'POST') return gate.promise;
    return json({}, 404);
  });

  const saving = app.saveOrganizationPerson();
  await settle();
  assert.equal(calls.length, 1, 'the create request is in flight');
  await logout(session);
  const afterLogout = calls.length;
  gate.resolve(json(personDto({ name: 'Persona tardía' })));
  const ok = await saving;

  assert.equal(ok, false, 'a write completed after logout reports no success');
  assert.equal(calls.length, afterLogout, 'a late completion performs no follow-up read');
  assert.equal(app.organization.people.items.length, 0, 'the cleared directory keeps no revived row');
  assert.equal(app.organization.people.total, 0);
  assert.equal(app.organization.peopleTotals.total, 0);
  assert.equal(app.personDialog.open, false);
  assert.equal(app.lastToast, undefined, 'no success toast is shown after logout');
});

test('B1 a live person save still reports the server row and its toast', async () => {
  const session = serverApp(['people.view', 'people.create']);
  const { c, app } = session;
  app.route = route('people');
  app.personDialog = {
    open: true, mode: 'create', id: '', name: 'Persona viva', role: '',
    departmentId: '', siteId: '', email: '', phone: '', active: true
  };
  stub(c, (call) => (call.url === '/api/v1/people'
    ? json(personDto({ name: 'Persona viva' }))
    : json({}, 404)));

  assert.equal(await app.saveOrganizationPerson(), true);
  assert.equal(app.organization.people.items.length, 1);
  assert.equal(app.organization.people.items[0].name, 'Persona viva');
  assert.equal(app.organization.people.total, 1);
  assert.equal(app.personDialog.open, false);
  assert.equal(app.lastToast, 'Persona creada.');
});

test('B1 an assignment resolved after logout reports no success and refreshes nothing', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const { c, app } = session;
  app.route = route('person', { personId: PERSON_ID });
  app.organization.relations.assetId = ASSET_ID;
  app.organization.relations.loaded = true;
  app.assignDialog = {
    open: true, mode: 'person', assetId: ASSET_ID, personId: '', selectedId: PERSON_ID,
    search: '', reason: 'Traslado', notes: '', effectiveAt: '', error: ''
  };
  const gate = deferred();
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/auth/logout') return json({});
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/assign') return gate.promise;
    return json({}, 404);
  });

  const saving = app.confirmAssignment();
  await settle();
  assert.equal(calls.length, 1, 'the assignment request is in flight');
  await logout(session);
  gate.resolve(json(assetDto({ responsiblePersonId: PERSON_ID })));
  const ok = await saving;

  assert.equal(ok, false, 'a late assignment reports no success');
  assert.equal(app.organization.personAssets.items.length, 0, 'no server asset page is revived');
  assert.equal(app.organization.relations.items.length, 0, 'no relation page is revived');
  assert.equal(app.assignDialog.open, false);
  assert.equal(app.lastToast, undefined, 'no success toast is shown after logout');
});

test('B1 a live assignment still reports the server change', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const { c, app } = session;
  app.route = route('person', { personId: PERSON_ID });
  app.assignDialog = {
    open: true, mode: 'person', assetId: ASSET_ID, personId: '', selectedId: PERSON_ID,
    search: '', reason: '', notes: '', effectiveAt: '', error: ''
  };
  stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/assign') return json(assetDto({ responsiblePersonId: PERSON_ID }));
    if (call.url.indexOf('/api/v1/people/' + PERSON_ID) === 0) return json({ items: [], total: 0, limit: 50, offset: 0 });
    return json({}, 404);
  });

  assert.equal(await app.confirmAssignment(), true);
  assert.equal(app.lastToast, 'Activo asignado.');
  assert.equal(app.assignDialog.open, false);
});

/* ------------------------------------------------------------------------ B2 */

test('B2 the mounted assignment modal keeps the audit fields and the server asset picker', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const { c, app } = session;
  app.route = route('person', { personId: PERSON_ID });
  app.organization.people.items = [{
    id: PERSON_ID, name: 'Ana Benítez', label: 'Ana Benítez (Analista)', role: 'Analista',
    departmentId: DEPARTMENT_ID, siteId: SITE_ID, active: true
  }];
  app.organization.people.total = 1;
  app.organization.people.loaded = true;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/assets/search') === 0) return json({ items: [assetDto()], total: 1, limit: 50, offset: 0 });
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/assign') return json(assetDto({ responsiblePersonId: PERSON_ID }));
    if (call.url.indexOf('/api/v1/people/' + PERSON_ID) === 0) return json({ items: [assetDto()], total: 1, limit: 50, offset: 0 });
    return json({}, 404);
  });

  app.openAssignPerson(app.organization.people.items[0]);
  await settle();
  assert.equal(app.assignDialog.mode, 'asset', 'the person sheet assigns an asset to the person');
  assert.equal(app.organization.assetSearch.items.length, 1);

  const markup = indexRegion('<!-- Asignación -->', '<!-- Traslado de activo -->');
  const mounted = mountTemplate(session, 'Phase5AssignmentRegion', markup);
  await c.Vue.nextTick();
  requireErrors(session, 'the assignment modal');

  const picker = nodeByProp(mounted.root, 'aria-label', 'Activos sin responsable');
  assert.ok(picker, 'the asset picker is rendered for the person sheet in server mode');
  const options = nodesWhere(picker, (node) => node.tag === 'button');
  assert.equal(options.length, 1, 'the server search page is offered as selectable assets');
  assert.match(textOf(options[0]), /Notebook de dirección/);

  const audit = nodeByProp(mounted.root, 'id', 'assign-effective-hint');
  assert.ok(audit, 'the audit fields stay visible next to the picker');
  assert.match(textOf(mounted.root), /Motivo/);
  assert.match(textOf(mounted.root), /Notas/);
  assert.match(textOf(mounted.root), /Fecha efectiva/);

  options[0].props.onClick();
  await c.Vue.nextTick();
  assert.equal(app.assignDialog.selectedId, ASSET_ID, 'the asset option selects the server UUID');

  typeInto(nodeByProp(mounted.root, 'placeholder', 'Motivo del cambio (opcional)'), 'Cambio de equipo');
  typeInto(nodeByProp(mounted.root, 'placeholder', 'Notas adicionales (opcional)'), 'Entrega en mostrador');
  typeInto(nodeByProp(mounted.root, 'aria-describedby', 'assign-effective-hint'), '2026-03-02T09:30');
  await c.Vue.nextTick();

  const confirm = buttonsWithText(mounted.root, 'Asignar activo')[0];
  assert.ok(confirm, 'the modal keeps its confirmation action');
  confirm.props.onClick();
  await settle();

  const assign = calls.find((call) => call.url === '/api/v1/assets/' + ASSET_ID + '/assign');
  assert.ok(assign, 'the person sheet posts the canonical assignment');
  assert.equal(assign.body.personId, PERSON_ID, 'the person id is the sheet target');
  assert.equal(assign.body.reason, 'Cambio de equipo');
  assert.equal(assign.body.notes, 'Entrega en mostrador');
  assert.match(assign.body.effectiveAt, /^2026-03-02T\d\d:\d\d/);
  assert.match(assign.body.effectiveAt, /(Z|[+-]\d\d:\d\d)$/);

  mounted.unmount();
});

/* ------------------------------------------------------------------------ B3 */

test('B3 typing in the real people search input issues one bounded server query', async () => {
  const session = serverApp(['people.view']);
  const { c, app } = session;
  app.route = route('people');
  const calls = stub(c, (call) => (call.url.indexOf('/api/v1/people') === 0
    ? json({ items: [personDto()], total: 1, limit: 50, offset: 0 })
    : json({}, 404)));

  const markup = indexBlock('id="people-search"', '<div class="search-field">', '</div>');
  const mounted = mountTemplate(session, 'Phase5PeopleSearch', markup, {
    watch: { 'prefs.people': c.options.watch['prefs.people'] }
  });
  await c.Vue.nextTick();
  assert.equal(calls.length, 0, 'mounting the filter issues no unneeded request');

  const input = nodeByProp(mounted.root, 'id', 'people-search');
  assert.ok(input, 'the people search input is rendered');
  typeInto(input, 'ana');
  await c.Vue.nextTick();
  assert.equal(app.prefs.people.search, 'ana', 'the real input writes the directory filter');
  await wait(320);

  const queries = calls.filter((call) => call.url.indexOf('/api/v1/people') === 0);
  assert.equal(queries.length, 1, 'the typed text triggers exactly one directory query');
  assert.match(queries[0].url, /limit=50/, 'the query stays bounded');
  assert.match(queries[0].url, /offset=0/, 'a new term restarts the page offset');
  assert.match(queries[0].url, /query=ana/);
  assert.equal(app.organization.people.items[0].id, PERSON_ID, 'the directory shows the server page');

  mounted.unmount();
});

test('B3 typing a relation target queries the server beyond the first asset page', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const { c, app } = session;
  app.route = route('detail', { assetId: ASSET_ID });
  app.organization.types.items = [typeDto()];
  app.organization.types.loaded = true;
  app.organization.relations.assetId = ASSET_ID;
  app.organization.relations.loaded = true;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/relationships?') === 0) return json({ items: [], total: 0, limit: 50, offset: 0 });
    if (call.url.indexOf('/api/v1/relationship-types') === 0) return json([typeDto()]);
    if (call.url.indexOf('/api/v1/assets/search') === 0) {
      if (/query=servidor/.test(call.url)) {
        return json({
          items: [assetDto({ id: REMOTE_ASSET_ID, quickCode: 'SRV-002', name: 'Servidor de respaldo' })],
          total: 1,
          limit: 50,
          offset: 0
        });
      }
      return json({ items: [assetDto({ id: HOST_ID, quickCode: 'HOST-001', name: 'Host conocido' })], total: 40, limit: 50, offset: 0 });
    }
    return json({}, 404);
  });

  const mounted = session.mount('OrganizationRelations', { app, asset: { id: ASSET_ID, name: 'Notebook de dirección' } });
  await c.Vue.nextTick();
  await settle();
  const create = buttonsWithText(mounted.root, 'Añadir relación')[0];
  assert.ok(create, 'the relation form opens from the relation panel');
  create.props.onClick();
  await c.Vue.nextTick();
  await settle();
  const initial = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(initial.length, 1, 'opening the form reads the first bounded page once');

  const search = nodeByProp(mounted.root, 'id', 'server-relation-target');
  assert.ok(search, 'the relation target search input is rendered');
  typeInto(search, 'servidor');
  await c.Vue.nextTick();
  await wait(320);

  const queries = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(queries.length, 2, 'the typed target asks the server instead of filtering one page');
  assert.match(queries[1].url, /query=servidor/);
  assert.match(queries[1].url, /limit=50/);
  assert.match(queries[1].url, /offset=0/);
  const offered = nodesWhere(mounted.root, (node) => node.tag === 'option' && node.props && node.props.value === REMOTE_ASSET_ID);
  assert.equal(offered.length, 1, 'an asset outside the first page becomes selectable');
  assert.equal(app.organization.assetSearch.items[0].id, REMOTE_ASSET_ID);

  mounted.unmount();
});

test('B3 route cleanup and logout cancel a pending server search', async () => {
  const session = serverApp(['people.view', 'assets.view']);
  const { c, app } = session;
  app.route = route('people');
  const calls = stub(c, () => json({ items: [], total: 0, limit: 50, offset: 0 }));

  app.scheduleOrganizationPeopleSearch();
  app.handleOrganizationRoute(route('panel'));
  await wait(320);
  assert.equal(calls.length, 0, 'a route change cancels the pending directory query');
  assert.equal(app.organization.peopleSearchTimer, null);

  app.scheduleOrganizationAssetSearch('servidor');
  app.clearOrganizationState();
  await wait(320);
  assert.equal(calls.length, 0, 'the session cleanup cancels the pending asset query');
  assert.equal(app.organization.assetSearchTimer, null);
});

test('B3 the mounted assignment input issues one bounded asset query and a late page never revives it', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const { c, app } = session;
  app.route = route('person', { personId: PERSON_ID });
  const person = {
    id: PERSON_ID, name: 'Ana Benítez', label: 'Ana Benítez (Analista)', role: 'Analista',
    departmentId: DEPARTMENT_ID, siteId: SITE_ID, active: true
  };
  app.organization.people.items = [person];
  app.organization.people.total = 1;
  app.organization.people.loaded = true;
  const typed = deferred();
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/assets/search') === 0) {
      if (/query=servidor/.test(call.url)) return typed.promise;
      return json({ items: [assetDto()], total: 1, limit: 50, offset: 0 });
    }
    if (call.url === '/api/v1/auth/logout') return json({}, 200);
    return json({}, 404);
  });

  app.openAssignPerson(person);
  const markup = indexRegion('<!-- Asignación -->', '<!-- Traslado de activo -->');
  const mounted = mountTemplate(session, 'Phase5AssignmentInput', markup, {
    watch: { 'assignDialog.search': c.options.watch['assignDialog.search'] }
  });
  await c.Vue.nextTick();
  await settle();
  requireErrors(session, 'the assignment sheet');
  assert.equal(app.assignDialog.mode, 'asset', 'the person sheet picks an asset');

  const search = nodeByProp(mounted.root, 'id', 'assign-search');
  assert.ok(search, 'the assignment search input is rendered');
  typeInto(search, 'servidor');
  await c.Vue.nextTick();
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0).length, 1,
    'the typed term waits for the debounce');
  await wait(320);

  const queries = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(queries.length, 2, 'typing in the mounted input issues the bounded asset query');
  assert.match(queries[1].url, /limit=50/, 'the query stays bounded');
  assert.match(queries[1].url, /offset=0/, 'a new term restarts the page offset');
  assert.match(queries[1].url, /query=servidor/);

  await logout(session);
  typed.resolve(json({ items: [assetDto({ id: REMOTE_ASSET_ID, name: 'Servidor de respaldo' })], total: 1, limit: 50, offset: 0 }));
  await settle();
  await c.Vue.nextTick();

  assert.equal(app.organization.assetSearch.items.length, 0, 'a late page never revives the server search');
  assert.equal(app.organization.assetSearch.error, '', 'a cancelled page reports no error');
  assert.equal(app.assignDialog.open, false, 'the cleared assignment sheet is not revived');

  mounted.unmount();
});

/* ------------------------------------------------------------------------ B4 */

test('B4 relationship-type configuration requires config.general, not assets.edit', () => {
  const configure = serverApp(['config.general']);
  configure.app.route = route('config', { section: 'relaciones' });
  assert.equal(configure.app.canConfig('relaciones'), true, 'config.general reaches the section');
  assert.equal(configure.app.accessRoute(route('config', { section: 'relaciones' })).name, 'config', 'the route is allowed');
  assert.equal(configure.app.can('assets.edit'), false, 'no asset edit is implied');

  const editor = serverApp(['people.view', 'assets.view', 'assets.edit']);
  editor.app.route = route('config', { section: 'relaciones' });
  assert.equal(editor.app.canConfig('relaciones'), false, 'asset edit alone cannot configure the vocabulary');
  assert.equal(editor.app.accessRoute(route('config', { section: 'relaciones' })).name, 'denied', 'the route is refused');
});

test('B4 the type writer and its controls follow config.general without breaking edge edits', async () => {
  const configured = serverApp(['config.general']);
  const { c, app } = configured;
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/relationship-types') return json(typeDto({ key: 'depends_on' }), 201);
    return json({}, 404);
  });
  app.organization.dialogs.type = {
    open: true, mode: 'create', key: 'depends_on', forwardLabel: 'Depende de',
    inverseLabel: 'Es dependencia de', containment: false, active: true, error: '', busy: false
  };
  assert.equal(await app.saveOrganizationType(), true, 'config.general writes the type');
  const post = calls.find((call) => call.url === '/api/v1/relationship-types');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.body.key, 'depends_on');

  const editor = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const editorCalls = stub(editor.c, () => json({}, 200));
  editor.app.organization.dialogs.type = {
    open: true, mode: 'create', key: 'depends_on', forwardLabel: 'Depende de',
    inverseLabel: 'Es dependencia de', containment: false, active: true, error: '', busy: false
  };
  assert.equal(await editor.app.saveOrganizationType(), false, 'assets.edit cannot write the vocabulary');
  assert.equal(editorCalls.length, 0, 'the refused type write sends no request');
  assert.match(editor.app.organization.dialogs.type.error, /permiso/i);

  editor.app.organization.dialogs.relation = {
    open: true, mode: 'create', id: '', sourceId: ASSET_ID, targetId: HOST_ID,
    typeKey: 'hosted_in', reason: 'Montaje', notes: '', effectiveAt: '', error: '', busy: false
  };
  stub(editor.c, (call) => (call.url === '/api/v1/relationships'
    ? json(edgeDto({ id: 'new-edge' }), 201)
    : json({ items: [], total: 0, limit: 50, offset: 0 })));
  assert.equal(await editor.app.saveOrganizationRelation(), true, 'a legitimate edge edit still works with assets.edit');
});

test('B4 the mounted type panel hides its configuration controls without config.general', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const { c, app } = session;
  app.organization.types.items = [typeDto()];
  app.organization.types.loaded = true;
  stub(c, (call) => (call.url.indexOf('/api/v1/relationship-types') === 0 ? json([typeDto()]) : json({}, 404)));

  const mounted = session.mount('OrganizationRelationTypes', { app });
  await c.Vue.nextTick();
  requireErrors(session, 'the relation type panel');
  assert.equal(buttonsWithText(mounted.root, 'Nuevo tipo').length, 0, 'no create control is offered');
  assert.equal(buttonsWithText(mounted.root, 'Editar').length, 0, 'no edit control is offered');
  assert.match(textOf(mounted.root), /Solo lectura/, 'the read-only state is factual');

  mounted.unmount();
});

test('B4 a missing assets.view stays an honest read error instead of demo types', async () => {
  const session = serverApp(['config.general']);
  const { c, app } = session;
  const calls = stub(c, () => json({}, 403));
  assert.equal(await app.loadOrganizationRelationTypes({ includeInactive: true }), false);
  assert.equal(calls.length, 0, 'no read is attempted without the read capability');
  assert.equal(app.organization.types.items.length, 0, 'no prototype type is invented');
  assert.match(app.organization.types.error, /permiso/i);
});

/* ------------------------------------------------------------------------ B5 */

function mapPayload(overrides) {
  return Object.assign({
    sites: [{ id: SITE_ID, name: 'Sede Central', latitude: '-25.28', longitude: '-57.63' }],
    positions: [{
      assetId: ASSET_ID,
      quickCode: 'NB-CEN-001',
      name: 'Notebook de dirección',
      siteId: SITE_ID,
      locationId: FLOOR_ID,
      x: 0.125,
      y: 0.5
    }],
    limit: 50,
    offset: 0,
    truncated: false
  }, overrides || {});
}

function mapResponder(payload) {
  return (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: canonicalLocations(), total: 3, limit: 200, offset: 0 });
    if (call.url.indexOf('/api/v1/map') === 0) return json(payload);
    return json({}, 404);
  };
}

test('B5 the mounted canonical floor opens from the composed server source', async () => {
  const session = serverApp(['people.view', 'assets.view']);
  const { c, app } = session;
  app.route = route('map');
  stub(c, mapResponder(mapPayload({
    positions: [{
      assetId: ASSET_ID,
      quickCode: 'NB-CEN-001',
      name: 'Notebook de dirección',
      siteId: SITE_ID,
      locationId: ROOM_ID,
      x: 0.125,
      y: 0.5
    }]
  })));
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  assert.equal(app.serverMapMode, true);

  const mounted = session.mount('MapExplorer', { app, focusId: '' });
  await c.Vue.nextTick();
  requireErrors(session, 'the server floor');
  assert.equal(mounted.instance.floorView, null, 'the explorer starts at the geographic level');

  mounted.instance.openFloor(FLOOR_ID);
  await c.Vue.nextTick();

  assert.equal(mounted.instance.level, 'floor', 'the floor level opens');
  assert.equal(mounted.instance.activeFloorId, FLOOR_ID, 'the canonical floor id is active');
  assert.equal(mounted.instance.activeSiteId, SITE_ID, 'the canonical site is active');
  assert.equal(mounted.instance.openBuildingId, BUILDING_ID, 'the canonical building is active');
  const view = mounted.instance.floorView;
  assert.ok(view, 'the floor view is composed');
  assert.equal(view.floor.id, FLOOR_ID);
  assert.equal(view.floor.name, 'Piso 2');
  assert.equal(view.building.name, 'Edificio Norte');
  assert.equal(view.site.label, 'Sede Central');
  const markers = mounted.instance.floorMarkers;
  assert.equal(markers.length, 1, 'the placed canonical asset becomes a marker');
  assert.equal(markers[0].asset.id, ASSET_ID);
  assert.equal(markers[0].asset.name, 'Notebook de dirección', 'the marker keeps the server asset, not a prototype one');
  mounted.instance.selectedId = ASSET_ID;
  await c.Vue.nextTick();
  assert.equal(
    mounted.instance.selectedPath,
    'Sede Central › Edificio Norte › Piso 2 › Sala Canónica',
    'the canonical room, floor, building and site compose the selected path'
  );

  mounted.unmount();
});

test('B5 the prototype floor keeps reading its own map model', async () => {
  const session = setup();
  const { c, app } = session;
  app.route = route('map');
  app.authenticated = false;
  assert.equal(app.serverMapMode, false);
  const floor = app.maps.floors[0];
  assert.ok(floor, 'the prototype map model keeps its floors');

  const mounted = session.mount('MapExplorer', { app, focusId: '' });
  await c.Vue.nextTick();
  requireErrors(session, 'the prototype floor');
  assert.equal(mounted.instance.source, app, 'prototype mode still reads the app model directly');

  mounted.instance.openFloor(floor.id);
  await c.Vue.nextTick();
  assert.equal(mounted.instance.level, 'floor');
  assert.equal(mounted.instance.activeFloorId, floor.id);
  assert.equal(mounted.instance.floorView.floor.id, floor.id);

  mounted.unmount();
});

/* ------------------------------------------------------------------------ B6 */

test('B6 a canonical position is never invented from a null coordinate', () => {
  const { c } = setup();
  const api = c.AssetOrganization;
  assert.equal(api.pixelsFromCanonical(null, null), null, 'a null pair is not a 0,0 position');
  assert.equal(api.pixelsFromCanonical(undefined, 0.5), null, 'a missing x is not zero');
  assert.equal(api.pixelsFromCanonical('', ''), null, 'a blank pair is not a 0,0 position');
  assert.equal(api.pixelsFromCanonical(0.5, Number.NaN), null, 'a non-finite y is not zero');
  assert.equal(api.canonicalFromPixels(null, null), null, 'a null pixel pair is not 0,0');
  assert.deepEqual({ ...api.pixelsFromCanonical(0, 0) }, { x: 0, y: 0 }, 'an explicit origin is kept');
  assert.deepEqual({ ...api.pixelsFromCanonical('0.25', '0.5') }, { x: 400, y: 500 }, 'a bounded decimal still converts');
  assert.deepEqual({ ...api.canonicalFromPixels(400, 500) }, { x: 0.25, y: 0.5 }, 'a bounded pixel still converts');
});

test('B6 the canonical map keeps assets but drops unpositioned placements', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const { c, app } = session;
  app.route = route('map');
  stub(c, mapResponder(mapPayload({
    positions: [
      { assetId: ASSET_ID, quickCode: 'NB-CEN-001', name: 'Notebook de dirección', siteId: SITE_ID, locationId: FLOOR_ID, x: 0.125, y: 0.5 },
      { assetId: HOST_ID, quickCode: 'SRV-002', name: 'Servidor de respaldo', siteId: SITE_ID, locationId: FLOOR_ID, x: null, y: null },
      { assetId: REMOTE_ASSET_ID, quickCode: 'CAM-003', name: 'Cámara de acceso', siteId: SITE_ID, locationId: FLOOR_ID, x: '', y: 0.25 }
    ]
  })));
  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);

  const maps = app.organizationMapSource.maps;
  assert.ok(maps.positions[ASSET_ID], 'the positioned asset keeps its marker');
  assert.equal(maps.positions[HOST_ID], undefined, 'a null pair creates no origin marker');
  assert.equal(maps.positions[REMOTE_ASSET_ID], undefined, 'a blank coordinate creates no marker');
  assert.equal(app.organizationMapSource.assets.length, 3, 'the unpositioned assets stay in the map asset list');
  const unpositioned = app.organizationMapSource.assets.find((asset) => asset.id === HOST_ID);
  assert.equal(unpositioned.locationId, FLOOR_ID, 'the unpositioned asset keeps its canonical location');

  stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + HOST_ID) return json(assetDto({ id: HOST_ID, positionX: null, positionY: null }));
    return json({}, 404);
  });
  assert.equal(await app.saveOrganizationPosition(HOST_ID, FLOOR_ID, null, null), true);
  const source = app.organizationMapSource;
  assert.equal(source.maps.positions[HOST_ID], undefined, 'clearing a position leaves no origin marker behind');
});

/* ------------------------------------------------------------------------ B7 */

test('B7 the canonical link keeps its stable type alias and its child endpoint', async () => {
  const { c } = setup();
  const link = c.AssetOrganization.mapLink(edgeDto());
  assert.equal(link.typeKey, 'hosted_in', 'the consumer condition receives the canonical alias');
  assert.equal(link.type, 'hosted_in', 'the existing alias stays intact');
  assert.equal(link.from, ASSET_ID, 'the source endpoint is the child');
  assert.equal(link.to, HOST_ID, 'the target endpoint is the host');
});

test('B7 the host move always selects the child from the edge source in both views', () => {
  const incoming = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const link = incoming.c.AssetOrganization.mapLink(edgeDto({ direction: 'incoming', label: 'Aloja' }));
  incoming.app.openOrganizationHostMove(link);
  assert.equal(incoming.app.organization.dialogs.hostMove.open, true);
  assert.equal(incoming.app.organization.dialogs.hostMove.childId, ASSET_ID, 'the incoming view keeps the child as the source');

  const outgoing = serverApp(['people.view', 'assets.view', 'assets.edit']);
  outgoing.app.openOrganizationHostMove(outgoing.c.AssetOrganization.mapLink(edgeDto({ direction: 'outgoing' })));
  assert.equal(outgoing.app.organization.dialogs.hostMove.childId, ASSET_ID, 'the outgoing view selects the same child');

  const readonly = serverApp(['people.view', 'assets.view']);
  readonly.app.openOrganizationHostMove(link);
  assert.equal(readonly.app.organization.dialogs.hostMove.open, false, 'a caller without assets.edit opens nothing');
});

test('B7 the mounted host action appears only for hosted_in and posts the canonical move', async () => {
  const session = serverApp(['people.view', 'assets.view', 'assets.edit']);
  const { c, app } = session;
  app.route = route('detail', { assetId: ASSET_ID });
  app.organization.types.items = [typeDto()];
  app.organization.types.loaded = true;
  app.organization.relations.assetId = ASSET_ID;
  app.organization.relations.total = 2;
  app.organization.relations.loaded = true;
  app.organization.assetSearch.items = [];
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/relationships?') === 0) {
      return json({
        items: [
          edgeDto({ direction: 'outgoing' }),
          edgeDto({ id: 'edge-depends', typeKey: 'depends_on', label: 'Depende de', inverseLabel: 'Es dependencia de', direction: 'outgoing' })
        ],
        total: 2,
        limit: 50,
        offset: 0
      });
    }
    if (call.url.indexOf('/api/v1/relationship-types') === 0) return json([typeDto()]);
    if (call.url === '/api/v1/relationships/host-move') return json({ childId: ASSET_ID, oldRelationship: edgeDto(), newRelationship: edgeDto({ id: 'moved' }), effectiveAt: null });
    return json({}, 404);
  });

  const mounted = session.mount('OrganizationRelations', { app, asset: { id: ASSET_ID, name: 'Notebook de dirección' } });
  await c.Vue.nextTick();
  await settle();
  requireErrors(session, 'the relation panel');

  const hostActions = buttonsWithText(mounted.root, 'Cambiar host');
  assert.equal(hostActions.length, 1, 'only the hosted_in relation offers the host action');
  hostActions[0].props.onClick();
  await c.Vue.nextTick();
  assert.equal(app.organization.dialogs.hostMove.open, true);
  assert.equal(app.organization.dialogs.hostMove.childId, ASSET_ID, 'the mounted action selects the edge source as the child');

  app.organization.dialogs.hostMove.newHostId = REMOTE_ASSET_ID;
  app.organization.dialogs.hostMove.reason = 'Cambio de host';
  app.organization.dialogs.hostMove.notes = 'Rack 4';
  app.organization.dialogs.hostMove.effectiveAt = '2026-04-01T08:00';
  assert.equal(await app.confirmOrganizationHostMove(), true);
  const move = calls.find((call) => call.url === '/api/v1/relationships/host-move');
  assert.ok(move);
  assert.equal(move.body.childId, ASSET_ID, 'the payload keeps the child');
  assert.equal(move.body.newHostId, REMOTE_ASSET_ID, 'the payload carries the selected host');
  assert.equal(move.body.reason, 'Cambio de host');
  assert.equal(move.body.notes, 'Rack 4');
  assert.match(move.body.effectiveAt, /^2026-04-01T\d\d:\d\d/);
  assert.match(move.body.effectiveAt, /(Z|[+-]\d\d:\d\d)$/);

  mounted.unmount();
});

test('B7 a non-hosted relation offers no host action and the readonly panel posts nothing', async () => {
  const readonly = serverApp(['people.view', 'assets.view']);
  const { c, app } = readonly;
  app.route = route('detail', { assetId: ASSET_ID });
  app.organization.types.items = [typeDto()];
  app.organization.types.loaded = true;
  app.organization.relations.assetId = ASSET_ID;
  app.organization.relations.total = 2;
  app.organization.relations.loaded = true;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/relationships?') === 0) {
      return json({
        items: [
          edgeDto({ direction: 'outgoing' }),
          edgeDto({ id: 'edge-depends', typeKey: 'depends_on', label: 'Depende de', inverseLabel: 'Es dependencia de', direction: 'outgoing' })
        ],
        total: 2,
        limit: 50,
        offset: 0
      });
    }
    if (call.url.indexOf('/api/v1/relationship-types') === 0) return json([typeDto()]);
    return json({}, 404);
  });

  const mounted = readonly.mount('OrganizationRelations', { app, asset: { id: ASSET_ID, name: 'Notebook de dirección' } });
  await c.Vue.nextTick();
  await settle();
  requireErrors(readonly, 'the readonly relation panel');
  assert.equal(buttonsWithText(mounted.root, 'Cambiar host').length, 0, 'no host action without assets.edit');
  assert.equal(buttonsWithText(mounted.root, 'Añadir relación').length, 0, 'no create control without assets.edit');
  assert.match(textOf(mounted.root), /Solo lectura/);
  assert.equal(calls.filter((call) => call.init.method && call.init.method !== 'GET').length, 0, 'the readonly panel posts nothing');
  assert.equal(app.organization.dialogs.hostMove.open, false);

  mounted.unmount();
});
