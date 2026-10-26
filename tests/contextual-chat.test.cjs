'use strict';
// Public component events + canonical HTTP boundary. Real browser layout/focus
// is checked by the parent; the renderer pins identity and state continuity.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const plain = value => JSON.parse(JSON.stringify(value));
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
function text(node) {
  return (node.text || '') + (node.children || []).map(text).join(' ');
}
function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => plain(payload) };
}
function surface(config = {}) {
  const ui = setup();
  ui.app.route = { name: 'panel' };
  ui.c.location.hash = '#/panel';
  ui.app.csrfToken = 'fixture-csrf';
  const listeners = new Map();
  ui.c.document.addEventListener = (name, callback) => listeners.set(name, callback);
  ui.c.document.removeEventListener = name => listeners.delete(name);
  const state = {
    instances: [
      { id: 'internal', name: 'Pydantic AI', engine: 'pydantic', enabled: true, models: [{ id: 'model-a' }, { id: 'model-b' }], capabilities: { tools: true } },
      { id: 'external', name: 'OpenCode', engine: 'opencode', enabled: true, models: [{ id: 'external-model' }], capabilities: { tools: true, streaming: true } }
    ],
    preference: { instanceId: 'internal', model: 'model-a' },
    session: { id: 'saved-own', instanceId: 'external', model: 'external-model', status: 'idle', messages: [{ role: 'user', content: 'Consulta guardada' }, { role: 'assistant', content: 'Respuesta guardada' }], actions: [], results: [], approvalPending: false },
    providers: { items: [{ id: 'global-one', name: 'Proveedor de instalación', scope: 'global', baseUrl: 'https://global.example/v1', models: ['model-a'], credentialConfigured: true, enabled: true }], canManageGlobal: false, canManagePersonal: false, credentialStorageAvailable: true },
    ...config
  };
  const calls = [];
  ui.c.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body, signal: init.signal, headers: init.headers });
    if (path === '/agent/engines') return response({ instances: state.instances, preference: state.preference });
    if (path === '/agent/preferences') { state.preference = body; return response(body); }
    if (path === '/agent/sessions' && method === 'GET') return response({ sessions: [{ id: 'saved-own', instanceId: 'external', model: 'external-model', status: 'idle', title: 'Consulta guardada' }] });
    if (path === '/agent/sessions' && method === 'POST') return response({ id: 'active-own', instanceId: body.instanceId, model: body.model, messages: [] }, 201);
    if (/^\/agent\/sessions\/[^/]+$/.test(path)) {
      if (method === 'PATCH') return state.patchError
        ? response({ error: { code: 'forbidden', message: 'El perfil no autoriza este motor.' } }, 403)
        : response({ id: path.split('/').pop(), instanceId: body.instanceId || state.session.instanceId, model: body.model });
      if (state.pendingSnapshot) return state.pendingSnapshot;
      return response(state.session);
    }
    if (path.endsWith('/messages')) {
      if (state.holdStream) {
        let sent = false;
        return { ok: true, status: 200, body: { getReader: () => ({
          read: async () => {
            if (sent) return { done: true };
            sent = true;
            await new Promise(resolve => { state.release = resolve; });
            return { done: false, value: new TextEncoder().encode('data: {"type":"delta","text":"Respuesta tardía"}\n\ndata: {"type":"done"}\n\n') };
          }, releaseLock() {}
        }) } };
      }
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode('data: {"type":"delta","text":"Respuesta"}\n\ndata: {"type":"done"}\n\n') }), releaseLock() {} }) } };
    }
    if (path === '/agent/providers' && method === 'GET') return response(state.providers);
    if (path.startsWith('/agent/providers') && method !== 'GET') {
      if (state.providerError) return response({ error: { code: 'unavailable', message: 'Falta ITSM_AI_CREDENTIAL_KEY en el servidor.' } }, 503);
      if (method === 'DELETE') state.providers.items = state.providers.items.filter(item => !path.endsWith('/' + item.id));
      else {
        const record = { id: 'personal-one', ...body, credentialConfigured: !!body.apiKey };
        delete record.apiKey;
        state.providers.items = state.providers.items.filter(item => item.id !== record.id).concat(record);
      }
      return response(null, 204);
    }
    return response({ error: { code: 'not_found' } }, 404);
  };
  const mounted = ui.mount(config.component || 'AssetConversation');
  return { ...ui, mounted, vm: mounted.instance, state, calls, listeners };
}
function control(ui, id) {
  const node = find(ui.mounted.root, node => node.props && node.props.id === id);
  assert.ok(node, id + ' is rendered');
  return node;
}
async function fill(ui, id, value) {
  const input = control(ui, id);
  input.value = value;
  input.listeners.input({ target: input });
  await ui.settle();
}
async function open(ui) {
  await control(ui, 'conversation-opener').props.onClick({ currentTarget: control(ui, 'conversation-opener') });
  await ui.settle();
}

