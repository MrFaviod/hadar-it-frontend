'use strict';
// Phase 4 configuration contract: the panels render the server catalog and they
// evolve it without destructive deletes, while the environment stays server-owned.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, json, stubFetch, dto, catalog } = require('./inventory-harness.cjs');

function configAware(handler) {
  return (call) => (call.url === '/api/v1/inventory/config' ? json(catalog()) : handler(call));
}

async function ready(app) {
  assert.equal(await app.loadInventoryCatalog(), true);
}

test('the fields panel lists the server library and deactivates instead of deleting', async () => {
  const { c, app, mount } = setup();
  const calls = stubFetch(c, configAware(() => json({})));
  await ready(app);
  const localFields = app.assetAdmin.fields.length;
  const view = mount('AssetFieldsPanel', { app }).instance;

  assert.equal(view.real, true);
  assert.deepEqual(view.fields.map((field) => field.key), ['cpu', 'ram', 'poe', 'os', 'installedAt', 'retiredField']);
  assert.equal(view.fields[5].active, false);

  assert.equal(await app.setAssetFieldActive(view.fields[1], false), true);
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/inventory/config/fields/ram');
  assert.equal(put.body.active, false, 'the field is deactivated, not deleted');
  assert.equal(put.body.label, 'Memoria RAM');
  assert.equal(put.body.type, 'number');
  assert.equal(app.assetAdmin.fields.length, localFields, 'local demo fields are untouched');
  assert.match(app.lastToast, /desactivado/i);
});

test('the statuses panel reads and deactivates the server statuses', async () => {
  const { c, app, mount } = setup();
  const calls = stubFetch(c, configAware(() => json({})));
  await ready(app);
  const view = mount('AssetStatusesPanel', { app }).instance;

  assert.deepEqual(view.statuses.map((status) => status.id), ['in_use', 'maintenance', 'storage', 'retired', 'obsolete']);
  assert.equal(view.statuses[4].active, false);

  assert.equal(await app.setAssetStatusActive(view.statuses[0], false), true);
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/inventory/config/statuses/in_use');
  assert.equal(put.body.active, false);
  assert.equal(put.body.label, 'Asignado');
});

test('the forms panel opens a server category and saves its bucket layout', async () => {
  const { c, app, mount } = setup();
  const calls = stubFetch(c, configAware(() => json({})));
  await ready(app);
  const view = mount('AssetFormsPanel', { app }).instance;

  assert.deepEqual(view.categories.map((category) => category.id), ['notebooks', 'camaras', 'ups']);
  assert.equal(await app.openFormDraft('notebooks'), true);
  assert.equal(view.draft.form.prefix, 'NB');
  assert.deepEqual(view.techFields.map((field) => field.key), ['cpu', 'ram', 'poe', 'os', 'installedAt']);

  app.setFormFieldBucket('cost', 'quick');
  app.toggleFormTech('cpu');
  assert.equal(await app.saveFormDraft(), true);
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/inventory/config/categories/notebooks');
  assert.equal(put.body.prefix, 'NB');
  assert.equal(put.body.quick.indexOf('cost') !== -1, true);
  assert.equal(put.body.tech.indexOf('cpu') === -1, true);
  assert.equal(app.formDraft, null, 'the draft closes after a saved form');
});

test('the identity panel shows server rules and never exposes the environment switch', async () => {
  const { c, app, mount } = setup();
  stubFetch(c, configAware(() => json({})));
  await ready(app);
  const view = mount('AssetIdentityPanel', { app }).instance;

  assert.equal(view.real, true);
  assert.equal(view.rules.quickPad, 3);
  assert.equal(view.rules.separator, '-');
  assert.equal(view.purge.environment, 'production');
  assert.equal(view.purge.permission, 'assets.purge');
  assert.equal(view.purge.archivedRequired, true);
  assert.equal(view.mode, '', 'there is no browser-side mode to toggle');

  const before = app.assetAdmin.operations.mode;
  assert.equal(app.setOperationsMode(before === 'production' ? 'development' : 'production'), false);
  assert.match(app.lastToast, /servidor/i);
  assert.equal(app.assetAdmin.operations.mode, before, 'the local demo mode is not rewritten');
});

