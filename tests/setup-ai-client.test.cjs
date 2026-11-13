'use strict';
// Transport for the AI step. The wizard handles one provider credential, so
// the rules pinned here are narrow: the key travels in one POST body and
// nowhere else, the response is reduced to the sanitized receipt, and a
// failure becomes a closed diagnostic code rather than server text or an
// echoed upstream message. client.ts imports nothing, so the native TypeScript
// loader can require it directly; the module cache is cleared per case because
// the CSRF token is module state on purpose.
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

const RECEIPT = {
  status: 'configured', provider: 'api.example.com', model: 'gpt-4.1-mini',
  tool: 'get_setup_status', latency_ms: 412, input_tokens: 120, output_tokens: 18,
  pending: false, reason: null, checked_at: '2026-11-13T10:00:00Z', deferred_at: null,
};

test('configureAi posts endpoint, model and key once with the session CSRF token', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/ai': { status: 200, body: { state: 'ai_configured', ai: RECEIPT, discovered_models: 7 } },
  });
  await client.claim('one-time-secret');
  const result = await client.configureAi({ baseUrl: 'https://api.example.com/v1', model: 'gpt-4.1-mini', apiKey: 'sk-live-key' });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ai_configured');
  assert.equal(result.receipt.provider, 'api.example.com');
  assert.equal(result.receipt.model, 'gpt-4.1-mini');
  assert.equal(result.receipt.tool, 'get_setup_status');
  assert.equal(result.receipt.latencyMs, 412);

  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/ai');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'same-origin');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), {
    base_url: 'https://api.example.com/v1', model: 'gpt-4.1-mini', api_key: 'sk-live-key',
  });
  assert.ok(!call.url.includes('sk-live-key'), 'the key must never ride in a URL');
});

test('configureAi reports every documented diagnostic as a closed code', async () => {
  const cases = [
    [502, 'provider_unreachable', 'provider_unreachable'],
    [422, 'model_without_tools', 'model_without_tools'],
    [422, 'endpoint_forbidden', 'endpoint_forbidden'],
    [422, 'credential_missing', 'credential_missing'],
    [409, 'credential_key_missing', 'credential_key_missing'],
    [502, 'auth_failed', 'auth_failed'],
    [422, 'tool_not_called', 'tool_not_called'],
    [409, 'state_refused', 'state_refused'],
    [403, 'csrf_invalid', 'session_expired'],
    [401, 'authentication_required', 'session_expired'],
  ];
  for (const [status, error, code] of cases) {
    const { client } = claimedClient({ 'POST /api/setup/v1/ai': { status, body: { error } } });
    await client.claim('one-time-secret');
    const result = await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'k' });
    assert.equal(result.ok, false, error);
    assert.equal(result.code, code, error);
  }
});

test('an unknown server error never leaks upstream text into the result', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/ai': { status: 500, body: { error: 'Traceback: secret sk-live-key rejected by proxy' } },
  });
  await client.claim('one-time-secret');
  const result = await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk-live-key' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unavailable');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('Traceback'), serialized);
  assert.ok(!serialized.includes('sk-live-key'), serialized);
});

test('a transport failure and a timeout stay distinguishable from a provider answer', async () => {
  const offline = load().createSetupClient({ fetch: async () => { throw new TypeError('Failed to fetch'); }, timeoutMs: 50 });
  offline.claim = async () => ({ ok: true });
  assert.equal((await offline.configureAi({ baseUrl: 'https://x.test', model: 'm', apiKey: 'k' })).code, 'network');

  const hanging = load().createSetupClient({
    fetch: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
    timeoutMs: 20,
  });
  assert.equal((await hanging.configureAi({ baseUrl: 'https://x.test', model: 'm', apiKey: 'k' })).code, 'timeout');
});

test('a 200 without a receipt is a broken response, not a configured provider', async () => {
  const bodies = [
    { state: 'ai_configured' },
    { state: 'ai_configured', ai: null },
    { state: 'ai_configured', ai: { status: 'configured' } },
  ];
  for (const body of bodies) {
    const { client } = claimedClient({ 'POST /api/setup/v1/ai': { status: 200, body } });
    const result = await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'k' });
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.code, 'invalid-response', JSON.stringify(body));
  }
});

