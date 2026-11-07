'use strict';
// Focused conversation surface: the browser posts to the server agent endpoint,
// shows factual unavailability, and never parses business operations itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';

function vnodeText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(vnodeText).join(' ');
  if (!node || typeof node !== 'object') return '';
  return (node.text || '') + ' ' + vnodeText(node.children || []);
}

function findById(node, id) {
  if (!node) return null;
  if (node.props && node.props.id === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function optionsOf(select) {
  return ((select && select.children) || []).filter(node => node.tag === 'option');
}

function changeHandler(control) {
  return (control && control.listeners && control.listeners.change) ||
    (control && control.props && control.props.onChange) || null;
}

function hermesInstance(id, profile, name) {
  return {
    id,
    name,
    engine: 'hermes',
    profile,
    enabled: true,
    capabilities: { streaming: true, cancel: true, tools: true, usage: true },
    version: '0.22.5',
    models: [{ id: 'hermes:' + profile, name: 'Modelo ' + profile, provider: 'hermes', free: null }],
    error: null
  };
}

function hermesPayload() {
  const payload = enginesPayload();
  payload.instances.push(hermesInstance('hermes-itsm', 'itsm', 'Hermes ITSM'));
  payload.instances.push(hermesInstance('hermes-default', 'default', 'Hermes personal'));
  payload.preference = { instanceId: 'hermes-itsm', model: 'hermes:itsm' };
  return payload;
}

function agentPayload(overrides) {
  return Object.assign(
    {
      message: 'Encontré 1 servidor en Matriz.',
      actions: [{ tool: 'assets.search', status: 'completed', assetIds: [ASSET_ID] }],
      results: [
        {
          id: ASSET_ID,
          quickCode: 'SRV-DC-004',
          name: 'Servidor de base de datos',
          category: 'Servidores',
          type: 'Servidor',
          brand: 'Dell',
          model: 'R650',
          serial: 'SN-9',
          ip: '10.0.0.9',
          site: 'Matriz',
          location: 'Rack A-04',
          responsible: '',
          status: 'in_use',
          description: '',
          createdAt: '2026-01-05T10:00:00Z',
          updatedAt: '2026-01-06T11:30:00Z'
        }
      ]
    },
    overrides
  );
}

function quotaBalance(overrides) {
  return Object.assign({
    limitTokens: 1000,
    consumedTokens: 250,
    reservedTokens: 50,
    availableTokens: 700,
    pendingCount: 1,
    legacyTokens: 0,
    limitSource: 'default',
    precision: { measured: 250, estimated: 0, unavailable: 0 }
  }, overrides || {});
}

function usagePayload(overrides) {
  return Object.assign({
    periodDay: '2026-10-27',
    timezone: 'America/Mexico_City',
    funding: { company: quotaBalance(), personal: quotaBalance() }
  }, overrides || {});
}

function mountConversation() {
  const { c, app, mount } = setup();
  const requests = [];
  c.AssetAccess.request = async (vm, path, options) => {
    if (path === '/agent/usage/me') return usagePayload();
    requests.push({ vm, path, options });
    return agentPayload();
  };
  const mounted = mount('AssetConversation', { app });
  return { c, app, mount: mounted, requests, vm: mounted.instance };
}

test('the conversation route is addressable from the hash', () => {
  const { c, app } = setup();
  c.location.hash = '#/conversacion';
  assert.equal(app.parseRoute().name, 'conversation');
  assert.equal(app.hashFor({ name: 'conversation' }), '#/conversacion');
  app.route = app.parseRoute();
  assert.equal(app.pageLabel, 'Conversación');
});

test('sending a message posts it to the agent endpoint with prior turns', async () => {
  const { vm, requests } = mountConversation();
  vm.draft = 'Mostrame los servidores de Matriz';

  assert.equal(await vm.send(), true);

  assert.equal(requests[0].path, '/agent/chat');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.body.message, 'Mostrame los servidores de Matriz');
  assert.equal(requests[0].options.body.conversation.length, 0);
  assert.equal(vm.messages.length, 2);
  assert.equal(vm.messages[0].role, 'user');
  assert.equal(vm.messages[1].role, 'assistant');
  assert.equal(vm.messages[1].content, 'Encontré 1 servidor en Matriz.');
  assert.equal(vm.results[0].id, ASSET_ID);
  assert.equal(vm.assetHref(ASSET_ID), '#/activo/' + ASSET_ID);
  assert.equal(vm.actions[0].status, 'completed');
  assert.equal(vm.actionStatusLabel('denied'), 'Denegada');
  assert.equal(vm.draft, '');
  assert.equal(vm.busy, false);

  vm.draft = 'Cambiá el responsable de esta computadora';
  await vm.send();
  assert.equal(requests[1].options.body.message, 'Cambiá el responsable de esta computadora');
  assert.equal(requests[1].options.body.conversation.length, 2);
  assert.equal(requests[1].options.body.conversation[0].role, 'user');
  assert.equal(requests[1].options.body.conversation[1].role, 'assistant');
});

test('the history sent to the server is bounded to the last turns', async () => {
  const { vm, requests } = mountConversation();
  for (let index = 0; index < 26; index += 1) {
    vm.messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: 'turno ' + index });
  }
  vm.draft = 'seguimos';
  await vm.send();
  assert.equal(requests[0].options.body.conversation.length, 20);
  assert.equal(requests[0].options.body.conversation[19].content, 'turno 25');
});

test('a missing server model shows a factual error and no invented reply', async () => {
  const { c, vm } = mountConversation();
  c.AssetAccess.request = async () => {
    const error = new Error('No se pudo completar la solicitud.');
    error.status = 503;
    throw error;
  };

  vm.draft = 'Registrá un switch Aruba en Example Site';
  assert.equal(await vm.send(), false);

  assert.match(vm.error, /no está disponible/i);
  assert.match(vm.error, /modelo/i);
  assert.equal(vm.messages.filter((message) => message.role === 'assistant').length, 0);
  assert.equal(vm.busy, false);
  assert.equal(vm.actions.length, 0);
});

test('empty messages are not sent', async () => {
  const { vm, requests } = mountConversation();
  vm.draft = '   ';
  assert.equal(await vm.send(), false);
  assert.equal(requests.length, 0);
});

test('assistant text is rendered as text, never as markup', async () => {
  const { c, vm } = mountConversation();
  vm.messages.push({ role: 'assistant', content: '<img src=x onerror="alert(1)">' });
  await c.Vue.nextTick();
  const tags = [];
  const walk = (node) => {
    if (!node) return;
    if (node.tag && node.tag !== '#text' && node.tag !== '#comment') tags.push(String(node.tag).toUpperCase());
    (node.children || []).forEach(walk);
  };
  walk(vm.$el || { children: [] });
  assert.equal(tags.includes('IMG'), false);
});

