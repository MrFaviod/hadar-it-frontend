'use strict';
// Boots the real frontend i18n runtime (`assets/js/i18n.js`) with the vendored
// Vue and vue-i18n global builds so catalog, fallback, formatting and locale
// switching rules run through the shipped code instead of a test double.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const BUILTIN_LOCALES = {
  revision: 4,
  defaultLocale: 'es',
  formats: { timezone: 'America/Asuncion', currency: 'PYG' },
  locales: [
    { tag: 'es', name: 'Spanish', nativeName: 'Español', provider: 'builtin' },
    { tag: 'en', name: 'English', nativeName: 'English', provider: 'builtin' }
  ]
};

// Minimal renderer host: enough element/text nodes to mount a component with
// interpolated text and reactive data, without a DOM implementation.
function createHost() {
  return {
    createElement: (tag) => ({ tag, children: [], props: {}, parent: null, style: {}, selected: false, multiple: false, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 560, width: 960, height: 560 }), focus() {}, blur() {}, querySelector() { return null; }, closest() { return null; } }),
    createText: (text) => ({ tag: '#text', text, children: [] }),
    createComment: (text) => ({ tag: '#comment', text, children: [] }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    patchProp: (node, key, _old, value) => { node.props[key] = value; },
    insert(node, parent, anchor) {
      if (node.parent) {
        const index = node.parent.children.indexOf(node);
        if (index >= 0) node.parent.children.splice(index, 1);
      }
      const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
      if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, node);
      else parent.children.push(node);
      node.parent = parent;
    },
    remove(node) {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      if (!node.parent) return null;
      return node.parent.children[node.parent.children.indexOf(node) + 1] || null;
    },
    querySelector() { return null; }
  };
}

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

function setup(options = {}) {
  const store = new Map();
  if (options.locale) store.set('itsm.locale', options.locale);
  const calls = [];
  const attributes = {};
  const bundles = options.bundles || {};
  const localesPayload = options.locales === undefined ? BUILTIN_LOCALES : options.locales;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function respond(payload, status = 200) {
    return {
      ok: status < 400,
      status,
      headers: { get: () => null },
      json: async () => clone(payload)
    };
  }

  const context = vm.createContext({
    console, Date, JSON, Intl, Object, Array, Map, Set, Number, String, Boolean, Error, TypeError,
    RegExp, Math, Promise, Symbol, WeakMap, WeakSet, Proxy, Reflect, URLSearchParams,
    setTimeout, clearTimeout, AbortController, AbortSignal
  });
  context.window = context;
  context.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  context.document = {
    title: '',
    createElement: (tag) => ({ tag, style: {}, innerHTML: '', setAttribute() {}, appendChild() {}, removeChild() {}, cloneNode() { return { style: {}, innerHTML: '' }; } }),
    documentElement: {
      setAttribute(name, value) { attributes[name] = String(value); },
      getAttribute(name) { return name in attributes ? attributes[name] : null; }
    }
  };
  context.fetch = async (url, init = {}) => {
    const target = String(url);
    const headers = init.headers || {};
    calls.push({ url: target, method: init.method || 'GET', headers });
    if (target.includes('/i18n/locales')) {
      if (localesPayload === null) return respond({ error: { code: 'not_found' } }, 404);
      return respond(localesPayload);
    }
    if (target.includes('/i18n/bundle')) {
      const query = target.split('?')[1] || '';
      const tag = new URLSearchParams(query).get('locale') || 'es';
      const payload = bundles[tag];
      if (!payload) return respond({ error: { code: 'api.i18n.unknown_locale' } }, 404);
      const etag = '"' + (payload.revision || 0) + '-' + tag + '"';
      if (headers['If-None-Match'] === etag) {
        return { ok: false, status: 304, headers: { get: (name) => (String(name).toLowerCase() === 'etag' ? etag : null) }, json: async () => null };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'etag' ? etag : null) },
        json: async () => clone(payload)
      };
    }
    return respond({ error: { code: 'not_found' } }, 404);
  };

  vm.runInContext(read('assets/vendor/vue.global.prod.js'), context);
  vm.runInContext(read('assets/vendor/vue-i18n.global.prod.js'), context);
  // The full catalogs are static frontend assets; injecting them keeps every
  // catalog-backed label available synchronously, exactly like a preloaded app.
  context.__ITSM_I18N_CATALOGS__ = {
    catalogs: { es: json('assets/i18n/es.json'), en: json('assets/i18n/en.json') },
    context: json('assets/i18n/context.json')
  };
  vm.runInContext(read('assets/js/i18n.js'), context);

  const ItsmI18n = context.ItsmI18n;
  function mount(component) {
    const renderer = context.Vue.createRenderer(createHost());
    const app = renderer.createApp(component);
    app.use(ItsmI18n.i18n);
    const root = { children: [] };
    const instance = app.mount(root);
    return { root, instance, unmount: () => app.unmount() };
  }

  return { c: context, ItsmI18n, calls, store, attributes, mount, textOf };
}

module.exports = { setup, BUILTIN_LOCALES, textOf };
