'use strict';
// Phase 5 completion regressions: the capability split, the location hierarchy,
// the transfer dialog, structured asset history and authenticated universal
// search. Every case evaluates the real AssetAccess permission methods
// (can/canConfig/requirePermission/accessRoute); no test replaces them with an
// always-true lambda, so a missing permission hides data instead of passing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PERSON_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_PERSON_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const DEPT_ID = 'cccccccc-1111-2222-3333-444444444444';
const SITE_ID = 'dddddddd-1111-2222-3333-444444444444';
const BUILDING_ID = 'abababab-1111-2222-3333-444444444444';
const FLOOR_ID = 'eeeeeeee-1111-2222-3333-444444444444';
const ROOM_ID = 'f0f0f0f0-1111-2222-3333-444444444444';
// A floor whose building is not part of the loaded page: the nearest site
// ancestor is unknown, so no site may be invented for it.
const ORPHAN_ID = '12121212-1111-2222-3333-444444444444';
const MISSING_PARENT_ID = '34343434-1111-2222-3333-444444444444';
const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const HOST_ID = '99999999-8888-7777-6666-555555555555';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function stub(c, handler) {
  const calls = [];
  c.fetch = async (url, init) => {
    const call = { url, init: init || {}, body: init && init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  };
  return calls;
}

// Real permissions: the shared harness installs a full-catalog session and then
// stubs `can` with an always-true lambda. Rebinding the adapter's own methods
// restores the production evaluation path used by the Vue views.
function realApp(permissions) {
  const { c, app } = setup();
  for (const name of ['can', 'canConfig', 'requirePermission', 'accessRoute']) {
    assert.equal(typeof c.options.methods[name], 'function', 'AssetAccess.methods.' + name + ' must exist');
    app[name] = c.options.methods[name].bind(app);
  }
  app.route = { name: 'people', personId: '', assetId: '', section: '', focusId: '' };
  app.serverPermissions = permissions.slice();
  app.csrfToken = 'csrf-test-token';
  app.showToast = (message, tone) => {
    app.lastToast = message;
    app.lastToastTone = tone || 'ok';
  };
  return { c, app };
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
    responsible: 'Ana Benítez',
    positionX: '0.25',
    positionY: '0.5',
    status: 'in_use',
    description: '',
    archived: false,
    images: [],
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-06T11:30:00Z'
  }, overrides);
}

