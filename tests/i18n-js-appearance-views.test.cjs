'use strict';
// S3: the appearance settings notices, resource labels and package errors are
// catalog copy. They must render Spanish today and English under an English
// locale instead of keeping a Spanish literal in the module.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function mountSettings(locale) {
  const s = setup();
  const mounted = s.mount('AppearanceSettings', { app: s.app });
  // boot() resolves its catalog and locale payloads asynchronously and would
  // otherwise re-apply the installation default after the switch.
  await s.settle();
  if (locale) s.c.ItsmI18n.setLocale(locale);
  return { s, mounted, view: mounted.instance };
}

async function mountDialog(locale) {
  const s = setup();
  // The package dialog is a local component of the settings view, not an app-wide
  // registration, so the harness needs it registered to mount it directly.
  s.c.options.components.AppearancePackageDialog = s.c.AssetAppearanceViews.AppearancePackageDialog;
  const active = s.app.appearance.active;
  const mounted = s.mount('AppearancePackageDialog', {
    open: true, kind: 'import', presets: s.app.appearance.presets, active, current: active, app: s.app
  });
  await s.settle();
  if (locale) s.c.ItsmI18n.setLocale(locale);
  return { s, mounted, view: mounted.instance };
}

test('appearance settings notices and labels follow the active locale', async () => {
  const spanish = await mountSettings();
  try {
    const view = spanish.view;
    spanish.s.app.authenticated = false;
    view.select(spanish.s.app.appearance.presets[0]);
    assert.equal(view.notice, 'Vista previa seleccionada. Pulsa Aplicar para cambiar la identidad global.');
    view.discard();
    assert.equal(view.notice, 'Cambios sin aplicar descartados.');
    view.duplicate();
    assert.equal(view.notice, 'Copia guardada. Puedes editarla sin cambiar el preset original.');
    view.save();
    assert.equal(view.notice, 'Preset guardado en la galería de esta sesión. No se ha aplicado.');
    view.restore();
    assert.equal(view.notice, 'Se ha restaurado la identidad original de Asset Manager.');
    assert.deepEqual(Array.from(view.resourceKeys, (item) => item.label), [
      'Logotipo principal', 'Variante para modo oscuro', 'Logotipo compacto', 'Favicon'
    ]);
    spanish.s.c.ItsmI18n.setLocale('en');
    view.select(spanish.s.app.appearance.presets[0]);
    assert.equal(view.notice, 'Preview selected. Press Apply to change the global identity.');
    view.discard();
    assert.equal(view.notice, 'Unsaved changes discarded.');
    view.duplicate();
    assert.equal(view.notice, 'Copy saved. You can edit it without changing the original preset.');
    view.save();
    assert.equal(view.notice, 'Preset saved in this session gallery. It has not been applied.');
    view.restore();
    assert.equal(view.notice, 'The original Asset Manager identity has been restored.');
    assert.deepEqual(Array.from(view.resourceKeys, (item) => item.label), [
      'Primary logo', 'Dark mode variant', 'Compact logo', 'Favicon'
    ]);
  } finally {
    spanish.mounted.unmount();
  }
});

