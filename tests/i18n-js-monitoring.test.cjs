'use strict';
// Sweep M: the monitoring adapter validates writes and labels notification
// targets on the client. Those messages belong to the catalog and must follow the
// active locale without touching the server message.
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

const json = (payload) => ({ ok: true, status: 200, json: async () => payload, blob: async () => new Blob([]) });

test('monitoring adapter copy follows the active locale', async () => {
  const s = setup();
  s.c.fetch = async () => json({ state: 'pending', outboxId: 'outbox-1' });
  try {
    await inLocale(s, 'es', async () => {
      assert.equal((await s.app.updateMonitoringAsset('', {})).error, 'Falta el activo que se quiere supervisar.');
      assert.equal((await s.app.silenceMonitoringAlert('alert-1', {})).error, 'El silencio necesita un motivo.');
      assert.equal((await s.app.saveMonitoringWindow({})).error, 'La ventana necesita un nombre.');
      assert.equal(s.app.notificationRecipientLabel(''), 'Sin destinatario');
      await s.app.testNotificationChannel('channel-1');
      assert.equal(s.app.lastToast, 'Prueba en cola para channel-1. El resultado no confirma la entrega.');
    });
    await inLocale(s, 'en', async () => {
      assert.equal((await s.app.updateMonitoringAsset('', {})).error, 'The asset to monitor is missing.');
      assert.equal((await s.app.silenceMonitoringAlert('alert-1', {})).error, 'A silence needs a reason.');
      assert.equal((await s.app.saveMonitoringWindow({})).error, 'The window needs a name.');
      assert.equal(s.app.notificationRecipientLabel(''), 'No recipient');
      await s.app.testNotificationChannel('channel-1');
      assert.equal(s.app.lastToast, 'Test queued for channel-1. The result does not confirm delivery.');
    });
    await inLocale(s, 'es', async () => {
      assert.equal(s.app.notificationRecipientLabel(''), 'Sin destinatario', 'the Spanish source copy returns');
    });
  } finally {
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
