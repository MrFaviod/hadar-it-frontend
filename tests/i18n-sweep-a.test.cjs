'use strict';
// T3a sweep A: shell, help, dashboard, search, workspace, people, agents,
// conversation and report copy must render from the `ui.*` catalog. Each test
// switches the real runtime to `en` and back to `es`, so a hard-coded literal
// in either language fails here instead of only in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');

const ROOT = path.join(__dirname, '..');

function text(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(text).join(' ');
}

async function withLocales(s, assertPair) {
  await s.c.ItsmI18n.loadBundle('es');
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
  const es = assertPair.es;
  es(text(s.root));
  s.c.ItsmI18n.setLocale('en');
  await s.tick();
  await s.settle();
  assertPair.en(text(s.root));
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
}

function mountNamed(s, name, props) {
  const ui = s.mount(name, props);
  s.root = ui.root;
  return ui;
}

test('T3a help topics are catalog keys in both locales', async () => {
  const s = setup();
  assert.ok(s.c.AssetHelp, 'help module is loaded');
  const ui = mountNamed(s, 'HelpPage');
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Ayuda/, 'the Spanish heading is unchanged');
      assert.match(copy, /Inventario/, 'topic titles come from the es catalog');
      assert.match(copy, /Guías breves/, 'the lead is translated');
    },
    en: (copy) => {
      assert.match(copy, /Help/, 'the English heading is shown');
      assert.match(copy, /Inventory/, 'topic titles come from the en catalog');
      assert.doesNotMatch(copy, /Guías breves|Inventario/, 'no Spanish copy leaks into English');
    }
  });
  s.c.ItsmI18n.setLocale('en');
  await s.tick();
  assert.deepEqual(Array.from(s.c.AssetHelp.search('coverage'), (topic) => topic.id), ['warranties'], 'search reads the displayed language');
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
  assert.deepEqual(Array.from(s.c.AssetHelp.search('garantias'), (topic) => topic.id), ['warranties'], 'accent-insensitive Spanish search still works');
  ui.unmount();
});

test('T3a workspace shortcuts render from the catalog', async () => {
  const s = setup();
  s.app.route = { name: 'inventory' };
  s.app.workspaceState = s.c.AssetWorkspace.createState();
  const ui = mountNamed(s, 'WorkspaceShortcuts');
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Favoritos/, 'Spanish favourites label is unchanged');
      assert.match(copy, /Vistas guardadas/, 'Spanish saved views label is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Favorites/, 'English favourites label is shown');
      assert.match(copy, /Saved views/, 'English saved views label is shown');
      assert.doesNotMatch(copy, /Favoritos|Vistas guardadas/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

// The shell regions converted by this sweep keep their structure but take every
// visible string from the catalog; the Spanish literals must be gone.
test('T3a converted index.html regions contain no literal copy', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const region = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
  const people = region("<section v-else-if=\"route.name === 'people'\"", "<section v-else-if=\"route.name === 'person' && currentPerson\"");
  const person = region("<section v-else-if=\"route.name === 'person' && currentPerson\"", "<section v-else-if=\"route.name === 'person' && serverOrganizationMode");
  const denied = region("<section v-if=\"route.name === 'denied'\"", '<help-page');
  const filters = region('universal-filter-strip', 'asset-conversation');
  const configHead = region('<header class="page-head config-page__head">', '<div class="config-layout">');
  for (const [name, slice, literals] of [
    ['people route', people, ['>Personas<', '>Directorio<', '>Nueva persona', 'Personas registradas', 'Limpiar filtros', 'Sin correo']],
    ['person route', person, ['>Contacto<', '>Correo<', 'Sin teléfono', '>Activos a su cargo', 'Volver al directorio']],
    ['denied route', denied, ['Acceso denegado', 'Permisos']],
    ['shared filter strip', filters, ['Todas las categorías', 'Restablecer filtros', 'Filtros seleccionados']],
    ['config header', configHead, ['Ajustes del espacio', 'Identidad, catálogo']]
  ]) {
    assert.ok(slice.length > 100, name + ' region is found');
    for (const literal of literals) assert.ok(!slice.includes(literal), name + ' no longer hard-codes ' + JSON.stringify(literal));
  }
});
