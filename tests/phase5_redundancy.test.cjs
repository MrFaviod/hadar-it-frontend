'use strict';
// Phase 5 redundancy groups: bounded inventory facts, complete member replacement
// and the graph/asset surfaces that read them. Every expectation derives from the
// accepted backend contract (group/member DTO, `active_active` shares that total
// exactly 100, `active_passive` primary+backup, no partial member writes), not
// from the adapter implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const HOST_1 = '11111111-aaaa-4bbb-8ccc-000000000001';
const HOST_2 = '11111111-aaaa-4bbb-8ccc-000000000002';
const ASSET_A = '22222222-aaaa-4bbb-8ccc-00000000000a';
const ASSET_B = '22222222-aaaa-4bbb-8ccc-00000000000b';
const ASSET_C = '22222222-aaaa-4bbb-8ccc-00000000000c';
const GROUP_ID = '33333333-aaaa-4bbb-8ccc-000000000001';
const GROUP_ID_2 = '33333333-aaaa-4bbb-8ccc-000000000002';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function failure(code, status) {
  return json({ error: { code, message: 'rejected' } }, status || 409);
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

function memberDto(overrides) {
  return Object.assign({
    assetId: ASSET_A,
    name: 'Réplica A',
    quickCode: 'RD-A',
    archived: false,
    role: null,
    share: '40',
    host: { id: HOST_1, name: 'Host Norte' }
  }, overrides);
}

function groupDto(overrides) {
  return Object.assign({
    id: GROUP_ID,
    name: 'Portal web',
    description: 'Balanceo AB 40/60 entre dos réplicas',
    mode: 'active_active',
    active: true,
    createdAt: '2026-06-01T12:00:00+00:00',
    updatedAt: '2026-06-01T12:00:00+00:00',
    memberCount: 2,
    members: [
      memberDto(),
      memberDto({ assetId: ASSET_B, name: 'Réplica B', quickCode: 'RD-B', share: '60', host: { id: HOST_2, name: 'Host Sur' } })
    ]
  }, overrides);
}

function passiveGroupDto(overrides) {
  return groupDto(Object.assign({
    id: GROUP_ID_2,
    name: 'Base de datos',
    mode: 'active_passive',
    members: [
      memberDto({ assetId: ASSET_A, name: 'Réplica A', role: 'primary', share: null, host: { id: HOST_1, name: 'Host Norte' } }),
      memberDto({ assetId: ASSET_B, name: 'Réplica B', role: 'backup', share: null, host: null })
    ]
  }, overrides));
}

function assetDto(overrides) {
  return Object.assign({
    id: ASSET_A,
    quickCode: 'RD-A',
    name: 'Réplica A',
    category: 'Servidores',
    type: 'Servidor',
    site: '',
    siteId: '',
    location: '',
    locationId: '',
    status: 'in_use',
    archived: false,
    positionX: null,
    positionY: null
  }, overrides);
}

// Real permission evaluation: `can` reads the session's serverPermissions, so a
// missing capability removes the write instead of being papered over.
function serverApp(permissions) {
  const session = setup();
  const { c, app } = session;
  app.route = { name: 'detail', assetId: ASSET_A, personId: '', section: '', focusId: '' };
  app.serverPermissions = permissions.slice();
  app.csrfToken = 'csrf-test-token';
  ['can', 'canConfig', 'requirePermission'].forEach((name) => {
    app[name] = c.options.methods[name].bind(app);
  });
  return session;
}

function groupCalls(calls, method) {
  return calls.filter((call) => call.url.indexOf('/api/v1/redundancy-groups') === 0
    && (!method || call.init.method === method));
}

// Fills the real adapter draft, the same object the rendered form edits.
function openCreateDraft(app, members) {
  app.openRedundancyCreate();
  const dialog = app.redundancy.dialog;
  dialog.name = 'Portal web';
  const list = members || [
    { assetId: ASSET_A, name: 'Réplica A', share: '40', role: '', host: { id: HOST_1, name: 'Host Norte' } },
    { assetId: ASSET_B, name: 'Réplica B', share: '60', role: '', host: { id: HOST_2, name: 'Host Sur' } }
  ];
  list.forEach((entry) => {
    app.addRedundancyMember({ id: entry.assetId, name: entry.name });
    const added = dialog.members.find((item) => item.assetId === entry.assetId);
    if (entry.share !== undefined) app.setRedundancyShare(entry.assetId, entry.share);
    if (entry.role !== undefined) added.role = entry.role;
  });
  return dialog;
}

// Seeds the adapter's own read state instead of calling a production hook that
// only exists for tests. The group DTOs remain literal contract fixtures.
function seedAssetGroups(app, page) {
  Object.assign(app.redundancy.assetGroups, {
    assetId: ASSET_A, items: [], total: 0, examined: 0, loaded: true, loading: false, error: ''
  }, page);
  app.redundancy.assetGroups.truncated = app.redundancy.assetGroups.examined < app.redundancy.assetGroups.total;
}

// ---------------------------------------------------------------- adapter

test('the asset sheet matches groups against one bounded server page and reports what it did not examine', async () => {
  const { c, app } = serverApp(['assets.view']);
  const calls = stub(c, () => json({
    total: 3,
    limit: 200,
    offset: 0,
    items: [groupDto({ members: [memberDto({ assetId: ASSET_C })], memberCount: 1 }), passiveGroupDto()]
  }));

  const ok = await app.loadRedundancyGroupsForAsset(ASSET_A);
  assert.equal(ok, true);

  const reads = calls.filter((call) => call.url.indexOf('/api/v1/redundancy-groups') === 0);
  assert.equal(reads.length, 1, 'the sheet reads one bounded page, never the whole inventory');
  assert.match(reads[0].url, /limit=200/);
  assert.match(reads[0].url, /offset=0/);

  const state = app.redundancy.assetGroups;
  assert.deepEqual(state.items.map((group) => group.id), [GROUP_ID_2], 'only groups that name the asset are listed');
  assert.equal(state.examined, 2, 'the page size actually examined is stated');
  assert.equal(state.total, 3, 'the server total is preserved so the gap can be disclosed');
  assert.equal(state.truncated, true);

  const [group] = state.items;
  assert.equal(group.mode, 'active_passive');
  assert.equal(group.members[0].role, 'primary');
  assert.equal(group.members[0].host.name, 'Host Norte');
  assert.equal(group.members[1].host, null, 'a member without hosted_in keeps a null host');
});

test('creating a 40:60 active/active group posts the complete member list exactly once', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  const dialog = openCreateDraft(app);
  dialog.description = 'Reparto 40/60';

  const ok = await app.saveRedundancyGroup();
  assert.equal(ok, true);
  const writes = groupCalls(calls, 'POST');
  assert.equal(writes.length, 1, 'one request, not one write per member');
  assert.equal(writes[0].url, '/api/v1/redundancy-groups');
  assert.deepEqual(writes[0].body, {
    name: 'Portal web',
    description: 'Reparto 40/60',
    mode: 'active_active',
    active: true,
    members: [{ assetId: ASSET_A, share: '40' }, { assetId: ASSET_B, share: '60' }]
  });
  assert.equal(app.redundancy.dialog.open, false);
});

