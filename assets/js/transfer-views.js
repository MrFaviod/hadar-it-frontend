/* Vistas del módulo de importación y exportación. */
(function () {
  'use strict';

  const Data = window.AssetTransferData;
  const Engine = window.AssetTransferEngine;

  const STEP_LIST = [
    { index: 1, id: 'archivo', label: 'Archivo', hint: 'Origen y hojas' },
    { index: 2, id: 'columnas', label: 'Correspondencia', hint: 'Columnas y reglas' },
    { index: 3, id: 'vista', label: 'Vista previa', hint: 'Validación' },
    { index: 4, id: 'conflictos', label: 'Conflictos', hint: 'Decisiones' },
    { index: 5, id: 'resumen', label: 'Resumen', hint: 'Aplicar y cerrar' }
  ];

  const ACTION_LABELS = {
    update: 'Actualizar',
    create: 'Crear como nuevo',
    skip: 'Omitir',
    review: 'Revisar después'
  };

  const ACTION_ICONS = {
    update: 'pencil',
    create: 'plus',
    skip: 'minus',
    review: 'history'
  };

  const FILTERS = [
    { id: 'all', label: 'Todos' },
    { id: 'new', label: 'Listos' },
    { id: 'update', label: 'Actualizaciones' },
    { id: 'conflict', label: 'Conflictos' },
    { id: 'exception', label: 'Excepciones' }
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
        return this.kind === 'import' ? 'Perfiles de importación' : 'Perfiles de exportación';
      },
      help() {
        return this.kind === 'import'
          ? 'Un perfil guarda la correspondencia de columnas, los criterios de identificación y las reglas de tratamiento.'
          : 'Un perfil guarda los campos exportados, su orden y el formato de salida.';
      }
    },
    methods: {
      meta(profile) {
        if (this.kind === 'import') {
          const mapping = profile.mapping || {};
          const mapped = Object.keys(mapping).filter((key) => mapping[key]).length;
          const ident = (profile.identification || []).map((key) => {
            const field = Data.IDENTIFICATION_FIELDS.find((item) => item.key === key);
            return field ? field.label.toLocaleLowerCase('es') : key;
          });
          return mapped + ' columnas · ' + (ident.length ? ident.join(', ') : 'sin identificación');
        }
        const format = profile.format === 'xlsx' ? 'Excel' : 'CSV';
        return (profile.fields || []).length + ' campos · ' + format;
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
      <modal-shell :open="open" eyebrow="Configuraciones guardadas" :title="title" size="wide" @close="$emit('close')">
        <div class="tx-profiles">
          <p class="form-intro">{{ help }}</p>

          <div class="tx-profile-save">
            <div class="field">
              <label :for="'tx-profile-name-' + kind">Guardar la configuración actual</label>
              <div class="input-shell">
                <input :id="'tx-profile-name-' + kind" v-model="name" type="text" autocomplete="off" placeholder="Ej. Inventario de sedes 2026">
              </div>
            </div>
            <button type="button" class="btn btn--primary btn--small" data-od-id="transfer-profile-save" :disabled="!name.trim()" @click="save">Guardar perfil</button>
          </div>

          <ul class="tx-profile-list">
            <li v-for="profile in profiles" :key="profile.id" class="tx-profile">
              <div class="tx-profile__body">
                <div class="tx-profile__title">
                  <strong>{{ profile.name }}</strong>
                  <span class="tx-tag" :class="{ 'tx-tag--builtin': profile.builtin }">{{ profile.builtin ? 'Predeterminado' : 'Personalizado' }}</span>
                </div>
                <p>{{ profile.description }}</p>
                <p class="tx-profile__meta mono">{{ meta(profile) }}</p>
              </div>
              <div class="tx-profile__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="$emit('apply', profile)">Aplicar</button>
                <button v-if="!profile.builtin" type="button" class="icon-button" :aria-label="'Eliminar el perfil ' + profile.name" @click="remove(profile)">
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
        return ['', 'Paso 1 de 5 · Origen', 'Paso 2 de 5 · Estructura', 'Paso 3 de 5 · Calidad del dato', 'Paso 4 de 5 · Decisiones', 'Paso 5 de 5 · Resultado'][this.step];
      },
      stepTitle() {
        if (this.step === 5) return this.applied ? 'Importación completada' : 'Revisión final';
        return ['', 'Archivo y hojas', 'Correspondencia de columnas', 'Vista previa de los registros', 'Conflictos y excepciones'][this.step];
      },
      stepLead() {
        if (this.step === 1) return 'Trabaja con Excel de varias hojas o CSV. Cada hoja puede aportar su sede y su categoría.';
        if (this.step === 2) return 'Revisa la correspondencia detectada y ajusta las reglas antes de validar los datos.';
        if (this.step === 3) return 'Los registros se validan, se comparan con el inventario y se agrupan por estado.';
        if (this.step === 4) return 'Resuelve cada coincidencia ambigua y decide qué hacer con las excepciones.';
        return this.applied
          ? 'Resumen de lo aplicado al inventario y de los registros que quedaron pendientes.'
          : 'Comprueba el resultado previsto. Los cambios sobre activos existentes se aplican tras confirmar.';
      },
      footNote() {
        if (this.step === 1) return this.selectedRowCount ? this.selectedRowCount + ' filas listas para analizar.' : 'Selecciona al menos una hoja.';
        if (this.step === 2) return 'Los campos vacíos del archivo se conservan como están en el inventario.';
        if (this.step === 3) return this.rows.length + ' registros analizados · ' + this.rowCounts.pending + ' requieren decisión o revisión.';
        if (this.step === 4) return 'Las actualizaciones se confirman en el paso final con el detalle de los cambios.';
        return this.applied ? 'El inventario ya refleja los cambios.' : 'No se modifica nada hasta confirmar la importación.';
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
        return this.filteredRows.length ? 'Mostrando ' + (this.page * 8 + 1) + '–' + Math.min(this.filteredRows.length, this.page * 8 + 8) + ' de ' + this.filteredRows.length : 'Sin registros en este filtro';
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
        this.app.showToast('Correspondencia detectada de nuevo.');
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
        return target ? target.group : 'Se ignorará en la importación';
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
        if (state === 'ignored') return 'Sin asignar';
        if (state === 'duplicate') return 'Campo repetido';
        if (state === 'auto') return 'Detectada';
        return 'Manual';
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
        const total = row.changes.length;
        return total === 1 ? '1 campo' : total + ' campos';
      },
      targetsByGroup(group) {
        return Data.TARGETS.filter((target) => target.group === group);
      },
      toggleIdentification(key) {
        const has = this.identification.indexOf(key) !== -1;
        if (has && this.identification.length === 1) {
          this.app.showToast('Debe quedar al menos un criterio de identificación.', 'error');
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
        return decision.action ? ACTION_LABELS[decision.action] : 'Sin decidir';
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
        return changes.map((field) => field.label).join(', ') || 'sin cambios';
      },
      openConfirm() {
        if (!this.canEdit) {
          this.app.showToast('Tu rol no permite modificar el inventario.', 'error');
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
        this.progressLabel = 'Preparando la importación…';
        const result = Engine.batch();
        const total = this.rows.length;
        for (let index = 0; index < total; index += 1) {
          const row = this.rows[index];
          Engine.applyRow(this.app, row, Engine.decisionFor(row, this.decisions), result);
          this.progress = Math.round(((index + 1) / total) * 100);
          this.progressLabel = 'Procesando ' + (index + 1) + ' de ' + total + ' · ' + row.sheetName + ' · fila ' + row.rowNumber;
          await this.sleep(28);
        }
        const counts = Engine.finish(this.app, result, {
          record: true,
          fileName: this.file.name,
          fileId: this.file.id,
          profile: this.activeProfile ? this.activeProfile.name : 'Detección automática',
          sheets: this.selectedSheets.length
        });
        this.historyTick += 1;
        this.applied = {
          result,
          counts,
          at: new Date().toISOString(),
          fileName: this.file.name,
          profile: this.activeProfile ? this.activeProfile.name : 'Detección automática'
        };
        this.applying = false;
        this.progress = 100;
        this.app.showToast('Importación aplicada: ' + counts.created + ' creados y ' + counts.updated + ' actualizados.');
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
          this.app.showToast('Informe descargado.');
        } catch (error) {
          this.app.showToast('No se pudo descargar el informe.', 'error');
        }
      },
      downloadReport() {
        if (!this.applied) return;
        const csv = Engine.reportCsv(this.applied.result, 'Importación de ' + this.applied.fileName + ' · ' + Data.formatDateTime(this.applied.at));
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
          description: 'Guardado desde ' + this.file.name + '.',
          fileId: this.fileId,
          identification: this.identification.slice(),
          mapping,
          sheetSites
        });
        if (!saved) return;
        this.profileId = saved.id;
        this.profilesOpen = false;
        this.app.showToast('Perfil «' + saved.name + '» guardado.');
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
        this.app.showToast('Perfil «' + profile.name + '» aplicado.');
      }
    },
    template: `
      <div class="tx-layout">
        <div class="tx-main">
          <ol class="tx-steps" aria-label="Pasos de la importación">
            <li v-for="item in steps" :key="item.id" class="tx-step"
                :class="{ 'is-active': item.index === step, 'is-done': item.index < step }">
              <button type="button" class="tx-step__btn" :data-od-id="'transfer-step-' + item.index" :disabled="item.index > step"
                      :aria-label="'Paso ' + item.index + ': ' + item.label"
                      :aria-current="item.index === step ? 'step' : null" @click="goStep(item.index)">
                <span class="tx-step__mark">
                  <app-icon v-if="item.index < step" name="check"></app-icon>
                  <template v-else>{{ item.index }}</template>
                </span>
                <span class="tx-step__text">
                  <strong>{{ item.label }}</strong>
                  <small>{{ item.hint }}</small>
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
                <p>{{ stepLead }}</p>
              </div>
              <div class="tx-panel__tools">
                <button v-if="step === 2" type="button" class="btn btn--secondary btn--small" @click="autoMapping">
                  <app-icon name="refresh"></app-icon> Volver a detectar
                </button>
                <button v-if="step < 5" type="button" class="btn btn--ghost btn--small" @click="profilesOpen = true">
                  <app-icon name="sliders"></app-icon> Perfiles
                </button>
              </div>
            </header>

            <!-- Paso 1 -->
            <div v-if="step === 1" class="tx-source">
              <div class="tx-source__list">
                <p class="tx-label">Archivo de origen</p>
                <button v-for="item in files" :key="item.id" type="button" class="tx-file"
                        :class="{ 'is-active': fileId === item.id }" :aria-pressed="fileId === item.id"
                        @click="selectFile(item.id)">
                  <span class="tx-file__format" :class="'tx-file__format--' + item.format">{{ item.format.toUpperCase() }}</span>
                  <span class="tx-file__body">
                    <strong>{{ item.name }}</strong>
                    <small class="mono">{{ item.sheets.length }} {{ item.sheets.length === 1 ? 'hoja' : 'hojas' }} · {{ rowTotal(item) }} filas · {{ item.size }}</small>
                    <span class="tx-file__origin">{{ item.origin }}</span>
                  </span>
                  <span v-if="fileId === item.id" class="tx-file__check"><app-icon name="check"></app-icon></span>
                </button>
                <p class="tx-hint"><app-icon name="info"></app-icon> Este prototipo analiza archivos de ejemplo; no se lee ningún archivo del equipo.</p>
              </div>

              <div class="tx-source__sheets">
                <p class="tx-label">Hojas detectadas</p>
                <div v-if="!file" class="tx-empty">Elige un archivo para ver sus hojas.</div>
                <template v-else>
                  <label v-for="sheet in file.sheets" :key="sheet.id" class="tx-sheet" :class="{ 'is-active': sheets[sheet.id] }">
                    <input v-model="sheets[sheet.id]" type="checkbox">
                    <span class="tx-sheet__body">
                      <strong>{{ sheet.name }}</strong>
                      <small class="mono">{{ sheet.rows.length }} filas · {{ sheet.columns.length }} columnas</small>
                      <span v-if="sheets[sheet.id]" class="tx-sheet__tags">
                        <span class="tx-tag"><app-icon name="building"></app-icon> {{ siteLabel(sheetSite[sheet.id] || sheet.siteId) || 'Sede por asignar' }}</span>
                        <span class="tx-tag"><app-icon name="grid"></app-icon> {{ categoryLabel(sheetCategory[sheet.id]) || 'Categoría por fila' }}</span>
                      </span>
                    </span>
                    <span class="tx-sheet__count mono">{{ sheet.rows.length }}</span>
                  </label>
                  <p class="tx-hint"><app-icon name="check"></app-icon> Cada hoja se interpreta por separado y conserva su propia correspondencia.</p>
                </template>
              </div>
            </div>

            <!-- Paso 2 -->
            <div v-else-if="step === 2" class="tx-mapping">
              <p v-if="!selectedSheets.length" class="tx-empty">No hay hojas seleccionadas.</p>
              <article v-for="sheet in selectedSheets" :key="sheet.id" class="tx-sheet-panel">
                <header class="tx-sheet-panel__head">
                  <div>
                    <p class="eyebrow">{{ sheet.name }}</p>
                    <h3>{{ sheet.rows.length }} filas · {{ sheet.columns.length }} columnas</h3>
                  </div>
                  <div class="tx-sheet-panel__defaults">
                    <div class="field">
                      <label :for="'sheet-site-' + sheet.id">Sede de la hoja</label>
                      <div class="input-shell">
                        <app-icon name="building"></app-icon>
                        <select :id="'sheet-site-' + sheet.id" v-model="sheetSite[sheet.id]">
                          <option value="">Sin sede</option>
                          <option v-for="site in app.sites" :key="site.id" :value="site.id">{{ site.label }}</option>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                    <div class="field">
                      <label :for="'sheet-cat-' + sheet.id">Categoría</label>
                      <div class="input-shell">
                        <app-icon name="grid"></app-icon>
                        <select :id="'sheet-cat-' + sheet.id" v-model="sheetCategory[sheet.id]">
                          <option value="">Deducir por fila</option>
                          <option v-for="category in app.categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                  </div>
                </header>

                <div class="tx-map" role="table" :aria-label="'Correspondencia de columnas de ' + sheet.name">
                  <div class="tx-map__head" role="row">
                    <span role="columnheader">Columna del archivo</span>
                    <span role="columnheader">Primer valor</span>
                    <span role="columnheader">Campo del activo</span>
                    <span role="columnheader">Detección</span>
                  </div>
                  <div v-for="(column, index) in sheet.columns" :key="column" class="tx-map__row" role="row">
                    <span class="tx-map__column" role="cell">
                      <strong>{{ column }}</strong>
                      <small>{{ mappedLabel(sheet, index) }}</small>
                    </span>
                    <span class="tx-map__sample mono" role="cell" :title="sample(sheet, index)">{{ previewValue(sheet, index) }}</span>
                    <div class="field field--inline" role="cell">
                      <label class="sr-only" :for="'map-' + sheet.id + '-' + index">Campo para la columna {{ column }}</label>
                      <div class="input-shell">
                        <select :id="'map-' + sheet.id + '-' + index" :value="(mapping[sheet.id] || [])[index] || ''"
                                @change="setMapping(sheet.id, index, $event.target.value)">
                          <option value="">Ignorar columna</option>
                          <optgroup v-for="group in targetGroups" :key="group" :label="group">
                            <option v-for="target in targetsByGroup(group)" :key="target.key" :value="target.key">{{ target.label }}</option>
                          </optgroup>
                        </select>
                        <app-icon name="chevron-down"></app-icon>
                      </div>
                    </div>
                    <span v-if="detectState(sheet, index) === 'auto'" class="tx-detect tx-detect--auto" role="cell" title="Detectada automáticamente">
                      <app-icon name="check"></app-icon><span class="sr-only">Detectada automáticamente</span>
                    </span>
                    <span v-else class="tx-detect" :class="'tx-detect--' + detectState(sheet, index)" role="cell">{{ detectLabel(sheet, index) }}</span>
                  </div>
                </div>
              </article>

              <section class="tx-ident" data-od-id="transfer-identification" aria-labelledby="tx-ident-title">
                <header>
                  <h3 id="tx-ident-title">Identificación de coincidencias</h3>
                  <p>La serie y la IP confirman un activo existente; el nombre solo lo sugiere y requiere decisión.</p>
                </header>
                <div class="tx-ident__options">
                  <label v-for="field in identificationFields" :key="field.key" class="check-row">
                    <input type="checkbox" :checked="identification.indexOf(field.key) !== -1" @change="toggleIdentification(field.key)">
                    <span>
                      <strong>{{ field.label }}</strong>
                      <small>{{ field.strength === 'strong' ? 'Coincidencia inequívoca' : 'Coincidencia débil' }}</small>
                    </span>
                  </label>
                </div>
              </section>

              <div class="tx-rules">
                <div class="tx-rule">
                  <app-icon name="lock"></app-icon>
                  <div><strong>El ID permanente nunca se reemplaza</strong><span>Una actualización conserva el identificador y el código del activo existente.</span></div>
                  <span class="tx-tag tx-tag--lock">Regla fija</span>
                </div>
                <div class="tx-rule">
                  <app-icon name="check"></app-icon>
                  <div><strong>Los campos vacíos no sobrescriben</strong><span>Solo se aplican los valores presentes en el archivo.</span></div>
                  <span class="tx-tag tx-tag--lock">Regla fija</span>
                </div>
                <label class="tx-rule tx-rule--toggle">
                  <span class="switch">
                    <input v-model="rules.flagIncomplete" type="checkbox">
                    <span class="switch__track"><span class="switch__thumb"></span></span>
                  </span>
                  <div><strong>Marcar registros incompletos para revisión</strong><span>Los registros sin responsable o sin identificador quedan pendientes en lugar de crearse.</span></div>
                </label>
              </div>
            </div>

            <!-- Paso 3 -->
            <div v-else-if="step === 3" class="tx-preview">
              <div class="tx-kpis">
                <div class="tx-kpi">
                  <span class="tx-kpi__label">Registros</span>
                  <strong class="tx-kpi__value">{{ rows.length }}</strong>
                  <span class="tx-kpi__note">{{ selectedSheets.length }} hojas seleccionadas</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">Por crear</span>
                  <strong class="tx-kpi__value">{{ rowCounts.created }}</strong>
                  <span class="tx-kpi__note">Sin coincidencia en el inventario</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">Actualizaciones</span>
                  <strong class="tx-kpi__value">{{ rowCounts.updated }}</strong>
                  <span class="tx-kpi__note">Coincidencia inequívoca</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">Conflictos</span>
                  <strong class="tx-kpi__value">{{ conflicts.length }}</strong>
                  <span class="tx-kpi__note">Requieren una decisión</span>
                </div>
                <div class="tx-kpi">
                  <span class="tx-kpi__label">Excepciones</span>
                  <strong class="tx-kpi__value">{{ exceptions.length }}</strong>
                  <span class="tx-kpi__note">Duplicados, bajas y errores</span>
                </div>
              </div>

              <div class="tx-filterbar">
                <div class="tx-chips" role="group" aria-label="Filtrar registros por estado">
                  <button v-for="option in filters" :key="option.id" type="button" class="chip tx-chip"
                          :class="{ 'is-active': filter === option.id }" :aria-pressed="filter === option.id"
                          @click="filter = option.id">
                    <span>{{ option.label }}</span><span class="chip__count">{{ option.count }}</span>
                  </button>
                </div>
                <span class="tx-filterbar__meta mono">{{ ranking }}</span>
              </div>

              <div class="tx-table-wrap">
                <div class="tx-table" role="table" aria-label="Vista previa de los registros importados">
                  <div class="tx-table__head" role="row">
                    <span role="columnheader">Fila</span>
                    <span role="columnheader">Activo</span>
                    <span role="columnheader">Categoría</span>
                    <span role="columnheader">Sede</span>
                    <span role="columnheader">Identificación</span>
                    <span role="columnheader">Estado</span>
                    <span role="columnheader" class="sr-only">Detalle</span>
                  </div>
                  <div v-for="row in pagedRows" :key="row.key" class="tx-table__row" :class="{ 'is-open': expanded === row.key }" role="row">
                    <span class="tx-table__cell" role="cell">
                      <strong class="mono">{{ row.rowNumber }}</strong>
                      <small>{{ row.sheetName }}</small>
                    </span>
                    <span class="tx-table__cell" role="cell">
                      <strong>{{ row.display.name || 'Sin nombre' }}</strong>
                      <small>{{ [row.display.brand, row.display.model].filter(Boolean).join(' ') || row.display.serial || '—' }}</small>
                    </span>
                    <span class="tx-table__cell" role="cell">{{ row.display.category || '—' }}</span>
                    <span class="tx-table__cell" role="cell">{{ row.display.site || 'Sin sede' }}</span>
                    <span class="tx-table__cell" role="cell">
                      <span v-if="row.primaryCandidateId" class="mono">{{ row.primaryCandidateId }}</span>
                      <span v-else class="tx-muted">Nuevo registro</span>
                      <small v-if="row.matchedByName">por nombre</small>
                    </span>
                    <span class="tx-table__cell" role="cell">
                      <span class="tx-state" :class="'tx-state--' + tone(row)"><span class="tx-dot"></span>{{ stateLabel(row) }}</span>
                    </span>
                    <button type="button" class="icon-button tx-table__toggle" :aria-expanded="expanded === row.key"
                            :aria-label="'Ver el detalle de la fila ' + row.rowNumber"
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
                      <p v-else class="tx-muted">Sin incidencias detectadas en esta fila.</p>
                    </div>
                  </div>
                  <div v-if="!filteredRows.length" class="tx-empty">No hay registros con este estado.</div>
                </div>
              </div>

              <div class="tx-pager">
                <button type="button" class="btn btn--ghost btn--small" :disabled="page === 0" @click="page -= 1">Anterior</button>
                <span class="mono">{{ page + 1 }} / {{ totalPages }}</span>
                <button type="button" class="btn btn--ghost btn--small" :disabled="page >= totalPages - 1" @click="page += 1">Siguiente</button>
              </div>
            </div>

            <!-- Paso 4 -->
            <div v-else-if="step === 4" class="tx-conflicts">
              <section class="tx-block" data-od-id="transfer-conflicts" aria-labelledby="tx-conflict-title">
                <header class="tx-block__head">
                  <div>
                    <h3 id="tx-conflict-title">Coincidencias ambiguas</h3>
                    <p>El archivo apunta a más de un activo o solo coincide el nombre.</p>
                  </div>
                  <button v-if="conflicts.length" type="button" class="btn btn--secondary btn--small" @click="resolveAllConflicts">
                    Actualizar todas con la coincidencia principal
                  </button>
                </header>

                <div v-if="!conflicts.length" class="tx-empty tx-empty--ok">
                  <app-icon name="check"></app-icon>
                  <p>No hay coincidencias ambiguas: cada registro apunta a un único activo o a ninguno.</p>
                </div>

                <article v-for="row in conflicts" :key="row.key" class="tx-conflict" :data-od-id="'transfer-conflict-' + row.key">
                  <header class="tx-conflict__head">
                    <div>
                      <p class="eyebrow">Fila {{ row.rowNumber }} · {{ row.sheetName }}</p>
                      <h4>{{ row.display.name || 'Sin nombre' }}</h4>
                      <p class="tx-conflict__reason"><app-icon name="alert"></app-icon> {{ row.reasons.join(' ') }}</p>
                    </div>
                    <span class="tx-state" :class="'tx-state--' + (decisionFor(row).action ? 'info' : 'warn')">
                      <span class="tx-dot"></span>{{ decisionLabel(row) }}
                    </span>
                  </header>

                  <div v-if="row.candidates.length > 1" class="tx-conflict__targets">
                    <span class="tx-label">Comparar con</span>
                    <div class="tx-chips">
                      <button v-for="id in row.candidates" :key="id" type="button" class="chip tx-chip"
                              :class="{ 'is-active': (compareTarget[row.key] || row.primaryCandidateId) === id }"
                              :aria-pressed="(compareTarget[row.key] || row.primaryCandidateId) === id"
                              @click="setCompareTarget(row, id)">{{ id }}</button>
                    </div>
                  </div>

                  <div class="tx-compare">
                    <div class="tx-compare__head">
                      <span>Campo</span><span>En el inventario</span><span>En el archivo</span>
                    </div>
                    <div v-for="field in comparisonFor(row)" :key="field.key" class="tx-compare__row"
                         :class="{ 'is-changed': field.changed, 'is-missing': !field.filled }">
                      <span class="tx-compare__label">{{ field.label }}</span>
                      <span class="tx-compare__current">{{ field.current || '—' }}</span>
                      <span class="tx-compare__imported">
                        <template v-if="field.filled && field.imported">{{ field.imported }}</template>
                        <template v-else-if="field.filled"><span class="tx-muted">Vacío · se conserva</span></template>
                        <template v-else><span class="tx-muted">—</span></template>
                      </span>
                    </div>
                  </div>

                  <div class="tx-conflict__actions">
                    <span class="tx-label">Acción</span>
                    <div class="tx-choices" role="group" :aria-label="'Acción para la fila ' + row.rowNumber">
                      <button v-for="action in actions(row)" :key="action" type="button" class="tx-choice"
                              :class="{ 'is-active': decisionFor(row).action === action }"
                              :aria-pressed="decisionFor(row).action === action" @click="setDecision(row, action)">
                        <app-icon :name="actionIcon(action)"></app-icon>{{ actionLabel(action) }}
                      </button>
                    </div>
                    <p v-if="decisionFor(row).action === 'update'" class="tx-hint">
                      <app-icon name="info"></app-icon> Se actualizará {{ decisionFor(row).targetId }} y se conservará su ID permanente.
                    </p>
                  </div>
                </article>
              </section>

              <section class="tx-block" data-od-id="transfer-exceptions" aria-labelledby="tx-exception-title">
                <header class="tx-block__head">
                  <div>
                    <h3 id="tx-exception-title">Excepciones</h3>
                    <p>Duplicados en el archivo, activos dados de baja, registros incompletos y errores de formato.</p>
                  </div>
                </header>
                <div v-if="!exceptions.length" class="tx-empty tx-empty--ok">
                  <app-icon name="check"></app-icon>
                  <p>No hay excepciones que resolver.</p>
                </div>
                <ul v-else class="tx-exception-list">
                  <li v-for="row in exceptions" :key="row.key" class="tx-exception">
                    <div class="tx-exception__body">
                      <div class="tx-exception__title">
                        <span class="tx-state" :class="'tx-state--' + tone(row)"><span class="tx-dot"></span>{{ stateLabel(row) }}</span>
                        <strong>{{ row.display.name || 'Registro sin nombre' }}</strong>
                        <span class="mono tx-muted">{{ row.sheetName }} · fila {{ row.rowNumber }}</span>
                      </div>
                      <p v-for="issue in row.errors.concat(row.warnings).slice(0, 2)" :key="issue" class="tx-exception__issue">{{ issue }}</p>
                      <p v-if="row.state === 'error'" class="tx-exception__issue">Corrige el archivo y vuelve a importarlo, o deja el registro para revisión.</p>
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
                    <h3 id="tx-update-title">Actualizaciones inequívocas</h3>
                    <p>Coinciden por serie o IP con un único activo. Revisa los cambios antes de confirmar.</p>
                  </div>
                  <button v-if="updates.length" type="button" class="btn btn--ghost btn--small" @click="bulkSkipUpdates">Omitir todas</button>
                </header>
                <div v-if="!updates.length" class="tx-empty">No hay actualizaciones automáticas.</div>
                <ul v-else class="tx-update-list">
                  <li v-for="row in updates" :key="row.key" class="tx-update">
                    <div class="tx-update__head">
                      <span class="mono">{{ row.primaryCandidateId }}</span>
                      <strong>{{ row.display.name }}</strong>
                      <span class="tx-state tx-state--info"><span class="tx-dot"></span>{{ fieldsLabel(row) }}</span>
                      <button type="button" class="text-button" @click="expandedUpdate = expandedUpdate === row.key ? '' : row.key">
                        {{ expandedUpdate === row.key ? 'Ocultar comparación' : 'Ver comparación' }}
                      </button>
                      <button type="button" class="tx-choice" :class="{ 'is-active': decisionFor(row).action === 'skip' }" @click="setDecision(row, 'skip')">Omitir</button>
                    </div>
                    <div v-if="expandedUpdate === row.key" class="tx-compare">
                      <div class="tx-compare__head"><span>Campo</span><span>En el inventario</span><span>En el archivo</span></div>
                      <div v-for="field in row.comparison" :key="field.key" class="tx-compare__row"
                           :class="{ 'is-changed': field.changed, 'is-missing': !field.filled }">
                        <span class="tx-compare__label">{{ field.label }}</span>
                        <span class="tx-compare__current">{{ field.current || '—' }}</span>
                        <span class="tx-compare__imported">{{ field.imported || 'Vacío · se conserva' }}</span>
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
                    <span>No cierres esta vista mientras se aplican los cambios.</span>
                  </div>
                  <strong class="mono">{{ progress }}%</strong>
                </div>
                <div class="tx-progress__track"><span class="tx-progress__fill" :style="{ width: progress + '%' }"></span></div>
              </div>

              <template v-else-if="applied">
                <div class="tx-result">
                  <span class="tx-result__mark"><app-icon name="check"></app-icon></span>
                  <div>
                    <h3>Importación aplicada</h3>
                    <p>{{ applied.fileName }} · {{ applied.profile }} · {{ applied.result.created.length + applied.result.updated.length }} cambios en el inventario.</p>
                  </div>
                </div>

                <div class="tx-kpis tx-kpis--result">
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">Creados</span>
                    <strong class="tx-kpi__value">{{ applied.counts.created }}</strong>
                    <span class="tx-kpi__note">Activos nuevos con ID permanente</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">Actualizados</span>
                    <strong class="tx-kpi__value">{{ applied.counts.updated }}</strong>
                    <span class="tx-kpi__note">ID conservado</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">Omitidos</span>
                    <strong class="tx-kpi__value">{{ applied.counts.skipped }}</strong>
                    <span class="tx-kpi__note">Descartados en la revisión</span>
                  </div>
                  <div class="tx-kpi">
                    <span class="tx-kpi__label">Pendientes</span>
                    <strong class="tx-kpi__value">{{ applied.counts.pending }}</strong>
                    <span class="tx-kpi__note">Para revisar más tarde</span>
                  </div>
                </div>

                <div class="tx-result-grid">
                  <section class="tx-result-block" data-od-id="transfer-result-created">
                    <h4>Activos creados</h4>
                    <ul v-if="applied.result.created.length" class="tx-result-list">
                      <li v-for="item in applied.result.created" :key="item.assetId">
                        <span class="mono">{{ item.assetId }}</span>
                        <span>{{ item.name }}</span>
                        <small>{{ item.row.sheetName }} · fila {{ item.row.rowNumber }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">No se crearon activos.</p>
                  </section>
                  <section class="tx-result-block" data-od-id="transfer-result-updated">
                    <h4>Activos actualizados</h4>
                    <ul v-if="applied.result.updated.length" class="tx-result-list">
                      <li v-for="item in applied.result.updated" :key="item.assetId">
                        <span class="mono">{{ item.assetId }}</span>
                        <span>{{ item.name }}</span>
                        <small>{{ item.fields.length ? item.fields.join(', ') : 'sin cambios de valor' }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">No se actualizaron activos.</p>
                  </section>
                  <section class="tx-result-block" data-od-id="transfer-result-pending">
                    <h4>Registros pendientes</h4>
                    <ul v-if="applied.result.pending.length" class="tx-result-list">
                      <li v-for="item in applied.result.pending" :key="item.row.key">
                        <span class="mono">{{ item.row.sheetName }} · {{ item.row.rowNumber }}</span>
                        <span>{{ item.row.display.name || 'Sin nombre' }}</span>
                        <small>{{ item.reason }}</small>
                      </li>
                    </ul>
                    <p v-else class="tx-muted">No quedaron registros pendientes.</p>
                  </section>
                </div>
              </template>

              <template v-else>
                <div class="tx-review">
                  <section class="tx-review__main" data-od-id="transfer-final-review">
                    <h3>Qué va a cambiar</h3>
                    <p>Se aplicarán {{ rowCounts.created }} altas y {{ rowCounts.updated }} actualizaciones. Las actualizaciones conservan el ID permanente y solo escriben los campos presentes en el archivo.</p>
                    <div class="tx-kpis tx-kpis--compact">
                      <div class="tx-kpi"><span class="tx-kpi__label">Creados</span><strong class="tx-kpi__value">{{ rowCounts.created }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">Actualizados</span><strong class="tx-kpi__value">{{ rowCounts.updated }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">Omitidos</span><strong class="tx-kpi__value">{{ rowCounts.skipped }}</strong></div>
                      <div class="tx-kpi"><span class="tx-kpi__label">Pendientes</span><strong class="tx-kpi__value">{{ rowCounts.pending }}</strong></div>
                    </div>
                    <ul class="tx-issues">
                      <li class="tx-issue"><app-icon name="lock"></app-icon> Los campos vacíos del archivo no sobrescriben los valores existentes.</li>
                      <li class="tx-issue"><app-icon name="lock"></app-icon> El ID permanente de cada activo se conserva en las actualizaciones.</li>
                    </ul>
                    <p v-if="!canEdit" class="form-error" role="alert">Tu rol permite revisar la importación, pero no aplicarla. Solicita el permiso de edición de activos.</p>
                  </section>
                  <aside class="tx-review__side">
                    <h3>Decisiones</h3>
                    <ul class="tx-review__decisions">
                      <li><span>Conflictos sin decidir</span><strong class="mono">{{ conflicts.filter((row) => !decisionFor(row).action).length }}</strong></li>
                      <li><span>Actualizaciones</span><strong class="mono">{{ updateRows.length }}</strong></li>
                      <li><span>Altas</span><strong class="mono">{{ createRows.length }}</strong></li>
                      <li><span>Pendientes</span><strong class="mono">{{ rowCounts.pending }}</strong></li>
                    </ul>
                  </aside>
                </div>
              </template>

              <div class="tx-summary__actions">
                <div class="tx-summary__group">
                  <button v-if="!applied" type="button" class="btn btn--primary" data-od-id="transfer-apply" :disabled="!canEdit || applying" @click="openConfirm">
                    <app-icon name="upload"></app-icon> Aplicar importación
                  </button>
                  <button v-if="applied" type="button" class="btn btn--primary" data-od-id="transfer-view-inventory" @click="goInventory">Ver inventario</button>
                  <button v-if="applied" type="button" class="btn btn--secondary" data-od-id="transfer-download-report" @click="downloadReport">
                    <app-icon name="download"></app-icon> Descargar informe
                  </button>
                  <button v-if="applied" type="button" class="btn btn--ghost" @click="resetImport">Nueva importación</button>
                </div>
                <p v-if="applied" class="tx-muted">Registrado en el historial de importaciones del navegador.</p>
              </div>
            </div>
          </section>

          <footer class="tx-foot">
            <p class="tx-foot__note">{{ footNote }}</p>
            <div class="tx-foot__actions">
              <button v-if="step > 1 && !applied" type="button" class="btn btn--ghost" data-od-id="transfer-back" @click="previousStep">Volver</button>
              <button v-if="step < 5" type="button" class="btn btn--primary" data-od-id="transfer-continue" :disabled="!canContinue" @click="nextStep">Continuar</button>
            </div>
          </footer>
        </div>

        <aside class="tx-rail" aria-label="Contexto de la importación">
          <div class="tx-rail__card">
            <header class="tx-rail__head">
              <h3>Contexto</h3>
              <span class="tx-tag">{{ activeProfile ? activeProfile.name : 'Detección automática' }}</span>
            </header>
            <dl class="tx-summary-list">
              <div><dt>Archivo</dt><dd>{{ file ? file.name : '—' }}</dd></div>
              <div><dt>Formato</dt><dd>{{ file ? file.format.toUpperCase() : '—' }}</dd></div>
              <div><dt>Hojas</dt><dd>{{ selectedSheets.length }} de {{ file ? file.sheets.length : 0 }}</dd></div>
              <div><dt>Filas</dt><dd class="mono">{{ selectedRowCount }}</dd></div>
              <div><dt>Identificación</dt><dd>{{ identificationLabels.join(' · ') }}</dd></div>
            </dl>
            <div class="tx-rail__stats">
              <div><span class="mono">{{ applied ? applied.counts.created : rowCounts.created }}</span><small>creados</small></div>
              <div><span class="mono">{{ applied ? applied.counts.updated : rowCounts.updated }}</span><small>actualizados</small></div>
              <div><span class="mono">{{ applied ? applied.counts.pending : rowCounts.pending }}</span><small>pendientes</small></div>
            </div>
            <button type="button" class="text-button" @click="profilesOpen = true">
              <app-icon name="sliders"></app-icon> Gestionar perfiles
            </button>
          </div>

          <div class="tx-rail__card">
            <header class="tx-rail__head"><h3>Historial reciente</h3></header>
            <ul v-if="history.length" class="tx-rail-list">
              <li v-for="entry in history" :key="entry.id">
                <strong>{{ entry.fileName }}</strong>
                <span class="mono">{{ entry.counts.created }} creados · {{ entry.counts.updated }} actualizados</span>
                <small>{{ entry.profile }} · {{ formatTransferDate(entry.at) }}</small>
              </li>
            </ul>
            <p v-else class="tx-muted">Todavía no hay importaciones registradas.</p>
          </div>
        </aside>

        <transfer-profile-dialog :open="profilesOpen" kind="import" @close="profilesOpen = false"
                                @apply="applyProfile" @save="saveProfile"></transfer-profile-dialog>

        <modal-shell :open="confirmOpen" eyebrow="Confirmación" title="Confirmar importación" @close="confirmOpen = false">
          <p class="form-intro">Se aplicarán los cambios sobre el inventario actual. Revisa el detalle antes de continuar.</p>
          <div class="tx-kpis tx-kpis--compact">
            <div class="tx-kpi"><span class="tx-kpi__label">Creados</span><strong class="tx-kpi__value">{{ rowCounts.created }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">Actualizados</span><strong class="tx-kpi__value">{{ rowCounts.updated }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">Omitidos</span><strong class="tx-kpi__value">{{ rowCounts.skipped }}</strong></div>
            <div class="tx-kpi"><span class="tx-kpi__label">Pendientes</span><strong class="tx-kpi__value">{{ rowCounts.pending }}</strong></div>
          </div>

          <div class="tx-confirm-grid">
            <section data-od-id="transfer-confirm-updates">
              <h3>Activos que se actualizan</h3>
              <ul v-if="updateRows.length" class="tx-confirm-list">
                <li v-for="row in updateRows" :key="row.key">
                  <span class="mono">{{ row.primaryCandidateId }}</span>
                  <span>{{ row.display.name }}</span>
                  <small>{{ changedLabels(row) }}</small>
                </li>
              </ul>
              <p v-else class="tx-muted">Ningún activo existente cambia.</p>
            </section>
            <section data-od-id="transfer-confirm-creates">
              <h3>Altas previstas</h3>
              <p class="tx-confirm-count mono">{{ createRows.length }}</p>
              <p class="tx-muted">Cada alta recibe un ID permanente nuevo y un código generado con las reglas del sistema.</p>
            </section>
          </div>

          <ul class="tx-issues">
            <li class="tx-issue"><app-icon name="lock"></app-icon> El ID permanente de los activos existentes no cambia.</li>
            <li class="tx-issue"><app-icon name="lock"></app-icon> Los campos vacíos del archivo no sobrescriben valores.</li>
          </ul>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="confirmOpen = false">Cancelar</button>
            <button type="button" class="btn btn--primary" data-od-id="transfer-confirm-apply" :disabled="applying" @click="applyImport">Aplicar importación</button>
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
        if (state === 'loading') return 'Cargando inventario…';
        if (state === 'error') return 'Inventario no disponible';
        if (state !== 'ready') return '';
        const total = Number(this.app.inventory.total) || 0;
        return total === 1 ? '1 activo' : total + ' activos';
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
            <p class="eyebrow"><span class="eyebrow__line"></span> Entrada y salida de datos</p>
            <h1 id="transfer-title">Importar y exportar</h1>
            <p class="page-sub">Importa activos desde un archivo o exporta el inventario.</p>
          </div>
          <div class="page-head__side">
            <div class="page-head__meta" aria-label="Resumen del módulo">
              <span v-if="inventoryCountLabel" class="mono">{{ inventoryCountLabel }}</span>
              <span v-if="inventoryCountState === 'ready' && app.inventoryFiltersActive">inventario filtrado</span>
              <span>{{ profileCount }} perfiles · {{ customCount }} propios</span>
            </div>
          </div>
        </header>

        <div class="tx-tabs" role="tablist" aria-label="Flujos de datos">
          <button type="button" role="tab" id="tx-tab-import" class="tx-tab"
                  :class="{ 'is-active': tab === 'import' }" :aria-selected="tab === 'import' ? 'true' : 'false'"
                  aria-controls="tx-panel-import" data-od-id="transfer-tab-import" @click="setTab('import')">
            <span class="tx-tab__icon"><app-icon name="upload"></app-icon></span>
            <span class="tx-tab__text"><strong>Importar</strong><small>Excel y CSV al inventario</small></span>
          </button>
          <button type="button" role="tab" id="tx-tab-export" class="tx-tab"
                  :class="{ 'is-active': tab === 'export' }" :aria-selected="tab === 'export' ? 'true' : 'false'"
                  aria-controls="tx-panel-export" data-od-id="transfer-tab-export" @click="setTab('export')">
            <span class="tx-tab__icon"><app-icon name="download"></app-icon></span>
            <span class="tx-tab__text"><strong>Exportar</strong><small>Inventario a Excel y CSV</small></span>
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
