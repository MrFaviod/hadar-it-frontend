'use strict';
// Rendered empty-state contract for the people directory: an empty page is only
// a filtered result when the user actually has active filters. A canonical
// directory with zero people must say so instead of blaming filters, and a page
// whose unfiltered totals are missing or non-zero must stay neutral.
// The fixture mounts the real index.html empty-state region with the real
// vendored Vue and the real AssetAccess permission evaluation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup } = require('./universal-harness.cjs');

// The shipped people empty state, so the mounted test reads the same markup the
// browser renders. No copy of the region lives in this file.
function peopleEmptyRegion() {
  const html = fs.readFileSync('index.html', 'utf8');
  const from = html.indexOf('<div v-if="!filteredPeople.length');
  assert.ok(from !== -1, 'index.html still contains the people empty state');
  const to = html.indexOf('<!-- Ficha de persona -->', from);
  assert.ok(to > from, 'index.html still contains the person detail section after the empty state');
  return html.slice(from, to);
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

function directoryApp(overrides) {
  const session = setup();
  const app = session.app;
  app.route = { name: 'people', personId: '', assetId: '', section: '', focusId: '' };
  app.prefs.people = { search: '', site: 'all', department: 'all', status: 'all' };
  Object.assign(app.organization.people, {
    items: [], total: 0, limit: 25, offset: 0, loaded: true, loading: false, error: ''
  });
  Object.assign(app.organization.peopleTotals, { total: 0, active: 0, loaded: true, error: '' });
  const merged = Object.assign({ directory: {}, filters: {}, people: {}, totals: {} }, overrides || {});
  Object.assign(app.organization.people, merged.directory);
  Object.assign(app.organization.peopleTotals, merged.totals);
  Object.assign(app.prefs.people, merged.filters);
  app.organization.people.items = merged.people.items || [];
  return session;
}

async function mountEmpty(session, canCreate) {
  const { c, app } = session;
  app.can = () => canCreate !== false;
  Object.assign(app, {
    openPersonDialog: app.openPersonDialog || function () { app.lastOpenedPersonDialog = true; },
    clearPeopleFilters: app.clearPeopleFilters || function () { app.lastClearedPeopleFilters = true; }
  });
  const options = Object.assign(
    {
      name: 'PeopleEmptyState',
      props: { app: { type: Object, required: true } },
      components: Object.assign({}, c.options.components)
    },
    bindings(app),
    { template: '<div>' + peopleEmptyRegion() + '</div>' }
  );
  c.options.components.PeopleEmptyState = options;
  const mounted = session.mount('PeopleEmptyState', { app });
  await session.settle();
  return mounted;
}

test('a canonical directory with zero people reports no records and offers no filter reset', async () => {
  const s = directoryApp();
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /Todavía no hay personas registradas/, 'the empty directory explains that no person exists yet');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'zero records are not blamed on filters that are not active');
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'there is no filter reset to offer without active filters');
  assert.match(rendered, /Nueva persona/, 'the empty directory still offers the authorized create action');
  assert.doesNotMatch(rendered, /personas encontradas/, 'the empty card invents no record count');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('zero people without the create permission keeps the truthful copy and hides the create action', async () => {
  const s = directoryApp();
  const mounted = await mountEmpty(s, false);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /Todavía no hay personas registradas/, 'the empty directory still explains that no person exists yet');
  assert.doesNotMatch(rendered, /Nueva persona/, 'the create action stays behind its permission gate');
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'there is no filter reset to offer without active filters');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('an empty page with an active filter keeps the filter message and its reset action', async () => {
  const s = directoryApp({ filters: { status: 'active' } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /No hay personas con estos filtros/, 'an active filter still explains the empty result');
  assert.match(rendered, /Limpiar filtros/, 'an active filter keeps its reset action');
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'a filtered result is not reported as an empty directory');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('an empty page with a search term keeps the filter message and its reset action', async () => {
  const s = directoryApp({ filters: { search: 'ana' } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /No hay personas con estos filtros/, 'a search term still explains the empty result');
  assert.match(rendered, /Limpiar filtros/, 'a search term keeps its reset action');
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'a search result is not reported as an empty directory');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('an empty page with unknown unfiltered totals stays neutral instead of reporting an empty directory', async () => {
  const s = directoryApp({ totals: { loaded: false, total: 0 } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /No hay personas para mostrar/, 'missing totals keep the neutral guidance');
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'unknown totals are not reported as an empty directory');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'unknown totals are not blamed on filters');
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'unknown totals offer no filter reset');
  assert.doesNotMatch(rendered, /personas encontradas/, 'the neutral card invents no record count');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('an empty page with a non-zero unfiltered total stays neutral instead of reporting an empty directory', async () => {
  const s = directoryApp({ totals: { loaded: true, total: 7 } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.match(rendered, /No hay personas para mostrar/, 'a non-zero directory keeps the neutral guidance');
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'a populated directory is not reported as empty');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'a populated directory is not blamed on filters');
  assert.doesNotMatch(rendered, /Limpiar filtros/, 'a populated directory offers no filter reset');
  assert.doesNotMatch(rendered, /\b7\b/, 'the neutral card repeats no unfiltered total');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('a failed people request keeps the server error and renders no empty state', async () => {
  const s = directoryApp({ directory: { error: 'Servidor no disponible' } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'a server error is not reported as an empty directory');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'a server error is not reported as a filtered result');
  assert.doesNotMatch(rendered, /No hay personas para mostrar/, 'a server error is not reported as a neutral empty page');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('a loading people request renders no empty state', async () => {
  const s = directoryApp({ directory: { loading: true, loaded: false } });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'loading is not reported as an empty directory');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'loading is not reported as a filtered result');
  assert.doesNotMatch(rendered, /No hay personas para mostrar/, 'loading is not reported as a neutral empty page');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});

test('a populated people page renders no empty state', async () => {
  const s = directoryApp({
    totals: { loaded: true, total: 1 },
    people: { items: [{ id: 'person-1', name: 'Ana Benítez', role: 'Analista', departmentId: 'dep-1', siteId: 'site-1', active: true }] }
  });
  const mounted = await mountEmpty(s);
  const rendered = textContent(mounted.root);
  assert.doesNotMatch(rendered, /Todavía no hay personas registradas/, 'a populated page shows no empty-directory copy');
  assert.doesNotMatch(rendered, /No hay personas con estos filtros/, 'a populated page shows no filtered-empty copy');
  assert.doesNotMatch(rendered, /No hay personas para mostrar/, 'a populated page shows no neutral empty copy');
  assert.deepEqual(s.errors, []);
  mounted.unmount();
});
