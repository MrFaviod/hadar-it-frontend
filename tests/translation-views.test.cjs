'use strict';
// S9 translator tools: the `idiomas` config section reads the T7 i18n scope
// (source registration, coverage, missing keys, export, validate, import and the
// custom layer). Each case drives a real mounted component through the shipped
// `AssetAccess.request` transport, so the recorded calls are the browser's own
// requests, and switches the shipped runtime between `es` and `en`: a hard-coded
// literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

function walk(node, visit) {
  if (!node) return;
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

function findById(node, id) {
  let found = null;
  walk(node, (current) => {
    if (!found && current.props && current.props.id === id) found = current;
  });
  return found;
}

function findAll(node, predicate) {
  const out = [];
  walk(node, (current) => { if (predicate(current)) out.push(current); });
  return out;
}

function buttonByText(node, label) {
  return findAll(node, (current) => current.tag === 'button')
    .find((button) => textContent(button).trim() === label) || null;
}

function click(node) {
  const handler = node && node.props ? node.props.onClick : null;
  assert.equal(typeof handler, 'function', 'the control has a click handler');
  return handler({ preventDefault() {}, target: node });
}

function setValue(node, value) {
  assert.ok(node, 'the control exists');
  node.props.value = value;
  const handler = node.props.onInput || node.props.onChange;
  assert.equal(typeof handler, 'function', 'the control is bound to its model');
  return handler({ target: { value } });
}

// ------------------------------------------------------------------ fixtures

function orphan(key) {
  return {
    key,
    reason: 'source_key_missing',
    reasonKey: 'api.i18n.problem.source_key_missing',
    message: 'La clave no existe en el catálogo de origen.',
    params: { key }
  };
}

function missingItem(key, context) {
  return { key, context };
}

function coveragePayload() {
  return {
    revision: 12,
    sourceLocale: 'es',
    namespace: null,
    page: { limit: 25, offset: 0 },
    source: { locale: 'es', total: 12, namespaces: { api: 10, ui: 2 } },
    locales: [
      {
        tag: 'es',
        displayTag: 'es',
        name: 'Spanish',
        nativeName: 'Español',
        localeProvider: 'core',
        source: true,
        total: 12,
        translated: 12,
        percentage: 100,
        providers: [
          { id: 'core', kind: 'core', entries: 10 },
          { id: 'ui-source', kind: 'ui-source', entries: 2 }
        ],
        custom: { entries: 0, orphaned: [] },
        missing: { total: 0, limit: 25, offset: 0, items: [] }
      },
      {
        tag: 'en',
        displayTag: 'en',
        name: 'English',
        nativeName: 'English',
        localeProvider: 'core',
        source: false,
        total: 12,
        translated: 6,
        percentage: 50,
        providers: [
          { id: 'core', kind: 'core', entries: 4 },
          { id: 'ui-source', kind: 'ui-source', entries: 1 },
          { id: 'acme', kind: 'extension', entries: 1 }
        ],
        custom: { entries: 2, orphaned: [orphan('api.assets.legacy')] },
        missing: { total: 61, limit: 25, offset: 0, items: [missingItem('api.assets.archive', 'Archive action label.')] }
      },
      {
        tag: 'pt-br',
        displayTag: 'pt-BR',
        name: 'Portuguese (Brazil)',
        nativeName: 'Português (Brasil)',
        localeProvider: 'pt-br-pack',
        source: false,
        total: 12,
        translated: 5,
        percentage: 41.67,
        providers: [{ id: 'pt-br-pack', kind: 'language-pack', entries: 5 }],
        custom: { entries: 0, orphaned: [] },
        missing: { total: 7, limit: 25, offset: 0, items: [missingItem('api.assets.restore', '')] }
      }
    ]
  };
}

function coverageFor(call) {
  const payload = coveragePayload();
  const locale = call.params.get('locale');
  const limit = Number(call.params.get('limit')) || 25;
  const offset = Number(call.params.get('offset')) || 0;
  const namespace = call.params.get('namespace');
  payload.namespace = namespace || null;
  payload.page = { limit, offset };
  if (namespace) payload.source.namespaces = { [namespace]: namespace === 'ui' ? 2 : 10 };
  payload.locales = payload.locales.filter((row) => !locale || row.tag === locale);
  payload.locales.forEach((row) => {
    row.missing.limit = limit;
    row.missing.offset = offset;
    if (offset > 0) row.missing.items = [missingItem('api.assets.retire', 'Retire action label.')];
  });
  return payload;
}

function validReport(locale) {
  return { locale, format: 'json', valid: true, dryRun: false, entries: 2, applied: 2, revision: 13, problems: [] };
}

function invalidReport(locale) {
  return {
    locale,
    format: 'json',
    valid: false,
    dryRun: true,
    entries: 3,
    applied: 0,
    revision: 12,
    problems: [
      { key: 'api.unknown.key', reason: 'unknown_key', reasonKey: 'api.i18n.problem.unknown_key', message: 'La clave no existe en el catálogo de origen.', params: {} },
      { key: 'api.assets.created', reason: 'parameters_mismatch', reasonKey: 'api.i18n.problem.parameters_mismatch', message: 'Faltan parámetros: {count}.', params: { missing: ['count'] } }
    ]
  };
}

function respond(payload, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => JSON.parse(JSON.stringify(payload)),
    blob: async () => new Blob([JSON.stringify(payload)])
  };
}

