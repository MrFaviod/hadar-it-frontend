'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(fetch) {
  const timers = new Map(); let id = 0;
  const window = { fetch, AssetStore: { KEYS: {} }, setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key) };
  const sandbox = { window, AbortController, Date, Promise, Number, Math, String, JSON, Error, Object, Array };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../assets/js/access.js'), 'utf8'), sandbox);
  const component = window.AssetAccess.DemoCountdown;
  assert.ok(component, 'the authenticated shell exposes a countdown component');
  const state = Object.assign({}, component.data());
  for (const [key, fn] of Object.entries(component.methods)) state[key] = fn.bind(state);
  return { component, state, timers };
}

test('remaining time comes from the server clock, not the browser clock', async () => {
  const { component, state, timers } = load(async () => ({ ok: true, json: async () => ({ enabled: true, serverTime: '2000-01-01T00:00:00Z', nextResetAt: '2000-01-01T00:42:05Z', generation: 1, resetting: false }) }));
  await state.refresh();
  assert.equal(component.computed.label.call(state), 'Reinicio en 42:05');
  assert.equal(timers.size, 1);
  component.beforeUnmount.call(state);
  assert.equal(timers.size, 0);
  assert.equal(state.controller.signal.aborted, true);
});

test('local ticks interpolate a server sample without spending one request per second', async () => {
  let requests = 0;
  const { component, state, timers } = load(async () => { requests += 1; return { ok: true, json: async () => ({ enabled: true, serverTime: '2000-01-01T00:00:00Z', nextResetAt: '2000-01-01T00:01:00Z' }) }; });
  await state.refresh();
  for (let i = 0; i < 14; i++) { state.tick(); }
  assert.equal(requests, 1);
  assert.equal(component.computed.label.call(state), 'Reinicio en 0:46');
  component.beforeUnmount.call(state);
});

test('an unavailable or malformed deadline is never replaced by an invented hour', async () => {
  const { component, state } = load(async () => ({ ok: true, json: async () => ({ enabled: true, serverTime: 'invalid', nextResetAt: 'invalid' }) }));
  await state.refresh();
  assert.equal(component.computed.label.call(state), 'Próximo reinicio no disponible');
  component.beforeUnmount.call(state);
});

test('unmount ignores a late server response and does not restart polling', async () => {
  let release;
  const { component, state, timers } = load(() => new Promise(resolve => { release = resolve; }));
  const pending = state.refresh();
  component.beforeUnmount.call(state);
  release({ ok: true, json: async () => ({ enabled: true, serverTime: '2000-01-01', nextResetAt: '2000-01-02' }) });
  await pending;
  assert.equal(state.remainingSeconds, null);
  assert.equal(timers.size, 0);
});