test('appearance resource and package errors follow the active locale', async () => {
  const spanish = await mountSettings();
  try {
    const view = spanish.view;
    view.resource({ target: { files: [{ type: 'text/plain', size: 10 }] } }, 'logo');
    assert.equal(view.error, 'Selecciona una imagen SVG, PNG, JPEG, WebP o ICO.');
    view.resource({ target: { files: [{ type: 'image/png', size: 4 * 1024 * 1024 }] } }, 'logo');
    assert.equal(view.error, 'La imagen supera los 2 MB. Selecciona un archivo más pequeño.');
  } finally {
    spanish.mounted.unmount();
  }
  const english = await mountSettings('en');
  try {
    const view = english.view;
    view.resource({ target: { files: [{ type: 'text/plain', size: 10 }] } }, 'logo');
    assert.equal(view.error, 'Choose an SVG, PNG, JPEG, WebP or ICO image.');
    view.resource({ target: { files: [{ type: 'image/png', size: 4 * 1024 * 1024 }] } }, 'logo');
    assert.equal(view.error, 'The image is larger than 2 MB. Choose a smaller file.');
  } finally {
    english.mounted.unmount();
  }

  const spanishDialog = await mountDialog();
  try {
    await spanishDialog.view.read({ name: 'notas.txt', size: 10 });
    assert.equal(spanishDialog.view.error, 'Selecciona un archivo ZIP de apariencia.');
    await spanishDialog.view.read({ name: 'paquete.zip', size: 30 * 1024 * 1024 });
    assert.equal(spanishDialog.view.error, 'El paquete supera el máximo de 24 MB.');
  } finally {
    spanishDialog.mounted.unmount();
  }
  const englishDialog = await mountDialog('en');
  try {
    await englishDialog.view.read({ name: 'notes.txt', size: 10 });
    assert.equal(englishDialog.view.error, 'Choose an appearance ZIP file.');
    await englishDialog.view.read({ name: 'package.zip', size: 30 * 1024 * 1024 });
    assert.equal(englishDialog.view.error, 'The package exceeds the 24 MB limit.');
  } finally {
    englishDialog.mounted.unmount();
  }
});

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textOf).join('');
}

test('appearance settings render mode, gallery and apply-bar copy from the catalog', async () => {
  const harness = setup();
  const mounted = harness.mount('AppearanceSettings', { app: harness.app });
  await harness.settle();
  try {
    let text = textOf(mounted.root);
    for (const spanish of ['Claro', 'Oscuro', 'Automático', 'Apariencia actualizada',
      'La identidad genérica siempre estará disponible.', 'Principal', 'Resumen operativo', 'Todo, en su sitio']) {
      assert.ok(text.includes(spanish), spanish + ' is missing from the Spanish settings view');
    }
    harness.c.ItsmI18n.setLocale('en');
    await harness.settle();
    text = textOf(mounted.root);
    for (const english of ['Light', 'Dark', 'Automatic', 'Appearance up to date',
      'The generic identity is always available.', 'Primary', 'Operational summary', 'Everything in place']) {
      assert.ok(text.includes(english), english + ' is missing from the English settings view');
    }
    assert.ok(!text.includes('Apariencia actualizada'), 'the Spanish apply-bar copy survived the locale switch');
  } finally {
    mounted.unmount();
  }
});

test('the appearance package dialog renders export and import copy from the catalog', async () => {
  const harness = setup();
  try {
    harness.c.options.components.AppearancePackageDialog = harness.c.AssetAppearanceViews.AppearancePackageDialog;
    const active = harness.app.appearance.active;
    const props = { open: true, presets: harness.app.appearance.presets, active, current: active, app: harness.app };
    const exported = harness.mount('AppearancePackageDialog', { ...props, kind: 'export' });
    await harness.settle();
    let text = textOf(exported.root);
    assert.ok(text.includes('Exportar apariencia'), 'the Spanish export title is missing');
    assert.ok(text.includes('Descargar ZIP'), 'the Spanish download button is missing');
    harness.c.ItsmI18n.setLocale('en');
    await harness.settle();
    text = textOf(exported.root);
    assert.ok(text.includes('Export appearance'), 'the English export title is missing');
    assert.ok(text.includes('Download ZIP'), 'the English download button is missing');
    exported.unmount();

    harness.c.ItsmI18n.setLocale('es');
    const imported = harness.mount('AppearancePackageDialog', { ...props, kind: 'import' });
    await harness.settle();
    text = textOf(imported.root);
    assert.ok(text.includes('Importar apariencia'), 'the Spanish import title is missing');
    assert.ok(text.includes('Arrastra aquí un archivo ZIP'), 'the Spanish drop-zone title is missing');
    harness.c.ItsmI18n.setLocale('en');
    await harness.settle();
    text = textOf(imported.root);
    assert.ok(text.includes('Import appearance'), 'the English import title is missing');
    assert.ok(text.includes('Drag a ZIP file here'), 'the English drop-zone title is missing');
    imported.unmount();
  } finally {
    // Components mounted above are unmounted explicitly; nothing else to release.
  }
});
