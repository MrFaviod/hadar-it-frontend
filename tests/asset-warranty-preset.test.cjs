'use strict';
// The warranty presets must pick a real calendar date in the user's local
// zone: a month offset from the 31st clamps to the last day of the target
// month instead of overflowing into the following month.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'assets', 'js', 'asset-admin.js');

// Runs the real preset method with "now" fixed to a local wall-clock time.
function presetFor(localNow, months) {
  const RealDate = Date;
  const fixed = localNow.getTime();
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(fixed); }
    static now() { return fixed; }
  }
  const win = { AssetSchema: {}, AssetStore: {}, ItsmI18n: { t: (key) => key } };
  const context = vm.createContext({ window: win, console, Date: FixedDate, Math, JSON, Object, Array, String, Number, Set, Map });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  const draft = { warranty: {} };
  const self = Object.assign({ assetEditor: { draft } }, win.AssetAdminMethods);
  self.applyAssetWarrantyPreset(months);
  return draft.warranty.until;
}

test('a 1-month warranty from Jan 31 clamps to the last day of February', () => {
  assert.equal(presetFor(new Date(2026, 0, 31, 12), 1), '2026-02-28');
});

test('the preset uses the local calendar date, not the UTC date', () => {
  // Local 00:30 on Mar 10 is still Mar 9 in UTC for zones east of UTC.
  assert.equal(presetFor(new Date(2026, 2, 10, 0, 30), 0), '2026-03-10');
});

test('a malformed warranty date is never reported as an active warranty', () => {
  const win = { AssetSchema: { formatDate: (value) => value }, AssetStore: {}, ItsmI18n: { t: (key) => key } };
  const context = vm.createContext({ window: win, console, Date, Math, JSON, Object, Array, String, Number, Set, Map });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  const state = win.AssetAdminMethods.assetWarrantyState({ warranty: { until: 'not-a-date' } });
  assert.notEqual(state.label, 'ui.asset.admin.warranty_active');
  assert.notEqual(state.tone, 'ok');
});