function routes() {
  return {
    'PUT /i18n/sources/ui': { source: 'ui', changed: true, digest: 'a'.repeat(64), revision: 12, locales: ['es', 'en'], keys: 5735 },
    'GET /i18n/coverage': (call) => respond(coverageFor(call)),
    'POST /i18n/validate': (call) => respond(invalidReport(call.body.locale)),
    'POST /i18n/import': (call) => respond(validReport(call.body.locale)),
    'DELETE /i18n/custom/en/api.assets.legacy': { locale: 'en', deleted: 1, revision: 13 },
    'DELETE /i18n/custom/en': { locale: 'en', deleted: 2, revision: 14 },
    'GET /i18n/export': () => respond({})
  };
}

function parseBody(body) {
  if (typeof body !== 'string' || !body) return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
}

function stubFetch(s, table) {
  s.c.fetch = async (url, init = {}) => {
    const target = String(url).replace(/^\/api\/v1/, '');
    const [path, query = ''] = target.split('?');
    const method = init.method || 'GET';
    // The transport boundary is where the browser decides the session headers,
    // so the recorded entry keeps them: a mutation without the root CSRF token
    // is a real defect and must be assertable from a mounted component.
    const entry = { method, path, params: new URLSearchParams(query), body: parseBody(init.body), headers: init.headers || {}, credentials: init.credentials || '' };
    s.server.calls.push(entry);
    const handler = table[method + ' ' + path];
    if (typeof handler === 'function') return handler(entry);
    if (handler) return respond(handler);
    if (path === '/i18n/bundle') {
      return respond({ locale: entry.params.get('locale'), revision: 13, fallback: [], messages: {}, overrides: {} });
    }
    return respond({ error: { code: 'not_found', message: 'No encontrado.' }, details: [] }, 404);
  };
}

function callsTo(s, method, path) {
  return s.server.calls.filter((call) => call.method === method && call.path === path);
}

async function mountSection(s) {
  const ui = s.mount('TranslationSettings', { app: s.app });
  await s.settle();
  await s.settle();
  return ui;
}

// --------------------------------------------------------------------- tests

