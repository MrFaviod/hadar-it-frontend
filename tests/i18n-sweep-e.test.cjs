'use strict';
// T3e sweep E: monitoring, alerts, notifications and operations copy must render
// from the `ui.*` catalog. Each case mounts a real component, checks the Spanish
// source text unchanged and then switches the shipped runtime to `en`, so a
// hard-coded literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(textContent).join('');
}

async function withLocales(s, root, pair) {
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
  pair.es(textContent(root));
  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  pair.en(textContent(root));
  s.c.ItsmI18n.setLocale('es');
  await s.settle();
}

const ASSET = { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Servidor de fichajes', quickCode: 'SRV-01', code: 'SRV-01', site: 'Sede' };
const ALERT = { id: 'alert-1', alertName: 'ProbeFailed', assetName: ASSET.name, quickCode: ASSET.quickCode, severity: 'critical', state: 'firing' };

test('T3e the silence dialog renders its copy from the catalog', async () => {
  const s = setup();
  const dialog = s.mount('MonSilenceDialog', { open: true, alert: ALERT, app: s.app });
  await s.settle();
  await withLocales(s, dialog.root, {
    es: (copy) => {
      assert.match(copy, /Silenciar avisos/, 'the Spanish title is unchanged');
      assert.match(copy, /El silencio detiene las notificaciones externas/, 'the Spanish intro is unchanged');
      assert.match(copy, /Duración/, 'the Spanish field label is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Silence alerts/, 'the English title is shown');
      assert.doesNotMatch(copy, /Silenciar|Duración|Motivo/, 'no Spanish copy leaks into English');
    }
  });
  assert.deepEqual(s.errors, []);
  dialog.unmount();
});

test('T3e the alert settings page renders its copy from the catalog', async () => {
  const s = setup();
  const settings = s.mount('AlertSettings', { app: s.app });
  await s.settle();
  await withLocales(s, settings.root, {
    es: (copy) => {
      assert.match(copy, /Ventanas de mantenimiento y silencios/, 'the Spanish intro is unchanged');
      assert.match(copy, /Ventanas/, 'the Spanish tab is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Maintenance windows and silences/, 'the English intro is shown');
      assert.doesNotMatch(copy, /Ventanas de mantenimiento|Silencios/, 'no Spanish copy leaks into English');
    }
  });
  assert.deepEqual(s.errors, []);
  settings.unmount();
});

test('T3e the asset operations panel renders its copy from the catalog', async () => {
  const s = setup();
  const movements = s.mount('AssetMovements', { asset: ASSET, app: s.app });
  await s.settle();
  await withLocales(s, movements.root, {
    es: (copy) => {
      assert.match(copy, /Operaciones del activo/, 'the Spanish heading is unchanged');
      assert.match(copy, /Cada movimiento registra responsable/, 'the Spanish lead is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /Asset operations/, 'the English heading is shown');
      assert.doesNotMatch(copy, /Operaciones del activo|Movimientos/, 'no Spanish copy leaks into English');
    }
  });
  assert.deepEqual(s.errors, []);
  movements.unmount();
});

test('T3e operations amounts use the installation currency', () => {
  const s = setup();
  s.c.ItsmI18n.applySession({ installation: { currency: 'PYG', timezone: 'America/Asuncion' } });
  const asset = { id: ASSET.id, code: 'SRV-01', statusId: 'in_use', cost: 1000 };
  const context = { assets: [asset], sites: [], locations: [] };
  const rowFor = () => s.c.AssetOpsEngine.computeBulk([asset], { cost: 1500 }, context)[0];
  const cost = rowFor().changes.find((change) => change.field === 'cost');
  assert.ok(cost, 'the cost change is planned');
  assert.equal(cost.before, s.c.ItsmI18n.amount(1000), 'the before amount is formatted by the runtime');
  assert.equal(cost.after, s.c.ItsmI18n.amount(1500), 'the after amount is formatted by the runtime');
  // Without the runtime the engine must not invent a currency of its own: EUR
  // used to be hard-coded here and the installation now decides the currency.
  const runtime = s.c.ItsmI18n;
  delete s.c.ItsmI18n;
  const fallback = rowFor().changes.find((change) => change.field === 'cost');
  s.c.ItsmI18n = runtime;
  assert.doesNotMatch(String(fallback.before) + String(fallback.after), /\u20ac|EUR/, 'no hard-coded euro amount survives');
});

test('T3e monitoring status and severity labels render from the catalog', async () => {
  const s = setup();
  const pill = s.mount('MonStatusPill', { status: 'down' });
  await s.settle();
  await withLocales(s, pill.root, {
    es: (copy) => assert.equal(copy, 'No disponible', 'the Spanish status label is unchanged'),
    en: (copy) => assert.equal(copy, 'Unavailable', 'the English status label is shown')
  });
  assert.deepEqual(s.errors, []);
  pill.unmount();
});
