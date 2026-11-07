'use strict';
// Behavioural coverage for the IA configuration surface: engine preferences,
// exact-target installer runs, shared catalog, verification truthfulness and
// the remote request/receipt workflow. The HTTP boundary is the canonical
// AssetAccess transport, stubbed the same way the shipped application uses it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const ENGINE_ID = 'opencode-local';
const MACHINE_ID = 'machine-opencode-ops';
const GLOBAL_PROVIDER_ID = '11111111-2222-4333-8444-555555555555';
const PERSONAL_PROVIDER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function collectNodes(node, predicate, result) {
  const found = result || [];
  if (!node) return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) collectNodes(child, predicate, found);
  return found;
}

function nodeText(node) {
  if (!node) return '';
  return (node.text || '') + (node.children || []).map(nodeText).join(' ');
}

async function enterNativeValue(ui, id, value) {
  const input = findNode(ui.mount.root, node => node.props && node.props.id === id);
  assert.ok(input && input.listeners && input.listeners.input, id + ' has a native input listener');
  input.value = value;
  input.listeners.input({ target: input, preventDefault() {} });
  await ui.settle();
}

function enginesPayload(overrides) {
  return Object.assign({
    instances: [
      { id: 'pydantic', name: 'Pydantic AI', engine: 'pydantic', enabled: true, models: [{ id: 'internal', name: 'Modelo interno', provider: 'itsm', free: true }], capabilities: { streaming: false, cancel: false, tools: true, usage: true } },
      {
        id: ENGINE_ID,
        name: 'OpenCode local',
        engine: 'opencode',
        enabled: true,
        models: [
          { id: 'opencode/free-a', name: 'Free A', provider: 'opencode', free: true },
          { id: 'opencode/free-b', name: 'Free B', provider: 'opencode', free: false }
        ],
        capabilities: { streaming: true, cancel: true, tools: true, usage: true, models: true },
        version: '1.4.0',
        error: ''
      }
    ],
    preference: { instanceId: ENGINE_ID, model: 'opencode/free-a' },
    budget: { dailyLimit: 50000, usedMeasured: 1200, usedReported: 300, strictExternal: false }
  }, overrides);
}

function hermesInstance(id, profile, name) {
  return {
    id,
    name,
    engine: 'hermes',
    profile,
    enabled: true,
    version: '0.22.5',
    models: [{ id: 'hermes:' + profile, name: 'Modelo ' + profile, provider: 'hermes', free: null }],
    capabilities: { streaming: true, cancel: true, tools: true, usage: true }
  };
}

function hermesEnginesPayload() {
  const payload = enginesPayload();
  payload.instances = payload.instances.concat([
    hermesInstance('hermes-itsm', 'itsm', 'Hermes ITSM'),
    hermesInstance('hermes-default', 'default', 'Hermes personal')
  ]);
  payload.preference = { instanceId: 'hermes-itsm', model: 'hermes:itsm' };
  return payload;
}

function catalogPayload() {
  return {
    skills: [
      { name: 'itsm.assets.search', module: 'itsm', version: '1.0.0', description: 'Busca activos.', permissions: ['assets.view'], capabilities: ['tools'], digest: 'a'.repeat(64) },
      { name: 'itsm.assets.update', module: 'itsm', version: '1.0.0', description: 'Actualiza activos.', permissions: ['assets.edit'], capabilities: ['tools'], digest: 'b'.repeat(64) },
      { name: 'netbox.sync', version: '2.1.0', module: 'netbox', permissions: ['assets.edit'], capabilities: ['tools'], digest: 'c'.repeat(64) },
      { name: 'netbox.status', version: '2.1.0', module: 'netbox', permissions: ['assets.view'], capabilities: ['tools'], digest: 'd'.repeat(64) }
    ],
    modules: [
      { id: 'itsm', name: 'ITSM official skills', version: '1.0.0', enabled: true, official: true, permissions: ['assets.view', 'assets.edit'], capabilities: ['tools'], skills: ['itsm.assets.search', 'itsm.assets.update'] },
      { id: 'netbox', name: 'NetBox', enabled: true, official: false, permissions: ['assets.view'], capabilities: ['tools'], skills: ['netbox.sync', 'netbox.status'] }
    ]
  };
}

function integrationsPayload(overrides) {
  return Object.assign({
    instances: [
      { id: 'pydantic', name: 'Pydantic AI', engine: 'pydantic', enabled: true, secretConfigured: false },
      { id: ENGINE_ID, name: 'OpenCode local', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096', secretRef: 'OPENCODE_SERVER_PASSWORD', secretConfigured: true, username: 'itsm', profile: 'default', directory: '/srv/opencode', enabled: true, defaultModel: 'opencode/free-a', integrationIdentityId: MACHINE_ID }
    ],
    installations: [],
    defaults: { instanceId: ENGINE_ID, model: 'opencode/free-a' }
  }, overrides);
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

function providersPayload(overrides) {
  return Object.assign({
    items: [
      {
        id: GLOBAL_PROVIDER_ID,
        name: 'OpenAI global',
        scope: 'global',
        baseUrl: 'https://api.openai.example/v1',
        models: ['global-model'],
        enabled: true,
        credentialConfigured: true
      },
      {
        id: PERSONAL_PROVIDER_ID,
        name: 'OpenAI personal',
        scope: 'personal',
        baseUrl: 'https://api.openai.example/v1',
        models: ['personal-model'],
        enabled: true,
        credentialConfigured: true,
        credentialStatus: 'older'
      },
      {
        id: '99999999-8888-4777-8666-555555555555',
        name: 'Global deshabilitado',
        scope: 'global',
        baseUrl: 'https://api.openai.example/v1',
        models: ['disabled-model'],
        enabled: false,
      }
    ]
  }, overrides || {});
}

function quotaPolicyPayload(overrides) {
  return Object.assign({
    companyDailyLimit: 50000,
    personalDailyLimit: null,
    companyLimitSource: 'default',
    personalLimitSource: 'not_applicable',
    timezone: 'America/Mexico_City',
    pendingTimezone: '',
    pendingEffectiveDay: '',
    serverTime: '2026-10-27T12:00:00Z',
    overrides: []
  }, overrides || {});
}

function quotaReportPayload(overrides) {
  return Object.assign({
    timezone: 'America/Mexico_City',
    generatedAt: '2026-10-27T12:00:00Z',
    filters: { includeLegacy: true },
    groupBy: ['day', 'provider'],
    totals: { settledTokens: 100, reservedTokens: 20, pendingCount: 1, unresolvedCount: 0, releasedCount: 0, receiptCount: 1, legacyTokens: 5 },
    precision: { measured: 100, estimated: 0, unavailable: 1 },
    items: [{
      day: '2026-10-27',
      userId: 'human-1',
      providerId: 'openai',
      providerName: 'OpenAI',
      providerScope: 'global',
      model: 'gpt-test',
      engine: 'opencode',
      funding: 'company',
      precision: 'measured',
      source: 'provider',
      state: 'settled',
      settledTokens: 100,
      reservedTokens: 0,
      pendingCount: 0,
      unresolvedCount: 0,
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      legacy: false
    }]
  }, overrides || {});
}

function targetDetectionPayload(overrides) {
  return Object.assign({
    target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0', remote: false },
    detection: {
      engine: 'opencode',
      format: 'v2',
      version: '1.4.0',
      profile: 'default',
      targetPath: '/srv/opencode',
      configFile: 'opencode.json',
      configExists: false,
      skillsDirectory: '.opencode/skills',
      limitations: ['OpenCode effective permissions can inherit configuration sources outside the selected target.']
    }
  }, overrides || {});
}

function surface(options) {
  const config = options || {};
  const { c, app, mount, settle } = setup();
  const calls = [];
  const state = {
    engines: config.engines || enginesPayload(),
    integrations: config.integrations || integrationsPayload(),
    catalog: config.catalog || catalogPayload(),
    detect: config.detect || targetDetectionPayload(),
    policy: config.policy || quotaPolicyPayload(),
    usage: config.usage || usagePayload(),
    report: config.report || quotaReportPayload(),
    pending: config.pending || { items: [] },
    providers: config.providers || providersPayload(),
    deferProviders: config.deferProviders === true,
    install: config.install || {
      id: 'installation-1',
      instanceId: ENGINE_ID,
      target: { engine: 'opencode', path: '/srv/opencode/profiles/ops', profile: 'ops', version: '1.4.0', remote: false },
      skills: ['itsm.assets.search', 'netbox.sync'],
      mcp: { url: 'http://127.0.0.1:8000/mcp', secretRef: 'ITSM_MCP_TOKEN', identityId: MACHINE_ID },
      status: 'configured',
      verified: false,
      mcpVerified: false,
      profileSafetyVerified: false,
      checks: ['MCP handshake not performed'],
      conflicts: ['/srv/opencode/AGENTS.md'],
      binding: {},
      requestDigest: null,
      operation: 'install',
      managedFiles: ['/srv/opencode/config.json'],
      createdAt: '2026-01-01T00:00:00+00:00',
      updatedAt: '2026-01-01T00:00:00+00:00'
    },
    receipt: config.receipt || {
      id: 'installation-1',
      instanceId: ENGINE_ID,
      target: { engine: 'opencode', path: '/srv/opencode/profiles/ops', profile: 'ops', version: '1.4.0', remote: false },
      skills: ['itsm.assets.search', 'netbox.sync'],
      mcp: { url: 'http://127.0.0.1:8000/mcp', secretRef: 'ITSM_MCP_TOKEN', identityId: MACHINE_ID },
      status: 'verified',
      verified: true,
      mcpVerified: true,
      profileSafetyVerified: true,
      checks: ['MCP handshake ok'],
      conflicts: [],
      binding: {},
      requestDigest: null,
      operation: 'verify',
      managedFiles: ['/srv/opencode/config.json'],
      createdAt: '2026-01-01T00:00:00+00:00',
      updatedAt: '2026-01-01T00:00:00+00:00'
    }
  };
  if (config.can) app.can = config.can;
  if (config.users) app.security.users = config.users;
  if (config.activeUserId) app.activeUserId = config.activeUserId;
  c.AssetAccess.request = async (vm, path, requestOptions) => {
    const method = (requestOptions && requestOptions.method) || 'GET';
    const body = requestOptions && requestOptions.body;
    calls.push({ path, method, body });
    if (path === '/agent/engines') return state.engines;
    if (path === '/agent/usage/me') return state.usage;
    if (/^\/agent\/providers\/[^/]+\/check$/.test(path) && method === 'POST') {
      state.providerChecks = (state.providerChecks || 0) + 1;
      return config.providerCheck || { ok: true, code: 'ok', modelCount: 3, checkedAt: '2026-10-27T12:00:00Z' };
    }
    if (path === '/agent/providers') {
      if (state.deferProviders) await new Promise(resolve => { state.releaseProviders = resolve; });
      return state.providers;
    }
    if (path === '/agent/usage/policy' && method === 'GET') {
      if (state.deferPolicy) await new Promise((resolve) => { state.releasePolicy = resolve; });
      return state.policy;
    }
    if (path === '/agent/usage/policy' && method === 'PUT') {
      state.policySave = body;
      if (body.cancelTimezoneChange) {
        state.policy = Object.assign({}, state.policy, { pendingTimezone: '', pendingEffectiveDay: '' });
        return state.policy;
      }
      const next = Object.assign({}, state.policy);
      if (Object.prototype.hasOwnProperty.call(body, 'companyDailyLimit')) next.companyDailyLimit = body.companyDailyLimit;
      if (Object.prototype.hasOwnProperty.call(body, 'personalDailyLimit')) next.personalDailyLimit = body.personalDailyLimit;
      if (body.timezone) {
        next.pendingTimezone = body.timezone;
        next.pendingEffectiveDay = '2026-10-28';
      }
      state.policy = next;
      return next;
    }
    if (/^\/agent\/usage\/overrides\/[^/?]+/.test(path)) {
      const userId = decodeURIComponent(path.split('?')[0].split('/').pop());
      if (method === 'PUT') {
        if (state.deferOverride) await new Promise((resolve) => { state.releaseOverride = resolve; });
        state.overrideSave = { userId, body };
        state.policy.overrides = (state.policy.overrides || [])
          .filter(item => !(item.userId === userId && item.scope === body.scope))
          .concat({ userId, scope: body.scope, dailyLimit: body.dailyLimit, updatedAt: '2026-10-27T12:00:00Z' });
        return { overrides: state.policy.overrides };
      }
      if (method === 'DELETE') {
        const scope = new URLSearchParams(path.split('?')[1] || '').get('scope');
        state.overrideDelete = { userId, scope };
        state.policy.overrides = (state.policy.overrides || [])
          .filter(item => !(item.userId === userId && item.scope === scope));
        return { overrides: state.policy.overrides };
      }
    }
    if (path.startsWith('/agent/usage/report')) {
      state.reportQuery = path;
      return state.report;
    }
    if (path.startsWith('/agent/usage/pending')) {
      state.pendingQuery = path;
      return state.pending;
    }
    if (path === '/agent/integrations') return state.integrations;
    if (path === '/agent/integrations/catalog') return state.catalog;
    if (path === '/agent/preferences' && method === 'PUT') return { instanceId: body.instanceId, model: body.model };
    if (path === '/agent/integrations/targets') return state.detect;
    if (path === '/agent/integrations/install') return state.install;
    if (path === '/agent/integrations/receipts') return state.receipt;
    if (path === '/agent/integrations/instances' && method === 'POST') return { id: 'instance-new', name: body.name, engine: body.engine };
    if (path.startsWith('/agent/integrations/modules/') && method === 'PUT') {
      return { id: decodeURIComponent(path.split('/').pop()), enabled: body.enabled, registered: body.enabled };
    }
    if (path === '/agent/integrations/installations/installation-1/request') {
      return { request: { engine: 'opencode', path: '/srv/opencode', remote: true }, requestDigest: 'digest-1', installation: state.install };
    }
    return {};
  };
  const mounted = mount(config.component || 'AgentIntegrationsSettings', config.props ? Object.assign({ app }, config.props) : { app });
  return { c, app, mount: mounted, vm: mounted.instance, calls, state, settle };
}

test('the rendered new-instance step saves through the registered instance editor', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: {
      instances: integrationsPayload().instances,
      catalog: catalogPayload(),
      identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'agent' }]
    }
  });
  await ui.settle();

  const radio = findNode(ui.mount.root, node => node.tag === 'input' && node.props && node.props.type === 'radio' && node.props.value === 'new');
  assert.ok(radio, 'the rendered new-instance radio exists');
  const selectNew = (radio.listeners && radio.listeners.change) ||
    (radio.props && (radio.props.onChange || radio.props['onUpdate:modelValue']));
  assert.ok(selectNew, 'the rendered radio is wired to the mode');
  radio.checked = true;
  selectNew({ target: radio });
  await ui.settle();
  assert.equal(ui.vm.mode, 'new');

  const input = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-name');
  assert.ok(input, 'the rendered instance editor is mounted');
  input.value = 'OpenCode nuevo';
  const handler = (input.listeners && input.listeners.input) ||
    (input.props && (input.props.onInput || input.props['onUpdate:modelValue']));
  assert.ok(handler, 'the rendered name input is writable');
  handler({ target: input, preventDefault() {} });
  await ui.settle();
  assert.equal(ui.vm.instanceDraft.name, 'OpenCode nuevo');

  const form = findNode(ui.mount.root, node => node.tag === 'form');
  assert.ok(form, 'the rendered instance form is mounted');
  const submit = (form.props && form.props.onSubmit) || (form.listeners && form.listeners.submit);
  assert.ok(submit, 'the rendered form submits');
  submit({ preventDefault() {} });
  await ui.settle();

  const save = ui.calls.find(call => call.path === '/agent/integrations/instances' && call.method === 'POST');
  assert.equal(save.body.name, 'OpenCode nuevo');
  assert.equal(ui.vm.instanceId, 'instance-new');
  assert.equal(ui.vm.mode, 'existing');
  assert.equal(findNode(ui.mount.root, node => node.tag === 'app-icon'), null);
});

