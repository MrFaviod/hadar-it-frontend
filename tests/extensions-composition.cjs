'use strict';
// Runtime UI composition contract (SDK v1 `frontend.contributions`).
// These tests drive the same public host wrappers the shipped template mounts,
// so they fail if projection, ordering, permission or lifecycle gating regress.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const { createSandbox, mountThroughShell, digest } = require('./extensions-support.cjs');

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

const PERMISSION = 'ext_registry.records_read';

function item(id, contributions, extra) {
  const manifest = {
    sdkVersion: 1, id, name: 'Registro ' + id, version: '1.0.0', schemaVersion: 1,
    permissions: [{ code: PERMISSION, label: 'Leer', description: 'Consulta el registro.' }],
    frontend: { entry: 'frontend.js', pages: [], assetPanels: [], contributions }
  };
  const marker = digest();
  return {
    manifest, digest: marker, version: '1.0.0', revision: 1, enabled: true, schemaVersion: 1,
    frontendUrl: '/api/v1/extensions/' + id + '/frontend.js?digest=' + marker, operations: [],
    ...extra
  };
}

function contribution(overrides) {
  return {
    id: 'summary', label: 'Resumen de la extensión', target: 'page.inventory', mode: 'add',
    permission: PERMISSION, component: 'RegistrySummary', order: 0, ...overrides
  };
}

function context() {
  const created = setup();
  const scriptDocument = createSandbox().window.document;
  const createElement = created.c.document.createElement.bind(created.c.document);
  created.c.document.head = scriptDocument.head;
  created.c.document.createElement = (tag) => tag === 'script' ? scriptDocument.createElement(tag) : createElement(tag);
  created.c.location.origin = 'https://itsm.example';
  created.c.UIComposition = created.c.UIComposition;
  return created;
}

function load(created, rawItems, components) {
  const app = created.app;
  created.c.AssetExtensions.sync(app, { sdkVersion: 1, items: rawItems });
  const pending = created.c.document.head.children.filter((node) => node.tagName === 'SCRIPT');
  pending.forEach((node) => {
    const id = node.dataset.extensionId;
    created.c.ITSMExtensions.register(id, { components: components(id) });
    node.onload();
  });
  return app;
}

function boundary(created, target, core, props) {
  const UI = created.c.UIComposition;
  return mountThroughShell(created.c, {
    components: { CompositionBoundary: UI.components.CompositionBoundary, CompositionSlot: UI.components.CompositionSlot },
    props: ['app', 'target', 'context'],
    template: '<section><composition-boundary :app="app" :target="target" :context="context"><p class="core">' + core + '</p></composition-boundary></section>'
  }, { app: created.app, target, context: props || {} });
}

function content(root) {
  const parts = [];
  (function walk(node) {
    if (!node) return;
    if (node.text) parts.push(String(node.text));
    (node.children || []).forEach(walk);
  })(root);
  return parts.join(' ');
}

test('route mapping covers business pages and config without wrapping protected administration', () => {
  const s = context();
  for (const target of TARGETS.filter((id) => id.startsWith('page.'))) {
    s.app.route = { name: target.slice(5) };
    assert.equal(s.app.uiRouteTarget, target, target);
  }
  for (const target of TARGETS.filter((id) => id.startsWith('config.'))) {
    s.app.route = { name: 'config', section: target.slice(7) };
    assert.equal(s.app.uiRouteTarget, target, target);
  }
  for (const route of [
    {name:'login'}, {name:'users'}, {name:'user'}, {name:'denied'},
    {name:'config',section:'seguridad'}, {name:'config',section:'extensiones'},
    {name:'config',section:'sistema'}, {name:'extension',extensionId:'registry',pageId:'records'}
  ]) {
    s.app.route = route;
    assert.equal(s.app.uiRouteTarget, '', JSON.stringify(route));
  }
});

for (const target of ['page.inventory', 'config.general']) {
  test(target + ' renders add, hide, replace, denied and disabled fallbacks', () => {
    for (const mode of ['add','hide','replace']) {
      const s = context();
      s.app.can = () => true;
      load(s, [item('registry',[contribution({target,mode,component: mode === 'hide' ? undefined : 'RegistrySummary'})])],
        () => ({RegistrySummary:{template:'<p>EXTENSION BUSINESS BODY</p>'}}));
      const view = boundary(s,target,'CORE BUSINESS BODY');
      const rendered = content(view.root);
      assert.equal(rendered.includes('EXTENSION BUSINESS BODY'), mode !== 'hide', mode);
      assert.equal(rendered.includes('CORE BUSINESS BODY'), mode === 'add', mode);
      view.unmount();
      s.c.AssetExtensions.stop(s.app);
      const restored = boundary(s,target,'CORE BUSINESS BODY');
      assert.match(content(restored.root), /CORE BUSINESS BODY/);
      restored.unmount();
    }
    const denied = context();
    denied.app.can = () => false;
    load(denied,[item('registry',[contribution({target,mode:'replace'})])],
      () => ({RegistrySummary:{template:'<p>UNAUTHORIZED BODY</p>'}}));
    const view = boundary(denied,target,'CORE BUSINESS BODY');
    assert.match(content(view.root), /CORE BUSINESS BODY/);
    assert.doesNotMatch(content(view.root), /UNAUTHORIZED BODY/);
    view.unmount();
  });
}

