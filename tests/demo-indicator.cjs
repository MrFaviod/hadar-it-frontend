'use strict';
// Demo installation identity (spec S8): the server envelope is the only
// authority. The browser keeps the flag in reactive session state, clears it
// with the rest of the identity and never persists it. This file covers the
// session lifecycle and the static shell wiring; the authenticated rendered
// journey still belongs to the browser seam check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function envelope(extra) {
  return Object.assign({
    user: { id: 'user-1', username: 'demo.owner', name: 'Responsable', active: true, roleId: 'superadmin' },
    permissions: ['assets.view'],
    csrfToken: 'csrf-1',
    sessionMinutes: 480
  }, extra || {});
}

function state() {
  return {
    users: [{ id: 'user-1', username: 'demo.owner', name: 'Responsable', active: true, roleId: 'superadmin' }],
    roles: [{ id: 'superadmin', name: 'Superadministrador' }],
    sessionMinutes: 480
  };
}

function reply(body, status) {
  return { ok: status === undefined || status === 200, status: status || 200, json: async () => body };
}

function recorder() {
  const calls = [];
  return {
    calls,
    getItem() { return null; },
    setItem(key, value) { calls.push(['setItem', key, String(value)]); },
    removeItem(key) { calls.push(['removeItem', key]); }
  };
}

function load(handler) {
  const localStorage = recorder();
  const sessionStorage = recorder();
  const sandbox = {
    window: {
      AssetStore: { KEYS: {} },
      location: { hash: '#/panel' },
      localStorage,
      sessionStorage,
      setTimeout,
      clearTimeout,
      fetch: handler
    },
    AbortController,
    TextDecoder,
    Promise,
    JSON,
    Error,
    String,
    Number,
    Object,
    Array
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/access.js'), 'utf8'), sandbox);
  return { access: sandbox.window.AssetAccess, localStorage, sessionStorage };
}

function app(access, overrides) {
  const instance = Object.assign({}, access.data(), {
    route: { name: 'panel' },
    parseRoute: () => ({ name: 'panel' }),
    hashFor: () => '#/panel',
    ensureHash() {},
    syncAccess() {},
    showToast() {}
  }, overrides || {});
  Object.keys(access.methods).forEach(name => { instance[name] = access.methods[name]; });
  return instance;
}

function writes(rec) {
  return rec.calls.filter(call => call[0] === 'setItem').length;
}

test('a marked installation puts the reactive demo flag into the authenticated shell', async (t) => {
  const { access, localStorage, sessionStorage } = load(async (url) => {
    if (url.endsWith('/auth/me')) return reply(envelope({ demoMode: true }));
    if (url.endsWith('/identity/state')) return reply(state());
    throw new Error('unexpected request ' + url);
  });
  const instance = app(access);
  t.after(() => access.stop(instance));
  assert.equal(instance.demoMode, false);
  access.start(instance);
  await instance.accessReady;
  assert.equal(instance.authenticated, true);
  assert.equal(instance.demoMode, true);
  assert.equal(writes(localStorage), 0);
  assert.equal(writes(sessionStorage), 0);
});

test('legacy payloads that never carry the flag stay ordinary installations', async (t) => {
  const { access } = load(async (url) => {
    if (url.endsWith('/auth/me')) return reply(envelope());
    return reply(state());
  });
  const instance = app(access);
  t.after(() => access.stop(instance));
  access.start(instance);
  await instance.accessReady;
  assert.equal(instance.authenticated, true);
  assert.equal(instance.demoMode, false);
});

test('only the boolean true enables the notice', async (t) => {
  for (const forged of ['true', '1', 1, {}, [], 'yes', null, 0]) {
    const { access } = load(async (url) => {
      if (url.endsWith('/auth/me')) return reply(envelope({ demoMode: forged }));
      return reply(state());
    });
    const instance = app(access);
    t.after(() => access.stop(instance));
    access.start(instance);
    await instance.accessReady;
    assert.equal(instance.demoMode, false, 'demoMode accepted ' + JSON.stringify(forged));
  }
});

test('logout clears the demo flag with the rest of the identity', async (t) => {
  const { access, localStorage, sessionStorage } = load(async (url, init) => {
    if (url.endsWith('/auth/logout')) {
      assert.equal(init.method, 'POST');
      return reply({ status: 'ok' });
    }
    if (url.endsWith('/auth/me')) return reply(envelope({ demoMode: true }));
    return reply(state());
  });
  const instance = app(access);
  t.after(() => access.stop(instance));
  access.start(instance);
  await instance.accessReady;
  assert.equal(instance.demoMode, true);
  assert.equal(await instance.logout(), true);
  assert.equal(instance.authenticated, false);
  assert.equal(instance.demoMode, false);
  assert.equal(instance.route.name, 'login');
  assert.equal(writes(localStorage), 0);
  assert.equal(writes(sessionStorage), 0);
});

test('an expired session clears the demo flag instead of keeping a stale notice', async (t) => {
  let expired = false;
  const { access } = load(async (url) => {
    if (expired) return reply({ error: { code: 'unauthorized', message: 'authentication required' } }, 401);
    if (url.endsWith('/auth/me')) return reply(envelope({ demoMode: true }));
    return reply(state());
  });
  const instance = app(access);
  t.after(() => access.stop(instance));
  access.start(instance);
  await instance.accessReady;
  assert.equal(instance.demoMode, true);
  expired = true;
  assert.equal(await instance.checkAccessSession(), false);
  assert.equal(instance.authenticated, false);
  assert.equal(instance.demoMode, false);
  assert.equal(instance.route.name, 'login');
});

test('a fresh start never reuses a demo flag from the previous identity', async (t) => {
  const { access } = load(async (url) => {
    if (url.endsWith('/auth/me')) return reply(envelope());
    return reply(state());
  });
  const instance = app(access, { demoMode: true });
  t.after(() => access.stop(instance));
  access.start(instance);
  await instance.accessReady;
  assert.equal(instance.demoMode, false);
});

test('the authenticated shell renders the factual Spanish demo notice and nothing else', () => {
  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shell = template.indexOf('class="app-shell"');
  const main = template.indexOf('<main id="main-content"');
  const notice = /<p\b[^>]*v-if="demoMode"[^>]*>[\s\S]*?<\/p>/.exec(template);
  assert.ok(shell !== -1 && main > shell, 'the authenticated shell must own the notice');
  assert.ok(notice, 'index.html must bind the notice to demoMode');
  assert.ok(notice.index > shell && notice.index < main, 'the notice belongs between the shell header and the page content');
  assert.match(notice[0], /Modo demostración/);
  assert.doesNotMatch(notice[0], /no envía|bloquea|alertas|producción/i, 'the notice must not claim unverified outbound guarantees');
  const css = fs.readFileSync(path.join(root, 'assets/css/app.css'), 'utf8');
  assert.match(css, /\.demo-notice\s*\{/);
  assert.match(css, /\.demo-notice__dot\s*\{/);
});