test('an active/active draft whose shares do not total 100 never reaches the server', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  const dialog = openCreateDraft(app, [
    { assetId: ASSET_A, name: 'Réplica A', share: '40' },
    { assetId: ASSET_B, name: 'Réplica B', share: '50' }
  ]);

  const first = await app.saveRedundancyGroup();
  assert.equal(first, false);
  assert.equal(groupCalls(calls, 'POST').length, 0, 'an impossible total is not sent as a guess');
  assert.match(dialog.error, /100/);

  dialog.members[1].share = '60';
  assert.equal(app.validateRedundancyDialog(), '', 'the same draft becomes valid once the total is exact');
});

test('shares stay exact decimals: non-finite, boolean and third-decimal values are refused', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  const dialog = openCreateDraft(app);

  ['NaN', 'Infinity', '33.333', '-5', '101'].forEach((value) => {
    dialog.members[0].share = value;
    dialog.members[1].share = '60';
    assert.notEqual(app.validateRedundancyDialog(), '', value + ' is not a valid share');
  });

  dialog.members[0].share = '40.0';
  dialog.members[1].share = '60.00';
  assert.equal(app.validateRedundancyDialog(), '', 'trailing zeros stay exact and valid');
  await app.saveRedundancyGroup();
  const writes = groupCalls(calls, 'POST');
  assert.deepEqual(writes[0].body.members, [
    { assetId: ASSET_A, share: '40.0' },
    { assetId: ASSET_B, share: '60.00' }
  ], 'the client never rewrites the configured percentage');
});

test('an active/passive draft declares one principal and a backup without inventing shares', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(passiveGroupDto(), 201));
  app.openRedundancyCreate();
  app.setRedundancyDialogMode('active_passive');
  const dialog = app.redundancy.dialog;
  dialog.name = 'Base de datos';
  app.addRedundancyMember({ id: ASSET_A, name: 'Réplica A' });
  app.addRedundancyMember({ id: ASSET_B, name: 'Réplica B' });

  assert.equal(dialog.members[0].role, 'primary', 'the first member becomes the draft principal');
  assert.equal(dialog.members[1].role, 'backup');
  assert.equal(app.validateRedundancyDialog(), '');
  const ok = await app.saveRedundancyGroup();
  assert.equal(ok, true);

  const [write] = groupCalls(calls, 'POST');
  assert.equal(write.body.mode, 'active_passive');
  assert.deepEqual(write.body.members, [
    { assetId: ASSET_A, role: 'primary' },
    { assetId: ASSET_B, role: 'backup' }
  ], 'no fake 0/100 share is sent in passive mode');

  app.openRedundancyEdit(passiveGroupDto());
  assert.equal(app.validateRedundancyDialog(), '');
  app.setRedundancyRole(ASSET_B, 'primary');
  assert.notEqual(app.validateRedundancyDialog(), '', 'two principals are not a valid arrangement');
  app.setRedundancyRole(ASSET_A, 'backup');
  app.setRedundancyRole(ASSET_B, 'primary');
  assert.equal(app.validateRedundancyDialog(), '', 'one principal plus one backup is valid');
});

test('the draft refuses duplicate assets and more members than the server accepts', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  const dialog = openCreateDraft(app);
  app.addRedundancyMember({ id: ASSET_A, name: 'Réplica A' });
  assert.equal(dialog.members.length, 2, 'a repeated assetId is not added twice');
  assert.match(dialog.error, /ya forma parte/i);

  for (let index = 0; index < 60; index += 1) {
    app.addRedundancyMember({ id: 'asset-' + index, name: 'Activo ' + index });
  }
  assert.equal(dialog.members.length, 50, 'the draft stops at the server bound of 50 members');
  const single = openCreateDraft(app, [{ assetId: ASSET_A, name: 'Réplica A', share: '100' }]);
  single.members.push({ assetId: ASSET_A, name: 'Repetida', share: '0', role: '' });
  assert.notEqual(app.validateRedundancyDialog(), '', 'a duplicate list is never valid');
  assert.equal(groupCalls(calls, 'POST').length, 0);
});

test('editing sends the full member list, the group mode and an explicit null description', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(passiveGroupDto({ active: true })));
  app.openRedundancyEdit(passiveGroupDto({ active: false, description: 'Nota previa' }));
  const dialog = app.redundancy.dialog;
  dialog.name = 'Base de datos';
  dialog.description = '';
  app.setRedundancyDialogMode('active_active');
  app.setRedundancyShare(ASSET_A, '40');
  app.setRedundancyShare(ASSET_B, '60');

  const ok = await app.saveRedundancyGroup();
  assert.equal(ok, true);
  const [write] = groupCalls(calls, 'PATCH');
  assert.equal(write.url, '/api/v1/redundancy-groups/' + GROUP_ID_2);
  assert.equal(write.body.description, null, 'an emptied description clears the stored value');
  assert.equal(write.body.mode, 'active_active', 'the mode change travels with the complete list');
  assert.deepEqual(write.body.members, [
    { assetId: ASSET_A, share: '40' },
    { assetId: ASSET_B, share: '60' }
  ]);
});

