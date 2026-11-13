'use strict';
// The setup client decides whether this installation may be claimed. A wrong
// answer either hides the wizard or offers a claim on a live instance, so each
// transport outcome is pinned here: 200 enabled, 200 disabled, 404, 5xx,
// network failure and timeout. client.ts imports nothing, so the native
// TypeScript loader can require it directly; the module cache is cleared for
// every case because the CSRF token is module state on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SOURCE = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'client.ts'));

function load(fetchImpl, globals = {}) {
  delete require.cache[SOURCE];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  Object.assign(globalThis, globals);
  try {
    return require(SOURCE);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

function reply(status, body, { throwOnJson = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (throwOnJson) throw new SyntaxError('not json');
      return body;
    },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

const STATUS = {
  state: 'unclaimed', mode: 'dev', release_mode: 'dev', setup_enabled: true,
  claim_available: true, backend: 'ok', version: '0.1.0', instance_id: 'abc',
};

function calls() {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return reply(200, STATUS);
  };
  return { seen, fetchImpl };
}

test('a 200 with setup enabled and a claim available is the only first install', async () => {
  const { seen, fetchImpl } = calls();
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const result = await client.getStatus();
  assert.equal(result.kind, 'setup-available');
  assert.equal(result.status.state, 'unclaimed');
  assert.equal(result.status.setup_enabled, true);
  assert.equal(result.status.instance_id, 'abc');
  assert.equal(seen[0].url, '/api/setup/v1/status');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.equal(seen[0].init.cache, 'no-store');
});

test('a 200 with setup disabled is an existing instance, never a first install', async () => {
  const fetchImpl = async () => reply(200, { ...STATUS, setup_enabled: false, claim_available: false });
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const result = await client.getStatus();
  assert.equal(result.kind, 'existing-instance');
  assert.equal(result.reason, 'disabled');
});

test('a 200 already claimed or complete is an existing instance', async () => {
  for (const state of ['claimed', 'complete']) {
    const fetchImpl = async () => reply(200, { ...STATUS, state, claim_available: false });
    const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
    const result = await client.getStatus();
    assert.equal(result.kind, 'existing-instance', state);
    assert.equal(result.reason, 'state', state);
  }
});

test('a 404 means the stack has no setup service, not a claimable install', async () => {
  const fetchImpl = async () => reply(404, { detail: 'Not Found' });
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  assert.deepEqual({ ...(await client.getStatus()) }, { kind: 'existing-instance', reason: 'absent', status: null });
});

test('a 5xx from the edge is unavailability and never offers a claim', async () => {
  for (const status of [500, 502, 503, 504]) {
    const fetchImpl = async () => reply(status, '<html>bad gateway</html>');
    const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
    const result = await client.getStatus();
    assert.equal(result.kind, 'unavailable', String(status));
    assert.equal(result.reason, 'server', String(status));
    assert.equal(result.httpStatus, status);
  }
});

test('a network failure is unavailability, not a first install', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const result = await client.getStatus();
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.reason, 'network');
});

test('a slow probe times out and aborts the request instead of hanging the boot', async () => {
  let aborted = false;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
  });
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 20 });
  const started = Date.now();
  const result = await client.getStatus();
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.reason, 'timeout');
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000, 'the probe must not wait for the browser default');
});

test('a 200 that is not the documented status shape is unavailability', async () => {
  for (const body of [{ hello: 'world' }, [STATUS], 'unclaimed', { state: 'unclaimed' }]) {
    const fetchImpl = async () => reply(200, body);
    const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
    const result = await client.getStatus();
    assert.equal(result.kind, 'unavailable', JSON.stringify(body));
    assert.equal(result.reason, 'invalid', JSON.stringify(body));
  }
});

test('claim posts the credential once, keeps the CSRF token in memory and sends it on the next write', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return reply(200, { state: 'claimed', csrf_token: 'csrf-1' });
  };
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const result = await client.claim('one-time-secret');
  assert.equal(result.ok, true);
  assert.equal(client.csrfToken(), 'csrf-1');
  assert.equal(seen[0].url, '/api/setup/v1/claim');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(JSON.parse(seen[0].init.body).credential, 'one-time-secret');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  assert.equal(seen[0].init.headers['X-CSRF-Token'], undefined, 'the claim itself carries no session token');
  await client.claim('second');
  assert.equal(seen[1].init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(load(async () => reply(200, {})).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 }).csrfToken(), null,
    'a new client starts without a token: it never comes from storage');
});