test('chat is closed by default and opens without leaving its module; Escape restores its native opener', async () => {
  const ui = surface();
  const opener = control(ui, 'conversation-opener');
  assert.equal(opener.tag, 'button');
  assert.equal(opener.props['aria-expanded'], false);
  let focused = 0;
  opener.focus = () => { focused += 1; };
  await open(ui);
  assert.equal(ui.app.route.name, 'panel');
  assert.equal(control(ui, 'conversation-opener').props['aria-expanded'], true);
  assert.equal(control(ui, 'conversation-surface').props['aria-modal'], undefined);
  ui.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  await ui.settle();
  assert.equal(control(ui, 'conversation-opener').props['aria-expanded'], false);
  assert.equal(focused, 1);
  ui.mounted.unmount();
  assert.equal(ui.listeners.has('keydown'), false);
});

test('navigation and full-to-compact expansion keep one live stream, transcript and draft', async () => {
  const ui = surface({ holdStream: true });
  await open(ui);
  ui.vm.draft = 'Consulta en curso';
  const pending = ui.vm.send();
  await ui.settle();
  const stream = ui.calls.find(call => call.path.endsWith('/messages'));
  assert.ok(stream);
  ui.vm.draft = 'Borrador siguiente';
  ui.app.route = { name: 'inventory' };
  await ui.settle();
  await control(ui, 'conversation-expand').props.onClick();
  assert.equal(ui.app.lastHash, '#/conversacion');
  ui.app.route = { name: 'conversation' };
  await ui.settle();
  assert.equal(stream.signal.aborted, false);
  assert.equal(ui.vm.draft, 'Borrador siguiente');
  await control(ui, 'conversation-collapse').props.onClick();
  assert.equal(ui.app.lastHash, '#/inventario');
  ui.app.route = { name: 'inventory' };
  await ui.settle();
  ui.state.release();
  await pending;
  assert.equal(ui.vm.sessionId, 'active-own');
  assert.equal(ui.vm.messages.map(item => item.content).join('|'), 'Consulta en curso|Respuesta tardía');
  assert.equal(ui.calls.filter(call => call.path === '/agent/sessions' && call.method === 'POST').length, 1);
  ui.mounted.unmount();
});

test('account switch off the full route aborts and erases private draft, history, preference and late frames', async () => {
  const ui = surface({ holdStream: true });
  await open(ui);
  ui.vm.draft = 'Consulta privada';
  const pending = ui.vm.send();
  await ui.settle();
  const stream = ui.calls.find(call => call.path.endsWith('/messages'));
  ui.vm.draft = 'Borrador privado';
  ui.app.activeUserId = 'other-user';
  assert.equal(stream.signal.aborted, true, 'identity invalidation is synchronous');
  ui.state.release();
  await pending;
  await ui.settle();
  assert.equal(ui.vm.messages.length, 0);
  assert.equal(ui.vm.draft, '');
  assert.equal(ui.vm.sessionId, '');
  assert.equal(ui.vm.agentPreference.instanceId, '');
  assert.equal(control(ui, 'conversation-opener').props['aria-expanded'], false);
  ui.mounted.unmount();
});

test('logout and unmount each abort a compact stream and cannot revive private data', async () => {
  for (const action of ['logout', 'unmount']) {
    const ui = surface({ holdStream: true });
    await open(ui);
    ui.vm.draft = 'Privado';
    const pending = ui.vm.send();
    await ui.settle();
    const signal = ui.calls.find(call => call.path.endsWith('/messages')).signal;
    if (action === 'logout') ui.app.authenticated = false;
    else ui.mounted.unmount();
    assert.equal(signal.aborted, true);
    ui.state.release();
    await pending;
    assert.equal(ui.vm.messages.length, 0);
    assert.equal(ui.vm.draft, '');
    if (action === 'logout') ui.mounted.unmount();
  }
});

test('saved own sessions resume server transcript without resending or overwriting user preference', async () => {
  const ui = surface();
  await open(ui);
  const picker = control(ui, 'conversation-session');
  await picker.props.onChange({ target: { value: 'saved-own' } });
  await ui.settle();
  assert.equal(ui.vm.sessionId, 'saved-own');
  assert.equal(ui.vm.messages.map(item => item.content).join('|'), 'Consulta guardada|Respuesta guardada');
  assert.equal(ui.vm.agentPreference.instanceId, 'external');
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
  assert.equal(ui.state.preference.instanceId, 'internal');
  ui.mounted.unmount();
});

