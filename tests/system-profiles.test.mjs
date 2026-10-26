// Behavioural coverage for installation profiles on the Vue surface:
// permission catalog, route gating, truthful executor states, the system
// configuration contract and the reserved-role assignment ceiling. The HTTP
// boundary is the canonical AssetAccess transport used by the shipped app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { setup } = require('./universal-harness.cjs');

const SYSTEM_PERMISSIONS = [
  'system.view',
  'system.providers',
  'system.modules',
  'system.configure',
  'system.backup',
  'system.update'
];

function plain(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
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

function byId(root, id) {
  return findNode(root, (node) => node.props && node.props.id === id);
}

function click(root, label) {
  const node = findNode(root, (item) => item.tag === 'button' && nodeText(item).includes(label));
  assert.ok(node, 'rendered button: ' + label);
  const handler = (node.props && node.props.onClick) || (node.listeners && node.listeners.click);
  assert.ok(handler, 'button is wired: ' + label);
  handler({ preventDefault() {}, stopPropagation() {} });
}

function isDisabled(root, label) {
  const node = findNode(root, (item) => item.tag === 'button' && nodeText(item).includes(label));
  assert.ok(node, 'rendered button: ' + label);
  return node.props.disabled === true;
}

function changeSelect(root, id, value) {
  const node = byId(root, id);
  assert.ok(node, 'rendered select: ' + id);
  const handler = (node.listeners && node.listeners.change) || (node.props && (node.props.onChange || node.props['onUpdate:modelValue']));
  assert.ok(handler, 'select is wired: ' + id);
  node.value = value;
  handler({ target: node });
}

function typeInput(root, id, value) {
  const node = byId(root, id);
  assert.ok(node, 'rendered input: ' + id);
  const handler = (node.listeners && node.listeners.input) || (node.props && (node.props.onInput || node.props['onUpdate:modelValue']));
  assert.ok(handler, 'input is wired: ' + id);
  node.value = value;
  handler({ target: node });
}

function submitContaining(root, fieldId) {
  let node = byId(root, fieldId);
  while (node && node.tag !== 'form') node = node.parent;
  assert.ok(node, 'form contains: ' + fieldId);
  const handler = (node.props && node.props.onSubmit) || (node.listeners && node.listeners.submit);
  assert.ok(handler, 'form is wired');
  handler({ preventDefault() {} });
}

function statusPayload(overrides) {
  return Object.assign({
    ready: true,
    checkedAt: '2026-01-02T03:04:05Z',
    app: { name: 'ITSM Asset', version: '0.1.0', mode: 'production', database: 'sqlite' },
    readiness: { database: 'ok', migrations: 'ok', current: '0020', head: '0020' },
    executor: { configured: false, available: false, actions: [], detail: null }
  }, overrides);
}

function configurationPayload(overrides) {
  return Object.assign({
    deployment: { classification: 'test', maintenanceWindow: 'anytime', database: 'sqlite' },
    executor: { configured: false }
  }, overrides);
}

function providersPayload(overrides) {
  return Object.assign({
    selected: { provider: 'openai', model: 'gpt-4o-mini' },
    selection: { provider: 'openai', model: 'gpt-4o-mini', source: 'installation', updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'superadmin' },
    providers: [
      { id: 'openai', label: 'OpenAI', credentialConfigured: true, credentialEnv: ['OPENAI_API_KEY'] },
      { id: 'anthropic', label: 'Anthropic', credentialConfigured: false, credentialEnv: ['ANTHROPIC_API_KEY'] }
    ]
  }, overrides);
}

function modulesPayload() {
  return {
    modules: [
      { id: 'itsm', name: 'ITSM oficial', enabled: true, official: true, version: '1.0.0' },
      { id: 'netbox', name: 'NetBox', enabled: true, official: false, version: '2.0.0' }
    ]
  };
}

function operationResult(action, overrides) {
  return Object.assign({
    action,
    state: 'unavailable',
    result: null,
    reference: null,
    exitCode: null,
    startedAt: null,
    durationMs: null,
    message: 'Sin ejecutor externo configurado.'
  }, overrides);
}

function systemSurface(options) {
  const config = options || {};
  const { c, app, mount, settle } = setup();
  const calls = [];
  const state = {
    status: config.status === undefined ? statusPayload() : plain(config.status),
    configuration: config.configuration === undefined ? configurationPayload() : plain(config.configuration),
    providers: config.providers === undefined ? providersPayload() : plain(config.providers),
    modules: config.modules === undefined ? modulesPayload() : plain(config.modules),
    operations: config.operations || null
  };
  app.can = config.can || (() => true);
  if (config.csrfToken) app.csrfToken = config.csrfToken;
  c.AssetAccess.request = async (vm, path, requestOptions) => {
    const request = requestOptions || {};
    const method = request.method || 'GET';
    const body = request.body;
    calls.push({ path, method, body: plain(body), signal: request.signal });
    if (config.request) {
      const custom = await config.request({ path, method, body, requestOptions: request, state });
      if (custom !== undefined) return custom;
    }
    if (path === '/system/status') return plain(state.status);
    if (path === '/system/configuration' && method === 'GET') return plain(state.configuration);
    if (path === '/system/configuration' && method === 'PATCH') {
      state.configuration = plain(state.configuration);
      state.configuration.deployment = Object.assign({}, state.configuration.deployment, plain(body && body.deployment));
      return plain(state.configuration);
    }
    if (path === '/system/providers' && method === 'GET') return plain(state.providers);
    if (path === '/system/providers' && method === 'PUT') {
      const selection = { provider: body.provider, model: body.model, source: 'installation', updatedAt: '2026-02-02T00:00:00Z', updatedBy: 'superadmin' };
      state.providers = plain(state.providers);
      state.providers.selection = selection;
      state.providers.selected = { provider: body.provider, model: body.model };
      return plain(state.providers);
    }
    if (path === '/system/modules' && method === 'GET') return plain(state.modules);
    if (path.startsWith('/system/modules/') && method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').pop());
      state.modules.modules = state.modules.modules.map((module) => module.id === id ? Object.assign({}, module, { enabled: body.enabled }) : module);
      return { id, enabled: body.enabled, registered: body.enabled };
    }
    if (path === '/system/operations' && method === 'POST') {
      const action = body.action;
      if (state.operations && state.operations[action]) return plain(state.operations[action]);
      return operationResult(action);
    }
    return { error: { code: 'not_found' } };
  };
  const mounted = mount(config.component || 'SystemOperations', Object.assign({ app }, config.props || {}));
  return { c, app, calls, state, mount: mounted, vm: mounted.instance, settle };
}

function roleFixture() {
  return [
    { id: 'superadmin', name: 'Superadmin', permissions: SYSTEM_PERMISSIONS.concat(['assets.view', 'config.integrations']), builtIn: true },
    { id: 'admin', name: 'Admin', permissions: ['assets.view', 'config.integrations'], builtIn: true },
    { id: 'user', name: 'User', permissions: ['assets.view'], builtIn: true }
  ];
}

test('the permission catalog carries the six reserved installation grants', () => {
  const { c } = setup();
  const group = c.AssetAccess.catalog.find((item) => item.id === 'system');
  assert.ok(group, 'system permission group exists');
  assert.deepEqual(Array.from(group.permissions, (permission) => permission.id), SYSTEM_PERMISSIONS);
  assert.equal(group.label, 'Sistema');
});

test('the sistema route is addressable and driven by server permissions', () => {
  const { c, app } = setup();
  const route = { name: 'config', section: 'general', assetId: null, personId: null };
  assert.deepEqual(plain(c.AssetSystemViews.routeOverride(route, '#/configuracion/sistema')), { name: 'config', section: 'sistema', assetId: null, personId: null });
  assert.equal(c.AssetSystemViews.routeOverride(route, '#/configuracion/ia'), null);

  app.authenticated = true;
  app.security.users = [{ id: 'u-admin', name: 'Admin', roleId: 'admin', active: true }];
  app.activeUserId = 'u-admin';
  app.serverPermissions = ['assets.view', 'people.view'];
  app.can = (permission) => app.serverPermissions.includes(permission);
  assert.equal(app.accessRoute({ name: 'config', section: 'sistema' }).name, 'denied', 'Admin without system.view is denied the direct route');

  app.serverPermissions = ['system.view'];
  const allowed = app.accessRoute({ name: 'config', section: 'sistema' });
  assert.equal(allowed.name, 'config');
  assert.equal(allowed.section, 'sistema');
});

test('a role without system.view sees no system controls and makes no request', async () => {
  const ui = systemSurface({ can: () => false });
  await ui.settle();
  assert.equal(ui.calls.length, 0);
  const text = nodeText(ui.mount.root);
  assert.match(text, /no tiene el permiso para ver el sistema/);
  assert.equal(findNode(ui.mount.root, (node) => node.tag === 'button'), null);
});

test('view-only access reads status, configuration and providers, never modules', async () => {
  const ui = systemSurface({ can: (permission) => permission === 'system.view' });
  await ui.settle();
  assert.deepEqual(ui.calls.map((call) => call.path).sort(), ['/system/configuration', '/system/providers', '/system/status']);
  assert.ok(ui.calls.every((call) => call.method === 'GET'));
  const text = nodeText(ui.mount.root);
  assert.match(text, /ITSM Asset/);
  assert.match(text, /Preparado/);
  assert.match(text, /Base de datos/);
  assert.match(text, /requiere el permiso de módulos del sistema/);
  assert.match(text, /requiere el permiso de configuración del despliegue/);
  assert.match(text, /requiere el permiso de proveedores de IA/);
  assert.match(text, /Comprobar despliegue/);
  assert.match(text, /solo puede consultar el estado/);
  assert.equal(findNode(ui.mount.root, (node) => node.tag === 'button' && nodeText(node).includes('Guardar preferencias')), null);
  assert.equal(findNode(ui.mount.root, (node) => node.tag === 'button' && nodeText(node).includes('Crear respaldo')), null);
});

test('the status panel never presents an unconfigured executor as ready', async () => {
  const ui = systemSurface({
    status: statusPayload({ ready: false, executor: { configured: false, available: false, actions: [], detail: null } })
  });
  await ui.settle();
  const text = nodeText(ui.mount.root);
  assert.match(text, /Sin ejecutor externo configurado/);
  assert.match(text, /sin configurar/);
  assert.match(text, /No preparado/);
  assert.doesNotMatch(text, /ejecutor externo: configurado/);
});

test('a deployment check reports the server unavailable state, never a synthetic success', async () => {
  const ui = systemSurface({ can: (permission) => permission === 'system.view' });
  await ui.settle();
  click(ui.mount.root, 'Comprobar despliegue');
  await ui.settle();
  const operation = ui.calls.find((call) => call.path === '/system/operations');
  assert.ok(operation, 'deployment.status was requested');
  assert.equal(operation.method, 'POST');
  assert.deepEqual(operation.body, { action: 'deployment.status' });
  const text = nodeText(ui.mount.root);
  assert.match(text, /No disponible/);
  assert.match(text, /Sin ejecutor externo configurado\./);
  assert.doesNotMatch(text, /Completado/);
});

test('superadmin saves deployment classification and maintenance through the nested contract', async () => {
  const ui = systemSurface();
  await ui.settle();
  assert.ok(byId(ui.mount.root, 'system-classification'), 'classification select is rendered');
  assert.ok(byId(ui.mount.root, 'system-maintenance'), 'maintenance select is rendered');
  ui.vm.configurationDraft.classification = 'production';
  ui.vm.configurationDraft.maintenanceWindow = 'outside_business_hours';
  submitContaining(ui.mount.root, 'system-classification');
  await ui.settle();
  const patch = ui.calls.find((call) => call.path === '/system/configuration' && call.method === 'PATCH');
  assert.ok(patch, 'configuration PATCH was sent');
  assert.deepEqual(patch.body, { deployment: { classification: 'production', maintenanceWindow: 'outside_business_hours' } });
  assert.equal('environment' in patch.body.deployment, false);
  assert.match(nodeText(ui.mount.root), /Preferencias del despliegue guardadas/);
});

test('a replacement session while authenticated re-reads and discards the old response', async () => {
  let releaseFirst = null;
  let statusCalls = 0;
  const ui = systemSurface({
    csrfToken: 'csrf-one',
    request: ({ path }) => {
      if (path !== '/system/status') return undefined;
      statusCalls += 1;
      if (statusCalls > 1) {
        return statusPayload({ app: Object.assign({}, statusPayload().app, { name: 'Nuevo' }) });
      }
      return new Promise((resolve) => {
        releaseFirst = () => resolve(statusPayload({ app: Object.assign({}, statusPayload().app, { name: 'Anterior' }) }));
      });
    }
  });
  await ui.settle();
  assert.ok(releaseFirst, 'the first status request is still pending');
  const initial = ui.calls.find((call) => call.path === '/system/status');
  ui.app.csrfToken = 'csrf-two';
  await ui.settle();
  releaseFirst();
  await ui.settle();
  assert.equal(initial.signal.aborted, true, 'the previous identity signal is aborted');
  assert.equal(ui.vm.status.app.name, 'Nuevo', 'the new identity result is the only one published');
});

test('a selected-only provider response still presents the installed default', async () => {
  const base = providersPayload();
  const ui = systemSurface({ providers: { selected: { provider: 'openai', model: 'gpt-4o-mini' }, selection: null, providers: base.providers } });
  await ui.settle();
  assert.equal(ui.vm.providerDraft.provider, 'openai');
  assert.equal(ui.vm.providerDraft.model, 'gpt-4o-mini');
  assert.match(nodeText(ui.mount.root), /Selección actual:\s*OpenAI · gpt-4o-mini/);
  assert.equal(byId(ui.mount.root, 'system-provider-model').props.value, 'gpt-4o-mini');
});

test('provider selection saves only provider and model, never credentials', async () => {
  const ui = systemSurface();
  await ui.settle();
  assert.ok(byId(ui.mount.root, 'system-provider'), 'provider select is rendered');
  ui.vm.providerDraft.provider = 'anthropic';
  ui.vm.providerDraft.model = 'claude-sonnet-4';
  submitContaining(ui.mount.root, 'system-provider-model');
  await ui.settle();
  const put = ui.calls.find((call) => call.path === '/system/providers' && call.method === 'PUT');
  assert.ok(put, 'providers PUT was sent');
  assert.deepEqual(Object.keys(put.body).sort(), ['model', 'provider']);
  assert.deepEqual(put.body, { provider: 'anthropic', model: 'claude-sonnet-4' });
  assert.doesNotMatch(JSON.stringify(put.body), /API_KEY|secret|token/i);
  const text = nodeText(ui.mount.root);
  assert.match(text, /Anthropic · claude-sonnet-4/);
  assert.match(text, /Credencial configurada/);
  assert.match(text, /Sin credencial/);
});

test('module mutation uses the system modules endpoint and leaves the official module alone', async () => {
  const ui = systemSurface();
  await ui.settle();
  const officialRow = findNode(ui.mount.root, (node) => node.props && String(node.props.class).includes('agent-module'));
  assert.ok(officialRow);
  assert.equal(collectNodes(ui.mount.root, (node) => node.tag === 'button' && nodeText(node).includes('Deshabilitar módulo')).length, 1);
  assert.match(nodeText(ui.mount.root), /no se deshabilita aquí/);
  click(ui.mount.root, 'Deshabilitar módulo');
  await ui.settle();
  const patch = ui.calls.find((call) => call.path.startsWith('/system/modules/') && call.method === 'PATCH');
  assert.ok(patch, 'module PATCH was sent');
  assert.equal(patch.path, '/system/modules/netbox');
  assert.deepEqual(patch.body, { enabled: false });
  assert.match(nodeText(ui.mount.root), /Habilitar módulo/);
  assert.equal(ui.state.modules.modules.find((module) => module.id === 'netbox').enabled, false);
});

test('a configured executor runs the fixed backup action and shows its reference', async () => {
  const ui = systemSurface({
    status: statusPayload({ executor: { configured: true, available: true, actions: ['deployment.status', 'update.prepare', 'backup.create'], detail: null } }),
    operations: {
      'backup.create': operationResult('backup.create', {
        state: 'completed',
        result: { status: 'ok' },
        reference: 'backup-2026-01-02',
        exitCode: 0,
        durationMs: 120,
        message: 'Respaldo creado.'
      })
    }
  });
  await ui.settle();
  click(ui.mount.root, 'Crear respaldo');
  await ui.settle();
  const operation = ui.calls.find((call) => call.path === '/system/operations');
  assert.ok(operation);
  assert.deepEqual(operation.body, { action: 'backup.create' });
  const text = nodeText(ui.mount.root);
  assert.match(text, /Completado/);
  assert.match(text, /Respaldo creado\./);
  assert.match(text, /backup-2026-01-02/);
  assert.match(text, /Código de salida: 0/);
});

test('an unavailable executor disables update and backup and never posts', async () => {
  const ui = systemSurface({
    status: statusPayload({ executor: { configured: true, available: false, actions: [], detail: 'El socket del ejecutor no responde.' } })
  });
  await ui.settle();
  assert.equal(isDisabled(ui.mount.root, 'Preparar actualización'), true);
  assert.equal(isDisabled(ui.mount.root, 'Crear respaldo'), true);
  click(ui.mount.root, 'Crear respaldo');
  click(ui.mount.root, 'Preparar actualización');
  await ui.settle();
  assert.equal(ui.calls.filter((call) => call.path === '/system/operations').length, 0);
  assert.match(nodeText(ui.mount.root), /El ejecutor externo no está disponible: El socket del ejecutor no responde\./);
});

test('logout aborts in-flight reads and discards their late payloads', async () => {
  let releaseStatus = null;
  let statusSignal = null;
  const ui = systemSurface({
    request: ({ path, requestOptions }) => {
      if (path !== '/system/status') return undefined;
      statusSignal = requestOptions.signal;
      return new Promise((resolve) => { releaseStatus = resolve; });
    }
  });
  await ui.settle();
  assert.ok(ui.vm.loading, 'the status request is still pending');
  assert.ok(statusSignal, 'the request carried an abort signal');
  ui.app.authenticated = false;
  await ui.settle();
  assert.equal(statusSignal.aborted, true, 'logout aborts the in-flight read');
  assert.equal(ui.vm.status, null, 'disposed state drops the pending status');
  assert.equal(ui.vm.loading, false);
  releaseStatus(statusPayload());
  await ui.settle();
  assert.equal(ui.vm.status, null, 'a late payload never repopulates installation state');
});

test('server role metadata, not role ids, marks built-in roles', async () => {
  const { app, mount, settle } = setup();
  app.security.roles = roleFixture().map((role) => Object.assign({}, role, { builtIn: role.id === 'superadmin' }));
  const mounted = mount('AccessSecurity', { app });
  await settle();
  const text = nodeText(mounted.root);
  assert.match(text, /Superadmin/);
  assert.match(text, /Admin/);
  const baseBadges = collectNodes(mounted.root, (node) => node.props && String(node.props.class || '').includes('role-badge') && String(node.text || '').trim() === 'Base');
  assert.equal(baseBadges.length, 1, 'only the server-flagged role is a base role');
});

test('a limited administrator cannot assign reserved roles and sees them as restricted', async () => {
  const { c, app, mount, settle } = setup();
  c.options.components.AccessAccountForm = c.AssetAccessViews.AccessAccountForm;
  app.security.roles = roleFixture();
  app.can = (permission) => ['users.create', 'users.edit', 'assets.view', 'config.integrations'].includes(permission);
  const draft = { id: '', username: 'nuevo', name: 'Nuevo', email: '', roleId: 'admin', active: true, personId: '', password: 'x' };
  const errors = { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' };
  const create = mount('AccessAccountForm', { app, draft, errors, mode: 'create', formId: 'account-create' });
  await settle();
  const select = byId(create.root, 'access-role');
  const values = collectNodes(select, (node) => node.tag === 'option').map((node) => node.props.value);
  assert.equal(values.includes('superadmin'), false, 'reserved role is not assignable');
  assert.ok(values.includes('admin'));
  assert.ok(values.includes('user'));
  assert.doesNotMatch(nodeText(select), /Superadmin/);

  const edit = mount('AccessAccountForm', {
    app,
    draft: Object.assign({}, draft, { id: 'account-1', roleId: 'superadmin' }),
    errors,
    mode: 'edit',
    formId: 'account-edit'
  });
  await settle();
  const editSelect = byId(edit.root, 'access-role');
  assert.match(nodeText(editSelect), /Superadmin · Restringido/, 'existing reserved role is shown but still restricted');
});

function agentSurface(can) {
  const { c, app, mount, settle } = setup();
  const calls = [];
  app.can = can;
  c.AssetAccess.request = async (vm, path, requestOptions) => {
    const method = (requestOptions && requestOptions.method) || 'GET';
    calls.push({ path, method, body: requestOptions && requestOptions.body });
    if (path === '/agent/engines') {
      return {
        instances: [
          { id: 'pydantic', name: 'Pydantic AI', engine: 'pydantic', enabled: true, models: [{ id: 'internal', name: 'Modelo interno', provider: 'itsm', free: true }], capabilities: { streaming: false, cancel: false, tools: true, usage: true } }
        ],
        preference: { instanceId: 'pydantic', model: 'internal' },
        budget: { dailyLimit: 0, usedMeasured: 0, usedReported: 0, strictExternal: false }
      };
    }
    if (path === '/agent/integrations') return { instances: [], installations: [], defaults: { instanceId: null, model: null } };
    if (path === '/agent/integrations/catalog') {
      return { skills: [], modules: [{ id: 'netbox', name: 'NetBox', enabled: true, official: false }] };
    }
    return {};
  };
  const mounted = mount('AgentIntegrationsSettings', { app });
  return { c, app, calls, mount: mounted, vm: mounted.instance, settle };
}

test('IA administration is gated by system.providers while chat preference stays on assets.view', async () => {
  const preferenceOnly = agentSurface((permission) => permission === 'assets.view' || permission === 'config.integrations');
  await preferenceOnly.settle();
  const preferenceText = nodeText(preferenceOnly.mount.root);
  assert.match(preferenceText, /Preferencia del chat/);
  assert.match(preferenceText, /requiere el permiso de proveedores de IA del sistema/);
  assert.equal(preferenceOnly.calls.some((call) => call.path === '/agent/integrations'), false);
  assert.ok(preferenceOnly.calls.some((call) => call.path === '/agent/engines'), 'the chat preference still loads engines');

  const providerAdmin = agentSurface((permission) => permission === 'system.providers');
  await providerAdmin.settle();
  const adminText = nodeText(providerAdmin.mount.root);
  assert.match(adminText, /Catálogo compartido/);
  assert.match(adminText, /Cambiar módulos requiere el permiso de módulos del sistema/);
  assert.equal(findNode(providerAdmin.mount.root, (node) => node.tag === 'button' && nodeText(node).includes('Deshabilitar módulo')), null);

  const fullAdmin = agentSurface((permission) => permission === 'system.providers' || permission === 'system.modules');
  await fullAdmin.settle();
  assert.ok(findNode(fullAdmin.mount.root, (node) => node.tag === 'button' && nodeText(node).includes('Deshabilitar módulo')), 'module mutation is offered with system.modules');
});