test('saving the identification rules sends only server rule keys', async () => {
  const { c, app } = setup();
  const calls = stubFetch(c, configAware(() => json({})));
  await ready(app);
  app.resetAssetIdRules();
  const draft = app.inventoryRulesDraft();
  draft.quickPad = 4;
  draft.includeSite = false;

  assert.equal(await app.saveAssetIdRules(), true);
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/inventory/config/rules/identification');
  assert.equal(put.body.quickPad, 4);
  assert.equal(put.body.includeSite, false);
  assert.equal(put.body.separator, '-');
  assert.deepEqual(put.body.siteCodes, { Central: 'CEN' });
  assert.equal('permanentPrefix' in put.body, false);
});

test('the identity panel edits the global status transitions on the server', async () => {
  const { c, app, mount } = setup();
  const calls = stubFetch(c, configAware(() => json({})));
  await ready(app);
  const view = mount('AssetIdentityPanel', { app }).instance;

  assert.equal(JSON.stringify(app.inventoryTransitionRows()), JSON.stringify([
    { from: 'in_use', to: 'maintenance' },
    { from: 'in_use', to: 'storage' },
    { from: 'maintenance', to: 'in_use' }
  ]));
  assert.deepEqual(view.statuses.map((status) => status.id), ['in_use', 'maintenance', 'storage', 'retired', 'obsolete']);

  app.addInventoryTransition();
  const rows = app.inventoryTransitionRows();
  rows[rows.length - 1].from = 'maintenance';
  rows[rows.length - 1].to = 'retired';
  assert.equal(await app.saveInventoryTransitionsDraft(), true);

  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(put.url, '/api/v1/inventory/config/rules/transitions');
  assert.deepEqual(put.body.transitions, {
    in_use: ['maintenance', 'storage'],
    maintenance: ['in_use', 'retired']
  });
  assert.equal(app.inventoryTransitionsDraft, null, 'the draft resets after a saved table');
});

// ---------------------------------------------------------------------------
// Server-authority regressions: real permissions, no prototype fallback.
// ---------------------------------------------------------------------------

function sessionHandler(permissions, configPayload, configStatus) {
  return (call) => {
    if (call.url === '/api/v1/auth/me') {
      return json({
        user: { id: 'u1', name: 'Operador', roleId: 'r1', active: true },
        csrfToken: 'tok-1',
        permissions: permissions,
        sessionMinutes: 30
      });
    }
    if (call.url === '/api/v1/identity/state') {
      return json({ users: [{ id: 'u1', name: 'Operador', roleId: 'r1', active: true }], roles: [] });
    }
    if (call.url.indexOf('/api/v1/inventory/config') === 0) {
      if ((call.init.method || 'GET') === 'GET') {
        return configPayload === undefined ? json(catalog()) : json(configPayload, configStatus);
      }
      return json({ saved: true });
    }
    if (call.url.indexOf('/api/v1/assets/search') === 0 || call.url === '/api/v1/assets/search') {
      return json({ items: [dto()], total: 1, limit: 25, offset: 0 });
    }
    return json({});
  };
}

function serverBoot(permissions, configPayload, configStatus) {
  const { c, app, mount } = setup();
  const calls = stubFetch(c, sessionHandler(permissions, configPayload, configStatus));
  app.can = c.AssetAccess.methods.can.bind(app);
  app.requirePermission = c.AssetAccess.methods.requirePermission.bind(app);
  app.canConfig = c.AssetAccess.methods.canConfig.bind(app);
  app.accessRoute = c.AssetAccess.methods.accessRoute.bind(app);
  return { c, app, calls, mount };
}

function puts(calls) {
  return calls.filter((call) => call.init.method === 'PUT');
}

test('a server-granted assets.purge survives the permission catalog', async () => {
  const { c, app } = serverBoot(['assets.view', 'assets.edit', 'assets.purge']);
  await app.checkAccessSession();
  assert.equal(app.can('assets.purge'), true, 'the server grant is usable');
  assert.equal(app.effectivePermissions.includes('assets.purge'), true);
  assert.equal(app.permissionGroups().some((group) => group.permissions.some((item) => item.id === 'assets.purge')), true);
  app.security.roles = [{ id: 'r1', name: 'Operador', permissions: ['assets.view', 'assets.edit', 'assets.purge'] }];
  assert.equal(app.userPermissions(app.currentUser).includes('assets.purge'), true, 'role editing keeps the grant');

  await app.loadInventoryCatalog();
  const archived = app.inventoryMapAsset(dto({ archived: true, archivedAt: '2026-02-01T10:00:00Z' }));
  assert.equal(app.openInventoryLifecycle(archived, 'purge'), true);
  assert.equal(app.inventoryLifecycle.error, '');
  assert.equal(c.AssetAccess.methods.can.call(app, 'assets.purge'), true);
});