test('the asset context route is explicit and reversible', () => {
  const { c, app } = setup();
  c.location.hash = '#/conversacion/activo/' + ASSET_ID;
  const parsed = app.parseRoute();
  assert.equal(parsed.name, 'conversation');
  assert.equal(parsed.assetId, ASSET_ID);
  assert.equal(app.hashFor({ name: 'conversation', assetId: ASSET_ID }), '#/conversacion/activo/' + ASSET_ID);
  assert.equal(app.hashFor({ name: 'conversation' }), '#/conversacion');
  c.location.hash = '#/conversacion';
  assert.equal(app.parseRoute().assetId, null);
});

test('an in-flight request is aborted when the surface unmounts', async () => {
  const { c, app, mount } = setup();
  let signal = null;
  c.AssetAccess.request = (vm, path, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  const mounted = mount('AssetConversation', { app });
  mounted.instance.draft = 'Mostrame los servidores de Matriz';
  mounted.instance.send();

  assert.ok(signal, 'the request was sent');
  assert.equal(signal.aborted, false);
  mounted.unmount();
  assert.equal(signal.aborted, true);
});

test('logging out cancels the request and drops the conversation', async () => {
  const { c, app, mount } = setup();
  let signal = null;
  c.AssetAccess.request = (vm, path, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  const mounted = mount('AssetConversation', { app });
  const vm = mounted.instance;
  vm.messages.push({ role: 'user', content: 'hola' });
  vm.draft = 'Cambiá el responsable de esta computadora';
  vm.send();

  app.authenticated = false;
  await c.Vue.nextTick();

  assert.equal(signal.aborted, true);
  assert.equal(vm.messages.length, 0);
  assert.equal(vm.busy, false);
});

test('only a selected known server asset is sent as context', async () => {
  const { app, requests, vm } = mountConversation();
  app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor de base de datos', quickCode: 'SRV-DC-004' }];

  assert.equal(vm.assetContextOptions.map((asset) => asset.id).join(','), ASSET_ID);
  vm.selectedAssetId = ASSET_ID;
  vm.draft = 'Cambiá el responsable de esta computadora';
  await vm.send();
  assert.equal(requests[0].options.body.assetId, ASSET_ID);

  vm.selectedAssetId = 'AM-1062';
  vm.draft = 'Mostrame los servidores de Matriz';
  await vm.send();
  assert.equal('assetId' in requests[1].options.body, false);
});

test('a route id preselects only a permanent server identifier', async () => {
  const { c, app, mount } = setup();
  app.route = { name: 'conversation', assetId: ASSET_ID };
  c.AssetAccess.request = async () => agentPayload();
  const mounted = mount('AssetConversation', { app });
  assert.equal(mounted.instance.selectedAssetId, ASSET_ID);
  mounted.unmount();

  const second = setup();
  second.app.route = { name: 'conversation', assetId: 'AM-1062' };
  const other = second.mount('AssetConversation', { app: second.app });
  assert.equal(other.instance.selectedAssetId, '');
});

test('an over-long message is rejected before any request', async () => {
  const { vm, requests } = mountConversation();
  vm.draft = 'x'.repeat(vm.maxMessageLength + 1);
  assert.equal(await vm.send(), false);
  assert.equal(requests.length, 0);
  assert.match(vm.error, /caracteres/);
});

// ---------------------------------------------------------------------------
// Common session path: engine discovery, SSE parsing, cancel and recovery.
// The canonical browser boundary (`fetch`) is used so CSRF, headers, chunked
// event parsing and abort signals are the ones the shipped transport uses.

const ENGINE_ID = 'opencode-local';

function enginesPayload(overrides) {
  return Object.assign(
    {
      instances: [
        {
          id: 'pydantic-built-in',
          name: 'Pydantic AI',
          engine: 'pydantic',
          profile: '',
          enabled: true,
          capabilities: { streaming: false, cancel: false, tools: true, usage: false },
          version: '1.0',
          models: [{ id: 'pydantic:default', name: 'Modelo interno', provider: 'pydantic', free: null }],
          error: null
        },
        {
          id: ENGINE_ID,
          name: 'OpenCode local',
          engine: 'opencode',
          profile: 'itsm',
          enabled: true,
          capabilities: { streaming: true, cancel: true, tools: true, usage: true },
          version: '2.1.2',
          models: [
            { id: 'opencode/free-a', name: 'Gratis A', provider: 'opencode', free: true },
            { id: 'opencode/free-b', name: 'Gratis B', provider: 'opencode', free: true }
          ],
          error: null
        }
      ],
      preference: { instanceId: ENGINE_ID, model: 'opencode/free-a' },
      budget: { dailyLimit: 50000, usedMeasured: 1200, usedReported: 300, strictExternal: false }
    },
    overrides
  );
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => JSON.parse(JSON.stringify(payload)),
    blob: async () => new Blob([])
  };
}

function sseResponse(chunks) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (index < chunks.length) {
              return Promise.resolve({ value: new TextEncoder().encode(chunks[index++]), done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          releaseLock() {}
        };
      }
    }
  };
}

const DEFAULT_FRAMES = [
  'data: {"type":"delta","text":"Hola"}\n\n',
  'data: {"type":"tool","tool":"assets.search","status":"running"}\n\n',
  'data: {"type":"tool","tool":"assets.search","status":"completed","output":"1 activo"}\n\n',
  'data: {"type":"usage","inputTokens":12,"outputTokens":5,"cacheReadTokens":null,"cacheWriteTokens":null,"reasoningTokens":null,"totalTokens":17,"precision":"measured","source":"engine","estimationMethod":null,"inputIncludesCache":null,"outputIncludesReasoning":null,"totalSource":"derived"}\n\n',
  'data: {"type":"done","cancelled":false,"actions":[{"tool":"assets.search","status":"completed","assetIds":["' +
    ASSET_ID +
    '"]}],"results":[{"id":"' +
    ASSET_ID +
    '","name":"Servidor de base de datos"}],"approvalPending":false}\n\n'
];

