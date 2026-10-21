(function () {
  'use strict';

  const Maint = window.ASSET_MAINT || {};

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
    {
      id: 'availability',
      label: 'Disponibilidad',
      short: 'Dispo.',
      icon: 'activity',
      unit: '%',
      direction: 'below',
      warn: 99,
      crit: 95,
      metric: false,
      base: true,
      step: 0.01,
      hint: 'Respuesta al ping y al puerto de gestión del equipo.'
    },
    {
      id: 'latency',
      label: 'Latencia',
      short: 'Latencia',
      icon: 'wifi',
      unit: 'ms',
      direction: 'above',
      warn: 60,
      crit: 120,
      metric: true,
      step: 1,
      hint: 'Tiempo de ida y vuelta medio de las últimas comprobaciones.'
    },
    {
      id: 'cpu',
      label: 'CPU',
      short: 'CPU',
      icon: 'activity',
      unit: '%',
      direction: 'above',
      warn: 75,
      crit: 90,
      metric: true,
      step: 1,
      hint: 'Uso medio del procesador durante el intervalo.'
    },
    {
      id: 'memory',
      label: 'Memoria',
      short: 'Mem.',
      icon: 'layers',
      unit: '%',
      direction: 'above',
      warn: 80,
      crit: 92,
      metric: true,
      step: 1,
      hint: 'Memoria en uso sobre el total disponible.'
    },
    {
      id: 'disk',
      label: 'Almacenamiento',
      short: 'Disco',
      icon: 'server',
      unit: '%',
      direction: 'above',
      warn: 80,
      crit: 90,
      metric: true,
      step: 1,
      hint: 'Ocupación del volumen principal.'
    },
    {
      id: 'temperature',
      label: 'Temperatura',
      short: 'Temp.',
      icon: 'thermometer',
      unit: '°C',
      direction: 'above',
      warn: 32,
      crit: 40,
      metric: true,
      step: 0.1,
      hint: 'Lectura de los sensores del equipo o de la sala.'
    },
    {
      id: 'services',
      label: 'Servicios',
      short: 'Servicios',
      icon: 'sliders',
      unit: '%',
      direction: 'below',
      warn: 90,
      crit: 70,
      metric: true,
      step: 1,
      hint: 'Porcentaje de servicios activos sobre el total esperado del equipo.'
    }
  ];

  const STATUSES = [
    { id: 'up', label: 'Disponible', tone: 'ok', icon: 'check', hint: 'Responde y todas las comprobaciones están dentro de rango.' },
    { id: 'degraded', label: 'Degradado', tone: 'warn', icon: 'alert', hint: 'Responde, pero alguna comprobación supera el umbral de aviso.' },
    { id: 'down', label: 'No disponible', tone: 'down', icon: 'x-circle', hint: 'No responde a la comprobación de disponibilidad.' },
    { id: 'unmonitored', label: 'Sin supervisión', tone: 'neutral', icon: 'minus', hint: 'El equipo no tiene comprobaciones configuradas.' }
  ];

  const RANGES = [
    { id: '24h', label: '24 horas', points: 24, stepHours: 1, hint: 'Último día' },
    { id: '7d', label: '7 días', points: 28, stepHours: 6, hint: 'Última semana' },
    { id: '30d', label: '30 días', points: 30, stepHours: 24, hint: 'Último mes' }
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
  const CHANNELS = {
    smtp: {
      enabled: true,
      host: 'smtp.example-org.local',
      port: 587,
      secure: true,
      from: 'noc@example-org.local',
      fromName: 'Supervisión TI',
      recipients: 'guardia@example-org.local; soporte@example-org.local',
      subject: '[{severity}] {asset} · {title}',
      template: 'Se ha detectado una incidencia en {asset} ({site}).\n\n{message}\n\nSeveridad: {severity}\nDetectada: {detectedAt}\nEstado: {state}\n\nAbrir la alerta: {link}',
      lastTestAt: isoAgo(1200),
      lastTestResult: 'ok'
    },
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
    { id: 'alert', label: 'Alerta', icon: 'alert', tone: 'warn' },
    { id: 'incident', label: 'Incidente', icon: 'shield', tone: 'down' },
    { id: 'maintenance', label: 'Mantenimiento', icon: 'refresh', tone: 'hold' },
    { id: 'system', label: 'Sistema', icon: 'info', tone: 'neutral' }
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
    { id: 'critica', label: 'Crítica', tone: 'down', weight: 4 },
    { id: 'alta', label: 'Alta', tone: 'warn', weight: 3 },
    { id: 'media', label: 'Media', tone: 'hold', weight: 2 },
    { id: 'baja', label: 'Baja', tone: 'neutral', weight: 1 }
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
    seed
  };
})();