test('the consumed catalogue exposes exactly the eighty shipped targets and no protected target', () => {
  const { c } = context();
  const UI = c.UIComposition;
  assert.equal(UI.CATALOGUE.length, 80);
  TARGETS.forEach((target) => assert.equal(UI.isKnownTarget(target), true, target));
  assert.equal(JSON.stringify([...UI.CATALOGUE].sort()), JSON.stringify([...TARGETS].sort()));
  ['nav.login', 'nav.users', 'nav.security', 'page.users', 'config.seguridad', 'config.extensiones', 'page.extensions', 'nav.config', '*'].forEach((target) => {
    assert.equal(UI.isKnownTarget(target), false, target);
    assert.equal(UI.isProtectedTarget(target), true, target);
  });
  const coverage = UI.coverage();
  assert.equal(coverage.declared, 80);
  assert.equal(coverage.wired, 80);
  assert.equal(JSON.stringify(coverage.missing), '[]');
});

test('additions sort by order, extension id then contribution id and reject unauthorized or invalid declarations', () => {
  const { c } = context();
  const items = [
    item('zeta', [contribution({ id: 'zeta-late', order: 20, target: 'page.inventory' })]),
    item('alpha', [
      contribution({ id: 'second', order: 5, target: 'page.inventory' }),
      contribution({ id: 'first', order: 5, target: 'page.inventory' })
    ]),
    item('beta', [contribution({ id: 'beta-late', order: 30, target: 'page.inventory' })]),
    item('gamma', [
      contribution({ id: 'unknown', target: 'page.nowhere' }),
      contribution({ id: 'no-component', mode: 'replace', component: '', target: 'page.inventory' }),
      contribution({ id: 'hide-with-component', mode: 'hide', target: 'page.inventory' }),
      contribution({ id: 'not-declared', permission: 'ext_other.read', target: 'page.inventory' }),
      contribution({ id: 'bad-mode', mode: 'destroy', target: 'page.inventory' })
    ])
  ];
  items.forEach((entry) => { entry.loaded = true; });
  const projection = c.UIComposition.project(items, () => true, () => true);
  const additions = projection.additions['page.inventory'].map((entry) => entry.extensionId + ':' + entry.contributionId);
  assert.equal(JSON.stringify(additions), JSON.stringify(['alpha:first', 'alpha:second', 'zeta:zeta-late', 'beta:beta-late']));
  const denied = c.UIComposition.project(items, () => false, () => true);
  assert.equal(denied.additions['page.inventory'], undefined);
  const invalidItem = item('gamma', [
      contribution({ id: 'Bad Id' }),
      contribution({ id: 'dup' }),
      contribution({ id: 'dup' }),
      contribution({ target: 'nav.config' }),
      contribution({ target: 'nav.extensions', mode: 'hide' }),
      contribution({ target: 'nav.extensions', mode: 'replace' }),
    contribution({ target: 'nav.extensions', mode: 'add', id: 'ext-add' })
  ]);
  invalidItem.loaded = true;
  const invalidIds = c.UIComposition.project([invalidItem], () => true, () => true);
  assert.equal(JSON.stringify(invalidIds.additions['nav.extensions'].map((entry) => entry.contributionId)), JSON.stringify(['ext-add']));
  assert.equal(invalidIds.additions['nav.config'], undefined);
  assert.equal(JSON.stringify(invalidIds.additions['page.inventory'].map((entry) => entry.contributionId)), JSON.stringify(['dup']));
});

