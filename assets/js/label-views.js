(function () {
  'use strict';

  const LABEL = window.AssetLabelEngine;

  // Module copy resolves through the shared runtime: templates use `$t`, the
  // methods, toasts and status words use this helper.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  // Height of the preview window, in CSS pixels, before the sheet is fitted to
  // the column. It matches the previous fixed preview height.
  const PREVIEW_VIEWPORT_PX = 640;
  const MM_PER_INCH = 25.4;
  // The generated label document declares its own physical page width. The
  // preview is fitted to the document that is on screen, never to the draft:
  // `label.pageWidthMm` changes before a new document exists, so fitting by the
  // draft would scale the old sheet to the new page width.
  const SHEET_WIDTH = /\.label-page\s*\{[^}]*?\bwidth:\s*([0-9]*\.?[0-9]+)mm/;

  // A closed vocabulary prints its catalog label, never the server enum. A
  // value outside the catalog is shown as received instead of guessed.
  function statusLabel(value) {
    const key = String(value || '').toLowerCase();
    const options = (window.AssetInventory && window.AssetInventory.STATUS_OPTIONS) || [];
    const option = options.find((entry) => entry.value === key);
    return option ? option.label : value;
  }

  function renderedSheetMm(html) {
    const match = SHEET_WIDTH.exec(String(html || ''));
    const value = match ? parseFloat(match[1]) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  const JOB_LABELS = {
    queued: 'ui.labels.job.queued',
    running: 'ui.labels.job.running',
    completed: 'ui.labels.job.completed',
    failed: 'ui.labels.job.failed'
  };

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    // Exact options: the day/month/year presets cannot also carry dateStyle and
    // timeStyle, and mixing them throws in Intl.DateTimeFormat.
    if (runtime && typeof runtime.formatDate === 'function') {
      return runtime.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
    }
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
      name: tr('ui.labels.job.document_name'),
      labels: LABEL.wireLabelOptions(options)
    };
  }

  const AssetQrCode = {
    name: 'Phase9AssetQrCode',
    props: {
      svg: { type: String, default: '' },
      label: { type: String, default: '' }
    },
    template: `
      <div v-if="svg" class="asset-qr" role="img" :aria-label="label || $t('ui.qr.code.aria')" v-html="svg"></div>
      <p v-else class="doc-help">{{ $t('ui.qr.code.loading') }}</p>
    `
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
          <div><p class="eyebrow">{{ $t('ui.qr.panel.eyebrow') }}</p><h2>{{ $t('ui.qr.panel.title') }}</h2></div>
          <span class="status-pill"><app-icon name="lock"></app-icon> {{ $t('ui.qr.panel.private_by_default') }}</span>
        </header>
        <div class="qr-asset-body">
          <asset-qr-code :svg="qr.svg" :label="$t('ui.qr.code.asset_aria', { name: asset.name })"></asset-qr-code>
          <div>
            <h3>{{ asset.id }}</h3>
            <p>{{ $t('ui.qr.panel.lead') }}</p>
            <code>{{ privateUrl || $t('ui.qr.panel.loading_url') }}</code>
            <div class="doc-inline">
              <button type="button" class="btn btn--secondary btn--small" :disabled="!privateUrl" @click="copy(privateUrl)">{{ $t('ui.qr.panel.copy_private') }}</button>
              <a class="text-button" :href="privateReportUrl()">{{ $t('ui.qr.panel.preview_private') }}</a>
              <button type="button" class="text-button" @click="app.openDocuments('reports', [asset.id])">{{ $t('ui.qr.panel.prepare_report') }}</button>
              <button type="button" class="text-button" @click="app.openDocuments('labels', [asset.id])">{{ $t('ui.qr.panel.create_label') }}</button>
            </div>
          </div>
        </div>
        <p v-if="qr.error" class="doc-error" role="alert">{{ qr.error }}</p>
        <div class="qr-share-settings">
          <div>
            <strong>{{ $t('ui.qr.share.title') }}</strong>
            <p>{{ $t('ui.qr.share.lead') }}</p>
          </div>
          <template v-if="!share">
            <fieldset class="doc-field-options" :disabled="!canShare">
              <legend>{{ $t('ui.qr.share.fields_legend') }}</legend>
              <label v-for="field in publicFields" :key="field.key">
                <input type="checkbox" v-model="shareFields" :value="field.key">{{ field.label }}
              </label>
            </fieldset>
            <label class="doc-field">{{ $t('ui.qr.share.expiry') }}
              <select v-model.number="expiresInDays" :disabled="!canShare">
                <option v-for="days in expiryDays" :key="days" :value="days">{{ $t('ui.qr.expiry_days', { count: days }, days) }}</option>
              </select>
            </label>
            <button type="button" class="btn btn--secondary" :disabled="!canShare || app.phase9.share.creating" @click="createShare">
              {{ app.phase9.share.creating ? $t('ui.qr.share.creating') : $t('ui.qr.share.create') }}
            </button>
            <span v-if="!canShare" class="doc-help">{{ $t('ui.qr.share.no_permission') }}</span>
          </template>
          <template v-else>
            <div v-if="share.url" class="qr-shared-url">
              <code>{{ share.url }}</code>
              <button type="button" class="text-button" @click="copy(share.url)">{{ $t('ui.qr.share.copy') }}</button>
              <a class="text-button" :href="share.url" target="_blank" rel="noopener">{{ $t('ui.qr.share.open') }}</a>
            </div>
            <p v-else class="doc-help" role="status">{{ $t('ui.qr.share.url_hidden') }}</p>
            <p class="doc-help">{{ $t('ui.qr.share.expires', { date: formatDate(share.expiresAt), count: share.fields.length }) }}</p>
            <button type="button" class="btn btn--ghost btn--small" :disabled="app.phase9.share.revoking" @click="revoke">
              {{ app.phase9.share.revoking ? $t('ui.qr.share.revoking') : $t('ui.qr.share.revoke') }}
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
        if (this.app.copyText) this.app.copyText(value, tr('ui.qr.copied'));
        this.copied = value;
      },
      privateReportUrl() {
        return '#/reporte/' + encodeURIComponent(this.asset.id);
      },
      async createShare() {
        this.copied = '';
        const result = await this.app.phase9CreateShare(this.asset.id, this.shareFields, this.expiresInDays);
        if (!result.ok) return;
        this.app.showToast(tr('ui.qr.toast.created'));
      },
      async revoke() {
        if (!this.share) return;
        const result = await this.app.phase9RevokeShare(this.share.id);
        if (!result.ok) return;
        this.app.showToast(tr('ui.qr.toast.revoked'));
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
          return { loading: false, asset: null, fields: [], error: tr('ui.qr.error.token_missing') };
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
        if (this.publicMode) return tr('ui.qr.public_org');
        const branding = this.app.phase9Settings.branding;
        return branding && branding.name ? branding.name : tr('ui.shell.public_brand');
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
          // The capability projection is owned by `phase9LoadPublicReport`,
          // which clears it before every read so a swapped or revoked token can
          // never keep the previous record on screen.
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
        if (value === undefined || value === null || value === '') return '—';
        return key === 'status' ? statusLabel(value) : value;
      },
      date(value) {
        return formatDate(value);
      }
    },
    template: `
      <section class="page qr-report-page" data-od-id="qr-asset-report">
        <template v-if="asset">
          <a v-if="!publicMode" class="back-link" :href="'#/activo/' + encodeURIComponent(asset.id)">
            <app-icon name="arrow-left"></app-icon>{{ $t('ui.qr.report.back') }}
          </a>
          <header class="page-head">
            <div>
              <p class="eyebrow">{{ publicMode ? $t('ui.qr.report.eyebrow_public') : $t('ui.qr.report.eyebrow_private', { id: asset.id }) }}</p>
              <h1>{{ publicMode ? $t('ui.qr.report.title_public') : $t('ui.qr.report.title_private') }}</h1>
              <p class="page-head__description">{{ publicMode ? $t('ui.qr.report.lead_public') : $t('ui.qr.report.lead_private') }}</p>
            </div>
            <span class="status-pill">{{ publicMode ? $t('ui.qr.report.pill_public') : $t('ui.qr.report.pill_private') }}</span>
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
                <asset-qr-code :svg="privateQr.svg" :label="$t('ui.qr.code.asset_aria', { name: asset.id })"></asset-qr-code>
                <p>{{ $t('ui.qr.report.dest_private') }}<span class="mono">{{ privateQr.url }}</span></p>
              </template>
              <p v-else-if="publicMode">{{ $t('ui.qr.report.expires', { date: date(publicState.expiresAt) }) }}<span class="mono">{{ $t('ui.qr.report.fields_visible', { count: publicState.fields.length }) }}</span></p>
              <p v-else>{{ $t('ui.qr.report.internal') }}<span class="mono">{{ asset.id }}</span></p>
            </footer>
          </article>
        </template>
        <div v-else-if="loading" class="doc-empty"><app-icon name="file-text"></app-icon><h2>{{ $t('ui.qr.report.loading') }}</h2></div>
        <div v-else class="qr-public-empty">
          <app-icon name="lock"></app-icon>
          <h2>{{ publicMode ? $t('ui.qr.report.unavailable_public') : $t('ui.qr.report.unavailable_private') }}</h2>
          <p>{{ error || $t('ui.qr.report.unavailable_lead') }}</p>
          <a v-if="!publicMode" href="#/inventario" class="btn btn--secondary">{{ $t('ui.qr.report.go_inventory') }}</a>
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
        notice: '',
        previewScale: 1,
        previewFrameHeight: PREVIEW_VIEWPORT_PX,
        previewObserver: null,
        previewDisposed: false
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
      },
      previewSheetMm() {
        return renderedSheetMm(this.previewState.html);
      },
      previewSheetWidth() {
        return this.previewSheetMm
          ? Math.round(this.previewSheetMm * (96 / MM_PER_INCH) * 100) / 100
          : 0;
      },
      previewSheetStyle() {
        return {
          '--doc-scale': String(this.previewScale),
          '--doc-sheet-width': this.previewSheetWidth ? this.previewSheetWidth + 'px' : '100%',
          '--doc-frame-height': this.previewFrameHeight + 'px'
        };
      }
    },
    watch: {
      'previewState.html'() {
        this.$nextTick(this.observePreview);
      }
    },
    created() {
      this.initialize();
    },
    mounted() {
      this.$nextTick(this.observePreview);
    },
    beforeUnmount() {
      // A queued nextTick observation and a resize callback already handed to
      // the browser can run after this point: both must find a disposed
      // component instead of re-observing a torn-down preview.
      this.previewDisposed = true;
      if (this.previewObserver) this.previewObserver.disconnect();
      this.previewObserver = null;
    },
    methods: {
      /* The label sheet keeps its real page width in millimetres, so a preview
       * column narrower than the page used to hide its right-hand labels. Fit
       * the sheet that was generated, not the current draft, to the column. */
      previewHost() {
        if (this.previewDisposed) return null;
        // Mounted hosts and harness stubs differ: never assume a DOM element.
        const root = this.$el;
        if (!root || typeof root.querySelector !== 'function') return null;
        if (root.isConnected === false) return null;
        return root.querySelector('.doc-pages');
      },
      fitPreview() {
        if (this.previewDisposed) return;
        const sheet = this.previewSheetWidth;
        if (!(sheet > 0)) {
          // A document without a readable sheet width is not fitted, and it
          // must not inherit the scale and frame of the sheet before it.
          this.previewScale = 1;
          this.previewFrameHeight = PREVIEW_VIEWPORT_PX;
          return;
        }
        const pages = this.previewHost();
        if (!pages) return;
        const style = window.getComputedStyle(pages);
        const available = pages.clientWidth
          - (parseFloat(style.paddingLeft) || 0)
          - (parseFloat(style.paddingRight) || 0);
        if (!(available > 0)) return;
        // Floor the ratio so the fitted sheet can never overflow by rounding.
        const ratio = Math.min(1, Math.floor((available / sheet) * 10000) / 10000);
        this.previewScale = ratio;
        this.previewFrameHeight = Math.round(PREVIEW_VIEWPORT_PX / ratio);
      },
      observePreview() {
        if (this.previewDisposed) return;
        const pages = this.previewHost();
        if (!pages) {
          this.fitPreview();
          return;
        }
        if (typeof ResizeObserver === 'function') {
          if (!this.previewObserver) {
            this.previewObserver = new ResizeObserver(() => {
              if (this.previewDisposed) return;
              this.fitPreview();
            });
          }
          this.previewObserver.disconnect();
          this.previewObserver.observe(pages);
        }
        this.fitPreview();
      },
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
          this.error = tr('ui.labels.error.no_assets');
          return;
        }
        if (!this.label.fields.length) {
          this.error = tr('ui.labels.error.no_fields');
          return;
        }
        const result = await this.app.phase9CreateJob(this.request());
        if (!result.ok) {
          this.error = result.error || '';
          return;
        }
        this.notice = tr('ui.labels.toast.queued');
      },
      jobLabel(value) {
        return JOB_LABELS[value] ? tr(JOB_LABELS[value]) : (value || tr('ui.labels.job.none'));
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
            <p class="eyebrow">{{ $t('ui.labels.eyebrow_physical') }}</p>
            <h1>{{ $t('ui.labels.center.title') }}</h1>
            <p class="page-head__description">{{ $t('ui.labels.center.lead') }}</p>
          </div>
          <a class="btn btn--secondary" href="#/configuracion/etiquetas"><app-icon name="sliders"></app-icon>{{ $t('ui.labels.center.defaults_link') }}</a>
        </header>
        <div class="doc-workspace">
          <aside class="doc-controls">
            <div class="doc-control-head"><p class="eyebrow">{{ $t('ui.labels.center.eyebrow_compose') }}</p><h2>{{ $t('ui.labels.center.compose_title') }}</h2></div>
            <label class="doc-field">{{ $t('ui.labels.field.format') }}
              <select v-model="label.formatId" @change="applyFormat">
                <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option>
              </select>
            </label>
            <p class="doc-help">{{ currentFormat.detail }}</p>
            <div v-if="custom" class="doc-form-grid">
              <label class="doc-field">{{ $t('ui.labels.geometry.width') }}<input type="number" v-model.number="label.widthMm" min="10" max="500" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.height') }}<input type="number" v-model.number="label.heightMm" min="10" max="500" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.page_width') }}<input type="number" v-model.number="label.pageWidthMm" min="20" max="1000" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.page_height') }}<input type="number" v-model.number="label.pageHeightMm" min="20" max="1000" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.margin_top') }}<input type="number" v-model.number="label.marginTopMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.margin_right') }}<input type="number" v-model.number="label.marginRightMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.margin_bottom') }}<input type="number" v-model.number="label.marginBottomMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.margin_left') }}<input type="number" v-model.number="label.marginLeftMm" min="0" max="50" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.gap_x') }}<input type="number" v-model.number="label.gapXmm" min="0" max="30" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.gap_y') }}<input type="number" v-model.number="label.gapYmm" min="0" max="30" step="0.5"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.columns') }}<input type="number" v-model.number="label.columns" min="1" max="12"></label>
              <label class="doc-field">{{ $t('ui.labels.geometry.offset') }}<input type="number" v-model.number="label.offset" min="0" max="500"></label>
            </div>
            <div class="doc-inline">
              <label><input type="checkbox" v-model="label.logo">{{ $t('ui.labels.field.logo') }}</label>
              <label><input type="checkbox" v-model="label.qr">{{ $t('ui.labels.field.qr') }}</label>
            </div>
            <fieldset class="doc-field-options">
              <legend>{{ $t('ui.labels.center.elements_legend') }}</legend>
              <label v-for="field in fieldOptions" :key="field.key">
                <input type="checkbox" v-model="label.fields" :value="field.key">{{ field.label }}
              </label>
            </fieldset>

            <hr class="doc-rule">
            <label class="doc-field">{{ $t('ui.labels.search.label') }}<input type="search" v-model="filters.search" :placeholder="$t('ui.labels.search.placeholder')" @input="scheduleSelection"></label>
            <div class="doc-form-grid">
              <label class="doc-field">{{ $t('ui.labels.field.category') }}
                <select v-model="filters.category" @change="reloadSelection">
                  <option value="">{{ $t('ui.labels.filter.all_feminine') }}</option>
                  <option v-for="category in categoryOptions" :key="category.id" :value="category.id">{{ category.label }}</option>
                </select>
              </label>
              <label class="doc-field">{{ $t('ui.labels.field.status') }}
                <select v-model="filters.status" @change="reloadSelection">
                  <option value="">{{ $t('ui.labels.filter.all_masculine') }}</option>
                  <option v-for="status in statusOptions" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="doc-field">{{ $t('ui.labels.field.site') }}
                <select v-model="filters.siteId" @change="reloadSelection">
                  <option value="">{{ $t('ui.labels.filter.all_feminine') }}</option>
                  <option v-for="site in siteOptions" :key="site.id" :value="site.id">{{ site.label }}</option>
                </select>
              </label>
              <label class="doc-field">{{ $t('ui.labels.field.location') }}
                <select v-model="filters.locationId" @change="reloadSelection">
                  <option value="">{{ $t('ui.labels.filter.all_feminine') }}</option>
                  <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.name }}</option>
                </select>
              </label>
              <label class="doc-field">{{ $t('ui.labels.field.responsible') }}
                <select v-model="filters.responsiblePersonId" @change="reloadSelection">
                  <option value="">{{ $t('ui.labels.filter.all_masculine') }}</option>
                  <option v-for="person in responsibleOptions" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
              </label>
              <label class="doc-field">{{ $t('ui.labels.filter.archived') }}
                <select v-model="filters.archived" @change="reloadSelection">
                  <option value="active">{{ $t('ui.labels.filter.archived_active') }}</option>
                  <option value="archived">{{ $t('ui.labels.filter.archived_only') }}</option>
                </select>
              </label>
            </div>
            <div class="doc-section-label">
              <strong>{{ $t('ui.labels.count', { count: selectedCount }, selectedCount) }}</strong>
              <span class="mono">{{ explicit ? $t('ui.labels.selection.manual') : $t('ui.reports.all_results') }}</span>
            </div>
            <div class="doc-inline">
              <button type="button" class="text-button" @click="selectAllMatching">{{ $t('ui.reports.all_results') }}</button>
              <button type="button" class="text-button" @click="selectPage">{{ $t('ui.reports.current_page') }}</button>
              <button type="button" class="text-button" @click="clearSelection">{{ $t('ui.reports.clear_selection') }}</button>
            </div>
            <div class="doc-asset-picker" aria-live="polite">
              <p v-if="selection.loading" class="doc-help">{{ $t('ui.labels.selection.loading') }}</p>
              <p v-else-if="selection.error" class="doc-error" role="alert">{{ selection.error }}</p>
              <p v-else-if="!selection.items.length" class="doc-help">{{ $t('ui.labels.selection.empty') }}</p>
              <label v-for="asset in selection.items" :key="asset.id">
                <input type="checkbox" :checked="rowSelected(asset)" @change="toggle(asset)">
                <span><strong>{{ asset.name }}</strong><small class="mono">{{ asset.id }} · {{ asset.code || asset.quickCode }}</small></span>
              </label>
            </div>
            <div class="doc-inline">
              <button type="button" class="btn btn--ghost btn--small" :disabled="selection.offset === 0 || selection.loading" @click="selectionPage('previous')">← {{ $t('ui.inventory.previous') }}</button>
              <span class="mono">{{ pageNumber }} / {{ pageCount }}</span>
              <button type="button" class="btn btn--ghost btn--small" :disabled="selection.loading || selection.offset + selection.limit >= selection.total" @click="selectionPage('next')">{{ $t('ui.inventory.next') }} →</button>
            </div>
          </aside>

          <div class="doc-preview-area">
            <header class="doc-preview-toolbar">
              <div>
                <p class="eyebrow">{{ $t('ui.labels.center.eyebrow_preview') }}</p>
                <h2>{{ $t('ui.labels.center.preview_title') }}</h2>
                <p>{{ $t('ui.labels.count', { count: selectedCount }, selectedCount) }} · {{ $t('ui.labels.preview.pages', { count: pages }, pages) }} · {{ currentFormat.widthMm }} × {{ currentFormat.heightMm }} mm</p>
              </div>
              <button type="button" class="btn btn--secondary" :disabled="previewState.loading" @click="preview">
                <app-icon name="eye"></app-icon>{{ previewState.loading ? $t('ui.labels.preview.preparing') : $t('ui.labels.preview.refresh') }}
              </button>
            </header>
            <div v-if="previewState.html" class="doc-pages">
              <div class="doc-sheet" :style="previewSheetStyle">
                <iframe class="doc-sheet__frame" :srcdoc="previewState.html" sandbox="" :title="$t('ui.labels.preview.frame_title')"></iframe>
              </div>
            </div>
            <div v-else class="doc-empty">
              <app-icon name="printer"></app-icon>
              <h3>{{ previewState.loading ? $t('ui.labels.preview.loading') : $t('ui.labels.preview.empty_title') }}</h3>
              <p>{{ $t('ui.labels.preview.empty_lead') }}</p>
            </div>
            <p v-if="error || previewState.error || selection.error" class="doc-error" role="alert">{{ error || previewState.error || selection.error }}</p>
            <p v-if="notice" class="doc-help" role="status">{{ notice }}</p>
            <div v-if="activeJob" class="doc-output-bar" data-od-id="active-label-job">
              <div>
                <strong>{{ jobLabel(activeJob.status) }} · {{ activeJob.processed }} / {{ activeJob.total }}</strong>
                <p v-if="activeJob.errors.length" class="doc-error">{{ activeJob.errors.join(' · ') }}</p>
              </div>
              <button v-for="document in activeJobDocuments" :key="document.id" type="button" class="btn btn--ghost btn--small" @click="download(document)">{{ $t('ui.labels.job.download', { name: document.name }) }}</button>
            </div>
            <footer class="doc-output-bar">
              <div>
                <strong>{{ $t('ui.labels.footer.count', { count: selectedCount }, selectedCount) }}</strong>
                <p>{{ $t('ui.labels.footer.note') }}</p>
              </div>
              <button type="button" class="btn btn--primary" :disabled="!selectedCount || !label.fields.length || !canGenerate" data-od-id="prepare-labels" @click="generate">
                <app-icon name="printer"></app-icon>{{ $t('ui.labels.footer.prepare') }}
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
      return { baseUrl: '', error: '', saved: false, loading: false, loadError: '',
        urlError: '', dirty: false, owned: false };
    },
    computed: {
      settings() {
        return this.app.phase9.settings;
      },
      canSave() {
        return this.app.can('config.general');
      },
      // The private destination is a route pattern, not copy: it is built here
      // so the template has no literal path a translator would touch.
      privatePath() {
        return '#/reporte/{id-permanente}';
      },
      example() {
        return this.app.phase9.selection.items[0]
          ? LABEL.assetUrl(this.baseUrl || 'https://activos.organizacion.example/', this.app.phase9.selection.items[0].id)
          : '';
      }
    },
    created() {
      this.owned = true;
      this.load();
    },
    beforeUnmount() {
      this.owned = false;
    },
    methods: {
      ownerToken() {
        const user = this.app.currentUser || {};
        const phase9 = this.app.phase9 || {};
        return String(user.id || '') + '|' + String(phase9.sessionEpoch || '');
      },
      async load() {
        const owner = this.ownerToken();
        this.loading = true;
        this.loadError = '';
        // The retained base URL stays visible while the refresh runs.
        if (!this.dirty) this.baseUrl = this.settings.baseUrl;
        const loaded = await this.app.phase9LoadSettings();
        if (!this.owned || this.ownerToken() !== owner) return;
        this.loading = false;
        if (!loaded) {
          if (this.canSave && !this.settings.loaded) this.loadError = tr('ui.qr.settings.load_error');
          return;
        }
        // An edit typed during the read wins over the response.
        if (this.dirty) return;
        this.baseUrl = this.settings.baseUrl;
        this.dirty = false;
        this.saved = false;
      },
      async save() {
        this.error = '';
        this.urlError = '';
        this.saved = false;
        // The handler is the guard: a disabled button is not a contract.
        if (this.loading || !this.settings.loaded || this.loadError || this.settings.saving) {
          return { ok: false, error: this.loadError };
        }
        if (!this.canSave) {
          this.error = tr('ui.labels.error.permission');
          return { ok: false };
        }
        if (this.baseUrl) {
          try {
            const url = new URL(this.baseUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          } catch (_) {
            this.urlError = tr('ui.qr.settings.error_url');
            return { ok: false };
          }
        }
        const result = await this.app.phase9SaveSettings({ baseUrl: this.baseUrl });
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        this.dirty = false;
        this.saved = true;
        this.app.showToast(tr('ui.qr.settings.toast_saved'));
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="qr-settings">
        <header class="config-section-head">
          <p class="eyebrow">{{ $t('ui.qr.settings.eyebrow') }}</p>
          <h2>{{ $t('ui.qr.settings.title') }}</h2>
          <p>{{ $t('ui.qr.settings.lead') }}</p>
        </header>
        <form class="qr-settings-form" @submit.prevent="save" @input="saved = false; dirty = true" :aria-busy="settings.saving ? 'true' : 'false'">
          <p v-if="loading" class="doc-help" role="status">{{ $t('ui.common.loading') }}</p>
          <p v-else-if="loadError" class="doc-error" role="alert">{{ loadError }}</p>
          <label class="doc-field">{{ $t('ui.qr.settings.base_url') }}
            <input type="url" v-model="baseUrl" maxlength="400" :placeholder="$t('ui.qr.settings.base_url_placeholder')"
                   :aria-invalid="urlError ? 'true' : 'false'"
                   :aria-describedby="urlError ? 'qr-base-url-error' : null">
          </label>
          <p v-if="urlError" id="qr-base-url-error" class="doc-error">{{ urlError }}</p>
          <p class="doc-help">{{ $t('ui.qr.settings.private_prefix') }} <code>{{ privatePath }}</code>. {{ $t('ui.qr.settings.private_note') }}</p>
          <div v-if="example" class="qr-example">
            <div><strong>{{ $t('ui.qr.settings.example') }}</strong><code>{{ example }}</code></div>
          </div>
          <div class="qr-access-note">
            <app-icon name="lock"></app-icon>
            <div><strong>{{ $t('ui.qr.settings.access_title') }}</strong><p>{{ $t('ui.qr.settings.access_lead') }}</p></div>
          </div>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canSave || settings.saving || loading || !settings.loaded || !!loadError">{{ settings.saving ? $t('ui.common.saving') : (saved ? $t('ui.qr.settings.saved') : $t('ui.qr.settings.save')) }}</button>
        </form>
      </section>
    `
  };

  const LabelSettings = {
    name: 'Phase9LabelSettings',
    props: { app: { type: Object, required: true } },
    data() {
      return { label: LABEL.defaultLabelOptions({}), error: '', saved: false, loading: false,
        loadError: '', dirty: false, owned: false };
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
      this.owned = true;
      this.load();
    },
    beforeUnmount() {
      this.owned = false;
    },
    methods: {
      ownerToken() {
        const user = this.app.currentUser || {};
        const phase9 = this.app.phase9 || {};
        return String(user.id || '') + '|' + String(phase9.sessionEpoch || '');
      },
      copyRetained() {
        this.label = LABEL.defaultLabelOptions(this.settings.labelDefaults);
      },
      async load() {
        const owner = this.ownerToken();
        this.loading = true;
        this.loadError = '';
        // The retained geometry stays visible while the refresh runs.
        if (!this.dirty) this.copyRetained();
        const loaded = await this.app.phase9LoadSettings();
        if (!this.owned || this.ownerToken() !== owner) return;
        this.loading = false;
        if (!loaded) {
          if (this.canSave && !this.settings.loaded) this.loadError = tr('ui.labels.settings.load_error');
          return;
        }
        // An edit typed during the read wins over the response.
        if (this.dirty) return;
        this.copyRetained();
        this.dirty = false;
        this.saved = false;
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
        this.error = '';
        this.saved = false;
        // The handler is the guard: a disabled button is not a contract.
        if (this.loading || !this.settings.loaded || this.loadError || this.settings.saving) {
          return { ok: false, error: this.loadError };
        }
        if (!this.canSave) {
          this.error = tr('ui.labels.error.permission');
          return { ok: false };
        }
        const result = await this.app.phase9SaveSettings({ labelDefaults: this.label });
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        this.dirty = false;
        this.saved = true;
        this.app.showToast(tr('ui.labels.settings.toast_saved'));
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="label-settings">
        <header class="config-section-head">
          <p class="eyebrow">{{ $t('ui.labels.eyebrow_physical') }}</p>
          <h2>{{ $t('ui.labels.settings.title') }}</h2>
          <p>{{ $t('ui.labels.settings.lead') }}</p>
        </header>
        <form class="qr-settings-form" @submit.prevent="save" @input="saved = false; dirty = true" @change="saved = false" :aria-busy="settings.saving ? 'true' : 'false'">
          <p v-if="loading" class="doc-help" role="status">{{ $t('ui.common.loading') }}</p>
          <p v-else-if="loadError" class="doc-error" role="alert">{{ loadError }}</p>
          <label class="doc-field">{{ $t('ui.labels.settings.format_label') }}
            <select v-model="label.formatId" @change="applyFormat(); dirty = true">
              <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }} · {{ format.detail }}</option>
            </select>
          </label>
          <div class="doc-form-grid">
            <label class="doc-field">{{ $t('ui.labels.geometry.width') }}<input type="number" v-model.number="label.widthMm" min="10" max="500" step="0.5"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.height') }}<input type="number" v-model.number="label.heightMm" min="10" max="500" step="0.5"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.columns') }}<input type="number" v-model.number="label.columns" min="1" max="12"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.offset') }}<input type="number" v-model.number="label.offset" min="0" max="500"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.margin_top') }}<input type="number" v-model.number="label.marginTopMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.margin_right') }}<input type="number" v-model.number="label.marginRightMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.margin_bottom') }}<input type="number" v-model.number="label.marginBottomMm" min="0" max="50" step="0.5"></label>
            <label class="doc-field">{{ $t('ui.labels.geometry.margin_left') }}<input type="number" v-model.number="label.marginLeftMm" min="0" max="50" step="0.5"></label>
          </div>
          <div class="doc-inline">
            <label><input type="checkbox" v-model="label.logo">{{ $t('ui.labels.field.logo') }}</label>
            <label><input type="checkbox" v-model="label.qr">{{ $t('ui.labels.field.qr') }}</label>
          </div>
          <fieldset class="doc-field-options">
            <legend>{{ $t('ui.labels.settings.elements_legend') }}</legend>
            <label v-for="field in fieldOptions" :key="field.key">
              <input type="checkbox" v-model="label.fields" :value="field.key">{{ field.label }}
            </label>
          </fieldset>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canSave || settings.saving || loading || !settings.loaded || !!loadError">{{ settings.saving ? $t('ui.common.saving') : (saved ? $t('ui.labels.settings.saved') : $t('ui.labels.settings.save')) }}</button>
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
