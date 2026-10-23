'use strict';
// Phase 6 warranties (S6, S7, S9, S10): the original warranty components keep
// their layout and flow, but every value comes from the server. These tests
// mount the shipped components and fail if a save mutates the browser asset,
// a receipt becomes a local file reference, a preference lands in localStorage,
// or the center filters the prototype collection instead of the server list.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const harness = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';
const RECEIPT_ID = 'aaaaaaa1-bbbb-cccc-dddd-eeeeeeeeeeee';
const UPLOADED_ID = 'fffffff2-1111-2222-3333-444444444444';

function response(payload, status) {
  const code = status || 200;
  return { ok: code >= 200 && code < 300, status: code, json: () => Promise.resolve(payload) };
}

function stubFetch(c, handler) {
  const calls = [];
  c.fetch = (url, init) => {
    const call = { url: String(url), init: init || {}, body: init && init.body };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length));
  };
  return calls;
}

function trackStorage(c) {
  let writes = 0;
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => {
    writes += 1;
    original(key, value);
  };
  return () => writes;
}

function item(overrides) {
  return Object.assign({
    assetId: ASSET_ID,
    supplier: 'HP',
    purchaseDate: '2026-01-02',
    durationMonths: 24,
    expiresOn: '2028-01-02',
    status: 'active',
    receiptId: RECEIPT_ID,
    notes: '',
    coverage: 'current'
  }, overrides || {});
}

// The mounted tree keeps tag names and props, so the structure assertion reads
// what the component actually rendered.
function collect(node, found) {
  const out = found || [];
  if (!node || typeof node !== 'object') return out;
  if (node.tag && node.tag !== '#text' && node.tag !== '#comment') {
    const props = node.props || {};
    out.push({ tag: node.tag, class: String(props.class || ''), odId: String(props['data-od-id'] || '') });
  }
  (node.children || []).forEach((child) => collect(child, out));
  return out;
}

test('the original editor saves the canonical payload and never mutates the browser asset', async () => {
  const { c, app, mount } = harness.setup();
  const writes = trackStorage(c);
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true, warranty: { provider: 'Prototipo', until: '2020-01-01' } };
  const canonical = item({ notes: 'Ampliada' });
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'PUT') return response(canonical);
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    return response(item());
  });
  const panel = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);

  assert.equal(panel.instance.w.provider, 'HP', 'the panel shows the server warranty, not the prototype shape');
  assert.equal(panel.instance.w.purchase, '2026-01-02');
  assert.equal(panel.instance.w.until, '2028-01-02');
  assert.equal(panel.instance.w.months, 24);
  assert.equal(panel.instance.state.label, 'Vigente', 'coverage comes from the server field');

  await app.loadAssetAttachments(ASSET_ID);
  panel.instance.startEdit();
  await panel.instance.saveEditor({ provider: 'Canonical', purchase: '2026-01-02', until: '2028-01-02', months: 24, mode: 'date', note: 'Ampliada', receiptId: RECEIPT_ID });

  const put = calls.find((call) => call.init.method === 'PUT');
  assert.ok(put, 'the save reaches the warranty endpoint');
  assert.equal(put.url, '/api/v1/assets/' + ASSET_ID + '/warranty');
  const body = JSON.parse(put.body);
  assert.equal(body.supplier, 'Canonical');
  assert.equal(body.purchaseDate, '2026-01-02');
  assert.equal(body.expiresOn, '2028-01-02');
  assert.equal(body.notes, 'Ampliada');
  assert.equal(body.receiptId, RECEIPT_ID);
  assert.equal(body.status, 'active');
  assert.deepEqual(asset.warranty, { provider: 'Prototipo', until: '2020-01-01' }, 'the prototype asset keeps its own shape');
  assert.equal(writes(), 0, 'a warranty save never writes browser storage');
  panel.unmount();
});

test('a duration warranty sends the months and leaves the expiry to the server calculation', async () => {
  const { c, app, mount } = harness.setup();
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'PUT') return response(item({ durationMonths: 12, expiresOn: '2027-01-02' }));
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    return response(null, 404);
  });
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };
  const panel = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  assert.equal(panel.instance.w.provider, '', 'a missing warranty is an empty form, not a prototype fallback');

  await panel.instance.saveEditor({ provider: 'Dell', purchase: '2026-02-01', until: '', months: 12, mode: 'duration', note: '', receiptId: '' });

  const put = calls.find((call) => call.init.method === 'PUT');
  const body = JSON.parse(put.body);
  assert.equal(body.durationMonths, 12);
  assert.equal(body.expiresOn, undefined, 'the previewed expiry is not sent as a conflicting date');
  assert.equal(body.receiptId, null);
  panel.unmount();
});

