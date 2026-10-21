(function () {
  'use strict';
  const M = window.AssetMonitorEngine;
  const periods = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
  const statusLabels = { up: 'Disponibles', degraded: 'Degradados', down: 'Fuera de línea', unmonitored: 'Sin supervisión', unknown: 'Sin datos' };
  function date(value) { const n = Date.parse(value); return Number.isFinite(n) ? n : 0; }
  function build(app, filters, reference) {
    const now = reference || Date.now();
    const f = filters || {};
    const period = periods[f.period] ? f.period : '24h';
    const assets = (app.assets || []).filter(a => (!f.category || a.category === f.category) && (!f.site || a.site === f.site) && (!f.status || f.status==='all' || a.statusId===f.status) && (!f.location || f.location==='all' || a.locationId===f.location));
    const ids = new Set(assets.map(a => a.id));
    const alerts = ((app.maintenance || {}).alerts || []).filter(a => ids.has(a.assetId));
    const activeAlerts = alerts.filter(a => a.state === 'open');
    const rows = M.deviceRows(app.monitoring, assets, alerts, now).map(row => {
      const ids = M.checkIdsFor(app.monitoring, row.asset);
      return { ...row, status: row.monitored && !row.probe ? 'unknown' : row.status,
        latencyMs: ids.includes('latency') ? row.latencyMs : null,
        uptimePct: ids.includes('availability') ? row.uptimePct : null };
    });
    const stats = M.stats(app.monitoring, assets, alerts, now);
    const eligible = check => assets.filter(a => M.isMonitored(app.monitoring, a) && M.probeOf(app.monitoring, a.id) && M.checkIdsFor(app.monitoring, a).includes(check));
    const availability = M.aggregateAvailability(app.monitoring, eligible('availability'), period, now).filter(p => Number.isFinite(p.value));
    const latency = M.aggregateLatency(app.monitoring, eligible('latency'), period, now).filter(p => Number.isFinite(p.value));
    const uptimeValues = rows.filter(r => Number.isFinite(r.uptimePct)).map(r => r.uptimePct);
    stats.availability = uptimeValues.length ? uptimeValues.reduce((sum, n) => sum + n, 0) / uptimeValues.length : null;
    const distribution = Object.keys(statusLabels).map(id => ({ id, label: statusLabels[id], count: rows.filter(r => r.status === id).length }));
    // Some monitor versions call unmonitored devices "unmonitored"; preserve all other no-data states explicitly.
    const covered = distribution.reduce((sum, r) => sum + r.count, 0);
    if (covered < assets.length) distribution.find(r => r.id === 'unknown').count += assets.length - covered;
    const breakdown = (field, catalogue) => (catalogue || []).map(item => {
      const grouped = rows.filter(r => r.asset[field] === item.id);
      return { id: item.id, label: item.label, total: grouped.length, up: grouped.filter(r => r.status === 'up').length,
        degraded: grouped.filter(r => r.status === 'degraded').length, down: grouped.filter(r => r.status === 'down').length,
        other: grouped.filter(r => !['up', 'degraded', 'down'].includes(r.status)).length };
    }).filter(r => r.total);
    const activity = [];
    assets.forEach(asset => (asset.history || []).forEach((e, i) => {
      activity.push({ id: asset.id + ':history:' + i, at: e.at || e.date || '', kind: ['monitoring', 'alert'].includes(e.kind) ? 'alert' : ['maintenance', 'intervention', 'repair', 'incident'].includes(e.kind) ? 'technical' : 'inventory',
        title: e.title || e.detail || 'Cambio registrado', detail: e.detail || '', asset, href: '#/activo/' + encodeURIComponent(asset.id) });
    }));
    alerts.forEach(alert => {
      const asset = assets.find(a => a.id === alert.assetId);
      const events = Array.isArray(alert.events) && alert.events.length ? alert.events : [{ at: alert.createdAt || alert.at, title: alert.title || alert.description }];
      events.forEach((e, i) => activity.push({ id: alert.id + ':event:' + i, at: e.at || alert.createdAt, kind: e.type === 'recovered' || /recuper/i.test(e.title || e.text || e.kind || '') ? 'recovery' : 'alert', title: e.title || e.text || e.message || alert.title || alert.description || 'Evento de alerta', detail: e.detail || '', asset, href: '#/supervision/alerta/' + encodeURIComponent(alert.id) }));
    });
    ((app.maintenance || {}).interventions || []).filter(i => ids.has(i.assetId)).forEach(i => {
      const asset = assets.find(a => a.id === i.assetId);
      activity.push({ id: 'intervention:' + i.id, at: i.completedAt || i.date || i.createdAt, kind: 'technical', title: i.description || 'Intervención técnica', detail: i.status || '', asset, href: '#/activo/' + encodeURIComponent(asset.id) });
    });
    const recentActivity = activity.filter(e => date(e.at) && date(e.at) >= now - periods[period] && date(e.at) <= now).sort((a, b) => date(b.at) - date(a.at));
    const maintenance = window.AssetMaintEngine.agenda(app.maintenance, assets, {}, window.AssetMaintEngine.localDay(new Date(now))).filter(r => !['paused', 'unscheduled'].includes(r.status));
    const warranties = assets.filter(a => !a.retired && a.warranty && date(a.warranty.until)).map(asset => ({ asset, until: asset.warranty.until, days: window.AssetMaintEngine.daysUntil(asset.warranty.until, window.AssetMaintEngine.localDay(new Date(now))) }))
      .filter(r => r.days >= 0 && r.days <= 90).sort((a, b) => a.days - b.days);
    const severity = ['critica', 'alta', 'media', 'baja'].map(id => ({ id, label: M.severityMeta(id).label, count: activeAlerts.filter(a => a.severity === id).length }));
    return { assets, rows, stats, alerts, activeAlerts, availability, latency, distribution, severity, maintenance, warranties, activity: recentActivity,
      byCategory: breakdown('category', app.categories || app.config.categories), bySite: breakdown('site', app.sites || app.config.sites),
      outages: recentActivity.filter(e => e.kind === 'recovery' || (e.kind === 'alert' && /caída|sin respuesta|conectividad|fuera de línea|recuper/i.test(e.title + ' ' + e.detail))),
      period, now, lastCheck: rows.map(r => r.lastCheckAt).filter(Boolean).sort().at(-1) || '',
      uptimeDays: rows.filter(r => Number.isFinite(r.uptimeDays)).length ? Math.round(rows.filter(r => Number.isFinite(r.uptimeDays)).reduce((n, r) => n + r.uptimeDays, 0) / rows.filter(r => Number.isFinite(r.uptimeDays)).length) : null };
  }
  window.AssetDashboardModel = { build, periods };
})();