test('the IA section is addressable under configuration and lists the preference', async () => {
  const { c, app } = setup();
  c.location.hash = '#/configuracion/ia';
  const parsed = app.parseRoute();
  assert.equal(parsed.name, 'config');
  assert.equal(parsed.section, 'ia');
  assert.equal(app.hashFor({ name: 'config', section: 'ia' }), '#/configuracion/ia');
  app.route = parsed;
  assert.ok(app.permittedConfigSections.some(section => section.id === 'ia'));
});

test('the mounted picker renders discovered engines and persists a model change', async () => {
  const ui = surface({ component: 'AgentEnginePicker' });
  await ui.settle();
  assert.equal(ui.vm.agentEnginesLoaded, true);
  assert.deepEqual(ui.vm.agentModels.map(model => model.id), ['opencode/free-a', 'opencode/free-b']);
  const text = node => (node.text || '') + (node.children || []).map(text).join(' ');
  const rendered = text(ui.mount.root);
  assert.match(rendered, /OpenCode 1\.4\.0/);
  assert.match(rendered, /Free B/);

  assert.equal(await ui.vm.onModel({ target: { value: 'opencode/free-b' } }), true);
  const saved = ui.calls.filter(call => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(plain(saved.body), { instanceId: ENGINE_ID, model: 'opencode/free-b' });
});

test('the shared picker groups Hermes profiles under one engine and switches profile through the saved preference', async () => {
  const ui = surface({ component: 'AgentEnginePicker', engines: hermesEnginesPayload() });
  await ui.settle();

  const engine = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-engine-instance');
  assert.ok(engine, 'the picker renders the engine selector');
  const engineOptions = engine.children.filter(node => node.tag === 'option');
  assert.equal(engineOptions.filter(option => option.props.value === 'hermes').length, 1,
    'one engine choice covers every authorized Hermes profile');
  assert.equal(engineOptions.some(option => option.props.value === 'hermes-itsm'), false);

  const profile = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-engine-profile');
  assert.ok(profile, 'the picker renders the external profile selector');
  const profileOptions = profile.children.filter(node => node.tag === 'option');
  assert.deepEqual(profileOptions.map(option => option.props.value), ['hermes-itsm', 'hermes-default']);
  assert.deepEqual(profileOptions.map(option => nodeText(option).trim()), ['itsm', 'default']);

  const change = (profile.listeners && profile.listeners.change) || (profile.props && profile.props.onChange);
  assert.ok(change, 'the profile selector is wired');
  profile.value = 'hermes-default';
  assert.equal(await change(Object.create({ target: profile })), true);

  const saved = ui.calls.filter(call => call.path === '/agent/preferences' && call.method === 'PUT').pop();
  assert.deepEqual(plain(saved.body), { instanceId: 'hermes-default', model: 'hermes:default' });
  assert.equal(ui.vm.agentPreference.instanceId, 'hermes-default');
  assert.equal(ui.calls.some(call => call.path.startsWith('/agent/sessions')), false);
});

test('the shared picker hides the profile selector without alternatives and keeps Pydantic providers distinct', async () => {
  const engines = enginesPayload();
  engines.instances = engines.instances.concat({
    id: 'pydantic-personal',
    name: 'Mi proveedor',
    engine: 'pydantic',
    profile: '',
    enabled: true,
    version: '1.0',
    models: [{ id: 'personal:model', name: 'Personal', provider: 'pydantic', free: null }],
    capabilities: { tools: true }
  });
  const ui = surface({ component: 'AgentEnginePicker', engines });
  await ui.settle();

  assert.equal(findNode(ui.mount.root, node => node.props && node.props.id === 'agent-engine-profile'), null);
  const engine = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-engine-instance');
  assert.deepEqual(engine.children.filter(node => node.tag === 'option').map(node => node.props.value),
    ['pydantic', 'opencode', 'pydantic-personal']);
  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /Mi proveedor/);
  assert.match(rendered, /OpenCode 1\.4\.0/);
});

