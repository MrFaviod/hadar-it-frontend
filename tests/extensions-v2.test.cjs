'use strict';
// SDK v2 frontend contract: declarative views, asset actions, widgets and the
// isolated iframe. These tests drive the shipped host wrappers through the real
// VM template, so a render, request or isolation regression fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const { digest } = require('./extensions-support.cjs');

const READ = 'ext_license.read';
const WRITE = 'ext_license.write';
const ACT = 'ext_license.execute';
const ASSET_ID = '9f0f2f4c-0000-4000-8000-000000000001';

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

function tableView(overrides) {
  return {
    table: Object.assign({
      operation: 'list_licenses',
      columns: [
        { field: 'key', label: 'Clave' },
        { field: 'expires', label: 'Vence', format: 'date' },
        { field: 'perpetual', label: 'Perpetua', format: 'boolean' }
      ],
      filterAsset: 'assetId',
      form: {
        operation: 'create_license',
        assetField: 'assetId',
        fields: [
          { field: 'key', label: 'Clave', input: 'text', required: true },
          { field: 'seats', label: 'Puestos', input: 'number' }
        ]
      }
    }, overrides || {})
  };
}

function formView(overrides) {
  return {
    form: Object.assign({
      operation: 'create_license',
      assetField: 'assetId',
      fields: [
        { field: 'key', label: 'Clave de licencia', input: 'text', required: true },
        { field: 'notes', label: 'Notas', input: 'textarea' },
        { field: 'seats', label: 'Puestos', input: 'number' },
        { field: 'expires', label: 'Vence', input: 'date' },
        { field: 'tier', label: 'Tipo', input: 'select', options: ['Estándar', 'Volumen'] },
        { field: 'perpetual', label: 'Licencia perpetua', input: 'checkbox' }
      ]
    }, overrides || {})
  };
}

function manifest(overrides) {
  return Object.assign({
    id: 'license',
    name: 'Licencias',
    version: '2.0.0',
    sdkVersion: 2,
    schemaVersion: 1,
    runtime: 'declarative',
    capabilities: ['assets.read', 'assets.write'],
    storage: { engine: 'sqlite' },
    permissions: [
      { code: READ, label: 'Ver licencias', description: 'Consulta las licencias del activo.' },
      { code: WRITE, label: 'Crear licencias', description: 'Crea licencias declaradas.' },
      { code: ACT, label: 'Ejecutar acciones', description: 'Ejecuta acciones declaradas sobre un activo.' }
    ],
    operations: [
      { name: 'list_licenses', description: 'Lista licencias', permission: READ, mutation: false, kind: 'list', collection: 'licenses' },
      { name: 'create_license', description: 'Crea una licencia', permission: WRITE, mutation: true, kind: 'put', collection: 'licenses' },
      { name: 'revoke_license', description: 'Revoca una licencia', permission: ACT, mutation: true, kind: 'handler' }
    ],
    frontend: {
      pages: [{ id: 'licencias', label: 'Licencias', icon: 'package', permission: READ, view: tableView() }],
      assetPanels: [{ id: 'licencias', label: 'Licencias del activo', permission: READ, view: tableView() }],
      widgets: [{ id: 'resumen', label: 'Licencias vigentes', permission: READ, view: tableView() }],
      actions: [{ id: 'revoke', label: 'Revocar licencia', target: 'asset.action', permission: ACT, operation: 'revoke_license', confirm: 'Se revocará la licencia del activo. Los datos se conservan.' }]
    }
  }, overrides || {});
}

function item(overrides) {
  const manifestValue = (overrides && overrides.manifest) || manifest();
  const marker = (overrides && overrides.digest) || digest('a');
  return Object.assign({
    manifest: manifestValue,
    digest: marker,
    enabled: true,
    version: manifestValue.version,
    revision: 3,
    schemaVersion: 1,
    status: 'installed',
    frontendUrl: null,
    operations: manifestValue.operations
  }, overrides || {}, { manifest: manifestValue });
}

function activate(c, app, items) {
  return c.AssetExtensions.sync(app, { sdkVersion: 2, items });
}

function callsFor(c, needle) {
  return c.fetch.calls ? [] : [];
}

