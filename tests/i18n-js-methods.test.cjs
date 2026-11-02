'use strict';
// S3/S10: the shared root methods show catalog copy for login validation and the
// asset integration dialog. Route literals stay stable identifiers.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

function configDialog(asset) {
  return { open: true, asset, anydeskId: '', rmmAgentId: '' };
}

test('login and integration errors render in both locales', async () => {
  const s = harness.setup();
  const app = s.app;
  const methods = s.c.AssetMethods;

  methods.validateLoginField.call(app, 'username');
  assert.equal(app.loginErrors.username, 'Introduce tu usuario.', 'Spanish stays the source');

  app.authenticated = true;
  app.assetConfig = configDialog(null);
  app.assetConfigErrors = { anydeskId: '', rmmAgentId: '', general: '' };
  assert.equal(await methods.saveAssetConfig.call(app), false);
  assert.equal(app.assetConfigErrors.general, 'No se ha encontrado el activo en el servidor.');

  app.assetConfig = configDialog({ id: 'x', serverAsset: {} });
  app.assetConfigErrors = { anydeskId: '', rmmAgentId: '', general: '' };
  app.can = () => false;
  assert.equal(await methods.saveAssetConfig.call(app), false);
  assert.equal(app.assetConfigErrors.general, 'Tu rol no permite modificar las integraciones del activo.');

  await switchTo(s, 'en');
  methods.validateLoginField.call(app, 'username');
  assert.equal(app.loginErrors.username, 'Enter your username.', 'the English login error is shown');
  app.assetConfig = configDialog(null);
  app.assetConfigErrors = { anydeskId: '', rmmAgentId: '', general: '' };
  await methods.saveAssetConfig.call(app);
  assert.equal(app.assetConfigErrors.general, 'The asset was not found on the server.');
  app.assetConfig = configDialog({ id: 'x', serverAsset: {} });
  app.assetConfigErrors = { anydeskId: '', rmmAgentId: '', general: '' };
  await methods.saveAssetConfig.call(app);
  assert.equal(app.assetConfigErrors.general, 'Your role cannot change the asset integrations.');

  await switchTo(s, 'es');
  methods.validateLoginField.call(app, 'username');
  assert.equal(app.loginErrors.username, 'Introduce tu usuario.', 'the Spanish error returns after the switch');
});
