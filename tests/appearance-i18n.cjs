'use strict';
// Boots the shipped i18n runtime inside a bare vm context so the appearance
// modules under test resolve their messages through the real catalogs instead
// of a test double.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function bootAppearanceI18n(context, locale) {
  context.localStorage = {
    getItem: (key) => (key === 'itsm.locale' && locale ? locale : null),
    setItem() {},
    removeItem() {}
  };
  context.__ITSM_I18N_CATALOGS__ = {
    catalogs: {
      es: JSON.parse(read('assets/i18n/es.json')),
      en: JSON.parse(read('assets/i18n/en.json'))
    },
    context: JSON.parse(read('assets/i18n/context.json'))
  };
  context.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ revision: 1, locales: [] })
  });
  vm.runInContext(read('assets/vendor/vue.global.prod.js'), context);
  vm.runInContext(read('assets/vendor/vue-i18n.global.prod.js'), context);
  vm.runInContext(read('assets/js/i18n.js'), context);
  return context.ItsmI18n;
}

module.exports = { bootAppearanceI18n };
