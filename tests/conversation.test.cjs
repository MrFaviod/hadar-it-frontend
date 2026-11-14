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

function clickHandler(control) {
  return (control && control.listeners && control.listeners.click) ||
    (control && control.props && control.props.onClick) || null;
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

  vm.draft = 'Registrá un switch Aruba en Sede Norte';
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
  app.route = (config && config.route) || { name: 'conversation', assetId: null, personId: null, section: null };
  app.csrfToken = 'csrf-session';
  const calls = [];
  // The surface listens on document for Escape; the harness document is a
  // stub, so the registered handlers are captured here (same idiom as
  // contextual-chat.test.cjs).
  const listeners = new Map();
  c.document.addEventListener = (type, handler) => { listeners.set(type, handler); };
  c.document.removeEventListener = (type) => { listeners.delete(type); };
  const state = Object.assign(
    {
      engines: enginesPayload(),
      frames: DEFAULT_FRAMES,
      messageResponse: null,
      messageError: null,
      createCount: 0,
      cancelResult: { cancelled: true },
      sessionSnapshot: null,
      usage: usagePayload(),
      attachments: [],
      uploadGate: null,
      uploadFailure: null,
      assetAttachments: { items: [], hasMore: false, total: 0 }
    },
    config || {}
  );
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    const [route, query = ''] = path.split('?');
    const method = init.method || 'GET';
    let body = init.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { /* raw body */ }
    }
    calls.push({ path, method, body, rawBody: init.body, headers: init.headers || {}, signal: init.signal });
    if (route === '/agent/engines') {
      if (state.enginesError) {
        return jsonResponse({ error: { code: state.enginesError.code, message: '' } }, state.enginesError.status);
      }
      return jsonResponse(state.engines);
    }
    if (route === '/agent/usage/me') {
      if (state.usageError) {
        return jsonResponse({ error: { code: state.usageError.code || 'unavailable', message: '' } }, state.usageError.status);
      }
      if (state.deferUsage) await new Promise((resolve) => { state.releaseUsage = resolve; });
      return jsonResponse(state.usage);
    }
    if (route === '/agent/providers') {
      return jsonResponse(state.providers || { items: [], canManageGlobal: false, canManagePersonal: true });
    }
    if (route === '/agent/preferences' && method === 'PUT') {
      state.preference = body;
      return jsonResponse(body);
    }
    if (route === '/agent/sessions' && method === 'POST') {
      state.createCount += 1;
      return jsonResponse(
        { id: 'sess-' + state.createCount, instanceId: body.instanceId, model: body.model, providerId: body.providerId || null, messages: [] },
        201
      );
    }
    if (/^\/agent\/sessions\/[^/]+$/.test(route) && method === 'PATCH') {
      state.patch = body;
      if (state.patchPending) await new Promise((resolve) => { state.releasePatch = resolve; });
      if (state.patchError) {
        return jsonResponse({ error: { code: 'unavailable', message: state.patchError.message } }, state.patchError.status);
      }
      const patchedModel = body.model || (body.providerId ? 'personal-model' : (body.providerId === null ? 'opencode/free-a' : undefined));
      return jsonResponse({ id: route.split('/').pop(), instanceId: body.instanceId || ENGINE_ID, model: patchedModel, providerId: body.providerId === undefined ? null : body.providerId });
    }
    if (/^\/agent\/sessions\/[^/]+$/.test(route) && method === 'GET') {
      return jsonResponse(
        state.sessionSnapshot || {
          id: route.split('/').pop(),
          messages: [],
          actions: [],
          results: [],
          approvalPending: false
        }
      );
    }
    if (/^\/agent\/sessions\/[^/]+\/attachments$/.test(route) && method === 'POST') {
      if (state.uploadGate) await state.uploadGate;
      if (state.uploadFailure) {
        return jsonResponse({ error: state.uploadFailure }, state.uploadFailure.status || 422);
      }
      const filename = new URLSearchParams(query).get('filename') || '';
      const kind = /\.(png|jpe?g|webp|gif)$/i.test(filename) ? 'image' : (/\.pdf$/i.test(filename) ? 'file' : 'text');
      const item = {
        id: 'att-' + (state.attachments.length + 1),
        filename,
        mediaType: kind === 'image' ? 'image/png' : (kind === 'file' ? 'application/pdf' : 'text/plain'),
        kind,
        size: body && typeof body.byteLength === 'number' ? body.byteLength : 0
      };
      state.attachments.push(item);
      return jsonResponse(item, 201);
    }
    if (/^\/agent\/sessions\/[^/]+\/attachments\/[^/]+$/.test(route) && method === 'DELETE') {
      if (state.deleteAttachmentFailure) {
        return jsonResponse({ error: state.deleteAttachmentFailure }, state.deleteAttachmentFailure.status || 422);
      }
      const attachmentId = route.split('/').pop();
      state.attachments = state.attachments.filter((item) => item.id !== attachmentId);
      return { ok: true, status: 204, json: async () => null, blob: async () => new Blob([]) };
    }
    if (/^\/agent\/sessions\/[^/]+\/messages$/.test(route) && method === 'POST') {
      if (state.messageError) return jsonResponse({ error: state.messageError }, state.messageError.status || 422);
      return state.messageResponse || sseResponse(typeof state.frames === 'function' ? state.frames(body) : state.frames);
    }
    if (/^\/agent\/sessions\/[^/]+\/cancel$/.test(route) && method === 'POST') {
      state.cancelCalls = (state.cancelCalls || 0) + 1;
      return jsonResponse(state.cancelResult);
    }
    if (/^\/assets\/[^/]+\/attachments$/.test(route)) {
      state.assetAttachmentQuery = query;
      return jsonResponse(state.assetAttachments);
    }
    if (route === '/agent/chat') {
      return jsonResponse({ message: 'Respuesta compatible', actions: [], results: [] });
    }
    return jsonResponse({ error: { code: 'not_found', message: '' } }, 404);
  };
  const mounted = mount('AssetConversation', { app });
  return { c, app, mount: mounted, vm: mounted.instance, calls, state, settle, listeners };
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

