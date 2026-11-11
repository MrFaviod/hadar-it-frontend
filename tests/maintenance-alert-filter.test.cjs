'use strict';
// The alerts tab filter must reach the engine under the key the engine reads
// (`status`). Passing `state` silently ignored the chosen filter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');
const read = (name) => fs.readFileSync(path.join(JS, name), 'utf8');

test('the alerts view passes its state filter to the engine as status', () => {
  const source = read('maintenance-views.js');
  const call = source.match(/Engine\.alertMatches\(item, this\.assets, \{([^}]*)\}\)/);
  assert.ok(call, 'alerts filter call is present');
  assert.match(call[1], /status:\s*this\.filters\.state/);
  assert.doesNotMatch(call[1], /\bstate:\s*this\.filters\.state/);
});

test('the engine filters alerts by status when given one', () => {
  const win = {};
  const context = vm.createContext({ window: win, console });
  vm.runInContext(read('maintenance-engine.js'), context, { filename: 'maintenance-engine.js' });
  const engine = win.AssetMaintEngine;
  assert.ok(engine && typeof engine.alertMatches === 'function', 'engine exposes alertMatches');
  const open = { id: 'a1', state: 'open', message: 'x', assetId: '', kind: 'warranty' };
  const closed = { id: 'a2', state: 'closed', message: 'x', assetId: '', kind: 'warranty' };
  assert.equal(engine.alertMatches(open, [], { status: 'closed' }), false);
  assert.equal(engine.alertMatches(closed, [], { status: 'closed' }), true);
});
