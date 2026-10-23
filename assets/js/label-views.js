(function () {
  'use strict';

  const LABEL = window.AssetLabelEngine;

  const JOB_LABELS = {
    queued: 'En cola',
    running: 'Generando',
    completed: 'Completado',
    failed: 'Con errores'
  };

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatBytes(value) {
    const size = Number(value) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function labelRequest(options) {
    return {
      family: 'inventory',
      templateId: null,
      template: null,
      assetIds: [],
      filters: {},
      fields: [],
      mode: 'consolidated',
      output: 'pdf',
      name: 'Etiquetas de inventario',
      labels: LABEL.wireLabelOptions(options)
    };
  }

  const AssetQrCode = {
    name: 'Phase9AssetQrCode',
    props: {
      svg: { type: String, default: '' },
      label: { type: String, default: 'Código QR del activo' }
    },
    template: '<div v-if="svg" class="asset-qr" role="img" :aria-label="label" v-html="svg"></div><p v-else class="doc-help">El código QR se carga desde el servidor.</p>'
  };

  const AssetQrPanel = {
    name: 'Phase9AssetQrPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true }, asset: { type: Object, required: true } },
    data() {
      return {
        shareFields: ['name', 'quickCode', 'status'],
        expiresInDays: 7,
        copied: ''
      };
    },
    computed: {
      qr() {
        return this.app.phase9.qr;
      },
      share() {
        return this.qr.assetId === this.asset.id ? this.qr.share : null;
      },
      privateUrl() {
        return this.qr.assetId === this.asset.id ? this.qr.url : '';
      },
      publicFields() {
        return LABEL.PUBLIC_FIELDS;
      },
      expiryDays() {
        return LABEL.SHARE_EXPIRY_DAYS;
      },
      canShare() {
        return this.app.can('reports.share');
      },
      loading() {
        return this.qr.loading;
      }
    },
    created() {
      this.load();
    },
    watch: {
      'asset.id': function () {
        this.load();
      }
    },
    template: `
      <section class="operations-panel qr-asset-panel" data-od-id="asset-qr-panel">
        <header class="panel-head">
          <div><p class="eyebrow">Identidad permanente</p><h2>Código QR y enlace público</h2></div>
          <span class="status-pill"><app-icon name="lock"></app-icon> Privado por defecto</span>
        </header>
        <div class="qr-asset-body">
          <asset-qr-code :svg="qr.svg" :label="'Código QR del activo ' + asset.name"></asset-qr-code>
          <div>
            <h3>{{ asset.id }}</h3>
            <p>El QR usa el identificador permanente del servidor. El enlace privado conserva la identidad aunque cambien el código rápido o la ubicación.</p>
            <code>{{ privateUrl || 'Cargando dirección del servidor…' }}</code>
            <div class="doc-inline">
              <button type="button" class="btn btn--secondary btn--small" :disabled="!privateUrl" @click="copy(privateUrl)">Copiar enlace privado</button>
              <a class="text-button" :href="privateReportUrl()">Previsualizar ficha privada</a>
              <button type="button" class="text-button" @click="app.openDocuments('reports', [asset.id])">Preparar reporte</button>
              <button type="button" class="text-button" @click="app.openDocuments('labels', [asset.id])">Crear etiqueta</button>
            </div>
          </div>
        </div>
        <p v-if="qr.error" class="doc-error" role="alert">{{ qr.error }}</p>
        <div class="qr-share-settings">
          <div>
            <strong>Enlace público limitado</strong>
            <p>Solo los campos marcados se publican. Crear o revocar el enlace requiere el permiso específico de reportes, no el de edición de activos.</p>
          </div>
          <template v-if="!share">
            <fieldset class="doc-field-options" :disabled="!canShare">
              <legend>Campos públicos</legend>
              <label v-for="field in publicFields" :key="field.key">
                <input type="checkbox" v-model="shareFields" :value="field.key">{{ field.label }}
              </label>
            </fieldset>
            <label class="doc-field">Caducidad
              <select v-model.number="expiresInDays" :disabled="!canShare">
                <option v-for="days in expiryDays" :key="days" :value="days">{{ days }} {{ days === 1 ? 'día' : 'días' }}</option>
              </select>
            </label>
            <button type="button" class="btn btn--secondary" :disabled="!canShare || app.phase9.share.creating" @click="createShare">
              {{ app.phase9.share.creating ? 'Creando…' : 'Crear enlace público' }}
            </button>
            <span v-if="!canShare" class="doc-help">Necesitas el permiso para compartir reportes.</span>
          </template>
          <template v-else>
            <div v-if="share.url" class="qr-shared-url">
              <code>{{ share.url }}</code>
              <button type="button" class="text-button" @click="copy(share.url)">Copiar</button>
              <a class="text-button" :href="share.url" target="_blank" rel="noopener">Abrir</a>
            </div>
            <p v-else class="doc-help" role="status">El servidor conserva este enlace, pero la dirección completa solo se muestra al crearlo. Revócalo y crea uno nuevo si necesitas volver a copiarla.</p>
            <p class="doc-help">Caduca el {{ formatDate(share.expiresAt) }} · {{ share.fields.length }} campos visibles.</p>
            <button type="button" class="btn btn--ghost btn--small" :disabled="app.phase9.share.revoking" @click="revoke">
              {{ app.phase9.share.revoking ? 'Revocando…' : 'Revocar enlace' }}
            </button>
          </template>
        </div>
        <p v-if="app.phase9.share.error" class="doc-error" role="alert">{{ app.phase9.share.error }}</p>
      </section>
    `,
    methods: {
      formatDate,
      load() {
        if (!this.app.authenticated || !this.app.can('assets.view')) return;
        this.app.phase9LoadQr(this.asset.id);
      },
      copy(value) {
        if (this.app.copyText) this.app.copyText(value, 'Dirección copiada.');
        this.copied = value;
      },
      privateReportUrl() {
        return '#/reporte/' + encodeURIComponent(this.asset.id);
      },
      async createShare() {
        this.copied = '';
        const result = await this.app.phase9CreateShare(this.asset.id, this.shareFields, this.expiresInDays);
        if (!result.ok) return;
        this.app.showToast('Enlace público creado.');
      },
      async revoke() {
        if (!this.share) return;
        const result = await this.app.phase9RevokeShare(this.share.id);
        if (!result.ok) return;
        this.app.showToast('Enlace público revocado.');
      }
    }
  };

  const PublicAssetReport = {
    name: 'Phase9PublicAssetReport',
    components: { AppIcon: window.AppIcon, AssetQrCode: AssetQrCode },
    props: { app: { type: Object, required: true } },
    computed: {
      token() {
        return this.app.route && this.app.route.shareToken ? this.app.route.shareToken : '';
      },
      assetId() {
        return this.app.route && this.app.route.assetId ? this.app.route.assetId : '';
      },
      publicMode() {
        return !!(this.app.route && this.app.route.section === 'publico');
      },
      invalidPublic() {
        return this.publicMode && !this.token;
      },
      publicState() {
        return this.app.phase9.publicReport;
      },
      privateState() {
        return this.app.phase9.privateReport;
      },
      state() {
        if (this.invalidPublic) {
          return { loading: false, asset: null, fields: [], error: 'El enlace no incluye un token de acceso válido.' };
        }
        return this.publicMode ? this.publicState : this.privateState;
      },
      asset() {
        return this.state ? this.state.asset : null;
      },
      loading() {
        return !this.state || this.state.loading;
      },
      error() {
        return this.state ? this.state.error : '';
      },
      fields() {
        if (this.publicMode) {
          return (this.publicState.fields || []).map((key) => window.AssetReportEngine.fieldOf(key));
        }
        const keys = this.privateState && this.privateState.fields && this.privateState.fields.length
          ? this.privateState.fields
          : ['quickCode', 'name', 'category', 'site', 'location', 'status', 'responsible', 'serial', 'brand', 'model'];
        return keys.map(function (key) {
          return window.AssetReportEngine.fieldOf(key);
        });
      },
      privateQr() {
        return this.app.phase9.qr;
      },
      orgName() {
        if (this.publicMode) return 'Activo';
        const branding = this.app.phase9Settings.branding;
        return branding && branding.name ? branding.name : 'ITMS · Activos';
      }
    },
    created() {
      this.load();
    },
    watch: {
      token() {
        this.load();
      },
      assetId() {
        this.load();
      }
    },
    methods: {
      async load() {
        if (this.publicMode) {
          if (this.token) await this.app.phase9LoadPublicReport(this.token);
          return;
        }
        if (!this.app.authenticated || !this.app.can('assets.view')) return;
        await this.app.phase9LoadPrivateReport(this.assetId);
        if (this.asset) this.app.phase9LoadQr(this.assetId);
      },
      value(key) {
        const asset = this.asset;
        if (!asset) return '—';
        const value = asset[key];
        return value === undefined || value === null || value === '' ? '—' : value;
      },
      date(value) {
        return formatDate(value);
      }
    },
    template: `
      <section class="page qr-report-page" data-od-id="qr-asset-report">
        <template v-if="asset">
          <a v-if="!publicMode" class="back-link" :href="'#/activo/' + encodeURIComponent(asset.id)">
            <app-icon name="arrow-left"></app-icon>Volver al activo
          </a>
          <header class="page-head">
            <div>
              <p class="eyebrow">{{ publicMode ? 'Reporte público' : 'Reporte del activo · ' + asset.id }}</p>
              <h1>{{ publicMode ? 'Ficha pública limitada' : 'Ficha privada' }}</h1>
              <p class="page-head__description">{{ publicMode ? 'Este enlace solo muestra los campos autorizados por la organización y no abre el inventario privado.' : 'Información interna del inventario vinculada al identificador permanente.' }}</p>
            </div>
            <span class="status-pill">{{ publicMode ? 'Enlace público' : 'Privado' }}</span>
          </header>
          <article class="qr-record">
            <header>
              <div><p>{{ orgName }}</p><h2>{{ asset.name || asset.id }}</h2></div>
              <span class="status-pill">{{ value('status') }}</span>
            </header>
            <dl class="doc-facts">
              <div v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ value(field.key) }}</dd></div>
            </dl>
            <footer>
              <template v-if="!publicMode && privateQr.svg">
                <asset-qr-code :svg="privateQr.svg" :label="'Código QR del activo ' + asset.id"></asset-qr-code>
                <p>Destino privado vinculado al ID permanente.<span class="mono">{{ privateQr.url }}</span></p>
              </template>
              <p v-else-if="publicMode">Enlace público caduca el {{ date(publicState.expiresAt) }}.<span class="mono">{{ publicState.fields.length }} campos visibles</span></p>
              <p v-else>Ficha interna del activo.<span class="mono">{{ asset.id }}</span></p>
            </footer>
          </article>
        </template>
        <div v-else-if="loading" class="doc-empty"><app-icon name="file-text"></app-icon><h2>Cargando reporte…</h2></div>
        <div v-else class="qr-public-empty">
          <app-icon name="lock"></app-icon>
          <h2>{{ publicMode ? 'Este enlace no está disponible' : 'No se pudo cargar la ficha' }}</h2>
          <p>{{ error || 'El enlace puede haber caducado, haber sido revocado o no corresponder a un activo vigente.' }}</p>
          <a v-if="!publicMode" href="#/inventario" class="btn btn--secondary">Ir al inventario</a>
        </div>
      </section>
    `
  };

  const LabelsCenter = {
    name: 'Phase9LabelsCenter',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      const context = this.app.documentContext || {};
      return {
        label: LABEL.defaultLabelOptions({}),
        filters: {
          search: '',
          category: '',
          siteId: '',
          locationId: '',
          responsiblePersonId: '',
          status: '',
          archived: 'active'
        },
        explicit: !!(context.ids && context.ids.length),
        ids: context.ids ? context.ids.slice() : [],
        error: '',
        notice: ''
      };
    },
    computed: {
      state() {
        return this.app.phase9;
      },
      selection() {
        return this.state.selection;
      },
      previewState() {
        return this.state.preview;
      },
      jobs() {
        return this.state.jobs.items;
      },
      activeJob() {
        return this.state.activeJob.job;
      },
      selectedCount() {
        return this.explicit ? this.ids.length : this.selection.total;
      },
      formats() {
        return LABEL.FORMATS;
      },
      currentFormat() {
        return LABEL.formatOf(this.label.formatId);
      },
      fieldOptions() {
        return LABEL.LABEL_FIELDS;
      },
      pageNumber() {
        return Math.floor(this.selection.offset / Math.max(1, this.selection.limit)) + 1;
      },
      pageCount() {
        return Math.max(1, Math.ceil(this.selection.total / Math.max(1, this.selection.limit)));
      },
      pages() {
        return LABEL.estimatedPages(this.selectedCount || this.previewState.assets || 0, this.label);
      },
      categoryOptions() {
        return this.app.inventoryCategoryChoices || [];
      },
      siteOptions() {
        return this.app.sites || [];
      },
      locationOptions() {
        return (this.app.organizationLocations || []).filter((item) => item && item.id && item.level !== 'site');
      },
      responsibleOptions() {
        return (this.app.filteredPeople || this.app.people || []).filter((person) => person && person.id);
      },
      statusOptions() {
        return this.app.inventoryStatusChoices || [];
      },
      custom() {
        return this.label.formatId === 'custom';
      },
      canGenerate() {
        return this.app.can('assets.view');
      },
      activeJobDocuments() {
        return this.activeJob ? this.activeJob.documents : [];
      }
    },
    created() {
      this.initialize();
    },
    methods: {
      async initialize() {
        await this.app.phase9LoadSettings();
        this.resetLabel();
        await this.app.phase9LoadSelection({ filters: this.filters, resetOffset: true });
        this.app.phase9LoadJobs();
      },
      resetLabel() {
        this.label = LABEL.defaultLabelOptions(this.app.phase9.settings.labelDefaults);
      },
      applyFormat() {
        const format = LABEL.formatOf(this.label.formatId);
        const preset = this.label.formatId !== 'custom';
        this.label.widthMm = preset ? format.widthMm : this.label.widthMm;
        this.label.heightMm = preset ? format.heightMm : this.label.heightMm;
        this.label.pageWidthMm = preset ? format.pageWidthMm : this.label.pageWidthMm;
        this.label.pageHeightMm = preset ? format.pageHeightMm : this.label.pageHeightMm;
        this.label.columns = preset ? format.columns : this.label.columns;
        this.label.rows = preset ? format.rows : this.label.rows;
        this.label.marginTopMm = preset ? format.marginTopMm : this.label.marginTopMm;
        this.label.marginRightMm = preset ? format.marginRightMm : this.label.marginRightMm;
        this.label.marginBottomMm = preset ? format.marginBottomMm : this.label.marginBottomMm;
        this.label.marginLeftMm = preset ? format.marginLeftMm : this.label.marginLeftMm;
        this.label.gapXmm = preset ? format.gapXmm : this.label.gapXmm;
        this.label.gapYmm = preset ? format.gapYmm : this.label.gapYmm;
      },
      reloadSelection() {
        this.app.phase9LoadSelection({ filters: this.filters, resetOffset: true });
      },
      scheduleSelection() {
        this.app.phase9ScheduleSelectionSearch(this.filters);
      },
      selectionPage(direction) {
        this.app.phase9SelectionPage(direction);
      },
      rowSelected(asset) {
        return !this.explicit || this.ids.indexOf(asset.id) !== -1;
      },
      toggle(asset) {
        if (!this.explicit) {
          this.ids = this.selection.items.map((item) => item.id);
          this.explicit = true;
        }
        const index = this.ids.indexOf(asset.id);
        if (index >= 0) this.ids.splice(index, 1);
        else this.ids.push(asset.id);
      },
      selectPage() {
        this.explicit = true;
        this.ids = this.selection.items.map((item) => item.id);
      },
      selectAllMatching() {
        this.explicit = false;
        this.ids = [];
      },
      clearSelection() {
        this.explicit = true;
        this.ids = [];
      },
      request() {
        const request = labelRequest(this.label);
        request.assetIds = this.explicit ? this.ids.slice() : [];
        request.filters = {
          search: this.filters.search,
          category: this.filters.category,
          siteId: this.filters.siteId,
          locationId: this.filters.locationId,
          responsiblePersonId: this.filters.responsiblePersonId,
          status: this.filters.status,
          archived: this.filters.archived === 'archived' ? true : (this.filters.archived === 'active' ? false : null)
        };
        return request;
      },
      async preview() {
        this.error = '';
        const result = await this.app.phase9PreviewReport(this.request());
        if (!result.ok) this.error = result.error || '';
      },
      async generate() {
        this.error = '';
        if (!this.selectedCount) {
          this.error = 'Selecciona al menos un activo.';
          return;
        }
        if (!this.label.fields.length) {
          this.error = 'Selecciona al menos un elemento para la etiqueta.';
          return;
        }
        const result = await this.app.phase9CreateJob(this.request());
        if (!result.ok) {
          this.error = result.error || '';
          return;
        }
        this.notice = 'Trabajo de etiquetas en cola.';
      },
      jobLabel(value) {
        return JOB_LABELS[value] || value || 'Sin estado';
      },
      date(value) {
        return formatDate(value);
      },
      size(value) {
        return formatBytes(value);
      },
      async download(documentRef) {
        const result = await this.app.phase9DownloadDocument(documentRef);
        if (!result.ok) this.error = result.error || '';
      }
    },
    template: `
      <section class="page labels-page" data-od-id="labels-center">
        <header class="page-head">
          <div>
            <p class="eyebrow">Identificación física</p>
            <h1>Etiquetas de inventario</h1>
            <p class="page-head__description">Etiquetas reales del servidor con formatos A4 y adhesivos, tamaños y márgenes configurables, logotipo y código QR permanente.</p>
          </div>
          <a class="btn btn--secondary" href="#/configuracion/etiquetas"><app-icon name="sliders"></app-icon>Valores predeterminados</a>
        </header>
        <div class="doc-workspace">
          <aside class="doc-controls">
            <div class="doc-control-head"><p class="eyebrow">01 · Composición</p><h2>Prepara las etiquetas</h2></div>
            <label class="doc-field">Formato
              <select v-model="label.formatId" @change="applyFormat">
                <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option>
              </select>
            </label>
            <p class="doc-help">{{ currentFormat.detail }}</p>
            <div v-if="custom" class="doc-form-grid">
              <label class="doc-field">Ancho (mm)<input type="number" v-model.number="label.widthMm" min="10" max="500" step="0.5"></label>
              <label class="doc-field">Alto (mm)<input type="number" v-model.number="label.heightMm" min="10" max="500" step="0.5"></label>
              <label class="doc-field">Ancho de página<input type="number" v-model.number="label.pageWidthMm" min="20" max="1000" step="0.5"></label>
              <label class="doc-field">Alto de página<input type="number" v-model.number="label.pageHeightMm" min="20" max="1000" step="0.5"></label>
              <label class="doc-field">Margen superior<input type="number" v-model.number="label.marginTopMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">Margen derecho<input type="number" v-model.number="label.marginRightMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">Margen inferior<input type="number" v-model.number="label.marginBottomMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">Margen izquierdo<input type="number" v-model.number="label.marginLeftMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">Separación horizontal<input type="number" v-model.number="label.gapXmm" min="0" max="30" step="0.5"></label>
              <label class="doc-field">Separación vertical<input type="number" v-model.number="label.gapYmm" min="0" max="30" step="0.5"></label>
              <label class="doc-field">Columnas<input type="number" v-model.number="label.columns" min="1" max="12"></label>
              <label class="doc-field">Posiciones usadas<input type="number" v-model.number="label.offset" min="0" max="500"></label>
            </div>
            <div class="doc-inline">
              <label><input type="checkbox" v-model="label.logo">Logotipo</label>
              <label><input type="checkbox" v-model="label.qr">Código QR</label>
            </div>
            <fieldset class="doc-field-options">
              <legend>Elementos de la etiqueta</legend>
              <label v-for="field in fieldOptions" :key="field.key">
                <input type="checkbox" v-model="label.fields" :value="field.key">{{ field.label }}
              </label>
            </fieldset>

            <hr class="doc-rule">
            <label class="doc-field">Buscar activos<input type="search" v-model="filters.search" placeholder="Nombre, ID o código" @input="scheduleSelection"></label>
            <div class="doc-form-grid">
              <label class="doc-field">Categoría
                <select v-model="filters.category" @change="reloadSelection">
                  <option value="">Todas</option>
                  <option v-for="category in categoryOptions" :key="category.id" :value="category.id">{{ category.label }}</option>
                </select>
              </label>
              <label class="doc-field">Estado
                <select v-model="filters.status" @change="reloadSelection">
                  <option value="">Todos</option>
                  <option v-for="status in statusOptions" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="doc-field">Sede
                <select v-model="filters.siteId" @change="reloadSelection">
                  <option value="">Todas</option>
                  <option v-for="site in siteOptions" :key="site.id" :value="site.id">{{ site.label }}</option>
                </select>
              </label>
              <label class="doc-field">Ubicación
                <select v-model="filters.locationId" @change="reloadSelection">
                  <option value="">Todas</option>
                  <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.name }}</option>
                </select>
              </label>
              <label class="doc-field">Responsable
                <select v-model="filters.responsiblePersonId" @change="reloadSelection">
                  <option value="">Todos</option>
                  <option v-for="person in responsibleOptions" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
              </label>
              <label class="doc-field">Archivados
                <select v-model="filters.archived" @change="reloadSelection">
                  <option value="active">Solo activos</option>
                  <option value="archived">Solo archivados</option>
                </select>
              </label>
            </div>
            <div class="doc-section-label">
              <strong>{{ selectedCount }} {{ selectedCount === 1 ? 'etiqueta' : 'etiquetas' }}</strong>
              <span class="mono">{{ explicit ? 'Selección manual' : 'Todos los resultados' }}</span>
            </div>
            <div class="doc-inline">
              <button type="button" class="text-button" @click="selectAllMatching">Todos los resultados</button>
              <button type="button" class="text-button" @click="selectPage">Página actual</button>
              <button type="button" class="text-button" @click="clearSelection">Vaciar</button>
            </div>
            <div class="doc-asset-picker" aria-live="polite">
              <p v-if="selection.loading" class="doc-help">Cargando activos del servidor…</p>
              <p v-else-if="selection.error" class="doc-error" role="alert">{{ selection.error }}</p>
              <p v-else-if="!selection.items.length" class="doc-help">Ningún activo coincide con los filtros.</p>
              <label v-for="asset in selection.items" :key="asset.id">
                <input type="checkbox" :checked="rowSelected(asset)" @change="toggle(asset)">
                <span><strong>{{ asset.name }}</strong><small class="mono">{{ asset.id }} · {{ asset.code || asset.quickCode }}</small></span>
              </label>
            </div>
            <div class="doc-inline">
              <button type="button" class="btn btn--ghost btn--small" :disabled="selection.offset === 0 || selection.loading" @click="selectionPage('previous')">← Anterior</button>
              <span class="mono">{{ pageNumber }} / {{ pageCount }}</span>
              <button type="button" class="btn btn--ghost btn--small" :disabled="selection.loading || selection.offset + selection.limit >= selection.total" @click="selectionPage('next')">Siguiente →</button>
            </div>
          </aside>

          <div class="doc-preview-area">
            <header class="doc-preview-toolbar">
              <div>
                <p class="eyebrow">02 · Vista previa</p>
                <h2>Hoja de etiquetas</h2>
                <p>{{ selectedCount }} etiquetas · {{ pages }} {{ pages === 1 ? 'página' : 'páginas' }} · {{ currentFormat.widthMm }} × {{ currentFormat.heightMm }} mm</p>
              </div>
              <button type="button" class="btn btn--secondary" :disabled="previewState.loading" @click="preview">
                <app-icon name="eye"></app-icon>{{ previewState.loading ? 'Preparando…' : 'Actualizar vista previa' }}
              </button>
            </header>
            <div v-if="previewState.html" class="doc-pages">
              <iframe :srcdoc="previewState.html" sandbox="" title="Vista previa de etiquetas" style="width:100%;min-height:640px;border:0;background:#fff"></iframe>
            </div>
            <div v-else class="doc-empty">
              <app-icon name="printer"></app-icon>
              <h3>{{ previewState.loading ? 'Preparando etiquetas…' : 'Sin vista previa' }}</h3>
              <p>El servidor compone la hoja con la misma geometría y contenido que el PDF final.</p>
            </div>
            <p v-if="error || previewState.error || selection.error" class="doc-error" role="alert">{{ error || previewState.error || selection.error }}</p>
            <p v-if="notice" class="doc-help" role="status">{{ notice }}</p>
            <div v-if="activeJob" class="doc-output-bar" data-od-id="active-label-job">
              <div>
                <strong>{{ jobLabel(activeJob.status) }} · {{ activeJob.processed }} / {{ activeJob.total }}</strong>
                <p v-if="activeJob.errors.length" class="doc-error">{{ activeJob.errors.join(' · ') }}</p>
              </div>
              <button v-for="document in activeJobDocuments" :key="document.id" type="button" class="btn btn--ghost btn--small" @click="download(document)">Descargar {{ document.name }}</button>
            </div>
            <footer class="doc-output-bar">
              <div>
                <strong>{{ selectedCount }} {{ selectedCount === 1 ? 'etiqueta' : 'etiquetas' }} para preparar</strong>
                <p>PDF real generado por el servidor · QR permanente · acceso privado por defecto</p>
              </div>
              <button type="button" class="btn btn--primary" :disabled="!selectedCount || !label.fields.length || !canGenerate" data-od-id="prepare-labels" @click="generate">
                <app-icon name="printer"></app-icon>Preparar PDF de etiquetas
              </button>
            </footer>
          </div>
        </div>
      </section>
    `
  };

  const QrSettings = {
    name: 'Phase9QrSettings',
    props: { app: { type: Object, required: true } },
    data() {
      return { baseUrl: '', error: '', saved: false };
    },
    computed: {
      settings() {
        return this.app.phase9.settings;
      },
      canSave() {
        return this.app.can('config.general');
      },
      example() {
        return this.app.phase9.selection.items[0]
          ? LABEL.assetUrl(this.baseUrl || 'https://activos.organizacion.example/', this.app.phase9.selection.items[0].id)
          : '';
      }
    },
    created() {
      this.load();
    },
    methods: {
      async load() {
        await this.app.phase9LoadSettings();
        this.baseUrl = this.settings.baseUrl;
      },
      async save() {
        this.error = '';
        if (this.baseUrl) {
          try {
            const url = new URL(this.baseUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          } catch (_) {
            this.error = 'Introduce una URL http o https válida.';
            return;
          }
        }
        if (!this.canSave) {
          this.error = 'Necesitas el permiso de configuración general.';
          return;
        }
        const result = await this.app.phase9SaveSettings({ baseUrl: this.baseUrl });
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        this.saved = true;
        this.app.showToast('URL base de los códigos QR guardada.');
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="qr-settings">
        <header class="config-section-head">
          <p class="eyebrow">Identidad y acceso</p>
          <h2>URL base y códigos QR</h2>
          <p>El QR de cada activo usa la URL base de la organización y el identificador permanente emitido por el servidor.</p>
        </header>
        <form class="qr-settings-form" @submit.prevent="save">
          <label class="doc-field">URL base de los reportes
            <input type="url" v-model="baseUrl" maxlength="400" placeholder="https://activos.organizacion.example/">
          </label>
          <p class="doc-help">Destino privado: <code>#/reporte/{id-permanente}</code>. Los enlaces públicos se crean y revocan por activo con el permiso de reportes.</p>
          <div v-if="example" class="qr-example">
            <div><strong>Ejemplo de destino</strong><code>{{ example }}</code></div>
          </div>
          <div class="qr-access-note">
            <app-icon name="lock"></app-icon>
            <div><strong>Acceso privado por defecto</strong><p>Cada enlace público limita sus campos y su caducidad, y puede revocarse de forma independiente.</p></div>
          </div>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canSave || settings.saving">{{ settings.saving ? 'Guardando…' : (saved ? 'Guardado' : 'Guardar URL base') }}</button>
        </form>
      </section>
    `
  };

  const LabelSettings = {
    name: 'Phase9LabelSettings',
    props: { app: { type: Object, required: true } },
    data() {
      return { label: LABEL.defaultLabelOptions({}), error: '', saved: false };
    },
    computed: {
      formats() {
        return LABEL.FORMATS;
      },
      fieldOptions() {
        return LABEL.LABEL_FIELDS;
      },
      canSave() {
        return this.app.can('config.general');
      },
      settings() {
        return this.app.phase9.settings;
      }
    },
    created() {
      this.load();
    },
    methods: {
      async load() {
        await this.app.phase9LoadSettings();
        this.label = LABEL.defaultLabelOptions(this.settings.labelDefaults);
      },
      applyFormat() {
        const format = LABEL.formatOf(this.label.formatId);
        const preset = this.label.formatId !== 'custom';
        if (!preset) return;
        this.label.widthMm = format.widthMm;
        this.label.heightMm = format.heightMm;
        this.label.pageWidthMm = format.pageWidthMm;
        this.label.pageHeightMm = format.pageHeightMm;
        this.label.columns = format.columns;
        this.label.rows = format.rows;
        this.label.marginTopMm = format.marginTopMm;
        this.label.marginRightMm = format.marginRightMm;
        this.label.marginBottomMm = format.marginBottomMm;
        this.label.marginLeftMm = format.marginLeftMm;
        this.label.gapXmm = format.gapXmm;
        this.label.gapYmm = format.gapYmm;
      },
      async save() {
        if (!this.canSave) {
          this.error = 'Necesitas el permiso de configuración general.';
          return;
        }
        this.error = '';
        const result = await this.app.phase9SaveSettings({ labelDefaults: this.label });
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        this.saved = true;
        this.app.showToast('Valores predeterminados de etiquetas guardados.');
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="label-settings">
        <header class="config-section-head">
          <p class="eyebrow">Identificación física</p>
          <h2>Formatos y valores de etiquetas</h2>
          <p>Los valores predeterminados se aplican al preparar etiquetas; la hoja final conserva la geometría canónica del servidor.</p>
        </header>
        <form class="qr-settings-form" @submit.prevent="save">
          <label class="doc-field">Formato predeterminado
            <select v-model="label.formatId" @change="applyFormat">
              <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }} · {{ format.detail }}</option>
            </select>
          </label>
          <div class="doc-form-grid">
            <label class="doc-field">Ancho (mm)<input type="number" v-model.number="label.widthMm" min="10" max="500" step="0.5"></label>
            <label class="doc-field">Alto (mm)<input type="number" v-model.number="label.heightMm" min="10" max="500" step="0.5"></label>
            <label class="doc-field">Columnas<input type="number" v-model.number="label.columns" min="1" max="12"></label>
            <label class="doc-field">Posiciones usadas<input type="number" v-model.number="label.offset" min="0" max="500"></label>
            <label class="doc-field">Margen superior<input type="number" v-model.number="label.marginTopMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">Margen derecho<input type="number" v-model.number="label.marginRightMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">Margen inferior<input type="number" v-model.number="label.marginBottomMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">Margen izquierdo<input type="number" v-model.number="label.marginLeftMm" min="0" max="50" step="0.5"></label>
          </div>
          <div class="doc-inline">
            <label><input type="checkbox" v-model="label.logo">Logotipo</label>
            <label><input type="checkbox" v-model="label.qr">Código QR</label>
          </div>
          <fieldset class="doc-field-options">
            <legend>Elementos predeterminados</legend>
            <label v-for="field in fieldOptions" :key="field.key">
              <input type="checkbox" v-model="label.fields" :value="field.key">{{ field.label }}
            </label>
          </fieldset>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canSave || settings.saving">{{ settings.saving ? 'Guardando…' : (saved ? 'Guardado' : 'Guardar valores') }}</button>
        </form>
      </section>
    `
  };

  window.AssetLabelViews = {
    AssetQrCode: AssetQrCode,
    AssetQrPanel: AssetQrPanel,
    PublicAssetReport: PublicAssetReport,
    LabelsCenter: LabelsCenter,
    QrSettings: QrSettings,
    LabelSettings: LabelSettings
  };

  Object.values(window.AssetLabelViews).forEach(function (component) {
    component.components = Object.assign({ AppIcon: window.AppIcon }, component.components || {});
  });
})();
