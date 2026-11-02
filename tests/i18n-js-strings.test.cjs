'use strict';
// Sweep L guard: human-visible copy must live in the catalogs, including the
// strings a Vue template never holds. The existing literal scanner only reads
// the `index.html` shell and `template:` markup, so module-level label maps such
// as `JOB_LABELS` or a `throw new Error('…')` reached the user untranslated.
//
// This scanner reads the JavaScript of every `assets/js/*.js` module, drops
// comments, regular expressions and markup templates, and flags string literals
// that still carry Spanish copy. The heuristic is deliberately conservative: it
// prefers a visible gap it can explain over guessing about valid technical text.
//
// Exclusions, each with the reason recorded in DEMO_DATA_FILES:
//   - prototype demo datasets that are fixture content, not product copy;
//   - catalog keys and the `tr('…')`/`t('…')`/`$t('…')` arguments that resolve
//     them (those are keys, not copy);
//   - `template:` literals and markup, which `tests/i18n-literals-*.cjs` owns.
//
// Regenerate the allowlist after converting a file:
//   node tests/i18n-js-strings.test.cjs --write
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_DIR = path.join(ROOT, 'assets', 'js');
const BASELINE_PATH = path.join(__dirname, 'i18n-js-strings-baseline.json');

// Files that hold fixture content instead of interface copy. Only these may be
// skipped, and each one needs its reason here so the exclusion stays reviewable.
const DEMO_DATA_FILES = {
  'data.js': 'Prototype demo inventory dataset seeded into localStorage, not product copy.',
  'map-data.js': 'Demo site, building and floor-plan catalog used by the prototype map.',
  'monitoring-data.js': 'Demo monitoring series and sample assets for the prototype dashboard.',
  'maintenance-data.js': 'Demo maintenance plans, windows and history for the prototype views.',
  'relations-data.js': 'Demo relationship types and seeded links for the prototype graph.',
  'transfer-data.js': 'Demo import rows and export fixtures for the prototype transfer flow.'
};

// Literals the heuristic reads as Spanish words but that never render: they are
// stable route hashes and generated identifiers. Each entry needs its reason,
// and an entry that stops matching the source fails the audit below.
const NON_COPY_LITERALS = {
  'dashboard-model.js': {
    '#/supervision/alerta/': 'Route hash prefix of the monitoring alert view; routes are stable ids.',
    '#/mantenimiento/incidente/': 'Route hash prefix of the maintenance incident view; routes are stable ids.'
  },
  'maintenance-views.js': {
    '#/mantenimiento/incidente/': 'Route hash prefix of the maintenance incident view; routes are stable ids.',
    '#/supervision/alerta/': 'Route hash prefix of the monitoring alert view; routes are stable ids.'
  },
  'maintenance-panels.js': {
    '#/mantenimiento/incidente/': 'Route hash prefix of the maintenance incident view; routes are stable ids.'
  },
  'transfer-export-views.js': {
    '#/datos/importar': 'Route hash of the import view; routes are stable ids.',
    '#/datos/exportar': 'Route hash of the export view; routes are stable ids.'
  },
  'graph-views.js': {
    '#/infra/mapa/activo/': 'Route hash prefix of the infrastructure map focused on one asset; routes are stable ids.'
  },
  'map-engine.js': {
    '-sin-sala': 'Suffix of the generated room id used when a floor has no rooms; it is never displayed.'
  }
};

// Words that only exist in Spanish interface copy. `WIDE_WORDS` is the broad
// function-word list; two of them in one string is already conclusive.
const WIDE_WORDS = new Set((
  'de del la las los el un una unos unas para con sin por que al en es son este esta estos estas ' +
  'más muy todo toda todos todas desde hasta entre cuando donde sobre debe deben puede pueden no se ' +
  'su sus también solo cada otro otra ahora antes después aquí así hay está están será sería tiene ' +
  'tienen lo le les mi mis tu tus'
).split(' '));