function sessionSurface(config) {
  const { c, app, mount, settle } = setup();
  app.route = { name: 'conversation', assetId: null, personId: null, section: null };
  app.csrfToken = 'csrf-session';
  const calls = [];
  const state = Object.assign(
    {
      engines: enginesPayload(),
      frames: DEFAULT_FRAMES,
      messageResponse: null,
      createCount: 0,
      cancelResult: { cancelled: true },
      sessionSnapshot: null,
      usage: usagePayload()
    },
    config || {}
  );
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    const method = init.method || 'GET';
    let body = init.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { /* raw body */ }
    }
    calls.push({ path, method, body, headers: init.headers || {}, signal: init.signal });
    if (path === '/agent/engines') {
      if (state.enginesError) {
        return jsonResponse({ error: { code: state.enginesError.code, message: '' } }, state.enginesError.status);
      }
      return jsonResponse(state.engines);
    }
    if (path === '/agent/usage/me') {
      if (state.usageError) {
        return jsonResponse({ error: { code: state.usageError.code || 'unavailable', message: '' } }, state.usageError.status);
      }
      if (state.deferUsage) await new Promise((resolve) => { state.releaseUsage = resolve; });
      return jsonResponse(state.usage);
    }
    if (path === '/agent/preferences' && method === 'PUT') {
      state.preference = body;
      return jsonResponse(body);
    }
    if (path === '/agent/sessions' && method === 'POST') {
      state.createCount += 1;
      return jsonResponse(
        { id: 'sess-' + state.createCount, instanceId: body.instanceId, model: body.model, messages: [] },
        201
      );
    }
    if (/^\/agent\/sessions\/[^/]+$/.test(path) && method === 'PATCH') {
      state.patch = body;
      if (state.patchPending) await new Promise((resolve) => { state.releasePatch = resolve; });
      if (state.patchError) {
        return jsonResponse({ error: { code: 'unavailable', message: state.patchError.message } }, state.patchError.status);
      }
      return jsonResponse({ id: path.split('/').pop(), instanceId: body.instanceId || ENGINE_ID, model: body.model });
    }
    if (/^\/agent\/sessions\/[^/]+$/.test(path) && method === 'GET') {
      return jsonResponse(
        state.sessionSnapshot || {
          id: path.split('/').pop(),
          messages: [],
          actions: [],
          results: [],
          approvalPending: false
        }
      );
    }
    if (/^\/agent\/sessions\/[^/]+\/messages$/.test(path) && method === 'POST') {
      return state.messageResponse || sseResponse(typeof state.frames === 'function' ? state.frames(body) : state.frames);
    }
    if (/^\/agent\/sessions\/[^/]+\/cancel$/.test(path) && method === 'POST') {
      state.cancelCalls = (state.cancelCalls || 0) + 1;
      return jsonResponse(state.cancelResult);
    }
    if (path === '/agent/chat') {
      return jsonResponse({ message: 'Respuesta compatible', actions: [], results: [] });
    }
    return jsonResponse({ error: { code: 'not_found', message: '' } }, 404);
  };
  const mounted = mount('AssetConversation', { app });
  return { c, app, mount: mounted, vm: mounted.instance, calls, state, settle };
}

test('the chat loads engines dynamically and heals a saved model that disappeared', async () => {
  const surface = sessionSurface({
    engines: enginesPayload({ preference: { instanceId: ENGINE_ID, model: 'opencode/removed' } })
  });
  await surface.settle();

  assert.equal(surface.calls[0].path, '/agent/engines');
  assert.equal(surface.vm.agentActiveInstance.id, ENGINE_ID);
  assert.deepEqual(surface.vm.agentModels.map((model) => model.id), ['opencode/free-a', 'opencode/free-b']);
  assert.equal(surface.vm.agentPreference.model, 'opencode/free-a');
  assert.match(surface.vm.agentSelectionNotice, /ya no está disponible/i);
  const saved = surface.calls.find((call) => call.path === '/agent/preferences' && call.method === 'PUT');
  assert.deepEqual(saved.body, { instanceId: ENGINE_ID, model: 'opencode/free-a' });
  assert.equal(surface.vm.agentBudget.usedMeasured, 1200);
  assert.equal(surface.vm.agentBudget.usedReported, 300);
  assert.equal(surface.vm.agentBudget.strictExternal, false);
  assert.doesNotMatch(vnodeText(surface.mount.root), /aplica el límite antes de enviar/i);
});

test('sending through the common session path streams deltas, tools, usage and existing cards', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.vm.draft = 'Busca los servidores de Matriz';

  assert.equal(await surface.vm.send(), true);

  const created = surface.calls.find((call) => call.path === '/agent/sessions' && call.method === 'POST');
  assert.deepEqual(created.body, { instanceId: ENGINE_ID, model: 'opencode/free-a' });
  const streamed = surface.calls.find((call) => /^\/agent\/sessions\/[^/]+\/messages$/.test(call.path));
  assert.equal(streamed.method, 'POST');
  assert.equal(streamed.body.message, 'Busca los servidores de Matriz');
  assert.equal(streamed.headers['X-CSRF-Token'], 'csrf-session');
  assert.equal(streamed.headers.Accept, 'text/event-stream');

  assert.equal(surface.vm.messages[0].role, 'user');
  assert.equal(surface.vm.messages[1].role, 'assistant');
  assert.equal(surface.vm.messages[1].content, 'Hola');
  assert.equal(surface.vm.tools.length, 1);
  assert.equal(surface.vm.tools[0].status, 'completed');
  assert.equal(surface.vm.usage.source, 'engine');
  assert.equal(surface.vm.usage.precision, 'measured');
  assert.equal(surface.vm.results[0].id, ASSET_ID);
  assert.equal(surface.vm.actions[0].status, 'completed');
  assert.equal(surface.vm.busy, false);
  assert.equal(surface.vm.streaming, false);
});

test('changing engine preserves the ITSM session and transcript without replaying prior context', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.vm.draft = 'Primera consulta';
  await surface.vm.send();
  surface.vm.draft = 'Segunda consulta';
  await surface.vm.send();
  const transcript = JSON.parse(JSON.stringify(surface.vm.messages));

  await surface.vm.changeEngine('pydantic-built-in');
  assert.equal(surface.vm.sessionId, 'sess-1');
  assert.deepEqual(JSON.parse(JSON.stringify(surface.vm.messages)), transcript);
  const patch = surface.calls.find(call => call.method === 'PATCH');
  assert.deepEqual(patch.body, { instanceId: 'pydantic-built-in', model: 'pydantic:default' });
  const saved = surface.calls.filter((call) => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'pydantic-built-in', model: 'pydantic:default' });

  surface.vm.draft = 'Tercera consulta';
  await surface.vm.send();
  const creates = surface.calls.filter((call) => call.path === '/agent/sessions' && call.method === 'POST');
  assert.equal(creates.length, 1);
  assert.equal(surface.vm.messages.length, 6);
});

