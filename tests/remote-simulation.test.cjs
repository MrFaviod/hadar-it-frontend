'use strict';
// The remote dialog never opens a real session. Finishing its simulation must
// not claim that a connection was made.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'assets', 'js', 'methods.js');

test('finishing the remote simulation reports unavailable, not connected', () => {
  let scheduled = null;
  const win = {
    AssetStore: { KEYS: {} },
    ItsmI18n: { t: (key) => key },
    setTimeout: (fn) => { scheduled = fn; return 1; },
    clearTimeout() {}
  };
  const context = vm.createContext({ window: win, console });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  const self = Object.assign({
    remoteDialog: { open: true, state: 'idle' },
    remoteTimer: null
  }, win.AssetMethods);
  self.simulateRemote();
  assert.equal(self.remoteDialog.state, 'connecting');
  scheduled();
  assert.notEqual(self.remoteDialog.state, 'connected', 'the simulation must not report a connection');
  assert.equal(self.remoteDialog.state, 'unavailable');
});
