'use strict';
// Sweep M: the reports adapter rejects a template save, a job read and a report
// generation on the client. Those fallbacks belong to the catalog, so they follow
// the active locale while the server message stays untouched.
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

test('report adapter fallbacks follow the active locale', async () => {
  const s = setup();
  const can = s.app.can;
  s.c.fetch = async () => json({ job: { id: 'job-1', status: 'failed', errors: [{ code: 'render' }] } });
  try {
    await inLocale(s, 'es', async () => {
      s.app.can = (permission) => permission !== 'assets.edit';
      const denied = await s.app.phase9SaveTemplate({ id: '', name: 'Reporte' });
      assert.equal(denied.ok, false);
      assert.equal(denied.error, 'No tienes permisos para editar plantillas.');
      s.app.can = can;
      const unnamed = await s.app.phase9SaveTemplate({ id: '', name: '   ' });
      assert.equal(unnamed.error, 'Indica un nombre para la plantilla.');
      await s.app.phase9LoadJob('job-1');
      assert.deepEqual(s.app.phase9.activeJob.job.errors, ['Error del trabajo.']);
    });
    await inLocale(s, 'en', async () => {
      s.app.can = (permission) => permission !== 'assets.edit';
      const denied = await s.app.phase9SaveTemplate({ id: '', name: 'Report' });
      assert.equal(denied.error, 'You cannot edit report templates.');
      s.app.can = can;
      const unnamed = await s.app.phase9SaveTemplate({ id: '', name: '   ' });
      assert.equal(unnamed.error, 'Enter a template name.');
      await s.app.phase9LoadJob('job-1');
      assert.deepEqual(s.app.phase9.activeJob.job.errors, ['Job error.']);
    });
    await inLocale(s, 'es', async () => {
      const unnamed = await s.app.phase9SaveTemplate({ id: '', name: '   ' });
      assert.equal(unnamed.error, 'Indica un nombre para la plantilla.', 'the Spanish source copy returns');
    });
  } finally {
    s.app.can = can;
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
