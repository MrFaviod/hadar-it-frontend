'use strict';
// A wizard tab left open on an earlier step goes stale the moment the
// installation is finished somewhere else: the service answers every setup
// call with 409 {"error": "setup_complete"}. The client is the one place that
// notices it, so no step has to map that code itself and the page can move to
// the completed screen instead of the generic "unavailable" it would show for
// any other refusal. The refusal never reaches the page: it is one closed
// signal, and no server prose travels with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = require.resolve(path.join(ROOT, 'src', 'setup', 'client.ts'));

function load() {
  delete require.cache[SOURCE];
  return require(SOURCE);
}

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

// One route per test: the path suffix decides the answer, and every request is
// recorded so a test can prove a refused call happened exactly once.
function harness(status, body) {
  const calls = [];
  const { createSetupClient } = load();
  const client = createSetupClient({
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET' });
      return reply(status, body);
    },
  });
  return { client, calls };
}

const COMPLETE = { error: 'setup_complete' };

test('the client exposes the finished-installation signal', () => {
  const { client } = harness(200, {});
  assert.equal(typeof client.onSetupComplete, 'function');
  const off = client.onSetupComplete(() => {});
  assert.equal(typeof off, 'function');
});

test('a stale tab reading the configuration is told the install is complete', async () => {
  const { client } = harness(409, COMPLETE);
  const seen = [];
  client.onSetupComplete(() => seen.push('complete'));
  const result = await client.getOverview();
  assert.equal(result.ok, false);
  assert.equal(seen.length, 1, 'the completed screen was never triggered');
  // The refusal is a transition, not a diagnosis: no code reaches the page and
  // nothing server-authored is carried along with it.
  assert.notEqual(result.code, 'setup_complete');
  assert.equal('error' in result, false);
});

test('every configuration call carries the same signal', async () => {
  const cases = [
    ['startConfiguration', (client) => client.startConfiguration()],
    ['getOverview', (client) => client.getOverview()],
    ['getSection', (client) => client.getSection('storage')],
    ['previewSection', (client) => client.previewSection('storage', { engine: 'sqlite' })],
    ['applySection', (client) => client.applySection('storage', { engine: 'sqlite' }, true)],
    ['postponeSection', (client) => client.postponeSection('ai', true)],
    ['acceptRisk', (client) => client.acceptRisk('storage', 'backup', 'no backup host', true)],
    ['verify', (client) => client.verify()],
    ['getReport', (client) => client.getReport()],
    ['complete', (client) => client.complete()],
  ];
  for (const [name, call] of cases) {
    const { client } = harness(409, COMPLETE);
    let seen = 0;
    client.onSetupComplete(() => { seen += 1; });
    const result = await call(client);
    assert.equal(result.ok, false, `${name} reported success`);
    assert.equal(seen, 1, `${name} did not signal the finished installation`);
  }
});

test('only 409 setup_complete is the finished installation', async () => {
  const refusals = [
    [409, { error: 'state_refused' }],
    [409, { error: 'verification_blocked', checklist: [] }],
    [500, { error: 'configuration_unavailable' }],
    [403, { error: 'permission_denied' }],
    [401, { error: 'authentication_required' }],
  ];
  for (const [status, body] of refusals) {
    const { client } = harness(status, body);
    let seen = 0;
    client.onSetupComplete(() => { seen += 1; });
    const result = await client.getOverview();
    assert.equal(result.ok, false);
    assert.equal(seen, 0, `${body.error} was mistaken for a finished installation`);
  }
});

test('a successful read is not a completion', async () => {
  const { client } = harness(200, { error: 'setup_complete' });
  let seen = 0;
  client.onSetupComplete(() => { seen += 1; });
  await client.getOverview();
  assert.equal(seen, 0, 'a 200 was read as a completion');
});

test('unsubscribing stops the signal', async () => {
  const { client } = harness(409, COMPLETE);
  let seen = 0;
  const off = client.onSetupComplete(() => { seen += 1; });
  await client.getOverview();
  off();
  await client.getOverview();
  assert.equal(seen, 1);
});

test('a throwing listener cannot hide the refusal from the page', async () => {
  const { client } = harness(409, COMPLETE);
  let seen = 0;
  client.onSetupComplete(() => { throw new Error('listener'); });
  client.onSetupComplete(() => { seen += 1; });
  const result = await client.getOverview();
  assert.equal(result.ok, false);
  assert.equal(seen, 1, 'one listener broke the others');
});

// The page side: one registration, one completed screen. A stale tab must not
// keep a per-step mapping that could drift from the client's.
test('the wizard registers the signal once and lands on the completed screen', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src', 'setup', 'SetupApp.tsx'), 'utf8');
  assert.match(app, /client\.onSetupComplete\(/);
  assert.match(app, /finishCompleted\(null\)/);
  assert.match(app, /completed \|\| state === 'complete'/);
  // No step reads the raw code: the client owns that mapping.
  assert.ok(!/setup_complete/.test(app), 'the page maps setup_complete itself');
});