test('a discovery failure on another engine is visible without replacing the saved engine', async () => {
  const payload = enginesPayload();
  payload.preference = { instanceId: 'pydantic-built-in', model: 'pydantic:default' };
  payload.instances.push({
    id: 'opencode-broken',
    name: 'OpenCode externo',
    engine: 'opencode',
    profile: 'itsm',
    enabled: true,
    capabilities: { streaming: true, cancel: true, tools: true, usage: true },
    version: null,
    models: [],
    error: 'engine authentication failed'
  });
  const surface = sessionSurface({ engines: payload });
  await surface.settle();

  assert.equal(surface.vm.agentPreference.instanceId, 'pydantic-built-in');
  assert.deepEqual(surface.vm.agentDiscoveryErrors.map((failure) => failure.error), ['engine authentication failed']);
  const text = vnodeText(surface.mount.root);
  assert.match(text, /OpenCode externo/);
  assert.match(text, /engine authentication failed/);
  assert.doesNotMatch(text, /El servidor no anunció motores configurables/);
});

test('selecting an engine with no announced models keeps the choice and saves a null model', async () => {
  const payload = enginesPayload();
  payload.instances.push({
    id: 'opencode-empty',
    name: 'OpenCode sin modelos',
    engine: 'opencode',
    profile: 'itsm',
    enabled: true,
    capabilities: { streaming: true, cancel: true, tools: true, usage: true },
    models: [],
    error: 'engine authentication failed'
  });
  const surface = sessionSurface({ engines: payload });
  await surface.settle();

  assert.equal(await surface.vm.changeEngine('opencode-empty'), true);
  const saved = surface.calls.filter((call) => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'opencode-empty', model: null });
  assert.equal(surface.vm.agentPreference.instanceId, 'opencode-empty');
  assert.equal(surface.vm.agentPreference.model, '');
  assert.equal(surface.vm.agentModels.length, 0);
  assert.match(surface.vm.agentSelectionNotice, /no anunció modelos/);
  assert.deepEqual(surface.vm.agentDiscoveryErrors.map((failure) => failure.error), ['engine authentication failed']);
  assert.match(vnodeText(surface.mount.root), /OpenCode sin modelos · OpenCode: engine authentication failed/);
  assert.equal(surface.vm.sessionId, '');
});

test('the rendered chat engine selector keeps a chosen engine with no models', async () => {
  const payload = enginesPayload();
  payload.instances.push({
    id: 'opencode-empty',
    name: 'OpenCode sin modelos',
    engine: 'opencode',
    profile: 'itsm',
    enabled: true,
    capabilities: { streaming: true, cancel: true, tools: true, usage: true },
    models: [],
    error: null
  });
  const surface = sessionSurface({ engines: payload });
  await surface.settle();
  const findById = (node, id) => {
    if (!node) return null;
    if (node.props && node.props.id === id) return node;
    for (const child of node.children || []) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  };

  const select = findById(surface.mount.root, 'conversation-engine');
  assert.ok(select, 'the rendered chat engine selector exists');
  const change = (select.listeners && select.listeners.change) ||
    (select.props && (select.props.onChange || select.props['onUpdate:modelValue']));
  assert.ok(change, 'the rendered chat engine selector is wired');
  // A real DOM Event exposes target through its prototype, not as an own field.
  // Exercise that shape so the rendered handler is not proven only by a mock.
  select.value = 'opencode-empty';
  const event = Object.create({ target: select });
  await change(event);
  await surface.settle();

  const saved = surface.calls.filter((call) => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'opencode-empty', model: null });
  assert.equal(surface.vm.agentPreference.instanceId, 'opencode-empty');
  assert.equal(surface.vm.agentPreference.model, '');
  assert.match(surface.vm.agentSelectionNotice, /no anunció modelos/);
});

test('changing model reuses the internal session and patches the selected model', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.vm.draft = 'Busca servidores';
  await surface.vm.send();

  await surface.vm.changeModel('opencode/free-b');
  assert.deepEqual(surface.state.patch, { model: 'opencode/free-b' });
  const saved = surface.calls.filter((call) => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: ENGINE_ID, model: 'opencode/free-b' });
  assert.equal(surface.vm.sessionModel, 'opencode/free-b');
});

test('the stream parser reassembles chunked frames across byte boundaries', async () => {
  const surface = sessionSurface({ frames: ['data: {"type":"del', 'ta","text":"Ho', 'la"}\n\ndata: {"type":"done","cancelled":false}\n\n'] });
  await surface.settle();
  surface.vm.draft = 'Hola';
  assert.equal(await surface.vm.send(), true);
  assert.equal(surface.vm.messages[1].content, 'Hola');
});

test('multi-fragment deltas append exactly once each, even when two fragments match', async () => {
  const surface = sessionSurface({
    frames: [
      'data: {"type":"delta","text":"Hola"}\n\n',
      'data: {"type":"delta","text":", "}\n\n',
      'data: {"type":"delta","text":"la"}\n\n',
      'data: {"type":"delta","text":"la"}\n\n',
      'data: {"type":"done","cancelled":false}\n\n'
    ]
  });
  await surface.settle();
  surface.vm.draft = 'Saluda';
  assert.equal(await surface.vm.send(), true);
  assert.equal(surface.vm.messages[1].content, 'Hola, lala');
});

test('reconnecting replaces the transcript from the server snapshot without duplicating text', async () => {
  const snapshot = {
    id: 'sess-1',
    instanceId: ENGINE_ID,
    model: 'opencode/free-a',
    messages: [
      { role: 'user', content: 'Saluda' },
      { role: 'assistant', content: 'Hola, lala' }
    ],
    actions: [],
    results: [],
    approvalPending: false
  };
  const surface = sessionSurface({
    frames: [
      'data: {"type":"delta","text":"Hola"}\n\n',
      'data: {"type":"delta","text":", lala"}\n\n',
      'data: {"type":"error","message":"Corte de prueba.","retryable":true}\n\n',
      'data: {"type":"done","cancelled":false}\n\n'
    ],
    sessionSnapshot: snapshot
  });
  await surface.settle();
  surface.vm.draft = 'Saluda';
  await surface.vm.send();
  assert.equal(surface.vm.messages[1].content, 'Hola, lala');

  assert.equal(await surface.vm.reconnectSession(), true);
  assert.equal(await surface.vm.reconnectSession(), true);
  const assistant = surface.vm.messages.filter((message) => message.role === 'assistant');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].content, 'Hola, lala');
});

