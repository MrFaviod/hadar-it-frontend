(function () {
  'use strict';

  const Maint = window.ASSET_MAINT || {};

  function runtime() {
    return typeof window !== 'undefined' ? window.ItsmI18n : null;
  }

  function tr(key, params) {
    const api = runtime();
    return api ? api.t(key, params) : '';
  }

  // The label, short and hint of every catalog entry are enumerable getters, so
  // the views keep reading plain properties while the value is a live catalog
  // lookup: a locale switch is never frozen into the dataset (D2, D3).
  const LOCALIZED = ['label', 'short', 'hint'];

  function relabel(entry, source, properties) {
    const origin = source || entry;
    (properties || LOCALIZED).forEach(function (property) {
      const key = origin[property + 'Key'];
      if (!key) return;
      Object.defineProperty(entry, property, {
        enumerable: true,
        configurable: true,
        get: function () { return tr(key); }
      });
    });
    return entry;
  }

  function localized(entry, properties) {
    return relabel(entry, entry, properties);
  }

  // A notification template carries `{severity}`, `{asset}` and the other
  // tokens the preview replaces. The catalog message keeps them, so the getter
  // passes each token back as its own value instead of letting the runtime
  // interpolate it away.
  const TEMPLATE_TOKENS = {
    severity: '{severity}',
    asset: '{asset}',
    site: '{site}',
    title: '{title}',
    message: '{message}',
    detectedAt: '{detectedAt}',
    state: '{state}',
    link: '{link}'
  };

  function template(entry, property) {
    const key = entry[property + 'Key'];
    Object.defineProperty(entry, property, {
      enumerable: true,
      configurable: true,
      get: function () { return tr(key, TEMPLATE_TOKENS); }
    });
    return entry;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Deterministic seed from the asset id. The availability and latency series
  // are derived from it, so charts are stable between reloads without storing
  // hundreds of samples in localStorage.
  function hash(value) {
    const text = String(value || '');
    let result = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function isoInHours(offsetHours) {
    return new Date(Date.now() + offsetHours * 3600000).toISOString();
  }

  function isoAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  // ---------------------------------------------------------------- checks
  // The catalogue is the modular part of the supervision: availability is the
  // base level and every other check adds a metric with its own thresholds.
  const CHECKS = [
    localized({
      id: 'availability',
      labelKey: 'ui.monitoring.device.metric_availability',
      shortKey: 'ui.monitoring.check_short.availability',
      hintKey: 'ui.monitoring.check_hint.availability',
      icon: 'activity',
      unit: '%',
      direction: 'below',
      warn: 99,
      crit: 95,
      metric: false,
      base: true,
      step: 0.01
    }),
    localized({
      id: 'latency',
      labelKey: 'ui.monitoring.metric.latency',
      shortKey: 'ui.monitoring.check_short.latency',
      hintKey: 'ui.monitoring.check_hint.latency',
      icon: 'wifi',
      unit: 'ms',
      direction: 'above',
      warn: 60,
      crit: 120,
      metric: true,
      step: 1
    }),
    localized({
      id: 'cpu',
      labelKey: 'ui.monitoring.metric.cpu',
      shortKey: 'ui.monitoring.check_short.cpu',
      hintKey: 'ui.monitoring.check_hint.cpu',
      icon: 'activity',
      unit: '%',
      direction: 'above',
      warn: 75,
      crit: 90,
      metric: true,
      step: 1
    }),
    localized({
      id: 'memory',
      labelKey: 'ui.monitoring.metric.memory',
      shortKey: 'ui.monitoring.check_short.memory',
      hintKey: 'ui.monitoring.check_hint.memory',
      icon: 'layers',
      unit: '%',
      direction: 'above',
      warn: 80,
      crit: 92,
      metric: true,
      step: 1
    }),
    localized({
      id: 'disk',
      labelKey: 'ui.monitoring.check_label.disk',
      shortKey: 'ui.monitoring.metric.disk',
      hintKey: 'ui.monitoring.check_hint.disk',
      icon: 'server',
      unit: '%',
      direction: 'above',
      warn: 80,
      crit: 90,
      metric: true,
      step: 1
    }),
    localized({
      id: 'temperature',
      labelKey: 'ui.monitoring.metric.temperature',
      shortKey: 'ui.monitoring.check_short.temperature',
      hintKey: 'ui.monitoring.check_hint.temperature',
      icon: 'thermometer',
      unit: '°C',
      direction: 'above',
      warn: 32,
      crit: 40,
      metric: true,
      step: 0.1
    }),
    localized({
      id: 'services',
      labelKey: 'ui.monitoring.check_label.services',
      shortKey: 'ui.monitoring.check_short.services',
      hintKey: 'ui.monitoring.check_hint.services',
      icon: 'sliders',
      unit: '%',
      direction: 'below',
      warn: 90,
      crit: 70,
      metric: true,
      step: 1
    })
  ];

  const STATUSES = [
    localized({ id: 'up', labelKey: 'ui.monitoring.status.up', hintKey: 'ui.monitoring.status_hint.up', tone: 'ok', icon: 'check' }),
    localized({ id: 'degraded', labelKey: 'ui.monitoring.status.degraded', hintKey: 'ui.monitoring.status_hint.degraded', tone: 'warn', icon: 'alert' }),
    localized({ id: 'down', labelKey: 'ui.monitoring.status.down', hintKey: 'ui.monitoring.status_hint.down', tone: 'down', icon: 'x-circle' }),
    localized({ id: 'unmonitored', labelKey: 'ui.monitoring.status.unmonitored', hintKey: 'ui.monitoring.status_hint.unmonitored', tone: 'neutral', icon: 'minus' })
  ];

  const RANGES = [
    localized({ id: '24h', labelKey: 'ui.monitoring.period.24h', points: 24, stepHours: 1, hintKey: 'ui.monitoring.period_hint.24h' }),
    localized({ id: '7d', labelKey: 'ui.monitoring.period.7d', points: 28, stepHours: 6, hintKey: 'ui.monitoring.period_hint.7d' }),
    localized({ id: '30d', labelKey: 'ui.monitoring.period.30d', points: 30, stepHours: 24, hintKey: 'ui.monitoring.period_hint.30d' })
  ];

  // ---------------------------------------------------------------- policies
  // Default coverage by category. User computers stay out of the default
  // supervision and join through an individual exception.
  const POLICIES = [
    { category: 'servidores', enabled: true, intervalMinutes: 5, checkIds: ['availability', 'latency', 'cpu', 'memory', 'disk', 'temperature', 'services'] },
    { category: 'switches', enabled: true, intervalMinutes: 5, checkIds: ['availability', 'latency', 'cpu', 'memory', 'services'] },
    { category: 'camaras', enabled: true, intervalMinutes: 10, checkIds: ['availability', 'latency', 'services'] },
    { category: 'ups', enabled: true, intervalMinutes: 10, checkIds: ['availability', 'temperature', 'services'] },
    { category: 'virtualizacion', enabled: true, intervalMinutes: 5, checkIds: ['availability', 'latency', 'cpu', 'memory', 'disk'] },
    { category: 'contenedores', enabled: true, intervalMinutes: 5, checkIds: ['availability', 'cpu', 'memory', 'disk', 'services'] },
    { category: 'otros', enabled: false, intervalMinutes: 15, checkIds: ['availability'] },
    { category: 'computadoras', enabled: false, intervalMinutes: 30, checkIds: ['availability'] },
    { category: 'notebooks', enabled: false, intervalMinutes: 30, checkIds: ['availability'] },
    { category: 'impresoras', enabled: false, intervalMinutes: 30, checkIds: ['availability'] },
    { category: 'monitores', enabled: false, intervalMinutes: 30, checkIds: ['availability'] }
  ];

  const EXCEPTIONS = [
    { assetId: 'AM-1063', enabled: true, intervalMinutes: 10, checkIds: ['availability', 'latency', 'disk', 'temperature', 'services'] },
    { assetId: 'AM-1068', enabled: true, intervalMinutes: 5, checkIds: ['availability', 'latency', 'services'] },
    { assetId: 'AM-1069', enabled: true, intervalMinutes: 15, checkIds: ['availability', 'latency'] },
    { assetId: 'AM-1065', enabled: true, intervalMinutes: 30, checkIds: ['availability'] }
  ];

  // ---------------------------------------------------------------- probes
  // Current measurements. Values are entered by hand so the demo reads like a
  // real park: nothing is derived from a random number at render time.
  const PROBES = [
    {
      assetId: 'AM-1046', status: 'up', latencyMs: 4, uptimePct: 99.98, uptimeDays: 214,
      checkedMinutesAgo: 1, values: { cpu: 41, memory: 63, disk: 58, temperature: 24, servicesUp: 6, servicesTotal: 6 }
    },
    {
      assetId: 'AM-1047', status: 'degraded', latencyMs: 7, uptimePct: 99.71, uptimeDays: 61,
      checkedMinutesAgo: 2, values: { cpu: 28, memory: 44, disk: 71, temperature: 38.4, servicesUp: 5, servicesTotal: 6 }
    },
    {
      assetId: 'AM-1062', status: 'up', latencyMs: 3, uptimePct: 99.95, uptimeDays: 128,
      checkedMinutesAgo: 1, values: { cpu: 62, memory: 74, disk: 66, temperature: 27, servicesUp: 5, servicesTotal: 5 }
    },
    {
      assetId: 'AM-1050', status: 'up', latencyMs: 2, uptimePct: 99.99, uptimeDays: 341,
      checkedMinutesAgo: 1, values: { cpu: 18, memory: 34, temperature: 29, servicesUp: 4, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1051', status: 'up', latencyMs: 3, uptimePct: 99.86, uptimeDays: 96,
      checkedMinutesAgo: 2, values: { cpu: 21, memory: 39, temperature: 31, servicesUp: 4, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1064', status: 'degraded', latencyMs: 11, uptimePct: 96.2, uptimeDays: 12,
      checkedMinutesAgo: 1, values: { cpu: 33, memory: 46, temperature: 30, servicesUp: 4, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1066', status: 'up', latencyMs: 2, uptimePct: 99.97, uptimeDays: 187,
      checkedMinutesAgo: 1, values: { cpu: 16, memory: 31, temperature: 28, servicesUp: 4, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1057', status: 'up', latencyMs: 9, uptimePct: 99.42, uptimeDays: 73,
      checkedMinutesAgo: 4, values: { servicesUp: 3, servicesTotal: 3 }
    },
    {
      assetId: 'AM-1067', status: 'down', latencyMs: 0, uptimePct: 92.6, uptimeDays: 0,
      checkedMinutesAgo: 1, downSince: isoInHours(-5), values: { servicesUp: 0, servicesTotal: 3 }
    },
    {
      assetId: 'AM-1058', status: 'degraded', latencyMs: 6, uptimePct: 99.9, uptimeDays: 402,
      checkedMinutesAgo: 6, values: { temperature: 34.2, servicesUp: 3, servicesTotal: 3 }
    },
    {
      assetId: 'AM-1059', status: 'up', latencyMs: 2, uptimePct: 99.99, uptimeDays: 219,
      checkedMinutesAgo: 1, values: { cpu: 37, memory: 58, disk: 42, servicesUp: 3, servicesTotal: 3 }
    },
    {
      assetId: 'AM-1060', status: 'degraded', latencyMs: 4, uptimePct: 99.6, uptimeDays: 44,
      checkedMinutesAgo: 2, values: { cpu: 22, memory: 51, disk: 38, servicesUp: 3, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1063', status: 'degraded', latencyMs: 5, uptimePct: 99.93, uptimeDays: 302,
      checkedMinutesAgo: 3, values: { cpu: 12, memory: 36, disk: 88, temperature: 30, servicesUp: 4, servicesTotal: 4 }
    },
    {
      assetId: 'AM-1068', status: 'up', latencyMs: 1, uptimePct: 99.99, uptimeDays: 268,
      checkedMinutesAgo: 1, values: { servicesUp: 3, servicesTotal: 3 }
    },
    {
      assetId: 'AM-1069', status: 'down', latencyMs: 0, uptimePct: 97.4, uptimeDays: 0,
      checkedMinutesAgo: 2, downSince: isoInHours(-3), values: { servicesUp: 0, servicesTotal: 2 }
    },
    {
      assetId: 'AM-1065', status: 'up', latencyMs: 5, uptimePct: 99.12, uptimeDays: 21,
      checkedMinutesAgo: 12, values: {}
    }
  ];

  // ---------------------------------------------------------------- silences
  const SILENCES = [
    {
      id: 'sil-01', scope: 'category', target: 'ups', until: isoInHours(12),
      reason: 'Sustitución de baterías programada en el rack A.', createdAt: isoAgo(180), createdBy: 'Diego Salas'
    },
    {
      id: 'sil-02', scope: 'asset', target: 'AM-1057', until: isoInHours(48),
      reason: 'Obra en recepción: la cámara permanece desmontada.', createdAt: isoAgo(600), createdBy: 'Lucía Pardo'
    }
  ];

  // ---------------------------------------------------------------- windows
  // Maintenance windows mute external notifications while the work is planned.
  // They never hide the alert from the operational views.
  const WINDOWS = [
    {
      id: 'win-01', label: 'Respaldo nocturno', start: '01:00', end: '02:30',
      days: [0, 1, 2, 3, 4, 5, 6], categories: [], sites: [], active: true,
      reason: 'La copia de seguridad satura la red de gestión.'
    },
    {
      id: 'win-02', label: 'Actualización de switches', start: '22:00', end: '23:59',
      days: [6], categories: ['switches'], sites: ['dc'], active: true,
      reason: 'Firmware programado por el equipo de Redes.'
    }
  ];

  // ---------------------------------------------------------------- channels
  // The sender name, the subject and the body are catalog lookups as well. The
  // subject and body keep their `{asset}`-style tokens: the getter passes each
  // token back as its own value so the runtime does not interpolate it away
  // before the preview renders the alert.
  const CHANNELS = {
    smtp: template(template(localized({
      enabled: true,
      host: 'smtp.example-org.local',
      port: 587,
      secure: true,
      from: 'noc@example-org.local',
      fromNameKey: 'ui.monitoring.channel.from_name',
      recipients: 'guardia@example-org.local; soporte@example-org.local',
      subjectKey: 'ui.monitoring.channel.subject',
      templateKey: 'ui.monitoring.channel.template',
      lastTestAt: isoAgo(1200),
      lastTestResult: 'ok'
    }, ['fromName']), 'subject'), 'template'),
    telegram: {
      enabled: false,
      botName: 'example-org_noc_bot',
      token: '8123456789:AAF-DEMO-token-simulado',
      chatIds: '-1001987654321; 482119034',
      template: '{severity} · {asset}\n{title}\n{message}\n\n{link}',
      parseMode: 'Markdown',
      lastTestAt: '',
      lastTestResult: ''
    }
  };

  // ---------------------------------------------------------------- escalation
  const ESCALATIONS = [
    {
      id: 'esc-01', label: 'Críticas, aviso inmediato', severity: 'critica', categories: [], sites: [],
      channels: ['smtp', 'telegram'], afterMinutes: 0, window: 'always', requireUnack: false,
      recipients: '', enabled: true
    },
    {
      id: 'esc-02', label: 'Altas sin reconocer', severity: 'alta', categories: [], sites: [],
      channels: ['smtp'], afterMinutes: 15, window: 'always', requireUnack: true,
      recipients: 'guardia@example-org.local', enabled: true
    },
    {
      id: 'esc-03', label: 'Medianas en horario laboral', severity: 'media', categories: [], sites: [],
      channels: ['smtp'], afterMinutes: 60, window: 'business', requireUnack: true,
      recipients: '', enabled: true
    },
    {
      id: 'esc-04', label: 'Red de sedes', severity: '', categories: ['switches', 'otros'], sites: [],
      channels: ['telegram'], afterMinutes: 5, window: 'always', requireUnack: true,
      recipients: '', enabled: false
    },
    {
      id: 'esc-05', label: 'Resumen diario de bajas', severity: 'baja', categories: [], sites: [],
      channels: ['smtp'], afterMinutes: 480, window: 'always', requireUnack: false,
      recipients: '', enabled: false
    }
  ];

  // ---------------------------------------------------------------- inbox
  const NOTIFICATIONS = [
    {
      id: 'not-01', kind: 'alert', severity: 'alta', alertId: 'ALT-2413', assetId: 'AM-1069',
      title: 'Reloj biométrico sin conexión', body: 'Segunda comprobación sin respuesta en recepción de Sede Norte.',
      at: isoAgo(58), readAt: '', channels: ['smtp']
    },
    {
      id: 'not-02', kind: 'alert', severity: 'alta', alertId: 'ALT-2407', assetId: 'AM-1064',
      title: 'Cuarto corte en el switch de acceso Norte', body: 'La serie se agrupa como fallo intermitente: 4 eventos en 12 horas.',
      at: isoAgo(95), readAt: '', channels: ['smtp']
    },
    {
      id: 'not-03', kind: 'alert', severity: 'media', alertId: 'ALT-2406', assetId: 'AM-1047',
      title: 'Alerta reconocida y todavía activa', body: 'Diego Salas reconoció la temperatura alta del servidor de respaldo.',
      at: isoAgo(160), readAt: isoAgo(150), channels: []
    },
    {
      id: 'not-04', kind: 'incident', severity: 'alta', incidentId: 'INC-2404', assetId: 'AM-1047',
      title: 'INC-2404 · Intervención registrada', body: 'Sustitución del disco con alerta SMART en el servidor de respaldo.',
      at: isoAgo(420), readAt: isoAgo(300), channels: ['smtp']
    },
    {
      id: 'not-05', kind: 'maintenance', severity: 'media', assetId: 'AM-1058',
      title: 'Mantenimiento preventivo vencido', body: 'La revisión semestral de la UPS del rack A pasó su fecha prevista.',
      at: isoAgo(1500), readAt: '', channels: ['smtp']
    },
    {
      id: 'not-06', kind: 'alert', severity: 'media', alertId: 'ALT-2412', assetId: 'AM-1050',
      title: 'ALT-2412 resuelta', body: 'La latencia del switch de núcleo volvió a su valor habitual tras ampliar la ventana.',
      at: isoAgo(2400), readAt: isoAgo(2380), channels: []
    },
    {
      id: 'not-07', kind: 'system', severity: 'baja', alertId: '', assetId: '',
      title: 'Reglas de escalamiento actualizadas', body: 'Se desactivó el aviso por Telegram hasta validar el bot.',
      at: isoAgo(3600), readAt: '', channels: []
    }
  ];

  const NOTIFICATION_KINDS = [
    localized({ id: 'alert', labelKey: 'ui.monitoring.notification_kind.alert', icon: 'alert', tone: 'warn' }),
    localized({ id: 'incident', labelKey: 'ui.monitoring.notification_kind.incident', icon: 'shield', tone: 'down' }),
    localized({ id: 'maintenance', labelKey: 'ui.monitoring.notification_kind.maintenance', icon: 'refresh', tone: 'hold' }),
    localized({ id: 'system', labelKey: 'ui.monitoring.notification_kind.system', icon: 'info', tone: 'neutral' })
  ];

  const PREFS = {
    range: '7d',
    defaultTab: 'estado',
    autoRefresh: false,
    refreshSeconds: 30,
    showUnmonitored: true,
    groupRepeats: true,
    highlightIntermittent: true,
    inAppNotifications: true,
    businessHours: { from: '08:00', to: '18:00', days: [1, 2, 3, 4, 5] }
  };

  const PRIORITIES = Maint.PRIORITIES || [
    localized({ id: 'critica', labelKey: 'ui.monitoring.severity.critical', tone: 'down', weight: 4 }),
    localized({ id: 'alta', labelKey: 'ui.monitoring.severity.warning', tone: 'warn', weight: 3 }),
    localized({ id: 'media', labelKey: 'ui.monitoring.severity.info', tone: 'hold', weight: 2 }),
    localized({ id: 'baja', labelKey: 'ui.monitoring.severity.low', tone: 'neutral', weight: 1 })
  ];

  function seed() {
    return {
      version: 1,
      checks: clone(CHECKS),
      policies: clone(POLICIES),
      exceptions: clone(EXCEPTIONS),
      probes: clone(PROBES),
      silences: clone(SILENCES),
      windows: clone(WINDOWS),
      channels: clone(CHANNELS),
      escalations: clone(ESCALATIONS),
      notifications: clone(NOTIFICATIONS),
      prefs: clone(PREFS)
    };
  }

  window.ASSET_MONITOR = {
    CHECKS,
    STATUSES,
    RANGES,
    POLICIES,
    EXCEPTIONS,
    PROBES,
    SILENCES,
    WINDOWS,
    CHANNELS,
    ESCALATIONS,
    NOTIFICATIONS,
    NOTIFICATION_KINDS,
    PREFS,
    PRIORITIES,
    clone,
    hash,
    isoInHours,
    isoAgo,
    // Re-attaches the catalog getters after a derived copy, so a normalized
    // entry still follows a locale switch instead of keeping its first value.
    relabel,
    seed
  };
})();
