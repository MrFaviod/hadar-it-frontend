'use strict';
// The three capabilities the wizard gained last: the agent section's linked
// provider record, the declared backup policy with the origin/session apply
// that reports what the environment overrides and what needs a restart, and
// the installation organization name in appearance.
//
// The rules pinned here are the ones the page depends on: ``declared`` is its
// own status (never a pass), a declaration travels as action ``declare`` with
// confirm, an apply receipt's provenance is read as data (env wins, named),
// and a status the client did not ask for is never painted as success.
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

function claimedClient(routes) {
  const { seen, fetchImpl } = harness({
    'POST /api/setup/v1/claim': { status: 200, body: { state: 'claimed', csrf_token: 'csrf-1' } },
    ...routes,
  });
  const client = load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  return { client, seen };
}

const DECLARATION = {
  target: 's3://hadar-backups/prod',
  location_kind: 'object_storage',
  schedule: 'daily 02:00 UTC',
  retention: '30 days',
  responsible: 'platform team',
};

const DECLARED = {
  section: 'operational',
  required: true,
  postponable: false,
  status: 'declared',
  receipt: {
    backup_policy: {
      target: DECLARATION.target,
      location_kind: 'object_storage',
      schedule: DECLARATION.schedule,
      retention: DECLARATION.retention,
      responsible: DECLARATION.responsible,
      declared_by: 'owner',
      declared_at: '2026-01-02T03:04:05Z',
      source: 'declaration',
    },
  },
};

const OPERATIONAL_READ = {
  section: 'operational',
  required: true,
  postponable: false,
  status: 'declared',
  actions: ['apply', 'postpone'],
  current: {
    origin: 'https://assets.example.com',
    cookie_secure: true,
    worker: 'running',
    settings: {
      auth_origin: { value: 'https://assets.example.com', source: 'env', overridden_by: 'ITSM_AUTH_ORIGIN' },
      auth_session_minutes_default: { value: 60, source: 'installation', overridden_by: null },
    },
    restart_required: true,
    restart_scope: ['backend', 'worker'],
    note: 'restart the backend and the worker',
    backup_policy: DECLARED.receipt.backup_policy,
  },
  proposed: null,
  receipt: null,
};

const APPLIED = {
  section: 'operational',
  required: true,
  postponable: false,
  status: 'applied',
  receipt: {
    source: 'installation_file',
    written: ['auth_origin', 'auth_cookie_secure'],
    effective: {
      auth_origin: { value: 'https://env.example.com', source: 'env', overridden_by: 'ITSM_AUTH_ORIGIN' },
      auth_cookie_secure: { value: true, source: 'installation', overridden_by: null },
    },
    overridden_by: ['ITSM_AUTH_ORIGIN'],
    restart_required: true,
    restart_scope: ['backend', 'worker'],
    note: 'values take effect after a restart',
  },
};

test('a declaration travels as action declare and keeps the status declared', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/operational/apply': { status: 200, body: DECLARED },
  });
  await client.claim('one-time-secret');
  const result = await client.declareSection('operational', {
    item: 'backup_policy_declared',
    ...DECLARATION,
  }, true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'declared');
  assert.equal(result.receipt.operational.backupPolicy.target, DECLARATION.target);
  assert.equal(result.receipt.operational.backupPolicy.retention, '30 days');
  const post = seen.find((entry) => entry.url.endsWith('/configuration/operational/apply'));
  const body = JSON.parse(post.init.body);
  assert.equal(body.action, 'declare');
  assert.equal(body.confirm, true);
  assert.equal(body.values.item, 'backup_policy_declared');
  assert.equal(body.values.location_kind, 'object_storage');
});

test('a declaration without the explicit confirmation never leaves the client', async () => {
  const { client, seen } = claimedClient({});
  await client.claim('one-time-secret');
  const result = await client.declareSection('operational', { item: 'backup_policy_declared' }, false);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirm_required');
  assert.deepEqual(seen.filter((entry) => entry.url.endsWith('/apply')), []);
});

test('a declaration answered with another status is refused, not shown as success', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/operational/apply': {
      status: 200,
      body: { ...DECLARED, status: 'passed' },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.declareSection('operational', { item: 'backup_policy_declared' }, true);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
});