test('the receipt is copied field by field and never echoes a key or ciphertext', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/ai': {
      status: 200,
      body: { state: 'ai_configured', ai: { ...RECEIPT, api_key: 'sk-echoed', ciphertext: 'gAAAA', base_url: 'https://api.example.com' } },
    },
  });
  const result = await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk-echoed' });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('sk-echoed'), serialized);
  assert.ok(!serialized.includes('ciphertext'), serialized);
  assert.ok(!serialized.includes('base_url'), serialized);
});

test('the wizard key is not retained: no later request repeats it and no client field holds it', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/ai': { status: 502, body: { error: 'provider_unreachable' } },
  });
  await client.claim('one-time-secret');
  await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk-first-secret' });
  await client.configureAi({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk-second-secret' });
  const aiCalls = seen.filter((entry) => entry.url === '/api/setup/v1/ai');
  assert.equal(aiCalls.length, 2);
  assert.deepEqual(JSON.parse(aiCalls[1].init.body), {
    base_url: 'https://api.example.com', model: 'm', api_key: 'sk-second-secret',
  });
  for (const entry of seen) {
    assert.ok(!entry.url.includes('sk-'), entry.url);
    assert.ok(!JSON.stringify(entry.init.headers ?? {}).includes('sk-'), 'no key may travel in a header');
  }
  assert.equal(JSON.stringify(client).includes('sk-'), false);
  assert.equal(Object.keys(client).some((key) => String(key).toLowerCase().includes('key')), false);
  assert.equal(client.csrfToken(), 'csrf-1', 'only the CSRF token is kept in memory');
});

test('deferAi records the pending item without a body and keeps the CSRF header', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/ai/defer': {
      status: 200,
      body: { state: 'ai_deferred', ai: { status: 'pending', pending: true, reason: null, deferred_at: '2026-11-13T10:01:00Z' } },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.deferAi();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ai_deferred');
  assert.equal(result.receipt.pending, true);
  assert.equal(result.receipt.status, 'pending');
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/ai/defer');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(call.init.body, undefined);
});

test('askAssistant sends one bounded question and returns the answer with the tools that ran', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/assistant/ask': {
      status: 200,
      body: { answer: 'La instalación está reclamada y la IA configurada.', tools: ['get_setup_status'], latency_ms: 934 },
    },
  });
  await client.claim('one-time-secret');
  const result = await client.askAssistant('¿Cuál es el estado?');
  assert.equal(result.ok, true);
  assert.equal(result.answer, 'La instalación está reclamada y la IA configurada.');
  assert.deepEqual(result.tools, ['get_setup_status']);
  assert.equal(result.latencyMs, 934);
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/assistant/ask');
  assert.deepEqual(JSON.parse(call.init.body), { question: '¿Cuál es el estado?' });
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
});

test('askAssistant refuses to answer without a configured provider and never shows raw text', async () => {
  const { client } = claimedClient({
    'POST /api/setup/v1/assistant/ask': { status: 409, body: { error: 'ai_not_configured' } },
  });
  await client.claim('one-time-secret');
  const result = await client.askAssistant('hola');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ai_not_configured');

  const broken = claimedClient({
    'POST /api/setup/v1/assistant/ask': { status: 200, body: { answer: 42 } },
  });
  const second = await broken.client.askAssistant('hola');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'invalid-response');
});

test('logout ends the setup session and forgets the CSRF token in memory', async () => {
  const { client, seen } = claimedClient({
    'POST /api/setup/v1/session/logout': { status: 200, body: { status: 'signed_out' } },
  });
  await client.claim('one-time-secret');
  const result = await client.logout();
  assert.equal(result.ok, true);
  const call = seen.at(-1);
  assert.equal(call.url, '/api/setup/v1/session/logout');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(call.init.body, undefined);
  assert.equal(client.csrfToken(), null);
});
