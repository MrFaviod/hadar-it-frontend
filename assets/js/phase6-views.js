(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }

  // Module copy resolves through the shared runtime: templates use `$t`, the
  // toasts, status words and validation messages use this helper.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  /* Phase 6 workspace surfaces.
   *
   * These components replace the prototype import wizard, warranty center and
   * bulk editor on the routes that already existed. Every value comes from the
   * Phase 6 adapter: the server parses the file, classifies the rows, keeps the
   * preview, requires a human approval and executes with stored permissions.
   * No demo file, placeholder row or browser-stored preference is read here.
   */
  const Views = (window.AssetPhase6Views = window.AssetPhase6Views || {});

  const CATEGORY_KEYS = {
    photo: 'ui.phase6.category.photo',
    receipt: 'ui.phase6.category.receipt',
    manual: 'ui.phase6.category.manual',
    document: 'ui.phase6.category.document'
  };
  const WARRANTY_STATUSES = ['active', 'cancelled', 'claimed', 'unknown'];
  const WARRANTY_STATUS_KEYS = {
    active: 'ui.phase6.warranty.status.active',
    cancelled: 'ui.phase6.warranty.status.cancelled',
    claimed: 'ui.phase6.warranty.status.claimed',
    unknown: 'ui.phase6.warranty.status.unknown'
  };
  const COVERAGE_KEYS = {
    '': 'ui.phase6.coverage.all',
    current: 'ui.phase6.coverage.current',
    expiring: 'ui.phase6.coverage.expiring',
    expired: 'ui.phase6.coverage.expired',
    unknown: 'ui.phase6.coverage.unknown'
  };
  const COVERAGE_TONES = { current: 'ok', expiring: 'warn', expired: 'down', unknown: 'hold' };
  const CLASS_KEYS = {
    new: 'ui.phase6.classification.new',
    safe: 'ui.phase6.classification.safe',
    possible_duplicate: 'ui.phase6.classification.possible_duplicate',
    error: 'ui.phase6.classification.error',
    omitted: 'ui.phase6.classification.omitted'
  };
  const CLASS_TONES = { new: 'ok', safe: 'ok', possible_duplicate: 'warn', error: 'down', omitted: 'hold' };
  const STATE_KEYS = {
    preview: 'ui.phase6.state.preview',
    approved: 'ui.phase6.state.approved',
    queued: 'ui.phase6.state.queued',
    running: 'ui.phase6.state.running',
    complete: 'ui.phase6.state.complete',
    queue_error: 'ui.phase6.state.queue_error',
    error: 'ui.phase6.state.error'
  };
  const BULK_ACTIONS = [
    { id: 'update', labelKey: 'ui.phase6.bulk.action.update' },
    { id: 'assign', labelKey: 'ui.phase6.bulk.action.assign' },
    { id: 'transfer', labelKey: 'ui.phase6.bulk.action.transfer' },
    { id: 'archive', labelKey: 'ui.phase6.bulk.action.archive' }
  ];
  const IMPORT_FIELDS = [
    { id: 'name', labelKey: 'ui.labels.field.name' },
    { id: 'quick_code', labelKey: 'ui.labels.field.quick_code' },
    { id: 'category', labelKey: 'ui.labels.field.category' },
    { id: 'type', labelKey: 'ui.phase6.import.field.type' },
    { id: 'brand', labelKey: 'ui.phase6.import.field.brand' },
    { id: 'model', labelKey: 'ui.phase6.import.field.model' },
    { id: 'serial', labelKey: 'ui.phase6.import.field.serial' },
    { id: 'ip', labelKey: 'ui.phase6.import.field.ip' },
    { id: 'site', labelKey: 'ui.labels.field.site' },
    { id: 'location', labelKey: 'ui.labels.field.location' },
    { id: 'responsible', labelKey: 'ui.phase6.import.field.responsible' },
    { id: 'status', labelKey: 'ui.labels.field.status' },
    { id: 'cost', labelKey: 'ui.phase6.import.field.cost' },
    { id: 'description', labelKey: 'ui.phase6.import.field.description' }
  ];
  const MATCH_FIELD_KEYS = {
    quick_code: 'ui.phase6.match.quick_code',
    serial: 'ui.phase6.match.serial',
    ip: 'ui.phase6.match.ip'
  };
  const EXPORT_FIELD_KEYS = {
    id: 'ui.labels.field.id',
    quick_code: 'ui.labels.field.quick_code',
    name: 'ui.labels.field.name',
    category: 'ui.labels.field.category',
    status: 'ui.labels.field.status',
    serial: 'ui.phase6.import.field.serial',
    site: 'ui.labels.field.site',
    location: 'ui.labels.field.location',
    responsible: 'ui.phase6.import.field.responsible'
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(value) {
    const raw = text(value);
    if (!raw) return '';
    return raw.slice(0, 10);
  }

  function coverageLabel(value) {
    return tr(COVERAGE_KEYS[text(value)] || COVERAGE_KEYS.unknown);
  }

  function coverageTone(value) {
    return COVERAGE_TONES[text(value)] || 'hold';
  }

  function statusLabel(value) {
    return tr(WARRANTY_STATUS_KEYS[text(value)] || WARRANTY_STATUS_KEYS.unknown);
  }

  function categoryLabel(value) {
    return tr(CATEGORY_KEYS[text(value)] || CATEGORY_KEYS.document);
  }

  function classLabel(value) {
    return tr(CLASS_KEYS[text(value)] || 'ui.phase6.classification.none');
  }

  function classTone(value) {
    return CLASS_TONES[text(value)] || 'hold';
  }

  function stateLabel(value) {
    return tr(STATE_KEYS[text(value)] || 'ui.phase6.state.none');
  }

  function importFieldLabel(field) {
    return tr(field.labelKey);
  }

  function saveBlob(blob, filename) {
    if (typeof URL === 'undefined' || !URL.createObjectURL) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'assets.csv';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    return true;
  }

  function fileOf(event) {
    const input = event && event.target;
    const files = input && input.files;
    return files && files.length ? files[0] : null;
  }

  function optionsWithMapping(options, mapping) {
    const next = Object.assign({}, options);
    const entries = Object.keys(mapping || {}).filter((key) => text(mapping[key]));
    if (entries.length) {
      next.mapping = {};
      entries.forEach((key) => {
        next.mapping[key] = mapping[key];
      });
    }
    return next;
  }

  Views.Phase6DataTransfer = {
    name: 'Phase6DataTransfer',
    props: { app: { type: Object, required: true } },
    data() {
      return {
        tab: 'import',
        step: 1,
        file: null,
        options: {
          delimiter: '',
          encoding: '',
          headerRow: 1,
          siteFromSheet: false,
          overwriteEmpty: false,
          category: '',
          matchFields: ['quick_code', 'serial']
        },
        mapping: {},
        profileId: '',
        profileName: '',
        resolving: {},
        busy: false,
        message: '',
        errors: {},
        exportFields: ['id', 'quick_code', 'name', 'category', 'status', 'serial', 'site', 'location', 'responsible'],
        exportSelection: 'filters',
        exportFilters: { category: '', status: '', site_id: '', location_id: '', archived: '' }
      };
    },
    computed: {
      phase6() {
        return this.app.phase6;
      },
      operation() {
        return this.app.phase6 ? this.app.phase6.operation : null;
      },
      rows() {
        return this.app.phase6OperationRows || [];
      },
      counts() {
        return this.app.phase6ClassificationCounts || { new: 0, safe: 0, possible_duplicate: 0, error: 0, omitted: 0 };
      },
      summary() {
        return this.app.phase6OperationSummary || { created: 0, modified: 0, omitted: 0, failed: 0 };
      },
      conflicts() {
        return this.app.phase6ConflictRows || [];
      },
      profiles() {
        return this.app.phase6ImportProfiles || [];
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      state() {
        return this.operation ? this.operation.state : '';
      },
      approved() {
        return !!(this.operation && this.operation.approved);
      },
      finalState() {
        return ['complete', 'error', 'queue_error'].indexOf(this.state) !== -1;
      },
      columns() {
        const seen = {};
        this.rows.forEach((row) => {
          Object.keys(row.values || {}).forEach((key) => {
            if (key === 'technical' || seen[key]) return;
            seen[key] = true;
          });
        });
        return Object.keys(seen).sort((a, b) => compareText(a, b, { sensitivity: 'base' }));
      },
      fieldChoices() {
        const choices = IMPORT_FIELDS.map((field) => ({ id: field.id, label: importFieldLabel(field), labelKey: field.labelKey }));
        const catalog = this.app.inventoryCatalog;
        const fields = catalog && Array.isArray(catalog.fields) ? catalog.fields : [];
        fields
          .filter((field) => field.active !== false)
          .forEach((field) => {
            choices.push({ id: 'technical.' + field.key, label: field.label + ' (' + tr('ui.phase6.import.own_field') + ')' });
          });
        return choices;
      },
      selectedRows() {
        return this.app.inventoryItems ? this.app.inventoryItems.slice() : [];
      },
      selectionIds() {
        return (this.app.bulk && Array.isArray(this.app.bulk.ids) ? this.app.bulk.ids : []).slice();
      },
      statusChoices() {
        const statuses = this.app.inventoryStatusChoices || [];
        return statuses.map((status) => ({ value: status.value, label: status.label }));
      },
      canApprove() {
        return this.canEdit && !!this.operation && !!this.operation.id && this.state === 'preview' && !this.conflicts.length && this.operation.total > 0;
      },
      canExecute() {
        return this.canEdit && !!this.operation && !!this.operation.id && (this.state === 'approved' || this.state === 'preview') && this.approved;
      },
      stepCount() {
        return 4;
      }
    },
    created() {
      if (this.app.loadImportProfiles) this.app.loadImportProfiles();
    },
    methods: {
      categoryLabel,
      classLabel,
      classTone,
      stateLabel,
      formatSize,
      formatDate,
      coverageLabel,
      stepLabel(index) {
        return tr(['ui.phase6.step.file', 'ui.phase6.step.mapping', 'ui.phase6.step.preview', 'ui.phase6.step.result'][index - 1]);
      },
      matchFieldLabel(field) {
        return tr(MATCH_FIELD_KEYS[field]);
      },
      explain(error) {
        return text(error) || '';
      },
      selectTab(tab) {
        this.tab = tab;
      },
      onFile(event) {
        this.file = fileOf(event);
        this.message = '';
        this.errors = {};
      },
      toggleMatchField(field) {
        const current = this.options.matchFields.slice();
        const index = current.indexOf(field);
        if (index === -1) current.push(field);
        else if (current.length > 1) current.splice(index, 1);
        this.options.matchFields = current;
      },
      matchFieldOn(field) {
        return this.options.matchFields.indexOf(field) !== -1;
      },
      setOption(key, value) {
        this.options = Object.assign({}, this.options, { [key]: value });
      },
      setMapping(column, field) {
        this.mapping = Object.assign({}, this.mapping, { [column]: field });
      },
      analysisOptions() {
        const options = Object.assign({}, this.options);
        if (!options.delimiter) delete options.delimiter;
        if (!options.encoding) delete options.encoding;
        if (!options.category) delete options.category;
        if (this.profileId) options.profileId = this.profileId;
        return optionsWithMapping(options, this.mapping);
      },
      async runAnalysis() {
        if (!this.canEdit) {
          this.message = tr('ui.phase6.error.edit_permission');
          return false;
        }
        if (!this.file) {
          this.message = tr('ui.phase6.error.file_required');
          return false;
        }
        this.busy = true;
        this.message = '';
        const result = await this.app.analyzeImport(this.file, this.analysisOptions());
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || tr('ui.phase6.error.analyze');
          return false;
        }
        this.step = 2;
        this.message = tr('ui.phase6.notice.analyzed');
        return true;
      },
      async reanalyzeWithMapping() {
        const ok = await this.runAnalysis();
        if (ok) this.step = 3;
        return ok;
      },
      async resolve(row, action) {
        const entry = this.resolving[row.index] || {};
        const extra = {};
        if (action === 'update') {
          const assetId = text(entry.assetId) || text(row.assetId);
          if (!assetId) {
            this.errors = Object.assign({}, this.errors, { [row.index]: tr('ui.phase6.error.asset_id_required') });
            return false;
          }
          if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) {
            this.errors = Object.assign({}, this.errors, { [row.index]: tr('ui.phase6.error.asset_id_uuid') });
            return false;
          }
          extra.assetId = assetId;
        }
        this.errors = Object.assign({}, this.errors, { [row.index]: '' });
        const result = await this.app.resolvePhase6Row(row.index, action, extra);
        if (!result || !result.ok) {
          this.errors = Object.assign({}, this.errors, { [row.index]: (result && result.error) || tr('ui.phase6.error.resolve') });
          return false;
        }
        return true;
      },
      setResolution(index, assetId) {
        this.resolving = Object.assign({}, this.resolving, { [index]: { assetId } });
      },
      async approve() {
        const result = await this.app.approvePhase6Operation();
        this.message = result && result.ok
          ? tr('ui.phase6.notice.approved')
          : (result && result.error) || '';
        return !!(result && result.ok);
      },
      async execute() {
        this.busy = true;
        const result = await this.app.executePhase6Operation();
        this.busy = false;
        this.step = 4;
        this.message = result && result.ok ? '' : (result && result.error) || tr('ui.phase6.error.execute');
        return !!(result && result.ok);
      },
      async enqueue() {
        this.busy = true;
        const result = await this.app.enqueuePhase6Operation();
        this.busy = false;
        if (result && result.ok) {
          this.step = 4;
          this.app.startPhase6Polling();
          this.message = tr('ui.phase6.notice.enqueued');
        } else {
          this.message = (result && result.error) || tr('ui.phase6.error.enqueue');
        }
        return !!(result && result.ok);
      },
      async refresh() {
        const ok = await this.app.refreshPhase6Operation();
        if (!ok) this.message = tr('ui.phase6.error.refresh');
        return ok;
      },
      startNew() {
        this.step = 1;
        this.file = null;
        this.mapping = {};
        this.resolving = {};
        this.busy = false;
        this.message = '';
        this.errors = {};
        this.app.clearPhase6State();
        if (this.app.loadImportProfiles) this.app.loadImportProfiles();
      },
      async saveProfile() {
        const name = text(this.profileName);
        if (!name) {
          this.message = tr('ui.phase6.error.profile_name');
          return false;
        }
        const result = await this.app.saveImportProfile(name, this.analysisOptions());
        this.message = result && result.ok ? tr('ui.phase6.notice.profile_saved') : (result && result.error) || '';
        if (result && result.ok) this.profileName = '';
        return !!(result && result.ok);
      },
      async removeProfile(profile) {
        const result = await this.app.deleteImportProfile(profile.id);
        this.message = result && result.ok ? tr('ui.phase6.notice.profile_deleted') : (result && result.error) || '';
        return !!(result && result.ok);
      },
      useProfile() {
        const profile = this.profiles.find((item) => item.id === this.profileId);
        if (!profile) return;
        const stored = profile.options || {};
        this.options = Object.assign({}, this.options, {
          delimiter: typeof stored.delimiter === 'string' ? stored.delimiter : '',
          encoding: typeof stored.encoding === 'string' ? stored.encoding : '',
          headerRow: Number(stored.headerRow) || 1,
          siteFromSheet: stored.siteFromSheet === true,
          overwriteEmpty: stored.overwriteEmpty === true,
          category: typeof stored.category === 'string' ? stored.category : '',
          matchFields: Array.isArray(stored.matchFields) && stored.matchFields.length ? stored.matchFields.slice() : this.options.matchFields
        });
        this.mapping = Object.assign({}, stored.mapping && typeof stored.mapping === 'object' ? stored.mapping : {});
      },
      toggleExportField(field) {
        const current = this.exportFields.slice();
        const index = current.indexOf(field);
        if (index === -1) current.push(field);
        else if (current.length > 1) current.splice(index, 1);
        this.exportFields = current;
      },
      exportFieldOn(field) {
        return this.exportFields.indexOf(field) !== -1;
      },
      exportFieldLabel(field) {
        return tr(EXPORT_FIELD_KEYS[field] || '') || field;
      },
      exportFiltersBody() {
        const filters = {};
        Object.keys(this.exportFilters).forEach((key) => {
          const value = text(this.exportFilters[key]);
          if (!value) return;
          filters[key] = key === 'archived' ? value === 'true' : value;
        });
        return filters;
      },
      async runExport() {
        const input = { fields: this.exportFields.slice() };
        if (this.exportSelection === 'selection') {
          if (!this.selectionIds.length) {
            this.message = tr('ui.phase6.error.no_selection');
            return false;
          }
          input.assetIds = this.selectionIds;
        } else {
          input.filters = this.exportFiltersBody();
          if (!Object.keys(input.filters).length) {
            this.message = tr('ui.phase6.error.export_filter');
            return false;
          }
        }
        this.busy = true;
        const result = await this.app.exportPhase6Assets(input);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || tr('ui.phase6.error.export');
          return false;
        }
        if (!saveBlob(result.blob, result.filename)) {
          this.message = tr('ui.phase6.error.download');
          return false;
        }
        this.message = tr('ui.phase6.notice.exported');
        return true;
      }
    },
    template: `
      <section class="phase6-page">
        <header class="page-head">
          <div>
            <p class="eyebrow">{{ $t('ui.phase6.transfer.eyebrow') }}</p>
            <h1>{{ $t('ui.phase6.transfer.title') }}</h1>
            <p>{{ $t('ui.phase6.transfer.lead') }}</p>
          </div>
          <div class="page-head__actions">
            <div class="chip-filter" role="tablist" :aria-label="$t('ui.phase6.transfer.tabs_aria')">
              <button type="button" role="tab" class="chip" :class="{ 'is-active': tab === 'import' }" :aria-selected="tab === 'import'" @click="selectTab('import')">{{ $t('ui.phase6.transfer.tab_import') }}</button>
              <button type="button" role="tab" class="chip" :class="{ 'is-active': tab === 'export' }" :aria-selected="tab === 'export'" @click="selectTab('export')">{{ $t('ui.phase6.transfer.tab_export') }}</button>
            </div>
          </div>
        </header>

        <div v-if="message" class="config-note" role="status">{{ message }}</div>

        <div v-if="tab === 'import'" class="tx-main">
          <ol class="flow-steps flow-steps--four">
            <li v-for="index in stepCount" :key="index" class="flow-step" :class="{ 'is-active': step === index }">
              <span class="flow-step__num">{{ index }}</span>
              <span class="flow-step__copy">{{ stepLabel(index) }}</span>
            </li>
          </ol>

          <section v-if="step === 1" class="tx-block" aria-labelledby="phase6-file-title">
            <header class="tx-block__head">
              <h2 id="phase6-file-title">{{ $t('ui.phase6.file.title') }}</h2>
              <span class="chip chip--muted">{{ $t('ui.phase6.file.limits') }}</span>
            </header>
            <div class="field">
              <label class="field__label" for="phase6-file">{{ $t('ui.phase6.file.label') }}</label>
              <input id="phase6-file" class="input-shell" type="file" accept=".csv,.xlsx" @change="onFile">
            </div>
            <div class="phase6-grid">
              <div class="field">
                <label class="field__label" for="phase6-profile">{{ $t('ui.phase6.profile.label') }}</label>
                <select id="phase6-profile" class="input-shell" v-model="profileId">
                  <option value="">{{ $t('ui.phase6.profile.none') }}</option>
                  <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                </select>
                <button type="button" class="btn btn--ghost btn--small" @click="useProfile">{{ $t('ui.phase6.profile.apply') }}</button>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-delimiter">{{ $t('ui.phase6.csv.delimiter') }}</label>
                <select id="phase6-delimiter" class="input-shell" :value="options.delimiter" @change="setOption('delimiter', $event.target.value)">
                  <option value="">{{ $t('ui.phase6.csv.detect') }}</option>
                  <option value=",">{{ $t('ui.phase6.csv.comma') }}</option>
                  <option value=";">{{ $t('ui.phase6.csv.semicolon') }}</option>
                  <option value="\t">{{ $t('ui.phase6.csv.tab') }}</option>
                  <option value="|">{{ $t('ui.phase6.csv.pipe') }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-encoding">{{ $t('ui.phase6.csv.encoding') }}</label>
                <select id="phase6-encoding" class="input-shell" :value="options.encoding" @change="setOption('encoding', $event.target.value)">
                  <option value="">{{ $t('ui.phase6.csv.detect') }}</option>
                  <option value="utf-8">{{ $t('ui.phase6.csv.utf8') }}</option>
                  <option value="utf-8-sig">{{ $t('ui.phase6.csv.utf8_bom') }}</option>
                  <option value="cp1252">{{ $t('ui.phase6.csv.cp1252') }}</option>
                  <option value="latin-1">{{ $t('ui.phase6.csv.latin1') }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-header">{{ $t('ui.phase6.csv.header_row') }}</label>
                <input id="phase6-header" class="input-shell" type="number" min="1" max="100" :value="options.headerRow" @input="setOption('headerRow', Number($event.target.value) || 1)">
              </div>
              <div class="field">
                <label class="field__label" for="phase6-category">{{ $t('ui.phase6.file.category') }}</label>
                <input id="phase6-category" class="input-shell" :value="options.category" @input="setOption('category', $event.target.value)">
              </div>
            </div>
            <label class="bulk-field__toggle">
              <input type="checkbox" :checked="options.siteFromSheet" @change="setOption('siteFromSheet', $event.target.checked)">
              <span>{{ $t('ui.phase6.option.site_from_sheet') }}</span>
            </label>
            <label class="bulk-field__toggle">
              <input type="checkbox" :checked="options.overwriteEmpty" @change="setOption('overwriteEmpty', $event.target.checked)">
              <span>{{ $t('ui.phase6.option.overwrite_empty') }}</span>
            </label>
            <div class="tx-chips" role="group" :aria-label="$t('ui.phase6.match.aria')">
              <button v-for="field in ['quick_code','serial','ip']" :key="field" type="button" class="tx-chip" :class="{ 'is-active': matchFieldOn(field) }" :aria-pressed="matchFieldOn(field)" @click="toggleMatchField(field)">
                {{ matchFieldLabel(field) }}
              </button>
            </div>
            <div class="tx-foot">
              <p class="tx-foot__note">{{ $t('ui.phase6.file.note') }}</p>
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--primary" :disabled="busy || !file || !canEdit" @click="runAnalysis">
                  <app-icon name="upload"></app-icon> {{ $t('ui.phase6.action.analyze') }}
                </button>
              </div>
            </div>
          </section>

          <section v-if="step === 2" class="tx-block" aria-labelledby="phase6-mapping-title">
            <header class="tx-block__head">
              <h2 id="phase6-mapping-title">{{ $t('ui.phase6.mapping.title') }}</h2>
              <span class="chip chip--muted">{{ $t('ui.phase6.mapping.count', { count: columns.length }, columns.length) }}</span>
            </header>
            <p v-if="!columns.length" class="config-note">{{ $t('ui.phase6.mapping.empty') }}</p>
            <div v-for="column in columns" :key="column" class="tx-map__row">
              <span class="tx-label mono">{{ column }}</span>
              <select class="input-shell" :value="mapping[column] || ''" @change="setMapping(column, $event.target.value)">
                <option value="">{{ $t('ui.phase6.mapping.skip') }}</option>
                <option v-for="field in fieldChoices" :key="field.id" :value="field.id">{{ field.label }}</option>
              </select>
            </div>
            <div class="tx-foot">
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--ghost" @click="step = 1">{{ $t('ui.phase6.action.back') }}</button>
                <button type="button" class="btn btn--primary" :disabled="busy" @click="reanalyzeWithMapping">{{ $t('ui.phase6.action.reanalyze') }}</button>
              </div>
            </div>
          </section>

          <section v-if="step >= 3" class="tx-block" aria-labelledby="phase6-preview-title">
            <header class="tx-block__head">
              <h2 id="phase6-preview-title">{{ $t('ui.phase6.preview.title') }}</h2>
              <span class="chip" :class="'status status--' + (state === 'complete' ? 'ok' : state === 'error' ? 'down' : 'hold')">{{ stateLabel(state) }}</span>
            </header>
            <div class="tx-kpis">
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.new') }}</span><span class="tx-kpi__value">{{ counts.new }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.safe') }}</span><span class="tx-kpi__value">{{ counts.safe }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.possible_duplicate') }}</span><span class="tx-kpi__value">{{ counts.possible_duplicate }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.classification.error') }}</span><span class="tx-kpi__value">{{ counts.error }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.processed') }}</span><span class="tx-kpi__value">{{ operation.processed }} / {{ operation.total }}</span></div>
            </div>
            <p v-if="operation.jobId" class="config-note mono">{{ $t('ui.phase6.preview.job', { id: operation.jobId }) }}</p>
            <p v-if="operation.error" class="field__error" role="alert">{{ operation.error }}</p>

            <div v-if="conflicts.length" class="tx-conflicts" aria-labelledby="phase6-conflicts-title">
              <h3 id="phase6-conflicts-title">{{ $t('ui.phase6.conflicts.title') }}</h3>
              <article v-for="row in conflicts" :key="row.index" class="tx-conflict">
                <header class="tx-conflict__head">
                  <span class="status" :class="'status--' + classTone(row.classification)">{{ classLabel(row.classification) }}</span>
                  <span class="mono">{{ $t('ui.phase6.conflicts.line', { sheet: row.sheet, line: row.line }) }}</span>
                </header>
                <p class="tx-conflict__reason">{{ row.errors.length ? row.errors.join(' · ') : $t('ui.phase6.conflicts.ambiguous') }}</p>
                <div class="tx-conflict__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="resolve(row, 'skip')">{{ $t('ui.phase6.action.skip') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="resolve(row, 'create')">{{ $t('ui.phase6.action.create') }}</button>
                  <label class="tx-label">
                    {{ $t('ui.phase6.conflicts.asset_id') }}
                    <input class="input-shell" :value="(resolving[row.index] || {}).assetId || row.assetId || ''" @input="setResolution(row.index, $event.target.value)">
                  </label>
                  <button type="button" class="btn btn--secondary btn--small" @click="resolve(row, 'update')">{{ $t('ui.phase6.action.update') }}</button>
                </div>
                <p v-if="errors[row.index]" class="field__error" role="alert">{{ errors[row.index] }}</p>
              </article>
            </div>

            <div class="phase6-table" role="table" :aria-label="$t('ui.phase6.table.aria')">
              <div class="phase6-row phase6-row--head" role="row">
                <span role="columnheader">{{ $t('ui.phase6.col.classification') }}</span>
                <span role="columnheader">{{ $t('ui.phase6.col.sheet_line') }}</span>
                <span role="columnheader">{{ $t('ui.phase6.col.values') }}</span>
                <span role="columnheader">{{ $t('ui.phase6.col.result') }}</span>
              </div>
              <div v-for="row in rows" :key="row.index" class="phase6-row" role="row">
                <span role="cell"><span class="status" :class="'status--' + classTone(row.classification)">{{ classLabel(row.classification) }}</span></span>
                <span role="cell" class="mono">{{ row.sheet }} · {{ row.line }}</span>
                <span role="cell" class="mono truncate">{{ Object.keys(row.values).map(key => key + ': ' + row.values[key]).join(' · ') }}</span>
                <span role="cell">{{ row.result || row.action || '—' }}<span v-if="row.error" class="cell-note">{{ row.error }}</span></span>
              </div>
            </div>

            <div class="tx-foot">
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--ghost" @click="step = 2">{{ $t('ui.phase6.action.mapping') }}</button>
                <button type="button" class="btn btn--ghost" @click="refresh">{{ $t('ui.phase6.action.refresh') }}</button>
                <button type="button" class="btn btn--primary" :disabled="!canApprove || busy" @click="approve">{{ $t('ui.phase6.action.approve') }}</button>
                <button type="button" class="btn btn--primary" :disabled="!canExecute || busy" @click="execute">{{ $t('ui.phase6.action.execute') }}</button>
                <button type="button" class="btn btn--secondary" :disabled="!canExecute || busy" @click="enqueue">{{ $t('ui.phase6.action.enqueue') }}</button>
              </div>
            </div>
          </section>

          <section v-if="step === 4" class="tx-block tx-block--result" aria-labelledby="phase6-result-title">
            <header class="tx-block__head">
              <h2 id="phase6-result-title">{{ $t('ui.phase6.result.title') }}</h2>
              <span class="chip" :class="'status status--' + (operation.state === 'complete' ? 'ok' : 'down')">{{ stateLabel(operation.state) }}</span>
            </header>
            <div class="tx-kpis tx-kpis--result">
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.created') }}</span><span class="tx-kpi__value">{{ summary.created }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.modified') }}</span><span class="tx-kpi__value">{{ summary.modified }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.omitted') }}</span><span class="tx-kpi__value">{{ summary.omitted }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.phase6.kpi.failed') }}</span><span class="tx-kpi__value">{{ summary.failed }}</span></div>
            </div>
            <p class="tx-foot__note">{{ $t('ui.phase6.result.note') }}</p>
            <div class="tx-foot__actions">
              <button type="button" class="btn btn--ghost" @click="refresh">{{ $t('ui.phase6.action.refresh_state') }}</button>
              <button type="button" class="btn btn--primary" @click="startNew">{{ $t('ui.phase6.action.new_import') }}</button>
            </div>
          </section>

          <section class="tx-block" aria-labelledby="phase6-profiles-title">
            <header class="tx-block__head">
              <h2 id="phase6-profiles-title">{{ $t('ui.phase6.profiles.title') }}</h2>
              <span class="chip chip--muted">{{ $t('ui.phase6.profiles.count', { count: profiles.length }, profiles.length) }}</span>
            </header>
            <ul class="phase6-list">
              <li v-for="profile in profiles" :key="profile.id" class="phase6-list__item">
                <span>{{ profile.name }}</span>
                <span class="mono cell-note">{{ Object.keys(profile.options || {}).join(', ') || $t('ui.phase6.profiles.no_options') }}</span>
                <span class="phase6-list__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="profileId = profile.id; useProfile()">{{ $t('ui.phase6.profiles.use') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" :disabled="!canEdit" @click="removeProfile(profile)">{{ $t('ui.common.delete') }}</button>
                </span>
              </li>
            </ul>
            <div class="phase6-grid">
              <label class="field">
                <span class="field__label">{{ $t('ui.phase6.profiles.save_lead') }}</span>
                <input class="input-shell" v-model="profileName" :placeholder="$t('ui.phase6.profiles.name_placeholder')">
              </label>
              <button type="button" class="btn btn--secondary" :disabled="!canEdit || !profileName.trim()" @click="saveProfile">{{ $t('ui.phase6.profiles.save') }}</button>
            </div>
          </section>
        </div>

        <div v-if="tab === 'export'" class="tx-main">
          <section class="tx-block" aria-labelledby="phase6-export-title">
            <header class="tx-block__head">
              <h2 id="phase6-export-title">{{ $t('ui.phase6.export.title') }}</h2>
              <span class="chip chip--muted">{{ $t('ui.phase6.export.chip') }}</span>
            </header>
            <div class="tx-filterbar">
              <label class="tx-label">
                {{ $t('ui.phase6.export.source') }}
                <select class="input-shell" v-model="exportSelection">
                  <option value="filters">{{ $t('ui.phase6.export.filters') }}</option>
                  <option value="selection">{{ $t('ui.phase6.export.selection', { count: selectionIds.length }) }}</option>
                </select>
              </label>
            </div>
            <div v-if="exportSelection === 'filters'" class="phase6-grid">
              <label class="field"><span class="field__label">{{ $t('ui.labels.field.category') }}</span><input class="input-shell" v-model="exportFilters.category"></label>
              <label class="field"><span class="field__label">{{ $t('ui.labels.field.status') }}</span>
                <select class="input-shell" v-model="exportFilters.status">
                  <option value="">{{ $t('ui.phase6.export.all_statuses') }}</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="field"><span class="field__label">{{ $t('ui.phase6.export.site_id') }}</span><input class="input-shell" v-model="exportFilters.site_id"></label>
              <label class="field"><span class="field__label">{{ $t('ui.phase6.export.location_id') }}</span><input class="input-shell" v-model="exportFilters.location_id"></label>
              <label class="field"><span class="field__label">{{ $t('ui.labels.filter.archived') }}</span>
                <select class="input-shell" v-model="exportFilters.archived">
                  <option value="">{{ $t('ui.phase6.export.archived_any') }}</option>
                  <option value="false">{{ $t('ui.phase6.export.archived_active') }}</option>
                  <option value="true">{{ $t('ui.phase6.export.archived_only') }}</option>
                </select>
              </label>
            </div>
            <fieldset class="phase6-fieldset">
              <legend>{{ $t('ui.phase6.export.fields_legend') }}</legend>
              <label v-for="field in app.phase6ExportFields" :key="field" class="bulk-field__toggle">
                <input type="checkbox" :checked="exportFieldOn(field)" @change="toggleExportField(field)">
                <span>{{ exportFieldLabel(field) }}</span>
              </label>
            </fieldset>
            <div class="tx-foot">
              <p class="tx-foot__note">{{ $t('ui.phase6.export.note') }}</p>
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--primary" :disabled="busy || !app.phase6CanView" @click="runExport">{{ $t('ui.phase6.export.download') }}</button>
              </div>
            </div>
          </section>
        </div>
      </section>
    `
  };
  /* Bulk editor over the fixed preview: the server selects the assets, checks
   * category rules and Casbin permissions, and stores one approval that the
   * browser cannot invent. */
  Views.Phase6BulkEditor = {
    name: 'Phase6BulkEditor',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      ids: { type: Array, default() { return []; } },
      app: { type: Object, required: true }
    },
    emits: ['close', 'applied'],
    data() {
      return {
        step: 1,
        action: 'update',
        changes: { status: '', category: '', site_id: '', location_id: '', responsible_person_id: '', name: '', description: '' },
        filters: { category: '', status: '', site_id: '', location_id: '', responsible_person_id: '', archived: '' },
        reason: '',
        busy: false,
        message: '',
        errors: {}
      };
    },
    computed: {
      operation() {
        return this.app.phase6 ? this.app.phase6.operation : null;
      },
      rows() {
        return this.app.phase6OperationRows || [];
      },
      summary() {
        return this.app.phase6OperationSummary || { created: 0, modified: 0, omitted: 0, failed: 0 };
      },
      conflicts() {
        return this.app.phase6ConflictRows || [];
      },
      state() {
        return this.operation ? this.operation.state : '';
      },
      approved() {
        return !!(this.operation && this.operation.approved);
      },
      useSelection() {
        return Array.isArray(this.ids) && this.ids.length > 0;
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      actions() {
        return BULK_ACTIONS;
      },
      statusChoices() {
        return (this.app.inventoryStatusChoices || []).map((status) => ({ value: status.value, label: status.label }));
      },
      canApprove() {
        return this.canEdit && this.state === 'preview' && !this.conflicts.length && !!this.rows.length;
      },
      canExecute() {
        return this.canEdit && this.approved && (this.state === 'approved' || this.state === 'queued' || this.state === 'preview');
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        this.step = 1;
        this.busy = false;
        this.message = '';
        this.errors = {};
        this.reason = '';
        this.changes = { status: '', category: '', site_id: '', location_id: '', responsible_person_id: '', name: '', description: '' };
        this.filters = { category: '', status: '', site_id: '', location_id: '', responsible_person_id: '', archived: '' };
        this.action = 'update';
      }
    },
    methods: {
      classLabel,
      classTone,
      stateLabel,
      categoryLabel,
      setChange(key, value) {
        this.changes = Object.assign({}, this.changes, { [key]: value });
      },
      setFilter(key, value) {
        this.filters = Object.assign({}, this.filters, { [key]: value });
      },
      changesBody() {
        const body = {};
        const keys = ['status', 'category', 'site_id', 'location_id', 'responsible_person_id', 'name', 'description'];
        keys.forEach((key) => {
          const value = text(this.changes[key]);
          if (value) body[key] = value;
        });
        return body;
      },
      filtersBody() {
        const body = {};
        Object.keys(this.filters).forEach((key) => {
          const value = text(this.filters[key]);
          if (!value) return;
          body[key] = key === 'archived' ? value === 'true' : value;
        });
        return body;
      },
      async preview() {
        if (!this.canEdit) {
          this.message = tr('ui.phase6.error.edit_permission');
          return false;
        }
        const input = { action: this.action, changes: this.changesBody(), filters: this.filtersBody() };
        if (this.useSelection) input.assetIds = this.ids.slice();
        if (this.reason) input.reason = this.reason;
        if (!this.useSelection && !Object.keys(input.filters).length) {
          this.message = tr('ui.phase6.error.bulk_filter');
          return false;
        }
        if (this.action === 'archive' && text(this.reason).length < 4) {
          this.message = tr('ui.phase6.error.archive_reason');
          return false;
        }
        this.busy = true;
        this.message = '';
        const result = await this.app.bulkPreviewPhase6(input);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || tr('ui.phase6.error.preview');
          return false;
        }
        this.step = 2;
        return true;
      },
      async resolve(row) {
        const result = await this.app.resolvePhase6Row(row.index, 'skip', {});
        if (!result || !result.ok) {
          this.message = (result && result.error) || tr('ui.phase6.error.skip_row');
          return false;
        }
        return true;
      },
      async approve() {
        const result = await this.app.approvePhase6Operation();
        this.message = result && result.ok ? tr('ui.phase6.notice.preview_approved') : (result && result.error) || '';
        if (result && result.ok) this.step = 3;
        return !!(result && result.ok);
      },
      async execute() {
        this.busy = true;
        const result = await this.app.executePhase6Operation();
        this.busy = false;
        this.step = 4;
        if (result && result.ok) {
          this.message = '';
          this.$emit('applied');
        } else {
          this.message = (result && result.error) || tr('ui.phase6.error.execute');
        }
        return !!(result && result.ok);
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.phase6.bulk.title')" :eyebrow="$t('ui.phase6.bulk.eyebrow')" @close="close">
        <div class="bulk-body">
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <ol class="flow-steps flow-steps--four">
            <li class="flow-step" :class="{ 'is-active': step === 1 }"><span class="flow-step__num">1</span><span class="flow-step__copy">{{ $t('ui.phase6.bulk.step.assets') }}</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 2 }"><span class="flow-step__num">2</span><span class="flow-step__copy">{{ $t('ui.phase6.bulk.step.preview') }}</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 3 }"><span class="flow-step__num">3</span><span class="flow-step__copy">{{ $t('ui.phase6.bulk.step.approval') }}</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 4 }"><span class="flow-step__num">4</span><span class="flow-step__copy">{{ $t('ui.phase6.bulk.step.result') }}</span></li>
          </ol>

          <template v-if="step === 1">
            <p class="bulk-lead">{{ useSelection ? $t('ui.phase6.bulk.lead_selection', { count: ids.length }) : $t('ui.phase6.bulk.lead_filters') }}</p>
            <div v-if="!useSelection" class="bulk-fields">
              <label class="field"><span class="field__label">{{ $t('ui.labels.field.category') }}</span><input class="input-shell" :value="filters.category" @input="setFilter('category', $event.target.value)"></label>
              <label class="field"><span class="field__label">{{ $t('ui.labels.field.status') }}</span>
                <select class="input-shell" :value="filters.status" @change="setFilter('status', $event.target.value)">
                  <option value="">{{ $t('ui.labels.filter.all_masculine') }}</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="field"><span class="field__label">{{ $t('ui.phase6.export.site_id') }}</span><input class="input-shell" :value="filters.site_id" @input="setFilter('site_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">{{ $t('ui.phase6.export.location_id') }}</span><input class="input-shell" :value="filters.location_id" @input="setFilter('location_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">{{ $t('ui.phase6.bulk.responsible_id') }}</span><input class="input-shell" :value="filters.responsible_person_id" @input="setFilter('responsible_person_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">{{ $t('ui.labels.filter.archived') }}</span>
                <select class="input-shell" :value="filters.archived" @change="setFilter('archived', $event.target.value)">
                  <option value="">{{ $t('ui.phase6.export.archived_any') }}</option>
                  <option value="false">{{ $t('ui.phase6.export.archived_active') }}</option>
                  <option value="true">{{ $t('ui.phase6.export.archived_only') }}</option>
                </select>
              </label>
            </div>
            <div class="field">
              <label class="field__label" for="bulk-action">{{ $t('ui.phase6.bulk.action') }}</label>
              <select id="bulk-action" class="input-shell" v-model="action">
                <option v-for="item in actions" :key="item.id" :value="item.id">{{ item.label }}</option>
              </select>
            </div>
            <div class="bulk-fields">
              <label v-if="action === 'update'" class="field"><span class="field__label">{{ $t('ui.labels.field.status') }}</span>
                <select class="input-shell" :value="changes.status" @change="setChange('status', $event.target.value)">
                  <option value="">{{ $t('ui.phase6.bulk.no_change') }}</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label v-if="action === 'update'" class="field"><span class="field__label">{{ $t('ui.labels.field.category') }}</span><input class="input-shell" :value="changes.category" @input="setChange('category', $event.target.value)"></label>
              <label v-if="action === 'assign' || action === 'update'" class="field"><span class="field__label">{{ $t('ui.phase6.bulk.responsible_id') }}</span><input class="input-shell" :value="changes.responsible_person_id" @input="setChange('responsible_person_id', $event.target.value)"></label>
              <label v-if="action === 'transfer' || action === 'update'" class="field"><span class="field__label">{{ $t('ui.phase6.export.location_id') }}</span><input class="input-shell" :value="changes.location_id" @input="setChange('location_id', $event.target.value)"></label>
            </div>
            <label v-if="action === 'archive'" class="field">
              <span class="field__label">{{ $t('ui.phase6.bulk.reason') }}</span>
              <textarea class="input-shell" :value="reason" @input="reason = $event.target.value"></textarea>
            </label>
            <p class="bulk-warning">{{ $t('ui.phase6.bulk.warning_fields') }}</p>
          </template>

          <template v-if="step === 2">
            <p class="bulk-lead">{{ $t('ui.phase6.bulk.preview_count', { rows: rows.length, conflicts: conflicts.length }) }}</p>
            <div class="bulk-preview">
              <div v-for="row in rows" :key="row.index" class="bulk-preview__row">
                <span class="bulk-preview__asset mono">{{ row.assetId || '—' }}</span>
                <span class="status" :class="'status--' + (classTone(row.classification))">{{ classLabel(row.classification) }}</span>
                <span class="mono truncate">{{ Object.keys(row.values || {}).map(key => key + ': ' + row.values[key]).join(' · ') }}</span>
                <span v-if="row.error" class="cell-note">{{ row.error }}</span>
                <button v-if="row.classification === 'error'" type="button" class="btn btn--ghost btn--small" @click="resolve(row)">{{ $t('ui.phase6.action.skip') }}</button>
              </div>
            </div>
            <p class="bulk-warning">{{ $t('ui.phase6.bulk.warning_approval') }}</p>
          </template>

          <template v-if="step === 3">
            <p class="bulk-lead">{{ $t('ui.phase6.bulk.state', { state: stateLabel(state) }) }}<span v-if="operation && operation.jobId"> · {{ $t('ui.phase6.bulk.job', { id: operation.jobId }) }}</span></p>
            <div class="bulk-summary">
              <div class="bulk-summary__value"><span class="bulk-summary__label">{{ $t('ui.phase6.kpi.processed') }}</span><strong>{{ operation ? operation.processed : 0 }} / {{ operation ? operation.total : 0 }}</strong></div>
            </div>
          </template>

          <template v-if="step === 4">
            <div class="bulk-summary">
              <div class="bulk-summary__value"><span class="bulk-summary__label">{{ $t('ui.phase6.kpi.modified') }}</span><strong>{{ summary.modified }}</strong></div>
              <div class="bulk-summary__value"><span class="bulk-summary__label">{{ $t('ui.phase6.kpi.omitted') }}</span><strong>{{ summary.omitted }}</strong></div>
              <div class="bulk-summary__value"><span class="bulk-summary__label">{{ $t('ui.phase6.kpi.failed') }}</span><strong>{{ summary.failed }}</strong></div>
            </div>
            <p class="bulk-warning">{{ $t('ui.phase6.bulk.warning_failed') }}</p>
          </template>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="close">{{ $t('ui.common.close') }}</button>
          <button v-if="step === 1" type="button" class="btn btn--primary" :disabled="busy || !canEdit" @click="preview">{{ $t('ui.phase6.bulk.preview') }}</button>
          <button v-if="step === 2" type="button" class="btn btn--secondary" :disabled="!canApprove || busy" @click="approve">{{ $t('ui.phase6.bulk.approve') }}</button>
          <button v-if="step === 3" type="button" class="btn btn--primary" :disabled="!canExecute || busy" @click="execute">{{ $t('ui.phase6.bulk.execute') }}</button>
        </template>
      </modal-shell>
    `
  };

  /* Warranty center over the real API: current, expiring, expired and unknown
   * coverage, with the individual warranty of each asset. */
  Views.Phase6WarrantyCenter = {
    name: 'Phase6WarrantyCenter',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        coverage: '',
        editor: { open: false, assetId: '', supplier: '', purchaseDate: '', durationMonths: '', expiresOn: '', status: 'active', receiptId: '', notes: '' },
        busy: false,
        message: '',
        errors: {},
        confirmDelete: false
      };
    },
    computed: {
      state() {
        return this.app.phase6.warranties;
      },
      items() {
        return this.app.phase6WarrantyItems || [];
      },
      coverages() {
        return this.app.phase6WarrantyCoverages || [];
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      receipts() {
        const list = this.app.phase6.attachments;
        if (!list || list.assetId !== this.editor.assetId) return [];
        return list.items.filter((item) => item.category === 'receipt');
      }
    },
    created() {
      this.reload();
    },
    methods: {
      categoryLabel,
      statusLabel,
      coverageLabel,
      coverageTone,
      formatDate,
      formatSize,
      assetLabel(id) {
        const asset = (this.app.inventoryItems || []).find((item) => item.id === id);
        if (asset) return (asset.code || asset.id) + ' · ' + asset.name;
        if (this.app.currentAsset && this.app.currentAsset.id === id) {
          return (this.app.currentAsset.code || id) + ' · ' + this.app.currentAsset.name;
        }
        return id;
      },
      setCoverage(value) {
        this.coverage = value;
        this.reload();
      },
      async reload() {
        const ok = await this.app.loadWarranties({ coverage: this.coverage, offset: 0, limit: 50 });
        if (!ok) this.message = this.state.error;
        return ok;
      },
      async loadMore() {
        return this.app.loadWarranties({ coverage: this.coverage, offset: this.state.items.length, limit: 50 });
      },
      openEditor(item) {
        this.errors = {};
        this.message = '';
        this.confirmDelete = false;
        this.editor = {
          open: true,
          assetId: item.assetId,
          supplier: item.supplier || '',
          purchaseDate: item.purchaseDate || '',
          durationMonths: item.durationMonths === null || item.durationMonths === undefined ? '' : String(item.durationMonths),
          expiresOn: item.expiresOn || '',
          status: item.status || 'active',
          receiptId: item.receiptId || '',
          notes: item.notes || ''
        };
        this.app.loadAssetAttachments(item.assetId);
      },
      closeEditor() {
        this.editor.open = false;
        this.confirmDelete = false;
        this.errors = {};
      },
      save() {
        const editor = this.editor;
        const values = {
          supplier: text(editor.supplier),
          purchaseDate: text(editor.purchaseDate),
          status: text(editor.status) || 'active',
          receiptId: text(editor.receiptId),
          notes: text(editor.notes),
          durationMonths: editor.durationMonths === '' ? '' : Number(editor.durationMonths),
          expiresOn: text(editor.expiresOn)
        };
        if (values.durationMonths === '' ) delete values.durationMonths;
        this.busy = true;
        return this.app.saveAssetWarranty(editor.assetId, values).then((result) => {
          this.busy = false;
          if (!result || !result.ok) {
            this.errors = (result && result.fieldErrors) || {};
            this.message = (result && result.error) || tr('ui.phase6.warranty.error_save');
            return false;
          }
          this.editor.open = false;
          this.message = tr('ui.phase6.warranty.saved');
          this.reload();
          return true;
        });
      },
      remove() {
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          return false;
        }
        this.busy = true;
        return this.app.deleteAssetWarranty(this.editor.assetId).then((result) => {
          this.busy = false;
          if (!result || !result.ok) {
            this.message = (result && result.error) || tr('ui.phase6.warranty.error_delete');
            return false;
          }
          this.confirmDelete = false;
          this.editor.open = false;
          this.message = tr('ui.phase6.warranty.deleted');
          this.reload();
          return true;
        });
      }
    },
    template: `
      <section class="phase6-page warranties-page">
        <header class="page-head">
          <div>
            <p class="eyebrow">{{ $t('ui.phase6.warranty.eyebrow') }}</p>
            <h1>{{ $t('ui.phase6.warranty.title') }}</h1>
            <p>{{ $t('ui.phase6.warranty.lead') }}</p>
          </div>
        </header>
        <div class="chip-filter" role="group" :aria-label="$t('ui.phase6.warranty.coverage_aria')">
          <button v-for="value in coverages" :key="value" type="button" class="chip" :class="{ 'is-active': coverage === value }" :aria-pressed="coverage === value" @click="setCoverage(value)">{{ coverageLabel(value) }}</button>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="state.loading" class="config-note" role="status">{{ $t('ui.phase6.warranty.loading') }}</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!items.length" class="config-note">{{ $t('ui.phase6.warranty.empty') }}</p>
        <template v-else>
          <div class="phase6-table" role="table" :aria-label="$t('ui.phase6.warranty.table_aria')">
            <div class="phase6-row phase6-row--head" role="row">
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_asset') }}</span>
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_supplier') }}</span>
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_dates') }}</span>
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_coverage') }}</span>
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_status') }}</span>
              <span role="columnheader">{{ $t('ui.phase6.warranty.col_actions') }}</span>
            </div>
            <div v-for="item in items" :key="item.assetId" class="phase6-row" role="row">
              <span role="cell" class="truncate">{{ assetLabel(item.assetId) }}</span>
              <span role="cell">{{ item.supplier || '—' }}</span>
              <span role="cell" class="mono">{{ formatDate(item.purchaseDate) || '—' }} → {{ formatDate(item.expiresOn) || '—' }}</span>
              <span role="cell"><span class="status" :class="'status--' + coverageTone(item.coverage)">{{ coverageLabel(item.coverage) }}</span></span>
              <span role="cell">{{ statusLabel(item.status) }}</span>
              <span role="cell"><button type="button" class="btn btn--ghost btn--small" @click="openEditor(item)">{{ canEdit ? $t('ui.phase6.warranty.edit') : $t('ui.phase6.warranty.view') }}</button></span>
            </div>
          </div>
          <button v-if="state.hasMore" type="button" class="btn btn--secondary btn--small" @click="loadMore">{{ $t('ui.phase6.warranty.load_more') }}</button>
        </template>

        <modal-shell :open="editor.open" :title="$t('ui.phase6.warranty.modal_title')" :eyebrow="$t('ui.phase6.warranty.modal_eyebrow')" @close="closeEditor">
          <div class="phase6-grid">
            <p class="mono phase6-span">{{ editor.assetId }}</p>
            <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.provider') }}</span><input class="input-shell" v-model="editor.supplier" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.purchase_date') }}</span><input class="input-shell" type="date" v-model="editor.purchaseDate" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.duration_months') }}</span><input class="input-shell" type="number" min="1" max="1200" v-model="editor.durationMonths" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.expires') }}</span><input class="input-shell" type="date" v-model="editor.expiresOn" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">{{ $t('ui.labels.field.status') }}</span>
              <select class="input-shell" v-model="editor.status" :disabled="!canEdit">
                <option v-for="status in ['active','cancelled','claimed','unknown']" :key="status" :value="status">{{ statusLabel(status) }}</option>
              </select>
            </label>
            <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.receipt') }}</span>
              <select class="input-shell" v-model="editor.receiptId" :disabled="!canEdit">
                <option value="">{{ $t('ui.phase6.warranty.receipt_none') }}</option>
                <option v-for="file in receipts" :key="file.id" :value="file.id">{{ file.filename }} · {{ formatSize(file.size) }}</option>
              </select>
            </label>
            <label class="field phase6-span"><span class="field__label">{{ $t('ui.phase6.warranty.notes') }}</span><textarea class="input-shell" v-model="editor.notes" :disabled="!canEdit"></textarea></label>
          </div>
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeEditor">{{ $t('ui.common.close') }}</button>
            <button v-if="canEdit" type="button" class="btn btn--ghost" :disabled="busy" @click="remove">{{ confirmDelete ? $t('ui.phase6.warranty.confirm_delete') : $t('ui.phase6.warranty.delete') }}</button>
            <button v-if="canEdit" type="button" class="btn btn--primary" :disabled="busy" @click="save">{{ $t('ui.common.save') }}</button>
          </template>
        </modal-shell>
      </section>
    `
  };

  /* Expiring-soon threshold from Configuración; the server stores it. */
  Views.Phase6WarrantySettings = {
    name: 'Phase6WarrantySettings',
    props: { app: { type: Object, required: true } },
    data() {
      return { days: 30, busy: false, message: '', error: '' };
    },
    computed: {
      state() {
        return this.app.phase6.warrantyPrefs;
      },
      canEdit() {
        return !!(this.app.authenticated && this.app.can('config.general'));
      }
    },
    created() {
      this.load();
    },
    methods: {
      async load() {
        await this.app.loadWarrantyPreferences();
        this.days = this.app.phase6.warrantyPrefs.expiringDays;
        this.error = this.app.phase6.warrantyPrefs.error;
        return !this.error;
      },
      async save() {
        this.busy = true;
        const result = await this.app.saveWarrantyPreferences(this.days);
        this.busy = false;
        this.message = result && result.ok ? tr('ui.phase6.settings.saved') : '';
        this.error = result && !result.ok ? (result.error || '') : '';
        return !!(result && result.ok);
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-warranty-settings-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">{{ $t('ui.phase6.warranty.eyebrow') }}</p>
            <h2 id="phase6-warranty-settings-title">{{ $t('ui.phase6.settings.title') }}</h2>
          </div>
        </header>
        <p class="config-note">{{ $t('ui.phase6.settings.lead') }}</p>
        <div class="phase6-grid">
          <label class="field">
            <span class="field__label">{{ $t('ui.phase6.settings.days') }}</span>
            <input class="input-shell" type="number" min="1" max="365" v-model.number="days" :disabled="!canEdit">
          </label>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="error" class="field__error" role="alert">{{ error }}</p>
        <button type="button" class="btn btn--primary" :disabled="!canEdit || busy" @click="save">{{ $t('ui.phase6.settings.save') }}</button>
      </section>
    `
  };

  /* Individual warranty of the asset in the server detail view. */
  Views.Phase6AssetWarranty = {
    name: 'Phase6AssetWarranty',
    props: { asset: { type: Object, default: null }, app: { type: Object, required: true } },
    data() {
      return {
        editing: false,
        busy: false,
        message: '',
        errors: {},
        form: { supplier: '', purchaseDate: '', durationMonths: '', expiresOn: '', status: 'active', receiptId: '', notes: '' }
      };
    },
    computed: {
      state() {
        return this.app.phase6.warranty;
      },
      item() {
        return this.state.assetId === (this.asset && this.asset.id) ? this.state.item : null;
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      receipts() {
        const list = this.app.phase6.attachments;
        if (!list || list.assetId !== (this.asset && this.asset.id)) return [];
        return list.items.filter((entry) => entry.category === 'receipt');
      }
    },
    watch: {
      'asset.id': {
        immediate: true,
        handler() {
          this.reload();
        }
      }
    },
    methods: {
      statusLabel,
      coverageLabel,
      coverageTone,
      formatDate,
      formatSize,
      async reload() {
        if (!this.asset || !this.asset.id || !this.app.phase6CanView) return false;
        this.editing = false;
        this.errors = {};
        const ok = await this.app.loadAssetWarranty(this.asset.id);
        if (this.app.phase6CanEdit) this.app.loadAssetAttachments(this.asset.id);
        return ok;
      },
      startEdit() {
        const item = this.item || {};
        this.form = {
          supplier: item.supplier || '',
          purchaseDate: item.purchaseDate || '',
          durationMonths: item.durationMonths === null || item.durationMonths === undefined ? '' : String(item.durationMonths),
          expiresOn: item.expiresOn || '',
          status: item.status || 'active',
          receiptId: item.receiptId || '',
          notes: item.notes || ''
        };
        this.editing = true;
        this.message = '';
      },
      cancel() {
        this.editing = false;
        this.errors = {};
      },
      async save() {
        const values = {
          supplier: text(this.form.supplier),
          purchaseDate: text(this.form.purchaseDate),
          status: text(this.form.status) || 'active',
          receiptId: text(this.form.receiptId),
          notes: text(this.form.notes),
          expiresOn: text(this.form.expiresOn)
        };
        if (this.form.durationMonths !== '') values.durationMonths = Number(this.form.durationMonths);
        this.busy = true;
        const result = await this.app.saveAssetWarranty(this.asset.id, values);
        this.busy = false;
        if (!result || !result.ok) {
          this.errors = (result && result.fieldErrors) || {};
          this.message = (result && result.error) || tr('ui.phase6.warranty.error_save');
          return false;
        }
        this.editing = false;
        this.message = tr('ui.phase6.warranty.saved');
        return true;
      },
      async remove() {
        this.busy = true;
        const result = await this.app.deleteAssetWarranty(this.asset.id);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || tr('ui.phase6.warranty.error_delete');
          return false;
        }
        this.message = tr('ui.phase6.warranty.deleted');
        return true;
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-asset-warranty-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">{{ $t('ui.phase6.warranty.eyebrow_single') }}</p>
            <h2 id="phase6-asset-warranty-title">{{ $t('ui.phase6.warranty.modal_eyebrow') }}</h2>
          </div>
          <span v-if="item" class="status" :class="'status--' + coverageTone(item.coverage)">{{ coverageLabel(item.coverage) }}</span>
          <button v-if="canEdit && !editing" type="button" class="btn btn--ghost btn--small" @click="startEdit">{{ item ? $t('ui.phase6.warranty.edit_button') : $t('ui.phase6.warranty.register') }}</button>
        </header>
        <p v-if="state.loading" class="config-note" role="status">{{ $t('ui.phase6.warranty.loading_single') }}</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!item && !editing" class="config-note">{{ $t('ui.phase6.warranty.empty_single') }}</p>
        <dl v-else-if="item && !editing" class="phase6-details">
          <div><dt>{{ $t('ui.phase6.warranty.provider') }}</dt><dd>{{ item.supplier || $t('ui.phase6.warranty.no_provider') }}</dd></div>
          <div><dt>{{ $t('ui.phase6.warranty.purchase_date') }}</dt><dd class="mono">{{ formatDate(item.purchaseDate) || $t('ui.phase6.warranty.no_date') }}</dd></div>
          <div><dt>{{ $t('ui.phase6.warranty.duration') }}</dt><dd>{{ item.durationMonths ? $t('ui.phase6.warranty.months', { count: item.durationMonths }) : $t('ui.phase6.warranty.no_duration') }}</dd></div>
          <div><dt>{{ $t('ui.phase6.warranty.expires') }}</dt><dd class="mono">{{ formatDate(item.expiresOn) || $t('ui.phase6.warranty.no_expiry') }}</dd></div>
          <div><dt>{{ $t('ui.phase6.warranty.status') }}</dt><dd>{{ statusLabel(item.status) }}</dd></div>
          <div><dt>{{ $t('ui.phase6.warranty.receipt') }}</dt><dd>{{ item.receiptId ? $t('ui.phase6.warranty.receipt_linked') : $t('ui.phase6.warranty.receipt_none') }}</dd></div>
          <div class="phase6-span"><dt>{{ $t('ui.phase6.warranty.notes') }}</dt><dd>{{ item.notes || $t('ui.phase6.warranty.no_notes') }}</dd></div>
        </dl>
        <div v-if="editing" class="phase6-grid">
          <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.provider') }}</span><input class="input-shell" v-model="form.supplier"></label>
          <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.purchase_date') }}</span><input class="input-shell" type="date" v-model="form.purchaseDate"></label>
          <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.duration_months') }}</span><input class="input-shell" type="number" min="1" max="1200" v-model="form.durationMonths"></label>
          <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.expires') }}</span><input class="input-shell" type="date" v-model="form.expiresOn"></label>
          <label class="field"><span class="field__label">{{ $t('ui.labels.field.status') }}</span>
            <select class="input-shell" v-model="form.status">
              <option v-for="status in ['active','cancelled','claimed','unknown']" :key="status" :value="status">{{ statusLabel(status) }}</option>
            </select>
          </label>
          <label class="field"><span class="field__label">{{ $t('ui.phase6.warranty.receipt') }}</span>
            <select class="input-shell" v-model="form.receiptId">
              <option value="">{{ $t('ui.phase6.warranty.receipt_none') }}</option>
              <option v-for="file in receipts" :key="file.id" :value="file.id">{{ file.filename }} · {{ formatSize(file.size) }}</option>
            </select>
          </label>
          <label class="field phase6-span"><span class="field__label">{{ $t('ui.phase6.warranty.notes') }}</span><textarea class="input-shell" v-model="form.notes"></textarea></label>
          <p v-if="message" class="config-note phase6-span" role="status">{{ message }}</p>
          <div class="phase6-actions phase6-span">
            <button type="button" class="btn btn--ghost btn--small" @click="cancel">{{ $t('ui.common.cancel') }}</button>
            <button v-if="item" type="button" class="btn btn--ghost btn--small" @click="remove">{{ $t('ui.common.delete') }}</button>
            <button type="button" class="btn btn--primary btn--small" :disabled="busy" @click="save">{{ $t('ui.phase6.warranty.save') }}</button>
          </div>
        </div>
      </section>
    `
  };

  /* Attachments of the asset: metadata and bytes both come from the server. */
  Views.Phase6Attachments = {
    name: 'Phase6Attachments',
    props: { asset: { type: Object, default: null }, app: { type: Object, required: true } },
    data() {
      return { category: 'document', busy: false, message: '', confirmId: '' };
    },
    computed: {
      state() {
        return this.app.phase6.attachments;
      },
      items() {
        return this.state.assetId === (this.asset && this.asset.id) ? this.app.phase6AttachmentItems : [];
      },
      canEdit() {
        return !!(this.app.phase6CanEdit);
      },
      categories() {
        return this.app.phase6AttachmentCategories || [];
      }
    },
    watch: {
      'asset.id': {
        immediate: true,
        handler() {
          this.reload();
        }
      }
    },
    methods: {
      categoryLabel,
      formatSize,
      formatDate,
      async reload() {
        if (!this.asset || !this.asset.id || !this.app.phase6CanView) return false;
        this.confirmId = '';
        return this.app.loadAssetAttachments(this.asset.id, { offset: 0, limit: 50 });
      },
      async upload(event) {
        const file = fileOf(event);
        if (!file) return false;
        this.busy = true;
        const result = await this.app.uploadAssetAttachment(this.asset.id, file, this.category);
        this.busy = false;
        if (result && result.ok) {
          this.message = tr('ui.phase6.attachments.uploaded');
        } else if (result && !result.cancelled) {
          this.message = result.error || tr('ui.phase6.attachments.error_upload');
        }
        if (event.target) event.target.value = '';
        return !!(result && result.ok);
      },
      async download(item) {
        const result = await this.app.downloadAssetAttachment(item);
        if (result && result.ok) {
          saveBlob(result.blob, result.filename);
          this.message = tr('ui.phase6.attachments.download_ready');
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || tr('ui.phase6.attachments.error_download');
        return false;
      },
      async remove(item) {
        if (this.confirmId !== item.id) {
          this.confirmId = item.id;
          return false;
        }
        this.busy = true;
        const result = await this.app.deleteAssetAttachment(item.id);
        this.busy = false;
        this.confirmId = '';
        if (result && result.ok) {
          this.message = tr('ui.phase6.attachments.deleted');
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || tr('ui.phase6.attachments.error_delete');
        return false;
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-attachments-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">{{ $t('ui.phase6.attachments.eyebrow') }}</p>
            <h2 id="phase6-attachments-title">{{ $t('ui.phase6.attachments.title') }}</h2>
          </div>
          <span class="mono info-panel__meta">{{ $t('ui.phase6.attachments.count', { count: items.length }) }}</span>
        </header>
        <div v-if="canEdit" class="phase6-grid phase6-grid--upload">
          <label class="field">
            <span class="field__label">{{ $t('ui.phase6.attachments.category') }}</span>
            <select class="input-shell" v-model="category">
              <option v-for="value in categories" :key="value" :value="value">{{ categoryLabel(value) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.phase6.attachments.file') }}</span>
            <input class="input-shell" type="file" :disabled="busy" @change="upload">
          </label>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="state.loading" class="config-note" role="status">{{ $t('ui.phase6.attachments.loading') }}</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!items.length" class="config-note">{{ $t('ui.phase6.attachments.empty') }}</p>
        <ul v-else class="phase6-list">
          <li v-for="item in items" :key="item.id" class="phase6-list__item">
            <span class="truncate">{{ item.filename }}</span>
            <span class="chip chip--muted">{{ categoryLabel(item.category) }}</span>
            <span class="mono cell-note">{{ formatSize(item.size) }} · {{ formatDate(item.createdAt) }}</span>
            <span class="phase6-list__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="download(item)">{{ $t('ui.phase6.attachments.download') }}</button>
              <button v-if="canEdit" type="button" class="btn btn--ghost btn--small" :disabled="busy" @click="remove(item)">{{ confirmId === item.id ? $t('ui.phase6.attachments.confirm') : $t('ui.common.delete') }}</button>
            </span>
          </li>
        </ul>
      </section>
    `
  };
})();