test('resumed session keeps its engine and draft through close, reopen and full expansion independently of saved preference', async () => {
  const ui = surface();
  await open(ui);
  await control(ui, 'conversation-session').props.onChange({ target: { value: 'saved-own' } });
  ui.vm.draft = 'Borrador guardado';
  ui.vm.closePanel();
  await open(ui);
  ui.app.route = { name: 'conversation' };
  await ui.settle();
  assert.equal(ui.vm.sessionId, 'saved-own');
  assert.equal(ui.vm.agentPreference.instanceId, 'external');
  assert.equal(ui.vm.agentPreference.model, 'external-model');
  assert.equal(ui.vm.draft, 'Borrador guardado');
  assert.equal(ui.vm.messages.length, 2);
  assert.equal(ui.state.preference.instanceId, 'internal');
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
  ui.mounted.unmount();
});

test('an unavailable resumed model never heals or overwrites the independent saved preference', async () => {
  const ui = surface();
  await open(ui);
  await control(ui, 'conversation-session').props.onChange({ target: { value: 'saved-own' } });
  ui.state.instances = ui.state.instances.filter(instance => instance.id !== 'external');
  ui.vm.closePanel();
  await open(ui);
  assert.equal(ui.vm.sessionId, 'saved-own');
  assert.equal(ui.vm.agentPreference.instanceId, 'external');
  assert.equal(ui.vm.canSend, false);
  assert.equal(ui.state.preference.instanceId, 'internal');
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
  ui.mounted.unmount();
});

test('starting a new conversation uses the independently saved preference after a resume', async () => {
  const ui = surface();
  await open(ui);
  await control(ui, 'conversation-session').props.onChange({ target: { value: 'saved-own' } });
  await ui.settle();
  await control(ui, 'conversation-session').props.onChange({ target: { value: '' } });
  assert.equal(ui.vm.sessionId, '');
  assert.equal(ui.vm.messages.length, 0);
  assert.equal(ui.vm.draft, '');
  assert.equal(ui.vm.agentPreference.instanceId, 'internal');
  assert.equal(ui.vm.agentPreference.model, 'model-a');
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
  ui.mounted.unmount();
});

test('engine transition patches the same ITSM session and preserves transcript with no replay', async () => {
  const ui = surface();
  await open(ui);
  ui.vm.draft = 'Primera consulta';
  await ui.vm.send();
  const before = plain(ui.vm.messages);
  await control(ui, 'conversation-engine').props.onChange({ target: { value: 'external' } });
  assert.equal(ui.vm.sessionId, 'active-own');
  assert.deepEqual(plain(ui.vm.messages), before);
  const patch = ui.calls.find(call => call.method === 'PATCH');
  assert.equal(patch.path, '/agent/sessions/active-own');
  assert.deepEqual(patch.body, { instanceId: 'external', model: 'external-model' });
  assert.equal(ui.calls.filter(call => call.path.endsWith('/messages')).length, 1);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 2);
  ui.mounted.unmount();
});

test('refused engine or model transition keeps the same session, transcript and saved preference', async () => {
  const ui = surface({ patchError: true });
  await open(ui);
  ui.vm.draft = 'Primera consulta';
  await ui.vm.send();
  const before = plain(ui.vm.messages);
  assert.equal(await ui.vm.changeEngine('external'), false);
  assert.equal(await ui.vm.changeModel('model-b'), false);
  assert.equal(ui.vm.sessionId, 'active-own');
  assert.equal(ui.vm.agentPreference.instanceId, 'internal');
  assert.equal(ui.vm.agentPreference.model, 'model-a');
  assert.deepEqual(plain(ui.vm.messages), before);
  assert.match(text(ui.mounted.root), /El perfil no autoriza este motor/);
  assert.equal(ui.calls.filter(call => call.path === '/agent/preferences').length, 0);
  ui.mounted.unmount();
});

test('explicit context only uses a canonical server record, never a UUID-shaped demo or alert', async () => {
  const ui = surface();
  ui.app.route = { name: 'detail', assetId: ASSET_ID };
  ui.app.inventoryDetail.asset = { id: ASSET_ID, name: 'Demo', serverAsset: false };
  await open(ui);
  assert.equal(find(ui.mounted.root, node => node.props && node.props.id === 'conversation-use-asset'), null);
  ui.app.inventoryDetail.asset = { id: ASSET_ID, name: 'Servidor real', serverAsset: true };
  await ui.settle();
  await control(ui, 'conversation-use-asset').props.onClick();
  ui.vm.draft = 'Consulta este activo';
  await ui.vm.send();
  assert.equal(ui.calls.find(call => call.path.endsWith('/messages')).body.assetId, ASSET_ID);
  ui.app.route = { name: 'monitorAlert', alertId: 'demo-1' };
  await ui.settle();
  assert.match(text(ui.mounted.root), /demostración/);
  ui.mounted.unmount();
});