test('hide and replace choose one deterministic winner and unavailable modules keep the core', () => {
  const { c } = context();
  const items = [
    item('beta', [contribution({ id: 'beta-hide', mode: 'hide', target: 'asset.panel.history', order: 1, component: undefined })]),
    item('alpha', [contribution({ id: 'alpha-replace', mode: 'replace', target: 'asset.panel.history', order: 1, component: 'HistoryPanel' })]),
    item('gamma', [contribution({ id: 'later-hide', mode: 'hide', target: 'asset.panel.history', order: 2, component: undefined })])
  ];
  items.forEach((entry) => { entry.loaded = true; });
  const projection = c.UIComposition.project(items, () => true, () => true);
  assert.equal(projection.hidden['asset.panel.history'], undefined);
  assert.equal(projection.replacement['asset.panel.history'].contributionId, 'alpha-replace');
  const first = c.UIComposition.project(items, () => true, () => true);
  assert.equal(
    JSON.stringify(first.replacement['asset.panel.history']),
    JSON.stringify(projection.replacement['asset.panel.history'])
  );
  const unavailable = c.UIComposition.project([
    { ...items[0], loaded: false },
    { ...items[1], loaded: false },
    { ...items[2], loaded: false }
  ], () => true, () => true);
  assert.equal(unavailable.hidden['asset.panel.history'], undefined);
  assert.equal(unavailable.replacement['asset.panel.history'], undefined);
});

test('the mounted boundary replaces and hides the named core surface, then restores it when the extension stops', async () => {
  const created = context();
  const app = created.app;
  const before = boundary(created, 'page.inventory', 'Inventario del núcleo');
  assert.match(content(before.root), /Inventario del núcleo/);

  load(created, [item('registry', [
    contribution({ id: 'summary', target: 'page.inventory', mode: 'replace', component: 'RegistrySummary' })
  ])], () => ({
    RegistrySummary: { template: '<article class="extension-summary"><h2>Resumen de la extensión</h2></article>' }
  }));
  await created.tick();

  const replaced = boundary(created, 'page.inventory', 'Inventario del núcleo');
  assert.match(content(replaced.root), /Resumen de la extensión/);
  assert.doesNotMatch(content(replaced.root), /Inventario del núcleo/);
  assert.equal(replaced.errors.length, 0);
  assert.equal(replaced.root.children[0].tag, 'section');

  created.c.AssetExtensions.stop(app);
  await created.tick();
  const restored = boundary(created, 'page.inventory', 'Inventario del núcleo');
  assert.match(content(restored.root), /Inventario del núcleo/);
  assert.doesNotMatch(content(restored.root), /Resumen de la extensión/);
  before.unmount(); replaced.unmount(); restored.unmount();
});

test('hide removes only the named target, and unauthorized declarations never suppress the core', async () => {
  const denied = context();
  denied.app.can = (permission) => permission !== PERMISSION;
  load(denied, [item('registry', [
    contribution({ id: 'hide-history', mode: 'hide', target: 'asset.panel.history', component: undefined })
  ])], () => ({}));
  await denied.tick();
  const deniedCore = boundary(denied, 'asset.panel.history', 'Historial del núcleo');
  assert.match(content(deniedCore.root), /Historial del núcleo/);
  deniedCore.unmount();

  const created = context();
  const app = created.app;
  load(created, [item('registry', [
    contribution({ id: 'hide-history', mode: 'hide', target: 'asset.panel.history', component: undefined })
  ])], () => ({}));
  await created.tick();
  const hidden = boundary(created, 'asset.panel.history', 'Historial del núcleo');
  assert.doesNotMatch(content(hidden.root), /Historial del núcleo/);
  assert.match(content(hidden.root), /ocultada por la extensión/);

  const untouched = boundary(created, 'asset.panel.warranty', 'Garantía del núcleo');
  assert.match(content(untouched.root), /Garantía del núcleo/);

  created.c.AssetExtensions.stop(app);
  await created.tick();
  const restored = boundary(created, 'asset.panel.history', 'Historial del núcleo');
  assert.match(content(restored.root), /Historial del núcleo/);
  hidden.unmount(); untouched.unmount(); restored.unmount();
});

// --- Asset context: a slot or boundary hands the extension a deep-frozen copy
// --- produced by the host `readonlyAsset` helper, never the live host object.

function assetHost() {
  return {
    id: 'asset-demo',
    name: 'Servidor demo',
    tags: ['produccion'],
    location: { site: 'Sede central', rack: 'R2' }
  };
}

test('the composition boundary projects a deep-frozen copy of the asset context', async () => {
  const created = context();
  const host = assetHost();
  const seen = [];
  load(created, [item('registry', [
    contribution({ id: 'history-replace', mode: 'replace', target: 'asset.panel.history', component: 'HistoryPanel' })
  ])], () => ({
    HistoryPanel: {
      props: ['asset', 'sdk'],
      created() { seen.push({ asset: this.asset, sdk: this.sdk }); },
      template: '<article class="extension-history">Historial de la extensión</article>'
    }
  }));
  await created.tick();

  const mounted = boundary(created, 'asset.panel.history', 'Historial del núcleo', { asset: host });
  assert.match(content(mounted.root), /Historial de la extensión/);
  assert.equal(seen.length, 1);
  const projected = seen[0].asset;

  assert.notEqual(projected, host);
  assert.equal(projected.name, 'Servidor demo');
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.location), true);
  assert.equal(Object.isFrozen(projected.tags), true);
  assert.equal(Object.isFrozen(seen[0].sdk), true);

  assert.throws(() => { projected.name = 'mutado'; });
  assert.throws(() => { projected.location.site = 'Otra sede'; });
  assert.throws(() => { projected.tags.push('mutado'); });
  assert.equal(host.name, 'Servidor demo');
  assert.equal(host.location.site, 'Sede central');
  assert.equal(JSON.stringify(host.tags), JSON.stringify(['produccion']));
  mounted.unmount();
});

