'use strict';
// Restoring the default relation types can remove links that use custom
// types, so it must take a second, explicit confirmation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');

test('restoring relation types waits for a second confirmation', () => {
  let restored = 0;
  const win = {
    ItsmI18n: { t: (key) => key },
    AssetRelations: { restoreTypes() { restored += 1; return { removedLinks: 0 }; } },
    AssetRelationViews: {}
  };
  const context = vm.createContext({ window: win, console });
  const file = path.join(JS, 'relations-views.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const methods = win.AssetRelationViews.RelationsSettings.methods;
  const self = Object.assign({}, methods, {
    pendingRestore: false, blockedMessage: '', app: { showToast() {} }
  });

  self.restoreTypes();
  assert.equal(restored, 0, 'the first click only asks for confirmation');
  assert.equal(self.pendingRestore, true);

  self.restoreTypes();
  assert.equal(restored, 1);
  assert.equal(self.pendingRestore, false);
});