test('a retryable stream failure is reported without resending the message on reconnect', async () => {
  const surface = sessionSurface({
    frames: [
      'data: {"type":"delta","text":"Parcial"}\n\n',
      'data: {"type":"error","code":"unavailable","message":"La instancia dejó de responder.","retryable":true}\n\n',
      'data: {"type":"done","cancelled":false}\n\n'
    ],
    sessionSnapshot: {
      id: 'sess-1',
      instanceId: ENGINE_ID,
      model: 'opencode/free-a',
      messages: [
        { role: 'user', content: 'Busca servidores' },
        { role: 'assistant', content: 'Parcial' }
      ],
      actions: [],
      results: [],
      approvalPending: false
    }
  });
  await surface.settle();
  surface.vm.draft = 'Busca servidores';
  await surface.vm.send();

  assert.match(surface.vm.error, /dejó de responder/i);
  assert.equal(surface.vm.retryable, true);
  const messageCalls = () => surface.calls.filter((call) => /\/messages$/.test(call.path)).length;
  const sent = messageCalls();

  assert.equal(await surface.vm.reconnectSession(), true);
  assert.equal(messageCalls(), sent);
  const fetched = surface.calls.filter((call) => /^\/agent\/sessions\/[^/]+$/.test(call.path) && call.method === 'GET').pop();
  assert.equal(fetched.path, '/agent/sessions/sess-1');
  assert.equal(surface.vm.messages.filter((message) => message.role === 'assistant').length, 1);
  assert.equal(surface.vm.error, '');
});

test('cancel is visible while processing and posts to the internal session', async () => {
  const surface = sessionSurface();
  await surface.settle();
  let release = () => {};
  surface.state.messageResponse = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              release = () => resolve({ value: new TextEncoder().encode('data: {"type":"done","cancelled":true}\n\n'), done: false });
            });
          },
          releaseLock() {}
        };
      }
    }
  };
  surface.vm.draft = 'Ejecuta una operación larga';
  const pending = surface.vm.send();
  await surface.settle();

  assert.equal(surface.vm.busy, true);
  assert.equal(surface.vm.canCancel, true);
  assert.equal(await surface.vm.cancelRun(), true);
  assert.equal(surface.state.cancelCalls, 1);
  assert.equal(surface.vm.cancelPending, true);

  release();
  await pending;
  assert.equal(surface.vm.busy, false);
  assert.equal(surface.vm.cancelPending, false);
  assert.match(surface.vm.streamStatus, /cancel/i);
});

test('a text-only 404 from engine discovery keeps the legacy chat usable', async () => {
  const { c, app, mount, settle } = setup();
  app.route = { name: 'conversation', assetId: null, personId: null, section: null };
  app.csrfToken = 'csrf-text-404';
  const calls = [];
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/agent/engines') {
      return {
        ok: false,
        status: 404,
        json: async () => { throw new SyntaxError('Unexpected token N in JSON at position 0'); }
      };
    }
    if (path === '/agent/chat') return jsonResponse(agentPayload());
    return jsonResponse({ error: { code: 'not_found', message: '' } }, 404);
  };
  const mounted = mount('AssetConversation', { app });
  await settle();
  assert.equal(mounted.instance.legacyFallback, true);
  assert.equal(mounted.instance.agentEnginesAvailable, false);
  assert.equal(mounted.instance.agentEnginesError, '');
  assert.doesNotMatch(mounted.instance.agentEnginesError, /Unexpected token/i);
  assert.equal(mounted.instance.error, '');
  mounted.instance.draft = 'Busca servidores';
  assert.equal(await mounted.instance.send(), true);
  assert.equal(calls.some(call => call.path === '/agent/chat'), true);
  assert.equal(mounted.instance.messages[1].content, 'Encontré 1 servidor en Matriz.');
});

test('an unavailable engine endpoint keeps the verified /agent/chat fallback', async () => {
  const { c, app, mount, settle } = setup();
  app.route = { name: 'conversation', assetId: null, personId: null, section: null };
  app.csrfToken = 'csrf-fallback';
  const calls = [];
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    calls.push({ path, method: init.method || 'GET', headers: init.headers || {} });
    if (path === '/agent/engines') return jsonResponse({ error: { code: 'not_found', message: '' } }, 404);
    if (path === '/agent/chat') return jsonResponse({ message: 'Respuesta compatible', actions: [], results: [] });
    return jsonResponse({ error: { code: 'not_found', message: '' } }, 404);
  };
  const mounted = mount('AssetConversation', { app });
  await settle();
  mounted.instance.draft = 'Busca servidores';
  assert.equal(await mounted.instance.send(), true);
  const legacy = calls.find((call) => call.path === '/agent/chat');
  assert.equal(legacy.method, 'POST');
  assert.equal(mounted.instance.messages[1].content, 'Respuesta compatible');
});

test('a failed engine discovery never falls back to legacy chat', async () => {
  const surface = sessionSurface({ enginesError: { status: 503, code: 'unavailable' } });
  await surface.settle();
  assert.equal(surface.vm.agentEnginesAvailable, true);
  surface.vm.draft = 'Hola';
  assert.equal(await surface.vm.send(), false);
  assert.match(surface.vm.error, /No hay un motor habilitado/i);
  assert.equal(surface.calls.some((call) => call.path === '/agent/chat'), false);
});

test('a successful engine endpoint with no instances never falls back to legacy chat', async () => {
  const surface = sessionSurface({
    engines: enginesPayload({ instances: [], preference: { instanceId: '', model: '' } })
  });
  await surface.settle();
  assert.equal(surface.vm.agentEnginesAvailable, true);
  assert.equal(surface.vm.useAgentSessions, true);
  assert.equal(surface.vm.canSend, false);
  surface.vm.draft = 'Hola';
  assert.equal(await surface.vm.send(), false);
  assert.match(surface.vm.error, /No hay un motor habilitado/i);
  assert.equal(surface.calls.some((call) => call.path === '/agent/chat'), false);
});

test('a successful engine endpoint with no enabled instance never falls back to legacy chat', async () => {
  const surface = sessionSurface({
    engines: enginesPayload({
      instances: [{ id: 'pydantic', name: 'Pydantic AI', engine: 'pydantic', enabled: false, models: [{ id: 'pydantic:default', name: 'Pydantic', provider: 'pydantic', free: null }] }],
      preference: { instanceId: 'pydantic', model: 'pydantic:default' }
    })
  });
  await surface.settle();
  assert.equal(surface.vm.agentEnginesAvailable, true);
  assert.equal(surface.vm.useAgentSessions, true);
  assert.equal(surface.vm.canSend, false);
  surface.vm.draft = 'Hola';
  assert.equal(await surface.vm.send(), false);
  assert.match(surface.vm.error, /No hay un motor habilitado/i);
  assert.equal(surface.calls.some((call) => call.path === '/agent/chat'), false);
});

test('the selected asset is sent as bounded session context only when known', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor', quickCode: 'SRV-1' }];
  surface.vm.selectedAssetId = ASSET_ID;
  surface.vm.draft = 'Cambia el responsable';
  await surface.vm.send();

  const created = surface.calls.find((call) => call.path === '/agent/sessions' && call.method === 'POST');
  assert.equal(created.body.assetId, ASSET_ID);
  const streamed = surface.calls.find((call) => /\/messages$/.test(call.path));
  assert.equal(streamed.body.assetId, ASSET_ID);
});

