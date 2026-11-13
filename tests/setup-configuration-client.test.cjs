'use strict';
// Configuration transport for the wizard, pinned against the payloads the
// backend serves (tests/test_setup_configuration.py is the source of these
// bodies). The rules here are the ones the UI depends on: ``values`` is a
// dict, a preview never mutates, apply/postpone/accept_risk all travel to
// /apply with an explicit action and confirm, a refused confirm never leaves
// the client, a postponement is never a pass, and verify's 409 keeps the
// observed checklist. Server prose and unknown codes are dropped, never
// rendered.
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

/** One checklist item exactly as checklist.build_checklist emits it. */
function item(id, overrides = {}) {
  return {
    id,
    section: 'appearance',
    required: false,
    postponable: false,
    status: 'passed',
    evidence: 'observed by the service',
    blocking: false,
    acceptedRisk: false,
    ...overrides,
  };
}

const SECTION = {
  section: 'appearance',
  required: true,
  postponable: false,
  status: 'passed',
  actions: ['apply'],
  current: { preset: 'blue', previous: null, builtinIds: ['generic', 'forest', 'blue'] },
  proposed: null,
  receipt: { active_id: 'blue', source: 'apply_preset' },
  prose: 'internal note that must never reach the page',
};

test('startConfiguration posts once and parses state and mode', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration': {
      status: 200,
      body: { state: 'configuring', mode: 'dev', sections: [SECTION] },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.startConfiguration();

  assert.equal(result.ok, true);
  assert.equal(result.state, 'configuring');
  assert.equal(result.mode, 'dev');
  assert.equal(result.sections, undefined);
  const post = seen.find((entry) => entry.url.endsWith('/configuration'));
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.body, undefined);
});

test('the overview keeps sections, checklist and the decision lists', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration': {
      status: 200,
      body: {
        state: 'configuring',
        mode: 'dev',
        sections: [{ section: 'appearance', required: true, postponable: false, status: 'passed', actions: ['apply'] }],
        checklist: [
          item('appearance_decided', { status: 'passed', evidence: 'active appearance blue' }),
          item('smtp', {
            section: 'notifications',
            required: false,
            postponable: true,
            status: 'postponed',
            evidence: 'postponed by the operator',
          }),
        ],
        blocking: [],
        acceptedRisk: [],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.getOverview();

  assert.equal(result.ok, true);
  assert.equal(result.overview.state, 'configuring');
  assert.equal(result.overview.mode, 'dev');
  assert.deepEqual(result.overview.sections, [
    { section: 'appearance', required: true, postponable: false, status: 'passed', actions: ['apply'] },
  ]);
  assert.equal(result.overview.checklist.items.length, 2);
  assert.equal(result.overview.checklist.items[1].status, 'postponed');
  assert.deepEqual(result.overview.blocking, []);
});

test('getSection reads the section record and drops unknown fields', async () => {
  const { client, seen } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': { status: 200, body: SECTION },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('appearance');

  assert.equal(result.ok, true);
  assert.deepEqual(result.section, {
    section: 'appearance',
    required: true,
    postponable: false,
    status: 'passed',
    actions: ['apply'],
    current: { preset: 'blue', previous: null, builtinIds: ['generic', 'forest', 'blue'] },
    proposed: null,
    receipt: { active_id: 'blue', source: 'apply_preset' },
    currentUnavailable: false,
  });
  const read = seen.find((entry) => entry.url.endsWith('/configuration/appearance'));
  assert.equal(read.init.method, 'GET');
  assert.equal(read.init.body, undefined);
});

test('a section whose live value could not be read keeps only the record', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/operational': {
      status: 200,
      body: {
        section: 'operational',
        required: true,
        postponable: false,
        status: 'pending',
        actions: ['apply'],
        current: null,
        proposed: null,
        receipt: null,
        currentUnavailable: true,
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('operational');

  assert.equal(result.ok, true);
  assert.equal(result.section.current, null);
  assert.equal(result.section.currentUnavailable, true);
});

test('preview posts values to the section route and parses the diff', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/appearance': {
      status: 200,
      body: {
        section: 'appearance',
        status: 'preview',
        required: true,
        postponable: false,
        current: { preset: 'generic' },
        proposed: { preset: 'forest' },
        changes: [{ field: 'preset', from: 'generic', to: 'forest' }],
        preview_only: true,
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.previewSection('appearance', { preset: 'forest' });

  assert.equal(result.ok, true);
  assert.equal(result.preview.status, 'preview');
  assert.equal(result.preview.previewOnly, true);
  assert.deepEqual(result.preview.proposed, { preset: 'forest' });
  assert.deepEqual(result.preview.changes, [{ field: 'preset', from: 'generic', to: 'forest' }]);
  const post = seen.find((entry) => entry.url.endsWith('/configuration/appearance'));
  assert.deepEqual(JSON.parse(post.init.body), { values: { preset: 'forest' } });
});

