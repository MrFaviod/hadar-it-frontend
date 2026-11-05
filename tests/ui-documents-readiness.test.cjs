'use strict';
// Focused contracts for the U9 readiness correction. Each test asserts what the
// public surface really renders: the public capability projection, its failure
// state, and the sheet geometry a label preview is fitted to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const c = vm.createContext({
    console, Date, URL, Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    DataView, atob, btoa, setTimeout, clearTimeout,
    localStorage: storage, sessionStorage: storage,
    location: { hash: '#/panel' }, history: { replaceState() {} }, navigator: {}
  });
  c.window = c;
  vm.runInContext(fs.readFileSync('assets/vendor/vue.global.prod.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('assets/vendor/vue-i18n.global.prod.js', 'utf8'), c);
  const catalog = (tag) => JSON.parse(fs.readFileSync('assets/i18n/' + tag + '.json', 'utf8'));
  c.__ITSM_I18N_CATALOGS__ = {
    catalogs: { es: catalog('es'), en: catalog('en') }, context: catalog('context')
  };
  c.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
  // Vue's template compiler decodes entities through a detached element; the
  // harness only needs the attribute round-trip, not a real DOM.
  const decode = (text) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'
  }[entity] || String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))));
  c.document = {
    createElement() {
      return {
        children: [],
        set innerHTML(value) {
          this.textContent = decode(value);
          this.children = [{ getAttribute: () => decode((value.match(/foo="([\s\S]*)"/) || [])[1] || '') }];
        }
      };
    },
    title: ''
  };
  const html = fs.readFileSync('index.html', 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if ((src.includes('/vendor/') && !src.includes('report-qrcode')) || /theme|sidebar|app\.js/.test(src)) continue;
    if (src === 'assets/js/panel.js' && !c.AssetDashboardViews) {
      for (const name of ['dashboard-model', 'dashboard-preferences', 'dashboard-views']) {
        vm.runInContext(fs.readFileSync('assets/js/' + name + '.js', 'utf8'), c);
      }
    }
    vm.runInContext(fs.readFileSync(src, 'utf8'), c, { filename: src });
  }
  c.ItsmI18n.primeBundle('es');
  const Vue = c.Vue;
  c.Vue = { ...Vue, createApp(options) { c.options = options; return { mount() {} }; } };
  vm.runInContext(fs.readFileSync('assets/js/app.js', 'utf8'), c);
  c.Vue = Vue;

  const app = Vue.reactive(c.options.data());
  app.currentUser = { id: 'admin' };
  app.can = () => true;
  app.showToast = (message) => { app.lastToast = message; };
  app.setHash = (hash) => { app.lastHash = hash; };
  for (const [key, fn] of Object.entries(c.options.methods)) app[key] = fn.bind(app);
  for (const [key, fn] of Object.entries(c.options.computed)) {
    Object.defineProperty(app, key, { get: () => fn.call(app), configurable: true });
  }

  const errors = [];
  const host = {
    createElement: (tag) => ({
      tag, tagName: String(tag).toUpperCase(), props: {}, children: [], parent: null,
      addEventListener() {}, removeEventListener() {},
      get options() { return this.children; },
      get value() { return this.props.value; }, set value(value) { this.props.value = value; },
      selected: false, multiple: false
    }),
    createText: (text) => ({ tag: '#text', text, children: [] }),
    createComment: (text) => ({ tag: '#comment', text, children: [] }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    patchProp: (node, key, old, value) => { node.props[key] = value; },
    insert(node, parent, anchor) {
      if (node.parent) {
        const index = node.parent.children.indexOf(node);
        if (index >= 0) node.parent.children.splice(index, 1);
      }
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at >= 0) parent.children.splice(at, 0, node); else parent.children.push(node);
      node.parent = parent;
    },
    remove(node) {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      return node.parent ? node.parent.children[node.parent.children.indexOf(node) + 1] || null : null;
    }
  };
  function mount(name, props = {}) {
    const source = c.options.components[name];
    assert.ok(source, name + ' is registered');
    function adapt(component) {
      if (!component || typeof component !== 'object') return component;
      const out = { ...component, components: { ...(component.components || {}) } };
      if (out.template) {
        out.template = out.template.replace(/<transition name="fade">/g, '<template>').replace(/<\/transition>/g, '</template>');
      }
      for (const [key, value] of Object.entries(out.components)) out.components[key] = adapt(value);
      return out;
    }
    const root = { children: [] };
    const renderer = Vue.createRenderer(host);
    const instance = renderer.createApp(adapt(source), { app, ...props });
    if (c.ItsmI18n) instance.use(c.ItsmI18n.i18n);
    instance.config.errorHandler = (error) => errors.push(error);
    const vmInstance = instance.mount(root);
    return { instance: vmInstance, root, unmount: () => instance.unmount() };
  }
  return { c, app, mount, errors, tick: Vue.nextTick };
}

