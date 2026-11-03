(function () {
  'use strict';
  const periods = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  // Stable operational identifiers. Only their displayed labels are localized.
  const STATUS_IDS = ['up', 'degraded', 'down', 'unmonitored', 'unknown'];
  const STATUS_KEYS = { up: 'ui.dashboard.status_up', degraded: 'ui.dashboard.status_degraded', down: 'ui.dashboard.status_down', unmonitored: 'ui.dashboard.status_unmonitored', unknown: 'ui.dashboard.status_unknown' };
  const statusLabels = { get up() { return tr(STATUS_KEYS.up); }, get degraded() { return tr(STATUS_KEYS.degraded); }, get down() { return tr(STATUS_KEYS.down); }, get unmonitored() { return tr(STATUS_KEYS.unmonitored); }, get unknown() { return tr(STATUS_KEYS.unknown); } };
  const statusTones = { up: 'ok', degraded: 'warn', down: 'down', unmonitored: 'hold', unknown: 'hold' };
  const severityIds = { critical: 'critica', warning: 'alta', info: 'media', critica: 'critica', alta: 'alta', media: 'media', baja: 'baja' };
  const SEVERITY_KEYS = { critica: 'ui.dashboard.severity_critical', alta: 'ui.dashboard.severity_high', media: 'ui.dashboard.severity_medium', baja: 'ui.dashboard.severity_low' };
  // Maintenance planning tokens are service identifiers. Known ones resolve the
  // shipped catalog label; an unmapped identifier keeps the service value so it
  // stays visible instead of being silently rewritten.
  const MAINTENANCE_STATUS_KEYS = { overdue: 'ui.maintenance.status.overdue', upcoming: 'ui.maintenance.filter.upcoming', pending: 'ui.dashboard.pending_default' };
  const MAINTENANCE_TONES = { danger: 'down', warn: 'warn', normal: 'hold', ok: 'ok', down: 'down', hold: 'hold' };
  function maintenanceMeta(status, tone) {
    const id = status || '';
    const label = id ? (MAINTENANCE_STATUS_KEYS[id] ? tr(MAINTENANCE_STATUS_KEYS[id]) : id) : tr('ui.dashboard.pending_default');
    return { id, label, tone: MAINTENANCE_TONES[tone] || tone || 'hold' };
  }
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const list = value => Array.isArray(value) ? value : [];
  const zeroStats = () => ({ total: 0, monitored: 0, up: 0, degraded: 0, down: 0, unmonitored: 0, unknown: 0, criticalAlerts: 0, unacknowledged: 0, activeIncidents: 0, availability: null });
  const emptyInventory = () => ({ total: 0, active: 0, unassigned: 0, attention: [] });
  const assetFromRow = row => ({ id: row.assetId, name: row.assetName || row.name || row.assetCode || row.quickCode || row.assetId, code: row.assetCode || row.quickCode || row.assetId, category: row.category || '', type: row.type || '', site: row.siteId || row.site || '', locationId: row.locationId || '', statusId: row.status || '', retired: false, assigneeId: '' });
  const linkFor = target => {
    const t = target || {};
    if (t.kind === 'alert') return '#/supervision/alerta/' + encodeURIComponent(t.id);
    if (t.kind === 'asset') return '#/activo/' + encodeURIComponent(t.id);
    return '';
  };
  function empty(period) { return fromSummary(null, { period }, undefined); }

  function fromSummary(raw, filters, reference) {
    const f = filters || {};
    const period = periods[f.period] ? f.period : '24h';
    const now = reference || Date.now();
    if (!raw || typeof raw !== 'object') {
      return { available: false, assets: [], rows: [], stats: { ...zeroStats(), availability: null }, alerts: [], activeAlerts: [], availability: [], latency: [],
        distribution: [], severity: [], maintenance: [], warranties: [], activity: [], byCategory: [], bySite: [], outages: [], incidents: [],
        inventory: emptyInventory(), period, now, lastCheck: '', uptimeDays: null, widgetAvailable: () => false };
    }
    const rows = list(raw.rows).map(row => ({
      asset: assetFromRow(row), status: STATUS_IDS.includes(row.status) ? row.status : 'unknown',
      statusMeta: { id: row.status || 'unknown', label: tr(STATUS_KEYS[row.status] || STATUS_KEYS.unknown), tone: statusTones[row.status] || 'hold' },
      monitored: !!row.monitored, reason: row.reason || '', uptimePct: number(row.uptimePct), latencyMs: number(row.latencyMs),
      lastCheckAt: row.lastCheckAt || '', uptimeDays: null, href: linkFor(row.target) || '#/activo/' + encodeURIComponent(row.assetId)
    })).filter(row => {
      if (f.status && f.status !== 'all' && row.status !== f.status) return false;
      if (f.location && f.location !== 'all' && row.asset.locationId !== f.location) return false;
      if (f.search && !(row.asset.name + ' ' + row.asset.code).toLocaleLowerCase('es').includes(String(f.search).toLocaleLowerCase('es'))) return false;
      return true;
    });
    const assets = rows.map(row => row.asset);
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    const assetFor = (id, name, code) => byId.get(id) || (id ? { id, name: name || code || id, code: code || id, category: '', site: '', locationId: '', statusId: '', retired: false, assigneeId: '' }  : { id: '', name: name || tr('ui.dashboard.no_asset'), code: code || '', category: '', site: '', locationId: '', statusId: '', retired: false, assigneeId: '' });
    const availabilitySource = raw.availability || {};
    const samples = list(availabilitySource.samples).map(point => ({ at: point.at || '', label: point.label || period, value: number(point.value) })).filter(point => point.value !== null);
    const currentAvailability = number(availabilitySource.current);
    const availability = samples.length ? samples : currentAvailability === null ? [] : [{ at: availabilitySource.lastCheckAt || '', label: period, value: currentAvailability }];
    const latencyCurrent = number((raw.latency || {}).current);
    const latency = latencyCurrent === null ? [] : [{ at: availabilitySource.lastCheckAt || '', label: tr('ui.dashboard.current'), value: latencyCurrent }];
    const stats = { ...zeroStats(), ...(raw.stats || {}), availability: currentAvailability };
    const activeAlerts = list(raw.activeAlerts).map(alert => ({
      id: alert.id, title: alert.title || alert.description || tr('ui.dashboard.alert_fallback'), description: alert.description || '',
      severity: alert.severity || 'info', severityRank: ({ critical: 3, warning: 2, info: 1 })[alert.severity] || 0,
      assetId: alert.assetId || '', asset: assetFor(alert.assetId, alert.assetName, alert.assetCode),
      state: alert.state || 'open', acknowledged: !!alert.acknowledged, acknowledgedAt: alert.acknowledgedAt || null,
      createdAt: alert.createdAt || '', href: linkFor(alert.target) || '#/supervision/alerta/' + encodeURIComponent(alert.id)
    }));
    const activity = list(raw.activity).map(event => {
      const asset = assetFor(event.assetId, event.assetName, event.assetCode);
      return { id: event.id, at: event.at || '', kind: event.kind || 'inventory', title: event.title || tr('ui.dashboard.change_registered'),
        detail: event.detail || '', asset, assetId: asset.id, href: linkFor(event.target) || (asset.id ? '#/activo/' + encodeURIComponent(asset.id) : '') };
    }).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    const maintenance = list(raw.maintenance).map(row => ({
      planId: row.planId, assetId: row.assetId, asset: assetFor(row.assetId, row.assetName, row.assetCode),
      label: row.label || tr('ui.dashboard.preventive_default'), template: { label: row.label || tr('ui.dashboard.preventive_default') },
      status: row.status || '', statusMeta: maintenanceMeta(row.status, row.statusTone), dueAt: row.dueAt || ''
    }));
    const warranties = list(raw.warranties).map(row => ({
      asset: assetFor(row.assetId, row.assetName, row.assetCode), assetId: row.assetId, until: row.until || '',
      days: Number(row.days) || 0, coverage: row.coverage || 'expiring'
    }));
    // Device states are known system enumerations. The service also sends its own
    // display label, already localized in Spanish, so trusting it would leave Spanish
    // rows in an English UI. A known identifier always renders the selected catalog;
    // an identifier the catalog does not know keeps the server label untouched.
    const distribution = list(raw.distribution).map(item => ({ id: item.id, label: STATUS_KEYS[item.id] ? (tr(STATUS_KEYS[item.id]) || item.label || item.id) : (item.label || item.id), count: Number(item.count) || 0 }));
    const severity = ['critica', 'alta', 'media', 'baja'].map(id => {
      const item = list(raw.severity).find(entry => (severityIds[entry.id] || entry.id) === id);
      // Severity is the same kind of known enumeration: the catalog owns the label
      // for the four shipped levels, the service label is only a fallback when no
      // catalog is installed.
      return { id, label: tr(SEVERITY_KEYS[id]) || (item && item.label) || id, count: Number(item && item.count) || 0 };
    });
    const outages = activity.filter(event => event.kind === 'recovery' || (event.kind === 'alert' && /caída|sin respuesta|conectividad|fuera de línea|recuper/i.test(event.title + ' ' + event.detail)));
    const inventorySource = raw.inventory || {};
    const inventory = { total: Number(inventorySource.total) || 0, active: Number(inventorySource.active) || 0, unassigned: Number(inventorySource.unassigned) || 0,
      attention: list(inventorySource.attention).map(item => ({ ...item, asset: assetFor(item.assetId, item.assetName, item.assetCode) })) };
    const incidents = Array.isArray(raw.incidents) ? raw.incidents.map(item => ({ ...item, asset: assetFor(item.assetId, item.assetName, item.assetCode), href: '#/mantenimiento/incidente/' + encodeURIComponent(item.id) })) : [];
    const unavailable = new Set(list(raw.unavailable).map(item => typeof item === 'string' ? item : item && item.id));
    const group = item => ({ id: item.id, label: item.label || item.id, total: Number(item.total) || 0, up: Number(item.up) || 0, degraded: Number(item.degraded) || 0, down: Number(item.down) || 0, other: Number(item.other) || 0 });
    const model = {
      available: true, raw, assets, rows, stats: { ...stats, activeIncidents: Number(raw.stats && raw.stats.activeIncidents) || incidents.length },
      alerts: activeAlerts, activeAlerts, availability, latency, distribution, severity, maintenance, warranties, activity, outages, incidents, inventory,
      byCategory: list(raw.byCategory).map(group), bySite: list(raw.bySite).map(group), period, now,
      lastCheck: availabilitySource.lastCheckAt || rows.map(row => row.lastCheckAt).filter(Boolean).sort().at(-1) || '', uptimeDays: null
    };
    model.widgetAvailable = widget => {
      if (unavailable.has(widget)) return false;
      if (widget === 'availability') return !!(availabilitySource.configured || availability.length);
      if (widget === 'latency') return latencyCurrent !== null;
      if (widget === 'incidents') return Array.isArray(raw.incidents);
      if (widget === 'distribution') return Array.isArray(raw.distribution);
      return true;
    };
    return model;
  }
  function build(app, filters, reference) {
    const summary = app && app.dashboard ? app.dashboard.summary : null;
    return fromSummary(summary, filters, reference);
  }
  window.AssetDashboardModel = { build, fromSummary, empty, periods, statusLabels };
})();
