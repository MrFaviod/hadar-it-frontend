'use strict';
// Minimal catalog-backed i18n runtime for harnesses that evaluate a module
// without booting the real Vue-based glue in `assets/js/i18n.js`.
//
// The modules under test resolve their copy through `window.ItsmI18n`, and some
// harnesses (extension sandboxes, appearance engines) have no Vue renderer at
// all. This double reads the shipped catalogs and implements the same contract
// the glue documents: named `{param}` substitution, ` | ` plural forms selected
// by `count`, Spanish as the source locale and English as the second locale.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CATALOGS = {
  es: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/i18n/es.json'), 'utf8')),
  en: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/i18n/en.json'), 'utf8'))
};

function pluralIndex(locale, count) {
  const rules = new Intl.PluralRules(locale);
  const categories = rules.resolvedOptions().pluralCategories;
  return Math.max(0, categories.indexOf(rules.select(count)));
}

function translate(locale, key, params) {
  const catalog = CATALOGS[locale] || CATALOGS.es;
  const raw = catalog[key];
  if (typeof raw !== 'string') return 'Text unavailable';
  let message = raw;
  if (params && typeof params.count === 'number' && message.indexOf(' | ') !== -1) {
    const forms = message.split(' | ');
    message = forms[Math.min(pluralIndex(locale, params.count), forms.length - 1)];
  }
  return message.replace(/\{(\w+)\}/g, (match, name) => {
    if (!params || params[name] === undefined || params[name] === null) return match;
    return String(params[name]);
  });
}

/**
 * Install the double on a sandboxed `window`.
 * @param {object} window Sandboxed window object that modules read from.
 * @returns {object} The installed runtime.
 */
function install(window) {
  let locale = 'es';
  const runtime = {
    t(key, params) { return translate(locale, key, params); },
    setLocale(tag) {
      locale = CATALOGS[tag] ? tag : 'es';
      return locale;
    },
    get locale() { return locale; },
    number(value) { return new Intl.NumberFormat(locale).format(value); },
    // Vue plugin surface so templates mounted by a harness still get `$t`.
    i18n: {
      install(app) {
        app.config.globalProperties.$t = (key, params) => translate(locale, key, params);
        app.config.globalProperties.$n = (value) => new Intl.NumberFormat(locale).format(value);
      }
    }
  };
  window.ItsmI18n = runtime;
  return runtime;
}

module.exports = { install, CATALOGS, translate };
