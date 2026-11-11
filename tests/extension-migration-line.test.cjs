'use strict';
// The migration summary line receives `from`, `to` and `state`. Its catalog
// text must use the same placeholders, or the compatibility state is dropped
// and a `{count}` token is printed literally.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const I18N = path.join(__dirname, '..', 'assets', 'i18n');

for (const locale of ['en', 'es']) {
  test(`${locale}: the migration line uses the state placeholder`, () => {
    const pack = JSON.parse(fs.readFileSync(path.join(I18N, `${locale}.json`), 'utf8'));
    const text = pack['ui.extensions.migrations.line'];
    assert.equal(typeof text, 'string');
    assert.match(text, /\{state\}/);
    assert.doesNotMatch(text, /\{count\}/);
  });
}
