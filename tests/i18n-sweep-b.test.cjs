'use strict';
// S3/S10 sweep B: inventory, catalog, forms, transfer, warranty, labels and
// Phase 6 surfaces render their copy from the catalog. Spanish stays the
// source, so each case asserts the original Spanish first and then the same
// component in English without a remount.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./i18n-sweep-b-harness.cjs');

const ROOT = path.join(__dirname, '..');

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

async function withView(name, run) {
  const harness = open();
  await harness.c.ItsmI18n.ready;
  const view = harness.mount(name, { app: harness.app });
  try {
    await settle(harness);
    await run(harness, view, textOf(view.root));
  } finally {
    view.unmount();
  }
}

function switchLocale(harness, tag) {
  harness.c.ItsmI18n.setLocale(tag);
  return settle(harness);
}

test('S3 catalog field library renders English and keeps the Spanish source', async () => {
  await withView('AssetFieldsPanel', async (harness, view, spanish) => {
    assert.match(spanish, /Biblioteca de campos/);
    await switchLocale(harness, 'en');
    const english = textOf(view.root);
    assert.match(english, /Field library/);
    assert.doesNotMatch(english, /Biblioteca de campos/);
  });
});

test('S3 asset editor copy is catalog-backed', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/asset-editor.js'), 'utf8');
  assert.match(source, /t\('ui\.asset\.editor\./);
  assert.doesNotMatch(source, /'Registrar activo'/);
  assert.doesNotMatch(source, /'Opcional · único en el inventario'/);
});

test('S3 warranty settings render English and keep the Spanish source', async () => {
  await withView('WarrantySettings', async (harness, view, spanish) => {
    assert.match(spanish, /Preferencias de garantías/);
    await switchLocale(harness, 'en');
    const english = textOf(view.root);
    assert.match(english, /Warranty preferences/);
    assert.doesNotMatch(english, /Preferencias de garantías/);
  });
});

test('S3 the assigned index.html sweep B regions are catalog-backed', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inventory = slice(html, '<section v-else-if="route.name === \'inventory\'" class="page"', '<monitoring-center v-else-if=');
  const detail = slice(html, 'route.name === \'detail\' && currentAsset', '<!-- Diálogo de acceso remoto -->');
  const dialogs = slice(html, '<!-- Diálogo de acceso remoto -->', '<!-- Estructura física del servidor -->');

  assert.match(inventory, /\$t\('ui\.inventory\.title'\)/);
  assert.match(detail, /\$t\('ui\.asset\.detail\./);
  assert.match(dialogs, /\$t\('ui\.(asset|catalog)\./);
});

function slice(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from !== -1, 'missing start marker ' + start);
  const to = text.indexOf(end, from);
  assert.ok(to !== -1, 'missing end marker ' + end);
  return text.slice(from, to);
}
