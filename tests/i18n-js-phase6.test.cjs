'use strict';
// Sweep M: the Phase 6 adapter validates the attachment file name on the client
// and must report that failure in the active locale.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function inLocale(s, tag, run) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
  return run();
}

test('the attachment file-name failure follows the active locale', async () => {
  const s = setup();
  try {
    await inLocale(s, 'es', async () => {
      const es = await s.app.uploadAssetAttachment('', { name: '' });
      assert.equal(es.ok, false);
      assert.equal(es.error, 'Selecciona un archivo con nombre.');
    });
    await inLocale(s, 'en', async () => {
      const en = await s.app.uploadAssetAttachment('', { name: '' });
      assert.equal(en.ok, false);
      assert.equal(en.error, 'Select a file with a name.');
    });
    await inLocale(s, 'es', async () => {
      const back = await s.app.uploadAssetAttachment('', { name: '' });
      assert.equal(back.error, 'Selecciona un archivo con nombre.', 'the Spanish source copy returns');
    });
  } finally {
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
