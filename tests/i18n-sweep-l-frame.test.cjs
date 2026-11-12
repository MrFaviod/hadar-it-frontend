'use strict';
// Sweep L follow-up: the isolated extension frame renders its own copy inside a
// sandbox with no host i18n instance. The host must resolve every protocol
// error, kit label and in-frame message through the catalog and hand the frame
// the active locale, so a hot language switch reaches the sandbox too.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, evaluate, digest } = require('./extensions-support.cjs');

function env() {
  const sandbox = createSandbox();
  sandbox.window.location.origin = 'https://itsm.example';
  evaluate(sandbox, 'assets/js/extension-frame.js');
  return sandbox;
}

function fixture(options) {
  const sandbox = env();
  const posts = [];
  const frame = sandbox.window.document.createElement('iframe');
  frame.contentWindow = { postMessage(payload) { posts.push(payload); } };
  const bridge = sandbox.window.ExtensionFrame.bridge(Object.assign({
    frame,
    item: { id: 'license', operations: [{ name: 'list_licenses' }], pages: [{ id: 'licencias' }] },
    component: 'LicensePanel',
    permissions: [],
    getTheme: () => ({}),
    sdk: { request: () => Promise.resolve({ items: [] }) }
  }, options || {}));
  return { sandbox, frame, bridge, posts };
}

test('extension frame protocol errors follow the active locale', () => {
  const sandbox = env();
  const frameApi = sandbox.window.ExtensionFrame;
  const binding = { id: 'license', digest: digest() };
  const badPath = () => frameApi.validatedFrontendUrl('https://itsm.example/evil.js', binding);

  sandbox.window.ItsmI18n.setLocale('es');
  assert.throws(badPath, /no es la declarada por el host/);

  sandbox.window.ItsmI18n.setLocale('en');
  assert.throws(badPath, /not the path declared by the host/);
  assert.throws(
    () => frameApi.validatedFrontendUrl('', binding),
    /does not publish a valid frontend module/
  );
});

test('extension frame kit labels come from the catalog', () => {
  const sandbox = env();
  const frameApi = sandbox.window.ExtensionFrame;

  sandbox.window.ItsmI18n.setLocale('es');
  assert.equal(frameApi.frameMessages().emptyTable, 'Sin datos.');
  assert.equal(frameApi.frameMessages().booleanTrue, 'Sí');
  assert.equal(frameApi.frameMessages().booleanFalse, 'No');

  sandbox.window.ItsmI18n.setLocale('en');
  assert.equal(frameApi.frameMessages().emptyTable, 'No data.');
  assert.equal(frameApi.frameMessages().booleanTrue, 'Yes');
  assert.equal(frameApi.frameMessages().booleanFalse, 'No');
  assert.equal(frameApi.frameMessages().invalidOperation, 'The operation is not valid.');
});

test('the sandbox document declares the active locale and embeds the messages', () => {
  const sandbox = env();
  const frameApi = sandbox.window.ExtensionFrame;
  sandbox.window.ItsmI18n.setLocale('en');
  const doc = frameApi.buildDocument({
    vueSource: '/* vue */',
    moduleSource: '/* module */',
    theme: {}
  });
  assert.match(doc, /<html lang="en">/);
  assert.match(doc, /No data\./);
  assert.match(doc, /Loading data…/);
});

test('the bridge posts a localized error to the frame', () => {
  const { sandbox, frame, bridge, posts } = fixture({ sdk: null });
  sandbox.window.ItsmI18n.setLocale('en');
  bridge.handleMessage({ source: frame.contentWindow, data: { type: 'itsm:ready' } });
  assert.equal(bridge.handleMessage({
    source: frame.contentWindow,
    data: { type: 'itsm:request', id: 'r1', operation: 'list_licenses', args: {} }
  }), false);
  const response = posts.filter((payload) => payload.type === 'itsm:response').pop();
  assert.equal(response.ok, false);
  assert.equal(response.error, 'The extension is no longer active.');
});

test('a language switch re-posts the init payload with the new messages', () => {
  const { sandbox, frame, bridge, posts } = fixture();
  bridge.handleMessage({ source: frame.contentWindow, data: { type: 'itsm:ready' } });
  const first = posts.filter((payload) => payload.type === 'itsm:init').pop();
  assert.equal(first.locale, 'es');
  assert.equal(first.messages.emptyTable, 'Sin datos.');

  sandbox.window.ItsmI18n.setLocale('en');
  const second = posts.filter((payload) => payload.type === 'itsm:init').pop();
  assert.equal(second.locale, 'en');
  assert.equal(second.messages.emptyTable, 'No data.');
  assert.equal(second.messages.loadingData, 'Loading data…');

  bridge.dispose();
});