test('the editor previews the calculated expiry from the registered purchase date', async () => {
  const { c, mount } = harness.setup();
  stubFetch(c, () => response(null, 404));
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };
  const panel = mount('AssetWarrantyPanel', { asset });
  panel.instance.startEdit();
  const editor = panel.instance.editorDraft();
  editor.provider = 'Dell';
  editor.purchase = '2026-01-31';
  editor.months = 1;
  editor.mode = 'duration';
  panel.instance.editorDraft(editor);
  assert.equal(panel.instance.previewExpiry(editor), '2026-02-28', 'month ends clamp like the server calculation');
  panel.unmount();
});

test('a receipt is uploaded as real bytes before the warranty references its opaque id', async () => {
  const { c, app, mount } = harness.setup();
  const stored = { id: UPLOADED_ID, assetId: ASSET_ID, filename: 'factura.pdf', category: 'receipt', size: 8, contentType: 'application/pdf' };
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'POST') return response(stored, 201);
    if (call.init.method === 'PUT') return response(item({ receiptId: UPLOADED_ID }));
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [stored], hasMore: false });
    return response(item());
  });
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };
  const panel = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  await app.loadAssetAttachments(ASSET_ID);
  panel.instance.startEdit();

  const uploaded = await panel.instance.uploadReceipt({ target: { value: 'factura.pdf', files: [{ name: 'factura.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }] } });

  const post = calls.find((call) => call.init.method === 'POST');
  assert.ok(post, 'the file travels to the attachments endpoint');
  assert.equal(post.url, '/api/v1/assets/' + ASSET_ID + '/attachments?filename=factura.pdf&category=receipt');
  assert.ok(post.body instanceof ArrayBuffer, 'the stored value is the file bytes');
  assert.equal(uploaded, UPLOADED_ID, 'the editor selects the uploaded attachment');
  assert.equal(panel.instance.editorDraft().receiptId, UPLOADED_ID);

  await panel.instance.saveEditor(panel.instance.editorDraft());
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.equal(JSON.parse(put.body).receiptId, UPLOADED_ID);
  panel.unmount();
});

test('unlinking the reference keeps the stored receipt and downloads the opaque id', async () => {
  const { c, app, mount } = harness.setup();
  const stored = { id: RECEIPT_ID, assetId: ASSET_ID, filename: 'factura.pdf', category: 'receipt', size: 2048, contentType: 'application/pdf' };
  const blob = { size: 2048 };
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/download') !== -1) return { ok: true, status: 200, json: () => Promise.resolve(blob), blob: () => Promise.resolve(blob) };
    if (call.init.method === 'PUT') return response(item({ receiptId: null }));
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [stored], hasMore: false });
    return response(item());
  });
  const downloads = [];

  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };
  const panel = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  await app.loadAssetAttachments(ASSET_ID);
  // The browser download capability is replaced only after the component
  // template is compiled, so the renderer keeps its own DOM helpers.
  c.document.body = { appendChild() {}, removeChild() {} };
  c.document.createElement = () => ({ href: '', download: '', rel: '', click() { downloads.push({ href: this.href, filename: this.download }); } });
  c.URL = class extends URL {
    static createObjectURL() { return 'blob:warranty-test'; }
    static revokeObjectURL() {}
  };
  assert.equal(panel.instance.receipt().filename, 'factura.pdf');

  assert.equal(await panel.instance.downloadReceipt(), true);
  const download = calls.find((call) => call.url.indexOf('/download') !== -1);
  assert.equal(download.url, '/api/v1/assets/' + ASSET_ID + '/attachments/' + RECEIPT_ID + '/download');
  assert.deepEqual(downloads.map((entry) => entry.filename), ['factura.pdf']);

  panel.instance.startEdit();
  panel.instance.unlinkReceipt();
  assert.equal(panel.instance.editorDraft().receiptId, '');
  await panel.instance.saveEditor(panel.instance.editorDraft());
  assert.equal(JSON.parse(calls.find((call) => call.init.method === 'PUT').body).receiptId, null);
  assert.equal(calls.filter((call) => call.init.method === 'DELETE').length, 0, 'unlinking never deletes the stored blob');
  panel.unmount();
});

