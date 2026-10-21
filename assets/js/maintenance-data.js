(function () {
  'use strict';

  const DAY = 86400000;

  function isoAt(offsetDays, hours, minutes) {
    const date = new Date();
    date.setHours(hours === undefined ? 9 : hours, minutes === undefined ? 0 : minutes, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString();
  }

  function dayAt(offsetDays) {
    return isoAt(offsetDays).slice(0, 10);
  }

  // Relative hour helpers keep the seeded alert history recent without ever
  // landing in the future: a fixed clock time would break before that hour.
  function isoInHours(offsetHours) {
    return new Date(Date.now() + offsetHours * 3600000).toISOString();
  }

  function isoAgoHours(offsetHours) {
    return new Date(Date.now() - offsetHours * 3600000).toISOString();
  }

  // ---------------------------------------------------------------- types
  const INTERVENTION_TYPES = [
    {
      id: 'preventivo',
      label: 'Preventivo',
      icon: 'refresh',
      tone: 'ok',
      resetsPreventive: true,
      hint: 'Revisión periódica del plan. Reinicia el intervalo preventivo al completarse.'
    },
    {
      id: 'correctivo',
      label: 'Correctivo',
      icon: 'alert',
      tone: 'warn',
      resetsPreventive: false,
      hint: 'Reparación de una avería. No reinicia el intervalo preventivo.'
    },
    {
      id: 'inspeccion',
      label: 'Inspección',
      icon: 'search',
      tone: 'neutral',
      resetsPreventive: false,
      hint: 'Comprobación puntual sin sustitución de piezas.'
    },
    {
      id: 'actualizacion',
      label: 'Actualización',
      icon: 'download',
      tone: 'neutral',
      resetsPreventive: false,
      hint: 'Firmware, sistema operativo o software del equipo.'
    },
    {
      id: 'sustitucion',
      label: 'Sustitución',
      icon: 'box',
      tone: 'warn',
      resetsPreventive: false,
      hint: 'Cambio de un componente o repuesto.'
    },
    {
      id: 'limpieza',
      label: 'Limpieza',
      icon: 'check',
      tone: 'neutral',
      resetsPreventive: false,
      hint: 'Limpieza física o lógica sin intervención mayor.'
    }
  ];

  // ---------------------------------------------------------------- templates
  const TEMPLATES = [
    {
      id: 'tpl-ups',
      category: 'ups',
      label: 'Revisión de UPS',
      intervalMonths: 6,
      active: true,
      tasks: [
        'Prueba de autonomía y transferencia a batería',
        'Revisión del estado de baterías y bornes',
        'Comprobación de alarmas y registro de eventos',
        'Limpieza de rejillas y verificación de ventilación'
      ]
    },
    {
      id: 'tpl-servidores',
      category: 'servidores',
      label: 'Revisión de servidores',
      intervalMonths: 3,
      active: true,
      tasks: [
        'Lectura de SMART y estado del RAID',
        'Revisión de temperaturas y ventiladores',
        'Actualización de firmware y agentes de gestión',
        'Limpieza de filtros y comprobación de logs'
      ]
    },
    {
      id: 'tpl-switches',
      category: 'switches',
      label: 'Mantenimiento de red',
      intervalMonths: 6,
      active: true,
      tasks: [
        'Copia de seguridad de la configuración',
        'Revisión de puertos, errores y SFP',
        'Limpieza y comprobación de ventilación',
        'Actualización de firmware planificada'
      ]
    },
    {
      id: 'tpl-camaras',
      category: 'camaras',
      label: 'Revisión de videovigilancia',
      intervalMonths: 3,
      active: true,
      tasks: [
        'Limpieza de lente y comprobación del enfoque',
        'Verificación de visión nocturna e infrarrojos',
        'Comprobación de grabación y retención',
        'Revisión de cableado y alimentación PoE'
      ]
    },
    {
      id: 'tpl-computadoras',
      category: 'computadoras',
      label: 'Mantenimiento de equipos',
      intervalMonths: 12,
      active: true,
      tasks: [
        'Limpieza interna y de ventiladores',
        'Actualizaciones del sistema y antivirus',
        'Comprobación de disco y de la batería CMOS',
        'Verificación de cableado y periféricos'
      ]
    },
    {
      id: 'tpl-notebooks',
      category: 'notebooks',
      label: 'Mantenimiento de notebooks',
      intervalMonths: 12,
      active: true,
      tasks: [
        'Limpieza del sistema de refrigeración',
        'Diagnóstico de batería y cargador',
        'Actualizaciones del sistema operativo',
        'Revisión de bisagras y teclado'
      ]
    },
    {
      id: 'tpl-impresoras',
      category: 'impresoras',
      label: 'Mantenimiento de impresión',
      intervalMonths: 3,
      active: true,
      tasks: [
        'Limpieza de rodillos y zona de paso de papel',
        'Revisión de consumibles y contadores',
        'Prueba de impresión y alineación',
        'Comprobación de conectividad en red'
      ]
    },
    {
      id: 'tpl-virtualizacion',
      category: 'virtualizacion',
      label: 'Revisión de máquinas virtuales',
      intervalMonths: 6,
      active: true,
      tasks: [
        'Comprobación de respaldos y snapshots',
        'Revisión de espacio en discos virtuales',
        'Actualizaciones del sistema invitado',
        'Verificación de alarmas del hipervisor'
      ]
    },
    {
      id: 'tpl-contenedores',
      category: 'contenedores',
      label: 'Revisión de contenedores',
      intervalMonths: 6,
      active: true,
      tasks: [
        'Actualización de la imagen base',
        'Revisión de límites de CPU y memoria',
        'Comprobación de respaldos de volúmenes',
        'Rotación de logs y verificación de salud'
      ]
    }
  ];

  // ---------------------------------------------------------------- plans
  const PLANS = [
    {
      id: 'plan-AM-1058',
      assetId: 'AM-1058',
      templateId: 'tpl-ups',
      intervalMonths: 6,
      lastCompletedAt: dayAt(-190),
      tasks: TEMPLATES[0].tasks.slice(),
      exceptions: [],
      note: 'Rack A-04. Incluye prueba de transferencia con carga real.',
      paused: false
    },
    {
      id: 'plan-AM-1047',
      assetId: 'AM-1047',
      templateId: 'tpl-servidores',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-85),
      tasks: TEMPLATES[1].tasks.slice(),
      exceptions: ['El firmware se actualiza junto al hipervisor, no en ventana propia.'],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1050',
      assetId: 'AM-1050',
      templateId: 'tpl-switches',
      intervalMonths: 6,
      lastCompletedAt: dayAt(-182),
      tasks: TEMPLATES[2].tasks.slice(),
      exceptions: [],
      note: 'Ventana de mantenimiento: martes de 07:00 a 08:00.',
      paused: false
    },
    {
      id: 'plan-AM-1057',
      assetId: 'AM-1057',
      templateId: 'tpl-camaras',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-88),
      tasks: TEMPLATES[3].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1046',
      assetId: 'AM-1046',
      templateId: 'tpl-servidores',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-70),
      tasks: TEMPLATES[1].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1062',
      assetId: 'AM-1062',
      templateId: 'tpl-servidores',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-60),
      tasks: TEMPLATES[1].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1042',
      assetId: 'AM-1042',
      templateId: 'tpl-notebooks',
      intervalMonths: 12,
      lastCompletedAt: dayAt(-370),
      tasks: TEMPLATES[5].tasks.slice(),
      exceptions: ['Se entrega con el cargador de viaje; no requiere limpieza interna anual.'],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1048',
      assetId: 'AM-1048',
      templateId: 'tpl-impresoras',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-95),
      tasks: TEMPLATES[6].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1067',
      assetId: 'AM-1067',
      templateId: 'tpl-camaras',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-3),
      tasks: TEMPLATES[3].tasks.slice(),
      exceptions: [],
      note: 'Cubre el pasillo de racks y el acceso a la zona fría.',
      paused: false
    },
    {
      id: 'plan-AM-1064',
      assetId: 'AM-1064',
      templateId: 'tpl-switches',
      intervalMonths: 6,
      lastCompletedAt: dayAt(-181),
      tasks: TEMPLATES[2].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1059',
      assetId: 'AM-1059',
      templateId: 'tpl-virtualizacion',
      intervalMonths: 6,
      lastCompletedAt: dayAt(-160),
      tasks: TEMPLATES[7].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1051',
      assetId: 'AM-1051',
      templateId: 'tpl-switches',
      intervalMonths: 6,
      lastCompletedAt: dayAt(-140),
      tasks: TEMPLATES[2].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1065',
      assetId: 'AM-1065',
      templateId: 'tpl-computadoras',
      intervalMonths: 12,
      lastCompletedAt: dayAt(-350),
      tasks: TEMPLATES[4].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1044',
      assetId: 'AM-1044',
      templateId: 'tpl-computadoras',
      intervalMonths: 12,
      lastCompletedAt: dayAt(-360),
      tasks: TEMPLATES[4].tasks.slice(),
      exceptions: [],
      note: '',
      paused: false
    },
    {
      id: 'plan-AM-1061',
      assetId: 'AM-1061',
      templateId: 'tpl-impresoras',
      intervalMonths: 3,
      lastCompletedAt: dayAt(-120),
      tasks: TEMPLATES[6].tasks.slice(),
      exceptions: [],
      note: 'Equipo dado de baja: el plan queda en pausa.',
      paused: true
    }
  ];

  // ---------------------------------------------------------------- interventions
  const INTERVENTIONS = [
    {
      id: 'INT-2401',
      assetId: 'AM-1058',
      type: 'preventivo',
      title: 'Revisión semestral de UPS',
      description: 'Prueba de transferencia con carga real y revisión de baterías del rack A.',
      date: isoAt(-12, 8, 30),
      state: 'done',
      technicianId: 'sergio-vidal',
      notes: 'Autonomía medida: 14 min al 60 % de carga. Sin alarmas activas.',
      parts: [{ label: 'Batería RBC7', qty: 2, cost: 180 }],
      attachments: [{ name: 'informe-ups-rack-a.pdf', size: '148 KB', kind: 'pdf' }],
      incidentId: '',
      completedAt: isoAt(-12, 11, 10)
    },
    {
      id: 'INT-2402',
      assetId: 'AM-1047',
      type: 'correctivo',
      title: 'Sustitución de disco con alerta SMART',
      description: 'El disco 2 del arreglo presentaba sectores reasignados y alertas intermitentes.',
      date: isoAt(-5, 9, 15),
      state: 'done',
      technicianId: 'lucia-pardo',
      notes: 'Arreglo reconstruido al 100 %. El plan preventivo sigue su calendario.',
      parts: [{ label: 'SSD empresarial 480 GB', qty: 1, cost: 95 }],
      attachments: [{ name: 'smart-disco-2.txt', size: '12 KB', kind: 'txt' }],
      incidentId: 'INC-2404',
      completedAt: isoAt(-5, 13, 40)
    },
    {
      id: 'INT-2403',
      assetId: 'AM-1050',
      type: 'preventivo',
      title: 'Mantenimiento semestral del switch de núcleo',
      description: 'Copia de configuración, revisión de puertos y limpieza del chasis.',
      date: isoAt(0, 7, 0),
      state: 'in_progress',
      technicianId: 'ivan-costa',
      notes: 'Ventana abierta. Pendiente la actualización de firmware.',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: ''
    },
    {
      id: 'INT-2404',
      assetId: 'AM-1057',
      type: 'preventivo',
      title: 'Revisión trimestral de cámara de recepción',
      description: 'Limpieza de lente, comprobación de infrarrojos y retención de grabación.',
      date: isoAt(2, 9, 0),
      state: 'planned',
      technicianId: 'diego-salas',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: 'INC-2405',
      completedAt: ''
    },
    {
      id: 'INT-2405',
      assetId: 'AM-1046',
      type: 'preventivo',
      title: 'Revisión trimestral del servidor de virtualización',
      description: 'SMART, RAID, temperaturas y actualización de agentes de gestión.',
      date: isoAt(10, 8, 0),
      state: 'planned',
      technicianId: 'sergio-vidal',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: ''
    },
    {
      id: 'INT-2406',
      assetId: 'AM-1062',
      type: 'correctivo',
      title: 'Revisión de latencia del servidor de aplicaciones',
      description: 'Picos de latencia tras el incidente de facturación; se revisan conexiones y colas.',
      date: isoAt(1, 10, 0),
      state: 'planned',
      technicianId: 'lucia-pardo',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: 'INC-2401',
      completedAt: ''
    },
    {
      id: 'INT-2407',
      assetId: 'AM-1060',
      type: 'correctivo',
      title: 'Reinicio y ajuste de límites del contenedor de API',
      description: 'El contenedor alcanzó el límite de CPU durante el pico de facturación.',
      date: isoAt(-2, 11, 20),
      state: 'done',
      technicianId: 'sergio-vidal',
      notes: 'Límite de CPU ampliado a 2 núcleos y memoria a 2 GB.',
      parts: [],
      attachments: [{ name: 'docker-stats.png', size: '86 KB', kind: 'imagen' }],
      incidentId: 'INC-2401',
      completedAt: isoAt(-2, 12, 5)
    },
    {
      id: 'INT-2408',
      assetId: 'AM-1048',
      type: 'correctivo',
      title: 'Atasco recurrente en la bandeja 1',
      description: 'La impresora de administración atasca el papel en la bandeja superior.',
      date: isoAt(1, 9, 30),
      state: 'planned',
      technicianId: 'diego-salas',
      notes: '',
      parts: [{ label: 'Rodillo de arrastre', qty: 1, cost: 32 }],
      attachments: [],
      incidentId: 'INC-2402',
      completedAt: ''
    },
    {
      id: 'INT-2409',
      assetId: 'AM-1049',
      type: 'preventivo',
      title: 'Revisión trimestral de impresora de recepción',
      description: 'Limpieza de rodillos, consumibles y prueba de red.',
      date: isoAt(-30, 9, 0),
      state: 'done',
      technicianId: 'elena-navarro',
      notes: 'Sin incidencias. Contador de páginas: 12 480.',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: isoAt(-30, 10, 15)
    },
    {
      id: 'INT-2410',
      assetId: 'AM-1067',
      type: 'preventivo',
      title: 'Puesta a punto de la cámara de sala de servidores',
      description: 'Ajuste de encuadre y comprobación del campo de visión tras la instalación.',
      date: isoAt(-3, 16, 0),
      state: 'done',
      technicianId: 'ivan-costa',
      notes: 'Encuadre validado con el diagrama de cobertura.',
      parts: [],
      attachments: [{ name: 'cobertura-camara-dc.svg', size: '3 KB', kind: 'svg' }],
      incidentId: '',
      completedAt: isoAt(-3, 17, 20)
    },
    {
      id: 'INT-2411',
      assetId: 'AM-1064',
      type: 'correctivo',
      title: 'Puerto 12 sin enlace en el switch de acceso Norte',
      description: 'El puerto presentaba errores CRC y caídas intermitentes.',
      date: isoAt(-20, 12, 0),
      state: 'done',
      technicianId: 'ivan-costa',
      notes: 'Se movió el cableado al puerto 18 y se reemplazó el latiguillo.',
      parts: [{ label: 'Latiguillo Cat 6 2 m', qty: 1, cost: 8 }],
      attachments: [],
      incidentId: '',
      completedAt: isoAt(-20, 12, 45)
    },
    {
      id: 'INT-2412',
      assetId: 'AM-1059',
      type: 'preventivo',
      title: 'Revisión semestral de la VM de facturación',
      description: 'Respaldos, snapshots y espacio en discos virtuales.',
      date: isoAt(21, 9, 0),
      state: 'planned',
      technicianId: 'lucia-pardo',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: ''
    },
    {
      id: 'INT-2413',
      assetId: 'AM-1051',
      type: 'preventivo',
      title: 'Revisión semestral del switch de planta',
      description: 'Configuración respaldada, puertos y limpieza.',
      date: isoAt(40, 8, 30),
      state: 'planned',
      technicianId: 'ivan-costa',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: ''
    },
    {
      id: 'INT-2414',
      assetId: 'AM-1045',
      type: 'inspeccion',
      title: 'Revisión de equipo sin responsable',
      description: 'Equipo de producción sin asignar: se comprueba estado físico y etiquetado.',
      date: isoAt(6, 10, 0),
      state: 'planned',
      technicianId: 'diego-salas',
      notes: '',
      parts: [],
      attachments: [],
      incidentId: '',
      completedAt: ''
    }
  ];

  // ---------------------------------------------------------------- incidents
  const INCIDENTS = [
    {
      id: 'INC-2401',
      title: 'Caída intermitente del servicio de facturación',
      description: 'Los usuarios reportan cortes al emitir facturas. El contenedor de API alcanza el límite de CPU y la VM de facturación responde con latencia.',
      priority: 'critica',
      state: 'en_curso',
      primaryAssetId: 'AM-1059',
      affectedIds: ['AM-1060', 'AM-1046'],
      assigneeId: 'lucia-pardo',
      openedAt: isoAt(-2, 8, 45),
      resolvedAt: '',
      closedAt: '',
      actions: [
        { id: 'act-1', at: isoAt(-2, 8, 50), actor: 'Lucía Pardo', text: 'Se confirma el impacto en facturación y se abre el incidente.' },
        { id: 'act-2', at: isoAt(-2, 10, 10), actor: 'Sergio Vidal', text: 'El contenedor de API se reinicia y se amplía el límite de CPU.' },
        { id: 'act-3', at: isoAt(-1, 9, 20), actor: 'Lucía Pardo', text: 'Se programa revisión de latencia en el servidor de aplicaciones.' }
      ],
      interventionIds: ['INT-2407', 'INT-2406']
    },
    {
      id: 'INC-2402',
      title: 'Atasco de papel en la impresora de administración',
      description: 'La bandeja 1 atasca el papel de forma recurrente desde el lunes.',
      priority: 'media',
      state: 'abierto',
      primaryAssetId: 'AM-1048',
      affectedIds: [],
      assigneeId: 'diego-salas',
      openedAt: isoAt(0, 8, 10),
      resolvedAt: '',
      closedAt: '',
      actions: [
        { id: 'act-4', at: isoAt(0, 8, 12), actor: 'Diego Salas', text: 'Se registra la incidencia desde la ficha del activo.' }
      ],
      interventionIds: ['INT-2408']
    },
    {
      id: 'INC-2403',
      title: 'Pérdida de conectividad en Planta Sur',
      description: 'El switch de planta dejó de responder durante 14 minutos y arrastró al teléfono de operaciones.',
      priority: 'alta',
      state: 'en_curso',
      primaryAssetId: 'AM-1051',
      affectedIds: ['AM-1056'],
      assigneeId: 'ivan-costa',
      openedAt: isoAt(-6, 15, 5),
      resolvedAt: '',
      closedAt: '',
      actions: [
        { id: 'act-5', at: isoAt(-6, 15, 8), actor: 'Iván Costa', text: 'Se detecta el corte desde la supervisión y se abre el incidente.' },
        { id: 'act-6', at: isoAt(-6, 15, 30), actor: 'Iván Costa', text: 'Se reinicia el switch y se revisa la alimentación del rack.' },
        { id: 'act-7', at: isoAt(-5, 9, 40), actor: 'Iván Costa', text: 'La supervisión deja de reportar el corte. Se confirma la resolución tras la ventana de observación.' }
      ],
      interventionIds: []
    },
    {
      id: 'INC-2404',
      title: 'Ruido y alerta SMART en el servidor de respaldo',
      description: 'El servidor de respaldo emite ruido en el ventilador 3 y el disco 2 presenta alertas SMART.',
      priority: 'baja',
      state: 'abierto',
      primaryAssetId: 'AM-1047',
      affectedIds: [],
      assigneeId: 'sergio-vidal',
      openedAt: isoAt(-9, 11, 0),
      resolvedAt: '',
      closedAt: '',
      actions: [
        { id: 'act-8', at: isoAt(-9, 11, 5), actor: 'Sergio Vidal', text: 'Se abre el incidente a partir de la alerta de supervisión.' },
        { id: 'act-9', at: isoAt(-5, 13, 45), actor: 'Lucía Pardo', text: 'Disco sustituido. Queda pendiente revisar el ventilador.' }
      ],
      interventionIds: ['INT-2402']
    },
    {
      id: 'INC-2405',
      title: 'Cámara de recepción sin grabación',
      description: 'La cámara de recepción no envía segmentos al grabador desde hace tres días.',
      priority: 'media',
      state: 'abierto',
      primaryAssetId: 'AM-1057',
      affectedIds: [],
      assigneeId: 'diego-salas',
      openedAt: isoAt(-3, 10, 25),
      resolvedAt: '',
      closedAt: '',
      actions: [
        { id: 'act-10', at: isoAt(-3, 10, 30), actor: 'Diego Salas', text: 'Se vincula la alerta de heartbeat al incidente.' }
      ],
      interventionIds: ['INT-2404']
    }
  ];

  // ---------------------------------------------------------------- alerts
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

  const PREFS = {
    rangeDays: 30,
    showCompleted: false,
    defaultAssigneeId: '',
    defaultView: 'agenda'
  };

  const PRIORITIES = [
    { id: 'critica', label: 'Crítica', tone: 'down', weight: 4 },
    { id: 'alta', label: 'Alta', tone: 'warn', weight: 3 },
    { id: 'media', label: 'Media', tone: 'hold', weight: 2 },
    { id: 'baja', label: 'Baja', tone: 'neutral', weight: 1 }
  ];

  const INCIDENT_STATES = [
    { id: 'abierto', label: 'Abierto', tone: 'warn' },
    { id: 'en_curso', label: 'En curso', tone: 'hold' },
    { id: 'resuelto', label: 'Resuelto', tone: 'ok' },
    { id: 'cerrado', label: 'Cerrado', tone: 'neutral' }
  ];

  const INTERVENTION_STATES = [
    { id: 'planned', label: 'Planificada', tone: 'hold' },
    { id: 'in_progress', label: 'En curso', tone: 'warn' },
    { id: 'done', label: 'Completada', tone: 'ok' },
    { id: 'cancelled', label: 'Cancelada', tone: 'neutral' }
  ];

  const ALERT_STATES = [
    { id: 'open', label: 'Activa', tone: 'warn' },
    { id: 'recovered', label: 'Recuperada', tone: 'ok' },
    { id: 'converted', label: 'Convertida', tone: 'hold' },
    { id: 'linked', label: 'Vinculada', tone: 'neutral' },
    { id: 'resolved', label: 'Resuelta', tone: 'ok' }
  ];

  const ALERT_KINDS = [
    { id: 'offline', label: 'Sin conexión', icon: 'x-circle' },
    { id: 'heartbeat', label: 'Sin señal', icon: 'activity' },
    { id: 'cpu', label: 'CPU alta', icon: 'activity' },
    { id: 'disk', label: 'Disco', icon: 'server' },
    { id: 'battery', label: 'Batería', icon: 'battery' },
    { id: 'temperature', label: 'Temperatura', icon: 'alert' },
    { id: 'latency', label: 'Latencia alta', icon: 'activity' },
    { id: 'services', label: 'Servicio caído', icon: 'x-circle' }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function seed() {
    return {
      version: 1,
      types: clone(INTERVENTION_TYPES),
      templates: clone(TEMPLATES),
      plans: clone(PLANS),
      interventions: clone(INTERVENTIONS),
      incidents: clone(INCIDENTS),
      alerts: clone(ALERTS),
      prefs: clone(PREFS)
    };
  }

  window.ASSET_MAINT = {
    DAY: DAY,
    INTERVENTION_TYPES,
    TEMPLATES,
    PLANS,
    INTERVENTIONS,
    INCIDENTS,
    ALERTS,
    PREFS,
    PRIORITIES,
    INCIDENT_STATES,
    INTERVENTION_STATES,
    ALERT_STATES,
    ALERT_KINDS,
    isoAt,
    dayAt,
    isoInHours,
    isoAgoHours,
    clone,
    seed
  };
})();
