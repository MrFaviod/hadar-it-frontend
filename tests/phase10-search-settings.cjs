'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function settings(request) {
  const c = vm.createContext({ AbortController, window: { AssetAccess: { request } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/search-views.js'), 'utf8'), c);
  const component = c.window.AssetSearchViews.SearchSettings;
  assert.ok(component, 'Search administration is available within existing settings');
  const instance = { ...component.data(), app: { authenticated: true, activeUserId: 'admin', can: () => true } };
  for (const [name, method] of Object.entries(component.methods)) instance[name] = method.bind(instance);
  return { component, instance };
}
test('index administration reports denial without queued success or stale status', async () => {
  const requests = [];
  const { instance } = settings(async (_app, url) => {
    requests.push(url);
    if (url === '/search/status') return { configured: true, available: true, pending: 2 };
    throw new Error('Permiso denegado');
  });
  await instance.refresh();
  assert.equal(instance.status.pending, 2);
  await instance.submit('rebuild');
  assert.equal(instance.error, 'Permiso denegado');
  assert.equal(instance.feedback, '');
  assert.equal(instance.busy, false);
  instance.app.can = () => false;
  await instance.submit('sync');
  assert.equal(requests.length, 2, 'No request is sent without current presentation permission');
});
test('settings clear aborts pending status and drops another account response', async () => {
  let resolve, signal;
  const { instance } = settings((_app, _url, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  const pending = instance.refresh();
  instance.app.activeUserId = 'reader';
  instance.clear();
  resolve({ configured: true, available: true, pending: 5 });
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(instance.status, null);
  assert.equal(instance.error, '');
  assert.equal(instance.feedback, '');
});