test('the rendered provider selector keeps a chosen engine with no models', async () => {
  const payload = enginesPayload();
  payload.instances = payload.instances.filter((instance) => instance.id !== ENGINE_ID);
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

  const select = findById(surface.mount.root, 'conversation-provider');
  assert.ok(select, 'the rendered provider selector exists');
  const change = (select.listeners && select.listeners.change) ||
    (select.props && (select.props.onChange || select.props['onUpdate:modelValue']));
  assert.ok(change, 'the rendered provider selector is wired');
  // A real DOM Event exposes target through its prototype, not as an own field.
  // Exercise that shape so the rendered handler is not proven only by a mock.
  select.value = 'engine:opencode-empty';
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

test('a same-engine profile switch patches the ITSM session without replaying the transcript', async () => {
  const surface = sessionSurface({ engines: hermesPayload() });
  await surface.settle();
  const vm = surface.vm;
  vm.draft = 'Consulta inicial';
  assert.equal(await vm.send(), true);
  vm.draft = 'Borrador sin enviar';
  const transcript = JSON.parse(JSON.stringify(vm.messages));
  const sessionId = vm.sessionId;
  assert.equal(sessionId, 'sess-1');

  const providerSelect = findById(surface.mount.root, 'conversation-provider');
  assert.ok(providerSelect, 'the rendered provider selector exists');
  const providerOptions = optionsOf(providerSelect);
  const values = providerOptions.map(option => option.props.value);
  assert.ok(values.includes('engine:hermes-itsm'), 'the active Hermes profile is selectable');
  assert.ok(values.includes('engine:hermes-default'), 'every authorized Hermes profile is selectable');
  const labels = providerOptions.map(option => vnodeText(option).trim());
  assert.equal(new Set(labels).size, labels.length, 'each profile has a distinguishable label');
  assert.match(labels.join(' | '), /Hermes ITSM/);
  assert.match(labels.join(' | '), /Hermes personal/);
  assert.equal(findById(surface.mount.root, 'conversation-profile'), null, 'the chat never asks for a separate profile');

  const change = changeHandler(providerSelect);
  await change(Object.create({ target: { value: 'engine:hermes-default' } }));
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

test('a rejected profile switch restores the authorized selection and keeps the ITSM session intact', async () => {
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

  assert.equal(await vm.changeProfile('hermes-default'), false);
  await surface.settle();

  assert.equal(findById(surface.mount.root, 'conversation-provider').props.value, 'engine:hermes-itsm');
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
  assert.equal(findById(surface.mount.root, 'conversation-provider').props.disabled, true);
  assert.equal(findById(surface.mount.root, 'conversation-model').props.disabled, true);

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

test('the profile selector is never rendered and Pydantic providers stay distinct', async () => {
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
  const providerSelect = findById(surface.mount.root, 'conversation-provider');
  assert.deepEqual(optionsOf(providerSelect).map(option => option.props.value), ['engine:pydantic-global', 'engine:pydantic-personal']);
  const rendered = vnodeText(surface.mount.root);
  assert.match(rendered, /Proveedor global/);
  assert.match(rendered, /Mi proveedor/);
});

test('a single external profile is selectable through the provider control', async () => {
  const payload = enginesPayload();
  payload.instances.push(hermesInstance('hermes-itsm', 'itsm', 'Hermes ITSM'));
  payload.preference = { instanceId: 'pydantic-built-in', model: 'pydantic:default' };
  const surface = sessionSurface({ engines: payload });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(findById(surface.mount.root, 'conversation-profile'), null);
  const providerSelect = findById(surface.mount.root, 'conversation-provider');
  const option = optionsOf(providerSelect).find(item => item.props.value === 'engine:hermes-itsm');
  assert.ok(option, 'one Hermes provider option is rendered');
  assert.match(vnodeText(option), /Hermes 0\.22\.5/);

  const change = changeHandler(providerSelect);
  providerSelect.value = 'engine:hermes-itsm';
  assert.equal(await change(Object.create({ target: providerSelect })), true);
  assert.equal(vm.agentPreference.instanceId, 'hermes-itsm');
  assert.equal(vm.agentPreference.model, 'hermes:itsm');
  assert.equal(surface.calls.some(call => call.method === 'PATCH'), false);
  const saved = surface.calls.filter(call => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'hermes-itsm', model: 'hermes:itsm' });
});

test('the conversation never renders or requests routine quota, budget or usage dashboards', async () => {
  const surface = sessionSurface();
  await surface.settle();
  assert.equal(surface.calls.filter(call => call.path === '/agent/usage/me').length, 0, 'no routine quota traffic');
  const rendered = vnodeText(surface.mount.root);
  assert.doesNotMatch(rendered, /Tu cuota diaria de IA|Consumido:|Reservado:|Límite diario|Presupuesto diario/);
  assert.equal(findById(surface.mount.root, 'conversation-quota'), null);
  assert.equal(findById(surface.mount.root, 'conversation-usage'), null);
  assert.equal(surface.vm.usage, null);
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
  assert.equal(findById(surface.mount.root, 'conversation-usage'), null, 'technical usage stays out of the transcript');
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
  assert.equal(findById(surface.mount.root, 'conversation-usage'), null);
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
  assert.equal(findById(surface.mount.root, 'conversation-usage'), null);
});

test('a submitted extension offers human review without treating its candidate as an asset', async () => {
  const { vm, mount, c } = mountConversation();
  const candidateId = '22222222-3333-4444-5555-666666666666';
  vm.applyDone({ approvalPending: true, results: [{
    type: 'extension_review', candidateId, extensionId: 'record-registry',
    version: '1.0.0', digest: 'a'.repeat(64),
    reviewUrl: 'https://untrusted.example/approve'
  }] });
  await c.Vue.nextTick();
  const link = findById(mount.root, 'conversation-extension-review-' + candidateId);
  assert.ok(link, 'human review must be an actionable native link');
  assert.equal(link.props.href, '#/configuracion/extensiones?candidato=' + candidateId);
  assert.equal(vm.results.length, 0, 'candidates are not inventory assets');
  assert.equal(vm.approvalPending, true);
  vm.resetSurface();
  await c.Vue.nextTick();
  assert.equal(findById(mount.root, 'conversation-extension-review-' + candidateId), null);
});

test('malformed candidate review data never becomes an actionable approval link', () => {
  const { vm, mount } = mountConversation();
  vm.applyDone({ results: [{ type: 'extension_review', candidateId: '../admin', digest: 'bad' }] });
  assert.equal(findById(mount.root, 'conversation-extension-reviews'), null);
  assert.equal(vm.results.length, 0);
});

test('a managed engine can switch between the global provider and the user own key', async () => {
  const PERSONAL = '33333333-4444-4555-8666-777777777777';
  const engines = enginesPayload();
  const opencode = engines.instances.find(item => item.id === ENGINE_ID);
  opencode.quota = { mode: 'managed', enforcement: 'admission_only', reason: '', directException: false };
  const surface = sessionSurface({
    engines,
    preference: { instanceId: ENGINE_ID, model: 'opencode/free-a' },
    providers: {
      items: [
        { id: PERSONAL, name: 'Mi OpenRouter', scope: 'personal', enabled: true, models: ['personal-model'], credentialConfigured: true },
        { id: '44444444-5555-4666-8777-888888888888', name: 'Otro global', scope: 'global', enabled: true, models: ['g'], credentialConfigured: true },
        { id: '55555555-6666-4777-8888-999999999999', name: 'Personal apagado', scope: 'personal', enabled: false, models: ['x'], credentialConfigured: true }
      ],
      canManageGlobal: false,
      canManagePersonal: true
    }
  });
  await surface.settle();
  const options = surface.vm.agentProviderOptions.map(option => option.value);
  assert.equal(JSON.stringify(options), JSON.stringify(['', PERSONAL]), 'only the instance global provider and the user enabled personal providers');
  const providerSelect = findById(surface.mount.root, 'conversation-provider');
  assert.deepEqual(optionsOf(providerSelect).map(option => option.props.value), ['engine:pydantic-built-in', 'provider:', 'provider:' + PERSONAL]);

  assert.equal(await surface.vm.changeChatProvider('provider:' + PERSONAL), true);
  assert.equal(surface.vm.managedProviderId, PERSONAL);
  assert.equal(JSON.stringify(surface.vm.agentModels.map(model => model.id)), '["personal-model"]');
  surface.vm.draft = 'Hola';
  assert.equal(await surface.vm.send(), true);
  const created = surface.calls.find(call => call.path === '/agent/sessions' && call.method === 'POST');
  assert.equal(JSON.stringify(created.body), JSON.stringify({ instanceId: ENGINE_ID, model: 'personal-model', providerId: PERSONAL }));
  await surface.settle();
  assert.equal(findById(surface.mount.root, 'conversation-provider').props.value, 'provider:' + PERSONAL);

  assert.equal(await surface.vm.changeChatProvider('provider:'), true);
  const patch = surface.calls.filter(call => /^\/agent\/sessions\/[^/]+$/.test(call.path) && call.method === 'PATCH').pop();
  assert.equal(JSON.stringify(patch.body), '{"providerId":null}');
  assert.equal(surface.vm.sessionProviderId, '');
  assert.equal(surface.vm.agentPreference.model, 'opencode/free-a');
  assert.equal(findById(surface.mount.root, 'conversation-provider').props.value, 'provider:');
  assert.equal(findById(surface.mount.root, 'conversation-model').props.value, 'opencode/free-a');
});

// ---------------------------------------------------------------------------
// Multimodal attachments: owner+session scoped uploads, capability gating and
// existing asset attachments. The server sniffs the bytes; the browser only
// transports them and never persists them.
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 8]);
const TEXT_BYTES = new TextEncoder().encode('orden,serie\n1,ABC\n');
const ASSET_ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ASSET_ATTACHMENT_B_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const plain = value => JSON.parse(JSON.stringify(value));

function chatFile(name, bytes) {
  return new File([bytes || TEXT_BYTES], name);
}

function attachmentPayload(inputs, instanceOverrides) {
  return {
    instances: [
      Object.assign(
        {
          id: ENGINE_ID,
          name: 'OpenCode local',
          engine: 'opencode',
          profile: 'itsm',
          enabled: true,
          attachmentsSupported: true,
          capabilities: { streaming: true, cancel: true, tools: true, usage: true },
          version: '2.1.2',
          models: [
            {
              id: 'opencode/free-a',
              name: 'Gratis A',
              provider: 'opencode',
              free: true,
              inputs: Object.assign({ image: false, file: false }, inputs || {})
            }
          ],
          error: null
        },
        instanceOverrides || {}
      )
    ],
    preference: { instanceId: ENGINE_ID, model: 'opencode/free-a' },
    budget: null
  };
}

test('a chosen file uploads its raw bytes with the session CSRF token and stays pending', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();

  const input = findById(surface.mount.root, 'conversation-attachment');
  assert.ok(input, 'the rendered chat offers a native file chooser');
  assert.equal(input.props.type, 'file');
  assert.equal(input.props.multiple, true);
  const choose = changeHandler(input);
  assert.equal(typeof choose, 'function', 'the file chooser is wired to the surface');
  assert.match(String(input.props.accept), /\.txt/, 'text attachments are offered for a text-capable model');

  input.files = [chatFile('datos.csv')];
  assert.equal(await choose({ target: input }), true);

  const uploads = surface.calls.filter((call) => /\/attachments\?/.test(call.path));
  assert.equal(uploads.length, 1);
  const uploaded = uploads[0];
  assert.equal(uploaded.path, '/agent/sessions/sess-1/attachments?filename=datos.csv');
  assert.equal(uploaded.method, 'POST');
  assert.equal(uploaded.headers['X-CSRF-Token'], 'csrf-session');
  assert.ok(uploaded.rawBody instanceof ArrayBuffer, 'the body is the raw file, not JSON');
  assert.deepEqual(Array.from(new Uint8Array(uploaded.rawBody)), Array.from(TEXT_BYTES));

  assert.equal(surface.vm.attachments.length, 1);
  assert.deepEqual(plain(surface.vm.attachments[0]), {
    id: 'att-1',
    filename: 'datos.csv',
    mediaType: 'text/plain',
    kind: 'text',
    size: TEXT_BYTES.byteLength,
    sizeKnown: true
  });
  assert.equal(surface.vm.sessionAttachmentCount, 1);
  assert.match(vnodeText(surface.mount.root), /datos\.csv/);
});

test('attachment uploads honour the file, per-message, count and session limits', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;
  const uploads = () => surface.calls.filter((call) => /\/attachments\?/.test(call.path)).length;

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('grande.txt', new Uint8Array(4 * 1024 * 1024 + 1))], value: '' } }), false);
  assert.match(vm.attachmentError, /4 MiB/);
  assert.equal(uploads(), 0);

  const five = [1, 2, 3, 4, 5].map((n) => chatFile('nota' + n + '.txt'));
  assert.equal(await vm.attachFiles({ target: { files: five, value: '' } }), false);
  assert.match(vm.attachmentError, /4 archivos/);
  assert.equal(uploads(), 0);

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('tres.txt', new Uint8Array(3 * 1024 * 1024))], value: '' } }), true);
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('dos.txt', new Uint8Array(2 * 1024 * 1024))], value: '' } }), false);
  assert.match(vm.attachmentError, /4 MiB/);
  assert.equal(vm.attachments.length, 1);

  vm.attachments = [];
  vm.sessionAttachmentCount = 20;
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('otra.txt')], value: '' } }), false);
  assert.match(vm.attachmentError, /20/);
});

