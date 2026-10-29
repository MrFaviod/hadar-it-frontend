'use strict';
// Rendered filter state of the canonical people directory: the results bar must
// report only filters the user actually set. The default sentinels ('all') and a
// blank search term are the unfiltered state, so they are neither counted nor
// described. Real department, site, status and search selections keep their
// count and their server labels. The fixture mounts the shipped results bar with
// the real vendored Vue, so the assertions read the public computed values and
// the markup the browser renders. No copy of the region lives in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup } = require('./universal-harness.cjs');

const DEPARTMENT_ID = '5a1e0c10-0006-4f10-9a10-000000000006';
const SITE_ID = '5a1e0c10-0001-4f10-9a10-000000000001';
const PERSON_ID = '5a1e0c10-0005-4f10-9a10-000000000005';

// The shipped people results bar, so the mounted test reads the same markup the
// browser renders. Other sections carry their own results bar, so the slice is
// anchored on the people filter count that this bar is the only one to print.
function resultsBarRegion() {
  const html = fs.readFileSync('index.html', 'utf8');
  const anchor = html.indexOf('{{ peopleFilterCount }}');
  assert.ok(anchor !== -1, 'index.html still renders the people filter count');
  const from = html.lastIndexOf('<div class="results-bar"', anchor);
  assert.ok(from !== -1, 'the people filter count lives in a results bar');
  const buttonEnd = html.indexOf('</button>', anchor);
  assert.ok(buttonEnd > anchor, 'the results bar still carries the filter reset action');
  const to = html.indexOf('</div>', buttonEnd);
  assert.ok(to > buttonEnd, 'the results bar still closes after its reset action');
  return html.slice(from, to + '</div>'.length);
}

