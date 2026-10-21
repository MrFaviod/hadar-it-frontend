'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const c = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, localStorage: storage, sessionStorage: storage });
  c.window = c;
  for (const file of ['data','map-data','asset-schema','operations-data','maintenance-data','maintenance-engine','monitoring-data','monitoring-engine','relations-data','store']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/' + file + '.js'), 'utf8'), c);
  }
  for (const file of ['dashboard-model','dashboard-preferences']) {
    const p = path.join(root, 'assets/js/' + file + '.js');
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), c);
  }
  return c;
}
test('dashboard derives monitored counts, filters, coherent series and missing-data states without mutating inventory', () => {
  const c = context();
  assert.ok(c.AssetDashboardModel, 'Dashboard public derivation API must exist');
  const s = c.AssetStore.initialState();
  const app = { ...s, categories: s.config.categories, sites: s.config.sites };
  const before = JSON.stringify(s);
  const m = c.AssetDashboardModel.build(app, { category: '', site: '', period: '24h' });
  assert.equal(m.assets.length, 28);
  assert.equal(m.stats.monitored, 16);
  assert.equal(m.stats.unmonitored, 12);
  assert.equal(m.stats.up + m.stats.down + m.stats.degraded, 16);
  assert.ok(m.availability.length > 1);
  assert.equal(m.distribution.reduce((n, r) => n + r.count, 0), 28);
  const filtered = c.AssetDashboardModel.build(app, { category: s.assets[0].category, site: s.assets[0].site, period: '7d' });
  assert.ok(filtered.assets.length > 0);
  assert.ok(filtered.assets.every(a => a.site === s.assets[0].site && a.category === s.assets[0].category));
  assert.ok(filtered.alerts.every(a => filtered.assets.some(item => item.id === a.assetId)));
  const empty = c.AssetDashboardModel.build(app, { category: 'missing', site: '', period: '30d' });
  assert.equal(empty.stats.availability, null);
  assert.equal(empty.availability.length, 0);
  assert.equal(empty.activity.length, 0);
  assert.equal(JSON.stringify(s), before);
});
test('warranty window includes today as zero days and day 90 but excludes expired and day 91', () => {
  const c = context(), s = c.AssetStore.initialState();
  const now = new Date(2026, 8, 12, 12, 0).getTime();
  const day = offset => { const d = new Date(2026,8,12+offset,12); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  s.assets.forEach((a,i) => { a.retired = null; a.warranty = {until:day([-1,0,90,91][i] ?? 200)}; });
  const m = c.AssetDashboardModel.build(s, {period:'24h'}, now);
  assert.deepEqual(Array.from(m.warranties,r=>r.days), [0,90]);
  assert.equal(m.warranties[0].asset.id,s.assets[1].id);
});
test('additional metrics require configured checks and no-probe equipment receives no invented values', () => {
  const c = context(), s = c.AssetStore.initialState();
  const monitored = s.assets.filter(a => c.AssetMonitorEngine.isMonitored(s.monitoring,a));
  s.monitoring.policies.forEach(p => { p.checkIds = ['availability']; });
  s.monitoring.exceptions.forEach(e => { e.checkIds = ['availability']; });
  const m = c.AssetDashboardModel.build(s, {period:'24h'});
  assert.equal(m.latency.length, 0);
  s.monitoring.probes = [];
  const missing = c.AssetDashboardModel.build(s, {period:'24h'});
  assert.equal(missing.availability.length, 0);
  assert.equal(missing.stats.availability, null);
  assert.equal(missing.distribution.find(r=>r.id==='unknown').count, monitored.length);
});
test('recovery events preserve their real text and the activity filter exposes them', () => {
  const c = context(); const s = c.AssetStore.initialState();
  const now = Date.now(), at = new Date(now - 60000).toISOString();
  s.maintenance.alerts = [{ id: 'demo-recovery', assetId: s.assets[0].id, state: 'recovered', severity: 'alta', events: [{ at, type: 'recovered', text: 'Conectividad recuperada' }] }];
  const m = c.AssetDashboardModel.build(s, { period: '24h' }, now);
  const e = m.activity.find(e => e.id === 'demo-recovery:event:0');
  assert.equal(e.kind, 'recovery');
  assert.equal(e.title, 'Conectividad recuperada');
  assert.equal(m.outages.some(e => e.id === 'demo-recovery:event:0'), true);
});
test('widget visibility and order are per-user, temporary widgets never alter the saved layout', () => {
  const c = context();
  assert.ok(c.AssetDashboardPrefs, 'Dashboard preferences API must exist');
  const P = c.AssetDashboardPrefs, s = P.createState();
  const original = JSON.stringify(P.layoutFor(s, 'a'));
  P.setWidgetVisible(s, 'a', 'alerts', false);
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), false);
  assert.equal(P.visibleWidgets(s, 'b').includes('alerts'), true);
  P.addTemporary(s, 'a', 'alerts');
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), true);
  assert.equal(P.layoutFor(s, 'a').includes('alerts'), false);
  P.clearTemporary(s, 'a');
  assert.equal(P.visibleWidgets(s, 'a').includes('alerts'), false);
  P.moveWidget(s, 'a', 'inventory', -1);
  assert.equal(P.layoutFor(s, 'a').at(-2), 'inventory');
  P.resetLayout(s, 'a');
  assert.equal(JSON.stringify(P.layoutFor(s, 'a')), original);
});
test('custom link CRUD validates before writing and isolates personal and shared links', () => {
  const c = context();
  assert.ok(c.AssetDashboardPrefs, 'Dashboard link CRUD API must exist');
  const P = c.AssetDashboardPrefs, s = P.createState();
  let before = JSON.stringify(s);
  const invalid = P.saveLink(s, 'a', false, { name: 'Unsafe', url: 'javascript:alert(1)', scope: 'personal', icon: 'server' });
  assert.equal(invalid.ok, false);
  assert.equal(JSON.stringify(s), before);
  const personal = P.saveLink(s, 'a', false, { name: 'Internal', url: 'https://example.com', scope: 'personal', icon: 'server', category: 'Red' });
  assert.equal(personal.ok, true);
  assert.equal(P.linksFor(s, 'a').length, 1);
  assert.equal(P.linksFor(s, 'b').length, 0);
  before = JSON.stringify(s);
  assert.equal(P.saveLink(s, 'b', false, { id: personal.link.id, name: 'Hijack', url: 'https://example.org', scope: 'personal' }).ok, false);
  assert.equal(JSON.stringify(s), before);
  assert.equal(P.saveLink(s, 'a', false, { name: 'Shared', url: 'https://example.org', scope: 'shared' }).ok, false);
  assert.equal(P.saveLink(s, 'a', true, { name: 'Shared', url: 'https://example.org', scope: 'shared' }).ok, true);
  assert.equal(P.linksFor(s, 'b').length, 1);
  assert.equal(P.removeLink(s, 'b', false, personal.link.id).ok, false);
  assert.equal(P.removeLink(s, 'a', false, personal.link.id).ok, true);
});
