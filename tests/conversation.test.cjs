'use strict';
// Focused conversation surface: the browser posts to the server agent endpoint,
// shows factual unavailability, and never parses business operations itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';

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
