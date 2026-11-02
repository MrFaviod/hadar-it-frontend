'use strict';
// T3 JS-string follow-up: the managed-provider selector builds its option
// labels in JavaScript. They must resolve through `ui.chat.*` at read time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function conversationFixture() {
  const s = setup();
  const mounted = s.mount('AssetConversation', { app: s.app });
  const vm = mounted.instance;
  vm.agentEngines = [
    { id: 'engine-1', engine: 'opencode', label: 'OpenCode', models: [{ id: 'model-a' }], quota: { mode: 'managed' } }
  ];
  vm.agentPreference = { instanceId: 'engine-1', model: 'model-a' };
  vm.chatProviders = [
    { id: 'provider-1', name: 'Mi OpenRouter', models: ['model-a'], capabilities: {} }
  ];
  return { s, vm, i18n: s.c.ItsmI18n, unmount: mounted.unmount };
}

test('managed provider options name the organization provider in the active locale', () => {
  const { vm, i18n, unmount } = conversationFixture();
  i18n.setLocale('es');
  assert.deepEqual(Array.from(vm.agentProviderOptions, (option) => option.label), [
    'Proveedor de la organización',
    'Mi OpenRouter · Tu clave'
  ]);
  i18n.setLocale('en');
  assert.deepEqual(Array.from(vm.agentProviderOptions, (option) => option.label), [
    'Organization provider',
    'Mi OpenRouter · Your key'
  ]);
  assert.deepEqual(Array.from(vm.agentProviderOptions, (option) => option.value), ['', 'provider-1'], 'provider ids stay stable');
  i18n.setLocale('es');
  unmount();
});
