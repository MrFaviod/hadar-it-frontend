'use strict';
// A failed runtime load must not be cached: the next mount has to be able to
// try again instead of reusing the rejected promise for the page lifetime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy.ts'), 'utf8');

test('a rejected runtime load clears the cached promise', () => {
  const load = SOURCE.slice(SOURCE.indexOf('function loadRuntime'), SOURCE.indexOf('// React owns the host'));
  assert.match(load, /\.catch\(\s*\(?(error|err|e)\)?\s*=>\s*\{[^}]*ready\s*=\s*undefined[^}]*throw/s);
});
