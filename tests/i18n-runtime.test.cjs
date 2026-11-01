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