test('a rejected profile preference restores the picker selection', async () => {
  const ui = surface({ component: 'AgentEnginePicker', engines: hermesEnginesPayload() });
  await ui.settle();
  const original = ui.c.AssetAccess.request;
  ui.c.AssetAccess.request = async (vm, path, options) => {
    if (path === '/agent/preferences' && options && options.method === 'PUT') {
      const error = new Error('No se pudo guardar la preferencia.');
      error.serverMessage = 'El servidor rechazó la preferencia del chat.';
      error.status = 503;
      throw error;
    }
    return original(vm, path, options);
  };

  const profile = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-engine-profile');
  const change = (profile.listeners && profile.listeners.change) || (profile.props && profile.props.onChange);
  profile.value = 'hermes-default';
  assert.equal(await change(Object.create({ target: profile })), false);
  assert.equal(profile.value, 'hermes-itsm');
  assert.equal(ui.vm.agentPreference.instanceId, 'hermes-itsm');
  assert.equal(ui.vm.agentPreference.model, 'hermes:itsm');
  assert.match(ui.vm.agentSelectionNotice, /rechazó la preferencia/i);
});

test('a newly registered OpenCode instance carries its profile into the wizard target', async () => {
  const ui = surface({ component: 'AgentIntegrationWizard', props: { instances: integrationsPayload().instances, catalog: catalogPayload(), identities: [] } });
  const vm = ui.vm;
  vm.mode = 'new';
  vm.instanceDraft = Object.assign({}, vm.instanceDraft, {
    name: 'OpenCode ITSM',
    engine: 'opencode',
    baseUrl: 'http://127.0.0.1:4096',
    profile: 'itsm-real',
    directory: '/srv/opencode/itsm'
  });
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(vm.instanceId, 'instance-new');
  assert.equal(vm.target.profile, 'itsm-real');
  assert.equal(vm.target.path, '/srv/opencode/itsm');
  const save = ui.calls.find(call => call.path === '/agent/integrations/instances' && call.method === 'POST');
  assert.equal(save.body.profile, 'itsm-real');
});

test('the wizard preserves the registered OpenCode profile in inspection and install requests', async () => {
  const instances = integrationsPayload().instances.map(instance =>
    instance.id === ENGINE_ID ? Object.assign({}, instance, { profile: 'itsm-real', directory: '/srv/opencode/itsm' }) : instance);
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: { instances, catalog: catalogPayload(), identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }] }
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(vm.target.profile, 'itsm-real');
  assert.equal(vm.target.path, '/srv/opencode/itsm');

  assert.equal(await vm.detect(), true);
  const inspection = ui.calls.filter(call => call.path === '/agent/integrations/targets').pop();
  assert.equal(inspection.body.profile, 'itsm-real');

  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.step = 5;
  assert.equal(await vm.install(), true);
  const installation = ui.calls.filter(call => call.path === '/agent/integrations/install').pop();
  assert.equal(installation.body.target.instanceId, undefined);
  assert.equal(installation.body.instanceId, ENGINE_ID);
  assert.equal(installation.body.target.profile, 'itsm-real');
});

test('the wizard refreshes the profile when the selected instance changes', async () => {
  const base = integrationsPayload().instances.find(instance => instance.id === ENGINE_ID);
  const instances = [
    Object.assign({}, base, { id: 'opencode-alpha', name: 'Alpha', profile: 'alpha', directory: '/srv/alpha' }),
    Object.assign({}, base, { id: 'opencode-beta', name: 'Beta', profile: 'beta', directory: '/srv/beta' })
  ];
  const ui = surface({ component: 'AgentIntegrationWizard', props: { instances, catalog: catalogPayload(), identities: [] } });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = 'opencode-alpha';
  await vm.next();
  assert.equal(vm.target.profile, 'alpha');

  vm.back();
  assert.equal(vm.step, 1);
  vm.instanceId = 'opencode-beta';
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(vm.target.profile, 'beta');
});

test('the installer result shows the sanitized server error and limitations instead of only a generic failure', async () => {
  const hermes = {
    id: 'hermes-itsm', name: 'Hermes ITSM', engine: 'hermes', profile: 'itsm', enabled: true,
    directory: '/srv/hermes/itsm', secretRef: 'HERMES_MCP_TOKEN', integrationIdentityId: MACHINE_ID
  };
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: { instances: integrationsPayload().instances.concat(hermes), catalog: catalogPayload(), identities: [{ id: MACHINE_ID, name: 'Hermes ops', actorKind: 'external_agent', roleId: 'reader', active: true }] },
    detect: targetDetectionPayload({
      target: { engine: 'hermes', path: '/srv/hermes/itsm', profile: 'itsm', version: '0.22.5', remote: false },
      detection: {
        engine: 'hermes',
        format: 'yaml',
        version: '0.22.5',
        profile: 'itsm',
        targetPath: '/srv/hermes/itsm',
        configFile: 'hermes.yaml',
        configExists: true,
        skillsDirectory: 'skills',
        limitations: []
      }
    }),
    install: {
      id: 'installation-1',
      instanceId: 'hermes-itsm',
      target: { engine: 'hermes', path: '/srv/hermes/itsm', profile: 'itsm', version: '0.22.5', remote: false },
      status: 'failed',
      verified: false,
      checks: [],
      conflicts: [],
      managedFiles: [],
      operation: 'install',
      error: { code: 'config_invalid', message: 'La configuración de Hermes no se pudo validar.' },
      limitations: ['El perfil existente se conservó sin migrar.']
    }
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = 'hermes-itsm';
  await vm.next();
  assert.equal(await vm.detect(), true);
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.step = 5;
  assert.equal(await vm.install(), true);
  await ui.settle();

  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /La configuración de Hermes no se pudo validar\./);
  assert.match(rendered, /El perfil existente se conservó sin migrar\./);
  assert.doesNotMatch(rendered, /no confirmó una conexión MCP real/);
});

test('administrative writes cross the canonical transport with JSON and CSRF', async () => {
  const { c, app } = setup();
  app.csrfToken = 'csrf-agent';
  const calls = [];
  c.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'installation-1', status: 'exported', verified: false, requestDigest: 'digest-1' }),
      blob: async () => new Blob([])
    };
  };
  const body = {
    instanceId: ENGINE_ID,
    target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0', remote: true },
    mcp: { url: 'http://127.0.0.1:8000/mcp', secretRef: 'ITSM_MCP_TOKEN', identityId: MACHINE_ID },
    skills: ['itsm.assets.search'],
    operation: 'install',
    mode: 'remote'
  };
  await c.AssetAgentApi.apply(app, body);
  assert.equal(calls[0].url, '/api/v1/agent/integrations/install');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'csrf-agent');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), body);

  const receipt = { instanceId: ENGINE_ID, requestDigest: 'digest-1', receipt: { status: 'verified' } };
  await c.AssetAgentApi.importReceipt(app, receipt);
  assert.equal(calls[1].url, '/api/v1/agent/integrations/receipts');
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'csrf-agent');
  assert.deepEqual(JSON.parse(calls[1].init.body), receipt);
});

test('a non-admin keeps the engine preference but never queries admin integrations', async () => {
  const ui = surface({ can: permission => permission === 'assets.view' });
  await ui.settle();
  assert.equal(ui.vm.isAdmin, false);
  assert.equal(ui.vm.agentEnginesLoaded, true);
  assert.equal(ui.vm.agentPreference.model, 'opencode/free-a');
  assert.equal(ui.calls.some(call => call.path === '/agent/integrations'), false);
  assert.equal(ui.calls.some(call => call.path === '/agent/integrations/catalog'), false);
  assert.equal(findNode(ui.mount.root, node => node.tag === 'app-icon'), null);
});

test('the first registration opens the guided wizard automatically', async () => {
  const ui = surface({
    integrations: integrationsPayload({
      instances: [{ id: 'pydantic', name: 'Pydantic AI', engine: 'pydantic', enabled: true }]
    })
  });
  await ui.settle();
  assert.equal(ui.vm.adminAvailable, true);
  assert.equal(ui.vm.wizardOpen, true);
  assert.equal(ui.vm.firstRegistration, true);
});

test('the wizard installs only the exact inspected target and reports unverified configuration honestly', async () => {
  const ui = surface({ component: 'AgentIntegrationWizard', props: { instances: integrationsPayload().instances, catalog: catalogPayload(), identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }] } });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/srv/opencode/profiles/ops';
  vm.target.profile = 'ops';
  vm.target.version = '1.4.0';
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(await vm.detect(), true);
  await vm.next();
  assert.equal(vm.step, 3);
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  await vm.next();
  assert.equal(vm.step, 4);
  vm.selectedSkills = ['itsm.assets.search', 'netbox.sync'];
  await vm.next();
  assert.equal(vm.step, 5);
  assert.equal(vm.verified, false);
  assert.equal(await vm.install(), true);

  assert.equal(vm.result.verified, false);
  assert.equal(vm.verified, false);
  assert.equal(vm.result.instanceId, ENGINE_ID);
  assert.equal(vm.result.target.version, '1.4.0');
  assert.equal(vm.result.operation, 'install');
  assert.equal('version' in vm.result, false);
  assert.deepEqual(plain(vm.result.conflicts), ['/srv/opencode/AGENTS.md']);
  await ui.settle();
  assert.match(nodeText(ui.mount.root), /Versión: 1\.4\.0/);
  assert.match(nodeText(ui.mount.root), /no confirmó una conexión MCP real/);
});

test('the installer refuses a local target that changed after inspection', async () => {
  const wizard = () => surface({
    component: 'AgentIntegrationWizard',
    props: {
      instances: integrationsPayload().instances,
      catalog: catalogPayload(),
      identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }]
    }
  });
  const inspect = async (vm) => {
    vm.mode = 'existing';
    vm.instanceId = ENGINE_ID;
    vm.target.path = '/srv/opencode';
    vm.target.version = '1.4.0';
    await vm.next();
    assert.equal(vm.step, 2);
    assert.equal(await vm.detect(), true);
    assert.equal(vm.detection.detected, true);
    vm.mcp.url = 'http://127.0.0.1:8000/mcp';
    vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
    vm.mcp.identityId = MACHINE_ID;
    vm.selectedSkills = ['itsm.assets.search'];
  };

  const changes = [
    ['path', vm => { vm.target.path = '/srv/otro'; }],
    ['profile', vm => { vm.target.profile = 'ops'; }],
    ['version', vm => { vm.target.version = '9.9.9'; }]
  ];
  for (const [field, change] of changes) {
    const ui = wizard();
    const vm = ui.vm;
    await inspect(vm);
    change(vm);
    vm.step = 2;
    assert.equal(vm.canNext, false, field + ' change must require a new inspection');
    vm.step = 5;
    assert.equal(await vm.install(), false, field + ' change must block the install');
    assert.match(vm.error, /Inspecciona y confirma el destino antes de instalar/);
    assert.equal(vm.result, null);
    assert.equal(ui.calls.some(call => call.path === '/agent/integrations/install'), false);
  }

  const ui = wizard();
  const vm = ui.vm;
  await inspect(vm);
  vm.target.profile = 'ops';
  assert.equal(await vm.detect(), true);
  vm.step = 5;
  assert.equal(await vm.install(), true);
  assert.equal(ui.calls.filter(call => call.path === '/agent/integrations/install').length, 1);
});

