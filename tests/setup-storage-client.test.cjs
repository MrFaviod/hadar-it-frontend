'use strict';
// Storage preparation and first-owner transport. The wizard sends one database
// URL and one owner password, so the rules pinned here are narrow: the secret
// travels in exactly one POST body, the server's closed classification is the
// only thing rendered (never its prose), the reloaded wizard adopts the session
// CSRF token, and no password survives the call inside the client.
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
  return { client, seen, fetchImpl };
}

const PROBE = {
  reachable: true,
  engine: 'postgresql',
  version: '16.13',
  status: 'empty',
  identity: null,
  adoptable: true,
  guidance: 'internal note: host db-primary.corp resolves behind the proxy',
};

const STORAGE_URL = 'postgresql+psycopg://itsm:s3cret-db@db:5432/itsm';

test('checkStorage posts the candidate URL once and keeps only the closed classification', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/storage/check': { status: 200, body: PROBE },
  });
  await client.claim('one-time-secret');
  const result = await client.checkStorage(STORAGE_URL);

  assert.equal(result.ok, true);
  assert.deepEqual(result.probe, {
    reachable: true,
    engine: 'postgresql',
    version: '16.13',
    classification: 'empty',
    identity: null,
    adoptable: true,
  });
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/storage/check');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'same-origin');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.deepEqual(JSON.parse(call.init.body), { database_url: STORAGE_URL });
  assert.ok(!call.url.includes('s3cret-db'), 'the URL must never ride in a URL');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('guidance'), serialized);
  assert.ok(!serialized.includes('db-primary'), serialized);
  assert.ok(!serialized.includes('s3cret-db'), serialized);
});

test('checkStorage keeps an unreachable probe a probe, without the service text', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/storage/check': {
      status: 200,
      body: {
        reachable: false,
        engine: 'postgresql',
        version: null,
        status: 'unreachable',
        identity: null,
        adoptable: false,
        guidance: 'could not connect to itsm:s3cret-db@127.0.0.1:1',
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.checkStorage(STORAGE_URL);
  assert.equal(result.ok, true);
  assert.equal(result.probe.reachable, false);
  assert.equal(result.probe.classification, 'unreachable');
  assert.equal(result.probe.adoptable, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('could not connect'), serialized);
  assert.ok(!serialized.includes('s3cret-db'), serialized);
});

test('checkStorage maps every refusal to a closed diagnostic code', async () => {
  const cases = [
    [422, 'unsupported_engine', 'unsupported_engine'],
    [409, 'database_not_adoptable', 'database_not_adoptable'],
    [409, 'state_refused', 'state_refused'],
    [422, 'invalid_request', 'invalid_request'],
    [401, 'authentication_required', 'session_expired'],
    [403, 'csrf_invalid', 'session_expired'],
    [503, 'setup unavailable', 'unavailable'],
    [500, 'Traceback: password s3cret-db rejected', 'unavailable'],
  ];
  for (const [status, error, code] of cases) {
    const { client } = claimedClient({
      'POST /api/setup/v1/storage/check': { status, body: { error } },
    });
    await client.claim('one-time-secret');
    const result = await client.checkStorage(STORAGE_URL);
    assert.equal(result.ok, false, error);
    assert.equal(result.code, code, error);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('Traceback'), serialized);
    assert.ok(!serialized.includes('s3cret-db'), serialized);
  }
});

test('checkStorage distinguishes a transport failure from a timeout', async () => {
  const offline = load().createSetupClient({
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    timeoutMs: 50,
  });
  assert.equal((await offline.checkStorage(STORAGE_URL)).code, 'network');

  const hanging = load().createSetupClient({
    fetch: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
    timeoutMs: 20,
  });
  assert.equal((await hanging.checkStorage(STORAGE_URL)).code, 'timeout');
});

