'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, stubFetch, json } = require('./inventory-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('the actual sidebar renders unknown, zero and loaded totals without an inventory visit', async t => {
  const session = setup();
  const { c, app } = session;
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const fragment = html.slice(html.indexOf('<span v-if="!serverInventory || inventoryNavTotal'), html.indexOf('</span>', html.indexOf('<span v-if="!serverInventory || inventoryNavTotal')) + 7);
  assert.ok(fragment.includes('nav-link__count'));
  c.options.components.NavCountProbe = { props: ['app'], template: '<div>' + fragment.replaceAll('serverInventory', 'app.serverInventory').replaceAll('inventoryNavTotal', 'app.inventoryNavTotal').replaceAll('assets.length', 'app.assets.length') + '</div>' };
  const view = session.mount('NavCountProbe');
  t.after(() => view.unmount());
  const text = node => node.text !== undefined ? node.text : (node.children || []).map(text).join('');
  assert.equal(text(view.root), '');
  stubFetch(c, () => json({ total: 0 }));
  await app.maintainInventoryCount(); await session.settle();
  assert.equal(text(view.root), '0');
  stubFetch(c, () => json({ total: 41 }));
  await app.maintainInventoryCount({ force: true }); await session.settle();
  assert.equal(text(view.root), '41');
});


test('navigation loads a server total outside inventory without reading the list or filters', async () => {
  const { c, app } = setup();
  app.route = { name: 'config', section: 'general' };
  app.inventoryFilters.query = 'filtered';
  const calls = stubFetch(c, () => json({ items: [], total: 73, limit: 1, offset: 0 }));
  assert.equal(app.inventoryNavTotal, null, 'unknown is not zero');
  await app.maintainInventoryCount();
  assert.equal(app.inventoryNavTotal, 73);
  assert.equal(app.inventory.loaded, false);
  assert.equal(app.inventoryFilters.query, 'filtered');
  assert.match(calls[0].url, /\/assets\/search\?limit=1&offset=0$/);
  await app.maintainInventoryCount();
  assert.equal(calls.length, 1, 'identity maintenance does not repeatedly fetch');
});

test('filtered results never replace the navigation total and a real zero remains visible', async () => {
  const { c, app } = setup();
  stubFetch(c, () => json({ items: [], total: 0, limit: 1, offset: 0 }));
  await app.maintainInventoryCount();
  assert.equal(app.inventoryNavTotal, 0);
  app.inventoryFilters.query = 'none';
  app.inventory.total = 9;
  assert.equal(app.inventoryNavTotal, 0);
});

test('failed count reads are unknown, not a fabricated zero, and can retry', async () => {
  const { c, app } = setup();
  stubFetch(c, () => json({ error: { code: 'failed' } }, 500));
  await app.maintainInventoryCount();
  assert.equal(app.inventoryNavTotal, null);
  stubFetch(c, () => json({ items: [], total: 18 }));
  await app.maintainInventoryCount();
  assert.equal(app.inventoryNavTotal, 18);
});

test('logout cancels count reads and stale responses cannot repopulate another session', async () => {
  const { c, app } = setup();
  let resolve;
  stubFetch(c, () => new Promise(r => { resolve = r; }));
  const pending = app.maintainInventoryCount();
  app.clearInventoryState();
  resolve(json({ items: [], total: 999 }));
  await pending;
  assert.equal(app.inventoryNavTotal, null);
});

test('permission and identity watchers start the independent count on any page', async () => {
  const { c, app } = setup();
  app.route = { name: 'config', section: 'general' };
  stubFetch(c, () => json({ total: 27 }));
  c.options.watch.serverInventory.handler.call(app);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.inventoryNavTotal, 27);
});

test('a user change hides the former total and rejects the former pending response', async () => {
  const { c, app } = setup();
  let resolve;
  stubFetch(c, () => new Promise(r => { resolve = r; }));
  const pending = app.maintainInventoryCount();
  const old = app.activeUserId;
  app.activeUserId = 'second-user';
  assert.notEqual(app.activeUserId, old);
  assert.equal(app.inventoryNavTotal, null);
  resolve(json({ total: 88 }));
  await pending;
  assert.equal(app.inventoryNavTotal, null);
});

test('users without asset visibility do not fetch a count', async () => {
  const { c, app } = setup();
  app.can = () => false;
  const calls = stubFetch(c, () => { throw new Error('unexpected request'); });
  await app.maintainInventoryCount();
  assert.equal(calls.length, 0);
  assert.equal(app.inventoryNavTotal, null);
});