test('T7 the languages section renders its copy from the catalog in es and en', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  const spanish = textContent(ui.root);
  assert.match(spanish, /Idiomas y traducciones/, 'the Spanish heading is shown');
  assert.match(spanish, /Cobertura por idioma/, 'the Spanish coverage heading is shown');
  assert.match(spanish, /Claves faltantes/, 'the Spanish missing heading is shown');
  assert.match(spanish, /Espacio de nombres/, 'the Spanish filter label is shown');

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  const english = textContent(ui.root);
  assert.match(english, /Languages and translations/, 'the English heading is shown');
  assert.match(english, /Coverage per locale/, 'the English coverage heading is shown');
  assert.match(english, /Missing keys/, 'the English missing heading is shown');
  assert.doesNotMatch(english, /Cobertura por idioma|Claves faltantes/, 'no Spanish copy leaks into English');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 registers the shipped ui source catalog with its catalogs and context', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const registrations = callsTo(s, 'PUT', '/i18n/sources/ui');
  assert.equal(registrations.length, 1, 'the source is registered once');
  const body = registrations[0].body;
  assert.ok(body.catalogs.es['ui.translations.title'], 'the Spanish source catalog is sent');
  assert.ok(body.catalogs.en['ui.translations.title'], 'the English catalog is sent for parity checks');
  assert.ok(body.context['ui.translations.title'], 'the translator context is sent');
  assert.match(textContent(ui.root), /5735 claves/, 'the registered key count is reported');
  ui.unmount();

  // A remount with the same shipped catalogs must not repeat the idempotent write.
  const again = await mountSection(s);
  assert.equal(callsTo(s, 'PUT', '/i18n/sources/ui').length, 1, 'an unchanged catalog is not re-sent');
  again.unmount();
});

test('T7 the coverage table lists every installed locale with providers and percentages', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const table = findAll(ui.root, (node) => node.tag === 'table')[0];
  assert.ok(table, 'the coverage table is rendered');
  assert.ok(findAll(table, (node) => node.tag === 'th' && node.props.scope === 'col').length >= 5, 'the table has header cells');
  assert.deepEqual(s.errors, []);

  const copy = textContent(ui.root);
  assert.match(copy, /Português \(Brasil\)/, 'the native name is shown');
  assert.match(copy, /Paquete de idioma/, 'the language pack provider is named');
  assert.match(copy, /41,67 %/, 'the percentage uses the active locale formatting');
  assert.match(copy, /Extensión/, 'the extension provider is named');
  assert.match(copy, /api\.assets\.legacy/, 'the orphaned custom key is listed');

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  const english = textContent(ui.root);
  assert.match(english, /41\.67%/, 'English formats the percentage with a dot');
  assert.match(english, /Language pack/, 'the provider kind is translated');
  assert.doesNotMatch(english, /Paquete de idioma/, 'no Spanish provider text leaks');

  ui.unmount();
});

