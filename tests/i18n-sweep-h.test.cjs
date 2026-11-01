'use strict';
// S3/S10 sweep H: transfer (import/export) surfaces render their copy from the
// catalog. Spanish stays the source, so every case asserts the original Spanish
// first and then the same component or module in English without a remount.
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('./i18n-sweep-b-harness.cjs');

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

async function settle(harness) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.tick();
}

async function switchLocale(harness, tag) {
  harness.c.ItsmI18n.setLocale(tag);
  await settle(harness);
}

async function withView(name, run) {
  const harness = open();
  await harness.c.ItsmI18n.ready;
  if (!harness.c.options.components[name]) {
    harness.c.options.components[name] = harness.c.AssetTransferViews[name];
  }
  const view = harness.mount(name, { app: harness.app });
  try {
    await settle(harness);
    await run(harness, view, textOf(view.root));
  } finally {
    view.unmount();
  }
}

test('S3 the data transfer hub renders English and keeps the Spanish source', async () => {
  await withView('DataTransfer', async (harness, view, spanish) => {
    assert.match(spanish, /Importar y exportar/);
    assert.match(spanish, /Excel y CSV al inventario/);
    await switchLocale(harness, 'en');
    const english = textOf(view.root);
    assert.match(english, /Import and export/);
    assert.match(english, /Excel and CSV into the inventory/);
    assert.doesNotMatch(english, /Importar y exportar/);
  });
});

test('S3 the export builder renders English and keeps the Spanish source', async () => {
  await withView('TransferExport', async (harness, view, spanish) => {
    assert.match(spanish, /Qué activos entran en el archivo/);
    assert.match(spanish, /Campos y perfil/);
    await switchLocale(harness, 'en');
    const english = textOf(view.root);
    assert.match(english, /Which assets go into the file/);
    assert.match(english, /Fields and profile/);
    assert.doesNotMatch(english, /Qué activos entran en el archivo/);
  });
});

test('S3 the transfer settings section renders English and keeps the Spanish source', async () => {
  await withView('DataTransferSettings', async (harness, view, spanish) => {
    assert.match(spanish, /Datos e importación/);
    await switchLocale(harness, 'en');
    const english = textOf(view.root);
    assert.match(english, /Data and import/);
    assert.doesNotMatch(english, /Datos e importación/);
  });
});

test('S3 transfer field, state and profile labels are catalog-backed in both locales', async () => {
  const harness = open();
  await harness.c.ItsmI18n.ready;
  const D = harness.c.AssetTransferData;
  const E = harness.c.AssetTransferEngine;
  const labelOf = (list, key) => (list.find((item) => item.key === key) || {}).label;

  assert.equal(labelOf(D.TARGETS, 'name'), 'Nombre');
  assert.equal(labelOf(D.EXPORT_FIELDS, 'id'), 'ID permanente');
  assert.equal(labelOf(D.IDENTIFICATION_FIELDS, 'code'), 'Código del activo');
  assert.equal(E.STATE_LABELS.new, 'Listo para crear');
  assert.equal(D.profiles('import')[0].name, 'Inventario de sedes');

  harness.c.ItsmI18n.setLocale('en');
  assert.equal(labelOf(D.TARGETS, 'name'), 'Name');
  assert.equal(labelOf(D.EXPORT_FIELDS, 'id'), 'Permanent ID');
  assert.equal(labelOf(D.IDENTIFICATION_FIELDS, 'code'), 'Asset code');
  assert.equal(E.STATE_LABELS.new, 'Ready to create');
  assert.equal(D.profiles('import')[0].name, 'Sites inventory');
  assert.equal(D.TARGETS[0].group, 'Identification');
});

test('S3 the importer analysis messages follow the active locale', async () => {
  const harness = open();
  await harness.c.ItsmI18n.ready;
  const app = { assets: [], people: [], sites: [] };
  const wizard = {
    fileId: 'sedes-2026',
    sheets: { central: true },
    mapping: {},
    sheetSite: {},
    sheetCategory: {},
    identification: ['serial', 'ip', 'name'],
    rules: { flagIncomplete: true }
  };
  const before = harness.c.AssetTransferEngine.analyze(app, wizard).rows[0];
  assert.ok(before.errors.includes('Falta el nombre del activo.'));

  harness.c.ItsmI18n.setLocale('en');
  const after = harness.c.AssetTransferEngine.analyze(app, wizard).rows[0];
  assert.ok(after.errors.includes('The asset name is missing.'));
  assert.ok(!after.errors.includes('Falta el nombre del activo.'));
});

test('S3 the server-bound importer copy is catalog-backed', () => {
  const harness = open();
  const template = harness.c.AssetTransferViews.TransferImport.template;
  assert.match(template, /\$t\('ui\.transfer\./);
  assert.doesNotMatch(template, /Seleccionar Excel o CSV/);
  assert.doesNotMatch(template, /El servidor analiza el archivo sin modificar activos/);
});
