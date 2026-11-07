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

function mountConversation() {
  const { c, app, mount } = setup();
  const requests = [];
  c.AssetAccess.request = async (vm, path, options) => {
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
  'data: {"type":"usage","inputTokens":12,"outputTokens":5,"source":"reported"}\n\n',
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
      sessionSnapshot: null
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
      return jsonResponse({ id: path.split('/').pop(), instanceId: body.model, model: body.model });
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
  assert.match(surface.vm.agentBudgetStrictDisclosure, /no garantiza/i);
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
  assert.equal(surface.vm.usage.source, 'reported');
  assert.equal(surface.vm.results[0].id, ASSET_ID);
  assert.equal(surface.vm.actions[0].status, 'completed');
  assert.equal(surface.vm.busy, false);
  assert.equal(surface.vm.streaming, false);
});

test('changing engine starts a different internal session with bounded prior context', async () => {
  const surface = sessionSurface();
  await surface.settle();
  surface.vm.draft = 'Primera consulta';
  await surface.vm.send();
  surface.vm.draft = 'Segunda consulta';
  await surface.vm.send();

  await surface.vm.changeEngine('pydantic-built-in');
  assert.equal(surface.vm.sessionId, '');
  const saved = surface.calls.filter((call) => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'pydantic-built-in', model: 'pydantic:default' });

  surface.vm.draft = 'Tercera consulta';
  await surface.vm.send();
  const creates = surface.calls.filter((call) => call.path === '/agent/sessions' && call.method === 'POST');
  assert.equal(creates.length, 2);
  assert.equal(creates[1].body.instanceId, 'pydantic-built-in');
  assert.equal(creates[1].body.model, 'pydantic:default');
  assert.equal(creates[1].body.context.length, 4);
  assert.equal(creates[1].body.context[0].role, 'user');
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
