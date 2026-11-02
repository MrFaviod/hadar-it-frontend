'use strict';
// S3: the placeholders and failure fallbacks of the access core and the access
// views are catalog copy. They must render Spanish today and English under
// `setLocale('en')` instead of keeping a Spanish literal in the module.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function unauthorizedAccount(s) {
  const { app } = s;
  app.security.roles = [{ id: 'fixture', name: 'Fixture', permissions: [] }];
  app.security.users = [
    { id: 'u1', username: 'u1', name: 'User one', roleId: 'fixture', active: true, personId: 'missing-person' }
  ];
  app.route = { name: 'user', userId: 'u1', assetId: null, personId: null, section: null };
  app.setUserActive = () => Promise.reject(new Error(''));
  return app.security.users[0];
}

test('access.js role and person placeholders follow the active locale', () => {
  const s = setup();
  const { app, c } = s;
  assert.equal(app.roleLabel('missing-role'), 'Sin rol');
  assert.equal(app.userPersonLabel({}), 'Sin vincular');
  assert.equal(app.userPersonLabel({ personId: 'missing-person' }), 'Persona no disponible');
  c.ItsmI18n.setLocale('en');
  assert.equal(app.roleLabel('missing-role'), 'No role');
  assert.equal(app.userPersonLabel({}), 'Not linked');
  assert.equal(app.userPersonLabel({ personId: 'missing-person' }), 'Person unavailable');
});

test('access.js keeps its save-failure fallback in the active locale', async () => {
  const s = setup();
  const { app, c } = s;
  c.fetch = async () => { throw new Error(''); };
  const spanish = await app.saveRole({ name: 'Soporte', permissions: [] });
  assert.equal(spanish.ok, false);
  assert.equal(spanish.error, 'No se pudo guardar el cambio.');
  c.ItsmI18n.setLocale('en');
  const english = await app.saveRole({ name: 'Support', permissions: [] });
  assert.equal(english.ok, false);
  assert.equal(english.error, 'The change could not be saved.');
});

test('access-views person placeholders and account failure toasts follow the active locale', async () => {
  const s = setup();
  const { c } = s;
  const user = unauthorizedAccount(s);
  const mounted = s.mount('AccessUsers', { app: s.app });
  try {
    const view = mounted.instance;
    assert.equal(view.personLabel({}), 'Sin vincular');
    assert.equal(view.personLabel({ personId: 'missing-person' }), 'Persona no disponible');
    view.requestDeactivate(user);
    view.confirmDeactivate();
    await s.settle();
    assert.equal(s.app.lastToast, 'No se pudo desactivar la cuenta.');
    await view.activate(user);
    await s.settle();
    assert.equal(s.app.lastToast, 'No se pudo activar la cuenta.');
    c.ItsmI18n.setLocale('en');
    assert.equal(view.personLabel({}), 'Not linked');
    assert.equal(view.personLabel({ personId: 'missing-person' }), 'Person unavailable');
    await view.activate(user);
    await s.settle();
    assert.equal(s.app.lastToast, 'The account could not be enabled.');
  } finally {
    mounted.unmount();
  }
});

test('access-views detail failures reuse the localized account messages', async () => {
  const s = setup();
  const { c } = s;
  unauthorizedAccount(s);
  const mounted = s.mount('AccessUserDetail', { app: s.app });
  try {
    const view = mounted.instance;
    assert.ok(view.account);
    view.changeActive(false);
    await s.settle();
    assert.equal(s.app.lastToast, 'No se pudo actualizar la cuenta.');
    c.ItsmI18n.setLocale('en');
    view.changeActive(false);
    await s.settle();
    assert.equal(s.app.lastToast, 'The account could not be updated.');
  } finally {
    mounted.unmount();
  }
});