test('T7 the missing keys panel pages through the selected locale', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const localeSelect = findById(ui.root, 'translations-missing-locale');
  assert.ok(localeSelect, 'the missing-keys locale control exists');
  assert.equal(localeSelect.props.value, 'en', 'the first translated locale is selected');
  let copy = textContent(ui.root);
  assert.match(copy, /api\.assets\.archive/, 'the first missing key is listed');
  assert.match(copy, /Archive action label\./, 'its context is listed');
  assert.match(copy, /Mostrando 1–1 de 61/, 'the page range is shown');

  await click(buttonByText(ui.root, 'Siguiente'));
  await s.settle();

  const paged = s.server.calls.filter((call) => call.path === '/i18n/coverage' && call.params.get('offset') === '25');
  assert.equal(paged.length, 1, 'the next page requests offset 25');
  assert.equal(paged[0].params.get('locale'), 'en', 'the page keeps the selected locale');
  copy = textContent(ui.root);
  assert.match(copy, /api\.assets\.retire/, 'the second page is rendered');
  assert.doesNotMatch(copy, /api\.assets\.archive/, 'the previous page is replaced');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 validating a catalog lists every problem and writes nothing', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  setValue(findById(ui.root, 'translations-import-locale'), 'pt-br');
  await s.settle();
  setValue(findById(ui.root, 'translations-import-content'), '{"api.unknown.key": "Não encontrado."}');
  await s.settle();

  await click(buttonByText(ui.root, 'Validar'));
  await s.settle();

  const validations = callsTo(s, 'POST', '/i18n/validate');
  assert.equal(validations.length, 1, 'validate is requested once');
  assert.deepEqual(validations[0].body, { locale: 'pt-br', format: 'json', content: '{"api.unknown.key": "Não encontrado."}' });
  assert.equal(callsTo(s, 'POST', '/i18n/import').length, 0, 'validate never writes');

  const copy = textContent(ui.root);
  assert.match(copy, /api\.unknown\.key/, 'the offending key is listed');
  assert.match(copy, /La clave no existe en el catálogo de origen\./, 'the localized reason is listed');
  assert.match(copy, /api\.assets\.created/, 'every problem is listed, not only the first');
  assert.match(copy, /2 problemas/, 'the problem count is announced');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 a successful import stores the catalog and reloads the active bundle', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);
  const coverageBefore = callsTo(s, 'GET', '/i18n/coverage').length;

  setValue(findById(ui.root, 'translations-import-locale'), 'pt-br');
  await s.settle();
  setValue(findById(ui.root, 'translations-import-content'), '{"api.assets.restore": "Restaurar ativo"}');
  await s.settle();

  await click(buttonByText(ui.root, 'Importar'));
  await s.settle();
  await s.settle();

  const imports = callsTo(s, 'POST', '/i18n/import');
  assert.equal(imports.length, 1, 'the import is sent');
  assert.deepEqual(imports[0].body, { locale: 'pt-br', format: 'json', content: '{"api.assets.restore": "Restaurar ativo"}' });
  assert.ok(callsTo(s, 'GET', '/i18n/coverage').length > coverageBefore, 'coverage is reloaded after the import');
  const reloads = s.server.calls.filter((call) => call.path === '/i18n/bundle' && call.params.get('locale') === 'pt-br');
  assert.ok(reloads.length >= 1, 'the imported locale overlay is reloaded without a page reload');

  const copy = textContent(ui.root);
  assert.match(copy, /Importación guardada/, 'the import is reported');
  assert.match(copy, /Se recargó el idioma pt-br/, 'the reload is reported with the locale');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 deleting one custom translation and resetting a locale ask for confirmation', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  await click(findById(ui.root, 'translations-delete-api.assets.legacy'));
  await s.settle();
  let copy = textContent(ui.root);
  assert.match(copy, /¿Eliminar la traducción personalizada de api\.assets\.legacy\?/, 'the confirmation names the key');
  assert.equal(callsTo(s, 'DELETE', '/i18n/custom/en/api.assets.legacy').length, 0, 'nothing is deleted before confirmation');

  await click(buttonByText(ui.root, 'Eliminar traducción'));
  await s.settle();

  assert.equal(callsTo(s, 'DELETE', '/i18n/custom/en/api.assets.legacy').length, 1, 'the key is deleted for its locale');
  copy = textContent(ui.root);
  assert.match(copy, /Se eliminó la traducción personalizada de api\.assets\.legacy\./, 'the deletion is reported');

  await click(findById(ui.root, 'translations-reset-en'));
  await s.settle();
  copy = textContent(ui.root);
  assert.match(copy, /¿Restablecer todas las traducciones personalizadas de en\?/, 'the reset confirmation names the locale');
  assert.equal(callsTo(s, 'DELETE', '/i18n/custom/en').length, 0, 'nothing is reset before confirmation');

  await click(buttonByText(ui.root, 'Restablecer traducciones'));
  await s.settle();

  assert.equal(callsTo(s, 'DELETE', '/i18n/custom/en').length, 1, 'the locale layer is reset');
  copy = textContent(ui.root);
  assert.match(copy, /Se eliminaron 2 traducciones personalizadas de en\./, 'the reset count is reported');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 export downloads the chosen locale, format and namespace', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  setValue(findById(ui.root, 'translations-export-locale'), 'en');
  await s.settle();
  setValue(findById(ui.root, 'translations-export-format'), 'po');
  await s.settle();
  setValue(findById(ui.root, 'translations-export-namespace'), 'api');
  await s.settle();

  await click(buttonByText(ui.root, 'Exportar'));
  await s.settle();

  const exports = callsTo(s, 'GET', '/i18n/export');
  assert.equal(exports.length, 1, 'the export is requested once');
  assert.equal(exports[0].params.get('locale'), 'en');
  assert.equal(exports[0].params.get('format'), 'po');
  assert.equal(exports[0].params.get('namespace'), 'api');
  assert.match(textContent(ui.root), /en\.api\.po/, 'the prepared file name is reported');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 a view-only account reads coverage but gets no write actions', async () => {
  const s = setup();
  stubFetch(s, routes());
  s.app.can = (permission) => permission === 'system.view';
  const ui = await mountSection(s);

  assert.equal(callsTo(s, 'PUT', '/i18n/sources/ui').length, 0, 'a reader never registers the source');
  assert.equal(buttonByText(ui.root, 'Importar'), null, 'the import action is hidden');
  assert.ok(findById(ui.root, 'translations-import-content'), 'a reader can still paste a catalog to validate');
  assert.ok(buttonByText(ui.root, 'Validar'), 'validation only needs system.view');
  assert.equal(findById(ui.root, 'translations-reset-en'), null, 'the reset action is hidden');
  assert.equal(findById(ui.root, 'translations-delete-api.assets.legacy'), null, 'deleting a key is hidden');
  assert.ok(buttonByText(ui.root, 'Exportar'), 'export only needs system.view');

  const copy = textContent(ui.root);
  assert.match(copy, /hace falta system\.configure/, 'the read-only boundary is stated');
  assert.match(copy, /Cobertura por idioma/, 'coverage is still readable');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 a rejected import shows the localized server message without claiming success', async () => {
  const s = setup();
  const table = routes();
  table['POST /i18n/import'] = () => respond({
    error: { code: 'validation_error', message: 'La importación tiene 2 problemas.', key: 'api.i18n.import_invalid', params: { count: 2 } },
    details: [],
    report: invalidReport('en')
  }, 422);
  stubFetch(s, table);
  const ui = await mountSection(s);

  setValue(findById(ui.root, 'translations-import-locale'), 'en');
  await s.settle();
  setValue(findById(ui.root, 'translations-import-content'), '{"api.unknown.key": "x"}');
  await s.settle();

  await click(buttonByText(ui.root, 'Importar'));
  await s.settle();

  const copy = textContent(ui.root);
  assert.match(copy, /La importación tiene 2 problemas\./, 'the server message is shown');
  assert.doesNotMatch(copy, /Importación guardada/, 'no success is claimed');
  assert.doesNotMatch(copy, /Se recargó el idioma/, 'the bundle is not reloaded on failure');

  ui.unmount();
});

