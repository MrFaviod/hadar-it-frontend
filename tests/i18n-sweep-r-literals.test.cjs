'use strict';
// T3 close-out (S10): the last template literals the literal scanner still
// counts. Three screens kept Spanish copy inside a Vue template: the report
// preview heading, the five block-editor accessible names and the empty-site
// fallback of the transfer picker and the monitoring device header. They must
// resolve through the catalog so `en` never shows the Spanish word, while `es`
// keeps the exact source text.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

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

function findAll(node, predicate) {
  const out = [];
  walk(node, (current) => { if (predicate(current)) out.push(current); });
  return out;
}

function ariaLabels(node) {
  return findAll(node, (current) => current.props && typeof current.props['aria-label'] === 'string')
    .map((current) => current.props['aria-label']);
}

function byClass(node, className) {
  return findAll(node, (current) => current.props && typeof current.props.class === 'string'
    && current.props.class.split(/\s+/).includes(className));
}

async function inLocale(s, tag, run) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.settle();
  return run();
}

async function reportsFixture() {
  const s = harness.setup();
  s.app.phase9LoadTemplates = async () => false;
  s.app.phase9LoadSelection = async () => false;
  s.app.phase9LoadJobs = async () => false;
  const mounted = s.mount('ReportsCenter', { app: s.app });
  await s.settle();
  return { s, view: mounted.instance, root: mounted.root, unmount: mounted.unmount };
}

async function transferFixture() {
  const s = harness.setup();
  s.c.options.components.TransferExport = s.c.AssetTransferViews.TransferExport;
  // The picker lists what the endpoint would export: the canonical server page,
  // not the prototype catalogue the browser demo used to paint.
  s.app.inventory.items = [
    { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Nodo sin sede', site: '', serial: '' }
  ];
  const mounted = s.mount('TransferExport', { app: s.app });
  const view = mounted.instance;
  view.scope = 'selection';
  view.selectedIds = ['5a1e0c10-0001-4f10-9a10-000000000001'];
  await s.settle();
  return { s, view, root: mounted.root, unmount: mounted.unmount };
}

async function deviceFixture() {
  const s = harness.setup();
  // The device record is a computed over the monitoring adapter state, so the
  // fixture seeds the adapter the application itself reads.
  s.app.monitoringApi.device = {
    record: {
      asset: { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Nodo sin sede', quickCode: '', category: '', image: '', site: '' },
      status: 'up',
      config: { profileCategory: '' },
      provenance: { source: 'prometheus', period: { preset: '24h' } },
      uptime: { percent: 99, samples: 10 },
      alerts: { recent: [] },
      checks: [],
      series: [],
      latencySeries: { points: [] },
      availabilitySeries: { points: [] }
    },
    loading: false,
    error: '',
    missing: false,
    period: '24h'
  };
  const mounted = s.mount('MonitorDevice', { app: s.app });
  await s.settle();
  return { s, root: mounted.root, unmount: mounted.unmount };
}

test('the report preview heading is catalog copy in both locales', async () => {
  const { s, view, root, unmount } = await reportsFixture();
  try {
    // Without a draft the heading is the untitled state, not a template name.
    view.draft = null;
    await s.settle();
    await inLocale(s, 'es', () => {
      const toolbar = byClass(root, 'doc-preview-toolbar')[0];
      assert.ok(toolbar, 'the preview toolbar is rendered');
      assert.match(textContent(toolbar), /Sin plantilla/, 'the Spanish source copy is shown');
    });
    await inLocale(s, 'en', () => {
      const toolbar = byClass(root, 'doc-preview-toolbar')[0];
      assert.match(textContent(toolbar), /No template/, 'the English copy is shown');
      assert.doesNotMatch(textContent(toolbar), /Sin plantilla/, 'no Spanish copy leaks');
    });
    assert.deepEqual(s.errors, []);
  } finally {
    s.c.ItsmI18n.setLocale('es');
    unmount();
  }
});

test('the report block editor accessible names follow the active locale', async () => {
  const { s, view, root, unmount } = await reportsFixture();
  try {
    view.editor = true;
    await s.settle();

    // The block labels are captured when the draft is created, so each locale
    // starts from its own draft: the accessible name, not the frozen label, is
    // what this case proves.
    await inLocale(s, 'es', async () => {
      view.draft = s.c.AssetReportEngine.createTemplate('history');
      await s.settle();
      const labels = ariaLabels(root);
      for (const expected of [
        'Activar Encabezado', 'Subir Encabezado', 'Bajar Encabezado', 'Quitar Encabezado', 'Texto de Encabezado'
      ]) {
        assert.ok(labels.includes(expected), expected + ' is announced');
      }
    });
    await inLocale(s, 'en', async () => {
      view.draft = s.c.AssetReportEngine.createTemplate('history');
      await s.settle();
      const labels = ariaLabels(root);
      for (const expected of [
        'Enable Heading', 'Move Heading up', 'Move Heading down', 'Remove Heading', 'Text for Heading'
      ]) {
        assert.ok(labels.includes(expected), expected + ' is announced');
      }
      assert.ok(!labels.some((label) => /^(Activar|Subir|Bajar|Quitar|Texto de) /.test(label)), 'no Spanish accessible name leaks');
    });
    assert.deepEqual(s.errors, []);
  } finally {
    s.c.ItsmI18n.setLocale('es');
    unmount();
  }
});

test('the transfer picker names a missing site in the active locale', async () => {
  const { s, root, unmount } = await transferFixture();
  try {
    await inLocale(s, 'es', () => {
      const picker = byClass(root, 'tx-picker')[0];
      assert.ok(picker, 'the manual selection picker is rendered');
      assert.match(textContent(picker), /Sin sede/, 'the Spanish fallback is shown');
    });
    await inLocale(s, 'en', () => {
      const picker = byClass(root, 'tx-picker')[0];
      assert.match(textContent(picker), /No site/, 'the English fallback is shown');
      assert.doesNotMatch(textContent(picker), /Sin sede/, 'no Spanish fallback leaks');
    });
    assert.deepEqual(s.errors, []);
  } finally {
    s.c.ItsmI18n.setLocale('es');
    unmount();
  }
});

test('the monitoring device header names a missing site in the active locale', async () => {
  const { s, root, unmount } = await deviceFixture();
  try {
    await inLocale(s, 'es', () => {
      const sub = byClass(root, 'page-sub')[0];
      assert.ok(sub, 'the device subtitle is rendered');
      assert.match(textContent(sub), /Sin sede/, 'the Spanish fallback is shown');
    });
    await inLocale(s, 'en', () => {
      const sub = byClass(root, 'page-sub')[0];
      assert.match(textContent(sub), /No site/, 'the English fallback is shown');
      assert.doesNotMatch(textContent(sub), /Sin sede/, 'no Spanish fallback leaks');
    });
    assert.deepEqual(s.errors, []);
  } finally {
    s.c.ItsmI18n.setLocale('es');
    unmount();
  }
});