test('a caller without the purge grant cannot open the protected purge dialog', async () => {
  const { c, app } = serverBoot(['assets.view', 'assets.edit']);
  await app.checkAccessSession();
  assert.equal(app.can('assets.purge'), false);
  await app.loadInventoryCatalog();
  const archived = app.inventoryMapAsset(dto({ archived: true, archivedAt: '2026-02-01T10:00:00Z' }));
  assert.equal(app.openInventoryLifecycle(archived, 'purge'), false);
  assert.match(app.inventoryLifecycle.error, /rol|permiso/i);
  assert.equal(c.AssetAccess.methods.can.call(app, 'assets.purge'), false);
});

test('catalog configuration follows the backend config permissions, not assets.edit', async () => {
  const { app, calls } = serverBoot(['assets.view', 'config.categories', 'config.general']);
  await app.checkAccessSession();
  assert.equal(app.can('assets.edit'), false, 'the caller cannot edit assets');
  assert.equal(app.canConfig('activos'), true, 'the activos tab is reachable through catalog permissions');
  assert.equal(app.accessRoute({ name: 'config', section: 'activos' }).name, 'config');
  assert.equal(app.accessRoute({ name: 'config', section: 'categorias' }).name, 'config');
  await app.loadInventoryCatalog();

  assert.equal(app.openAssetField(), true);
  Object.assign(app.fieldDialog, { label: 'GPU', type: 'text' });
  assert.equal(await app.saveAssetField(), true);
  assert.equal(puts(calls)[0].url, '/api/v1/inventory/config/fields/gpu');
  assert.equal(puts(calls)[0].body.label, 'GPU');

  assert.equal(app.openAssetStatusDialog(), true);
  Object.assign(app.assetStatusDialog, { label: 'En revisión', tone: 'hold' });
  assert.equal(await app.saveAssetStatus(), true);
  assert.equal(puts(calls)[1].url, '/api/v1/inventory/config/statuses/en-revision');

  assert.equal(app.openFormDraft('notebooks'), true);
  assert.equal(await app.saveFormDraft(), true);
  assert.equal(puts(calls)[2].url, '/api/v1/inventory/config/categories/notebooks');

  assert.equal(await app.saveAssetIdRules(), true);
  assert.equal(puts(calls)[3].url, '/api/v1/inventory/config/rules/identification');
  assert.equal(puts(calls).length, 4);

  assert.equal(app.openAssetCreate(), false, 'catalog permissions do not grant asset editing');
  assert.equal(app.assetEditor.open, false);
});

test('a category-only editor cannot write statuses or identification rules', async () => {
  const { app, calls } = serverBoot(['assets.view', 'config.categories']);
  await app.checkAccessSession();
  await app.loadInventoryCatalog();
  assert.equal(app.openAssetField(), true);
  assert.equal(app.openAssetStatusDialog(), false);
  assert.equal(await app.saveAssetStatus(), false);
  app.assetStatusDialog = { open: true, mode: 'create', label: 'Intruso', tone: 'hold', final: false, active: true };
  assert.equal(await app.saveAssetStatus(), false);
  assert.equal(await app.saveAssetIdRules(), false);
  assert.equal(app.openFormDraft('notebooks'), true);
  assert.equal(await app.saveFormDraft(), true);
  assert.deepEqual(puts(calls).map((call) => call.url), ['/api/v1/inventory/config/categories/notebooks']);
});

test('a general-only editor cannot write the catalog fields', async () => {
  const { app, calls } = serverBoot(['assets.view', 'config.general']);
  await app.checkAccessSession();
  await app.loadInventoryCatalog();
  assert.equal(app.openAssetField(), false);
  assert.equal(await app.saveAssetField(), false);
  assert.equal(app.openFormDraft('notebooks'), false);
  assert.equal(app.openAssetStatusDialog(), true);
  Object.assign(app.assetStatusDialog, { label: 'Obsoleto', tone: 'hold' });
  assert.equal(await app.saveAssetStatus(), true);
  assert.deepEqual(puts(calls).map((call) => call.url), ['/api/v1/inventory/config/statuses/obsoleto']);
});

