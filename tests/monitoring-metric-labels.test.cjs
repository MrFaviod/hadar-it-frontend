const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/monitoring-settings.js', 'utf8');
function options(locale) {
  const window = { ItsmI18n: { t: key => `${locale}:${key}` }, Views: {} };
  vm.runInNewContext(source, { window });
  return window.Views.MonitoringSettings.computed.metrics.call({ presets: { metrics: [
    { id: 'latency', label: 'Latencia', unit: 'ms', extra: 7 },
    { id: 'custom', label: 'Custom operator metric', unit: 'x' }
  ] } });
}
test('known metric labels follow the active locale without changing metadata', () => {
  for (const locale of ['es', 'en']) {
    const rows = options(locale);
    assert.equal(rows[0].label, `${locale}:ui.monitoring.metric.latency`);
    assert.equal(rows[0].unit, 'ms');
    assert.equal(rows[0].extra, 7);
    assert.equal(rows[0].id, 'latency');
  }
});
test('unknown metric labels remain server-owned', () => {
  assert.equal(options('en')[1].label, 'Custom operator metric');
});
