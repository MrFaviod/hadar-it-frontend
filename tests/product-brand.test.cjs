'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup } = require('./inventory-harness.cjs');

test('Hadar IT is the original identity, including restore and shell fallback', () => {
  const { c, app } = setup();
  const E = c.AssetAppearanceEngine;
  const state = E.createState();
  assert.equal(state.active.branding.appName, 'Hadar IT');
  assert.equal(state.presets[0].name, 'Hadar IT');
  const custom = E.clone(state.presets[1]);
  custom.branding.appName = 'Departamento propio';
  E.applyPreset(state, custom);
  assert.equal(state.active.branding.appName, 'Departamento propio');
  E.restore(state);
  assert.equal(state.active.branding.appName, 'Hadar IT');
  app.config.general.appName = '';
  assert.equal(app.appName, 'Hadar IT');
});

test('brand copy is consistent in both locales, document metadata and startup errors', () => {
  for (const language of ['es', 'en']) {
    const catalog = JSON.parse(fs.readFileSync(`assets/i18n/${language}.json`, 'utf8'));
    assert.equal(catalog['ui.shell.brand'], 'Hadar IT');
    assert.equal(catalog['ui.shell.tagline'], 'Bring your own department.');
    assert.match(catalog['ui.appearance.restore.confirm'], /Hadar IT/);
  }
  assert.match(fs.readFileSync('index.html', 'utf8'), /<title>Hadar IT/);
  assert.match(fs.readFileSync('src/main.tsx', 'utf8'), /No se pudo iniciar Hadar IT/);
  for (const name of ['logo', 'favicon']) {
    assert.match(fs.readFileSync(`assets/svg/${name}.svg`, 'utf8'), /Hadar IT/);
  }
});