test('without assets.view the panel reads nothing and without assets.edit it cannot save', async () => {
  const { c, app, mount } = harness.setup();
  const calls = stubFetch(c, () => response(item()));
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };

  app.can = () => false;
  const blocked = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  assert.equal(calls.length, 0, 'a caller without assets.view never queries the warranty');
  assert.equal(blocked.instance.item, null);
  blocked.unmount();

  app.can = (permission) => permission === 'assets.view';
  const readOnly = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  assert.equal(readOnly.instance.canEdit, false, 'assets.edit is required to start editing');
  assert.equal(readOnly.instance.item.supplier, 'HP');
  readOnly.unmount();
});

test('a save that resolves after the session ended reports cancellation and touches nothing', async () => {
  const { c, app, mount } = harness.setup();
  let release = null;
  c.fetch = (url, init) => {
    if ((init && init.method) === 'PUT') {
      return new Promise((resolve) => {
        release = () => resolve(response(item({ notes: 'late' })));
      });
    }
    if (String(url).indexOf('/attachments') !== -1) return Promise.resolve(response({ items: [], hasMore: false }));
    return Promise.resolve(response(item()));
  };
  const asset = { id: ASSET_ID, name: 'Notebook HP', serverAsset: true };
  const panel = mount('AssetWarrantyPanel', { asset });
  await app.loadAssetWarranty(ASSET_ID);
  panel.instance.startEdit();

  const saving = panel.instance.saveEditor({ provider: 'Late', purchase: '2026-01-02', until: '2028-01-02', months: 0, mode: 'date', note: '', receiptId: '' });
  app.clearPhase6State();
  release();
  assert.equal(await saving, false, 'the late save cannot report success');
  assert.equal(app.phase6.warranty.item, null);
  assert.equal(app.lastToast, undefined);
  panel.unmount();
});

test('warranty preferences persist only the bounded server value', async () => {
  const { c, app, mount } = harness.setup();
  const writes = trackStorage(c);
  const calls = stubFetch(c, (call) => {
    if (call.init.method === 'PUT') return response({ expiringDays: 45 });
    return response({ expiringDays: 30 });
  });
  const view = mount('WarrantySettings');
  await view.instance.load();
  assert.equal(view.instance.days, 30);
  const get = calls.find((call) => call.url.indexOf('/warranty-preferences') !== -1);
  assert.equal(get.url, '/api/v1/warranty-preferences');

  view.instance.days = 45;
  assert.equal(await view.instance.save(), true);
  const put = calls.find((call) => call.init.method === 'PUT');
  assert.deepEqual(JSON.parse(put.body), { expiringDays: 45 }, 'only the stored preference travels');
  assert.equal(app.phase6.warrantyPrefs.expiringDays, 45);
  assert.equal(writes(), 0, 'no browser storage holds the preference');

  // The bound is the server contract: an out-of-range value never travels.
  const sent = calls.length;
  view.instance.days = 0;
  assert.equal(await view.instance.save(), false);
  assert.equal(calls.length, sent, 'the client refuses a value the server would reject');
  assert.match(view.instance.error, /365/);
  view.unmount();
});

test('the settings section keeps the site, category and retired filters transient', async () => {
  const { c, app, mount } = harness.setup();
  const writes = trackStorage(c);
  const calls = stubFetch(c, () => response({ expiringDays: 30 }));
  const view = mount('WarrantySettings');
  await view.instance.load();

  view.instance.app.warrantyPrefs.site = 'central';
  view.instance.app.warrantyPrefs.category = 'pc';
  view.instance.app.warrantyPrefs.includeRetired = true;
  await view.instance.save();

  const put = calls.find((call) => call.init.method === 'PUT');
  assert.deepEqual(JSON.parse(put.body), { expiringDays: view.instance.days }, 'view filters are never persisted');
  assert.equal(writes(), 0);
  assert.match(view.instance.filterNote, /esta sesión/i, 'the view-only scope is disclosed');
  view.unmount();
});

