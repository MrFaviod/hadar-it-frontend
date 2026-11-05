'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

/*
 * The Data page is the only surface that reads the import/export contract the
 * server actually applies. These tests mount the real components and assert the
 * rendered copy and rows, so a prototype fixture can never stand in for the
 * canonical inventory and no state can ask for something the user cannot do yet.
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

function classes(node) {
  return String((node.props && node.props.class) || '').split(/\s+/).filter(Boolean);
}

/** Text of the first rendered element carrying `className`. */
function classText(root, className) {
  const found = nodes(root, (node) => classes(node).indexOf(className) !== -1);
  return found.length ? textOf(found[0]).replace(/\s+/g, ' ').trim() : '';
}

function rendered(root) {
  return textOf(root).replace(/\s+/g, ' ').trim();
}

// The prototype catalogue is what a browser demo used to paint. A real install
// has none of it; the canonical read is the only asset source the server exports.
const PROTOTYPE_ROWS = [
  { id: 'AM-1042', name: 'Notebook de diseño', category: 'notebooks', site: 'central', status: 'active', serial: 'SN-PROTO-1' },
  { id: 'AM-1043', name: 'Notebook de soporte', category: 'notebooks', site: 'central', status: 'active', serial: 'SN-PROTO-2' }
];

function importFixture(t, options = {}) {
  const { c, app, mount, tick } = harness.setup();
  c.options.components.TransferImport = c.AssetTransferViews.TransferImport;
  app.loadImportProfiles = async () => true;
  if (options.source) app.__testSource = options.source;
  const mounted = mount('TransferImport');
  t.after(() => mounted.unmount());
  return { c, app, view: mounted.instance, root: mounted.root, tick };
}

function exportFixture(t, options = {}) {
  const { c, app, mount, tick } = harness.setup();
  c.options.components.TransferExport = c.AssetTransferViews.TransferExport;
  app.assets = (options.assets || []).slice();
  if (options.filteredAssets) {
    Object.defineProperty(app, 'filteredAssets', {
      get: () => options.filteredAssets,
      configurable: true
    });
  }
  // `serverInventory` is the application's own declaration that the session is
  // backed by the server inventory (assets/js/inventory-api.js); a host that does
  // not declare it keeps its own catalogue.
  if (options.serverInventory === false) {
    Object.defineProperty(app, 'serverInventory', { value: undefined, configurable: true });
  }
  app.inventoryFilters = { query: '', category: 'all', status: 'all' };
  app.inventory = Object.assign({}, app.inventory, {
    items: (options.inventoryItems || []).slice(),
    total: (options.inventoryItems || []).length,
    loaded: options.loaded !== false,
    loading: false,
    error: ''
  });
  app.loadImportProfiles = async () => true;
  // The locale has to be active before the render under test: the harness i18n
  // instance does not re-render mounted trees on a later switch.
  if (options.locale) c.ItsmI18n.setLocale(options.locale);
  const mounted = mount('TransferExport');
  t.after(() => mounted.unmount());
  return { c, app, view: mounted.instance, root: mounted.root, tick };
}

test('import step 1 asks for a file before it can ask for a sheet', async (t) => {
  const { view, root, tick } = importFixture(t);
  assert.equal(view.file, null);
  const foot = classText(root, 'tx-foot__note');
  assert.match(foot, /^Elige un archivo para continuar\.$/, foot);
  assert.doesNotMatch(foot, /hoja/i, foot);

  // Once the server has returned sheets, an unchecked sheet is the real gap.
  view.sourceMeta = {
    id: 'inventario.csv', name: 'inventario.csv', format: 'csv', origin: 'Archivo seleccionado', size: '2 KB',
    sheets: [{ id: 'inventario', name: 'inventario', columns: ['name', 'serial'], rows: [{ name: 'Router' }] }]
  };
  view.sheets = { inventario: false };
  await tick();
  const afterSheets = classText(root, 'tx-foot__note');
  assert.match(afterSheets, /^Selecciona al menos una hoja\.$/, afterSheets);
});

test('the import rail keeps no history card that can never fill', async (t) => {
  const { root } = importFixture(t);
  const text = rendered(root);
  assert.doesNotMatch(text, /Historial reciente/);
  assert.doesNotMatch(text, /Todavía no hay importaciones registradas\./);
});

