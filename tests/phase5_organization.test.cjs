'use strict';
// Phase 5 server authority: directory, lifecycle assignment, directed
// relationships, bounded graph and canonical map coordinates.
// Each test fails if the browser keeps using prototype people/links/positions,
// invents a field the API does not accept, or reports success without a server
// effect.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PERSON_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_PERSON_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const DEPT_ID = 'cccccccc-1111-2222-3333-444444444444';
const SITE_ID = 'dddddddd-1111-2222-3333-444444444444';
const FLOOR_ID = 'eeeeeeee-1111-2222-3333-444444444444';
const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const HOST_ID = '99999999-8888-7777-6666-555555555555';
const EDGE_ID = 'ffffffff-1111-2222-3333-444444444444';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function personDto(overrides) {
  return Object.assign({
    id: PERSON_ID,
    name: 'Ana Benítez',
    label: 'Ana Benítez (Analista)',
    jobTitle: 'Analista',
    departmentId: DEPT_ID,
    siteId: SITE_ID,
    contactEmail: 'ana@example.test',
    contactPhone: '+595 21 555',
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z'
  }, overrides);
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
    location: 'Piso 4',
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
  }, overrides);
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

// Real permission evaluation: AssetAccess.can/canConfig derive from the
// session's serverPermissions, so a missing capability hides data instead of
// being papered over by an always-true lambda.
function serverApp(permissions) {
  const { c, app } = setup();
  app.route = { name: 'people', personId: '', assetId: '', section: '', focusId: '' };
  app.serverPermissions = permissions.slice();
  app.csrfToken = 'csrf-test-token';
  ['can', 'canConfig', 'requirePermission', 'accessRoute'].forEach((name) => {
    app[name] = c.options.methods[name].bind(app);
  });
  return { c, app };
}

function departmentDto() {
  return { id: DEPT_ID, name: 'Tecnología', active: true, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z' };
}

function siteDto() {
  return { id: SITE_ID, level: 'site', parentId: null, name: 'Sede Central', description: '', latitude: '-25.28', longitude: '-57.63', planRef: '', planPage: '', active: true, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z' };
}

function floorDto() {
  return { id: FLOOR_ID, level: 'floor', parentId: SITE_ID, name: 'Piso 4', description: '', latitude: null, longitude: null, planRef: 'plano-p4.pdf', planPage: '2', active: true, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z' };
}

function typeDto(overrides) {
  return Object.assign({
    key: 'hosted_in',
    forwardLabel: 'Alojado en',
    inverseLabel: 'Aloja',
    containment: true,
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
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
  }, overrides);
}

test('the directory reads the server page and never writes people to localStorage', async () => {
  const { c, app } = serverApp(['people.view']);
  const writes = [];
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return original(key, value); };
  const demoPeople = app.people.length;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/people') === 0) return json({ items: [personDto()], total: 61, limit: 50, offset: 0 });
    if (call.url.indexOf('/api/v1/departments') === 0) return json({ items: [departmentDto()], total: 1, limit: 200, offset: 0 });
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: [siteDto()], total: 1, limit: 200, offset: 0 });
    return json({}, 404);
  });

  app.prefs.people.search = 'ana';
  app.prefs.people.status = 'active';
  const ok = await app.loadOrganizationPeople({ offset: 0 });

  assert.equal(ok, true);
  const people = calls.find((call) => call.url.indexOf('/api/v1/people') === 0);
  assert.match(people.url, /limit=50/);
  assert.match(people.url, /query=ana/);
  assert.match(people.url, /status=active/);
  assert.equal(app.organization.people.total, 61);
  assert.equal(app.organization.people.items[0].id, PERSON_ID);
  assert.equal(app.organization.people.items[0].role, 'Analista');
  assert.equal(app.people.length, demoPeople, 'prototype people stay untouched');
  assert.equal(writes.filter((key) => key.indexOf('people') !== -1).length, 0);
});

