'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

/*
 * Reusable transfer profiles live on the server, not in the browser. These
 * tests mount the real settings section and the real profile dialog, so they
 * fail if either one falls back to local storage, mixes import and export
 * profiles, or advertises preferences the server does not keep.
 */

const plain = (value) => JSON.parse(JSON.stringify(value));

const PROFILES = [
  { id: 'csv-standard', name: 'CSV estándar', options: {} },
  {
    id: 'custom-import',
    name: 'Inventario de sedes',
    options: { kind: 'import', sheetMappings: { Norte: { name: 'name', serial: 'serial' } }, matchFields: ['serial'] }
  },
  {
    id: 'custom-export',
    name: 'Exportación compacta',
    options: { kind: 'export', fields: ['id', 'name'], format: 'csv' }
  }
];

function fixture(t, options = {}) {
  const { c, app, mount } = harness.setup();
  // These views are mounted directly, as the module hosts them.
  c.options.components.TransferProfileDialog = c.AssetTransferViews.TransferProfileDialog;
  c.options.components.TransferExport = c.AssetTransferViews.TransferExport;
  const calls = { load: 0, removed: [] };
  app.phase6.profiles = Object.assign({}, app.phase6.profiles, {
    items: (options.profiles || []).slice(),
    total: 0,
    loaded: true,
    loading: false,
    error: ''
  });
  app.loadImportProfiles = async () => {
    calls.load += 1;
    return options.loadResult !== false;
  };
  app.deleteImportProfile = async (id) => {
    calls.removed.push(id);
    if (options.deleteResult) return options.deleteResult;
    app.phase6.profiles.items = app.phase6.profiles.items.filter((profile) => profile.id !== id);
    return { ok: true };
  };
  return { c, app, mount, calls };
}

// Local storage must stay untouched: the module has no browser-owned prefs.
function countStorageWrites(c) {
  const original = c.localStorage.setItem;
  let writes = 0;
  c.localStorage.setItem = (key, value) => { writes += 1; original(key, value); };
  return () => writes;
}

test('the transfer settings section lists server profiles by kind and deletes only custom ones', async (t) => {
  const { c, app, mount, calls } = fixture(t, { profiles: PROFILES });
  const mounted = mount('DataTransferSettings');
  t.after(() => mounted.unmount());
  const view = mounted.instance;
  const writes = countStorageWrites(c);

  assert.deepEqual(plain(view.importProfiles.map((profile) => profile.id)), ['csv-standard', 'custom-import']);
  assert.deepEqual(plain(view.exportProfiles.map((profile) => profile.id)), ['custom-export']);
  assert.equal(view.customCount, 2);
  assert.equal(view.isBuiltin(view.importProfiles[0]), true);
  assert.equal(view.isBuiltin(view.importProfiles[1]), false);
  assert.equal(view.profileKind(view.exportProfiles[0]), 'export');
  assert.equal(view.profileMeta(view.exportProfiles[0]), '2 campos · CSV');
  assert.equal(view.profileMeta(view.importProfiles[1]), '2 columnas · 1 criterio de identificación');

  await view.remove(view.exportProfiles[0]);
  assert.deepEqual(calls.removed, ['custom-export']);
  assert.equal(app.phase6.profiles.items.length, 2);
  assert.match(app.lastToast, /Exportación compacta» eliminado del servidor/);

  // A predetermined profile is server-owned and cannot be deleted.
  assert.equal(await view.remove(view.importProfiles[0]), false);
  assert.deepEqual(calls.removed, ['custom-export']);

  // Nothing in this section writes a browser preference any more.
  assert.equal(writes(), 0);
  assert.match(view.savedNote, /se guardan en el servidor/);
  assert.match(view.savedNote, /no guarda preferencias en el navegador/);
});

test('the settings section never falls back to the browser profile catalog', async (t) => {
  const { c, app, mount, calls } = fixture(t, { profiles: [] });
  const localCatalog = c.AssetTransferData.profiles('import');
  assert.ok(localCatalog.length > 0, 'the local catalog still exists and must not be used');
  const mounted = mount('DataTransferSettings');
  t.after(() => mounted.unmount());
  const view = mounted.instance;

  assert.equal(calls.load, 1);
  assert.deepEqual(plain(view.serverProfiles), []);
  assert.equal(view.importProfiles.length, 0);
  assert.equal(view.exportProfiles.length, 0);
  assert.equal(view.customCount, 0);
});

