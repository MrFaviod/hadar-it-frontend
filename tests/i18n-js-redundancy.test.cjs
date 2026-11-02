'use strict';
// Sweep M: the redundancy adapter resolves its member labels, dialog summaries
// and write failures through `ui.redundancy.*` at call time, so a locale switch
// changes the vocabulary without touching the server configuration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function inLocale(s, tag, run) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
  return run();
}

test('redundancy adapter copy follows the active locale', async () => {
  const s = setup();
  const can = s.app.can;
  try {
    await inLocale(s, 'es', async () => {
      assert.equal(s.app.redundancyModeLabel('active_passive'), 'Activo/pasivo');
      assert.equal(s.app.redundancyModeLabel('active_active'), 'Activo/activo');
      assert.equal(s.app.redundancyRoleLabel('primary'), 'Principal');
      assert.equal(s.app.redundancyRoleLabel('backup'), 'Respaldo');
      assert.equal(s.app.redundancyShareLabel({ share: '50.00' }), 'Reparto de carga 50.00 %');
      assert.equal(s.app.redundancyHostLabel({}), 'Sin host registrado');
      assert.equal(s.app.redundancyDraftSummary(), 'Todavía no hay réplicas en el grupo.');
      assert.equal(s.app.validateRedundancyDialog(), 'Indica un nombre para el grupo.');
      s.app.can = (permission) => permission !== 'assets.view';
      assert.equal(await s.app.loadRedundancyGroupsForAsset('asset-1'), false);
      assert.equal(s.app.redundancy.assetGroups.error, 'No tienes permisos para leer los grupos de redundancia.');
      s.app.can = can;
      s.app.redundancy.dialog.members = [{ assetId: 'a' }, { assetId: 'a' }];
      s.app.redundancy.dialog.name = 'Grupo';
      assert.equal(s.app.validateRedundancyDialog(), 'Un activo no puede repetirse en el grupo.');
      s.app.redundancy.dialog.members = [];
    });
    await inLocale(s, 'en', async () => {
      s.app.redundancy.dialog.name = '';
      s.app.redundancy.dialog.members = [];
      assert.equal(s.app.redundancyModeLabel('active_passive'), 'Active/passive');
      assert.equal(s.app.redundancyModeLabel('active_active'), 'Active/active');
      assert.equal(s.app.redundancyRoleLabel('primary'), 'Primary');
      assert.equal(s.app.redundancyRoleLabel('backup'), 'Backup');
      assert.equal(s.app.redundancyShareLabel({ share: '50.00' }), 'Load share 50.00 %');
      assert.equal(s.app.redundancyHostLabel({}), 'No registered host');
      assert.equal(s.app.redundancyDraftSummary(), 'The group has no replicas yet.');
      assert.equal(s.app.validateRedundancyDialog(), 'Enter a group name.');
      s.app.can = (permission) => permission !== 'assets.view';
      await s.app.loadRedundancyGroupsForAsset('asset-1');
      assert.equal(s.app.redundancy.assetGroups.error, 'You cannot read redundancy groups.');
      s.app.can = can;
      s.app.redundancy.dialog.members = [{ assetId: 'a' }, { assetId: 'a' }];
      s.app.redundancy.dialog.name = 'Group';
      assert.equal(s.app.validateRedundancyDialog(), 'An asset cannot appear twice in the group.');
      s.app.redundancy.dialog.members = [];
    });
    await inLocale(s, 'es', async () => {
      assert.equal(s.app.redundancyModeLabel('active_passive'), 'Activo/pasivo', 'the Spanish source copy returns');
    });
  } finally {
    s.app.can = can;
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
