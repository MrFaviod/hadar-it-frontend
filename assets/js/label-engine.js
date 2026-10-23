(function () {
  'use strict';

  /* Canonical label vocabulary.
   *
   * Physical geometry, pagination, QR output and the PDF are produced by the
   * report engine. The frontend only edits the allowlisted options and shows
   * the server preview; no label settings are persisted in the browser. */

  const PUBLIC_FIELDS = [
    { key: 'id', label: 'ID permanente' },
    { key: 'quickCode', label: 'Código rápido' },
    { key: 'name', label: 'Nombre' },
    { key: 'category', label: 'Categoría' },
    { key: 'site', label: 'Sede' },
    { key: 'location', label: 'Ubicación' },
    { key: 'status', label: 'Estado' }
  ];

  const LABEL_FIELDS = [
    { key: 'logo', label: 'Logotipo' },
    { key: 'name', label: 'Nombre' },
    { key: 'id', label: 'ID permanente' },
    { key: 'code', label: 'Código rápido' },
    { key: 'qr', label: 'Código QR' },
    { key: 'site', label: 'Sede' },
    { key: 'location', label: 'Ubicación' },
    { key: 'serial', label: 'Serie' }
  ];

  const FORMATS = [
    {
      id: 'a4-24', label: 'A4 · 24 etiquetas', detail: '70 × 37 mm · 3 columnas × 8 filas',
      widthMm: 70, heightMm: 37, pageWidthMm: 210, pageHeightMm: 297,
      marginTopMm: 13.5, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      gapXmm: 0, gapYmm: 0, columns: 3, rows: 8, offset: 0
    },
    {
      id: 'a4-21', label: 'A4 · 21 etiquetas', detail: '63.5 × 38.1 mm · 3 columnas × 7 filas',
      widthMm: 63.5, heightMm: 38.1, pageWidthMm: 210, pageHeightMm: 297,
      marginTopMm: 13.5, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      gapXmm: 0, gapYmm: 0, columns: 3, rows: 7, offset: 0
    },
    {
      id: 'roll-50x30', label: 'Rollo · 50 × 30 mm', detail: 'Una etiqueta por fila',
      widthMm: 50, heightMm: 30, pageWidthMm: 50, pageHeightMm: 30,
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      gapXmm: 0, gapYmm: 0, columns: 1, rows: 1, offset: 0
    },
    {
      id: 'roll-80x50', label: 'Rollo · 80 × 50 mm', detail: 'Una etiqueta por fila',
      widthMm: 80, heightMm: 50, pageWidthMm: 80, pageHeightMm: 50,
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      gapXmm: 0, gapYmm: 0, columns: 1, rows: 1, offset: 0
    },
    {
      id: 'custom', label: 'Personalizada', detail: 'Define tamaño, márgenes y columnas',
      widthMm: 70, heightMm: 37, pageWidthMm: 210, pageHeightMm: 297,
      marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
      gapXmm: 2, gapYmm: 2, columns: 3, rows: 8, offset: 0
    }
  ];

  const SHARE_EXPIRY_DAYS = [1, 7, 30, 90];

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function number(value, fallback) {
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatOf(id) {
    return FORMATS.find(function (format) { return format.id === id; }) || FORMATS[0];
  }

  function publicFieldOf(key) {
    return PUBLIC_FIELDS.find(function (field) { return field.key === key; }) || null;
  }

  function labelFieldOf(key) {
    return LABEL_FIELDS.find(function (field) { return field.key === key; }) || { key: text(key), label: text(key) };
  }

  function defaultLabelOptions(source) {
    const raw = source && typeof source === 'object' ? source : {};
    const format = formatOf(raw.formatId);
    return {
      formatId: format.id,
      widthMm: number(raw.widthMm, format.widthMm),
      heightMm: number(raw.heightMm, format.heightMm),
      pageWidthMm: number(raw.pageWidthMm, format.pageWidthMm),
      pageHeightMm: number(raw.pageHeightMm, format.pageHeightMm),
      marginTopMm: number(raw.marginTopMm, format.marginTopMm),
      marginRightMm: number(raw.marginRightMm, format.marginRightMm),
      marginBottomMm: number(raw.marginBottomMm, format.marginBottomMm),
      marginLeftMm: number(raw.marginLeftMm, format.marginLeftMm),
      gapXmm: number(raw.gapXmm, format.gapXmm),
      gapYmm: number(raw.gapYmm, format.gapYmm),
      columns: Math.max(1, Math.trunc(number(raw.columns, format.columns))),
      rows: Math.max(1, Math.trunc(number(raw.rows, format.rows))),
      offset: Math.max(0, Math.trunc(number(raw.offset, format.offset))),
      fields: Array.isArray(raw.fields)
        ? raw.fields.map(text).filter(function (key) {
          return LABEL_FIELDS.some(function (field) { return field.key === key; });
        })
        : ['logo', 'name', 'code', 'qr'],
      logo: raw.logo !== false,
      qr: raw.qr !== false
    };
  }

  function normalizeLabelOptions(source) {
    return defaultLabelOptions(source);
  }

  function wireLabelOptions(source) {
    const options = defaultLabelOptions(source);
    return {
      formatId: options.formatId,
      widthMm: options.widthMm,
      heightMm: options.heightMm,
      pageWidthMm: options.pageWidthMm,
      pageHeightMm: options.pageHeightMm,
      marginTopMm: options.marginTopMm,
      marginRightMm: options.marginRightMm,
      marginBottomMm: options.marginBottomMm,
      marginLeftMm: options.marginLeftMm,
      gapXmm: options.gapXmm,
      gapYmm: options.gapYmm,
      columns: options.columns,
      offset: options.offset,
      fields: options.fields.slice(),
      logo: options.logo,
      qr: options.qr
    };
  }

  function assetUrl(baseUrl, assetId) {
    const base = text(baseUrl).replace(/\/+$/, '');
    if (!base || !text(assetId)) return '';
    return base + '/#/reporte/' + encodeURIComponent(text(assetId));
  }

  function publicUrl(baseUrl, assetId, token) {
    const base = text(baseUrl).replace(/\/+$/, '');
    if (!base || !text(assetId) || !text(token)) return '';
    return base + '/#/reporte/' + encodeURIComponent(text(assetId)) + '/publico?share=' + encodeURIComponent(text(token));
  }

  function perPage(options) {
    const opts = defaultLabelOptions(options);
    return Math.max(1, opts.columns * opts.rows);
  }

  function estimatedPages(count, options) {
    return Math.ceil(Math.max(0, Number(count) || 0) / perPage(options));
  }

  window.AssetLabelEngine = {
    PUBLIC_FIELDS: PUBLIC_FIELDS,
    LABEL_FIELDS: LABEL_FIELDS,
    FORMATS: FORMATS,
    SHARE_EXPIRY_DAYS: SHARE_EXPIRY_DAYS,
    formatOf: formatOf,
    publicFieldOf: publicFieldOf,
    labelFieldOf: labelFieldOf,
    defaultLabelOptions: defaultLabelOptions,
    normalizeLabelOptions: normalizeLabelOptions,
    wireLabelOptions: wireLabelOptions,
    assetUrl: assetUrl,
    publicUrl: publicUrl,
    perPage: perPage,
    estimatedPages: estimatedPages
  };
})();
