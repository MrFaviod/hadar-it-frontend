const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const MODULES = ['assets/js/map-data.js', 'assets/js/map-engine.js', 'assets/js/map-config-views.js'];

function boot() {
  const window = {};
  window.setTimeout = function () {};
  window.clearTimeout = function () {};
  const sandbox = { window: window, console: console, setTimeout: function () {}, clearTimeout: function () {} };
  vm.createContext(sandbox);
  MODULES.forEach(function (file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  });
  return window;
}

function state(installed) {
  const window = boot();
  const View = window.AssetMapViews.MapSettings;
  const prefs = { cluster: false };
  const app = {
    serverOrganizationMode: installed,
    serverMapMode: false,
    maps: {
      buildings: [{ id: 'prototype-building' }],
      floors: [{ id: 'prototype-floor', name: 'Prototype floor', building: 'prototype-building', site: 'protoSite' }],
      plans: [{ id: 'prototype-plan', name: 'Prototype plan', visible: true, opacity: 0.5, floor: 'prototype-floor', format: 'svg' }],
      positions: { old: { x: 0.1, y: 0.2 } },
      geo: { protoSite: { lat: 1, lng: 2, address: 'Prototype address' } },
      prefs: prefs
    },
    assets: [{ id: 'old' }],
    sites: [{ id: 'protoSite', label: 'Prototype site' }],
    organizationMapSource: {
      maps: {
        buildings: [],
        floors: [],
        plans: [],
        positions: {},
        geo: { serverSite: { lat: -25.3, lng: -57.6, address: 'Server address' } },
        serverMap: true
      },
      assets: [],
      sites: [{ id: 'serverSite', label: 'Server site', latitude: -25.3, longitude: -57.6 }]
    },
    toasts: [],
    showToast: function (message, kind) {
      app.toasts.push([message, kind]);
    },
    setHash: function () {}
  };
  const ctx = Object.assign({ app: app }, View.data.call({ app: app }), View.methods);
  Object.entries(View.computed).forEach(function (entry) {
    Object.defineProperty(ctx, entry[0], { get: function () { return entry[1].call(ctx); } });
  });
  function call(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    return View.methods[name].apply(ctx, args);
  }
  return { window: window, app: app, ctx: ctx, prefs: prefs, call: call };
}

function snapshot(app) {
  return JSON.stringify({ maps: app.maps, assets: app.assets, sites: app.sites });
}

test('installed settings never display prototype maps, assets or positions', function () {
  const s = state(true);
  assert.equal(s.ctx.buildings.length, 0);
  assert.equal(s.ctx.assets.length, 0);
  assert.equal(s.ctx.positionedCount, 0);
  assert.equal(s.ctx.maps.prefs, s.prefs);
  assert.equal(s.app.maps.buildings[0].id, 'prototype-building');
  s.app.organizationMapSource.assets.push({ id: 'real' });
  s.app.organizationMapSource.maps.buildings.push({ id: 'real-building' });
  assert.equal(s.ctx.assets[0].id, 'real');
  assert.equal(s.ctx.buildings[0].id, 'real-building');
});

test('prototype settings preserve their existing source and preferences', function () {
  const s = state(false);
  assert.equal(s.ctx.maps, s.app.maps);
  assert.equal(s.ctx.assets, s.app.assets);
  assert.equal(s.ctx.maps.prefs, s.prefs);
  assert.equal(s.ctx.positionedCount, 1);
});

test('installed settings do not offer prototype plan presets', function () {
  const s = state(true);
  const prototypeSources = (s.window.AssetMapData.plans || []).map(function (plan) { return plan.src; });
  assert.ok(prototypeSources.length > 0, 'fixture expects bundled prototype plans');
  assert.equal(s.ctx.planPresets.length, 0);
});

test('installed settings read server coordinates instead of prototype geo', function () {
  const s = state(true);
  s.call('hydrateGeo');
  assert.equal(s.ctx.geoDraft.serverSite.lat, '-25.3');
  assert.equal(s.ctx.geoDraft.serverSite.lng, '-57.6');
  assert.equal(s.ctx.geoDraft.serverSite.address, 'Server address');
  assert.equal(s.ctx.geoDraft.protoSite, undefined);
});

test('installed settings handlers never mutate the prototype store', function () {
  const s = state(true);
  const before = snapshot(s.app);
  s.call('saveSite', 'serverSite');
  s.call('resetSite', 'serverSite');
  s.call('togglePlan', { id: 'prototype-plan', visible: true });
  s.call('setPlanOpacity', { id: 'prototype-plan' }, 0.4);
  s.call('openPlanDialog');
  s.ctx.planDialog = { open: true, name: 'New plan', floor: 'prototype-floor', kind: 'custom', src: 'data:image/svg+xml;base64,AA', error: '', busy: false };
  s.call('createPlan');
  s.call('askRemovePlan', 'prototype-plan');
  s.call('removePlan', 'prototype-plan');
  s.ctx.confirmPositions = false;
  s.call('clearPositions');
  s.call('clearPositions');
  assert.equal(snapshot(s.app), before);
  assert.equal(s.app.maps.plans.length, 1);
  assert.equal(s.app.maps.plans[0].visible, true);
  assert.equal(s.app.maps.plans[0].opacity, 0.5);
  assert.equal(s.app.maps.geo.protoSite.lat, 1);
  assert.equal(Object.keys(s.app.maps.positions).length, 1);
});

test('installed settings keep local display preferences editable', function () {
  const s = state(true);
  s.call('setPref', 'labels', false);
  s.call('setPref', 'base', 'detalle');
  assert.equal(s.app.maps.prefs.labels, false);
  assert.equal(s.app.maps.prefs.base, 'detalle');
  assert.equal(s.app.maps.prefs.cluster, false);
});

test('prototype settings keep their existing mutations', function () {
  const s = state(false);
  const siteId = Object.keys(s.window.AssetMapData.sites)[0];
  const base = s.window.AssetMapData.sites[siteId];
  s.app.sites.push({ id: siteId, label: 'Prototype site' });
  s.ctx.geoDraft[siteId] = { lat: '10', lng: '20', address: 'Edited address' };
  s.call('saveSite', siteId);
  assert.equal(s.app.maps.geo[siteId].lat, 10);
  assert.equal(s.app.maps.geo[siteId].lng, 20);
  assert.equal(s.app.maps.geo[siteId].address, 'Edited address');
  s.call('resetSite', siteId);
  assert.equal(s.app.maps.geo[siteId].lat, base.lat);
  assert.equal(s.app.maps.geo[siteId].lng, base.lng);
  s.call('togglePlan', { id: 'prototype-plan', visible: true });
  assert.equal(s.app.maps.plans[0].visible, false);
  s.call('setPlanOpacity', { id: 'prototype-plan' }, 0.3);
  assert.equal(s.app.maps.plans[0].opacity, 0.3);
  s.ctx.confirmPositions = true;
  s.call('clearPositions');
  assert.equal(Object.keys(s.app.maps.positions).length, 0);
  assert.ok(s.ctx.planPresets.length > 0);
});
