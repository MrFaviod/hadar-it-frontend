'use strict';
// A session check that was in flight when the user logged out must not sign
// the user back in when it resolves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function jsonResponse(body, status) {
  return { ok: status === undefined || status < 400, status: status || 200, json: async () => body };
}

test('a logout during the initial session check is not undone by the late response', async () => {
  const me = deferred();
  const session = { user: { id: 'u1', active: true, username: 'ana', roleId: 'r1' }, csrfToken: 't', permissions: [] };
  const win = {
    ItsmI18n: { t: (key) => key, clearSession() {}, applySession() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState() {} },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout, AbortController,
    fetch: async (url) => {
      if (url === '/api/v1/auth/me') return me.promise;
      if (url === '/api/v1/auth/logout') return jsonResponse({}, 200);
      if (url === '/api/v1/identity/state') return jsonResponse({ users: [], roles: [], sessionMinutes: 30 });
      return jsonResponse({}, 404);
    }
  };
  const context = vm.createContext({ window: win, console, setTimeout, clearTimeout, AbortController, URL, URLSearchParams });
  for (const file of ['access.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS, file), 'utf8'), context, { filename: file });
  }
  const access = win.AssetAccess;
  const app = Object.assign({}, access.methods, access.data(), {
    route: { name: 'home' }, parseRoute: () => ({ name: 'home' }), ensureHash() {}, hashFor: () => '#/',
    showToast() {}, people: [], syncAccess() { return true; }
  });
  app.accessRoute = () => ({ name: 'home' });
  access.start(app);
  await app.logout();
  me.resolve(jsonResponse(session));
  await app.accessReady;
  assert.equal(app.authenticated, false, 'the late session must not restore the signed-in state');
});
