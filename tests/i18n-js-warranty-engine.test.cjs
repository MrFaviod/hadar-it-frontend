'use strict';
// S3/S10: the warranty engine returns catalog labels and messages. The stable
// `key` values never change with the locale; only the visible copy does.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

test('warranty coverage labels and save errors follow the locale', async () => {
  const s = harness.setup();
  const engine = s.c.AssetWarrantyEngine;
  assert.ok(engine, 'the warranty engine is loaded');

  assert.equal(engine.status(null, 30, '2026-09-12').label, 'Sin información');
  assert.equal(engine.status({ until: '2026-10-12' }, 30, '2026-09-12').label, 'Próxima a vencer');
  assert.equal(engine.status({ until: '2026-10-13' }, 30, '2026-09-12').label, 'Vigente');
  assert.equal(engine.status({ until: '2026-09-11' }, 30, '2026-09-12').label, 'Vencida');
  assert.equal(engine.save({}, { provider: '' }).error, 'Indica el proveedor de la garantía.');
  assert.equal(engine.save({}, { provider: 'P' }).error, 'Indica una fecha de compra válida.');
  assert.equal(engine.save({}, { provider: 'P', purchase: '2026-09-01' }).error, 'Indica una fecha de vencimiento o duración válida.');
  assert.equal(engine.save({}, { provider: 'P', purchase: '2026-09-01', until: '2026-08-01' }).error, 'El vencimiento no puede ser anterior a la compra.');
  assert.equal(engine.status(null, 30, '2026-09-12').key, 'missing', 'the stable coverage key never changes');

  await switchTo(s, 'en');
  assert.equal(engine.status(null, 30, '2026-09-12').label, 'No information');
  assert.equal(engine.status({ until: '2026-10-12' }, 30, '2026-09-12').label, 'Expiring soon');
  assert.equal(engine.status({ until: '2026-10-13' }, 30, '2026-09-12').label, 'Active');
  assert.equal(engine.status({ until: '2026-09-11' }, 30, '2026-09-12').label, 'Expired');
  assert.equal(engine.save({}, { provider: '' }).error, 'Enter the warranty vendor.');
  assert.equal(engine.save({}, { provider: 'P' }).error, 'Enter a valid purchase date.');
  assert.equal(engine.save({}, { provider: 'P', purchase: '2026-09-01' }).error, 'Enter a valid expiry date or duration.');
  assert.equal(engine.save({}, { provider: 'P', purchase: '2026-09-01', until: '2026-08-01' }).error, 'The expiry cannot be earlier than the purchase.');
  assert.equal(engine.status(null, 30, '2026-09-12').key, 'missing', 'the stable coverage key is locale independent');

  await switchTo(s, 'es');
  assert.equal(engine.status(null, 30, '2026-09-12').label, 'Sin información', 'the Spanish label returns after the switch');
});
