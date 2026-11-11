'use strict';
// The favorite button label must describe the record it is attached to, not
// the state of the current target.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'assets', 'js', 'workspace-views.js');

test('a favorite row label reflects its own record, not the current target', () => {
  const win = { ItsmI18n: { t: (key) => key } };
  const context = vm.createContext({ window: win, console });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  const methods = win.AssetWorkspaceViews.WorkspaceShortcuts.methods;
  // The current target is a favorite, the row record is not.
  const self = Object.assign({}, methods, {
    active: true,
    app: { workspaceFavorites: [{ key: 'target-key' }] }
  });
  const label = self.favoriteLabel({ key: 'other-key', label: 'Other' });
  assert.equal(label, 'ui.workspace.favorite');
  const current = self.favoriteLabel({ key: 'target-key', label: 'Target' });
  assert.equal(current, 'ui.workspace.unfavorite');
});