function rendered(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.children || []).map(rendered).join(' ');
}

function appSet(s, id = 'admin') {
  s.app.authenticated = true;
  s.app.activeUserId = id;
  s.app.currentUser = { id, active: true };
  s.app.effectivePermissions = [];
  s.app.phase9LoadSettings = async () => false;
  s.app.phase9LoadSelection = async () => false;
  s.app.phase9LoadJobs = async () => false;
  s.app.phase9LoadTemplates = async () => false;
}

const VALID = {
  asset: { id: 'asset-1', name: 'Router de borde', quickCode: 'RD-0001', status: 'in_use' },
  fields: ['quickCode', 'name', 'status'],
  expiresAt: '2030-01-01T00:00:00Z'
};

const REPORT_HTML_A4 = `<!doctype html><html><head><style>
@page {
  size: A4;
  margin: 22mm 14mm 18mm 14mm;
}
body { font-size: 9.5pt; }
table.doc-table { width: 100%; border-collapse: collapse; }
</style></head><body><h1 class="doc-title">Inventario</h1>
<table class="doc-table"><thead><tr><th>Activo</th><th>Responsable</th></tr></thead>
<tbody><tr><td>Router de borde</td><td>Ana Torres</td></tr></tbody></table></body></html>`;
const REPORT_HTML_LETTER = REPORT_HTML_A4.replace('size: A4', 'size: Letter');

const LABEL_HTML_210 = `<!doctype html><html><head><style>
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
.label-page { position: relative;
  width: 210mm;
  height: 297mm;
  overflow: hidden;
  break-after: page;
  page-break-after: always;
  background: #ffffff;
  }
.label-page:last-child { break-after: auto; page-break-after: auto; }
</style></head><body><section class="label-page"><table class="label-layout"><tr><td>
<div class="label-cell">RD-0001</div></td></tr></table></section></body></html>`;

const LABEL_HTML_100 = LABEL_HTML_210.replace(/210mm/g, '100mm').replace(/297mm/g, '100mm');