function departmentDto(overrides) {
  return Object.assign({
    id: DEPT_ID,
    name: 'Tecnología',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
}

function siteDto(overrides) {
  return Object.assign({
    id: SITE_ID,
    level: 'site',
    parentId: null,
    name: 'Sede Central',
    description: 'Casa central',
    latitude: '-25.28',
    longitude: '-57.63',
    planRef: '',
    planPage: '',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
}

function buildingDto(overrides) {
  return Object.assign({
    id: BUILDING_ID,
    level: 'building',
    parentId: SITE_ID,
    name: 'Edificio Norte',
    description: '',
    latitude: null,
    longitude: null,
    planRef: '',
    planPage: '',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
}

function floorDto(overrides) {
  return Object.assign({
    id: FLOOR_ID,
    level: 'floor',
    parentId: BUILDING_ID,
    name: 'Piso 4',
    description: '',
    latitude: null,
    longitude: null,
    planRef: 'plano-p4.pdf',
    planPage: '2',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
}

function roomDto(overrides) {
  return Object.assign({
    id: ROOM_ID,
    level: 'room_zone',
    parentId: FLOOR_ID,
    name: 'Sala de servidores',
    description: '',
    latitude: null,
    longitude: null,
    planRef: '',
    planPage: '',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z'
  }, overrides);
}

function locationPage() {
  return { items: [siteDto(), buildingDto(), floorDto(), roomDto()], total: 4, limit: 200, offset: 0 };
}

test('an authenticated session never falls back to prototype sites or people', async () => {
  const { c, app } = realApp(['assets.view']);
  const writes = [];
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return original(key, value); };
  assert.ok(app.config.sites.length > 0, 'the prototype fixture still carries demo sites');

  assert.equal(app.sites.length, 0, 'server authority must not expose prototype sites before a read');
  assert.equal(app.departments.length, 0, 'server authority must not expose prototype departments');

  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    return json({}, 404);
  });
  assert.equal(await app.loadOrganizationLocations(), true);
  assert.equal(app.sites.length, 1);
  assert.equal(app.sites[0].id, SITE_ID);
  assert.equal(app.filteredPeople.length, 0, 'no prototype people without people.view');

  app.route = { name: 'person', personId: PERSON_ID, assetId: '', section: '', focusId: '' };
  assert.equal(app.currentPerson, null, 'a person route must not expose a prototype person');
  assert.equal(app.accessRoute({ name: 'person', personId: PERSON_ID }).name, 'denied');
  assert.deepEqual(writes, []);
});

test('an asset-only role reads the map, graph and location tree without people.view', async () => {
  const { c, app } = realApp(['assets.view']);
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations/tree') === 0) {
      return json({ roots: [Object.assign(siteDto(), { children: [Object.assign(buildingDto(), { children: [floorDto()] })] })], nodeCount: 3, depth: 3, truncated: false });
    }
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    if (call.url.indexOf('/api/v1/map') === 0) {
      return json({ sites: [{ id: SITE_ID, name: 'Sede Central', latitude: -25.28, longitude: -57.63 }], positions: [{ assetId: ASSET_ID, quickCode: 'NB-CEN-001', name: 'Notebook de dirección', siteId: SITE_ID, locationId: FLOOR_ID, x: 0.125, y: 0.5 }], limit: 50, offset: 0, truncated: false });
    }
    if (call.url.indexOf('/api/v1/infrastructure/graph') === 0) {
      return json({ rootId: ASSET_ID, depth: 2, direction: 'both', nodes: [{ id: ASSET_ID, quickCode: 'NB-CEN-001', name: 'Notebook de dirección', category: 'Notebooks', type: 'Notebook', status: 'in_use', archived: false }], edges: [], total: 1, limit: 200, offset: 0, truncated: false, nodesTruncated: false, edgesTruncated: false, depthTruncated: false });
    }
    return json({}, 404);
  });

  assert.equal(await app.loadOrganizationMap({ siteId: '' }), true);
  assert.equal(app.serverMapMode, true);
  assert.equal(app.organizationMapSource.maps.sites.some((site) => site.id === SITE_ID), true);
  assert.equal(await app.loadOrganizationTree({ depth: 3 }), true);
  assert.equal(app.organization.tree.roots[0].children.length, 1, 'the hierarchy keeps building and floor levels');
  assert.equal(app.organization.tree.roots[0].children[0].children[0].level, 'floor');
  assert.equal(await app.loadOrganizationGraph({ rootId: ASSET_ID, depth: 2 }), true);
  assert.equal(app.organizationGraphSource.assets.length, 1);
  assert.equal(calls.some((call) => call.url.indexOf('/api/v1/people') === 0), false, 'no directory read is required for the map');
  assert.equal(app.can('people.view'), false);
});

test('a config-only capability gets an honest limit instead of demo data', async () => {
  const { c, app } = realApp(['config.sites', 'config.departments']);
  assert.equal(app.canConfig('sedes'), true);
  assert.equal(app.canConfig('personas'), true);
  assert.equal(app.can('assets.edit'), false, 'config.sites is not an assets.edit surrogate');

  const calls = stub(c, () => json({ error: { code: 'forbidden' } }, 403));
  assert.equal(await app.loadOrganizationLocations(), false);
  assert.match(app.organization.locations.error, /permiso/i);
  assert.equal(app.sites.length, 0, 'a denied read must not fall back to prototype sites');
  assert.equal(await app.loadOrganizationDepartments(), false);
  assert.match(app.organization.departments.error, /permiso/i);
  assert.equal(app.departments.length, 0);
  assert.equal(await app.loadOrganizationTree({ depth: 2 }), false);
  assert.equal(app.organization.tree.roots.length, 0);
  assert.equal(calls.every((call) => !call.init.method || call.init.method === 'GET'), true);
});

test('the configuration creates and edits every location level with server payloads', async () => {
  const { c, app } = realApp(['assets.view', 'config.sites']);
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations?') === 0) return json(locationPage());
    if (call.url === '/api/v1/locations' && call.init.method === 'POST') return json(buildingDto(), 201);
    if (call.url === '/api/v1/locations/' + FLOOR_ID) return json(floorDto({ name: 'Piso 4 Bis', planPage: '3' }));
    return json({}, 404);
  });
  assert.equal(await app.loadOrganizationLocations(), true);

  app.openOrganizationLocationDialog({ level: 'building', parentId: SITE_ID });
  assert.equal(app.organization.dialogs.location.open, true);
  assert.equal(app.organization.dialogs.location.level, 'building');
  assert.deepEqual(app.organizationParentChoices('building').map((item) => item.id), [SITE_ID]);
  assert.deepEqual(app.organizationParentChoices('floor').map((item) => item.id), [BUILDING_ID]);
  app.organization.dialogs.location.name = 'Edificio Norte';
  app.organization.dialogs.location.description = 'Ala norte';
  assert.equal(await app.saveOrganizationLocationDialog(), true);

  const post = calls.find((call) => call.url === '/api/v1/locations' && call.init.method === 'POST');
  assert.deepEqual(post.body, { level: 'building', parentId: SITE_ID, name: 'Edificio Norte', description: 'Ala norte' });
  assert.equal('latitude' in post.body, false, 'coordinates are an optional site-only pair');

  const floor = app.organization.locations.items.find((item) => item.id === FLOOR_ID);
  app.openOrganizationLocationDialog({ level: 'floor', location: floor });
  app.organization.dialogs.location.name = 'Piso 4 Bis';
  app.organization.dialogs.location.planPage = '3';
  assert.equal(await app.saveOrganizationLocationDialog(), true);

  const patch = calls.find((call) => call.url === '/api/v1/locations/' + FLOOR_ID);
  assert.equal(patch.init.method, 'PATCH');
  assert.equal(patch.body.name, 'Piso 4 Bis');
  assert.equal(patch.body.planRef, 'plano-p4.pdf');
  assert.equal(patch.body.planPage, '3');
  assert.equal('level' in patch.body, false, 'the level is immutable after creation');
  assert.equal('parentId' in patch.body, false, 'an unchanged parent is not resent');
  assert.equal(app.organization.dialogs.location.open, false);
});

