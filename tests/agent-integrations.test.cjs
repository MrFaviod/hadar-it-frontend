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
  c.AssetAccess.request = async (vm, path, requestOptions) => {
    const method = (requestOptions && requestOptions.method) || 'GET';
    const body = requestOptions && requestOptions.body;
    calls.push({ path, method, body });
    if (path === '/agent/engines') return state.engines;
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
  vm.mcp.url = 'http://127.0.0.1:8000/mcp';
  vm.mcp.secretRef = 'ITSM_MCP_TOKEN';
  vm.mcp.identityId = MACHINE_ID;
  vm.selectedSkills = ['itsm.assets.search'];
  vm.detection = { detected: true, targetPath: '/srv/hermes/itsm' };
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
    directory: '/home/example-user/Dev/itms/asset/.verification/opencode-integrations/opencode',
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
    return { detected: true, path: '/srv/opencode' };
  };
  const vm = ui.vm;
  vm.mode = 'existing';
  vm.instanceId = ENGINE_ID;
  vm.target.path = '/no-existe';
  vm.detection = { detected: true, path: '/no-existe' };
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
