'use strict';
// T3 JS-string follow-up: the report catalog (families, allowlisted fields,
// block types, grouping options and default block copy) lives in module-level
// constants. Those labels must resolve through `ui.reports.*` when they are
// read, so changing the locale updates the catalog instead of freezing the
// Spanish text at script load.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function engineFixture() {
  const s = setup();
  return { s, engine: s.c.AssetReportEngine, i18n: s.c.ItsmI18n };
}

function labels(items) {
  return Array.from(items, (item) => item.label);
}

test('report families and their descriptions read from the catalog', () => {
  const { engine, i18n } = engineFixture();
  i18n.setLocale('es');
  assert.deepEqual(labels(engine.FAMILIES), ['Inventario', 'Historial', 'Garantías']);
  assert.deepEqual(Array.from(engine.FAMILIES, (family) => family.description), [
    'Listados y fichas del inventario actual.',
    'Movimientos, eventos y trazabilidad.',
    'Cobertura vigente, por vencer y vencida.'
  ]);
  i18n.setLocale('en');
  assert.deepEqual(labels(engine.FAMILIES), ['Inventory', 'History', 'Warranties']);
  assert.deepEqual(Array.from(engine.FAMILIES, (family) => family.description), [
    'Listings and records of the current inventory.',
    'Movements, events and traceability.',
    'Current, expiring and expired coverage.'
  ]);
  i18n.setLocale('es');
});

test('allowlisted report fields keep their stable keys and localized labels', () => {
  const { engine, i18n } = engineFixture();
  i18n.setLocale('es');
  assert.equal(engine.fieldOf('quickCode').label, 'Código rápido');
  assert.equal(engine.fieldOf('purchaseCost').label, 'Costo de compra');
  assert.equal(engine.fieldOf('technical').label, 'Ficha técnica');
  assert.equal(engine.fieldOf('expiresOn').label, 'Vencimiento');
  assert.equal(engine.fieldOf('statusOld').label, 'Estado anterior');
  assert.equal(engine.fieldOf('desconocido').label, 'desconocido', 'an unknown key is shown verbatim');
  i18n.setLocale('en');
  assert.equal(engine.fieldOf('quickCode').label, 'Quick code');
  assert.equal(engine.fieldOf('purchaseCost').label, 'Purchase cost');
  assert.equal(engine.fieldOf('technical').label, 'Technical details');
  assert.equal(engine.fieldOf('expiresOn').label, 'Expiry');
  assert.equal(engine.fieldOf('statusOld').label, 'Previous status');
  assert.deepEqual(Array.from(engine.fieldsForFamily('history'), (field) => field.key).slice(0, 3), ['assetId', 'quickCode', 'name']);
  i18n.setLocale('es');
});

test('block types and grouping options are resolved per locale', () => {
  const { engine, i18n } = engineFixture();
  i18n.setLocale('es');
  assert.deepEqual(labels(engine.BLOCK_TYPES), ['Encabezado', 'Texto', 'Ficha de activo', 'Tabla', 'Fotografía', 'Resumen', 'Código QR', 'Pie de página']);
  assert.deepEqual(labels(engine.GROUPS), ['Sin agrupar', 'Categoría', 'Sede', 'Responsable', 'Ubicación', 'Estado']);
  i18n.setLocale('en');
  assert.deepEqual(labels(engine.BLOCK_TYPES), ['Heading', 'Text', 'Asset record', 'Table', 'Photo', 'Summary', 'QR code', 'Footer']);
  assert.deepEqual(labels(engine.GROUPS), ['Ungrouped', 'Category', 'Site', 'Responsible', 'Location', 'Status']);
  assert.deepEqual(Array.from(engine.BLOCK_TYPES, (item) => item.type), ['heading', 'text', 'asset', 'table', 'photo', 'summary', 'qr', 'footer'], 'block ids stay stable');
  i18n.setLocale('es');
});

test('new report templates and their default blocks use the active locale', () => {
  const { engine, i18n } = engineFixture();
  i18n.setLocale('es');
  const spanish = engine.createTemplate('inventory');
  assert.equal(spanish.name, 'Nueva plantilla');
  assert.deepEqual(labels(spanish.blocks), ['Encabezado', 'Tabla de datos', 'Pie de página']);
  assert.equal(spanish.blocks[0].text, 'Inventario');
  assert.equal(engine.normalizeTemplate({ family: 'inventory' }).name, 'Plantilla sin nombre');
  i18n.setLocale('en');
  const english = engine.createTemplate('inventory');
  assert.equal(english.name, 'New template');
  assert.deepEqual(labels(english.blocks), ['Heading', 'Data table', 'Footer']);
  assert.equal(english.blocks[0].text, 'Inventory');
  assert.equal(engine.normalizeTemplate({ family: 'inventory' }).name, 'Untitled template');
  i18n.setLocale('es');
});
