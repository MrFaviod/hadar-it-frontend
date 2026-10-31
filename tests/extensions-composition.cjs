'use strict';
// Runtime UI composition contract (SDK v2 `frontend.contributions`): targets are
// a closed catalogue, additions are declarative views and hide is the only other
// mode. The shipped host wrappers are mounted, so projection regressions fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const { mountThroughShell, digest } = require('./extensions-support.cjs');

const TARGETS = [
  'nav.panel', 'nav.inventory', 'nav.conversation', 'nav.maintenance', 'nav.monitoring', 'nav.infrastructure',
  'nav.datos', 'nav.reports', 'nav.warranties', 'nav.labels', 'nav.people', 'nav.help', 'nav.extensions',
  'page.panel', 'page.inventory', 'page.conversation', 'page.maintenance', 'page.monitoring', 'page.map',
  'page.graph', 'page.datos', 'page.reports', 'page.warranties', 'page.labels', 'page.people', 'page.person',
  'page.detail', 'page.incident', 'page.reportAsset', 'page.monitorDevice', 'page.monitorAlert',
  'page.notifications', 'page.help',
  'widget.availability', 'widget.alerts', 'widget.distribution', 'widget.infrastructure', 'widget.activity',
  'widget.maintenance', 'widget.warranties', 'widget.inventory', 'widget.latency', 'widget.incidents',
  'asset.panel.warranty', 'asset.panel.attachments', 'asset.panel.qr', 'asset.panel.relations',
  'asset.panel.maintenance', 'asset.panel.monitoring', 'asset.panel.history',
  'asset.action.edit', 'asset.action.assign', 'asset.action.return', 'asset.action.transfer', 'asset.action.ask',
  'asset.action.duplicate', 'asset.action.change-status', 'asset.action.restore', 'asset.action.archive',
  'asset.action.retire', 'asset.action.purge', 'asset.action.delete',
  'config.apariencia', 'config.general', 'config.categorias', 'config.activos', 'config.sedes', 'config.personas',
  'config.integraciones', 'config.relaciones', 'config.mantenimiento', 'config.supervision', 'config.alertas',
  'config.notificaciones', 'config.mapas', 'config.datos', 'config.reportes', 'config.garantias', 'config.qr',
  'config.etiquetas'
];

const PERMISSION = 'ext_registry.read';

function content(node) {
  if (!node) return '';
  return [node.text || '', ...(node.children || []).map(content)].join(' ');
}

function nodes(node, predicate, found = []) {
  if (!node) return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) nodes(child, predicate, found);
  return found;
}

function tableContribution(id, target, extra) {
  return Object.assign({
    id,
    label: 'Registros ' + id,
    target,
    mode: 'add',
    permission: PERMISSION,
    view: { table: { operation: 'list_records', columns: [{ field: 'name', label: 'Nombre' }] } }
  }, extra || {});
}

function extension(id, contributions) {
  const manifest = {
    sdkVersion: 2,
    id,
    name: 'Registro ' + id,
    version: '2.0.0',
    schemaVersion: 1,
    runtime: 'declarative',
    capabilities: [],
    permissions: [{ code: PERMISSION, label: 'Leer', description: 'Consulta el registro.' }],
    operations: [{ name: 'list_records', description: 'Lista', permission: PERMISSION, mutation: false, kind: 'list' }],
    frontend: { pages: [], assetPanels: [], widgets: [], actions: [], contributions }
  };
  return {
    manifest,
    digest: digest(id === 'alpha' ? 'a' : 'b'),
    version: '2.0.0',
    revision: 1,
    enabled: true,
    schemaVersion: 1,
    status: 'installed',
    frontendUrl: null,
    operations: manifest.operations
  };
}

function world() {
  const created = setup();
  const { c, app } = created;
  c.location.origin = 'https://itsm.example';
  const requests = [];
  c.fetch = async (url, init) => {
    const target = String(url).replace(/^\/api\/v1/, '');
    requests.push({ target, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 'row-1', name: 'Fila canónica' }], total: 1, limit: 10, offset: 0 }) };
  };
  app.serverPermissions = (app.serverPermissions || []).concat([PERMISSION]);
  return { created, c, app, requests };
}

function sync(c, app, items) {
  return c.AssetExtensions.sync(app, { sdkVersion: 2, items });
}

function mountHost(c, app, template) {
  return mountThroughShell(c, {
    components: {
      CompositionBoundary: c.UIComposition.components.CompositionBoundary,
      CompositionSlot: c.UIComposition.components.CompositionSlot,
      CompositionNavItem: c.UIComposition.components.CompositionNavItem,
      CompositionWidgets: c.UIComposition.components.CompositionWidgets,
      UiCompositionWidgets: c.UIComposition.components.UICompositionWidgets,
      ExtensionView: c.ExtensionViews.components.ExtensionView
    },
    props: ['app'],
    template
  }, { app });
}

const settle = async (created) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await created.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await created.tick();
};

test('the composition catalogue is the closed 80-target list and keeps administration protected', () => {
  const { c } = world();
  assert.equal(c.UIComposition.CATALOGUE.length, 80);
  assert.deepEqual(Array.from(c.UIComposition.CATALOGUE), TARGETS);
  ['config.seguridad', 'config.extensiones', 'nav.login', 'page.users', 'nav.system', 'config.sistema']
    .forEach((target) => assert.equal(c.UIComposition.isKnownTarget(target), false, target + ' stays core-owned'));
});