test('an in-flight inspection cannot overwrite a target that changed while it was pending', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: {
      instances: integrationsPayload().instances,
      catalog: catalogPayload(),
      identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }]
    }
  });
  const pendingInspections = [];
  ui.c.AssetAccess.request = (vm, path) => {
    if (path === '/agent/integrations/targets') {
      return new Promise(resolve => { pendingInspections.push(resolve); });
    }
    return Promise.resolve({});
  };
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/srv/opencode';
  vm.target.version = '1.4.0';
  await vm.next();
  assert.equal(vm.step, 2);

  const pending = vm.detect();
  await Promise.resolve();
  assert.equal(vm.detecting, true);
  assert.equal(pendingInspections.length, 1);
  vm.target.profile = 'ops';
  pendingInspections[0](targetDetectionPayload());
  assert.equal(await pending, false);
  assert.equal(vm.detection, null);
  assert.equal(vm.detecting, false);
  assert.equal(vm.target.version, '1.4.0');
  assert.doesNotMatch(vm.detectError, /inspección de destino válida/i);

  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.step = 5;
  assert.equal(await vm.install(), false);
  assert.match(vm.error, /Inspecciona y confirma el destino antes de instalar/);

  vm.step = 2;
  const retry = vm.detect();
  await Promise.resolve();
  assert.equal(pendingInspections.length, 2);
  pendingInspections[1](targetDetectionPayload({
    target: { engine: 'opencode', path: '/srv/opencode', profile: 'ops', version: '1.4.0', remote: false },
    detection: {
      engine: 'opencode',
      format: 'v2',
      version: '1.4.0',
      profile: 'ops',
      targetPath: '/srv/opencode',
      configFile: 'opencode.json',
      configExists: false,
      skillsDirectory: '.opencode/skills',
      limitations: []
    }
  }));
  assert.equal(await retry, true);
  assert.equal(vm.detection.detected, true);
  vm.step = 5;
  assert.equal(await vm.install(), true);
});

test('a remote export still works without a local inspection and returning to local requires a fresh one', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: {
      instances: integrationsPayload().instances,
      catalog: catalogPayload(),
      identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }]
    },
    install: {
      id: 'installation-1',
      instanceId: ENGINE_ID,
      target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0', remote: true },
      skills: ['itsm.assets.search'],
      mcp: { url: 'http://127.0.0.1:8000/mcp', secretRef: 'ITSM_MCP_TOKEN', identityId: MACHINE_ID },
      status: 'exported',
      verified: false,
      mcpVerified: false,
      profileSafetyVerified: false,
      checks: [],
      conflicts: [],
      operation: 'install',
      managedFiles: [],
      createdAt: '2026-01-01T00:00:00+00:00',
      updatedAt: '2026-01-01T00:00:00+00:00'
    }
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/srv/opencode';
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(await vm.detect(), true);

  vm.target.remote = true;
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.step = 5;
  assert.equal(await vm.install(), true);
  const exported = ui.calls.filter(call => call.path === '/agent/integrations/install').pop();
  assert.equal(exported.body.mode, 'remote');
  assert.equal(exported.body.target.remote, true);

  vm.result = null;
  vm.error = '';
  vm.target.remote = false;
  vm.step = 2;
  assert.equal(vm.canNext, false);
  vm.step = 5;
  assert.equal(await vm.install(), false);
  assert.match(vm.error, /Inspecciona y confirma el destino antes de instalar/);
});

test('the wizard accepts the canonical nested target detection envelope', async () => {
  const detect = targetDetectionPayload({
    target: { engine: 'opencode', path: '/srv/opencode', profile: null, version: '2.1.2', remote: false },
    detection: {
      engine: 'opencode',
      format: 'v2',
      version: '2.1.2',
      profile: null,
      targetPath: '/srv/opencode',
      configFile: 'opencode.json',
      configExists: false,
      skillsDirectory: '.opencode/skills',
      limitations: ['OpenCode effective permissions can inherit global configuration sources.']
    }
  });
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: { instances: integrationsPayload().instances.map(instance => instance.id === ENGINE_ID ? { ...instance, profile: null } : instance), catalog: catalogPayload(), identities: [] },
    detect
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.version = '2.1.2';
  await vm.next();
  assert.equal(vm.step, 2);
  assert.equal(vm.target.profile, '');

  assert.equal(await vm.detect(), true);
  const inspection = ui.calls.filter(call => call.path === '/agent/integrations/targets').pop();
  assert.equal(inspection.body.profile, null);
  assert.equal(vm.detectError, '');
  assert.equal(vm.detection.detected, true);
  assert.equal(vm.detection.targetPath, '/srv/opencode');
  assert.equal(vm.detection.configExists, false);
  assert.equal(vm.target.version, '2.1.2');
  await ui.settle();
  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /Destino detectado: \/srv\/opencode/);
  assert.match(rendered, /versión 2\.1\.2/);
  assert.match(rendered, /configuración nueva/);
  assert.match(rendered, /OpenCode effective permissions/);
  assert.doesNotMatch(rendered, /no detectó un destino instalable/);
});

test('an arbitrary 200 without the canonical target envelope is not installable', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: { instances: integrationsPayload().instances, catalog: catalogPayload(), identities: [] },
    detect: { detected: true, path: '/srv/opencode' }
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/srv/opencode';
  await vm.next();
  assert.equal(vm.step, 2);

  assert.equal(await vm.detect(), false);
  assert.equal(vm.detection, null);
  assert.match(vm.detectError, /inspección de destino válida/i);
  assert.equal(vm.canNext, false);
});

test('a remote install exports a bound request and verifies only after importing its receipt', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: { instances: integrationsPayload().instances, catalog: catalogPayload(), identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'external_agent', roleId: 'reader', active: true }] },
    install: {
      id: 'installation-1',
      instanceId: ENGINE_ID,
      target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0', remote: true },
      skills: ['itsm.assets.search'],
      mcp: { url: 'http://127.0.0.1:8000/mcp', secretRef: 'ITSM_MCP_TOKEN', identityId: MACHINE_ID },
      status: 'exported',
      verified: false,
      mcpVerified: false,
      profileSafetyVerified: false,
      request: { engine: 'opencode', path: '/srv/opencode', remote: true },
      requestDigest: 'digest-1',
      binding: { requestDigest: 'digest-1' },
      checks: ['remote request generated'],
      conflicts: [],
      operation: 'install',
      managedFiles: [],
      createdAt: '2026-01-01T00:00:00+00:00',
      updatedAt: '2026-01-01T00:00:00+00:00'
    }
  });
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/srv/opencode';
  vm.target.remote = true;
  await vm.next();
  assert.equal(vm.step, 2);
  await vm.next();
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  await vm.next();
  vm.selectedSkills = ['itsm.assets.search'];
  await vm.next();
  assert.equal(await vm.install(), true);

  const installCall = ui.calls.find(call => call.path === '/agent/integrations/install');
  assert.equal(installCall.body.mode, 'remote');
  assert.equal(installCall.body.target.remote, true);
  assert.equal(vm.result.status, 'exported');
  assert.equal(vm.verified, false);
  assert.match(vm.statusLabel(vm.result), /exportada/i);
  assert.deepEqual(plain(vm.result.request), { engine: 'opencode', path: '/srv/opencode', remote: true });
  assert.equal(vm.result.requestDigest, 'digest-1');

  vm.receiptText = '{not json';
  assert.equal(await vm.importWizardReceipt(), false);
  assert.match(vm.receiptError, /JSON/i);
  assert.equal(ui.calls.some(call => call.path === '/agent/integrations/receipts'), false);

  vm.receiptText = JSON.stringify({ requestDigest: 'digest-1', handshake: 'ok' });
  assert.equal(await vm.importWizardReceipt(), true);
  const receiptCall = ui.calls.find(call => call.path === '/agent/integrations/receipts');
  assert.deepEqual(plain(receiptCall.body), {
    instanceId: ENGINE_ID,
    requestDigest: 'digest-1',
    receipt: { requestDigest: 'digest-1', handshake: 'ok' }
  });
  assert.equal(vm.result.verified, true);
  assert.equal(vm.verified, true);
});

test('lifecycle operations reuse the stored binding instead of resending secrets or skills', async () => {
  const record = {
    id: 'installation-9',
    instanceId: ENGINE_ID,
    target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0' },
    status: 'configured',
    verified: false
  };
  const ui = surface({ integrations: integrationsPayload({ installations: [record] }) });
  await ui.settle();
  const stored = ui.vm.installations[0];
  assert.equal(stored.target.path, '/srv/opencode');
  assert.equal(await ui.vm.applyOperation({ operation: 'verify', record: stored }), true);
  const call = ui.calls.find(item => item.path === '/agent/integrations/install');
  assert.deepEqual(plain(call.body), {
    instanceId: ENGINE_ID,
    target: { engine: 'opencode', path: '/srv/opencode', profile: 'default', version: '1.4.0' },
    operation: 'verify'
  });
  assert.equal('mcp' in call.body, false);
  assert.equal('skills' in call.body, false);
  assert.equal(ui.vm.operationResult.instanceId, ENGINE_ID);
  assert.equal(ui.vm.operationResult.target.version, '1.4.0');
  assert.equal('version' in ui.vm.operationResult, false);
  await ui.settle();
  assert.match(nodeText(ui.mount.root), /Versión: 1\.4\.0/);
});

