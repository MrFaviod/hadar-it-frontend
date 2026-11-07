(function () {
  'use strict';

  /* Canonical report catalog.
   *
   * Templates, composition and numbering are server-owned. This module only
   * describes the allowlisted wire vocabulary the editor may show and builds
   * an empty draft; it never stores documents, history or templates. */

  const FAMILIES = [
    { id: 'inventory', label: 'Inventario', description: 'Listados y fichas del inventario actual.' },
    { id: 'history', label: 'Historial', description: 'Movimientos, eventos y trazabilidad.' },
    { id: 'warranty', label: 'Garantías', description: 'Cobertura vigente, por vencer y vencida.' }
  ];

  const ASSET_FIELDS = [
    { key: 'id', label: 'ID permanente' },
    { key: 'quickCode', label: 'Código rápido' },
    { key: 'name', label: 'Nombre' },
    { key: 'category', label: 'Categoría' },
    { key: 'site', label: 'Sede' },
    { key: 'location', label: 'Ubicación' },
    { key: 'status', label: 'Estado' },
    { key: 'responsible', label: 'Responsable' },
    { key: 'serial', label: 'Serie' },
    { key: 'brand', label: 'Marca' },
    { key: 'model', label: 'Modelo' },
    { key: 'ip', label: 'IP' },
    { key: 'purchaseCost', label: 'Costo de compra' },
    { key: 'technical', label: 'Ficha técnica' }
  ];

  const HISTORY_FIELDS = [
    { key: 'assetId', label: 'ID del activo' },
    { key: 'quickCode', label: 'Código rápido' },
    { key: 'name', label: 'Nombre' },
    { key: 'action', label: 'Acción' },
    { key: 'actor', label: 'Actor' },
    { key: 'effectiveAt', label: 'Fecha' },
    { key: 'entityType', label: 'Origen' },
    { key: 'entityId', label: 'ID de origen' },
    { key: 'statusOld', label: 'Estado anterior' },
    { key: 'statusNew', label: 'Estado nuevo' },
    { key: 'changes', label: 'Cambios' },
    { key: 'notes', label: 'Notas' },
    { key: 'source', label: 'Fuente' }
  ];

  const WARRANTY_FIELDS = [
    { key: 'assetId', label: 'ID del activo' },
    { key: 'quickCode', label: 'Código rápido' },
    { key: 'name', label: 'Nombre' },
    { key: 'category', label: 'Categoría' },
    { key: 'site', label: 'Sede' },
    { key: 'supplier', label: 'Proveedor' },
    { key: 'purchaseDate', label: 'Compra' },
    { key: 'expiresOn', label: 'Vencimiento' },
    { key: 'coverage', label: 'Cobertura' },
    { key: 'receiptId', label: 'Comprobante' },
    { key: 'notes', label: 'Notas' }
  ];

  const FIELDS = ASSET_FIELDS.concat(
    HISTORY_FIELDS.filter(function (field) {
      return !ASSET_FIELDS.some(function (assetField) { return assetField.key === field.key; });
    }),
    WARRANTY_FIELDS.filter(function (field) {
      return !ASSET_FIELDS.some(function (assetField) { return assetField.key === field.key; }) &&
        !HISTORY_FIELDS.some(function (historyField) { return historyField.key === field.key; });
    })
  );

  const BLOCK_TYPES = [
    { type: 'heading', label: 'Encabezado', icon: 'type' },
    { type: 'text', label: 'Texto', icon: 'file-text' },
    { type: 'asset', label: 'Ficha de activo', icon: 'package' },
    { type: 'table', label: 'Tabla', icon: 'table' },
    { type: 'photo', label: 'Fotografía', icon: 'image' },
    { type: 'summary', label: 'Resumen', icon: 'chart' },
    { type: 'qr', label: 'Código QR', icon: 'qr' },
    { type: 'footer', label: 'Pie de página', icon: 'minus' }
  ];

  const FAMILY_OPTIONS = {
    inventory: ASSET_FIELDS,
    history: HISTORY_FIELDS,
    warranty: WARRANTY_FIELDS
  };

  // Canonical default projections agreed with the reports service. They match
  // the server's default columns, so a preview requested without fields does
  // not silently drop history or warranty data.
  const FAMILY_DEFAULT_FIELDS = {
    inventory: ['id', 'quickCode', 'name', 'category', 'site', 'location', 'status', 'responsible'],
    history: ['quickCode', 'action', 'actor', 'effectiveAt', 'entityType', 'changes', 'notes'],
    warranty: ['quickCode', 'name', 'category', 'site', 'supplier', 'purchaseDate', 'expiresOn', 'coverage', 'receiptId', 'notes']
  };

  const GROUPS = [
    { value: 'none', label: 'Sin agrupar' },
    { value: 'category', label: 'Categoría' },
    { value: 'site', label: 'Sede' },
    { value: 'responsible', label: 'Responsable' },
    { value: 'location', label: 'Ubicación' },
    { value: 'status', label: 'Estado' }
  ];

  const BLOCK_DEFAULTS = {
    heading: { label: 'Encabezado', text: 'Reporte de inventario' },
    text: { label: 'Texto', text: '' },
    asset: { label: 'Ficha de activo', text: '' },
    table: { label: 'Tabla', text: '' },
    photo: { label: 'Fotografía', text: '' },
    summary: { label: 'Resumen', text: '' },
    qr: { label: 'Código QR', text: '' },
    footer: { label: 'Pie de página', text: '' }
  };

  let blockCounter = 0;

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function familyOf(id) {
    return FAMILIES.find(function (family) { return family.id === id; }) || FAMILIES[0];
  }

  function fieldOf(key) {
    return FIELDS.find(function (field) { return field.key === key; }) || { key: text(key), label: text(key) };
  }

  function fieldsForFamily(family) {
    return (FAMILY_OPTIONS[family] || FAMILY_OPTIONS.inventory).slice();
  }

  function familyFields(family) {
    return (FAMILY_DEFAULT_FIELDS[family] || FAMILY_DEFAULT_FIELDS.inventory).slice();
  }

  function fieldKeys(family) {
    return fieldsForFamily(family).map(function (field) { return field.key; });
  }

  function block(type, overrides) {
    const kind = BLOCK_TYPES.some(function (item) { return item.type === type; }) ? type : 'text';
    const defaults = BLOCK_DEFAULTS[kind];
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    blockCounter += 1;
    return {
      id: text(source.id) || 'block-' + blockCounter,
      type: kind,
      label: text(source.label) || defaults.label,
      text: typeof source.text === 'string' ? source.text : defaults.text,
      enabled: source.enabled !== false
    };
  }

  function createTemplate(family) {
    const id = FAMILIES.some(function (item) { return item.id === family; }) ? family : 'inventory';
    return {
      id: '',
      name: 'Nueva plantilla',
      description: '',
      family: id,
      mode: 'list',
      format: 'A4',
      fields: familyFields(id),
      logo: true,
      images: false,
      version: 1,
      blocks: [
        block('heading', { label: 'Encabezado', text: familyOf(id).label }),
        block('table', { label: 'Tabla de datos' }),
        block('footer', { label: 'Pie de página' })
      ]
    };
  }

  function normalizeTemplate(source) {
    const raw = source && typeof source === 'object' ? source : {};
    const family = FAMILIES.some(function (item) { return item.id === raw.family; }) ? raw.family : 'inventory';
    const allowed = fieldKeys(family);
    const selected = Array.isArray(raw.fields)
      ? raw.fields.map(function (key) { return text(key); }).filter(function (key) {
        return allowed.indexOf(key) !== -1;
      })
      : [];
    const fields = selected.length ? selected : familyFields(family);
    const blocks = Array.isArray(raw.blocks)
      ? raw.blocks.map(function (item, index) {
        const next = block(text(item && item.type), item);
        if (!text(item && item.id)) next.id = 'block-' + index;
        return next;
      })
      : [];
    return {
      id: text(raw.id),
      name: text(raw.name) || 'Plantilla sin nombre',
      description: text(raw.description),
      family: family,
      mode: raw.mode === 'sheet' ? 'sheet' : 'list',
      format: raw.format === 'Letter' ? 'Letter' : 'A4',
      fields: fields,
      logo: raw.logo !== false,
      images: raw.images === true,
      version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
      builtin: raw.builtin === true,
      blocks: blocks
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function composeRequestMode(template) {
    return template && template.mode === 'sheet' ? 'individual' : 'consolidated';
  }

  window.AssetReportEngine = {
    FAMILIES: FAMILIES,
    FIELDS: FIELDS,
    ASSET_FIELDS: ASSET_FIELDS,
    HISTORY_FIELDS: HISTORY_FIELDS,
    WARRANTY_FIELDS: WARRANTY_FIELDS,
    GROUPS: GROUPS,
    BLOCK_TYPES: BLOCK_TYPES,
    BLOCKS: BLOCK_TYPES,
    familyFields: familyFields,
    fieldsForFamily: fieldsForFamily,
    fieldKeys: fieldKeys,
    familyOf: familyOf,
    fieldOf: fieldOf,
    block: block,
    createTemplate: createTemplate,
    normalizeTemplate: normalizeTemplate,
    clone: clone,
    composeRequestMode: composeRequestMode
  };
})();
