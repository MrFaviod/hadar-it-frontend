'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, evaluate, deferred, digest } = require('./extensions-support.cjs');

const EXT_ID = 'demo';
const PAGE_PERMISSION = 'ext_demo.page';
const OP_PERMISSION = 'ext_demo.inspect';

function manifest(overrides) {
  const base = {
    id: EXT_ID,
    name: 'Demo nativa',
    version: '1.2.0',
    sdkVersion: 1,
    schemaVersion: 2,
    permissions: [
      { code: PAGE_PERMISSION, label: 'Ver página', description: 'Abre la página de demo.' },
      { code: OP_PERMISSION, label: 'Inspeccionar', description: 'Consulta datos de demo.' }
    ],
    operations: [
      { name: 'inspect', description: 'Consulta', permission: OP_PERMISSION, mutation: false, parameters: {} }
    ],
    frontend: {
      entry: 'frontend.js',
      pages: [{ id: 'panel', label: 'Panel demo', component: 'DemoPanel', permission: PAGE_PERMISSION, icon: 'package' }],
      assetPanels: [{ id: 'ficha', label: 'Demo del activo', component: 'DemoAssetPanel', permission: PAGE_PERMISSION, icon: 'box' }]
    }
  };
  return Object.assign(base, overrides || {});
}

function item(overrides) {
  const id = (overrides && overrides.manifest && overrides.manifest.id) || EXT_ID;
  const urlDigest = (overrides && overrides.digest) || digest('a');
  const base = {
    manifest: manifest(),
    digest: urlDigest,
    enabled: true,
    version: '1.2.0',
    revision: 4,
    schemaVersion: 2,
    frontendUrl: '/api/v1/extensions/' + id + '/frontend.js?digest=' + urlDigest,
    operations: [{ name: 'inspect', description: 'Consulta', permission: OP_PERMISSION, mutation: false }]
  };
  return Object.assign(base, overrides || {});
}

function activate(host) {
  const script = host.document.head.children[0];
  host.window.ITSMExtensions.register(EXT_ID, {
    components: {
      DemoPanel: { template: '<p>demo</p>' },
      DemoAssetPanel: { template: '<p>activo</p>' }
    }
  });
  script.onload();
  return host.vm.extensions.items[0];
}

function createHost(options) {
  const env = createSandbox();
  const requests = [];
  let handler = () => Promise.resolve({ sdkVersion: 1, items: [] });
  env.window.AssetAccess = {
    request(vm, requestPath, requestOptions) {
      requests.push({ vm, path: requestPath, options: requestOptions });
      return handler(vm, requestPath, requestOptions);
    },
    setExtensionPermissions(items) {
      env.window.__catalog = Array.isArray(items) ? items.map((entry) => entry.id) : [];
    }
  };
  evaluate(env, 'assets/js/extensions.js');
  const service = env.window.AssetExtensions;
  const state = service.data().extensions;
  const vm = {
    authenticated: true,
    activeUserId: 'user-1',
    csrfToken: 'csrf-1',
    serverPermissions: [PAGE_PERMISSION, OP_PERMISSION, 'system.modules'],
    route: { name: 'panel' },
    extensions: state,
    can(permission) { return this.serverPermissions.includes(permission); },
    showToast() {}
  };
  return {
    env,
    window: env.window,
    document: env.window.document,
    service,
    vm,
    requests,
    setHandler(fn) { handler = fn; }
  };
}

test('extensions sync refuses unknown SDK versions and keeps no stale modules', async () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 2, items: [item()] });
  assert.equal(host.window.ITSMExtensions.sdkVersion, 1);
  assert.equal(host.vm.extensions.items.length, 0);
  assert.match(host.vm.extensions.error, /SDK/);
  assert.equal(host.document.head.children.length, 0);
});

test('extensions loads only exact same-origin digest-bound script URLs', () => {
  const host = createHost();
  const badOrigin = item({ frontendUrl: 'https://evil.example/api/v1/extensions/demo/frontend.js?digest=' + digest() });
  host.service.sync(host.vm, { sdkVersion: 1, items: [badOrigin] });
  assert.equal(host.document.head.children.length, 0);
  assert.match(host.vm.extensions.items[0].loadError, /origen/i);

  const badDigest = item({ frontendUrl: '/api/v1/extensions/demo/frontend.js?digest=' + digest('b') });
  host.service.sync(host.vm, { sdkVersion: 1, items: [badDigest] });
  assert.equal(host.document.head.children.length, 0);
  assert.match(host.vm.extensions.items[0].loadError, /digest/i);

  const badPath = item({ frontendUrl: '/api/v1/extensions/other/frontend.js?digest=' + digest() });
  host.service.sync(host.vm, { sdkVersion: 1, items: [badPath] });
  assert.equal(host.document.head.children.length, 0);

  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  assert.equal(host.document.head.children.length, 1);
  assert.equal(
    host.document.head.children[0].src,
    'https://itsm.example/api/v1/extensions/demo/frontend.js?digest=' + digest()
  );
});