test('applyStorage reports what the service did and never retains the URL', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/storage': {
      status: 200,
      body: {
        state: 'storage_ready',
        storage: {
          engine: 'sqlite',
          version: '3.45.1',
          status: 'empty',
          identity: 'dev',
          config_source: 'installation',
          migrated: true,
          identity_claimed: true,
          database_url: 'sqlite:////private/app.db',
        },
        database_url: 'sqlite:////private/app.db',
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applyStorage('sqlite:////private/app.db');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'storage_ready');
  assert.deepEqual(result.storage, {
    engine: 'sqlite',
    version: '3.45.1',
    classification: 'empty',
    identity: 'dev',
    configSource: 'installation',
    migrated: true,
  });
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/storage');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.deepEqual(JSON.parse(call.init.body), { database_url: 'sqlite:////private/app.db' });
  assert.ok(!JSON.stringify(result).includes('/private/app.db'));

  await client.getStatus();
  for (const entry of seen.slice(2)) {
    assert.ok(!JSON.stringify(entry.init).includes('/private/app.db'), entry.url);
  }
});

test('applyStorage keeps an externally provided database read-only and labelled', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/storage': {
      status: 200,
      body: {
        state: 'storage_ready',
        storage: {
          engine: 'postgresql', version: '16.13', status: 'ours', identity: 'dev',
          config_source: 'external', migrated: true, identity_claimed: true,
        },
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.applyStorage(STORAGE_URL);
  assert.equal(result.ok, true);
  assert.equal(result.storage.configSource, 'external');
  assert.equal(result.storage.classification, 'ours');
});

test('applyStorage refuses a foreign database and a broken success body', async () => {
  const refused = claimedClient({
    'POST /api/setup/v1/storage': { status: 409, body: { error: 'database_not_adoptable', guidance: 'operator step' } },
  });
  await refused.client.claim('one-time-secret');
  const blocked = await refused.client.applyStorage(STORAGE_URL);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'database_not_adoptable');
  assert.ok(!JSON.stringify(blocked).includes('operator step'));

  for (const body of [{ state: 'storage_ready' }, { state: 'storage_ready', storage: null }, { storage: {} }]) {
    const broken = claimedClient({ 'POST /api/setup/v1/storage': { status: 200, body } });
    await broken.client.claim('one-time-secret');
    const result = await broken.client.applyStorage(STORAGE_URL);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.code, 'invalid-response', JSON.stringify(body));
  }
});

test('createOwner posts the first owner once and returns a sanitized receipt', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/owner': {
      status: 200,
      body: {
        state: 'owner_ready',
        owner: { username: 'ada', display_name: 'Ada Lovelace', password: 'owner-secret-123' },
        ai: 'pending',
        password: 'owner-secret-123',
      },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.createOwner({
    username: '  ada  ',
    displayName: 'Ada Lovelace',
    email: '',
    password: 'owner-secret-123',
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'owner_ready');
  assert.deepEqual(result.owner, { username: 'ada', displayName: 'Ada Lovelace' });
  assert.equal(result.ai, 'pending');
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/owner');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'same-origin');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.deepEqual(JSON.parse(call.init.body), {
    username: 'ada', display_name: 'Ada Lovelace', password: 'owner-secret-123',
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('owner-secret-123'), serialized);
  assert.ok(!serialized.includes('password'), serialized);
});

test('createOwner includes an optional email only when it is set', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/owner': {
      status: 200,
      body: { state: 'owner_ready', owner: { username: 'ada', display_name: 'Ada' }, ai: 'transferred' },
    },
  });
  await client.claim('one-time-secret');
  await client.createOwner({ username: 'ada', displayName: 'Ada', email: ' ada@example.com ', password: 'owner-secret-123' });
  const body = JSON.parse(seen.at(-1).init.body);
  assert.equal(body.email, 'ada@example.com');
  assert.equal(body.display_name, 'Ada');
});

test('createOwner reports an existing owner separately from a rejected password', async () => {
  const cases = [
    [409, 'owner_exists', 'owner_exists'],
    [409, 'state_refused', 'state_refused'],
    [422, 'invalid_request', 'invalid_request'],
    [401, 'authentication_required', 'session_expired'],
    [500, 'reset token abc123', 'unavailable'],
  ];
  for (const [status, error, code] of cases) {
    const { client } = claimedClient({
      'POST /api/setup/v1/owner': { status, body: { error } },
    });
    await client.claim('one-time-secret');
    const result = await client.createOwner({
      username: 'ada', displayName: 'Ada', password: 'owner-secret-123',
    });
    assert.equal(result.ok, false, error);
    assert.equal(result.code, code, error);
    assert.ok(!JSON.stringify(result).includes('reset token'), String(error));
  }
});

