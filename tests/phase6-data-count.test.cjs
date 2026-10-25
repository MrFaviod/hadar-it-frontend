'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

/*
 * The Data workspace header counts the canonical inventory, never the prototype
 * demo array. Documented filter policy (audit ITSM-001 minimal decision): the
 * header reports the total of the existing canonical inventory read, which the
 * server already filtered by the retained inventory query/category/status; the
 * header labels that filtered scope and never duplicates state or resets the
 * filters. Export keeps its own independent scope and payload.
 *
 * The assertions read the rendered header through the shipped template and the
 * shared HTTP transport, so a prototype count, a page-sized count, a stale
 * refresh value or an optimistic export change fails for its actual effect.
 */

const PROTOTYPE_COUNT = 28;

function walk(node, visit) {
  if (!node) return;
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

function textOf(node) {
  if (!node) return '';
  if (node.text !== undefined) return node.text;
  return (node.children || []).map(textOf).join('');
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function nodes(root, predicate) {
  const found = [];
  walk(root, (node) => { if (predicate(node)) found.push(node); });
  return found;
}

// The summary region renders each visible datum in its own span, so the
// rendered header has separate items ("2 activos", "inventario filtrado",
// "0 perfiles · 0 propios"). Reading the region's text as one concatenation
// would glue those neighbours into "2 activos0 perfiles" and make the header
// assertion depend on whitespace that the template deliberately does not
// render between spans. Join the region's direct segments instead, leaving the
// text inside each segment untouched so numeric labels stay exact.
function summaryText(root) {
  const meta = nodes(root, (node) => node.props && node.props['aria-label'] === 'Resumen del módulo');
  assert.equal(meta.length, 1, 'the Data header keeps its module summary region');
  const segments = (meta[0].children || [])
    .map((child) => textOf(child).replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length > 0);
  return segments.length ? segments.join(' ') : textOf(meta[0]).replace(/\s+/g, ' ').trim();
}

function json(payload, status = 200) {
  return { ok: status < 400, status, json: async () => plain(payload) };
}

function assetDto(index) {
  return {
    id: 'asset-' + index,
    name: 'Activo canónico ' + index,
    quickCode: 'AM-' + index,
    category: 'network',
    status: 'active',
    technical: {}
  };
}

const dtoList = (count) => Array.from({ length: count }, (_, index) => assetDto(index + 1));

// The prototype array the header used to read. Its exact length mirrors the
// shipped demo catalogue so the old implementation visibly reports 28.
function prototypeAssets() {
  return Array.from({ length: PROTOTYPE_COUNT }, (_, index) => ({
    id: 'demo-' + index,
    name: 'Activo de demostración ' + index,
    category: 'notebooks',
    status: 'Asignado'
  }));
}

function stubSearch(c, respond) {
  const calls = [];
  c.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET', body: init.body, signal: init.signal });
    const path = target.split('?')[0].replace(/^\/api\/v1/, '');
    const response = respond ? respond({ url: target, path, method: init.method || 'GET' }) : null;
    // Model the browser transport: a request cancelled while it is in flight
    // rejects with AbortError instead of delivering a payload, so a route
    // handler that starts the Data read and then falls through to its abort
    // path cannot be mistaken for a working refresh.
    await Promise.resolve();
    if (init.signal && init.signal.aborted) {
      const error = new Error('Solicitud cancelada.');
      error.name = 'AbortError';
      throw error;
    }
    return response || json({ error: { code: 'not_found' }, details: [] }, 404);
  };
  return calls;
}

const searchCalls = (calls) => calls.filter((call) => call.url.replace(/^\/api\/v1/, '').split('?')[0] === '/assets/search');

function searchPayload(total, loaded) {
  return { items: dtoList(loaded), total, limit: 50, offset: 0 };
}

function fixture(t) {
  const session = harness.setup();
  const { c, app } = session;
  c.options.components.DataTransfer = c.AssetTransferViews.DataTransfer;
  c.options.components.TransferImport = c.AssetTransferViews.TransferImport;
  c.options.components.TransferExport = c.AssetTransferViews.TransferExport;
  app.route = { name: 'datos', section: 'importar' };
  app.assets = prototypeAssets();
  app.prefs = Object.assign({}, app.prefs, { search: '', category: 'all', site: 'all' });
  app.inventoryFilters = { query: '', category: 'all', status: 'all' };
  app.loadImportProfiles = async () => true;
  const mounted = session.mount('DataTransfer');
  t.after(() => mounted.unmount());
  return Object.assign({}, session, { view: mounted.instance, root: mounted.root });
}

const FILTER_LABEL = /(filtrad|con filtros|filtros activos)/i;

test('the header reports the canonical total for zero, two and a page larger than the loaded items', async (t) => {
  const cases = [
    { total: 0, loaded: 0 },
    { total: 2, loaded: 2 },
    { total: 151, loaded: 50 }
  ];

  for (const sample of cases) {
    const { app, c, root, settle } = fixture(t);
    assert.equal(app.assets.length, PROTOTYPE_COUNT, 'the prototype fixture stays mounted');
    const calls = stubSearch(c, ({ path }) => (
      path === '/assets/search' ? json(searchPayload(sample.total, sample.loaded)) : null
    ));

    await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
    await settle();

    const expected = new RegExp('(^|\\D)' + sample.total + '\\s+activos\\b');
    assert.match(summaryText(root), expected, 'the header shows the canonical server total');
    assert.doesNotMatch(summaryText(root), /\b28\s+activos\b/, 'the prototype count is never authoritative');
    if (sample.total !== sample.loaded) {
      assert.doesNotMatch(summaryText(root), new RegExp('\\b' + sample.loaded + '\\s+activos\\b'),
        'the header reports the inventory total, not the loaded page');
    }
    assert.doesNotMatch(summaryText(root), FILTER_LABEL, 'an unfiltered count is not labelled as filtered');
    assert.equal(searchCalls(calls).length, 1, 'the Data header reads the existing canonical inventory endpoint');
  }
});

test('initial, loading and error states never present a prototype or stale count', async (t) => {
  const { app, c, root, settle } = fixture(t);

  // Nothing has been read yet: the demo array is the only numeric source available.
  assert.equal(app.inventory.loaded, false);
  assert.doesNotMatch(summaryText(root), /\d+\s+activos/, 'the initial header does not claim an inventory count');
  assert.doesNotMatch(summaryText(root), /\b28\s+activos\b/);

  stubSearch(c, ({ path }) => (path === '/assets/search' ? json(searchPayload(2, 2)) : null));
  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.match(summaryText(root), /\b2\s+activos\b/);

  // A refresh keeps the previous total out of the header while the read is in flight.
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  c.fetch = async () => {
    await pending;
    return json(searchPayload(5, 5));
  };
  const refresh = app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.equal(app.inventory.loading, true, 'the refresh is still in flight');
  assert.doesNotMatch(summaryText(root), /\b2\s+activos\b/, 'the stale total is not presented during loading');
  assert.doesNotMatch(summaryText(root), /\b28\s+activos\b/);
  release();
  await refresh;
  await settle();
  assert.match(summaryText(root), /\b5\s+activos\b/, 'the refreshed canonical total replaces the old one');

  // A failed read clears the authoritative count instead of reviving the demo value.
  stubSearch(c, ({ path }) => (path === '/assets/search'
    ? json({ error: { code: 'server_error' }, details: [] }, 500)
    : null));
  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.equal(app.inventory.error, 'No se pudo completar la solicitud.');
  assert.doesNotMatch(summaryText(root), /\d+\s+activos/, 'an error never shows a count as authoritative');
  assert.doesNotMatch(summaryText(root), /\b28\s+activos\b/);
});

test('entering and re-entering the Data route re-reads the canonical inventory and reflects its total', async (t) => {
  const { app, c, root, settle } = fixture(t);
  let total = 2;
  const calls = stubSearch(c, ({ path, method }) => (
    path === '/assets/search' && method === 'GET' ? json(searchPayload(total, Math.min(total, 2))) : null
  ));

  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.match(summaryText(root), /\b2\s+activos\b/);

  // Another session creates assets between visits; re-entering refreshes instead
  // of trusting the previously loaded page.
  total = 5;
  await app.handleInventoryRoute({ name: 'datos', section: 'importar' }, { name: 'panel' });
  await settle();
  assert.equal(searchCalls(calls).length, 2, 'the re-entry performs a fresh canonical read');
  assert.deepEqual(searchCalls(calls).map((call) => call.url.split('?')[0]),
    ['/api/v1/assets/search', '/api/v1/assets/search']);
  assert.match(summaryText(root), /\b5\s+activos\b/, 'the header reflects the refreshed total');
});

test('the count follows the retained inventory filters and labels the filtered scope', async (t) => {
  const { app, c, root, settle } = fixture(t);
  app.inventoryCatalog.loaded = true;
  app.inventoryCatalog.categories = [{ id: 'network', label: 'Redes', active: true }];
  app.inventoryFilters = { query: 'router', category: 'network', status: 'active' };
  const calls = stubSearch(c, ({ path }) => (path === '/assets/search' ? json(searchPayload(3, 3)) : null));

  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();

  const search = searchCalls(calls)[0];
  assert.ok(search, 'the Data entry reads the canonical inventory');
  const params = new URL(search.url, 'http://localhost').searchParams;
  assert.equal(params.get('query'), 'router', 'the retained text filter is part of the canonical read');
  assert.equal(params.get('category'), 'Redes', 'the retained category filter is part of the canonical read');
  assert.equal(params.get('status'), 'active', 'the retained status filter is part of the canonical read');
  assert.deepEqual(plain(app.inventoryFilters), { query: 'router', category: 'network', status: 'active' },
    'entering the Data route does not reset the inventory filters');

  const summary = summaryText(root);
  assert.match(summary, /\b3\s+activos\b/, 'the count is the filtered canonical total');
  assert.match(summary, FILTER_LABEL, 'the header states that the count follows active inventory filters');
});

test('the canonical count refresh leaves the export payload and scope untouched', async (t) => {
  const { app, c, root, mount, settle } = fixture(t);
  app.assets = [{ id: 'asset-a1', name: 'Router', category: 'network', status: 'active' }];
  app.inventoryFilters = { query: '', category: 'network', status: 'active' };
  app.workspaceInventory = Object.assign({}, app.workspaceInventory, { location: 'loc-uuid' });
  app.phase6.profiles.items = [{
    id: 'builtin-export',
    name: 'Inventario',
    options: { kind: 'export', fields: ['id', 'name', 'category', 'status'], format: 'csv' }
  }];
  const calls = stubSearch(c, ({ path }) => (path === '/assets/search' ? json(searchPayload(151, 50)) : null));

  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.match(summaryText(root), /\b151\s+activos\b/);
  assert.equal(calls.filter((call) => call.url.indexOf('/assets/export') !== -1).length, 0,
    'the count refresh never reaches the export endpoint');
  assert.deepEqual(plain(app.inventoryFilters), { query: '', category: 'network', status: 'active' });

  // The export view mounted over the same app state still sends the unchanged contract.
  const blob = new Blob(['id,name\r\nasset-a1,Router\r\n'], { type: 'text/csv' });
  const exported = [];
  c.fetch = async (url, init = {}) => {
    exported.push({
      url: String(url),
      method: init.method || 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    });
    return { ok: true, status: 200, blob: async () => blob };
  };
  const exportMount = mount('TransferExport');
  t.after(() => exportMount.unmount());
  await exportMount.instance.generate();

  assert.equal(exported.length, 1);
  assert.equal(exported[0].url, '/api/v1/assets/export');
  assert.equal(exported[0].method, 'POST');
  assert.deepEqual(exported[0].body, {
    fields: ['id', 'name', 'category', 'status'],
    options: { separator: 'comma', headerRow: true, bom: true, includeEmpty: true },
    filters: { archived: false, category: 'network', status: 'active', location_id: 'loc-uuid' }
  });
});

test('a late response from an abandoned read never replaces the newest canonical total', async (t) => {
  const { app, c, root, settle } = fixture(t);
  const gates = [];
  let reads = 0;
  c.fetch = async () => {
    reads += 1;
    const read = reads;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    gates.push(release);
    await gate;
    return json(searchPayload(read === 1 ? 99 : 4, 4));
  };

  const first = app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.equal(reads, 1);
  const second = app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.equal(reads, 2, 'the second entry starts a newer read');

  gates[1]();
  await second;
  await settle();
  assert.match(summaryText(root), /\b4\s+activos\b/);

  // The older read resolves after the newest one and must be discarded.
  gates[0]();
  await first;
  await settle();
  assert.match(summaryText(root), /\b4\s+activos\b/, 'the newest canonical total wins');
  assert.doesNotMatch(summaryText(root), /\b99\s+activos\b/, 'the abandoned read never renders');
});

test('without assets.view the header never invents a count from the prototype array', async (t) => {
  const { app, c, root, settle } = fixture(t);
  app.can = () => false;
  const calls = stubSearch(c, () => null);

  await app.handleInventoryRoute({ name: 'datos', section: 'importar' });
  await settle();
  assert.equal(searchCalls(calls).length, 0, 'no canonical read is attempted without the permission');
  assert.doesNotMatch(summaryText(root), /\b28\s+activos\b/);
  assert.doesNotMatch(summaryText(root), /\d+\s+activos/);
});
