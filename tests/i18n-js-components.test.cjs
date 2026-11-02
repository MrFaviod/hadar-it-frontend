'use strict';
// S3/S10: the shared table, error panel and boolean cells render catalog copy in
// both locales. Spanish stays byte-for-byte; English never leaks Spanish.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

test('table cells translate booleans and the empty state keeps the Spanish source', async () => {
  const s = harness.setup();
  const filled = s.mount('ItsmTable', { columns: [{ field: 'flag', label: 'Flag' }], rows: [{ id: 'one', flag: true }] });
  const blank = s.mount('ItsmTable', { columns: [{ field: 'name', label: 'Nombre' }], rows: [] });
  await s.settle();
  assert.match(textOf(filled.root), /Sí/, 'Spanish boolean cell is unchanged');
  assert.match(textOf(blank.root), /Sin datos\./, 'Spanish empty state is unchanged');

  await switchTo(s, 'en');
  const englishCell = textOf(filled.root);
  assert.match(englishCell, /Yes/, 'the English boolean cell is shown');
  assert.doesNotMatch(englishCell, /Sí/, 'no Spanish boolean leaks into English');
  const englishEmpty = textOf(blank.root);
  assert.match(englishEmpty, /No data\./, 'the English empty state is shown');
  assert.doesNotMatch(englishEmpty, /Sin datos/, 'no Spanish empty state leaks into English');

  await switchTo(s, 'es');
  assert.match(textOf(filled.root), /Sí/, 'the Spanish boolean returns');
  assert.match(textOf(blank.root), /Sin datos\./, 'the Spanish empty state returns');
});

test('the error panel renders its localized title and retry action', async () => {
  const s = harness.setup();
  const mounted = s.mount('ItsmError', { error: 'Servidor no disponible.', retry: true });
  await s.settle();
  const spanish = textOf(mounted.root);
  assert.match(spanish, /No se pudo completar la acción/, 'the Spanish title is unchanged');
  assert.match(spanish, /Reintentar/, 'the Spanish retry action is unchanged');

  await switchTo(s, 'en');
  const english = textOf(mounted.root);
  assert.match(english, /The action could not be completed/, 'the English title is shown');
  assert.match(english, /Retry/, 'the English retry action is shown');
  assert.doesNotMatch(english, /No se pudo completar la acción|Reintentar/, 'no Spanish copy leaks into English');
});
