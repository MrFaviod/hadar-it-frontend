'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./inventory-harness.cjs');

test('masonry spans measured content, including one shared gap, not the tallest neighbour', () => {
  const { c } = setup();
  const span = c.AssetDashboardCharts.masonrySpan;
  assert.equal(span(213, 16), 229);
  assert.equal(span(377.5, 16), 394);
  assert.equal(span(0, 16), 16);
});

test('panel owns masonry lifecycle without regrouping or reordering saved widgets', () => {
  const { c } = setup();
  assert.equal(c.AssetPanel.PanelOverview.directives.masonry, c.AssetDashboardCharts.masonry);
  assert.equal(typeof c.AssetDashboardCharts.masonry.mounted, 'function');
  assert.equal(typeof c.AssetDashboardCharts.masonry.updated, 'function');
  assert.equal(typeof c.AssetDashboardCharts.masonry.unmounted, 'function');
  assert.match(c.AssetPanel.PanelOverview.template, /v-masonry/);
});

test('masonry observes changed content and disconnects pending work on unmount', () => {
  const { c } = setup();
  const frames = new Map(); let next = 0, observer, disconnected = false;
  c.requestAnimationFrame = fn => { frames.set(++next, fn); return next; };
  c.cancelAnimationFrame = id => frames.delete(id);
  c.ResizeObserver = class { constructor(fn) { this.fire = fn; observer = this; } observe() {} unobserve() {} disconnect() { disconnected = true; } };
  c.getComputedStyle = () => ({gridTemplateColumns:'500px 500px',columnGap:'16px'});
  const item = {style:{removeProperty(key) { delete this[key]; }},getBoundingClientRect:()=>({height:213})};
  const el = {children:[item],classList:{add(){},remove(){}}};
  const flush = () => { for (const [id,fn] of [...frames]) { frames.delete(id); fn(); } };
  c.AssetDashboardCharts.masonry.mounted(el); flush();
  assert.equal(item.style.gridRowEnd, 'span 229');
  item.getBoundingClientRect = () => ({height:377.5}); observer.fire(); flush();
  assert.equal(item.style.gridRowEnd, 'span 394');
  observer.fire(); assert.equal(frames.size,1);
  c.AssetDashboardCharts.masonry.unmounted(el);
  assert.equal(disconnected,true); assert.equal(frames.size,0);
  observer.fire(); assert.equal(frames.size,0);
});