test('images and PDFs need the model marks while UTF-8 text is allowed for a supported model', async () => {
  const surface = sessionSurface({ engines: attachmentPayload({ image: false, file: false }) });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('foto.png', PNG_BYTES)], value: '' } }), false);
  assert.match(vm.attachmentError, /no admite imágenes/i);
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('informe.pdf', PNG_BYTES)], value: '' } }), false);
  assert.match(vm.attachmentError, /no admite PDF/i);
  assert.equal(surface.calls.filter((call) => /\/attachments\?/.test(call.path)).length, 0);

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('datos.csv')], value: '' } }), true);
  assert.equal(vm.attachmentError, '');
  assert.equal(vm.attachments[0].filename, 'datos.csv');

  const marked = sessionSurface({ engines: attachmentPayload({ image: true, file: true }) });
  await marked.settle();
  const accept = String(findById(marked.mount.root, 'conversation-attachment').props.accept);
  assert.match(accept, /\.png/);
  assert.match(accept, /\.pdf/);
  assert.match(accept, /\.csv/);
  assert.equal(
    await marked.vm.attachFiles({
      target: { files: [chatFile('foto.png', PNG_BYTES), chatFile('informe.pdf', PNG_BYTES)], value: '' }
    }),
    true
  );
  assert.deepEqual(plain(marked.vm.attachments.map((item) => item.kind)), ['image', 'file']);
});