test('deactivation uses the dedicated transition and a refused reactivation keeps the loaded membership', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/deactivate') !== -1) return json(groupDto({ active: false }));
    if (call.init.method === 'PATCH') return failure('conflict', 409);
    return json({ total: 1, limit: 200, offset: 0, items: [groupDto()] });
  });
  await app.loadRedundancyGroupsForAsset(ASSET_A);
  const before = JSON.stringify(app.redundancy.assetGroups.items);

  const ok = await app.deactivateRedundancyGroup(groupDto());
  assert.equal(ok, true);
  const [transition] = groupCalls(calls, 'POST');
  assert.equal(transition.url, '/api/v1/redundancy-groups/' + GROUP_ID + '/deactivate');
  assert.equal(groupCalls(calls, 'PATCH').length, 0, 'deactivation never guesses a patch');

  const reactivated = await app.reactivateRedundancyGroup(passiveGroupDto({ active: false }));
  assert.equal(reactivated, false, 'a refused activation is not reported as success');
  const patch = groupCalls(calls, 'PATCH').pop();
  assert.deepEqual(patch.body, { active: true });
  assert.equal(app.lastToast === 'Grupo reactivado.' || false, false, 'no success toast for a refusal');
  assert.equal(JSON.stringify(app.redundancy.assetGroups.items), before, 'the canonical membership already loaded is untouched');
  assert.match(app.redundancy.error, /estado actual/, 'the shared conflict message is what the operator reads');
});

test('a read-only session never opens the editor and never writes', async () => {
  const { c, app } = serverApp(['assets.view']);
  const calls = stub(c, () => json({ total: 0, limit: 200, offset: 0, items: [] }));
  await app.loadRedundancyGroupsForAsset(ASSET_A);

  app.openRedundancyCreate();
  assert.equal(app.redundancy.dialog.open, false, 'without assets.edit the editor does not open');
  app.redundancy.dialog.open = true;
  const ok = await app.saveRedundancyGroup();
  assert.equal(ok, false);
  assert.equal(groupCalls(calls, 'POST').length, 0);
  assert.equal(groupCalls(calls, 'PATCH').length, 0);
  const deactivated = await app.deactivateRedundancyGroup(groupDto());
  assert.equal(deactivated, false);
  assert.equal(groupCalls(calls, 'POST').length, 0);
});

test('a forbidden or failing read stays empty and names the problem instead of inventing groups', async () => {
  const { c, app } = serverApp(['assets.view']);
  stub(c, () => failure('forbidden', 403));
  const ok = await app.loadRedundancyGroupsForAsset(ASSET_A);
  assert.equal(ok, false);
  assert.deepEqual(Array.from(app.redundancy.assetGroups.items), []);
  assert.equal(app.redundancy.assetGroups.loaded, false);
  assert.equal(app.redundancy.assetGroups.error, 'No tienes permisos para realizar esta acción.');

  const denied = serverApp([]);
  stub(denied.c, () => json({ total: 1, limit: 200, offset: 0, items: [groupDto()] }));
  const read = await denied.app.loadRedundancyGroupsForAsset(ASSET_A);
  assert.equal(read, false, 'no assets.view means no read at all');
  assert.deepEqual(Array.from(denied.app.redundancy.assetGroups.items), []);
});

test('a group read that resolves after logout never revives rows', async () => {
  const { c, app } = serverApp(['assets.view']);
  let release;
  c.fetch = () => new Promise((resolve) => { release = () => resolve(json({ total: 1, limit: 200, offset: 0, items: [groupDto()] })); });
  const pending = app.loadRedundancyGroupsForAsset(ASSET_A);
  app.authenticated = false;
  app.clearRedundancyState();

  release();
  assert.equal(await pending, false);
  assert.deepEqual(Array.from(app.redundancy.assetGroups.items), []);
  assert.equal(app.redundancy.assetGroups.loaded, false);
});

test('a save that resolves after logout reports no success, no toast and no follow-up read', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  const dialog = openCreateDraft(app);
  let release;
  const realFetch = c.fetch;
  c.fetch = (url, init) => {
    calls.push({ url, init: init || {} });
    return new Promise((resolve) => { release = () => resolve(json(groupDto(), 201)); });
  };
  app.authenticated = true;
  const pending = app.saveRedundancyGroup();
  app.authenticated = false;
  app.clearRedundancyState();
  assert.equal(app.redundancy.dialog.open, false, 'logout closes the stale dialog');

  release();
  assert.equal(await pending, false);
  assert.notEqual(app.lastToast, 'Grupo de redundancia creado.');
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/redundancy-groups') === 0).length, 1,
    'no refresh is issued for a session that already ended');
  c.fetch = realFetch;
});

test('member search is a debounced bounded server query, not a client filter over one page', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json({ total: 1, limit: 50, offset: 0, items: [assetDto({ id: ASSET_C, name: 'Réplica C' })] }));
  app.openRedundancyCreate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const opened = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(opened.length, 1, 'opening the editor reads one bounded page');
  assert.match(opened[0].url, /limit=50/);
  assert.match(opened[0].url, /offset=0/);

  app.scheduleRedundancyAssetSearch('réplica');
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0).length, 1,
    'typing waits for the debounce');
  await new Promise((resolve) => setTimeout(resolve, 320));
  const searches = calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0);
  assert.equal(searches.length, 2, 'the typed term asks the server once');
  assert.match(searches[1].url, /limit=50/);
  assert.match(searches[1].url, /offset=0/);
  assert.match(searches[1].url, /query=r%C3%A9plica/);
  assert.equal(app.redundancy.assetSearch.items[0].id, ASSET_C, 'the server page is what the picker offers');

  app.scheduleRedundancyAssetSearch('otra');
  app.closeRedundancyDialog();
  app.clearRedundancyState();
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(calls.filter((call) => call.url.indexOf('/api/v1/assets/search') === 0).length, 2,
    'a pending debounce is cancelled when the dialog or session ends');
});

test('a second submit while the save is in flight does not post twice', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const calls = stub(c, () => json(groupDto(), 201));
  openCreateDraft(app);
  const first = app.saveRedundancyGroup();
  const second = app.saveRedundancyGroup();
  assert.equal(await second, false, 'the busy dialog ignores the repeated click');
  assert.equal(await first, true);
  assert.equal(groupCalls(calls, 'POST').length, 1);
});

// ------------------------------------------------------- mounted components

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