// A single hit from this list is enough when the string is more than one word,
// because none of these words are English.
const SPANISH_WORDS = new Set((
  'de del las los para con sin por que una desde hasta entre cuando donde sobre debe deben puede ' +
  'pueden todos todas también está están más según después aquí así tiene tienen sería generando ' +
  'completado eliminada eliminado guardada guardado servidor extensión plantilla eliminar cancelar ' +
  'buscar cargar activos activo estado estados permiso usuario usuarios archivo imagen fecha nombre ' +
  'código categoría ubicación apariencia incidente alerta supervisión datos cola errores réplica ' +
  'réplicas falta faltan'
).split(' '));

const SPANISH_CHARS = /[áéíóúüñ¿¡]/i;
const CATALOG_KEY = /^(ui|api|ext)\.[\w.-]+$/;
const TRANSFER_CALL = /(?:^|[^\w$.])(?:tr|t|\$t)\s*\(\s*$/;
const MARKUP_TEMPLATE = /<\/?[a-z][\w-]*[\s>/]/i;
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|throw|yield|await|do|else|instanceof)\s*$/;
const GERUND_OR_PARTICIPLE = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(ando|iendo|ado|ada)$/;

function decodeEscape(source, index) {
  const marker = source[index + 1];
  if (marker === 'n') return ['\n', index + 2];
  if (marker === 't') return ['\t', index + 2];
  if (marker === 'r') return ['\r', index + 2];
  if (marker === 'u' && source[index + 2] === '{') {
    const end = source.indexOf('}', index + 3);
    return [String.fromCodePoint(parseInt(source.slice(index + 3, end), 16)), end + 1];
  }
  if (marker === 'u') return [String.fromCharCode(parseInt(source.slice(index + 2, index + 6), 16)), index + 6];
  if (marker === 'x') return [String.fromCharCode(parseInt(source.slice(index + 2, index + 4), 16)), index + 4];
  return [marker === undefined ? '' : marker, index + 2];
}

// Split a template literal into its copy and the code of its interpolations.
// Interpolations become `{…}` placeholders so a sentence such as
// `Falta ${name}.` still reads as one message, while the interpolated code is
// scanned as code and not as copy.
function splitTemplate(value) {
  let text = '';
  const code = [];
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('${', index);
    if (start < 0) {
      text += value.slice(index);
      break;
    }
    let depth = 0;
    let quote = '';
    let cursor = start;
    let closed = false;
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth <= 0) {
          closed = true;
          cursor += 1;
          break;
        }
      }
    }
    if (!closed) {
      text += value.slice(start);
      break;
    }
    text += value.slice(index, start) + '{…}';
    code.push(value.slice(start + 2, cursor - 1));
    index = cursor;
  }
  return { text, code };
}

function literalIsRegexStart(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  const character = source[cursor];
  if ('=(,:!&|?{};+-*%<>~^['.includes(character)) return true;
  if (!/[\w$]/.test(character)) return false;
  return REGEX_KEYWORDS.test(source.slice(Math.max(0, index - 30), index));
}

function readLiterals(source, lineBase) {
  const literals = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === '/' && literalIsRegexStart(source, index)) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length) {
        const next = source[cursor];
        if (next === '\\') {
          cursor += 2;
          continue;
        }
        if (next === '[') inClass = true;
        else if (next === ']') inClass = false;
        else if (next === '/' && !inClass) {
          cursor += 1;
          break;
        } else if (next === '\n') break;
        cursor += 1;
      }
      while (cursor < source.length && /[a-z]/.test(source[cursor])) cursor += 1;
      index = cursor;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      const start = index;
      let value = '';
      index += 1;
      while (index < source.length) {
        const next = source[index];
        if (next === '\\') {
          const [decoded, resume] = decodeEscape(source, index);
          value += decoded;
          index = resume;
          continue;
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      literals.push({
        value,
        quote,
        line: lineBase + source.slice(0, start).split('\n').length,
        before: source.slice(Math.max(0, start - 40), start)
      });
      continue;
    }
    index += 1;
  }
  return literals;
}

/**
 * Collect every string literal of a module that is not markup or a catalog call.
 * @param {string} source Module source.
 * @returns {{value: string, line: number, quote: string}[]} Candidate literals.
 */