test('an engine without the explicit attachments flag hides the whole attachment control', async () => {
  const surface = sessionSurface({ engines: attachmentPayload({}, { attachmentsSupported: undefined }) });
  await surface.settle();

  assert.equal(findById(surface.mount.root, 'conversation-attachment'), null);
  assert.equal(await surface.vm.attachFiles({ target: { files: [chatFile('datos.txt')], value: '' } }), false);
  assert.equal(surface.calls.filter((call) => /\/attachments\?/.test(call.path)).length, 0);

  const refused = sessionSurface({ engines: attachmentPayload({}, { attachmentsSupported: false }) });
  await refused.settle();
  assert.equal(findById(refused.mount.root, 'conversation-attachment'), null);
  assert.equal(await refused.vm.attachFiles({ target: { files: [chatFile('datos.txt')], value: '' } }), false);
});

test('an attachment-only message is sent with its ids and cleared only after acceptance', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('datos.csv')], value: '' } }), true);
  assert.equal(vm.draft, '');
  assert.equal(vm.canSend, true);

  assert.equal(await vm.send(), true);
  const streamed = surface.calls.filter((call) => /\/messages$/.test(call.path)).pop();
  assert.equal(streamed.body.message, '');
  assert.equal(JSON.stringify(streamed.body.attachmentIds), '["att-1"]');
  assert.equal(streamed.body.assetAttachmentIds, undefined);
  assert.equal(vm.attachments.length, 0);
  assert.match(vnodeText(surface.mount.root), /datos\.csv/);
});

