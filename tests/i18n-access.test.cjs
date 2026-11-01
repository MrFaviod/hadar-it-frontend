'use strict';
// Transport-level i18n contract: every API request declares the active locale,
// and failures prefer the server message only when it carries a translation key.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function failure(status, payload) {
  return async () => ({ ok: false, status, json: async () => payload });
}

test('D11 every API request sends Accept-Language with the active locale', async () => {
  const s = setup();
  const { c } = s;
  await c.AssetAccess.request(s.app, '/dashboard');
  let call = s.server.calls.filter((item) => item.url === '/dashboard').pop();
  assert.equal(call.headers['Accept-Language'], 'es');
  c.ItsmI18n.setLocale('en');
  await c.AssetAccess.request(s.app, '/dashboard');
  call = s.server.calls.filter((item) => item.url === '/dashboard').pop();
  assert.equal(call.headers['Accept-Language'], 'en');
});

test('D8/D11 a translated server message wins when the envelope carries a key', async () => {
  const s = setup();
  const { c } = s;
  c.fetch = failure(422, { error: { code: 'validation_error', message: 'El nombre ya existe.', key: 'api.assets.name_taken', params: {} }, details: [] });
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/assets'),
    (error) => {
      assert.equal(error.message, 'El nombre ya existe.');
      assert.equal(error.code, 'validation_error');
      return true;
    }
  );
});

test('D8 without a key the failure keeps the translated code table', async () => {
  const s = setup();
  const { c } = s;
  c.fetch = failure(403, { error: { code: 'forbidden' } });
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/assets'),
    (error) => {
      assert.equal(error.message, 'No tienes permisos para realizar esta acción.');
      return true;
    }
  );
  c.ItsmI18n.setLocale('en');
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/assets'),
    (error) => {
      assert.equal(error.message, 'You do not have permission to perform this action.');
      return true;
    }
  );
  c.fetch = failure(418, { error: { code: 'teapot' } });
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/assets'),
    (error) => {
      assert.equal(error.message, 'The request could not be completed.');
      return true;
    }
  );
});

test('an untranslated validation failure keeps its composed reason and field errors', async () => {
  const s = setup();
  const { c } = s;
  c.fetch = failure(422, { error: { code: 'validation_error', message: 'Campos inválidos.' }, details: [{ field: 'name', message: 'Requerido' }] });
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/assets'),
    (error) => {
      assert.equal(error.message, 'El servidor rechazó la solicitud: name: Requerido');
      assert.equal(error.fieldErrors.name, 'Revisa este campo.');
      return true;
    }
  );
  c.fetch = failure(401, { error: { code: 'unauthorized' } });
  await assert.rejects(
    () => c.AssetAccess.request(s.app, '/auth/login', { method: 'POST', body: { username: 'x', password: 'y' } }),
    (error) => {
      assert.equal(error.message, 'Usuario o contraseña incorrectos.');
      return true;
    }
  );
});

test('S2 the profile selector saves the language with CSRF and applies it immediately', async () => {
  const s = setup();
  const { c, app } = s;
  app.csrfToken = 'csrf-1';
  const calls = [];
  c.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'user-1', name: 'Usuario Uno', username: 'uno', active: true },
        permissions: [],
        csrfToken: 'csrf-2',
        demoMode: false,
        locale: 'en',
        preferences: { locale: 'en' },
        installation: { defaultLocale: 'es', timezone: 'America/Asuncion', currency: 'PYG' }
      })
    };
  };
  const applied = await app.changeLocale('en');
  assert.equal(applied, true);
  const patch = calls.find((call) => call.url === '/api/v1/auth/me/preferences');
  assert.ok(patch, 'the preference is sent to the session endpoint');
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(patch.headers['Accept-Language'], 'es');
  assert.deepEqual(JSON.parse(patch.body), { locale: 'en' });
  assert.equal(c.ItsmI18n.activeLocale, 'en');
  assert.equal(c.ItsmI18n.t('ui.shell.logout'), 'Sign out');
});

test('S2 an anonymous selector change persists locally and never calls the session endpoint', async () => {
  const s = setup();
  const { c, app } = s;
  const calls = [];
  c.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    return { ok: false, status: 401, json: async () => ({ error: { code: 'unauthorized' } }) };
  };
  app.authenticated = false;
  assert.equal(await app.changeLocale('en'), true);
  assert.equal(calls.filter((call) => call.url.includes('/auth/me/preferences')).length, 0);
  assert.equal(c.localStorage.getItem('itsm.locale'), 'en');
  assert.equal(c.ItsmI18n.activeLocale, 'en');
});

test('a rejected preference keeps the current language and reports the failure', async () => {
  const s = setup();
  const { c, app } = s;
  c.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { code: 'validation_error', message: 'Idioma no admitido.' } }) });
  assert.equal(await app.changeLocale('en'), false);
  assert.equal(c.ItsmI18n.activeLocale, 'es');
  assert.equal(app.lastToast, 'El servidor rechazó la solicitud: Idioma no admitido.');
});
