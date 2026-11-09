'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./inventory-harness.cjs');

test('availability comparison never turns rolling windows into a timeline', () => {
  const { c } = setup();
  const C = c.AssetDashboardCharts;
  const periods = [{ label: '24h', value: 99 }, { label: '7d', value: 97 }, { label: '30d', value: 98 }];
  assert.equal(C.isTimeline(periods), false);
  assert.equal(C.isTimeline([{ at: '2026-11-01T00:00:00Z', value: 1 }]), false);
  assert.equal(C.isTimeline([{ at: '2026-11-01T00:00:00Z', value: 1 }, { at: '2026-11-02T00:00:00Z', value: 2 }]), true);
  assert.equal(C.isTimeline([{ at: '2026-11-01T00:00:00Z', label: '24h', value: 1 }, { at: '2026-11-02T00:00:00Z', label: '7d', value: 2 }]), false);
});

test('donut segments encode only returned counts; zeros and missing data add no arcs', () => {
  const { c } = setup();
  const arcs = c.AssetDashboardCharts.segments([{ id: 'up', count: 3 }, { id: 'unknown', count: 1 }, { id: 'down', count: 0 }]);
  assert.equal(arcs.length, 2);
  assert.equal(arcs[0].share, 75);
  assert.equal(arcs[1].offset, -75);
  assert.equal(c.AssetDashboardCharts.segments([]).length, 0);
  assert.equal(c.AssetDashboardCharts.segments([{ count: -1 }, { count: NaN }]).length, 0);
});

test('latency bars retain zero measurements but never fabricate missing readings', () => {
  const { c } = setup();
  const rows = [{ latencyMs: null }, { latencyMs: 0, asset: { name: 'zero' } }, { latencyMs: 14, asset: { name: 'real' } }];
  const measured = c.AssetDashboardCharts.latencyRows(rows);
  assert.equal(measured.length, 2);
  assert.equal(measured[0].latencyMs, 14);
  assert.equal(measured[1].latencyMs, 0);
});
