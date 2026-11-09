'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, stubFetch, json, dto } = require('./inventory-harness.cjs');

function fixture() {
  const s = setup();
  s.app.inventoryCatalog.loaded = true;
  const calls = stubFetch(s.c, call => {
    const query = new URL(call.url, 'http://fixture').searchParams;
    const category = query.get('category') || 'all';
    return json({ items: [dto({ name: category, category })], total: 1,
      limit: Number(query.get('limit')), offset: Number(query.get('offset')) });
  });
  return { ...s, calls };
}

test('sidebar category reentry replaces the previous collection and resets pagination', async () => {
  const { app, calls } = fixture();
  app.route = { name: 'inventory' };
  app.inventoryFilters.category = 'servidores';
  app.inventory.offset = 25;
  await app.loadInventory();
  app.route = { name: 'config', section: 'general' };
  app.filterFromSidebar('virtualizacion');
  assert.equal(app.lastHash, '#/inventario');
  app.route = { name: 'inventory' };
  await app.handleInventoryRoute(app.route);
  assert.equal(app.inventory.items[0].name, 'virtualizacion');
  const params = new URL(calls.at(-1).url, 'http://fixture').searchParams;
  assert.equal(params.get('category'), 'virtualizacion');
  assert.equal(params.get('offset'), '0');
});

test('any retained filter changed outside inventory invalidates the cached collection', async () => {
  const { app, calls } = fixture();
  await app.loadInventory();
  app.inventoryFilters.category = 'contenedores';
  app.inventoryFilters.query = 'norte';
  app.inventoryFilters.status = 'in_use';
  await app.handleInventoryRoute({ name: 'inventory' });
  assert.equal(app.inventory.items[0].name, 'contenedores');
  assert.match(calls.at(-1).url, /query=norte/);
  assert.match(calls.at(-1).url, /status=in_use/);
  const count = calls.length;
  await app.handleInventoryRoute({ name: 'inventory' });
  assert.equal(calls.length, count, 'unchanged completed query can be reused');
});

test('an old collection response cannot be treated as a newly selected category', async () => {
  const { app, c } = fixture();
  let resolve;
  stubFetch(c, () => new Promise(done => { resolve = done; }));
  app.inventoryFilters.category = 'servidores';
  const pending = app.loadInventory();
  app.inventoryFilters.category = 'virtualizacion';
  resolve(json({ items: [dto({ name: 'servidores' })], total: 1, limit: 25, offset: 0 }));
  await pending;
  assert.equal(app.inventory.loaded, false, 'obsolete response is not accepted as a loaded collection');
  assert.equal(app.inventoryCount.total, null, 'obsolete results do not update the global badge');
  stubFetch(c, () => json({ items: [dto({ name: 'virtualizacion' })], total: 1, limit: 25, offset: 0 }));
  await app.handleInventoryRoute({ name: 'inventory' });
  assert.equal(app.inventory.items[0].name, 'virtualizacion');
});