test('disabling a module removes its skills and refreshes the shared catalog', async () => {
  const ui = surface();
  await ui.settle();
  const module = ui.vm.catalog.modules.find(item => item.id === 'netbox');
  assert.equal(ui.vm.catalog.skills.some(skill => skill.module === 'netbox'), true);
  assert.equal(await ui.vm.toggleModule(module), true);

  const toggle = ui.calls.find(call => call.path === '/agent/integrations/modules/netbox');
  assert.deepEqual(plain(toggle.body), { enabled: false });
  assert.equal(ui.calls.filter(call => call.path === '/agent/integrations/catalog').length, 2);
});

test('an instance form sends only the secret reference and never a token value', async () => {
  const ui = surface();
  await ui.settle();
  ui.vm.newInstance();
  ui.vm.instanceDraft.name = 'OpenCode pruebas';
  ui.vm.instanceDraft.engine = 'opencode';
  ui.vm.instanceDraft.baseUrl = 'http://127.0.0.1:4096';
  ui.vm.instanceDraft.secretRef = 'OPENCODE_SERVER_PASSWORD';
  ui.vm.instanceDraft.integrationIdentityId = MACHINE_ID;
  assert.equal(ui.vm.enginePickerKey, 0);
  assert.equal(await ui.vm.saveInstance(), true);
  assert.equal(ui.vm.enginePickerKey, 1);
  const save = ui.calls.find(call => call.path === '/agent/integrations/instances' && call.method === 'POST');
  assert.equal(save.body.secretRef, 'OPENCODE_SERVER_PASSWORD');
  assert.equal('token' in save.body, false);
  assert.equal('secret' in save.body, false);
  assert.equal('password' in save.body, false);
});

