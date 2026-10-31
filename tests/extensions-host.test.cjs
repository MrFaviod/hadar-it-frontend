'use strict';
// SDK v2 host contract: discovery never executes module code, declarative views
// are data, and the SDK only calls operations this extension declared.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, evaluate, digest, deferred } = require('./extensions-support.cjs');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

const READ = 'ext_demo.read';
const WRITE = 'ext_demo.write';

function manifest(overrides) {
  return Object.assign({
    id: 'demo',
    name: 'Demo',
    version: '2.0.0',
    sdkVersion: 2,
    schemaVersion: 1,
    runtime: 'declarative',
    capabilities: [],
    storage: { engine: 'sqlite' },
    permissions: [
      { code: READ, label: 'Leer demo', description: 'Consulta los registros de la demo.' },
      { code: WRITE, label: 'Escribir demo', description: 'Crea registros en la demo.' }
    ],
    operations: [
      { name: 'list_records', description: 'Lista', permission: READ, mutation: false, kind: 'list', collection: 'records' },
      { name: 'create_record', description: 'Crea', permission: WRITE, mutation: true, kind: 'put', collection: 'records' }
    ],
    frontend: {
      pages: [{ id: 'records', label: 'Registros', permission: READ, view: { table: { operation: 'list_records', columns: [{ field: 'name', label: 'Nombre' }] } } }],
      assetPanels: [{ id: 'summary', label: 'Resumen', permission: READ, view: { form: { operation: 'create_record', fields: [{ field: 'name', label: 'Nombre', input: 'text' }] } } }],
      widgets: [{ id: 'count', label: 'Total', permission: READ, view: { table: { operation: 'list_records', columns: [{ field: 'name', label: 'Nombre' }] } } }],
      actions: [{ id: 'add', label: 'Añadir registro', target: 'asset.action', permission: WRITE, operation: 'create_record' }]
    }
  }, overrides || {});
}

function item(overrides) {
  const value = Object.assign({}, overrides || {});
  const manifestValue = value.manifest || manifest();
  return Object.assign({
    manifest: manifestValue,
    digest: digest('a'),
    enabled: true,
    version: manifestValue.version,
    revision: 2,
    schemaVersion: 1,
    status: 'installed',
    frontendUrl: null,
    operations: manifestValue.operations
  }, value, { manifest: manifestValue });
}

function createHost(permissions) {
  const sandbox = createSandbox();
  const calls = [];
  const catalog = [];
  sandbox.window.location.origin = 'https://itsm.example';
  sandbox.window.AssetAccess = {
    request: async (vm, path, options) => {
      calls.push({ path, options, vm });
      return { items: [] };
    },
    setExtensionPermissions: (groups) => catalog.push(groups)
  };
  evaluate(sandbox, 'assets/js/extension-views.js');
  evaluate(sandbox, 'assets/js/ui-composition.js');
  evaluate(sandbox, 'assets/js/extensions.js');
  const app = {
    authenticated: true,
    activeUserId: 'user-1',
    serverPermissions: permissions || [READ, WRITE, 'system.modules'],
    can(permission) { return this.serverPermissions.indexOf(permission) !== -1; }
  };
  app.extensions = sandbox.window.AssetExtensions.data().extensions;
  return { sandbox, window: sandbox.window, service: sandbox.window.AssetExtensions, app, calls, catalog };
}

function sync(host, items) {
  return host.service.sync(host.app, { sdkVersion: 2, items: items || [item()] });
}

test('discovery rejects an incompatible SDK and never creates a module script', () => {
  const host = createHost();
  assert.equal(host.service.sync(host.app, { sdkVersion: 1, items: [item()] }), false);
  assert.match(host.app.extensions.error, /SDK incompatible/);
  assert.equal(host.app.extensions.items.length, 0);

  assert.equal(sync(host), true);
  assert.equal(host.app.extensions.items.length, 1);
  assert.equal(host.app.extensions.items[0].loaded, true);
  assert.equal(host.window.document.head.children.length, 0, 'no script element was created');
  assert.equal(host.window.ITSMExtensions.sdkVersion, 2);
});

test('v1 modules stay visible as requires_upgrade and are never exposed as SDK or pages', () => {
  const host = createHost();
  const legacy = item({ manifest: manifest({ sdkVersion: 1 }), version: '1.0.0', status: 'requires_upgrade' });
  assert.equal(sync(host, [legacy]), true);
  const stored = host.app.extensions.items[0];
  assert.equal(stored.requiresUpgrade, true);
  assert.equal(host.service.sdkFor(host.app, stored), null);
  assert.deepEqual(plain(host.service.pageLinks(host.app)), []);
  assert.deepEqual(plain(host.service.panelsFor(host.app)), []);
  assert.deepEqual(plain(host.service.widgetsFor(host.app)), []);
  assert.deepEqual(plain(host.service.actionsFor(host.app, { id: 'a-1' })), []);
});