function moduleLiterals(source) {
  const found = [];
  const walk = (code, lineBase) => {
    for (const literal of readLiterals(code, lineBase)) {
      if (/template\s*:\s*$/.test(literal.before)) continue;
      if (literal.quote === '`' && literal.value.includes('${')) {
        const parts = splitTemplate(literal.value);
        if (!MARKUP_TEMPLATE.test(parts.text)) {
          found.push({ value: parts.text, line: literal.line, before: literal.before });
        }
        parts.code.forEach((chunk) => walk(chunk, literal.line));
        continue;
      }
      if (literal.quote === '`' && MARKUP_TEMPLATE.test(literal.value)) continue;
      found.push({ value: literal.value, line: literal.line, before: literal.before });
    }
  };
  walk(source, 0);
  return found;
}

function isTechnical(value) {
  if (CATALOG_KEY.test(value)) return true;
  if (value === 'use strict') return true;
  if (/^[a-z][a-z0-9_.\-/:#?=&%+@$]*$/.test(value)) return true;
  if (/[{};]/.test(value) && /:/.test(value)) return true;
  if (/^[.#][\w-]+(\s|,|$)/.test(value)) return true;
  if (MARKUP_TEMPLATE.test(value)) return true;
  return false;
}

/**
 * Conservative Spanish-copy heuristic.
 * @param {string} value Trimmed literal value.
 * @returns {boolean} True when the literal is plausibly Spanish interface copy.
 */
function looksSpanish(value) {
  if (SPANISH_CHARS.test(value)) return true;
  // A `{…}` placeholder stands in for an interpolation: it keeps a single-word
  // message such as `Falta {…}.` readable as a sentence.
  const words = value.toLowerCase().replace(/\{…\}/g, ' item ').match(/[a-záéíóúüñ]+/g) || [];
  if (!words.length) return false;
  const wide = new Set();
  const direct = new Set();
  words.forEach((word) => {
    if (WIDE_WORDS.has(word)) wide.add(word);
    if (SPANISH_WORDS.has(word)) direct.add(word);
  });
  if (wide.size >= 2) return true;
  if (direct.size >= 1 && words.length >= 2) return true;
  if (words.length === 1 && GERUND_OR_PARTICIPLE.test(value)) return true;
  return false;
}

function isCandidate(literal) {
  const value = literal.value.trim();
  if (!value) return false;
  if (TRANSFER_CALL.test(literal.before)) return false;
  if (isTechnical(value)) return false;
  return looksSpanish(value);
}

/**
 * Scan one module source.
 * @param {string} source Module source.
 * @returns {{line: number, value: string}[]} Spanish literals found.
 */
function scanSource(source) {
  return moduleLiterals(source)
    .filter(isCandidate)
    .map((literal) => ({ line: literal.line, value: literal.value.trim() }));
}

function listModules() {
  return fs.readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.js') && !DEMO_DATA_FILES[name])
    .sort();
}

/**
 * Scan every module that is not an excluded demo dataset.
 * @param {{includeNonCopy?: boolean}} [options] Keep allowlisted non-copy literals.
 * @returns {{files: Record<string, number>, hits: Record<string, {line: number, value: string}[]>, total: number}}
 */
function scanTree(options) {
  const includeNonCopy = !!(options && options.includeNonCopy);
  const files = {};
  const hits = {};
  let total = 0;
  for (const name of listModules()) {
    const allowed = NON_COPY_LITERALS[name] || {};
    const found = scanSource(fs.readFileSync(path.join(MODULE_DIR, name), 'utf8'))
      .filter((hit) => includeNonCopy || !allowed[hit.value]);
    if (!found.length) continue;
    files[name] = found.length;
    hits[name] = found;
    total += found.length;
  }
  return { files, hits, total };
}

function readBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

/**
 * Compare the current scan with a baseline that may only shrink.
 * @param {{files: Record<string, number>}} current Current per-file counts.
 * @param {{files: Record<string, number>}} baseline Allowed per-file counts.
 * @returns {{grew: string[], added: string[]}} Regressions found.
 */
function compare(current, baseline) {
  const grew = [];
  const added = [];
  for (const [file, count] of Object.entries(current.files)) {
    if (!(file in baseline.files)) added.push(`${file} (${count})`);
    else if (count > baseline.files[file]) grew.push(`${file} (${baseline.files[file]} -> ${count})`);
  }
  return { grew, added };
}

if (require.main === module && process.argv.includes('--write')) {
  const scan = scanTree();
  const ordered = {};
  Object.keys(scan.files).sort().forEach((file) => {
    ordered[file] = scan.files[file];
  });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({
    note: 'Spanish JavaScript string literals outside templates, per module. Regenerate with `node tests/i18n-js-strings.test.cjs --write`; entries may only shrink and are removed when a file reaches zero.',
    demo_data_exclusions: DEMO_DATA_FILES,
    total: scan.total,
    files: ordered
  }, null, 2)}\n`);
  process.stdout.write(`i18n-js-strings baseline: ${scan.total} literals in ${Object.keys(ordered).length} files\n`);
} else {
  test('the heuristic separates copy from keys, markup and identifiers', () => {
    const sample = [
      "const LABELS = { queued: 'En cola', failed: 'Con errores' };",
      "throw new Error('La ruta del módulo no es válida.');",
      'const label = tr(\'ui.reports.job_queued\');',
      'const markup = \'<span class="pill">{{ label }}</span>\';',
      'const state = \'in_use\';',
      '// Sin datos. is a comment, not copy',
      'const shifted = `Falta ${name}.`;',
      'const sentence = `La extensión ${id} ya no está activa.`;'
    ].join('\n');
    const found = scanSource(sample).map((hit) => hit.value);
    assert.deepEqual(found, [
      'En cola',
      'Con errores',
      'La ruta del módulo no es válida.',
      'Falta {…}.',
      'La extensión {…} ya no está activa.'
    ]);
  });

  test('no module adds Spanish copy outside templates', () => {
    const baseline = readBaseline();
    const scan = scanTree();
    const { grew, added } = compare(scan, baseline);
    assert.deepEqual(grew, [], 'a file gained hard-coded Spanish; move the copy to a catalog key');
    assert.deepEqual(added, [], 'a new file contains hard-coded Spanish; add it to the catalogs instead');
    assert.ok(scan.total <= baseline.total, `total Spanish literals grew: ${baseline.total} -> ${scan.total}`);
  });

  test('the converted modules carry no Spanish JavaScript strings', () => {
    const scan = scanTree();
    for (const file of ['report-views.js', 'extension-frame.js']) {
      const found = scan.hits[file] || [];
      assert.deepEqual(
        found.map((hit) => `${file}:${hit.line} ${hit.value}`),
        [],
        `${file} must resolve its copy through the catalogs`
      );
    }
  });

  test('the allowlist documents every exclusion and only shrinks', () => {
    const baseline = readBaseline();
    assert.equal(typeof baseline.note, 'string');
    for (const [file, reason] of Object.entries(baseline.demo_data_exclusions)) {
      assert.ok(reason.length > 20, `${file} needs a real exclusion reason`);
      assert.ok(fs.existsSync(path.join(MODULE_DIR, file)), `${file} must still exist`);
      assert.ok(!(file in baseline.files), `${file} is excluded and must not be counted`);
    }
    assert.deepEqual(Object.keys(baseline.demo_data_exclusions).sort(), Object.keys(DEMO_DATA_FILES).sort());
    for (const [file, count] of Object.entries(baseline.files)) {
      assert.ok(Number.isInteger(count) && count > 0, `${file} needs a positive count`);
      assert.ok(fs.existsSync(path.join(MODULE_DIR, file)), `${file} no longer exists; drop its baseline entry`);
    }
  });

  test('the non-copy allowlist names literals that exist and never render', () => {
    const all = scanTree({ includeNonCopy: true });
    const current = scanTree();
    for (const [file, entries] of Object.entries(NON_COPY_LITERALS)) {
      assert.ok(fs.existsSync(path.join(MODULE_DIR, file)), `${file} must still exist`);
      const seen = new Set(((all.hits || {})[file] || []).map((hit) => hit.value));
      for (const [literal, reason] of Object.entries(entries)) {
        assert.ok(reason.length > 20, `${file}: ${literal} needs a real reason`);
        assert.ok(seen.has(literal), `${file}: ${literal} no longer exists; drop the entry`);
        assert.ok(!((current.hits || {})[file] || []).some((hit) => hit.value === literal), `${file}: ${literal} is still counted as copy`);
      }
    }
  });
}

module.exports = { scanSource, scanTree, compare, looksSpanish, DEMO_DATA_FILES, NON_COPY_LITERALS, BASELINE_PATH };