test('a person without read permission gets a factual error, not demo people', async () => {
  const { c, app } = serverApp([]);
  stub(c, () => json({}, 403));

  const ok = await app.loadOrganizationPeople({ offset: 0 });

  assert.equal(ok, false);
  assert.equal(app.serverOrganizationMode, true, 'the authenticated session keeps server authority');
  assert.equal(app.organizationDirectoryMode, false, 'the missing capability gates the directory only');
  assert.equal(app.organizationDenied, true);
  assert.equal(app.filteredPeople.length, 0);
  assert.equal(app.organization.people.items.length, 0);
  assert.equal(app.sites.length, 0, 'no prototype site leaks into the authenticated session');
});

test('person detail, assets and history use the canonical UUID paths', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view']);
  app.route = { name: 'person', personId: PERSON_ID, assetId: '', section: '', focusId: '' };
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/people/' + PERSON_ID) return json(personDto());
    if (call.url.indexOf('/api/v1/people/' + PERSON_ID + '/assets') === 0) return json({ items: [assetDto()], total: 1, limit: 50, offset: 0 });
    if (call.url.indexOf('/api/v1/people/' + PERSON_ID + '/history') === 0) return json({ items: [{ id: 'h1', action: 'assigned', actorUsername: 'maria', source: 'rest', createdAt: '2026-01-02T10:00:00Z', reason: 'Alta', effectiveAt: '2026-01-01T00:00:00Z', changes: {} }], total: 1, limit: 25, offset: 0 });
    return json({}, 404);
  });

  assert.equal(await app.loadOrganizationPerson(PERSON_ID), true);
  assert.equal(await app.loadOrganizationPersonAssets(PERSON_ID), true);
  assert.equal(await app.loadOrganizationPersonHistory(PERSON_ID), true);

  assert.equal(app.currentPerson.id, PERSON_ID);
  assert.equal(app.currentPerson.name, 'Ana Benítez');
  assert.equal(app.personAssets.length, 1);
  assert.equal(app.personAssets[0].id, ASSET_ID);
  assert.equal(app.organization.personHistory.items[0].title, 'Responsable asignado');
  assert.equal(app.organization.personHistory.items[0].actorUsername, 'maria');
  assert.equal(calls.length, 3);
});

test('editing a person sends backend field names and reports the server record', async () => {
  const { c, app } = serverApp(['people.view', 'people.edit']);
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/people/' + PERSON_ID && call.init.method === 'PATCH') return json(personDto({ jobTitle: 'Jefa de soporte' }));
    return json({}, 404);
  });
  app.personDialog = {
    open: true, mode: 'edit', id: PERSON_ID, name: 'Ana Benítez', role: 'Jefa de soporte',
    departmentId: DEPT_ID, siteId: SITE_ID, email: 'ana@example.test', phone: '+595 21 555', active: true
  };

  const ok = await app.saveOrganizationPerson();

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(calls[0].body, {
    name: 'Ana Benítez',
    jobTitle: 'Jefa de soporte',
    departmentId: DEPT_ID,
    siteId: SITE_ID,
    contactEmail: 'ana@example.test',
    contactPhone: '+595 21 555',
    status: 'active'
  });
  assert.equal(app.personDialog.open, false);
});

test('a person edit without people.edit is refused before any request', async () => {
  const { c, app } = serverApp(['people.view']);
  const calls = stub(c, () => json({}, 200));
  app.personDialog = { open: true, mode: 'edit', id: PERSON_ID, name: 'Ana', role: '', departmentId: '', siteId: '', email: '', phone: '', active: true };

  const ok = await app.saveOrganizationPerson();

  assert.equal(ok, false);
  assert.equal(calls.length, 0);
  assert.match(app.lastToast, /permiso/i);
});

