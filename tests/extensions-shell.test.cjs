'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const { createSandbox, digest, mountThroughShell } = require('./extensions-support.cjs');

function nodes(node, predicate, found = []) {
  if (!node) return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) nodes(child, predicate, found);
  return found;
}

function content(node) {
  if (!node) return '';
  return [node.text || '', ...(node.children || []).map(content)].join(' ');
}

function control(root, tag) {
  return nodes(root, (node) => node.tag === tag)[0];
}

test('extension review deep links survive ordinary router canonicalization', () => {
  const { c, app } = setup();
  c.location.hash = '#/configuracion/extensiones?candidato=review-123';
  const route = app.parseRoute();
  assert.equal(route.section, 'extensiones');
  assert.equal(route.candidateId, 'review-123');
  assert.equal(app.hashFor(route), '#/configuracion/extensiones?candidato=review-123');
  c.location.hash = '#/extensiones/registry/records';
  const page = app.parseRoute();
  assert.equal(page.name, 'extension');
  assert.equal(page.extensionId, 'registry');
  assert.equal(page.pageId, 'records');
  assert.equal(app.hashFor(page), c.location.hash);
  c.location.hash = '#/activo/A%201';
  assert.equal(app.hashFor(app.parseRoute()), '#/activo/A%201');
});

test('session grants survive discovery ordering without granting catalog permissions', async () => {
  const { c, app } = setup();
  app.can = c.AssetAccess.methods.can.bind(app);
  c.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).endsWith('/auth/me')
      ? { user: { id: 'server-human', active: true }, csrfToken: 'csrf', permissions: ['assets.view', 'ext_registry.read', 'not.a.permission'] }
      : { users: [{ id: 'server-human', active: true }], roles: [] }
  });
  assert.equal(await app.checkAccessSession(), true);
  assert.equal(app.can('assets.view'), true);
  assert.equal(app.can('ext_registry.read'), true, 'server grants exist before discovery');
  assert.equal(app.can('not.a.permission'), false);
  c.AssetAccess.setExtensionPermissions([{ id: 'extension:registry', label: 'Registro', permissions: [
    { id: 'ext_registry.read', label: 'Leer' }, { id: 'ext_registry.write', label: 'Escribir' },
    { id: 'assets.edit', label: 'No puede sustituir al núcleo' }
  ] }]);
  assert.equal(app.can('ext_registry.write'), false, 'catalog is presentation, never authority');
  assert.equal(c.AssetAccess.catalog.filter((group) => group.extension).length, 1);
  assert.equal(c.AssetAccess.catalog.find((group) => group.extension).permissions.length, 2);
  app.authenticated = false;
  c.AssetAccess.setExtensionPermissions([]);
  assert.equal(app.can('ext_registry.read'), false);
  assert.equal(c.AssetAccess.catalog.filter((group) => group.extension).length, 0);
});

test('native field renders associated errors and emits the typed input value', async () => {
  const { mount, tick, errors } = setup();
  const updates = [];
  const field = mount('ItsmField', { label: 'Referencia', error: 'Es obligatoria.', required: true,
    'onUpdate:modelValue': (value) => updates.push(value) });
  const input = control(field.root, 'input');
  const label = control(field.root, 'label');
  assert.equal(label.props.for, input.props.id);
  assert.equal(input.props['aria-invalid'], 'true');
  assert.equal(input.props.required, true);
  assert.ok(nodes(field.root, (node) => node.props && node.props.id === input.props['aria-describedby']).length);
  input.props.onInput({ target: { value: 'REG-001' } });
  await tick();
  assert.deepEqual(updates, ['REG-001']);
  assert.match(content(field.root), /Es obligatoria/);
  assert.equal(errors.length, 0);
  field.unmount();
});