test('the composition slot projects the same read-only asset context and tolerates a null one', async () => {
  const created = context();
  const host = assetHost();
  const seen = [];
  const UI = created.c.UIComposition;
  const mountSlot = (contextProp) => mountThroughShell(created.c, {
    components: { CompositionSlot: UI.components.CompositionSlot },
    props: ['app', 'context'],
    template: '<div class="toolbar"><composition-slot :app="app" target="asset.action.delete" :context="context"><button class="btn">Eliminar activo</button></composition-slot></div>'
  }, { app: created.app, context: contextProp });

  load(created, [item('registry', [
    contribution({ id: 'delete-replace', mode: 'replace', target: 'asset.action.delete', component: 'DeleteAction' })
  ])], () => ({
    DeleteAction: {
      props: ['asset'],
      created() { seen.push(this.asset); },
      template: '<button class="btn">Eliminar con extensión</button>'
    }
  }));
  await created.tick();

  const withAsset = mountSlot({ asset: host });
  assert.match(content(withAsset.root), /Eliminar con extensión/);
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], host);
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(Object.isFrozen(seen[0].location), true);
  assert.throws(() => { seen[0].location.rack = 'R9'; });
  assert.equal(host.location.rack, 'R2');

  const withoutAsset = mountSlot({});
  assert.equal(seen.length, 2);
  assert.equal(seen[1], null);

  const withoutContext = mountSlot(null);
  assert.equal(seen.length, 3);
  assert.equal(seen[2], null);

  withAsset.unmount(); withoutAsset.unmount(); withoutContext.unmount();
});

test('the asset action slot hides only its own affordance and returns the core action on stop', async () => {
  const created = context();
  const app = created.app;
  const UI = created.c.UIComposition;
  const mountSlot = () => mountThroughShell(created.c, {
    components: { CompositionSlot: UI.components.CompositionSlot },
    props: ['app'],
    template: '<div class="toolbar"><composition-slot :app="app" target="asset.action.delete"><button class="btn">Eliminar activo</button></composition-slot></div>'
  }, { app: created.app });
  const core = mountSlot();
  assert.match(content(core.root), /Eliminar activo/);

  load(created, [item('registry', [
    contribution({ id: 'hide-delete', mode: 'hide', target: 'asset.action.delete', component: undefined })
  ])], () => ({}));
  await created.tick();
  const hidden = mountSlot();
  assert.doesNotMatch(content(hidden.root), /Eliminar activo/);

  created.c.AssetExtensions.stop(app);
  await created.tick();
  const restored = mountSlot();
  assert.match(content(restored.root), /Eliminar activo/);
  core.unmount(); hidden.unmount(); restored.unmount();
});

// --- Nav and widget replacements: the two families that had a projection but
// --- no render path. These mount the shipped host wrappers the template uses.

function navHost(created, target, core, permitted) {
  const UI = created.c.UIComposition;
  return mountThroughShell(created.c, {
    components: {
      CompositionNavItem: UI.components.CompositionNavItem,
      CompositionNavAdditions: UI.components.CompositionNavAdditions
    },
    props: ['app', 'target', 'permitted'],
    template: '<nav class="sidebar__nav">'
      + '<composition-nav-item :app="app" :target="target" :permitted="permitted">' + core + '</composition-nav-item>'
      + '<composition-nav-additions :app="app"></composition-nav-additions></nav>'
  }, { app: created.app, target, permitted: permitted !== false });
}

function dashboardState(created) {
  const state = created.c.AssetDashboardPrefs.createState();
  state.layouts = { 'fixture-user': ['alerts', 'availability'] };
  created.app.dashboard = state;
  return state;
}

function widgetHost(created) {
  const UI = created.c.UIComposition;
  const P = created.c.AssetDashboardPrefs;
  return mountThroughShell(created.c, {
    components: { CompositionWidgets: UI.components.CompositionWidgets },
    props: ['app'],
    data: () => ({ userId: 'fixture-user' }),
    computed: {
      coreWidgets() { return P.visibleWidgets(this.app.dashboard, this.userId); }
    },
    template: '<section><div class="core-grid"><p v-for="id in coreWidgets" :key="id" class="core-widget">{{ id }}</p></div>'
      + '<composition-widgets :app="app"></composition-widgets></section>'
  }, { app: created.app });
}

