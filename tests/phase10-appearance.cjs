'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const FILES = ['appearance-engine.js', 'appearance-package.js', 'appearance-api.js', 'appearance-runtime.js', 'appearance-views.js'];
const DOMAIN = 'https://asset.example.test';

function preset(E, id, appName, organizationName) {
  const source = E.clone(E.createState().presets[0]);
  source.id = id;
  source.name = appName;
  source.branding = Object.assign({}, source.branding, { appName, organizationName });
  return source;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function load() {
  const icon = { href: '' };
  const meta = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
  const root = { dataset: {}, style: { values: new Map(), setProperty(key, value) { this.values.set(key, value); }, removeProperty(key) { this.values.delete(key); } } };
  const links = [];
  const context = vm.createContext({
    console, Date, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, atob, btoa,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, URL: { createObjectURL: () => 'blob:appearance', revokeObjectURL() {} },
    document: {
      documentElement: root,
      querySelector(selector) { return selector.includes('icon') ? icon : selector.includes('meta') ? meta : null; },
      createElement(tag) {
        const element = { tag, children: [], click() { element.clicked = true; } };
        if (tag === 'a') element.href = '';
        links.push(element);
        return element;
      },
      head: { appendChild() {} },
      title: ''
    }
  });
  context.window = context;
  context.fetch = async () => { throw new Error('unexpected external fetch'); };
  for (const file of FILES) vm.runInContext(fs.readFileSync('assets/js/' + file, 'utf8'), context, { filename: file });
  return { c: context, icon, meta, root, links };
}

function themeStore(initial) {
  const values = new Map([['guest', initial || 'system']]);
  const writes = [];
  const scopes = [];
  const theme = {
    scope: 'guest', preference: values.get('guest'),
    setScope(id) {
      this.scope = id == null || id === '' ? 'guest' : String(id);
      scopes.push(this.scope);
      this.preference = values.get(this.scope) || 'system';
      return this.preference;
    },
    set(value) {
      this.preference = value;
      values.set(this.scope, value);
      writes.push([this.scope, value]);
      return { preference: value, resolved: value === 'system' ? 'light' : value };
    },
    getPreference() { return this.preference; },
    getResolved() { return this.preference === 'system' ? 'light' : this.preference; }
  };
  return { theme, values, writes, scopes };
}

function makeApp(c, theme, handler, extra) {
  const app = Object.assign({
    authenticated: false, currentUser: null, activeUserId: null,
    themeMode: 'system', themeResolvedMode: 'light',
    config: { general: {} }, appearance: c.AssetAppearanceEngine.createState(),
    toasts: [], titleUpdates: 0, permissions: ['config.general'],
    can(permission) { return permission === 'config.general' ? this.permissions.includes(permission) : true; },
    requirePermission(permission) { return this.can(permission); },
    showToast(message) { this.toasts.push(message); },
    updateDocumentTitle() { this.titleUpdates += 1; }
  }, extra || {});
  for (const [name, fn] of Object.entries(c.AssetAppearanceMethods)) app[name] = fn.bind(app);
  app.__requests = [];
  app.__handler = handler;
  c.AssetAccess = {
    request: async (instance, path, options = {}) => {
      instance.__requests.push({ path, method: String(options.method || 'GET').toUpperCase(), options });
      return instance.__handler(path, options, instance);
    }
  };
  return app;
}

function paths(app) { return app.__requests.map((request) => request.method + ' ' + request.path); }

test('S9/S10 public prelogin reads only the active identity and drives shell branding', async () => {
  const { c, icon } = load();
  const E = c.AssetAppearanceEngine;
  const active = preset(E, 'clinica', 'Clínica del Norte', 'Clínica del Norte');
  active.branding.logo = '/api/v1/appearance/resources/logo-1';
  active.branding.favicon = '/api/v1/appearance/resources/favicon-1';
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, async (path) => {
    assert.equal(path, '/appearance/active');
    return { active };
  });
  await app.startAppearance();
  assert.deepEqual(paths(app), ['GET /appearance/active']);
  assert.equal(app.appearance.active.id, 'clinica');
  assert.equal(app.config.general.appName, 'Clínica del Norte');
  assert.equal(icon.href, '/api/v1/appearance/resources/favicon-1');
  assert.equal(app.authenticated, false);
  assert.equal(app.toasts.length, 0);
});

