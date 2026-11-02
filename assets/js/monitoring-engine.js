(function () {
  'use strict';

  const Data = window.ASSET_MONITOR;
  const Maint = window.ASSET_MAINT || {};
  const MaintEngine = window.AssetMaintEngine || {};

  const HISTORY_LIMIT = 200;
  const NOTIFICATION_LIMIT = 80;
  const DAY_MS = 86400000;

  function runtime() {
    return typeof window !== 'undefined' ? window.ItsmI18n : null;
  }

  // Every visible label and message below is a catalog key resolved on read, so
  // a locale switch re-reads the catalog instead of keeping the language that
  // was active when the module loaded (D2, D3).
  function tr(key, params) {
    const api = runtime();
    return api ? api.t(key, params) : '';
  }

  // Chart axis labels: short weekday and month names per locale.
  const DAY_SHORT_KEYS = [
    'ui.monitoring.day_short.sun', 'ui.monitoring.day_short.mon', 'ui.monitoring.day_short.tue',
    'ui.monitoring.day_short.wed', 'ui.monitoring.day_short.thu', 'ui.monitoring.day_short.fri',
    'ui.monitoring.day_short.sat'
  ];
  const MONTH_KEYS = [
    'ui.monitoring.month_short.jan', 'ui.monitoring.month_short.feb', 'ui.monitoring.month_short.mar',
    'ui.monitoring.month_short.apr', 'ui.monitoring.month_short.may', 'ui.monitoring.month_short.jun',
    'ui.monitoring.month_short.jul', 'ui.monitoring.month_short.aug', 'ui.monitoring.month_short.sep',
    'ui.monitoring.month_short.oct', 'ui.monitoring.month_short.nov', 'ui.monitoring.month_short.dec'
  ];

  function dayShort(day) {
    return tr(DAY_SHORT_KEYS[day] || DAY_SHORT_KEYS[0]);
  }

  function monthShort(month) {
    return tr(MONTH_KEYS[month] || MONTH_KEYS[0]);
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function num(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isoOr(value, fallback) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function meta(list, id) {
    return (list || []).find((item) => item.id === id) || (list || [])[0] || { id: id, label: id, tone: 'neutral' };
  }

  function severityMeta(id) {
    return meta(Data.PRIORITIES, id);
  }

  function severityRank(id) {
    return severityMeta(id).weight || 1;
  }

  function alertStateMeta(id) {
    return meta(Maint.ALERT_STATES, id);
  }

  function alertKindMeta(id) {
    return meta(Maint.ALERT_KINDS, id);
  }

  function statusMeta(id) {
    return meta(Data.STATUSES, id || 'unmonitored');
  }

  function rangeMeta(id) {
    return meta(Data.RANGES, id || Data.PREFS.range);
  }

  function notificationKindMeta(id) {
    return meta(Data.NOTIFICATION_KINDS, id);
  }

  function channelMeta(id) {
    if (id === 'smtp') return { id: 'smtp', label: tr('ui.monitoring.channel.smtp'), icon: 'mail' };
    if (id === 'telegram') return { id: 'telegram', label: tr('ui.monitoring.channel.telegram'), icon: 'send' };
    return { id: id, label: id, icon: 'info' };
  }

  // ---------------------------------------------------------------- normalize
  function normalizeChecks(value) {
    const source = Array.isArray(value) ? value : Data.CHECKS;
    return Data.CHECKS.map((base) => {
      const stored = source.find((item) => item && item.id === base.id) || {};
      let warn = num(stored.warn, base.warn);
      let crit = num(stored.crit, base.crit);
      if (base.direction === 'above') {
        if (crit <= warn) crit = warn + Math.max(base.step, 1);
      } else if (crit >= warn) {
        crit = warn - Math.max(base.step, 1);
      }
      // The copy keeps the catalog keys, so re-attaching the getters keeps the
      // normalized check hot-switchable instead of freezing its first label.
      return Data.relabel(Object.assign({}, base, {
        warn: Math.round(warn * 100) / 100,
        crit: Math.round(crit * 100) / 100
      }), base);
    });
  }

  function normalizePolicies(value, categories, checks) {
    const source = Array.isArray(value) ? value : Data.POLICIES;
    const validChecks = checks.map((check) => check.id);
    const list = Array.isArray(categories) && categories.length ? categories : Data.POLICIES.map((item) => ({ id: item.category }));
    return list.map((category) => {
      const stored = source.find((item) => item && item.category === category.id)
        || Data.POLICIES.find((item) => item.category === category.id)
        || { category: category.id, enabled: false, intervalMinutes: 30, checkIds: ['availability'] };
      const checkIds = (Array.isArray(stored.checkIds) ? stored.checkIds : ['availability'])
        .filter((id, index, all) => validChecks.indexOf(id) !== -1 && all.indexOf(id) === index);
      return {
        category: category.id,
        enabled: bool(stored.enabled, false),
        intervalMinutes: clamp(Math.round(num(stored.intervalMinutes, 30)), 1, 1440),
        checkIds: checkIds.length ? checkIds : ['availability']
      };
    });
  }

  function normalizeExceptions(value, assets, checks) {
    const source = Array.isArray(value) ? value : Data.EXCEPTIONS;
    const validChecks = checks.map((check) => check.id);
    const assetIds = new Set((assets || []).map((asset) => asset.id));
    const seen = new Set();
    return source.reduce((result, item) => {
      if (!item || typeof item !== 'object' || !item.assetId) return result;
      if (!assetIds.has(item.assetId) || seen.has(item.assetId)) return result;
      seen.add(item.assetId);
      const checkIds = (Array.isArray(item.checkIds) ? item.checkIds : ['availability'])
        .filter((id, index, all) => validChecks.indexOf(id) !== -1 && all.indexOf(id) === index);
      result.push({
        assetId: item.assetId,
        enabled: item.enabled !== false,
        intervalMinutes: clamp(Math.round(num(item.intervalMinutes, 15)), 1, 1440),
        checkIds: checkIds.length ? checkIds : ['availability']
      });
      return result;
    }, []);
  }

  function normalizeProbes(value, assets, policies, exceptions, checks, prefs) {
    const source = Array.isArray(value) ? value : Data.PROBES;
    const validIds = new Set((assets || []).map((asset) => asset.id));
    const statuses = Data.STATUSES.map((item) => item.id);
    return source.reduce((result, item) => {
      if (!item || typeof item !== 'object' || !validIds.has(item.assetId)) return result;
      const values = item.values && typeof item.values === 'object' ? item.values : {};
      const clean = {};
      ['cpu', 'memory', 'disk', 'temperature', 'servicesUp', 'servicesTotal'].forEach((key) => {
        if (Number.isFinite(Number(values[key]))) clean[key] = Number(values[key]);
      });
      const status = statuses.indexOf(item.status) !== -1 && item.status !== 'unmonitored' ? item.status : 'up';
      result.push({
        assetId: item.assetId,
        status: status,
        latencyMs: Math.max(0, num(item.latencyMs, 0)),
        uptimePct: clamp(num(item.uptimePct, 100), 0, 100),
        uptimeDays: Math.max(0, Math.round(num(item.uptimeDays, 0))),
        lastCheckAt: isoOr(item.lastCheckAt, item.checkedMinutesAgo !== undefined
          ? new Date(Date.now() - num(item.checkedMinutesAgo, 1) * 60000).toISOString()
          : nowIso()),
        downSince: isoOr(item.downSince, ''),
        checks: Math.max(0, Math.round(num(item.checks, 0))),
        values: clean
      });
      return result;
    }, []);
  }

  function normalizeSilences(value, assets, categories) {
    const source = Array.isArray(value) ? value : Data.SILENCES;
    const assetIds = new Set((assets || []).map((asset) => asset.id));
    const categoryIds = new Set((categories || []).map((category) => category.id));
    const seen = new Set();
    return source.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const scope = item.scope === 'category' ? 'category' : 'asset';
      const target = text(item.target);
      if (!target || seen.has(scope + ':' + target)) return result;
      if (scope === 'asset' && !assetIds.has(target)) return result;
      if (scope === 'category' && !categoryIds.has(target)) return result;
      seen.add(scope + ':' + target);
      result.push({
        id: text(item.id, 'sil-' + target),
        scope: scope,
        target: target,
        until: isoOr(item.until, ''),
        reason: text(item.reason).slice(0, 200),
        createdAt: isoOr(item.createdAt, nowIso()),
        createdBy: text(item.createdBy, tr('ui.monitoring.actor.administrator'))
      });
      return result;
    }, []);
  }

  function validTime(value, fallback) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? value : fallback;
  }

  function normalizeWindows(value, categories, sites) {
    const source = Array.isArray(value) ? value : Data.WINDOWS;
    const categoryIds = new Set((categories || []).map((category) => category.id));
    const siteIds = new Set((sites || []).map((site) => site.id));
    return source.reduce((result, item, index) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label);
      if (!label) return result;
      const start = validTime(item.start, '01:00');
      const end = validTime(item.end, '02:00');
      const days = (Array.isArray(item.days) ? item.days : [0, 1, 2, 3, 4, 5, 6])
        .map((day) => Math.round(num(day, -1)))
        .filter((day, position, all) => day >= 0 && day <= 6 && all.indexOf(day) === position);
      result.push({
        id: text(item.id, 'win-' + (index + 1)),
        label: label,
        start: start,
        end: end,
        days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
        categories: (Array.isArray(item.categories) ? item.categories : []).filter((id) => categoryIds.has(id)),
        sites: (Array.isArray(item.sites) ? item.sites : []).filter((id) => siteIds.has(id)),
        active: item.active !== false,
        reason: text(item.reason).slice(0, 200)
      });
      return result;
    }, []);
  }

  // The SMTP sender, subject and body ship as catalog copy. While the stored
  // channel has no value of its own the getter re-reads the catalog default, so
  // a locale switch updates the preview and a saved override still wins.
  function channelCopy(target, property, stored, fallback, limit, trim) {
    Object.defineProperty(target, property, {
      enumerable: true,
      configurable: true,
      get: function () {
        const value = Object.prototype.hasOwnProperty.call(stored, property) ? stored[property] : fallback();
        if (typeof value !== 'string') return '';
        return (trim ? value.trim() : value).slice(0, limit);
      },
      set: function (value) {
        stored[property] = value;
      }
    });
    return target;
  }

  function normalizeChannels(value) {
    const source = value && typeof value === 'object' ? value : {};
    const smtpInput = source.smtp && typeof source.smtp === 'object' ? source.smtp : {};
    const smtp = Object.assign({}, Data.CHANNELS.smtp, smtpInput);
    const telegram = Object.assign({}, Data.CHANNELS.telegram, source.telegram && typeof source.telegram === 'object' ? source.telegram : {});
    const smtpChannel = {
      enabled: smtp.enabled !== false,
      host: text(smtp.host).slice(0, 120),
      port: clamp(Math.round(num(smtp.port, 587)), 1, 65535),
      secure: smtp.secure !== false,
      from: text(smtp.from).slice(0, 120),
      recipients: text(smtp.recipients).slice(0, 400),
      lastTestAt: isoOr(smtp.lastTestAt, ''),
      lastTestResult: smtp.lastTestResult === 'ok' || smtp.lastTestResult === 'error' ? smtp.lastTestResult : ''
    };
    [['fromName', 80, true], ['subject', 160, true], ['template', 1200, false]].forEach(function (field) {
      channelCopy(smtpChannel, field[0], smtpInput, function () {
        return Data.CHANNELS.smtp[field[0]];
      }, field[1], field[2]);
    });
    return {
      smtp: smtpChannel,
      telegram: {
        enabled: telegram.enabled === true,
        botName: text(telegram.botName).slice(0, 80),
        token: text(telegram.token).slice(0, 160),
        chatIds: text(telegram.chatIds).slice(0, 200),
        template: typeof telegram.template === 'string' ? telegram.template.slice(0, 1200) : '',
        parseMode: ['Markdown', 'HTML', 'Texto'].indexOf(telegram.parseMode) !== -1 ? telegram.parseMode : 'Markdown',
        lastTestAt: isoOr(telegram.lastTestAt, ''),
        lastTestResult: telegram.lastTestResult === 'ok' || telegram.lastTestResult === 'error' ? telegram.lastTestResult : ''
      }
    };
  }

  function normalizeEscalations(value, categories, sites) {
    const source = Array.isArray(value) ? value : Data.ESCALATIONS;
    const categoryIds = new Set((categories || []).map((category) => category.id));
    const siteIds = new Set((sites || []).map((site) => site.id));
    const severities = Data.PRIORITIES.map((item) => item.id);
    return source.reduce((result, item, index) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label);
      if (!label) return result;
      result.push({
        id: text(item.id, 'esc-' + (index + 1)),
        label: label,
        severity: severities.indexOf(item.severity) !== -1 ? item.severity : '',
        categories: (Array.isArray(item.categories) ? item.categories : []).filter((id) => categoryIds.has(id)),
        sites: (Array.isArray(item.sites) ? item.sites : []).filter((id) => siteIds.has(id)),
        channels: (Array.isArray(item.channels) ? item.channels : ['smtp']).filter((id) => id === 'smtp' || id === 'telegram'),
        afterMinutes: clamp(Math.round(num(item.afterMinutes, 0)), 0, 10080),
        window: ['always', 'business', 'after_hours'].indexOf(item.window) !== -1 ? item.window : 'always',
        requireUnack: item.requireUnack !== false,
        recipients: text(item.recipients).slice(0, 300),
        enabled: item.enabled === true
      });
      return result;
    }, []);
  }

  function normalizeNotifications(value) {
    const source = Array.isArray(value) ? value : Data.NOTIFICATIONS;
    const kinds = Data.NOTIFICATION_KINDS.map((item) => item.id);
    const severities = Data.PRIORITIES.map((item) => item.id);
    return source.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const title = text(item.title);
      if (!title) return result;
      result.push({
        id: text(item.id, 'not-' + result.length),
        kind: kinds.indexOf(item.kind) !== -1 ? item.kind : 'system',
        severity: severities.indexOf(item.severity) !== -1 ? item.severity : 'baja',
        title: title.slice(0, 140),
        body: text(item.body).slice(0, 300),
        at: isoOr(item.at, nowIso()),
        readAt: isoOr(item.readAt, ''),
        alertId: text(item.alertId),
        incidentId: text(item.incidentId),
        assetId: text(item.assetId),
        channels: (Array.isArray(item.channels) ? item.channels : []).filter((id) => id === 'smtp' || id === 'telegram')
      });
      return result;
    }, []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, NOTIFICATION_LIMIT);
  }

  function normalizePrefs(value) {
    const source = value && typeof value === 'object' ? value : {};
    const base = Data.PREFS;
    const hours = source.businessHours && typeof source.businessHours === 'object' ? source.businessHours : {};
    const days = (Array.isArray(hours.days) ? hours.days : base.businessHours.days)
      .map((day) => Math.round(num(day, -1)))
      .filter((day, index, all) => day >= 0 && day <= 6 && all.indexOf(day) === index);
    return {
      range: Data.RANGES.some((item) => item.id === source.range) ? source.range : base.range,
      defaultTab: ['estado', 'dispositivos', 'alertas'].indexOf(source.defaultTab) !== -1 ? source.defaultTab : base.defaultTab,
      autoRefresh: source.autoRefresh === true,
      refreshSeconds: clamp(Math.round(num(source.refreshSeconds, base.refreshSeconds)), 10, 300),
      showUnmonitored: source.showUnmonitored !== false,
      groupRepeats: source.groupRepeats !== false,
      highlightIntermittent: source.highlightIntermittent !== false,
      inAppNotifications: source.inAppNotifications !== false,
      businessHours: {
        from: validTime(hours.from, base.businessHours.from),
        to: validTime(hours.to, base.businessHours.to),
        days: days.length ? days : base.businessHours.days.slice()
      }
    };
  }

  function normalize(value, assets, categories, sites) {
    const source = value && typeof value === 'object' ? value : {};
    const checks = normalizeChecks(source.checks);
    const policies = normalizePolicies(source.policies, categories, checks);
    const exceptions = normalizeExceptions(source.exceptions, assets, checks);
    const prefs = normalizePrefs(source.prefs);
    return {
      version: 1,
      checks: checks,
      policies: policies,
      exceptions: exceptions,
      probes: normalizeProbes(source.probes, assets, policies, exceptions, checks, prefs),
      silences: normalizeSilences(source.silences, assets, categories),
      windows: normalizeWindows(source.windows, categories, sites),
      channels: normalizeChannels(source.channels),
      escalations: normalizeEscalations(source.escalations, categories, sites),
      notifications: normalizeNotifications(source.notifications),
      prefs: prefs
    };
  }

  // ---------------------------------------------------------------- selection
  function checkById(state, id) {
    return (state.checks || []).find((check) => check.id === id) || null;
  }

  function policyFor(state, category) {
    return (state.policies || []).find((policy) => policy.category === category) || null;
  }

  function exceptionFor(state, assetId) {
    return (state.exceptions || []).find((exception) => exception.assetId === assetId) || null;
  }

  function isMonitored(state, asset) {
    if (!asset || asset.retired) return false;
    const exception = exceptionFor(state, asset.id);
    if (exception) return exception.enabled;
    const policy = policyFor(state, asset.category);
    return !!(policy && policy.enabled);
  }

  function intervalFor(state, asset) {
    const exception = exceptionFor(state, asset.id);
    if (exception && exception.enabled) return exception.intervalMinutes;
    const policy = policyFor(state, asset.category);
    return policy ? policy.intervalMinutes : 30;
  }

  function checkIdsFor(state, asset) {
    const exception = exceptionFor(state, asset.id);
    if (exception && exception.enabled) return exception.checkIds;
    const policy = policyFor(state, asset.category);
    return policy && policy.enabled ? policy.checkIds : [];
  }

  function checksFor(state, asset) {
    return checkIdsFor(state, asset).map((id) => checkById(state, id)).filter(Boolean);
  }

  function probeOf(state, assetId) {
    return (state.probes || []).find((probe) => probe.assetId === assetId) || null;
  }

  function ensureProbe(state, asset) {
    if (!isMonitored(state, asset)) return null;
    let probe = probeOf(state, asset.id);
    if (probe) return probe;
    const seed = Data.hash(asset.id);
    probe = {
      assetId: asset.id,
      status: 'up',
      latencyMs: 2 + (seed % 9),
      uptimePct: 99.5 + ((seed % 49) / 100),
      uptimeDays: 5 + (seed % 180),
      lastCheckAt: new Date(Date.now() - (1 + (seed % 8)) * 60000).toISOString(),
      downSince: '',
      checks: 3,
      values: {}
    };
    checksFor(state, asset).forEach((check) => {
      if (check.id === 'cpu') probe.values.cpu = 20 + (seed % 45);
      if (check.id === 'memory') probe.values.memory = 30 + (seed % 40);
      if (check.id === 'disk') probe.values.disk = 30 + (seed % 55);
      if (check.id === 'temperature') probe.values.temperature = 24 + (seed % 8);
      if (check.id === 'services') {
        probe.values.servicesTotal = 3;
        probe.values.servicesUp = 3;
      }
    });
    state.probes = Array.isArray(state.probes) ? state.probes : [];
    state.probes.push(probe);
    return probe;
  }

  // ---------------------------------------------------------------- measures
  function valueOf(probe, check) {
    if (!probe || !check) return null;
    if (check.id === 'availability') return probe.status === 'down' ? 0 : 100;
    if (check.id === 'latency') return probe.status === 'down' ? null : probe.latencyMs;
    if (check.id === 'services') {
      const total = probe.values.servicesTotal;
      const up = probe.values.servicesUp;
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(up)) return null;
      return Math.round((up / total) * 1000) / 10;
    }
    return Number.isFinite(probe.values[check.id]) ? probe.values[check.id] : null;
  }

  function checkStatus(check, value) {
    if (value === null || value === undefined) return 'unknown';
    if (check.direction === 'below') {
      if (value <= check.crit) return 'crit';
      if (value <= check.warn) return 'warn';
      return 'ok';
    }
    if (value >= check.crit) return 'crit';
    if (value >= check.warn) return 'warn';
    return 'ok';
  }

  function checkRows(state, asset, probe) {
    return checksFor(state, asset).map((check) => {
      const value = valueOf(probe, check);
      const services = check.id === 'services' && probe ? probe.values : null;
      return {
        check: check,
        value: value,
        status: checkStatus(check, value),
        // Services keep the raw counters so the UI can show "3 de 4" next to
        // the percentage, but the threshold is evaluated on the ratio.
        up: services && Number.isFinite(services.servicesUp) ? services.servicesUp : null,
        total: services && Number.isFinite(services.servicesTotal) ? services.servicesTotal : null
      };
    });
  }

  function deviceStatus(state, asset) {
    if (!isMonitored(state, asset)) return 'unmonitored';
    const probe = probeOf(state, asset.id);
    if (!probe) return 'unmonitored';
    if (probe.status === 'down') return 'down';
    const breached = checkRows(state, asset, probe).some((row) => row.status === 'warn' || row.status === 'crit');
    if (breached || probe.status === 'degraded') return 'degraded';
    return 'up';
  }

  function alertsFor(assets, alerts, assetId) {
    return (Array.isArray(alerts) ? alerts : []).filter((alert) => alert.assetId === assetId);
  }

  function deviceRow(state, asset, alerts, now) {
    const monitored = isMonitored(state, asset);
    const probe = monitored ? probeOf(state, asset.id) : null;
    const status = deviceStatus(state, asset);
    return {
      asset: asset,
      monitored: monitored,
      probe: probe,
      status: status,
      statusMeta: statusMeta(status),
      checks: probe ? checkRows(state, asset, probe) : [],
      latencyMs: probe && probe.status !== 'down' ? probe.latencyMs : null,
      uptimePct: probe ? probe.uptimePct : null,
      uptimeDays: probe ? probe.uptimeDays : null,
      lastCheckAt: probe ? probe.lastCheckAt : '',
      intervalMinutes: intervalFor(state, asset),
      downSince: probe ? probe.downSince : '',
      alerts: alertsFor(null, alerts, asset.id),
      openAlerts: alertsFor(null, alerts, asset.id).filter((alert) => alert.state === 'open').length,
      staleMinutes: probe ? Math.max(0, Math.round((now - Date.parse(probe.lastCheckAt)) / 60000)) : null
    };
  }

  function deviceRows(state, assets, alerts, now) {
    const reference = now || Date.now();
    return (assets || []).map((asset) => deviceRow(state, asset, alerts, reference));
  }

  function stats(state, assets, alerts, now) {
    const rows = deviceRows(state, assets, alerts, now);
    const monitored = rows.filter((row) => row.monitored);
    const up = monitored.filter((row) => row.status === 'up');
    const degraded = monitored.filter((row) => row.status === 'degraded');
    const down = monitored.filter((row) => row.status === 'down');
    const unm = rows.length - monitored.length;
    const active = (alerts || []).filter((alert) => alert.state === 'open');
    const unread = (state.notifications || []).filter((item) => !item.readAt);
    const uptimeValues = monitored.filter((row) => Number.isFinite(row.uptimePct)).map((row) => row.uptimePct);
    const latencyValues = monitored.filter((row) => Number.isFinite(row.latencyMs)).map((row) => row.latencyMs);
    return {
      total: rows.length,
      monitored: monitored.length,
      up: up.length,
      degraded: degraded.length,
      down: down.length,
      unmonitored: unm,
      availability: uptimeValues.length
        ? Math.round((uptimeValues.reduce((total, value) => total + value, 0) / uptimeValues.length) * 100) / 100
        : null,
      latency: latencyValues.length
        ? Math.round(latencyValues.reduce((total, value) => total + value, 0) / latencyValues.length)
        : null,
      activeAlerts: active.length,
      criticalAlerts: active.filter((alert) => alert.severity === 'critica').length,
      unacknowledged: active.filter((alert) => !alert.acknowledgedAt).length,
      silenced: active.filter((alert) => activeSilence(state, alert, now).silenced).length,
      notifications: unread.length,
      pending: unread.filter((item) => item.severity === 'critica' || item.severity === 'alta').length
    };
  }

  // ---------------------------------------------------------------- series
  function rng(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointLabel(date, range) {
    if (range.id === '24h') return pad(date.getHours()) + ':00';
    if (range.id === '7d') return dayShort(date.getDay()) + ' ' + pad(date.getHours()) + 'h';
    return date.getDate() + ' ' + monthShort(date.getMonth());
  }

  function pointsFor(rangeId, now) {
    const range = rangeMeta(rangeId);
    const reference = now || Date.now();
    const points = [];
    for (let index = 0; index < range.points; index += 1) {
      const offset = (range.points - 1 - index) * range.stepHours * 3600000;
      const date = new Date(reference - offset);
      points.push({ index: index, at: date.toISOString(), label: pointLabel(date, range) });
    }
    return { range: range, points: points };
  }

  function availabilitySeries(state, asset, rangeId, now) {
    const probe = probeOf(state, asset.id);
    if (!probe) return [];
    const built = pointsFor(rangeId, now);
    const count = built.points.length;
    const random = rng(Data.hash(asset.id + ':' + built.range.id + ':availability'));
    const base = clamp(probe.uptimePct, 60, 100);
    const dips = [];
    if (probe.status === 'down') {
      dips.push({ index: count - 1, depth: 100 });
    } else if (probe.status === 'degraded') {
      dips.push({ index: Math.max(1, Math.round(count * 0.32)), depth: base - 97.2 });
      dips.push({ index: Math.max(2, Math.round(count * 0.71)), depth: base - 96.4 });
    }
    return built.points.map((point) => {
      const dip = dips.find((entry) => entry.index === point.index);
      let value = base + (random() * 0.12 - 0.04);
      if (dip) value = dip.depth >= 90 ? 0 : clamp(base - dip.depth, 0, 100);
      return {
        at: point.at,
        label: point.label,
        value: Math.round(clamp(value, 0, 100) * 100) / 100
      };
    });
  }

  function latencySeries(state, asset, rangeId, now) {
    const probe = probeOf(state, asset.id);
    if (!probe || probe.status === 'down') return [];
    const built = pointsFor(rangeId, now);
    const random = rng(Data.hash(asset.id + ':' + built.range.id + ':latency'));
    const base = Math.max(1, probe.latencyMs);
    const spikes = probe.status === 'degraded' ? [Math.round(built.points.length * 0.4), Math.round(built.points.length * 0.85)] : [];
    return built.points.map((point, index) => {
      let value = base * (0.78 + random() * 0.44);
      if (spikes.indexOf(index) !== -1) value = base * (1.8 + random());
      return {
        at: point.at,
        label: point.label,
        value: Math.round(value * 10) / 10
      };
    });
  }

  function aggregate(state, assets, rangeId, key, now) {
    const rows = (assets || []).filter((asset) => isMonitored(state, asset));
    if (!rows.length) return [];
    const built = pointsFor(rangeId, now);
    return built.points.map((point, index) => {
      const values = rows.map((asset) => {
        const series = key === 'latency'
          ? latencySeries(state, asset, rangeId, now)
          : availabilitySeries(state, asset, rangeId, now);
        const entry = series[index];
        return entry ? entry.value : null;
      }).filter((value) => value !== null && Number.isFinite(value));
      return {
        at: point.at,
        label: point.label,
        value: values.length
          ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100
          : null
      };
    });
  }

  function aggregateAvailability(state, assets, rangeId, now) {
    return aggregate(state, assets, rangeId, 'availability', now);
  }

  function aggregateLatency(state, assets, rangeId, now) {
    return aggregate(state, assets, rangeId, 'latency', now);
  }

  // ---------------------------------------------------------------- alerts
  function activeSilence(state, alert, now) {
    const reference = now || Date.now();
    if (alert.silencedUntil && Date.parse(alert.silencedUntil) > reference) {
      return { silenced: true, until: alert.silencedUntil, reason: alert.silenceReason || '', scope: 'alert' };
    }
    const silences = (state.silences || []).filter((silence) => Date.parse(silence.until) > reference);
    const match = silences.find((silence) => silence.scope === 'asset' && silence.target === alert.assetId);
    if (match) return { silenced: true, until: match.until, reason: match.reason, scope: 'asset', silenceId: match.id };
    return { silenced: false, until: '', reason: '', scope: '' };
  }

  function silenceMatchesAsset(state, silence, assets, assetId) {
    if (silence.scope === 'asset') return silence.target === assetId;
    const asset = (assets || []).find((item) => item.id === assetId);
    return !!asset && asset.category === silence.target;
  }

  function assetSilence(state, assets, assetId, now) {
    const reference = now || Date.now();
    return (state.silences || []).find((silence) => Date.parse(silence.until) > reference && silenceMatchesAsset(state, silence, assets, assetId)) || null;
  }

  function alertRow(state, alert, assets, now) {
    const asset = (assets || []).find((item) => item.id === alert.assetId) || null;
    const silence = activeSilence(state, alert, now);
    return {
      alert: alert,
      asset: asset,
      severity: severityMeta(alert.severity),
      state: alertStateMeta(alert.state),
      kind: alertKindMeta(alert.kind),
      acknowledged: !!alert.acknowledgedAt,
      silenced: silence.silenced,
      silence: silence,
      events: Array.isArray(alert.events) ? alert.events.slice() : [],
      groupCount: Math.max(1, num(alert.groupCount, 1)),
      lastEventAt: alert.lastEventAt || alert.detectedAt,
      active: alert.state === 'open',
      incidentId: alert.incidentId || ''
    };
  }

  function alertMatches(state, alert, assets, filters, now) {
    const input = filters || {};
    const asset = (assets || []).find((item) => item.id === alert.assetId) || null;
    const term = text(input.query).toLocaleLowerCase('es');
    if (term) {
      const haystack = [
        alert.id, alert.message, alert.kind, alert.severity, alert.incidentId,
        asset ? asset.name : '', asset ? asset.id : '', asset ? asset.type : ''
      ].join(' ').toLocaleLowerCase('es');
      if (haystack.indexOf(term) === -1) return false;
    }
    if (input.severity && input.severity !== 'all' && alert.severity !== input.severity) return false;
    if (input.state && input.state !== 'all') {
      if (input.state === 'history') {
        if (alert.state === 'open') return false;
      } else if (input.state === 'active') {
        if (alert.state !== 'open') return false;
      } else if (alert.state !== input.state) {
        return false;
      }
    }
    if (input.category && input.category !== 'all' && (!asset || asset.category !== input.category)) return false;
    if (input.site && input.site !== 'all' && (!asset || asset.site !== input.site)) return false;
    if (input.assetId && input.assetId !== 'all' && alert.assetId !== input.assetId) return false;
    if (input.ack === 'yes' && !alert.acknowledgedAt) return false;
    if (input.ack === 'no' && alert.acknowledgedAt) return false;
    if (input.silenced === 'yes' && !activeSilence(state, alert, now).silenced) return false;
    if (input.silenced === 'no' && activeSilence(state, alert, now).silenced) return false;
    return true;
  }

  function sortAlerts(list) {
    return list.slice().sort((a, b) => {
      const openDiff = (b.state === 'open' ? 1 : 0) - (a.state === 'open' ? 1 : 0);
      if (openDiff) return openDiff;
      const rank = severityRank(b.severity) - severityRank(a.severity);
      if (rank) return rank;
      return Date.parse(b.lastEventAt || b.detectedAt) - Date.parse(a.lastEventAt || a.detectedAt);
    });
  }

  function filteredAlerts(state, alerts, assets, filters, now) {
    return sortAlerts((alerts || []).filter((alert) => alertMatches(state, alert, assets, filters, now)));
  }

  function thresholdText(alert) {
    if (!alert.threshold) return '';
    const check = checkById({ checks: Data.CHECKS }, alert.threshold.checkId);
    const unit = alert.threshold.unit || (check ? check.unit : '');
    const value = alert.threshold.value;
    const limit = alert.threshold.limit;
    if (value === undefined || limit === undefined) return '';
    const key = check && check.direction === 'below' ? 'ui.monitoring.threshold.below' : 'ui.monitoring.threshold.above';
    return tr(key, { value: value, unit: unit, limit: limit });
  }

  // ---------------------------------------------------------------- mutations
  function logEvent(alert, type, message, at) {
    alert.events = Array.isArray(alert.events) ? alert.events : [];
    alert.events.unshift({
      id: 'ev-' + alert.id + '-' + (alert.events.length + 1),
      at: at || nowIso(),
      type: type,
      text: message
    });
    alert.events = alert.events.slice(0, 24);
    alert.lastEventAt = (alert.events[0] || {}).at || alert.detectedAt;
    return alert.events[0];
  }

  function pushHistory(asset, title, detail, extra) {
    if (!asset || !window.AssetSchema) return null;
    const entry = window.AssetSchema.historyEntry('monitoring', title, detail, extra || {});
    asset.history = Array.isArray(asset.history) ? asset.history : [];
    asset.history.unshift(entry);
    if (asset.history.length > HISTORY_LIMIT) asset.history.length = HISTORY_LIMIT;
    return entry;
  }

  function notify(state, payload) {
    const input = payload || {};
    const entry = {
      id: 'not-' + Date.now().toString(36) + '-' + Math.round(Math.random() * 1000),
      kind: ['alert', 'incident', 'maintenance', 'system'].indexOf(input.kind) !== -1 ? input.kind : 'alert',
      severity: Data.PRIORITIES.some((item) => item.id === input.severity) ? input.severity : 'media',
      title: text(input.title, tr('ui.monitoring.notice.default_title')).slice(0, 140),
      body: text(input.body).slice(0, 300),
      at: nowIso(),
      readAt: '',
      alertId: text(input.alertId),
      incidentId: text(input.incidentId),
      assetId: text(input.assetId),
      channels: Array.isArray(input.channels) ? input.channels.filter((id) => id === 'smtp' || id === 'telegram') : []
    };
    state.notifications = [entry].concat(Array.isArray(state.notifications) ? state.notifications : []).slice(0, NOTIFICATION_LIMIT);
    return entry;
  }

  function acknowledge(state, maintenance, alertId, context) {
    const ctx = context || {};
    const alert = ((maintenance || {}).alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: [tr('ui.monitoring.error.alert_missing')] };
    if (alert.acknowledgedAt) return { ok: false, errors: [tr('ui.monitoring.error.alert_acknowledged')] };
    alert.acknowledgedAt = nowIso();
    alert.acknowledgedBy = text(ctx.actor, tr('ui.monitoring.actor.administrator'));
    logEvent(alert, 'acknowledged', tr('ui.monitoring.log.acknowledged', { actor: alert.acknowledgedBy }));
    return { ok: true, errors: [], alert: alert };
  }

  function silence(state, maintenance, alertId, hours, reason, context) {
    const ctx = context || {};
    const alert = ((maintenance || {}).alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: [tr('ui.monitoring.error.alert_missing')] };
    const span = clamp(Math.round(num(hours, 4)), 1, 168);
    alert.silencedUntil = new Date(Date.now() + span * 3600000).toISOString();
    alert.silenceReason = text(reason).slice(0, 200);
    logEvent(alert, 'silenced', tr('ui.monitoring.log.silenced', {
      hours: span,
      actor: text(ctx.actor, tr('ui.monitoring.actor.administrator'))
    }));
    return { ok: true, errors: [], alert: alert };
  }

  function clearSilence(state, maintenance, alertId) {
    const alert = ((maintenance || {}).alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: [tr('ui.monitoring.error.alert_missing')] };
    alert.silencedUntil = '';
    alert.silenceReason = '';
    logEvent(alert, 'unsilenced', tr('ui.monitoring.log.unsilenced'));
    return { ok: true, errors: [], alert: alert };
  }

  function recoverDevice(state, maintenance, assets, assetId, context) {
    const ctx = context || {};
    const asset = (assets || []).find((entry) => entry.id === assetId);
    const probe = probeOf(state, assetId);
    if (!asset || !probe) return { ok: false, errors: [tr('ui.monitoring.error.device_unmonitored')], recovered: 0 };
    if (probe.status === 'up') return { ok: false, errors: [tr('ui.monitoring.error.device_available')], recovered: 0 };
    probe.status = 'up';
    probe.downSince = '';
    probe.lastCheckAt = nowIso();
    probe.latencyMs = Math.max(1, probe.latencyMs || 4);
    probe.checks = (probe.checks || 0) + 1;
    // Services stopped because the device was unreachable, not because of a
    // service fault: the simulated recovery restores them with the link.
    if (Number.isFinite(probe.values.servicesTotal)) {
      probe.values.servicesUp = probe.values.servicesTotal;
    }
    const incidents = (maintenance || {}).incidents || [];
    const open = ((maintenance || {}).alerts || []).filter((alert) => alert.assetId === assetId && alert.state === 'open');
    open.forEach((alert) => {
      alert.recoveredAt = nowIso();
      alert.state = 'recovered';
      logEvent(alert, 'recovered', tr('ui.monitoring.log.recovered'));
      const incident = incidents.find((entry) => entry.id === alert.incidentId) || null;
      alert.suggestion = !!incident && incident.state !== 'resuelto' && incident.state !== 'cerrado';
    });
    pushHistory(asset, tr('ui.monitoring.history.recovery_detected'),
      open.length
        ? tr('ui.monitoring.history.recovery_open', { ids: open.map((alert) => alert.id).join(', ') })
        : tr('ui.monitoring.history.recovery_detail'),
      { actor: text(ctx.actor, tr('ui.monitoring.actor.administrator')), movement: 'monitoring' });
    notify(state, {
      kind: 'alert',
      severity: 'media',
      title: tr('ui.monitoring.notice.recovered_title', { asset: asset.name }),
      body: open.length
        ? tr('ui.monitoring.notice.recovered_body', { count: open.length })
        : tr('ui.monitoring.notice.recovered_body_idle'),
      assetId: asset.id,
      alertId: open.length ? open[0].id : ''
    });
    return { ok: true, errors: [], recovered: open.length, asset: asset, alerts: open };
  }

  function resolveAlert(state, maintenance, assets, alertId, context) {
    const ctx = context || {};
    const alert = ((maintenance || {}).alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: [tr('ui.monitoring.error.alert_missing')] };
    if (alert.state === 'resolved') return { ok: false, errors: [tr('ui.monitoring.error.alert_resolved')] };
    if (!alert.recoveredAt && alert.state === 'open') {
      return { ok: false, errors: [tr('ui.monitoring.error.alert_active')] };
    }
    alert.state = 'resolved';
    alert.resolvedAt = nowIso();
    alert.resolvedBy = text(ctx.actor, tr('ui.monitoring.actor.administrator'));
    alert.suggestion = false;
    logEvent(alert, 'resolved', tr('ui.monitoring.log.resolved', { actor: alert.resolvedBy }));
    const asset = (assets || []).find((entry) => entry.id === alert.assetId);
    pushHistory(asset, tr('ui.monitoring.history.alert_resolved'),
      alert.id + ' · ' + alert.message,
      { actor: alert.resolvedBy, movement: 'monitoring' });
    return { ok: true, errors: [], alert: alert };
  }

  function createAlert(state, maintenance, assets, payload, context) {
    const ctx = context || {};
    const input = payload || {};
    const asset = (assets || []).find((entry) => entry.id === input.assetId);
    if (!asset || !maintenance) return { ok: false, errors: [tr('ui.monitoring.error.device_missing')], alert: null };
    maintenance.alerts = Array.isArray(maintenance.alerts) ? maintenance.alerts : [];
    const nextNumber = maintenance.alerts.reduce((max, alert) => {
      const match = /^ALT-(\d+)$/.exec(alert.id || '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 2400) + 1;
    const alert = {
      id: 'ALT-' + nextNumber,
      assetId: asset.id,
      checkId: text(input.checkId),
      kind: text(input.kind, 'offline'),
      severity: Data.PRIORITIES.some((item) => item.id === input.severity) ? input.severity : 'alta',
      message: text(input.message, tr('ui.monitoring.log.out_of_range', { asset: asset.name })).slice(0, 240),
      detectedAt: nowIso(),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 1,
      lastEventAt: nowIso(),
      events: [{ id: 'ev-' + nextNumber + '-1', at: nowIso(), type: 'detected', text: text(input.detail, tr('ui.monitoring.log.first_detection')) }]
    };
    if (input.threshold) alert.threshold = clone(input.threshold);
    maintenance.alerts.unshift(alert);
    pushHistory(asset, tr('ui.monitoring.history.alert_created'), alert.id + ' · ' + alert.message, { actor: text(ctx.actor, tr('ui.monitoring.actor.monitoring')), movement: 'monitoring' });
    notify(state, {
      kind: 'alert', severity: alert.severity, title: asset.name + ' · ' + alertKindMeta(alert.kind).label,
      body: alert.message, alertId: alert.id, assetId: asset.id, channels: ['smtp']
    });
    return { ok: true, errors: [], alert: alert };
  }

  function evaluateAlert(state, maintenance, assets, assetId, context) {
    const asset = (assets || []).find((entry) => entry.id === assetId);
    const probe = probeOf(state, assetId);
    if (!asset || !probe) return { created: null };
    const open = ((maintenance || {}).alerts || []).filter((alert) => alert.assetId === assetId && alert.state === 'open');
    if (probe.status === 'down') {
      // A device that does not answer produces one availability alert, never a
      // second one for every metric the silence of the device makes invalid.
      if (open.some((alert) => alert.checkId === 'availability')) return { created: null };
      const result = createAlert(state, maintenance, assets, {
        assetId: assetId,
        checkId: 'availability',
        kind: 'offline',
        severity: 'alta',
        message: tr('ui.monitoring.log.no_response'),
        detail: tr('ui.monitoring.log.no_response_detail'),
        threshold: { checkId: 'availability', value: 0, limit: 99, unit: '%' }
      }, context);
      return { created: result.alert };
    }
    const breached = checkRows(state, asset, probe)
      .filter((row) => row.status === 'crit' && row.check.id !== 'availability' && !open.some((alert) => alert.checkId === row.check.id));
    if (breached.length) {
      const row = breached[0];
      const result = createAlert(state, maintenance, assets, {
        assetId: assetId,
        checkId: row.check.id,
        kind: row.check.id === 'services' ? 'services' : (row.check.id === 'latency' ? 'latency' : 'temperature'),
        severity: 'alta',
        message: tr('ui.monitoring.log.threshold', {
          check: row.check.label,
          value: row.value,
          unit: row.check.unit,
          limit: row.check.crit
        }),
        detail: tr('ui.monitoring.log.auto_detection', { check: row.check.label }),
        threshold: { checkId: row.check.id, value: row.value, limit: row.check.crit, unit: row.check.unit }
      }, context);
      return { created: result.alert };
    }
    return { created: null };
  }

  function sweep(state, maintenance, assets, context) {
    const ctx = context || {};
    const list = (assets || []).filter((asset) => isMonitored(state, asset));
    const started = nowIso();
    let created = 0;
    list.forEach((asset) => {
      const probe = ensureProbe(state, asset);
      if (!probe) return;
      probe.checks = (probe.checks || 0) + 1;
      probe.lastCheckAt = nowIso();
      if (probe.status !== 'down') {
        const drift = (Data.hash(asset.id + ':' + probe.checks) % 7) - 3;
        probe.latencyMs = clamp(probe.latencyMs + drift, 1, 900);
      }
      const result = evaluateAlert(state, maintenance, assets, asset.id, ctx);
      if (result.created) created += 1;
    });
    return {
      ok: true,
      started: started,
      checked: list.length,
      created: created,
      down: list.filter((asset) => deviceStatus(state, asset) === 'down').length,
      degraded: list.filter((asset) => deviceStatus(state, asset) === 'degraded').length
    };
  }

  function convertToIncident(state, maintenance, assets, alertId, payload, context) {
    const ctx = context || {};
    if (!MaintEngine.createFromAlert) return { ok: false, errors: [tr('ui.monitoring.error.maintenance_module')], incident: null };
    const alert = ((maintenance || {}).alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: [tr('ui.monitoring.error.alert_missing')], incident: null };
    const result = MaintEngine.createFromAlert(maintenance, assets, alertId, payload || {}, {
      actor: text(ctx.actor, tr('ui.monitoring.actor.administrator')),
      actorId: text(ctx.actorId)
    });
    if (!result.ok) return result;
    logEvent(alert, 'converted', tr('ui.monitoring.log.converted', { id: result.incident.id }));
    notify(state, {
      kind: 'incident',
      severity: alert.severity,
      title: tr('ui.monitoring.notice.incident_created', { id: result.incident.id, alertId: alert.id }),
      body: result.incident.title,
      alertId: alert.id,
      incidentId: result.incident.id,
      assetId: alert.assetId
    });
    return result;
  }

  // ---------------------------------------------------------------- escalation
  function minutesOf(value) {
    const parts = String(value || '00:00').split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function inBusinessHours(state, date) {
    const prefs = state.prefs.businessHours;
    const reference = date || new Date();
    if (prefs.days.indexOf(reference.getDay()) === -1) return false;
    const minutes = reference.getHours() * 60 + reference.getMinutes();
    return minutes >= minutesOf(prefs.from) && minutes < minutesOf(prefs.to);
  }

  function windowFor(state, alert, assets, date) {
    const asset = (assets || []).find((item) => item.id === alert.assetId) || null;
    const reference = date || new Date();
    const minutes = reference.getHours() * 60 + reference.getMinutes();
    return (state.windows || []).find((window) => {
      if (!window.active) return false;
      if (window.days.indexOf(reference.getDay()) === -1) return false;
      const start = minutesOf(window.start);
      const end = minutesOf(window.end);
      const inside = end >= start
        ? minutes >= start && minutes <= end
        : minutes >= start || minutes <= end;
      if (!inside) return false;
      if (window.categories.length && (!asset || window.categories.indexOf(asset.category) === -1)) return false;
      if (window.sites.length && (!asset || window.sites.indexOf(asset.site) === -1)) return false;
      return true;
    }) || null;
  }

  // The channel label is a live getter: a channel state or an escalation plan
  // can be kept between renders and still follow a locale switch.
  function channelStateEntry(id, configured, enabled) {
    const entry = { id: id, configured: configured, enabled: enabled };
    Object.defineProperty(entry, 'label', {
      enumerable: true,
      configurable: true,
      get: function () { return channelMeta(id).label; }
    });
    return entry;
  }

  function channelState(state, id) {
    const channel = (state.channels || {})[id];
    if (!channel) return channelStateEntry(id, false, false);
    if (id === 'smtp') {
      const configured = !!(channel.host && channel.from && channel.recipients);
      return channelStateEntry(id, configured, channel.enabled);
    }
    const configured = !!(channel.botName && channel.token && channel.chatIds);
    return channelStateEntry(id, configured, channel.enabled === true);
  }

  function ruleMatches(rule, alert, assets, state) {
    if (!rule.enabled) return false;
    if (rule.severity && rule.severity !== alert.severity) return false;
    const asset = (assets || []).find((item) => item.id === alert.assetId) || null;
    if (rule.categories.length && (!asset || rule.categories.indexOf(asset.category) === -1)) return false;
    if (rule.sites.length && (!asset || rule.sites.indexOf(asset.site) === -1)) return false;
    if (rule.window === 'business' && !inBusinessHours(state, new Date())) return false;
    if (rule.window === 'after_hours' && inBusinessHours(state, new Date())) return false;
    return true;
  }

  function escalationPlan(state, alert, assets, now) {
    const reference = now || Date.now();
    const silence = activeSilence(state, alert, reference);
    const window = windowFor(state, alert, assets, new Date(reference));
    const items = (state.escalations || []).map((rule) => {
      const applicable = ruleMatches(rule, alert, assets, state);
      const at = Date.parse(alert.detectedAt) + rule.afterMinutes * 60000;
      const channels = rule.channels.map((id) => {
        const status = channelState(state, id);
        return channelStateEntry(id, status.configured, status.enabled);
      });
      let status = 'scheduled';
      if (!applicable) status = 'skipped';
      else if (rule.requireUnack && alert.acknowledgedAt) status = 'acknowledged';
      else if (silence.silenced) status = 'silenced';
      else if (window) status = 'window';
      else if (channels.some((channel) => !channel.configured)) status = 'channel';
      else if (!channels.some((channel) => channel.enabled)) status = 'disabled';
      else if (alert.state !== 'open') status = 'closed';
      else if (at <= reference) status = 'sent';
      return {
        rule: rule,
        at: new Date(at).toISOString(),
        status: status,
        channels: channels,
        applicable: applicable
      };
    });
    const next = items.find((item) => item.status === 'scheduled') || null;
    return { items: items, next: next, silence: silence, window: window };
  }

  const TEMPLATE_KEYS = ['severity', 'asset', 'site', 'title', 'message', 'detectedAt', 'state', 'link', 'incident'];

  function formatStamp(value) {
    const api = runtime();
    // formatDate is the exact-options entry point: dateStyle/timeStyle cannot be
    // merged with the day/month/year bundle datetime() applies.
    return api ? api.formatDate(value, { dateStyle: 'short', timeStyle: 'short' }) : '';
  }

  function templateContext(alert, assets) {
    const asset = (assets || []).find((item) => item.id === alert.assetId) || null;
    return {
      severity: severityMeta(alert.severity).label,
      asset: asset ? asset.name : alert.assetId,
      site: asset ? asset.site : '',
      title: alertKindMeta(alert.kind).label,
      message: alert.message,
      detectedAt: formatStamp(alert.detectedAt),
      state: alertStateMeta(alert.state).label,
      link: '#/supervision/alerta/' + alert.id,
      incident: alert.incidentId || tr('ui.monitoring.template.no_incident')
    };
  }

  function renderTemplate(template, context) {
    return String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : match;
    });
  }

  function preview(state, channelId, alert, assets) {
    const context = templateContext(alert, assets);
    const channel = (state.channels || {})[channelId] || {};
    if (channelId === 'smtp') {
      return {
        subject: renderTemplate(channel.subject || '', context),
        body: renderTemplate(channel.template || '', context),
        from: (channel.fromName ? channel.fromName + ' <' + channel.from + '>' : channel.from) || '',
        to: channel.recipients || ''
      };
    }
    return {
      body: renderTemplate(channel.template || '', context),
      chat: channel.chatIds || '',
      bot: channel.botName || '',
      mode: channel.parseMode || 'Markdown'
    };
  }

  // ---------------------------------------------------------------- config
  function saveThresholds(state, payload) {
    const input = payload || {};
    const check = checkById(state, input.id);
    if (!check) return { ok: false, errors: [tr('ui.monitoring.error.check_missing')] };
    const warn = num(input.warn, check.warn);
    const crit = num(input.crit, check.crit);
    if (check.direction === 'above' && crit <= warn) {
      return { ok: false, errors: [tr('ui.monitoring.error.threshold_above')] };
    }
    if (check.direction === 'below' && crit >= warn) {
      return { ok: false, errors: [tr('ui.monitoring.error.threshold_below')] };
    }
    check.warn = Math.round(warn * 100) / 100;
    check.crit = Math.round(crit * 100) / 100;
    return { ok: true, errors: [], check: check };
  }

  function savePolicy(state, category, payload) {
    const input = payload || {};
    const policy = policyFor(state, category);
    if (!policy) return { ok: false, errors: [tr('ui.monitoring.error.category_missing')] };
    const validIds = state.checks.map((check) => check.id);
    const checkIds = (Array.isArray(input.checkIds) ? input.checkIds : policy.checkIds)
      .filter((id, index, all) => validIds.indexOf(id) !== -1 && all.indexOf(id) === index);
    if (input.enabled !== false && !checkIds.length) {
      return { ok: false, errors: [tr('ui.monitoring.error.policy_checks')] };
    }
    policy.enabled = input.enabled !== false;
    policy.intervalMinutes = clamp(Math.round(num(input.intervalMinutes, policy.intervalMinutes)), 1, 1440);
    policy.checkIds = checkIds.length ? checkIds : policy.checkIds;
    return { ok: true, errors: [], policy: policy };
  }

  function saveException(state, assetId, payload) {
    const input = payload || {};
    const asset = input.asset || null;
    const id = text(assetId, input.assetId);
    if (!id) return { ok: false, errors: [tr('ui.monitoring.error.asset_required')] };
    const validIds = state.checks.map((check) => check.id);
    let exception = exceptionFor(state, id);
    if (!exception) {
      exception = { assetId: id, enabled: true, intervalMinutes: 15, checkIds: ['availability'] };
      state.exceptions.push(exception);
    }
    const checkIds = (Array.isArray(input.checkIds) ? input.checkIds : exception.checkIds)
      .filter((checkId, index, all) => validIds.indexOf(checkId) !== -1 && all.indexOf(checkId) === index);
    if (input.enabled !== false && !checkIds.length) {
      return { ok: false, errors: [tr('ui.monitoring.error.exception_checks')] };
    }
    exception.enabled = input.enabled !== false;
    exception.intervalMinutes = clamp(Math.round(num(input.intervalMinutes, exception.intervalMinutes)), 1, 1440);
    exception.checkIds = checkIds.length ? checkIds : exception.checkIds;
    if (asset) ensureProbe(state, asset);
    return { ok: true, errors: [], exception: exception };
  }

  function removeException(state, assetId) {
    const index = (state.exceptions || []).findIndex((item) => item.assetId === assetId);
    if (index === -1) return { ok: false, errors: [tr('ui.monitoring.error.exception_missing')] };
    state.exceptions.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function addSilence(state, payload, context) {
    const input = payload || {};
    const scope = input.scope === 'category' ? 'category' : 'asset';
    const target = text(input.target);
    if (!target) return { ok: false, errors: [tr('ui.monitoring.error.silence_scope')] };
    const hours = clamp(Math.round(num(input.hours, 4)), 1, 720);
    if (state.silences.some((silence) => silence.scope === scope && silence.target === target)) {
      return { ok: false, errors: [tr('ui.monitoring.error.silence_exists')] };
    }
    state.silences.unshift({
      id: 'sil-' + Date.now().toString(36),
      scope: scope,
      target: target,
      until: new Date(Date.now() + hours * 3600000).toISOString(),
      reason: text(input.reason).slice(0, 200),
      createdAt: nowIso(),
      createdBy: text((context || {}).actor, tr('ui.monitoring.actor.administrator'))
    });
    return { ok: true, errors: [] };
  }

  function removeSilence(state, id) {
    const index = (state.silences || []).findIndex((silence) => silence.id === id);
    if (index === -1) return { ok: false, errors: [tr('ui.monitoring.error.silence_missing')] };
    state.silences.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function saveWindow(state, payload) {
    const input = payload || {};
    const label = text(input.label);
    if (!label) return { ok: false, errors: [tr('ui.monitoring.error.window_name')] };
    const days = (Array.isArray(input.days) ? input.days : [1, 2, 3, 4, 5])
      .map((day) => Math.round(num(day, -1)))
      .filter((day, index, all) => day >= 0 && day <= 6 && all.indexOf(day) === index);
    const target = input.id ? state.windows.find((window) => window.id === input.id) : null;
    const data = {
      label: label,
      start: validTime(input.start, '01:00'),
      end: validTime(input.end, '02:00'),
      days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
      categories: (Array.isArray(input.categories) ? input.categories : []).filter((id) => state.policies.some((policy) => policy.category === id)),
      sites: (Array.isArray(input.sites) ? input.sites : []).filter((id) => typeof id === 'string' && id),
      active: input.active !== false,
      reason: text(input.reason).slice(0, 200)
    };
    if (target) {
      Object.assign(target, data);
      return { ok: true, errors: [], window: target };
    }
    const window = Object.assign({ id: 'win-' + Date.now().toString(36) }, data);
    state.windows.push(window);
    return { ok: true, errors: [], window: window };
  }

  function removeWindow(state, id) {
    const index = (state.windows || []).findIndex((window) => window.id === id);
    if (index === -1) return { ok: false, errors: [tr('ui.monitoring.error.window_missing')] };
    state.windows.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function saveChannel(state, id, payload) {
    const input = payload || {};
    const channel = state.channels[id];
    if (!channel) return { ok: false, errors: [tr('ui.monitoring.error.channel_missing')] };
    if (id === 'smtp') {
      if (input.enabled && (!text(input.host) || !text(input.from) || !text(input.recipients))) {
        return { ok: false, errors: [tr('ui.monitoring.error.smtp_fields')] };
      }
      const port = Math.round(num(input.port, channel.port));
      if (!(port > 0 && port <= 65535)) return { ok: false, errors: [tr('ui.monitoring.error.port_range')] };
      Object.assign(channel, {
        enabled: input.enabled !== false,
        host: text(input.host),
        port: port,
        secure: input.secure !== false,
        from: text(input.from),
        fromName: text(input.fromName),
        recipients: text(input.recipients),
        subject: text(input.subject)
      });
      // The stored body only wins when the form actually sends one: copying the
      // catalog default back would freeze it in the language of the save.
      if (typeof input.template === 'string') channel.template = input.template;
      return { ok: true, errors: [], channel: channel };
    }
    if (input.enabled && (!text(input.botName) || !text(input.token) || !text(input.chatIds))) {
      return { ok: false, errors: [tr('ui.monitoring.error.telegram_fields')] };
    }
    Object.assign(channel, {
      enabled: input.enabled === true,
      botName: text(input.botName),
      token: text(input.token),
      chatIds: text(input.chatIds),
      template: typeof input.template === 'string' ? input.template : channel.template,
      parseMode: ['Markdown', 'HTML', 'Texto'].indexOf(input.parseMode) !== -1 ? input.parseMode : channel.parseMode
    });
    return { ok: true, errors: [], channel: channel };
  }

  function testChannel(state, id, context) {
    const status = channelState(state, id);
    if (!status.configured) return { ok: false, errors: [tr('ui.monitoring.error.channel_unconfigured')] };
    const channel = state.channels[id];
    channel.lastTestAt = nowIso();
    channel.lastTestResult = 'ok';
    notify(state, {
      kind: 'system',
      severity: 'baja',
      title: tr('ui.monitoring.notice.test_title', { channel: channelMeta(id).label }),
      body: tr('ui.monitoring.notice.test_body', { target: id === 'smtp' ? channel.recipients : channel.chatIds }),
      channels: [id]
    });
    return { ok: true, errors: [], actor: text((context || {}).actor, tr('ui.monitoring.actor.administrator')) };
  }

  function saveEscalation(state, payload) {
    const input = payload || {};
    const label = text(input.label);
    if (!label) return { ok: false, errors: [tr('ui.monitoring.error.rule_name')] };
    const channels = (Array.isArray(input.channels) ? input.channels : ['smtp']).filter((id) => id === 'smtp' || id === 'telegram');
    if (!channels.length) return { ok: false, errors: [tr('ui.monitoring.error.rule_channel')] };
    const target = input.id ? state.escalations.find((rule) => rule.id === input.id) : null;
    const data = {
      label: label,
      severity: Data.PRIORITIES.some((item) => item.id === input.severity) ? input.severity : '',
      categories: (Array.isArray(input.categories) ? input.categories : []).filter((id) => state.policies.some((policy) => policy.category === id)),
      sites: Array.isArray(input.sites) ? input.sites.filter((id) => typeof id === 'string' && id) : [],
      channels: channels,
      afterMinutes: clamp(Math.round(num(input.afterMinutes, 0)), 0, 10080),
      window: ['always', 'business', 'after_hours'].indexOf(input.window) !== -1 ? input.window : 'always',
      requireUnack: input.requireUnack !== false,
      recipients: text(input.recipients).slice(0, 300),
      enabled: input.enabled === true
    };
    if (target) {
      Object.assign(target, data);
      return { ok: true, errors: [], rule: target };
    }
    const rule = Object.assign({ id: 'esc-' + Date.now().toString(36) }, data);
    state.escalations.push(rule);
    return { ok: true, errors: [], rule: rule };
  }

  function removeEscalation(state, id) {
    const index = (state.escalations || []).findIndex((rule) => rule.id === id);
    if (index === -1) return { ok: false, errors: [tr('ui.monitoring.error.rule_missing')] };
    state.escalations.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function restoreEscalations(state) {
    state.escalations = clone(Data.ESCALATIONS);
    return { ok: true, errors: [] };
  }

  function savePrefs(state, payload) {
    state.prefs = normalizePrefs(Object.assign({}, state.prefs, payload || {}));
    return { ok: true, errors: [], prefs: state.prefs };
  }

  // ---------------------------------------------------------------- inbox
  function unreadNotifications(state) {
    return (state.notifications || []).filter((item) => !item.readAt);
  }

  function markNotificationRead(state, id) {
    const notification = (state.notifications || []).find((item) => item.id === id);
    if (!notification) return { ok: false, errors: [tr('ui.monitoring.error.notification_unavailable')] };
    if (!notification.readAt) notification.readAt = nowIso();
    return { ok: true, errors: [], notification: notification };
  }

  function markAllNotificationsRead(state) {
    const at = nowIso();
    (state.notifications || []).forEach((notification) => {
      if (!notification.readAt) notification.readAt = at;
    });
    return { ok: true, errors: [] };
  }

  function notificationMatches(notification, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'new') return !notification.readAt;
    if (filter === 'pending') return !notification.readAt && (notification.severity === 'alta' || notification.severity === 'critica');
    if (filter === 'read') return !!notification.readAt;
    if (filter === 'alert') return notification.kind === 'alert';
    if (filter === 'incident') return notification.kind === 'incident';
    if (filter === 'maintenance') return notification.kind === 'maintenance';
    return true;
  }

  // ---------------------------------------------------------------- exports
  window.AssetMonitorEngine = {
    DAY_MS,
    normalize,
    clone,
    text,
    num,
    bool,
    clamp,
    nowIso,
    isoOr,
    // selection
    checkById,
    policyFor,
    exceptionFor,
    isMonitored,
    intervalFor,
    checkIdsFor,
    checksFor,
    probeOf,
    ensureProbe,
    checkRows,
    checkStatus,
    deviceStatus,
    deviceRow,
    deviceRows,
    stats,
    // metadata
    severityMeta,
    severityRank,
    alertStateMeta,
    alertKindMeta,
    statusMeta,
    statusMetaOf: statusMeta,
    rangeMeta,
    notificationKindMeta,
    channelMeta,
    meta,
    // series
    pointsFor,
    availabilitySeries,
    latencySeries,
    aggregateAvailability,
    aggregateLatency,
    // alerts
    activeSilence,
    assetSilence,
    alertRow,
    alertMatches,
    filteredAlerts,
    sortAlerts,
    thresholdText,
    logEvent,
    // lifecycle
    acknowledge,
    silence,
    clearSilence,
    recoverDevice,
    resolveAlert,
    evaluateAlert,
    createAlert,
    sweep,
    convertToIncident,
    // escalation
    inBusinessHours,
    windowFor,
    channelState,
    escalationPlan,
    renderTemplate,
    templateContext,
    TEMPLATE_KEYS,
    preview,
    // config
    saveThresholds,
    savePolicy,
    saveException,
    removeException,
    addSilence,
    removeSilence,
    saveWindow,
    removeWindow,
    saveChannel,
    testChannel,
    saveEscalation,
    removeEscalation,
    restoreEscalations,
    savePrefs,
    // inbox
    notify,
    unreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    notificationMatches,
    pushHistory
  };
})();
