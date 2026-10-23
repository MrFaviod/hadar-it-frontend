(function () {
  'use strict';

  /* Phase 6 workspace surfaces.
   *
   * These components replace the prototype import wizard, warranty center and
   * bulk editor on the routes that already existed. Every value comes from the
   * Phase 6 adapter: the server parses the file, classifies the rows, keeps the
   * preview, requires a human approval and executes with stored permissions.
   * No demo file, placeholder row or browser-stored preference is read here.
   */
  const Views = (window.AssetPhase6Views = window.AssetPhase6Views || {});

  const CATEGORY_LABELS = {
    photo: 'Fotografía',
    receipt: 'Comprobante',
    manual: 'Manual',
    document: 'Documento'
  };
  const WARRANTY_STATUSES = ['active', 'cancelled', 'claimed', 'unknown'];
  const WARRANTY_STATUS_LABELS = {
    active: 'Vigente',
    cancelled: 'Cancelada',
    claimed: 'Reclamada',
    unknown: 'Sin estado'
  };
  const COVERAGE_LABELS = {
    '': 'Todas',
    current: 'Vigentes',
    expiring: 'Próximas a vencer',
    expired: 'Vencidas',
    unknown: 'Sin datos'
  };
  const COVERAGE_TONES = { current: 'ok', expiring: 'warn', expired: 'down', unknown: 'hold' };
  const CLASS_LABELS = {
    new: 'Nuevo',
    safe: 'Coincidencia segura',
    possible_duplicate: 'Posible duplicado',
    error: 'Con errores',
    omitted: 'Omitido'
  };
  const CLASS_TONES = { new: 'ok', safe: 'ok', possible_duplicate: 'warn', error: 'down', omitted: 'hold' };
  const STATE_LABELS = {
    preview: 'Previsualización',
    approved: 'Aprobada',
    queued: 'En cola',
    running: 'Ejecutando',
    complete: 'Completada',
    queue_error: 'Error de cola',
    error: 'Con errores'
  };
  const BULK_ACTIONS = [
    { id: 'update', label: 'Editar campos' },
    { id: 'assign', label: 'Modificar responsable' },
    { id: 'transfer', label: 'Trasladar entre ubicaciones' },
    { id: 'archive', label: 'Archivar activos' }
  ];
  const IMPORT_FIELDS = [
    { id: 'name', label: 'Nombre' },
    { id: 'quick_code', label: 'Código rápido' },
    { id: 'category', label: 'Categoría' },
    { id: 'type', label: 'Tipo' },
    { id: 'brand', label: 'Marca' },
    { id: 'model', label: 'Modelo' },
    { id: 'serial', label: 'Número de serie' },
    { id: 'ip', label: 'Dirección IP' },
    { id: 'site', label: 'Sede' },
    { id: 'location', label: 'Ubicación' },
    { id: 'responsible', label: 'Responsable' },
    { id: 'status', label: 'Estado' },
    { id: 'cost', label: 'Coste' },
    { id: 'description', label: 'Descripción' }
  ];
  const EXPORT_FIELD_LABELS = {
    id: 'ID permanente',
    quick_code: 'Código rápido',
    name: 'Nombre',
    category: 'Categoría',
    status: 'Estado',
    serial: 'Número de serie',
    site: 'Sede',
    location: 'Ubicación',
    responsible: 'Responsable'
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
    return COVERAGE_LABELS[text(value)] || COVERAGE_LABELS.unknown;
  }

  function coverageTone(value) {
    return COVERAGE_TONES[text(value)] || 'hold';
  }

  function statusLabel(value) {
    return WARRANTY_STATUS_LABELS[text(value)] || WARRANTY_STATUS_LABELS.unknown;
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[text(value)] || CATEGORY_LABELS.document;
  }

  function classLabel(value) {
    return CLASS_LABELS[text(value)] || 'Sin clasificar';
  }

  function classTone(value) {
    return CLASS_TONES[text(value)] || 'hold';
  }

  function stateLabel(value) {
    return STATE_LABELS[text(value)] || 'Sin estado';
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
        return Object.keys(seen).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
      },
      fieldChoices() {
        const choices = IMPORT_FIELDS.slice();
        const catalog = this.app.inventoryCatalog;
        const fields = catalog && Array.isArray(catalog.fields) ? catalog.fields : [];
        fields
          .filter((field) => field.active !== false)
          .forEach((field) => {
            choices.push({ id: 'technical.' + field.key, label: field.label + ' (campo propio)' });
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
          this.message = 'Necesitas permiso para editar activos.';
          return false;
        }
        if (!this.file) {
          this.message = 'Selecciona un archivo CSV o XLSX.';
          return false;
        }
        this.busy = true;
        this.message = '';
        const result = await this.app.analyzeImport(this.file, this.analysisOptions());
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || 'No se pudo analizar el archivo.';
          return false;
        }
        this.step = 2;
        this.message = 'Análisis completado. Revisa la correspondencia y los conflictos antes de aprobar.';
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
            this.errors = Object.assign({}, this.errors, { [row.index]: 'Escribe el ID permanente del activo que se actualiza.' });
            return false;
          }
          if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) {
            this.errors = Object.assign({}, this.errors, { [row.index]: 'El ID permanente debe ser un UUID.' });
            return false;
          }
          extra.assetId = assetId;
        }
        this.errors = Object.assign({}, this.errors, { [row.index]: '' });
        const result = await this.app.resolvePhase6Row(row.index, action, extra);
        if (!result || !result.ok) {
          this.errors = Object.assign({}, this.errors, { [row.index]: (result && result.error) || 'No se pudo guardar la decisión.' });
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
          ? 'Previsualización aprobada. La ejecución revalidará tus permisos y la versión de cada activo.'
          : (result && result.error) || '';
        return !!(result && result.ok);
      },
      async execute() {
        this.busy = true;
        const result = await this.app.executePhase6Operation();
        this.busy = false;
        this.step = 4;
        this.message = result && result.ok ? '' : (result && result.error) || 'No se pudo aplicar la operación.';
        return !!(result && result.ok);
      },
      async enqueue() {
        this.busy = true;
        const result = await this.app.enqueuePhase6Operation();
        this.busy = false;
        if (result && result.ok) {
          this.step = 4;
          this.app.startPhase6Polling();
          this.message = 'importación enviada al trabajador en segundo plano.';
        } else {
          this.message = (result && result.error) || 'No se pudo enviar el trabajo.';
        }
        return !!(result && result.ok);
      },
      async refresh() {
        const ok = await this.app.refreshPhase6Operation();
        if (!ok) this.message = 'No se pudo consultar la operación.';
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
          this.message = 'Escribe un nombre para el perfil.';
          return false;
        }
        const result = await this.app.saveImportProfile(name, this.analysisOptions());
        this.message = result && result.ok ? 'Perfil guardado.' : (result && result.error) || '';
        if (result && result.ok) this.profileName = '';
        return !!(result && result.ok);
      },
      async removeProfile(profile) {
        const result = await this.app.deleteImportProfile(profile.id);
        this.message = result && result.ok ? 'Perfil eliminado.' : (result && result.error) || '';
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
        return EXPORT_FIELD_LABELS[field] || field;
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
            this.message = 'No hay activos seleccionados en el inventario.';
            return false;
          }
          input.assetIds = this.selectionIds;
        } else {
          input.filters = this.exportFiltersBody();
          if (!Object.keys(input.filters).length) {
            this.message = 'Elige al menos un filtro o exporta la selección del inventario.';
            return false;
          }
        }
        this.busy = true;
        const result = await this.app.exportPhase6Assets(input);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || 'No se pudo exportar.';
          return false;
        }
        if (!saveBlob(result.blob, result.filename)) {
          this.message = 'No se pudo descargar el archivo.';
          return false;
        }
        this.message = 'La exportación se ha descargado.';
        return true;
      }
    },
    template: `
      <section class="phase6-page">
        <header class="page-head">
          <div>
            <p class="eyebrow">Datos</p>
            <h1>Importación y exportación</h1>
            <p>El servidor analiza los archivos, conserva la previsualización y exige una aprobación humana antes de aplicar cambios.</p>
          </div>
          <div class="page-head__actions">
            <div class="chip-filter" role="tablist" aria-label="Sección de datos">
              <button type="button" role="tab" class="chip" :class="{ 'is-active': tab === 'import' }" :aria-selected="tab === 'import'" @click="selectTab('import')">Importar</button>
              <button type="button" role="tab" class="chip" :class="{ 'is-active': tab === 'export' }" :aria-selected="tab === 'export'" @click="selectTab('export')">Exportar</button>
            </div>
          </div>
        </header>

        <div v-if="message" class="config-note" role="status">{{ message }}</div>

        <div v-if="tab === 'import'" class="tx-main">
          <ol class="flow-steps flow-steps--four">
            <li v-for="index in stepCount" :key="index" class="flow-step" :class="{ 'is-active': step === index }">
              <span class="flow-step__num">{{ index }}</span>
              <span class="flow-step__copy">{{ ['Archivo y opciones', 'Correspondencia', 'Previsualización y conflictos', 'Resultado'][index - 1] }}</span>
            </li>
          </ol>

          <section v-if="step === 1" class="tx-block" aria-labelledby="phase6-file-title">
            <header class="tx-block__head">
              <h2 id="phase6-file-title">Archivo y opciones de análisis</h2>
              <span class="chip chip--muted">CSV o XLSX · 10 MiB</span>
            </header>
            <div class="field">
              <label class="field__label" for="phase6-file">Archivo</label>
              <input id="phase6-file" class="input-shell" type="file" accept=".csv,.xlsx" @change="onFile">
            </div>
            <div class="phase6-grid">
              <div class="field">
                <label class="field__label" for="phase6-profile">Perfil de importación</label>
                <select id="phase6-profile" class="input-shell" v-model="profileId">
                  <option value="">Sin perfil</option>
                  <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                </select>
                <button type="button" class="btn btn--ghost btn--small" @click="useProfile">Aplicar perfil</button>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-delimiter">Separador CSV</label>
                <select id="phase6-delimiter" class="input-shell" :value="options.delimiter" @change="setOption('delimiter', $event.target.value)">
                  <option value="">Detectar</option>
                  <option value=",">Coma (,)</option>
                  <option value=";">Punto y coma (;)</option>
                  <option value="\t">Tabulador</option>
                  <option value="|">Barra vertical (|)</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-encoding">Codificación</label>
                <select id="phase6-encoding" class="input-shell" :value="options.encoding" @change="setOption('encoding', $event.target.value)">
                  <option value="">Detectar</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="utf-8-sig">UTF-8 con BOM</option>
                  <option value="cp1252">Windows-1252</option>
                  <option value="latin-1">Latin-1</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="phase6-header">Fila de encabezados</label>
                <input id="phase6-header" class="input-shell" type="number" min="1" max="100" :value="options.headerRow" @input="setOption('headerRow', Number($event.target.value) || 1)">
              </div>
              <div class="field">
                <label class="field__label" for="phase6-category">Categoría por defecto</label>
                <input id="phase6-category" class="input-shell" :value="options.category" @input="setOption('category', $event.target.value)">
              </div>
            </div>
            <label class="bulk-field__toggle">
              <input type="checkbox" :checked="options.siteFromSheet" @change="setOption('siteFromSheet', $event.target.checked)">
              <span>Identificar la sede por el nombre de la hoja</span>
            </label>
            <label class="bulk-field__toggle">
              <input type="checkbox" :checked="options.overwriteEmpty" @change="setOption('overwriteEmpty', $event.target.checked)">
              <span>Sobrescribir con valores vacíos los campos del archivo</span>
            </label>
            <div class="tx-chips" role="group" aria-label="Criterios de coincidencia">
              <button v-for="field in ['quick_code','serial','ip']" :key="field" type="button" class="tx-chip" :class="{ 'is-active': matchFieldOn(field) }" :aria-pressed="matchFieldOn(field)" @click="toggleMatchField(field)">
                {{ field === 'quick_code' ? 'Código rápido' : field === 'serial' ? 'Número de serie' : 'IP' }}
              </button>
            </div>
            <div class="tx-foot">
              <p class="tx-foot__note">Ningún registro cambia en esta fase. Los campos vacíos conservan el valor existente salvo que lo marques arriba.</p>
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--primary" :disabled="busy || !file || !canEdit" @click="runAnalysis">
                  <app-icon name="upload"></app-icon> Analizar archivo
                </button>
              </div>
            </div>
          </section>

          <section v-if="step === 2" class="tx-block" aria-labelledby="phase6-mapping-title">
            <header class="tx-block__head">
              <h2 id="phase6-mapping-title">Correspondencia de columnas</h2>
              <span class="chip chip--muted">{{ columns.length }} columnas detectadas</span>
            </header>
            <p v-if="!columns.length" class="config-note">El servidor no devolvió columnas. Revisa el archivo y vuelve a analizarlo.</p>
            <div v-for="column in columns" :key="column" class="tx-map__row">
              <span class="tx-label mono">{{ column }}</span>
              <select class="input-shell" :value="mapping[column] || ''" @change="setMapping(column, $event.target.value)">
                <option value="">No importar</option>
                <option v-for="field in fieldChoices" :key="field.id" :value="field.id">{{ field.label }}</option>
              </select>
            </div>
            <div class="tx-foot">
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--ghost" @click="step = 1">Volver</button>
                <button type="button" class="btn btn--primary" :disabled="busy" @click="reanalyzeWithMapping">Analizar con esta correspondencia</button>
              </div>
            </div>
          </section>

          <section v-if="step >= 3" class="tx-block" aria-labelledby="phase6-preview-title">
            <header class="tx-block__head">
              <h2 id="phase6-preview-title">Previsualización</h2>
              <span class="chip" :class="'status status--' + (state === 'complete' ? 'ok' : state === 'error' ? 'down' : 'hold')">{{ stateLabel(state) }}</span>
            </header>
            <div class="tx-kpis">
              <div class="tx-kpi"><span class="tx-kpi__label">Nuevos</span><span class="tx-kpi__value">{{ counts.new }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Coincidencias seguras</span><span class="tx-kpi__value">{{ counts.safe }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Posibles duplicados</span><span class="tx-kpi__value">{{ counts.possible_duplicate }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Con errores</span><span class="tx-kpi__value">{{ counts.error }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Procesados</span><span class="tx-kpi__value">{{ operation.processed }} / {{ operation.total }}</span></div>
            </div>
            <p v-if="operation.jobId" class="config-note mono">Trabajo {{ operation.jobId }}</p>
            <p v-if="operation.error" class="field__error" role="alert">{{ operation.error }}</p>

            <div v-if="conflicts.length" class="tx-conflicts" aria-labelledby="phase6-conflicts-title">
              <h3 id="phase6-conflicts-title">Conflictos que requieren revisión</h3>
              <article v-for="row in conflicts" :key="row.index" class="tx-conflict">
                <header class="tx-conflict__head">
                  <span class="status" :class="'status--' + classTone(row.classification)">{{ classLabel(row.classification) }}</span>
                  <span class="mono">{{ row.sheet }} · línea {{ row.line }}</span>
                </header>
                <p class="tx-conflict__reason">{{ row.errors.length ? row.errors.join(' · ') : 'Coincidencia ambigua con un activo existente.' }}</p>
                <div class="tx-conflict__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="resolve(row, 'skip')">Omitir</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="resolve(row, 'create')">Crear como nuevo</button>
                  <label class="tx-label">
                    ID permanente existente
                    <input class="input-shell" :value="(resolving[row.index] || {}).assetId || row.assetId || ''" @input="setResolution(row.index, $event.target.value)">
                  </label>
                  <button type="button" class="btn btn--secondary btn--small" @click="resolve(row, 'update')">Actualizar este activo</button>
                </div>
                <p v-if="errors[row.index]" class="field__error" role="alert">{{ errors[row.index] }}</p>
              </article>
            </div>

            <div class="phase6-table" role="table" aria-label="Filas analizadas">
              <div class="phase6-row phase6-row--head" role="row">
                <span role="columnheader">Clasificación</span>
                <span role="columnheader">Hoja y línea</span>
                <span role="columnheader">Valores</span>
                <span role="columnheader">Resultado</span>
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
                <button type="button" class="btn btn--ghost" @click="step = 2">Correspondencia</button>
                <button type="button" class="btn btn--ghost" @click="refresh">Actualizar</button>
                <button type="button" class="btn btn--primary" :disabled="!canApprove || busy" @click="approve">Aprobar previsualización</button>
                <button type="button" class="btn btn--primary" :disabled="!canExecute || busy" @click="execute">Ejecutar ahora</button>
                <button type="button" class="btn btn--secondary" :disabled="!canExecute || busy" @click="enqueue">Enviar a segundo plano</button>
              </div>
            </div>
          </section>

          <section v-if="step === 4" class="tx-block tx-block--result" aria-labelledby="phase6-result-title">
            <header class="tx-block__head">
              <h2 id="phase6-result-title">Resultado</h2>
              <span class="chip" :class="'status status--' + (operation.state === 'complete' ? 'ok' : 'down')">{{ stateLabel(operation.state) }}</span>
            </header>
            <div class="tx-kpis tx-kpis--result">
              <div class="tx-kpi"><span class="tx-kpi__label">Creados</span><span class="tx-kpi__value">{{ summary.created }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Modificados</span><span class="tx-kpi__value">{{ summary.modified }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Omitidos</span><span class="tx-kpi__value">{{ summary.omitted }}</span></div>
              <div class="tx-kpi"><span class="tx-kpi__label">Fallidos</span><span class="tx-kpi__value">{{ summary.failed }}</span></div>
            </div>
            <p class="tx-foot__note">Los registros ya procesados no se repiten: reintentar la operación continúa desde el estado guardado.</p>
            <div class="tx-foot__actions">
              <button type="button" class="btn btn--ghost" @click="refresh">Consultar estado</button>
              <button type="button" class="btn btn--primary" @click="startNew">Nueva importación</button>
            </div>
          </section>

          <section class="tx-block" aria-labelledby="phase6-profiles-title">
            <header class="tx-block__head">
              <h2 id="phase6-profiles-title">Perfiles de importación</h2>
              <span class="chip chip--muted">{{ profiles.length }} perfiles</span>
            </header>
            <ul class="phase6-list">
              <li v-for="profile in profiles" :key="profile.id" class="phase6-list__item">
                <span>{{ profile.name }}</span>
                <span class="mono cell-note">{{ Object.keys(profile.options || {}).join(', ') || 'Sin opciones' }}</span>
                <span class="phase6-list__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="profileId = profile.id; useProfile()">Usar</button>
                  <button type="button" class="btn btn--ghost btn--small" :disabled="!canEdit" @click="removeProfile(profile)">Eliminar</button>
                </span>
              </li>
            </ul>
            <div class="phase6-grid">
              <label class="field">
                <span class="field__label">Guardar opciones actuales como perfil</span>
                <input class="input-shell" v-model="profileName" placeholder="Nombre del perfil">
              </label>
              <button type="button" class="btn btn--secondary" :disabled="!canEdit || !profileName.trim()" @click="saveProfile">Guardar perfil</button>
            </div>
          </section>
        </div>

        <div v-if="tab === 'export'" class="tx-main">
          <section class="tx-block" aria-labelledby="phase6-export-title">
            <header class="tx-block__head">
              <h2 id="phase6-export-title">Exportación de activos</h2>
              <span class="chip chip--muted">CSV del servidor</span>
            </header>
            <div class="tx-filterbar">
              <label class="tx-label">
                Origen
                <select class="input-shell" v-model="exportSelection">
                  <option value="filters">Filtros</option>
                  <option value="selection">Selección del inventario ({{ selectionIds.length }})</option>
                </select>
              </label>
            </div>
            <div v-if="exportSelection === 'filters'" class="phase6-grid">
              <label class="field"><span class="field__label">Categoría</span><input class="input-shell" v-model="exportFilters.category"></label>
              <label class="field"><span class="field__label">Estado</span>
                <select class="input-shell" v-model="exportFilters.status">
                  <option value="">Todos</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="field"><span class="field__label">ID de sede</span><input class="input-shell" v-model="exportFilters.site_id"></label>
              <label class="field"><span class="field__label">ID de ubicación</span><input class="input-shell" v-model="exportFilters.location_id"></label>
              <label class="field"><span class="field__label">Archivados</span>
                <select class="input-shell" v-model="exportFilters.archived">
                  <option value="">Cualquiera</option>
                  <option value="false">Solo activos</option>
                  <option value="true">Solo archivados</option>
                </select>
              </label>
            </div>
            <fieldset class="phase6-fieldset">
              <legend>Campos</legend>
              <label v-for="field in app.phase6ExportFields" :key="field" class="bulk-field__toggle">
                <input type="checkbox" :checked="exportFieldOn(field)" @change="toggleExportField(field)">
                <span>{{ exportFieldLabel(field) }}</span>
              </label>
            </fieldset>
            <div class="tx-foot">
              <p class="tx-foot__note">El servidor aplica los permisos de lectura y no incluye columnas que no solicites.</p>
              <div class="tx-foot__actions">
                <button type="button" class="btn btn--primary" :disabled="busy || !app.phase6CanView" @click="runExport">Descargar CSV</button>
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
          this.message = 'Necesitas permiso para editar activos.';
          return false;
        }
        const input = { action: this.action, changes: this.changesBody(), filters: this.filtersBody() };
        if (this.useSelection) input.assetIds = this.ids.slice();
        if (this.reason) input.reason = this.reason;
        if (!this.useSelection && !Object.keys(input.filters).length) {
          this.message = 'Elige al menos un filtro o selecciona activos en el inventario.';
          return false;
        }
        if (this.action === 'archive' && text(this.reason).length < 4) {
          this.message = 'Escribe el motivo del archivado (4 caracteres o más).';
          return false;
        }
        this.busy = true;
        this.message = '';
        const result = await this.app.bulkPreviewPhase6(input);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || 'No se pudo preparar la previsualización.';
          return false;
        }
        this.step = 2;
        return true;
      },
      async resolve(row) {
        const result = await this.app.resolvePhase6Row(row.index, 'skip', {});
        if (!result || !result.ok) {
          this.message = (result && result.error) || 'No se pudo omitir la fila.';
          return false;
        }
        return true;
      },
      async approve() {
        const result = await this.app.approvePhase6Operation();
        this.message = result && result.ok ? 'Previsualización aprobada.' : (result && result.error) || '';
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
          this.message = (result && result.error) || 'No se pudo aplicar la operación.';
        }
        return !!(result && result.ok);
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Editor masivo" eyebrow="Operación por lote" @close="close">
        <div class="bulk-body">
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <ol class="flow-steps flow-steps--four">
            <li class="flow-step" :class="{ 'is-active': step === 1 }"><span class="flow-step__num">1</span><span class="flow-step__copy">Activos</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 2 }"><span class="flow-step__num">2</span><span class="flow-step__copy">Vista previa</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 3 }"><span class="flow-step__num">3</span><span class="flow-step__copy">Aprobación</span></li>
            <li class="flow-step" :class="{ 'is-active': step === 4 }"><span class="flow-step__num">4</span><span class="flow-step__copy">Resultado</span></li>
          </ol>

          <template v-if="step === 1">
            <p class="bulk-lead">{{ useSelection ? 'Se modifican los ' + ids.length + ' activos seleccionados.' : 'Se modifican los activos que cumplen los filtros.' }}</p>
            <div v-if="!useSelection" class="bulk-fields">
              <label class="field"><span class="field__label">Categoría</span><input class="input-shell" :value="filters.category" @input="setFilter('category', $event.target.value)"></label>
              <label class="field"><span class="field__label">Estado</span>
                <select class="input-shell" :value="filters.status" @change="setFilter('status', $event.target.value)">
                  <option value="">Todos</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label class="field"><span class="field__label">ID de sede</span><input class="input-shell" :value="filters.site_id" @input="setFilter('site_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">ID de ubicación</span><input class="input-shell" :value="filters.location_id" @input="setFilter('location_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">ID de responsable</span><input class="input-shell" :value="filters.responsible_person_id" @input="setFilter('responsible_person_id', $event.target.value)"></label>
              <label class="field"><span class="field__label">Archivados</span>
                <select class="input-shell" :value="filters.archived" @change="setFilter('archived', $event.target.value)">
                  <option value="">Cualquiera</option>
                  <option value="false">Solo activos</option>
                  <option value="true">Solo archivados</option>
                </select>
              </label>
            </div>
            <div class="field">
              <label class="field__label" for="bulk-action">Operación</label>
              <select id="bulk-action" class="input-shell" v-model="action">
                <option v-for="item in actions" :key="item.id" :value="item.id">{{ item.label }}</option>
              </select>
            </div>
            <div class="bulk-fields">
              <label v-if="action === 'update'" class="field"><span class="field__label">Estado</span>
                <select class="input-shell" :value="changes.status" @change="setChange('status', $event.target.value)">
                  <option value="">Sin cambio</option>
                  <option v-for="status in statusChoices" :key="status.value" :value="status.value">{{ status.label }}</option>
                </select>
              </label>
              <label v-if="action === 'update'" class="field"><span class="field__label">Categoría</span><input class="input-shell" :value="changes.category" @input="setChange('category', $event.target.value)"></label>
              <label v-if="action === 'assign' || action === 'update'" class="field"><span class="field__label">ID de responsable</span><input class="input-shell" :value="changes.responsible_person_id" @input="setChange('responsible_person_id', $event.target.value)"></label>
              <label v-if="action === 'transfer' || action === 'update'" class="field"><span class="field__label">ID de ubicación</span><input class="input-shell" :value="changes.location_id" @input="setChange('location_id', $event.target.value)"></label>
            </div>
            <label v-if="action === 'archive'" class="field">
              <span class="field__label">Motivo</span>
              <textarea class="input-shell" :value="reason" @input="reason = $event.target.value"></textarea>
            </label>
            <p class="bulk-warning">Los campos no seleccionados conservan su valor y cada activo recibe su propio historial.</p>
          </template>

          <template v-if="step === 2">
            <p class="bulk-lead">{{ rows.length }} activos en la previsualización · {{ conflicts.length }} con errores</p>
            <div class="bulk-preview">
              <div v-for="row in rows" :key="row.index" class="bulk-preview__row">
                <span class="bulk-preview__asset mono">{{ row.assetId || '—' }}</span>
                <span class="status" :class="'status--' + (classTone(row.classification))">{{ classLabel(row.classification) }}</span>
                <span class="mono truncate">{{ Object.keys(row.values || {}).map(key => key + ': ' + row.values[key]).join(' · ') }}</span>
                <span v-if="row.error" class="cell-note">{{ row.error }}</span>
                <button v-if="row.classification === 'error'" type="button" class="btn btn--ghost btn--small" @click="resolve(row)">Omitir</button>
              </div>
            </div>
            <p class="bulk-warning">Una aprobación autoriza exactamente estos activos y valores. Si cambian, hay que preparar otra previsualización.</p>
          </template>

          <template v-if="step === 3">
            <p class="bulk-lead">Estado: {{ stateLabel(state) }}<span v-if="operation && operation.jobId"> · trabajo {{ operation.jobId }}</span></p>
            <div class="bulk-summary">
              <div class="bulk-summary__value"><span class="bulk-summary__label">Procesados</span><strong>{{ operation ? operation.processed : 0 }} / {{ operation ? operation.total : 0 }}</strong></div>
            </div>
          </template>

          <template v-if="step === 4">
            <div class="bulk-summary">
              <div class="bulk-summary__value"><span class="bulk-summary__label">Modificados</span><strong>{{ summary.modified }}</strong></div>
              <div class="bulk-summary__value"><span class="bulk-summary__label">Omitidos</span><strong>{{ summary.omitted }}</strong></div>
              <div class="bulk-summary__value"><span class="bulk-summary__label">Fallidos</span><strong>{{ summary.failed }}</strong></div>
            </div>
            <p class="bulk-warning">Los activos fallidos conservan su estado anterior; puedes reintentar la misma operación sin duplicar los ya procesados.</p>
          </template>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="close">Cerrar</button>
          <button v-if="step === 1" type="button" class="btn btn--primary" :disabled="busy || !canEdit" @click="preview">Previsualizar</button>
          <button v-if="step === 2" type="button" class="btn btn--secondary" :disabled="!canApprove || busy" @click="approve">Aprobar</button>
          <button v-if="step === 3" type="button" class="btn btn--primary" :disabled="!canExecute || busy" @click="execute">Ejecutar</button>
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
            this.message = (result && result.error) || 'No se pudo guardar la garantía.';
            return false;
          }
          this.editor.open = false;
          this.message = 'Garantía guardada.';
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
            this.message = (result && result.error) || 'No se pudo eliminar la garantía.';
            return false;
          }
          this.confirmDelete = false;
          this.editor.open = false;
          this.message = 'Garantía eliminada.';
          this.reload();
          return true;
        });
      }
    },
    template: `
      <section class="phase6-page warranties-page">
        <header class="page-head">
          <div>
            <p class="eyebrow">Garantías</p>
            <h1>Garantías individuales</h1>
            <p>Los vencimientos se calculan con los datos guardados en el servidor; no hay garantías compartidas.</p>
          </div>
        </header>
        <div class="chip-filter" role="group" aria-label="Cobertura de garantías">
          <button v-for="value in coverages" :key="value" type="button" class="chip" :class="{ 'is-active': coverage === value }" :aria-pressed="coverage === value" @click="setCoverage(value)">{{ coverageLabel(value) }}</button>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="state.loading" class="config-note" role="status">Consultando garantías…</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!items.length" class="config-note">No hay garantías registradas para esta cobertura.</p>
        <template v-else>
          <div class="phase6-table" role="table" aria-label="Garantías registradas">
            <div class="phase6-row phase6-row--head" role="row">
              <span role="columnheader">Activo</span>
              <span role="columnheader">Proveedor</span>
              <span role="columnheader">Compra y vencimiento</span>
              <span role="columnheader">Cobertura</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Acciones</span>
            </div>
            <div v-for="item in items" :key="item.assetId" class="phase6-row" role="row">
              <span role="cell" class="truncate">{{ assetLabel(item.assetId) }}</span>
              <span role="cell">{{ item.supplier || '—' }}</span>
              <span role="cell" class="mono">{{ formatDate(item.purchaseDate) || '—' }} → {{ formatDate(item.expiresOn) || '—' }}</span>
              <span role="cell"><span class="status" :class="'status--' + coverageTone(item.coverage)">{{ coverageLabel(item.coverage) }}</span></span>
              <span role="cell">{{ statusLabel(item.status) }}</span>
              <span role="cell"><button type="button" class="btn btn--ghost btn--small" @click="openEditor(item)">{{ canEdit ? 'Editar' : 'Consultar' }}</button></span>
            </div>
          </div>
          <button v-if="state.hasMore" type="button" class="btn btn--secondary btn--small" @click="loadMore">Cargar más garantías</button>
        </template>

        <modal-shell :open="editor.open" :title="'Garantía del activo'" eyebrow="Garantía individual" @close="closeEditor">
          <div class="phase6-grid">
            <p class="mono phase6-span">{{ editor.assetId }}</p>
            <label class="field"><span class="field__label">Proveedor</span><input class="input-shell" v-model="editor.supplier" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">Fecha de compra</span><input class="input-shell" type="date" v-model="editor.purchaseDate" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">Duración en meses</span><input class="input-shell" type="number" min="1" max="1200" v-model="editor.durationMonths" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">Vencimiento</span><input class="input-shell" type="date" v-model="editor.expiresOn" :disabled="!canEdit"></label>
            <label class="field"><span class="field__label">Estado</span>
              <select class="input-shell" v-model="editor.status" :disabled="!canEdit">
                <option v-for="status in ['active','cancelled','claimed','unknown']" :key="status" :value="status">{{ statusLabel(status) }}</option>
              </select>
            </label>
            <label class="field"><span class="field__label">Comprobante</span>
              <select class="input-shell" v-model="editor.receiptId" :disabled="!canEdit">
                <option value="">Sin comprobante</option>
                <option v-for="file in receipts" :key="file.id" :value="file.id">{{ file.filename }} · {{ formatSize(file.size) }}</option>
              </select>
            </label>
            <label class="field phase6-span"><span class="field__label">Observaciones</span><textarea class="input-shell" v-model="editor.notes" :disabled="!canEdit"></textarea></label>
          </div>
          <p v-if="message" class="config-note" role="status">{{ message }}</p>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeEditor">Cerrar</button>
            <button v-if="canEdit" type="button" class="btn btn--ghost" :disabled="busy" @click="remove">{{ confirmDelete ? 'Confirmar eliminación' : 'Eliminar garantía' }}</button>
            <button v-if="canEdit" type="button" class="btn btn--primary" :disabled="busy" @click="save">Guardar</button>
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
        this.message = result && result.ok ? 'Preferencia guardada.' : '';
        this.error = result && !result.ok ? (result.error || '') : '';
        return !!(result && result.ok);
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-warranty-settings-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">Garantías</p>
            <h2 id="phase6-warranty-settings-title">Aviso de vencimiento próximo</h2>
          </div>
        </header>
        <p class="config-note">Días de antelación con los que una garantía se considera próxima a vencer.</p>
        <div class="phase6-grid">
          <label class="field">
            <span class="field__label">Días antes del vencimiento</span>
            <input class="input-shell" type="number" min="1" max="365" v-model.number="days" :disabled="!canEdit">
          </label>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="error" class="field__error" role="alert">{{ error }}</p>
        <button type="button" class="btn btn--primary" :disabled="!canEdit || busy" @click="save">Guardar preferencia</button>
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
          this.message = (result && result.error) || 'No se pudo guardar la garantía.';
          return false;
        }
        this.editing = false;
        this.message = 'Garantía guardada.';
        return true;
      },
      async remove() {
        this.busy = true;
        const result = await this.app.deleteAssetWarranty(this.asset.id);
        this.busy = false;
        if (!result || !result.ok) {
          this.message = (result && result.error) || 'No se pudo eliminar la garantía.';
          return false;
        }
        this.message = 'Garantía eliminada.';
        return true;
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-asset-warranty-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">Garantía</p>
            <h2 id="phase6-asset-warranty-title">Garantía individual</h2>
          </div>
          <span v-if="item" class="status" :class="'status--' + coverageTone(item.coverage)">{{ coverageLabel(item.coverage) }}</span>
          <button v-if="canEdit && !editing" type="button" class="btn btn--ghost btn--small" @click="startEdit">{{ item ? 'Editar' : 'Registrar garantía' }}</button>
        </header>
        <p v-if="state.loading" class="config-note" role="status">Consultando la garantía…</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!item && !editing" class="config-note">Este activo no tiene garantía registrada.</p>
        <dl v-else-if="item && !editing" class="phase6-details">
          <div><dt>Proveedor</dt><dd>{{ item.supplier || 'Sin proveedor' }}</dd></div>
          <div><dt>Fecha de compra</dt><dd class="mono">{{ formatDate(item.purchaseDate) || 'Sin fecha' }}</dd></div>
          <div><dt>Duración</dt><dd>{{ item.durationMonths ? item.durationMonths + ' meses' : 'Sin duración' }}</dd></div>
          <div><dt>Vencimiento</dt><dd class="mono">{{ formatDate(item.expiresOn) || 'Sin vencimiento' }}</dd></div>
          <div><dt>Estado</dt><dd>{{ statusLabel(item.status) }}</dd></div>
          <div><dt>Comprobante</dt><dd>{{ item.receiptId ? 'Adjunto vinculado' : 'Sin comprobante' }}</dd></div>
          <div class="phase6-span"><dt>Observaciones</dt><dd>{{ item.notes || 'Sin observaciones' }}</dd></div>
        </dl>
        <div v-if="editing" class="phase6-grid">
          <label class="field"><span class="field__label">Proveedor</span><input class="input-shell" v-model="form.supplier"></label>
          <label class="field"><span class="field__label">Fecha de compra</span><input class="input-shell" type="date" v-model="form.purchaseDate"></label>
          <label class="field"><span class="field__label">Duración en meses</span><input class="input-shell" type="number" min="1" max="1200" v-model="form.durationMonths"></label>
          <label class="field"><span class="field__label">Vencimiento</span><input class="input-shell" type="date" v-model="form.expiresOn"></label>
          <label class="field"><span class="field__label">Estado</span>
            <select class="input-shell" v-model="form.status">
              <option v-for="status in ['active','cancelled','claimed','unknown']" :key="status" :value="status">{{ statusLabel(status) }}</option>
            </select>
          </label>
          <label class="field"><span class="field__label">Comprobante</span>
            <select class="input-shell" v-model="form.receiptId">
              <option value="">Sin comprobante</option>
              <option v-for="file in receipts" :key="file.id" :value="file.id">{{ file.filename }} · {{ formatSize(file.size) }}</option>
            </select>
          </label>
          <label class="field phase6-span"><span class="field__label">Observaciones</span><textarea class="input-shell" v-model="form.notes"></textarea></label>
          <p v-if="message" class="config-note phase6-span" role="status">{{ message }}</p>
          <div class="phase6-actions phase6-span">
            <button type="button" class="btn btn--ghost btn--small" @click="cancel">Cancelar</button>
            <button v-if="item" type="button" class="btn btn--ghost btn--small" @click="remove">Eliminar</button>
            <button type="button" class="btn btn--primary btn--small" :disabled="busy" @click="save">Guardar garantía</button>
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
          this.message = 'Archivo subido.';
        } else if (result && !result.cancelled) {
          this.message = result.error || 'No se pudo subir el archivo.';
        }
        if (event.target) event.target.value = '';
        return !!(result && result.ok);
      },
      async download(item) {
        const result = await this.app.downloadAssetAttachment(item);
        if (result && result.ok) {
          saveBlob(result.blob, result.filename);
          this.message = 'Descarga preparada.';
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || 'No se pudo descargar el archivo.';
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
          this.message = 'Adjunto eliminado.';
          return true;
        }
        if (result && !result.cancelled) this.message = result.error || 'No se pudo eliminar el adjunto.';
        return false;
      }
    },
    template: `
      <section class="phase6-panel" aria-labelledby="phase6-attachments-title">
        <header class="panel-head">
          <div>
            <p class="eyebrow">Documentos</p>
            <h2 id="phase6-attachments-title">Adjuntos del activo</h2>
          </div>
          <span class="mono info-panel__meta">{{ items.length }} archivos</span>
        </header>
        <div v-if="canEdit" class="phase6-grid phase6-grid--upload">
          <label class="field">
            <span class="field__label">Categoría documental</span>
            <select class="input-shell" v-model="category">
              <option v-for="value in categories" :key="value" :value="value">{{ categoryLabel(value) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Archivo</span>
            <input class="input-shell" type="file" :disabled="busy" @change="upload">
          </label>
        </div>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <p v-if="state.loading" class="config-note" role="status">Consultando adjuntos…</p>
        <p v-else-if="state.error" class="field__error" role="alert">{{ state.error }}</p>
        <p v-else-if="!items.length" class="config-note">Sin fotografías, comprobantes, manuales ni documentos.</p>
        <ul v-else class="phase6-list">
          <li v-for="item in items" :key="item.id" class="phase6-list__item">
            <span class="truncate">{{ item.filename }}</span>
            <span class="chip chip--muted">{{ categoryLabel(item.category) }}</span>
            <span class="mono cell-note">{{ formatSize(item.size) }} · {{ formatDate(item.createdAt) }}</span>
            <span class="phase6-list__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="download(item)">Descargar</button>
              <button v-if="canEdit" type="button" class="btn btn--ghost btn--small" :disabled="busy" @click="remove(item)">{{ confirmId === item.id ? 'Confirmar' : 'Eliminar' }}</button>
            </span>
          </li>
        </ul>
      </section>
    `
  };
})();