// A real browser routes `input`/`change` to the handler the template declared;
// the test renderer keeps template events as props and v-model directives as
// native listeners, so both are accepted and driven with the native event shape.
function nativeHandler(node, type) {
  const handler = (node.listeners || {})[type] || (node.props || {})['on' + type[0].toUpperCase() + type.slice(1)];
  assert.equal(typeof handler, 'function', 'the control declares its ' + type + ' handler');
  return handler;
}

function typeInto(node, value) {
  assert.ok(node, 'the input is rendered');
  const handler = nativeHandler(node, 'input');
  node.value = value;
  handler({ target: node });
}

function changeTo(node, value) {
  assert.ok(node, 'the control is rendered');
  const handler = nativeHandler(node, 'change');
  node.value = value;
  handler({ target: node });
}

function pick(node, value) {
  assert.ok(node, 'the select is rendered');
  const handler = nativeHandler(node, 'change');
  node.value = value;
  handler({ target: node });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function mountComponent(session, name, props) {
  const mounted = session.mount(name, props);
  await session.c.Vue.nextTick();
  await settle();
  return mounted;
}

function relationsFixture(permissions) {
  const session = serverApp(permissions);
  const { app, c } = session;
  // Default read: the panel's own bounded group page. Tests that need
  // different traffic install their own stub afterwards.
  stub(c, (call) => {
    if (call.url.indexOf('/api/v1/redundancy-groups') === 0) return json({ total: 0, limit: 200, offset: 0, items: [] });
    return json({});
  });
  app.organization.types.items = [];
  app.organization.types.loaded = true;
  app.organization.relations.assetId = ASSET_A;
  app.organization.relations.loaded = true;
  app.organization.relations.items = [];
  app.organization.assetSearch.items = [assetDto({ id: ASSET_B, name: 'Réplica B' }), assetDto({ id: ASSET_C, name: 'Réplica C' })];
  app.organization.assetSearch.loaded = true;
  return session;
}

test('the asset sheet lists the loaded groups with role, traffic share, host and the examined page size', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app } = session;
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  // The panel's own read settles first; the seeded page then stands for the
  // bounded response the operator would actually see.
  seedAssetGroups(app, { items: [groupDto(), passiveGroupDto()], total: 5, examined: 2 });
  await session.c.Vue.nextTick();
  const text = textOf(mounted.root);

  assert.match(text, /Redundancia/);
  assert.match(text, /Portal web/);
  assert.match(text, /Activo\/activo/);
  assert.match(text, /Reparto de carga/);
  assert.match(text, /40\s?%/);
  assert.match(text, /60\s?%/);
  assert.match(text, /Host Norte/);
  assert.match(text, /Principal/);
  assert.match(text, /Respaldo/);
  assert.match(text, /2 de 5 grupos/, 'the truncated page is disclosed, never presented as complete');
  assert.match(text, /no reparte tráfico/i, 'the descriptive boundary is stated in the interface');
  assert.deepEqual(session.errors, []);
  mounted.unmount();
});

test('the rendered redundancy form creates the 40:60 group from its own controls', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/assets/search') === 0) {
      return json({ total: 2, limit: 50, offset: 0, items: [assetDto({ id: ASSET_B, name: 'Réplica B' }), assetDto({ id: ASSET_C, name: 'Réplica C' })] });
    }
    if (call.url.indexOf('/api/v1/redundancy-groups') === 0 && call.init.method === 'POST') return json(groupDto(), 201);
    if (call.url.indexOf('/api/v1/redundancy-groups') === 0) return json({ total: 1, limit: 200, offset: 0, items: [groupDto()] });
    return json({});
  });
  seedAssetGroups(app, {});
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });

  buttonsWithText(mounted.root, 'Nuevo grupo')[0].props.onClick();
  await c.Vue.nextTick();
  await settle();
  typeInto(nodeByProp(mounted.root, 'id', 'redundancy-name'), 'Portal web');
  typeInto(nodeByProp(mounted.root, 'id', 'redundancy-description'), 'Reparto 40/60');
  // El alta siembra el activo de la ficha; este caso quiere exactamente dos
  // réplicas del servidor, así que se retira la sembrada desde el propio control.
  nodeByProp(mounted.root, 'data-redundancy-remove', ASSET_A).props.onClick();
  await c.Vue.nextTick();

  const addA = nodeByProp(mounted.root, 'data-redundancy-add', ASSET_B);
  const addB = nodeByProp(mounted.root, 'data-redundancy-add', ASSET_C);
  assert.ok(addA && addB, 'the bounded server page offers both replicas');
  addA.props.onClick();
  addB.props.onClick();
  await c.Vue.nextTick();

  typeInto(nodeByProp(mounted.root, 'data-redundancy-share', ASSET_B), '40');
  typeInto(nodeByProp(mounted.root, 'data-redundancy-share', ASSET_C), '60');
  await c.Vue.nextTick();
  buttonsWithText(mounted.root, 'Guardar grupo')[0].props.onClick();
  await settle();

  const write = calls.find((call) => call.url === '/api/v1/redundancy-groups' && call.init.method === 'POST');
  assert.ok(write, 'the visible form posts the group');
  assert.equal(write.body.name, 'Portal web');
  assert.equal(write.body.description, 'Reparto 40/60');
  assert.deepEqual(write.body.members, [{ assetId: ASSET_B, share: '40' }, { assetId: ASSET_C, share: '60' }]);
  assert.equal(app.redundancy.dialog.open, false);
  assert.deepEqual(session.errors, []);
  mounted.unmount();
});