test('the conflicts header offers no control that only shows a toast', async (t) => {
  const { app, view, root, tick } = importFixture(t);
  app.phase6.operation.rows = [{
    index: 0, line: 2, sheet: 'inventario', values: { name: 'Router de borde', serial: 'SN-CAN-1' },
    assetId: 'asset-8f21', candidates: ['asset-8f21'], classification: 'possible_duplicate', action: ''
  }];
  view.step = 4;
  await tick();
  assert.equal(view.conflicts.length, 1);
  const text = rendered(root);
  // The server resolves one match per row: a bulk button can only explain why
  // it refuses, so it is not offered as an action.
  assert.doesNotMatch(text, /Actualizar todas con la coincidencia principal/);
});

test('the applied summary renders the server result, which carries no field list', async (t) => {
  const { view, root, tick } = importFixture(t);
  view.step = 5;
  view.applied = {
    result: {
      created: [{ assetId: 'asset-new', row: { sheetName: 'CSV', rowNumber: 3 }, name: 'Notebook nueva' }],
      updated: [{
        assetId: 'asset-8f21', row: { sheetName: 'CSV', rowNumber: 2 }, name: 'Router de borde',
        changes: { name: 'Router de borde', serial: 'SN-EDGE-1' }
      }],
      skipped: [], pending: []
    },
    counts: { created: 1, updated: 1, skipped: 0, pending: 0 },
    fileName: 'inventario.csv', profile: 'Personalizado', at: '2026-01-01T00:00:00.000Z'
  };
  await tick();
  const text = rendered(root);
  assert.match(text, /Router de borde/);
  assert.match(text, /Notebook nueva/);
});

test('the export preview never paints the prototype catalogue', async (t) => {
  const { view, root } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: [] });
  assert.deepEqual(plain(view.previewRows), []);
  const text = rendered(root);
  PROTOTYPE_ROWS.forEach((row) => assert.doesNotMatch(text, new RegExp(row.id)));
  assert.match(text, /El inventario cargado no tiene activos para previsualizar\./);
});

test('a server session previews nothing before the inventory read lands', async (t) => {
  const { view, root, tick } = exportFixture(t, {
    assets: PROTOTYPE_ROWS,
    inventoryItems: [],
    loaded: false
  });
  assert.deepEqual(plain(view.previewRows), []);
  const text = rendered(root);
  PROTOTYPE_ROWS.forEach((row) => assert.doesNotMatch(text, new RegExp(row.id)));
  assert.match(text, /El inventario cargado no tiene activos para previsualizar\./);

  // The manual-selection picker reads the same source, so it lists nothing either.
  view.scope = 'selection';
  await tick();
  const picker = classText(root, 'tx-picker');
  PROTOTYPE_ROWS.forEach((row) => assert.doesNotMatch(picker, new RegExp(row.id)));
  assert.match(picker, /No hay activos que coincidan con la búsqueda\./);
});

test('a host without the server inventory adapter keeps its own catalogue', async (t) => {
  const { view, root } = exportFixture(t, {
    serverInventory: false,
    assets: PROTOTYPE_ROWS,
    inventoryItems: []
  });
  const rows = plain(view.previewRows);
  assert.equal(rows.length, 2);
  assert.match(rendered(root), /AM-1042/);
});

test('the separator options are labelled in the selected locale', async (t) => {
  // The option text is UI copy, not stored data: it must follow the locale while
  // the value sent to the server stays the separator symbol.
  const expect = (root) => nodes(root, (node) => node.tag === 'option')
    .map((node) => textOf(node).replace(/\s+/g, ' ').trim());
  for (const [locale, semicolon, comma] of [['es', 'Punto y coma (;)', 'Coma (,)'], ['en', 'Semicolon (;)', 'Comma (,)']]) {
    const { root } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: [], locale });
    const labels = expect(root);
    assert.ok(labels.indexOf(semicolon) !== -1, `${locale}: missing ${semicolon}: ${labels.join(' | ')}`);
    assert.ok(labels.indexOf(comma) !== -1, `${locale}: missing ${comma}: ${labels.join(' | ')}`);
  }
});

