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

// S3: the languages section keeps the catalog's tú convention, and the role
// line keeps its layout while both counts select their own plural form.
test('S3 the languages section copy uses the tú forms of the shipped Spanish catalog', () => {
  const expected = {
    'ui.translations.lead': 'Consulta la cobertura por idioma, exporta o importa catálogos y revisa las traducciones personalizadas.',
    'ui.translations.no_view': 'Necesitas el permiso system.view para ver las traducciones.',
    'ui.translations.missing.choose_locale': 'Elige un idioma para ver sus claves faltantes.',
    'ui.translations.import.lead': 'Pega o elige un catálogo JSON o PO. Validar no escribe nada; importar guarda en la capa personalizada, que una actualización del núcleo no borra.',
    'ui.translations.import.required': 'Elige un idioma y pega un catálogo.'
  };
  const voseo = /(?<![\wáéíóúñ])(Consultá|consultá|exportá|importá|Revisá|revisá|Necesitás|necesitás|Elegí|elegí|Pegá|pegá|Descargá|descargá|Podés|podés|Tenés|tenés|querés)(?![\wáéíóúñ])/;
  for (const key of Object.keys(expected)) {
    assert.equal(es[key], expected[key], key + ' keeps the tú form');
    assert.doesNotMatch(es[key], voseo, key + ' must not use voseo');
  }
});

// S3: the remaining languages keys that still described their limits and
// actions in voseo keep their full meaning in the catalog's tú forms.
test('S3 the remaining languages keys use the tú forms without losing their meaning', () => {
  const expected = {
    'ui.translations.read_only': 'Puedes consultar la cobertura y validar catálogos. Para importar, eliminar o restablecer hace falta system.configure.',
    'ui.translations.permission_denied': 'No tienes permiso para esta acción.',
    'ui.translations.export.lead': 'Descarga las traducciones existentes de un idioma.',
    'ui.translations.custom.orphaned_lead': 'Claves personalizadas que una actualización del núcleo dejó de servir; se conservan y puedes eliminarlas.'
  };
  const voseo = /(?<![\wáéíóúñ])(Consultá|consultá|exportá|importá|Revisá|revisá|Necesitás|necesitás|Elegí|elegí|Pegá|pegá|Descargá|descargá|Podés|podés|Tenés|tenés|querés)(?![\wáéíóúñ])/;
  for (const key of Object.keys(expected)) {
    assert.equal(es[key], expected[key], key + ' keeps the tú form');
    assert.doesNotMatch(es[key], voseo, key + ' must not use voseo');
  }
  assert.deepEqual(parameters(es['ui.translations.read_only']), [], 'the read-only limit keeps its bare permission name');
  assert.ok(es['ui.translations.read_only'].includes('system.configure'), 'the read-only limit still names the required permission');
  assert.deepEqual(parameters(es['ui.translations.custom.orphaned_lead']), [], 'the orphaned explanation declares no interpolation');
});

test('S3 the role line keeps its layout and both counts keep their own plural forms', () => {
  assert.equal(es['ui.access.role_meta'], '{permissions} · {accounts}');
  assert.equal(en['ui.access.role_meta'], '{permissions} · {accounts}');
  assert.deepEqual(parameters(es['ui.access.role_meta']), ['accounts', 'permissions']);
  assert.equal(es['ui.access.role_accounts'], '{count} cuenta | {count} cuentas');
  assert.equal(en['ui.access.role_accounts'], '{count} account | {count} accounts');
  assert.ok(context['ui.access.role_accounts'], 'context.json documents the account count');
});