test('T7 a rejected import lists every problem and reloads nothing', async () => {
  const s = setup();
  const table = routes();
  table['POST /i18n/import'] = () => respond({
    error: { code: 'validation_error', message: 'La importación tiene 2 problemas.', key: 'api.i18n.import_invalid', params: { count: 2 } },
    details: [],
    report: invalidReport('en')
  }, 422);
  stubFetch(s, table);
  const ui = await mountSection(s);

  const bundles = callsTo(s, 'GET', '/i18n/bundle').length;
  const coverage = callsTo(s, 'GET', '/i18n/coverage').length;

  setValue(findById(ui.root, 'translations-import-locale'), 'en');
  await s.settle();
  setValue(findById(ui.root, 'translations-import-content'), '{"api.unknown.key": "x"}');
  await s.settle();

  await click(buttonByText(ui.root, 'Importar'));
  await s.settle();

  const copy = textContent(ui.root);
  assert.match(copy, /La importación tiene 2 problemas\./, 'the server summary is shown');
  const reportBlock = findAll(ui.root, (node) => node.props && typeof node.props.class === 'string'
    && node.props.class.split(/\s+/).includes('translation-report'))[0];
  assert.ok(reportBlock, 'the rejected import still renders the report block');
  const problems = textContent(reportBlock);
  assert.match(problems, /api\.unknown\.key/, 'the first problem key is listed');
  assert.match(problems, /La clave no existe en el catálogo de origen\./, 'the first problem message is listed');
  assert.match(problems, /api\.assets\.created/, 'the second problem key is listed');
  assert.match(problems, /Faltan parámetros: \{count\}\./, 'the second problem message is listed');
  assert.ok(findById(ui.root, 'translations-import-content'), 'the pasted catalog is kept for correction');
  assert.doesNotMatch(copy, /Importación guardada/, 'no success is claimed');
  assert.doesNotMatch(copy, /Se recargó el idioma/, 'no locale reload is claimed');
  assert.equal(callsTo(s, 'GET', '/i18n/bundle').length, bundles, 'the bundle is not fetched again');
  assert.equal(callsTo(s, 'GET', '/i18n/coverage').length, coverage, 'coverage is not reloaded');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 the languages section is reachable from the config navigation with system.view', async () => {
  const s = setup();

  const section = s.app.configSections.find((item) => item.id === 'idiomas');
  assert.ok(section, 'the config navigation lists the languages section');
  assert.equal(section.label, 'Idiomas', 'the nav label comes from the catalog');
  assert.equal(section.icon, 'file-text', 'the nav item has an icon');

  s.c.location.hash = '#/configuracion/idiomas';
  assert.equal(s.app.parseRoute().section, 'idiomas', 'the hash keeps the section instead of falling back');
  assert.equal(s.app.hashFor({ name: 'config', section: 'idiomas' }), '#/configuracion/idiomas', 'the section has its own hash');

  assert.ok(s.app.permittedConfigSections.some((item) => item.id === 'idiomas'), 'a configure account sees the section');

  s.app.can = (permission) => permission === 'system.view';
  assert.ok(s.app.permittedConfigSections.some((item) => item.id === 'idiomas'), 'system.view is enough to read translations');
  assert.ok(!s.app.permittedConfigSections.some((item) => item.id === 'categorias'), 'other sections keep their own permission');
  assert.equal(s.app.accessRoute({ name: 'config', section: 'idiomas' }).name, 'config', 'the route is not denied');
  assert.equal(s.app.accessRoute({ name: 'config', section: 'categorias' }).name, 'denied', 'other sections keep their own guard');

  assert.deepEqual(s.errors, []);
});