function fixture() {
  const created = setup();
  created.c.location.origin = 'https://itsm.example';
  const requests = [];
  created.c.fetch = async (url, init) => {
    const target = String(url).replace(/^\/api\/v1/, '');
    let body = init && init.body;
    if (typeof body === 'string' && body) body = JSON.parse(body);
    requests.push({ url: target, method: (init && init.method) || 'GET', body });
    if (target.startsWith('/extensions/license/invoke/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 'lic-1', key: 'LIC-001', expires: '2026-03-15', perpetual: true }], total: 23, limit: 10, offset: 0 })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { c: created.c, app: created.app, requests, errors: created.errors, mount: created.mount, tick: created.tick, settle: created.settle };
}

test('v2 discovery keeps declarative items, marks SDK 1 as requires_upgrade and creates no script', () => {
  const { c, app } = fixture();
  const created = [];
  const createElement = c.document.createElement.bind(c.document);
  c.document.createElement = (tag) => {
    created.push(String(tag).toLowerCase());
    return createElement(tag);
  };
  const legacy = item({
    manifest: manifest({
      sdkVersion: 1,
      id: 'legacy',
      runtime: undefined,
      frontend: { entry: 'frontend.js', pages: [{ id: 'panel', label: 'Panel', component: 'Legacy', permission: READ }] }
    })
  });
  activate(c, app, [item(), legacy]);
  const declarative = app.extensions.items[0];
  const upgraded = app.extensions.items[1];
  assert.equal(declarative.requiresUpgrade, false);
  assert.equal(declarative.runtime, 'declarative');
  assert.equal(declarative.pages.length, 1);
  assert.equal(declarative.pages[0].view.kind, 'table');
  assert.equal(upgraded.requiresUpgrade, true);
  assert.equal(created.filter((tag) => tag === 'script').length, 0);
  assert.equal(app.extensions.error, '');
});

test('a declarative list sends the asset id inside filters', async () => {
  const { c, app, requests, errors, mount, settle } = fixture();
  activate(c, app, [item()]);
  const view = mount('ExtensionView', {
    app,
    item: app.extensions.items[0],
    view: app.extensions.items[0].pages[0].view,
    asset: { id: ASSET_ID, name: 'Servidor de licencias' }
  });
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/extensions/license/invoke/list_licenses');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { limit: 10, offset: 0, filters: { assetId: ASSET_ID } });
  const rendered = content(view.root);
  assert.match(rendered, /LIC-001/);
  assert.match(rendered, /Sí/);
  assert.match(rendered, /Mostrando 1–10 de 23/);
  assert.equal(errors.length, 0);
  view.unmount();
});

test('a table renders module store records {id, version, data} by their data fields', async () => {
  const { c, app, requests, errors, mount, settle } = fixture();
  c.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init && init.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 'rec-1', version: 2, data: { key: 'LIC-STORE', expires: '2026-03-15', perpetual: false } }],
        total: 1
      })
    };
  };
  activate(c, app, [item()]);
  const view = mount('ExtensionView', {
    app,
    item: app.extensions.items[0],
    view: app.extensions.items[0].pages[0].view,
    asset: { id: ASSET_ID }
  });
  await settle();
  assert.equal(requests.length, 1);
  const rendered = content(view.root);
  assert.match(rendered, /LIC-STORE/);
  assert.match(rendered, /No/);
  assert.match(rendered, /Mostrando 1–1 de 1/);
  assert.equal(errors.length, 0);
  view.unmount();
});

test('table pagination requests the next page and formats dates with the host locale', async () => {
  const { c, app, requests, mount, settle } = fixture();
  activate(c, app, [item()]);
  assert.equal(
    c.ExtensionViews.formatValue('2026-03-15', 'date'),
    new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date('2026-03-15'))
  );
  const view = mount('ExtensionView', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(tableView(), app.extensions.items[0].operations).value, asset: { id: ASSET_ID } });
  await settle();
  const next = nodes(view.root, (node) => node.props && node.props['aria-label'] === 'Página siguiente')[0];
  assert.ok(next, 'next page control is rendered');
  next.props.onClick();
  await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, { limit: 10, offset: 10, filters: { assetId: ASSET_ID } });
  view.unmount();
});

