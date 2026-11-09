(function () {
  const categories = [
    {
      id: 'computadoras', label: 'Computadoras', slug: 'computadoras', icon: 'desktop',
      image: 'assets/svg/devices/desktop.svg',
      description: 'Equipos de escritorio para puestos administrativos y operativos.'
    },
    {
      id: 'notebooks', label: 'Notebooks', slug: 'notebooks', icon: 'laptop',
      image: 'assets/svg/devices/notebook.svg',
      description: 'Portátiles asignados a movilidad y trabajo híbrido.'
    },
    {
      id: 'servidores', label: 'Servidores', slug: 'servidores', icon: 'server',
      image: 'assets/svg/devices/server.svg',
      description: 'Infraestructura física y virtual de los servicios internos.'
    },
    {
      id: 'impresoras', label: 'Impresoras', slug: 'impresoras', icon: 'printer',
      image: 'assets/svg/devices/printer.svg',
      description: 'Impresoras y equipos multifunción compartidos.'
    },
    {
      id: 'switches', label: 'Switches', slug: 'switches', icon: 'network',
      image: 'assets/svg/devices/switch.svg',
      description: 'Conmutadores y equipamiento de red.'
    },
    {
      id: 'monitores', label: 'Monitores', slug: 'monitores', icon: 'display',
      image: 'assets/svg/devices/monitor.svg',
      description: 'Pantallas y periféricos de visualización.'
    },
    {
      id: 'camaras', label: 'Cámaras', slug: 'camaras', icon: 'camera',
      image: 'assets/svg/devices/camera.svg',
      description: 'Cámaras IP y equipos de videovigilancia.'
    },
    {
      id: 'ups', label: 'UPS', slug: 'ups', icon: 'battery',
      image: 'assets/svg/devices/ups.svg',
      description: 'Sistemas de alimentación ininterrumpida.'
    },
    {
      id: 'virtualizacion', label: 'Virtualización', slug: 'virtualizacion', icon: 'layers',
      image: 'assets/svg/devices/vm.svg',
      description: 'Máquinas virtuales alojadas en los hipervisores.'
    },
    {
      id: 'contenedores', label: 'Contenedores', slug: 'contenedores', icon: 'box',
      image: 'assets/svg/devices/container.svg',
      description: 'Contenedores y servicios desplegados sobre Docker.'
    },
    {
      id: 'otros', label: 'Otros equipos', slug: 'otros', icon: 'package',
      image: 'assets/svg/devices/other.svg',
      description: 'Accesorios y equipos sin categoría específica.'
    }
  ];

  const sites = [
    {
      id: 'central', label: 'Sede Central', short: 'Central',
      locations: [
        { id: 'diseno', label: 'Piso 3 · Diseño' },
        { id: 'administracion', label: 'Piso 2 · Administración' },
        { id: 'direccion', label: 'Piso 4 · Dirección' }
      ]
    },
    {
      id: 'norte', label: 'Sede Norte', short: 'Norte',
      locations: [
        { id: 'soporte', label: 'Piso 1 · Soporte técnico' },
        { id: 'recepcion', label: 'Planta baja · Recepción' }
      ]
    },
    {
      id: 'sur', label: 'Planta Sur', short: 'Sur',
      locations: [
        { id: 'produccion', label: 'Nave 2 · Producción' },
        { id: 'comunicaciones', label: 'Sala de comunicaciones · Nave 1' },
        { id: 'operaciones', label: 'Nave 2 · Operaciones' }
      ]
    },
    {
      id: 'dc', label: 'Data Center', short: 'Data Center',
      locations: [
        { id: 'zona-fria-a', label: 'Rack A-04 · Zona fría' },
        { id: 'zona-fria-b', label: 'Rack B-02 · Zona fría' },
        { id: 'sala-comunicaciones', label: 'Rack A-01 · Sala de comunicaciones' }
      ]
    }
  ];

  const departments = [
    { id: 'direccion', label: 'Dirección' },
    { id: 'diseno', label: 'Diseño' },
    { id: 'administracion', label: 'Administración' },
    { id: 'soporte', label: 'Soporte técnico' },
    { id: 'operaciones', label: 'Operaciones' },
    { id: 'infraestructura', label: 'Infraestructura' },
    { id: 'sistemas', label: 'Sistemas' },
    { id: 'redes', label: 'Redes' }
  ];

  const assets = [
    {
      id: 'AM-1042', name: 'Notebook de diseño', type: 'Notebook', category: 'notebooks',
      brand: 'Lenovo', model: 'ThinkPad T14 Gen 4', ip: '10.24.18.42',
      location: 'Piso 3 · Diseño', locationId: 'diseno', site: 'central', assignee: 'Laura Méndez', cost: 1490,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/notebook-lenovo.svg', hasOwnImage: true,
      anydeskId: '1523884017', rmmAgentId: 'rmm-7fd2-1042', rmmOnline: true
    },
    {
      id: 'AM-1043', name: 'Notebook de soporte', type: 'Notebook', category: 'notebooks',
      brand: 'Dell', model: 'Latitude 5440', ip: '10.24.18.57',
      location: 'Piso 1 · Soporte técnico', locationId: 'soporte', site: 'norte', assignee: 'Diego Salas', cost: 1280,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/notebook.svg', hasOwnImage: false,
      anydeskId: '908441275', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1044', name: 'Equipo de administración', type: 'Computadora', category: 'computadoras',
      brand: 'HP', model: 'EliteDesk 800 G9', ip: '10.24.20.11',
      location: 'Piso 2 · Administración', locationId: 'administracion', site: 'central', assignee: 'Marta Ruiz', cost: 1120,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/desktop-hp.svg', hasOwnImage: true,
      anydeskId: '', rmmAgentId: 'rmm-3ac8-1044', rmmOnline: true
    },
    {
      id: 'AM-1045', name: 'Equipo de producción', type: 'Computadora', category: 'computadoras',
      brand: 'Dell', model: 'OptiPlex 7010', ip: '10.40.12.36',
      location: 'Nave 2 · Producción', locationId: 'produccion', site: 'sur', assignee: '', cost: 980,
      status: 'En resguardo', statusTone: 'hold', image: 'assets/svg/devices/desktop.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1046', name: 'Servidor de virtualización', type: 'Servidor', category: 'servidores',
      brand: 'HPE', model: 'ProLiant DL380 Gen11', ip: '10.10.2.14',
      location: 'Rack A-04 · Zona fría', locationId: 'zona-fria-a', site: 'dc', assignee: 'Infraestructura', cost: 8400,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/server-hpe.svg', hasOwnImage: true,
      anydeskId: '', rmmAgentId: 'rmm-9b2a-1046', rmmOnline: true
    },
    {
      id: 'AM-1047', name: 'Servidor de respaldo', type: 'Servidor', category: 'servidores',
      brand: 'Dell', model: 'PowerEdge R660', ip: '10.10.2.21',
      location: 'Rack B-02 · Zona fría', locationId: 'zona-fria-b', site: 'dc', assignee: 'Sistemas', cost: 7900,
      status: 'Mantenimiento', statusTone: 'warn', image: 'assets/svg/devices/server.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: 'rmm-44c1-1047', rmmOnline: false
    },
    {
      id: 'AM-1048', name: 'Impresora de administración', type: 'Impresora', category: 'impresoras',
      brand: 'HP', model: 'LaserJet Enterprise M611', ip: '10.24.30.11',
      location: 'Piso 2 · Administración', locationId: 'administracion', site: 'central', assignee: 'Administración', cost: 760,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/printer-hp.svg', hasOwnImage: true,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1049', name: 'Impresora de recepción', type: 'Impresora', category: 'impresoras',
      brand: 'Epson', model: 'WorkForce Pro WF-C5790', ip: '10.0.4.18',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: 'Operaciones', cost: 540,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/printer.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1050', name: 'Switch de núcleo', type: 'Switch', category: 'switches',
      brand: 'Cisco', model: 'Catalyst 9200L-48P', ip: '10.10.0.2',
      location: 'Rack A-01 · Sala de comunicaciones', locationId: 'sala-comunicaciones', site: 'dc', assignee: 'Redes', cost: 3100,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/switch-cisco.svg', hasOwnImage: true,
      anydeskId: '', rmmAgentId: 'rmm-18de-1050', rmmOnline: true
    },
    {
      id: 'AM-1051', name: 'Switch de planta', type: 'Switch', category: 'switches',
      brand: 'Ubiquiti', model: 'USW-Pro-48-PoE', ip: '10.40.0.5',
      location: 'Sala de comunicaciones · Nave 1', locationId: 'comunicaciones', site: 'sur', assignee: 'Redes', cost: 890,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/switch.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1052', name: 'Monitor de diseño', type: 'Monitor', category: 'monitores',
      brand: 'LG', model: 'UltraFine 27UP850', ip: '',
      location: 'Piso 3 · Diseño', locationId: 'diseno', site: 'central', assignee: 'Laura Méndez', cost: 420,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/monitor-lg.svg', hasOwnImage: true,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1053', name: 'Monitor de recepción', type: 'Monitor', category: 'monitores',
      brand: 'Samsung', model: 'ViewFinity S6', ip: '',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: '', cost: 360,
      status: 'En resguardo', statusTone: 'hold', image: 'assets/svg/devices/monitor.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1054', name: 'Notebook de dirección', type: 'Notebook', category: 'notebooks',
      brand: 'Apple', model: 'MacBook Pro 14 M3', ip: '10.24.18.19',
      location: 'Piso 4 · Dirección', locationId: 'direccion', site: 'central', assignee: 'Nicolás Ferrer', cost: 2290,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/notebook.svg', hasOwnImage: false,
      anydeskId: '774209618', rmmAgentId: 'rmm-2f6b-1054', rmmOnline: true
    },
    {
      id: 'AM-1055', name: 'Dock de puesto 3B', type: 'Docking station', category: 'otros',
      brand: 'Lenovo', model: 'ThinkPad Universal USB-C', ip: '',
      location: 'Piso 3 · Diseño', locationId: 'diseno', site: 'central', assignee: 'Laura Méndez', cost: 210,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/other.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1056', name: 'Teléfono de operaciones', type: 'Teléfono IP', category: 'otros',
      brand: 'Yealink', model: 'T54W', ip: '10.40.8.44',
      location: 'Nave 2 · Operaciones', locationId: 'operaciones', site: 'sur', assignee: '', cost: 190,
      status: 'Mantenimiento', statusTone: 'warn', image: 'assets/svg/devices/other.svg', hasOwnImage: false,
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1057', name: 'Cámara de recepción', type: 'Cámara IP', category: 'camaras',
      brand: 'Axis', model: 'M3086-V', ip: '10.0.4.61', serial: 'AX-M3086-4471',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: '', cost: 340,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/camera.svg', hasOwnImage: true,
      fovImage: 'assets/svg/camera-fov.svg',
      warranty: { until: '2027-05-20', provider: 'Axis Gold', note: 'Renovación automática anual.' },
      tech: { resolution: '2688 × 1512', fovAngle: '110° horizontal', nightVision: true, poe: true },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1058', name: 'UPS del rack A', type: 'UPS', category: 'ups',
      brand: 'APC', model: 'Smart-UPS SRT 1500', ip: '', serial: 'AS-1934-7720',
      location: 'Rack A-04 · Zona fría', locationId: 'zona-fria-a', site: 'dc', assignee: 'Sergio Vidal', cost: 1180,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/ups.svg', hasOwnImage: true,
      warranty: { until: '2028-02-10', provider: 'APC Care', note: '' },
      tech: { upsCapacity: '1500 VA / 1200 W', batteryLife: '11 min a plena carga', rack: 'Rack A-04 · U38' },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1059', name: 'VM de facturación', type: 'Máquina virtual', category: 'virtualizacion',
      brand: 'Proxmox', model: 'VM 311 · Debian 12', ip: '10.10.4.32',
      location: 'Rack A-04 · Zona fría', locationId: 'zona-fria-a', site: 'dc', assignee: 'Lucía Pardo', cost: 0,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/vm.svg', hasOwnImage: true,
      tech: { vmHost: 'hvm-01', vmCpu: '4', vmRam: '16', vmDisk: '160 GB NVMe', os: 'Debian 12' },
      anydeskId: '', rmmAgentId: 'rmm-vm-1059', rmmOnline: true
    },
    {
      id: 'AM-1060', name: 'Contenedor de API', type: 'Contenedor', category: 'contenedores',
      brand: 'Docker', model: 'ghcr.io/acme/api:2.8.1', ip: '10.10.4.40',
      location: 'Rack B-02 · Zona fría', locationId: 'zona-fria-b', site: 'dc', assignee: 'Sergio Vidal', cost: 0,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/container.svg', hasOwnImage: true,
      tech: { containerImage: 'ghcr.io/acme/api:2.8.1', containerHost: 'docker-01', containerPorts: '8080:8080' },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1061', name: 'Impresora de depósito', type: 'Impresora', category: 'impresoras',
      brand: 'Brother', model: 'HL-L6400DW', ip: '10.40.8.52', serial: 'BR-771204',
      location: 'Nave 2 · Producción', locationId: 'produccion', site: 'sur', assignee: '', cost: 480,
      status: 'Dado de baja', statusTone: 'down', image: 'assets/svg/devices/printer.svg', hasOwnImage: false,
      retired: { at: '2025-09-18T14:20:00.000Z', reason: 'Fin de vida útil', note: 'Sustituida por el equipo multifunción de producción.' },
      tech: { firmware: '1.32', mac: '00:1B:A9:4C:22:08', ports: 1 },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1062', name: 'Servidor de aplicaciones', type: 'Servidor', category: 'servidores',
      brand: 'HPE', model: 'ProLiant DL360 Gen11', ip: '10.10.4.11', serial: 'HPE-DL360-88214',
      location: 'Rack B-02 · Zona fría', locationId: 'zona-fria-b', site: 'dc', assignee: 'Lucía Pardo', cost: 7200,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/server.svg', hasOwnImage: false,
      warranty: { until: '2029-03-14', provider: 'HPE Care Pack', note: 'Soporte 24×7 con reemplazo en 4 h.' },
      tech: {
        cpu: '2 × Xeon Silver 4410Y', ram: '128 GB DDR5', storage: '2 × 960 GB NVMe',
        os: 'Debian 12', rack: 'Rack B-02 · U20', mac: '00:1B:A9:71:04:6C'
      },
      anydeskId: '', rmmAgentId: 'rmm-71f4-1062', rmmOnline: true
    },
    {
      id: 'AM-1063', name: 'NAS de respaldos', type: 'Almacenamiento NAS', category: 'otros',
      brand: 'Synology', model: 'RackStation RS1221+', ip: '10.10.4.25', serial: 'SY-RS1221-30418',
      location: 'Rack B-02 · Zona fría', locationId: 'zona-fria-b', site: 'dc', assignee: 'Sistemas', cost: 2600,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/other.svg', hasOwnImage: false,
      warranty: { until: '2028-11-30', provider: 'Synology Care', note: '' },
      tech: { mac: '00:11:32:6B:90:1A' },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1064', name: 'Switch de acceso Norte', type: 'Switch', category: 'switches',
      brand: 'Ubiquiti', model: 'USW-Pro-24-PoE', ip: '10.0.4.2', serial: 'UB-PRO24-77190',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: 'Redes', cost: 640,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/switch.svg', hasOwnImage: false,
      tech: { ports: 24, firmware: '6.6.65', mac: '74:AC:B9:22:0F:5E' },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1065', name: 'Equipo de recepción', type: 'Computadora', category: 'computadoras',
      brand: 'HP', model: 'EliteDesk 800 G9', ip: '10.0.4.30', serial: 'HP-800G9-50127',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: 'Diego Salas', cost: 1090,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/desktop.svg', hasOwnImage: false,
      tech: { cpu: 'Intel Core i5-13500', ram: '16 GB DDR4', storage: '512 GB NVMe', os: 'Windows 11 Pro', mac: '8C:16:45:90:2A:11' },
      anydeskId: '441290837', rmmAgentId: 'rmm-5c09-1065', rmmOnline: true
    },
    {
      id: 'AM-1066', name: 'Switch de acceso Central', type: 'Switch', category: 'switches',
      brand: 'Cisco', model: 'Catalyst 9200L-24P', ip: '10.24.0.3', serial: 'CS-9200L-11904',
      location: 'Piso 2 · Administración', locationId: 'administracion', site: 'central', assignee: 'Redes', cost: 2400,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/switch-cisco.svg', hasOwnImage: true,
      tech: { ports: 24, firmware: '17.09.04a', rack: '', mac: '00:1E:7A:44:B0:93' },
      anydeskId: '', rmmAgentId: 'rmm-2a77-1066', rmmOnline: true
    },
    {
      id: 'AM-1067', name: 'Cámara de sala de servidores', type: 'Cámara IP', category: 'camaras',
      brand: 'Axis', model: 'P3265-LVE', ip: '10.10.0.74', serial: 'AX-P3265-88213',
      location: 'Rack A-04 · Zona fría', locationId: 'zona-fria-a', site: 'dc', assignee: 'Infraestructura', cost: 720,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/camera.svg', hasOwnImage: false,
      fovImage: 'assets/svg/camera-fov-dc.svg',
      warranty: { until: '2028-07-09', provider: 'Axis Gold', note: 'Cobertura del pasillo de racks y del acceso a la zona fría.' },
      tech: { resolution: '1920 × 1080', fovAngle: '96° horizontal', nightVision: true, poe: true },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    },
    {
      id: 'AM-1068', name: 'Gateway perimetral', type: 'Router', category: 'otros',
      brand: 'MikroTik', model: 'RB5009UG+S+IN', ip: '10.10.0.1', serial: 'MT-5009-31845',
      location: 'Rack A-01 · Sala de comunicaciones', locationId: 'zona-fria-a', site: 'dc', assignee: 'Redes', cost: 460,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/other.svg', hasOwnImage: false,
      warranty: { until: '2027-11-30', provider: 'MikroTik Distribución', note: 'Salida a Internet y enrutamiento entre sedes.' },
      tech: { ports: 8, firmware: '7.16.1', rack: 'A-01', mac: '48:8F:5A:21:CC:07' },
      anydeskId: '', rmmAgentId: 'rmm-9f31-1068', rmmOnline: true
    },
    {
      id: 'AM-1069', name: 'Reloj biométrico de recepción', type: 'Reloj biométrico', category: 'otros',
      brand: 'ZKTeco', model: 'SpeedFace-V5L', ip: '10.0.120.80', serial: 'ZK-V5L-772904',
      location: 'Planta baja · Recepción', locationId: 'recepcion', site: 'norte', assignee: 'Operaciones', cost: 690,
      status: 'Asignado', statusTone: 'ok', image: 'assets/svg/devices/other.svg', hasOwnImage: false,
      warranty: { until: '2028-02-14', provider: 'Biométrica Sur', note: 'Control de asistencia y acceso del personal.' },
      tech: { firmware: 'ZAM170-NF-1.2.4', users: 240, mac: '00:17:61:3A:90:5E' },
      anydeskId: '', rmmAgentId: '', rmmOnline: false
    }
  ];

  const people = [
    {
      id: 'laura-mendez', name: 'Laura Méndez', role: 'Diseñadora de producto',
      departmentId: 'diseno', siteId: 'central', email: 'laura.mendez@acme.test',
      phone: '+34 611 204 882', active: true
    },
    {
      id: 'diego-salas', name: 'Diego Salas', role: 'Técnico de soporte',
      departmentId: 'soporte', siteId: 'norte', email: 'diego.salas@acme.test',
      phone: '+34 622 118 430', active: true
    },
    {
      id: 'marta-ruiz', name: 'Marta Ruiz', role: 'Administrativa',
      departmentId: 'administracion', siteId: 'central', email: 'marta.ruiz@acme.test',
      phone: '+34 633 907 215', active: true
    },
    {
      id: 'nicolas-ferrer', name: 'Nicolás Ferrer', role: 'Director de operaciones',
      departmentId: 'direccion', siteId: 'central', email: 'nicolas.ferrer@acme.test',
      phone: '+34 644 520 198', active: true
    },
    {
      id: 'sergio-vidal', name: 'Sergio Vidal', role: 'Administrador de infraestructura',
      departmentId: 'infraestructura', siteId: 'dc', email: 'sergio.vidal@acme.test',
      phone: '+34 655 341 026', active: true
    },
    {
      id: 'lucia-pardo', name: 'Lucía Pardo', role: 'Responsable de sistemas',
      departmentId: 'sistemas', siteId: 'dc', email: 'lucia.pardo@acme.test',
      phone: '+34 666 782 514', active: true
    },
    {
      id: 'andres-molina', name: 'Andrés Molina', role: 'Gestor administrativo',
      departmentId: 'administracion', siteId: 'central', email: 'andres.molina@acme.test',
      phone: '+34 677 235 901', active: true
    },
    {
      id: 'paula-reyes', name: 'Paula Reyes', role: 'Coordinadora de operaciones',
      departmentId: 'operaciones', siteId: 'sur', email: 'paula.reyes@acme.test',
      phone: '+34 688 410 637', active: true
    },
    {
      id: 'ivan-costa', name: 'Iván Costa', role: 'Administrador de redes',
      departmentId: 'redes', siteId: 'dc', email: 'ivan.costa@acme.test',
      phone: '+34 699 864 120', active: true
    },
    {
      id: 'elena-navarro', name: 'Elena Navarro', role: 'Técnica de soporte',
      departmentId: 'soporte', siteId: 'norte', email: 'elena.navarro@acme.test',
      phone: '+34 610 573 288', active: false
    }
  ];

  const assignments = {
    'AM-1042': 'laura-mendez',
    'AM-1043': 'diego-salas',
    'AM-1044': 'marta-ruiz',
    'AM-1045': '',
    'AM-1046': 'sergio-vidal',
    'AM-1047': 'lucia-pardo',
    'AM-1048': 'andres-molina',
    'AM-1049': 'paula-reyes',
    'AM-1050': 'ivan-costa',
    'AM-1051': 'ivan-costa',
    'AM-1052': 'laura-mendez',
    'AM-1053': '',
    'AM-1054': 'nicolas-ferrer',
    'AM-1055': 'laura-mendez',
    'AM-1056': '',
    'AM-1057': '',
    'AM-1058': 'sergio-vidal',
    'AM-1059': 'lucia-pardo',
    'AM-1060': 'sergio-vidal',
    'AM-1061': ''
  };

  window.ASSET_DATA = {
    categories,
    sites,
    departments,
    assets,
    people,
    assignments,
    defaultGeneral: {
      organizationName: 'Operaciones TI',
      appName: 'Hadar IT',
      logo: 'assets/svg/logo.svg'
    },
    defaultSettings: {
      anydeskUrl: 'https://anydesk.com/es/remote-support',
      rmmUrl: 'https://rmm.assetmanager.local/agents/'
    }
  };
})();