test('a nav replacement renders in place with its additions and restores the core link on stop', async () => {
  const created = context();
  const app = created.app;
  const reportsCore = '<a class="nav-link" href="#/reportes">Reportes del núcleo</a>';
  const labelsCore = '<a class="nav-link" href="#/etiquetas">Etiquetas del núcleo</a>';

  const before = navHost(created, 'nav.reports', reportsCore);
  assert.match(content(before.root), /Reportes del núcleo/);
  before.unmount();

  load(created, [item('registry', [
    contribution({ id: 'reports-replace', target: 'nav.reports', mode: 'replace', component: 'RegistryReports' }),
    contribution({ id: 'reports-add', target: 'nav.reports', mode: 'add', component: 'RegistryReportLink', order: 5 }),
    contribution({ id: 'labels-hide', target: 'nav.labels', mode: 'hide', component: undefined })
  ])], () => ({
    RegistryReports: { template: '<a class="extension-reports" href="#/reportes-extension">Reportes de la extensión</a>' },
    RegistryReportLink: { template: '<a class="extension-report-link" href="#/reportes-extension">Enlace añadido</a>' }
  }));
  await created.tick();

  const replaced = navHost(created, 'nav.reports', reportsCore);
  assert.match(content(replaced.root), /Reportes de la extensión/);
  assert.doesNotMatch(content(replaced.root), /Reportes del núcleo/);
  assert.match(content(replaced.root), /Enlace añadido/);

  const hidden = navHost(created, 'nav.labels', labelsCore);
  assert.doesNotMatch(content(hidden.root), /Etiquetas del núcleo/);

  const untouched = navHost(created, 'nav.help', '<a class="nav-link" href="#/ayuda">Ayuda del núcleo</a>');
  assert.match(content(untouched.root), /Ayuda del núcleo/);

  created.c.AssetExtensions.stop(app);
  await created.tick();

  const restored = navHost(created, 'nav.reports', reportsCore);
  assert.match(content(restored.root), /Reportes del núcleo/);
  assert.doesNotMatch(content(restored.root), /Reportes de la extensión/);
  assert.doesNotMatch(content(restored.root), /Enlace añadido/);
  const labelsRestored = navHost(created, 'nav.labels', labelsCore);
  assert.match(content(labelsRestored.root), /Etiquetas del núcleo/);
  replaced.unmount(); hidden.unmount(); untouched.unmount(); restored.unmount(); labelsRestored.unmount();
});

test('a widget replacement renders while usable, keeps the saved layout, and restores the core widget on stop', async () => {
  const created = context();
  const app = created.app;
  const dashboard = dashboardState(created);

  const before = widgetHost(created);
  assert.match(content(before.root), /alerts/);
  assert.match(content(before.root), /availability/);
  before.unmount();

  load(created, [item('registry', [
    contribution({ id: 'alerts-replace', target: 'widget.alerts', mode: 'replace', component: 'RegistryAlerts' })
  ])], () => ({
    RegistryAlerts: { template: '<div class="extension-alerts"><p>Alertas de la extensión</p></div>' }
  }));
  await created.tick();

  const replaced = widgetHost(created);
  const replacedText = content(replaced.root);
  assert.match(replacedText, /Alertas de la extensión/);
  assert.doesNotMatch(replacedText, /\balerts\b/);
  assert.match(replacedText, /availability/);
  assert.equal(JSON.stringify(dashboard.layouts['fixture-user']), JSON.stringify(['alerts', 'availability']));
  assert.equal(dashboard.widgets, null);

  created.c.AssetExtensions.stop(app);
  await created.tick();

  const restored = widgetHost(created);
  const restoredText = content(restored.root);
  assert.match(restoredText, /\balerts\b/);
  assert.match(restoredText, /availability/);
  assert.doesNotMatch(restoredText, /Alertas de la extensión/);
  assert.equal(JSON.stringify(dashboard.layouts['fixture-user']), JSON.stringify(['alerts', 'availability']));
  replaced.unmount(); restored.unmount();
});