function textContent(node) {
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

// Every own binding of the harness app exposed to the mounted region, so the
// real markup resolves the same names it resolves on the root component.
function bindings(app) {
  const options = { computed: {}, methods: {} };
  Object.getOwnPropertyNames(app).forEach((key) => {
    if (key === 'app' || key.charAt(0) === '_') return;
    const value = app[key];
    if (typeof value === 'function') {
      options.methods[key] = function () { return value.apply(app, arguments); };
    } else {
      options.computed[key] = function () { return app[key]; };
    }
  });
  return options;
}

// Canonical directory records shaped like the mapped server page, so the labels
// the bar prints are the ones the server owns.
function directoryApp(filters) {
  const session = setup();
  const app = session.app;
  app.route = { name: 'people', personId: '', assetId: '', section: '', focusId: '' };
  app.can = () => true;
  app.prefs.people = Object.assign({ search: '', site: 'all', department: 'all', status: 'all' }, filters || {});
  const seed = (page, items) => {
    Object.assign(page, { items, total: items.length, loaded: true, loading: false, error: '' });
  };
  seed(app.organization.people, [{
    id: PERSON_ID,
    name: 'Ana Canónica',
    label: 'Ana Canónica (Analista)',
    role: 'Analista',
    departmentId: DEPARTMENT_ID,
    siteId: SITE_ID,
    active: true
  }]);
  seed(app.organization.departments, [{
    id: DEPARTMENT_ID, name: 'Operaciones', label: 'Operaciones', active: true, serverRecord: true
  }]);
  seed(app.organization.locations, [{
    id: SITE_ID, level: 'site', parentId: null, name: 'Sede Central', active: true, levelLabel: 'Sede'
  }]);
  return session;
}

async function mountBar(session) {
  const { c, app } = session;
  const options = Object.assign(
    {
      name: 'PeopleResultsBar',
      props: { app: { type: Object, required: true } },
      components: Object.assign({}, c.options.components)
    },
    bindings(app),
    { template: '<div>' + resultsBarRegion() + '</div>' }
  );
  c.options.components.PeopleResultsBar = options;
  const mounted = session.mount('PeopleResultsBar', { app });
  await session.settle();
  return mounted;
}

test('the default people filter state reports no active filters and no description', async () => {
  const s = directoryApp();
  assert.equal(s.app.peopleFilterCount, 0, 'the default sentinels are not filters');
  assert.equal(s.app.peopleFilterDescription, '', 'the default sentinels describe nothing');
  const mounted = await mountBar(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'the unfiltered bar offers no filter reset');
  assert.doesNotMatch(rendered, /Sin departamento/, 'the department sentinel is not described');
  assert.doesNotMatch(rendered, /Sin sede/, 'the site sentinel is not described');
  assert.doesNotMatch(rendered, /·/, 'the unfiltered bar appends no description');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('a blank search term and the sentinels still report no filters', async () => {
  const s = directoryApp({ search: '   ' });
  assert.equal(s.app.peopleFilterCount, 0, 'a whitespace search term is not a filter');
  assert.equal(s.app.peopleFilterDescription, '', 'a whitespace search term describes nothing');
  const mounted = await mountBar(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'a blank search offers no filter reset');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('the literal search word all is not a select sentinel', async () => {
  const s = directoryApp({ search: 'all' });
  assert.equal(s.app.peopleFilterCount, 1);
  assert.equal(s.app.peopleFilterDescription, '"all"');
  const mounted = await mountBar(s);
  assert.match(textContent(mounted.root), /Limpiar filtros\s*1/);
  assert.match(textContent(mounted.root), /"all"/);
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('real filters are counted once each and described with their server labels', async () => {
  const s = directoryApp({ search: 'ana', department: DEPARTMENT_ID, site: SITE_ID, status: 'active' });
  assert.equal(s.app.peopleFilterCount, 4, 'every real filter counts exactly once');
  assert.equal(s.app.peopleFilterDescription, '"ana" · Operaciones · Sede Central · Solo activas',
    'the description keeps the search term and the server department and site labels');
  const mounted = await mountBar(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /Limpiar filtros\s*4/, 'the reset action reports the real filter count');
  assert.match(rendered, /"ana" · Operaciones · Sede Central · Solo activas/, 'the bar renders the real description');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('a single real selection keeps its own count and label', async () => {
  const statusOnly = directoryApp({ status: 'inactive' });
  assert.equal(statusOnly.app.peopleFilterCount, 1, 'the inactive status counts once');
  assert.equal(statusOnly.app.peopleFilterDescription, 'Solo inactivas', 'the inactive status keeps its label');
  const departmentOnly = directoryApp({ department: DEPARTMENT_ID });
  assert.equal(departmentOnly.app.peopleFilterCount, 1, 'a real department counts once');
  assert.equal(departmentOnly.app.peopleFilterDescription, 'Operaciones', 'a real department keeps its server label');
  const siteOnly = directoryApp({ site: SITE_ID });
  assert.equal(siteOnly.app.peopleFilterCount, 1, 'a real site counts once');
  assert.equal(siteOnly.app.peopleFilterDescription, 'Sede Central', 'a real site keeps its server label');
});

test('clearing the filters restores the unfiltered state', async () => {
  const s = directoryApp({ search: 'ana', department: DEPARTMENT_ID, site: SITE_ID, status: 'inactive' });
  assert.equal(s.app.peopleFilterCount, 4, 'the fixture starts with four active filters');
  s.app.clearPeopleFilters();
  await s.settle();
  assert.deepEqual(Object.assign({}, s.app.prefs.people), { search: '', site: 'all', department: 'all', status: 'all' },
    'the reset restores the default sentinels');
  assert.equal(s.app.peopleFilterCount, 0, 'the reset leaves no active filter');
  assert.equal(s.app.peopleFilterDescription, '', 'the reset leaves no description');
  const mounted = await mountBar(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'the reset bar offers no further reset');
  assert.doesNotMatch(rendered, /·/, 'the reset bar appends no description');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});