test('a failing catalog never falls back to prototype configuration', async () => {
  const { c, app, calls } = serverBoot(['assets.view', 'assets.edit', 'config.categories', 'config.general'], { error: { code: 'internal', message: 'boom' } }, 500);
  await app.checkAccessSession();
  assert.equal(await app.loadInventoryCatalog(), false);
  assert.equal(app.inventoryCatalogReady, false);
  assert.match(app.inventoryCatalog.error, /configuración/i);

  assert.equal(JSON.stringify(app.inventoryConfigFields()), '[]');
  assert.equal(JSON.stringify(app.inventoryConfigStatuses()), '[]');
  assert.equal(JSON.stringify(app.inventoryConfigCategories()), '[]');

  const adminBefore = JSON.stringify(app.assetAdmin);
  const writes = [];
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return original(key, value); };

  assert.equal(app.openAssetField(), false);
  assert.equal(app.fieldDialog.open, false);
  app.fieldDialog = { open: true, mode: 'create', key: '', label: 'Probe', type: 'text', options: '' };
  assert.equal(await app.saveAssetField(), false);
  assert.equal(await app.setAssetFieldActive({ key: 'cpu', label: 'Procesador', type: 'text' }, false), false);
  assert.equal(app.openAssetStatusDialog(), false);
  app.assetStatusDialog = { open: true, mode: 'create', label: 'Probe estado', tone: 'hold', final: false, active: true };
  assert.equal(await app.saveAssetStatus(), false);
  assert.equal(app.openFormDraft('notebooks'), false);
  assert.equal(await app.saveFormDraft(), false);
  assert.equal(await app.saveAssetIdRules(), false);
  assert.equal(app.resetAssetIdRules(), false);
  assert.equal(app.setOperationsMode('production'), false);
  assert.equal(app.openCategoryDialog(), false);
  app.categoryDialog = { open: true, mode: 'create', id: '', label: 'Probe categoria', prefix: 'PRB', type: 'Equipo', icon: 'box', active: true };
  assert.equal(await app.saveCategory(), false);

  assert.equal(JSON.stringify(app.assetAdmin), adminBefore, 'prototype configuration is untouched');
  assert.deepEqual(writes, [], 'nothing is persisted in localStorage');
  assert.equal(puts(calls).length, 0, 'no catalog write is attempted');

  c.fetch = async (url, init) => {
    if (String(url).indexOf('/api/v1/inventory/config') === 0) return json(catalog());
    return json({});
  };
  assert.equal(await app.loadInventoryCatalog(), true, 'retry recovers the real catalog');
  assert.equal(app.inventoryConfigFields().length, 6);
});

test('the categories route loads the server catalog and saves category metadata there', async () => {
  const { c, app, calls } = serverBoot(['assets.view', 'config.categories']);
  await app.checkAccessSession();
  await app.handleInventoryRoute({ name: 'config', section: 'categorias' });
  assert.equal(app.inventoryCatalogReady, true, 'the route loads the server catalog');
  assert.equal(calls.filter((call) => call.url === '/api/v1/inventory/config').length, 1);

  const prototypeBefore = app.config.categories.length;
  const writes = [];
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return original(key, value); };

  assert.equal(app.openCategoryDialog(), true);
  Object.assign(app.categoryDialog, { label: 'Kioscos', prefix: 'kio', type: 'Kiosco', icon: 'box' });
  assert.equal(await app.saveCategory(), true);
  const put = puts(calls)[0];
  assert.equal(put.url, '/api/v1/inventory/config/categories/kioscos');
  assert.deepEqual(Object.keys(put.body).sort(), ['active', 'advanced', 'fov', 'icon', 'id', 'label', 'prefix', 'quick', 'tech', 'transitions', 'type']);
  assert.equal(put.body.prefix, 'KIO');
  assert.equal(put.body.label, 'Kioscos');
  assert.equal(put.body.active, true, 'new categories start active');

  assert.equal(app.config.categories.length, prototypeBefore, 'prototype categories are not mutated');
  assert.deepEqual(writes, []);

  assert.equal(app.openCategoryDialog(app.inventoryConfigCategories()[0]), true);
  assert.equal(app.categoryDialog.mode, 'edit');
  assert.equal(app.categoryDialog.prefix, 'NB');
  Object.assign(app.categoryDialog, { active: false });
  assert.equal(await app.saveCategory(), true);
  const edit = puts(calls)[1];
  assert.equal(edit.url, '/api/v1/inventory/config/categories/notebooks');
  assert.equal(edit.body.active, false, 'deactivation is the non-destructive path');
  assert.equal(edit.body.quick.indexOf('name') !== -1, true, 'the existing layout is preserved');
});