test('unusable replacement components and core permission denial never suppress the core surface', async () => {
  // (a) a replacement that reports a render failure stops suppressing the core
  // widget. The throw itself is exercised in the browser fixture; here the host
  // seam is driven directly so the recovery stays a real rendered assertion.
  const failing = context();
  dashboardState(failing);
  load(failing, [item('registry', [
    contribution({ id: 'alerts-replace', target: 'widget.alerts', mode: 'replace', component: 'RegistryAlerts' })
  ])], () => ({ RegistryAlerts: { template: '<p class="extension-alerts">Alertas de la extensión</p>' } }));
  await failing.tick();
  const failingHost = widgetHost(failing);
  assert.match(content(failingHost.root), /Alertas de la extensión/);
  assert.doesNotMatch(content(failingHost.root), /\balerts\b/);
  const winner = failing.c.AssetExtensions.compositionFor(failing.app).replacement['widget.alerts'];
  assert.equal(failing.c.AssetExtensions.compositionFailure(failing.app, winner), true);
  await failing.tick();
  const recoveredText = content(failingHost.root);
  assert.match(recoveredText, /\balerts\b/);
  assert.match(recoveredText, /availability/);
  assert.doesNotMatch(recoveredText, /Alertas de la extensión/);
  assert.equal(failing.errors.length, 0);

  // (b) a module that reports itself loaded but never registers the declared
  // components keeps both core surfaces.
  const unavailable = context();
  const navCore = '<a class="nav-link" href="#/reportes">Reportes del núcleo</a>';
  dashboardState(unavailable);
  unavailable.c.AssetExtensions.sync(unavailable.app, { sdkVersion: 1, items: [item('registry', [
    contribution({ id: 'reports-replace', target: 'nav.reports', mode: 'replace', component: 'MissingReports' }),
    contribution({ id: 'alerts-replace', target: 'widget.alerts', mode: 'replace', component: 'MissingAlerts' })
  ])] });
  unavailable.app.extensions.items.forEach((entry) => { entry.loaded = true; });
  await unavailable.tick();
  const navAfter = navHost(unavailable, 'nav.reports', navCore);
  assert.match(content(navAfter.root), /Reportes del núcleo/);
  const widgetsAfter = widgetHost(unavailable);
  assert.match(content(widgetsAfter.root), /\balerts\b/);

  // (c) holding the extension permission is not core scope: nav.people still
  // requires the core people.view affordance.
  const denied = context();
  denied.app.can = (permission) => permission === PERMISSION;
  load(denied, [item('registry', [
    contribution({ id: 'people-replace', target: 'nav.people', mode: 'replace', component: 'RegistryPeople' })
  ])], () => ({ RegistryPeople: { template: '<a class="extension-people" href="#/personas">Personas de la extensión</a>' } }));
  await denied.tick();
  const peopleCore = '<a class="nav-link" href="#/personas">Personas del núcleo</a>';
  const deniedNav = navHost(denied, 'nav.people', peopleCore, false);
  assert.doesNotMatch(content(deniedNav.root), /Personas del núcleo/);
  assert.doesNotMatch(content(deniedNav.root), /Personas de la extensión/);
  const allowedNav = navHost(denied, 'nav.people', peopleCore, true);
  assert.match(content(allowedNav.root), /Personas de la extensión/);

  failingHost.unmount(); navAfter.unmount(); widgetsAfter.unmount();
  deniedNav.unmount(); allowedNav.unmount();
});

// --- Asset detail surface: the asset.panel/asset.action wrappers must render a
// --- replacement or addition only when the shipped template's own core
// --- permission and asset-state condition already shows that affordance. The
// --- core child keeps its condition, so an extension never widens what the
// --- person can already see. Duplicate declarations render at most one node.

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function slotHost(created, template, props) {
  const UI = created.c.UIComposition;
  return mountThroughShell(created.c, {
    components: { CompositionSlot: UI.components.CompositionSlot },
    props: ['app', 'permitted', 'server', 'archive', 'view'],
    template
  }, { app: created.app, permitted: true, server: false, archive: true, view: true, ...(props || {}) });
}

test('an asset action replacement and its additions stay hidden when the core condition denies the action', async () => {
  const created = context();
  load(created, [item('registry', [
    contribution({ id: 'edit-replace', target: 'asset.action.edit', mode: 'replace', component: 'RegistryEdit' }),
    contribution({ id: 'edit-add', target: 'asset.action.edit', mode: 'add', component: 'RegistryEditExtra', order: 2 })
  ])], () => ({
    RegistryEdit: { template: '<button class="extension-edit">Edición de la extensión</button>' },
    RegistryEditExtra: { template: '<button class="extension-edit-extra">Acción añadida por la extensión</button>' }
  }));
  await created.tick();

  const template = '<div class="toolbar"><composition-slot :app="app" target="asset.action.edit" :permitted="permitted">'
    + '<button v-if="permitted" class="core-edit">Editar activo del núcleo</button>'
    + '</composition-slot></div>';

  const denied = slotHost(created, template, { permitted: false });
  const deniedText = content(denied.root);
  assert.doesNotMatch(deniedText, /Editar activo del núcleo/);
  assert.doesNotMatch(deniedText, /Edición de la extensión/);
  assert.doesNotMatch(deniedText, /Acción añadida por la extensión/);

  const allowed = slotHost(created, template, { permitted: true });
  const allowedText = content(allowed.root);
  assert.match(allowedText, /Edición de la extensión/);
  assert.doesNotMatch(allowedText, /Editar activo del núcleo/);
  assert.match(allowedText, /Acción añadida por la extensión/);
  assert.equal(occurrences(allowedText, 'Acción añadida por la extensión'), 1);

  denied.unmount(); allowed.unmount();
});