test('a failed same-token public reload clears the record instead of painting it', async () => {
  const s = setup();
  appSet(s);
  s.app.route = { name: 'reportAsset', assetId: VALID.asset.id, section: 'publico', shareToken: 'capability-valid' };
  const calls = [];
  s.c.AssetAccess.request = async (vm, path) => {
    calls.push(path);
    return JSON.parse(JSON.stringify(VALID));
  };
  const view = s.mount('PublicAssetReport');
  const report = view.instance;
  await s.tick();
  await s.tick();
  assert.equal(s.app.phase9.publicReport.asset && s.app.phase9.publicReport.asset.id, VALID.asset.id);
  assert.match(rendered(view.root).replace(/\s+/g, ' '), /Router de borde/);

  // The capability is revoked on the server: the same token now fails. No
  // navigation happens, so nothing but the read itself can drop the record.
  s.c.AssetAccess.request = async (...args) => {
    calls.push(args);
    throw Object.assign(new Error('Esta capacidad fue revocada'), { status: 401 });
  };
  await report.load();
  await s.tick();
  await s.tick();
  assert.equal(s.app.phase9.publicReport.asset, null, 'the revoked capability must not retain its asset');
  assert.deepEqual(Array.from(s.app.phase9.publicReport.fields), []);
  assert.equal(s.app.phase9.publicReport.loaded, false);
  const text = rendered(view.root).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /Router de borde/);
  assert.match(text, /Este enlace no está disponible/);
  assert.match(text, /Esta capacidad fue revocada/);
  assert.equal(calls.length, 2);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a public capability never falls back to private state, and a later success paints again', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9.privateReport.asset = { id: VALID.asset.id, name: 'Ficha privada interna', serial: 'SN-1' };
  s.app.route = { name: 'reportAsset', assetId: VALID.asset.id, section: 'publico', shareToken: 'capability-valid' };
  s.c.AssetAccess.request = async () => {
    throw Object.assign(new Error('Sin respuesta'), { status: 500 });
  };
  const view = s.mount('PublicAssetReport');
  const report = view.instance;
  await s.tick();
  await s.tick();
  const failed = rendered(view.root).replace(/\s+/g, ' ');
  assert.doesNotMatch(failed, /Ficha privada interna/);
  assert.doesNotMatch(failed, /SN-1/);
  assert.match(failed, /Este enlace no está disponible/);
  assert.equal(s.app.phase9.privateReport.asset.name, 'Ficha privada interna');

  s.c.AssetAccess.request = async () => JSON.parse(JSON.stringify(VALID));
  await report.load();
  await s.tick();
  await s.tick();
  assert.match(rendered(view.root).replace(/\s+/g, ' '), /Router de borde/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a swapped token clears the earlier capability and adopts the new record', async () => {
  const s = setup();
  appSet(s);
  s.app.route = { name: 'reportAsset', assetId: VALID.asset.id, section: 'publico', shareToken: 'capability-a' };
  let fulfil = null;
  s.c.AssetAccess.request = async () => JSON.parse(JSON.stringify(VALID));
  const view = s.mount('PublicAssetReport');
  await s.tick();
  await s.tick();
  assert.match(rendered(view.root).replace(/\s+/g, ' '), /Router de borde/);

  s.c.AssetAccess.request = async () => new Promise((resolve) => { fulfil = resolve; });
  s.app.route = { name: 'reportAsset', assetId: VALID.asset.id, section: 'publico', shareToken: 'capability-b' };
  await s.tick();
  await s.tick();
  const pending = s.app.phase9.publicReport;
  assert.equal(pending.token, 'capability-b');
  assert.equal(pending.asset, null, 'the earlier capability must not stay on screen while B loads');
  assert.doesNotMatch(rendered(view.root).replace(/\s+/g, ' '), /Router de borde/);

  fulfil({ asset: { id: VALID.asset.id, name: 'Ficha de la capacidad B' }, fields: ['name'], expiresAt: '2031-02-02T00:00:00Z' });
  await s.tick();
  await s.tick();
  const text = rendered(view.root).replace(/\s+/g, ' ');
  assert.match(text, /Ficha de la capacidad B/);
  assert.doesNotMatch(text, /Router de borde/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the label preview is fitted to the generated document, not to an edited draft', async () => {
  const s = setup();
  appSet(s);
  let html = LABEL_HTML_210;
  let pending = null;
  s.app.phase9PreviewReport = async () => {
    if (pending) return pending;
    s.app.phase9.preview.html = html;
    return { ok: true, preview: s.app.phase9.preview };
  };
  const view = s.mount('LabelsCenter');
  const labels = view.instance;
  await s.tick();
  await labels.preview();
  await s.tick();
  assert.equal(labels.label.pageWidthMm, 210);
  assert.equal(labels.previewSheetStyle['--doc-sheet-width'], '793.7px');
  assert.equal(labels.previewSheetStyle['--doc-frame-height'], '640px');

  // The draft changes, the rendered document does not: the fit must keep the
  // geometry of the document that is actually painted.
  labels.label.pageWidthMm = 100;
  await s.tick();
  assert.equal(labels.previewSheetStyle['--doc-sheet-width'], '793.7px');

  // A replacement preview is pending: the painted document is still the 210 mm
  // one, so the fitted geometry cannot follow the new draft yet.
  let resolvePending;
  pending = new Promise((resolve) => { resolvePending = resolve; });
  const pendingPreview = labels.preview();
  await s.tick();
  assert.equal(labels.previewSheetStyle['--doc-sheet-width'], '793.7px');
  resolvePending({ ok: true, preview: s.app.phase9.preview });
  await pendingPreview;

  // Only a real new document changes the geometry.
  pending = null;
  html = LABEL_HTML_100;
  s.app.phase9PreviewReport = async () => {
    s.app.phase9.preview.html = html;
    return { ok: true, preview: s.app.phase9.preview };
  };
  await labels.preview();
  await s.tick();
  assert.equal(labels.previewSheetStyle['--doc-sheet-width'], '377.95px');
  assert.equal(labels.previewSheetStyle['--doc-frame-height'], '640px');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the public field with a closed vocabulary prints its catalog label', async () => {
  const s = setup();
  appSet(s);
  s.app.route = { name: 'reportAsset', assetId: VALID.asset.id, section: 'publico', shareToken: 'capability-valid' };
  s.c.AssetAccess.request = async () => JSON.parse(JSON.stringify(VALID));
  const view = s.mount('PublicAssetReport');
  await s.tick();
  await s.tick();
  const text = rendered(view.root).replace(/\s+/g, ' ');
  assert.match(text, /Router de borde/);
  // The server enum is storage detail; the page prints the catalog label.
  assert.match(text, /Asignado/);
  assert.doesNotMatch(text, /in_use/);

  // A value outside the catalog is shown as received, never guessed.
  s.app.phase9.publicReport.asset = { ...VALID.asset, status: 'cuarentena' };
  await s.tick();
  const after = rendered(view.root).replace(/\s+/g, ' ');
  assert.match(after, /cuarentena/);
  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('the report preview is fitted to the page the server generated', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9LoadTemplates = async () => false;
  const view = s.mount('ReportsCenter');
  const report = view.instance;
  await s.tick();
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '100%');
  assert.equal(report.previewSheetStyle['--doc-frame-height'], '640px');
  assert.equal(report.previewSheetStyle['--doc-scale'], '1');

  s.app.phase9.preview.html = REPORT_HTML_A4;
  await s.tick();
  // A 210 mm page is 793.7 CSS px at 96 dpi: the frame keeps the physical page
  // width and the fit scales it into the column instead of reflowing it.
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '793.7px');
  assert.equal(report.previewSheetStyle['--doc-frame-height'], '640px');
  assert.equal(report.previewSheetStyle['--doc-scale'], '1');

  // A template change is not a new document: the fit cannot follow it.
  report.templateId = 'template-other';
  await s.tick();
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '793.7px');

  s.app.phase9.preview.html = REPORT_HTML_LETTER;
  await s.tick();
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '816px');
  assert.deepEqual(s.errors, []);
  view.unmount();
});

