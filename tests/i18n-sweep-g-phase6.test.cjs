'use strict';
// S3/S10 sweep G, Phase 6: import/export transfer, bulk editor, warranty
// surfaces and attachments render their copy from `ui.phase6.*`. Spanish stays
// byte-for-byte; a locale switch changes the module vocabulary too, including
// the late failure messages resolved by the adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');

const ROOT = path.join(__dirname, '..');

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

async function inLocale(s, tag, run) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
  return run();
}

const ASSET = { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Router', quickCode: 'RT-01' };

const CASES = [
  { name: 'Phase6DataTransfer', props: {}, es: /Importación y exportación/, en: /Import and export/, esAction: /Analizar archivo/, enAction: /Analyze file/ },
  { name: 'Phase6BulkEditor', props: { open: true, ids: [] }, es: /Los campos no seleccionados conservan su valor/, en: /Unselected fields keep their value/, esAction: /Previsualizar/, enAction: /Preview/ },
  { name: 'Phase6WarrantyCenter', props: {}, es: /Los vencimientos se calculan con los datos guardados en el servidor/, en: /Expiry dates are computed from the data stored on the server/, esAction: /Próximas a vencer/, enAction: /Expiring soon/ },
  { name: 'Phase6WarrantySettings', props: {}, es: /Aviso de vencimiento próximo/, en: /Upcoming expiry notice/, esAction: /Guardar preferencia/, enAction: /Save preference/ },
  { name: 'Phase6AssetWarranty', props: { asset: ASSET }, es: /Garantía individual/, en: /Individual warranty/, esAction: /Registrar garantía/, enAction: /Record warranty/ },
  { name: 'Phase6Attachments', props: { asset: ASSET }, es: /Adjuntos del activo/, en: /Asset attachments/, esAction: /Categoría documental/, enAction: /Document category/ }
];

for (const item of CASES) {
  test(`${item.name} renders Spanish first and English after a switch`, async () => {
    const s = setup();
    const view = s.mount(item.name, Object.assign({ app: s.app }, item.props));
    await s.settle();
    const spanish = textOf(view.root);
    assert.match(spanish, item.es, 'the Spanish source copy is unchanged');
    assert.match(spanish, item.esAction, 'the Spanish source action is unchanged');

    const english = await inLocale(s, 'en', () => textOf(view.root));
    assert.match(english, item.en, 'the English copy is shown');
    assert.match(english, item.enAction, 'the English action is shown');
    assert.doesNotMatch(english, item.es, 'no Spanish copy leaks into English');
    assert.doesNotMatch(english, item.esAction, 'no Spanish action leaks into English');

    const back = await inLocale(s, 'es', () => textOf(view.root));
    assert.match(back, item.es, 'the source copy returns after the switch');
    assert.deepEqual(s.errors, [], 'the component mounted without runtime errors');
    view.unmount();
  });
}

test('the Phase 6 vocabulary follows a locale switch after mount', async () => {
  const s = setup();
  const view = s.mount('Phase6DataTransfer', { app: s.app });
  await s.settle();
  assert.equal(view.instance.stateLabel('preview'), 'Previsualización');
  assert.equal(view.instance.classLabel('possible_duplicate'), 'Posible duplicado');
  assert.equal(view.instance.coverageLabel('expiring'), 'Próximas a vencer');
  assert.equal(view.instance.exportFieldLabel('serial'), 'Número de serie');
  assert.equal(view.instance.matchFieldLabel('ip'), 'IP');

  await inLocale(s, 'en', () => {});
  assert.equal(view.instance.stateLabel('preview'), 'Preview', 'the state label switches with the locale');
  assert.equal(view.instance.classLabel('possible_duplicate'), 'Possible duplicate');
  assert.equal(view.instance.coverageLabel('expiring'), 'Expiring soon');
  assert.equal(view.instance.exportFieldLabel('serial'), 'Serial number');

  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the Phase 6 sources carry no hard-coded copy', () => {
  const views = fs.readFileSync(path.join(ROOT, 'assets/js/phase6-views.js'), 'utf8');
  assert.ok(views.includes("$t('ui.phase6.transfer.title')"), 'the transfer title reads a catalog key');
  assert.ok(views.includes("tr('ui.phase6.warranty.saved')"), 'the warranty toast reads a catalog key');
  assert.ok(!views.includes('Garantías individuales'), 'the old Spanish title literal is gone');
  assert.ok(!views.includes('Cargar más garantías'), 'the old Spanish action literal is gone');

  const api = fs.readFileSync(path.join(ROOT, 'assets/js/phase6-api.js'), 'utf8');
  assert.ok(api.includes("tr('ui.phase6.error.request_failed')"), 'the adapter resolves its fallback error per locale');
  assert.ok(!api.includes('No se pudo completar la solicitud.'), 'the module-load Spanish constant is gone');
  assert.ok(!/const FALLBACK_ERROR/.test(api), 'no frozen fallback copy remains');
});
