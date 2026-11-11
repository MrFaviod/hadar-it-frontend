'use strict';
// Retiring an asset records the values it had before the retirement. The
// history change must not read fields that were already overwritten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');

function loadMethods() {
  const win = {
    ItsmI18n: { t: (key) => key },
    AssetSchema: { historyEntry: (kind, title, detail, extra) => Object.assign({ kind, title, detail }, extra) },
    AssetStore: {}
  };
  const context = vm.createContext({ window: win, console });
  const file = path.join(JS, 'asset-admin.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return win.AssetAdminMethods;
}

test('retiring a staffed asset records its previous status and responsible person', () => {
  const methods = loadMethods();
  const asset = {
    id: 'a1', name: 'Portátil', status: 'En uso', statusId: 'in_use', statusTone: 'ok',
    assignee: 'Ana Benítez', assigneeId: 'p1', history: [], retired: null
  };
  const self = Object.assign({}, methods, {
    retireDialog: { open: true, assetId: 'a1', reason: 'end_of_life', note: '', acknowledged: true },
    retireDialogError: '',
    assets: [asset],
    assetFinalStatus: () => ({ id: 'retired', label: 'Baja', tone: 'bad' }),
    retireReasonText: (reason) => reason,
    assetActor: () => 'Admin',
    persistAssets() {}, persistAssignments() {}, closeRetireDialog() {}, showToast() {}
  });

  methods.confirmRetire.call(self);

  const entry = asset.history[0];
  assert.equal(entry.movement, 'retired');
  const status = entry.changes.find((change) => change.field === 'statusId');
  assert.equal(status.before, 'En uso');
  assert.equal(status.after, 'Baja');
  const owner = entry.changes.find((change) => change.field === 'assigneeId');
  assert.ok(owner, 'the responsible change is recorded');
  assert.equal(owner.before, 'Ana Benítez');
  assert.equal(asset.assignee, '');
});
