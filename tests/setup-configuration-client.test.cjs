'use strict';
// Configuration transport for the wizard. The rules pinned here are the ones
// the UI depends on: every section read answers with an effective value and
// its source, a preview never mutates, an apply is refused unless the operator
// confirmed it, a postponed item stays postponed, and verify answers with the
// checklist plus its observed evidence. Server prose and unknown codes are
// dropped, never rendered.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SOURCE = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'client.ts'));

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

function harness(routes) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const entry = { url: String(url), init };
    seen.push(entry);
    const route = routes[`${init.method} ${entry.url}`];
    if (!route) return reply(404, { error: 'not_found' });
    return typeof route === 'function' ? route(entry) : reply(route.status, route.body);
  };
  return { seen, fetchImpl };
}

const CLAIMED = { status: 200, body: { state: 'claimed', csrf_token: 'csrf-1' } };

function claimedClient(routes) {
  const { seen, fetchImpl } = harness({ 'POST /api/setup/v1/claim': CLAIMED, ...routes });
  const client = load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  return { client, seen };
}

const SECTION = {
  id: 'appearance',
  status: 'applied',
  source: 'installation',
  required: true,
  postponable: false,
  locked: false,
  value: 'claro',
  options: ['claro', 'nocturno'],
  updated_at: '2026-11-13T10:00:00Z',
  prose: 'internal note that must never reach the page',
};

test('startConfiguration posts once and parses the section list', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration': {
      status: 200,
      body: { state: 'configuring', sections: [SECTION] },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.startConfiguration();

  assert.equal(result.ok, true);
  assert.equal(result.state, 'configuring');
  assert.equal(result.sections.length, 1);
  assert.deepEqual(result.sections[0], {
    id: 'appearance',
    status: 'applied',
    source: 'installation',
    required: true,
    postponable: false,
    locked: false,
    value: 'claro',
    options: ['claro', 'nocturno'],
    updatedAt: '2026-11-13T10:00:00Z',
  });
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/configuration');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(call.init.body, undefined, 'starting configuration carries no operator input');
});

test('getSection reads the effective value and source from the envelope', async () => {
  const { client, seen } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': { status: 200, body: { section: SECTION } },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('appearance');

  assert.equal(result.ok, true);
  assert.equal(result.section.value, 'claro');
  assert.equal(result.section.source, 'installation');
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/configuration/appearance');
  assert.equal(call.init.method, 'GET');
});

test('an external value is marked locked and keeps no server prose', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': {
      status: 200,
      body: { section: { ...SECTION, source: 'environment', value: 'nocturno' } },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('appearance');
  assert.equal(result.ok, true);
  assert.equal(result.section.source, 'environment');
  assert.equal(JSON.stringify(result).includes('internal note'), false);
});

test('previewSection posts the proposed value and parses a diff', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/appearance/preview': {
      status: 200,
      body: {
        section: 'appearance',
        value: 'nocturno',
        changes: [{ field: 'theme', from: 'claro', to: 'nocturno' }],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.previewSection('appearance', 'nocturno');

  assert.equal(result.ok, true);
  assert.equal(result.preview.value, 'nocturno');
  assert.deepEqual(result.preview.changes, [{ field: 'theme', from: 'claro', to: 'nocturno' }]);
  const call = seen.at(-1);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { value: 'nocturno' });
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
});

test('applySection refuses to send without an explicit confirm', async () => {
  const { client, seen } = claimedClient({});
  await client.claim('one-time-secret');
  const before = seen.length;
  const result = await client.applySection('appearance', 'nocturno', false);

  assert.deepEqual(result, { ok: false, code: 'confirm_required' });
  assert.equal(seen.length, before, 'an unconfirmed apply must not reach the service');
});