test('S9 global gallery is shared across accounts while light/dark mode stays per user', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const shared = preset(E, 'shared', 'Identidad Común', 'Operaciones');
  shared.branding.logo = '/api/v1/appearance/resources/logo-shared';
  const gallery = [generic, shared];
  const handler = async (path) => {
    if (path === '/appearance/active') return { active: shared };
    if (path === '/appearance/presets') return { presets: gallery, activeId: 'shared', previousId: 'generic' };
    throw new Error('unexpected ' + path);
  };
  const store = themeStore('system');
  c.AssetTheme = store.theme;
  const ana = makeApp(c, store.theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  ana.changeAppearanceUser();
  assert.equal(ana.appearance.presets.length, 1, 'demo presets are not presented as installed gallery before load');
  await ana.startAppearance();
  assert.equal(ana.appearance.active.id, 'shared');
  assert.deepEqual(ana.appearance.presets.map((item) => item.id), ['generic', 'shared']);
  ana.applyThemeMode('dark');
  assert.equal(store.values.get('ana'), 'dark');

  const luis = makeApp(c, store.theme, handler, { authenticated: true, currentUser: { id: 'luis' }, activeUserId: 'luis' });
  luis.changeAppearanceUser();
  assert.equal(luis.themeMode, 'system', 'another account does not inherit Ana mode');
  await luis.startAppearance();
  luis.applyThemeMode('light');
  assert.equal(store.values.get('luis'), 'light');
  assert.equal(store.values.get('ana'), 'dark');
  assert.equal(luis.appearance.active.branding.organizationName, 'Operaciones');
  assert.equal(ana.appearance.active.branding.organizationName, 'Operaciones');
  ana.resetThemeMode();
  assert.equal(ana.themeMode, 'system');
  assert.equal(store.values.get('guest'), 'system');
  assert.equal(store.writes.some(([scope]) => scope === 'guest'), false, 'logout does not overwrite the guest preference');
});