test('logging out aborts the stream and a late event cannot revive the surface', async () => {
  const surface = sessionSurface();
  await surface.settle();
  let release = () => {};
  let signal = null;
  surface.state.messageResponse = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              release = () => resolve({ value: new TextEncoder().encode('data: {"type":"delta","text":"Tarde"}\n\n'), done: false });
            });
          },
          releaseLock() {}
        };
      }
    }
  };
  surface.vm.draft = 'Consulta';
  const pending = surface.vm.send();
  await surface.settle();
  signal = surface.calls.find((call) => /\/messages$/.test(call.path)).signal;
  assert.ok(signal);
  assert.equal(signal.aborted, false);

  surface.app.authenticated = false;
  await surface.settle();
  assert.equal(signal.aborted, true);
  assert.equal(surface.vm.messages.length, 0);
  release();
  await pending;
  assert.equal(surface.vm.messages.length, 0);
  assert.equal(surface.vm.sessionId, '');
});

test('a same-engine profile switch patches the ITSM session and keeps transcript, draft and identity', async () => {
  const surface = sessionSurface({ engines: hermesPayload() });
  await surface.settle();
  const vm = surface.vm;
  vm.draft = 'Consulta inicial';
  assert.equal(await vm.send(), true);
  vm.draft = 'Borrador sin enviar';
  const transcript = JSON.parse(JSON.stringify(vm.messages));
  const sessionId = vm.sessionId;
  assert.equal(sessionId, 'sess-1');

  const engineSelect = findById(surface.mount.root, 'conversation-engine');
  assert.ok(engineSelect, 'the rendered chat engine selector exists');
  const engineOptions = optionsOf(engineSelect);
  assert.equal(engineOptions.filter(option => option.props.value === 'hermes').length, 1,
    'one engine choice covers every authorized Hermes profile');
  assert.equal(engineOptions.some(option => option.props.value === 'hermes-itsm'), false);
  assert.match(vnodeText(engineOptions.find(option => option.props.value === 'hermes')), /Hermes 0\.22\.5/);

  const profileSelect = findById(surface.mount.root, 'conversation-profile');
  assert.ok(profileSelect, 'the profile selector is rendered for distinct external profiles');
  assert.deepEqual(optionsOf(profileSelect).map(option => option.props.value), ['hermes-itsm', 'hermes-default']);
  assert.deepEqual(optionsOf(profileSelect).map(option => vnodeText(option).trim()), ['itsm', 'default']);
  assert.equal(profileSelect.props['aria-describedby'], 'conversation-profile-help');
  assert.ok(findById(surface.mount.root, 'conversation-profile-help'), 'the profile help target is rendered');

  const change = changeHandler(profileSelect);
  assert.ok(change, 'the profile selector is wired');
  profileSelect.value = 'hermes-default';
  assert.equal(await change(Object.create({ target: profileSelect })), true);
  await surface.settle();

  assert.equal(vm.sessionId, sessionId);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.messages)), transcript);
  assert.equal(vm.draft, 'Borrador sin enviar');
  assert.equal(vm.sessionInstanceId, 'hermes-default');
  assert.equal(vm.sessionModel, 'hermes:default');
  assert.equal(vm.agentPreference.instanceId, 'hermes-default');
  const patches = surface.calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, '/agent/sessions/sess-1');
  assert.deepEqual(patches[0].body, { instanceId: 'hermes-default', model: 'hermes:default' });
  assert.equal(surface.calls.filter(call => call.path === '/agent/sessions' && call.method === 'POST').length, 1);
  assert.deepEqual(surface.state.preference, { instanceId: 'hermes-default', model: 'hermes:default' });
});

test('a rejected profile switch restores the selected profile and keeps the ITSM session intact', async () => {
  const surface = sessionSurface({
    engines: hermesPayload(),
    patchError: { status: 503, message: 'El motor rechazó el cambio de perfil.' }
  });
  await surface.settle();
  const vm = surface.vm;
  vm.draft = 'Consulta inicial';
  await vm.send();
  vm.draft = 'Borrador sin enviar';
  const transcript = JSON.parse(JSON.stringify(vm.messages));
  const preferenceWrites = () => surface.calls.filter(call => call.path === '/agent/preferences').length;
  assert.equal(preferenceWrites(), 0);

  const profileSelect = findById(surface.mount.root, 'conversation-profile');
  const change = changeHandler(profileSelect);
  profileSelect.value = 'hermes-default';
  assert.equal(await change(Object.create({ target: profileSelect })), false);
  await surface.settle();

  assert.equal(profileSelect.value, 'hermes-itsm');
  assert.equal(vm.agentPreference.instanceId, 'hermes-itsm');
  assert.equal(vm.agentPreference.model, 'hermes:itsm');
  assert.equal(vm.sessionInstanceId, 'hermes-itsm');
  assert.equal(vm.sessionId, 'sess-1');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.messages)), transcript);
  assert.equal(vm.draft, 'Borrador sin enviar');
  assert.match(vm.error, /rechazó el cambio de perfil/i);
  assert.equal(preferenceWrites(), 0);
  assert.equal(surface.state.preference, undefined);
});

test('a profile switch that resolves after logout cannot restore state or leak a preference', async () => {
  const surface = sessionSurface({ engines: hermesPayload(), patchPending: true });
  await surface.settle();
  const vm = surface.vm;
  vm.draft = 'Consulta inicial';
  await vm.send();
  const pending = vm.changeProfile('hermes-default');
  await surface.settle();
  assert.equal(vm.selecting, true);
  assert.equal(findById(surface.mount.root, 'conversation-profile').props.disabled, true);
  assert.equal(findById(surface.mount.root, 'conversation-engine').props.disabled, true);

  surface.app.authenticated = false;
  await surface.settle();
  assert.equal(vm.sessionId, '');
  surface.state.releasePatch();
  assert.equal(await pending, false);
  await surface.settle();

  assert.equal(vm.agentPreference.instanceId, '');
  assert.equal(vm.agentPreference.model, '');
  assert.equal(vm.sessionInstanceId, '');
  assert.equal(vm.sessionId, '');
  assert.equal(vm.selecting, false);
  assert.equal(vm.messages.length, 0);
  assert.equal(vm.error, '');
  assert.equal(surface.calls.filter(call => call.path === '/agent/preferences').length, 0);
  assert.equal(surface.state.preference, undefined);
});