test('a refused save keeps the rendered form and the canonical membership on screen', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/api/v1/redundancy-groups') === 0 && call.init.method === 'POST') return failure('conflict', 409);
    return json({ total: 1, limit: 200, offset: 0, items: [groupDto()] });
  });
  seedAssetGroups(app, { items: [groupDto()], total: 1, examined: 1 });
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  const before = JSON.stringify(app.redundancy.assetGroups.items);

  buttonsWithText(mounted.root, 'Nuevo grupo')[0].props.onClick();
  await c.Vue.nextTick();
  typeInto(nodeByProp(mounted.root, 'id', 'redundancy-name'), 'Portal web');
  app.removeRedundancyMember(ASSET_A);
  app.addRedundancyMember({ id: ASSET_B, name: 'Réplica B' });
  app.addRedundancyMember({ id: ASSET_C, name: 'Réplica C' });
  await c.Vue.nextTick();
  typeInto(nodeByProp(mounted.root, 'data-redundancy-share', ASSET_B), '40');
  typeInto(nodeByProp(mounted.root, 'data-redundancy-share', ASSET_C), '60');
  await c.Vue.nextTick();
  buttonsWithText(mounted.root, 'Guardar grupo')[0].props.onClick();
  await settle();

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 1);
  assert.equal(app.redundancy.dialog.open, true, 'a refusal keeps the dialog open');
  assert.match(textOf(mounted.root), /La operación no se puede completar con el estado actual\./);
  assert.equal(JSON.stringify(app.redundancy.assetGroups.items), before, 'the loaded groups are not rewritten by a refusal');
  assert.equal(nodeByProp(mounted.root, 'id', 'redundancy-name').props.value, 'Portal web', 'the typed draft survives');
  mounted.unmount();
});

test('a read-only asset sheet shows no redundancy write controls', async () => {
  const session = relationsFixture(['assets.view']);
  const { app } = session;
  seedAssetGroups(app, { items: [groupDto()], total: 1, examined: 1 });
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [groupDto()], total: 1, examined: 1 });
  await session.c.Vue.nextTick();

  assert.equal(buttonsWithText(mounted.root, 'Nuevo grupo').length, 0);
  assert.equal(buttonsWithText(mounted.root, 'Desactivar').length, 0);
  assert.match(textOf(mounted.root), /Solo lectura/);
  assert.match(textOf(mounted.root), /Portal web/, 'the group stays readable');
  mounted.unmount();
});

function graphFixture(permissions) {
  const session = relationsFixture(permissions);
  const { app } = session;
  app.route = { name: 'graph', assetId: '', personId: '', section: '', focusId: '' };
  app.organization.graph.nodes = [
    { id: ASSET_A, name: 'Réplica A', quickCode: 'RD-A', status: 'in_use', category: 'Servidores', siteId: '' },
    { id: ASSET_B, name: 'Réplica B', quickCode: 'RD-B', status: 'in_use', category: 'Servidores', siteId: '' },
    { id: HOST_1, name: 'Host Norte', quickCode: 'HN-1', status: 'in_use', category: 'Servidores', siteId: '' }
  ];
  app.organization.graph.edges = [
    { id: 'edge-1', sourceId: ASSET_A, targetId: HOST_1, typeKey: 'hosted_in' },
    { id: 'edge-2', sourceId: ASSET_B, targetId: HOST_1, typeKey: 'hosted_in' }
  ];
  app.organization.types.items = [
    { id: 'hosted_in', key: 'hosted_in', label: 'Alojado en', inverse: 'Aloja', directed: true, containment: true, active: true, icon: 'server', tone: 'physical', serverRecord: true }
  ];
  app.organization.types.loaded = true;
  app.organization.graph.loaded = true;
  app.redundancy.groups.items = [groupDto(), passiveGroupDto()];
  app.redundancy.groups.total = 3;
  app.redundancy.groups.loaded = true;
  return session;
}

test('the graph shows which nodes belong to a redundancy group without inventing edges', async () => {
  const session = graphFixture(['assets.view']);
  const { app } = session;
  const mounted = await mountComponent(session, 'GraphExplorer', { app, focusId: '' });
  const text = textOf(mounted.root);

  assert.match(text, /Redundancia/);
  assert.match(text, /Portal web/);
  assert.match(text, /Activo\/activo/);
  assert.match(text, /Reparto de carga 40 · 60|Reparto de carga/);
  assert.match(text, /Host Norte/);
  assert.match(text, /2 de 3 grupos/, 'the graph states which part of the group page it loaded');

  const badges = nodesWhere(mounted.root, (node) => node.props && node.props.class === 'gnode__redundancy');
  assert.equal(badges.length, 2, 'both member nodes carry a redundancy marker');
  const edges = nodesWhere(mounted.root, (node) => node.tag === 'line'
    && String((node.props && node.props.class) || '').indexOf('gedge--') !== -1);
  assert.equal(edges.length, 2, 'redundancy does not replace or duplicate the directed hosting edges');
  assert.ok(edges.every((edge) => String(edge.props['marker-end'] || '').indexOf('url(#garrow-') === 0),
    'the hosting edges remain directed, unlike the descriptive group');
  assert.deepEqual(session.errors, []);
  mounted.unmount();
});

test('the graph inspector names the member role and the separate hosting context', async () => {
  const session = graphFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const mounted = await mountComponent(session, 'GraphExplorer', { app, focusId: ASSET_A });
  app.selectedId = ASSET_A;
  await c.Vue.nextTick();
  const text = textOf(mounted.root);

  assert.match(text, /Principal|Respaldo/);
  assert.match(text, /Reparto de carga/);
  assert.match(text, /Host Norte/);
  assert.match(text, /Alojamiento|hosted_in|Alojado/i, 'hosting stays a directed relation, not a redundancy fact');
  mounted.unmount();
});

test('opening the create form from an asset sheet seeds that asset in the draft', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  stub(c, () => json({ total: 0, limit: 50, offset: 0, items: [] }));
  seedAssetGroups(app, {});
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });

  buttonsWithText(mounted.root, 'Nuevo grupo')[0].props.onClick();
  await c.Vue.nextTick();

  const draft = app.redundancy.dialog.members;
  assert.equal(JSON.stringify(draft.map((member) => member.assetId)), JSON.stringify([ASSET_A]),
    'the asset whose sheet opened the form is the first replica');
  assert.equal(draft[0].role, '', 'an active/active draft carries no role');
  assert.equal(draft[0].share, '', 'the share starts empty instead of inventing a percentage');
  assert.equal(app.redundancy.assetGroups.items.length, 0, 'the draft writes nothing by itself');
  mounted.unmount();
});

// ------------------------------------------------------------ correcciones

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise: promise, resolve: resolve };
}