test('table reports server failures and offers a retry instead of inventing rows', async () => {
  const { c, app, mount, settle } = fixture();
  activate(c, app, [item()]);
  c.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 'service_unavailable', message: 'El servicio de licencias no responde.' } }) });
  const view = mount('ExtensionView', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(tableView(), app.extensions.items[0].operations).value });
  await settle();
  const rendered = content(view.root);
  assert.match(rendered, /El servicio de licencias no responde|no se pudo/i);
  assert.equal(nodes(view.root, (node) => node.tag === 'table').length, 0, 'no table of invented rows');
  assert.ok(nodes(view.root, (node) => node.props && node.props.role === 'alert').length);
  view.unmount();
});

test('form validates required fields before invoking the operation', async () => {
  const { c, app, requests, mount, settle } = fixture();
  activate(c, app, [item()]);
  const view = mount('ExtensionForm', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(formView(), app.extensions.items[0].operations).value, asset: { id: ASSET_ID } });
  const form = view.root;
  assert.match(content(form), /Clave de licencia/);
  await view.instance.submit();
  await settle();
  assert.equal(requests.length, 0, 'invalid form never calls the server');
  assert.match(content(view.root), /obligatorio/i);
  view.unmount();
});

test('a declarative put form sends the asset id inside the data object and refreshes its sibling table', async () => {
  const { c, app, requests, mount, settle } = fixture();
  activate(c, app, [item()]);
  const view = mount('ExtensionView', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(tableView(), app.extensions.items[0].operations).value, asset: { id: ASSET_ID } });
  await settle();
  assert.equal(requests.length, 1);
  const form = view.instance.$refs.form;
  assert.ok(form, 'the table renders its declared form');
  form.values.key = 'LIC-NEW';
  form.values.seats = '4';
  await form.submit();
  await settle();
  assert.equal(requests.length, 3, 'create plus the table refresh');
  assert.equal(requests[1].url, '/extensions/license/invoke/create_license');
  assert.deepEqual(requests[1].body, { data: { key: 'LIC-NEW', seats: 4, assetId: ASSET_ID } });
  assert.equal(requests[2].url, '/extensions/license/invoke/list_licenses');
  assert.match(content(view.root), /El servidor guardó el registro/);
  view.unmount();
});

test('a save in a separate form panel refreshes the module tables on the same page', async () => {
  const { c, app, requests, mount, settle } = fixture();
  activate(c, app, [item()]);
  const operations = app.extensions.items[0].operations;
  const tablePanel = mount('ExtensionView', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(tableView({ form: undefined }), operations).value, asset: { id: ASSET_ID } });
  const formPanel = mount('ExtensionView', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(formView(), operations).value, asset: { id: ASSET_ID } });
  await settle();
  assert.equal(requests.length, 1, 'only the table loads on mount');
  const formInstance = formPanel.instance.$refs.form;
  assert.ok(formInstance, 'the form panel exposes its form');
  formInstance.values.key = 'LIC-OTHER';
  await formInstance.submit();
  await settle();
  assert.equal(requests[1].url, '/extensions/license/invoke/create_license');
  assert.equal(requests.length, 3, 'the separate table panel reloads after the save');
  assert.equal(requests[2].url, '/extensions/license/invoke/list_licenses');
  tablePanel.unmount();
  formPanel.unmount();
});

test('a handler table receives the asset id as a top-level argument', async () => {
  const { c, app, requests, mount, settle } = fixture();
  const handlerManifest = manifest({
    operations: [
      { name: 'list_licenses', description: 'Lista licencias', permission: READ, kind: 'handler' },
      { name: 'create_license', description: 'Crea una licencia', permission: WRITE, mutation: true, kind: 'put', collection: 'licenses' }
    ],
    frontend: {
      pages: [{ id: 'licencias', label: 'Licencias', permission: READ, view: tableView() }],
      assetPanels: [],
      widgets: [],
      actions: []
    }
  });
  activate(c, app, [item({ manifest: handlerManifest })]);
  const view = mount('ExtensionView', {
    app,
    item: app.extensions.items[0],
    view: app.extensions.items[0].pages[0].view,
    asset: { id: ASSET_ID }
  });
  await settle();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { limit: 10, offset: 0, assetId: ASSET_ID });
  view.unmount();
});

