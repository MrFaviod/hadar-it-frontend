'use strict';
// Completion transport for the wizard. The finish step is a promise to the
// operator: the report preview is sanitized, the confirmation is explicit and
// carries the setup CSRF token, and a 409 setup_complete is the same finished
// installation, not an error. These cases pin the payloads the backend serves
// (tests/test_setup_recovery.py) and the boot decision that never mounts setup
// once the normal API reports installation_complete.
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

const CLAIM = {
  status: 200,
  body: { state: 'verifying', mode: 'production', release_mode: 'production', csrf_token: 'csrf-9' },
};

function claimedClient(routes) {
  const { seen, fetchImpl } = harness({ 'POST /api/setup/v1/claim': CLAIM, ...routes });
  const client = load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  return { client, seen, fetchImpl };
}

// One sanitized report exactly as itsm/setup/completion.build_report emits it,
// plus fields a hostile or buggy service could echo.
const REPORT = {
  contract: 'onboarding/v1',
  setup_contract_version: '1',
  mode: 'production',
  release_mode: 'production',
  state: 'verifying',
  instance_id: 'inst-1',
  owner: { username: 'operator', password: 'hunter2' },
  ai: { status: 'configured', provider: 'openai', model: 'gpt-5', pending: false, api_key: 'sk-live' },
  storage: {
    version: '16', engine: 'postgresql', status: 'ready', identity: 'itms',
    config_source: 'installation', migrated: true, identity_claimed: true,
    password: 'hunter2', database_url: 'postgresql://u:p@host/db',
  },
  checklist: [{
    id: 'setup_enabled', section: null, required: true, postponable: false,
    status: 'passed', evidence: 'observed by the service', blocking: false, acceptedRisk: false,
  }],
  blocking: [],
  acceptedRisk: [],
  verified_at: '2026-01-01T00:00:00+00:00',
  completed_at: null,
  completed_by: null,
  report_digest: null,
  token: 'bearer-1',
  secret: 'shh',
};

test('the report preview is a GET that keeps only the allowlisted fields', async () => {
  const { client, seen } = claimedClient({
    'GET /api/setup/v1/report': { status: 200, body: REPORT },
  });
  const result = await client.getReport();
  assert.equal(result.ok, true);
  assert.equal(seen[0].url, '/api/setup/v1/report');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.equal(seen[0].init.cache, 'no-store');

  const report = result.report;
  assert.equal(report.contract, 'onboarding/v1');
  assert.equal(report.state, 'verifying');
  assert.equal(report.instanceId, 'inst-1');
  assert.equal(report.owner.username, 'operator');
  assert.equal(report.ai.provider, 'openai');
  assert.equal(report.ai.pending, false);
  assert.deepEqual(Object.keys(report.storage).sort(), [
    'configSource', 'engine', 'identity', 'identityClaimed', 'migrated', 'status', 'version',
  ]);
  assert.equal(report.storage.engine, 'postgresql');
  assert.equal(report.checklist.length, 1);
  assert.equal(report.checklist[0].id, 'setup_enabled');
  assert.equal(report.verifiedAt, '2026-01-01T00:00:00+00:00');
});

test('no credential, token or connection string reaches the report object', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/report': { status: 200, body: REPORT },
  });
  const result = await client.getReport();
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.report);
  for (const forbidden of ['password', 'secret', 'api_key', 'apiKey', 'token', 'database_url', 'hunter2', 'sk-live', 'bearer-1']) {
    assert.ok(!serialized.includes(forbidden), `the report kept ${forbidden}`);
  }
});

test('a completed installation answers the report with 409 setup_complete', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/report': { status: 409, body: { error: 'setup_complete' } },
  });
  const result = await client.getReport();
  assert.deepEqual({ ...result }, { ok: false, code: 'setup_complete' });
});

test('a denied report is a session diagnosis, never a finished installation', async () => {
  const { client } = claimedClient({
    'GET /api/setup/v1/report': { status: 401, body: { error: 'authentication_required' } },
  });
  const result = await client.getReport();
  assert.deepEqual({ ...result }, { ok: false, code: 'session_expired' });
});

test('complete is one POST with the setup CSRF token and drops it on success', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/complete': {
      status: 200,
      body: {
        state: 'complete',
        completed_at: '2026-01-01T00:00:00+00:00',
        completed_by: 'operator',
        instance_id: 'inst-1',
        setup_contract_version: '1',
        report_digest: 'a'.repeat(64),
      },
    },
  });
  assert.equal(await client.claim('credential-1').then((r) => r.ok), true);
  const result = await client.complete();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'complete');
  assert.equal(result.reportDigest, 'a'.repeat(64));
  assert.equal(result.instanceId, 'inst-1');
  assert.equal(seen[1].url, '/api/setup/v1/complete');
  assert.equal(seen[1].init.method, 'POST');
  assert.equal(seen[1].init.body, undefined);
  assert.equal(seen[1].init.headers['X-CSRF-Token'], 'csrf-9');
  // The service invalidates the setup session: keeping the token would offer
  // one more mutation the server is guaranteed to refuse.
  assert.equal(client.csrfToken(), null);
});

