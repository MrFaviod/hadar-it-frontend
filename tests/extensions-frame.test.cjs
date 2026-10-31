'use strict';
// The isolated frame is the only place where an extension module's own code may
// run. Its host bridge accepts a closed message set from its own frame only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, evaluate, digest } = require('./extensions-support.cjs');

const EXTENSION_ID = 'license';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function env() {
  const sandbox = createSandbox();
  sandbox.window.location.origin = 'https://itsm.example';
  sandbox.window.fetch = async () => ({ ok: true, status: 200, text: async () => 'ok' });
  evaluate(sandbox, 'assets/js/extension-frame.js');
  return sandbox;
}

function fixture(options) {
  const sandbox = env();
  const posts = [];
  const sizes = [];
  const navigations = [];
  const requests = [];
  const frame = sandbox.window.document.createElement('iframe');
  frame.contentWindow = {
    postMessage(payload, origin) {
      posts.push({ payload, origin });
    }
  };
  const item = {
    id: EXTENSION_ID,
    operations: [{ name: 'list_licenses' }, { name: 'revoke_license' }],
    pages: [{ id: 'licencias' }],
    permissions: [{ code: 'ext_license.read' }]
  };
  const bridge = sandbox.window.ExtensionFrame.bridge(Object.assign({
    frame,
    item,
    component: 'LicensePanel',
    asset: { id: 'a-1', name: 'Servidor', nested: { tags: ['produccion'] } },
    permissions: ['ext_license.read'],
    getTheme: () => ({ '--paper': '#ffffff' }),
    onHeight: (height) => sizes.push(height),
    navigate: (page) => navigations.push(page),
    sdk: {
      id: EXTENSION_ID,
      request(operation, args) {
        requests.push({ operation, args });
        return Promise.resolve({ items: [{ id: 'lic-1' }] });
      }
    }
  }, options || {}));
  return { sandbox, frame, bridge, posts, sizes, navigations, requests };
}

function event(frame, data, source) {
  return { source: source === undefined ? frame.contentWindow : source, data };
}

test('bridge announces the exact sandbox and CSP the host builds', () => {
  const { sandbox } = fixture();
  const frameApi = sandbox.window.ExtensionFrame;
  assert.equal(frameApi.SANDBOX, 'allow-scripts');
  assert.match(frameApi.CSP, /default-src 'none'/);
  assert.match(frameApi.CSP, /connect-src 'none'/);
  assert.doesNotMatch(frameApi.SANDBOX, /allow-same-origin/);
  const doc = frameApi.buildDocument({
    extensionId: EXTENSION_ID,
    component: 'LicensePanel',
    vueSource: 'window.Vue = {};',
    moduleSource: 'window.ITSMExtension.register({components:{LicensePanel:{template:"<p>x</p>"}}});',
    theme: { '--paper': '#ffffff' }
  });
  assert.match(doc, /<iframe|<!DOCTYPE html>/i);
  assert.match(doc, /sandbox-document/);
  assert.match(doc, /connect-src 'none'/);
  assert.match(doc, /--paper: #ffffff/);
});

test('buildDocument cannot be escaped by a module that closes the script tag', () => {
  const { sandbox } = fixture();
  const doc = sandbox.window.ExtensionFrame.buildDocument({
    extensionId: EXTENSION_ID,
    component: 'LicensePanel',
    vueSource: '/* vue */',
    moduleSource: 'var a = 1;</script><script>window.pwned = true;</script>',
    theme: {}
  });
  assert.doesNotMatch(doc, /<\/script><script>window\.pwned/);
  assert.match(doc, /window\.pwned/);
});

test('bridge ignores messages from a foreign source and malformed payloads', () => {
  const { bridge, frame, posts } = fixture();
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:ready' }, {})), false);
  assert.equal(bridge.handleMessage({ data: { type: 'itsm:ready' } }), false);
  assert.equal(bridge.handleMessage(event(frame, 'text')), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:init' })), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request' })), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:resize', height: 'large' })), false);
  assert.equal(posts.length, 0);
});

test('ready answers with init and theme for this extension only', () => {
  const { bridge, frame, posts } = fixture();
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:ready' })), true);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].payload.type, 'itsm:init');
  assert.equal(posts[0].payload.extensionId, EXTENSION_ID);
  assert.equal(posts[0].payload.component, 'LicensePanel');
  assert.deepEqual(plain(posts[0].payload.asset), { id: 'a-1', name: 'Servidor', nested: { tags: ['produccion'] } });
  assert.deepEqual(plain(posts[0].payload.permissions), ['ext_license.read']);
  assert.equal(posts[1].payload.type, 'itsm:theme');
  assert.deepEqual(plain(posts[1].payload.theme), { '--paper': '#ffffff' });
  assert.equal(posts[0].origin, '*', 'the frame has an opaque origin, so only * can reach it');
});

