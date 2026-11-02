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
    const entry = { method, path, params: new URLSearchParams(query), body: parseBody(init.body) };
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
