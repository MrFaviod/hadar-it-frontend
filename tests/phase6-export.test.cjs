'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

/*
 * The export view is the only client of POST /assets/export. These tests mount
 * the real component so the assertions cover the payload built from the
 * incumbent scope/field/option controls, the server guard around the request,
 * and the exact blob handed to the download.
 */

function walk(node, visit) {
  if (!node) return;
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

function textOf(node) {
  if (!node) return '';
  if (node.text !== undefined) return node.text;
  return (node.children || []).map(textOf).join('');
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function nodes(root, predicate) {
  const found = [];
  walk(root, (node) => { if (predicate(node)) found.push(node); });
  return found;
}

function fixture(t, options = {}) {
  const { c, app, mount } = harness.setup();
  c.options.components.TransferExport = c.AssetTransferViews.TransferExport;
  app.assets = (options.assets || []).slice();
  app.prefs = Object.assign({}, app.prefs, { search: '', category: 'all', site: 'all' });
  app.inventoryFilters = { query: '', category: 'all', status: 'all' };
  app.loadImportProfiles = async () => true;
  if (options.phase6Profiles) app.phase6.profiles.items = options.phase6Profiles;
  const mounted = mount('TransferExport');
  t.after(() => mounted.unmount());
  return { c, app, view: mounted.instance, root: mounted.root };
}

function stubExport(c, blob) {
  const calls = [];
  c.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, blob: async () => blob };
  };
  return calls;
}

const serverBlob = () => new Blob(['\ufeffid,name\r\nasset-a1,Router\r\n'], { type: 'text/csv' });

