'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, json, stubFetch, dto, ASSET_ID } = require('./inventory-harness.cjs');

function prepare() {
  const { c, app } = setup();
  app.authenticated = true;
  app.csrfToken = 'phase10-test-csrf';
  app.settings.anydeskEnabled = true;
  app.settings.rmmEnabled = true;
  app.inventoryDetail.asset = app.inventoryMapAsset(dto({ technical: { cpu: 'Xeon', anydeskId: '123456789', rmmAgentId: 'agent-10' } }));
  app.inventoryDetail.id = ASSET_ID;
  app.inventory.items = [app.inventoryDetail.asset];
  app.openAssetConfig(app.inventoryDetail.asset);
  return { c, app };
}

test('remote configuration survives canonical reload without losing unrelated technical values', async () => {
  const { c, app } = prepare();
  assert.equal(app.assetConfig.anydeskId, '123456789');
  assert.equal(app.assetConfig.rmmAgentId, 'agent-10');
  app.assetConfig.anydeskId = '987654321';
  app.assetConfig.rmmAgentId = 'agent-20';
  stubFetch(c, (call) => {
    assert.equal(call.init.method, 'PATCH');
    assert.equal(call.url, '/api/v1/assets/' + ASSET_ID);
    assert.deepEqual(call.body.technical, { cpu: 'Xeon', anydeskId: '987654321', rmmAgentId: 'agent-20' });
    return json(dto({ technical: call.body.technical }));
  });
  assert.equal(await app.saveAssetConfig(), true);
  const reloaded = app.inventoryMapAsset(dto({ technical: app.inventoryDetail.asset.technical }));
  assert.equal(reloaded.anydeskId, '987654321');
  assert.equal(reloaded.rmmAgentId, 'agent-20');
  assert.equal(reloaded.technical.cpu, 'Xeon');
});

test('denied remote save leaves canonical state and editor unchanged', async () => {
  const { c, app } = prepare();
  app.assetConfig.anydeskId = '987654321';
  stubFetch(c, () => json({ error: { code: 'forbidden' } }, 403));
  assert.equal(await app.saveAssetConfig(), false);
  assert.equal(app.inventoryDetail.asset.anydeskId, '123456789');
  assert.equal(app.assetConfig.open, true);
  assert.ok(app.assetConfigErrors.general);
});

test('late remote save cannot revive asset state or success after identity replacement', async () => {
  const { c, app } = prepare();
  app.assetConfig.anydeskId = '987654321';
  let resolve;
  stubFetch(c, () => new Promise((done) => { resolve = done; }));
  const pending = app.saveAssetConfig();
  app.clearInventoryState();
  app.assetConfig.open = false;
  resolve(json(dto({ technical: { anydeskId: '987654321' } })));
  assert.equal(await pending, false);
  assert.equal(app.inventoryDetail.asset, null);
  assert.equal(app.assetConfig.open, false);
});
