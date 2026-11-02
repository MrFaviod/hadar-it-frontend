'use strict';
// Module-local helpers (`tr`, `T`, `t`, `translate`, `label`) wrap
// `window.ItsmI18n.t`, so their first literal argument is a catalog key that the
// `$t(...)`/`ItsmI18n.t(...)` usage scan in `i18n-catalogs.test.cjs` never reads.
// This module extracts those keys so a missing translation fails a test instead
// of reaching the user as the runtime's "text unavailable" fallback.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// `(?<![\w$.])` keeps `$t(...)`, `ItsmI18n.t(...)` and `object.t(...)` out of the
// helper scan: those calls are already covered by the catalog usage test.
const HELPER_CALL = /(?<![\w$.])(tr|T|t|translate|label)\s*\(\s*(['"])(ui\.[^'"]*)\2/g;

/**
 * Literal catalog keys passed to a module-local translation helper.
 * @param {string} source JavaScript or HTML source.
 * @returns {Array<{key: string, helper: string, index: number}>}
 */
function helperKeys(source) {
  const found = [];
  HELPER_CALL.lastIndex = 0;
  let match;
  while ((match = HELPER_CALL.exec(source))) {
    const key = match[3];
    // Assembled keys are a separate rule (a literal key per branch); counting
    // them here would report a non-existent key instead of their real defect.
    if (key.includes('${') || key.includes('+')) continue;
    found.push({ helper: match[1], key, index: match.index });
  }
  return found;
}

function sourceFiles() {
  const directory = path.join(ROOT, 'assets/js');
  const files = ['index.html'];
  for (const entry of fs.readdirSync(directory).sort()) if (entry.endsWith('.js')) files.push('assets/js/' + entry);
  return files;
}

/**
 * Every helper-rendered key in the frontend and the files that use it.
 * @returns {Map<string, Set<string>>}
 */
function scanRepository() {
  const used = new Map();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const entry of helperKeys(source)) {
      if (!used.has(entry.key)) used.set(entry.key, new Set());
      used.get(entry.key).add(file);
    }
  }
  return used;
}

module.exports = { helperKeys, scanRepository, sourceFiles, ROOT };