test('the settings section reports a failed server profile load instead of inventing profiles', async (t) => {
  const { mount } = fixture(t, { profiles: [], loadResult: false });
  const mounted = mount('DataTransferSettings');
  t.after(() => mounted.unmount());
  const view = mounted.instance;

  assert.equal(await view.refresh(), false);
  assert.equal(view.error, 'No se pudieron cargar los perfiles del servidor.');
  assert.deepEqual(plain(view.serverProfiles), []);
});

test('the profile dialog filters server profiles by kind and reads metadata from their options', async (t) => {
  const { app, mount, calls } = fixture(t, { profiles: PROFILES });
  const exportsDialog = mount('TransferProfileDialog', { open: true, kind: 'export' });
  const importsDialog = mount('TransferProfileDialog', { open: true, kind: 'import' });
  t.after(() => { exportsDialog.unmount(); importsDialog.unmount(); });
  const exportsView = exportsDialog.instance;
  const importsView = importsDialog.instance;

  assert.deepEqual(plain(exportsView.profiles.map((profile) => profile.id)), ['custom-export']);
  assert.equal(exportsView.title, 'Perfiles de exportación');
  assert.equal(exportsView.meta(exportsView.profiles[0]), '2 campos · CSV');

  assert.deepEqual(plain(importsView.profiles.map((profile) => profile.id)), ['csv-standard', 'custom-import']);
  assert.equal(importsView.title, 'Perfiles de importación');
  assert.equal(importsView.profiles[0].builtin, true);
  assert.equal(importsView.profiles[1].builtin, false);
  assert.equal(importsView.meta(importsView.profiles[1]), '2 columnas · 1 criterio de identificación');

  await importsView.remove(importsView.profiles[1]);
  assert.deepEqual(calls.removed, ['custom-import']);
  assert.equal(app.phase6.profiles.items.length, 2);
  assert.match(app.lastToast, /Inventario de sedes» eliminado del servidor/);

  // A built-in profile returns before touching the server.
  await importsView.remove(importsView.profiles[0]);
  assert.deepEqual(calls.removed, ['custom-import']);
});

test('the export view sends the named separator the server expects', async (t) => {
  const { c, app, mount } = fixture(t, { profiles: [] });
  const bodies = [];
  c.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, blob: async () => new Blob(['id,name\r\nasset-1,Router\r\n'], { type: 'text/csv' }) };
  };
  const mounted = mount('TransferExport');
  t.after(() => mounted.unmount());
  const view = mounted.instance;
  app.inventoryFilters = { query: '', category: 'all', status: 'all' };
  app.workspaceInventory = Object.assign({}, app.workspaceInventory, { location: 'all' });

  assert.deepEqual(plain(view.options), { headerRow: true, separator: ',', bom: true, includeEmpty: true });
  await view.generate();
  assert.equal(bodies[0].options.separator, 'comma');
  assert.equal(bodies[0].options.headerRow, true);
  assert.equal(bodies[0].options.bom, true);
  assert.equal(bodies[0].options.includeEmpty, true);

  // El control visible conserva el delimitador que elige la persona; solo el
  // valor de envío viaja por nombre. Se busca el control realmente renderizado
  // (su id), no una marca de diseño que la vista no emite.
  const separator = [];
  (function walk(node) {
    if (!node) return;
    if (node.props && node.props.id === 'tx-export-separator') separator.push(node);
    (node.children || []).forEach(walk);
  })(mounted.root);
  assert.equal(separator.length, 1);
  assert.deepEqual(separator[0].children.map((option) => option.props.value), [';', ',']);
  assert.equal(typeof separator[0].props['onUpdate:modelValue'], 'function');

  view.options.separator = ';';
  await view.generate();
  assert.equal(bodies[1].options.separator, 'semicolon');
});
