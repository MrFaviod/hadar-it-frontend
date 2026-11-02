'use strict';
// The literal scanner reads `template: '…'` markup and index.html only. Copy that
// a template builds another way stays uncounted: an inline object in `v-for`, a
// ternary inside `{{ }}`, a `${}` interpolation, a markup constant interpolated
// into a template, or a concatenated markup string. This suite pins the extended
// scan so those literals reach the baseline instead of hiding.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expressionLiterals, scanHtml, scanModule, scanRepository
} = require('./i18n-literals-scanner.cjs');

test('copy inside a template expression is counted', () => {
  const markup = '<p>{{dirty?\'Hay cambios sin aplicar\':\'Apariencia actualizada\'}}</p>';
  assert.deepEqual(expressionLiterals(markup), ['Hay cambios sin aplicar', 'Apariencia actualizada']);
});

test('copy inside an inline loop item object is counted once', () => {
  const markup = '<button v-for="m in [{id:\'light\',label:\'Claro\'},{id:\'dark\',label:\'Oscuro\'}]" :key="m.id">{{m.label}}</button>';
  assert.deepEqual(expressionLiterals(markup), ['Claro', 'Oscuro']);
});

test('catalog keys, class names and identifiers are not copy', () => {
  const markup = [
    '<div :class="{\'is-dark\':mode===\'dark\'}" :aria-label="$t(\'ui.appearance.settings.mode_aria\')">',
    '<span :data-od-id="\'appearance-preset-\'+p.id">',
    '<a :title="c.label+\' \'+editMode">x</a>',
    '<b :style="{\'--sample-primary\':p.colors.light.primary}">y</b>',
    '<i :class="\'status status--\'+row.state">z</i>'
  ].join('');
  assert.deepEqual(expressionLiterals(markup), []);
});

test('a template built from a markup constant and ${} interpolation is counted', () => {
  const source = [
    'const editorTemplate = `<div><strong>Comprobante</strong><span>{{ $t(\'ui.warranty.receipt_filename\') }}</span></div>`;',
    'const Panel = { template: `<section>${editorTemplate}<p>{{ busy ? \'Cargando…\' : \'Listo\' }}</p></section>` };'
  ].join('\n');
  assert.equal(scanModule(source), 3);
});

test('a concatenated markup string is counted', () => {
  const source = 'root.innerHTML = \'<div class="kit-error" role="alert"><strong>\' + escapeText(name) + \'</strong><p>Revisa la extensión.</p></div>\';';
  assert.equal(scanModule(source), 1);
});

test('the shell counts copy in its own template expressions', () => {
  const html = '<div id="app"><p>{{ loading ? \'Cargando…\' : \'Listo\' }}</p></div><script src="assets/vendor/vue.js"></script>';
  assert.equal(scanHtml(html), 2);
});

test('the scanner keeps seeing the localized files at zero', () => {
  const report = scanRepository();
  const remaining = ['assets/js/appearance-views.js', 'assets/js/access-views.js', 'assets/js/extension-views.js']
    .filter((file) => (report.files[file] || 0) > 0)
    .map((file) => file + ': ' + report.files[file]);
  assert.deepEqual(remaining, [], 'these swept files still hold hard-coded copy');
});
