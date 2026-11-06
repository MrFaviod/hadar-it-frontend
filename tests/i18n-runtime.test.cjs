'use strict';
// The i18n runtime contract: catalog resolution, fallback, overlay precedence,
// installation formats and hot locale switching without losing state.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./i18n-harness.cjs');

test('D2/S5 plurals and named parameters render in Spanish and English', async () => {
  const { ItsmI18n: I } = setup();
  await I.ready;
  assert.equal(I.t('ui.shell.result_count', { count: 1 }), '1 resultado');
  assert.equal(I.t('ui.shell.result_count', { count: 5 }), '5 resultados');
  I.setLocale('en');
  assert.equal(I.t('ui.shell.result_count', { count: 1 }), '1 result');
  assert.equal(I.t('ui.shell.result_count', { count: 5 }), '5 results');
  assert.equal(I.t('ui.errors.request_rejected', { reason: 'campo inválido' }), 'The server rejected the request: campo inválido');
  assert.equal(I.t('ui.login.title'), 'Sign in');
});

test('D2 plural forms follow Intl.PluralRules categories instead of a fixed binary rule', async () => {
  const { ItsmI18n: I } = setup();
  await I.ready;
  I.i18n.global.mergeLocaleMessage('es', { 'ui.probe.many': 'uno | muchos | otros' });
  assert.equal(I.t('ui.probe.many', { count: 1 }), 'uno');
  assert.equal(I.t('ui.probe.many', { count: 5 }), 'otros');
  assert.equal(I.t('ui.probe.many', { count: 1000000 }), 'muchos');
});

test('D5 a key is never rendered: fallback chain and localized placeholder', async () => {
  const { ItsmI18n: I } = setup();
  await I.ready;
  assert.equal(I.t('ui.does.not.exist'), 'Texto no disponible');
  assert.ok(!I.t('ui.does.not.exist').includes('ui.does.not.exist'));
  assert.ok(I.misses.some((miss) => miss.key === 'ui.does.not.exist'), 'the miss is reported');
  I.i18n.global.mergeLocaleMessage('es', { 'ui.probe.spanish_only': 'Sólo en español' });
  I.setLocale('en');
  assert.equal(I.t('ui.probe.spanish_only'), 'Sólo en español');
  assert.equal(I.t('ui.does.not.exist'), 'Text unavailable');
});

test('D5 an unknown regional variant falls back to its parent language', async () => {
  const { ItsmI18n: I } = setup();
  await I.ready;
  I.i18n.global.mergeLocaleMessage('pt', { 'ui.probe.parent': 'Português' });
  assert.equal(I.setLocale('pt-BR'), 'pt-BR');
  assert.equal(I.t('ui.probe.parent'), 'Português');
  assert.equal(I.t('ui.shell.result_count', { count: 2 }), '2 resultados');
});

test('D11 overlay merge precedence is pack messages < built-in ui < overrides', async () => {
  const s = setup({
    bundles: {
      en: {
        locale: 'en',
        revision: 7,
        fallback: ['en', 'es'],
        messages: { 'ui.nav.panel': 'from pack messages', 'api.custom.notice': 'Server notice' },
        overrides: { 'ui.nav.warranties': 'Warranties (server)' }
      }
    }
  });
  const I = s.ItsmI18n;
  await I.ready;
  I.setLocale('en');
  await I.loadBundle('en');
  assert.equal(I.t('ui.nav.panel'), 'Dashboard', 'the built-in ui catalog wins over fill-only pack entries');
  assert.equal(I.t('api.custom.notice'), 'Server notice', 'non-ui namespaces pass through');
  assert.equal(I.t('ui.nav.warranties'), 'Warranties (server)', 'explicit overrides win over the built-in catalog');
});

test('D11 bundles are cached by ETag and reused on 304', async () => {
  const s = setup({ bundles: { en: { locale: 'en', revision: 7, fallback: ['en', 'es'], messages: { 'api.custom.notice': 'Server notice' }, overrides: {} } } });
  const I = s.ItsmI18n;
  await I.ready;
  I.setLocale('en');
  await I.loadBundle('en');
  await I.loadBundle('en');
  const bundleCalls = s.calls.filter((call) => call.url.includes('/i18n/bundle'));
  assert.ok(bundleCalls.length >= 2);
  assert.equal(bundleCalls[bundleCalls.length - 1].headers['If-None-Match'], '"7-en"');
  assert.equal(I.t('api.custom.notice'), 'Server notice');
});

