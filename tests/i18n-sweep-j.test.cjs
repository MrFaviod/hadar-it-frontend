'use strict';
// Sweep J: configuration, extension and appearance copy. The Vue views here are
// mounted through the shared universal harness in other suites, so this file
// covers the catalog contract, the localized runtime errors and the literal
// scanner behaviour those sweeps rely on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setup } = require('./i18n-harness.cjs');
const { countMarkup, literalTextNodes, scanRepository } = require('./i18n-literals-scanner.cjs');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = (file) => JSON.parse(read(file));

const es = json('assets/i18n/es.json');
const en = json('assets/i18n/en.json');
const descriptions = json('assets/i18n/context.json');

const SWEPT_FILES = [
  'index.html',
  'assets/js/extensions.js',
  'assets/js/appearance-api.js',
  'assets/js/appearance-engine.js',
  'assets/js/appearance-package.js',
  'assets/js/appearance-runtime.js',
  'assets/js/agent-integrations.js',
  'assets/js/report-views.js',
  'assets/js/maintenance-views.js',
  'assets/js/warranty-views.js',
  'assets/js/operations-views.js',
  'assets/js/asset-config-views.js',
  'assets/js/access-views.js',
  'assets/js/extension-frame.js'
];

function withEngine() {
  const harness = setup();
  vm.runInContext(read('assets/js/appearance-engine.js'), harness.c);
  return harness;
}

function preset(color) {
  return {
    version: 1,
    name: 'Prueba',
    branding: { appName: 'ITSM', organizationName: 'Operaciones' },
    colors: {
      light: { primary: color, secondary: '#0d766e', accent: '#a65c13' },
      dark: { primary: '#071923', secondary: '#62d4c7', accent: '#f6bf67' }
    },
    preferences: { defaultMode: 'system', compact: false }
  };
}

test('appearance validation errors follow the active language', () => {
  const { c, ItsmI18n } = withEngine();
  ItsmI18n.setLocale('es');
  assert.throws(() => c.AssetAppearanceEngine.tokens({ version: 2 }), (error) => error.message === 'Versión de preset incompatible.');
  ItsmI18n.setLocale('en');
  assert.throws(() => c.AssetAppearanceEngine.tokens({ version: 2 }), (error) => error.message === 'Incompatible preset version.');
});

test('appearance field errors interpolate the field and the localized mode', () => {
  const { c, ItsmI18n } = withEngine();
  ItsmI18n.setLocale('es');
  assert.throws(
    () => c.AssetAppearanceEngine.tokens(preset('azul')),
    /El color primary del modo claro no es válido\. Usa seis dígitos hexadecimales\./
  );
  ItsmI18n.setLocale('en');
  assert.throws(
    () => c.AssetAppearanceEngine.tokens(preset('azul')),
    /The color primary of the light mode is not valid\. Use six hexadecimal digits\./
  );
});

test('the literal scanner ignores template expressions and keeps real copy', () => {
  assert.equal(countMarkup('<span class="flow-step__num">{{ step > item.id ? \'✓\' : item.id }}</span>'), 0);
  assert.equal(countMarkup('<span>{{ $t(\'ui.access.role_meta\', { accounts: (users || []).filter((user) => user.roleId === role.id).length }) }}</span>'), 0);
  assert.equal(countMarkup('<div>${editorTemplate}</div>'), 0);
  assert.equal(countMarkup('<span>Guardar</span>'), 1);
  assert.equal(countMarkup('<span :aria-label="$t(\'ui.common.save\')">Guardar</span>'), 1);
  assert.deepEqual(literalTextNodes("{{ $t('ui.common.save') }}"), []);
});

test('every catalog key referenced by the sweep unit is translated and described', () => {
  const missing = [];
  for (const file of SWEPT_FILES) {
    for (const match of read(file).matchAll(/(?:\$t|ItsmI18n\.t|tr)\(\s*'(ui\.[A-Za-z0-9_.]+)'/g)) {
      const key = match[1];
      if (!Object.hasOwn(es, key)) missing.push(file + ' missing es ' + key);
      if (!Object.hasOwn(en, key)) missing.push(file + ' missing en ' + key);
      if (!Object.hasOwn(descriptions, key)) missing.push(file + ' missing description ' + key);
    }
  }
  assert.deepEqual(missing, []);
});

test('converted configuration, extension and appearance copy keeps the Spanish source', () => {
  assert.equal(es['ui.organization.config.sites_lead'], 'Organiza el inventario por sede y detalla las ubicaciones internas.');
  assert.equal(es['ui.organization.config.sites_delete_note'], 'Una sede o ubicación con activos o personas vinculadas no se puede eliminar. Al borrar una sede sin registros también se eliminan sus ubicaciones.');
  assert.equal(es['ui.extensions.confirm.eyebrow'], 'Confirmación humana');
  assert.equal(es['ui.extensions.result.approved'], 'El servidor confirmó la aprobación e instalación del paquete.');
  assert.equal(es['ui.appearance.runtime.applied'], 'Apariencia aplicada a toda la aplicación.');
  assert.equal(es['ui.reports.field_base_url'], 'URL base de los reportes');
  assert.equal(es['ui.maintenance.filter.all_states'], 'Todos los estados');
  assert.equal(es['ui.agents.integration_request_example'], 'python -m itsm.agent_integrations --request <ruta del archivo>');
  assert.notEqual(en['ui.extensions.confirm.eyebrow'], es['ui.extensions.confirm.eyebrow']);
  assert.notEqual(en['ui.organization.config.sites_lead'], es['ui.organization.config.sites_lead']);
  assert.equal(en['ui.agents.integration_request_example'], 'python -m itsm.agent_integrations --request <file path>');
});

test('the sweep files only keep technical and product-name literals', () => {
  const { files } = scanRepository();
  assert.equal(files['index.html'], 2);
  assert.equal(files['assets/js/extensions.js'], undefined);
  assert.equal(files['assets/js/appearance-api.js'], undefined);
  assert.equal(files['assets/js/appearance-engine.js'], undefined);
  assert.equal(files['assets/js/appearance-package.js'], undefined);
  assert.equal(files['assets/js/appearance-runtime.js'], undefined);
  assert.equal(files['assets/js/maintenance-views.js'], undefined);
  assert.equal(files['assets/js/warranty-views.js'], undefined);
  assert.equal(files['assets/js/operations-views.js'], undefined);
  assert.equal(files['assets/js/asset-config-views.js'], undefined);
  assert.equal(files['assets/js/access-views.js'], undefined);
  assert.equal(files['assets/js/extension-frame.js'], undefined);
});