test('column formats follow the JSON Schema spelling and numbers use the host locale', () => {
  const { c, app } = fixture();
  activate(c, app, [item()]);
  const operations = app.extensions.items[0].operations;
  const accepted = c.ExtensionViews.normalizeView({
    table: {
      operation: 'list_licenses',
      columns: [
        { field: 'seats', label: 'Puestos', format: 'number' },
        { field: 'expiresOn', label: 'Vence', format: 'date-time' },
        { field: 'perpetual', label: 'Perpetua', format: 'boolean' },
        { field: 'key', label: 'Clave', format: 'text' }
      ]
    }
  }, operations);
  assert.equal(accepted.ok, true);
  assert.deepEqual(Array.from(accepted.value.columns, (column) => column.format), ['number', 'date-time', 'boolean', 'text']);
  assert.equal(c.ExtensionViews.formatValue(1234.5, 'number'), new Intl.NumberFormat('es-ES').format(1234.5));
  assert.equal(c.ExtensionViews.formatValue('sin dato', 'number'), 'sin dato', 'non-numbers fall back to text');
  assert.equal(
    c.ExtensionViews.formatValue('2026-03-15T08:30:00Z', 'date-time'),
    new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-03-15T08:30:00Z'))
  );
  const rejected = c.ExtensionViews.normalizeView({
    table: { operation: 'list_licenses', columns: [{ field: 'expires', label: 'Vence', format: 'datetime' }] }
  }, operations);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /formato/);
});

test('the license reference page and asset panel normalize as declared', () => {
  const { c, app } = fixture();
  const reference = manifest({
    id: 'software-licenses',
    name: 'Licencias de software',
    operations: [
      { name: 'list_assignments', description: 'Lista asignaciones', permission: READ, kind: 'handler' },
      { name: 'list_licenses', description: 'Lista licencias', permission: READ, kind: 'list', collection: 'licenses' }
    ],
    frontend: {
      pages: [{
        id: 'licencias',
        label: 'Licencias',
        permission: READ,
        view: { table: { operation: 'list_licenses', columns: [{ field: 'seats', label: 'Puestos', format: 'number' }] } }
      }],
      assetPanels: [{
        id: 'asset-licenses',
        label: 'Licencias',
        permission: READ,
        view: {
          table: {
            operation: 'list_assignments',
            columns: [
              { field: 'licenseId', label: 'Licencia' },
              { field: 'referenceState', label: 'Estado' },
              { field: 'orphaned', label: 'Huérfana', format: 'boolean' }
            ],
            filterAsset: 'asset_id'
          }
        }
      }],
      widgets: [],
      actions: []
    }
  });
  activate(c, app, [item({ manifest: reference })]);
  const stored = app.extensions.items[0];
  assert.equal(stored.invalid, '');
  assert.equal(stored.pages[0].view.columns[0].format, 'number');
  const panel = stored.assetPanels[0].view;
  assert.equal(panel.kind, 'table');
  assert.equal(panel.operation, 'list_assignments');
  assert.equal(panel.filterAsset, 'asset_id');
  assert.equal(panel.operationKind, 'handler');
  assert.deepEqual(Array.from(panel.columns, (column) => column.format), ['text', 'text', 'boolean']);
});

test('form shows the server error message and keeps the entered values', async () => {
  const { c, app, mount, settle } = fixture();
  activate(c, app, [item()]);
  c.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'conflict', message: 'La clave ya existe en esta extensión.' } }) });
  const view = mount('ExtensionForm', { app, item: app.extensions.items[0], view: c.ExtensionViews.normalizeView(formView(), app.extensions.items[0].operations).value, asset: { id: ASSET_ID } });
  view.instance.values.key = 'LIC-DUP';
  await view.instance.submit();
  await settle();
  assert.match(content(view.root), /La clave ya existe/);
  assert.equal(view.instance.values.key, 'LIC-DUP');
  view.unmount();
});