test('selection export sends the server fields, exact options and the permanent ID', async (t) => {
  const { c, view } = fixture(t, {
    assets: [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active', serial: 'SN-1' }]
  });
  const blob = serverBlob();
  const calls = stubExport(c, blob);

  // The incumbent catalog keeps unsupported columns visible but inert.
  assert.equal(view.availableFields.find((field) => field.key === 'mac').supported, false);
  view.toggleField('mac');
  assert.deepEqual(plain(view.fields), ['id', 'name', 'category', 'status']);
  assert.match(view.error, /no lo admite la exportación del servidor/);

  view.fields = ['name', 'serial', 'code'];
  assert.deepEqual(plain(view.exportFields), ['id', 'name', 'serial', 'quick_code']);

  view.setScope('selection');
  view.toggleAsset('asset-a1');
  await view.generate();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/assets/export');
  assert.equal(calls[0].init.method, 'POST');
  // El control visible guarda el delimitador humano (','); el servidor recibe
  // el nombre del separador, que es el contrato del endpoint de exportación.
  assert.deepEqual(calls[0].body, {
    fields: ['id', 'name', 'serial', 'quick_code'],
    options: { separator: 'comma', headerRow: true, bom: true, includeEmpty: true },
    assetIds: ['asset-a1']
  });
  assert.equal(view.error, '');
  assert.equal(view.generating, false);
  assert.equal(view.result.fileName, 'assets.csv');
  assert.equal(view.result.blob, blob);
  assert.equal(view.result.rows, null);

  // The permanent ID is not offered for removal and cannot be removed.
  view.toggleField('id');
  assert.deepEqual(plain(view.fields), ['name', 'serial', 'code']);
  assert.match(view.error, /ID permanente/);
});

test('filter scope sends exact view filters, all scope asks for the whole inventory', async (t) => {
  const { app, c, view } = fixture(t, {
    assets: [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active', locationId: 'loc-uuid' }]
  });
  const calls = stubExport(c, serverBlob());
  app.inventoryFilters = { query: '', category: 'network', status: 'active' };
  app.workspaceInventory = Object.assign({}, app.workspaceInventory, { location: 'loc-uuid' });

  assert.equal(view.scopes.find((scope) => scope.id === 'filters').count, '—');
  await view.generate();
  assert.deepEqual(calls[0].body.filters, {
    archived: false,
    category: 'network',
    status: 'active',
    location_id: 'loc-uuid'
  });

  view.setScope('all');
  assert.equal(view.scope, 'all');
  await view.generate();
  assert.deepEqual(calls[1].body.filters, { all: true });

  // Free-text view filters have no server equivalent, but "all" does not need them.
  app.inventoryFilters = { query: 'router', category: 'all', status: 'all' };
  await view.generate();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body.filters, { all: true });

  view.setScope('filters');
  await view.generate();
  assert.equal(calls.length, 3);
  assert.match(view.error, /búsqueda de texto/);
});

test('the four byte options are editable and reach the server; Excel stays unavailable', async (t) => {
  const { c, view, root } = fixture(t, {
    assets: [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active' }]
  });
  const calls = stubExport(c, serverBlob());

  assert.equal(view.format, 'csv');
  assert.deepEqual(plain(view.options), { headerRow: true, separator: ',', bom: true, includeEmpty: true });

  const excel = nodes(root, (node) => node.tag === 'button' && textOf(node).indexOf('Libro Excel') !== -1);
  assert.equal(excel.length, 1);
  assert.equal(excel[0].props.disabled, true);

  const checkboxes = nodes(root, (node) => node.tag === 'input' && node.props.type === 'checkbox');
  assert.equal(checkboxes.length, 3);
  checkboxes.forEach((node) => assert.notEqual(node.props.disabled, true));

  const separator = nodes(root, (node) => node.tag === 'select' && node.props.id === 'tx-export-separator');
  assert.equal(separator.length, 1);
  assert.notEqual(separator[0].props.disabled, true);

  view.options.separator = ';';
  view.options.includeEmpty = false;
  view.options.headerRow = false;
  view.options.bom = false;
  await view.generate();

  // ';' en la vista se envía como el nombre 'semicolon'.
  assert.deepEqual(calls[0].body.options, { separator: 'semicolon', headerRow: false, bom: false, includeEmpty: false });
});

test('the server blob is downloaded unchanged and a stale session discards the response', async (t) => {
  const { c, app, view } = fixture(t, {
    assets: [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active' }]
  });
  const blob = serverBlob();
  let hook = null;
  c.fetch = async () => {
    if (hook) hook();
    return { ok: true, status: 200, blob: async () => blob };
  };

  const created = [];
  const originalCreate = c.URL.createObjectURL;
  const originalRevoke = c.URL.revokeObjectURL;
  const originalCreateElement = c.document.createElement;
  c.URL.createObjectURL = (value) => {
    created.push(value);
    return 'blob:server-export';
  };
  c.URL.revokeObjectURL = () => {};
  c.document.body = { appendChild() {}, removeChild() {} };
  c.document.createElement = (tag) => (tag === 'a' ? { href: '', download: '', click() {} } : originalCreateElement(tag));
  t.after(() => {
    c.URL.createObjectURL = originalCreate;
    c.URL.revokeObjectURL = originalRevoke;
    c.document.createElement = originalCreateElement;
  });

  view.setScope('selection');
  view.toggleAsset('asset-a1');
  await view.generate();
  assert.equal(view.result.blob, blob);

  view.download();
  assert.equal(created.length, 1);
  assert.equal(created[0], blob);

  // Logging out while the response is in flight discards it.
  hook = () => { app.phase6.sessionEpoch += 1; };
  await view.generate();
  assert.equal(view.result, null);
  assert.match(view.error, /se canceló/);
});

test('export profiles come from the server API and never use browser storage', async (t) => {
  const { c, app, view } = fixture(t, {
    phase6Profiles: [
      { id: 'builtin-export', name: 'Inventario', options: { kind: 'export', fields: ['id', 'quick_code', 'name'], format: 'csv' } },
      { id: 'builtin-import', name: 'Importación', options: { kind: 'import', mapping: { name: 'name' } } }
    ]
  });

  const writes = [];
  const originalSetItem = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { writes.push(key); return originalSetItem(key, value); };
  const originalSaveProfile = c.AssetTransferData.saveProfile;
  c.AssetTransferData.saveProfile = () => { throw new Error('the prototype profile store must not be used'); };
  t.after(() => {
    c.localStorage.setItem = originalSetItem;
    c.AssetTransferData.saveProfile = originalSaveProfile;
  });

  assert.deepEqual(plain(view.profileOptions.map((profile) => profile.name)), ['Inventario']);

  view.applyProfileById({ target: { value: 'builtin-export' } });
  assert.deepEqual(plain(view.fields), ['id', 'code', 'name']);
  assert.deepEqual(plain(view.exportFields), ['id', 'quick_code', 'name']);

  view.applyProfile({ id: 'builtin-import', name: 'Importación', options: { kind: 'import' } });
  assert.deepEqual(plain(view.fields), ['id', 'code', 'name']);
  assert.match(view.error, /no es de exportación/);

  const saved = [];
  app.saveImportProfile = async (name, options) => {
    saved.push({ name, options });
    return { ok: true };
  };
  await view.saveProfile('Equipo');

  assert.deepEqual(plain(saved), [{
    name: 'Equipo',
    options: { kind: 'export', fields: ['id', 'quick_code', 'name'], format: 'csv' }
  }]);
  assert.deepEqual(writes, []);
});

test('without assets.view the view does not reach the export endpoint', async (t) => {
  const { c, app, view } = fixture(t, {
    assets: [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active' }]
  });
  const calls = stubExport(c, serverBlob());
  // phase6CanView is derived from the same identity the API guard reads.
  app.can = () => false;

  view.setScope('selection');
  view.toggleAsset('asset-a1');
  await view.generate();

  assert.equal(calls.length, 0);
  assert.match(view.error, /permiso/);
});