test('instance quota routing saves exact direct and managed fields for provider administrators', async () => {
  const ui = surface();
  await ui.settle();
  const instance = ui.vm.adminInstances.find(item => item.id === ENGINE_ID);
  ui.vm.editInstance(instance);
  await ui.settle();

  const mode = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-mode');
  assert.ok(mode, 'the editor renders the quota mode for a provider administrator');
  ui.vm.instanceDraft.quotaMode = 'managed';
  await ui.settle();

  const provider = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-provider');
  assert.ok(provider, 'managed mode renders the global provider selector');
  const values = provider.children.filter(node => node.tag === 'option').map(node => node.props.value);
  assert.equal(values.includes(GLOBAL_PROVIDER_ID), true);
  assert.equal(values.includes(PERSONAL_PROVIDER_ID), false, 'personal providers are not offered for managed routing');
  assert.equal(values.includes('99999999-8888-4777-8666-555555555555'), false, 'disabled globals are not offered');

  ui.vm.instanceDraft.managedProviderId = '';
  assert.equal(await ui.vm.saveInstance(), false);
  assert.match(ui.vm.instanceError, /proveedor global/i);
  assert.equal(ui.calls.some(call => call.path === '/agent/integrations/instances/' + ENGINE_ID), false);

  Object.assign(ui.vm.instanceDraft, {
    managedProviderId: GLOBAL_PROVIDER_ID,
    managedContextTokens: '32768',
    defaultModel: 'global-model'
  });
  await ui.settle();
  assert.ok(findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-context'));
  assert.equal(await ui.vm.saveInstance(), true);
  const managed = ui.calls.filter(call => call.path === '/agent/integrations/instances/' + ENGINE_ID && call.method === 'PUT').pop();
  assert.deepEqual(plain({
    quotaMode: managed.body.quotaMode,
    directCompanyException: managed.body.directCompanyException,
    managedProviderId: managed.body.managedProviderId,
    managedContextTokens: managed.body.managedContextTokens
  }), {
    quotaMode: 'managed',
    directCompanyException: false,
    managedProviderId: GLOBAL_PROVIDER_ID,
    managedContextTokens: 32768
  });

  ui.vm.editInstance(Object.assign({}, instance, {
    quotaMode: 'managed',
    managedProviderId: GLOBAL_PROVIDER_ID,
    managedContextTokens: 32768
  }));
  await ui.settle();
  assert.equal(ui.vm.instanceDraft.managedContextTokens, '32768');
  Object.assign(ui.vm.instanceDraft, {
    quotaMode: 'direct',
    directCompanyException: true
  });
  await ui.settle();
  assert.equal(await ui.vm.saveInstance(), true);
  const direct = ui.calls.filter(call => call.path === '/agent/integrations/instances/' + ENGINE_ID && call.method === 'PUT').pop();
  assert.deepEqual(plain({
    quotaMode: direct.body.quotaMode,
    directCompanyException: direct.body.directCompanyException,
    managedProviderId: direct.body.managedProviderId,
    managedContextTokens: direct.body.managedContextTokens
  }), {
    quotaMode: 'direct',
    directCompanyException: true,
    managedProviderId: null,
    managedContextTokens: null
  });
});

test('instance quota controls and provider lookups require the instance quota authority', async () => {
  const ui = surface({
    component: 'AgentInstanceEditor',
    props: {
      canManageQuota: false,
      draft: {
        id: '', name: 'OpenCode', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096',
        secretRef: '', username: '', profile: '', directory: '', defaultModel: '', integrationIdentityId: '',
        enabled: true, quotaMode: 'managed', managedProviderId: GLOBAL_PROVIDER_ID,
        managedContextTokens: '1000', directCompanyException: false
      }
    }
  });
  await ui.settle();
  assert.equal(findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-mode'), null);
  assert.equal(findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-provider'), null);
  assert.equal(ui.calls.some(call => call.path === '/agent/providers'), false);
});

test('an instance validation refusal shows the server-safe reason and field detail', async () => {
  const { c, app, mount, settle } = setup();
  app.csrfToken = 'csrf-agent';
  let failure = {
    error: {
      code: 'validation_error',
      message: 'secretRef ITSM_OPENCODE_VERIFY_PASSWORD does not resolve to a configured secret'
    }
  };
  c.fetch = async (url, init = {}) => {
    const path = String(url).replace('/api/v1', '');
    if (init.method === 'POST' && path === '/agent/integrations/instances') {
      return { ok: false, status: 422, json: async () => failure };
    }
    if (path === '/agent/engines') return { ok: true, status: 200, json: async () => enginesPayload() };
    if (path === '/agent/integrations') return { ok: true, status: 200, json: async () => integrationsPayload() };
    if (path === '/agent/integrations/catalog') return { ok: true, status: 200, json: async () => catalogPayload() };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const mounted = mount('AgentIntegrationsSettings', { app });
  await settle();
  const vm = mounted.instance;
  vm.newInstance();
  Object.assign(vm.instanceDraft, {
    name: 'OpenCode isolated verification',
    engine: 'opencode',
    baseUrl: 'http://127.0.0.1:14963',
    secretRef: 'ITSM_OPENCODE_VERIFY_PASSWORD',
    directory: '/srv/itsm/.verification/opencode-integrations/opencode',
    integrationIdentityId: MACHINE_ID
  });

  assert.equal(await vm.saveInstance(), false);
  assert.match(vm.instanceError, /El servidor rechazó la solicitud: secretRef ITSM_OPENCODE_VERIFY_PASSWORD does not resolve to a configured secret/);
  assert.match(nodeText(mounted.root), /does not resolve to a configured secret/);

  failure = {
    error: { code: 'validation_error', message: 'request validation failed' },
    details: [{ field: 'integrationIdentityId', message: 'Input should be a valid UUID' }]
  };
  assert.equal(await vm.saveInstance(), false);
  assert.match(vm.instanceError, /integrationIdentityId: Input should be a valid UUID/);
});

test('the catalog groups official skills from the canonical official module', async () => {
  const ui = surface({ component: 'AgentCatalogPanel', props: { catalog: catalogPayload() } });
  await ui.settle();

  assert.deepEqual(ui.vm.officialSkills.map(skill => skill.name), ['itsm.assets.search', 'itsm.assets.update']);
  assert.deepEqual(ui.vm.externalModules.map(module => module.id), ['netbox']);
  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /Paquete oficial/);
  assert.match(rendered, /itsm\.assets\.search/);
  assert.match(rendered, /Oficial/);
  assert.doesNotMatch(rendered, /no anunció skills oficiales/);
  assert.doesNotMatch(rendered, /ITSM official skills/);
  assert.equal((rendered.match(/itsm\.assets\.search/g) || []).length, 1);
  const disableButtons = collectNodes(ui.mount.root, node => node.tag === 'button' && /Deshabilitar módulo/.test(nodeText(node)));
  assert.equal(disableButtons.length, 1, 'only the external NetBox module exposes a disable action');
});

test('the wizard labels canonical official skills as official', async () => {
  const ui = surface({
    component: 'AgentIntegrationWizard',
    props: {
      instances: integrationsPayload().instances,
      catalog: catalogPayload(),
      identities: [{ id: MACHINE_ID, name: 'OpenCode ops', actorKind: 'agent' }]
    }
  });
  await ui.settle();
  ui.vm.step = 4;
  await ui.settle();

  const row = findNode(ui.mount.root, node => node.tag === 'li' && /itsm\.assets\.search/.test(nodeText(node)));
  assert.ok(row, 'the official skill row is rendered');
  assert.match(nodeText(row), /Oficial/);
  assert.doesNotMatch(nodeText(row), /Módulo itsm/);
});

test('a server refusal is shown factually without claiming an installation', async () => {
  const ui = surface({ component: 'AgentIntegrationWizard', props: { instances: integrationsPayload().instances, catalog: catalogPayload(), identities: [] } });
  ui.c.AssetAccess.request = async (vm, path, requestOptions) => {
    if (path === '/agent/integrations/install') {
      const error = new Error('El destino no existe en el host.');
      error.status = 422;
      throw error;
    }
    if (path === '/agent/integrations/targets') {
      return targetDetectionPayload({
        target: { engine: 'opencode', path: '/no-existe', profile: 'default', version: '1.4.0', remote: false },
        detection: {
          engine: 'opencode',
          format: 'v2',
          version: '1.4.0',
          profile: 'default',
          targetPath: '/no-existe',
          configFile: 'opencode.json',
          configExists: false,
          skillsDirectory: '.opencode/skills',
          limitations: []
        }
      });
    }
    return {};
  };
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/no-existe';
  await vm.next();
  assert.equal(await vm.detect(), true);
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.step = 5;
  assert.equal(await vm.install(), false);
  assert.match(vm.error, /no existe/i);
  assert.equal(vm.result, null);
  assert.equal(vm.verified, false);
});

test('quota administration requires system.providers on a human account', async () => {
  const denied = surface({ can: permission => permission === 'users.edit' || permission === 'users.view' });
  await denied.settle();
  assert.equal(denied.vm.canManageQuota, false);
  assert.equal(denied.calls.some(call => call.path === '/agent/usage/policy'), false);
  assert.equal(findNode(denied.mount.root, node => node.props && node.props.id === 'quota-policy'), null);

  const agent = surface({
    users: [{ id: 'agent-1', name: 'Agente automático', actorKind: 'agent', active: true }],
    activeUserId: 'agent-1'
  });
  await agent.settle();
  assert.equal(agent.app.can('system.providers'), true);
  assert.equal(agent.vm.canManageQuota, false);
  assert.equal(findNode(agent.mount.root, node => node.props && node.props.id === 'quota-policy'), null);
});

test('policy distinguishes zero from unlimited, saves both defaults and cancels only a pending timezone', async () => {
  const ui = surface({
    policy: quotaPolicyPayload({
      companyDailyLimit: 0,
      pendingTimezone: 'Europe/Madrid',
      pendingEffectiveDay: '2026-10-28'
    })
  });
  await ui.settle();
  assert.equal(ui.vm.canManageQuota, true);
  assert.equal(ui.vm.quotaDraft.companyMode, 'limited');
  assert.equal(Boolean(findNode(ui.mount.root, node => node.props && node.props.id === 'quota-personal-limit')), false);
  assert.match(nodeText(ui.mount.root), /El consumo con proveedores personales se registra, pero no tiene límite diario/);
  assert.equal(ui.vm.quotaLimitText(null, true), 'Ilimitado');
  assert.equal(ui.vm.quotaLimitText(0, true), '0 tokens · sin admisión');
  const text = nodeText(ui.mount.root);
  assert.match(text, /0 tokens · sin admisión/);
  assert.match(text, /Europe\/Madrid/);

  ui.vm.quotaDraft.companyMode = 'unlimited';
  ui.vm.quotaDraft.timezone = 'Europe/Madrid';
  assert.equal(await ui.vm.saveQuotaPolicy(), true);
  assert.deepEqual(plain(ui.state.policySave), { companyDailyLimit: null, timezone: 'Europe/Madrid' });
  assert.equal(ui.vm.quotaPolicy.pendingTimezone, 'Europe/Madrid');

  assert.equal(await ui.vm.cancelQuotaTimezoneChange(), true);
  assert.deepEqual(plain(ui.state.policySave), { cancelTimezoneChange: true });
  assert.equal(ui.vm.quotaPolicy.pendingTimezone, '');
});

test('overrides separate inherit, explicit zero and explicit unlimited for a real account', async () => {
  const users = [
    { id: 'human-1', name: 'Ana', username: 'ana', actorKind: 'human', active: true },
    { id: 'human-2', name: 'Luis', username: 'luis', actorKind: 'human', active: true }
  ];
  const ui = surface({
    users,
    can: permission => permission === 'system.providers' || permission === 'users.view',
    policy: quotaPolicyPayload({
      overrides: [{ userId: 'human-1', scope: 'company', dailyLimit: null, updatedAt: '2026-10-27T10:00:00Z' }]
    })
  });
  await ui.settle();
  assert.equal(ui.vm.canBrowseQuotaUsers, true);
  assert.equal(ui.vm.quotaUserOptions.length, 2);
  assert.equal(ui.vm.quotaOverrideUser, 'human-1');
  assert.equal(ui.vm.quotaOverrideMode, 'unlimited');
  assert.equal(ui.vm.quotaOverrideLimitText(ui.vm.quotaOverrideRecord), 'Ilimitado');
  assert.match(nodeText(ui.mount.root), /Ilimitado explícito/);

  ui.vm.quotaOverrideMode = 'inherit';
  assert.equal(await ui.vm.saveQuotaOverride(), true);
  assert.deepEqual(plain(ui.state.overrideDelete), { userId: 'human-1', scope: 'company' });
  assert.equal(ui.vm.quotaOverrides.length, 0);
  assert.match(ui.vm.quotaOverrideNotice, /hereda|heredar/i);

  ui.vm.quotaOverrideMode = 'limited';
  ui.vm.quotaOverrideLimit = '0';
  assert.equal(await ui.vm.saveQuotaOverride(), true);
  assert.deepEqual(plain(ui.state.overrideSave.body), { dailyLimit: 0, scope: 'company' });
  assert.equal(ui.vm.quotaOverrideRecord.dailyLimit, 0);
  assert.equal(ui.vm.quotaOverrideMode, 'limited');
  assert.equal(ui.vm.quotaOverrideLimit, '0');
  assert.match(ui.vm.quotaOverrideLimitText(ui.vm.quotaOverrideRecord), /sin admisión/);
  assert.match(ui.vm.quotaOverrideNotice, /cero|sin admisión/i);

  const putsBefore = ui.calls.filter(call => /^\/agent\/usage\/overrides\//.test(call.path) && call.method === 'PUT').length;
  ui.vm.quotaOverrideUser = 'ana';
  assert.equal(ui.vm.quotaOverrideInputValid, false);
  assert.equal(await ui.vm.saveQuotaOverride(), false);
  assert.match(ui.vm.quotaOverrideError, /lista/);
  assert.equal(ui.calls.filter(call => /^\/agent\/usage\/overrides\//.test(call.path) && call.method === 'PUT').length, putsBefore);

  const manual = surface({ can: permission => permission === 'system.providers' });
  await manual.settle();
  manual.vm.quotaOverrideUser = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  manual.vm.quotaOverrideMode = 'unlimited';
  assert.equal(manual.vm.quotaOverrideInputValid, true);
  assert.equal(await manual.vm.saveQuotaOverride(), true);
  assert.deepEqual(plain(manual.state.overrideSave.body), { dailyLimit: null, scope: 'company' });
  assert.equal(Boolean(findNode(manual.mount.root, node => node.props && node.props.id === 'quota-override-scope')), false,
    'personal funding has no overrides to choose');
  manual.vm.quotaOverrideUser = 'ana';
  assert.equal(manual.vm.quotaOverrideInputValid, false);
});

test('the report preserves server totals, null cells and legacy attribution', async () => {
  const legacy = {
    day: '2026-10-26',
    userId: 'human-1',
    funding: '',
    precision: 'unavailable',
    source: 'legacy',
    state: 'legacy',
    settledTokens: null,
    reservedTokens: null,
    pendingCount: null,
    unresolvedCount: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    legacy: true
  };
  const measured = quotaReportPayload().items[0];
  const report = quotaReportPayload({ items: [legacy, measured] });
  const pending = {
    items: [{
      reservationId: 'hold-1',
      runId: 'run-1',
      userId: 'human-1',
      funding: 'company',
      state: 'pending',
      reservedTokens: 300,
      periodDay: '2026-10-27',
      timezone: 'America/Mexico_City',
      createdAt: '2026-10-27T11:00:00Z'
    }]
  };
  const ui = surface({
    report,
    pending,
    users: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Ana', username: 'ana', actorKind: 'human', active: true }],
    can: permission => permission === 'system.providers' || permission === 'users.view'
  });
  await ui.settle();

  assert.equal(ui.vm.quotaReport.totals.settledTokens, 100);
  assert.equal(ui.vm.quotaReport.totals.receiptCount, 1);
  assert.equal(ui.vm.quotaReport.totals.legacyTokens, 5);
  assert.equal(ui.vm.quotaRowProvider(legacy), 'Sin atribuir (legado)');
  assert.equal(ui.vm.quotaRowModel(legacy), 'Sin atribuir (legado)');
  assert.equal(ui.vm.quotaTokenText(legacy.cacheReadTokens), 'No disponible');
  assert.equal(ui.vm.quotaTokenText(measured.cacheReadTokens), 'No disponible');
  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /Sin atribuir \(legado\)/);
  assert.match(rendered, /Legado sin atribuir/);
  assert.match(rendered, /No disponible/);
  assert.match(rendered, /no se suman al total/i);
  assert.match(rendered, /no pagina/i);

  ui.vm.quotaReportFilters.userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  ui.vm.quotaReportFilters.providerId = 'openai';
  ui.vm.quotaReportFilters.model = 'gpt-test';
  ui.vm.quotaReportFilters.engine = 'opencode';
  ui.vm.quotaReportFilters.funding = 'company';
  ui.vm.quotaReportFilters.dayFrom = '2026-10-01';
  ui.vm.quotaReportFilters.dayTo = '2026-10-27';
  ui.vm.quotaReportIncludeLegacy = false;
  assert.equal(await ui.vm.loadQuotaReport(), true);
  for (const part of [
    'userId=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'providerId=openai',
    'model=gpt-test',
    'engine=opencode',
    'funding=company',
    'dayFrom=2026-10-01',
    'dayTo=2026-10-27',
    'includeLegacy=false'
  ]) {
    assert.match(ui.state.reportQuery, new RegExp(part));
  }
  ui.vm.quotaReportFilters.userId = 'ana';
  assert.equal(await ui.vm.loadQuotaReport(), false);
  assert.match(ui.vm.quotaReportError, /UUID/);

  assert.equal(await ui.vm.loadQuotaPending(), true);
  assert.match(ui.state.pendingQuery, /limit=100/);
  assert.equal(ui.vm.quotaPending.length, 1);
  assert.equal(ui.vm.quotaPending[0].reservedTokens, 300);
  assert.equal(ui.vm.quotaStateLabel(ui.vm.quotaPending[0].state), 'Pendiente');
  assert.match(nodeText(ui.mount.root), /hold-1/);
  assert.match(nodeText(ui.mount.root), /300/);
  assert.equal(ui.calls.some(call => /\/release/.test(call.path)), false);
});

test('engine quota status comes only from the server DTO and missing status is non-strict', async () => {
  const integrations = integrationsPayload({
    instances: [
      {
        id: 'strict-engine',
        name: 'Estricto',
        engine: 'opencode',
        enabled: true,
        quota: { mode: 'managed', enforcement: 'strict', reason: 'gateway de ITSM' },
        quotaMode: 'managed',
        managedProviderId: 'itsm',
        managedContextTokens: 32000,
        directCompanyException: false
      },
      {
        id: 'direct-engine',
        name: 'Directo',
        engine: 'hermes',
        enabled: true,
        quota: { mode: 'direct', enforcement: 'observed', reason: 'ejecución nativa', directException: true }
      },
      { id: 'unknown-engine', name: 'Sin estado', engine: 'pydantic', enabled: true }
    ]
  });
  const ui = surface({ integrations });
  await ui.settle();
  const byId = id => ui.vm.adminInstances.find(instance => instance.id === id);
  const strict = ui.vm.quotaEngineStatus(byId('strict-engine'));
  const direct = ui.vm.quotaEngineStatus(byId('direct-engine'));
  const unknown = ui.vm.quotaEngineStatus(byId('unknown-engine'));
  assert.equal(strict.strict, true);
  assert.equal(direct.strict, false);
  assert.equal(direct.directException, true);
  assert.equal(unknown.known, false);
  assert.equal(unknown.enforcement, 'unavailable');
  assert.equal(unknown.strict, false);
  const rendered = nodeText(ui.mount.root);
  assert.match(rendered, /Gestionado por el gateway/);
  assert.match(rendered, /Estricta antes de enviar/);
  assert.match(rendered, /excepción directa de empresa/);
  assert.match(rendered, /No informado/);
});

test('a replaced administrator cannot revive policy, report or pending data', async () => {
  const ui = surface({
    users: [
      { id: 'human-1', name: 'Ana', actorKind: 'human', active: true },
      { id: 'human-2', name: 'Luis', actorKind: 'human', active: true }
    ],
    activeUserId: 'human-1',
    pending: { items: [{ reservationId: 'hold-1', reservedTokens: 5, state: 'pending' }] }
  });
  await ui.settle();
  assert.equal(await ui.vm.loadQuotaPending(), true);
  assert.ok(ui.vm.quotaPolicy && ui.vm.quotaReport && ui.vm.quotaPending);

  ui.state.deferPolicy = true;
  const stale = ui.vm.loadQuotaPolicy();
  await Promise.resolve();
  ui.app.can = () => false;
  ui.app.security.users = [{ id: 'human-2', name: 'Luis', actorKind: 'human', active: true }];
  ui.app.activeUserId = 'human-2';
  await ui.settle();
  ui.state.deferPolicy = false;
  ui.state.releasePolicy();
  assert.equal(await stale, false);
  await ui.settle();
  assert.equal(ui.vm.quotaPolicy, null);
  assert.equal(ui.vm.quotaReport, null);
  assert.equal(ui.vm.quotaPending, null);
});

test('a policy refresh cannot abort or strand an in-flight override mutation', async () => {
  const ui = surface({
    users: [{ id: 'human-1', name: 'Ana', username: 'ana', actorKind: 'human', active: true }],
    activeUserId: 'human-1'
  });
  await ui.settle();
  ui.vm.quotaOverrideUser = 'human-1';
  ui.vm.quotaOverrideScope = 'company';
  ui.vm.quotaOverrideMode = 'limited';
  ui.vm.quotaOverrideLimit = '0';
  ui.state.deferOverride = true;
  const saving = ui.vm.saveQuotaOverride();
  await ui.settle();
  assert.equal(ui.vm.quotaOverrideBusy, true);

  ui.state.deferPolicy = true;
  const refreshing = ui.vm.loadQuotaPolicy();
  await ui.settle();
  ui.state.deferOverride = false;
  ui.state.releaseOverride();
  assert.equal(await saving, true);
  assert.equal(ui.state.overrideSave.body.dailyLimit, 0);
  assert.equal(ui.vm.quotaOverrideBusy, false);

  ui.state.deferPolicy = false;
  ui.state.releasePolicy();
  assert.equal(await refreshing, false);
  assert.equal(ui.vm.quotaPolicyLoading, false);
  assert.equal(ui.vm.quotaAdminMutationBusy, false);
});

test('the picker clears its own quota when the account session ends', async () => {
  const ui = surface({ component: 'AgentEnginePicker' });
  await ui.settle();
  assert.ok(ui.vm.quotaSnapshot);
  ui.app.authenticated = false;
  await ui.settle();
  assert.equal(ui.vm.quotaSnapshot, null);
  assert.equal(ui.vm.quotaLoaded, false);
  assert.equal(ui.vm.quotaLoading, false);
});

test('instance quota provider responses cannot revive a signed-out or replaced account', async () => {
  for (const boundary of ['logout', 'identity']) {
    const ui = surface({
      component: 'AgentInstanceEditor',
      props: {
        canManageQuota: true,
        draft: {
          name: 'OpenCode', engine: 'opencode', quotaMode: 'managed',
          managedProviderId: '', managedContextTokens: '', defaultModel: ''
        }
      }
    });
    await ui.settle();
    assert.equal(ui.vm.quotaGlobalProviders.length, 1);
    let release;
    ui.c.AssetAccess.request = async (_app, path) => {
      assert.equal(path, '/agent/providers');
      if (release) return { items: [] };
      return new Promise(resolve => { release = () => resolve(providersPayload()); });
    };
    const pending = ui.vm.loadQuotaProviders();
    await Promise.resolve();
    if (boundary === 'logout') ui.app.authenticated = false;
    else ui.app.activeUserId = 'replacement-account';
    await ui.settle();
    release();
    assert.equal(await pending, false, boundary + ' invalidates the old request');
    await ui.settle();
    assert.equal(ui.vm.quotaGlobalProviders.length, 0, boundary + ' clears provider options');
    assert.equal(ui.vm.quotaProvidersLoading, false);
    assert.equal(ui.vm.quotaProvidersError, '');
  }
});

test('a saved managed provider is not announced as unavailable while its options are loading', async () => {
  const ui = surface({
    component: 'AgentInstanceEditor',
    deferProviders: true,
    props: {
      canManageQuota: true,
      draft: {
        name: 'OpenCode', engine: 'opencode', quotaMode: 'managed',
        managedProviderId: GLOBAL_PROVIDER_ID, managedContextTokens: '32768', defaultModel: 'global-model'
      }
    }
  });
  await ui.settle();
  const provider = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-provider');
  assert.equal(provider.props.disabled, true);
  assert.equal(Boolean(findNode(ui.mount.root, node => node.props && node.props.role === 'alert')), false);
  ui.state.releaseProviders();
  await ui.settle();
  const loaded = findNode(ui.mount.root, node => node.props && node.props.id === 'agent-instance-quota-provider');
  assert.equal(loaded.props.disabled, false);
  assert.equal(loaded.children.some(node => node.tag === 'option' && node.props.value === GLOBAL_PROVIDER_ID), true);
  assert.equal(Boolean(findNode(ui.mount.root, node => node.props && node.props.role === 'alert')), false);
});

test('rendered policy number inputs save numeric defaults including explicit zero', async () => {
  const ui = surface({ policy: quotaPolicyPayload({ companyDailyLimit: 50000 }) });
  await ui.settle();
  await enterNativeValue(ui, 'quota-company-limit', '0');
  assert.equal(ui.vm.quotaDraft.companyLimit, 0);

  const form = findNode(ui.mount.root, node => node.tag === 'form' && findNode(node, child => child.props && child.props.id === 'quota-company-limit'));
  await form.props.onSubmit({ preventDefault() {} });
  await ui.settle();
  const save = ui.calls.find(call => call.path === '/agent/usage/policy' && call.method === 'PUT');
  assert.ok(save, 'submitting valid native number values reaches the policy endpoint');
  assert.deepEqual(plain(save.body), { companyDailyLimit: 0 }, 'personal limits are never sent');
  assert.equal(ui.state.policy.companyDailyLimit, 0);
  assert.equal(ui.vm.quotaPolicyError, '');
});

test('rendered override number input saves positive and zero numeric limits without changing funding', async () => {
  const ui = surface({ users: [{ id: 'human-1', name: 'Ana', actorKind: 'human', active: true }] });
  await ui.settle();
  const section = findNode(ui.mount.root, node => node.props && node.props['aria-labelledby'] === 'quota-overrides-title');
  const limited = findNode(section, node => node.tag === 'input' && node.props.type === 'radio' && node.props.value === 'limited');
  limited.checked = true;
  limited.listeners.change({ target: limited });
  await ui.settle();

  for (const [value, expected] of [['100', 100], ['0', 0]]) {
    await enterNativeValue(ui, 'quota-override-limit', value);
    assert.equal(ui.vm.quotaOverrideLimit, expected);
    const currentSection = findNode(ui.mount.root, node => node.props && node.props['aria-labelledby'] === 'quota-overrides-title');
    const save = findNode(currentSection, node => node.tag === 'button' && node.props.onClick);
    await save.props.onClick({});
    await ui.settle();
    assert.ok(ui.state.overrideSave, 'saving a valid native number reaches the override endpoint');
    assert.equal(ui.state.overrideSave.userId, 'human-1');
    assert.deepEqual(plain(ui.state.overrideSave.body), { dailyLimit: expected, scope: 'company' });
    assert.equal(ui.vm.quotaOverrideRecord.dailyLimit, expected);
    assert.equal(ui.vm.quotaOverrideError, '');
  }
});

test('invalid native quota limits send no policy or override mutation and leave stored values unchanged', async () => {
  const ui = surface({ users: [{ id: 'human-1', name: 'Ana', actorKind: 'human', active: true }] });
  await ui.settle();
  const before = plain(ui.state.policy);
  const section = findNode(ui.mount.root, node => node.props && node.props['aria-labelledby'] === 'quota-overrides-title');
  const limited = findNode(section, node => node.tag === 'input' && node.props.type === 'radio' && node.props.value === 'limited');
  limited.checked = true;
  limited.listeners.change({ target: limited });
  await ui.settle();

  for (const value of ['-1', '1.5', '9007199254740992', 'NaN', 'Infinity', '']) {
    await enterNativeValue(ui, 'quota-company-limit', value);
    const form = findNode(ui.mount.root, node => node.tag === 'form' && findNode(node, child => child.props && child.props.id === 'quota-company-limit'));
    await form.props.onSubmit({ preventDefault() {} });
    await ui.settle();
    assert.ok(ui.vm.quotaPolicyError, value + ' is rejected for policy');

    await enterNativeValue(ui, 'quota-override-limit', value);
    const currentSection = findNode(ui.mount.root, node => node.props && node.props['aria-labelledby'] === 'quota-overrides-title');
    const save = findNode(currentSection, node => node.tag === 'button' && node.props.onClick);
    await save.props.onClick({});
    await ui.settle();
    assert.ok(ui.vm.quotaOverrideError, value + ' is rejected for overrides');
    assert.equal(ui.calls.filter(call => call.method === 'PUT' && call.path.startsWith('/agent/usage/')).length, 0);
    assert.deepEqual(plain(ui.state.policy), before);
  }
});

test('report provider scope stays distinct from company or personal funding', async () => {
  const measured = quotaReportPayload().items[0];
  const ui = surface({ report: quotaReportPayload({ items: [
    Object.assign({}, measured, { providerName: 'Isolated company', providerScope: 'global', funding: 'company' }),
    Object.assign({}, measured, { providerName: 'My provider', providerScope: 'personal', funding: 'personal' }),
    Object.assign({}, measured, { providerName: 'Unknown provider', providerScope: 'unknown', funding: 'company' })
  ] }) });
  await ui.settle();
  const table = findNode(ui.mount.root, node => node.tag === 'table' && node.props.class === 'agent-quota-table');
  const rows = collectNodes(table, node => node.tag === 'tr').filter(row => row.children.some(node => node.tag === 'td'));
  assert.equal(rows.length, 3);
  const cells = rows.map(row => row.children.filter(node => node.tag === 'td'));
  assert.equal(nodeText(cells[0][2]), 'Isolated company · Global');
  assert.equal(nodeText(cells[0][5]), 'Empresa');
  assert.equal(nodeText(cells[1][2]), 'My provider · Personal');
  assert.equal(nodeText(cells[1][5]), 'Personal');
  assert.equal(nodeText(cells[2][2]), 'Unknown provider · Ámbito no informado');
  assert.equal(nodeText(cells[2][5]), 'Empresa');
});

test('personal balance is recorded without a daily limit and never offers a remaining amount', async () => {
  const personal = quotaBalance({ limitTokens: null, availableTokens: null, limitSource: 'record_only', consumedTokens: 4200 });
  const ui = surface({ usage: usagePayload({ funding: { company: quotaBalance(), personal } }) });
  await ui.settle();
  const text = nodeText(ui.mount.root);
  assert.match(text, /Límite: Sin límite diario · Solo registro/);
  assert.match(text, /Disponible: No aplica: se usa tu propia clave/);
  assert.doesNotMatch(text, /Límite diario personal/);
});

test('owners can check a stored key without ever seeing it again', async () => {
  const owner = { providers: providersPayload({ canManagePersonal: true }), can: () => true };
  const ui = surface(Object.assign({ providerCheck: { ok: false, code: 'unauthorized', checkedAt: '2026-10-27T12:00:00Z' } }, owner));
  await ui.settle();
  const text = nodeText(ui.mount.root);
  assert.match(text, /Credencial guardada con una clave de cifrado anterior/);
  assert.doesNotMatch(text, /sk-|apiKey/);
  const button = findNode(ui.mount.root, node => node.props && node.props.id === 'provider-check-' + PERSONAL_PROVIDER_ID);
  assert.ok(button, 'the owner sees a check action for their own provider');
  await button.props.onClick();
  await ui.settle();
  const call = ui.calls.find(item => item.path === '/agent/providers/' + PERSONAL_PROVIDER_ID + '/check');
  assert.equal(call.method, 'POST');
  assert.equal(call.body, undefined, 'the check sends no credential');
  assert.match(nodeText(ui.mount.root), /El proveedor rechazó la credencial/);

  const ok = surface(owner);
  await ok.settle();
  await findNode(ok.mount.root, node => node.props && node.props.id === 'provider-check-' + PERSONAL_PROVIDER_ID).props.onClick();
  await ok.settle();
  assert.match(nodeText(ok.mount.root), /Conexión correcta: el proveedor ofrece 3 modelos/);
});

test('new providers discover models automatically and owners mark multimodal capability per model', async () => {
  const discovered = {
    id: PERSONAL_PROVIDER_ID,
    name: 'OpenRouter personal',
    scope: 'personal',
    baseUrl: 'https://openrouter.example/api/v1',
    models: ['vision-model', 'text-model'],
    modelSelection: 'auto',
    discoveredModels: [{ id: 'vision-model', inputModalities: ['text', 'image'] }, { id: 'text-model', inputModalities: null }],
    modelCapabilities: {
      'vision-model': { image: true, file: false, source: 'provider' },
      'text-model': { image: null, file: null, source: 'unknown' }
    },
    discovery: { code: 'ok', checkedAt: '2026-10-27T12:00:00Z', count: 2 },
    enabled: true,
    credentialConfigured: true,
    credentialStatus: 'primary'
  };
  const ui = surface({
    component: 'AgentProvidersPanel',
    providers: { items: [discovered], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true },
    can: () => true
  });
  await ui.settle();
  const text = nodeText(ui.mount.root);
  assert.match(text, /Modelos descubiertos automáticamente: 2/);
  assert.match(text, /Acepta imágenes: vision-model/);
  assert.match(text, /Capacidad multimodal sin informar: text-model/);

  const panel = findNode(ui.mount.root, node => node.props && node.props.id === 'provider-new-personal');
  await panel.props.onClick();
  await ui.settle();
  const selection = findNode(ui.mount.root, node => node.props && node.props.id === 'provider-model-selection');
  assert.equal(selection.props.value, 'auto');
  assert.equal(Boolean(findNode(ui.mount.root, node => node.props && node.props.id === 'provider-models')), false, 'auto mode asks for no model list');
  const vm = ui.vm;
  vm.draft.name = 'Nuevo';
  vm.draft.baseUrl = 'https://nuevo.example/v1';
  assert.equal(await vm.saveProvider(), true);
  const created = ui.calls.find(call => call.path === '/agent/providers' && call.method === 'POST');
  assert.equal(JSON.stringify(created.body), JSON.stringify({ name: 'Nuevo', scope: 'personal', baseUrl: 'https://nuevo.example/v1', modelSelection: 'auto', enabled: true }));

  assert.equal(vm.editProvider(vm.items[0]), true);
  await ui.settle();
  const mark = findNode(ui.mount.root, node => node.props && node.props.id === 'provider-capability-image-1');
  assert.ok(mark, 'each offered model has an image capability control');
  assert.equal(mark.props.value, '');
  vm.setCapability('text-model', 'image', 'true');
  vm.setCapability('text-model', 'file', 'false');
  assert.equal(await vm.saveProvider(), true);
  const patched = ui.calls.filter(call => call.path === '/agent/providers/' + PERSONAL_PROVIDER_ID && call.method === 'PATCH').pop();
  assert.equal(JSON.stringify(patched.body.modelCapabilities), JSON.stringify({ 'text-model': { image: true, file: false } }));
  assert.equal(patched.body.modelSelection, 'auto');
  assert.equal('models' in patched.body, false, 'auto mode never sends a stale list');
});

test('a failed discovery is reported with its closed reason and never blocks the provider', async () => {
  const failing = {
    id: PERSONAL_PROVIDER_ID, name: 'Sin modelos', scope: 'personal', baseUrl: 'https://x.example/v1',
    models: [], modelSelection: 'auto', discoveredModels: [], modelCapabilities: {},
    discovery: { code: 'unauthorized', checkedAt: '2026-10-27T12:00:00Z', count: 0 },
    enabled: true, credentialConfigured: true, credentialStatus: 'primary'
  };
  const ui = surface({ component: 'AgentProvidersPanel', providers: { items: [failing], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true }, can: () => true });
  await ui.settle();
  assert.match(nodeText(ui.mount.root), /No se pudieron descubrir los modelos: El proveedor rechazó la credencial/);
});

test('checking a provider refreshes its discovered models in the list', async () => {
  const before = { id: PERSONAL_PROVIDER_ID, name: 'P', scope: 'personal', baseUrl: 'https://x.example/v1', models: [], modelSelection: 'auto', discoveredModels: [], modelCapabilities: {}, discovery: { code: 'timeout', checkedAt: null, count: 0 }, enabled: true, credentialConfigured: true, credentialStatus: 'primary' };
  const after = Object.assign({}, before, { models: ['m1'], discoveredModels: [{ id: 'm1', inputModalities: null }], discovery: { code: 'ok', checkedAt: '2026-10-27T12:00:00Z', count: 1 } });
  const ui = surface({
    component: 'AgentProvidersPanel',
    providers: { items: [before], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true },
    providerCheck: { ok: true, code: 'ok', modelCount: 1, checkedAt: '2026-10-27T12:00:00Z', provider: after },
    can: () => true
  });
  await ui.settle();
  ui.state.providers = { items: [after], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true };
  assert.equal(await ui.vm.checkProvider(ui.vm.items[0]), true);
  await ui.settle();
  assert.match(nodeText(ui.mount.root), /Modelos: m1/);
  assert.match(nodeText(ui.mount.root), /Conexión correcta: el proveedor ofrece 1 modelos/);
});

test('editing one model capability preserves existing owner marks for other models', async () => {
  const provider = { id: PERSONAL_PROVIDER_ID, name: 'P', scope: 'personal', baseUrl: 'https://x.example/v1', models: ['a', 'b'], modelSelection: 'auto', discoveredModels: [], modelCapabilities: { a: { image: true, file: false, source: 'owner' }, b: { image: null, file: null, source: 'unknown' } }, discovery: { code: 'ok', count: 2 }, enabled: true, credentialConfigured: true, credentialStatus: 'primary' };
  const ui = surface({ component: 'AgentProvidersPanel', providers: { items: [provider], canManageGlobal: false, canManagePersonal: true, credentialStorageAvailable: true }, can: () => true });
  await ui.settle();
  ui.vm.editProvider(ui.vm.items[0]);
  ui.vm.setCapability('b', 'file', 'true');
  await ui.vm.saveProvider();
  const patch = ui.calls.find(call => call.method === 'PATCH' && call.path === '/agent/providers/' + PERSONAL_PROVIDER_ID);
  assert.deepEqual(plain(patch.body.modelCapabilities), { a: { image: true, file: false }, b: { image: null, file: true } });
});