test('asset lifecycle state and permission gate the replacement exactly like the core lifecycle action', async () => {
  const created = context();
  const app = created.app;
  load(created, [item('registry', [
    contribution({ id: 'archive-replace', target: 'asset.action.archive', mode: 'replace', component: 'RegistryArchive' })
  ])], () => ({ RegistryArchive: { template: '<button class="extension-archive">Archivar desde la extensión</button>' } }));
  await created.tick();

  const open = { id: 'asset-open', name: 'Notebook', serverAsset: true, archived: false };
  const archived = { id: 'asset-archived', name: 'Notebook', serverAsset: true, archived: true };
  assert.equal(app.inventoryLifecycleAllowed('archive', archived), 'El activo ya está archivado.');

  const template = '<div class="toolbar"><composition-slot :app="app" target="asset.action.archive" :permitted="permitted">'
    + '<button v-if="permitted" class="core-archive">Archivar del núcleo</button>'
    + '</composition-slot></div>';

  const archivedSlot = slotHost(created, template, { permitted: !app.inventoryLifecycleAllowed('archive', archived) });
  const archivedText = content(archivedSlot.root);
  assert.doesNotMatch(archivedText, /Archivar desde la extensión/);
  assert.doesNotMatch(archivedText, /Archivar del núcleo/);

  const allowedSlot = slotHost(created, template, { permitted: !app.inventoryLifecycleAllowed('archive', open) });
  const allowedText = content(allowedSlot.root);
  assert.match(allowedText, /Archivar desde la extensión/);
  assert.doesNotMatch(allowedText, /Archivar del núcleo/);

  app.can = (code) => code !== 'assets.edit';
  assert.equal(app.inventoryLifecycleAllowed('archive', open), 'Tu rol no permite modificar el ciclo de vida del activo.');
  const deniedSlot = slotHost(created, template, { permitted: !app.inventoryLifecycleAllowed('archive', open) });
  const deniedText = content(deniedSlot.root);
  assert.doesNotMatch(deniedText, /Archivar desde la extensión/);
  assert.doesNotMatch(deniedText, /Archivar del núcleo/);

  archivedSlot.unmount(); allowedSlot.unmount(); deniedSlot.unmount();
});

test('asset panels render the replacement only in the server or prototype context the core panel exists in', async () => {
  const created = context();
  load(created, [item('registry', [
    contribution({ id: 'history-replace', target: 'asset.panel.history', mode: 'replace', component: 'RegistryHistory' }),
    contribution({ id: 'attachments-replace', target: 'asset.panel.attachments', mode: 'replace', component: 'RegistryAttachments' })
  ])], () => ({
    RegistryHistory: { template: '<section class="extension-history">Historial de la extensión</section>' },
    RegistryAttachments: { template: '<section class="extension-attachments">Adjuntos de la extensión</section>' }
  }));
  await created.tick();

  const template = '<div class="detail">'
    + '<composition-slot :app="app" target="asset.panel.history" :permitted="server"><section v-if="server" class="core-history">Historial del servidor</section></composition-slot>'
    + '<composition-slot :app="app" target="asset.panel.history" :permitted="!server"><section v-if="!server" class="core-history">Historial del prototipo</section></composition-slot>'
    + '<composition-slot :app="app" target="asset.panel.attachments" :permitted="server && view"><section v-if="server && view" class="core-attachments">Adjuntos del núcleo</section></composition-slot>'
    + '</div>';

  const serverHost = slotHost(created, template, { server: true });
  const serverText = content(serverHost.root);
  assert.equal(occurrences(serverText, 'Historial de la extensión'), 1);
  assert.equal(occurrences(serverText, 'Historial del servidor'), 0);
  assert.equal(occurrences(serverText, 'Historial del prototipo'), 0);
  assert.equal(occurrences(serverText, 'Adjuntos de la extensión'), 1);

  const prototypeHost = slotHost(created, template, { server: false });
  const prototypeText = content(prototypeHost.root);
  assert.equal(occurrences(prototypeText, 'Historial de la extensión'), 1);
  assert.equal(occurrences(prototypeText, 'Historial del prototipo'), 0);
  assert.equal(occurrences(prototypeText, 'Adjuntos de la extensión'), 0);
  assert.equal(occurrences(prototypeText, 'Adjuntos del núcleo'), 0);

  serverHost.unmount(); prototypeHost.unmount();
});