// Doble de `fetch` cuyas respuestas elegidas quedan pendientes: permite observar
// lo que hace el cliente después de un cambio real de sesión, ruta o diálogo en
// lugar de filtrarlo con un hook de ciclo de vida inventado para el test.
function pendingFetch(c, pendingFor, fallback) {
  const calls = [];
  c.fetch = async (url, init) => {
    const call = { url: url, init: init || {}, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const pending = pendingFor(call);
    if (pending) return pending;
    return fallback ? fallback(call) : json({});
  };
  return calls;
}

function collectToasts(app) {
  const list = [];
  app.showToast = (message, tone) => list.push({ message: message, tone: tone || '' });
  return list;
}

// El reemplazo de sesión real (`applySession` tras `/auth/me`) cambia identidad,
// permisos y CSRF dejando `authenticated` en true. Se reproduce ese estado exacto.
function replaceSession(app, userId, permissions) {
  app.activeUserId = userId;
  app.serverPermissions = permissions.slice();
  app.csrfToken = 'csrf-of-the-replacement';
}

function groupReads(calls) {
  return calls.filter((call) => call.url.indexOf('/api/v1/redundancy-groups') === 0
    && (!call.init.method || call.init.method === 'GET'));
}

test('B1: a replaced view-only session cannot complete the dialog save or claim it', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const list = collectToasts(app);
  app.redundancy.groups.loaded = true;
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.init.method === 'PATCH' ? pending.promise : null), (call) => (
    call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 0, limit: 200, offset: 0, items: [] })
      : json({})
  ));
  app.openRedundancyEdit(groupDto());
  const saving = app.saveRedundancyGroup();

  replaceSession(app, 'replacement-viewer', ['assets.view']);
  pending.resolve(json(groupDto()));

  assert.equal(await saving, false, 'the old authorized write cannot report success in the replacement session');
  assert.deepEqual(list, [], 'neither success nor failure is announced for a replaced session');
  assert.equal(groupCalls(calls, 'GET').length, 0, 'no follow-up read is issued after the replacement');
  assert.equal(app.redundancy.dialog.busy, false, 'the draft does not stay blocked');
  assert.equal(app.redundancy.dialog.mode, 'edit', 'the draft is not silently rewritten as saved');
});

test('B1: an unchanged session survives a benign same-user authorization check', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const list = collectToasts(app);
  app.redundancy.groups.loaded = true;
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.init.method === 'PATCH' ? pending.promise : null), (call) => (
    call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 0, limit: 200, offset: 0, items: [] })
      : json({})
  ));
  app.openRedundancyEdit(groupDto());
  const saving = app.saveRedundancyGroup();

  // A periodic `/auth/me` refreshes the same user with the same grants: identity
  // and permissions are equal even though the arrays and CSRF string are new.
  app.serverPermissions = ['assets.edit', 'assets.view'];
  app.csrfToken = 'rotated-csrf';
  pending.resolve(json(groupDto()));

  assert.equal(await saving, true, 'a benign check must not cancel an authorized write');
  assert.equal(list.length, 1);
  assert.equal(list[0].message, 'Grupo de redundancia actualizado.');
  assert.equal(groupCalls(calls, 'GET').length, 1, 'the group page is refreshed for the live session');
});

test('B1: deactivate and reactivate share the session identity guard', async () => {
  const { c, app } = serverApp(['assets.view', 'assets.edit']);
  const list = collectToasts(app);
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.init.method === 'POST' || call.init.method === 'PATCH' ? pending.promise : null), (call) => (
    call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 0, limit: 200, offset: 0, items: [] })
      : json({})
  ));
  app.redundancy.busyId = '';
  const off = app.deactivateRedundancyGroup(groupDto());
  replaceSession(app, 'replacement-viewer', ['assets.view']);
  pending.resolve(json(groupDto({ active: false })));
  assert.equal(await off, false, 'the panel operation cannot finish in another session');
  assert.deepEqual(list, []);
  assert.equal(app.redundancy.busyId, '', 'the panel operation releases its busy marker');

  const again = deferred();
  calls.length = 0;
  const current = app.redundancy.groups;
  void current;
  app.redundancy.busyId = '';
  app.activeUserId = 'domain-fixture';
  app.serverPermissions = ['assets.view', 'assets.edit'];
  c.fetch = async (url, init) => {
    const call = { url: url, init: init || {}, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return again.promise;
  };
  const on = app.reactivateRedundancyGroup(groupDto({ active: false }));
  replaceSession(app, 'replacement-viewer', ['assets.view']);
  again.resolve(json(groupDto()));
  assert.equal(await on, false, 'reactivation is guarded the same way');
  assert.deepEqual(list, []);
});

test('B2: unmounting the sheet closes its dialog and cancels the queued search', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const calls = stub(c, () => json({ total: 0, limit: 50, offset: 0, items: [] }));
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });

  buttonsWithText(mounted.root, 'Nuevo grupo')[0].props.onClick();
  await c.Vue.nextTick();
  await settle();
  const before = calls.length;
  typeInto(nodeByProp(mounted.root, 'id', 'redundancy-search'), 'VM');
  mounted.unmount();

  assert.equal(app.redundancy.dialog.open, false, 'the unmounted sheet does not leave a dialog open');
  await new Promise((resolve) => setTimeout(resolve, 340));
  assert.equal(calls.length, before, 'the debounced search does not leave the unmounted sheet');
});

test('B2: leaving the route closes the dialog and drops the in-flight save', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.init.method === 'PATCH' ? pending.promise : null), (call) => (
    call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 0, limit: 200, offset: 0, items: [] })
      : json({})
  ));
  app.redundancy.groups.loaded = true;
  app.openRedundancyEdit(groupDto());
  const saving = app.saveRedundancyGroup();

  await app.handleRedundancyRoute({ name: 'graph' });
  assert.equal(app.redundancy.dialog.open, false, 'departure closes the sheet dialog');
  const reads = groupReads(calls).length;
  pending.resolve(json(groupDto()));

  assert.equal(await saving, false, 'the abandoned write is not reported as saved');
  assert.deepEqual(list, [], 'no success toast follows a departure');
  assert.equal(groupReads(calls).length, reads, 'the abandoned write triggers no follow-up read');
});