test('an installation completed elsewhere is a success the UI already knows', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/complete': { status: 409, body: { error: 'setup_complete' } },
  });
  const result = await client.complete();
  assert.deepEqual({ ...result }, { ok: false, code: 'setup_complete' });
});

test('a failed re-verification keeps its own code and writes nothing', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/complete': { status: 409, body: { error: 'completion_blocked' } },
  });
  const result = await client.complete();
  assert.deepEqual({ ...result }, { ok: false, code: 'completion_blocked' });
});

test('a 200 that does not say complete is a broken response', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/complete': { status: 200, body: { state: 'verifying' } },
  });
  const result = await client.complete();
  assert.deepEqual({ ...result }, { ok: false, code: 'invalid-response' });
});

test('a transport failure never reads as completion', async () => {
  const down = async () => { throw new TypeError('offline'); };
  const client = load().createSetupClient({ fetch: down, timeoutMs: 50 });
  assert.deepEqual({ ...(await client.complete()) }, { ok: false, code: 'network' });
  assert.deepEqual({ ...(await client.getReport()) }, { ok: false, code: 'network' });
});

test('the normal API status decides against setup before setup is asked', async () => {
  const routes = {
    'GET /api/v1/health/ready': { status: 200, body: { installation_complete: true, installation_state: 'complete' } },
    'GET /api/setup/v1/status': {
      status: 200,
      body: { state: 'unclaimed', setup_enabled: true, claim_available: true },
    },
  };
  const { seen, fetchImpl } = harness(routes);
  const decision = await load().resolveBoot(
    load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }),
    { timeoutMs: 50 },
  );
  assert.deepEqual({ ...decision }, { view: 'legacy', reason: 'installed' });
  assert.deepEqual(seen.map((entry) => entry.url), ['/api/v1/health/ready']);
});

test('an incomplete installation still reaches the wizard', async () => {
  const routes = {
    'GET /api/v1/health/ready': { status: 200, body: { installation_complete: false, installation_state: 'unclaimed' } },
    'GET /api/setup/v1/status': {
      status: 200,
      body: {
        state: 'unclaimed', mode: 'production', release_mode: 'production', setup_enabled: true,
        claim_available: true, backend: 'ok', version: '0.1.0', instance_id: 'inst-1',
      },
    },
  };
  const { seen, fetchImpl } = harness(routes);
  const decision = await load().resolveBoot(
    load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }),
    { timeoutMs: 50 },
  );
  assert.equal(decision.view, 'wizard');
  assert.deepEqual(seen.map((entry) => entry.url), ['/api/v1/health/ready', '/api/setup/v1/status']);
});

test('setup unreachable on a completed installation still goes to the app', async () => {
  const fetchImpl = async (url) => {
    if (String(url) === '/api/v1/health/ready') {
      return reply(503, { status: 'not_ready', installation_complete: true, installation_state: 'complete' });
    }
    return reply(503, { detail: 'unavailable' });
  };
  const decision = await load().resolveBoot(
    load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }),
    { timeoutMs: 50 },
  );
  assert.deepEqual({ ...decision }, { view: 'legacy', reason: 'installed' });
});

test('a setup status that says complete never mounts the wizard', async () => {
  const routes = {
    'GET /api/v1/health/ready': { status: 404, body: { detail: 'Not Found' } },
    'GET /api/setup/v1/status': {
      status: 200,
      body: {
        state: 'complete', setup_enabled: true, claim_available: true,
        mode: 'production', release_mode: 'production', backend: 'ok', version: '0.1.0', instance_id: 'inst-1',
      },
    },
  };
  const { fetchImpl } = harness(routes);
  const decision = await load().resolveBoot(
    load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }),
    { timeoutMs: 50 },
  );
  assert.deepEqual({ ...decision }, { view: 'legacy', reason: 'installed' });
});

test('an unreachable app status falls back to the setup probe', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url) === '/api/v1/health/ready') throw new TypeError('offline');
    return reply(200, {
      state: 'unclaimed', setup_enabled: true, claim_available: true,
      mode: 'dev', release_mode: 'dev', backend: 'ok', version: '0.1.0', instance_id: 'inst-1',
    });
  };
  const decision = await load().resolveBoot(
    load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }),
    { timeoutMs: 50 },
  );
  assert.equal(decision.view, 'wizard');
});
