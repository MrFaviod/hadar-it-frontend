'use strict';
// Sweep M: the workspace/dashboard adapter resolves its client-side validator
// fallbacks through the catalog, not a frozen Spanish literal. The fallback only
// runs when the engine module is absent, and it must follow the active locale.
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

function withoutValidators(s) {
  const prefs = s.c.AssetDashboardPrefs;
  const workspace = s.c.AssetWorkspace;
  const savedShortcut = prefs && prefs.normalizeShortcut;
  const savedView = workspace && workspace.validateView;
  if (prefs) delete prefs.normalizeShortcut;
  if (workspace) delete workspace.validateView;
  return () => {
    if (prefs && savedShortcut) prefs.normalizeShortcut = savedShortcut;
    if (workspace && savedView) workspace.validateView = savedView;
  };
}

test('workspace validator fallbacks follow the active locale', async () => {
  const s = setup();
  const restore = withoutValidators(s);
  try {
    await inLocale(s, 'es', async () => {
      const shortcut = await s.c.AssetPhase10Api.saveShortcut(s.app, { name: 'Panel', url: '/panel' });
      assert.equal(shortcut.ok, false);
      assert.equal(shortcut.error, 'Validador de accesos no disponible.');
      const view = await s.c.AssetPhase10Api.saveView(s.app, { name: 'Vista' });
      assert.equal(view.ok, false);
      assert.equal(view.error, 'Validador de vistas no disponible.');
    });
    await inLocale(s, 'en', async () => {
      const shortcut = await s.c.AssetPhase10Api.saveShortcut(s.app, { name: 'Panel', url: '/panel' });
      assert.equal(shortcut.ok, false);
      assert.equal(shortcut.error, 'Shortcut validator unavailable.');
      const view = await s.c.AssetPhase10Api.saveView(s.app, { name: 'View' });
      assert.equal(view.ok, false);
      assert.equal(view.error, 'View validator unavailable.');
    });
    await inLocale(s, 'es', async () => {
      const view = await s.c.AssetPhase10Api.saveView(s.app, { name: 'Vista' });
      assert.equal(view.error, 'Validador de vistas no disponible.', 'the Spanish source copy returns');
    });
  } finally {
    restore();
    s.c.ItsmI18n.setLocale('es');
  }
  assert.deepEqual(s.errors, []);
});
