'use strict';
// T3d sweep D: incidents, maintenance, monitoring, operations and system
// operations copy must render from the `ui.*` catalog. Each test mounts a real
// component, checks the Spanish source text and then switches the shipped
// runtime to `en`, so a hard-coded literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

async function withLocales(s, root, pair) {
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  pair.es(textContent(root));
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  pair.en(textContent(root));
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
}

test('T3d system operations renders its sections from the catalog', async () => {
  const s = setup();
  const operations = s.mount('SystemOperations', { app: s.app });
  await s.settle();
  await withLocales(s, operations.root, {
    es: (copy) => {
      assert.match(copy, /Estado del despliegue/, 'the Spanish lead is unchanged');
      assert.match(copy, /Sistema/, 'the Spanish heading is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /System/, 'the English heading is shown');
      assert.doesNotMatch(copy, /Estado del despliegue|Instalación/, 'no Spanish copy leaks into English');
    }
  });
  assert.deepEqual(s.errors, []);
  operations.unmount();
});
