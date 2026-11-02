'use strict';
// T3 close-out (S3, S10): every literal the scanner still counts is copy a
// translator cannot reach, unless it is a documented non-copy value. The
// baseline keeps the count, and this suite keeps the reason: a new literal
// without a reason fails, and a reason that no longer matches the source fails
// too, so the exemption list cannot describe code that no longer exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scanner = require('./i18n-literals-scanner.cjs');

const ROOT = path.join(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/i18n-literals-baseline.json'), 'utf8'));

function entriesFor(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return file === 'index.html' ? scanner.htmlEntries(source) : scanner.literalEntries(source);
}

test('every remaining counted literal carries a documented reason', () => {
  const undocumented = [];
  for (const file of Object.keys(baseline.files)) {
    const documented = baseline.exemptions[file] || {};
    for (const entry of entriesFor(file)) {
      if (typeof documented[entry.value] !== 'string' || !documented[entry.value].trim()) {
        undocumented.push(file + ': ' + entry.kind + ' ' + JSON.stringify(entry.value));
      }
    }
  }
  assert.deepEqual(undocumented, [], 'these literals stay hard-coded without a reason in tests/i18n-literals-baseline.json');
});

test('no documented exemption describes copy that is gone', () => {
  const stale = [];
  for (const [file, reasons] of Object.entries(baseline.exemptions)) {
    const present = new Set(entriesFor(file).map((entry) => entry.value));
    for (const value of Object.keys(reasons)) {
      if (!present.has(value)) stale.push(file + ': ' + value);
    }
  }
  assert.deepEqual(stale, [], 'these exemptions no longer match the source and must be removed');
});

test('a file with a remaining literal is listed in the baseline', () => {
  const missing = Object.keys(baseline.files).filter((file) => !baseline.exemptions[file]);
  assert.deepEqual(missing, [], 'a file with counted literals needs its exemption list');
});
