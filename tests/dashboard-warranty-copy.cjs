'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const text = node => (node.text || '') + (node.children || []).map(text).join('');

test('warranty widget describes the configured coverage window rather than an invented ninety days', async () => {
  const s = setup();
  const catalogue = s.c.AssetDashboardPrefs.CATALOGUE;
  assert.equal(catalogue.find(item => item.id === 'warranties').description, 'Cobertura dentro del plazo configurado');
  s.c.options.components.DashboardWidget = s.c.AssetDashboardViews.DashboardWidget;
  const snapshot = { warranties: [] };
  const widget = s.mount('DashboardWidget', { app: s.app, widget: 'warranties', filters: {}, snapshot });
  await s.settle();
  assert.match(text(widget.root), /No hay garantías que venzan dentro del plazo configurado para esta selección\./);
  assert.doesNotMatch(text(widget.root), /90 días/);
  assert.deepEqual(s.errors, []);
  widget.unmount();
});
