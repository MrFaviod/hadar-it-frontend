/* Importación y exportación — fuentes de ejemplo, campos destino y perfiles.
   Todo el módulo es de demostración: no se leen archivos reales ni se envía nada. */
(function () {
  'use strict';

  const Store = window.AssetStore;
  const STORAGE_KEY = (Store && Store.KEYS && Store.KEYS.transfer) || 'asset-manager.transfer';

  /* Campos destino ------------------------------------------------------- */

  // Display copy comes from the ui.transfer.* catalog. Ids, target keys, file
  // names and CSV headers stay stable; the getters below resolve the active
  // locale on read so a locale switch re-renders the labels.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const TARGETS = [
    { key: 'name', get label() { return tr('ui.transfer.field.asset_name'); }, get group() { return tr('ui.transfer.group.identification'); }, get hint() { return tr('ui.transfer.field.asset_name_hint'); } },
    { key: 'type', get label() { return tr('ui.transfer.field.type'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'category', get label() { return tr('ui.transfer.field.category'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'brand', get label() { return tr('ui.transfer.field.brand'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'model', get label() { return tr('ui.transfer.field.model'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'serial', get label() { return tr('ui.transfer.field.serial'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'ip', get label() { return tr('ui.transfer.field.ip'); }, get group() { return tr('ui.transfer.group.network'); } },
    { key: 'mac', get label() { return tr('ui.transfer.field.mac'); }, get group() { return tr('ui.transfer.group.network'); } },
    { key: 'site', get label() { return tr('ui.transfer.field.site'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'location', get label() { return tr('ui.transfer.field.location'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'assignee', get label() { return tr('ui.transfer.field.assignee'); }, get group() { return tr('ui.transfer.group.assignment'); } },
    { key: 'cost', get label() { return tr('ui.transfer.field.cost'); }, get group() { return tr('ui.transfer.group.financial'); } },
    { key: 'warrantyUntil', get label() { return tr('ui.transfer.field.warranty_until'); }, get group() { return tr('ui.transfer.group.warranty'); } },
    { key: 'warrantyProvider', get label() { return tr('ui.transfer.field.warranty_provider'); }, get group() { return tr('ui.transfer.group.warranty'); } },
    { key: 'os', get label() { return tr('ui.transfer.field.os'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'cpu', get label() { return tr('ui.transfer.field.cpu'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'ram', get label() { return tr('ui.transfer.field.ram'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'anydeskId', get label() { return tr('ui.transfer.field.anydesk'); }, get group() { return tr('ui.transfer.group.remote'); } },
    { key: 'rmmAgentId', get label() { return tr('ui.transfer.field.rmm'); }, get group() { return tr('ui.transfer.group.remote'); } }
  ];
  const TARGET_BY_KEY = TARGETS.reduce((result, target) => {
    result[target.key] = target;
    return result;
  }, {});

  const IDENTIFICATION_FIELDS = [
    { key: 'serial', get label() { return tr('ui.transfer.field.serial'); }, get strength() { return 'strong'; } },
    { key: 'ip', get label() { return tr('ui.transfer.field.ip'); }, get strength() { return 'strong'; } },
    { key: 'code', get label() { return tr('ui.transfer.field.code'); }, get strength() { return 'strong'; } },
    { key: 'name', get label() { return tr('ui.transfer.field.asset_name'); }, get strength() { return 'weak'; } }
  ];
  /* Normalización y detección -------------------------------------------- */

  function norm(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function slug(value) {
    return norm(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const SYNONYMS = {
    name: ['hostname', 'nombre', 'equipo', 'descripcion', 'activo', 'denominacion', 'nombre del equipo'],
    type: ['tipo', 'clase', 'tipologia'],
    category: ['categoria', 'familia'],
    brand: ['marca', 'fabricante'],
    model: ['modelo', 'referencia'],
    serial: ['n serie', 'nro serie', 'numero de serie', 'numero serie', 'serie', 'sn', 'serial', 'serial number', 'service tag'],
    ip: ['ipv4', 'ip', 'direccion ip', 'dir ip'],
    site: ['sede', 'sitio', 'emplazamiento', 'centro'],
    location: ['ubicacion', 'area', 'piso', 'oficina', 'zona'],
    assignee: ['responsable', 'usuario', 'asignado a', 'asignado', 'persona'],
    cost: ['coste', 'valor', 'importe', 'precio'],
    warrantyUntil: ['garantia', 'fin garantia', 'fin de garantia', 'vencimiento garantia', 'garantia hasta'],
    warrantyProvider: ['proveedor de garantia', 'proveedor garantia', 'proveedor'],
    mac: ['mac', 'direccion mac', 'mac address'],
    os: ['sistema operativo', 'so', 'os'],
    ram: ['memoria ram', 'memoria', 'ram'],
    cpu: ['procesador', 'cpu'],
    anydeskId: ['anydesk', 'id anydesk'],
    rmmAgentId: ['agente rmm', 'rmm', 'id rmm']
  };

  const SYNONYM_INDEX = Object.keys(SYNONYMS).reduce((result, key) => {
    SYNONYMS[key].forEach((term) => {
      if (!result[term]) result[term] = key;
    });
    return result;
  }, {});

  function detectTarget(column) {
    const key = norm(column);
    if (!key) return '';
    if (SYNONYM_INDEX[key]) return SYNONYM_INDEX[key];
    const terms = Object.keys(SYNONYM_INDEX).sort((a, b) => b.length - a.length);
    for (let index = 0; index < terms.length; index += 1) {
      const term = terms[index];
      if (term.length < 4) continue;
      if (key.indexOf(term) !== -1) return SYNONYM_INDEX[term];
    }
    return '';
  }

  function detectMapping(columns, overrides) {
    const preset = overrides && typeof overrides === 'object' ? overrides : {};
    return columns.map((column) => {
      const normalized = norm(column);
      if (Object.prototype.hasOwnProperty.call(preset, normalized)) return preset[normalized] || '';
      return detectTarget(column);
    });
  }

  function sites() {
    return (Store && Array.isArray(Store.sites) ? Store.sites : []) || [];
  }

  function categories() {
    return (Store && Array.isArray(Store.categories) ? Store.categories : []) || [];
  }

  function siteIdFromText(value) {
    const key = norm(value);
    if (!key) return '';
    const list = sites();
    const found = list.find((site) => norm(site.id) === key || norm(site.label) === key || norm(site.short) === key);
    if (found) return found.id;
    const partial = list.find((site) => {
      const label = norm(site.label);
      return label.indexOf(key) !== -1 || key.indexOf(norm(site.short)) !== -1;
    });
    return partial ? partial.id : '';
  }

  function siteName(siteId) {
    const site = sites().find((item) => item.id === siteId);
    return site ? site.label : '';
  }

  function categoryIdFromText(value) {
    const key = norm(value);
    if (!key) return '';
    const list = categories();
    const direct = list.find((category) => norm(category.id) === key || norm(category.label) === key);
    if (direct) return direct.id;
    const singular = key.replace(/s$/, '');
    const loose = list.find((category) => {
      const label = norm(category.label).replace(/s$/, '');
      return label === singular || label.indexOf(singular) === 0 || singular.indexOf(label) === 0;
    });
    return loose ? loose.id : '';
  }

  function categoryIdFromSheet(sheetName) {
    return categoryIdFromText(String(sheetName || '').replace(/^red y /i, '')) || categoryIdFromText(sheetName);
  }

  /* Archivos de ejemplo --------------------------------------------------- */

  const FILES = [
    {
      id: 'sedes-2026',
      name: 'inventario_sedes_2026.xlsx',
      format: 'xlsx',
      size: '38 KB',
      get updated() { return tr('ui.transfer.file.updated_two_days'); },
      get origin() { return tr('ui.transfer.file.origin_previous_system'); },
      profileId: 'inventario-sedes',
      sheets: [
        {
          id: 'central',
          name: 'Sede Central',
          siteId: 'central',
          columns: ['Hostname', 'Tipo', 'Marca', 'Modelo', 'Nº serie', 'IPv4', 'Responsable', 'Ubicación', 'Coste', 'Garantía'],
          rows: [
            ['Notebook de diseño', 'Notebook', 'Lenovo', 'ThinkPad T14 Gen 4', 'PF-3KJ92L', '10.24.18.42', 'Laura Méndez', 'Piso 3 · Diseño', '1.490,00', '2027-08-31'],
            ['Equipo de administración', 'Computadora', 'HP', 'EliteDesk 800 G9', 'MXL2410XQ', '10.24.20.11', 'Marta Ruiz', 'Piso 2 · Administración', '1.120,00', '2026-03-15'],
            ['Notebook de dirección', 'Notebook', 'Apple', 'MacBook Pro 14 M3', 'C02XK1YJMD6M', '10.24.18.19', 'Nicolás Ferrer', 'Piso 4 · Dirección', '2.290,00', '2028-01-20'],
            ['Monitor de diseño', 'Monitor', 'LG', 'UltraFine 27UP850', '', '', 'Laura Méndez', 'Piso 3 · Diseño', '420,00', '2027-06-30'],
            ['Notebook de marketing', 'Notebook', 'Lenovo', 'ThinkPad L13', 'PF-9T41KQ', '10.24.18.63', 'Andrés Molina', 'Piso 2 · Administración', '1.180,00', '2026-11-30'],
            ['', 'Monitor', 'Dell', 'P2422H', '', '10.24.18.999', '', 'Piso 3 · Diseño', 'abc', '2026-13-01']
          ]
        },
        {
          id: 'norte',
          name: 'Sede Norte',
          siteId: 'norte',
          columns: ['Equipo', 'Categoría', 'Fabricante', 'Modelo', 'SN', 'IP', 'Usuario', 'Ubicación', 'Valor'],
          rows: [
            ['Notebook de soporte', 'Notebooks', 'Dell', 'Latitude 5440', 'DLL-5440-2210', '10.24.18.57', 'Diego Salas', 'Piso 1 · Soporte técnico', '1.280,00'],
            ['Impresora de recepción', 'Impresoras', 'Epson', 'WorkForce Pro WF-C5790', 'EPS-WF5790-88', '10.0.4.18', 'Operaciones', 'Planta baja · Recepción', '540,00'],
            ['Monitor de recepción', 'Monitores', 'Samsung', 'ViewFinity S6', '', '', '', 'Planta baja · Recepción', '360,00'],
            ['Cámara de recepción', 'Cámaras', 'Axis', 'M3086-V', 'AX-M3086-4471', '10.0.4.61', '', 'Planta baja · Recepción', '340,00']
          ]
        },
        {
          id: 'sur',
          name: 'Planta Sur',
          siteId: 'sur',
          columns: ['Equipo', 'Tipo', 'Marca', 'Modelo', 'Nº serie', 'IP', 'Responsable', 'Ubicación', 'Coste', 'Garantía'],
          rows: [
            ['Switch de planta', 'Switch', 'Ubiquiti', 'USW-Pro-48-PoE', 'UBI-48P-7712', '10.10.0.2', 'Redes', 'Sala de comunicaciones · Nave 1', '890,00', '2027-03-31'],
            ['Teléfono de operaciones', 'Teléfono IP', 'Yealink', 'T54W', 'YEALINK-T54-9920', '10.40.8.44', '', 'Nave 2 · Operaciones', '190,00', ''],
            ['UPS de producción', 'UPS', 'APC', 'Smart-UPS SMT 750', 'AS-2201-9930', '', '', 'Nave 2 · Producción', '640,00', '2029-01-15'],
            ['Monitor de producción', 'Monitor', 'Dell', 'P2422H', 'DELL-P2422-4419', '', 'Operaciones', 'Nave 2 · Producción', '245,00', '2027-04-30']
          ]
        }
      ]
    },
    {
      id: 'altas-2026',
      name: 'altas_proveedor_2026.csv',
      format: 'csv',
      size: '6 KB',
      get updated() { return tr('ui.transfer.file.updated_yesterday'); },
      get origin() { return tr('ui.transfer.file.origin_supplier'); },
      profileId: 'altas-proveedor',
      sheets: [
        {
          id: 'altas',
          name: 'Altas 2026',
          siteId: '',
          columns: ['Descripción', 'Serie', 'Tipo', 'Sitio', 'Área', 'Importe', 'Fin garantía', 'Notas'],
          rows: [
            ['Notebook de administración', 'HP-840G9-5521', 'Notebook', 'Central', 'Piso 2 · Administración', '1.290,00', '2027-09-30', 'Alta por renovación de parque'],
            ['Notebook de diseño', 'HP-840G9-5521', 'Notebook', 'Central', 'Piso 3 · Diseño', '1.490,00', '2027-08-31', 'Reemplazo de equipo, serie repetida'],
            ['Impresora de depósito', 'BR-771204', 'Impresora', 'Sur', 'Nave 2 · Producción', '480,00', '', 'Equipo dado de baja pendiente de retiro'],
            ['Dock de puesto 3B', 'LEN-DOCK-3B', 'Docking station', 'Central', 'Piso 3 · Diseño', '210,00', '', 'Sin serie de fábrica']
          ]
        }
      ]
    },
    {
      id: 'red-2026',
      name: 'inventario_red_2026.csv',
      format: 'csv',
      size: '4 KB',
      get updated() { return tr('ui.transfer.file.updated_five_days'); },
      get origin() { return tr('ui.transfer.file.origin_network'); },
      profileId: 'red-switches',
      sheets: [
        {
          id: 'red',
          name: 'Red y switches',
          siteId: '',
          columns: ['Hostname', 'Serie', 'IPv4', 'Sede', 'Switch', 'Puerto', 'VLAN'],
          rows: [
            ['Switch de acceso piso 4', 'CISCO-9200-4471', '10.24.0.14', 'Central', 'CORE-01', 'Gi1/0/24', '20'],
            ['Switch de núcleo', 'CISCO-9200-8801', '10.10.0.2', 'DC', 'CORE-01', 'Gi1/0/1', '1'],
            ['', '', '', 'Sur', 'ACCESS-02', 'Gi1/0/8', '30']
          ]
        }
      ]
    }
  ];

  /* Perfiles predeterminados --------------------------------------------- */

  const IMPORT_PROFILES = [
    {
      id: 'inventario-sedes',
      kind: 'import',
      get name() { return tr('ui.transfer.profile.sites.name'); },
      builtin: true,
      fileId: 'sedes-2026',
      get description() { return tr('ui.transfer.profile.sites.description'); },
      identification: ['serial', 'ip', 'name'],
      mapping: {
        hostname: 'name',
        equipo: 'name',
        tipo: 'type',
        categoria: 'category',
        marca: 'brand',
        fabricante: 'brand',
        modelo: 'model',
        'n serie': 'serial',
        sn: 'serial',
        ipv4: 'ip',
        ip: 'ip',
        responsable: 'assignee',
        usuario: 'assignee',
        ubicacion: 'location',
        area: 'location',
        coste: 'cost',
        valor: 'cost',
        garantia: 'warrantyUntil'
      },
      sheetSites: { 'sede central': 'central', 'sede norte': 'norte', 'planta sur': 'sur' }
    },
    {
      id: 'altas-proveedor',
      kind: 'import',
      get name() { return tr('ui.transfer.profile.supplier.name'); },
      builtin: true,
      fileId: 'altas-2026',
      get description() { return tr('ui.transfer.profile.supplier.description'); },
      identification: ['serial', 'ip', 'name'],
      mapping: {
        descripcion: 'name',
        serie: 'serial',
        tipo: 'type',
        sitio: 'site',
        area: 'location',
        importe: 'cost',
        'fin garantia': 'warrantyUntil',
        notas: ''
      },
      sheetSites: {}
    },
    {
      id: 'red-switches',
      kind: 'import',
      get name() { return tr('ui.transfer.profile.network.name'); },
      builtin: true,
      fileId: 'red-2026',
      get description() { return tr('ui.transfer.profile.network.description'); },
      identification: ['ip', 'serial'],
      mapping: {
        hostname: 'name',
        serie: 'serial',
        ipv4: 'ip',
        sede: 'site',
        switch: '',
        puerto: '',
        vlan: ''
      },
      sheetSites: {}
    }
  ];

  const EXPORT_FIELDS = [
    { key: 'id', get label() { return tr('ui.transfer.field.id'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'code', get label() { return tr('ui.transfer.field.code_short'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'name', get label() { return tr('ui.transfer.field.name'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'category', get label() { return tr('ui.transfer.field.category'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'type', get label() { return tr('ui.transfer.field.type'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'brand', get label() { return tr('ui.transfer.field.brand'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'model', get label() { return tr('ui.transfer.field.model'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'serial', get label() { return tr('ui.transfer.field.serial'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'ip', get label() { return tr('ui.transfer.field.ip'); }, get group() { return tr('ui.transfer.group.network'); } },
    { key: 'mac', get label() { return tr('ui.transfer.field.mac'); }, get group() { return tr('ui.transfer.group.network'); } },
    { key: 'site', get label() { return tr('ui.transfer.field.site'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'location', get label() { return tr('ui.transfer.field.location'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'assignee', get label() { return tr('ui.transfer.field.assignee'); }, get group() { return tr('ui.transfer.group.assignment'); } },
    { key: 'status', get label() { return tr('ui.transfer.field.status'); }, get group() { return tr('ui.transfer.group.status'); } },
    { key: 'cost', get label() { return tr('ui.transfer.field.cost'); }, get group() { return tr('ui.transfer.group.financial'); } },
    { key: 'warrantyUntil', get label() { return tr('ui.transfer.field.warranty_until'); }, get group() { return tr('ui.transfer.group.warranty'); } },
    { key: 'warrantyProvider', get label() { return tr('ui.transfer.field.warranty_provider'); }, get group() { return tr('ui.transfer.group.warranty'); } },
    { key: 'os', get label() { return tr('ui.transfer.field.os'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'cpu', get label() { return tr('ui.transfer.field.cpu'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'ram', get label() { return tr('ui.transfer.field.ram'); }, get group() { return tr('ui.transfer.group.technical'); } },
    { key: 'anydeskId', get label() { return tr('ui.transfer.field.anydesk'); }, get group() { return tr('ui.transfer.group.remote'); } },
    { key: 'rmmAgentId', get label() { return tr('ui.transfer.field.rmm'); }, get group() { return tr('ui.transfer.group.remote'); } },
    { key: 'updatedAt', get label() { return tr('ui.transfer.field.updated_at'); }, get group() { return tr('ui.transfer.group.traceability'); } }
  ];

  const EXPORT_PROFILES = [
    {
      id: 'inventario-completo',
      kind: 'export',
      get name() { return tr('ui.transfer.profile.full.name'); },
      builtin: true,
      get description() { return tr('ui.transfer.profile.full.description'); },
      format: 'csv',
      fields: ['id', 'code', 'name', 'category', 'brand', 'model', 'serial', 'ip', 'site', 'location', 'assignee', 'status', 'cost']
    },
    {
      id: 'ficha-tecnica',
      kind: 'export',
      get name() { return tr('ui.transfer.profile.technical.name'); },
      builtin: true,
      get description() { return tr('ui.transfer.profile.technical.description'); },
      format: 'csv',
      fields: ['id', 'name', 'brand', 'model', 'serial', 'os', 'cpu', 'ram', 'warrantyUntil', 'warrantyProvider']
    },
    {
      id: 'red-accesos',
      kind: 'export',
      get name() { return tr('ui.transfer.profile.network_access.name'); },
      builtin: true,
      get description() { return tr('ui.transfer.profile.network_access.description'); },
      format: 'csv',
      fields: ['id', 'name', 'ip', 'mac', 'site', 'location', 'anydeskId', 'rmmAgentId']
    },
    {
      id: 'control-garantias',
      kind: 'export',
      get name() { return tr('ui.transfer.profile.warranty.name'); },
      builtin: true,
      get description() { return tr('ui.transfer.profile.warranty.description'); },
      format: 'csv',
      fields: ['id', 'name', 'category', 'site', 'assignee', 'cost', 'warrantyUntil', 'warrantyProvider']
    }
  ];

  const DEFAULT_PREFS = {
    defaultImportProfile: 'inventario-sedes',
    defaultExportProfile: 'inventario-completo',
    defaultFormat: 'csv',
    duplicatePolicy: 'ask',
    headerRow: true,
    separator: ';',
    bom: true,
    includeEmpty: false,
    confirmUpdates: true,
    keepHistory: true
  };

  /* Almacenamiento -------------------------------------------------------- */

  function readState() {
    const fallback = { prefs: clone(DEFAULT_PREFS), customProfiles: [], history: [], exports: [] };
    if (!Store || typeof Store.readJSON !== 'function') return fallback;
    const stored = Store.readJSON(window.localStorage, STORAGE_KEY, null);
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      prefs: Object.assign(clone(DEFAULT_PREFS), stored.prefs && typeof stored.prefs === 'object' ? stored.prefs : {}),
      customProfiles: Array.isArray(stored.customProfiles) ? stored.customProfiles : [],
      history: Array.isArray(stored.history) ? stored.history : [],
      exports: Array.isArray(stored.exports) ? stored.exports : []
    };
  }

  let state = readState();

  function persist() {
    if (!Store || typeof Store.writeJSON !== 'function') return;
    Store.writeJSON(window.localStorage, STORAGE_KEY, state);
  }

  function getPrefs() {
    return clone(state.prefs);
  }

  function savePrefs(patch) {
    state.prefs = Object.assign(clone(DEFAULT_PREFS), state.prefs, patch && typeof patch === 'object' ? patch : {});
    persist();
    return getPrefs();
  }

  function customProfiles(kind) {
    return state.customProfiles.filter((profile) => profile && profile.kind === kind);
  }

  function profiles(kind) {
    const builtins = kind === 'import' ? IMPORT_PROFILES : EXPORT_PROFILES;
    return clone(builtins).concat(clone(customProfiles(kind)));
  }

  function profileById(id) {
    const all = clone(IMPORT_PROFILES).concat(clone(EXPORT_PROFILES), clone(state.customProfiles));
    return all.find((profile) => profile.id === id) || null;
  }

  function saveProfile(profile) {
    if (!profile || !profile.name) return null;
    const copy = clone(profile);
    copy.id = slug(copy.name) + '-' + Date.now().toString(36).slice(-4);
    copy.builtin = false;
    state.customProfiles.push(copy);
    persist();
    return clone(copy);
  }

  function deleteProfile(id) {
    const before = state.customProfiles.length;
    state.customProfiles = state.customProfiles.filter((profile) => profile.id !== id);
    if (state.customProfiles.length !== before) persist();
    return state.customProfiles.length !== before;
  }

  function history() {
    return clone(state.history).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  function addHistory(entry) {
    if (!entry) return;
    if (!state.prefs.keepHistory) {
      state.history = [];
      persist();
      return;
    }
    state.history.unshift(Object.assign({ id: 'imp-' + Date.now().toString(36) }, entry));
    state.history = state.history.slice(0, 8);
    persist();
  }

  function exportsLog() {
    return clone(state.exports).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  function addExport(entry) {
    state.exports.unshift(Object.assign({ id: 'exp-' + Date.now().toString(36) }, entry));
    state.exports = state.exports.slice(0, 6);
    persist();
  }

  /* Formato --------------------------------------------------------------- */

  function parseNumber(value) {
    if (typeof value === 'number') return value;
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    const cleaned = text.replace(/\s|€/g, '');
    const normalized = cleaned.indexOf(',') !== -1
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function parseDate(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parsed = Date.parse(text + 'T12:00:00');
      return Number.isFinite(parsed) ? text : 'invalid';
    }
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(text)) {
      const parts = text.split(/[/-]/);
      const iso = parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
      const parsed = Date.parse(iso + 'T12:00:00');
      return Number.isFinite(parsed) ? iso : 'invalid';
    }
    return 'invalid';
  }

  function isValidIp(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return true;
    const parts = text.split('.');
    if (parts.length !== 4) return false;
    return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }

  function formatNumber(value) {
    return window.ItsmI18n
      ? window.ItsmI18n.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '—';
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '—';
    return window.ItsmI18n
      ? window.ItsmI18n.formatDate(parsed, { day: '2-digit', month: 'short', year: 'numeric' })
      : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(parsed));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '—';
    return window.ItsmI18n
      ? window.ItsmI18n.formatDate(parsed, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(parsed));
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    const kilobytes = size < 1024 * 1024;
    const value = kilobytes ? size / 1024 : size / (1024 * 1024);
    // The decimal separator follows the active locale; the unit is a symbol.
    const formatted = window.ItsmI18n
      ? window.ItsmI18n.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : value.toFixed(1).replace('.', ',');
    return formatted + (kilobytes ? ' KB' : ' MB');
  }

  function csvCell(value, separator) {
    const text = String(value == null ? '' : value);
    const needsQuotes = text.indexOf('"') !== -1 || text.indexOf('\n') !== -1 || text.indexOf(separator) !== -1;
    return needsQuotes ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(header, rows, separator) {
    const sep = separator || ';';
    const lines = [];
    if (header && header.length) lines.push(header.map((cell) => csvCell(cell, sep)).join(sep));
    rows.forEach((row) => lines.push(row.map((cell) => csvCell(cell, sep)).join(sep)));
    return lines.join('\r\n');
  }

  window.AssetTransferData = {
    STORAGE_KEY,
    TARGETS,
    TARGET_BY_KEY,
    IDENTIFICATION_FIELDS,
    FILES,
    IMPORT_PROFILES,
    EXPORT_PROFILES,
    EXPORT_FIELDS,
    DEFAULT_PREFS,
    norm,
    slug,
    clone,
    detectTarget,
    detectMapping,
    siteIdFromText,
    siteName,
    categoryIdFromText,
    categoryIdFromSheet,
    parseNumber,
    parseDate,
    isValidIp,
    formatNumber,
    formatDate,
    formatDateTime,
    formatBytes,
    toCsv,
    getPrefs,
    savePrefs,
    profiles,
    profileById,
    saveProfile,
    deleteProfile,
    history,
    addHistory,
    exportsLog,
    addExport
  };
})();