test('the profile selector is hidden without external profiles and Pydantic providers stay distinct', async () => {
  const payload = enginesPayload({
    instances: [
      { id: 'pydantic-global', name: 'Proveedor global', engine: 'pydantic', profile: '', enabled: true, capabilities: { tools: true }, version: '1.0', models: [{ id: 'global:model', name: 'Global', provider: 'pydantic', free: null }], error: null },
      { id: 'pydantic-personal', name: 'Mi proveedor', engine: 'pydantic', profile: '', enabled: true, capabilities: { tools: true }, version: '1.0', models: [{ id: 'personal:model', name: 'Personal', provider: 'pydantic', free: null }], error: null }
    ],
    preference: { instanceId: 'pydantic-global', model: 'global:model' }
  });
  const surface = sessionSurface({ engines: payload });
  await surface.settle();

  assert.equal(findById(surface.mount.root, 'conversation-profile'), null);
  const engineSelect = findById(surface.mount.root, 'conversation-engine');
  assert.deepEqual(optionsOf(engineSelect).map(option => option.props.value), ['pydantic-global', 'pydantic-personal']);
  const rendered = vnodeText(surface.mount.root);
  assert.match(rendered, /Proveedor global/);
  assert.match(rendered, /Mi proveedor/);
});

test('a single external profile hides the selector while its engine choice stays selectable', async () => {
  const payload = enginesPayload();
  payload.instances.push(hermesInstance('hermes-itsm', 'itsm', 'Hermes ITSM'));
  payload.preference = { instanceId: 'pydantic-built-in', model: 'pydantic:default' };
  const surface = sessionSurface({ engines: payload });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(findById(surface.mount.root, 'conversation-profile'), null);
  const engineSelect = findById(surface.mount.root, 'conversation-engine');
  const option = optionsOf(engineSelect).find(item => item.props.value === 'hermes');
  assert.ok(option, 'one Hermes engine option is rendered');
  assert.match(vnodeText(option), /Hermes 0\.22\.5/);

  const change = changeHandler(engineSelect);
  engineSelect.value = 'hermes';
  assert.equal(await change(Object.create({ target: engineSelect })), true);
  assert.equal(vm.agentPreference.instanceId, 'hermes-itsm');
  assert.equal(vm.agentPreference.model, 'hermes:itsm');
  assert.equal(surface.calls.some(call => call.method === 'PATCH'), false);
  const saved = surface.calls.filter(call => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'hermes-itsm', model: 'hermes:itsm' });
});

test('the chat shows both quota accounts without assuming company funding', async () => {
  const companyOnly = sessionSurface();
  await companyOnly.settle();
  assert.equal(companyOnly.vm.quotaSelectedFunding, '');
  assert.match(companyOnly.vm.quotaSelectedNotice, /no informó/i);
  assert.ok(findById(companyOnly.mount.root, 'conversation-quota'));
  assert.match(vnodeText(companyOnly.mount.root), /Empresa/);
  assert.match(vnodeText(companyOnly.mount.root), /Personal/);
  assert.match(vnodeText(companyOnly.mount.root), /Reservado:\s+50/);

  const engines = hermesPayload();
  engines.instances.find(instance => instance.id === 'hermes-default').providerScope = 'personal';
  engines.preference = { instanceId: 'hermes-default', model: 'hermes:default' };
  const personal = sessionSurface({
    engines,
    usage: usagePayload({
      funding: {
        company: quotaBalance({ consumedTokens: 111 }),
        personal: quotaBalance({ consumedTokens: 999, limitTokens: null, availableTokens: null })
      }
    })
  });
  await personal.settle();
  assert.equal(personal.vm.quotaSelectedFunding, 'personal');
  assert.equal(personal.vm.quotaSelectedBalance.consumed, 999);
  assert.equal(personal.vm.quotaSelectedBalance.limit, null);
  assert.equal(personal.vm.quotaLimitText(personal.vm.quotaSelectedBalance), 'Ilimitado');
  assert.match(personal.vm.quotaSelectedNotice, /personal/i);
  const text = vnodeText(personal.mount.root);
  assert.match(text, /Contexto actual/);
  assert.match(text, /999/);
});

test('quota zero, unlimited, unknown and missing availability stay distinct', async () => {
  const denied = sessionSurface({
    usage: usagePayload({
      funding: {
        company: quotaBalance({ limitTokens: 0, consumedTokens: 0, availableTokens: 0, reservedTokens: 0 }),
        personal: quotaBalance({ limitTokens: null, availableTokens: null, pendingCount: null })
      }
    })
  });
  await denied.settle();
  assert.equal(denied.vm.quotaLimitText(denied.vm.quotaCompany), '0 tokens · sin admisión');
  assert.equal(denied.vm.quotaLimitText(denied.vm.quotaPersonal), 'Ilimitado');
  assert.match(vnodeText(denied.mount.root), /sin admisión/);
  assert.match(vnodeText(denied.mount.root), /Ilimitado/);

  const missingAvailability = sessionSurface({
    usage: usagePayload({ funding: { company: quotaBalance({ availableTokens: undefined }), personal: null } })
  });
  await missingAvailability.settle();
  assert.equal(missingAvailability.vm.quotaPersonal, null);
  assert.equal(missingAvailability.vm.quotaAvailableText(missingAvailability.vm.quotaCompany), 'No disponible');
  assert.match(vnodeText(missingAvailability.mount.root), /Personal/);
  assert.match(vnodeText(missingAvailability.mount.root), /No disponible/);

  const unknown = sessionSurface({ usage: {} });
  await unknown.settle();
  assert.equal(unknown.vm.quotaHasData, false);
  assert.equal(unknown.vm.quotaUnavailable, true);
  assert.doesNotMatch(vnodeText(unknown.mount.root), /Consumido: 0/);
  assert.match(vnodeText(unknown.mount.root), /no está disponible/i);
});

test('the own quota refreshes explicitly and after stream finish, cancellation and error', async () => {
  const surface = sessionSurface();
  await surface.settle();
  const usageCalls = () => surface.calls.filter((call) => call.path === '/agent/usage/me').length;
  const initial = usageCalls();
  assert.ok(initial >= 1);

  surface.vm.draft = 'Busca servidores';
  assert.equal(await surface.vm.send(), true);
  await surface.settle();
  assert.equal(usageCalls(), initial + 1);

  surface.state.messageResponse = jsonResponse({ error: { code: 'unavailable', message: 'motor caído' } }, 503);
  surface.vm.draft = 'Otra consulta';
  assert.equal(await surface.vm.send(), false);
  await surface.settle();
  assert.equal(usageCalls(), initial + 2);

  let release = () => {};
  surface.state.messageResponse = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              release = () => resolve({ value: new TextEncoder().encode('data: {"type":"done","cancelled":true}\n\n'), done: false });
            });
          },
          releaseLock() {}
        };
      }
    }
  };
  surface.state.cancelResult = { cancelled: true };
  surface.vm.draft = 'Ejecuta algo largo';
  const pending = surface.vm.send();
  await surface.settle();
  assert.equal(await surface.vm.cancelRun(), true);
  release();
  await pending;
  await surface.settle();
  assert.equal(usageCalls(), initial + 3);

  const refresh = findById(surface.mount.root, 'conversation-quota-refresh');
  assert.ok(refresh, 'the explicit quota refresh button is rendered');
  const click = (refresh.listeners && refresh.listeners.click) || (refresh.props && refresh.props.onClick);
  assert.ok(click);
  await click({ preventDefault() {} });
  await surface.settle();
  assert.equal(usageCalls(), initial + 4);
});

