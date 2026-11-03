'use strict';
// Distilled conversation surface: the default chat exposes provider, model and
// one configuration action. Quota, budget, capability, session and technical
// usage panels are absent; the transcript, composer, send/cancel, approvals,
// results and actionable failures stay. Provider selection still reuses the
// authorized engine/profile authority and never invents a provider model.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PERSONAL = '33333333-4444-4555-8666-777777777777';
const ASSET_ID = '11111111-2222-3333-4444-555555555555';

function findById(node, id) {
  if (!node) return null;
  if (node.props && node.props.id === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function vnodeText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(vnodeText).join(' ');
  if (!node || typeof node !== 'object') return '';
  return (node.text || '') + ' ' + vnodeText(node.children || []);
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

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(payload)), blob: async () => new Blob([]) };
}

function sseResponse(frames) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (index < frames.length) return Promise.resolve({ value: new TextEncoder().encode(frames[index++]), done: false });
            return Promise.resolve({ value: undefined, done: true });
          },
          releaseLock() {}
        };
      }
    }
  };
}

function enginesFixture() {
  return {
    instances: [
      {
        id: 'pydantic-built-in', name: 'Pydantic AI', engine: 'pydantic', profile: '', enabled: true,
        attachmentsSupported: true,
        capabilities: { streaming: false, cancel: false, tools: true, usage: false }, version: '1.0',
        models: [{ id: 'pydantic:default', name: 'Modelo interno', provider: 'pydantic', free: null }], error: null
      },
      {
        id: 'opencode-local', name: 'OpenCode local', engine: 'opencode', profile: 'itsm', enabled: true,
        capabilities: { streaming: true, cancel: true, tools: true, usage: true }, version: '2.1.2',
        models: [
          { id: 'opencode/free-a', name: 'Gratis A', provider: 'opencode', free: true },
          { id: 'opencode/free-b', name: 'Gratis B', provider: 'opencode', free: true }
        ],
        quota: { mode: 'managed', enforcement: 'admission_only', reason: '', directException: false },
        error: null
      },
      {
        id: 'hermes-itsm', name: 'Hermes ITSM', engine: 'hermes', profile: 'itsm', enabled: true,
        capabilities: { streaming: true, cancel: true, tools: true, usage: true }, version: '0.22.5',
        models: [{ id: 'hermes:itsm', name: 'Modelo itsm', provider: 'hermes', free: null }], error: null
      }
    ],
    preference: { instanceId: 'pydantic-built-in', model: 'pydantic:default' },
    budget: { dailyLimit: 50000, usedMeasured: 1200, usedReported: 300, strictExternal: false }
  };
}

function surface(config = {}) {
  const { c, app, mount, settle } = setup();
  app.route = { name: 'conversation', assetId: null, personId: null, section: null };
  app.csrfToken = 'csrf-distill';
  const calls = [];
  const state = Object.assign({
    engines: enginesFixture(),
    providers: {
      items: [{ id: PERSONAL, name: 'Mi OpenRouter', scope: 'personal', enabled: true, models: ['personal-model'], credentialConfigured: true }],
      canManageGlobal: false,
      canManagePersonal: true
    },
    frames: [
      'data: {"type":"delta","text":"Respuesta"}\n\n',
      'data: {"type":"done","cancelled":false,"actions":[{"tool":"assets.search","status":"completed","assetIds":["' + ASSET_ID + '"]}],"results":[{"id":"' + ASSET_ID + '","name":"Servidor de base de datos"}],"approvalPending":false}\n\n'
    ],
    holdStream: false,
    messageError: null
  }, config);
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    const [route, query = ''] = path.split('?');
    const method = init.method || 'GET';
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { /* raw */ } }
    calls.push({ path: route, query, method, body, headers: init.headers || {}, signal: init.signal });
    if (route === '/agent/engines') return response(state.engines);
    if (route === '/agent/providers') return response(state.providers);
    if (route === '/agent/preferences' && method === 'PUT') { state.preference = body; return response(body); }
    if (route === '/agent/sessions' && method === 'GET') return response({ sessions: [] });
    if (route === '/agent/sessions' && method === 'POST') {
      return response({ id: 'sess-distill', instanceId: body.instanceId, model: body.model, providerId: body.providerId || null, messages: [] }, 201);
    }
    if (/^\/agent\/sessions\/[^/]+$/.test(route) && method === 'PATCH') {
      const patchedModel = body.model || (body.providerId === null ? 'opencode/free-a' : 'personal-model');
      return response({ id: route.split('/').pop(), instanceId: body.instanceId || 'opencode-local', model: patchedModel, providerId: body.providerId === undefined ? null : body.providerId });
    }
    if (/^\/agent\/sessions\/[^/]+\/messages$/.test(route) && method === 'POST') {
      if (state.messageError) return response({ error: state.messageError }, state.messageError.status || 503);
      if (!state.holdStream) return sseResponse(state.frames);
      let sent = false;
      return {
        ok: true, status: 200, body: { getReader: () => ({
          read: async () => {
            if (sent) return { done: true };
            sent = true;
            await new Promise(resolve => { state.release = resolve; });
            return { done: false, value: new TextEncoder().encode('data: {"type":"delta","text":"Tarde"}\n\ndata: {"type":"done"}\n\n') };
          }, releaseLock() {}
        }) }
      };
    }
    if (/^\/agent\/sessions\/[^/]+\/cancel$/.test(route) && method === 'POST') return response({ cancelled: true });
    return response({ error: { code: 'not_found', message: '' } }, 404);
  };
  const mounted = mount('AssetConversation', { app });
  return { c, app, mount: mounted, vm: mounted.instance, calls, state, settle };
}

