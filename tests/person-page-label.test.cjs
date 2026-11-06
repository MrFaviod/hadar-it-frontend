'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/app.js', 'utf8');
const start = source.indexOf('      pageLabel() {');
const end = source.indexOf('\n      },', start);
const getter = vm.runInNewContext('({' + source.slice(start, end + 8).trim() + '}).pageLabel', { tr: key => key });
test('missing person retains directory breadcrumb instead of falling through to access', () => {
  assert.equal(getter.call({ route: { name: 'person' }, currentPerson: null }), 'ui.page.people');
});
test('existing person retains its name breadcrumb', () => {
  assert.equal(getter.call({ route: { name: 'person' }, currentPerson: { name: 'Example Person' } }), 'Example Person');
});
