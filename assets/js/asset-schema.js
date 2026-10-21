(function () {
  'use strict';

  const DATA = window.ASSET_DATA || {};

  const FIELD_TYPES = [
    { value: 'text', label: 'Texto' },
    { value: 'number', label: 'Número' },
    { value: 'select', label: 'Selección' },
    { value: 'boolean', label: 'Sí / No' },
    { value: 'date', label: 'Fecha' },
    { value: 'url', label: 'URL' },
    { value: 'textarea', label: 'Texto largo' }
  ];

  const COMMON_FIELDS = [
    { key: 'name', label: 'Nombre', group: 'Identificación' },
    { key: 'category', label: 'Categoría', group: 'Identificación' },
    { key: 'type', label: 'Tipo', group: 'Identificación' },
    { key: 'brand', label: 'Marca', group: 'Identificación' },
    { key: 'model', label: 'Modelo', group: 'Identificación' },
    { key: 'serial', label: 'Número de serie', group: 'Identificación' },
    { key: 'ip', label: 'Dirección IP', group: 'Red' },
    { key: 'site', label: 'Sede', group: 'Ubicación' },
    { key: 'locationId', label: 'Ubicación', group: 'Ubicación' },
    { key: 'assigneeId', label: 'Responsable', group: 'Asignación' },
    { key: 'cost', label: 'Coste', group: 'Económica' },
    { key: 'statusId', label: 'Estado', group: 'Estado' },
    { key: 'image', label: 'Fotografía', group: 'Medios' },
    { key: 'warranty', label: 'Garantía', group: 'Garantía' },
    { key: 'anydeskId', label: 'AnyDesk', group: 'Acceso remoto' },
    { key: 'rmmAgentId', label: 'Agente RMM', group: 'Acceso remoto' }
  ];

  const COMMON_KEYS = COMMON_FIELDS.map((field) => field.key);

  const FIELD_LIBRARY = [
    { key: 'serial', label: 'Número de serie', type: 'text', unit: '', options: [], hint: 'Serie del fabricante.' },
    { key: 'cpu', label: 'Procesador', type: 'text', unit: '', options: [], hint: 'Modelo y núcleos.' },
    { key: 'ram', label: 'Memoria RAM', type: 'number', unit: 'GB', options: [], hint: '' },
    { key: 'storage', label: 'Almacenamiento', type: 'text', unit: '', options: [], hint: 'Capacidad y tecnología.' },
    { key: 'os', label: 'Sistema operativo', type: 'text', unit: '', options: [], hint: '' },
    { key: 'mac', label: 'Dirección MAC', type: 'text', unit: '', options: [], hint: '' },
    { key: 'firmware', label: 'Firmware', type: 'text', unit: '', options: [], hint: '' },
    { key: 'ports', label: 'Puertos', type: 'number', unit: 'u', options: [], hint: 'Cantidad de puertos de acceso.' },
    { key: 'rack', label: 'Rack / unidad', type: 'text', unit: '', options: [], hint: 'Posición física en el rack.' },
    { key: 'resolution', label: 'Resolución', type: 'text', unit: '', options: [], hint: 'Ej. 2560 × 1440.' },
    { key: 'fovAngle', label: 'Ángulo de visión', type: 'text', unit: '', options: [], hint: 'Ej. 110° horizontal.' },
    { key: 'nightVision', label: 'Visión nocturna', type: 'boolean', unit: '', options: [], hint: '' },
    { key: 'poe', label: 'Alimentación PoE', type: 'boolean', unit: '', options: [], hint: '' },
    { key: 'upsCapacity', label: 'Capacidad', type: 'text', unit: '', options: [], hint: 'VA / W nominales.' },
    { key: 'batteryLife', label: 'Autonomía', type: 'text', unit: '', options: [], hint: 'Tiempo estimado a plena carga.' },
    { key: 'vmHost', label: 'Host', type: 'text', unit: '', options: [], hint: 'Hipervisor que aloja la máquina.' },
    { key: 'vmCpu', label: 'vCPU', type: 'number', unit: 'u', options: [], hint: '' },
    { key: 'vmRam', label: 'RAM asignada', type: 'number', unit: 'GB', options: [], hint: '' },
    { key: 'vmDisk', label: 'Disco virtual', type: 'text', unit: '', options: [], hint: 'Capacidad y tipo de disco.' },
    { key: 'containerImage', label: 'Imagen', type: 'text', unit: '', options: [], hint: 'Repositorio y etiqueta.' },
    { key: 'containerHost', label: 'Host de contenedores', type: 'text', unit: '', options: [], hint: '' },
    { key: 'containerPorts', label: 'Puertos publicados', type: 'text', unit: '', options: [], hint: 'Ej. 8080:80, 443:443.' }
  ];

  const FORM_PRESETS = {
    computadoras: {
      prefix: 'PC', type: 'Computadora',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'anydeskId', 'rmmAgentId', 'warranty'],
      tech: ['cpu', 'ram', 'storage', 'os', 'mac'], fov: false
    },
    notebooks: {
      prefix: 'NB', type: 'Notebook',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'anydeskId', 'rmmAgentId', 'warranty'],
      tech: ['cpu', 'ram', 'storage', 'os', 'mac'], fov: false
    },
    servidores: {
      prefix: 'SRV', type: 'Servidor',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'anydeskId', 'rmmAgentId', 'warranty'],
      tech: ['cpu', 'ram', 'storage', 'os', 'rack', 'mac'], fov: false
    },
    impresoras: {
      prefix: 'IMP', type: 'Impresora',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'warranty'],
      tech: ['firmware', 'mac', 'ports'], fov: false
    },
    switches: {
      prefix: 'SW', type: 'Switch',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'rmmAgentId', 'assigneeId', 'warranty'],
      tech: ['ports', 'firmware', 'rack', 'mac'], fov: false
    },
    monitores: {
      prefix: 'MON', type: 'Monitor',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId'],
      advanced: ['serial', 'cost', 'statusId', 'warranty'],
      tech: ['resolution'], fov: false
    },
    camaras: {
      prefix: 'CAM', type: 'Cámara IP',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'ip'],
      advanced: ['serial', 'cost', 'statusId', 'assigneeId', 'warranty'],
      tech: ['resolution', 'fovAngle', 'nightVision', 'poe'], fov: true
    },
    ups: {
      prefix: 'UPS', type: 'UPS',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId'],
      advanced: ['serial', 'cost', 'statusId', 'assigneeId', 'warranty'],
      tech: ['upsCapacity', 'batteryLife', 'rack'], fov: false
    },
    virtualizacion: {
      prefix: 'VM', type: 'Máquina virtual',
      quick: ['name', 'type', 'site', 'assigneeId', 'ip'],
      advanced: ['cost', 'statusId', 'rmmAgentId', 'warranty'],
      tech: ['vmHost', 'vmCpu', 'vmRam', 'vmDisk', 'os'], fov: false
    },
    contenedores: {
      prefix: 'CTR', type: 'Contenedor',
      quick: ['name', 'type', 'site', 'assigneeId', 'ip'],
      advanced: ['cost', 'statusId', 'warranty'],
      tech: ['containerImage', 'containerHost', 'containerPorts'], fov: false
    },
    otros: {
      prefix: 'OTRO', type: 'Equipo',
      quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId'],
      advanced: ['serial', 'cost', 'statusId', 'warranty'],
      tech: [], fov: false
    }
  };

  const STATUS_SEED = [
    { id: 'asignado', label: 'Asignado', tone: 'ok', final: false },
    { id: 'resguardo', label: 'En resguardo', tone: 'hold', final: false },
    { id: 'mantenimiento', label: 'Mantenimiento', tone: 'warn', final: false },
    { id: 'retirado', label: 'Dado de baja', tone: 'down', final: true }
  ];

  const TONE_LABELS = {
    ok: 'Operativo',
    warn: 'Atención',
    hold: 'Sin asignar',
    down: 'Baja'
  };

  const ID_RULES_SEED = {
    permanentPrefix: 'AM-',
    permanentPad: 4,
    separator: '-',
    quickPad: 3,
    siteCodeLength: 3,
    includeSite: true
  };

  const OPERATIONS_SEED = { mode: 'development' };

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function slug(value, fallback) {
    const base = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || fallback || 'campo';
  }

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function pad(value, size) {
    return String(value).padStart(size, '0');
  }

  function siteCode(site, rules) {
    let source = '';
    if (site && typeof site === 'object') {
      source = site.short || site.label || '';
    } else if (typeof site === 'string') {
      source = site;
    }
    source = source ? String(source) : '';
    const clean = source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleUpperCase('es')
      .replace(/[^A-Z0-9]/g, '');
    const size = Math.max(2, Math.min(5, number(rules.siteCodeLength, 3)));
    return clean ? clean.slice(0, size) : 'SED';
  }

  function normalizeOptions(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    return list.map((item) => text(item, '')).filter(Boolean);
  }

  function normalizeField(item) {
    if (!item || typeof item !== 'object') return null;
    const label = text(item.label, '');
    if (!label) return null;
    const key = slug(item.key || label, 'campo');
    const type = FIELD_TYPES.some((entry) => entry.value === item.type) ? item.type : 'text';
    return {
      key,
      label,
      type,
      unit: text(item.unit, ''),
      hint: text(item.hint, ''),
      options: type === 'select' ? normalizeOptions(item.options) : []
    };
  }

  function defaultAdmin() {
    return ensureForms({
      version: 2,
      fields: clone(FIELD_LIBRARY),
      forms: clone(FORM_PRESETS),
      statuses: clone(STATUS_SEED),
      idRules: clone(ID_RULES_SEED),
      operations: clone(OPERATIONS_SEED),
      sequence: 0
    }, DATA.categories || []);
  }

  function normalizeStatuses(value) {
    const list = Array.isArray(value) && value.length ? value : STATUS_SEED;
    const used = new Set();
    const result = [];
    list.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const label = text(item.label, '');
      if (!label) return;
      let id = slug(item.id || label, 'estado');
      let suffix = 2;
      while (used.has(id)) {
        id = slug(item.id || label, 'estado') + '-' + suffix;
        suffix += 1;
      }
      used.add(id);
      const tone = ['ok', 'warn', 'hold', 'down'].indexOf(item.tone) !== -1 ? item.tone : 'hold';
      result.push({ id, label, tone, final: !!item.final });
    });
    if (!result.length) return clone(STATUS_SEED);
    return result;
  }

  function normalizeForm(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const base = fallback && typeof fallback === 'object' ? fallback : FORM_PRESETS.otros;
    const pick = (item, allowed, fallbackList) => {
      const list = Array.isArray(item) ? item : fallbackList;
      return list.map((key) => String(key)).filter((key) => allowed.indexOf(key) !== -1);
    };
    const techAllowed = (base.tech || []).concat(FIELD_LIBRARY.map((field) => field.key));
    const quick = pick(source.quick, COMMON_KEYS, base.quick);
    const advanced = pick(source.advanced, COMMON_KEYS, base.advanced)
      .filter((key) => quick.indexOf(key) === -1);
    return {
      prefix: text(source.prefix, base.prefix).toLocaleUpperCase('es').replace(/[^A-Z0-9]/g, '').slice(0, 6) || base.prefix,
      type: text(source.type, base.type),
      quick,
      advanced,
      tech: pick(source.tech, techAllowed, base.tech),
      fov: typeof source.fov === 'boolean' ? source.fov : !!base.fov
    };
  }

  function normalizeAdmin(value) {
    const source = value && typeof value === 'object' ? value : {};
    const base = defaultAdmin();
    const fieldsUsed = new Set();
    const fields = (Array.isArray(source.fields) ? source.fields : base.fields).reduce((result, item) => {
      const field = normalizeField(item);
      if (!field || fieldsUsed.has(field.key)) return result;
      fieldsUsed.add(field.key);
      result.push(field);
      return result;
    }, []);
    const forms = {};
    const sourceForms = source.forms && typeof source.forms === 'object' ? source.forms : base.forms;
    Object.keys(base.forms).forEach((categoryId) => {
      forms[categoryId] = normalizeForm(sourceForms[categoryId], base.forms[categoryId]);
    });
    Object.keys(sourceForms).forEach((categoryId) => {
      if (forms[categoryId]) return;
      forms[categoryId] = normalizeForm(sourceForms[categoryId], FORM_PRESETS.otros);
    });
    const rules = source.idRules && typeof source.idRules === 'object' ? source.idRules : {};
    const operations = source.operations && typeof source.operations === 'object' ? source.operations : {};
    return {
      version: 2,
      fields: fields.length ? fields : clone(FIELD_LIBRARY),
      forms,
      statuses: normalizeStatuses(source.statuses),
      idRules: {
        permanentPrefix: text(rules.permanentPrefix, ID_RULES_SEED.permanentPrefix).toUpperCase().replace(/[^A-Z0-9-]/g, '') || ID_RULES_SEED.permanentPrefix,
        permanentPad: Math.max(3, Math.min(8, number(rules.permanentPad, ID_RULES_SEED.permanentPad))),
        separator: text(rules.separator, ID_RULES_SEED.separator).replace(/[^A-Za-z0-9-]/g, '').slice(0, 2) || '-',
        quickPad: Math.max(2, Math.min(5, number(rules.quickPad, ID_RULES_SEED.quickPad))),
        siteCodeLength: Math.max(2, Math.min(5, number(rules.siteCodeLength, ID_RULES_SEED.siteCodeLength))),
        includeSite: typeof rules.includeSite === 'boolean' ? rules.includeSite : ID_RULES_SEED.includeSite
      },
      operations: { mode: operations.mode === 'production' ? 'production' : 'development' },
      sequence: Math.max(0, number(source.sequence, 0))
    };
  }

  function ensureForms(admin, categories) {
    const list = Array.isArray(categories) ? categories : [];
    list.forEach((category) => {
      if (admin.forms[category.id]) return;
      const base = FORM_PRESETS.otros;
      admin.forms[category.id] = normalizeForm({
        prefix: String(category.label || 'EQ')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toLocaleUpperCase('es').replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'EQ',
        type: category.label,
        quick: base.quick,
        advanced: base.advanced,
        tech: [],
        fov: false
      }, base);
    });
    return admin;
  }

  function formFor(admin, categoryId) {
    const adminSafe = admin || defaultAdmin();
    if (adminSafe.forms && adminSafe.forms[categoryId]) return adminSafe.forms[categoryId];
    return FORM_PRESETS.otros;
  }

  function statusById(admin, id) {
    const statuses = (admin && admin.statuses) || STATUS_SEED;
    return statuses.find((status) => status.id === id) || statuses[0];
  }

  function statusFromLabel(admin, label) {
    const needle = String(label || '').toLocaleLowerCase('es');
    const statuses = (admin && admin.statuses) || STATUS_SEED;
    return statuses.find((status) => status.label.toLocaleLowerCase('es') === needle) || null;
  }

  function fieldByKey(admin, key) {
    const fields = (admin && admin.fields) || FIELD_LIBRARY;
    return fields.find((field) => field.key === key) || null;
  }

  function techFields(admin, categoryId) {
    const form = formFor(admin, categoryId);
    return form.tech.map((key) => fieldByKey(admin, key)).filter(Boolean);
  }

  function maxQuickNumber(assets, prefix, site, rules) {
    const pattern = new RegExp('^' + escapeRegExp(prefix) + '(?:' + escapeRegExp(rules.separator || '-') + escapeRegExp(site) + ')?' + escapeRegExp(rules.separator || '-') + '(\\d+)$');
    let max = 0;
    (assets || []).forEach((asset) => {
      const match = pattern.exec(asset.code || '');
      if (match) max = Math.max(max, number(match[1], 0));
    });
    return max;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildCode(prefix, site, counter, rules) {
    const parts = [prefix];
    if (rules.includeSite) parts.push(site);
    parts.push(pad(counter, rules.quickPad));
    return parts.join(rules.separator || '-');
  }

  function nextCode(assets, category, site, admin, ignoreId) {
    const rules = admin.idRules;
    const form = formFor(admin, category);
    const code = siteCode(site, rules);
    const others = (assets || []).filter((asset) => asset.id !== ignoreId);
    let counter = maxQuickNumber(others, form.prefix, code, rules) + 1;
    let candidate = buildCode(form.prefix, code, counter, rules);
    while (others.some((asset) => asset.code === candidate)) {
      counter += 1;
      candidate = buildCode(form.prefix, code, counter, rules);
    }
    return candidate;
  }

  function permanentNumber(id, prefix) {
    const match = new RegExp('^' + escapeRegExp(prefix) + '(\\d+)$').exec(String(id || ''));
    return match ? number(match[1], 0) : 0;
  }

  function nextPermanentId(assets, admin) {
    const prefix = admin.idRules.permanentPrefix;
    const highest = (assets || []).reduce((max, asset) => Math.max(max, permanentNumber(asset.id, prefix)), 0);
    const next = Math.max(highest, number(admin.sequence, 0)) + 1;
    return prefix + pad(next, admin.idRules.permanentPad);
  }

  function parseDate(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time);
  }

  function isoDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = parseDate(value);
    if (!parsed) return '';
    return parsed.toISOString().slice(0, 10);
  }

  function isoDateTime(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.toISOString() : '';
  }

  function formatDate(value) {
    const parsed = parseDate(value);
    if (!parsed) return '—';
    return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  }

  function formatDateTime(value) {
    const parsed = parseDate(value);
    if (!parsed) return '—';
    return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
  }

  function normalizeWarranty(value) {
    if (!value || typeof value !== 'object') return null;
    const until = isoDate(value.until);
    const provider = text(value.provider, '');
    const note = text(value.note, '');
    if (!until && !provider && !note) return null;
    const warranty = { until, provider, note };
    // Optional document metadata is additive; legacy warranty records retain their shape.
    if ('purchase' in value) warranty.purchase = isoDate(value.purchase);
    if ('months' in value) warranty.months = Math.max(0, Math.min(240, Number(value.months) || 0));
    if (Array.isArray(value.receipts)) warranty.receipts = value.receipts.filter(item => item && typeof item === 'object').map(item => ({ name: text(item.name, 'Comprobante'), size: Math.max(0, Number(item.size) || 0), type: text(item.type, '') }));
    return warranty;
  }

  function normalizeRetired(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      at: isoDateTime(value.at) || new Date().toISOString(),
      reason: text(value.reason, 'Sin especificar'),
      note: text(value.note, '')
    };
  }

  function normalizeChanges(value) {
    const list = Array.isArray(value) ? value : [];
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      result.push({
        field: text(item.field, ''),
        label: text(item.label, 'Campo'),
        before: text(item.before, ''),
        after: text(item.after, '')
      });
      return result;
    }, []);
  }

  function normalizeHistory(value) {
    const list = Array.isArray(value) ? value : [];
    let index = 0;
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      index += 1;
      const at = isoDateTime(item.at) || new Date().toISOString();
      result.push({
        id: text(item.id, 'h-' + index),
        at: at,
        kind: text(item.kind, 'updated'),
        title: text(item.title, 'Cambio registrado'),
        detail: text(item.detail, ''),
        actor: text(item.actor, 'Administrador'),
        changes: normalizeChanges(item.changes),
        movement: text(item.movement, ''),
        effectiveAt: isoDateTime(item.effectiveAt) || '',
        recordedAt: isoDateTime(item.recordedAt) || at
      });
      return result;
    }, []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  function normalizeTech(value, fields) {
    const source = value && typeof value === 'object' ? value : {};
    return fields.reduce((result, field) => {
      const raw = source[field.key];
      if (raw === undefined || raw === null || raw === '') return result;
      if (field.type === 'boolean') {
        result[field.key] = raw === true || raw === 'true';
      } else {
        result[field.key] = String(raw).slice(0, 400);
      }
      return result;
    }, {});
  }

  const SEED_CREATED = [
    '2024-02-12', '2024-03-04', '2024-04-18', '2024-05-09', '2024-06-21',
    '2024-07-15', '2024-08-02', '2024-09-11', '2024-10-06', '2024-11-19',
    '2025-01-13', '2025-02-24', '2025-03-18', '2025-04-07', '2025-05-26',
    '2025-06-30', '2025-08-14', '2025-09-22', '2025-10-08', '2025-11-27'
  ];

  function seedHistory(asset, index, status) {
    const created = SEED_CREATED[index % SEED_CREATED.length];
    const entries = [{
      id: 'seed-created-' + index,
      at: created + 'T09:15:00.000Z',
      kind: 'created',
      title: 'Alta en el inventario',
      detail: 'Registro creado con la ficha inicial del activo.',
      actor: 'Administrador',
      changes: [],
      movement: 'created',
      effectiveAt: created + 'T09:15:00.000Z',
      recordedAt: created + 'T09:15:00.000Z'
    }];
    if (asset.retired) {
      entries.push({
        id: 'seed-retired-' + index,
        at: isoDateTime(asset.retired.at),
        kind: 'retired',
        title: 'Activo dado de baja',
        detail: asset.retired.reason + (asset.retired.note ? ' · ' + asset.retired.note : ''),
        actor: 'Administrador',
        changes: [],
        movement: 'retired',
        effectiveAt: isoDateTime(asset.retired.at),
        recordedAt: isoDateTime(asset.retired.at)
      });
    }
    return entries;
  }

  function normalizeAssets(rawList, context) {
    const admin = context.admin;
    const categories = context.categories || [];
    const sites = context.sites || [];
    const people = context.people || [];
    const list = Array.isArray(rawList) ? rawList : [];
    const usedCodes = new Set();
    const result = [];

    list.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const id = text(raw.id, '');
      if (!id) return;
      const category = categories.some((item) => item.id === raw.category) ? raw.category : (categories[0] ? categories[0].id : 'otros');
      const categoryItem = categories.find((item) => item.id === category);
      const site = sites.some((item) => item.id === raw.site) ? raw.site : '';
      const siteItem = sites.find((item) => item.id === site);
      const locationExists = siteItem && Array.isArray(siteItem.locations)
        ? siteItem.locations.some((item) => item.id === raw.locationId)
        : false;
      const locationId = locationExists ? raw.locationId : '';
      const location = locationExists
        ? siteItem.locations.find((item) => item.id === locationId).label
        : '';
      const assigneeExists = people.some((person) => person.id === raw.assigneeId);
      const assigneeId = assigneeExists ? raw.assigneeId : '';
      const assignee = assigneeExists ? people.find((person) => person.id === assigneeId).name : text(raw.assignee, '');
      const statusSource = raw.statusId
        ? statusById(admin, raw.statusId)
        : statusFromLabel(admin, raw.status) || statusById(admin, 'asignado');
      const retired = normalizeRetired(raw.retired);
      const finalStatus = admin.statuses.find((item) => item.final) || statusById(admin, 'retirado');
      const statusId = retired ? finalStatus.id : statusSource.id;
      const status = statusById(admin, statusId);
      const fields = techFields(admin, category);
      const form = formFor(admin, category);
      const codePrefix = form.prefix;
      const codeSite = siteCode(siteItem, admin.idRules);
      let code = text(raw.code, '');
      if (!code || usedCodes.has(code)) {
        let counter = 1;
        let candidate = buildCode(codePrefix, codeSite, counter, admin.idRules);
        while (usedCodes.has(candidate)) {
          counter += 1;
          candidate = buildCode(codePrefix, codeSite, counter, admin.idRules);
        }
        code = candidate;
      }
      usedCodes.add(code);
      const history = normalizeHistory(raw.history);
      const asset = {
        id,
        code,
        name: text(raw.name, 'Activo sin nombre'),
        type: text(raw.type, form.type || 'Equipo'),
        category,
        brand: text(raw.brand, ''),
        model: text(raw.model, ''),
        serial: text(raw.serial, ''),
        ip: text(raw.ip, ''),
        site,
        locationId,
        location,
        assigneeId,
        assignee,
        cost: number(raw.cost, 0),
        statusId: status.id,
        status: status.label,
        statusTone: status.tone,
        image: text(raw.image, categoryItem ? categoryItem.image : 'assets/svg/devices/other.svg'),
        hasOwnImage: !!raw.hasOwnImage,
        fovImage: text(raw.fovImage, ''),
        tech: normalizeTech(raw.tech, fields),
        warranty: normalizeWarranty(raw.warranty),
        retired,
        history: history.length ? history : seedHistory({ retired, status }, index, status),
        createdAt: isoDateTime(raw.createdAt) || (SEED_CREATED[index % SEED_CREATED.length] + 'T09:15:00.000Z'),
        updatedAt: isoDateTime(raw.updatedAt) || '',
        anydeskId: text(raw.anydeskId, ''),
        rmmAgentId: text(raw.rmmAgentId, ''),
        rmmOnline: !!raw.rmmOnline
      };
      result.push(asset);
    });

    return result;
  }

  function gaps(asset, admin) {
    if (!asset) return [];
    if (asset.retired) return [];
    const form = formFor(admin, asset.category);
    const included = new Set(form.quick.concat(form.advanced));
    const checks = [
      { key: 'brand', label: 'Marca', missing: !asset.brand },
      { key: 'model', label: 'Modelo', missing: !asset.model },
      { key: 'serial', label: 'Número de serie', missing: !asset.serial },
      { key: 'site', label: 'Sede', missing: !asset.site },
      { key: 'locationId', label: 'Ubicación', missing: !asset.locationId },
      { key: 'assigneeId', label: 'Responsable', missing: !asset.assigneeId },
      { key: 'cost', label: 'Coste', missing: !asset.cost },
      { key: 'ip', label: 'Dirección IP', missing: !asset.ip }
    ];
    return checks.filter((item) => included.has(item.key) && item.missing).map((item) => item.label);
  }

  function newAsset(admin, categories) {
    const category = categories[0] ? categories[0].id : 'otros';
    return {
      id: '',
      code: '',
      name: '',
      type: formFor(admin, category).type,
      category,
      brand: '',
      model: '',
      serial: '',
      ip: '',
      site: '',
      locationId: '',
      location: '',
      assigneeId: '',
      assignee: '',
      cost: 0,
      statusId: (admin.statuses[0] || { id: 'asignado' }).id,
      status: '',
      statusTone: '',
      image: '',
      hasOwnImage: false,
      fovImage: '',
      tech: {},
      warranty: null,
      retired: null,
      history: [],
      createdAt: '',
      updatedAt: '',
      anydeskId: '',
      rmmAgentId: '',
      rmmOnline: false
    };
  }

  function historyEntry(kind, title, detail, extra) {
    const at = new Date().toISOString();
    const options = extra && typeof extra === 'object' ? extra : {};
    return {
      id: 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      at: options.at || at,
      kind,
      title,
      detail: detail || '',
      actor: text(options.actor, 'Administrador'),
      changes: normalizeChanges(options.changes),
      movement: text(options.movement, ''),
      effectiveAt: isoDateTime(options.effectiveAt) || '',
      recordedAt: isoDateTime(options.recordedAt) || at
    };
  }

  window.AssetSchema = {
    FIELD_TYPES,
    COMMON_FIELDS,
    COMMON_KEYS,
    FIELD_LIBRARY,
    FORM_PRESETS,
    STATUS_SEED,
    TONE_LABELS,
    ID_RULES_SEED,
    defaultAdmin,
    normalizeAdmin,
    normalizeAssets,
    normalizeForm,
    normalizeField,
    normalizeStatuses,
    ensureForms,
    formFor,
    techFields,
    fieldByKey,
    statusById,
    statusFromLabel,
    siteCode,
    buildCode,
    nextCode,
    nextPermanentId,
    pad,
    slug,
    text,
    clone,
    number,
    isoDate,
    isoDateTime,
    formatDate,
    formatDateTime,
    normalizeWarranty,
    normalizeHistory,
    gaps,
    newAsset,
    historyEntry
  };
})();