test('the location dialog rejects an invalid parent or half coordinates before any request', async () => {
  const { c, app } = realApp(['assets.view', 'config.sites']);
  const calls = stub(c, () => json(locationPage()));
  await app.loadOrganizationLocations();
  const before = calls.length;

  app.openOrganizationLocationDialog({ level: 'floor', parentId: SITE_ID });
  app.organization.dialogs.location.name = 'Piso inválido';
  assert.equal(await app.saveOrganizationLocationDialog(), false);
  assert.match(app.organization.dialogs.location.error, /edificio/i);
  assert.equal(calls.length, before, 'an invalid parent never reaches the server');

  app.openOrganizationLocationDialog({ level: 'site' });
  app.organization.dialogs.location.name = 'Sede sin par';
  app.organization.dialogs.location.latitude = '-25.3';
  assert.equal(await app.saveOrganizationLocationDialog(), false);
  assert.match(app.organization.dialogs.location.error, /latitud y longitud/i);
  assert.equal(calls.length, before);

  app.organization.dialogs.location.latitude = '';
  app.organization.dialogs.location.planRef = 'plano.pdf';
  assert.equal(await app.saveOrganizationLocationDialog(), false);
  assert.match(app.organization.dialogs.location.error, /plano/i);
  assert.equal(calls.length, before);
});

test('a 409 keeps the location state intact and never reports success', async () => {
  const { c, app } = realApp(['assets.view', 'config.sites']);
  let conflict = false;
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations?') === 0) return json(locationPage());
    if (call.url === '/api/v1/locations' && call.init.method === 'POST') {
      conflict = true;
      return json({ error: { code: 'conflict' } }, 409);
    }
    return json({}, 404);
  });
  await app.loadOrganizationLocations();
  const before = app.organization.locations.items.length;
  app.lastToast = '';

  app.openOrganizationLocationDialog({ level: 'room_zone', parentId: FLOOR_ID });
  app.organization.dialogs.location.name = 'Sala duplicada';
  assert.equal(await app.saveOrganizationLocationDialog(), false);

  assert.equal(conflict, true);
  assert.equal(app.organization.locations.items.length, before, 'no local mutation on conflict');
  assert.match(app.organization.dialogs.location.error, /estado actual|conflicto|no se puede/i);
  assert.equal(app.organization.dialogs.location.open, true, 'the dialog stays open for correction');
  assert.notEqual(app.lastToast, 'Ubicación guardada.');
});