test('C1 theme mode persists through the serialized workspace patch without clobbering widgets or favorites', async () => {
  const { c } = load();
  const handler = async (path, options) => {
    if (path !== '/workspace/state') throw new Error('unexpected ' + path);
    if (String(options.method || 'GET') === 'GET') {
      return { widgets: ['a', 'b'], favorites: [{ key: 'asset:1', type: 'asset', id: '1' }], usage: { 'asset:1': 2 }, lastViews: { inventory: { search: 'x' } }, themeMode: 'auto' };
    }
    return options.body;
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  app.changeAppearanceUser();
  const patched = [];
  app.patchWorkspaceState = async (patch) => { patched.push(patch); return { themeMode: patch.themeMode }; };
  await app.setAppearanceMode('dark');
  await app.setAppearanceMode('system');
  assert.equal(patched.length, 2);
  assert.equal(patched[0].themeMode, 'dark');
  assert.equal(patched[1].themeMode, 'auto');
  assert.deepEqual(paths(app), [], 'no independent workspace writes');

  delete app.patchWorkspaceState;
  await app.setAppearanceMode('light');
  assert.deepEqual(paths(app), ['GET /workspace/state', 'PUT /workspace/state']);
  const put = app.__requests[1].options.body;
  assert.deepEqual(put.widgets, ['a', 'b']);
  assert.deepEqual(put.favorites, [{ key: 'asset:1', type: 'asset', id: '1' }]);
  assert.deepEqual(put.usage, { 'asset:1': 2 });
  assert.deepEqual(put.lastViews, { inventory: { search: 'x' } });
  assert.equal(put.themeMode, 'light');
});

test('S9/S10 gallery mutations use server authority and update the active identity only on apply', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const custom = preset(E, 'custom-1', 'Original', 'Org');
  let gallery = [generic, custom];
  let active = custom;
  let previous = generic;
  const handler = async (path, options, app) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'GET' && path === '/appearance/active') return { active };
    if (method === 'GET' && path === '/appearance/presets') return { presets: gallery, activeId: active.id, previousId: previous.id };
    if (method === 'POST' && path === '/appearance/presets') {
      const saved = Object.assign({}, options.body, { id: 'custom-9', version: 1 });
      gallery.push(saved);
      return { preset: saved };
    }
    if (method === 'PUT' && path === '/appearance/presets/custom-1') {
      const saved = Object.assign({}, options.body, { id: 'custom-1', version: 1 });
      gallery = gallery.map((item) => item.id === saved.id ? saved : item);
      return { preset: saved };
    }
    if (method === 'POST' && path.startsWith('/appearance/apply/')) {
      previous = active;
      active = gallery.find((item) => item.id === path.split('/').pop());
      return { active, presets: gallery, previousId: previous.id };
    }
    if (method === 'POST' && path === '/appearance/restore') {
      previous = active; active = generic;
      return { active, presets: gallery, previousId: previous.id };
    }
    if (method === 'POST' && path === '/appearance/revert') {
      const next = previous; previous = active; active = next;
      return { active, presets: gallery, previousId: previous.id };
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  await app.startAppearance();
  assert.equal(app.appearance.active.id, 'custom-1');

  const fresh = E.clone(custom);
  fresh.id = 'draft-new';
  fresh.name = 'Nueva';
  fresh.branding.appName = 'Nueva';
  const created = await c.AssetAppearanceApi.savePreset(app, fresh);
  assert.equal(created.id, 'custom-9');
  assert.equal(app.appearance.active.id, 'custom-1', 'saving does not apply');

  fresh.id = 'custom-1';
  fresh.branding.appName = 'Editada';
  const updated = await c.AssetAppearanceApi.savePreset(app, fresh);
  assert.equal(updated.id, 'custom-1');
  assert.equal(app.appearance.active.branding.appName, 'Original', 'editing does not apply');

  const applied = await c.AssetAppearanceApi.applyPreset(app, created);
  assert.equal(applied.id, 'custom-9');
  assert.equal(app.appearance.active.id, 'custom-9');
  assert.equal(app.config.general.appName, 'Nueva');

  const restored = await c.AssetAppearanceApi.restore(app);
  assert.equal(restored.id, 'generic');
  assert.equal(app.appearance.active.id, 'generic');
  const reverted = await c.AssetAppearanceApi.revert(app);
  assert.equal(reverted.id, 'custom-9');
  assert.equal(app.appearance.active.id, 'custom-9');
  assert.equal(paths(app).join('|'), [
    'GET /appearance/presets',
    'POST /appearance/presets',
    'PUT /appearance/presets/custom-1',
    'POST /appearance/apply/custom-9',
    'POST /appearance/restore',
    'POST /appearance/revert'
  ].join('|'));
});

