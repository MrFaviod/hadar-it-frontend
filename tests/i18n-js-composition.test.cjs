'use strict';
// S3: ui-composition returns validation copy to the caller, which may render it
// outside the mounted app. The messages must come from the catalog so an English
// locale reports English while Spanish keeps today's exact text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function load(locale) {
  const session = setup();
  await session.settle();
  if (locale) session.c.ItsmI18n.setLocale(locale);
  return session.c.UIComposition;
}

const ITEM = { id: 'demo', permissions: [{ code: 'ext_demo.read' }] };
function contribution(overrides) {
  return Object.assign({
    id: 'demo-entry',
    label: 'Demo entry',
    target: 'widget.alerts',
    mode: 'add',
    permission: 'ext_demo.read'
  }, overrides || {});
}

test('composition validation copy follows the active locale', async () => {
  const es = await load();
  const en = await load('en');
  assert.equal(es.normalize(null).error, 'La contribución no es un objeto válido.');
  assert.equal(en.normalize(null).error, 'The contribution is not a valid object.');
  assert.equal(es.normalize({ id: 'Bad Id' }).error, 'La contribución tiene un id no válido.');
  assert.equal(en.normalize({ id: 'Bad Id' }).error, 'The contribution has an invalid id.');
  assert.equal(
    es.normalize(contribution({ target: 'nav.nowhere' }), ITEM).error,
    'El destino "nav.nowhere" no existe en el catálogo consumido.'
  );
  assert.equal(
    en.normalize(contribution({ target: 'nav.nowhere' }), ITEM).error,
    'The target "nav.nowhere" does not exist in the consumed catalogue.'
  );
  assert.equal(
    es.normalize(contribution({ mode: 'toggle' }), ITEM).error,
    'La contribución "demo-entry" usa un modo no válido.'
  );
  assert.equal(
    en.normalize(contribution({ mode: 'toggle' }), ITEM).error,
    'The contribution "demo-entry" uses an invalid mode.'
  );
  assert.equal(
    es.normalize(contribution({ permission: 'ext_other.read' }), ITEM).error,
    'El permiso "ext_other.read" no está declarado por la extensión.'
  );
  assert.equal(
    en.normalize(contribution({ permission: 'ext_other.read' }), ITEM).error,
    'The permission "ext_other.read" is not declared by the extension.'
  );
  assert.equal(
    es.normalize(contribution({ order: 99999 }), ITEM).error,
    'La contribución "demo-entry" usa un orden fuera de rango.'
  );
  assert.equal(
    en.normalize(contribution({ order: 99999 }), ITEM).error,
    'The contribution "demo-entry" uses an out-of-range order.'
  );
  assert.equal(
    es.normalize(contribution({ view: {} }), ITEM).error,
    'La contribución "demo-entry" no declara una vista válida. '
      + 'La vista debe declarar exactamente un tipo: tabla, formulario o aislada.'
  );
  assert.equal(
    en.normalize(contribution({ view: {} }), ITEM).error,
    'The contribution "demo-entry" does not declare a valid view. '
      + 'The view must declare exactly one type: table, form or isolated.'
  );
});
