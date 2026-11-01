(function () {
  'use strict';

  /* Maintenance constants and the explicitly demo monitoring alert fixtures.
   *
   * Phase 7 removed the prototype plans, interventions, incidents and templates:
   * those collections are server-authoritative through the maintenance adapter.
   * Only the monitoring alert list is still demo data for the next phase, and it
   * is labelled as such wherever it is rendered. */

  function dayAt(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function isoAt(offsetDays, hours, minutes) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  }

  function isoInHours(hours) {
    return new Date(Date.now() + hours * 3600000).toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* Display text comes from the ui.maintenance.* catalog. The ids stay stable
   * server vocabulary; the getters resolve the active locale on read so a
   * locale switch re-renders the labels. */
  function label(key) {
    return window.ItsmI18n ? window.ItsmI18n.t(key) : '';
  }

  /* Canonical server vocabulary: preventive, corrective, inspection,
   * installation and other. The labels are display-only. */
  const INTERVENTION_TYPES = [
    { id: 'preventive', get label() { return label('ui.maintenance.type.preventive'); }, icon: 'refresh', tone: 'ok', resetsPreventive: true, get hint() { return label('ui.maintenance.type.preventive_hint'); } },
    { id: 'corrective', get label() { return label('ui.maintenance.type.corrective'); }, icon: 'alert', tone: 'warn', resetsPreventive: false, get hint() { return label('ui.maintenance.type.corrective_hint'); } },
    { id: 'inspection', get label() { return label('ui.maintenance.type.inspection'); }, icon: 'search', tone: 'neutral', resetsPreventive: false, get hint() { return label('ui.maintenance.type.inspection_hint'); } },
    { id: 'installation', get label() { return label('ui.maintenance.type.installation'); }, icon: 'download', tone: 'neutral', resetsPreventive: false, get hint() { return label('ui.maintenance.type.installation_hint'); } },
    { id: 'other', get label() { return label('ui.maintenance.type.other'); }, icon: 'box', tone: 'neutral', resetsPreventive: false, get hint() { return label('ui.maintenance.type.other_hint'); } }
  ];

  const ALERTS = [
    {
      id: 'ALT-2401',
      assetId: 'AM-1051',
      kind: 'offline',
      severity: 'alta',
      message: 'El switch de planta no responde a ping desde la red de gestión.',
      detectedAt: isoAt(-6, 15, 2),
      recoveredAt: isoAt(-6, 15, 45),
      state: 'recovered',
      incidentId: 'INC-2403',
      suggestion: true
    },
    {
      id: 'ALT-2402',
      assetId: 'AM-1047',
      kind: 'disk',
      severity: 'alta',
      message: 'SMART: 214 sectores reasignados en el disco 2 del arreglo.',
      detectedAt: isoAt(-9, 10, 40),
      recoveredAt: '',
      state: 'converted',
      incidentId: 'INC-2404',
      suggestion: false
    },
    {
      id: 'ALT-2403',
      assetId: 'AM-1060',
      kind: 'cpu',
      severity: 'critica',
      message: 'Uso de CPU por encima del 95 % durante 15 minutos en el contenedor de API.',
      detectedAt: isoAt(-2, 8, 55),
      recoveredAt: isoAt(-2, 12, 20),
      state: 'open',
      incidentId: '',
      suggestion: false
    },
    {
      id: 'ALT-2404',
      assetId: 'AM-1057',
      kind: 'heartbeat',
      severity: 'media',
      message: 'Sin heartbeat de la cámara de recepción durante 10 minutos.',
      detectedAt: isoAt(-3, 10, 20),
      recoveredAt: '',
      state: 'linked',
      incidentId: 'INC-2405',
      suggestion: false
    },
    {
      id: 'ALT-2405',
      assetId: 'AM-1058',
      kind: 'battery',
      severity: 'baja',
      message: 'La UPS reporta baterías al 78 % de capacidad nominal.',
      detectedAt: isoAt(-14, 7, 35),
      recoveredAt: isoAt(-13, 7, 35),
      state: 'open',
      incidentId: '',
      suggestion: false
    },
    {
      id: 'ALT-2406',
      assetId: 'AM-1047',
      checkId: 'temperature',
      kind: 'temperature',
      severity: 'alta',
      message: 'Temperatura de entrada de 38,4 °C sostenida durante 20 minutos (umbral 32 °C).',
      detectedAt: isoAt(-1, 8, 5),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      acknowledgedAt: isoAt(0, 7, 15),
      acknowledgedBy: 'Diego Salas',
      groupCount: 3,
      lastEventAt: isoAt(0, 7, 15),
      threshold: { checkId: 'temperature', value: 38.4, limit: 32, unit: '°C' },
      events: [
        { id: 'ev-2406-1', at: isoAt(-1, 8, 5), type: 'detected', text: 'Primera lectura por encima del umbral: 36,1 °C.' },
        { id: 'ev-2406-2', at: isoAt(-1, 22, 40), type: 'repeated', text: 'Segunda lectura: 37,6 °C.' },
        { id: 'ev-2406-3', at: isoAt(-1, 23, 50), type: 'repeated', text: 'Tercera lectura: 38,4 °C. Se agrupa con las anteriores.' },
        { id: 'ev-2406-4', at: isoAt(0, 7, 15), type: 'acknowledged', text: 'Reconocida por Diego Salas. El problema continúa activo.' }
      ]
    },
    {
      id: 'ALT-2407',
      assetId: 'AM-1064',
      checkId: 'availability',
      kind: 'heartbeat',
      severity: 'alta',
      message: 'El switch de acceso Norte pierde respuesta de forma intermitente (4 cortes en 12 horas).',
      detectedAt: isoAt(-2, 6, 12),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 4,
      lastEventAt: isoAt(-1, 6, 45),
      intermittent: true,
      threshold: { checkId: 'availability', value: 96.2, limit: 99, unit: '%' },
      events: [
        { id: 'ev-2407-1', at: isoAt(-2, 6, 12), type: 'detected', text: 'Sin respuesta durante 3 minutos. Recuperado a las 06:18.' },
        { id: 'ev-2407-2', at: isoAt(-1, 19, 40), type: 'repeated', text: 'Nuevo corte de 2 minutos. Recuperado automáticamente.' },
        { id: 'ev-2407-3', at: isoAt(-1, 2, 8), type: 'repeated', text: 'Tercer corte, 4 minutos sin respuesta.' },
        { id: 'ev-2407-4', at: isoAt(-1, 6, 45), type: 'repeated', text: 'Cuarto corte. Se marca como fallo intermitente y se agrupa la serie.' }
      ]
    },
    {
      id: 'ALT-2408',
      assetId: 'AM-1067',
      checkId: 'availability',
      kind: 'heartbeat',
      severity: 'media',
      message: 'La cámara de sala de servidores no entrega señal de vídeo desde la última comprobación.',
      detectedAt: isoAt(-1, 5, 20),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      silencedUntil: isoInHours(15),
      silenceReason: 'Se está revisando el latiguillo del rack A-04.',
      groupCount: 2,
      lastEventAt: isoAt(-1, 9, 10),
      threshold: { checkId: 'availability', value: 0, limit: 99, unit: '%' },
      events: [
        { id: 'ev-2408-1', at: isoAt(-1, 5, 20), type: 'detected', text: 'Sin señal de vídeo ni respuesta a ping.' },
        { id: 'ev-2408-2', at: isoAt(-1, 6, 30), type: 'silenced', text: 'Silenciada 14 horas por revisión física del latiguillo.' }
      ]
    },
    {
      id: 'ALT-2409',
      assetId: 'AM-1063',
      checkId: 'disk',
      kind: 'disk',
      severity: 'alta',
      message: 'El volumen de respaldos alcanza el 88 % de su capacidad (umbral 80 %).',
      detectedAt: isoAt(-4, 3, 15),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 5,
      lastEventAt: isoAt(-1, 3, 15),
      threshold: { checkId: 'disk', value: 88, limit: 80, unit: '%' },
      events: [
        { id: 'ev-2409-1', at: isoAt(-4, 3, 15), type: 'detected', text: 'Ocupación del 81 %. Política de retención de 90 días.' },
        { id: 'ev-2409-5', at: isoAt(-1, 3, 15), type: 'repeated', text: 'Ocupación del 88 %. Se agrupa con las lecturas anteriores.' }
      ]
    },
    {
      id: 'ALT-2410',
      assetId: 'AM-1060',
      checkId: 'services',
      kind: 'services',
      severity: 'media',
      message: 'El servicio de cola del contenedor de API está detenido.',
      detectedAt: isoAt(-1, 4, 55),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 1,
      lastEventAt: isoAt(-1, 4, 55),
      threshold: { checkId: 'services', value: 1, limit: 1, unit: 'servicios' },
      events: [
        { id: 'ev-2410-1', at: isoAt(-1, 4, 55), type: 'detected', text: 'La comprobación de servicios devuelve worker detenido.' }
      ]
    },
    {
      id: 'ALT-2411',
      assetId: 'AM-1058',
      checkId: 'temperature',
      kind: 'temperature',
      severity: 'baja',
      message: 'Temperatura de la UPS de 34,2 °C, por encima del valor habitual de la sala.',
      detectedAt: isoAt(-5, 13, 10),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 2,
      lastEventAt: isoAt(-1, 13, 10),
      threshold: { checkId: 'temperature', value: 34.2, limit: 32, unit: '°C' }
    },
    {
      id: 'ALT-2412',
      assetId: 'AM-1050',
      checkId: 'latency',
      kind: 'latency',
      severity: 'media',
      message: 'Latencia del switch de núcleo por encima de 120 ms durante la ventana de respaldo.',
      detectedAt: isoAt(-7, 1, 22),
      recoveredAt: isoAt(-7, 2, 10),
      resolvedAt: isoAt(-6, 9, 30),
      resolvedBy: 'Sergio Vidal',
      state: 'resolved',
      incidentId: '',
      suggestion: false,
      acknowledgedAt: isoAt(-7, 1, 40),
      acknowledgedBy: 'Sergio Vidal',
      groupCount: 3,
      lastEventAt: isoAt(-7, 2, 10),
      threshold: { checkId: 'latency', value: 148, limit: 60, unit: 'ms' },
      events: [
        { id: 'ev-2412-1', at: isoAt(-7, 1, 22), type: 'detected', text: 'Latencia media de 148 ms coincidiendo con el respaldo nocturno.' },
        { id: 'ev-2412-2', at: isoAt(-7, 2, 10), type: 'recovered', text: 'La latencia vuelve a 12 ms. Se sugiere revisar la ventana.' },
        { id: 'ev-2412-3', at: isoAt(-6, 9, 30), type: 'resolved', text: 'Resuelta por Sergio Vidal tras ampliar la ventana de respaldo.' }
      ]
    },
    {
      id: 'ALT-2413',
      assetId: 'AM-1069',
      checkId: 'availability',
      kind: 'offline',
      severity: 'alta',
      message: 'El reloj biométrico de recepción no responde desde la red de gestión.',
      detectedAt: isoAt(-1, 7, 45),
      recoveredAt: '',
      state: 'open',
      incidentId: '',
      suggestion: false,
      groupCount: 2,
      lastEventAt: isoAt(-1, 9, 2),
      threshold: { checkId: 'availability', value: 0, limit: 99, unit: '%' },
      events: [
        { id: 'ev-2413-1', at: isoAt(-1, 7, 45), type: 'detected', text: 'Sin respuesta a ping ni al puerto de servicio biométrico.' },
        { id: 'ev-2413-2', at: isoAt(-1, 9, 2), type: 'repeated', text: 'Segunda comprobación sin respuesta.' }
      ]
    }
  ];

  const PREFS = { rangeDays: 30, showCompleted: false, defaultAssigneeId: '', defaultView: 'agenda' };

  const PRIORITIES = [
    { id: 'critical', get label() { return label('ui.maintenance.priority.critical'); }, tone: 'down', weight: 4 },
    { id: 'high', get label() { return label('ui.maintenance.priority.high'); }, tone: 'warn', weight: 3 },
    { id: 'normal', get label() { return label('ui.maintenance.priority.normal'); }, tone: 'hold', weight: 2 },
    { id: 'low', get label() { return label('ui.maintenance.priority.low'); }, tone: 'neutral', weight: 1 }
  ];

  const INCIDENT_STATES = [
    { id: 'open', get label() { return label('ui.incidents.state.open'); }, tone: 'warn' },
    { id: 'in_progress', get label() { return label('ui.incidents.state.in_progress'); }, tone: 'hold' },
    { id: 'resolved', get label() { return label('ui.incidents.state.resolved'); }, tone: 'ok' },
    { id: 'closed', get label() { return label('ui.incidents.state.closed'); }, tone: 'neutral' }
  ];

  const INTERVENTION_STATES = [
    { id: 'open', get label() { return label('ui.maintenance.state.open'); }, tone: 'hold' },
    { id: 'in_progress', get label() { return label('ui.maintenance.state.in_progress'); }, tone: 'warn' },
    { id: 'completed', get label() { return label('ui.maintenance.state.completed'); }, tone: 'ok' },
    { id: 'cancelled', get label() { return label('ui.maintenance.state.cancelled'); }, tone: 'neutral' }
  ];

  const ALERT_STATES = [
    { id: 'open', get label() { return label('ui.maintenance.alert_state.open'); } },
    { id: 'recovered', get label() { return label('ui.maintenance.alert_state.recovered'); } },
    { id: 'converted', get label() { return label('ui.maintenance.alert_state.converted'); } },
    { id: 'linked', get label() { return label('ui.maintenance.alert_state.linked'); } },
    { id: 'resolved', get label() { return label('ui.maintenance.alert_state.resolved'); } }
  ];

  const ALERT_KINDS = [
    { id: 'offline', get label() { return label('ui.maintenance.alert_kind.offline'); }, icon: 'wifi-off' },
    { id: 'heartbeat', get label() { return label('ui.maintenance.alert_kind.heartbeat'); }, icon: 'activity' },
    { id: 'cpu', get label() { return label('ui.maintenance.alert_kind.cpu'); }, icon: 'cpu' },
    { id: 'disk', get label() { return label('ui.maintenance.alert_kind.disk'); }, icon: 'hard-drive' },
    { id: 'battery', get label() { return label('ui.maintenance.alert_kind.battery'); }, icon: 'battery' },
    { id: 'temperature', get label() { return label('ui.maintenance.alert_kind.temperature'); }, icon: 'thermometer' },
    { id: 'latency', get label() { return label('ui.maintenance.alert_kind.latency'); }, icon: 'timer' },
    { id: 'services', get label() { return label('ui.maintenance.alert_kind.services'); }, icon: 'server' }
  ];

  function seedAlerts() {
    return clone(ALERTS);
  }

  window.ASSET_MAINT = {
    INTERVENTION_TYPES,
    ALERTS,
    PREFS,
    PRIORITIES,
    INCIDENT_STATES,
    INTERVENTION_STATES,
    ALERT_STATES,
    ALERT_KINDS,
    dayAt,
    isoAt,
    isoInHours,
    clone,
    seedAlerts
  };
})();
