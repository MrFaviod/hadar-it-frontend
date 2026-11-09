'use strict';
// T3c (sweep C): organization, relationships, maps, graphs, redundancy,
// extensions and appearance must render their copy from the catalog in both
// languages, and a language switch must update the mounted view in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const { textOf } = require('./i18n-harness.cjs');

const collapse = (value) => value.replace(/\s+/g, ' ').trim();

// Mounts the real component with the harness application, renders it in `es`,
// then switches the locale and re-reads the same instance: the copy has to come
// from the catalog, not from a literal frozen at mount time.
async function renderBothLocales(name, props) {
  const s = setup();
  const runtime = s.c.ItsmI18n;
  runtime.setLocale('es');
  const mounted = s.mount(name, props);
  await s.settle();
  const spanish = collapse(textOf(mounted.root));
  runtime.setLocale('en');
  await s.settle();
  const english = collapse(textOf(mounted.root));
  runtime.setLocale('es');
  await s.settle();
  const restored = collapse(textOf(mounted.root));
  mounted.unmount();
  assert.deepEqual(s.errors, [], name + ' renders without a Vue error');
  return { spanish, english, restored };
}

test('S3 organization configuration renders English copy and keeps the Spanish source', async () => {
  const s = setup();
  const { spanish, english, restored } = await renderBothLocales('OrganizationRelationTypes', { app: s.app });
  assert.match(spanish, /Tipos de relación/);
  assert.match(spanish, /Vocabulario administrado por el servidor\./);
  assert.match(english, /Relationship types/);
  assert.match(english, /Vocabulary managed by the server\./);
  assert.match(restored, /Tipos de relación/);
});

test('S3 asset relationships render English copy and keep the Spanish source', async () => {
  const s = setup();
  const asset = { id: 'sweep-c-empty', name: 'Sin vínculos', code: 'SW-C-1', category: 'otros', status: 'in_use' };
  const { spanish, english, restored } = await renderBothLocales('AssetRelations', { app: s.app, asset });
  assert.match(spanish, /Sin relaciones registradas/);
  assert.match(spanish, /Crear la primera relación/);
  assert.match(english, /No relationships recorded/);
  assert.match(english, /Create the first relationship/);
  assert.match(restored, /Sin relaciones registradas/);
});

test('S3 map settings render English copy and keep the Spanish source', async () => {
  const s = setup();
  const { spanish, english, restored } = await renderBothLocales('MapSettings', { app: s.app });
  assert.match(spanish, /Mapas y planos/);
  assert.match(english, /Maps and floor plans/);
  assert.match(restored, /Mapas y planos/);
});

test('S3 graph explorer renders English copy and keeps the Spanish source', async () => {
  const s = setup();
  const { spanish, english, restored } = await renderBothLocales('GraphExplorer', { app: s.app, focusId: '' });
  assert.match(spanish, /Grafo de relaciones/);
  assert.match(spanish, /Reacomodar/);
  assert.match(english, /Relationship graph/);
  assert.match(english, /Reflow/);
  assert.match(restored, /Grafo de relaciones/);
});

test('S3 redundancy panel renders English copy and keeps the Spanish source', async () => {
  const s = setup();
  const asset = s.app.assets[0];
  const { spanish, english, restored } = await renderBothLocales('OrganizationRelations', { app: s.app, asset });
  assert.match(spanish, /Redundancia/);
  assert.match(spanish, /Grupos del servidor que incluyen este activo/);
  assert.match(english, /Redundancy/);
  assert.match(english, /Server groups that include this asset/);
  assert.match(restored, /Grupos del servidor que incluyen este activo/);
});

test('S3 extension pages render English copy and keep the Spanish source', async () => {
  const s = setup();
  const { spanish, english, restored } = await renderBothLocales('ExtensionPage', { app: s.app, extensionId: 'missing', pageId: 'missing' });
  assert.match(spanish, /Módulo no instalado o no autorizado/);
  assert.match(spanish, /Volver al panel/);
  assert.match(english, /Module not installed or not authorized/);
  assert.match(english, /Back to the panel/);
  assert.match(restored, /Volver al panel/);
});

test('S3 appearance settings render English copy and keep the Spanish source', async () => {
  const s = setup();
  const { spanish, english, restored } = await renderBothLocales('AppearanceSettings', { app: s.app });
  assert.match(spanish, /Identidad de la organización/);
  assert.match(english, /Organization identity/);
  assert.match(restored, /Identidad de la organización/);
});