test('an added contribution renders the declared view through the host boundary', async () => {
  const { created, c, app, requests } = world();
  sync(c, app, [extension('alpha', [tableContribution('records', 'page.inventory')])]);
  const mounted = mountHost(c, app, '<composition-boundary :app="app" target="page.inventory"><p class="core">CORE</p></composition-boundary>');
  await settle(created);
  assert.match(content(mounted.root), /CORE/);
  assert.match(content(mounted.root), /Fila canónica/);
  assert.equal(requests.length, 1, 'the declarative view calls its own operation');
  assert.equal(mounted.errors.length, 0);
  mounted.unmount();
});

test('hide removes only its target and stop restores the core surface', async () => {
  const { created, c, app } = world();
  sync(c, app, [extension('alpha', [{ id: 'hide-inventory', label: 'Ocultar inventario', target: 'page.inventory', mode: 'hide', permission: PERMISSION }])]);
  const mounted = mountHost(c, app, '<composition-boundary :app="app" target="page.inventory"><p class="core">CORE</p></composition-boundary>');
  await settle(created);
  assert.doesNotMatch(content(mounted.root), /CORE/);
  assert.match(content(mounted.root), /oculto por la extensión/);
  c.AssetExtensions.stop(app);
  await settle(created);
  assert.match(content(mounted.root), /CORE/);
  mounted.unmount();
});

test('additions order deterministically by order, extension and contribution id', async () => {
  const { created, c, app } = world();
  sync(c, app, [
    extension('zeta', [tableContribution('late', 'page.panel', { order: 20, label: 'Zeta tarde' })]),
    extension('alpha', [
      tableContribution('second', 'page.panel', { order: 10, label: 'Alpha segundo' }),
      tableContribution('first', 'page.panel', { order: 5, label: 'Alpha primero' })
    ])
  ]);
  const projection = c.AssetExtensions.compositionFor(app);
  assert.deepEqual(Array.from(projection.additions['page.panel'].map((entry) => entry.label)), ['Alpha primero', 'Alpha segundo', 'Zeta tarde']);
  const mounted = mountHost(c, app, '<composition-slot :app="app" target="page.panel"><p class="core">CORE</p></composition-slot>');
  await settle(created);
  assert.equal(nodes(mounted.root, (node) => node.tag === 'table').length, 3, 'three declared views render in order');
  mounted.unmount();
});

test('permission-denied and invalid contributions never render', async () => {
  const { created, c, app } = world();
  sync(c, app, [extension('alpha', [
    tableContribution('denied', 'page.inventory', { permission: 'ext_registry.other' }),
    tableContribution('component', 'page.inventory', { view: undefined, component: 'PrivateWidget' }),
    tableContribution('nav-add', 'nav.panel'),
    tableContribution('protected', 'config.extensiones')
  ])]);
  const stored = app.extensions.items[0];
  assert.equal(stored.contributions.length, 0, 'no contribution survives normalization');
  assert.equal(stored.ignoredContributions.length, 4);
  app.can = () => false;
  sync(c, app, [extension('alpha', [tableContribution('records', 'page.inventory')])]);
  assert.equal(c.AssetExtensions.compositionFor(app).candidates.length, 1);
  assert.equal(c.AssetExtensions.compositionFor(app).ignored[0].reason, 'permission');
  const mounted = mountHost(c, app, '<composition-boundary :app="app" target="page.inventory"><p class="core">CORE</p></composition-boundary>');
  await settle(created);
  assert.match(content(mounted.root), /CORE/);
  assert.doesNotMatch(content(mounted.root), /Fila canónica/);
  mounted.unmount();
});

test('asset slots pass the asset context to the declared view, which filters by it', async () => {
  const { created, c, app, requests } = world();
  const contribution = tableContribution('records', 'asset.panel.warranty', {
    view: { table: { operation: 'list_records', columns: [{ field: 'name', label: 'Nombre' }], filterAsset: 'assetId' } }
  });
  sync(c, app, [extension('alpha', [contribution])]);
  const mounted = mountHost(c, app,
    '<composition-slot :app="app" target="asset.panel.warranty" :asset="{ id: \'A-77\' }"><p class="core">CORE</p></composition-slot>');
  await settle(created);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { limit: 10, offset: 0, filters: { assetId: 'A-77' } });
  mounted.unmount();
});

test('navigation targets can be hidden but never receive added entries', async () => {
  const { created, c, app } = world();
  sync(c, app, [extension('alpha', [
    { id: 'hide-reports', label: 'Ocultar reportes', target: 'nav.reports', mode: 'hide', permission: PERMISSION },
    tableContribution('nav-add', 'nav.panel')
  ])]);
  const stored = app.extensions.items[0];
  assert.equal(stored.contributions.length, 1);
  assert.equal(stored.contributions[0].mode, 'hide');
  assert.equal(stored.ignoredContributions.length, 1);
  const mounted = mountHost(c, app, '<composition-nav-item :app="app" target="nav.reports"><a class="core" href="#/reportes">Reportes</a></composition-nav-item>');
  await settle(created);
  assert.doesNotMatch(content(mounted.root), /Reportes/);
  mounted.unmount();
});

test('widget additions render their view inside a labelled card', async () => {
  const { created, c, app } = world();
  sync(c, app, [extension('alpha', [tableContribution('summary', 'widget.alerts', { label: 'Alertas de licencias' })])]);
  const mounted = mountHost(c, app, '<ui-composition-widgets :app="app"></ui-composition-widgets>');
  await settle(created);
  assert.match(content(mounted.root), /Alertas de licencias/);
  assert.match(content(mounted.root), /Fila canónica/);
  mounted.unmount();
});