test('request bridge forwards only operations declared by this extension', async () => {
  const { bridge, frame, posts, requests } = fixture();
  bridge.handleMessage(event(frame, { type: 'itsm:ready' }));
  posts.length = 0;
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r1', operation: 'core_sql', args: {} })), false);
  assert.equal(requests.length, 0, 'undeclared operations never reach the SDK');
  assert.equal(posts.length, 0);

  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r2', operation: 'list_licenses', args: { limit: 5 } })), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plain(requests[0]), { operation: 'list_licenses', args: { limit: 5 } });
  const response = posts.find((entry) => entry.payload.type === 'itsm:response');
  assert.deepEqual(plain(response.payload), { type: 'itsm:response', id: 'r2', ok: true, data: { items: [{ id: 'lic-1' }] } });
});

test('failed operations answer with a bounded Spanish error and never leak a stack', async () => {
  const { bridge, frame, posts } = fixture();
  bridge.handleMessage(event(frame, { type: 'itsm:ready' }));
  posts.length = 0;
  bridge.sdk.request = () => Promise.reject(new Error('La licencia no existe.'));
  bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r3', operation: 'revoke_license', args: { licenseId: 'x' } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const response = posts.find((entry) => entry.payload.type === 'itsm:response');
  assert.equal(response.payload.ok, false);
  assert.match(response.payload.error, /La licencia no existe\./);
  assert.doesNotMatch(String(response.payload.error), /at |\n/);
});

test('bridge caps concurrent requests and rejects malformed ones', async () => {
  const { bridge, frame, posts } = fixture();
  bridge.handleMessage(event(frame, { type: 'itsm:ready' }));
  posts.length = 0;
  const pending = [];
  bridge.sdk.request = () => new Promise((resolve) => pending.push(resolve));
  for (let index = 0; index < 25; index += 1) {
    bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r' + index, operation: 'list_licenses', args: {} }));
  }
  assert.equal(bridge.state.pending.size, 20, 'at most 20 requests stay in flight');
  const rejected = posts.filter((entry) => entry.payload.type === 'itsm:response' && entry.payload.ok === false);
  assert.equal(rejected.length, 5);
  pending.forEach((resolve) => resolve({ items: [] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bridge.state.pending.size, 0);

  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'bad id', operation: 'list_licenses' })), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r9', operation: 'list_licenses', args: [1] })), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:request', id: 'r9', operation: 'list_licenses', args: 'x' })), false);
});

test('bridge clamps resize, validates navigation and stops after dispose', () => {
  const { bridge, frame, sizes, navigations, posts } = fixture();
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:ready' })), true);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:resize', height: 100000 })), true);
  assert.equal(sizes[0], 2400);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:resize', height: 10 })), true);
  assert.equal(sizes[1], 160);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:navigate', page: 'licencias' })), true);
  assert.deepEqual(plain(navigations), ['licencias']);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:navigate', page: 'https://evil.example' })), false);
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:navigate', page: 'otra' })), false);
  posts.length = 0;
  bridge.dispose();
  assert.equal(bridge.handleMessage(event(frame, { type: 'itsm:ready' })), false);
  assert.equal(posts.length, 0);
});

test('loadSources revalidates the same-origin digest URL before fetching', async () => {
  const sandbox = env();
  const fetched = [];
  sandbox.window.fetch = async (url, init) => {
    fetched.push({ url, init });
    return { ok: true, status: 200, text: async () => 'module' };
  };
  const good = 'https://itsm.example/api/v1/extensions/license/frontend.js?digest=' + digest('b');
  const sources = await sandbox.window.ExtensionFrame.loadSources({ frontendUrl: good });
  assert.equal(sources.moduleSource, 'module');
  assert.match(fetched[0].url, /\/assets\/vendor\/vue\.global\.prod\.js$/);
  assert.equal(fetched[1].init.credentials, 'same-origin');
  assert.equal(fetched[1].init.redirect, 'error');

  await assert.rejects(() => sandbox.window.ExtensionFrame.loadSources({ frontendUrl: 'https://evil.example/api/v1/extensions/license/frontend.js?digest=' + digest('b') }), /misma origen|same-origin/i);
  await assert.rejects(() => sandbox.window.ExtensionFrame.loadSources({ frontendUrl: 'https://itsm.example/api/v1/extensions/license/frontend.js?digest=short' }), /digest|firma/i);
  await assert.rejects(() => sandbox.window.ExtensionFrame.loadSources({ frontendUrl: 'https://itsm.example/api/v1/assets/frontend.js?digest=' + digest('b') }), /ruta|path/i);
});
