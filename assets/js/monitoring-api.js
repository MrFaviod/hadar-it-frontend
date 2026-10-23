/*
 * Phase 8 monitoring/notification adapter.
 *
 * The server is the only operational authority for checks, probe results,
 * alerts, silences, windows, notification channels and inbox state. This
 * module maps the REST DTOs to the shapes the original Vue views already use,
 * keeps a monotonic request epoch per resource, and clears everything on
 * logout, identity replacement or unmount. It never persists credentials or
 * monitoring data in the browser.
 */
(function () {
  'use strict';

  const DEFAULT_LIMIT = 100;
  const INBOX_LIMIT = 50;
  const ASSET_KEYS = ['enabled', 'checkType', 'target', 'intervalSeconds', 'metrics', 'thresholds', 'minimumDurationSeconds', 'exporterId', 'snmpModule', 'snmpAuthRef'];
  const PROFILE_KEYS = ['enabled', 'checkType', 'intervalSeconds', 'metrics', 'thresholds', 'minimumDurationSeconds', 'exporterId', 'snmpModule', 'snmpAuthRef'];
  const WINDOW_KEYS = ['name', 'assetIds', 'daysOfWeek', 'startTime', 'endTime', 'timezone', 'enabled'];
  const CHANNEL_KEYS = ['id', 'kind', 'name', 'enabled', 'secretRef', 'config'];
  const RULE_KEYS = ['id', 'name', 'enabled', 'minimumSeverity', 'recipientIds', 'channelIds', 'escalationRecipientIds', 'schedule', 'acknowledgeAfterSeconds', 'retryIntervalSeconds', 'escalateAfterSeconds', 'maxAttempts'];
  const RAW_SECRET_KEYS = ['token', 'password', 'secret', 'webhook', 'webhookurl', 'bottoken', 'apikey', 'api_key', 'authorization', 'url'];
  const STATUS_META = {
    up: { label: 'Disponible', tone: 'ok', icon: 'check' },
    degraded: { label: 'Degradado', tone: 'warn', icon: 'alert' },
    down: { label: 'No disponible', tone: 'down', icon: 'x-circle' },
    unmonitored: { label: 'Sin supervisión', tone: 'neutral', icon: 'minus' },
    no_data: { label: 'Sin datos', tone: 'neutral', icon: 'clock' },
    unavailable: { label: 'Sin lectura', tone: 'neutral', icon: 'plug' }
  };
  const SEVERITY_META = {
    critical: { label: 'Crítica', tone: 'down' },
    warning: { label: 'Alta', tone: 'warn' },
    info: { label: 'Media', tone: 'hold' }
  };
  const ALERT_STATE_META = {
    pending: { label: 'Pendiente', tone: 'hold', icon: 'clock' },
    firing: { label: 'Activa', tone: 'down', icon: 'alert' },
    resolved: { label: 'Resuelta', tone: 'ok', icon: 'check' }
  };
  const EVENT_LABELS = {
    opened: 'Alerta abierta',
    fired: 'Alerta activa',
    acknowledged: 'Alerta reconocida',
    resolved: 'Alerta resuelta',
    silenced: 'Alerta silenciada',
    unsilenced: 'Silencio retirado',
    incident_linked: 'Incidente vinculado',
    incident_created: 'Incidente creado',
    maintenance_prepared: 'Mantenimiento preparado'
  };
  const CHECK_META = {
    icmp: { label: 'ICMP', icon: 'activity' },
    http: { label: 'HTTP(S)', icon: 'globe' },
    tcp: { label: 'TCP', icon: 'network' },
    dns: { label: 'DNS', icon: 'search' },
    snmp: { label: 'SNMP', icon: 'server' },
    node: { label: 'Node exporter', icon: 'server' },
    windows: { label: 'Windows exporter', icon: 'monitor' }
  };

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback === undefined ? '' : fallback);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : !!fallback;
  }

  function list(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function copy(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function pageState() {
    return { items: [], total: 0, limit: DEFAULT_LIMIT, offset: 0, loaded: false, loading: false, error: '', epoch: 0, controller: null };
  }

  function singleState() {
    return { record: null, loaded: false, loading: false, error: '', missing: false, epoch: 0, controller: null };
  }

  function deviceState() {
    return Object.assign(singleState(), { assetId: '', period: '24h' });
  }

  function alertDetailState() {
    return Object.assign(singleState(), { alertId: '', history: pageState() });
  }

  function createState() {
    return {
      identity: '',
      session: 0,
      writeVersion: 0,
      devices: pageState(),
      overview: { period: '24h', loading: false, error: '', epoch: 0, controller: null },
      config: singleState(),
      windows: pageState(),
      assets: pageState(),
      prepared: null,
      alerts: pageState(),
      alertCounts: { pending: 0, firing: 0, resolved: 0, loaded: false },
      alertFilters: { state: 'firing', severity: '', assetId: '' },
      device: deviceState(),
      alertDetail: alertDetailState(),
      inbox: pageState(),
      inboxUnreadTotal: null,
      notificationConfig: singleState(),
      notificationTestStates: {}
    };
  }

  function statusMeta(id) {
    return STATUS_META[id] || STATUS_META.no_data;
  }

  function severityMeta(id) {
    return SEVERITY_META[id] || { label: id ? String(id) : '—', tone: 'hold' };
  }

  function alertStateMeta(id) {
    return ALERT_STATE_META[id] || { label: id ? String(id) : '—', tone: 'neutral', icon: 'activity' };
  }

  function checkMeta(id) {
    return CHECK_META[id] || { label: id ? String(id) : 'Comprobación', icon: 'activity' };
  }

  function reasonLabel(reason) {
    if (!reason) return '';
    if (reason === 'target_missing') return 'Sin destino configurado';
    if (reason === 'prometheus_unavailable') return 'Prometheus no disponible';
    return String(reason);
  }

  function imageForCategory(category) {
    const source = (window.ASSET_DATA && window.ASSET_DATA.categories) || [];
    const match = source.find((item) => item.id === category || item.slug === category);
    return match && match.image ? match.image : 'assets/svg/devices/other.svg';
  }

  function pointLabel(iso, period) {
    if (!iso) return '';
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return '';
    const options = period === '30d'
      ? { day: '2-digit', month: 'short' }
      : period === '7d'
        ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    return at.toLocaleString('es-ES', options).replace(',', '');
  }

  function mapAsset(source, fallback) {
    const data = source && typeof source === 'object' ? source : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const id = text(data.id, text(data.assetId, text(base.assetId)));
    const category = text(data.category, text(base.category));
    return {
      id,
      code: text(data.quickCode, text(base.quickCode)),
      quickCode: text(data.quickCode, text(base.quickCode)),
      name: text(data.name, text(base.name, text(base.assetName, id))),
      category: category || text(base.category),
      categoryText: category || text(base.category),
      type: text(data.type, category || text(base.category)),
      site: text(data.site, text(base.site)),
      siteId: text(data.siteId, text(base.siteId)),
      ip: text(data.ip, '—'),
      location: text(data.location, ''),
      serial: text(data.serial, ''),
      brand: text(data.brand, ''),
      model: text(data.model, ''),
      image: text(data.image, imageForCategory(category)),
      serverAsset: true
    };
  }

  function mapUptime(value) {
    if (!value || typeof value !== 'object') return { percent: null, samples: null };
    return { percent: num(value.percent), samples: num(value.samples) };
  }

  function mapLatency(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      averageMs: num(value.averageMs),
      p95Ms: num(value.p95Ms),
      currentMs: num(value.currentMs)
    };
  }

  function mapPoint(point, period) {
    const at = text(point && point.at);
    return { at, label: pointLabel(at, period), value: num(point && point.value) };
  }

  function mapSeries(series, period) {
    const points = list(series && series.points).map((point) => mapPoint(point, period));
    return {
      metric: text(series && series.metric, 'unknown'),
      unit: text(series && series.unit),
      points,
      pointCount: num(series && series.pointCount) === null ? points.length : num(series && series.pointCount)
    };
  }

  function mapCheck(check) {
    return {
      checkType: text(check && check.checkType, 'unknown'),
      module: text(check && check.module),
      state: text(check && check.state, 'unknown'),
      lastCheckAt: text(check && check.lastCheckAt),
      latencyMs: num(check && check.latencyMs)
    };
  }

  function mapConfig(config) {
    const data = config && typeof config === 'object' ? config : {};
    return {
      enabled: !!data.enabled,
      checkType: text(data.checkType),
      target: text(data.target),
      targetPresent: !!data.targetPresent,
      intervalSeconds: num(data.intervalSeconds),
      metrics: list(data.metrics),
      thresholds: data.thresholds && typeof data.thresholds === 'object' ? copy(data.thresholds) : {},
      minimumDurationSeconds: num(data.minimumDurationSeconds),
      exporterId: text(data.exporterId) || null,
      snmpModule: text(data.snmpModule) || null,
      snmpAuthRef: text(data.snmpAuthRef) || null,
      profileCategory: text(data.profileCategory),
      overridden: list(data.overridden)
    };
  }

  function mapProvenance(value, fallbackPeriod) {
    const data = value && typeof value === 'object' ? value : {};
    const period = data.period && typeof data.period === 'object' ? data.period : {};
    return {
      source: text(data.source, 'prometheus'),
      prometheusConfigured: data.prometheusConfigured !== undefined ? !!data.prometheusConfigured : null,
      period: {
        preset: text(period.preset, fallbackPeriod || '24h'),
        from: text(period.from),
        to: text(period.to),
        stepSeconds: num(period.stepSeconds)
      }
    };
  }

  function mapAlertEvent(event) {
    const action = text(event && event.action, 'event');
    const from = text(event && event.fromState);
    const to = text(event && event.toState);
    const actor = text(event && event.actor);
    const note = text(event && event.note);
    const transition = from || to ? (from || '—') + ' → ' + (to || '—') : '';
    return {
      id: text(event && event.id),
      at: text(event && event.createdAt),
      type: action,
      action,
      fromState: from,
      toState: to,
      actor,
      source: text(event && event.source),
      note,
      label: EVENT_LABELS[action] || action,
      text: [EVENT_LABELS[action] || action, transition, note, actor ? 'por ' + actor : ''].filter(Boolean).join(' · ')
    };
  }

  function mapSilence(silence) {
    return {
      id: text(silence && silence.id),
      assetId: text(silence && silence.assetId),
      alertId: text(silence && silence.alertId),
      comment: text(silence && silence.comment),
      startsAt: text(silence && silence.startsAt),
      endsAt: text(silence && silence.endsAt),
      source: text(silence && silence.source),
      nativeId: text(silence && silence.nativeId),
      active: !!silence && silence.active !== false
    };
  }

  function mapAlert(alert, period) {
    const data = alert && typeof alert === 'object' ? alert : {};
    const events = list(data.events).map(mapAlertEvent);
    const silences = list(data.silences).map(mapSilence);
    const state = text(data.state, 'pending');
    const severity = text(data.severity, 'warning');
    const stateInfo = alertStateMeta(state);
    const severityInfo = severityMeta(severity);
    const activeSilence = silences.find((item) => item.active) || null;
    return {
      id: text(data.id),
      fingerprint: text(data.fingerprint),
      alertName: text(data.alertName, 'Alerta'),
      severity,
      severityLabel: severityInfo.label,
      severityTone: severityInfo.tone,
      assetId: text(data.assetId),
      assetName: text(data.assetName),
      quickCode: text(data.quickCode),
      state,
      stateLabel: stateInfo.label,
      stateTone: stateInfo.tone,
      silenced: !!data.silenced || !!activeSilence,
      silencedUntil: activeSilence ? activeSilence.endsAt : '',
      acknowledged: !!data.acknowledged,
      acknowledgedAt: text(data.acknowledgedAt),
      acknowledgedBy: text(data.acknowledgedBy),
      notes: text(data.notes),
      startsAt: text(data.startsAt),
      endsAt: text(data.endsAt),
      lastSeenAt: text(data.lastSeenAt),
      source: text(data.source),
      groupKey: text(data.groupKey),
      summary: text(data.summary),
      description: text(data.description),
      message: text(data.summary) || text(data.description) || text(data.alertName, 'Alerta'),
      incident: data.incident && typeof data.incident === 'object'
        ? { id: text(data.incident.id), status: text(data.incident.status), suggestedClose: !!data.incident.suggestedClose }
        : null,
      maintenanceWindow: data.maintenanceWindow && typeof data.maintenanceWindow === 'object'
        ? { id: text(data.maintenanceWindow.id), name: text(data.maintenanceWindow.name) }
        : null,
      labels: data.labels && typeof data.labels === 'object' ? copy(data.labels) : {},
      annotations: data.annotations && typeof data.annotations === 'object' ? copy(data.annotations) : {},
      events,
      silences,
      fallbackPeriod: period || ''
    };
  }

  function alertRow(alert) {
    if (!alert) return null;
    return {
      alert,
      asset: { id: alert.assetId, name: alert.assetName || alert.assetId, quickCode: alert.quickCode },
      severity: { value: alert.severity, label: alert.severityLabel, tone: alert.severityTone },
      kind: alert.alertName,
      state: alert.state,
      stateLabel: alert.stateLabel,
      stateTone: alert.stateTone,
      acknowledged: alert.acknowledged,
      acknowledgedAt: alert.acknowledgedAt,
      acknowledgedBy: alert.acknowledgedBy,
      silenced: alert.silenced,
      silence: alert.silences.find((item) => item.active) || null,
      active: alert.state === 'firing' || alert.state === 'pending',
      incidentId: alert.incident ? alert.incident.id : '',
      lastEventAt: alert.lastSeenAt || alert.startsAt,
      detectedAt: alert.startsAt,
      recoveredAt: alert.state === 'resolved' ? alert.endsAt : '',
      resolvedAt: alert.state === 'resolved' ? alert.endsAt : '',
      resolvedBy: '',
      groupCount: 1,
      intermittent: false,
      message: alert.message
    };
  }

  function mapDeviceRow(device) {
    const data = device && typeof device === 'object' ? device : {};
    const status = text(data.status, 'no_data');
    const uptime = mapUptime(data.uptime);
    const asset = mapAsset({}, data);
    return {
      device: data,
      asset,
      assetId: text(data.assetId),
      monitored: status !== 'unmonitored',
      status,
      statusLabel: statusMeta(status).label,
      statusTone: statusMeta(status).tone,
      reason: text(data.reason),
      reasonLabel: reasonLabel(data.reason),
      monitoringEnabled: !!data.monitoringEnabled,
      checkType: text(data.checkType),
      target: text(data.target),
      intervalSeconds: num(data.intervalSeconds),
      intervalMinutes: num(data.intervalSeconds) === null ? null : Math.round(num(data.intervalSeconds) / 60),
      lastCheckAt: text(data.lastCheckAt),
      latencyMs: num(data.latencyMs),
      uptimePct: uptime.percent,
      uptimeSamples: uptime.samples,
      uptimeDays: null,
      activeAlerts: num(data.activeAlerts) || 0,
      severity: text(data.severity),
      checks: [],
      alerts: [],
      openAlerts: num(data.activeAlerts) || 0,
      downSince: ''
    };
  }

  function mapDeviceDetail(detail, period) {
    const data = detail && typeof detail === 'object' ? detail : {};
    const asset = mapAsset(data.asset, {});
    const config = mapConfig(data.config);
    const series = list(data.series).map((item) => mapSeries(item, period));
    const alerts = data.alerts && typeof data.alerts === 'object' ? data.alerts : {};
    const uptime = mapUptime(data.uptime);
    return {
      assetId: asset.id,
      asset,
      config,
      status: text(data.status, 'no_data'),
      statusLabel: statusMeta(text(data.status, 'no_data')).label,
      statusTone: statusMeta(text(data.status, 'no_data')).tone,
      reason: text(data.reason),
      reasonLabel: reasonLabel(data.reason),
      provenance: mapProvenance(data.provenance, period),
      uptime,
      latency: mapLatency(data.latency),
      series,
      availabilitySeries: series.find((item) => item.metric === 'availability') || null,
      latencySeries: series.find((item) => item.metric === 'latency') || null,
      checks: list(data.checks).map(mapCheck),
      alerts: {
        active: num(alerts.active) || 0,
        lastRecoveryAt: text(alerts.lastRecoveryAt),
        recent: list(alerts.recent).map((item) => mapAlert(item, period))
      }
    };
  }

  function mapDeviceDto(value, period) {
    const data = value && typeof value === 'object' ? value : {};
    return {
      status: text(data.status, 'no_data'),
      reason: text(data.reason),
      provenance: mapProvenance(data.provenance, period)
    };
  }

  function mapInboxItem(item) {
    const data = item && typeof item === 'object' ? item : {};
    return {
      id: text(data.id),
      alertId: text(data.alertId),
      eventKey: text(data.eventKey),
      eventType: text(data.eventType),
      kind: text(data.eventType),
      severity: text(data.severity, 'info'),
      assetId: text(data.assetId),
      title: text(data.title, 'Aviso'),
      body: text(data.body),
      url: text(data.url),
      createdAt: text(data.createdAt),
      readAt: text(data.readAt),
      unread: data.unread === undefined ? !data.readAt : !!data.unread
    };
  }

  function mapChannel(channel) {
    const data = channel && typeof channel === 'object' ? channel : {};
    return {
      id: text(data.id),
      kind: text(data.kind, 'internal'),
      name: text(data.name, 'Canal'),
      enabled: data.enabled !== false,
      secretRef: text(data.secretRef) || null,
      configured: !!data.configured,
      config: data.config && typeof data.config === 'object' ? copy(data.config) : {},
      createdAt: text(data.createdAt),
      updatedAt: text(data.updatedAt)
    };
  }

  function mapRule(rule) {
    const data = rule && typeof rule === 'object' ? rule : {};
    return {
      id: text(data.id),
      name: text(data.name, 'Regla'),
      enabled: data.enabled !== false,
      minimumSeverity: text(data.minimumSeverity, 'info'),
      recipientIds: list(data.recipientIds),
      channelIds: list(data.channelIds),
      escalationRecipientIds: list(data.escalationRecipientIds),
      schedule: data.schedule && typeof data.schedule === 'object'
        ? { timezone: text(data.schedule.timezone), start: text(data.schedule.start), end: text(data.schedule.end) }
        : null,
      acknowledgeAfterSeconds: num(data.acknowledgeAfterSeconds),
      retryIntervalSeconds: num(data.retryIntervalSeconds),
      escalateAfterSeconds: num(data.escalateAfterSeconds),
      maxAttempts: num(data.maxAttempts),
      builtIn: !!data.builtIn,
      createdAt: text(data.createdAt),
      updatedAt: text(data.updatedAt)
    };
  }

  function mapConfigPresets(presets) {
    const data = presets && typeof presets === 'object' ? presets : {};
    return {
      periods: list(data.periods),
      intervals: list(data.intervals),
      minimumDurations: list(data.minimumDurations),
      metrics: list(data.metrics).map((item) => ({
        id: text(item && item.id),
        label: text(item && item.label, text(item && item.id)),
        unit: text(item && item.unit)
      })),
      checkTypes: list(data.checkTypes).map((item) => ({
        id: text(item && item.id),
        label: text(item && item.label, text(item && item.id))
      }))
    };
  }

  function mapMonitoringConfig(config) {
    const data = config && typeof config === 'object' ? config : {};
    return {
      prometheus: { configured: !!(data.prometheus && data.prometheus.configured) },
      alertmanager: { configured: !!(data.alertmanager && data.alertmanager.configured) },
      presets: mapConfigPresets(data.presets),
      profiles: list(data.profiles).map((profile) => Object.assign({}, mapConfig(profile), {
        category: text(profile && profile.category)
      })),
      exporters: list(data.exporters).map((exporter) => ({
        id: text(exporter && exporter.id),
        name: text(exporter && exporter.name, text(exporter && exporter.id)),
        kind: text(exporter && exporter.kind),
        module: text(exporter && exporter.module),
        address: text(exporter && exporter.address),
        enabled: !exporter || exporter.enabled !== false
      })),
      windows: list(data.windows),
      sources: list(data.sources)
    };
  }

  function mapNotificationConfig(config) {
    const data = config && typeof config === 'object' ? config : {};
    return {
      channels: list(data.channels).map(mapChannel),
      rules: list(data.rules).map(mapRule),
      retentionDays: num(data.retentionDays),
      defaults: data.defaults && typeof data.defaults === 'object'
        ? { internalChannelId: text(data.defaults.internalChannelId), defaultRuleId: text(data.defaults.defaultRuleId) }
        : { internalChannelId: '', defaultRuleId: '' }
    };
  }

  function pick(source, keys) {
    const values = source && typeof source === 'object' ? source : {};
    const result = {};
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined) result[key] = values[key];
    });
    return result;
  }

  function hasRawSecret(value, depth) {
    if (!value || typeof value !== 'object' || depth > 3) return false;
    return Object.keys(value).some((key) => {
      if (RAW_SECRET_KEYS.indexOf(key.toLocaleLowerCase('en')) !== -1) return true;
      return hasRawSecret(value[key], (depth || 0) + 1);
    });
  }

  function cleanChannel(input) {
    const source = input && typeof input === 'object' ? input : {};
    const body = pick(source, CHANNEL_KEYS);
    if (body.config && typeof body.config === 'object') {
      const config = {};
      if (body.kind === 'smtp' && body.config.subjectPrefix !== undefined) config.subjectPrefix = text(body.config.subjectPrefix);
      if (body.kind === 'telegram' && body.config.chatId !== undefined) config.chatId = text(body.config.chatId);
      body.config = config;
    }
    if (body.secretRef !== undefined) body.secretRef = text(body.secretRef) || null;
    return body;
  }

  function cleanRule(input) {
    const source = input && typeof input === 'object' ? input : {};
    const body = pick(source, RULE_KEYS);
    ['recipientIds', 'channelIds', 'escalationRecipientIds'].forEach((key) => {
      if (body[key] !== undefined) body[key] = list(body[key]).map((item) => text(item)).filter(Boolean);
    });
    if (body.schedule && typeof body.schedule === 'object') {
      body.schedule = {
        timezone: text(body.schedule.timezone),
        start: text(body.schedule.start),
        end: text(body.schedule.end)
      };
    } else if (body.schedule === null) {
      body.schedule = null;
    }
    return body;
  }

  function errorMessage(error, fallback) {
    return (error && (error.message || error.error)) || fallback || 'No se pudo consultar la supervisión.';
  }

  const methods = {
    /* ------------------------------------------------------------ lifecycle */
    monitoringToken() {
      const api = this.monitoringApi;
      return { api, session: api ? api.session : -1, identity: this.authenticated ? (this.activeUserId || '') : '' };
    },
    monitoringTokenOpen(token) {
      const api = this.monitoringApi;
      return !!(api && token && token.api === api && this.authenticated && token.identity && token.session === api.session && token.identity === this.activeUserId);
    },
    monitoringAbort(target) {
      if (!target) return;
      if (target.controller) target.controller.abort();
      target.controller = null;
    },
    monitoringAbortAll() {
      const api = this.monitoringApi;
      if (!api) return;
      [api.devices, api.config, api.windows, api.assets, api.alerts, api.device, api.alertDetail, api.alertDetail.history, api.inbox, api.notificationConfig, api.overview]
        .forEach((target) => this.monitoringAbort(target));
    },
    clearMonitoringState() {
      const previous = this.monitoringApi;
      if (previous) {
        previous.session += 1;
        this.monitoringAbortAll();
      }
      const fresh = createState();
      fresh.identity = this.authenticated ? (this.activeUserId || '') : '';
      this.monitoringApi = fresh;
    },
    maintainMonitoringIdentity() {
      const api = this.monitoringApi;
      if (!api) return;
      if (!this.authenticated) {
        if (api.identity || api.devices.loaded || api.device.loaded) this.clearMonitoringState();
        return;
      }
      const identity = this.activeUserId || '';
      if (api.identity !== identity) {
        this.clearMonitoringState();
        this.monitoringApi.identity = identity;
      }
    },
    monitoringRefreshSession() {
      const api = this.monitoringApi;
      if (api) api.writeVersion += 1;
      return api ? api.writeVersion : 0;
    },
    monitoringDenied(permission) {
      if (this.can && this.can(permission)) return null;
      const error = 'No tienes permisos para realizar esta acción.';
      if (this.showToast) this.showToast(error);
      return { ok: false, error };
    },

    /* ------------------------------------------------------------ reads */
    async monitoringRead(target, path, apply, options) {
      const opts = options || {};
      if (!this.monitoringAvailable || !target) return false;
      const token = this.monitoringToken();
      const epoch = target.epoch + 1;
      target.epoch = epoch;
      this.monitoringAbort(target);
      const controller = new AbortController();
      target.controller = controller;
      target.loading = true;
      target.error = '';
      if (opts.reset) {
        target.loaded = false;
        if (Array.isArray(target.items)) {
          target.items = [];
          target.total = 0;
          target.offset = 0;
        } else {
          target.record = null;
          target.missing = false;
        }
      }
      try {
        const payload = await window.AssetAccess.request(this, path, { signal: controller.signal });
        if (target.epoch !== epoch || !this.monitoringTokenOpen(token)) return false;
        if (apply) apply(payload);
        target.loaded = true;
        target.error = '';
        target.missing = false;
        return true;
      } catch (error) {
        if (target.epoch !== epoch || !this.monitoringTokenOpen(token) || (error && error.name === 'AbortError')) return false;
        if (error && error.status === 401) {
          this.clearMonitoringState();
          return false;
        }
        if (error && error.status === 404) {
          target.missing = true;
          target.record = null;
          target.error = target === this.monitoringApi.inbox ? 'El aviso no está disponible.' : 'El registro solicitado no está disponible.';
        } else {
          target.error = errorMessage(error);
        }
        return false;
      } finally {
        if (target.epoch === epoch) {
          target.loading = false;
          if (target.controller === controller) target.controller = null;
        }
      }
    },
    monitoringQuery(params) {
      const parts = [];
      Object.keys(params || {}).forEach((key) => {
        const value = params[key];
        if (value !== undefined && value !== null && value !== '') {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
        }
      });
      return parts.length ? '?' + parts.join('&') : '';
    },
    async loadMonitoringDevices(options) {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const opts = options || {};
      const period = ['24h', '7d', '30d'].indexOf(opts.period) !== -1 ? opts.period : (api.overview.period || '24h');
      const append = opts.append === true;
      const limit = opts.limit || DEFAULT_LIMIT;
      const offset = append ? api.devices.items.length : 0;
      const path = '/monitoring/devices' + this.monitoringQuery({
        period, limit, offset,
        category: opts.category && opts.category !== 'all' ? opts.category : '',
        siteId: opts.siteId && opts.siteId !== 'all' ? opts.siteId : ''
      });
      const applied = await this.monitoringRead(api.devices, path, (payload) => {
        const rows = list(payload && payload.items).map(mapDeviceRow);
        api.devices.items = append ? api.devices.items.concat(rows) : rows;
        api.devices.total = num(payload && payload.total) === null ? rows.length : num(payload.total);
        api.devices.limit = limit;
        api.devices.offset = offset;
        api.overview.period = period;
      }, { reset: !append });
      return applied;
    },
    async loadMoreMonitoringDevices() {
      const api = this.monitoringApi;
      return this.loadMonitoringDevices({ period: api.overview.period, append: true });
    },
    async loadMonitoringConfig() {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      return this.monitoringRead(api.config, '/monitoring/config', (payload) => {
        api.config.record = mapMonitoringConfig(payload);
        if (api.config.record.windows.length && !api.windows.loaded) {
          api.windows.items = api.config.record.windows.map((window) => window);
          api.windows.total = api.windows.items.length;
        }
      }, { reset: true });
    },
    async loadMonitoringWindows() {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      return this.monitoringRead(api.windows, '/monitoring/windows?limit=200&offset=0', (payload) => {
        api.windows.items = list(payload && payload.items);
        api.windows.total = num(payload && payload.total) === null ? api.windows.items.length : num(payload.total);
        api.windows.limit = 200;
      }, { reset: true });
    },
    async loadMonitoringAssetDirectory() {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      return this.monitoringRead(api.assets, '/assets/search?limit=200&offset=0', (payload) => {
        const rows = list(payload && payload.items).map((item) => ({
          id: text(item && item.id),
          name: text(item && item.name) || text(item && item.id),
          quickCode: text(item && item.quickCode)
        })).filter((item) => item.id);
        api.assets.items = rows;
        api.assets.total = num(payload && payload.total) === null ? rows.length : num(payload.total);
        api.assets.limit = 200;
      }, { reset: true });
    },
    clearMonitoringPrepared() {
      if (this.monitoringApi) this.monitoringApi.prepared = null;
    },
    async loadMonitoringAlerts(options) {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const opts = options || {};
      const state = opts.state !== undefined ? opts.state : api.alertFilters.state;
      const severity = opts.severity !== undefined ? opts.severity : api.alertFilters.severity;
      const assetId = opts.assetId !== undefined ? opts.assetId : api.alertFilters.assetId;
      const limit = opts.limit || DEFAULT_LIMIT;
      const offset = opts.append === true ? api.alerts.items.length : 0;
      api.alertFilters = { state: state || '', severity: severity || '', assetId: assetId || '' };
      const path = '/monitoring/alerts' + this.monitoringQuery({
        limit, offset,
        state: state && state !== 'all' ? state : '',
        severity: severity && severity !== 'all' ? severity : '',
        assetId: assetId && assetId !== 'all' ? assetId : ''
      });
      return this.monitoringRead(api.alerts, path, (payload) => {
        const rows = list(payload && payload.items).map((alert) => mapAlert(alert, api.overview.period));
        api.alerts.items = opts.append === true ? api.alerts.items.concat(rows) : rows;
        api.alerts.total = num(payload && payload.total) === null ? rows.length : num(payload.total);
        api.alerts.limit = limit;
        api.alerts.offset = offset;
      }, { reset: opts.append !== true });
    },
    async loadMoreMonitoringAlerts() {
      return this.loadMonitoringAlerts({ append: true });
    },
    async loadMonitoringAlertCounts() {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const token = this.monitoringToken();
      const states = ['pending', 'firing', 'resolved'];
      const counts = { pending: 0, firing: 0, resolved: 0, loaded: false };
      try {
        await Promise.all(states.map(async (state) => {
          const payload = await window.AssetAccess.request(this, '/monitoring/alerts' + this.monitoringQuery({ state, limit: 1, offset: 0 }), {});
          if (!this.monitoringTokenOpen(token)) return;
          counts[state] = num(payload && payload.total) || 0;
        }));
        if (!this.monitoringTokenOpen(token)) return false;
        api.alertCounts = Object.assign(counts, { loaded: true });
        return true;
      } catch (error) {
        if (error && error.status === 401) this.clearMonitoringState();
        return false;
      }
    },
    async loadMonitoringDevice(assetId, period) {
      if (!this.monitoringAvailable) return false;
      const id = text(assetId);
      if (!id) return false;
      const api = this.monitoringApi;
      const selected = ['24h', '7d', '30d'].indexOf(period) !== -1 ? period : (api.device.period || api.overview.period || '24h');
      api.device.assetId = id;
      api.device.period = selected;
      return this.monitoringRead(api.device, '/monitoring/devices/' + encodeURIComponent(id) + this.monitoringQuery({ period: selected }), (payload) => {
        api.device.record = mapDeviceDetail(payload, selected);
      }, { reset: true });
    },
    async loadMonitoringAlert(alertId) {
      if (!this.monitoringAvailable) return false;
      const id = text(alertId);
      if (!id) return false;
      const api = this.monitoringApi;
      api.alertDetail.alertId = id;
      return this.monitoringRead(api.alertDetail, '/monitoring/alerts/' + encodeURIComponent(id), (payload) => {
        api.alertDetail.record = mapAlert(payload, api.overview.period);
      }, { reset: true });
    },
    async loadMonitoringAlertHistory(alertId, options) {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const id = text(alertId) || api.alertDetail.alertId;
      if (!id) return false;
      const opts = options || {};
      const limit = opts.limit || 50;
      const offset = opts.append === true ? api.alertDetail.history.items.length : 0;
      return this.monitoringRead(api.alertDetail.history, '/monitoring/alerts/' + encodeURIComponent(id) + '/history' + this.monitoringQuery({ limit, offset }), (payload) => {
        const items = list(payload && payload.items).map(mapAlertEvent);
        api.alertDetail.history.items = opts.append === true ? api.alertDetail.history.items.concat(items) : items;
        api.alertDetail.history.total = num(payload && payload.total) === null ? items.length : num(payload.total);
        api.alertDetail.history.loaded = true;
        if (api.alertDetail.record && !api.alertDetail.record.events.length) api.alertDetail.record.events = api.alertDetail.history.items.slice();
      }, { reset: opts.append !== true });
    },
    async loadMonitoringInbox(options) {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const opts = options || {};
      const limit = opts.limit || INBOX_LIMIT;
      const offset = opts.append === true ? api.inbox.items.length : 0;
      const unread = opts.unread === true ? 'true' : (opts.unread === false ? 'false' : '');
      return this.monitoringRead(api.inbox, '/notifications/inbox' + this.monitoringQuery({ limit, offset, unread }), (payload) => {
        const items = list(payload && payload.items).map(mapInboxItem);
        api.inbox.items = opts.append === true ? api.inbox.items.concat(items) : items;
        api.inbox.total = num(payload && payload.total) === null ? items.length : num(payload.total);
        api.inbox.limit = limit;
        api.inbox.offset = offset;
        if (unread === 'true') api.inboxUnreadTotal = api.inbox.total;
      }, { reset: opts.append !== true });
    },
    async loadMonitoringUnreadCount() {
      if (!this.monitoringAvailable) return false;
      const api = this.monitoringApi;
      const token = this.monitoringToken();
      try {
        const payload = await window.AssetAccess.request(this, '/notifications/inbox' + this.monitoringQuery({ limit: 1, offset: 0, unread: 'true' }), {});
        if (!this.monitoringTokenOpen(token)) return false;
        api.inboxUnreadTotal = num(payload && payload.total) || 0;
        return true;
      } catch (error) {
        if (error && error.status === 401) this.clearMonitoringState();
        return false;
      }
    },
    async loadNotificationConfig() {
      if (!this.monitoringIntegrations) return false;
      const api = this.monitoringApi;
      return this.monitoringRead(api.notificationConfig, '/notifications/config', (payload) => {
        api.notificationConfig.record = mapNotificationConfig(payload);
      }, { reset: true });
    },
    async markMonitoringNotificationRead(notificationId) {
      if (!this.monitoringAvailable) return false;
      const id = text(notificationId);
      if (!id) return false;
      const token = this.monitoringToken();
      try {
        const payload = await window.AssetAccess.request(this, '/notifications/inbox/' + encodeURIComponent(id) + '/read', { method: 'POST', body: {} });
        if (!this.monitoringTokenOpen(token)) return false;
        const item = mapInboxItem(payload);
        const api = this.monitoringApi;
        const index = api.inbox.items.findIndex((entry) => entry.id === id);
        if (index >= 0) api.inbox.items.splice(index, 1, item);
        if (api.inboxUnreadTotal !== null && item.unread === false) api.inboxUnreadTotal = Math.max(0, api.inboxUnreadTotal - 1);
        return true;
      } catch (error) {
        if (error && error.status === 401) this.clearMonitoringState();
        else if (this.showToast) this.showToast(errorMessage(error, 'No se pudo marcar el aviso.'));
        return false;
      }
    },
    notificationRecipientLabel(id) {
      const target = text(id);
      if (!target) return 'Sin destinatario';
      const users = (this.security && Array.isArray(this.security.users)) ? this.security.users : [];
      const user = users.find((entry) => entry.id === target);
      return user ? (text(user.name) || target) : 'Identidad ' + target;
    },

    /* ------------------------------------------------------------ writes */
    async monitoringWrite(path, method, body) {
      const token = this.monitoringToken();
      if (!this.monitoringTokenOpen(token)) return { ok: false, cancelled: true, error: 'La sesión cambió; la operación se canceló.' };
      this.monitoringRefreshSession();
      try {
        const payload = await window.AssetAccess.request(this, path, { method, body });
        if (!this.monitoringTokenOpen(token)) return { ok: false, cancelled: true, error: 'La sesión cambió; la operación se canceló.' };
        return { ok: true, payload, fieldErrors: {} };
      } catch (error) {
        if (error && error.status === 401) this.clearMonitoringState();
        const failure = {
          ok: false,
          error: errorMessage(error, 'No se pudo guardar el cambio.'),
          fieldErrors: (error && error.fieldErrors) || {},
          status: error && error.status
        };
        if (this.showToast) this.showToast(failure.error);
        return failure;
      }
    },
    async updateMonitoringAsset(assetId, values) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(assetId);
      if (!id) return { ok: false, error: 'Falta el activo que se quiere supervisar.' };
      const body = pick(values, ASSET_KEYS);
      const result = await this.monitoringWrite('/monitoring/assets/' + encodeURIComponent(id), 'PATCH', body);
      if (!result.ok) return result;
      const api = this.monitoringApi;
      if (api.device.assetId === id) await this.loadMonitoringDevice(id, api.device.period);
      else if (api.devices.loaded) await this.loadMonitoringDevices({ period: api.overview.period });
      return result;
    },
    async updateMonitoringProfile(category, values) {
      const denied = this.monitoringDenied('config.categories');
      if (denied) return denied;
      const id = text(category);
      if (!id) return { ok: false, error: 'Falta la categoría del perfil.' };
      const result = await this.monitoringWrite('/monitoring/profiles/' + encodeURIComponent(id), 'PUT', pick(values, PROFILE_KEYS));
      if (!result.ok) return result;
      await this.loadMonitoringConfig();
      return result;
    },
    async saveMonitoringExporter(values) {
      const denied = this.monitoringDenied('config.integrations');
      if (denied) return denied;
      const body = pick(values, ['id', 'name', 'kind', 'module', 'address', 'enabled']);
      if (!text(body.name) || !text(body.kind) || !text(body.module)) return { ok: false, error: 'El exportador necesita nombre, tipo y módulo.' };
      const result = await this.monitoringWrite('/monitoring/exporters', 'POST', body);
      if (!result.ok) return result;
      await this.loadMonitoringConfig();
      return result;
    },
    async acknowledgeMonitoringAlert(alertId, notes) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(alertId);
      if (!id) return { ok: false, error: 'Falta la alerta.' };
      const body = text(notes) ? { notes: text(notes) } : {};
      const result = await this.monitoringWrite('/monitoring/alerts/' + encodeURIComponent(id) + '/acknowledge', 'POST', body);
      if (!result.ok) return result;
      const api = this.monitoringApi;
      const record = mapAlert(result.payload, api.overview.period);
      if (api.alertDetail.alertId === id) api.alertDetail.record = record;
      // The overview and alerts tab render this shared page, so the row is
      // replaced in place: it stays visible and firing, already acknowledged.
      const index = api.alerts.items.findIndex((entry) => entry.id === id);
      if (index >= 0) api.alerts.items.splice(index, 1, record);
      await this.loadMonitoringAlertCounts();
      return result;
    },
    silencePayload(target, options) {
      const opts = options || {};
      const hours = num(opts.hours);
      const duration = hours && hours > 0 ? hours : 4;
      return {
        endsAt: new Date(Date.now() + duration * 3600000).toISOString(),
        comment: text(opts.comment)
      };
    },
    async silenceMonitoringAlert(alertId, options) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(alertId);
      if (!id) return { ok: false, error: 'Falta la alerta.' };
      if (!text(options && options.comment)) return { ok: false, error: 'El silencio necesita un motivo.' };
      const body = Object.assign({ alertId: id }, this.silencePayload(id, options));
      const result = await this.monitoringWrite('/monitoring/silences', 'POST', body);
      if (!result.ok) return result;
      const api = this.monitoringApi;
      if (api.alertDetail.alertId === id) await this.loadMonitoringAlert(id);
      return result;
    },
    async silenceMonitoringAsset(assetId, options) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(assetId);
      if (!id) return { ok: false, error: 'Falta el activo.' };
      if (!text(options && options.comment)) return { ok: false, error: 'El silencio necesita un motivo.' };
      const body = Object.assign({ assetId: id }, this.silencePayload(id, options));
      return this.monitoringWrite('/monitoring/silences', 'POST', body);
    },
    async saveMonitoringWindow(values) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const body = pick(values, WINDOW_KEYS);
      if (!text(body.name)) return { ok: false, error: 'La ventana necesita un nombre.' };
      const id = text(values && values.id);
      const path = id ? '/monitoring/windows/' + encodeURIComponent(id) : '/monitoring/windows';
      const result = await this.monitoringWrite(path, id ? 'PUT' : 'POST', body);
      if (!result.ok) return result;
      await this.loadMonitoringWindows();
      return result;
    },
    async prepareMonitoringMaintenance(alertId) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(alertId);
      if (!id) return { ok: false, error: 'Falta la alerta.' };
      const result = await this.monitoringWrite('/monitoring/alerts/' + encodeURIComponent(id) + '/maintenance', 'POST', {});
      if (!result.ok) return result;
      const suggested = result.payload && result.payload.suggested ? result.payload.suggested : null;
      const api = this.monitoringApi;
      api.prepared = suggested ? {
        name: text(suggested.name),
        assetIds: list(suggested.assetIds).map((assetId) => text(assetId)).filter(Boolean),
        daysOfWeek: list(suggested.daysOfWeek),
        startTime: text(suggested.startTime),
        endTime: text(suggested.endTime),
        timezone: text(suggested.timezone)
      } : null;
      return {
        ok: true,
        suggested,
        existingWindow: result.payload && result.payload.existingWindow ? result.payload.existingWindow : null,
        payload: result.payload
      };
    },
    async linkMonitoringIncident(alertId, incidentId) {
      const denied = this.monitoringDenied('assets.edit');
      if (denied) return denied;
      const id = text(alertId);
      if (!id) return { ok: false, error: 'Falta la alerta.' };
      const target = text(incidentId);
      const result = await this.monitoringWrite('/monitoring/alerts/' + encodeURIComponent(id) + '/incident', 'POST', { incidentId: target || null });
      if (!result.ok) return result;
      const api = this.monitoringApi;
      if (api.alertDetail.alertId === id) api.alertDetail.record = mapAlert(result.payload, api.overview.period);
      return result;
    },
    async saveNotificationChannel(input) {
      const denied = this.monitoringDenied('config.integrations');
      if (denied) return denied;
      if (hasRawSecret(input, 0)) {
        const error = 'No se admiten secretos ni credenciales en el navegador. Indica solo una referencia de credencial del despliegue.';
        if (this.showToast) this.showToast(error);
        return { ok: false, error };
      }
      const body = cleanChannel(input);
      if (!text(body.name) || !text(body.kind)) return { ok: false, error: 'El canal necesita nombre y tipo.' };
      if (body.secretRef && !/^[A-Za-z0-9_.-]+$/.test(body.secretRef)) {
        const error = 'La referencia de credencial no es válida.';
        if (this.showToast) this.showToast(error);
        return { ok: false, error };
      }
      const result = await this.monitoringWrite('/notifications/channels', 'POST', body);
      if (!result.ok) return result;
      const api = this.monitoringApi;
      const record = api.notificationConfig.record;
      const channel = mapChannel(result.payload);
      if (record) {
        const index = record.channels.findIndex((item) => item.id === channel.id);
        if (index >= 0) record.channels.splice(index, 1, channel);
        else record.channels.push(channel);
      }
      return result;
    },
    async saveNotificationRule(input) {
      const denied = this.monitoringDenied('config.integrations');
      if (denied) return denied;
      const body = cleanRule(input);
      if (!text(body.name)) return { ok: false, error: 'La regla necesita un nombre.' };
      if (Array.isArray(body.channelIds) && body.channelIds.length === 0) return { ok: false, error: 'La regla necesita al menos un canal.' };
      const result = await this.monitoringWrite('/notifications/rules', 'POST', body);
      if (!result.ok) return result;
      const api = this.monitoringApi;
      const record = api.notificationConfig.record;
      const rule = mapRule(result.payload);
      if (record) {
        const index = record.rules.findIndex((item) => item.id === rule.id);
        if (index >= 0) record.rules.splice(index, 1, rule);
        else record.rules.push(rule);
      }
      return result;
    },
    async testNotificationChannel(channelId) {
      const denied = this.monitoringDenied('config.integrations');
      if (denied) return denied;
      const id = text(channelId);
      if (!id) return { ok: false, error: 'Falta el canal.' };
      const result = await this.monitoringWrite('/notifications/channels/' + encodeURIComponent(id) + '/test', 'POST', {});
      if (!result.ok) return result;
      const state = text(result.payload && result.payload.state, 'pending');
      const api = this.monitoringApi;
      api.notificationTestStates[id] = {
        state,
        outboxId: text(result.payload && result.payload.outboxId),
        at: new Date().toISOString()
      };
      // A 202 only means the delivery request is queued; it is never a delivery claim.
      if (this.showToast) this.showToast('Prueba en cola para ' + id + '. El resultado no confirma la entrega.');
      return { ok: true, state, outboxId: api.notificationTestStates[id].outboxId };
    },

    /* ------------------------------------------------------------ routing */
    async handleMonitoringRoute(next) {
      if (!next || !this.authenticated) {
        this.clearMonitoringState();
        return false;
      }
      const api = this.monitoringApi;
      if (next.name === 'monitoring') {
        const period = api.overview.period || '24h';
        // The center's controls come from the shared filters, so every key is
        // named here and a device-scoped load can never leak into the overview.
        const results = await Promise.all([
          this.loadMonitoringDevices({ period }),
          this.loadMonitoringAlerts({
            state: api.alertFilters.state || 'firing',
            severity: api.alertFilters.severity || '',
            assetId: api.alertFilters.assetId || ''
          }),
          this.loadMonitoringAlertCounts()
        ]);
        return results.every(Boolean);
      }
      if (next.name === 'monitorDevice' && next.assetId) {
        // Device alerts arrive inside the canonical device detail; loading the
        // shared list here would overwrite the overview scope and rows.
        return this.loadMonitoringDevice(next.assetId, api.overview.period);
      }
      if (next.name === 'monitorAlert' && next.alertId) {
        const detail = await this.loadMonitoringAlert(next.alertId);
        if (detail) await this.loadMonitoringAlertHistory(next.alertId);
        return detail;
      }
      if (next.name === 'notifications') {
        const results = await Promise.all([
          this.loadMonitoringInbox(),
          this.loadMonitoringUnreadCount()
        ]);
        return results.every(Boolean);
      }
      if (next.name === 'config' && next.section === 'supervision') return this.loadMonitoringConfig();
      if (next.name === 'config' && next.section === 'alertas') {
        const results = await Promise.all([this.loadMonitoringConfig(), this.loadMonitoringWindows()]);
        return results.every(Boolean);
      }
      if (next.name === 'config' && next.section === 'notificaciones') return this.loadNotificationConfig();
      if (next.name === 'detail' && next.assetId) return this.loadMonitoringDevice(next.assetId, api.overview.period);
      this.monitoringAbort(api.device);
      this.monitoringAbort(api.alertDetail);
      this.monitoringAbort(api.alertDetail.history);
      if (!next || next.name !== 'monitorAlert') api.alertDetail = alertDetailState();
      if (!next || next.name !== 'monitorDevice') api.device = deviceState();
      return true;
    }
  };

  const computed = {
    monitoringAvailable() {
      return !!(this.authenticated && this.activeUserId && this.can && this.can('assets.view'));
    },
    monitoringEditable() { return !!(this.can && this.can('assets.edit')); },
    monitoringConfigurable() { return !!(this.can && this.can('config.categories')); },
    monitoringIntegrations() { return !!(this.can && this.can('config.integrations')); },
    monitoringDevices() { return this.monitoringApi ? this.monitoringApi.devices.items : []; },
    monitoringDevicesTotal() { return this.monitoringApi ? this.monitoringApi.devices.total : 0; },
    monitoringDevicesLoading() { return !!(this.monitoringApi && this.monitoringApi.devices.loading); },
    monitoringDevicesError() { return this.monitoringApi ? this.monitoringApi.devices.error : ''; },
    monitoringDevicesTruncated() {
      const api = this.monitoringApi;
      return !!(api && api.devices.total > api.devices.items.length);
    },
    monitoringStats() {
      const items = this.monitoringDevices;
      const counts = { total: this.monitoringDevicesTotal, up: 0, degraded: 0, down: 0, unmonitored: 0, noData: 0, unavailable: 0, monitored: 0, activeAlerts: 0 };
      items.forEach((row) => {
        if (row.status === 'up') counts.up += 1;
        else if (row.status === 'degraded') counts.degraded += 1;
        else if (row.status === 'down') counts.down += 1;
        else if (row.status === 'unmonitored') counts.unmonitored += 1;
        else if (row.status === 'unavailable') counts.unavailable += 1;
        else counts.noData += 1;
        if (row.status !== 'unmonitored') counts.monitored += 1;
        counts.activeAlerts += row.activeAlerts || 0;
      });
      return counts;
    },
    monitoringAvailabilityPoints() {
      return this.monitoringDevices
        .filter((row) => row.uptimePct !== null)
        .map((row) => ({ at: '', label: row.asset.quickCode || row.asset.name, value: row.uptimePct }));
    },
    monitoringLatencyPoints() {
      return this.monitoringDevices
        .filter((row) => row.latencyMs !== null)
        .map((row) => ({ at: '', label: row.asset.quickCode || row.asset.name, value: row.latencyMs }));
    },
    monitoringProvenance() {
      const api = this.monitoringApi;
      return { source: 'prometheus', period: api ? api.overview.period : '24h', prometheusConfigured: this.monitoringConfig ? this.monitoringConfig.prometheus.configured : null };
    },
    monitoringConfig() { return this.monitoringApi && this.monitoringApi.config.record ? this.monitoringApi.config.record : null; },
    monitoringConfigLoading() { return !!(this.monitoringApi && this.monitoringApi.config.loading); },
    monitoringConfigError() { return this.monitoringApi ? this.monitoringApi.config.error : ''; },
    monitoringProfiles() { return this.monitoringConfig ? this.monitoringConfig.profiles : []; },
    monitoringExporters() { return this.monitoringConfig ? this.monitoringConfig.exporters : []; },
    monitoringPresets() { return this.monitoringConfig ? this.monitoringConfig.presets : { periods: [], intervals: [], minimumDurations: [], metrics: [], checkTypes: [] }; },
    monitoringSources() { return this.monitoringConfig ? this.monitoringConfig.sources : []; },
    monitoringWindows() { return this.monitoringApi ? this.monitoringApi.windows.items : []; },
    monitoringWindowsLoading() { return !!(this.monitoringApi && this.monitoringApi.windows.loading); },
    monitoringWindowsError() { return this.monitoringApi ? this.monitoringApi.windows.error : ''; },
    monitoringAssets() { return this.monitoringApi ? this.monitoringApi.assets.items : []; },
    monitoringAssetsTotal() { return this.monitoringApi ? this.monitoringApi.assets.total : 0; },
    monitoringAssetsLoading() { return !!(this.monitoringApi && this.monitoringApi.assets.loading); },
    monitoringAssetsError() { return this.monitoringApi ? this.monitoringApi.assets.error : ''; },
    monitoringAlerts() { return this.monitoringApi ? this.monitoringApi.alerts.items : []; },
    monitoringAlertsTotal() { return this.monitoringApi ? this.monitoringApi.alerts.total : 0; },
    monitoringAlertsLoading() { return !!(this.monitoringApi && this.monitoringApi.alerts.loading); },
    monitoringAlertsError() { return this.monitoringApi ? this.monitoringApi.alerts.error : ''; },
    monitoringAlertRows() { return this.monitoringAlerts.map(alertRow); },
    monitoringAlertCounts() { return this.monitoringApi ? this.monitoringApi.alertCounts : { pending: 0, firing: 0, resolved: 0, loaded: false }; },
    monitoringActiveAlertCount() {
      const counts = this.monitoringAlertCounts;
      return counts.loaded ? counts.firing : this.monitoringAlerts.filter((alert) => alert.state === 'firing').length;
    },
    monitoringDeviceRecord() { return this.monitoringApi && this.monitoringApi.device.record ? this.monitoringApi.device.record : null; },
    monitoringDeviceLoading() { return !!(this.monitoringApi && this.monitoringApi.device.loading); },
    monitoringDeviceError() { return this.monitoringApi ? this.monitoringApi.device.error : ''; },
    monitoringDeviceMissing() { return !!(this.monitoringApi && this.monitoringApi.device.missing); },
    monitoringDevicePeriod() { return this.monitoringApi ? this.monitoringApi.device.period : '24h'; },
    monitoringDeviceLatency() {
      const record = this.monitoringDeviceRecord;
      return record && record.latencySeries ? record.latencySeries.points : [];
    },
    monitoringDeviceAvailability() {
      const record = this.monitoringDeviceRecord;
      return record && record.availabilitySeries ? record.availabilitySeries.points : [];
    },
    monitoringDeviceChecks() { return this.monitoringDeviceRecord ? this.monitoringDeviceRecord.checks : []; },
    monitoringAlertRecord() { return this.monitoringApi && this.monitoringApi.alertDetail.record ? this.monitoringApi.alertDetail.record : null; },
    monitoringAlertRow() { return alertRow(this.monitoringAlertRecord); },
    monitoringAlertLoading() { return !!(this.monitoringApi && this.monitoringApi.alertDetail.loading); },
    monitoringAlertError() { return this.monitoringApi ? this.monitoringApi.alertDetail.error : ''; },
    monitoringAlertMissing() { return !!(this.monitoringApi && this.monitoringApi.alertDetail.missing); },
    monitoringAlertEvents() {
      const api = this.monitoringApi;
      if (!api) return [];
      return api.alertDetail.record ? api.alertDetail.record.events : api.alertDetail.history.items;
    },
    monitoringInbox() { return this.monitoringApi ? this.monitoringApi.inbox.items : []; },
    monitoringInboxTotal() { return this.monitoringApi ? this.monitoringApi.inbox.total : 0; },
    monitoringInboxLoading() { return !!(this.monitoringApi && this.monitoringApi.inbox.loading); },
    monitoringInboxError() { return this.monitoringApi ? this.monitoringApi.inbox.error : ''; },
    monitoringUnreadCount() {
      const api = this.monitoringApi;
      if (!api) return 0;
      if (api.inboxUnreadTotal !== null) return api.inboxUnreadTotal;
      return api.inbox.items.filter((item) => item.unread).length;
    },
    notificationConfig() { return this.monitoringApi && this.monitoringApi.notificationConfig.record ? this.monitoringApi.notificationConfig.record : null; },
    notificationConfigLoading() { return !!(this.monitoringApi && this.monitoringApi.notificationConfig.loading); },
    notificationConfigError() { return this.monitoringApi ? this.monitoringApi.notificationConfig.error : ''; },
    notificationChannels() { return this.notificationConfig ? this.notificationConfig.channels : []; },
    notificationRules() { return this.notificationConfig ? this.notificationConfig.rules : []; },
    notificationDefaults() { return this.notificationConfig ? this.notificationConfig.defaults : { internalChannelId: '', defaultRuleId: '' }; },
    notificationRetentionDays() { return this.notificationConfig ? this.notificationConfig.retentionDays : null; },
    notificationTestStates() { return this.monitoringApi ? this.monitoringApi.notificationTestStates : {}; },
    notificationRecipients() {
      const users = (this.security && Array.isArray(this.security.users)) ? this.security.users : [];
      return users.filter((user) => user && user.active !== false && user.id).map((user) => ({ id: user.id, label: text(user.name) || user.id }));
    },
    monitoringStatusMeta() { return statusMeta; },
    monitoringSeverityMeta() { return severityMeta; },
    monitoringAlertStateMeta() { return alertStateMeta; },
    monitoringCheckMeta() { return checkMeta; }
  };

  window.AssetMonitoringApiMapping = {
    statusMeta, severityMeta, alertStateMeta, checkMeta, reasonLabel, pointLabel,
    mapAsset, mapDeviceRow, mapDeviceDetail, mapAlert, mapAlertEvent, mapAlertRow: alertRow,
    mapInboxItem, mapChannel, mapRule, mapMonitoringConfig, mapNotificationConfig
  };
  window.AssetMonitoringApi = { data() { return { monitoringApi: createState() }; }, computed, methods };
})();
