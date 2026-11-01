'use strict';
// T3a sweep F: the agent integration surface (engines, OpenAI-compatible
// providers, MCP installations, machine identities, the daily AI quota and the
// shared skill catalog) renders from the `ui.agents.*` catalog. Every test
// switches the shipped runtime to `en` and back to `es`, so a hard-coded
// literal in either language fails here. Stable technical identifiers (engine
// ids, skill names, MCP command lines) must never change with the language.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function text(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(text).join(' ');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function respond(payload, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => clone(payload) };
}

// Canonical HTTP fixture at the browser boundary: every read goes through the
// shipped `AssetAccess.request` transport and the components' own adapters.
function stubAgentFetch(s, routes) {
  s.c.fetch = async (url, init = {}) => {
    const target = String(url).replace(/^\/api\/v1/, '');
    const path = target.split('?')[0];
    const method = init.method || 'GET';
    const key = method + ' ' + path;
    if (routes[key]) return respond(routes[key]);
    if (routes[path]) return respond(routes[path]);
    return respond({ error: { code: 'not_found' }, details: [] }, 404);
  };
}

async function withLocales(s, pairs) {
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
  pairs.es(text(s.root));
  s.c.ItsmI18n.setLocale('en');
  await s.tick();
  await s.settle();
  pairs.en(text(s.root));
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
}

async function mountAt(s, name, props) {
  const ui = s.mount(name, props);
  s.root = ui.root;
  await s.settle();
  return ui;
}

function catalogPayload() {
  return {
    skills: [
      { name: 'itsm.assets.search', module: 'itsm', version: '1.0.0', description: 'Busca activos.', permissions: ['assets.view'], capabilities: ['tools'], digest: 'a'.repeat(64) },
      { name: 'netbox.sync', version: '2.1.0', module: 'netbox', permissions: ['assets.edit'], capabilities: ['tools'], digest: 'c'.repeat(64) }
    ],
    modules: [
      { id: 'itsm', name: 'ITSM official skills', version: '1.0.0', enabled: true, official: true, permissions: ['assets.view'], capabilities: ['tools'] },
      { id: 'netbox', name: 'NetBox', enabled: true, official: false, permissions: ['assets.view'], capabilities: ['tools'] }
    ]
  };
}

function enginesPayload() {
  return {
    instances: [
      {
        id: 'opencode-local',
        name: 'OpenCode local',
        engine: 'opencode',
        enabled: true,
        version: '1.2.3',
        profile: 'default',
        models: [{ id: 'opencode/free-a', name: 'Free A', free: true }, { id: 'opencode/paid-b', name: 'Paid B' }],
        capabilities: { streaming: true, cancel: true, tools: true }
      },
      {
        id: 'opencode-work',
        name: 'OpenCode work',
        engine: 'opencode',
        enabled: true,
        version: '1.2.3',
        profile: 'work',
        models: [{ id: 'opencode/work-a', name: 'Work A' }],
        capabilities: { streaming: true }
      }
    ],
    preference: { instanceId: 'opencode-local', model: 'opencode/free-a' },
    budget: null
  };
}

function policyPayload() {
  return {
    companyDailyLimit: 5000,
    companyLimitSource: 'policy',
    timezone: 'America/Asuncion',
    pendingTimezone: '',
    pendingEffectiveDay: '',
    overrides: [{ userId: '5a1e0c10-0001-4f10-9a10-0000000000aa', scope: 'company', dailyLimit: 100, updatedAt: '2026-10-27T12:00:00Z' }]
  };
}

function reportPayload() {
  return {
    timezone: 'America/Asuncion',
    generatedAt: '2026-10-27T12:00:00Z',
    groupBy: ['user', 'provider'],
    items: [],
    totals: { settledTokens: 10, reservedTokens: 0, pendingCount: 0, unresolvedCount: 0, releasedCount: 0, receiptCount: 0, legacyTokens: 0 },
    precision: { measured: 10, estimated: 0, unavailable: 0 }
  };
}