test('a declarative module cannot publish code and an isolated view needs a sandboxed runtime', () => {
  const host = createHost();
  const withEntry = item({ manifest: manifest({ frontend: Object.assign(manifest().frontend, { entry: 'frontend.js' }) }) });
  sync(host, [withEntry]);
  assert.match(host.app.extensions.items[0].invalid, /no puede publicar código de frontend/);

  const isolatedDeclarative = item({ manifest: manifest({ frontend: { pages: [{ id: 'x', label: 'X', permission: READ, view: { isolated: { component: 'DemoPanel' } } }] } }) });
  sync(host, [isolatedDeclarative]);
  assert.match(host.app.extensions.items[0].invalid, /runtime "sandboxed"/);

  const sandboxed = item({
    manifest: manifest({ runtime: 'sandboxed', frontend: { pages: [{ id: 'x', label: 'X', permission: READ, view: { isolated: { component: 'DemoPanel' } } }] } }),
    frontendUrl: 'https://itsm.example/api/v1/extensions/demo/frontend.js?digest=' + digest('a')
  });
  sync(host, [sandboxed]);
  assert.equal(host.app.extensions.items[0].invalid, '');
  assert.ok(host.app.extensions.items[0].frontendUrl);
});

test('an unknown capability or another storage engine invalidates the manifest', () => {
  const host = createHost();
  sync(host, [item({ manifest: manifest({ capabilities: ['core_sql'] }) })]);
  assert.match(host.app.extensions.items[0].invalid, /capacidad/);
  sync(host, [item({ manifest: manifest({ storage: { engine: 'postgres' } }) })]);
  assert.match(host.app.extensions.items[0].invalid, /SQLite/);
});

test('the SDK invokes only declared operations with plain-object arguments and the caller permission', async () => {
  const host = createHost();
  sync(host);
  const sdk = host.service.sdkFor(host.app, host.app.extensions.items[0]);
  assert.ok(sdk);
  assert.equal(sdk.id, 'demo');
  assert.equal(sdk.version, '2.0.0');
  assert.equal(sdk.can(READ), true);
  assert.equal(sdk.can('assets.write'), false);

  await sdk.request('list_records', { limit: 5 });
  assert.equal(host.calls[0].path, '/extensions/demo/invoke/list_records');
  assert.equal(host.calls[0].options.method, 'POST');
  assert.deepEqual(host.calls[0].options.body, { limit: 5 });
  await assert.rejects(() => sdk.request('drop_tables', {}), /no declara esa operación/);
  await assert.rejects(() => sdk.request('list_records', [1]), /objeto/);

  host.app.serverPermissions = ['system.modules'];
  await assert.rejects(() => sdk.request('list_records', {}), /No tienes permiso/);
  assert.equal(host.calls.length, 1);
});

test('navigation stays inside own pages and core hash routes', () => {
  const host = createHost();
  sync(host);
  const sdk = host.service.sdkFor(host.app, host.app.extensions.items[0]);
  assert.equal(sdk.navigate({ page: 'records' }), true);
  assert.equal(String(host.window.location.hash), '#/extensiones/demo/records');
  assert.equal(sdk.navigate('#/inventario'), true);
  assert.equal(String(host.window.location.hash), '#/inventario');
  assert.equal(sdk.navigate('#/extensiones/otra/x'), false);
  assert.equal(sdk.navigate('https://evil.example'), false);
});

test('a response that arrives after stop cannot revive the extension', async () => {
  const host = createHost();
  sync(host);
  const sdk = host.service.sdkFor(host.app, host.app.extensions.items[0]);
  const pending = deferred();
  host.window.AssetAccess.request = () => pending.promise;
  const request = sdk.request('list_records', {});
  host.service.stop(host.app);
  pending.resolve({ items: [{ id: 'late' }] });
  await assert.rejects(() => request, /ya no está activa/);
  assert.equal(host.app.extensions.items.length, 0);
});

test('readonly assets are deep-frozen copies, never the live host object', () => {
  const host = createHost();
  const source = { id: 'a-1', name: 'Servidor', nested: { tags: ['produccion'] } };
  const snapshot = host.service.readonlyAsset(source);
  assert.notEqual(snapshot, source);
  assert.equal(snapshot.id, 'a-1');
  assert.throws(() => { snapshot.name = 'otro'; }, (error) => error && error.name === 'TypeError');
  assert.throws(() => { snapshot.nested.tags.push('x'); }, (error) => error && error.name === 'TypeError');
  assert.equal(source.nested.tags.length, 1);
  assert.equal(host.service.readonlyAsset(null), null);
});

test('pages, panels, widgets and actions are filtered by the caller permission', () => {
  const host = createHost();
  sync(host);
  assert.equal(host.service.pageLinks(host.app).length, 1);
  assert.equal(host.service.pageLinks(host.app)[0].href, '#/extensiones/demo/records');
  assert.equal(host.service.panelsFor(host.app).length, 1);
  assert.equal(host.service.widgetsFor(host.app).length, 1);
  assert.equal(host.service.actionsFor(host.app, { id: 'a-1' }).length, 1);
  assert.deepEqual(plain(host.service.actionsFor(host.app, null)), []);

  host.app.serverPermissions = ['system.modules'];
  assert.deepEqual(plain(host.service.pageLinks(host.app)), []);
  assert.deepEqual(plain(host.service.panelsFor(host.app)), []);
  assert.deepEqual(plain(host.service.widgetsFor(host.app)), []);
  assert.deepEqual(plain(host.service.actionsFor(host.app, { id: 'a-1' })), []);
});

test('discovered permissions are published to the catalog, including inactive modules', () => {
  const host = createHost();
  sync(host, [item(), item({ manifest: manifest({ id: 'off', name: 'Apagada' }), enabled: false })]);
  const groups = plain(host.catalog[host.catalog.length - 1]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, 'extension:demo');
  assert.equal(groups[0].inactive, false);
  assert.equal(groups[1].inactive, true, 'a disabled module keeps its catalog readable but inactive');
  assert.equal(groups[0].permissions.length, 2);
});