test('deactivation patches active and never deletes a location or department', async () => {
  const { c, app } = realApp(['people.view', 'config.departments', 'assets.view', 'config.sites']);
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations?') === 0) return json(locationPage());
    if (call.url.indexOf('/api/v1/departments?') === 0) return json({ items: [departmentDto()], total: 1, limit: 200, offset: 0 });
    if (call.url === '/api/v1/locations/' + ROOM_ID) return json(roomDto({ active: false }));
    if (call.url === '/api/v1/departments/' + DEPT_ID) return json(departmentDto({ active: false }));
    return json({}, 404);
  });
  await app.loadOrganizationLocations();
  await app.loadOrganizationDepartments();

  const room = app.organization.locations.items.find((item) => item.id === ROOM_ID);
  assert.equal(await app.setOrganizationLocationActive(room, false), true);
  const locationPatch = calls.find((call) => call.url === '/api/v1/locations/' + ROOM_ID);
  assert.equal(locationPatch.init.method, 'PATCH');
  assert.deepEqual(locationPatch.body, { active: false });
  assert.equal(app.organization.locations.items.find((item) => item.id === ROOM_ID).active, false);

  const department = app.organization.departments.items[0];
  assert.equal(await app.setOrganizationDepartmentActive(department, false), true);
  const departmentPatch = calls.find((call) => call.url === '/api/v1/departments/' + DEPT_ID);
  assert.equal(departmentPatch.init.method, 'PATCH');
  assert.deepEqual(departmentPatch.body, { active: false });
  assert.equal(app.organization.departments.items[0].active, false);

  app.requestDeleteSite(app.organizationServerSites[0]);
  app.requestDeleteLocation({ id: SITE_ID }, room);
  assert.equal(calls.some((call) => call.init.method === 'DELETE'), false, 'locations are deactivated, never deleted');
});

test('transfer requires a real change and sends canonical ids with the audit fields', async () => {
  const { c, app } = realApp(['assets.view', 'assets.edit']);
  // The detail route builds this state with the inventory mapper, not the
  // organization one; the fixture must be the state the runtime really has.
  app.inventoryDetail = { id: ASSET_ID, asset: app.inventoryMapAsset(assetDto()), loading: false, error: '' };
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    if (call.url === '/api/v1/assets/' + ASSET_ID && call.init.method === 'GET') return json(assetDto({ quickCode: 'NB-NOR-001', siteId: BUILDING_ID, locationId: FLOOR_ID }));
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/transfer') return json(assetDto({ quickCode: 'NB-NOR-001', siteId: BUILDING_ID, locationId: FLOOR_ID }));
    if (call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0) return json({ assetId: ASSET_ID, items: [], total: 0, limit: 25, offset: 0 });
    return json({}, 404);
  });
  await app.loadOrganizationLocations();

  app.openOrganizationTransfer(app.inventoryDetail.asset);
  assert.equal(app.organization.dialogs.transfer.open, true);
  app.organization.dialogs.transfer.siteId = SITE_ID;
  app.organization.dialogs.transfer.locationId = FLOOR_ID;
  assert.equal(await app.confirmOrganizationTransfer(), false);
  assert.match(app.organization.dialogs.transfer.error, /ya está|misma ubicación/i);
  assert.equal(calls.some((call) => call.url.indexOf('/transfer') !== -1), false, 'an unchanged transfer is refused locally');

  app.organization.dialogs.transfer.siteId = BUILDING_ID;
  app.organization.dialogs.transfer.reason = 'Traslado a oficina nueva';
  app.organization.dialogs.transfer.notes = 'Con monitor y docking';
  app.organization.dialogs.transfer.effectiveAt = '2026-03-01T09:30';
  assert.equal(await app.confirmOrganizationTransfer(), true);

  const transfer = calls.find((call) => call.url === '/api/v1/assets/' + ASSET_ID + '/transfer');
  assert.equal(transfer.init.method, 'POST');
  assert.equal(transfer.body.siteId, BUILDING_ID);
  assert.equal(transfer.body.locationId, FLOOR_ID);
  assert.equal(transfer.body.reason, 'Traslado a oficina nueva');
  assert.equal(transfer.body.notes, 'Con monitor y docking');
  assert.match(transfer.body.effectiveAt, /^2026-03-01T\d\d:\d\d/);
  assert.equal('quickCode' in transfer.body, false, 'the server owns the quick code');

  assert.equal(calls.some((call) => call.url === '/api/v1/assets/' + ASSET_ID && call.init.method === 'GET'), true, 'the asset is reloaded from the server');
  assert.equal(calls.some((call) => call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0), true, 'the history is reloaded from the server');
  assert.equal(app.organization.dialogs.transfer.open, false);
});