test('T3a agents: the shared skill catalog renders from the catalog in both locales', async () => {
  const s = setup();
  const ui = await mountAt(s, 'AgentCatalogPanel', { catalog: catalogPayload(), busyId: '', error: '', canManage: true });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Catálogo compartido/, 'the Spanish catalog heading is unchanged');
      assert.match(copy, /Paquete oficial/, 'the Spanish package heading is unchanged');
      assert.match(copy, /Permisos:/, 'the Spanish permissions label is unchanged');
      assert.match(copy, /Habilitado/, 'the module state is translated in Spanish');
      assert.match(copy, /Oficial/, 'the official tag is translated in Spanish');
      assert.match(copy, /itsm\.assets\.search/, 'skill names stay stable identifiers');
    },
    en: (copy) => {
      assert.match(copy, /Shared catalog/, 'the English catalog heading is shown');
      assert.match(copy, /Official package/, 'the English package heading is shown');
      assert.match(copy, /Permissions:/, 'the English permissions label is shown');
      assert.match(copy, /Enabled/, 'the module state is translated in English');
      assert.match(copy, /Official/, 'the official tag is translated in English');
      assert.match(copy, /itsm\.assets\.search/, 'skill names stay stable identifiers');
      assert.doesNotMatch(copy, /Catálogo compartido|Paquete oficial|Permisos:|Habilitado|Módulos/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the installations panel renders its empty state and copy from the catalog', async () => {
  const s = setup();
  const ui = await mountAt(s, 'AgentInstallationsPanel', { app: s.app, installations: [], busy: '', error: '', result: null });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Instalaciones/, 'the Spanish panel title is unchanged');
      assert.match(copy, /Todavía no hay instalaciones registradas\./, 'the Spanish empty state is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Installations/, 'the English panel title is shown');
      assert.match(copy, /No installations recorded yet\./, 'the English empty state is shown');
      assert.doesNotMatch(copy, /Todavía no hay instalaciones registradas/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the engine picker renders engine, profile and model copy from the catalog', async () => {
  const s = setup();
  stubAgentFetch(s, { '/agent/engines': enginesPayload(), '/agent/usage/me': { periodDay: '2026-10-27', timezone: 'America/Asuncion', funding: { company: null, personal: null } } });
  const ui = await mountAt(s, 'AgentEnginePicker', { app: s.app, heading: '', showBudget: false });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Motor y modelo/, 'the Spanish heading is unchanged');
      assert.match(copy, /El perfil elegido se usará en las conversaciones nuevas/, 'the Spanish profile hint is unchanged');
      assert.match(copy, /Respuesta progresiva/, 'the Spanish capability label is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Engine and model/, 'the English heading is shown');
      assert.match(copy, /The chosen profile is used in new conversations/, 'the English profile hint is shown');
      assert.match(copy, /Progressive response/, 'the English capability label is shown');
      assert.doesNotMatch(copy, /Motor y modelo|El perfil elegido|conversaciones nuevas|Respuesta progresiva/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the instance editor renders field labels and hints from the catalog', async () => {
  const s = setup();
  const draft = {
    id: '', name: '', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096', secretRef: '', username: '',
    profile: '', directory: '', defaultModel: '', integrationIdentityId: '', enabled: true,
    quotaMode: 'direct', directCompanyException: false, managedProviderId: '', managedContextTokens: ''
  };
  const ui = await mountAt(s, 'AgentInstanceEditor', { app: s.app, draft, identities: [], busy: false, error: '', canManageQuota: false });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Nombre/, 'the Spanish name label is unchanged');
      assert.match(copy, /URL base/, 'the Spanish base URL label is unchanged');
      assert.match(copy, /Guardar instancia/, 'the Spanish save label is unchanged');
      assert.match(copy, /Solo se guarda la referencia a la variable de entorno/, 'the Spanish secret hint is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Name/, 'the English name label is shown');
      assert.match(copy, /Base URL/, 'the English base URL label is shown');
      assert.match(copy, /Save instance/, 'the English save label is shown');
      assert.match(copy, /Only the reference to the environment variable is stored/, 'the English secret hint is shown');
      assert.doesNotMatch(copy, /Guardar instancia|URL base|Solo se guarda la referencia/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the guided integration wizard renders steps and headings from the catalog', async () => {
  const s = setup();
  const ui = await mountAt(s, 'AgentIntegrationWizard', { app: s.app, instances: [], catalog: { skills: [], modules: [] }, identities: [] });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Integración guiada/, 'the Spanish eyebrow is unchanged');
      assert.match(copy, /Asistente de integración/, 'the Spanish title is unchanged');
      assert.match(copy, /Paso 1 de 5/, 'the Spanish step counter is unchanged');
      assert.match(copy, /Instancia del motor/, 'the Spanish step heading is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Guided integration/, 'the English eyebrow is shown');
      assert.match(copy, /Integration wizard/, 'the English title is shown');
      assert.match(copy, /Step 1 of 5/, 'the English step counter is shown');
      assert.match(copy, /Engine instance/, 'the English step heading is shown');
      assert.doesNotMatch(copy, /Integración guiada|Asistente de integración|Paso 1 de 5/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the provider panel renders its headings and actions from the catalog', async () => {
  const s = setup();
  stubAgentFetch(s, {
    '/agent/providers': {
      items: [{ id: 'provider-1', name: 'Gateway', scope: 'global', baseUrl: 'https://ai.example.test/v1', models: ['model-a'], modelSelection: 'auto', discoveredModels: ['model-a'], credentialConfigured: true, credentialStatus: 'primary', enabled: true }],
      canManageGlobal: true,
      canManagePersonal: true,
      credentialStorageAvailable: true
    }
  });
  const ui = await mountAt(s, 'AgentProvidersPanel', { app: s.app });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Proveedores compatibles con OpenAI/, 'the Spanish title is unchanged');
      assert.match(copy, /Añadir proveedor global/, 'the Spanish global action is unchanged');
      assert.match(copy, /Modelos:/, 'the Spanish models label is unchanged');
      assert.match(copy, /Credencial configurada/, 'the Spanish credential state is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /OpenAI-compatible providers/, 'the English title is shown');
      assert.match(copy, /Add global provider/, 'the English global action is shown');
      assert.match(copy, /Models:/, 'the English models label is shown');
      assert.match(copy, /Credential configured/, 'the English credential state is shown');
      assert.doesNotMatch(copy, /Proveedores compatibles con OpenAI|Añadir proveedor global|Credencial configurada/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: the settings section and the daily quota administration render from the catalog', async () => {
  const s = setup();
  stubAgentFetch(s, {
    '/agent/engines': enginesPayload(),
    '/agent/usage/me': { periodDay: '2026-10-27', timezone: 'America/Asuncion', funding: { company: null, personal: null } },
    '/agent/integrations': { instances: [], installations: [], defaults: { instanceId: null, model: null } },
    '/agent/integrations/catalog': { skills: [], modules: [] },
    '/agent/usage/policy': policyPayload(),
    '/agent/usage/report': reportPayload()
  });
  const ui = await mountAt(s, 'AgentIntegrationsSettings', { app: s.app });
  await withLocales(s, {
    es: (copy) => {
      assert.match(copy, /Inteligencia artificial/, 'the Spanish eyebrow is unchanged');
      assert.match(copy, /Motores y modelos/, 'the Spanish section title is unchanged');
      assert.match(copy, /Cuota diaria de IA/, 'the Spanish quota heading is unchanged');
      assert.match(copy, /Excepciones por usuario/, 'the Spanish overrides heading is unchanged');
      assert.match(copy, /Consumo medido y estimado/, 'the Spanish report heading is unchanged');
      assert.match(copy, /Valor predeterminado del servidor/, 'the Spanish default label is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Artificial intelligence/, 'the English eyebrow is shown');
      assert.match(copy, /Engines and models/, 'the English section title is shown');
      assert.match(copy, /Daily AI quota/, 'the English quota heading is shown');
      assert.match(copy, /Per-user exceptions/, 'the English overrides heading is shown');
      assert.match(copy, /Measured and estimated usage/, 'the English report heading is shown');
      assert.match(copy, /Server default/, 'the English default label is shown');
      assert.doesNotMatch(copy, /Motores y modelos|Cuota diaria de IA|Excepciones por usuario/, 'no Spanish copy leaks into English');
    }
  });
  ui.unmount();
});

test('T3a agents: shared formatting helpers follow the active locale', async () => {
  const s = setup();
  stubAgentFetch(s, { '/agent/engines': enginesPayload(), '/agent/usage/me': { periodDay: '2026-10-27', funding: { company: null, personal: null } } });
  const ui = await mountAt(s, 'AgentEnginePicker', { app: s.app, showBudget: false });
  const Views = s.c.AssetAgentViews;
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
  assert.equal(Views.installationStatusLabel({ status: 'configured', verified: false }), 'Configurado, sin verificación', 'the Spanish installation status is unchanged');
  assert.equal(Views.engineLabel(''), 'Motor', 'the Spanish engine fallback is unchanged');
  assert.equal(s.c.ItsmI18n.number(12345), '12.345', 'Spanish numbers keep the Spanish grouping');
  s.c.ItsmI18n.setLocale('en');
  await s.tick();
  assert.equal(Views.installationStatusLabel({ status: 'configured', verified: false }), 'Configured, not verified', 'the English installation status is shown');
  assert.equal(Views.engineLabel(''), 'Engine', 'the English engine fallback is shown');
  assert.equal(s.c.ItsmI18n.number(12345), '12,345', 'English numbers use English grouping');
  assert.equal(Views.installationStatusLabel({ status: 'exported' }), 'Request exported, not installed', 'the English exported status is shown');
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
  ui.unmount();
});
