'use strict';
// The boot-failure path runs before any wizard translator exists, so it carries
// its own two-line fallback. This test pins the two properties that keep it
// safe: the catalogs own the copy, and the rendered path never prints the
// host's error text (which can name internal paths or tokens).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

function catalog(locale) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets', 'i18n', `${locale}.json`), 'utf8'));
}

test('the boot failure never renders the host error text', () => {
  assert.ok(!/[{>]\s*error\.message/.test(source), 'the host error text is rendered somewhere');
  assert.match(source, /data-boot-failure/);
  assert.match(source, /ui\.setup\.boot\.title/);
});

test('both catalogs carry the boot copy', () => {
  for (const locale of ['es', 'en']) {
    const copy = catalog(locale);
    for (const key of ['ui.setup.boot.title', 'ui.setup.boot.body', 'ui.setup.boot.retry']) {
      assert.equal(typeof copy[key], 'string', `${locale} is missing ${key}`);
      assert.ok(copy[key].trim().length > 0, `${locale} has an empty ${key}`);
    }
  }
});

test('the inline fallback is chosen by the document language', () => {
  assert.match(source, /document\.documentElement\.lang/);
  assert.match(source, /startsWith\('en'\)/);
});
