'use strict';
// A rejected request must release the busy flag, otherwise the form stays
// disabled until the page is reloaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');

function load(files) {
  const win = { ItsmI18n: { t: (key) => key } };
  const context = vm.createContext({ window: win, console, setTimeout, clearTimeout });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(JS, file), 'utf8'), context, { filename: file });
  }
  return win;
}

test('a failed monitoring profile save releases the busy flag', async () => {
  const win = load(['monitoring-settings.js']);
  const methods = win.Views.MonitoringSettings.methods;
  const self = Object.assign({}, methods, {
    canProfiles: true, busy: false, error: '', notice: '',
    profile: { category: 'ups', enabled: false, checkType: '', intervalSeconds: '', metrics: [], thresholds: {}, minimumDurationSeconds: '', exporterId: '', snmpModule: '', snmpAuthRef: '' },
    app: { updateMonitoringProfile: async () => { throw new Error('network down'); }, showToast() {} },
    selectProfile() {}, categoryName: () => ''
  });
  await assert.rejects(methods.saveProfile.call(self), /network down/);
  assert.equal(self.busy, false);
});

test('a failed maintenance plan completion releases the saving flag', async () => {
  const win = load(['maintenance-engine.js', 'maintenance-dialogs.js']);
  const methods = win.AssetMaintDialogs.PlanCompleteDialog.methods;
  const self = Object.assign({}, methods, {
    completedOn: '2026-01-02', notes: '', saving: false, error: '', planId: 'p1',
    app: { completeMaintenancePlan: async () => { throw new Error('network down'); } },
    $emit() {}
  });
  await assert.rejects(methods.save.call(self), /network down/);
  assert.equal(self.saving, false);
});
