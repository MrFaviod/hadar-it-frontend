'use strict';
// Legacy runtime scripts download in parallel but execute in document order,
// and the OpenDesign HTML is parsed once instead of once per mount.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy.ts'), 'utf8');

test('runtime scripts are inserted in parallel with async=false', () => {
  assert.match(src, /script\.async = false/);
  assert.match(src, /Promise\.all\(/);
  assert.doesNotMatch(src, /for \(const element of[\s\S]*await new Promise/);
});

test('the OpenDesign HTML is parsed once and reused by mount', () => {
  const parses = src.match(/new DOMParser\(\)\.parseFromString\(original/g) || [];
  assert.equal(parses.length, 1, 'expected a single DOMParser parse of the original HTML');
});
