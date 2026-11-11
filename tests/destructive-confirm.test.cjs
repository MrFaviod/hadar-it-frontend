'use strict';
// Destructive actions that cannot be undone must take a second, explicit
// confirmation before the API is called.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');

function load(files, extra) {
  const win = Object.assign({
    ItsmI18n: { t: (key) => key },
    AssetMaintEngine: new Proxy({}, { get: () => () => ({}) }),
    ASSET_MAINT: {},
    AssetReportEngine: new Proxy({}, { get: () => () => ({}) }),
    AssetLabelEngine: new Proxy({}, { get: () => () => ({}) })
  }, extra || {});
  const context = vm.createContext({ window: win, console, Date, Math, Intl, JSON, Set, Map, Array, Object, String, Number });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(JS, file), 'utf8'), context, { filename: file });
  }
  return win;
}

function fakeApp(extra) {
  const calls = [];
  const app = Object.assign({
    maintenanceEditable: true,
    calls,
    cancelMaintenancePlan(...args) { calls.push(['cancelMaintenancePlan', args]); return Promise.resolve({ ok: true }); },
    phase9DeleteTemplate(...args) { calls.push(['phase9DeleteTemplate', args]); return Promise.resolve({ ok: true }); },
    phase9LoadTemplates() { return Promise.resolve(); },
    showToast() {}
  }, extra || {});
  return app;
}

test('plan dialog: cancelling a plan waits for a second click', async () => {
  const win = load(['maintenance-dialogs.js']);
  const methods = win.AssetMaintDialogs.PlanDialog.methods;
  const app = fakeApp();
  const self = Object.assign({}, methods, {
    plan: { id: 'p1' }, saving: false, error: '', app, confirmCancel: false,
    $emit() {}
  });
  await self.cancelPlan();
  assert.equal(app.calls.length, 0, 'first click must not cancel the plan');
  assert.equal(self.confirmCancel, true);
  await self.cancelPlan();
  assert.deepEqual(app.calls.map((c) => c[0]), ['cancelMaintenancePlan']);
});

test('maintenance table: cancelling a plan waits for a second click', async () => {
  const win = load(['maintenance-dialogs.js', 'maintenance-views.js']);
  const methods = win.AssetMaintViews.MaintenanceCenter.methods;
  const app = fakeApp();
  const row = { plan: { id: 'p1' } };
  const self = Object.assign({}, methods, { app, active: {}, pendingCancelPlanId: '' });
  self.cancelPlan(row);
  assert.equal(app.calls.length, 0, 'first click must not cancel the plan');
  assert.equal(self.pendingCancelPlanId, 'p1');
  self.cancelPlan(row);
  assert.deepEqual(app.calls.map((c) => c[0]), ['cancelMaintenancePlan']);
});

test('reports: deleting a template waits for a second click', async () => {
  const win = load(['report-views.js']);
  const methods = win.AssetReportViews.ReportsCenter.methods;
  const app = fakeApp();
  const self = Object.assign({}, methods, { app, templateId: 't1', templates: [], pendingDeleteTemplate: false, error: '', notice: '', pickInitialTemplate() {} });
  await self.removeTemplate();
  assert.equal(app.calls.length, 0, 'first click must not delete the template');
  assert.equal(self.pendingDeleteTemplate, true);
  await self.removeTemplate();
  assert.deepEqual(app.calls.map((c) => c[0]), ['phase9DeleteTemplate']);
});
