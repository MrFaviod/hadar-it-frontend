'use strict';
// T3 JS-string follow-up: the dashboard widget bodies format their dates and
// their missing-value copy in JavaScript, outside the Vue template. Both must
// follow the active locale instead of a frozen Spanish literal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function widgetMethods() {
  const s = setup();
  const widget = s.c.AssetDashboardViews.DashboardWidget;
  assert.ok(widget, 'the dashboard widget is exported');
  return { i18n: s.c.ItsmI18n, methods: widget.methods };
}

test('a missing dashboard timestamp reads from the catalog', () => {
  const { i18n, methods } = widgetMethods();
  i18n.setLocale('es');
  assert.equal(methods.when.call({}, ''), 'Sin registro');
  assert.equal(methods.day.call({}, ''), 'Sin fecha');
  i18n.setLocale('en');
  assert.equal(methods.when.call({}, ''), 'No record');
  assert.equal(methods.day.call({}, ''), 'No date');
  i18n.setLocale('es');
});

test('dashboard dates render in the active locale', () => {
  const { i18n, methods } = widgetMethods();
  i18n.setLocale('es');
  assert.match(methods.when.call({}, '2026-11-01T12:00:00Z'), /nov/i);
  i18n.setLocale('en');
  assert.match(methods.when.call({}, '2026-11-01T12:00:00Z'), /nov/i);
  assert.match(methods.when.call({}, '2026-11-01T12:00:00Z'), /\d{1,2}:\d{2}/);
  i18n.setLocale('es');
});