async function choose(ui, id, value) {
  const select = findById(ui.mount.root, id);
  assert.ok(select, id + ' is rendered');
  const change = changeHandler(select);
  assert.ok(change, id + ' is wired');
  select.value = value;
  // Real DOM events expose target through the prototype, not an own field.
  return change(Object.create({ target: select }));
}

test('the default conversation exposes only provider, model and one configuration action', async () => {
  const ui = surface();
  await ui.settle();

  assert.ok(findById(ui.mount.root, 'conversation-provider'), 'provider selector is rendered');
  assert.ok(findById(ui.mount.root, 'conversation-model'), 'model selector is rendered');
  const config = findById(ui.mount.root, 'conversation-config');
  assert.ok(config, 'configuration action is rendered');
  assert.equal(config.props.href, '#/configuracion/ia');

  for (const id of ['conversation-engine', 'conversation-profile', 'conversation-session', 'conversation-quota', 'conversation-quota-refresh', 'conversation-usage']) {
    assert.equal(findById(ui.mount.root, id), null, id + ' is not part of the distilled surface');
  }

  const rendered = vnodeText(ui.mount.root);
  assert.doesNotMatch(rendered, /Pydantic AI · Pydantic AI/, 'the provider label never repeats the engine name');
  assert.doesNotMatch(rendered, /Motor y modelo/);
  assert.doesNotMatch(rendered, /Tu cuota diaria de IA/);
  assert.doesNotMatch(rendered, /El proveedor de la organización usa el presupuesto/);
  assert.doesNotMatch(rendered, /Cambiar de perfil conserva/);
  assert.doesNotMatch(rendered, /Consumido:|Reservado:|Límite diario|Presupuesto diario/);
  assert.equal(ui.calls.filter(call => call.path === '/agent/usage/me').length, 0, 'no routine quota traffic');

  // The composer, transcript and pending-attachment guard stay available.
  assert.ok(findById(ui.mount.root, 'conversation-form'));
  assert.ok(findById(ui.mount.root, 'conversation-input'));
  assert.ok(findById(ui.mount.root, 'conversation-send'));
  assert.ok(findById(ui.mount.root, 'conversation-attachment'));
  assert.match(vnodeText(findById(ui.mount.root, 'conversation-attachment-help')), /4 MiB/);
});