test('no password survives the call: the client keeps only the CSRF token', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/owner': (entry) => {
      const body = JSON.parse(entry.init.body);
      return reply(200, {
        state: 'owner_ready',
        owner: { username: body.username, display_name: body.display_name },
        ai: 'pending',
        password: body.password,
      });
    },
    'GET /api/setup/v1/status': { status: 200, body: { state: 'owner_ready', setup_enabled: true, claim_available: false } },
  });
  await client.claim('one-time-secret');
  await client.createOwner({ username: 'ada', displayName: 'Ada', password: 'first-secret-123' });
  await client.createOwner({ username: 'ada', displayName: 'Ada', password: 'second-secret-456' });

  const ownerBodies = seen
    .filter((entry) => entry.url === '/api/setup/v1/owner')
    .map((entry) => JSON.parse(entry.init.body));
  assert.deepEqual(ownerBodies.map((body) => body.password), ['first-secret-123', 'second-secret-456']);

  const clientText = JSON.stringify(client);
  assert.ok(!clientText.includes('first-secret-123'), clientText);
  assert.ok(!clientText.includes('second-secret-456'), clientText);
  assert.equal(Object.keys(client).some((key) => /pass|secret|url/i.test(key)), false);
  for (const entry of seen) {
    assert.ok(!entry.url.includes('secret'), entry.url);
    assert.ok(!JSON.stringify(entry.init.headers ?? {}).includes('secret'), 'no password may travel in a header');
  }
  await client.getStatus();
  assert.ok(!JSON.stringify(seen.at(-1).init).includes('secret'));
  assert.equal(client.csrfToken(), 'csrf-1');
});

test('getSession refreshes the CSRF token so a reloaded wizard can mutate', async () => {
  const { client, seen } = claimedClient({
    'GET /api/setup/v1/session': {
      status: 200,
      body: { state: 'ai_deferred', mode: 'dev', release_mode: 'dev', checks: [], csrf_token: 'csrf-reloaded' },
    },
    'POST /api/setup/v1/storage': {
      status: 200,
      body: { state: 'storage_ready', storage: { engine: 'sqlite', version: '3', status: 'empty', identity: 'dev', config_source: 'installation', migrated: true } },
    },
  });
  const session = await client.getSession();
  assert.equal(session.ok, true);
  assert.equal(session.session.state, 'ai_deferred');
  assert.equal(client.csrfToken(), 'csrf-reloaded');
  const applied = await client.applyStorage('sqlite:///app.db');
  assert.equal(applied.ok, true);
  assert.equal(seen.at(-1).init.headers['X-CSRF-Token'], 'csrf-reloaded');
});

test('a session without a token never invents one', async () => {
  const { client, seen } = claimedClient({
    'GET /api/setup/v1/session': { status: 200, body: { state: 'storage_ready', mode: 'dev', release_mode: 'dev', checks: [] } },
    'POST /api/setup/v1/owner': {
      status: 200,
      body: { state: 'owner_ready', owner: { username: 'ada', display_name: 'Ada' }, ai: 'pending' },
    },
  });
  const session = await client.getSession();
  assert.equal(session.ok, true);
  assert.equal(client.csrfToken(), null);
  await client.createOwner({ username: 'ada', displayName: 'Ada', password: 'owner-secret-123' });
  assert.equal(seen.at(-1).init.headers['X-CSRF-Token'], undefined);
});

test('the boot decision adopts the session token on reload, before any mutation', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    if (String(url).endsWith('/status')) {
      return reply(200, {
        state: 'ai_deferred', mode: 'dev', release_mode: 'dev', setup_enabled: true,
        claim_available: false, backend: 'unknown', version: '0.1.0', instance_id: 'abc',
      });
    }
    return reply(200, {
      state: 'ai_deferred', mode: 'dev', release_mode: 'dev', checks: [], csrf_token: 'csrf-boot',
    });
  };
  const client = load().createSetupClient({ fetch: fetchImpl, timeoutMs: 50 });
  const decision = await load().resolveEntry(client, { timeoutMs: 50 });
  assert.equal(decision.view, 'wizard');
  assert.equal(decision.session.state, 'ai_deferred');
  assert.equal(client.csrfToken(), 'csrf-boot');
  await client.getSession();
  assert.deepEqual(seen, ['/api/setup/v1/status', '/api/setup/v1/session', '/api/setup/v1/session']);
});
