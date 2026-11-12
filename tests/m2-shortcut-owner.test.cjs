'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('shared publication keeps visibility but only its authorized owner can mutate', () => {
  const c = vm.createContext({ URL });
  c.window = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/dashboard-preferences.js'), 'utf8'), c);
  const P = c.AssetDashboardPrefs;
  const link = { id: 'shared-1', ownerId: 'owner', name: 'Shared', url: 'https://example.test/', scope: 'shared' };
  const state = P.createState();
  state.links = [link];
  const before = JSON.stringify(state);
  assert.equal(P.linksFor(state, 'other').length, 1);
  assert.equal(P.normalizeShortcut(link, state.links, 'other', true).ok, false);
  assert.equal(P.editable(link, 'other', true), false);
  assert.equal(JSON.stringify(state), before);
  assert.equal(P.normalizeShortcut(link, state.links, 'owner', true).ok, true);
  assert.equal(P.editable(link, 'owner', true), true);
  assert.equal(P.normalizeShortcut(link, state.links, 'owner', false).ok, false);
  assert.equal(P.editable(link, 'owner', false), false);
  const personal = { ...link, scope: 'personal' };
  assert.equal(P.normalizeShortcut(personal, [personal], 'owner', false).ok, true);
  assert.equal(P.editable(personal, 'owner', false), true);
});