test('a transfer conflict or a logout mid-flight never reports a false success', async () => {
  const { c, app } = realApp(['assets.view', 'assets.edit']);
  // The detail route builds this state with the inventory mapper, not the
  // organization one; the fixture must be the state the runtime really has.
  app.inventoryDetail = { id: ASSET_ID, asset: app.inventoryMapAsset(assetDto()), loading: false, error: '' };
  let mode = 'conflict';
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/transfer') {
      if (mode === 'conflict') return json({ error: { code: 'conflict' } }, 409);
      return json(assetDto());
    }
    if (call.url === '/api/v1/assets/' + ASSET_ID) return json(assetDto());
    if (call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0) return json({ assetId: ASSET_ID, items: [], total: 0, limit: 25, offset: 0 });
    return json({}, 404);
  });
  await app.loadOrganizationLocations();

  app.lastToast = '';
  app.openOrganizationTransfer(app.inventoryDetail.asset);
  app.organization.dialogs.transfer.siteId = BUILDING_ID;
  assert.equal(await app.confirmOrganizationTransfer(), false);
  assert.match(app.organization.dialogs.transfer.error, /estado actual|conflicto|no se puede/i);
  assert.notEqual(app.lastToast, 'Activo trasladado.');

  // A logout while the write is in flight must not revive the dialog or toast.
  mode = 'ok';
  app.openOrganizationTransfer(app.inventoryDetail.asset);
  app.organization.dialogs.transfer.siteId = BUILDING_ID;
  app.lastToast = '';
  const pending = app.confirmOrganizationTransfer();
  app.clearOrganizationState();
  app.authenticated = false;
  assert.equal(await pending, false);
  assert.notEqual(app.lastToast, 'Activo trasladado.');
  assert.equal(app.organization.dialogs.transfer.open, false);
});

test('assigning from the asset sheet keeps the canonical responsible in the detail header', async () => {
  const { c, app } = realApp(['assets.view', 'assets.assign']);
  app.route = { name: 'detail', assetId: ASSET_ID, personId: '', section: '', focusId: '' };
  // The person picker is not the subject; only the detail and the write are.
  app.organization.people.loaded = true;
  let assigned = false;
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + ASSET_ID + '/assign') {
      assigned = true;
      return json(assetDto({ responsiblePersonId: OTHER_PERSON_ID, responsibleLabel: 'Luis Giménez', responsible: 'Luis Giménez' }));
    }
    if (call.url === '/api/v1/assets/' + ASSET_ID) {
      return json(assigned ? assetDto({ responsiblePersonId: OTHER_PERSON_ID, responsibleLabel: 'Luis Giménez', responsible: 'Luis Giménez' }) : assetDto());
    }
    if (call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0) {
      return json({ assetId: ASSET_ID, items: [], total: 0, limit: 50, offset: 0 });
    }
    return json({}, 404);
  });

  assert.equal(await app.loadInventoryDetail(ASSET_ID), true);
  assert.equal(app.currentAsset.responsiblePersonId, PERSON_ID);
  assert.equal(app.currentAsset.responsibleLabel, 'Ana Benítez');
  assert.equal(app.currentAsset.siteId, SITE_ID);
  assert.equal(app.currentAsset.locationId, FLOOR_ID);

  // The detail template conditions, evaluated with the real AssetAccess.can.
  const assignVisible = () => app.serverAssetMode && app.can('assets.assign') && !app.currentAsset.retired && !app.currentAsset.archived;
  const returnVisible = () => app.serverAssetMode && app.can('assets.assign') && !!app.currentAsset.responsiblePersonId;
  const assignLabel = () => (app.currentAsset.responsiblePersonId ? 'Reasignar responsable' : 'Asignar responsable');
  assert.equal(assignVisible(), true);
  assert.equal(returnVisible(), true);
  assert.equal(assignLabel(), 'Reasignar responsable');

  app.openAssignAsset(app.currentAsset);
  assert.equal(app.assignDialog.open, true);
  assert.equal(app.assignDialog.assetId, ASSET_ID);
  assert.equal(app.assignDialog.selectedId, PERSON_ID, 'the dialog preselects the current responsible');
  assert.equal(app.assignDialog.personId, PERSON_ID);

  app.assignDialog.selectedId = OTHER_PERSON_ID;
  assert.equal(await app.confirmAssignment(), true);
  assert.equal(app.lastToast, 'Activo asignado.');
  assert.equal(app.assignDialog.open, false);

  const post = calls.find((call) => call.url === '/api/v1/assets/' + ASSET_ID + '/assign');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.body.personId, OTHER_PERSON_ID);
  const detailReads = calls.filter((call) => call.url === '/api/v1/assets/' + ASSET_ID);
  assert.equal(detailReads.length, 2, 'the detail is reloaded from the server after the write');
  assert.ok(calls.indexOf(post) < calls.indexOf(detailReads[1]), 'the reload happens after the write');
  assert.equal(calls.some((call) => call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0), true);

  assert.equal(app.currentAsset.id, ASSET_ID);
  assert.equal(app.currentAsset.responsiblePersonId, OTHER_PERSON_ID);
  assert.equal(app.currentAsset.responsible, 'Luis Giménez');
  assert.equal(returnVisible(), true);
  assert.equal(assignLabel(), 'Reasignar responsable');
});