test('asset attachments are listed only after an explicit load and referenced by id', async () => {
  const surface = sessionSurface({
    engines: attachmentPayload({ image: true, file: true }),
    assetAttachments: {
      items: [
        {
          id: ASSET_ATTACHMENT_ID,
          assetId: ASSET_ID,
          filename: 'manual.pdf',
          category: 'manual',
          contentType: 'application/pdf',
          size: 2048,
          sha256: '',
          createdBy: '',
          createdAt: '2026-01-01T00:00:00Z'
        },
        {
          id: ASSET_ATTACHMENT_B_ID,
          assetId: ASSET_ID,
          filename: 'plano.png',
          category: 'photo',
          contentType: 'image/png',
          size: 1024,
          sha256: '',
          createdBy: '',
          createdAt: '2026-01-02T00:00:00Z'
        }
      ],
      hasMore: false,
      total: 2
    }
  });
  await surface.settle();
  const vm = surface.vm;
  surface.app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor', quickCode: 'SRV-1' }];
  vm.selectedAssetId = ASSET_ID;
  await surface.settle();

  assert.equal(vm.assetAttachments.length, 0, 'nothing is listed before an explicit load');
  assert.equal(surface.calls.filter((call) => /\/attachments\?limit=/.test(call.path)).length, 0);

  const load = findById(surface.mount.root, 'conversation-load-asset-attachments');
  assert.ok(load, 'the asset attachment picker offers an explicit load');
  await clickHandler(load)();

  const fetched = surface.calls.find((call) => /^\/assets\//.test(call.path));
  assert.equal(fetched.path, '/assets/' + ASSET_ID + '/attachments?limit=50&offset=0');
  assert.equal(vm.assetAttachments.length, 2);
  assert.equal(vm.assetAttachments[0].filename, 'manual.pdf');

  const checkbox = findById(surface.mount.root, 'conversation-asset-attachment-' + ASSET_ATTACHMENT_ID);
  assert.ok(checkbox, 'each loaded asset attachment can be chosen explicitly');
  await changeHandler(checkbox)({ target: { checked: true } });
  assert.deepEqual(plain(vm.selectedAssetAttachmentIds), [ASSET_ATTACHMENT_ID]);

  vm.draft = 'Resume el manual';
  assert.equal(await vm.send(), true);
  const streamed = surface.calls.filter((call) => /\/messages$/.test(call.path)).pop();
  assert.equal(JSON.stringify(streamed.body.assetAttachmentIds), JSON.stringify([ASSET_ATTACHMENT_ID]));
  assert.equal(streamed.body.message, 'Resume el manual');
  assert.equal(vm.selectedAssetAttachmentIds.length, 0);
});

test('removing a pending attachment deletes it on the server before dropping the row', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('uno.txt'), chatFile('dos.csv')], value: '' } }), true);
  assert.equal(vm.attachments.length, 2);

  const remove = findById(surface.mount.root, 'conversation-attachment-remove-att-1');
  assert.ok(remove, 'each pending attachment offers a remove action');
  await clickHandler(remove)();

  const deleted = surface.calls.filter((call) => call.method === 'DELETE').pop();
  assert.equal(deleted.path, '/agent/sessions/sess-1/attachments/att-1');
  assert.equal(vm.attachments.length, 1);
  assert.equal(vm.attachments[0].id, 'att-2');
  assert.equal(vm.sessionAttachmentCount, 1);
});