test('duplicated asset action declarations render exactly one replacement in each mutually exclusive context', async () => {
  const created = context();
  const app = created.app;
  load(created, [item('registry', [
    contribution({ id: 'duplicate-replace', target: 'asset.action.duplicate', mode: 'replace', component: 'RegistryDuplicate' }),
    contribution({ id: 'archive-replace', target: 'asset.action.archive', mode: 'replace', component: 'RegistryArchive' })
  ])], () => ({
    RegistryDuplicate: { template: '<button class="extension-duplicate">Duplicar desde la extensión</button>' },
    RegistryArchive: { template: '<button class="extension-archive">Archivar desde la extensión</button>' }
  }));
  await created.tick();

  const asset = { id: 'asset-open', name: 'Notebook', serverAsset: true, archived: false };
  const template = '<div class="detail">'
    + '<composition-slot :app="app" target="asset.action.duplicate" :permitted="!server"><button v-if="!server" class="core-duplicate">Duplicar del prototipo</button></composition-slot>'
    + '<composition-slot :app="app" target="asset.action.duplicate" :permitted="server"><button v-if="server" class="core-duplicate">Duplicar del servidor</button></composition-slot>'
    + '<composition-slot :app="app" target="asset.action.archive" :permitted="archive"><button v-if="archive" class="core-archive">Archivar del núcleo</button></composition-slot>'
    + '<composition-slot :app="app" target="asset.action.archive" :permitted="false"><button class="core-archive-card">Archivar activo del núcleo</button></composition-slot>'
    + '</div>';

  const serverHost = slotHost(created, template, {
    server: true, archive: !app.inventoryLifecycleAllowed('archive', asset)
  });
  const serverText = content(serverHost.root);
  assert.equal(occurrences(serverText, 'Duplicar desde la extensión'), 1);
  assert.equal(occurrences(serverText, 'Duplicar del servidor'), 0);
  assert.equal(occurrences(serverText, 'Duplicar del prototipo'), 0);
  assert.equal(occurrences(serverText, 'Archivar desde la extensión'), 1);
  assert.equal(occurrences(serverText, 'Archivar activo del núcleo'), 1);

  const prototypeAsset = { id: 'asset-proto', name: 'Notebook', serverAsset: false, archived: false };
  const prototypeHost = slotHost(created, template, {
    server: false, archive: !app.inventoryLifecycleAllowed('archive', prototypeAsset)
  });
  const prototypeText = content(prototypeHost.root);
  assert.equal(occurrences(prototypeText, 'Duplicar desde la extensión'), 1);
  assert.equal(occurrences(prototypeText, 'Duplicar del prototipo'), 0);
  assert.equal(occurrences(prototypeText, 'Archivar desde la extensión'), 0);

  serverHost.unmount(); prototypeHost.unmount();
});


test('hiding archive removes both shipped affordances while replacement stays single', async () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
  const slots = html.match(/<composition-slot[^>]*target="asset.action.archive"[\s\S]*?<\/composition-slot>/g);
  assert.equal(slots.length, 2, 'both shipped archive instances are exercised');
  for (const mode of ['hide', 'replace']) {
    const created = context();
    created.app.inventoryLifecycleAllowed = () => '';
    const rule = contribution({ id: 'archive-rule', target: 'asset.action.archive', mode, component: 'RegistryArchive' });
    if (mode === 'hide') delete rule.component;
    load(created, [item('registry', [rule])], () => ({ RegistryArchive: { template: '<button>Archivo de extensión</button>' } }));
    await created.tick();
    const wrapper = mountThroughShell(created.c, {
      components: { CompositionSlot: created.c.UIComposition.components.CompositionSlot },
      props: ['app'],
      computed: { currentAsset() { return { id: 'archive-fixture' }; } },
      methods: { inventoryLifecycleAllowed() { return ''; }, openInventoryLifecycle() {} },
      template: '<div>' + slots.join('').replaceAll(':app="$root"', ':app="app"') + '</div>'
    }, { app: created.app });
    const text = content(wrapper.root);
    if (mode === 'hide') assert.doesNotMatch(text, /Archivar activo|Archivo de extensión/);
    else assert.equal(occurrences(text, 'Archivo de extensión'), 1);
    created.c.AssetExtensions.stop(created.app);
    await created.tick();
    assert.match(content(wrapper.root), /Archivar/);
    assert.doesNotMatch(content(wrapper.root), /Archivo de extensión/);
    wrapper.unmount();
  }
});