test('without assets.assign the return action stays unavailable and nothing is written', async () => {
  const { c, app } = realApp(['assets.view']);
  app.route = { name: 'detail', assetId: ASSET_ID, personId: '', section: '', focusId: '' };
  const calls = stub(c, (call) => {
    if (call.url === '/api/v1/assets/' + ASSET_ID) return json(assetDto());
    return json({}, 404);
  });

  assert.equal(await app.loadInventoryDetail(ASSET_ID), true);
  assert.equal(app.can('assets.assign'), false);
  assert.equal(app.serverAssetMode && app.can('assets.assign') && !!app.currentAsset.responsiblePersonId, false);

  app.openAssignAsset(app.currentAsset);
  assert.equal(app.assignDialog.open, false, 'the dialog never opens without the permission');
  assert.equal(await app.confirmAssignment(), false);
  assert.equal(calls.some((call) => call.init.method && call.init.method !== 'GET'), false, 'no write is sent');
});

test('asset history keeps actor, source, entity, effective time, notes and values', async () => {
  const { c, app } = realApp(['assets.view']);
  const items = [
    {
      id: 'h1',
      sequence: 2,
      assetId: ASSET_ID,
      action: 'assigned',
      quickCodeOld: 'NB-CEN-001',
      quickCodeNew: 'NB-CEN-001',
      statusOld: 'in_storage',
      statusNew: 'in_use',
      archivedOld: false,
      archivedNew: false,
      changes: { responsible: { old: null, new: 'Ana Benítez' } },
      reason: 'Entrega al usuario',
      actorId: 'user-1',
      actorUsername: 'maria',
      createdAt: '2026-02-02T10:00:00Z',
      source: 'rest',
      entityType: 'asset',
      entityId: ASSET_ID,
      effectiveAt: '2026-02-01T00:00:00Z',
      notes: 'Firmó el comodato'
    },
    {
      id: 'h2',
      sequence: 3,
      assetId: ASSET_ID,
      action: 'transferred',
      quickCodeOld: 'NB-CEN-001',
      quickCodeNew: 'NB-NOR-001',
      statusOld: null,
      statusNew: null,
      archivedOld: null,
      archivedNew: null,
      changes: { site_id: { old: SITE_ID, new: BUILDING_ID } },
      reason: 'Mudanza de oficina',
      actorId: 'user-1',
      actorUsername: 'maria',
      createdAt: '2026-02-03T10:00:00Z',
      source: 'agent',
      entityType: 'asset',
      entityId: ASSET_ID,
      effectiveAt: null,
      notes: null
    }
  ];
  stub(c, () => json({ assetId: ASSET_ID, items, total: 2, limit: 25, offset: 0 }));

  assert.equal(await app.loadInventoryHistory(ASSET_ID), true);
  const [assigned, transferred] = app.inventoryHistory.items;

  assert.equal(assigned.actorId, 'user-1');
  assert.equal(assigned.actor, 'maria');
  assert.equal(assigned.source, 'rest');
  assert.equal(assigned.entityType, 'asset');
  assert.equal(assigned.entityId, ASSET_ID);
  assert.equal(assigned.effectiveAt, '2026-02-01T00:00:00Z');
  assert.equal(assigned.notes, 'Firmó el comodato');
  assert.equal(assigned.recordedAt, '2026-02-02T10:00:00Z');
  assert.equal(assigned.changes.responsible.new, 'Ana Benítez');
  assert.equal(assigned.title, 'Responsable asignado');

  assert.equal(transferred.quickCodeOld, 'NB-CEN-001');
  assert.equal(transferred.quickCodeNew, 'NB-NOR-001');
  assert.equal(transferred.source, 'agent');
  assert.equal(transferred.title, 'Activo trasladado');
  assert.equal(transferred.changes.site_id.old, SITE_ID);
  assert.equal(transferred.changes.site_id.new, BUILDING_ID);
});

