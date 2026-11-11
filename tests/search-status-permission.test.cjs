'use strict';
// Reading search status needs config.general. A user without it must not
// trigger a request that the server answers with 403.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'assets', 'js', 'search-views.js');

test('search settings do not request /search/status without config.general', async () => {
  const requests = [];
  const win = {
    ItsmI18n: { t: (key) => key },
    AssetAccess: { request: async (app, url) => { requests.push(url); return {}; } }
  };
  const context = vm.createContext({ window: win, console, AbortController, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  const methods = win.AssetSearchViews.SearchSettings.methods;
  const self = Object.assign({
    status: null, busy: false, error: '', feedback: '', epoch: 0, controller: null,
    app: { activeUserId: 'u1', authenticated: true, can: () => false }
  }, methods);
  await self.load();
  assert.deepEqual(requests, [], 'no status request without the permission');
  assert.equal(self.busy, false);
});
