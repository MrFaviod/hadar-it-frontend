/* Vistas del módulo de importación y exportación. */
(function () {
  'use strict';

  const Data = window.AssetTransferData;
  const Engine = window.AssetTransferEngine;

  // Display copy comes from the ui.transfer.* catalog; ids and field keys stay
  // stable. Templates use $t and the imperative code (toasts, previews,
  // computed labels) resolves through this thin wrapper.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const STEP_LIST = [
    { index: 1, id: 'archivo', get label() { return tr('ui.transfer.step.file'); }, get hint() { return tr('ui.transfer.step.file_hint'); } },
    { index: 2, id: 'columnas', get label() { return tr('ui.transfer.step.mapping'); }, get hint() { return tr('ui.transfer.step.mapping_hint'); } },
    { index: 3, id: 'vista', get label() { return tr('ui.transfer.step.preview'); }, get hint() { return tr('ui.transfer.step.preview_hint'); } },
    { index: 4, id: 'conflictos', get label() { return tr('ui.transfer.step.conflicts'); }, get hint() { return tr('ui.transfer.step.conflicts_hint'); } },
    { index: 5, id: 'resumen', get label() { return tr('ui.transfer.step.summary'); }, get hint() { return tr('ui.transfer.step.summary_hint'); } }
  ];

  const ACTION_LABELS = {
    get update() { return tr('ui.transfer.action.update'); },
    get create() { return tr('ui.transfer.action.create'); },
    get skip() { return tr('ui.transfer.action.skip'); },
    get review() { return tr('ui.transfer.action.review'); }
  };

  const ACTION_ICONS = {
    update: 'pencil',
    create: 'plus',
    skip: 'minus',
    review: 'history'
  };

  const FILTERS = [
    { id: 'all', get label() { return tr('ui.transfer.filter.all'); } },
    { id: 'new', get label() { return tr('ui.transfer.filter.new'); } },
    { id: 'update', get label() { return tr('ui.transfer.filter.update'); } },
    { id: 'conflict', get label() { return tr('ui.transfer.filter.conflict'); } },
    { id: 'exception', get label() { return tr('ui.transfer.filter.exception'); } }
  ];

  window.AssetTransferViews = window.AssetTransferViews || {};

  /* Diálogo de perfiles --------------------------------------------------- */

  window.AssetTransferViews.TransferProfileDialog = {
    name: 'TransferProfileDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      kind: { type: String, default: 'import' }
    },
    emits: ['close', 'apply', 'save'],
    data() {
      return { name: '', revision: 0 };
    },
    computed: {
      profiles() {
        void this.revision;
        return Data.profiles(this.kind);
      },
      title() {
        return this.kind === 'import' ? tr('ui.transfer.profile_dialog.title_import') : tr('ui.transfer.profile_dialog.title_export');
      },
      help() {
        return this.kind === 'import'
          ? tr('ui.transfer.profile_dialog.help_import')
          : tr('ui.transfer.profile_dialog.help_export');
      }
    },
    methods: {
      meta(profile) {
        if (this.kind === 'import') {
          const mapping = profile.mapping || {};
          const mapped = Object.keys(mapping).filter((key) => mapping[key]).length;
          const ident = (profile.identification || []).map((key) => {
            const field = Data.IDENTIFICATION_FIELDS.find((item) => item.key === key);
            return field ? field.label.toLocaleLowerCase() : key;
          });
          return tr('ui.transfer.profile_dialog.meta_import', {
            count: mapped,
            identification: ident.length ? ident.join(', ') : tr('ui.transfer.profile_dialog.no_identification')
          });
        }
        const format = profile.format === 'xlsx' ? 'Excel' : 'CSV';
        return tr('ui.transfer.profile_dialog.meta_export', { count: (profile.fields || []).length, format });
      },
      save() {
        const value = this.name.trim();
        if (!value) return;
        this.$emit('save', value);
        this.name = '';
      },
      remove(profile) {
        if (profile.builtin) return;
        Data.deleteProfile(profile.id);
        this.revision += 1;
      }
    },
    template: `
      <modal-shell :open="open" :eyebrow="$t('ui.transfer.profile_dialog.eyebrow')" :title="title" size="wide" @close="$emit('close')">
        <div class="tx-profiles">
          <p class="form-intro">{{ help }}</p>

          <div class="tx-profile-save">
            <div class="field">
              <label :for="'tx-profile-name-' + kind">{{ $t('ui.transfer.profile_dialog.save_current') }}</label>
              <div class="input-shell">
                <input :id="'tx-profile-name-' + kind" v-model="name" type="text" autocomplete="off" :placeholder="$t('ui.transfer.profile_dialog.name_placeholder')">
              </div>
            </div>
            <button type="button" class="btn btn--primary btn--small" data-od-id="transfer-profile-save" :disabled="!name.trim()" @click="save">{{ $t('ui.transfer.profile_dialog.save') }}</button>
          </div>

          <ul class="tx-profile-list">
            <li v-for="profile in profiles" :key="profile.id" class="tx-profile">
              <div class="tx-profile__body">
                <div class="tx-profile__title">
                  <strong>{{ profile.name }}</strong>
                  <span class="tx-tag" :class="{ 'tx-tag--builtin': profile.builtin }">{{ profile.builtin ? $t('ui.transfer.profile_default') : $t('ui.transfer.profile_custom') }}</span>
                </div>
                <p>{{ profile.description }}</p>
                <p class="tx-profile__meta mono">{{ meta(profile) }}</p>
              </div>
              <div class="tx-profile__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="$emit('apply', profile)">{{ $t('ui.transfer.profile_dialog.apply') }}</button>
                <button v-if="!profile.builtin" type="button" class="icon-button" :aria-label="$t('ui.transfer.profile_dialog.remove_aria', { name: profile.name })" @click="remove(profile)">
                  <app-icon name="trash"></app-icon>
                </button>
              </div>
            </li>
          </ul>
        </div>
      </modal-shell>
    `
  };

  /* Asistente de importación ---------------------------------------------- */

  window.AssetTransferViews.TransferImport = {
    name: 'TransferImport',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell, TransferProfileDialog: window.AssetTransferViews.TransferProfileDialog },
    props: { app: { type: Object, required: true } },
    data() {
      const prefs = Data.getPrefs();
      return {
        prefs,
        step: 1,
        fileId: '',
        sheets: {},
        mapping: {},
        sheetSite: {},
        sheetCategory: {},
        identification: ['serial', 'ip', 'name'],
        rules: { flagIncomplete: true },
        profileId: '',
        decisions: {},
        applied: null,
        historyTick: 0,
        applying: false,
        progress: 0,
        progressLabel: '',
        filter: 'all',
        page: 0,
        expanded: '',
        expandedUpdate: '',
        compareTarget: {},
        confirmOpen: false,
        profilesOpen: false
      };
    },
    created() {
      const preferred = Data.profileById(this.prefs.defaultImportProfile);
      const file = (preferred && Data.FILES.find((item) => item.id === preferred.fileId))
        || Data.FILES[0];
      if (file) this.selectFile(file.id);
    },
    computed: {
      files() {
        return Data.FILES;
      },
      file() {
        return Data.FILES.find((item) => item.id === this.fileId) || null;
      },
      canEdit() {
        return typeof this.app.can === 'function' ? this.app.can('assets.edit') : false;
      },
      targets() {
        return Data.TARGETS;
      },
      targetGroups() {
        return Data.TARGETS.reduce((result, target) => {
          if (result.indexOf(target.group) === -1) result.push(target.group);
          return result;
        }, []);
      },
      identificationFields() {
        return Data.IDENTIFICATION_FIELDS;
      },
      activeProfile() {
        return this.profileId ? Data.profileById(this.profileId) : null;
      },
      profileOptions() {
        return Data.profiles('import');
      },
      selectedSheets() {
        if (!this.file) return [];
        return this.file.sheets.filter((sheet) => this.sheets[sheet.id]);
      },
      selectedRowCount() {
        return this.selectedSheets.reduce((total, sheet) => total + sheet.rows.length, 0);
      },
      analysis() {
        return Engine.analyze(this.app, {
          fileId: this.fileId,
          sheets: this.sheets,
          mapping: this.mapping,
          sheetSite: this.sheetSite,
          sheetCategory: this.sheetCategory,
          identification: this.identification,
          rules: this.rules
        });
      },
      rows() {
        return this.analysis.rows;
      },
      rowCounts() {
        return Engine.counts(this.rows, this.decisions);
      },
      conflicts() {
        return this.rows.filter((row) => row.state === 'conflict');
      },
      updates() {
        return this.rows.filter((row) => row.state === 'update');
      },
      exceptions() {
        return this.rows.filter((row) => ['duplicate', 'retired', 'incomplete', 'error', 'unchanged'].indexOf(row.state) !== -1);
      },
      updateRows() {
        return this.rows.filter((row) => Engine.decisionFor(row, this.decisions).action === 'update');
      },
      createRows() {
        return this.rows.filter((row) => Engine.decisionFor(row, this.decisions).action === 'create');
      },
      history() {
        return this.historyTick >= 0 ? Data.history().slice(0, 3) : [];
      },
      steps() {
        return STEP_LIST.map((step) => Object.assign({}, step, {
          badge: step.index === 3 ? this.rows.length : step.index === 4 ? (this.conflicts.length + this.exceptions.length) : 0
        }));
      },
      stepEyebrow() {
        return ['', tr('ui.transfer.step.eyebrow_1'), tr('ui.transfer.step.eyebrow_2'), tr('ui.transfer.step.eyebrow_3'), tr('ui.transfer.step.eyebrow_4'), tr('ui.transfer.step.eyebrow_5')][this.step];
      },
      stepTitle() {
        if (this.step === 5) return this.applied ? tr('ui.transfer.step.title_done') : tr('ui.transfer.step.title_review');
        return ['', tr('ui.transfer.step.title_1'), tr('ui.transfer.step.title_2'), tr('ui.transfer.step.title_3'), tr('ui.transfer.step.title_4')][this.step];
      },
      stepLead() {
        if (this.step === 1) return tr('ui.transfer.step.lead_1');
        if (this.step === 2) return tr('ui.transfer.step.lead_2');
        if (this.step === 3) return tr('ui.transfer.step.lead_3');
        if (this.step === 4) return tr('ui.transfer.step.lead_4');
        return this.applied
          ? tr('ui.transfer.step.lead_done')
          : tr('ui.transfer.step.lead_review');
      },
      footNote() {
        if (this.step === 1) {
          // Sin archivo no hay hojas que elegir: el paso pendiente es el archivo.
          if (!this.file) return tr('ui.transfer.foot.choose_file');
          return this.selectedRowCount ? tr('ui.transfer.steps_selected_rows', { count: this.selectedRowCount }) : tr('ui.transfer.foot.select_sheet');
        }
        if (this.step === 2) return tr('ui.transfer.foot.empty_kept');
        if (this.step === 3) return tr('ui.transfer.foot.analysed', { count: this.rows.length, pending: this.rowCounts.pending });
        if (this.step === 4) return tr('ui.transfer.foot.updates');
        return this.applied ? tr('ui.transfer.foot.applied') : tr('ui.transfer.foot.not_applied');
      },
      filters() {
        return FILTERS.map((filter) => Object.assign({}, filter, { count: this.filterCount(filter.id) }));
      },
      filteredRows() {
        if (this.filter === 'all') return this.rows;
        if (this.filter === 'exception') {
          return this.rows.filter((row) => ['duplicate', 'retired', 'incomplete', 'error', 'unchanged'].indexOf(row.state) !== -1);
        }
        return this.rows.filter((row) => row.state === this.filter);
      },
      pagedRows() {
        const start = this.page * 8;
        return this.filteredRows.slice(start, start + 8);
      },
      totalPages() {
        return Math.max(1, Math.ceil(this.filteredRows.length / 8));
      },
      ranking() {
        return this.filteredRows.length
          ? tr('ui.transfer.ranking', { from: this.page * 8 + 1, to: Math.min(this.filteredRows.length, this.page * 8 + 8), total: this.filteredRows.length })
          : tr('ui.transfer.ranking_empty');
      },
      canContinue() {
        if (this.step === 1) return this.selectedSheets.length > 0;
        if (this.step === 2) return this.selectedSheets.every((sheet) => (this.mapping[sheet.id] || []).some((key) => key === 'name'));
        if (this.step === 4) return this.conflicts.every((row) => !!Engine.decisionFor(row, this.decisions).action);
        return true;
      },
      identificationLabels() {
        return this.identification.map((key) => {
          const field = Data.IDENTIFICATION_FIELDS.find((item) => item.key === key);
          return field ? field.label : key;
        });
      }
    },
    watch: {
      filter() {
        this.page = 0;
      },
      step() {
        this.expanded = '';
      }
    },
    methods: {
      sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
      },
      siteLabel(id) {
        return id ? this.app.siteLabel(id) : '';
      },
      categoryLabel(id) {
        return id ? this.app.categoryLabel(id) : '';
      },
      rowTotal(file) {
        return file.sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
      },
      selectFile(fileId) {
        const file = Data.FILES.find((item) => item.id === fileId);
        if (!file) return;
        const profile = Data.IMPORT_PROFILES.find((item) => item.fileId === fileId) || null;
        const sheets = {};
        const mapping = {};
        const sheetSite = {};
        const sheetCategory = {};
        file.sheets.forEach((sheet) => {
          sheets[sheet.id] = true;
          mapping[sheet.id] = Data.detectMapping(sheet.columns, profile ? profile.mapping : null);
          const preset = profile && profile.sheetSites ? profile.sheetSites[Data.norm(sheet.name)] : '';
          sheetSite[sheet.id] = preset || sheet.siteId || Data.siteIdFromText(sheet.name) || '';
          sheetCategory[sheet.id] = Data.categoryIdFromSheet(sheet.name) || '';
        });
        this.fileId = fileId;
        this.sheets = sheets;
        this.mapping = mapping;
        this.sheetSite = sheetSite;
        this.sheetCategory = sheetCategory;
        this.profileId = profile ? profile.id : '';
        this.identification = profile && Array.isArray(profile.identification)
          ? profile.identification.slice()
          : ['serial', 'ip', 'name'];
        this.decisions = {};
        this.applied = null;
        this.filter = 'all';
        this.page = 0;
        this.expanded = '';
        this.expandedUpdate = '';
        this.compareTarget = {};
      },
      autoMapping() {
        const profile = this.activeProfile;
        const mapping = {};
        this.selectedSheets.forEach((sheet) => {
          mapping[sheet.id] = Data.detectMapping(sheet.columns, profile ? profile.mapping : null);
        });
        this.mapping = Object.assign({}, this.mapping, mapping);
        this.app.showToast(tr('ui.transfer.mapping.detected'));
      },
      setMapping(sheetId, index, value) {
        const next = (this.mapping[sheetId] || []).slice();
        next[index] = value;
        this.mapping = Object.assign({}, this.mapping, { [sheetId]: next });
        this.decisions = {};
      },
      mappedLabel(sheet, index) {
        const key = (this.mapping[sheet.id] || [])[index];
        const target = key ? Data.TARGETS.find((item) => item.key === key) : null;
        return target ? target.group : tr('ui.transfer.mapping.ignored');
      },
      detectState(sheet, index) {
        const mapping = this.mapping[sheet.id] || [];
        const key = mapping[index];
        if (!key) return 'ignored';
        if (mapping.filter((item) => item === key).length > 1) return 'duplicate';
        return Data.detectTarget(sheet.columns[index]) === key ? 'auto' : 'manual';
      },
      detectLabel(sheet, index) {
        const state = this.detectState(sheet, index);
        if (state === 'ignored') return tr('ui.transfer.detect.unassigned');
        if (state === 'duplicate') return tr('ui.transfer.detect.duplicate');
        if (state === 'auto') return tr('ui.transfer.detect.auto');
        return tr('ui.transfer.detect.manual');
      },
      sample(sheet, index) {
        const row = sheet.rows.find((item) => String(item[index] || '').trim() !== '');
        return row ? row[index] : '—';
      },
      previewValue(sheet, index) {
        const value = this.sample(sheet, index);
        if (value === '—') return value;
        const target = (this.mapping[sheet.id] || [])[index];
        if (target === 'warrantyUntil') return Data.formatDate(value) || value;
        if (target === 'cost') {
          const parsed = Data.parseNumber(value);
          return Number.isFinite(parsed) ? Data.formatNumber(parsed) : value;
        }
        return value;
      },
      fieldsLabel(row) {
        return tr('ui.transfer.fields_count', { count: row.changes.length });
      },
      targetsByGroup(group) {
        return Data.TARGETS.filter((target) => target.group === group);
      },
      toggleIdentification(key) {
        const has = this.identification.indexOf(key) !== -1;
        if (has && this.identification.length === 1) {
          this.app.showToast(tr('ui.transfer.identification.required'), 'error');
          return;
        }
        this.identification = has
          ? this.identification.filter((item) => item !== key)
          : this.identification.concat([key]).sort((a, b) => {
            const order = Data.IDENTIFICATION_FIELDS.map((field) => field.key);
            return order.indexOf(a) - order.indexOf(b);
          });
        this.decisions = {};
      },
      setDecision(row, action) {
        const previous = this.decisions[row.key] || {};
        const targetId = previous.targetId || row.primaryCandidateId || '';
        this.decisions = Object.assign({}, this.decisions, {
          [row.key]: { action, targetId: action === 'update' ? (this.compareTarget[row.key] || targetId) : targetId }
        });
      },
      decisionFor(row) {
        return Engine.decisionFor(row, this.decisions);
      },
      decisionLabel(row) {
        const decision = Engine.decisionFor(row, this.decisions);
        return decision.action ? ACTION_LABELS[decision.action] : tr('ui.transfer.decision.undecided');
      },
      actions(row) {
        return Engine.actionsFor(row);
      },
      actionLabel(action) {
        return ACTION_LABELS[action] || action;
      },
      actionIcon(action) {
        return ACTION_ICONS[action] || 'check';
      },
      setCompareTarget(row, id) {
        this.compareTarget = Object.assign({}, this.compareTarget, { [row.key]: id });
        const decision = this.decisions[row.key] || {};
        if (decision.action === 'update') {
          this.decisions = Object.assign({}, this.decisions, { [row.key]: { action: 'update', targetId: id } });
        }
      },
      comparisonFor(row) {
        const target = this.compareTarget[row.key] || row.primaryCandidateId;
        return (row.comparisons && row.comparisons[target]) || row.comparison;
      },
      stateLabel(row) {
        return Engine.STATE_LABELS[row.state] || row.state;
      },
      tone(row) {
        return Engine.STATE_TONES[row.state] || 'hold';
      },
      formatTransferDate(value) {
        return Data.formatDateTime(value);
      },
      fieldLabel(key) {
        const target = Data.TARGET_BY_KEY[key] || Data.EXPORT_FIELDS.find((field) => field.key === key);
        return target ? target.label : key;
      },
      filterCount(id) {
        if (id === 'all') return this.rows.length;
        if (id === 'exception') {
          return this.rows.filter((row) => ['duplicate', 'retired', 'incomplete', 'error', 'unchanged'].indexOf(row.state) !== -1).length;
        }
        return this.rows.filter((row) => row.state === id).length;
      },
      goStep(index) {
        if (index > this.step || index < 1) return;
        this.step = index;
      },
      nextStep() {
        if (!this.canContinue) return;
        this.step = Math.min(5, this.step + 1);
      },
      previousStep() {
        this.step = Math.max(1, this.step - 1);
      },
      bulkSkipUpdates() {
        const next = Object.assign({}, this.decisions);
        this.updates.forEach((row) => {
          next[row.key] = { action: 'skip', targetId: row.primaryCandidateId };
        });
        this.decisions = next;
      },
      resolveAllConflicts() {
        const next = Object.assign({}, this.decisions);
        this.conflicts.forEach((row) => {
          if (!Engine.decisionFor(row, this.decisions).action) {
            next[row.key] = { action: 'update', targetId: row.primaryCandidateId };
          }
        });
        this.decisions = next;
      },
      changedLabels(row) {
        const changes = Engine.changesFor(row, this.decisionFor(row).targetId || row.primaryCandidateId);
        return changes.map((field) => field.label).join(', ') || tr('ui.transfer.compare.no_changes');
      },
      openConfirm() {
        if (!this.canEdit) {
          this.app.showToast(tr('ui.transfer.toast.no_permission'), 'error');
          return;
        }
        if (this.prefs.confirmUpdates === false) {
          this.applyImport();
          return;
        }
        this.confirmOpen = true;
      },
      async applyImport() {
        if (this.applying) return;
        this.confirmOpen = false;
        this.applying = true;
        this.progress = 0;
        this.progressLabel = tr('ui.transfer.progress.preparing');
        const result = Engine.batch();
        const total = this.rows.length;
        for (let index = 0; index < total; index += 1) {
          const row = this.rows[index];
          Engine.applyRow(this.app, row, Engine.decisionFor(row, this.decisions), result);
          this.progress = Math.round(((index + 1) / total) * 100);
          this.progressLabel = tr('ui.transfer.progress.processing', { current: index + 1, total, sheet: row.sheetName, row: row.rowNumber });
          await this.sleep(28);
        }
        const counts = Engine.finish(this.app, result, {
          record: true,
          fileName: this.file.name,
          fileId: this.file.id,
          profile: this.activeProfile ? this.activeProfile.name : tr('ui.transfer.profile.auto'),
          sheets: this.selectedSheets.length
        });
        this.historyTick += 1;
        this.applied = {
          result,
          counts,
          at: new Date().toISOString(),
          fileName: this.file.name,
          profile: this.activeProfile ? this.activeProfile.name : tr('ui.transfer.profile.auto')
        };
        this.applying = false;
        this.progress = 100;
        this.app.showToast(tr('ui.transfer.toast.applied', { created: counts.created, updated: counts.updated }));
      },
      resetImport() {
        this.historyTick += 1;
        this.applied = null;
        this.decisions = {};
        this.step = 1;
        this.progress = 0;
        if (this.file) this.selectFile(this.file.id);
      },
      goInventory() {
        this.app.setHash('#/inventario');
      },
      downloadText(text, filename, bom) {
        try {
          const blob = new Blob([(bom ? '\ufeff' : '') + text], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.setTimeout(() => URL.revokeObjectURL(url), 1200);
          this.app.showToast(tr('ui.transfer.toast.report_downloaded'));
        } catch (error) {
          this.app.showToast(tr('ui.transfer.toast.report_download_failed'), 'error');
        }
      },
      downloadReport() {
        if (!this.applied) return;
        const csv = Engine.reportCsv(this.applied.result, tr('ui.transfer.report.title', { name: this.applied.fileName, when: Data.formatDateTime(this.applied.at) }));
        this.downloadText(csv, 'informe-importacion-' + new Date().toISOString().slice(0, 10) + '.csv', true);
      },
      saveProfile(name) {
        const mapping = {};
        this.selectedSheets.forEach((sheet) => {
          sheet.columns.forEach((column, index) => {
            const target = (this.mapping[sheet.id] || [])[index];
            if (target) mapping[Data.norm(column)] = target;
          });
        });
        const sheetSites = {};
        this.selectedSheets.forEach((sheet) => {
          if (this.sheetSite[sheet.id]) sheetSites[Data.norm(sheet.name)] = this.sheetSite[sheet.id];
        });
        const saved = Data.saveProfile({
          kind: 'import',
          name,
          description: tr('ui.transfer.profile.saved_from', { file: this.file.name }),
          fileId: this.fileId,
          identification: this.identification.slice(),
          mapping,
          sheetSites
        });
        if (!saved) return;
        this.profileId = saved.id;
        this.profilesOpen = false;
        this.app.showToast(tr('ui.transfer.toast.profile_saved', { name: saved.name }));
      },
      applyProfile(profile) {
        if (!profile) return;
        if (profile.fileId && profile.fileId !== this.fileId) this.selectFile(profile.fileId);
        const file = this.file;
        if (!file) return;
        const mapping = {};
        file.sheets.forEach((sheet) => {
          mapping[sheet.id] = Data.detectMapping(sheet.columns, profile.mapping || {});
          if (profile.sheetSites && profile.sheetSites[Data.norm(sheet.name)]) {
            this.sheetSite[sheet.id] = profile.sheetSites[Data.norm(sheet.name)];
          }
        });
        this.mapping = mapping;
        this.profileId = profile.id;
        if (Array.isArray(profile.identification)) this.identification = profile.identification.slice();
        this.decisions = {};
        this.profilesOpen = false;
        this.app.showToast(tr('ui.transfer.toast.profile_applied', { name: profile.name }));
      }
    },
    template: `
      <div class="tx-layout">
        <div class="tx-main">
          <ol class="tx-steps" :aria-label="$t('ui.transfer.steps_aria')">
            <li v-for="item in steps" :key="item.id" class="tx-step"
                :class="{ 'is-active': item.index === step, 'is-done': item.index < step }">
              <button type="button" class="tx-step__btn" :data-od-id="'transfer-step-' + item.index" :disabled="item.index > step"
                      :aria-label="$t('ui.transfer.step_aria', { index: item.index, label: item.label })"
                      :aria-current="item.index === step ? 'step' : null" @click="goStep(item.index)">
                <span class="tx-step__mark">
                  <app-icon v-if="item.index < step" name="check"></app-icon>
                  <template v-else>{{ item.index }}</template>
                </span>
                <span class="tx-step__text">
                  <strong>{{ item.label }}</strong>

                </span>
                <span v-if="item.badge" class="tx-step__badge mono">{{ item.badge }}</span>
              </button>
            </li>
          </ol>

          <section class="tx-panel" :data-od-id="'transfer-step-panel-' + step" aria-labelledby="tx-step-title">
            <header class="tx-panel__head">
              <div>
                <p class="eyebrow"><span class="eyebrow__line"></span> {{ stepEyebrow }}</p>
                <h2 id="tx-step-title">{{ stepTitle }}</h2>

              </div>
              <div class="tx-panel__tools">
                <button v-if="step === 2" type="button" class="btn btn--secondary btn--small" @click="autoMapping">
                  <app-icon name="refresh"></app-icon> {{ $t('ui.transfer.mapping.detect_again') }}
                </button>
                <button v-if="step < 5" type="button" class="btn btn--ghost btn--small" @click="profilesOpen = true">
                  <app-icon name="sliders"></app-icon> {{ $t('ui.transfer.profiles') }}
                </button>
              </div>
            </header>

            <!-- Paso 1 -->
            <div v-if="step === 1" class="tx-source">
              <div class="tx-source__list">
                <p class="tx-label">{{ $t('ui.transfer.source_file') }}</p>
                <button v-for="item in files" :key="item.id" type="button" class="tx-file"
                        :class="{ 'is-active': fileId === item.id }" :aria-pressed="fileId === item.id"
                        @click="selectFile(item.id)">
                  <span class="tx-file__format" :class="'tx-file__format--' + item.format">{{ item.format.toUpperCase() }}</span>
                  <span class="tx-file__body">
                    <strong>{{ item.name }}</strong>
                    <small class="mono">{{ $t('ui.transfer.sheets_count', item.sheets.length) }} · {{ $t('ui.transfer.rows_count', rowTotal(item)) }} · {{ item.size }}</small>
                    <span class="tx-file__origin">{{ item.origin }}</span>
                  </span>
                  <span v-if="fileId === item.id" class="tx-file__check"><app-icon name="check"></app-icon></span>
                </button>
                <p class="tx-hint"><app-icon name="info"></app-icon> {{ $t('ui.transfer.demo_note') }}</p>
              </div>

              <div class="tx-source__sheets">
                <p class="tx-label">{{ $t('ui.transfer.sheets_detected') }}</p>
                <div v-if="!file" class="tx-empty">{{ $t('ui.transfer.choose_file') }}</div>
                <template v-else>
                  <label v-for="sheet in file.sheets" :key="sheet.id" class="tx-sheet" :class="{ 'is-active': sheets[sheet.id] }">
                    <input v-model="sheets[sheet.id]" type="checkbox">
                    <span class="tx-sheet__body">
                      <strong>{{ sheet.name }}</strong>
                      <small class="mono">{{ $t('ui.transfer.rows_count', sheet.rows.length) }} · {{ $t('ui.transfer.columns_count', sheet.columns.length) }}</small>
                      <span v-if="sheets[sheet.id]" class="tx-sheet__tags">
                        <span class="tx-tag"><app-icon name="building"></app-icon> {{ siteLabel(sheetSite[sheet.id] || sheet.siteId) || $t('ui.transfer.site_unassigned') }}</span>
                        <span class="tx-tag"><app-icon name="grid"></app-icon> {{ categoryLabel(sheetCategory[sheet.id]) || $t('ui.transfer.category_per_row') }}</span>
                      </span>
                    </span>
                    <span class="tx-sheet__count mono">{{ sheet.rows.length }}</span>
                  </label>
                  <p class="tx-hint"><app-icon name="check"></app-icon> {{ $t('ui.transfer.sheets_note') }}</p>
                </template>
              </div>
            </div>

            <!-- Paso 2 -->
            <div v-else-if="step === 2" class="tx-mapping">
              <p v-if="!selectedSheets.length" class="tx-empty">{{ $t('ui.transfer.no_sheets') }}</p>
              <article v-for="sheet in selectedSheets" :key="sheet.id" class="tx-sheet-panel">
                <header class="tx-sheet-panel__head">
                  <div>
                    <p class="eyebrow">{{ sheet.name }}</p>
                    <h3>{{ $t('ui.transfer.rows_count', sheet.rows.length) }} · {{ $t('ui.transfer.columns_count', sheet.columns.length) }}</h3>
                  </div>
                  <div class="tx-sheet-panel__defaults">
                    <div class="field">
                      <label :for="'sheet-site-' + sheet.id">{{ $t('ui.transfer.sheet_site') }}</label>
                      <div class="input-shell">
                        <app-icon name="building"></app-icon>
                        <select :id="'sheet-site-' + sheet.id" v-model="sheetSite[sheet.id]">
                          <option value="">{{ $t('ui.transfer.no_site') }}</option>
                          <option v-for="site in app.sites" :key="site.id" :value="site.id">{{ site.label }}</option>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                    <div class="field">
                      <label :for="'sheet-cat-' + sheet.id">{{ $t('ui.transfer.field.category') }}</label>
                      <div class="input-shell">
                        <app-icon name="grid"></app-icon>
                        <select :id="'sheet-cat-' + sheet.id" v-model="sheetCategory[sheet.id]">
                          <option value="">{{ $t('ui.transfer.deduce_per_row') }}</option>
                          <option v-for="category in app.categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                  </div>
                </header>

                <div class="tx-map" role="table" :aria-label="$t('ui.transfer.mapping.aria', { sheet: sheet.name })">
                  <div class="tx-map__head" role="row">
                    <span role="columnheader">{{ $t('ui.transfer.column.file') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.first_value') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.asset_field') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.detection') }}</span>
                  </div>
                  <div v-for="(column, index) in sheet.columns" :key="column" class="tx-map__entry" role="row">
                    <span class="tx-map__column" role="cell">
                      <strong>{{ column }}</strong>
                      <small>{{ mappedLabel(sheet, index) }}</small>
                    </span>
                    <span class="tx-map__sample mono" role="cell" :title="sample(sheet, index)">{{ previewValue(sheet, index) }}</span>
                    <div class="field field--inline" role="cell">
                      <label class="sr-only" :for="'map-' + sheet.id + '-' + index">{{ $t('ui.transfer.column.field_for', { column }) }}</label>
                      <div class="input-shell">
                        <select :id="'map-' + sheet.id + '-' + index" :value="(mapping[sheet.id] || [])[index] || ''"
                                @change="setMapping(sheet.id, index, $event.target.value)">
                          <option value="">{{ $t('ui.transfer.mapping.ignore_column') }}</option>
                          <optgroup v-for="group in targetGroups" :key="group" :label="group">
                            <option v-for="target in targetsByGroup(group)" :key="target.key" :value="target.key">{{ target.label }}</option>
                          </optgroup>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                    <span v-if="detectState(sheet, index) === 'auto'" class="tx-detect tx-detect--auto" role="cell" :title="$t('ui.transfer.detect.auto_title')">
                      <app-icon name="check"></app-icon><span class="sr-only">{{ $t('ui.transfer.detect.auto_title') }}</span>
                    </span>
                    <span v-else class="tx-detect" :class="'tx-detect--' + detectState(sheet, index)" role="cell">{{ detectLabel(sheet, index) }}</span>
                  </div>
                </div>
              </article>

              <section class="tx-ident" data-od-id="transfer-identification" aria-labelledby="tx-ident-title">
                <header>
                  <h3 id="tx-ident-title">{{ $t('ui.transfer.identification.title') }}</h3>
                  <p>{{ $t('ui.transfer.identification.lead') }}</p>
                </header>
                <div class="tx-ident__options">
                  <label v-for="field in identificationFields" :key="field.key" class="check-row">
                    <input type="checkbox" :checked="identification.indexOf(field.key) !== -1" @change="toggleIdentification(field.key)">
                    <span>
                      <strong>{{ field.label }}</strong>
                      <small>{{ field.strength === 'strong' ? $t('ui.transfer.strength.strong') : $t('ui.transfer.strength.weak') }}</small>
                    </span>
                  </label>
                </div>
              </section>

              <div class="tx-rules">
                <div class="tx-rule">
                  <app-icon name="lock"></app-icon>
                  <div><strong>{{ $t('ui.transfer.rule.id_title') }}</strong><span>{{ $t('ui.transfer.rule.id_body') }}</span></div>
                  <span class="tx-tag tx-tag--lock">{{ $t('ui.transfer.rule.fixed') }}</span>
                </div>
                <div class="tx-rule">
                  <app-icon name="check"></app-icon>
                  <div><strong>{{ $t('ui.transfer.rule.empty_title') }}</strong><span>{{ $t('ui.transfer.rule.empty_body') }}</span></div>
                  <span class="tx-tag tx-tag--lock">{{ $t('ui.transfer.rule.fixed') }}</span>
                </div>
                <label class="tx-rule tx-rule--toggle">
                  <span class="switch">
                    <input v-model="rules.flagIncomplete" type="checkbox">
                    <span class="switch__track"><span class="switch__thumb"></span></span>
                  </span>
                  <div><strong>{{ $t('ui.transfer.rule.incomplete_title') }}</strong><span>{{ $t('ui.transfer.rule.incomplete_body') }}</span></div>
                </label>
              </div>
            </div>

            <!-- Paso 3 -->
            <div v-else-if="step === 3" class="tx-preview">
              <div class="tx-kpis">
                <div class="tx-kpi">
                  <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.records') }}</span>
                  <strong class="tx-kpi__value">{{ rows.length }}</strong>
                  <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.sheets_selected', selectedSheets.length) }}</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.to_create') }}</span>
                  <strong class="tx-kpi__value">{{ rowCounts.created }}</strong>
                  <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.to_create_note') }}</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.updates') }}</span>
                  <strong class="tx-kpi__value">{{ rowCounts.updated }}</strong>
                  <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.updates_note') }}</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.conflicts') }}</span>
                  <strong class="tx-kpi__value">{{ conflicts.length }}</strong>
                  <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.conflicts_note') }}</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.exceptions') }}</span>
                  <strong class="tx-kpi__value">{{ exceptions.length }}</strong>
                  <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.exceptions_note') }}</span>
                </div>
              </div>

              <div class="tx-filterbar">
                <div class="tx-chips" role="group" :aria-label="$t('ui.transfer.filter_aria')">
                  <button v-for="option in filters" :key="option.id" type="button" class="chip tx-chip"
                          :class="{ 'is-active': filter === option.id }" :aria-pressed="filter === option.id"
                          @click="filter = option.id">
                    <span>{{ option.label }}</span><span class="chip__count">{{ option.count }}</span>
                  </button>
                </div>
                <span class="tx-filterbar__meta mono">{{ ranking }}</span>
              </div>

              <div class="tx-table-wrap">
                <div class="tx-table" role="table" :aria-label="$t('ui.transfer.preview_table_aria')">
                  <div class="tx-table__head" role="row">
                    <span role="columnheader">{{ $t('ui.transfer.column.row') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.asset') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.category') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.site') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.identification') }}</span>
                    <span role="columnheader">{{ $t('ui.transfer.column.status') }}</span>
                    <span role="columnheader" class="sr-only">{{ $t('ui.transfer.column.detail') }}</span>
                  </div>
                  <div v-for="row in pagedRows" :key="row.key" class="tx-table__row" :class="{ 'is-open': expanded === row.key }" role="row">
                    <span class="tx-table__cell" role="cell">
                      <strong class="mono">{{ row.rowNumber }}</strong>
                      <small>{{ row.sheetName }}</small>
                    </span>
                    <span class="tx-table__cell" role="cell">
                      <strong>{{ row.display.name || $t('ui.transfer.no_name') }}</strong>
                      <small>{{ [row.display.brand, row.display.model].filter(Boolean).join(' ') || row.display.serial || '—' }}</small>
                    </span>
                    <span class="tx-table__cell" role="cell">{{ row.display.category || '—' }}</span>
                    <span class="tx-table__cell" role="cell">{{ row.display.site || $t('ui.transfer.no_site') }}</span>
                    <span class="tx-table__cell" role="cell">
                      <span v-if="row.primaryCandidateId" class="mono">{{ row.primaryCandidateId }}</span>
                      <span v-else class="tx-muted">{{ $t('ui.transfer.new_record') }}</span>
                      <small v-if="row.matchedByName">{{ $t('ui.transfer.matched_by_name') }}</small>
                    </span>
                    <span class="tx-table__cell" role="cell">
                      <span class="tx-state" :class="'tx-state--' + tone(row)"><span class="tx-dot"></span>{{ stateLabel(row) }}</span>
                    </span>
                    <button type="button" class="icon-button tx-table__toggle" :aria-expanded="expanded === row.key"
                            :aria-label="$t('ui.transfer.row_detail_aria', { row: row.rowNumber })"
                            @click="expanded = expanded === row.key ? '' : row.key">
                      <app-icon name="chevron-down"></app-icon>
                    </button>
                    <div v-if="expanded === row.key" class="tx-detail">
                      <dl v-if="Object.keys(row.display).length" class="tx-detail__grid">
                        <div v-for="(value, key) in row.display" :key="key">
                          <dt>{{ fieldLabel(key) }}</dt>
                          <dd>{{ value }}</dd>
                        </div>
                      </dl>
                      <ul v-if="row.errors.length || row.warnings.length" class="tx-issues">
                        <li v-for="issue in row.errors" :key="issue" class="tx-issue tx-issue--error"><app-icon name="alert"></app-icon>{{ issue }}</li>
                        <li v-for="issue in row.warnings" :key="issue" class="tx-issue tx-issue--warn"><app-icon name="info"></app-icon>{{ issue }}</li>
                      </ul>
                      <p v-else class="tx-muted">{{ $t('ui.transfer.no_issues') }}</p>
                    </div>
                  </div>
                  <div v-if="!filteredRows.length" class="tx-empty">{{ $t('ui.transfer.no_rows_state') }}</div>
                </div>
              </div>

              <div class="tx-pager">
                <button type="button" class="btn btn--ghost btn--small" :disabled="page === 0" @click="page -= 1">{{ $t('ui.inventory.previous') }}</button>
                <span class="mono">{{ page + 1 }} / {{ totalPages }}</span>
                <button type="button" class="btn btn--ghost btn--small" :disabled="page >= totalPages - 1" @click="page += 1">{{ $t('ui.inventory.next') }}</button>
              </div>
            </div>

            <!-- Paso 4 -->
            <div v-else-if="step === 4" class="tx-conflicts">
              <section class="tx-block" data-od-id="transfer-conflicts" aria-labelledby="tx-conflict-title">
                <header class="tx-block__head">
                  <div>
                    <h3 id="tx-conflict-title">{{ $t('ui.transfer.conflicts.title') }}</h3>
                    <p>{{ $t('ui.transfer.conflicts.lead') }}</p>
                  </div>
                </header>

                <div v-if="!conflicts.length" class="tx-empty tx-empty--ok">
                  <app-icon name="check"></app-icon>
                  <p>{{ $t('ui.transfer.conflicts.empty') }}</p>
                </div>

                <article v-for="row in conflicts" :key="row.key" class="tx-conflict" :data-od-id="'transfer-conflict-' + row.key">
                  <header class="tx-conflict__head">
                    <div>
                      <p class="eyebrow">{{ $t('ui.transfer.conflicts.row', { row: row.rowNumber, sheet: row.sheetName }) }}</p>
                      <h4>{{ row.display.name || $t('ui.transfer.no_name') }}</h4>
                      <p class="tx-conflict__reason"><app-icon name="alert"></app-icon> {{ row.reasons.join(' ') }}</p>
                    </div>
                    <span class="tx-state" :class="'tx-state--' + (decisionFor(row).action ? 'info' : 'warn')">
                      <span class="tx-dot"></span>{{ decisionLabel(row) }}
                    </span>
                  </header>

                  <div v-if="row.candidates.length > 1" class="tx-conflict__targets">
                    <span class="tx-label">{{ $t('ui.transfer.conflicts.compare_with') }}</span>
                    <div class="tx-chips">
                      <button v-for="id in row.candidates" :key="id" type="button" class="chip tx-chip"
                              :class="{ 'is-active': (compareTarget[row.key] || row.primaryCandidateId) === id }"
                              :aria-pressed="(compareTarget[row.key] || row.primaryCandidateId) === id"
                              @click="setCompareTarget(row, id)">{{ id }}</button>
                    </div>
                  </div>

                  <div class="tx-compare">
                    <div class="tx-compare__head">
                      <span>{{ $t('ui.transfer.compare.field') }}</span><span>{{ $t('ui.transfer.compare.current') }}</span><span>{{ $t('ui.transfer.compare.imported') }}</span>
                    </div>
                    <div v-for="field in comparisonFor(row)" :key="field.key" class="tx-compare__row"
                         :class="{ 'is-changed': field.changed, 'is-missing': !field.filled }">
                      <span class="tx-compare__label">{{ field.label }}</span>
                      <span class="tx-compare__current">{{ field.current || '—' }}</span>
                      <span class="tx-compare__imported">
                        <template v-if="field.filled && field.imported">{{ field.imported }}</template>
                        <template v-else-if="field.filled"><span class="tx-muted">{{ $t('ui.transfer.compare.empty_kept') }}</span></template>
                        <template v-else><span class="tx-muted">—</span></template>
                      </span>
                    </div>
                  </div>

                  <div class="tx-conflict__actions">
                    <span class="tx-label">{{ $t('ui.transfer.conflicts.action') }}</span>
                    <div class="tx-choices" role="group" :aria-label="$t('ui.transfer.conflicts.action_aria', { row: row.rowNumber })">
                      <button v-for="action in actions(row)" :key="action" type="button" class="tx-choice"
                              :class="{ 'is-active': decisionFor(row).action === action }"
                              :aria-pressed="decisionFor(row).action === action" @click="setDecision(row, action)">
                        <app-icon :name="actionIcon(action)"></app-icon>{{ actionLabel(action) }}
                      </button>
                    </div>
                    <p v-if="decisionFor(row).action === 'update'" class="tx-hint">
                      <app-icon name="info"></app-icon> {{ $t('ui.transfer.conflicts.update_hint', { id: decisionFor(row).targetId }) }}
                    </p>
                  </div>
                </article>
              </section>

              <section class="tx-block" data-od-id="transfer-exceptions" aria-labelledby="tx-exception-title">
                <header class="tx-block__head">
                  <div>
                    <h3 id="tx-exception-title">{{ $t('ui.transfer.exceptions.title') }}</h3>
                    <p>{{ $t('ui.transfer.exceptions.lead') }}</p>
                  </div>
                </header>
                <div v-if="!exceptions.length" class="tx-empty tx-empty--ok">
                  <app-icon name="check"></app-icon>
                  <p>{{ $t('ui.transfer.exceptions.empty') }}</p>
                </div>
                <ul v-else class="tx-exception-list">
                  <li v-for="row in exceptions" :key="row.key" class="tx-exception">
                    <div class="tx-exception__body">
                      <div class="tx-exception__title">
                        <span class="tx-state" :class="'tx-state--' + tone(row)"><span class="tx-dot"></span>{{ stateLabel(row) }}</span>
                        <strong>{{ row.display.name || $t('ui.transfer.exceptions.unnamed') }}</strong>
                        <span class="mono tx-muted">{{ $t('ui.transfer.source_row', { sheet: row.sheetName, row: row.rowNumber }) }}</span>
                      </div>
                      <p v-for="issue in row.errors.concat(row.warnings).slice(0, 2)" :key="issue" class="tx-exception__issue">{{ issue }}</p>
                      <p v-if="row.state === 'error'" class="tx-exception__issue">{{ $t('ui.transfer.exceptions.fix_error') }}</p>
                    </div>
                    <div class="tx-exception__actions">
                      <button v-for="action in actions(row)" :key="action" type="button" class="tx-choice"
                              :class="{ 'is-active': decisionFor(row).action === action }"
                              :aria-pressed="decisionFor(row).action === action" @click="setDecision(row, action)">
                        {{ actionLabel(action) }}
                      </button>
                    </div>
                  </li>
                </ul>
              </section>

              <section class="tx-block" data-od-id="transfer-updates" aria-labelledby="tx-update-title">
                <header class="tx-block__head">
                  <div>
                    <h3 id="tx-update-title">{{ $t('ui.transfer.updates.title') }}</h3>
                    <p>{{ $t('ui.transfer.updates.lead') }}</p>
                  </div>
                  <button v-if="updates.length" type="button" class="btn btn--ghost btn--small" @click="bulkSkipUpdates">{{ $t('ui.transfer.updates.skip_all') }}</button>
                </header>
                <div v-if="!updates.length" class="tx-empty">{{ $t('ui.transfer.updates.empty') }}</div>
                <ul v-else class="tx-update-list">
                  <li v-for="row in updates" :key="row.key" class="tx-update">
                    <div class="tx-update__head">
                      <span class="mono">{{ row.primaryCandidateId }}</span>
                      <strong>{{ row.display.name }}</strong>
                      <span class="tx-state tx-state--info"><span class="tx-dot"></span>{{ fieldsLabel(row) }}</span>
                      <button type="button" class="text-button" @click="expandedUpdate = expandedUpdate === row.key ? '' : row.key">
                        {{ expandedUpdate === row.key ? $t('ui.transfer.updates.hide_compare') : $t('ui.transfer.updates.show_compare') }}
                      </button>
                      <button type="button" class="tx-choice" :class="{ 'is-active': decisionFor(row).action === 'skip' }" @click="setDecision(row, 'skip')">{{ $t('ui.transfer.action.skip') }}</button>
                    </div>
                    <div v-if="expandedUpdate === row.key" class="tx-compare">
                      <div class="tx-compare__head"><span>{{ $t('ui.transfer.compare.field') }}</span><span>{{ $t('ui.transfer.compare.current') }}</span><span>{{ $t('ui.transfer.compare.imported') }}</span></div>
                      <div v-for="field in row.comparison" :key="field.key" class="tx-compare__row"
                           :class="{ 'is-changed': field.changed, 'is-missing': !field.filled }">
                        <span class="tx-compare__label">{{ field.label }}</span>
                        <span class="tx-compare__current">{{ field.current || '—' }}</span>
                        <span class="tx-compare__imported">{{ field.imported || $t('ui.transfer.compare.empty_kept') }}</span>
                      </div>
                    </div>
                  </li>
                </ul>
              </section>
            </div>

            <!-- Paso 5 -->
            <div v-else class="tx-summary">
              <div v-if="applying" class="tx-progress" role="status" aria-live="polite">
                <div class="tx-progress__head">
                  <span class="spinner spinner--teal"></span>
                  <div>
                    <strong>{{ progressLabel }}</strong>
                    <span>{{ $t('ui.transfer.progress.dont_close') }}</span>
                  </div>
                  <strong class="mono">{{ progress }}%</strong>
                </div>
                <div class="tx-progress__track"><span class="tx-progress__fill" :style="{ width: progress + '%' }"></span></div>
              </div>

              <template v-else-if="applied">
                <div class="tx-result">
                  <span class="tx-result__mark"><app-icon name="check"></app-icon></span>
                  <div>
                    <h3>{{ $t('ui.transfer.result.applied_title') }}</h3>
                    <p>{{ $t('ui.transfer.result.applied_lead', { file: applied.fileName, profile: applied.profile, count: applied.result.created.length + applied.result.updated.length }) }}</p>
                  </div>
                </div>

                <div class="tx-kpis tx-kpis--result">
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.created') }}</span>
                    <strong class="tx-kpi__value">{{ applied.counts.created }}</strong>
                    <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.created_note') }}</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.updated') }}</span>
                    <strong class="tx-kpi__value">{{ applied.counts.updated }}</strong>
                    <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.updated_note') }}</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.skipped') }}</span>
                    <strong class="tx-kpi__value">{{ applied.counts.skipped }}</strong>
                    <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.skipped_note') }}</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">{{ $t('ui.transfer.kpi.pending') }}</span>
                    <strong class="tx-kpi__value">{{ applied.counts.pending }}</strong>
                    <span class="tx-kpi__note">{{ $t('ui.transfer.kpi.pending_note') }}</span>
                  </div>
                </div>

                <div class="tx-result-grid">
                  <section class="tx-result-block" data-od-id="transfer-result-created">
                    <h4>{{ $t('ui.transfer.result.created_title') }}</h4>
                    <ul v-if="applied.result.created.length" class="tx-result-list">
                      <li v-for="item in applied.result.created" :key="item.assetId">
                        <span class="mono">{{ item.assetId }}</span>
                        <span>{{ item.name }}</span>
                        <small>{{ $t('ui.transfer.source_row', { sheet: item.row.sheetName, row: item.row.rowNumber }) }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">{{ $t('ui.transfer.result.no_created') }}</p>
                  </section>
                  <section class="tx-result-block" data-od-id="transfer-result-updated">
                    <h4>{{ $t('ui.transfer.result.updated_title') }}</h4>
                    <ul v-if="applied.result.updated.length" class="tx-result-list">
                      <li v-for="item in applied.result.updated" :key="item.assetId">
                        <span class="mono">{{ item.assetId }}</span>
                        <span>{{ item.name }}</span>
                        <small v-if="item.fields && item.fields.length">{{ item.fields.join(', ') }}</small>
                        <small v-else-if="item.fields">{{ $t('ui.transfer.result.no_value_changes') }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">{{ $t('ui.transfer.result.no_updated') }}</p>
                  </section>
                  <section class="tx-result-block" data-od-id="transfer-result-pending">
                    <h4>{{ $t('ui.transfer.result.pending_title') }}</h4>
                    <ul v-if="applied.result.pending.length" class="tx-result-list">
                      <li v-for="item in applied.result.pending" :key="item.row.key">
                        <span class="mono">{{ item.row.sheetName }} · {{ item.row.rowNumber }}</span>
                        <span>{{ item.row.display.name || $t('ui.transfer.no_name') }}</span>
                        <small>{{ item.reason }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">{{ $t('ui.transfer.result.no_pending') }}</p>
                  </section>
                </div>
              </template>

              <template v-else>
                <div class="tx-review">
                  <section class="tx-review__main" data-od-id="transfer-final-review">
                    <h3>{{ $t('ui.transfer.review.title') }}</h3>
                    <p>{{ $t('ui.transfer.review.lead', { created: rowCounts.created, updated: rowCounts.updated }) }}</p>
                    <div class="tx-kpis tx-kpis--compact">
                      <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.created') }}</span><strong class="tx-kpi__value">{{ rowCounts.created }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.updated') }}</span><strong class="tx-kpi__value">{{ rowCounts.updated }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.skipped') }}</span><strong class="tx-kpi__value">{{ rowCounts.skipped }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.pending') }}</span><strong class="tx-kpi__value">{{ rowCounts.pending }}</strong></div>
                    </div>
                    <ul class="tx-issues">
                      <li class="tx-issue"><app-icon name="lock"></app-icon> {{ $t('ui.transfer.review.empty_rule') }}</li>
                      <li class="tx-issue"><app-icon name="lock"></app-icon> {{ $t('ui.transfer.review.id_rule') }}</li>
                    </ul>
                    <p v-if="!canEdit" class="form-error" role="alert">{{ $t('ui.transfer.review.no_permission') }}</p>
                  </section>
                  <aside class="tx-review__side">
                    <h3>{{ $t('ui.transfer.review.decisions') }}</h3>
                    <ul class="tx-review__decisions">
                      <li><span>{{ $t('ui.transfer.review.open_conflicts') }}</span><strong class="mono">{{ conflicts.filter((row) => !decisionFor(row).action).length }}</strong></li>
                      <li><span>{{ $t('ui.transfer.kpi.updates') }}</span><strong class="mono">{{ updateRows.length }}</strong></li>
                      <li><span>{{ $t('ui.transfer.review.creates') }}</span><strong class="mono">{{ createRows.length }}</strong></li>
                      <li><span>{{ $t('ui.transfer.kpi.pending') }}</span><strong class="mono">{{ rowCounts.pending }}</strong></li>
                    </ul>
                  </aside>
                </div>
              </template>

              <div class="tx-summary__actions">
                <div class="tx-summary__group">
                  <button v-if="!applied" type="button" class="btn btn--primary" data-od-id="transfer-apply" :disabled="!canEdit || applying" @click="openConfirm">
                    <app-icon name="upload"></app-icon> {{ $t('ui.transfer.apply') }}
                  </button>
                  <button v-if="applied" type="button" class="btn btn--primary" data-od-id="transfer-view-inventory" @click="goInventory">{{ $t('ui.transfer.view_inventory') }}</button>
                  <button v-if="applied" type="button" class="btn btn--secondary" data-od-id="transfer-download-report" @click="downloadReport">
                    <app-icon name="download"></app-icon> {{ $t('ui.transfer.download_report') }}
                  </button>
                  <button v-if="applied" type="button" class="btn btn--ghost" @click="resetImport">{{ $t('ui.transfer.new_import') }}</button>
                </div>
                <p v-if="applied" class="tx-muted">{{ $t('ui.transfer.history_note_demo') }}</p>
              </div>
            </div>
          </section>

          <footer class="tx-foot">
            <p class="tx-foot__note">{{ footNote }}</p>
            <div class="tx-foot__actions">
              <button v-if="step > 1 && !applied" type="button" class="btn btn--ghost" data-od-id="transfer-back" @click="previousStep">{{ $t('ui.transfer.back') }}</button>
              <button v-if="step < 5" type="button" class="btn btn--primary" data-od-id="transfer-continue" :disabled="!canContinue" @click="nextStep">{{ $t('ui.transfer.continue') }}</button>
            </div>
          </footer>
        </div>

        <aside class="tx-rail" :aria-label="$t('ui.transfer.rail.aria')">
          <div class="tx-rail__card">
            <header class="tx-rail__head">
              <h3>{{ $t('ui.transfer.rail.title') }}</h3>
              <span class="tx-tag">{{ activeProfile ? activeProfile.name : $t('ui.transfer.profile.auto') }}</span>
            </header>
            <dl class="tx-summary-list">
              <div><dt>{{ $t('ui.transfer.rail.file') }}</dt><dd>{{ file ? file.name : '—' }}</dd></div>
              <div><dt>{{ $t('ui.transfer.rail.format') }}</dt><dd>{{ file ? file.format.toUpperCase() : '—' }}</dd></div>
              <div><dt>{{ $t('ui.transfer.rail.sheets') }}</dt><dd>{{ $t('ui.transfer.rail.sheets_value', { selected: selectedSheets.length, total: file ? file.sheets.length : 0 }) }}</dd></div>
              <div><dt>{{ $t('ui.transfer.rail.rows') }}</dt><dd class="mono">{{ selectedRowCount }}</dd></div>
              <div><dt>{{ $t('ui.transfer.rail.identification') }}</dt><dd>{{ identificationLabels.join(' · ') }}</dd></div>
            </dl>
            <div class="tx-rail__stats">
              <div><span class="mono">{{ applied ? applied.counts.created : rowCounts.created }}</span><small>{{ $t('ui.transfer.stats.created') }}</small></div>
              <div><span class="mono">{{ applied ? applied.counts.updated : rowCounts.updated }}</span><small>{{ $t('ui.transfer.stats.updated') }}</small></div>
              <div><span class="mono">{{ applied ? applied.counts.pending : rowCounts.pending }}</span><small>{{ $t('ui.transfer.stats.pending') }}</small></div>
            </div>
            <button type="button" class="text-button" @click="profilesOpen = true">
              <app-icon name="sliders"></app-icon> {{ $t('ui.transfer.profiles.manage') }}
            </button>
          </div>

        </aside>

        <transfer-profile-dialog :open="profilesOpen" kind="import" @close="profilesOpen = false"
                                @apply="applyProfile" @save="saveProfile"></transfer-profile-dialog>

        <modal-shell :open="confirmOpen" :eyebrow="$t('ui.transfer.confirm.eyebrow')" :title="$t('ui.transfer.confirm.title')" @close="confirmOpen = false">
          <p class="form-intro">{{ $t('ui.transfer.confirm.lead') }}</p>
          <div class="tx-kpis tx-kpis--compact">
            <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.created') }}</span><strong class="tx-kpi__value">{{ rowCounts.created }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.updated') }}</span><strong class="tx-kpi__value">{{ rowCounts.updated }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.skipped') }}</span><strong class="tx-kpi__value">{{ rowCounts.skipped }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">{{ $t('ui.transfer.kpi.pending') }}</span><strong class="tx-kpi__value">{{ rowCounts.pending }}</strong></div>
          </div>

          <div class="tx-confirm-grid">
            <section data-od-id="transfer-confirm-updates">
              <h3>{{ $t('ui.transfer.confirm.updates_title') }}</h3>
              <ul v-if="updateRows.length" class="tx-confirm-list">
                <li v-for="row in updateRows" :key="row.key">
                  <span class="mono">{{ row.primaryCandidateId }}</span>
                  <span>{{ row.display.name }}</span>
                  <small>{{ changedLabels(row) }}</small>
                </li>
              </ul>
              <p v-else class="tx-muted">{{ $t('ui.transfer.confirm.no_updates') }}</p>
            </section>
            <section data-od-id="transfer-confirm-creates">
              <h3>{{ $t('ui.transfer.confirm.creates_title') }}</h3>
              <p class="tx-confirm-count mono">{{ createRows.length }}</p>
              <p class="tx-muted">{{ $t('ui.transfer.confirm.creates_body') }}</p>
            </section>
          </div>

          <ul class="tx-issues">
            <li class="tx-issue"><app-icon name="lock"></app-icon> {{ $t('ui.transfer.confirm.id_rule') }}</li>
            <li class="tx-issue"><app-icon name="lock"></app-icon> {{ $t('ui.transfer.confirm.empty_rule') }}</li>
          </ul>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="confirmOpen = false">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--primary" data-od-id="transfer-confirm-apply" :disabled="applying" @click="applyImport">{{ $t('ui.transfer.apply') }}</button>
          </template>
        </modal-shell>
      </div>
    `
  };

  /* Contenedor del módulo ------------------------------------------------- */

  window.AssetTransferViews.DataTransfer = {
    name: 'DataTransfer',
    components: {
      AppIcon: window.AppIcon,
      TransferImport: window.AssetTransferViews.TransferImport,
      TransferExport: window.AssetTransferViews.TransferExport
    },
    props: { app: { type: Object, required: true } },
    computed: {
      tab() {
        return this.app.route.section === 'exportar' ? 'export' : 'import';
      },
      profileCount() {
        return Data.profiles('import').length + Data.profiles('export').length;
      },
      customCount() {
        return Data.profiles('import').filter((profile) => !profile.builtin).length
          + Data.profiles('export').filter((profile) => !profile.builtin).length;
      },
      /* The workspace header counts the canonical inventory read, never the
       * prototype catalogue. Loading, errors and missing permission show a
       * concise state instead of a stale or demo total; a genuine empty
       * inventory renders 0 activos, and only a completed count can carry the
       * filtered-scope label. */
      inventoryCountState() {
        const app = this.app || {};
        if (typeof app.inventoryAvailable !== 'function' || !app.inventoryAvailable()) return 'hidden';
        const inventory = app.inventory || {};
        if (inventory.loading) return 'loading';
        if (inventory.error) return 'error';
        if (!inventory.loaded) return 'hidden';
        return 'ready';
      },
      inventoryCountLabel() {
        const state = this.inventoryCountState;
        if (state === 'loading') return tr('ui.transfer.inventory.loading');
        if (state === 'error') return tr('ui.transfer.inventory.unavailable');
        if (state !== 'ready') return '';
        return tr('ui.transfer.inventory.assets', { count: Number(this.app.inventory.total) || 0 });
      }
    },
    methods: {
      setTab(tab) {
        this.app.setHash('#/datos/' + (tab === 'export' ? 'exportar' : 'importar'));
      }
    },
    template: `
      <section class="page tx-page" aria-labelledby="transfer-title" data-od-id="data-transfer">
        <header class="page-head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.transfer.hub.eyebrow') }}</p>
            <h1 id="transfer-title">{{ $t('ui.transfer.hub.title') }}</h1>

          </div>
          <div class="page-head__side">
            <div class="page-head__meta" :aria-label="$t('ui.transfer.hub.summary_aria')">
              <span v-if="inventoryCountLabel" class="mono">{{ inventoryCountLabel }}</span>
              <span v-if="inventoryCountState === 'ready' && app.inventoryFiltersActive">{{ $t('ui.transfer.hub.filtered') }}</span>
              <span>{{ $t('ui.transfer.hub.profiles', { count: profileCount, custom: customCount }) }}</span>
            </div>
          </div>
        </header>

        <div class="tx-tabs" role="tablist" :aria-label="$t('ui.transfer.hub.tabs_aria')">
          <button type="button" role="tab" id="tx-tab-import" class="tx-tab"
                  :class="{ 'is-active': tab === 'import' }" :aria-selected="tab === 'import' ? 'true' : 'false'"
                  aria-controls="tx-panel-import" data-od-id="transfer-tab-import" @click="setTab('import')">
            <span class="tx-tab__icon"><app-icon name="upload"></app-icon></span>
            <span class="tx-tab__text"><strong>{{ $t('ui.transfer.hub.tab_import') }}</strong></span>
          </button>
          <button type="button" role="tab" id="tx-tab-export" class="tx-tab"
                  :class="{ 'is-active': tab === 'export' }" :aria-selected="tab === 'export' ? 'true' : 'false'"
                  aria-controls="tx-panel-export" data-od-id="transfer-tab-export" @click="setTab('export')">
            <span class="tx-tab__icon"><app-icon name="download"></app-icon></span>
            <span class="tx-tab__text"><strong>{{ $t('ui.transfer.hub.tab_export') }}</strong></span>
          </button>
        </div>

        <div id="tx-panel-import" role="tabpanel" aria-labelledby="tx-tab-import" v-show="tab === 'import'">
          <transfer-import :app="app"></transfer-import>
        </div>
        <div id="tx-panel-export" role="tabpanel" aria-labelledby="tx-tab-export" v-show="tab === 'export'">
          <transfer-export :app="app"></transfer-export>
        </div>
      </section>
    `
  };
})();
