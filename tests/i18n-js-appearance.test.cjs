'use strict';
// S3: the appearance codec, API and runtime emit catalog copy. Each error must
// render Spanish today and English after `setLocale('en')`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { bootAppearanceI18n } = require('./appearance-i18n.cjs');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const MODULES = [
  'assets/js/appearance-engine.js',
  'assets/js/appearance-package.js',
  'assets/js/appearance-api.js',
  'assets/js/appearance-runtime.js'
];

async function load(locale) {
  const context = vm.createContext({
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, atob, btoa, Blob, Response,
    Promise, Error, TypeError, setTimeout, clearTimeout
  });
  context.window = context;
  bootAppearanceI18n(context, locale);
  for (const file of MODULES) vm.runInContext(read(file), context, { filename: file });
  context.ItsmI18n.setLocale(locale);
  for (let turn = 0; turn < 20 && context.ItsmI18n.activeLocale !== locale; turn += 1) await Promise.resolve();
  assert.equal(context.ItsmI18n.activeLocale, locale);
  return context;
}

function preset(context) {
  return context.AssetAppearanceEngine.createState().active;
}

function respond(payload) {
  return async () => JSON.parse(JSON.stringify(payload));
}

async function captured(run) {
  try {
    await run();
    return 'no error';
  } catch (error) {
    return error.message;
  }
}

test('appearance package rejections follow the active locale', async () => {
  const spanish = await load('es');
  const english = await load('en');
  async function messages(context) {
    const P = context.AssetAppearancePackage;
    const out = [];
    const unsupported = preset(context);
    unsupported.branding.logo = 'data:text/plain;base64,AAAA';
    out.push(await captured(() => P.encode(unsupported)));
    const external = preset(context);
    external.branding.logo = 'https://example.test/logo.png';
    out.push(await captured(() => P.encode(external)));
    const typed = preset(context);
    typed.branding.logo = 'logo.png';
    out.push(await captured(() => P.encode(typed, async () => ({ bytes: new Uint8Array([1]), type: 'application/octet-stream' }))));
    return out;
  }
  assert.deepEqual(await messages(spanish), [
    'Formato de recurso no compatible. Usa SVG, PNG, JPEG, WebP o ICO.',
    'El paquete no puede depender de recursos externos. Carga una imagen local.',
    'El recurso logo tiene un formato incompatible.'
  ]);
  assert.deepEqual(await messages(english), [
    'Unsupported resource format. Use SVG, PNG, JPEG, WebP or ICO.',
    'The package cannot depend on external resources. Load a local image.',
    'The resource logo is in an unsupported format.'
  ]);
});

test('appearance API failures follow the active locale', async () => {
  const spanish = await load('es');
  const api = spanish.AssetAppearanceApi;
  const account = { authenticated: true, can: () => true, appearance: { presets: [], active: null, previous: null } };
  assert.equal(await captured(() => api.exportPreset(account)), 'Selecciona una apariencia para exportar.');
  spanish.AssetAccess = { request: respond({ active: 'broken' }) };
  assert.equal(await api.loadActive(account), null);
  assert.equal(api.lastError(account), 'La apariencia activa no contiene un preset válido.');
  spanish.AssetAccess = { request: respond({ previous: 'broken' }) };
  assert.equal(await api.loadActive(account), null);
  assert.equal(api.lastError(account), 'La apariencia anterior no contiene un preset válido.');
  spanish.AssetAccess = { request: async () => { throw new Error(''); } };
  assert.equal(await api.loadActive(account), null);
  assert.equal(api.lastError(account), 'No se pudo cargar la apariencia activa.');

  const english = await load('en');
  const englishApi = english.AssetAppearanceApi;
  const englishAccount = { authenticated: true, can: () => true, appearance: { presets: [], active: null, previous: null } };
  assert.equal(await captured(() => englishApi.exportPreset(englishAccount)), 'Select an appearance to export.');
  english.AssetAccess = { request: respond({ active: 'broken' }) };
  assert.equal(await englishApi.loadActive(englishAccount), null);
  assert.equal(englishApi.lastError(englishAccount), 'The active appearance does not contain a valid preset.');
  english.AssetAccess = { request: respond({ previous: 'broken' }) };
  assert.equal(await englishApi.loadActive(englishAccount), null);
  assert.equal(englishApi.lastError(englishAccount), 'The previous appearance does not contain a valid preset.');
  english.AssetAccess = { request: async () => { throw new Error(''); } };
  assert.equal(await englishApi.loadActive(englishAccount), null);
  assert.equal(englishApi.lastError(englishAccount), 'The active appearance could not be loaded.');
});

test('appearance runtime keeps its theme-preference fallback in the active locale', async () => {
  const spanish = await load('es');
  const toasts = [];
  const host = {
    authenticated: true,
    themeMode: 'system',
    appearance: { presets: [], active: null, previous: null, userId: 'u1' },
    patchWorkspaceState: () => Promise.reject(new Error('')),
    showToast: (message) => toasts.push(message)
  };
  await spanish.AssetAppearanceMethods.persistAppearanceMode.call(host, 'dark');
  assert.deepEqual(toasts, ['No se pudo guardar la preferencia de tema.']);

  const english = await load('en');
  const englishToasts = [];
  const englishHost = Object.assign({}, host, { patchWorkspaceState: () => Promise.reject(new Error('')), showToast: (message) => englishToasts.push(message) });
  await english.AssetAppearanceMethods.persistAppearanceMode.call(englishHost, 'dark');
  assert.deepEqual(englishToasts, ['The theme preference could not be saved.']);
});