test('the provider selector switches across engine types using the existing preference authority', async () => {
  const ui = surface();
  await ui.settle();
  const provider = findById(ui.mount.root, 'conversation-provider');
  assert.deepEqual(optionsOf(provider).map(option => option.props.value), [
    'engine:pydantic-built-in', 'engine:opencode-local', 'engine:hermes-itsm'
  ]);
  assert.equal(provider.props.value, 'engine:pydantic-built-in');

  assert.equal(await choose(ui, 'conversation-provider', 'engine:hermes-itsm'), true);
  await ui.settle();
  assert.equal(ui.vm.agentPreference.instanceId, 'hermes-itsm');
  assert.equal(ui.vm.agentPreference.model, 'hermes:itsm');
  const saved = ui.calls.filter(call => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(saved.body, { instanceId: 'hermes-itsm', model: 'hermes:itsm' });
  assert.equal(findById(ui.mount.root, 'conversation-provider').props.value, 'engine:hermes-itsm');
  assert.deepEqual(optionsOf(findById(ui.mount.root, 'conversation-model')).map(option => option.props.value), ['hermes:itsm']);

  assert.equal(await choose(ui, 'conversation-provider', 'engine:opencode-local'), true);
  await ui.settle();
  assert.equal(ui.vm.agentPreference.instanceId, 'opencode-local');
  assert.equal(ui.vm.agentPreference.model, 'opencode/free-a');
});

test('a managed engine offers its organization and personal providers in the same selector', async () => {
  const ui = surface();
  await ui.settle();
  assert.equal(await choose(ui, 'conversation-provider', 'engine:opencode-local'), true);
  await ui.settle();

  const provider = findById(ui.mount.root, 'conversation-provider');
  const values = optionsOf(provider).map(option => option.props.value);
  assert.ok(values.includes('provider:'), 'the organization provider is offered');
  assert.ok(values.includes('provider:' + PERSONAL), 'the personal provider is offered');
  assert.ok(!values.includes('engine:opencode-local'), 'the active managed engine is represented by its provider');
  assert.equal(provider.props.value, 'provider:');

  assert.equal(await choose(ui, 'conversation-provider', 'provider:' + PERSONAL), true);
  await ui.settle();
  assert.equal(ui.vm.managedProviderId, PERSONAL);
  assert.equal(ui.vm.agentPreference.model, 'personal-model');
  assert.equal(findById(ui.mount.root, 'conversation-model').props.value, 'personal-model');

  ui.vm.draft = 'Consulta';
  assert.equal(await ui.vm.send(), true);
  const created = ui.calls.find(call => call.path === '/agent/sessions' && call.method === 'POST');
  assert.equal(created.body.providerId, PERSONAL);
  assert.equal(created.body.model, 'personal-model');

  assert.equal(await choose(ui, 'conversation-provider', 'provider:'), true);
  await ui.settle();
  assert.equal(ui.vm.managedProviderId, '');
  assert.equal(ui.vm.agentPreference.model, 'opencode/free-a');
  const patch = ui.calls.filter(call => /^\/agent\/sessions\/[^/]+$/.test(call.path) && call.method === 'PATCH').pop();
  assert.deepEqual(patch.body, { providerId: null });
});

test('the configuration action is a real route to IA settings and disappears without permission', async () => {
  const ui = surface();
  await ui.settle();
  const config = findById(ui.mount.root, 'conversation-config');
  assert.equal(config.props.href, '#/configuracion/ia');
  const click = clickHandler(config);
  assert.ok(click, 'the configuration action is wired');
  assert.equal(ui.vm.openChatConfig(), true);
  assert.equal(ui.app.lastHash, '#/configuracion/ia');

  ui.app.can = () => false;
  await ui.settle();
  assert.equal(findById(ui.mount.root, 'conversation-config'), null);
});

test('an installation without engines keeps a disabled provider and one actionable configuration path', async () => {
  const ui = surface({ engines: { instances: [], preference: { instanceId: '', model: '' } } });
  await ui.settle();
  const provider = findById(ui.mount.root, 'conversation-provider');
  assert.ok(provider);
  assert.equal(provider.props.disabled, true);
  assert.deepEqual(optionsOf(provider).map(option => vnodeText(option).trim()), ['Sin configurar']);
  assert.equal(findById(ui.mount.root, 'conversation-model').props.disabled, true);
  assert.ok(findById(ui.mount.root, 'conversation-config'));
  assert.doesNotMatch(vnodeText(ui.mount.root), /El servidor no anunció motores/);
});

test('transcript, send, cancel, approvals, results and actionable errors survive', async () => {
  const ui = surface({ holdStream: true });
  await ui.settle();
  ui.vm.draft = 'Busca servidores';
  const pending = ui.vm.send();
  await ui.settle();
  assert.equal(ui.vm.messages[0].content, 'Busca servidores');
  const cancel = findById(ui.mount.root, 'conversation-cancel');
  assert.ok(cancel, 'cancel stays available while the agent runs');
  const cancelClick = clickHandler(cancel);
  assert.ok(cancelClick);
  await cancelClick();
  assert.equal(ui.state.release !== undefined, true, 'the run is cancelled through the server');
  ui.state.release();
  await pending;
  await ui.settle();

  const failing = surface({ messageError: { code: 'unavailable', message: 'El motor no respondió.' } });
  await failing.settle();
  failing.vm.draft = 'Consulta';
  assert.equal(await failing.vm.send(), false);
  await failing.settle();
  assert.match(vnodeText(failing.mount.root), /El motor no respondió\./);
  assert.ok(findById(failing.mount.root, 'conversation-error'), 'the failure is actionable and visible');
});

test('the transcript stays silent until there is a message', async () => {
  const ui = surface();
  await ui.settle();
  const rendered = vnodeText(ui.mount.root);
  assert.doesNotMatch(rendered, /Escribe una consulta|Write a question|Todavía no hay mensajes/);
  assert.equal(findById(ui.mount.root, 'conversation-empty'), null);
});

test('the attachment action is a localized control, not the browser file chrome', async () => {
  const ui = surface();
  await ui.settle();
  const attach = findById(ui.mount.root, 'conversation-attach');
  assert.ok(attach, 'a visible attachment action exists');
  assert.equal(vnodeText(attach).trim(), 'Adjuntos');
  const input = findById(ui.mount.root, 'conversation-attachment');
  assert.ok(input, 'the native input stays in the tree for the picker');
  assert.match(String(input.props.class || ''), /sr-only/);
  const click = clickHandler(attach);
  assert.ok(click, 'the attachment action is wired');
  await click();
  assert.equal(typeof ui.vm.openAttachmentPicker, 'function');
  const rendered = vnodeText(ui.mount.root);
  assert.doesNotMatch(rendered, /Choose Files|No file chosen/);
});