test('claim reports invalid credentials, lockout and unavailable service separately', async () => {
  const cases = [
    [401, { detail: 'invalid credential', attempts_remaining: 3 }, 'invalid', 3],
    [422, { detail: 'invalid credential', attempts_remaining: 1 }, 'invalid', 1],
    [400, { detail: 'invalid credential' }, 'invalid', null],
    [423, { detail: 'locked' }, 'locked', null],
    [429, { detail: 'too many attempts' }, 'locked', null],
    [503, { detail: 'setup unavailable' }, 'unavailable', null],
  ];
  for (const [status, body, code, attempts] of cases) {
    const fetchImpl = async () => reply(status, body);
    const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
    const result = await client.claim('secret');
    assert.equal(result.ok, false, String(status));
    assert.equal(result.code, code, String(status));
    assert.equal(result.attemptsRemaining, attempts, String(status));
  }
});

test('claim distinguishes a transport failure and a timeout from a rejected credential', async () => {
  const offlineImpl = async () => { throw new TypeError('Failed to fetch'); };
  const offline = load(offlineImpl).createSetupClient({ fetch: offlineImpl, timeoutMs: 50 });
  assert.equal((await offline.claim('secret')).code, 'network');
  const hangingImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const hanging = load(hangingImpl).createSetupClient({ fetch: hangingImpl, timeoutMs: 20 });
  assert.equal((await hanging.claim('secret')).code, 'timeout');
});

test('claim without a csrf token in the response is a broken response, not a success', async () => {
  const fetchImpl = async () => reply(200, { state: 'claimed' });
  const client = load(fetchImpl).createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const result = await client.claim('secret');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-response');
  assert.equal(client.csrfToken(), null);
});

test('session reads the claimed state and treats a denial as no session', async () => {
  const ok = async () => reply(200, { state: 'claimed', mode: 'dev', release_mode: 'dev', checks: { ai: 'pending' } });
  const client = load(ok).createSetupClient({ fetch: ok, timeoutMs: 50 });
  const session = await client.getSession();
  assert.equal(session.ok, true);
  assert.equal(session.session.state, 'claimed');
  assert.deepEqual(session.session.checks, { ai: 'pending' });

  for (const status of [401, 403, 404]) {
    const denied = async () => reply(status, { detail: 'no session' });
    const probe = load(denied).createSetupClient({ fetch: denied, timeoutMs: 50 });
    const result = await probe.getSession();
    assert.equal(result.ok, false, String(status));
    assert.equal(result.reason, 'denied', String(status));
  }
});

test('entry decision mounts the wizard only on an explicit claim or a live setup session', async () => {
  const seen = [];
  const enabled = async (url) => { seen.push(String(url)); return reply(200, STATUS); };
  const first = load(enabled).createSetupClient({ fetch: enabled, timeoutMs: 50 });
  const decision = await load(enabled).resolveEntry(first, { timeoutMs: 50 });
  assert.equal(decision.view, 'wizard');
  assert.equal(decision.session, null);
  assert.deepEqual(seen, ['/api/setup/v1/status'], 'a claimable install needs no session probe');

  const reload = [];
  const claimed = async (url) => {
    reload.push(String(url));
    if (String(url).endsWith('/status')) return reply(200, { ...STATUS, state: 'claimed', claim_available: false });
    return reply(200, { state: 'claimed', mode: 'dev', release_mode: 'dev', checks: {} });
  };
  const client = load(claimed).createSetupClient({ fetch: claimed, timeoutMs: 50 });
  const kept = await load(claimed).resolveEntry(client, { timeoutMs: 50 });
  assert.equal(kept.view, 'wizard');
  assert.equal(kept.session.state, 'claimed');
  assert.deepEqual(reload, ['/api/setup/v1/status', '/api/setup/v1/session']);

  const denied = async (url) => String(url).endsWith('/session')
    ? reply(401, { detail: 'no session' })
    : reply(200, { ...STATUS, state: 'complete', claim_available: false });
  const installed = await load(denied).resolveEntry(load(denied).createSetupClient({ fetch: denied, timeoutMs: 50 }), { timeoutMs: 50 });
  assert.deepEqual({ ...installed }, { view: 'legacy', reason: 'installed' });

  const gone = async () => reply(404, { detail: 'Not Found' });
  const absent = await load(gone).resolveEntry(load(gone).createSetupClient({ fetch: gone, timeoutMs: 50 }), { timeoutMs: 50 });
  assert.deepEqual({ ...absent }, { view: 'legacy', reason: 'installed' });

  const down = async () => reply(503, { detail: 'unavailable' });
  const unavailable = await load(down).resolveEntry(load(down).createSetupClient({ fetch: down, timeoutMs: 50 }), { timeoutMs: 50 });
  assert.deepEqual({ ...unavailable }, { view: 'legacy', reason: 'unavailable' });
});