test('an ordinary user sees provider status but no provider creation or modification controls', async () => {
  const ui = surface({ component: 'AgentIntegrationsSettings' });
  ui.app.can = permission => permission === 'assets.view';
  await ui.settle();
  assert.match(text(ui.mounted.root), /Proveedor de instalación/);
  assert.match(text(ui.mounted.root), /Credencial configurada/);
  assert.equal(find(ui.mounted.root, node => node.props && /^provider-(new|edit|delete)/.test(node.props.id || '')), null);
  assert.equal(ui.calls.filter(call => call.path.startsWith('/agent/providers') && call.method !== 'GET').length, 0);
  ui.mounted.unmount();
});

test('authorized personal provider writes explicit models and write-only credential using canonical CSRF transport', async () => {
  const ui = surface({ component: 'AgentIntegrationsSettings', providers: { items: [], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true } });
  ui.app.can = permission => ['assets.view', 'agents.providers.personal'].includes(permission);
  await ui.settle();
  assert.equal(find(ui.mounted.root, node => node.props && node.props.id === 'provider-new-global'), null);
  await control(ui, 'provider-new-personal').props.onClick();
  await fill(ui, 'provider-name', 'Mi proveedor');
  await fill(ui, 'provider-url', 'https://personal.example/v1');
  await fill(ui, 'provider-models', 'exact-model-a\nexact-model-b');
  assert.equal(control(ui, 'provider-key').props.type, 'password');
  await fill(ui, 'provider-key', 'fixture-secret-not-readback');
  await control(ui, 'provider-form').props.onSubmit({ preventDefault() {} });
  await ui.settle();
  const saved = ui.calls.find(call => call.path === '/agent/providers' && call.method === 'POST');
  assert.ok(saved, text(ui.mounted.root) + '\n' + ui.errors.map(error => error.stack).join('\n'));
  assert.deepEqual(saved.body, { name: 'Mi proveedor', scope: 'personal', baseUrl: 'https://personal.example/v1', models: ['exact-model-a', 'exact-model-b'], enabled: true, apiKey: 'fixture-secret-not-readback' });
  assert.equal(saved.headers['X-CSRF-Token'], 'fixture-csrf');
  assert.doesNotMatch(text(ui.mounted.root), /fixture-secret-not-readback/);
  assert.equal(find(ui.mounted.root, node => node.props && node.props.id === 'provider-key'), null);
  ui.mounted.unmount();
});

test('global authority stays separate and missing credential storage is a factual visible failure', async () => {
  const ui = surface({ component: 'AgentIntegrationsSettings', providerError: true, providers: { items: [], canManageGlobal: true, canManagePersonal: false, credentialStorageAvailable: false } });
  ui.app.can = permission => ['assets.view', 'system.providers'].includes(permission);
  await ui.settle();
  assert.equal(find(ui.mounted.root, node => node.props && node.props.id === 'provider-new-personal'), null);
  await control(ui, 'provider-new-global').props.onClick();
  assert.equal(control(ui, 'provider-key').props.disabled, true);
  assert.match(text(ui.mounted.root), /ITSM_AI_CREDENTIAL_KEY/);
  await fill(ui, 'provider-name', 'Global');
  await fill(ui, 'provider-url', 'http://operator-lan/v1');
  await fill(ui, 'provider-models', 'operator-model');
  await control(ui, 'provider-form').props.onSubmit({ preventDefault() {} });
  await ui.settle();
  const saved = ui.calls.find(call => call.path === '/agent/providers' && call.method === 'POST');
  assert.ok(saved, text(ui.mounted.root) + '\n' + ui.errors.map(error => error.stack).join('\n'));
  assert.equal(saved.body.scope, 'global');
  assert.equal('apiKey' in saved.body, false);
  assert.match(text(ui.mounted.root), /Falta ITSM_AI_CREDENTIAL_KEY en el servidor/);
  ui.mounted.unmount();
});

test('switching accounts erases provider metadata and in-progress credential input before old reads resolve', async () => {
  const ui = surface({ component: 'AgentProvidersPanel', providers: { items: [], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true } });
  ui.app.can = permission => permission === 'agents.providers.personal';
  await ui.settle();
  await control(ui, 'provider-new-personal').props.onClick();
  await fill(ui, 'provider-key', 'private-draft');
  assert.equal(ui.vm.draft.apiKey, 'private-draft');
  ui.app.activeUserId = 'other-user';
  assert.equal(ui.vm.draft, null);
  assert.equal(ui.vm.items.length, 0);
  assert.equal(ui.vm.canManagePersonal, false);
  ui.app.authenticated = false;
  await ui.settle();
  assert.doesNotMatch(text(ui.mounted.root), /private-draft/);
  ui.mounted.unmount();
});
