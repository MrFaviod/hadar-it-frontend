'use strict';
// D2/D3 catalog rules: one flat key format, complete es/en parity, a usage note
// per key, and no rendered key that the source catalog does not declare.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const es = readJson('assets/i18n/es.json');
const en = readJson('assets/i18n/en.json');
const context = readJson('assets/i18n/context.json');

function parameters(message) {
  const names = new Set();
  const pattern = /\{([a-zA-Z0-9_]+)\}/g;
  let match;
  while ((match = pattern.exec(message))) names.add(match[1]);
  return Array.from(names).sort();
}

function pluralForms(message) {
  return message.split(' | ').length;
}

function sourceFiles() {
  const directory = path.join(ROOT, 'assets/js');
  const files = ['index.html'];
  for (const entry of fs.readdirSync(directory).sort()) if (entry.endsWith('.js')) files.push('assets/js/' + entry);
  return files;
}

function usedKeys() {
  const used = new Map();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const pattern = /(?:\$t|ItsmI18n\.t|ItsmI18n\.te)\(\s*(['"])([^'"]+)\1/g;
    let match;
    while ((match = pattern.exec(source))) {
      if (match[2].includes('${') || match[2].includes('+')) continue;
      used.set(match[2], file);
    }
  }
  return used;
}

test('D3 Spanish and English declare exactly the same keys', () => {
  const spanish = Object.keys(es).sort();
  const english = Object.keys(en).sort();
  assert.deepEqual(spanish.filter((key) => !(key in en)), [], 'keys missing from en.json');
  assert.deepEqual(english.filter((key) => !(key in es)), [], 'keys missing from es.json');
  assert.deepEqual(english, spanish);
});

test('D2 every key follows the flat dotted ui.* format with a stable namespace', () => {
  for (const key of Object.keys(es)) {
    assert.match(key, /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/, key + ' is not a flat dotted key');
    assert.ok(key.startsWith('ui.'), key + ' is not a frontend ui.* key');
    assert.equal(typeof es[key], 'string');
    assert.ok(es[key].trim().length > 0, key + ' has an empty Spanish message');
    assert.ok(en[key].trim().length > 0, key + ' has an empty English message');
  }
});

test('D2 parameters and plural form counts match between es and en', () => {
  for (const key of Object.keys(es)) {
    assert.deepEqual(parameters(en[key]), parameters(es[key]), key + ' declares different parameters');
    assert.equal(pluralForms(en[key]), pluralForms(es[key]), key + ' declares a different number of plural forms');
  }
});

test('D3 every key documents its usage in context.json and no note is orphaned', () => {
  for (const key of Object.keys(es)) {
    assert.equal(typeof context[key], 'string', key + ' has no context note');
    assert.ok(context[key].trim().length >= 20, key + ' context note is too short to guide a translator');
  }
  assert.deepEqual(Object.keys(context).filter((key) => !(key in es)), [], 'context.json documents unknown keys');
});

test('D5 every key used by the frontend exists in the source catalog', () => {
  const used = usedKeys();
  const missing = Array.from(used.entries()).filter(([key]) => !(key in es)).map(([key, file]) => key + ' (' + file + ')');
  assert.deepEqual(missing, [], 'these rendered keys are not in assets/i18n/es.json');
});

test('D5 keys are never assembled at runtime', () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const pattern = /(?:\$t|ItsmI18n\.t)\(\s*['"][^'"]*['"]\s*\+/g;
    if (pattern.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'use a literal key per branch instead of concatenating catalog keys');
});