test('a person page shows the real asset movement trail, not directory events', async () => {
  const { c, app } = realApp(['people.view', 'assets.view']);
  app.route = { name: 'person', personId: PERSON_ID, assetId: '', section: '', focusId: '' };
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/people/' + PERSON_ID + '/assets') === 0) {
      return json({ items: [assetDto(), assetDto({ id: HOST_ID, quickCode: 'SRV-CEN-001', name: 'Servidor' })], total: 2, limit: 50, offset: 0 });
    }
    if (call.url.indexOf('/api/v1/assets/' + ASSET_ID + '/history') === 0) {
      return json({ assetId: ASSET_ID, items: [{ id: 'a1', sequence: 1, assetId: ASSET_ID, action: 'assigned', quickCodeOld: null, quickCodeNew: 'NB-CEN-001', statusOld: null, statusNew: 'in_use', archivedOld: null, archivedNew: null, changes: {}, reason: 'Alta', actorId: 'user-1', actorUsername: 'maria', createdAt: '2026-02-02T10:00:00Z', source: 'rest', entityType: 'asset', entityId: ASSET_ID, effectiveAt: null, notes: null }], total: 1, limit: 25, offset: 0 });
    }
    if (call.url.indexOf('/api/v1/assets/' + HOST_ID + '/history') === 0) {
      return json({ assetId: HOST_ID, items: [{ id: 'a2', sequence: 1, assetId: HOST_ID, action: 'transferred', quickCodeOld: 'SRV-CEN-001', quickCodeNew: 'SRV-NOR-001', statusOld: null, statusNew: null, archivedOld: null, archivedNew: null, changes: {}, reason: 'Mudanza', actorId: 'user-2', actorUsername: 'jose', createdAt: '2026-02-04T10:00:00Z', source: 'rest', entityType: 'asset', entityId: HOST_ID, effectiveAt: null, notes: null }], total: 1, limit: 25, offset: 0 });
    }
    return json({}, 404);
  });

  assert.equal(await app.loadOrganizationPersonAssets(PERSON_ID), true);
  assert.equal(await app.loadOrganizationPersonAssetHistory(PERSON_ID), true);

  const trail = app.organization.personAssetHistory.items;
  assert.equal(trail.length, 2);
  assert.equal(trail.map((item) => item.assetId).sort().join(','), [ASSET_ID, HOST_ID].sort().join(','));
  assert.equal(trail.every((item) => item.entityType === 'asset'), true, 'the trail carries asset events only');
  assert.equal(trail.every((item) => ['assigned', 'returned', 'transferred'].indexOf(item.action) !== -1), true);
  assert.equal(trail.find((item) => item.assetId === HOST_ID).quickCode, 'SRV-CEN-001');
  assert.equal(trail.find((item) => item.assetId === HOST_ID).title, 'Activo trasladado');
  assert.equal(calls.some((call) => call.url.indexOf('/people/' + PERSON_ID + '/history') === 0), false, 'directory history is a separate, factual panel');
});

test('authenticated universal search never indexes prototype people or sites', async () => {
  const { c, app } = realApp(['people.view', 'assets.view']);
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/people') === 0) return json({ items: [personDto()], total: 1, limit: 50, offset: 0 });
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    return json({}, 404);
  });
  await app.loadOrganizationPeople({ offset: 0 });
  await app.loadOrganizationLocations();

  const keys = app.universalRecords.map((record) => record.key);
  app.people.slice(0, 3).forEach((person) => {
    assert.equal(keys.indexOf('person:' + person.id), -1, 'prototype people stay out of the authenticated search');
  });
  app.config.sites.slice(0, 3).forEach((site) => {
    assert.equal(keys.indexOf('site:' + site.id), -1, 'prototype sites stay out of the authenticated search');
  });
  assert.equal(keys.indexOf('person:' + PERSON_ID) !== -1, true, 'server people are searchable');
  assert.equal(keys.indexOf('site:' + SITE_ID) !== -1, true, 'server sites are searchable');
});