test('a resumed conversation renders safe attachment names and never resends bytes or names as history', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;

  vm.applySessionSnapshot({
    id: 'sess-1',
    instanceId: ENGINE_ID,
    model: 'opencode/free-a',
    messages: [
      {
        role: 'user',
        content: '',
        attachments: [
          { id: 'att-9', filename: '../../etc/informe.pdf', mediaType: 'application/pdf', kind: 'file', size: 4096 }
        ]
      },
      { role: 'assistant', content: 'He leído el informe.' }
    ],
    actions: [],
    results: [],
    approvalPending: false
  });
  await surface.settle();

  assert.equal(vm.messages[0].attachments.length, 1);
  assert.equal(vm.messages[0].attachments[0].filename, 'informe.pdf', 'display keeps only the base name');
  assert.match(vnodeText(surface.mount.root), /informe\.pdf/);
  const history = JSON.stringify(vm.history());
  assert.equal(history.indexOf('attachments'), -1);
  assert.equal(history.indexOf('informe.pdf'), -1);
});

test('an upload that resolves after logout is discarded and never revives the surface', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  let release = () => {};
  surface.state.uploadGate = new Promise((resolve) => { release = resolve; });

  const pending = surface.vm.attachFiles({ target: { files: [chatFile('datos.txt')], value: '' } });
  await surface.settle();
  assert.equal(surface.vm.attachmentBusy, true);

  surface.app.authenticated = false;
  await surface.settle();
  release();

  assert.equal(await pending, false);
  assert.equal(surface.vm.attachments.length, 0);
  assert.equal(surface.vm.attachmentBusy, false);
  assert.equal(surface.vm.sessionId, '');
});

test('an upload that resolves after unmount is discarded without touching the old surface', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  let release = () => {};
  surface.state.uploadGate = new Promise((resolve) => { release = resolve; });

  const pending = surface.vm.attachFiles({ target: { files: [chatFile('datos.txt')], value: '' } });
  await surface.settle();
  surface.mount.unmount();
  release();

  assert.equal(await pending, false, 'a late upload never throws into the disposed tree');
  assert.equal(surface.vm.attachments.length, 0);
});

test('pending attachments lock the provider and model selectors', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('datos.csv')], value: '' } }), true);
  await surface.settle();

  for (const id of ['conversation-provider', 'conversation-model']) {
    const control = findById(surface.mount.root, id);
    assert.ok(control, id + ' is rendered');
    assert.equal(control.props.disabled, true, id + ' is locked while attachments are pending');
  }
  assert.equal(vm.chatProviderDisabled, true);
  assert.equal(await vm.changeEngine('pydantic-built-in'), false);
  assert.equal(surface.calls.filter((call) => call.method === 'PATCH').length, 0);
  assert.match(vnodeText(surface.mount.root), /Quita los adjuntos/i);
});

test('a rejected send keeps the draft and attachments for an explicit retry without resending', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('datos.csv')], value: '' } }), true);
  surface.state.messageError = { code: 'engine_attachments_unsupported', message: 'El motor no admite adjuntos.', status: 422 };

  vm.draft = 'Analiza el CSV';
  assert.equal(await vm.send(), false);

  assert.match(vm.error, /no admite adjuntos/i);
  assert.equal(vm.messages.length, 0, 'the rejected turn is not shown as sent');
  assert.equal(vm.draft, 'Analiza el CSV');
  assert.equal(vm.attachments.length, 1);
  assert.equal(surface.calls.filter((call) => /\/messages$/.test(call.path)).length, 1);
});

test('an asset-attachment-only message is sent from the rendered form', async () => {
  const surface = sessionSurface({
    engines: attachmentPayload(),
    assetAttachments: { items: [{ id: ASSET_ATTACHMENT_ID, filename: 'manual.pdf', kind: 'file', size: 1024 }], hasMore: false, total: 1 }
  });
  await surface.settle();
  const vm = surface.vm;
  surface.app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor', quickCode: 'SRV-1' }];
  vm.selectedAssetId = ASSET_ID;
  await surface.settle();
  await clickHandler(findById(surface.mount.root, 'conversation-load-asset-attachments'))();
  await surface.settle();
  await changeHandler(findById(surface.mount.root, 'conversation-asset-attachment-' + ASSET_ATTACHMENT_ID))({ target: { checked: true } });
  await surface.settle();

  assert.equal(vm.draft, '');
  assert.equal(vm.canSend, true, 'a checked asset attachment is message content on its own');
  const submit = findById(surface.mount.root, 'conversation-send');
  assert.ok(submit, 'the rendered send control exists');
  assert.equal(submit.props.disabled, false, 'the rendered send control is enabled for the asset-only turn');

  const form = findById(surface.mount.root, 'conversation-form');
  assert.equal(typeof form.props.onSubmit, 'function', 'the rendered form submits through its own handler');
  await form.props.onSubmit({ preventDefault() {} });
  await surface.settle();

  const streamed = surface.calls.filter((call) => /\/messages$/.test(call.path)).pop();
  assert.equal(streamed.body.message, '');
  assert.equal(JSON.stringify(streamed.body.assetAttachmentIds), JSON.stringify([ASSET_ATTACHMENT_ID]));
  assert.equal('attachmentIds' in streamed.body, false, 'no chat upload id is invented for an asset attachment');
  assert.equal(vm.selectedAssetAttachmentIds.length, 0);
});