test('S10 corrupt, incompatible or unsafe packages never replace the active identity', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const staged = preset(E, 'imported-1', 'Importada', 'Org');
  let mode = 'ok';
  const handler = async (path, options) => {
    if (path === '/appearance/active') return { active: generic };
    if (path === '/appearance/presets') return { presets: [generic], activeId: 'generic', previousId: null };
    if (path === '/appearance/import/preview') {
      assert.ok(options.body instanceof Blob, 'raw ZIP bytes are uploaded');
      assert.equal(options.body.type, 'application/zip');
      if (mode === 'corrupt') throw new Error('El ZIP está dañado: falló la comprobación de integridad.');
      if (mode === 'unsafe') {
        const unsafe = E.clone(staged);
        unsafe.branding.logo = 'https://tracker.example/logo.png';
        return { preset: unsafe, resources: [] };
      }
      return { preset: staged, resources: [{ name: 'resources/logo.svg', size: 12, type: 'image/svg+xml' }] };
    }
    if (path === '/appearance/import') return { preset: Object.assign({}, options.body.preset, { id: 'imported-1' }) };
    if (path === '/appearance/apply/imported-1') return { active: staged, presets: [generic, staged], previousId: 'generic' };
    throw new Error('unexpected ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  await app.startAppearance();
  const before = JSON.stringify(app.appearance);

  const preview = await c.AssetAppearanceApi.previewImport(app, new Uint8Array([80, 75, 3, 4]));
  assert.equal(preview.preset.id, 'imported-1');
  assert.equal(JSON.stringify(app.appearance), before, 'preview does not mutate the gallery or active');

  mode = 'corrupt';
  await assert.rejects(() => c.AssetAppearanceApi.previewImport(app, new Uint8Array([1, 2, 3])), /ZIP/);
  assert.equal(JSON.stringify(app.appearance), before);

  mode = 'unsafe';
  await assert.rejects(() => c.AssetAppearanceApi.previewImport(app, new Uint8Array([80, 75, 3, 4])), /recurso/i);
  assert.equal(JSON.stringify(app.appearance), before, 'unsafe resource cannot enter the gallery');

  const stagedPreset = await c.AssetAppearanceApi.stageImport(app, preview.preset, 'both');
  assert.equal(stagedPreset.id, 'imported-1');
  assert.equal(app.appearance.active.id, 'generic', 'staging does not activate');
  assert.ok(app.appearance.presets.some((item) => item.id === 'imported-1'));

  await c.AssetAppearanceApi.applyPreset(app, stagedPreset);
  assert.equal(app.appearance.active.id, 'imported-1');
  assert.equal(app.toasts.length, 0);
});

test('S10 real ZIP export uses the server package and leaves the active identity untouched', async () => {
  const { c, links } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const custom = preset(E, 'custom-1', 'Original', 'Org');
  const handler = async (path, options) => {
    if (path === '/appearance/active') return { active: custom };
    if (path === '/appearance/presets') return { presets: [generic, custom], activeId: 'custom-1', previousId: 'generic' };
    if (path === '/appearance/presets/custom-1/export') {
      assert.equal(options.responseType, 'blob');
      return new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/zip' });
    }
    throw new Error('unexpected ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  await app.startAppearance();
  const before = JSON.stringify(app.appearance.active);
  const blob = await c.AssetAppearanceApi.downloadPreset(app, 'custom-1', 'mi-apariencia');
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/zip');
  assert.equal(JSON.stringify(app.appearance.active), before);
  const link = links.find((item) => item.tag === 'a');
  assert.ok(link && link.clicked);
  assert.equal(link.download, 'mi-apariencia.zip');
  assert.equal(link.href, 'blob:appearance');
});

test('S9 late appearance responses after logout never mutate the shell', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const publicActive = preset(E, 'public', 'Pública', 'Org');
  const pending = deferred();
  const handler = async (path) => {
    if (path === '/appearance/active') return { active: publicActive };
    if (path === '/appearance/presets') return pending.promise;
    throw new Error('unexpected ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  const started = app.startAppearance();
  await new Promise((resolve) => setTimeout(resolve, 0));
  c.AssetAppearanceApi.clear(app);
  pending.resolve({ presets: [generic, preset(E, 'late', 'Tardía', 'Org')], activeId: 'late', previousId: 'generic' });
  await started;
  assert.equal(app.appearance.active.id, 'public');
  assert.equal(app.appearance.presets.map((item) => item.id).join(','), 'generic');
  assert.equal(app.toasts.length, 0);
});

test('S10 the shared resource boundary rejects external or traversing logo sources', () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  assert.equal(E.safeResource('javascript:alert(1)'), '');
  assert.equal(E.safeResource('https://tracker.example/logo.svg'), '');
  assert.equal(E.safeResource('//tracker.example/logo.svg'), '');
  assert.equal(E.safeResource('../secret/logo.svg'), '');
  assert.equal(E.safeResource('/api/v1/appearance/resources/logo-1'), '/api/v1/appearance/resources/logo-1');
  assert.equal(E.safeResource('assets/svg/logo.svg'), 'assets/svg/logo.svg');
  assert.equal(E.safeResource('data:image/svg+xml;base64,PHN2Zy8+'), 'data:image/svg+xml;base64,PHN2Zy8+');
  const bad = E.clone(E.createState().presets[0]);
  bad.branding.logo = 'https://tracker.example/logo.svg';
  assert.throws(() => E.validate(bad), /recurso/i);
});

test('S9/S10 the original editor delegates save, apply, restore and package actions to the server API', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const custom = preset(E, 'custom-1', 'Original', 'Org');
  let active = custom;
  let previous = generic;
  let gallery = [generic, custom];
  const handler = async (path, options) => {
    if (path === '/appearance/active') return { active };
    if (path === '/appearance/presets') return { presets: gallery, activeId: active.id, previousId: previous.id };
    if (path === '/appearance/presets/custom-1' && String(options.method) === 'PUT') {
      const saved = Object.assign({}, options.body, { id: 'custom-1', version: 1 });
      gallery = gallery.map((item) => item.id === saved.id ? saved : item);
      return { preset: saved };
    }
    if (path === '/appearance/apply/custom-1') {
      previous = active; active = gallery.find((item) => item.id === 'custom-1');
      return { active, presets: gallery, previousId: previous.id };
    }
    if (path === '/appearance/restore') { previous = active; active = generic; return { active, presets: gallery, previousId: previous.id }; }
    if (path === '/appearance/presets/custom-1/export') return new Blob([new Uint8Array([1])], { type: 'application/zip' });
    if (path === '/appearance/import/preview') return { preset: preset(E, 'preview', 'Previsualizada', 'Org'), resources: [] };
    throw new Error('unexpected ' + String(options.method || 'GET') + ' ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana' });
  await app.startAppearance();

  const settings = c.AssetAppearanceViews.AppearanceSettings;
  const editor = Object.assign(settings.data.call({ app }), { app, server: true });
  editor.builtinIds = app.appearance.builtinIds || ['generic'];
  for (const [name, fn] of Object.entries(settings.methods)) editor[name] = fn.bind(editor);
  editor.draft.branding.appName = 'Editada por servidor';
  await editor.apply();
  assert.equal(editor.error, '');
  assert.equal(app.appearance.active.branding.appName, 'Editada por servidor');
  assert.match(editor.notice, /aplicada/i);
  await editor.restore();
  assert.equal(app.appearance.active.id, 'generic');

  const dialog = c.AssetAppearanceViews.AppearancePackageDialog;
  const picker = Object.assign(dialog.data.call({ active: app.appearance.active }), { app, server: true, open: true, kind: 'import', presets: app.appearance.presets, active: app.appearance.active, current: app.appearance.active });
  for (const [name, fn] of Object.entries(dialog.methods)) picker[name] = fn.bind(picker);
  await picker.read({ name: 'paquete.zip', size: 4, arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer });
  assert.equal(picker.error, '');
  assert.equal(picker.detected.preset.id, 'preview');
  assert.equal(app.appearance.active.id, 'generic', 'preview never applies');
});

test('S9 forbidden appearance mutations stop before any server write', async () => {
  const { c } = load();
  const E = c.AssetAppearanceEngine;
  const generic = E.createState().presets[0];
  const handler = async (path) => {
    if (path === '/appearance/active') return { active: generic };
    if (path === '/appearance/presets') return { presets: [generic], activeId: 'generic', previousId: null };
    throw new Error('unexpected ' + path);
  };
  const { theme } = themeStore('system');
  c.AssetTheme = theme;
  const app = makeApp(c, theme, handler, { authenticated: true, currentUser: { id: 'ana' }, activeUserId: 'ana', permissions: [] });
  await app.startAppearance();
  const before = paths(app).length;
  await assert.rejects(() => c.AssetAppearanceApi.savePreset(app, E.clone(generic)), /permisos/i);
  assert.equal(paths(app).length, before);
  assert.equal(app.toasts.length, 0);
});