const REPORT_HTML_LANDSCAPE_AFTER = REPORT_HTML_A4.replace('size: A4', 'size: A4 landscape');
const REPORT_HTML_LANDSCAPE_BEFORE = REPORT_HTML_A4.replace('size: A4', 'size: landscape A4');
const REPORT_HTML_EXPLICIT_MM = REPORT_HTML_A4.replace('size: A4', 'size: 210mm 297mm');
const REPORT_HTML_EXPLICIT_LANDSCAPE = REPORT_HTML_A4.replace('size: A4', 'size: 297mm 210mm');
const REPORT_HTML_INCHES = REPORT_HTML_A4.replace('size: A4', 'size: 6in 8in');
const REPORT_HTML_UNITLESS = REPORT_HTML_A4.replace('size: A4', 'size: 210 297');
const REPORT_HTML_UNSUPPORTED_UNIT = REPORT_HTML_A4.replace('size: A4', 'size: 210em 297em');
const REPORT_HTML_AUTO = REPORT_HTML_A4.replace('size: A4', 'size: auto');
const REPORT_HTML_NO_PAGE = REPORT_HTML_A4.replace(/@page \{[^}]*\}/, '');

test('the preview reads the orientation and explicit dimensions a document declares', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9LoadTemplates = async () => false;
  const view = s.mount('ReportsCenter');
  const report = view.instance;
  await s.tick();
  const width = () => report.previewSheetStyle['--doc-sheet-width'];

  // Orientation applies to the named page size, in either authored order:
  // landscape A4 is 297 mm wide, not the 210 mm of the portrait page.
  for (const html of [REPORT_HTML_LANDSCAPE_AFTER, REPORT_HTML_LANDSCAPE_BEFORE]) {
    s.app.phase9.preview.html = html;
    await s.tick();
    assert.equal(width(), '1122.52px', 'landscape A4 must be 297 mm wide');
  }

  // An explicit length pair states the width directly, so declared landscape
  // geometry is honoured without the keyword.
  s.app.phase9.preview.html = REPORT_HTML_EXPLICIT_MM;
  await s.tick();
  assert.equal(width(), '793.7px');
  s.app.phase9.preview.html = REPORT_HTML_EXPLICIT_LANDSCAPE;
  await s.tick();
  assert.equal(width(), '1122.52px');

  // Lengths are read in their own unit, not assumed to be millimetres.
  s.app.phase9.preview.html = REPORT_HTML_INCHES;
  await s.tick();
  assert.equal(width(), '576px');

  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('an unreadable page size falls back to the unfitted preview instead of guessing', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9LoadTemplates = async () => false;
  const view = s.mount('ReportsCenter');
  const report = view.instance;
  await s.tick();

  // A unitless number is not a CSS length, and an unsupported unit cannot be
  // converted: both must keep the document at its natural width.
  for (const html of [REPORT_HTML_UNITLESS, REPORT_HTML_UNSUPPORTED_UNIT, REPORT_HTML_AUTO, REPORT_HTML_NO_PAGE]) {
    s.app.phase9.preview.html = html;
    await s.tick();
    assert.equal(report.previewSheetStyle['--doc-sheet-width'], '100%');
    assert.equal(report.previewSheetStyle['--doc-scale'], '1');
  }

  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a new document without a readable page size drops the previous fit', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9LoadTemplates = async () => false;
  const view = s.mount('ReportsCenter');
  const report = view.instance;
  await s.tick();

  s.app.phase9.preview.html = REPORT_HTML_A4;
  await s.tick();
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '793.7px');
  // Stand in for a fitted page: the scale and frame of an earlier document.
  report.previewScale = 0.42;
  report.previewFrameHeight = 1530;

  s.app.phase9.preview.html = REPORT_HTML_AUTO;
  await s.tick();
  await s.tick();
  assert.equal(report.previewSheetStyle['--doc-sheet-width'], '100%');
  assert.equal(report.previewSheetStyle['--doc-scale'], '1', 'a stale scale must not survive a new document');
  assert.equal(report.previewSheetStyle['--doc-frame-height'], '640px', 'a stale frame height must not survive a new document');

  assert.deepEqual(s.errors, []);
  view.unmount();
});