test('assignment posts the canonical person id with the audit fields', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/assign') return json(assetDto({ responsiblePersonId: OTHER_PERSON_ID }));
    return json({}, 404);
  });
  app.assignDialog = {
    open: true, mode: 'person', assetId: ASSET_ID, personId: '', selectedId: OTHER_PERSON_ID,
    search: '', reason: 'Traslado', notes: 'Entrega en mostrador', effectiveAt: '2026-02-01T09:30', error: ''
  };

  const ok = await app.assignServerAsset(ASSET_ID, OTHER_PERSON_ID, {
    reason: 'Traslado', notes: 'Entrega en mostrador', effectiveAt: '2026-02-01T09:30'
  });

  assert.equal(ok, true);
  const call = calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.body.personId, OTHER_PERSON_ID);
  assert.equal(call.body.reason, 'Traslado');
  assert.equal(call.body.notes, 'Entrega en mostrador');
  assert.match(call.body.effectiveAt, /^2026-02-01T\d\d:\d\d/);
  assert.match(call.body.effectiveAt, /(Z|[+-]\d\d:\d\d)$/);
});

test('an empty selection returns the asset instead of assigning nobody', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view', 'assets.assign']);
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/return') return json(assetDto({ responsiblePersonId: null, responsibleLabel: '' }));
    return json({}, 404);
  });
  app.assignDialog = {
    open: true, mode: 'person', assetId: ASSET_ID, personId: PERSON_ID, selectedId: '',
    search: '', reason: 'Fin de comodato', notes: '', effectiveAt: '', error: ''
  };

  const ok = await app.confirmAssignment();

  assert.equal(ok, true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, '/api/v1/assets/' + ASSET_ID + '/return');
  assert.equal(calls[0].body.reason, 'Fin de comodato');
});

test('relations read, create, move host and configure types with the documented routes', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view', 'assets.edit', 'config.general']);
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/relationship-types') === 0) return json([typeDto()]);
    if (call.url.indexOf('/api/v1/relationships?') === 0) return json({ items: [edgeDto()], total: 1, limit: 50, offset: 0 });
    if (call.url === '/api/v1/relationships') return json(edgeDto({ id: 'new-edge' }), 201);
    if (call.url === '/api/v1/relationships/host-move') return json({ childId: ASSET_ID, oldRelationship: edgeDto(), newRelationship: edgeDto({ id: 'new' }), effectiveAt: null });
    if (call.url === '/api/v1/relationship-types/hosted_in') return json(typeDto({ forwardLabel: 'Alojado en' }));
    return json({}, 404);
  });

  assert.equal(await app.loadOrganizationRelationTypes(), true);
  assert.equal(await app.loadOrganizationRelations(ASSET_ID), true);
  assert.equal(app.organization.relations.items[0].direction, 'outgoing');
  assert.equal(app.organization.relations.items[0].label, 'Alojado en');

  app.organization.dialogs.relation = {
    open: true, mode: 'create', id: '', sourceId: ASSET_ID, targetId: HOST_ID,
    typeKey: 'hosted_in', reason: 'Montaje', notes: '', effectiveAt: '', error: '', busy: false
  };
  assert.equal(await app.saveOrganizationRelation(), true);
  const create = calls.find((call) => call.url === '/api/v1/relationships');
  assert.deepEqual(create.body, { typeKey: 'hosted_in', reason: 'Montaje', sourceId: ASSET_ID, targetId: HOST_ID });

  app.organization.dialogs.hostMove = {
    open: true, childId: ASSET_ID, newHostId: HOST_ID, reason: 'Cambio de host', notes: '', effectiveAt: '', error: '', busy: false
  };
  assert.equal(await app.confirmOrganizationHostMove(), true);
  assert.match(calls.find((call) => call.url === '/api/v1/relationships/host-move').init.method, /POST/);

  app.organization.dialogs.type = {
    open: true, mode: 'edit', key: 'hosted_in', forwardLabel: 'Alojado en',
    inverseLabel: 'Aloja', containment: true, active: false, error: '', busy: false
  };
  assert.equal(await app.saveOrganizationType(), true);
  const patch = calls.find((call) => call.url === '/api/v1/relationship-types/hosted_in');
  assert.equal(patch.init.method, 'PATCH');
  assert.equal(patch.body.active, false);
});