test('an expired session clears the own quota without leaving a loading state', async () => {
  const surface = sessionSurface();
  await surface.settle();
  assert.ok(surface.vm.quotaSnapshot);
  surface.state.usageError = { status: 401, code: 'unauthenticated' };
  assert.equal(await surface.vm.loadQuota(), false);
  await surface.settle();
  assert.equal(surface.vm.quotaSnapshot, null);
  assert.equal(surface.vm.quotaLoaded, false);
  assert.equal(surface.vm.quotaLoading, false);
  assert.equal(surface.vm.quotaOwner, '');
  assert.doesNotMatch(vnodeText(surface.mount.root), /Consumido:/);
});

test('a late own-quota response cannot revive a signed-out account', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.vm.draft = 'Hola';
  await surface.vm.send();
  await surface.settle();
  assert.ok(surface.vm.quotaSnapshot);

  surface.state.deferUsage = true;
  const stale = surface.vm.loadQuota();
  await Promise.resolve();
  surface.app.authenticated = false;
  await surface.settle();
  surface.state.deferUsage = false;
  surface.state.releaseUsage();
  assert.equal(await stale, false);
  await surface.settle();
  assert.equal(surface.vm.quotaSnapshot, null);
  assert.equal(surface.vm.quotaLoaded, false);
  assert.equal(surface.vm.quotaLoading, false);
});

test('live usage keeps measured provider evidence separate and never adds included cache or reasoning twice', async () => {
  const event = {
    type: 'usage', inputTokens: 30, outputTokens: 10, cacheReadTokens: 20,
    cacheWriteTokens: 3, reasoningTokens: 4, totalTokens: 40,
    precision: 'measured', source: 'provider', estimationMethod: null,
    inputIncludesCache: true, outputIncludesReasoning: true, totalSource: 'derived'
  };
  const surface = sessionSurface({ frames: ['data: ' + JSON.stringify(event) + '\n\n', 'data: {"type":"done"}\n\n'] });
  await surface.settle();
  surface.vm.draft = 'Consulta con caché';
  assert.equal(await surface.vm.send(), true);
  await surface.settle();
  assert.equal(surface.vm.usage.precision, 'measured');
  assert.equal(surface.vm.usage.source, 'provider');
  assert.equal(surface.vm.usage.totalTokens, 40);
  assert.equal(surface.vm.usage.inputTokens, 30);
  assert.equal(surface.vm.usage.cacheReadTokens, 20);
  assert.equal(surface.vm.usage.cacheWriteTokens, 3);
  assert.equal(surface.vm.usage.reasoningTokens, 4);
  assert.equal(surface.vm.usage.inputIncludesCache, true);
  assert.equal(surface.vm.usage.outputIncludesReasoning, true);
  const evidence = vnodeText(findById(surface.mount.root, 'conversation-usage'));
  for (const value of ['30', '10', '20', '3', '4', '40']) assert.match(evidence, new RegExp('\\b' + value + '\\b'));
  assert.match(evidence, /medido/i);
  assert.match(evidence, /proveedor/i);
  assert.match(evidence, /última llamada/i);
  assert.doesNotMatch(evidence, /sin clasificar|\b67\b/i);
});

test('live usage replaces only the last call and preserves unavailable components rather than inventing zero', async () => {
  const events = [
    { type: 'usage', inputTokens: 30, outputTokens: 10, totalTokens: 40, precision: 'measured', source: 'provider' },
    {
      type: 'usage', inputTokens: null, outputTokens: null, cacheReadTokens: null,
      cacheWriteTokens: null, reasoningTokens: null, totalTokens: null,
      precision: 'unavailable', source: 'engine', estimationMethod: null,
      inputIncludesCache: false, outputIncludesReasoning: null, totalSource: null
    }
  ];
  const surface = sessionSurface({ frames: events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').concat('data: {"type":"done"}\n\n') });
  await surface.settle();
  surface.vm.draft = 'Dos llamadas';
  assert.equal(await surface.vm.send(), true);
  await surface.settle();
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) assert.equal(surface.vm.usage[key], null, key);
  assert.equal(surface.vm.usage.source, 'engine');
  assert.equal(surface.vm.usage.precision, 'unavailable');
  assert.equal(surface.vm.usage.inputIncludesCache, false);
  assert.equal(surface.vm.usage.outputIncludesReasoning, null);
  const evidence = vnodeText(findById(surface.mount.root, 'conversation-usage'));
  assert.match(evidence, /última llamada/i);
  assert.match(evidence, /no disponible/i);
  assert.match(evidence, /motor/i);
  assert.doesNotMatch(evidence, /\b0\b|\b40\b|sin clasificar/i);
});

test('live estimated usage displays its server method and explicit zero separately from null cache evidence', async () => {
  const event = {
    type: 'usage', inputTokens: 0, outputTokens: 2, cacheReadTokens: null,
    cacheWriteTokens: null, reasoningTokens: null, totalTokens: 2,
    precision: 'estimated', source: 'estimate', estimationMethod: 'utf8-bytes/4',
    inputIncludesCache: false, outputIncludesReasoning: null, totalSource: 'derived'
  };
  const surface = sessionSurface({ frames: ['data: ' + JSON.stringify(event) + '\n\n', 'data: {"type":"done"}\n\n'] });
  await surface.settle();
  surface.vm.draft = 'Estimación';
  assert.equal(await surface.vm.send(), true);
  await surface.settle();
  assert.equal(surface.vm.usage.inputTokens, 0);
  assert.equal(surface.vm.usage.cacheReadTokens, null);
  assert.equal(surface.vm.usage.estimationMethod, 'utf8-bytes/4');
  const evidence = vnodeText(findById(surface.mount.root, 'conversation-usage'));
  assert.match(evidence, /estimado/i);
  assert.match(evidence, /utf8-bytes\/4/);
  assert.match(evidence, /\b0\b/);
  assert.match(evidence, /no disponible/i);
});
