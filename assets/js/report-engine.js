(function () {
  'use strict';

  /* Canonical report catalog.
   *
   * Templates, composition and numbering are server-owned. This module only
   * describes the allowlisted wire vocabulary the editor may show and builds
   * an empty draft; it never stores documents, history or templates. */

  // Copy resolved outside a mounted template goes through the same runtime.
  // Reading the runtime revision keeps a rendered label reactive, so switching
  // the language re-renders the catalog the editor shows.
  function tr(key, params) {
    if (!window.ItsmI18n) return '';
    if (window.ItsmI18n.version) window.ItsmI18n.version.value;
    return window.ItsmI18n.t(key, params);
  }

  // Stable keys stay on the objects; only their labels and descriptions are
  // translated. The properties are getters so a language switch updates the
  // catalog that the editor renders, instead of freezing copy at load time.
  function localized(ids, textKeys) {
    const item = Object.assign({}, ids);
    Object.keys(textKeys).forEach(function (property) {
      Object.defineProperty(item, property, {
        enumerable: true,
        get: function () { return tr(textKeys[property]); }
      });
    });
    return item;
  }

  const FAMILIES = [
    localized({ id: 'inventory' }, { label: 'ui.reports.family_inventory', description: 'ui.reports.family_inventory_desc' }),
    localized({ id: 'history' }, { label: 'ui.reports.family_history', description: 'ui.reports.family_history_desc' }),
    localized({ id: 'warranty' }, { label: 'ui.reports.family_warranty', description: 'ui.reports.family_warranty_desc' })
  ];

  const FIELD_KEYS = {
    id: 'ui.reports.field_id',
    quickCode: 'ui.reports.field_quick_code',
    name: 'ui.common.name',
    category: 'ui.reports.field_category',
    site: 'ui.reports.field_site',
    location: 'ui.reports.field_location',
    status: 'ui.reports.field_status',
    responsible: 'ui.reports.field_responsible',
    serial: 'ui.reports.field_serial',
    brand: 'ui.reports.field_brand',
    model: 'ui.reports.field_model',
    ip: 'ui.reports.field_ip',
    purchaseCost: 'ui.reports.field_purchase_cost',
    technical: 'ui.reports.field_technical',
    assetId: 'ui.reports.field_asset_id',
    action: 'ui.reports.field_action',
    actor: 'ui.reports.actor',
    effectiveAt: 'ui.reports.field_date',
    entityType: 'ui.reports.field_origin',
    entityId: 'ui.reports.field_origin_id',
    statusOld: 'ui.reports.field_status_old',
    statusNew: 'ui.reports.field_status_new',
    changes: 'ui.reports.field_changes',
    notes: 'ui.reports.field_notes',
    source: 'ui.reports.field_source',
    supplier: 'ui.reports.field_supplier',
    purchaseDate: 'ui.reports.field_purchase',
    expiresOn: 'ui.reports.field_expires',
    coverage: 'ui.reports.coverage',
    receiptId: 'ui.reports.field_receipt'
  };

  function field(key) {
    return localized({ key: key }, { label: FIELD_KEYS[key] });
  }

  const ASSET_FIELDS = [
    'id', 'quickCode', 'name', 'category', 'site', 'location', 'status',
    'responsible', 'serial', 'brand', 'model', 'ip', 'purchaseCost', 'technical'
  ].map(field);

  const HISTORY_FIELDS = [
    'assetId', 'quickCode', 'name', 'action', 'actor', 'effectiveAt', 'entityType',
    'entityId', 'statusOld', 'statusNew', 'changes', 'notes', 'source'
  ].map(field);

  const WARRANTY_FIELDS = [
    'assetId', 'quickCode', 'name', 'category', 'site', 'supplier', 'purchaseDate',
    'expiresOn', 'coverage', 'receiptId', 'notes'
  ].map(field);

  const FIELDS = ASSET_FIELDS.concat(
    HISTORY_FIELDS.filter(function (field) {
      return !ASSET_FIELDS.some(function (assetField) { return assetField.key === field.key; });
    }),
    WARRANTY_FIELDS.filter(function (field) {
      return !ASSET_FIELDS.some(function (assetField) { return assetField.key === field.key; }) &&
        !HISTORY_FIELDS.some(function (historyField) { return historyField.key === field.key; });
    })
  );

  const BLOCK_KEYS = {
    heading: 'ui.reports.block_heading',
    text: 'ui.reports.block_text',
    asset: 'ui.reports.block_asset',
    table: 'ui.reports.block_table',
    photo: 'ui.reports.block_photo',
    summary: 'ui.reports.block_summary',
    qr: 'ui.reports.block_qr',
    footer: 'ui.reports.block_footer'
  };

  function blockType(type, icon) {
    return localized({ type: type, icon: icon }, { label: BLOCK_KEYS[type] });
  }

  const BLOCK_TYPES = [
    blockType('heading', 'type'),
    blockType('text', 'file-text'),
    blockType('asset', 'package'),
    blockType('table', 'table'),
    blockType('photo', 'image'),
    blockType('summary', 'chart'),
    blockType('qr', 'qr'),
    blockType('footer', 'minus')
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

  // Grouping reuses the field label of the column it groups by, so the editor
  // does not carry a second copy of the same word.
  const GROUPS = [
    localized({ value: 'none' }, { label: 'ui.reports.group_none' }),
    localized({ value: 'category' }, { label: FIELD_KEYS.category }),
    localized({ value: 'site' }, { label: FIELD_KEYS.site }),
    localized({ value: 'responsible' }, { label: FIELD_KEYS.responsible }),
    localized({ value: 'location' }, { label: FIELD_KEYS.location }),
    localized({ value: 'status' }, { label: FIELD_KEYS.status })
  ];

  // A block snapshots its label and text when it is created, because both are
  // part of the template draft the server stores.
  const BLOCK_DEFAULTS = {
    heading: { labelKey: BLOCK_KEYS.heading, textKey: 'ui.reports.block_heading_default_text' },
    text: { labelKey: BLOCK_KEYS.text, textKey: '' },
    asset: { labelKey: BLOCK_KEYS.asset, textKey: '' },
    table: { labelKey: BLOCK_KEYS.table, textKey: '' },
    photo: { labelKey: BLOCK_KEYS.photo, textKey: '' },
    summary: { labelKey: BLOCK_KEYS.summary, textKey: '' },
    qr: { labelKey: BLOCK_KEYS.qr, textKey: '' },
    footer: { labelKey: BLOCK_KEYS.footer, textKey: '' }
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
      label: text(source.label) || tr(defaults.labelKey),
      text: typeof source.text === 'string' ? source.text : tr(defaults.textKey),
      enabled: source.enabled !== false
    };
  }

  function createTemplate(family) {
    const id = FAMILIES.some(function (item) { return item.id === family; }) ? family : 'inventory';
    return {
      id: '',
      name: tr('ui.reports.new_template'),
      description: '',
      family: id,
      mode: 'list',
      format: 'A4',
      fields: familyFields(id),
      logo: true,
      images: false,
      version: 1,
      blocks: [
        block('heading', { label: tr(BLOCK_KEYS.heading), text: familyOf(id).label }),
        block('table', { label: tr('ui.reports.block_data_table') }),
        block('footer', { label: tr(BLOCK_KEYS.footer) })
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
      name: text(raw.name) || tr('ui.reports.template_untitled'),
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