test('the operational read-back keeps the declaration and the settings provenance', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/configuration/operational': { status: 200, body: OPERATIONAL_READ },
  });
  await client.claim('one-time-secret');
  const result = await client.getSection('operational');

  assert.equal(result.ok, true);
  assert.equal(result.section.status, 'declared');
  assert.equal(result.section.current.restart_required, true);
  assert.deepEqual(result.section.current.restart_scope, ['backend', 'worker']);
  assert.deepEqual(result.section.operational.effective, [
    { key: 'auth_origin', value: 'https://assets.example.com', source: 'env', overriddenBy: 'ITSM_AUTH_ORIGIN' },
    { key: 'auth_session_minutes_default', value: '60', source: 'installation', overriddenBy: null },
  ]);
  assert.equal(result.section.operational.restartRequired, true);
  assert.deepEqual(result.section.operational.restartScope, ['backend', 'worker']);
  assert.equal(result.section.operational.backupPolicy.declaredBy, 'owner');
  assert.equal(result.section.operational.backupPolicy.schedule, DECLARATION.schedule);
  assert.equal(result.section.operational.note, 'restart the backend and the worker');
});

test('applying origin settings reports the effective value, the env override and the restart', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/configuration/operational/apply': { status: 200, body: APPLIED },
  });
  await client.claim('one-time-secret');
  const result = await client.applySection('operational', {
    auth_origin: 'https://assets.example.com',
    auth_cookie_secure: true,
  }, true);

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'applied');
  assert.deepEqual(result.receipt.operational.overriddenBy, ['ITSM_AUTH_ORIGIN']);
  assert.equal(result.receipt.operational.restartRequired, true);
  assert.deepEqual(result.receipt.operational.restartScope, ['backend', 'worker']);
  assert.deepEqual(result.receipt.operational.effective[0], {
    key: 'auth_origin',
    value: 'https://env.example.com',
    source: 'env',
    overriddenBy: 'ITSM_AUTH_ORIGIN',
  });
  const post = seen.find((entry) => entry.url.endsWith('/configuration/operational/apply'));
  assert.equal(JSON.parse(post.init.body).action, 'apply');
});

test('an appearance preview carries the normalized organization name', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/appearance': {
      status: 200,
      body: {
        section: 'appearance',
        status: 'preview',
        required: true,
        postponable: false,
        current: { preset: 'generic', organizationName: null },
        proposed: { preset: 'generic', organizationName: 'Hadar IT' },
        changes: [{ field: 'organizationName', from: null, to: 'Hadar IT' }],
        preview_only: true,
        env_override: [],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.previewSection('appearance', { organizationName: '  Hadar   IT ' });

  assert.equal(result.ok, true);
  assert.equal(result.preview.proposed.organizationName, 'Hadar IT');
  assert.deepEqual(result.preview.changes, [{ field: 'organizationName', from: null, to: 'Hadar IT' }]);
});

test('a declared checklist item is kept apart from a pass', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/verify': {
      status: 200,
      body: {
        state: 'verifying',
        checklist: [
          {
            id: 'backup_policy_declared',
            section: 'operational',
            required: true,
            postponable: false,
            status: 'declared',
            evidence: 'declared: s3://hadar-backups/prod daily 02:00 UTC',
            blocking: false,
            acceptedRisk: false,
          },
        ],
        blocking: [],
        acceptedRisk: [],
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.verify();

  assert.equal(result.ok, true);
  assert.equal(result.checklist.items[0].status, 'declared');
  assert.equal(result.checklist.items[0].blocking, false);
});

test('the agent section carries the provider record flag, live and in the receipt', async () => {
  const live = claimedClient({
    'GET /api/setup/v1/configuration/agent': {
      status: 200,
      body: {
        section: 'agent',
        required: true,
        postponable: false,
        status: 'passed',
        actions: ['apply'],
        current: { provider: 'openai', model: 'gpt-5', provider_record: true },
        proposed: null,
        receipt: null,
      },
    },
  });
  await live.client.claim('one-time-secret');
  const read = await live.client.getSection('agent');
  assert.equal(read.section.current.provider_record, true);

  const applied = claimedClient({
    'POST /api/setup/v1/configuration/agent/apply': {
      status: 200,
      body: {
        section: 'agent',
        required: true,
        postponable: false,
        status: 'passed',
        receipt: {
          provider: 'openai',
          model: 'gpt-5',
          credential_configured: true,
          provider_record: false,
          latency_ms: 120,
        },
      },
    },
  });
  await applied.client.claim('one-time-secret');
  const appliedResult = await applied.client.applySection('agent', { provider: 'openai', model: 'gpt-5' }, true);
  assert.equal(appliedResult.receipt.receipt.provider_record, false);
});

test('a status outside the contract is still refused', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/configuration/operational/apply': {
      status: 200,
      body: { ...DECLARED, status: 'declared_at' },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.declareSection('operational', { item: 'backup_policy_declared' }, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
});
