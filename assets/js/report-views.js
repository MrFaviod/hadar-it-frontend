(function () {
  'use strict';

  const E = window.AssetReportEngine;
  const LABEL = window.AssetLabelEngine;

  const JOB_LABELS = {
    queued: 'En cola',
    running: 'Generando',
    completed: 'Completado',
    failed: 'Con errores'
  };
  const OUTPUT_LABELS = { pdf: 'PDF', csv: 'CSV', xlsx: 'Excel' };

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

  let inlineTemplateSequence = 0;

  function newTemplateId() {
    inlineTemplateSequence += 1;
    return 'custom-' + Date.now().toString(36) + '-' + inlineTemplateSequence.toString(36);
  }

  function wireTemplate(template) {
    if (!template) return null;
    return {
      id: template.id || '',
      name: template.name,
      description: template.description,
      family: template.family,
      mode: template.mode,
      format: template.format,
      fields: template.fields.slice(),
      logo: template.logo,
      images: template.images,
      version: 1,
      blocks: template.blocks.map(function (item) {
        return { id: item.id, type: item.type, label: item.label, text: item.text, enabled: item.enabled !== false };
      })
    };
  }

  const ReportsCenter = {
    name: 'Phase9ReportsCenter',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      const context = this.app.documentContext || {};
      const filters = {
        search: '',
        category: '',
        siteId: '',
        locationId: '',
        responsiblePersonId: '',
        status: '',
        archived: 'active',
        from: '',
        to: '',
        actor: '',
        event: '',
        warrantyFilter: ''
      };
      if (!context.ids || !context.ids.length) {
        filters.category = context.category && context.category !== 'all' ? context.category : '';
      }
      return {
        tab: 'prepare',
        family: 'inventory',
        templateId: '',
        draft: null,
        draftInlineId: '',
        composition: 'consolidated',
        group: 'none',
        output: 'pdf',
        filters: filters,
        explicit: !!(context.ids && context.ids.length),
        ids: context.ids ? context.ids.slice() : [],
        editor: false,
        addType: 'text',
        error: '',
        notice: '',
        previewStale: true
      };
    },
    computed: {
      state() {
        return this.app.phase9;
      },
      templates() {
        return this.state.templates.items;
      },
      familyTemplates() {
        return this.templates.filter((template) => template.family === this.family);
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
      documents() {
        return this.state.documents.items;
      },
      activeJob() {
        return this.state.activeJob.job;
      },
      selectedCount() {
        return this.explicit ? this.ids.length : this.selection.total;
      },
      pageNumber() {
        return Math.floor(this.selection.offset / Math.max(1, this.selection.limit)) + 1;
      },
      pageCount() {
        return Math.max(1, Math.ceil(this.selection.total / Math.max(1, this.selection.limit)));
      },
      canGenerate() {
        return this.app.can('assets.view');
      },
      canEditTemplate() {
        return this.app.can('assets.edit');
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
      blockTypes() {
        return E.BLOCK_TYPES;
      },
      familyOptions() {
        return E.FAMILIES;
      },
      fieldOptions() {
        return E.fieldsForFamily(this.draft ? this.draft.family : this.family);
      },
      groupOptions() {
        return E.GROUPS;
      },
      outputOptions() {
        return [{ value: 'pdf', label: 'PDF' }, { value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'Excel' }];
      },
      componentError() {
        return this.error || this.selection.error || this.previewState.error || this.state.templates.error;
      },
      draftEdited() {
        if (!this.draft || !this.templateId) return true;
        const source = this.templates.find((item) => item.id === this.templateId);
        if (!source) return true;
        return JSON.stringify(wireTemplate(source)) !== JSON.stringify(wireTemplate(this.draft));
      },
      hasPreview() {
        return !!this.previewState.html && !this.previewState.loading;
      },
      jobDocuments() {
        return this.activeJob ? this.activeJob.documents : [];
      }
    },
    created() {
      this.initialize();
    },
    methods: {
      jobLabel(value) {
        return JOB_LABELS[value] || value || 'Sin estado';
      },
      outputLabel(value) {
        return OUTPUT_LABELS[value] || value;
      },
      date(value) {
        return formatDate(value);
      },
      size(value) {
        return formatBytes(value);
      },
      async initialize() {
        const tasks = [this.app.phase9LoadTemplates(), this.app.phase9LoadSelection({ filters: this.filters, resetOffset: true })];
        if (this.app.can('config.general')) tasks.push(this.app.phase9LoadSettings());
        await Promise.all(tasks);
        this.pickInitialTemplate();
        this.app.phase9LoadJobs();
      },
      pickInitialTemplate() {
        const context = this.app.documentContext || {};
        const preferred = context.templateId && this.templates.find((template) => template.id === context.templateId);
        const familyTemplate = preferred || this.templates.find((template) => template.family === this.family);
        if (familyTemplate) this.chooseTemplate(familyTemplate.id);
        else this.newTemplate();
      },
      chooseFamily(id) {
        this.family = id;
        this.previewStale = true;
        this.editor = false;
        const first = this.templates.find((template) => template.family === id);
        if (first) this.chooseTemplate(first.id);
        else this.newTemplate();
      },
      chooseTemplate(id) {
        const template = this.templates.find((item) => item.id === id);
        if (!template) return;
        this.templateId = template.id;
        this.family = template.family;
        this.draft = E.clone(template);
        this.draftInlineId = template.builtin ? newTemplateId() : template.id;
        this.composition = E.composeRequestMode(template);
        this.previewStale = true;
        this.error = '';
      },
      draftFamilyChanged() {
        if (!this.draft) return;
        this.draft.fields = E.familyFields(this.draft.family);
        this.previewStale = true;
      },
      newTemplate() {
        this.templateId = '';
        this.draft = E.createTemplate(this.family);
        this.draftInlineId = newTemplateId();
        this.draft.id = this.draftInlineId;
        this.composition = 'consolidated';
        this.editor = true;
        this.previewStale = true;
      },
      toggleField(key) {
        if (!this.draft) return;
        const index = this.draft.fields.indexOf(key);
        if (index >= 0) this.draft.fields.splice(index, 1);
        else this.draft.fields.push(key);
      },
      fieldChecked(key) {
        return !!this.draft && this.draft.fields.indexOf(key) !== -1;
      },
      toggleBlock(item) {
        item.enabled = item.enabled === false;
      },
      addBlock() {
        if (!this.draft) return;
        this.draft.blocks.push(E.block(this.addType));
      },
      moveBlock(index, delta) {
        if (!this.draft) return;
        const target = index + delta;
        if (target < 0 || target >= this.draft.blocks.length) return;
        const item = this.draft.blocks.splice(index, 1)[0];
        this.draft.blocks.splice(target, 0, item);
      },
      removeBlock(index) {
        if (!this.draft) return;
        this.draft.blocks.splice(index, 1);
      },
      async saveTemplate() {
        if (!this.draft) return;
        this.error = '';
        const source = this.templateId ? this.templates.find((item) => item.id === this.templateId) : null;
        const candidate = E.clone(this.draft);
        if (!this.draftInlineId) this.draftInlineId = newTemplateId();
        if (!source || source.builtin) {
          candidate.id = this.draftInlineId;
          candidate.builtin = false;
        }
        const result = await this.app.phase9SaveTemplate(candidate);
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        await this.app.phase9LoadTemplates();
        this.chooseTemplate(result.template.id);
        this.notice = 'Plantilla guardada.';
        this.app.showToast('Plantilla de reportes guardada.');
      },
      async removeTemplate() {
        if (!this.templateId) return;
        const result = await this.app.phase9DeleteTemplate(this.templateId);
        if (!result.ok) {
          this.error = result.error;
          return;
        }
        await this.app.phase9LoadTemplates();
        this.pickInitialTemplate();
        this.app.showToast('Plantilla eliminada.');
      },
      reloadSelection() {
        this.previewStale = true;
        this.app.phase9LoadSelection({ filters: this.filters, resetOffset: true });
      },
      scheduleSelection() {
        this.previewStale = true;
        this.app.phase9ScheduleSelectionSearch(this.filters);
      },
      selectionPage(direction) {
        this.previewStale = true;
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
        this.previewStale = true;
      },
      selectPage() {
        this.explicit = true;
        this.ids = this.selection.items.map((item) => item.id);
        this.previewStale = true;
      },
      selectAllMatching() {
        this.explicit = false;
        this.ids = [];
        this.previewStale = true;
      },
      clearSelection() {
        this.explicit = true;
        this.ids = [];
        this.previewStale = true;
      },
      filtersForRequest() {
        const filters = this.filters;
        return {
          search: filters.search,
          category: filters.category,
          siteId: filters.siteId,
          locationId: filters.locationId,
          responsiblePersonId: filters.responsiblePersonId,
          status: filters.status,
          archived: filters.archived === 'archived' ? true : (filters.archived === 'active' ? false : null),
          from: this.family === 'history' ? filters.from : '',
          to: this.family === 'history' ? filters.to : '',
          actor: this.family === 'history' ? filters.actor : '',
          event: this.family === 'history' ? filters.event : '',
          warrantyFilter: this.family === 'warranty' ? filters.warrantyFilter : ''
        };
      },
      requestTemplate() {
        if (!this.draft) return null;
        if (this.templateId && !this.draftEdited) return null;
        const template = wireTemplate(this.draft);
        if (!this.draftInlineId) this.draftInlineId = newTemplateId();
        template.id = this.draftInlineId;
        return template;
      },
      request(output) {
        const template = this.requestTemplate();
        return {
          family: this.family,
          templateId: template ? null : (this.templateId || null),
          template: template,
          assetIds: this.explicit ? this.ids.slice() : [],
          filters: this.filtersForRequest(),
          fields: this.draft ? this.draft.fields.slice() : [],
          mode: this.composition,
          group: this.group || 'none',
          output: output || this.output,
          name: this.draft ? this.draft.name : '',
          labels: null
        };
      },
      async previewReport() {
        this.error = '';
        if (!this.draft) {
          this.error = 'Selecciona una plantilla antes de previsualizar.';
          return;
        }
        const result = await this.app.phase9PreviewReport(this.request('pdf'));
        if (!result.ok) {
          this.error = result.error || '';
          return;
        }
        this.previewStale = false;
      },
      async generate() {
        this.error = '';
        if (!this.selectedCount) {
          this.error = 'Selecciona al menos un activo.';
          return;
        }
        if (!this.draft) {
          this.error = 'Selecciona una plantilla antes de generar.';
          return;
        }
        const result = await this.app.phase9CreateJob(this.request(this.output));
        if (!result.ok) {
          this.error = result.error || '';
          return;
        }
        this.tab = 'jobs';
        this.notice = 'Trabajo en cola. El documento aparecerá al completarse.';
      },
      openJob(job) {
        this.tab = 'jobs';
        this.app.phase9LoadJob(job.id);
      },
      async download(documentRef) {
        const result = await this.app.phase9DownloadDocument(documentRef);
        if (!result.ok) this.error = result.error || '';
      }
    },
    template: `
      <section class="page reports-page" data-od-id="reports-center">
        <header class="page-head">
          <div>
            <p class="eyebrow">Documentos del servidor</p>
            <h1>Reportes</h1>
            <p class="page-head__description">Reportes de inventario, historial y garantías con plantillas versionadas del servidor. La previsualización y el PDF comparten la misma composición.</p>
          </div>
        </header>

        <div class="doc-tabs" role="tablist" aria-label="Secciones de reportes">
          <button role="tab" :aria-selected="tab === 'prepare'" :class="{ active: tab === 'prepare' }" @click="tab = 'prepare'">Preparar</button>
          <button role="tab" :aria-selected="tab === 'jobs'" :class="{ active: tab === 'jobs' }" @click="tab = 'jobs'">
            Trabajos y documentos <span class="mono">{{ jobs.length }}</span>
          </button>
        </div>

        <template v-if="tab === 'prepare'">
          <div class="doc-family-grid">
            <button v-for="familyOption in familyOptions" :key="familyOption.id" type="button" class="doc-family"
                    :class="{ active: familyOption.id === family }" @click="chooseFamily(familyOption.id)">
              <span class="doc-family__number">0{{ familyOptions.indexOf(familyOption) + 1 }}</span>
              <span><strong>{{ familyOption.label }}</strong><small>{{ familyOption.description }}</small></span>
              <app-icon name="arrow-up-right"></app-icon>
            </button>
          </div>

          <div class="doc-workspace">
            <aside class="doc-controls">
              <div class="doc-control-head">
                <p class="eyebrow">01 · Alcance</p>
                <h2>Prepara el reporte</h2>
              </div>

              <label class="doc-field">Plantilla del servidor
                <select :value="templateId" @change="chooseTemplate($event.target.value)">
                  <option value="" disabled>Selecciona una plantilla</option>
                  <option v-for="template in familyTemplates" :key="template.id" :value="template.id">
                    {{ template.name }}{{ template.builtin ? ' · predeterminada' : '' }}
                  </option>
                </select>
              </label>
              <div class="doc-inline">
                <button type="button" class="text-button" @click="editor = !editor">{{ editor ? 'Ocultar editor' : 'Editar composición' }}</button>
                <button type="button" class="text-button" @click="newTemplate">Nueva plantilla</button>
              </div>
              <p v-if="!templates.length && !state.templates.loading" class="doc-help">El servidor no ha publicado plantillas. Puedes crear una plantilla personalizada.</p>

              <hr class="doc-rule">
              <label class="doc-field">Buscar activos
                <input type="search" v-model="filters.search" placeholder="Nombre, ID, código o serie" @input="scheduleSelection">
              </label>
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

              <div v-if="family === 'history'" class="doc-form-grid">
                <label class="doc-field">Desde<input type="date" v-model="filters.from" @change="reloadSelection"></label>
                <label class="doc-field">Hasta<input type="date" v-model="filters.to" @change="reloadSelection"></label>
                <label class="doc-field">Actor<input v-model="filters.actor" maxlength="120" @change="reloadSelection"></label>
                <label class="doc-field">Evento<input v-model="filters.event" maxlength="120" @change="reloadSelection"></label>
              </div>
              <label v-if="family === 'warranty'" class="doc-field">Cobertura
                <select v-model="filters.warrantyFilter" @change="reloadSelection">
                  <option value="">Todas</option>
                  <option value="current">Vigente</option>
                  <option value="expiring">Por vencer</option>
                  <option value="expired">Vencida</option>
                  <option value="unknown">Sin datos</option>
                </select>
              </label>

              <hr class="doc-rule">
              <div class="doc-section-label">
                <strong>{{ selectedCount }} {{ selectedCount === 1 ? 'activo' : 'activos' }}</strong>
                <span class="mono" v-if="!explicit">Todos los resultados</span>
                <span class="mono" v-else>Selección manual</span>
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

              <hr class="doc-rule">
              <label class="doc-field">Composición
                <select v-model="composition">
                  <option value="consolidated">Consolidado</option>
                  <option value="individual">Un documento por activo</option>
                </select>
              </label>
              <label class="doc-field">Agrupar por
                <select v-model="group" aria-label="Agrupar filas del reporte">
                  <option v-for="item in groupOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
              </label>
              <label class="doc-field">Salida
                <select v-model="output">
                  <option v-for="item in outputOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
              </label>
            </aside>

            <div class="doc-preview-area">
              <header class="doc-preview-toolbar">
                <div>
                  <p class="eyebrow">02 · Previsualización</p>
                  <h2>{{ draft ? draft.name : 'Sin plantilla' }}</h2>
                  <p>{{ selectedCount }} activos · {{ composition === 'individual' ? 'documento por activo' : 'documento consolidado' }} · {{ outputLabel(output) }}</p>
                </div>
                <button type="button" class="btn btn--secondary" :disabled="previewState.loading || !draft" @click="previewReport">
                  <app-icon name="eye"></app-icon>{{ previewState.loading ? 'Preparando…' : 'Actualizar vista previa' }}
                </button>
              </header>

              <div v-if="editor && draft" class="doc-editor">
                <div class="doc-editor__head">
                  <div><h3>Editor de plantilla</h3><p>Los bloques y campos se guardan en el servidor como una plantilla personalizada.</p></div>
                  <span class="mono">v{{ draft.version }}</span>
                </div>
                <div class="doc-form-grid">
                  <label class="doc-field">Nombre<input v-model="draft.name" maxlength="120"></label>
                  <label class="doc-field">Descripción<input v-model="draft.description" maxlength="240"></label>
                  <label class="doc-field">Familia
                    <select v-model="draft.family" @change="draftFamilyChanged">
                      <option v-for="family in familyOptions" :key="family.id" :value="family.id">{{ family.label }}</option>
                    </select>
                  </label>
                  <label class="doc-field">Modo
                    <select v-model="draft.mode">
                      <option value="list">Lista</option>
                      <option value="sheet">Ficha</option>
                    </select>
                  </label>
                  <label class="doc-field">Papel
                    <select v-model="draft.format"><option value="A4">A4</option><option value="Letter">Carta</option></select>
                  </label>
                </div>
                <div class="doc-inline">
                  <label><input type="checkbox" v-model="draft.logo">Mostrar logotipo</label>
                  <label><input type="checkbox" v-model="draft.images">Incluir fotografías</label>
                </div>
                <fieldset class="doc-field-options">
                  <legend>Campos visibles</legend>
                  <label v-for="field in fieldOptions" :key="field.key">
                    <input type="checkbox" :checked="fieldChecked(field.key)" @change="toggleField(field.key)">{{ field.label }}
                  </label>
                </fieldset>
                <div class="doc-section-label"><strong>Bloques</strong><span class="mono">{{ draft.blocks.length }}</span></div>
                <div class="doc-block-list">
                  <div v-for="(item, index) in draft.blocks" :key="item.id" class="doc-block-row">
                    <input type="checkbox" :checked="item.enabled !== false" :aria-label="'Activar ' + item.label" @change="toggleBlock(item)">
                    <span><strong>{{ item.label }}</strong><small class="mono">{{ item.type }}</small></span>
                    <div class="doc-block-moves">
                      <button type="button" class="btn btn--ghost btn--small" :disabled="index === 0" :aria-label="'Subir ' + item.label" @click="moveBlock(index, -1)">↑</button>
                      <button type="button" class="btn btn--ghost btn--small" :disabled="index === draft.blocks.length - 1" :aria-label="'Bajar ' + item.label" @click="moveBlock(index, 1)">↓</button>
                      <button type="button" class="btn btn--ghost btn--small" :aria-label="'Quitar ' + item.label" @click="removeBlock(index)">×</button>
                    </div>
                    <input v-if="item.type === 'heading' || item.type === 'text' || item.type === 'footer'" v-model="item.text" :aria-label="'Texto de ' + item.label" maxlength="500">
                  </div>
                </div>
                <div class="doc-inline">
                  <select v-model="addType" aria-label="Tipo de bloque">
                    <option v-for="type in blockTypes" :key="type.type" :value="type.type">{{ type.label }}</option>
                  </select>
                  <button type="button" class="btn btn--ghost btn--small" @click="addBlock">Añadir bloque</button>
                </div>
                <div class="doc-inline">
                  <button type="button" class="btn btn--primary btn--small" :disabled="!canEditTemplate" @click="saveTemplate">Guardar plantilla</button>
                  <button v-if="templateId" type="button" class="btn btn--ghost btn--small" :disabled="!canEditTemplate" @click="removeTemplate">Eliminar plantilla</button>
                  <span v-if="!canEditTemplate" class="doc-help">Necesitas el permiso de edición de activos.</span>
                </div>
              </div>

              <div v-if="previewState.html" class="doc-pages">
                <iframe :srcdoc="previewState.html" sandbox="" title="Vista previa del reporte" style="width:100%;min-height:640px;border:0;background:#fff"></iframe>
                <p v-if="previewState.truncated" class="doc-help" role="status">La selección supera el límite del servidor; reduce los filtros para incluir todos los activos.</p>
                <p v-if="previewStale" class="doc-help" role="status">Los filtros o la plantilla cambiaron. Actualiza la vista previa antes de generar.</p>
              </div>
              <div v-else class="doc-empty">
                <app-icon name="file-text"></app-icon>
                <h3>{{ previewState.loading ? 'Preparando la vista previa…' : 'Sin vista previa' }}</h3>
                <p>{{ previewState.loading ? 'El servidor compone el documento con la misma plantilla que usará el PDF.' : 'Ajusta los filtros y pulsa «Actualizar vista previa».' }}</p>
              </div>

              <p v-if="componentError" class="doc-error" role="alert">{{ componentError }}</p>
              <p v-if="notice" class="doc-help" role="status">{{ notice }}</p>
              <footer class="doc-output-bar">
                <div>
                  <strong>{{ selectedCount }} {{ selectedCount === 1 ? 'activo' : 'activos' }}</strong>
                  <p>El PDF, CSV o Excel se genera como un trabajo real y queda disponible para descargar.</p>
                </div>
                <button type="button" class="btn btn--primary" :disabled="!selectedCount || !draft || !canGenerate" data-od-id="generate-report" @click="generate">
                  <app-icon name="file-text"></app-icon>Generar {{ outputLabel(output) }}
                </button>
              </footer>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-if="activeJob" class="doc-preview-area" data-od-id="active-report-job">
            <header class="doc-preview-toolbar">
              <div>
                <p class="eyebrow">Trabajo activo</p>
                <h2>{{ jobLabel(activeJob.status) }}</h2>
                <p>{{ activeJob.processed }} / {{ activeJob.total }} procesados · {{ date(activeJob.createdAt) }}</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" :disabled="state.activeJob.loading" @click="app.phase9LoadJob(activeJob.id)">Actualizar</button>
            </header>
            <div style="padding:20px 24px">
              <progress :value="activeJob.processed" :max="Math.max(1, activeJob.total)" style="width:100%" aria-label="Progreso del trabajo"></progress>
              <ul v-if="activeJob.errors.length" class="doc-error" role="alert">
                <li v-for="(item, index) in activeJob.errors" :key="index">{{ item }}</li>
              </ul>
              <table v-if="jobDocuments.length" class="asset-table">
                <thead><tr><th>Documento</th><th>Formato</th><th>Tamaño</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="document in jobDocuments" :key="document.id">
                    <td>{{ document.name }}</td>
                    <td class="mono">{{ document.mime }}</td>
                    <td>{{ size(document.size) }}</td>
                    <td><button type="button" class="btn btn--ghost btn--small" :disabled="state.download.loading" @click="download(document)">Descargar</button></td>
                  </tr>
                </tbody>
              </table>
              <p v-else-if="activeJob.status === 'completed'" class="doc-help">El trabajo no produjo documentos.</p>
              <p v-else class="doc-help">El documento aparecerá cuando el trabajo termine.</p>
            </div>
          </div>

          <div class="table-panel" style="margin-top:24px">
            <header class="panel-head"><div><p class="eyebrow">Historial del servidor</p><h2>Documentos recientes</h2></div><button type="button" class="text-button" @click="app.phase9LoadJobs()">Actualizar</button></header>
            <table class="asset-table" v-if="documents.length">
              <thead><tr><th>Documento</th><th>Trabajo</th><th>Creado</th><th>Tamaño</th><th></th></tr></thead>
              <tbody>
                <tr v-for="document in documents" :key="document.id">
                  <td>{{ document.name }}<small class="mono" style="display:block">{{ document.mime }}</small></td>
                  <td class="mono">{{ document.jobId }}</td>
                  <td>{{ date(document.jobCreatedAt) }}</td>
                  <td>{{ size(document.size) }}</td>
                  <td><button type="button" class="btn btn--ghost btn--small" :disabled="state.download.loading" @click="download(document)">Descargar</button></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="doc-empty">Todavía no hay documentos generados.</p>
          </div>

          <div class="table-panel" style="margin-top:24px">
            <header class="panel-head"><div><p class="eyebrow">Cola del servidor</p><h2>Trabajos</h2></div></header>
            <table class="asset-table" v-if="jobs.length">
              <thead><tr><th>Trabajo</th><th>Estado</th><th>Progreso</th><th>Errores</th><th>Creado</th><th></th></tr></thead>
              <tbody>
                <tr v-for="job in jobs" :key="job.id">
                  <td class="mono">{{ job.id }}</td>
                  <td><span class="status-pill">{{ jobLabel(job.status) }}</span></td>
                  <td>{{ job.processed }} / {{ job.total }}</td>
                  <td>{{ job.errors.length }}</td>
                  <td>{{ date(job.createdAt) }}</td>
                  <td><button type="button" class="btn btn--ghost btn--small" @click="openJob(job)">Ver</button></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="doc-empty">No hay trabajos de reportes.</p>
            <p v-if="state.jobs.error" class="doc-error" role="alert">{{ state.jobs.error }}</p>
          </div>
        </template>
      </section>
    `
  };

  const ReportSettings = {
    name: 'Phase9ReportSettings',
    props: { app: { type: Object, required: true } },
    data() {
      return {
        draft: { baseUrl: '', branding: { name: '', primary: '', accent: '', header: '', footer: '', logoAttachmentId: '' } },
        error: '',
        fieldErrors: {},
        saved: false
      };
    },
    computed: {
      state() {
        return this.app.phase9.settings;
      },
      canSave() {
        return this.app.can('config.general');
      }
    },
    created() {
      this.load();
    },
    methods: {
      async load() {
        await this.app.phase9LoadSettings();
        this.reset();
      },
      reset() {
        const settings = this.app.phase9.settings;
        this.draft = {
          baseUrl: settings.baseUrl,
          branding: Object.assign({}, settings.branding)
        };
        this.saved = false;
      },
      validColor(value) {
        return !value || /^#[0-9a-fA-F]{6}$/.test(value);
      },
      validate() {
        this.fieldErrors = {};
        this.error = '';
        if (this.draft.baseUrl) {
          try {
            const url = new URL(this.draft.baseUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          } catch (_) {
            this.fieldErrors.baseUrl = 'Introduce una URL http o https válida.';
          }
        }
        ['primary', 'accent'].forEach((key) => {
          if (!this.validColor(this.draft.branding[key])) this.fieldErrors[key] = 'Usa un color hexadecimal de seis dígitos.';
        });
        return !Object.keys(this.fieldErrors).length;
      },
      async save() {
        if (!this.canSave) {
          this.error = 'No tienes permiso para cambiar la configuración de reportes.';
          return;
        }
        if (!this.validate()) return;
        const result = await this.app.phase9SaveSettings({
          baseUrl: this.draft.baseUrl,
          branding: this.draft.branding,
          labelDefaults: this.state.labelDefaults
        });
        if (!result.ok) {
          this.error = result.error;
          this.fieldErrors = result.fieldErrors || {};
          return;
        }
        this.saved = true;
        this.reset();
        this.saved = true;
        this.app.showToast('Configuración de reportes guardada.');
      }
    },
    template: `
      <section class="config-section doc-settings" data-od-id="report-settings">
        <header class="config-section-head">
          <p class="eyebrow">Documentos e identidad</p>
          <h2>Reportes y URL base</h2>
          <p>La identidad visual y la dirección de los códigos QR pertenecen a la organización activa. Sin configuración se usa el tema genérico del motor.</p>
        </header>
        <form class="qr-settings-form" @submit.prevent="save">
          <label class="doc-field">URL base de los reportes
            <input type="url" v-model="draft.baseUrl" maxlength="400" placeholder="https://activos.organizacion.example/">
            <small v-if="fieldErrors.baseUrl" class="doc-error">{{ fieldErrors.baseUrl }}</small>
          </label>
          <div class="doc-form-grid">
            <label class="doc-field">Nombre de la organización<input v-model="draft.branding.name" maxlength="120"></label>
            <label class="doc-field">ID de adjunto del logotipo<input v-model="draft.branding.logoAttachmentId" maxlength="120" placeholder="Adjunto raster autorizado"></label>
            <label class="doc-field">Color principal<input v-model="draft.branding.primary" maxlength="7" placeholder="#0d766e"><small v-if="fieldErrors.primary" class="doc-error">{{ fieldErrors.primary }}</small></label>
            <label class="doc-field">Color de acento<input v-model="draft.branding.accent" maxlength="7" placeholder="#147c73"><small v-if="fieldErrors.accent" class="doc-error">{{ fieldErrors.accent }}</small></label>
          </div>
          <label class="doc-field">Encabezado del documento<textarea v-model="draft.branding.header" maxlength="300" rows="3"></textarea></label>
          <label class="doc-field">Pie del documento<textarea v-model="draft.branding.footer" maxlength="300" rows="3"></textarea></label>
          <p class="doc-help">El logotipo debe ser un adjunto raster existente y autorizado. No se aceptan HTML, CSS, rutas del sistema ni direcciones de red arbitrarias.</p>
          <p v-if="!canSave" class="doc-help">Necesitas el permiso de configuración general para guardar.</p>
          <p v-if="error" class="doc-error" role="alert">{{ error }}</p>
          <button class="btn btn--primary" type="submit" :disabled="!canSave || state.saving">{{ state.saving ? 'Guardando…' : (saved ? 'Configuración guardada' : 'Guardar configuración') }}</button>
        </form>
      </section>
    `
  };

  window.AssetReportViews = { ReportsCenter: ReportsCenter, ReportSettings: ReportSettings };
})();