test('D11 an anonymous language choice persists without a session and is applied on boot', async () => {
  const first = setup();
  await first.ItsmI18n.ready;
  assert.equal(first.ItsmI18n.setLocale('en', { persist: true }), 'en');
  assert.equal(first.store.get('itsm.locale'), 'en');
  const booted = setup({ locale: 'en' });
  await booted.ItsmI18n.ready;
  assert.equal(booted.ItsmI18n.activeLocale, 'en');
  assert.equal(booted.ItsmI18n.t('ui.login.title'), 'Sign in');
  assert.equal(booted.attributes.lang, 'en');
});

test('D7/D11 effective locale is user preference, then anonymous choice, then installation default', async () => {
  const s = setup({ locale: 'en' });
  const I = s.ItsmI18n;
  await I.ready;
  assert.equal(I.activeLocale, 'en', 'anonymous selection applies before login');
  I.applySession({ locale: 'es', preferences: { locale: 'es' }, installation: { defaultLocale: 'es', timezone: 'America/Asuncion', currency: 'PYG' } });
  assert.equal(I.activeLocale, 'es', 'the signed-in preference wins');
  I.applySession({ locale: 'es', preferences: { locale: null }, installation: { defaultLocale: 'es' } });
  assert.equal(I.activeLocale, 'en', 'without a preference the anonymous choice returns');
  I.clearSession();
  assert.equal(I.activeLocale, 'en');
  I.applySession({ locale: 'es', installation: { defaultLocale: 'es' } });
  assert.equal(I.activeLocale, 'en', 'the installation default never overrides an anonymous choice');

  const bare = setup({ locales: null });
  await bare.ItsmI18n.ready;
  assert.equal(bare.ItsmI18n.activeLocale, 'es', 'a missing session envelope tolerates the source locale');
  bare.ItsmI18n.applySession({ installation: { defaultLocale: 'en' } });
  assert.equal(bare.ItsmI18n.activeLocale, 'en');
  bare.ItsmI18n.applySession({});
  assert.equal(bare.ItsmI18n.activeLocale, 'en');
});

test('S2 a hot language switch re-renders templates and preserves component state', async () => {
  const s = setup();
  const I = s.ItsmI18n;
  await I.ready;
  const App = {
    data() {
      return { draft: 'texto en curso', selected: { id: 'asset-1' }, count: 2 };
    },
    template: '<div><span>{{ $t("ui.login.title") }}</span><span>{{ draft }}</span><span>{{ $t("ui.shell.result_count", { count }) }}</span></div>'
  };
  const view = s.mount(App);
  assert.equal(s.textOf(view.root), 'Iniciar sesióntexto en curso2 resultados');
  I.setLocale('en');
  await s.c.Vue.nextTick();
  assert.equal(s.textOf(view.root), 'Sign intexto en curso2 results');
  assert.equal(view.instance.draft, 'texto en curso');
  assert.deepEqual(view.instance.selected, { id: 'asset-1' });
  assert.equal(I.activeLocale, 'en');
  view.unmount();
});

test('D7 amounts use the installation currency and never the interface language', async () => {
  const s = setup();
  const I = s.ItsmI18n;
  await I.ready;
  assert.equal(I.currency, 'PYG');
  const spanish = I.amount(1500);
  I.setLocale('en');
  const english = I.amount(1500);
  assert.match(spanish, /PYG/);
  assert.match(english, /PYG/);
  assert.ok(!/[€$]/.test(spanish + english), 'no other currency leaks in');
  I.applySession({ installation: { currency: 'USD', timezone: 'UTC', defaultLocale: 'es' } });
  assert.equal(I.currency, 'USD');
  assert.match(I.amount(1500), /US\$|\$|USD/);
});

test('D7 dates use the installation timezone independently of the language', async () => {
  const s = setup();
  const I = s.ItsmI18n;
  await I.ready;
  const value = new Date('2024-01-02T02:30:00Z');
  assert.equal(I.date(value), '01/01/2024');
  I.setLocale('en');
  assert.equal(I.date(value), '01/01/2024');
  I.applySession({ installation: { timezone: 'UTC', currency: 'PYG', defaultLocale: 'es' } });
  assert.equal(I.activeLocale, 'es');
  assert.equal(I.date(value), '02/01/2024');
  I.setLocale('en');
  assert.equal(I.date(value), '01/02/2024');
  assert.equal(I.number(12345.5), '12,345.5');
});