test('extension registration commits declared components only after the script loads', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const script = host.document.head.children[0];
  assert.equal(host.service.componentFor('DemoPanel'), null);

  host.window.ITSMExtensions.register(EXT_ID, {
    components: {
      DemoPanel: { template: '<p>demo</p>' },
      DemoAssetPanel: { template: '<p>activo</p>' }
    }
  });
  assert.equal(host.service.componentFor('DemoPanel'), null, 'not committed before script load');
  script.onload();
  assert.deepEqual(host.service.componentFor('DemoPanel'), { template: '<p>demo</p>' });
  assert.equal(host.vm.extensions.items[0].loaded, true);

  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  assert.equal(host.document.head.children.length, 1, 'same digest is not loaded twice');
});

test('registration cannot claim core or shared component names', () => {
  const host = createHost();
  host.window.ITSMExtensions.configure({
    app: null,
    coreComponents: ['AppIcon', 'ModalShell', 'ItsmTable']
  });
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  for (const name of ['AppIcon', 'appicon', 'ItsmTable', 'ModalShell']) {
    assert.throws(
      () => host.window.ITSMExtensions.register(EXT_ID, { components: { [name]: { template: '<b></b>' } } }),
      /reservado|núcleo|core/i
    );
  }
  assert.throws(
    () => host.window.ITSMExtensions.register('other', { components: { Other: {} } }),
    /no está cargando/i
  );
});

test('module SDK invokes only declared operations with the session and permission', async () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const active = activate(host);
  const sdk = host.service.sdkFor(host.vm, active);
  assert.equal(Object.isFrozen(sdk), true);
  assert.equal(sdk.id, EXT_ID);
  assert.equal(sdk.version, '1.2.0');
  assert.equal(sdk.can(OP_PERMISSION), true);
  assert.equal(sdk.can('ext_demo.missing'), false);

  host.setHandler((_vm, requestPath, options) => {
    assert.equal(requestPath, '/extensions/demo/invoke/inspect');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.body, { query: 'abc' });
    return Promise.resolve({ ok: true });
  });
  assert.deepEqual(await sdk.request('inspect', { query: 'abc' }), { ok: true });

  await assert.rejects(() => sdk.request('missing', {}), /no declara/i);
  await assert.rejects(() => sdk.request('inspect', 'text'), /objeto/i);

  host.vm.serverPermissions = [PAGE_PERMISSION];
  await assert.rejects(() => sdk.request('inspect', {}), /permiso/i);
  assert.equal(host.requests.filter((entry) => entry.path.includes('/invoke/')).length, 1);
});

test('module navigation stays inside its pages and core hash routes', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const active = activate(host);
  const sdk = host.service.sdkFor(host.vm, active);

  sdk.navigate({ page: 'panel' });
  assert.equal(host.window.location.hash, '#/extensiones/demo/panel');
  sdk.navigate('#/inventario');
  assert.equal(host.window.location.hash, '#/inventario');
  assert.throws(() => sdk.navigate({ page: 'missing' }), /página/i);
  assert.throws(() => sdk.navigate('https://evil.example'), /ruta/i);
  assert.throws(() => sdk.navigate('javascript:alert(1)'), /ruta/i);
  assert.throws(() => sdk.navigate('#/extensiones/otra/panel'), /ruta/i);
});

test('disabling removes scripts, components and page links immediately', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  activate(host);
  assert.ok(host.service.componentFor('DemoPanel'));
  assert.equal(host.service.pageLinks(host.vm).length, 1);

  host.service.sync(host.vm, { sdkVersion: 1, items: [item({ enabled: false, frontendUrl: null })] });
  assert.equal(host.document.head.children.length, 0);
  assert.equal(host.service.componentFor('DemoPanel'), null);
  assert.equal(host.service.pageLinks(host.vm).length, 0);
  assert.equal(host.vm.extensions.items[0].enabled, false);
});

test('late discovery responses never overwrite the newest epoch or a logged-out session', async () => {
  const host = createHost();
  const first = deferred();
  const second = deferred();
  let call = 0;
  host.setHandler(() => {
    call += 1;
    return call === 1 ? first.promise : second.promise;
  });

  const firstLoad = host.service.load(host.vm, { force: true });
  const secondLoad = host.service.load(host.vm, { force: true });
  second.resolve({ sdkVersion: 1, items: [item()] });
  await secondLoad;
  first.resolve({ sdkVersion: 1, items: [item({ manifest: manifest({ id: 'stale', name: 'Vieja' }), frontendUrl: '/api/v1/extensions/stale/frontend.js?digest=' + digest() })] });
  await firstLoad;

  assert.equal(host.vm.extensions.items.length, 1);
  assert.equal(host.vm.extensions.items[0].id, EXT_ID);

  host.vm.authenticated = false;
  host.service.stop(host.vm);
  assert.equal(host.document.head.children.length, 0);
  assert.equal(host.service.componentFor('DemoPanel'), null);
  assert.equal(host.vm.extensions.items.length, 0);
});

