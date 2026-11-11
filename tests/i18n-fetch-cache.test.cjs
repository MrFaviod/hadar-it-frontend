'use strict';
// Catalog requests must allow the browser cache and ETag revalidation; forcing
// no-store makes every language switch download the full bundle again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'i18n.js'), 'utf8');

test('i18n catalog fetches do not force no-store', () => {
  assert.doesNotMatch(src, /cache:\s*'no-store'/);
});