test('chat and asset attachments share the four-file and four-megabyte message bounds', async () => {
  const MIB = 1024 * 1024;
  const surface = sessionSurface({
    engines: attachmentPayload(),
    assetAttachments: {
      items: [
        { id: ASSET_ATTACHMENT_ID, filename: 'pesado.pdf', kind: 'file', size: 3 * MIB },
        { id: ASSET_ATTACHMENT_B_ID, filename: 'justo.pdf', kind: 'file', size: 1 * MIB },
        { id: 'cccccccc-dddd-4eee-8fff-000000000000', filename: 'extra.txt', kind: 'text', size: 1 }
      ],
      hasMore: false,
      total: 3
    }
  });
  await surface.settle();
  const vm = surface.vm;
  surface.app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor', quickCode: 'SRV-1' }];
  vm.selectedAssetId = ASSET_ID;
  await surface.settle();
  await clickHandler(findById(surface.mount.root, 'conversation-load-asset-attachments'))();
  await surface.settle();

  const choose = async (id, checked) => {
    await changeHandler(findById(surface.mount.root, 'conversation-asset-attachment-' + id))({ target: { checked } });
    await surface.settle();
  };

  await choose(ASSET_ATTACHMENT_ID, true);
  await choose(ASSET_ATTACHMENT_B_ID, true);
  assert.equal(vm.selectedAssetAttachmentIds.length, 2, 'two attachments adding up to exactly 4 MiB are accepted');
  assert.equal(vm.attachmentError, '');

  await choose('cccccccc-dddd-4eee-8fff-000000000000', true);
  assert.equal(vm.selectedAssetAttachmentIds.length, 2, 'a selection over the shared byte budget is refused');
  assert.match(vm.attachmentError, /4 MiB/);

  const uploads = () => surface.calls.filter((call) => call.method === 'POST' && /\/attachments\?/.test(call.path)).length;
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('nota.txt')], value: '' } }), false);
  assert.match(vm.attachmentError, /4 MiB/);
  assert.equal(uploads(), 0, 'no upload leaves the browser when the combined budget is already spent');

  await choose(ASSET_ATTACHMENT_B_ID, false);
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('a.txt'), chatFile('b.txt'), chatFile('c.txt')], value: '' } }), true);
  assert.equal(vm.attachments.length, 3);

  await choose(ASSET_ATTACHMENT_B_ID, true);
  assert.equal(vm.selectedAssetAttachmentIds.length, 1, 'the combined four-file bound rejects the fifth row');
  assert.match(vm.attachmentError, /4 archivos/);

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('d.txt')], value: '' } }), false);
  assert.match(vm.attachmentError, /4 archivos/);
  assert.equal(uploads(), 3);
});

test('an asset attachment without a server size is never selected or counted as zero', async () => {
  const surface = sessionSurface({
    engines: attachmentPayload(),
    assetAttachments: { items: [{ id: ASSET_ATTACHMENT_ID, filename: 'sin-tamano.pdf', kind: 'file' }], hasMore: false, total: 1 }
  });
  await surface.settle();
  const vm = surface.vm;
  surface.app.inventory.items = [{ id: ASSET_ID, serverAsset: true, name: 'Servidor', quickCode: 'SRV-1' }];
  vm.selectedAssetId = ASSET_ID;
  await surface.settle();
  await clickHandler(findById(surface.mount.root, 'conversation-load-asset-attachments'))();
  await surface.settle();

  await changeHandler(findById(surface.mount.root, 'conversation-asset-attachment-' + ASSET_ATTACHMENT_ID))({ target: { checked: true } });
  await surface.settle();

  assert.equal(vm.selectedAssetAttachmentIds.length, 0);
  assert.match(vm.attachmentError, /no informó el tamaño/i);
  assert.equal(vm.canSend, false, 'an unverifiable attachment cannot become the only content');
  assert.match(vnodeText(surface.mount.root), /Tamaño no informado/);
});

