'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(request) {
  const clicks = [];
  const context = { setTimeout: fn => { fn(); return 0; }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { createElement: () => ({ click() { clicks.push('saved'); } }),
      body: { appendChild() {}, removeChild() {} } },
    ItsmI18n: { t: key => 'localized:' + key }, AssetAccess: { request } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('assets/js/phase9-api.js', 'utf8'), context);
  const methods = context.AssetPhase9.methods;
  const app = { authenticated: true, can: () => true,
    phase9: { download: { id: '', loading: false, error: '' } },
    phase9Token: () => 'owned', phase9TokenOpen: () => true };
  app.phase9Result = methods.phase9Result.bind(app);
  return { app, clicks, download: methods.phase9DownloadDocument.bind(app) };
}

test('download network exception uses the localized request error and saves nothing', async () => {
  const s = setup(async () => { throw new TypeError('Failed to fetch'); });
  const result = await s.download({ id: 'doc' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'localized:ui.errors.request_failed');
  assert.equal(s.app.phase9.download.error, result.error);
  assert.equal(s.app.phase9.download.loading, false);
  assert.deepEqual(s.clicks, []);
});

test('download preserves actionable HTTP errors instead of replacing their copy', async () => {
  const s = setup(async () => { throw Object.assign(new Error('Document no longer available'), { status: 404 }); });
  const result = await s.download({ id: 'doc' });
  assert.equal(result.error, 'Document no longer available');
  assert.equal(s.app.phase9.download.loading, false);
  assert.deepEqual(s.clicks, []);
});

test('successful download still saves one blob and clears loading', async () => {
  const s = setup(async () => ({ type: 'application/pdf' }));
  const result = await s.download({ id: 'doc', name: 'report.pdf' });
  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(s.app.phase9.download.error, '');
  assert.equal(s.app.phase9.download.loading, false);
  assert.deepEqual(s.clicks, ['saved']);
});