test('a queued preview observation and a late observer callback stop after unmount', async () => {
  const s = setup();
  appSet(s);
  s.app.phase9LoadTemplates = async () => false;
  const observers = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observing = 0;
      observers.push(this);
    }
    observe() { this.observing += 1; }
    disconnect() {}
  }
  s.c.ResizeObserver = FakeObserver;
  s.c.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });

  const view = s.mount('ReportsCenter');
  const report = view.instance;
  await s.tick();
  const pages = { clientWidth: 700, clientHeight: 640 };
  report.previewHost = () => pages;
  report.observePreview();
  assert.equal(observers.length, 1, 'the mounted preview observes its container');
  const observer = observers[0];
  const observing = observer.observing;

  // The observation is queued for the next tick while the component is still
  // alive; the queued callback must not recreate the observer after unmount.
  view.unmount();
  report.observePreview();
  assert.equal(observers.length, 1, 'no observer is created after unmount');
  assert.equal(observer.observing, observing, 'no container is observed after unmount');
  assert.equal(report.previewObserver, null);

  // A callback already handed to the browser must not write state either.
  report.previewScale = 0.42;
  report.previewFrameHeight = 1234;
  observer.callback();
  assert.equal(report.previewScale, 0.42, 'a late callback must not resize the sheet');
  assert.equal(report.previewFrameHeight, 1234, 'a late callback must not change the frame height');

  // The host itself is also a guard: a disposed component or a disconnected
  // root is not a fit target.
  const source = s.c.options.components.ReportsCenter;
  assert.equal(source.methods.previewHost.call({
    previewDisposed: true,
    $el: { querySelector: () => pages, isConnected: true }
  }), null, 'a disposed preview has no host');
  assert.equal(source.methods.previewHost.call({
    previewDisposed: false,
    $el: { querySelector: () => pages, isConnected: false }
  }), null, 'a disconnected root has no host');
  assert.deepEqual(s.errors, []);
});

test('a mounted label preview still fits on resize and after a remount', async () => {
  const s = setup();
  appSet(s);
  const observers = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observing = 0;
      observers.push(this);
    }
    observe() { this.observing += 1; }
    disconnect() {}
  }
  s.c.ResizeObserver = FakeObserver;
  s.c.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });
  s.app.phase9.preview.html = LABEL_HTML_210;

  const first = s.mount('LabelsCenter');
  const label = first.instance;
  await s.tick();
  const pages = { clientWidth: 700, clientHeight: 640 };
  label.previewHost = () => pages;
  label.observePreview();
  assert.equal(observers.length, 1, 'the mounted label preview observes its container');
  observers[0].callback();
  assert.equal(label.previewSheetStyle['--doc-sheet-width'], '793.7px');
  assert.equal(label.previewSheetStyle['--doc-scale'], '0.8819');
  assert.equal(label.previewSheetStyle['--doc-frame-height'], '726px');
  first.unmount();

  // A fresh mount after the first one was torn down still fits normally.
  const second = s.mount('LabelsCenter');
  const remounted = second.instance;
  await s.tick();
  remounted.previewHost = () => pages;
  remounted.observePreview();
  assert.equal(observers.length, 2, 'a remounted label preview observes again');
  assert.equal(remounted.previewDisposed, false, 'a fresh instance starts live');
  remounted.observePreview();
  assert.equal(observers.length, 2, 'one instance reuses its own observer');
  assert.deepEqual(s.errors, []);
  second.unmount();
});