test('graph requests stay bounded and never invent nodes for dangling edges', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view']);
  app.route = { name: 'graph', personId: '', assetId: '', section: '', focusId: ASSET_ID };
  const calls = stub(c, () => json({
    rootId: ASSET_ID,
    depth: 2,
    direction: 'both',
    nodes: [{ id: ASSET_ID, quickCode: 'NB-CEN-001', name: 'Notebook de dirección', category: 'Notebooks', type: 'Notebook', status: 'in_use', archived: false }],
    edges: [edgeDto({ targetId: HOST_ID })],
    truncated: true,
    nodesTruncated: true,
    edgesTruncated: false,
    depthTruncated: false,
    limit: 200,
    offset: 0,
    total: 1
  }));

  assert.equal(await app.loadOrganizationGraph({ rootId: ASSET_ID, depth: 2 }), true);

  assert.match(calls[0].url, /rootId=/);
  assert.match(calls[0].url, /depth=2/);
  assert.match(calls[0].url, /limit=200/);
  assert.equal(app.organization.graph.truncated, true);
  const source = app.organizationGraphSource;
  assert.equal(source.assets.length, 1, 'only server nodes become graph nodes');
  assert.equal(source.relations.links.length, 1);
  assert.equal(source.assets.some((asset) => asset.id === HOST_ID), false);
});

test('map positions convert between canvas pixels and canonical decimals', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view', 'assets.edit']);
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/map') === 0) return json({
      sites: [{ id: SITE_ID, name: 'Sede Central', latitude: -25.28, longitude: -57.63 }],
      positions: [{ assetId: ASSET_ID, quickCode: 'NB-CEN-001', name: 'Notebook de dirección', siteId: SITE_ID, locationId: FLOOR_ID, x: 0.125, y: 0.5 }],
      limit: 50, offset: 0, truncated: false
    });
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: [siteDto(), floorDto()], total: 2, limit: 200, offset: 0 });
    if (call.url === '/api/v1/assets/' + ASSET_ID) return json(assetDto({ positionX: '0.25', positionY: '0.5' }));
    return json({}, 404);
  });

  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  const maps = app.organizationMapSource.maps;
  assert.ok(maps.positions[ASSET_ID], 'the asset keeps a canvas position');
  assert.equal(maps.positions[ASSET_ID].x, Math.round(0.125 * 1600));
  assert.equal(maps.positions[ASSET_ID].y, Math.round(0.5 * 1000));
  assert.equal(maps.serverMap, true);
  assert.equal(maps.sites.some((site) => site.id === SITE_ID), true, 'sites come from the server map payload');
  maps.plans.forEach((plan) => {
    assert.equal(plan.src, '', 'a plan reference is metadata, never a fetched file');
    assert.equal(plan.illustrative, false);
  });

  assert.equal(await app.saveOrganizationPosition(ASSET_ID, FLOOR_ID, 400, 500), true);
  const patch = calls.find((call) => call.url === '/api/v1/assets/' + ASSET_ID);
  assert.equal(patch.init.method, 'PATCH');
  assert.equal(patch.body.locationId, FLOOR_ID);
  assert.equal(patch.body.positionX, '0.25');
  assert.equal(patch.body.positionY, '0.5');
});

test('server state never reaches localStorage for directory, graph or map', async () => {
  const { c, app } = serverApp(['people.view', 'assets.view']);
  const writes = [];
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return original(key, value); };
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/people') === 0) return json({ items: [personDto()], total: 1, limit: 50, offset: 0 });
    if (call.url.indexOf('/api/v1/map') === 0) return json({ sites: [], positions: [], limit: 50, offset: 0, truncated: false });
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: [siteDto()], total: 1, limit: 200, offset: 0 });
    return json({}, 404);
  });

  await app.loadOrganizationPeople({ offset: 0 });
  await app.loadOrganizationMap({ siteId: '' });

  assert.deepEqual(writes, []);
});