test('existing Spanish number, date and collation behavior is unchanged', async () => {
  const s = setup();
  const I = s.ItsmI18n;
  await I.ready;
  assert.equal(I.number(12345.5), '12.345,5');
  assert.equal(I.date(new Date('2024-01-02T15:04:00Z')), '02/01/2024');
  assert.equal(I.datetime(new Date('2024-01-02T15:04:00Z')), '02/01/2024, 12:04');
  assert.equal(I.date(Date.parse('2024-01-02T15:04:00Z'), { day: '2-digit', month: 'short', year: 'numeric' }), '02 ene 2024');
  assert.equal(I.collator({ sensitivity: 'base' }).compare('Ávila', 'avila'), 0);
  assert.equal(I.amount(null), '—');
});

test('people directory stat labels agree with the count they describe', async () => {
  const { ItsmI18n: I } = setup();
  await I.ready;
  const expected = {
    es: {
      'ui.people.stat_total': ['Personas registradas', 'Persona registrada', 'Personas registradas'],
      'ui.people.stat_active': ['Personas activas', 'Persona activa', 'Personas activas']
    },
    en: {
      'ui.people.stat_total': ['Registered people', 'Registered person', 'Registered people'],
      'ui.people.stat_active': ['Active people', 'Active person', 'Active people']
    }
  };
  for (const locale of ['es', 'en']) {
    I.setLocale(locale);
    for (const key of Object.keys(expected[locale])) {
      [0, 1, 2].forEach((count) => {
        const message = I.t(key, { count });
        assert.equal(message, expected[locale][key][count], locale + ' ' + key + ' for count ' + count);
        assert.ok(!/\d/.test(message), locale + ' ' + key + ' must not repeat the number');
      });
    }
  }
  I.setLocale('es');
});

// S3: the role line in Security composes two independent counts. Each count
// selects its own plural form from the shipped catalog, so 0/1/2 permissions
// and 0/1/2 accounts must agree with the number they describe in both locales.
const { setup: setupViews } = require('./universal-harness.cjs');

function roleRowLines(root) {
  const lines = [];
  const walk = (node) => {
    if (!node) return;
    const classes = node.props && node.props.class ? String(node.props.class).split(' ') : [];
    if (classes.includes('role-row__copy')) {
      const small = (node.children || []).find((child) => child.tag === 'small');
      lines.push(small ? String(small.text || '').trim() : null);
    }
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return lines;
}

test('S3 the Security role line pluralizes permission and account counts independently', async () => {
  const pairs = [[0, 0], [0, 2], [1, 0], [1, 1], [2, 1], [2, 2]];
  const expected = {
    es: [
      '0 permisos · 0 cuentas',
      '0 permisos · 2 cuentas',
      '1 permiso · 0 cuentas',
      '1 permiso · 1 cuenta',
      '2 permisos · 1 cuenta',
      '2 permisos · 2 cuentas'
    ],
    en: [
      '0 permissions · 0 accounts',
      '0 permissions · 2 accounts',
      '1 permission · 0 accounts',
      '1 permission · 1 account',
      '2 permissions · 1 account',
      '2 permissions · 2 accounts'
    ]
  };
  const s = setupViews();
  await s.c.ItsmI18n.ready;
  s.app.security.roles = pairs.map(([permissions], index) => ({
    id: 'role-' + index,
    name: 'Role ' + index,
    permissions: Array.from({ length: permissions }, (unused, slot) => 'probe.' + slot),
    builtIn: false
  }));
  const users = [];
  pairs.forEach(([, accounts], index) => {
    for (let slot = 0; slot < accounts; slot += 1) {
      users.push({ id: 'user-' + index + '-' + slot, name: 'User', roleId: 'role-' + index });
    }
  });
  s.app.security.users = users;
  const mounted = s.mount('AccessSecurity', { app: s.app });
  try {
    for (const locale of ['es', 'en']) {
      await s.c.ItsmI18n.setLocale(locale);
      await s.settle();
      assert.deepEqual(roleRowLines(mounted.root), expected[locale], locale + ' role lines');
    }
  } finally {
    mounted.unmount();
  }
});