test('the export preview names an empty selection, not an empty inventory', async (t) => {
  // A manual selection that picks nothing is a different state from an install
  // with no assets at all; the placeholder must name the real cause.
  const serverAssets = [
    { id: 'asset-8f21', name: 'Router de borde', code: 'AM-CAN-1', category: 'redes', site: 'Central', status: 'active' }
  ];
  const { view, root, tick } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: serverAssets });
  view.scope = 'selection';
  view.selectedIds = [];
  await tick();
  const text = rendered(root);
  assert.match(text, /El alcance elegido no tiene activos para previsualizar\./);
  assert.doesNotMatch(text, /El inventario cargado no tiene activos/);
});

test('the export preview shows the assets the server would export', async (t) => {
  const serverAssets = [
    { id: 'asset-8f21', name: 'Router de borde', code: 'AM-CAN-1', category: 'redes', site: 'Central', status: 'active' },
    { id: 'asset-9c02', name: 'Switch de planta', code: 'AM-CAN-2', category: 'redes', site: 'Central', status: 'active' }
  ];
  const { view, root } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: serverAssets });
  const rows = plain(view.previewRows);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((cells) => cells[0]), ['asset-8f21', 'asset-9c02']);
  const text = rendered(root);
  PROTOTYPE_ROWS.forEach((row) => assert.doesNotMatch(text, new RegExp(row.id)));
  assert.match(text, /asset-8f21/);
});

test('the manual selection picker lists the assets the server would export', async (t) => {
  const serverAssets = [
    { id: 'asset-8f21', name: 'Router de borde', site: 'Central' },
    { id: 'asset-9c02', name: 'Switch de planta', site: 'Central' }
  ];
  const { view, root, tick } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: serverAssets });
  view.scope = 'selection';
  await tick();
  const text = rendered(root);
  PROTOTYPE_ROWS.forEach((row) => assert.doesNotMatch(text, new RegExp(row.id)));
  assert.match(text, /Router de borde/);
  assert.match(text, /Seleccionar los 2 visibles/);
});

test('the export rail keeps no export-history card the server never fills', async (t) => {
  const { root } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: [] });
  const text = rendered(root);
  assert.doesNotMatch(text, /Exportaciones recientes/);
  assert.doesNotMatch(text, /El servidor no guarda un historial de exportaciones\./);
});

test('the format step states the server contract once, not per editable control', async (t) => {
  const { root } = exportFixture(t, { assets: PROTOTYPE_ROWS, inventoryItems: [] });
  const text = rendered(root);
  // The four byte options are real request controls; a paragraph claiming the
  // server applies them on its own contradicted them.
  assert.doesNotMatch(text, /El servidor aplica el separador, los encabezados, el BOM y las columnas vacías/);
  // The factual constraints stay: one CSV file, Excel unavailable.
  assert.match(text, /No disponible: el servidor solo entrega CSV\./);
  assert.match(text, /El servidor aplica el separador elegido\./);
});


test('a host without the adapter preserves filtered, whole and selected scopes', async (t) => {
  const { view, tick } = exportFixture(t, {
    serverInventory: false,
    assets: PROTOTYPE_ROWS,
    filteredAssets: [PROTOTYPE_ROWS[0]]
  });
  view.scope = 'filters';
  await tick();
  assert.deepEqual(plain(view.scopeAssets).map(row => row.id), ['AM-1042']);
  view.scope = 'all';
  await tick();
  assert.deepEqual(plain(view.scopeAssets).map(row => row.id), ['AM-1042', 'AM-1043']);
  view.scope = 'selection';
  view.selectedIds = ['AM-1043'];
  await tick();
  assert.deepEqual(plain(view.scopeAssets).map(row => row.id), ['AM-1043']);
});


test('a server filter preview respects the restored location without changing other scopes', async (t) => {
  const rows = [
    { id: 'location-a-device', name: 'Device A', locationId: 'location-a' },
    { id: 'location-b-device', name: 'Device B', locationId: 'location-b' }
  ];
  const { app, view, tick } = exportFixture(t, { inventoryItems: rows });
  app.workspaceInventory.location = 'location-a';
  view.scope = 'filters';
  await tick();
  assert.deepEqual(plain(view.previewAssets).map(row => row.id), ['location-a-device']);
  assert.equal(view.exportFilters.location_id, 'location-a');
  view.scope = 'all';
  await tick();
  assert.deepEqual(plain(view.scopeAssets).map(row => row.id), ['location-a-device', 'location-b-device']);
  view.scope = 'selection';
  view.selectedIds = ['location-b-device'];
  await tick();
  assert.deepEqual(plain(view.scopeAssets).map(row => row.id), ['location-b-device']);
});