test('the center pages the server list and joins only the loaded inventory', async () => {
  const { c, app, mount } = harness.setup();
  app.inventory.items = [{ id: ASSET_ID, name: 'Notebook HP', code: 'NB-1' }];
  app.inventory.total = 2;
  const rows = [item({ assetId: ASSET_ID }), item({ assetId: OTHER_ID, supplier: 'Dell', coverage: 'expired' })];
  const calls = stubFetch(c, (call, count) => {
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    if (call.url.indexOf('offset=0') !== -1) return response({ items: rows, hasMore: true, offset: 0 });
    return response({ items: [], hasMore: false, offset: 2 });
  });
  const view = mount('WarrantyCenter');
  await view.instance.reload();

  assert.equal(calls[0].url, '/api/v1/warranties?coverage=&offset=0&limit=50');
  assert.deepEqual(view.instance.rows.map((row) => row.assetId), [ASSET_ID, OTHER_ID]);
  assert.equal(view.instance.assetOf(rows[0]).name, 'Notebook HP', 'the loaded inventory names the row');
  assert.equal(view.instance.assetLabel(rows[1]), OTHER_ID, 'an inventory record outside the loaded page falls back to the UUID');
  assert.deepEqual(JSON.parse(JSON.stringify(view.instance.counts)), { all: 2, current: 1, expiring: 0, expired: 1, unknown: 0 }, 'counts describe the loaded rows');

  await view.instance.loadMore();
  assert.equal(calls[2].url, '/api/v1/warranties?coverage=&offset=2&limit=50');
  assert.equal(view.instance.items.length, 2);
  view.unmount();
});

test('the center filters coverage through the server and states what is loaded', async () => {
  const { c, app, mount } = harness.setup();
  const calls = stubFetch(c, (call) => {
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    return response({ items: [item({ coverage: 'expiring' })], hasMore: false, offset: 0 });
  });
  const view = mount('WarrantyCenter');
  await view.instance.reload();
  await view.instance.setCoverage('expiring');
  assert.ok(calls.some((call) => call.url === '/api/v1/warranties?coverage=expiring&offset=0&limit=50'));
  assert.match(view.instance.loadedNote, /cargad/i);
  assert.equal(view.instance.state.items.length, 1);
  view.unmount();
});

test('the warranty route mounts the original components and their layout', async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(html.includes('<warranty-center'), 'the center component is mounted');
  assert.ok(html.includes('<warranty-settings'), 'the settings component is mounted');
  assert.ok(html.includes('<asset-warranty-panel'), 'the asset panel is mounted');
  assert.ok(!html.includes('<phase6-warranty-center'));
  assert.ok(!html.includes('<phase6-warranty-settings'));
  assert.ok(!html.includes('<phase6-asset-warranty'));

  const { c, app, mount, errors } = harness.setup();
  stubFetch(c, (call) => {
    if (call.url.indexOf('/warranties') !== -1) return response({ items: [item()], hasMore: false });
    if (call.url.indexOf('/attachments') !== -1) return response({ items: [], hasMore: false });
    return response(item());
  });
  const center = mount('WarrantyCenter');
  await center.instance.reload();
  const centerNodes = collect(center.root);
  assert.ok(centerNodes.some((node) => node.odId === 'warranties-center'), 'the original center surface is rendered');
  assert.ok(centerNodes.some((node) => node.class.includes('warranty-table')), 'the original table is rendered');
  assert.ok(centerNodes.some((node) => node.class.includes('warranty-metric')), 'the original metrics are rendered');

  const panel = mount('AssetWarrantyPanel', { asset: { id: ASSET_ID, name: 'Notebook HP', serverAsset: true } });
  await app.loadAssetWarranty(ASSET_ID);
  const panelNodes = collect(panel.root);
  assert.ok(panelNodes.some((node) => node.odId === 'asset-warranty-panel'), 'the original asset panel is rendered');
  assert.ok(panelNodes.some((node) => node.class.includes('warranty-status-card')), 'the original status card is rendered');

  const settings = mount('WarrantySettings');
  await settings.instance.load();
  const settingsNodes = collect(settings.root);
  assert.ok(settingsNodes.some((node) => node.odId === 'warranty-settings'), 'the original settings surface is rendered');
  assert.deepEqual(Array.from(errors), [], 'the original surfaces render without runtime errors');
  center.unmount();
  panel.unmount();
  settings.unmount();
});