test('native table, status and error wrappers render factual states', async () => {
  const { mount, errors } = setup();
  const table = mount('ItsmTable', { caption: 'Registros', columns: [{ field: 'name', label: 'Nombre' }], rows: [{ id: 'one', name: 'Registro canónico' }] });
  assert.match(content(table.root), /Registro canónico/);
  assert.equal(control(table.root, 'th').props.scope, 'col');
  assert.equal(control(table.root, 'table').props.class, 'asset-table');
  const status = mount('ItsmStatus', { label: 'Pendiente', tone: 'hold' });
  assert.match(content(status.root), /Pendiente/);
  let retried = false;
  const error = mount('ItsmError', { error: 'El servidor no está disponible.', retry: true, onRetry() { retried = true; } });
  assert.equal(control(error.root, 'div').props.role, 'alert');
  control(error.root, 'button').props.onClick();
  assert.equal(retried, true);
  assert.match(content(error.root), /El servidor no está disponible/);
  assert.equal(errors.length, 0);
  table.unmount(); status.unmount(); error.unmount();
});

test('nested native contributions resolve actual global host wrappers after script completion', async () => {
  const { c, app, tick } = setup();
  const scriptDocument = createSandbox().window.document;
  const createElement = c.document.createElement.bind(c.document);
  c.document.head = scriptDocument.head;
  c.document.createElement = (tag) => tag === 'script' ? scriptDocument.createElement(tag) : createElement(tag);
  c.location.origin = 'https://itsm.example';
  const Page = c.AssetExtensions.components.ExtensionPage;
  const Panels = c.AssetExtensions.components.ExtensionAssetPanels;
  const mounted = mountThroughShell(c, {
    components: { ExtensionPage: Page, ExtensionAssetPanels: Panels },
    props: ['app'],
    template: '<main><extension-page :app="app" extension-id="registry" page-id="records"></extension-page><extension-asset-panels :app="app" :asset="{id: \'A-10\'}"></extension-asset-panels></main>'
  }, { app });
  const manifest = {
    sdkVersion: 1, id: 'registry', name: 'Registro', version: '1.0.0', schemaVersion: 1,
    permissions: [{ code: 'ext_registry.read', label: 'Leer', description: 'Consulta el registro.' }],
    frontend: { entry: 'frontend.js', pages: [{ id: 'records', label: 'Registros', component: 'RegistryPage', permission: 'ext_registry.read' }],
      assetPanels: [{ id: 'summary', label: 'Resumen', component: 'RegistryAsset', permission: 'ext_registry.read' }] }
  };
  c.AssetExtensions.sync(app, { sdkVersion: 1, items: [{ manifest, digest: digest(), version: '1.0.0', revision: 1, enabled: true,
    schemaVersion: 1, frontendUrl: '/api/v1/extensions/registry/frontend.js?digest=' + digest(), operations: [] }] });
  await tick();
  assert.match(content(mounted.root), /Cargando el módulo/);
  c.ITSMExtensions.register('registry', { components: {
    RegistryPage: { props: ['sdk'], template: '<itsm-table caption="Registro nativo" :rows="[{id: \'one\', name: \'Registro canónico\'}]" :columns="[{field: \'name\', label: \'Nombre\'}]"></itsm-table>' },
    RegistryAsset: { props: ['asset', 'sdk'], template: '<div><p>Contexto {{ asset.id }}</p><itsm-status label="Vigente" tone="ok"></itsm-status></div>' }
  } });
  c.document.head.children[0].onload();
  await tick();
  assert.match(content(mounted.root), /Registro canónico/);
  assert.match(content(mounted.root), /Contexto A-10/);
  assert.match(content(mounted.root), /Vigente/);
  assert.equal(nodes(mounted.root, (node) => node.tag === 'table' && node.props.class === 'asset-table').length, 1);
  assert.equal(mounted.errors.length, 0);
  c.AssetExtensions.stop(app);
  await tick();
  assert.doesNotMatch(content(mounted.root), /Registro canónico|Contexto A-10/);
  mounted.unmount();
});