test('B2: closing the dialog during a save keeps the client silent and leaves a new draft untouched', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.init.method === 'PATCH' ? pending.promise : null), (call) => (
    call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 0, limit: 200, offset: 0, items: [] })
      : json({})
  ));
  app.redundancy.groups.loaded = true;
  app.openRedundancyEdit(groupDto());
  const saving = app.saveRedundancyGroup();

  app.closeRedundancyDialog();
  app.openRedundancyCreate({ id: ASSET_C, name: 'Réplica C' });
  const replacement = app.redundancy.dialog;
  const reads = groupReads(calls).length;
  pending.resolve(json(groupDto()));

  assert.equal(await saving, false, 'the closed interaction cannot finish');
  assert.deepEqual(list, [], 'no toast is raised for the closed interaction');
  assert.equal(groupReads(calls).length, reads, 'no follow-up read is issued for the closed interaction');
  assert.equal(app.redundancy.dialog, replacement, 'the replacement draft stays the current dialog');
  assert.equal(replacement.error, '', 'the old completion does not write into the new draft');
  assert.equal(replacement.busy, false, 'the old completion does not block the new draft');
});

test('B2: a panel deactivation abandoned by unmount reports nothing and reads nothing', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const group = groupDto();
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.url.indexOf('/deactivate') !== -1 ? pending.promise : null),
    (call) => (call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 1, limit: 200, offset: 0, items: [group] })
      : json({ total: 0, limit: 50, offset: 0, items: [] })));
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [group], total: 1, examined: 1 });
  await c.Vue.nextTick();

  const buttons = buttonsWithText(mounted.root, 'Desactivar');
  assert.equal(buttons.length, 1, 'the mounted panel exposes the panel operation');
  const before = calls.length;
  const running = buttons[0].props.onClick();
  assert.equal(typeof running.then, 'function', 'the click reports the pending operation');
  await c.Vue.nextTick();
  assert.equal(calls.length, before + 1, 'one click issues exactly one request');

  mounted.unmount();
  pending.resolve(json(groupDto({ active: false })));
  assert.equal(await running, false, 'the unmounted panel does not report a committed deactivation');
  assert.deepEqual(list, [], 'no toast follows a deactivation abandoned by unmount');
  assert.equal(calls.length, before + 1, 'the abandoned deactivation issues no follow-up membership read');
  assert.equal(app.redundancy.error, '', 'the unmounted panel does not revive an error');
  assert.equal(app.redundancy.busyId, '', 'the busy mark is released after unmount');
});

test('B2: a panel reactivation abandoned by unmount reports nothing and reads nothing', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const group = groupDto({ active: false });
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (
    call.init.method === 'PATCH' && call.url.indexOf('/redundancy-groups/') !== -1 ? pending.promise : null
  ), (call) => (call.url.indexOf('/api/v1/redundancy-groups') === 0
    ? json({ total: 1, limit: 200, offset: 0, items: [group] })
    : json({ total: 0, limit: 50, offset: 0, items: [] })));
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [group], total: 1, examined: 1 });
  await c.Vue.nextTick();

  const buttons = buttonsWithText(mounted.root, 'Reactivar');
  assert.equal(buttons.length, 1, 'the mounted panel exposes the panel operation');
  const before = calls.length;
  const running = buttons[0].props.onClick();
  await c.Vue.nextTick();
  assert.equal(calls.length, before + 1, 'one click issues exactly one request');

  mounted.unmount();
  pending.resolve(json(groupDto({ active: true })));
  assert.equal(await running, false, 'the unmounted panel does not report a committed reactivation');
  assert.deepEqual(list, [], 'no toast follows a reactivation abandoned by unmount');
  assert.equal(calls.length, before + 1, 'the abandoned reactivation issues no follow-up membership read');
  assert.equal(app.redundancy.error, '', 'the unmounted panel does not revive an error');
  assert.equal(app.redundancy.busyId, '', 'the busy mark is released after unmount');
});

test('B2: a mounted, still-open panel still completes deactivation, even across dialog use', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const group = groupDto();
  const calls = stub(c, (call) => {
    if (call.url.indexOf('/deactivate') !== -1) return json(groupDto({ active: false }));
    if (call.url.indexOf('/redundancy-groups') !== -1) return json({ total: 1, limit: 200, offset: 0, items: [group] });
    return json({ total: 0, limit: 50, offset: 0, items: [] });
  });
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [group], total: 1, examined: 1 });
  await c.Vue.nextTick();

  // El diálogo es otra interacción: abrirlo y cerrarlo no debe invalidar la
  // operación del panel que el operador dejó en marcha.
  app.openRedundancyCreate({ id: ASSET_C, name: 'Réplica C' });
  app.closeRedundancyDialog();

  const deactivated = await app.deactivateRedundancyGroup(group);
  assert.equal(deactivated, true, 'an open sheet still completes its panel operation');
  assert.deepEqual(list.map((item) => item.message), ['Grupo de redundancia desactivado.']);
  assert.ok(calls.filter((call) => call.init.method === 'POST').length === 1, 'one deactivation request');
  const reads = calls.filter((call) => call.init.method !== 'POST'
    && call.url.indexOf('/deactivate') === -1
    && call.url.indexOf('/redundancy-groups') !== -1).length;
  assert.ok(reads >= 2, 'the panel is refreshed after the real mutation, saw ' + reads);
  mounted.unmount();
});

test('B2: a rejected panel operation after unmount stays silent', async () => {
  const session = relationsFixture(['assets.view', 'assets.edit']);
  const { app, c } = session;
  const list = collectToasts(app);
  const group = groupDto();
  const pending = deferred();
  const calls = pendingFetch(c, (call) => (call.url.indexOf('/deactivate') !== -1 ? pending.promise : null),
    (call) => (call.url.indexOf('/api/v1/redundancy-groups') === 0
      ? json({ total: 1, limit: 200, offset: 0, items: [group] })
      : json({ total: 0, limit: 50, offset: 0, items: [] })));
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [group], total: 1, examined: 1 });
  await c.Vue.nextTick();

  const before = calls.length;
  const running = buttonsWithText(mounted.root, 'Desactivar')[0].props.onClick();
  await c.Vue.nextTick();
  mounted.unmount();
  pending.resolve(failure('conflict', 409));

  assert.equal(await running, false, 'the rejection is not reported as success');
  assert.deepEqual(list, [], 'the removed panel raises no toast for its rejection');
  assert.equal(calls.length, before + 1, 'the rejection triggers no follow-up read');
  assert.equal(app.redundancy.error, '', 'the removed panel does not write an error');
});