test('T7 the canonical config table grants idiomas with system.view and nothing wider', async () => {
  const s = setup();

  // The section permission belongs to the shared table now, so the shared
  // helpers are the authority. A per-section override in the application would
  // hide a drift between the table and the shipped guard, which is what this
  // case prevents.
  s.app.can = (permission) => permission === 'system.view';
  assert.equal(s.c.AssetAccess.methods.canConfig.call(s.app, 'idiomas'), true, 'system.view reaches the languages section');
  assert.equal(s.c.AssetAccess.methods.canConfig.call(s.app, 'categorias'), false, 'categorias keeps config.categories');
  assert.equal(s.c.AssetAccess.methods.canConfig.call(s.app, 'general'), false, 'general keeps config.general');

  assert.equal(s.c.AssetAccess.methods.accessRoute.call(s.app, { name: 'config', section: 'idiomas' }).name, 'config', 'the shared guard allows the languages route');
  assert.equal(s.c.AssetAccess.methods.accessRoute.call(s.app, { name: 'config', section: 'categorias' }).name, 'denied', 'categorias stays denied for a system.view-only account');

  const sections = s.app.permittedConfigSections.map((item) => item.id);
  assert.ok(sections.includes('idiomas'), 'the navigation keeps the languages section');
  assert.ok(sections.includes('sistema'), 'the installation section keeps its own system.view grant');
  assert.ok(!sections.includes('categorias'), 'no other section is widened');

  assert.deepEqual(s.errors, []);
});