test('a personal provider admits an image only for the model the owner marked', async () => {
  const PERSONAL = '33333333-4444-4555-8666-777777777777';
  const engines = attachmentPayload({ image: false, file: false });
  engines.instances[0].quota = { mode: 'managed', enforcement: 'admission_only', reason: '', directException: false };
  const surface = sessionSurface({
    engines,
    providers: {
      items: [
        {
          id: PERSONAL,
          name: 'Mi proveedor',
          scope: 'personal',
          enabled: true,
          models: ['marcado', 'sin-marca'],
          modelCapabilities: { marcado: { image: true, file: null }, 'sin-marca': { image: null, file: true } },
          credentialConfigured: true
        }
      ],
      canManageGlobal: false,
      canManagePersonal: true
    }
  });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(await vm.changeProvider(PERSONAL), true);
  assert.equal(vm.agentPreference.model, 'marcado');
  assert.equal(vm.chatAttachmentSupport.image, true, 'an explicit owner mark admits images');
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('foto.png', PNG_BYTES)], value: '' } }), true);
  assert.equal(vm.attachments.length, 1);
  assert.equal(await vm.removeAttachment(vm.attachments[0].id), true);

  assert.equal(await vm.changeModel('sin-marca'), true);
  assert.equal(vm.chatAttachmentSupport.image, false, 'an unknown mark never admits images');
  assert.equal(vm.chatAttachmentSupport.file, true, 'the other marked modality stays available');
  const uploads = surface.calls.filter((call) => /\/attachments\?/.test(call.path)).length;
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('otra.png', PNG_BYTES)], value: '' } }), false);
  assert.match(vm.attachmentError, /no admite imágenes/i);
  assert.equal(surface.calls.filter((call) => /\/attachments\?/.test(call.path)).length, uploads);
  assert.equal(await vm.attachFiles({ target: { files: [chatFile('informe.pdf', TEXT_BYTES)], value: '' } }), true);
  assert.equal(vm.attachments.length, 1);
  assert.equal(vm.attachments[0].kind, 'file');
});

test('a rejected pending attachment deletion keeps the row and reports the server error', async () => {
  const surface = sessionSurface({ engines: attachmentPayload() });
  await surface.settle();
  const vm = surface.vm;

  assert.equal(await vm.attachFiles({ target: { files: [chatFile('datos.txt')], value: '' } }), true);
  assert.equal(vm.attachments.length, 1);
  surface.state.deleteAttachmentFailure = { code: 'conflict', message: 'El adjunto está en uso.', status: 409 };

  assert.equal(await vm.removeAttachment(vm.attachments[0].id), false);
  assert.equal(vm.attachments.length, 1, 'the row stays until the server confirms the deletion');
  assert.equal(vm.sessionAttachmentCount, 1);
  assert.match(vm.attachmentError, /en uso/i);
});

/* --- Entradas: píldora de la barra y botón flotante --- */

test('the floating chat button renders with its own accessible contract', async () => {
  const surface = sessionSurface({ route: { name: 'panel' } });
  await surface.settle();

  const fab = findById(surface.mount.root, 'conversation-fab');
  assert.ok(fab, 'conversation-fab is rendered');
  assert.equal(fab.tag, 'button');
  assert.equal(fab.props.type, 'button');
  assert.equal(fab.props['aria-controls'], 'conversation-surface');
  assert.equal(fab.props['aria-expanded'], false);
  assert.equal(typeof fab.props['aria-label'], 'string');
  assert.ok(fab.props['aria-label'].length > 0, 'the button is labelled');
  assert.equal(fab.props.hidden, false, 'it starts visible');
  assert.match(String(fab.props.class), /conversation-fab/);

  const opener = findById(surface.mount.root, 'conversation-opener');
  assert.ok(opener, 'the top-bar entry stays');
  assert.equal(opener.props['aria-controls'], 'conversation-surface');
  surface.mount.unmount();
});

test('the floating chat button is withdrawn on the full route and over canvases', async () => {
  const full = sessionSurface();
  await full.settle();
  assert.equal(findById(full.mount.root, 'conversation-fab'), null, 'the full surface draws no floating entry');
  full.mount.unmount();

  const surface = sessionSurface({ route: { name: 'panel' } });
  await surface.settle();
  for (const name of ['graph', 'map']) {
    surface.app.route = { name, assetId: null, personId: null, section: null };
    await surface.settle();
    assert.equal(findById(surface.mount.root, 'conversation-fab'), null, name + ' keeps its canvas clear');
    assert.ok(findById(surface.mount.root, 'conversation-opener'), 'the top-bar entry still works on ' + name);
  }

  surface.app.route = { name: 'inventory' };
  await surface.settle();
  assert.ok(findById(surface.mount.root, 'conversation-fab'), 'any other module keeps the floating entry');
  surface.mount.unmount();
});

test('the floating chat button hides while its panel is open and Escape returns focus to it', async () => {
  const surface = sessionSurface({ route: { name: 'panel' } });
  await surface.settle();

  const fab = findById(surface.mount.root, 'conversation-fab');
  let focused = 0;
  const fabElement = { id: 'conversation-fab', focus() { focused += 1; } };
  await clickHandler(fab)({ currentTarget: fabElement });
  await surface.settle();

  assert.equal(surface.vm.panelOpen, true);
  assert.equal(surface.vm.panelAnchor, 'fab');
  assert.equal(findById(surface.mount.root, 'conversation-fab').props.hidden, true, 'the button gives way to its panel');
  const section = findById(surface.mount.root, 'conversation-surface');
  assert.match(String(section.props.class), /conversation--from-fab/);

  surface.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  await surface.settle();

  assert.equal(surface.vm.panelOpen, false);
  assert.equal(focused, 1, 'Escape returns focus to the floating button that opened the panel');
  assert.equal(findById(surface.mount.root, 'conversation-fab').props.hidden, false);
  assert.doesNotMatch(String(findById(surface.mount.root, 'conversation-surface').props.class), /conversation--from-fab/);
  surface.mount.unmount();
});