test('stop aborts a script load and ignores its late registration', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const script = host.document.head.children[0];
  host.service.stop(host.vm);
  assert.equal(script.parentNode, null);
  script.onload();
  assert.equal(host.service.componentFor('DemoPanel'), null);
  assert.equal(host.vm.extensions.items.length, 0);
});

test('read-only asset context is a deep frozen copy', () => {
  const host = createHost();
  const source = { id: 'A-1', technical: { ip: '10.0.0.2' }, status: 'Activo' };
  const snapshot = host.service.readonlyAsset(source);
  assert.notEqual(snapshot, source);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.technical), true);
  assert.throws(() => { snapshot.technical.ip = '10.0.0.9'; }, TypeError);
  assert.equal(source.technical.ip, '10.0.0.2');
  assert.equal(snapshot.technical.ip, '10.0.0.2');
});

test('discovery keeps disabled modules for superadmin catalog but never offers them to pages', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item({ enabled: false, frontendUrl: null })] });
  assert.equal(host.vm.extensions.items.length, 1);
  assert.deepEqual(host.window.__catalog, ['extension:' + EXT_ID]);
  assert.equal(host.service.pageLinks(host.vm).length, 0);
  const group = host.service.permissionGroups(host.vm)[0];
  assert.match(group.label, /inactiva/i);
});

test('sidebar computed exposes synced native pages and clears them on logout', () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const links = host.service.computed.extensionPageLinks.call(host.vm);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, '#/extensiones/demo/panel');
  assert.equal(links[0].label, 'Panel demo');
  host.vm.authenticated = false;
  host.service.stop(host.vm);
  assert.equal(host.service.computed.extensionPageLinks.call(host.vm).length, 0);
});

test('same digest refresh retains the loaded module and its live SDK', async () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const active = activate(host);
  const sdk = host.service.sdkFor(host.vm, active);
  host.setHandler((_vm, requestPath) => Promise.resolve(requestPath === '/extensions'
    ? { sdkVersion: 1, items: [item({ revision: 5 })] }
    : { records: ['preserved'] }));
  await host.service.load(host.vm, { force: true });
  assert.equal(host.vm.extensions.items[0], active);
  assert.equal(active.loaded, true);
  assert.equal(active.revision, 5);
  assert.ok(host.service.sdkFor(host.vm, active));
  assert.deepEqual(await sdk.request('inspect'), { records: ['preserved'] });
  assert.equal(host.document.head.children.length, 1);
});

test('a same digest discovery refresh does not invalidate a pending script', async () => {
  const host = createHost();
  host.setHandler(() => Promise.resolve({ sdkVersion: 1, items: [item()] }));
  await host.service.load(host.vm, { force: true });
  const active = host.vm.extensions.items[0];
  const script = host.document.head.children[0];
  await host.service.load(host.vm, { force: true });
  activate(host);
  assert.equal(host.vm.extensions.items[0], active);
  assert.equal(active.loaded, true);
  assert.equal(script.parentNode, host.document.head);
  assert.equal(host.document.head.children.length, 1);
});

test('digest replacement deactivates old SDKs and commits only the new module', async () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const active = activate(host);
  const sdk = host.service.sdkFor(host.vm, active);
  const previousScript = host.document.head.children[0];
  host.service.sync(host.vm, { sdkVersion: 1, items: [item({ digest: digest('b'), revision: 5 })] });
  assert.equal(previousScript.parentNode, null);
  assert.equal(host.service.componentFor('DemoPanel'), null);
  await assert.rejects(() => sdk.request('inspect'), /activa/i);
  assert.equal(sdk.can(OP_PERMISSION), false);
  activate(host);
  assert.equal(host.vm.extensions.items[0].digest, digest('b'));
  assert.equal(host.vm.extensions.items[0].loaded, true);
});

test('a late operation response is discarded after disable or logout', async () => {
  const host = createHost();
  host.service.sync(host.vm, { sdkVersion: 1, items: [item()] });
  const active = activate(host);
  const pending = deferred();
  host.setHandler(() => pending.promise);
  const request = host.service.sdkFor(host.vm, active).request('inspect');
  host.service.sync(host.vm, { sdkVersion: 1, items: [item({ enabled: false, revision: 5 })] });
  pending.resolve({ records: ['must not reach the removed page'] });
  await assert.rejects(() => request, /activa|cancelada/i);
});