test('asset actions honour their permission and confirm through the native dialog', async () => {
  const { c, app, requests, mount, settle } = fixture();
  activate(c, app, [item()]);
  const assistant = app;
  assistant.can = (permission) => permission !== ACT;
  const denied = mount('ExtensionAssetActions', { app: assistant, asset: { id: ASSET_ID } });
  assert.equal(nodes(denied.root, (node) => node.tag === 'button').length, 0);
  denied.unmount();

  assistant.can = () => true;
  const view = mount('ExtensionAssetActions', { app: assistant, asset: { id: ASSET_ID } });
  const button = nodes(view.root, (node) => node.tag === 'button' && node.props.class && /btn/.test(node.props.class))[0];
  assert.ok(button);
  assert.match(content(button), /Revocar licencia/);
  button.props.onClick();
  await settle();
  assert.equal(requests.filter((entry) => entry.url.includes('/invoke/')).length, 0, 'nothing runs before confirmation');
  assert.match(content(view.root), /Se revocará la licencia del activo/);
  const confirm = nodes(view.root, (node) => node.tag === 'button' && /Confirmar acción/.test(content(node)))[0];
  assert.ok(confirm, 'confirmation button is rendered');
  confirm.props.onClick();
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/extensions/license/invoke/revoke_license');
  assert.deepEqual(requests[0].body, { assetId: ASSET_ID });
  assert.match(content(view.root), /El servidor completó la acción/);
  view.unmount();
});

test('declared widgets render only for authorized sessions', async () => {
  const { c, app, mount, settle } = fixture();
  activate(c, app, [item()]);
  app.route = { name: 'panel' };
  const allowed = mount('ExtensionWidgets', { app });
  await settle();
  assert.match(content(allowed.root), /Licencias vigentes/);
  assert.match(content(allowed.root), /LIC-001/);
  allowed.unmount();

  app.can = () => false;
  const denied = mount('ExtensionWidgets', { app });
  await settle();
  assert.doesNotMatch(content(denied.root), /Licencias vigentes/);
  denied.unmount();
});

test('isolated views fetch their own module and run it inside an allow-scripts frame', async () => {
  const { c, app, errors, mount, settle } = fixture();
  c.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/assets/vendor/vue.global.prod.js')) return { ok: true, status: 200, text: async () => 'window.__vueLoaded = true;' };
    if (target.includes('/api/v1/extensions/license/frontend.js')) return { ok: true, status: 200, text: async () => 'window.ITSMExtension.register({components:{LicensePanel:{render:function(){return Vue.h("p","aislado")}}}});' };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const isolated = item({
    frontendUrl: 'https://itsm.example/api/v1/extensions/license/frontend.js?digest=' + digest('a'),
    manifest: manifest({
      runtime: 'sandboxed',
      frontend: {
        pages: [{ id: 'aislada', label: 'Vista aislada', permission: READ, view: { isolated: { component: 'LicensePanel', height: 420 } } }],
        assetPanels: [],
        widgets: [],
        actions: []
      }
    })
  });
  activate(c, app, [isolated]);
  const active = app.extensions.items[0];
  assert.equal(active.requiresUpgrade, false);
  assert.ok(active.frontendUrl, 'the digest-bound module URL is kept for the host fetch');
  const view = mount('ExtensionView', { app, item: active, view: active.pages[0].view });
  await settle();
  const frame = nodes(view.root, (node) => node.tag === 'iframe')[0];
  assert.ok(frame, 'one isolated frame is rendered');
  assert.equal(frame.props.sandbox, 'allow-scripts');
  assert.doesNotMatch(String(frame.props.sandbox), /allow-same-origin|allow-popups|allow-top-navigation/);
  const srcdoc = String(frame.props.srcdoc);
  assert.match(srcdoc, /http-equiv="Content-Security-Policy"/);
  assert.match(srcdoc, /default-src 'none'/);
  assert.match(srcdoc, /script-src 'unsafe-inline'/);
  assert.match(srcdoc, /style-src 'unsafe-inline'/);
  assert.match(srcdoc, /img-src data:/);
  assert.match(srcdoc, /connect-src 'none'/);
  assert.match(srcdoc, /window\.ITSMExtension\.register/);
  assert.match(srcdoc, /LicensePanel/);
  assert.equal(errors.length, 0);
  view.unmount();
});