test('the prototype people watcher stays silent in an authenticated session', async () => {
  const { c, app } = realApp(['people.view']);
  const writes = [];
  c.localStorage.setItem = (key, value) => { writes.push(key); return true; };
  const handler = c.options.watch.people.handler;
  handler.call(app, app.people);
  assert.deepEqual(writes, [], 'server people never reach localStorage');
});

test('a canonical location search opens the map on its real site, location and level', async () => {
  const { c, app } = realApp(['people.view', 'assets.view']);
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json(locationPage());
    if (call.url.indexOf('/api/v1/people') === 0) return json({ items: [personDto()], total: 1, limit: 50, offset: 0 });
    return json({}, 404);
  });
  assert.equal(await app.loadOrganizationLocations(), true);
  assert.equal(await app.loadOrganizationPeople({ offset: 0 }), true);
  app.route = { name: 'map', personId: '', assetId: '', section: '', focusId: '' };
  const view = { level: 'floor', activeSiteId: '', activeFloorId: '', selectedId: '', selectedRoom: '', filters: {} };
  app.$refs = { workspaceView: view };

  const record = app.universalRecords.find((row) => row.key === 'location:' + BUILDING_ID + ':' + FLOOR_ID);
  assert.ok(record, 'the floor keeps its composite record key');
  assert.equal(record.target.id, FLOOR_ID, 'the target carries the location UUID, not the composite key');
  assert.equal(record.target.siteId, SITE_ID, 'the target carries the nearest site ancestor, not the composite key');

  app.openWorkspaceTarget(record);
  assert.equal(app.lastHash, '#/infra/mapa');
  assert.deepEqual(Array.from(app.explorerFilters.sites), [SITE_ID], 'the site filter is the real site, not a composite key');
  assert.deepEqual(Array.from(app.explorerFilters.locations), [FLOOR_ID]);
  assert.equal(view.level, 'geo');
  assert.equal(view.activeSiteId, SITE_ID);
  assert.equal(view.activeFloorId, '');
  assert.equal(c.AssetMapEngine.siteById(app, SITE_ID).id, SITE_ID);
  assert.equal(c.AssetMapEngine.siteById(app, view.activeSiteId).label, 'Sede Central');
});

test('a canonical room resolves its site two levels up and a location without a site ancestor is not routed', async () => {
  const { c, app } = realApp(['assets.view']);
  const orphan = floorDto({ id: ORPHAN_ID, parentId: MISSING_PARENT_ID });
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/locations') === 0) return json({ items: [siteDto(), buildingDto(), floorDto(), roomDto(), orphan], total: 5, limit: 200, offset: 0 });
    return json({}, 404);
  });
  assert.equal(await app.loadOrganizationLocations(), true);

  const room = app.universalRecords.find((row) => row.key === 'location:' + FLOOR_ID + ':' + ROOM_ID);
  assert.ok(room, 'the room is searchable');
  assert.equal(room.target.id, ROOM_ID);
  assert.equal(room.target.siteId, SITE_ID, 'the site is the nearest site ancestor, not the direct parent');
  const keys = app.universalRecords.map((row) => row.key);
  assert.equal(keys.indexOf('location:' + MISSING_PARENT_ID + ':' + ORPHAN_ID), -1, 'a location without a known site ancestor stays out of the map index');
  assert.equal(keys.indexOf('site:' + MISSING_PARENT_ID), -1, 'no site is invented for that ancestor');
});

test('authenticated universal search keeps person and location rows empty until the canonical reads answer', async () => {
  const { c, app } = realApp(['people.view', 'assets.view']);
  const organizationKeys = () => Array.from(app.universalRecords.map((row) => row.key)).filter((key) => /^(person|site|location):/.test(key));
  assert.deepEqual(organizationKeys(), [], 'no prototype or invented organization record before a read');
  stub(c, () => json({ error: { code: 'forbidden' } }, 403));
  assert.equal(await app.loadOrganizationLocations(), false);
  assert.equal(await app.loadOrganizationPeople({ offset: 0 }), false);
  assert.match(app.organization.locations.error, /permisos/i);
  assert.deepEqual(organizationKeys(), [], 'a failed canonical read yields no organization row, never demo data');
});