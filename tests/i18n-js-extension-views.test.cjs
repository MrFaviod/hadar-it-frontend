'use strict';
// S3: the declarative extension views return validation copy and render table,
// form and action labels. They must resolve through the catalog so English shows
// English while Spanish keeps today's exact text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function views(locale) {
  const session = setup();
  await session.settle();
  if (locale) session.c.ItsmI18n.setLocale(locale);
  return session;
}

test('extension view validation copy follows the active locale', async () => {
  const es = (await views()).c.ExtensionViews;
  const en = (await views('en')).c.ExtensionViews;
  assert.equal(es.normalizeView(null).error, 'La extensión no declara una vista válida.');
  assert.equal(en.normalizeView(null).error, 'The extension does not declare a valid view.');
  assert.equal(es.normalizeView({}).error, 'La vista debe declarar exactamente un tipo: tabla, formulario o aislada.');
  assert.equal(en.normalizeView({}).error, 'The view must declare exactly one type: table, form or isolated.');
  assert.equal(
    es.normalizeView({ table: { operation: 'Bad Op', columns: [] } }).error,
    'La vista de tabla necesita una operación con nombre válido.'
  );
  assert.equal(
    en.normalizeView({ table: { operation: 'Bad Op', columns: [] } }).error,
    'The table view needs a validly named operation.'
  );
  assert.equal(
    es.normalizeView({ table: { operation: 'records', columns: [] } }).error,
    'La tabla necesita entre 1 y 12 columnas.'
  );
  assert.equal(
    en.normalizeView({ table: { operation: 'records', columns: [] } }).error,
    'The table needs between 1 and 12 columns.'
  );
  assert.equal(
    es.normalizeView({ table: { operation: 'records', columns: [{ field: 'name', format: 'currency' }] } }).error,
    'El formato de la columna name no está permitido.'
  );
  assert.equal(
    en.normalizeView({ table: { operation: 'records', columns: [{ field: 'name', format: 'currency' }] } }).error,
    'The format of column name is not allowed.'
  );
  assert.equal(
    es.normalizeView({ form: { operation: 'records', fields: [] } }).error,
    'El formulario necesita entre 1 y 30 campos.'
  );
  assert.equal(
    en.normalizeView({ form: { operation: 'records', fields: [] } }).error,
    'The form needs between 1 and 30 fields.'
  );
  assert.equal(
    es.normalizeView({ isolated: { component: 'Bad Component' } }).error,
    'La vista aislada necesita un componente con nombre válido.'
  );
  assert.equal(
    en.normalizeView({ isolated: { component: 'Bad Component' } }).error,
    'The isolated view needs a validly named component.'
  );
  assert.equal(
    es.normalizeView({ isolated: { component: 'DemoPanel', height: 20 } }).error,
    'La altura de la vista aislada debe estar entre 160 y 2400 píxeles.'
  );
  assert.equal(
    en.normalizeView({ isolated: { component: 'DemoPanel', height: 20 } }).error,
    'The isolated view height must be between 160 and 2400 pixels.'
  );
});

test('extension view descriptions and values follow the active locale', async () => {
  const es = (await views()).c.ExtensionViews;
  const en = (await views('en')).c.ExtensionViews;
  assert.equal(es.describeView({ kind: 'table', operation: 'records' }), 'Tabla declarativa sobre records.');
  assert.equal(en.describeView({ kind: 'table', operation: 'records' }), 'A declarative table over records.');
  assert.equal(es.describeView({ kind: 'isolated', component: 'DemoPanel' }), 'Código aislado en un marco sin sesión (DemoPanel).');
  assert.equal(en.describeView({ kind: 'isolated', component: 'DemoPanel' }), 'Isolated code in a sessionless frame (DemoPanel).');
  assert.equal(es.describeView(null), 'Sin vista declarada.');
  assert.equal(en.describeView(null), 'No declared view.');
  assert.equal(es.formatValue(true, 'boolean'), 'Sí');
  assert.equal(en.formatValue(true, 'boolean'), 'Yes');
  assert.equal(es.formatValue(null, 'text'), '—');
  assert.equal(en.formatValue(null, 'text'), '—');
});

test('extension table copy follows the active locale', async () => {
  function table(session) {
    return session.c.ExtensionViews.components.ExtensionTable.computed;
  }
  const esSession = await views();
  const enSession = await views('en');
  const es = table(esSession);
  const en = table(enSession);
  const vm = {
    item: { id: 'demo', manifest: { name: 'Demo' } },
    view: { kind: 'table', operation: 'records', columns: [{ field: 'name', label: 'Name' }] },
    rows: [], total: 0, offset: 0, limit: 10, loading: false, loaded: false
  };
  assert.equal(es.caption.call(vm), 'Registros de Demo');
  assert.equal(en.caption.call(vm), 'Records of Demo');
  assert.equal(es.rangeLabel.call(vm), 'Sin registros para mostrar.');
  assert.equal(en.rangeLabel.call(vm), 'No records to show.');
  assert.equal(es.emptyLabel.call(vm), 'Sin datos.');
  assert.equal(en.emptyLabel.call(vm), 'No data.');
  const loaded = Object.assign({}, vm, { loaded: true });
  assert.equal(es.emptyLabel.call(loaded), 'La extensión no devolvió registros.');
  assert.equal(en.emptyLabel.call(loaded), 'The extension returned no records.');
  const showing = Object.assign({}, vm, { rows: [{ name: 'One' }, { name: 'Two' }], total: 7, limit: 2 });
  assert.equal(es.rangeLabel.call(showing), 'Mostrando 1–2 de 7');
  assert.equal(en.rangeLabel.call(showing), 'Showing 1–2 of 7');
});