test('applySection sends confirm and parses the read-back receipt', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/appearance/apply': {
      status: 200,
      body: {
        state: 'configuring',
        section: { ...SECTION, status: 'applied', value: 'nocturno' },
        receipt: [{ field: 'theme', value: 'nocturno' }],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('appearance', 'nocturno', true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'applied');
  assert.deepEqual(result.receipt.readback, [{ field: 'theme', value: 'nocturno' }]);
  const call = seen.at(-1);
  assert.deepEqual(JSON.parse(call.init.body), { value: 'nocturno', confirm: true });
});

test('applySection keeps a required-item refusal as a closed code', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/agent/apply': {
      status: 422,
      body: { error: 'item_required', detail: 'agent must be configured' },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('agent', 'x', true);
  assert.deepEqual(result, { ok: false, code: 'item_required' });
});

test('postponeSection only reports postponed when the service says so', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/notifications/postpone': {
      status: 200,
      body: { state: 'configuring', section: { ...SECTION, id: 'notifications', status: 'postponed', postponable: true } },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.postponeSection('notifications');

  assert.equal(result.ok, true);
  assert.equal(result.status, 'postponed');
  assert.equal(seen.at(-1).url, '/api/setup/v1/configuration/notifications/postpone');

  const refused = claimedClient({
    'POST /api/setup/v1/configuration/appearance/postpone': {
      status: 422,
      body: { error: 'not_postponable' },
    },
  });
  await refused.client.claim('one-time-secret');
  assert.deepEqual(await refused.client.postponeSection('appearance'), { ok: false, code: 'not_postponable' });
});

test('verify parses the checklist with observed evidence per item', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: {
        state: 'verifying',
        checklist: {
          mode: 'dev',
          items: [
            {
              id: 'database_ready',
              status: 'passed',
              required: true,
              postponable: false,
              evidence: [{ field: 'query', value: 'select 1' }],
              observed_at: '2026-11-13T10:01:00Z',
            },
            {
              id: 'smtp',
              status: 'postponed',
              required: false,
              postponable: true,
              evidence: [],
            },
          ],
        },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();

  assert.equal(result.ok, true);
  assert.equal(result.state, 'verifying');
  assert.equal(result.checklist.mode, 'dev');
  assert.equal(result.checklist.items.length, 2);
  assert.deepEqual(result.checklist.items[0].evidence, [{ field: 'query', value: 'select 1' }]);
  assert.equal(result.checklist.items[1].status, 'postponed');
  assert.equal(seen.at(-1).init.headers['X-CSRF-Token'], 'csrf-1');
});

test('verify keeps a refused configuration answer with its failed items', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: {
        state: 'configuring',
        checklist: {
          mode: 'dev',
          items: [
            { id: 'worker_ready', status: 'failed', required: true, postponable: false, evidence: [{ field: 'queue', value: '0 workers' }] },
          ],
        },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'configuring');
  assert.equal(result.checklist.items[0].status, 'failed');
});

test('an unknown section status is a broken response, not a green chip', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': {
      status: 200,
      body: { section: { ...SECTION, status: 'ok' } },
    },
  });
  await client.claim('one-time-secret');
  assert.deepEqual(await client.getSection('appearance'), { ok: false, code: 'invalid-response' });
});

test('a checklist without items is a broken response', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': { status: 200, body: { state: 'verifying', checklist: { mode: 'dev' } } },
  });
  await client.claim('one-time-secret');
  assert.deepEqual(await client.verify(), { ok: false, code: 'invalid-response' });
});

test('a setup session that expired is reported, never retried anonymously', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': { status: 403, body: { error: 'setup_session_expired' } },
  });
  await client.claim('one-time-secret');
  assert.deepEqual(await client.getSection('appearance'), { ok: false, code: 'session_expired' });
});

test('a network failure keeps its own code', async () => {
  const client = load().createSetupClient({
    fetch: async (url, init) => {
      if (init.method === 'POST' && String(url).endsWith('/claim')) return reply(200, CLAIMED.body);
      throw new TypeError('offline');
    },
    timeoutMs: 50,
  });
  await client.claim('one-time-secret');
  const result = await client.startConfiguration();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'network');
});