// ------------------------------------------------- request seam and notices
//
// The languages section is a child component: it receives the root app as a
// prop. Every request must therefore identify the root session, because the
// bootstrap CSRF token lives only on the mounted root, and a rejected session
// belongs to that same root. The following cases pin the seam at the real
// transport boundary instead of trusting the call site.

async function importCatalog(s, ui) {
  setValue(findById(ui.root, 'translations-import-locale'), 'pt-br');
  await s.settle();
  setValue(findById(ui.root, 'translations-import-content'), '{"api.assets.restore": "Restaurar ativo"}');
  await s.settle();
  await click(buttonByText(ui.root, 'Importar'));
  await s.settle();
  await s.settle();
}

test('T7 languages requests carry the root session token and same-origin credentials', async () => {
  const s = setup();
  s.app.csrfToken = 'csrf-languages';
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const registrations = callsTo(s, 'PUT', '/i18n/sources/ui');
  assert.equal(registrations.length, 1, 'the shipped catalog is registered once');
  assert.equal(registrations[0].headers['X-CSRF-Token'], 'csrf-languages', 'the registration uses the root bootstrapped token');
  assert.equal(registrations[0].credentials, 'same-origin', 'the registration keeps the session cookie boundary');

  await importCatalog(s, ui);
  const imports = callsTo(s, 'POST', '/i18n/import');
  assert.equal(imports.length, 1, 'the import is sent');
  assert.equal(imports[0].headers['X-CSRF-Token'], 'csrf-languages', 'the import uses the same root token');
  assert.equal(imports[0].credentials, 'same-origin', 'the import keeps the session cookie boundary');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 languages requests never invent a CSRF token the root does not hold', async () => {
  const s = setup();
  s.app.csrfToken = '';
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const registrations = callsTo(s, 'PUT', '/i18n/sources/ui');
  assert.equal(registrations.length, 1, 'the shipped catalog registration is still attempted');
  assert.equal(registrations[0].headers['X-CSRF-Token'], undefined, 'no header is fabricated without a session token');
  assert.equal(registrations[0].credentials, 'same-origin', 'the request stays same-origin');

  // The registration fails without a token in the real server; here the fake
  // transport accepts it, so the notice may report success. The seam assertion
  // is the header and the identity the request used, not a fabricated write.
  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 a 401 from a languages request clears the root session, not the section', async () => {
  const s = setup();
  s.app.csrfToken = 'csrf-languages';
  const table = routes();
  table['GET /i18n/coverage'] = () => respond({ error: { code: 'unauthenticated', key: 'api.auth.required', message: 'Sesión requerida.' }, details: [] }, 401);
  stubFetch(s, table);
  const ui = await mountSection(s);
  await s.settle();

  assert.equal(s.app.authenticated, false, 'the root session is signed out');
  assert.equal(s.app.activeUserId, null, 'the root identity is cleared');
  assert.equal(s.app.csrfToken, '', 'the stale token is dropped from the root');
  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 a denied import reports the denial and writes nothing', async () => {
  const s = setup();
  s.app.csrfToken = 'csrf-languages';
  const table = routes();
  table['POST /i18n/import'] = () => respond({ error: { code: 'forbidden', key: 'api.identity.permission_denied', message: 'Permiso denegado por el servidor.' }, details: [] }, 403);
  stubFetch(s, table);
  const ui = await mountSection(s);

  await importCatalog(s, ui);

  assert.equal(callsTo(s, 'POST', '/i18n/import').length, 1, 'the denied import is not retried');
  assert.equal(s.server.calls.filter((call) => call.path === '/i18n/bundle' && call.params.get('locale') === 'pt-br').length, 0, 'nothing is reloaded after the denial');
  assert.equal(callsTo(s, 'DELETE', '/i18n/custom/pt-br').length, 0, 'no custom layer write follows the denial');
  const copy = textContent(ui.root);
  assert.match(copy, /No tienes permiso para esta acción\./, 'the denial is localized for the account');
  assert.ok(!/Importación guardada/.test(copy), 'the denial never claims success');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 the registration notice follows the active locale and clears after a successful retry', async () => {
  const s = setup();
  s.app.csrfToken = 'csrf-languages';
  const table = routes();
  let registration = () => respond({ error: { code: 'forbidden', key: 'api.auth.csrf_invalid', message: 'CSRF inválido.' }, details: [] }, 403);
  table['PUT /i18n/sources/ui'] = (call) => registration(call);
  stubFetch(s, table);
  const ui = await mountSection(s);

  assert.match(textContent(ui.root), /No se pudo registrar el catálogo de la interfaz/, 'the failure is reported in Spanish');

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  await s.settle();
  const english = textContent(ui.root);
  assert.match(english, /The interface catalog could not be registered/, 'the notice is retranslated with the active locale');
  assert.ok(!/No se pudo registrar/.test(english), 'the stored Spanish sentence is not kept');

  registration = () => respond({ source: 'ui', changed: false, digest: 'a'.repeat(64), revision: 12, locales: ['es', 'en'], keys: 5735 });
  await ui.instance.registerSource();
  await s.settle();
  const recovered = textContent(ui.root);
  assert.match(recovered, /The interface catalog was already registered/, 'a successful retry clears the failure');
  assert.ok(!/could not be registered/.test(recovered), 'no stale failure survives the retry');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

function translationResult(node) {
  return findAll(node, (current) => current.tag === 'p'
    && String((current.props && current.props.class) || '').split(/\s+/).includes('translation-result'))[0] || null;
}

test('T7 the announced registration follows the active locale after a locale switch', async () => {
  const s = setup();
  stubFetch(s, routes());
  const ui = await mountSection(s);

  const live = translationResult(ui.root);
  assert.ok(live, 'the outcome is announced through the live status region');
  assert.equal(live.props.role, 'status', 'the region is a status live region');
  assert.equal(live.props['aria-live'], 'polite', 'the announcement is polite');
  assert.match(textContent(live), /Catálogo de la interfaz registrado/, 'the outcome is announced in the mount locale');

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  await s.settle();
  const english = textContent(translationResult(ui.root));
  assert.match(english, /Interface catalog registered/, 'the announcement follows the active locale');
  assert.ok(!/Catálogo de la interfaz/.test(english), 'the stored Spanish sentence is not kept');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});

test('T7 an already registered catalog is announced in the active locale, and a failure leaves no stale copy', async () => {
  const s = setup();
  const table = routes();
  let registration = () => respond({ error: { code: 'forbidden', key: 'api.auth.csrf_invalid', message: 'CSRF inválido.' }, details: [] }, 403);
  table['PUT /i18n/sources/ui'] = (call) => registration(call);
  stubFetch(s, table);
  const ui = await mountSection(s);

  assert.equal(textContent(translationResult(ui.root)), '', 'a failed registration leaves no stale announcement');
  assert.match(textContent(ui.root), /No se pudo registrar el catálogo de la interfaz/, 'the failure is reported through its own alert');

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  await s.settle();
  assert.match(textContent(ui.root), /The interface catalog could not be registered/, 'the failure follows the active locale');
  assert.ok(!/Catálogo de la interfaz/.test(textContent(translationResult(ui.root))), 'the failure leaves no stale success copy');

  registration = () => respond({ source: 'ui', changed: false, digest: 'a'.repeat(64), revision: 12, locales: ['es', 'en'], keys: 5735 });
  await ui.instance.registerSource();
  await s.settle();
  assert.match(textContent(translationResult(ui.root)), /The interface catalog was already registered/, 'the retry announces its outcome in the active locale');
  assert.ok(!/could not be registered/.test(textContent(translationResult(ui.root))), 'no stale failure survives the retry');

  assert.deepEqual(s.errors, []);
  ui.unmount();
});
