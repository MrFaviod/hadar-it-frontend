'use strict';
// Every catalog key the asset schema reads must exist in both packs and in the
// context file, or the UI shows the raw key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'asset-schema.js'), 'utf8');
const keys = [...new Set(schema.match(/'ui\.asset\.schema\.[a-z0-9_.]+'/g).map((item) => item.slice(1, -1)))];

test('the asset schema reads at least one catalog key', () => {
  assert.ok(keys.length > 0);
});

for (const file of ['en.json', 'es.json', 'context.json']) {
  test(`${file} defines every asset schema key`, () => {
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'i18n', file), 'utf8'));
    const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(pack, key));
    assert.deepEqual(missing, []);
  });
}