test('B3: an inactive group may be emptied or reduced to a single member', async () => {
  const empty = serverApp(['assets.view', 'assets.edit']);
  const emptyCalls = stub(empty.c, (call) => (call.init.method === 'PATCH'
    ? json(groupDto({ active: false, memberCount: 0, members: [] }))
    : json({ total: 0, limit: 200, offset: 0, items: [] })));
  empty.app.openRedundancyEdit(groupDto({ active: false }));
  empty.app.removeRedundancyMember(ASSET_A);
  empty.app.removeRedundancyMember(ASSET_B);
  assert.equal(empty.app.validateRedundancyDialog(), '', 'limpiar un grupo inactivo no tiene mínimo de miembros');
  assert.equal(await empty.app.saveRedundancyGroup(), true, 'the server accepts an empty inactive membership');
  const clean = emptyCalls.find((call) => call.init.method === 'PATCH');
  assert.deepEqual(clean.body.members, []);
  assert.equal(clean.body.active, false);
  assert.equal(clean.body.mode, 'active_active');

  const single = serverApp(['assets.view', 'assets.edit']);
  const singleCalls = stub(single.c, (call) => (call.init.method === 'PATCH'
    ? json(groupDto({ active: false, memberCount: 1, members: [memberDto({ share: '40' })] }))
    : json({ total: 0, limit: 200, offset: 0, items: [] })));
  single.app.openRedundancyEdit(groupDto({ active: false }));
  single.app.removeRedundancyMember(ASSET_B);
  assert.equal(single.app.validateRedundancyDialog(), '', 'un grupo inactivo con una réplica no exige suma de 100');
  assert.equal(await single.app.saveRedundancyGroup(), true);
  assert.deepEqual(singleCalls.find((call) => call.init.method === 'PATCH').body.members, [
    { assetId: ASSET_A, share: '40' }
  ]);

  const passive = serverApp(['assets.view', 'assets.edit']);
  const passiveCalls = stub(passive.c, (call) => (call.init.method === 'PATCH'
    ? json(passiveGroupDto({ active: false, memberCount: 1 }))
    : json({ total: 0, limit: 200, offset: 0, items: [] })));
  passive.app.openRedundancyEdit(passiveGroupDto({ active: false }));
  passive.app.removeRedundancyMember(ASSET_A);
  assert.equal(passive.app.validateRedundancyDialog(), '', 'el servidor permite un respaldo único inactivo');
  assert.equal(await passive.app.saveRedundancyGroup(), true);
  assert.deepEqual(passiveCalls.find((call) => call.init.method === 'PATCH').body.members, [
    { assetId: ASSET_B, role: 'backup' }
  ]);
});

test('B3: active groups and creation keep the two-member and complete-composition rules', async () => {
  const active = serverApp(['assets.view', 'assets.edit']);
  const activeCalls = stub(active.c, () => json(groupDto()));
  active.app.openRedundancyEdit(groupDto());
  active.app.removeRedundancyMember(ASSET_B);
  assert.match(active.app.validateRedundancyDialog(), /al menos 2/i);
  assert.equal(await active.app.saveRedundancyGroup(), false);
  assert.equal(activeCalls.filter((call) => call.init.method === 'PATCH').length, 0,
    'an active group with one member never reaches the server');

  const creation = serverApp(['assets.view', 'assets.edit']);
  const created = stub(creation.c, () => json(groupDto(), 201));
  creation.app.openRedundancyCreate({ id: ASSET_A, name: 'Réplica A' });
  creation.app.redundancy.dialog.name = 'Portal web';
  creation.app.setRedundancyShare(ASSET_A, '100');
  assert.match(creation.app.validateRedundancyDialog(), /al menos 2/i);
  assert.equal(await creation.app.saveRedundancyGroup(), false);
  assert.equal(created.filter((call) => call.init.method === 'POST').length, 0);

  const incomplete = serverApp(['assets.view', 'assets.edit']);
  const incompleteCalls = stub(incomplete.c, () => json(groupDto({ active: false })));
  incomplete.app.openRedundancyEdit(groupDto({ active: false }));
  incomplete.app.setRedundancyShare(ASSET_A, '40');
  incomplete.app.setRedundancyShare(ASSET_B, '50');
  assert.match(incomplete.app.validateRedundancyDialog(), /100/);
  assert.equal(await incomplete.app.saveRedundancyGroup(), false);
  assert.equal(incompleteCalls.filter((call) => call.init.method === 'PATCH').length, 0,
    'two members of an inactive active/active group still total exactly 100');

  const roles = serverApp(['assets.view', 'assets.edit']);
  const roleCalls = stub(roles.c, () => json(passiveGroupDto({ active: false })));
  roles.app.openRedundancyEdit(passiveGroupDto({ active: false }));
  roles.app.setRedundancyRole(ASSET_B, 'primary');
  assert.match(roles.app.validateRedundancyDialog(), /exactamente un Principal/i);
  assert.equal(await roles.app.saveRedundancyGroup(), false);
  assert.equal(roleCalls.filter((call) => call.init.method === 'PATCH').length, 0);
});

test('B4: a truncated page never claims that the asset belongs to no group', async () => {
  const session = relationsFixture(['assets.view']);
  const { app } = session;
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [], total: 201, examined: 1 });
  await session.c.Vue.nextTick();
  const text = textOf(mounted.root);

  assert.match(text, /Se examinaron 1 de 201 grupos del servidor/);
  assert.match(text, /ninguno incluye este activo/i);
  assert.match(text, /no se consultó en esta página/i);
  assert.doesNotMatch(text, /no pertenece a ningún grupo de redundancia/i,
    'absence is only definitive for a complete page');
  mounted.unmount();
});

test('B4: a complete page does state that the asset belongs to no group', async () => {
  const session = relationsFixture(['assets.view']);
  const { app } = session;
  const mounted = await mountComponent(session, 'OrganizationRelations', { asset: assetDto(), app });
  seedAssetGroups(app, { items: [], total: 1, examined: 1 });
  await session.c.Vue.nextTick();
  const text = textOf(mounted.root);

  assert.match(text, /no pertenece a ningún grupo de redundancia/i);
  assert.doesNotMatch(text, /ninguno incluye este activo/i);
  mounted.unmount();
});