test('a preview that claims to have applied is rejected as invalid', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/appearance': {
      status: 200,
      body: {
        section: 'appearance',
        status: 'passed',
        required: true,
        postponable: false,
        current: { preset: 'generic' },
        proposed: { preset: 'forest' },
        changes: [{ field: 'preset', from: 'generic', to: 'forest' }],
        preview_only: false,
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.previewSection('appearance', { preset: 'forest' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
});

test('apply travels to /apply with action apply and the confirmed values', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/appearance/apply': {
      status: 200,
      body: {
        section: 'appearance',
        required: true,
        postponable: false,
        status: 'passed',
        receipt: { active_id: 'blue', source: 'apply_preset' },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('appearance', { preset: 'blue' }, true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'passed');
  assert.deepEqual(result.receipt.receipt, { active_id: 'blue', source: 'apply_preset' });
  const post = seen.find((entry) => entry.url.endsWith('/configuration/appearance/apply'));
  assert.deepEqual(JSON.parse(post.init.body), {
    values: { preset: 'blue' },
    action: 'apply',
    confirm: true,
  });
});

test('an unconfirmed apply is refused before any request leaves the client', async () => {
  const { client, seen } = claimedClient({});
  await client.claim('one-time-secret');
  const result = await client.applySection('appearance', { preset: 'blue' }, false);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirm_required');
  assert.equal(seen.length, 1);
});

test('the service refusal for a missing confirmation keeps its own code', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/appearance/apply': {
      status: 422,
      body: { error: 'confirmation_required' },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('appearance', { preset: 'blue' }, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirm_required');
});

test('a revoked permission is reported as permission_denied, not an expired session', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/appearance/apply': {
      status: 403,
      body: { error: 'permission_denied' },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('appearance', { preset: 'blue' }, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
});

test('postpone is an apply action and only a postponed answer is accepted', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/notifications/apply': {
      status: 200,
      body: {
        section: 'notifications',
        required: false,
        postponable: true,
        status: 'postponed',
        receipt: { status: 'postponed', reason: 'no smtp host yet', postponed_at: '2026-11-13T10:00:00Z' },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.postponeSection('notifications', true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'postponed');
  const post = seen.find((entry) => entry.url.endsWith('/configuration/notifications/apply'));
  assert.deepEqual(JSON.parse(post.init.body), { values: {}, action: 'postpone', confirm: true });
});

test('postpone hides a passed answer: a write that applied is not a postponement', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/monitoring/apply': {
      status: 200,
      body: {
        section: 'monitoring',
        required: false,
        postponable: true,
        status: 'passed',
        receipt: { active_id: 'default' },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.postponeSection('monitoring', true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
});

test('accept_risk is a recorded production decision and never a pass', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/operational/apply': {
      status: 200,
      body: {
        section: 'operational',
        required: true,
        postponable: false,
        status: 'risk',
        receipt: {
          status: 'risk',
          item: 'backup_policy_declared',
          reason: 'single host demo',
          accepted_at: '2026-11-13T10:00:00Z',
        },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.acceptRisk('operational', 'backup_policy_declared', 'single host demo', true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'risk');
  assert.equal(result.receipt.status === 'passed', false);
  const post = seen.find((entry) => entry.url.endsWith('/configuration/operational/apply'));
  assert.deepEqual(JSON.parse(post.init.body), {
    values: { item: 'backup_policy_declared', reason: 'single host demo' },
    action: 'accept_risk',
    confirm: true,
  });
});

test('accept_risk is refused without the explicit confirm', async () => {
  const { client, seen } = claimedClient({});
  await client.claim('one-time-secret');
  const result = await client.acceptRisk('operational', 'backup_policy_declared', '', false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirm_required');
  assert.equal(seen.length, 1);
});

test('verify success parses the flat checklist and its own mode', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: {
        state: 'verifying',
        ready: true,
        mode: 'dev',
        checklist: [
          item('appearance_decided', { status: 'passed', evidence: 'active appearance blue' }),
          item('session_valid', { required: true, status: 'not_required', evidence: 'not required in dev' }),
        ],
        blocking: [],
        acceptedRisk: [],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();

  assert.equal(result.ok, true);
  assert.equal(result.state, 'verifying');
  assert.equal(result.checklist.mode, 'dev');
  assert.equal(result.checklist.items.length, 2);
  assert.equal(result.checklist.items[1].status, 'not_required');
});

test('a refused verify keeps the observed blocking checklist', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 409,
      body: {
        error: 'verification_blocked',
        state: 'configuring',
        ready: false,
        mode: 'dev',
        checklist: [
          item('ai_explicit', { section: 'agent', required: true, status: 'pending', evidence: 'no verified agent provider recorded', blocking: true }),
          item('worker_ready', { section: 'operational', required: true, status: 'failed', evidence: 'queue refused the probe', blocking: true }),
          item('appearance_decided', { status: 'passed', evidence: 'active appearance blue' }),
        ],
        blocking: ['ai_explicit', 'worker_ready'],
        acceptedRisk: [],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'verification_blocked');
  assert.deepEqual(result.checklist.blocking, ['ai_explicit', 'worker_ready']);
  assert.deepEqual(result.checklist.items.filter((entry) => entry.blocking).map((entry) => entry.id), [
    'ai_explicit',
    'worker_ready',
  ]);
});

test('an accepted risk is visible in the checklist and does not block', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: {
        state: 'verifying',
        ready: true,
        mode: 'prod',
        checklist: [
          item('backup_policy_declared', {
            section: 'operational',
            required: true,
            status: 'risk',
            evidence: 'accepted risk: single host demo',
            blocking: false,
            acceptedRisk: true,
          }),
        ],
        blocking: [],
        acceptedRisk: ['backup_policy_declared'],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();

  assert.equal(result.ok, true);
  assert.equal(result.checklist.items[0].status, 'risk');
  assert.equal(result.checklist.items[0].acceptedRisk, true);
  assert.deepEqual(result.checklist.acceptedRisk, ['backup_policy_declared']);
});

test('a checklist without items is a broken answer, never a green verification', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: { state: 'verifying', ready: true, mode: 'dev', checklist: [], blocking: [], acceptedRisk: [] },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
});

test('transport failures stay network/timeout and never invent a state', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/appearance': () => { throw new Error('offline'); },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('appearance');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'network');
});
