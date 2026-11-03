'use strict';
// T4 dashboard distillation: maintenance planning states arrive from the
// dashboard service as stable identifiers (`overdue`, `upcoming`, `pending`)
// and their tone as a service token (`danger`, `warn`, `normal`). The panel
// displays them, so the model must resolve the shipped Spanish/English labels
// and the pill tone the application already styles, without inventing a
// translation for an identifier the catalog does not know.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const PLANS = [
  { planId: 'p1', assetId: 'a1', assetName: 'Servidor Central', assetCode: 'SRV-1', label: 'Preventivo', status: 'overdue', statusTone: 'danger', dueAt: '2026-10-20' },
  { planId: 'p2', assetId: 'a2', assetName: 'Switch Norte', assetCode: 'SW-2', label: 'Preventivo', status: 'upcoming', statusTone: 'warn', dueAt: '2026-11-05' },
  { planId: 'p3', assetId: 'a3', assetName: 'Firewall Perimetral', assetCode: 'FW-3', label: 'Preventivo', status: 'pending', statusTone: 'normal', dueAt: '2027-01-30' }
];

function maintenance(c, plans, locale) {
  c.ItsmI18n.setLocale(locale);
  return c.AssetDashboardModel.fromSummary({ maintenance: plans }, { period: '24h' }).maintenance;
}

test('known maintenance states render the catalog label in both locales', () => {
  const { c } = setup();
  const es = maintenance(c, PLANS, 'es');
  assert.deepEqual(es.map(row => row.statusMeta.label), ['Vencido', 'Próximos', 'Pendiente']);
  const en = maintenance(c, PLANS, 'en');
  assert.deepEqual(en.map(row => row.statusMeta.label), ['Overdue', 'Upcoming', 'Pending']);
  c.ItsmI18n.setLocale('es');
});

test('localizing a maintenance state keeps the service identifier and the asset name', () => {
  const { c } = setup();
  const rows = maintenance(c, PLANS, 'es');
  assert.deepEqual(rows.map(row => row.status), ['overdue', 'upcoming', 'pending']);
  assert.deepEqual(rows.map(row => row.statusMeta.id), ['overdue', 'upcoming', 'pending']);
  assert.deepEqual(rows.map(row => row.asset.name), ['Servidor Central', 'Switch Norte', 'Firewall Perimetral']);
  assert.deepEqual(rows.map(row => row.template.label), ['Preventivo', 'Preventivo', 'Preventivo']);
  c.ItsmI18n.setLocale('es');
});

test('maintenance tone resolves to the pill state the application paints', () => {
  const { c } = setup();
  const rows = maintenance(c, PLANS, 'en');
  assert.deepEqual(rows.map(row => row.statusMeta.tone), ['down', 'warn', 'hold']);
  c.ItsmI18n.setLocale('es');
});

test('an unknown maintenance state keeps the server truth instead of a fabricated label', () => {
  const { c } = setup();
  const unknown = maintenance(c, [
    { planId: 'p4', assetId: 'a4', assetName: 'Impresora Depósito', status: 'paused', statusTone: 'custom', dueAt: '2026-10-21' },
    { planId: 'p5', assetId: 'a5', assetName: 'Monitor Sala', dueAt: '' }
  ], 'es');
  assert.equal(unknown[0].statusMeta.id, 'paused');
  assert.equal(unknown[0].statusMeta.label, 'paused');
  assert.equal(unknown[0].statusMeta.tone, 'custom');
  assert.equal(unknown[0].asset.name, 'Impresora Depósito');
  assert.equal(unknown[1].statusMeta.label, 'Pendiente');
  assert.equal(unknown[1].statusMeta.tone, 'hold');
  c.ItsmI18n.setLocale('es');
});

// Device states and severities are known system enumerations, not user data.
// The dashboard service keeps its own display label (localized to Spanish)
// beside the stable identifier, so an English UI inherited Spanish rows.
// Known identifiers must render the selected catalog; an identifier the
// catalog does not know keeps the server label, and user data (asset names,
// event titles, category labels) is never rewritten.
const SUMMARY = {
  distribution: [
    { id: 'up', label: 'En línea', count: 3 },
    { id: 'degraded', label: 'Degradado', count: 1 },
    { id: 'down', label: 'Fuera de línea', count: 0 },
    { id: 'unmonitored', label: 'Sin monitorización', count: 2 },
    { id: 'unknown', label: 'Sin datos', count: 1 },
    { id: 'maintenance', label: 'En mantenimiento', count: 1 }
  ],
  severity: [
    { id: 'critica', label: 'Crítica', count: 1 },
    { id: 'alta', label: 'Alta', count: 1 },
    { id: 'media', label: 'Media', count: 0 },
    { id: 'baja', label: 'Baja', count: 0 }
  ]
};

function summary(c, locale) {
  c.ItsmI18n.setLocale(locale);
  return c.AssetDashboardModel.fromSummary(SUMMARY, { period: '24h' });
}

test('known device states render the selected catalog instead of the server label', () => {
  const { c } = setup();
  const en = summary(c, 'en');
  assert.deepEqual(en.distribution.map(row => row.label), ['Available', 'Degraded', 'Offline', 'Unmonitored', 'No data', 'En mantenimiento']);
  assert.deepEqual(en.distribution.map(row => row.id), ['up', 'degraded', 'down', 'unmonitored', 'unknown', 'maintenance']);
  assert.deepEqual(en.distribution.map(row => row.count), [3, 1, 0, 2, 1, 1]);
  const es = summary(c, 'es');
  assert.deepEqual(es.distribution.map(row => row.label), ['Disponibles', 'Degradados', 'Fuera de línea', 'Sin supervisión', 'Sin datos', 'En mantenimiento']);
  c.ItsmI18n.setLocale('es');
});

test('known severities render the selected catalog instead of the server label', () => {
  const { c } = setup();
  const en = summary(c, 'en');
  assert.deepEqual([...en.severity.map(row => row.label)], ['Critical', 'High', 'Medium', 'Low']);
  assert.deepEqual([...en.severity.map(row => row.id)], ['critica', 'alta', 'media', 'baja']);
  assert.deepEqual([...en.severity.map(row => row.count)], [1, 1, 0, 0]);
  const es = summary(c, 'es');
  assert.deepEqual([...es.severity.map(row => row.label)], ['Crítica', 'Alta', 'Media', 'Baja']);
  c.ItsmI18n.setLocale('es');
});