test('a queued label observation and a late observer callback stop after unmount', async () => {
  const s = setup();
  appSet(s);
  const observers = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observing = 0;
      observers.push(this);
    }
    observe() { this.observing += 1; }
    disconnect() {}
  }
  s.c.ResizeObserver = FakeObserver;
  s.c.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });
  s.app.phase9.preview.html = LABEL_HTML_210;

  const view = s.mount('LabelsCenter');
  const label = view.instance;
  await s.tick();
  const pages = { clientWidth: 700, clientHeight: 640 };
  label.previewHost = () => pages;
  label.observePreview();
  assert.equal(observers.length, 1, 'the mounted label preview observes its container');
  const observer = observers[0];
  const observing = observer.observing;

  // The observation queued for the next tick must not recreate the observer.
  view.unmount();
  label.observePreview();
  assert.equal(observers.length, 1, 'no observer is created after label unmount');
  assert.equal(observer.observing, observing, 'no container is observed after label unmount');
  assert.equal(label.previewObserver, null);

  // A callback already handed to the browser must not write the fit either.
  label.previewScale = 0.42;
  label.previewFrameHeight = 1234;
  observer.callback();
  assert.equal(label.previewScale, 0.42, 'a late callback must not resize the label sheet');
  assert.equal(label.previewFrameHeight, 1234, 'a late callback must not change the label frame');

  // A disposed component or a disconnected root is not a fit target.
  const source = s.c.options.components.LabelsCenter;
  assert.equal(source.methods.previewHost.call({
    previewDisposed: true,
    $el: { querySelector: () => pages, isConnected: true }
  }), null, 'a disposed label preview has no host');
  assert.equal(source.methods.previewHost.call({
    previewDisposed: false,
    $el: { querySelector: () => pages, isConnected: false }
  }), null, 'a disconnected label root has no host');
  assert.deepEqual(s.errors, []);
});

test('a label preview without a readable sheet width drops the previous fit', async () => {
  const s = setup();
  appSet(s);
  const observers = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  }
  s.c.ResizeObserver = FakeObserver;
  s.c.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });
  s.app.phase9.preview.html = LABEL_HTML_210;

  const view = s.mount('LabelsCenter');
  const label = view.instance;
  await s.tick();
  label.previewHost = () => ({ clientWidth: 700, clientHeight: 640 });

  // A real fit of the 210mm sheet in a 700px column: narrower than the page.
  label.fitPreview();
  assert.equal(label.previewSheetStyle['--doc-sheet-width'], '793.7px');
  assert.equal(label.previewSheetStyle['--doc-scale'], '0.8819');
  assert.equal(label.previewSheetStyle['--doc-frame-height'], '726px');

  // The server replaces the preview with a document that declares no sheet width.
  s.app.phase9.preview.html = '<html><body><section class="label-page">sin ancho</section></body></html>';
  await s.tick();
  await s.tick();
  label.fitPreview();
  assert.equal(label.previewSheetStyle['--doc-sheet-width'], '100%');
  assert.equal(label.previewSheetStyle['--doc-scale'], '1', 'a stale label scale must not survive a new document');
  assert.equal(label.previewSheetStyle['--doc-frame-height'], '640px', 'a stale label frame must not survive a new document');

  // The fit stays unfitted while no sheet width is readable, and it does not throw.
  label.fitPreview();
  assert.equal(label.previewSheetStyle['--doc-scale'], '1');

  // A disposed component must not write the reset after unmount either.
  s.app.phase9.preview.html = LABEL_HTML_210;
  await s.tick();
  label.fitPreview();
  assert.equal(label.previewSheetStyle['--doc-scale'], '0.8819');
  view.unmount();
  s.app.phase9.preview.html = '<html><body>sin ancho</body></html>';
  await s.tick();
  label.fitPreview();
  assert.equal(label.previewScale, 0.8819, 'an unmounted label preview must not reset its state');
  assert.equal(label.previewFrameHeight, 726, 'an unmounted label preview must not touch its frame');
  assert.deepEqual(s.errors, []);
});
