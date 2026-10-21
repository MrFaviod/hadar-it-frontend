/* Generador de exportaciones y preferencias del módulo. */
(function () {
  'use strict';

  const Data = window.AssetTransferData;
  const Engine = window.AssetTransferEngine;

  window.AssetTransferViews = window.AssetTransferViews || {};

  const SCOPE_OPTIONS = [
    { id: 'filters', label: 'Vista filtrada', description: 'Aplica la búsqueda, la sede, la categoría y el orden activos.', icon: 'search' },
    { id: 'all', label: 'Todo el inventario', description: 'Incluye los activos dados de baja y los que no tienen responsable.', icon: 'layers' },
    { id: 'selection', label: 'Selección manual', description: 'Elige activos concretos de la lista.', icon: 'check' }
  ];

  window.AssetTransferViews.TransferExport = {
    name: 'TransferExport',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell, TransferProfileDialog: window.AssetTransferViews.TransferProfileDialog },
    props: { app: { type: Object, required: true } },
    data() {
      const prefs = Data.getPrefs();
      return {
        prefs,
        scope: 'filters',
        selectedIds: [],
        assetSearch: '',
        fields: [],
        profileId: '',
        format: prefs.defaultFormat || 'csv',
        options: {
          headerRow: prefs.headerRow !== false,
          separator: prefs.separator || ';',
          bom: prefs.bom !== false,
          includeEmpty: prefs.includeEmpty === true
        },
        profilesOpen: false,
        generating: false,
        progress: 0,
        progressLabel: '',
        result: null,
        error: '',
        recent: []
      };
    },
    created() {
      const profile = Data.profileById(this.prefs.defaultExportProfile) || Data.EXPORT_PROFILES[0];
      this.applyProfile(profile);
      this.recent = Data.exportsLog();
    },
    computed: {
      profileOptions() {
        return Data.profiles('export');
      },
      activeProfile() {
        return this.profileId ? Data.profileById(this.profileId) : null;
      },
      scopes() {
        return SCOPE_OPTIONS.map((option) => Object.assign({}, option, {
          count: option.id === 'filters'
            ? this.app.filteredAssets.length
            : option.id === 'all'
              ? this.app.assets.length
              : this.selectedIds.length
        }));
      },
      scopeAssets() {
        if (this.scope === 'all') return this.app.assets.slice();
        if (this.scope === 'selection') {
          return this.app.assets.filter((asset) => this.selectedIds.indexOf(asset.id) !== -1);
        }
        return this.app.filteredAssets.slice();
      },
      filteredAssets() {
        const term = Data.norm(this.assetSearch);
        if (!term) return this.app.assets;
        return this.app.assets.filter((asset) => Data.norm(asset.name + ' ' + asset.id + ' ' + asset.serial).indexOf(term) !== -1);
      },
      selectedCount() {
        return this.selectedIds.length;
      },
      fieldDetails() {
        return this.fields.map((key) => Data.EXPORT_FIELDS.find((field) => field.key === key)).filter(Boolean);
      },
      availableFields() {
        return Data.EXPORT_FIELDS.filter((field) => this.fields.indexOf(field.key) === -1);
      },
      previewFields() {
        return this.fields.slice(0, 2);
      },
      previewAssets() {
        return this.scopeAssets.slice(0, 3);
      },
      previewRows() {
        return this.previewAssets.map((asset) => this.previewFields.map((key) => Engine.exportValue(this.app, asset, key)));
      },
      estimateRows() {
        return this.scopeAssets.length;
      },
      estimateSize() {
        const cells = this.estimateRows * this.fields.length;
        return Data.formatBytes(cells * 16 + 64);
      },
      scopeLabel() {
        const option = SCOPE_OPTIONS.find((item) => item.id === this.scope);
        return option ? option.label : '';
      },
      canGenerate() {
        return this.fields.length > 0 && this.estimateRows > 0 && !this.generating;
      },
      recentExports() {
        return this.recent;
      }
    },
    methods: {
      fieldLabel(key) {
        const field = Data.EXPORT_FIELDS.find((item) => item.key === key);
        return field ? field.label : key;
      },
      fieldGroup(key) {
        const field = Data.EXPORT_FIELDS.find((item) => item.key === key);
        return field ? field.group : '';
      },
      formatSize(value) {
        return Data.formatBytes(value);
      },
      formatWhen(value) {
        return Data.formatDateTime(value);
      },
      siteLabel(id) {
        return this.app.siteLabel(id);
      },
      categoryLabel(id) {
        return this.app.categoryLabel(id);
      },
      setScope(id) {
        this.scope = id;
        this.result = null;
        this.error = '';
      },
      toggleAsset(id) {
        const index = this.selectedIds.indexOf(id);
        if (index === -1) this.selectedIds = this.selectedIds.concat([id]);
        else this.selectedIds = this.selectedIds.filter((item) => item !== id);
        this.result = null;
      },
      selectVisible() {
        const visible = this.filteredAssets.map((asset) => asset.id);
        const merged = this.selectedIds.slice();
        visible.forEach((id) => {
          if (merged.indexOf(id) === -1) merged.push(id);
        });
        this.selectedIds = merged;
        this.result = null;
      },
      clearSelection() {
        this.selectedIds = [];
        this.result = null;
      },
      toggleField(key) {
        if (this.fields.indexOf(key) !== -1) {
          this.fields = this.fields.filter((item) => item !== key);
        } else {
          this.fields = this.fields.concat([key]);
        }
        this.result = null;
        this.error = '';
      },
      moveField(index, delta) {
        const target = index + delta;
        if (target < 0 || target >= this.fields.length) return;
        const next = this.fields.slice();
        const value = next[index];
        next[index] = next[target];
        next[target] = value;
        this.fields = next;
      },
      resetFields() {
        const profile = this.activeProfile || Data.EXPORT_PROFILES[0];
        this.applyProfile(profile);
      },
      applyProfile(profile) {
        if (!profile) return;
        this.profileId = profile.id;
        this.fields = Array.isArray(profile.fields) ? profile.fields.slice() : this.fields;
        this.format = profile.format === 'xlsx' ? 'xlsx' : this.format;
        this.result = null;
      },
      applyProfileById(event) {
        const profile = Data.profileById(event.target.value);
        this.applyProfile(profile);
        event.target.value = this.profileId;
      },
      saveProfile(name) {
        const saved = Data.saveProfile({
          kind: 'export',
          name,
          description: 'Exportación de ' + this.fields.length + ' campos desde el inventario actual.',
          fields: this.fields.slice(),
          format: this.format
        });
        if (!saved) return;
        this.profileId = saved.id;
        this.profilesOpen = false;
        this.app.showToast('Perfil «' + saved.name + '» guardado.');
      },
      async generate() {
        this.error = '';
        if (!this.fields.length) {
          this.error = 'Elige al menos un campo para exportar.';
          return;
        }
        if (!this.estimateRows) {
          this.error = this.scope === 'selection'
            ? 'Selecciona al menos un activo para exportar.'
            : 'No hay activos que coincidan con los filtros actuales.';
          return;
        }
        this.generating = true;
        this.progress = 8;
        this.progressLabel = 'Preparando ' + this.scopeAssets.length + ' activos…';
        this.result = null;
        await this.sleep(180);
        this.progress = 42;
        this.progressLabel = 'Aplicando ' + this.fields.length + ' campos…';
        await this.sleep(240);
        this.progress = 76;
        this.progressLabel = 'Generando el archivo…';
        await this.sleep(220);
        const built = Engine.buildExport(this.app, {
          assets: this.scopeAssets,
          fields: this.fields,
          profileId: this.profileId,
          format: this.format,
          separator: this.options.separator,
          headerRow: this.options.headerRow,
          bom: this.options.bom,
          includeEmpty: this.options.includeEmpty
        });
        this.progress = 100;
        this.progressLabel = 'Archivo listo.';
        await this.sleep(160);
        this.result = built;
        this.generating = false;
        Data.addExport({
          at: new Date().toISOString(),
          fileName: built.fileName,
          rows: built.rows.length,
          size: built.size,
          format: built.format,
          profile: this.activeProfile ? this.activeProfile.name : 'Personalizado',
          scope: this.scopeLabel
        });
        this.recent = Data.exportsLog();
        this.app.showToast('Exportación generada: ' + built.rows.length + ' filas y ' + built.fields.length + ' columnas.');
      },
      sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
      },
      download() {
        if (!this.result) return;
        try {
          const content = this.result.csv.indexOf('\ufeff') === 0 ? this.result.csv : '\ufeff' + this.result.csv;
          const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = this.result.fileName.replace(/\.xlsx$/, '.csv');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.setTimeout(() => URL.revokeObjectURL(url), 1200);
          this.app.showToast('Archivo descargado.');
        } catch (error) {
          this.app.showToast('No se pudo descargar el archivo.', 'error');
        }
      },
      clearResult() {
        this.result = null;
      }
    },
    template: `
      <div class="tx-layout">
        <div class="tx-main">
          <section class="tx-panel" data-od-id="export-scope" aria-labelledby="tx-export-scope">
            <header class="tx-panel__head">
              <div>
                <p class="eyebrow"><span class="eyebrow__line"></span> Paso 1 · Alcance</p>
                <h2 id="tx-export-scope">Qué activos entran en el archivo</h2>
                <p>La exportación respeta los filtros de la vista de inventario y nunca incluye el histórico de cambios.</p>
              </div>
            </header>

            <div class="tx-scope">
              <button v-for="option in scopes" :key="option.id" type="button" class="tx-scope__card"
                      :class="{ 'is-active': scope === option.id }" :aria-pressed="scope === option.id" @click="setScope(option.id)">
                <span class="tx-scope__icon"><app-icon :name="option.icon"></app-icon></span>
                <span class="tx-scope__body">
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
                <span class="tx-scope__count mono">{{ option.count }}</span>
              </button>
            </div>

            <div v-if="scope === 'selection'" class="tx-picker">
              <div class="tx-picker__head">
                <div class="search-field">
                  <app-icon name="search"></app-icon>
                  <input v-model="assetSearch" type="search" placeholder="Buscar por nombre, ID o serie" aria-label="Buscar activos para exportar">
                </div>
                <button type="button" class="text-button" @click="selectVisible">Seleccionar los {{ filteredAssets.length }} visibles</button>
                <button type="button" class="text-button" @click="clearSelection">Limpiar</button>
              </div>
              <ul class="tx-picker__list">
                <li v-for="asset in filteredAssets" :key="asset.id">
                  <label class="tx-picker__item">
                    <input type="checkbox" :checked="selectedIds.indexOf(asset.id) !== -1" @change="toggleAsset(asset.id)">
                    <span class="tx-picker__body">
                      <strong>{{ asset.name }}</strong>
                      <small class="mono">{{ asset.id }} · {{ siteLabel(asset.site) }}</small>
                    </span>
                    <span class="tx-state" :class="'tx-state--' + (asset.retired ? 'down' : 'ok')"><span class="tx-dot"></span>{{ asset.status }}</span>
                  </label>
                </li>
              </ul>
              <p v-if="!filteredAssets.length" class="tx-muted">No hay activos que coincidan con la búsqueda.</p>
            </div>
          </section>

          <section class="tx-panel" data-od-id="export-fields" aria-labelledby="tx-export-fields">
            <header class="tx-panel__head">
              <div>
                <p class="eyebrow"><span class="eyebrow__line"></span> Paso 2 · Contenido</p>
                <h2 id="tx-export-fields">Campos y perfil</h2>
                <p>El orden de los campos se traduce en el orden de las columnas del archivo.</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" @click="profilesOpen = true">
                <app-icon name="sliders"></app-icon> Perfiles
              </button>
            </header>

            <div class="tx-profile-row">
              <div class="field">
                <label for="tx-export-profile">Perfil de exportación</label>
                <div class="input-shell">
                  <app-icon name="file-text"></app-icon>
                  <select id="tx-export-profile" :value="profileId" @change="applyProfileById">
                    <option v-for="profile in profileOptions" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                  </select>
                  <app-icon name="chevron-down"></app-icon>
                </div>
              </div>
              <p v-if="activeProfile" class="tx-profile-row__note">{{ activeProfile.description }}</p>
            </div>

            <div class="tx-field-builder">
              <div class="tx-field-col">
                <p class="tx-label">Campos incluidos <span class="mono">({{ fields.length }})</span></p>
                <ul v-if="fields.length" class="tx-field-list">
                  <li v-for="(key, index) in fields" :key="key" class="tx-field">
                    <span class="tx-field__index mono">{{ index + 1 }}</span>
                    <span class="tx-field__body">
                      <strong>{{ fieldLabel(key) }}</strong>
                      <small>{{ fieldGroup(key) }}</small>
                    </span>
                    <button type="button" class="icon-button" :disabled="index === 0" aria-label="Subir campo" @click="moveField(index, -1)">
                      <app-icon name="chevron-up"></app-icon>
                    </button>
                    <button type="button" class="icon-button" :disabled="index === fields.length - 1" aria-label="Bajar campo" @click="moveField(index, 1)">
                      <app-icon name="chevron-down"></app-icon>
                    </button>
                    <button type="button" class="icon-button" aria-label="Quitar campo" @click="toggleField(key)">
                      <app-icon name="minus"></app-icon>
                    </button>
                  </li>
                </ul>
                <p v-else class="tx-empty">El perfil no tiene campos. Añade al menos uno de la lista de disponibles.</p>
                <button type="button" class="text-button" @click="resetFields">Restablecer el perfil seleccionado</button>
              </div>

              <div class="tx-field-col">
                <p class="tx-label">Campos disponibles</p>
                <div class="tx-available">
                  <button v-for="field in availableFields" :key="field.key" type="button" class="tx-available__item" @click="toggleField(field.key)">
                    <app-icon name="plus"></app-icon>
                    <span>{{ field.label }}</span>
                    <small>{{ field.group }}</small>
                  </button>
                  <p v-if="!availableFields.length" class="tx-muted">Todos los campos están incluidos.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="tx-panel" data-od-id="export-format" aria-labelledby="tx-export-format">
            <header class="tx-panel__head">
              <div>
                <p class="eyebrow"><span class="eyebrow__line"></span> Paso 3 · Formato</p>
                <h2 id="tx-export-format">Cómo se entrega el archivo</h2>
                <p>CSV es la opción más compatible; Excel está pensado para entregas a terceros.</p>
              </div>
            </header>

            <div class="tx-scope tx-scope--formats">
              <button type="button" class="tx-scope__card" :class="{ 'is-active': format === 'csv' }" :aria-pressed="format === 'csv'" @click="format = 'csv'">
                <span class="tx-scope__icon"><app-icon name="file-text"></app-icon></span>
                <span class="tx-scope__body">
                  <strong>CSV delimitado</strong>
                  <small>Texto ligero que abre cualquier hoja de cálculo o sistema.</small>
                </span>
              </button>
              <button type="button" class="tx-scope__card" :class="{ 'is-active': format === 'xlsx' }" :aria-pressed="format === 'xlsx'" @click="format = 'xlsx'">
                <span class="tx-scope__icon"><app-icon name="table"></app-icon></span>
                <span class="tx-scope__body">
                  <strong>Libro Excel</strong>
                  <small>Encabezados fijos y columnas con formato de número.</small>
                </span>
              </button>
            </div>

            <p v-if="format === 'xlsx'" class="form-note">
              <app-icon name="info"></app-icon>
              En este prototipo el libro .xlsx se representa de forma simulada; la descarga disponible es el CSV equivalente.
            </p>

            <div class="tx-options">
              <label class="check-row">
                <input v-model="options.headerRow" type="checkbox">
                <span><strong>Incluir fila de encabezados</strong><small>La primera fila repite el nombre de cada campo.</small></span>
              </label>
              <label class="check-row">
                <input v-model="options.includeEmpty" type="checkbox">
                <span><strong>Incluir columnas sin datos</strong><small>Si se desactiva, se omiten las columnas vacías en todos los registros.</small></span>
              </label>
              <label class="check-row">
                <input v-model="options.bom" type="checkbox">
                <span><strong>Compatible con Excel en español</strong><small>Añade marca de orden de bytes para conservar los acentos.</small></span>
              </label>
              <div class="field tx-options__field">
                <label for="tx-export-separator">Separador de columnas</label>
                <div class="input-shell">
                  <select id="tx-export-separator" v-model="options.separator">
                    <option value=";">Punto y coma (;)</option>
                    <option value=",">Coma (,)</option>
                  </select>
                  <app-icon name="chevron-down"></app-icon>
                </div>
              </div>
            </div>

            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </section>

          <footer class="tx-foot">
            <p class="tx-foot__note">
              {{ estimateRows }} filas · {{ fields.length }} columnas · vista previa de {{ Math.min(3, estimateRows) }} registros.
            </p>
            <div class="tx-foot__actions">
              <button type="button" class="btn btn--primary" data-od-id="export-generate" :disabled="!canGenerate" @click="generate">
                <app-icon name="download"></app-icon> {{ generating ? 'Generando…' : 'Generar exportación' }}
              </button>
            </div>
          </footer>
        </div>

        <aside class="tx-rail" aria-label="Resumen de la exportación">
          <div class="tx-rail__card">
            <header class="tx-rail__head">
              <h3>Resumen</h3>
              <span class="tx-tag">{{ format === 'xlsx' ? 'Excel' : 'CSV' }}</span>
            </header>
            <dl class="tx-summary-list">
              <div><dt>Alcance</dt><dd>{{ scopeLabel }}</dd></div>
              <div><dt>Activos</dt><dd class="mono">{{ estimateRows }}</dd></div>
              <div><dt>Columnas</dt><dd class="mono">{{ fields.length }}</dd></div>
              <div><dt>Tamaño estimado</dt><dd class="mono">{{ estimateSize }}</dd></div>
              <div><dt>Perfil</dt><dd>{{ activeProfile ? activeProfile.name : 'Personalizado' }}</dd></div>
            </dl>
          </div>

          <div class="tx-rail__card">
            <header class="tx-rail__head"><h3>Vista previa</h3></header>
            <div v-if="previewRows.length" class="tx-mini-table-wrap">
              <table class="tx-mini-table">
                <thead>
                  <tr><th v-for="key in previewFields" :key="key">{{ fieldLabel(key) }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in previewRows" :key="index">
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex" class="mono">{{ cell || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="tx-muted">Añade campos y activos para ver la vista previa.</p>
          </div>

          <div v-if="generating" class="tx-rail__card" role="status" aria-live="polite">
            <header class="tx-rail__head"><h3>Generando</h3><span class="mono">{{ progress }}%</span></header>
            <div class="tx-progress__track"><span class="tx-progress__fill" :style="{ width: progress + '%' }"></span></div>
            <p class="tx-muted">{{ progressLabel }}</p>
          </div>

          <div v-if="result" class="tx-rail__card tx-rail__card--result">
            <header class="tx-rail__head"><h3>Archivo generado</h3><app-icon name="check"></app-icon></header>
            <p class="tx-result-file mono">{{ result.fileName }}</p>
            <dl class="tx-summary-list">
              <div><dt>Filas</dt><dd class="mono">{{ result.rows.length }}</dd></div>
              <div><dt>Columnas</dt><dd class="mono">{{ result.fields.length }}</dd></div>
              <div><dt>Tamaño</dt><dd class="mono">{{ formatSize(result.size) }}</dd></div>
            </dl>
            <div class="tx-rail__actions">
              <button type="button" class="btn btn--primary btn--small" data-od-id="export-download" @click="download">
                <app-icon name="download"></app-icon> Descargar{{ result.format === 'xlsx' ? ' CSV' : ' CSV' }}
              </button>
              <button type="button" class="text-button" @click="clearResult">Descartar</button>
            </div>
            <p v-if="result.format === 'xlsx'" class="tx-hint"><app-icon name="info"></app-icon> El libro de Excel se entrega como CSV equivalente.</p>
          </div>

          <div class="tx-rail__card">
            <header class="tx-rail__head"><h3>Exportaciones recientes</h3></header>
            <ul v-if="recentExports.length" class="tx-rail-list">
              <li v-for="entry in recentExports" :key="entry.id">
                <strong class="mono">{{ entry.fileName }}</strong>
                <span>{{ entry.rows }} filas · {{ formatSize(entry.size) }}</span>
                <small>{{ entry.profile }} · {{ formatWhen(entry.at) }}</small>
              </li>
            </ul>
            <p v-else class="tx-muted">Todavía no has generado exportaciones.</p>
          </div>
        </aside>

        <transfer-profile-dialog :open="profilesOpen" kind="export" @close="profilesOpen = false"
                                @apply="applyProfile" @save="saveProfile"></transfer-profile-dialog>
      </div>
    `
  };

  /* Preferencias en Configuración ----------------------------------------- */

  window.AssetTransferViews.DataTransferSettings = {
    name: 'DataTransferSettings',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        draft: Data.getPrefs(),
        savedAt: ''
      };
    },
    computed: {
      importProfiles() {
        return Data.profiles('import');
      },
      exportProfiles() {
        return Data.profiles('export');
      },
      customCount() {
        return this.importProfiles.concat(this.exportProfiles).filter((profile) => !profile.builtin).length;
      },
      savedNote() {
        return this.savedAt
          ? 'Preferencias guardadas ' + Data.formatDateTime(this.savedAt) + ' en este navegador.'
          : 'Se aplican a las próximas importaciones y exportaciones de este navegador.';
      }
    },
    methods: {
      save() {
        this.draft = Data.savePrefs({
          defaultImportProfile: this.draft.defaultImportProfile,
          defaultExportProfile: this.draft.defaultExportProfile,
          defaultFormat: this.draft.defaultFormat,
          duplicatePolicy: this.draft.duplicatePolicy,
          headerRow: this.draft.headerRow,
          separator: this.draft.separator,
          bom: this.draft.bom,
          includeEmpty: this.draft.includeEmpty,
          confirmUpdates: this.draft.confirmUpdates,
          keepHistory: this.draft.keepHistory
        });
        this.savedAt = new Date().toISOString();
        this.app.showToast('Preferencias de datos guardadas.');
      },
      openImport() {
        this.app.setHash('#/datos/importar');
      },
      openExport() {
        this.app.setHash('#/datos/exportar');
      }
    },
    template: `
      <section class="config-section" aria-labelledby="config-data-title" data-od-id="config-data">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Entrada y salida</p>
            <h2 id="config-data-title">Datos e importación</h2>
            <p>Define el perfil que se aplica por defecto y cómo se tratan los archivos antes de confirmar los cambios.</p>
          </div>
          <span class="config-badge"><app-icon name="upload"></app-icon> Local</span>
        </header>

        <form class="form-stack" novalidate @submit.prevent="save">
          <div class="form-grid">
            <div class="field">
              <label for="cfg-import-profile">Perfil de importación por defecto</label>
              <div class="input-shell">
                <app-icon name="upload"></app-icon>
                <select id="cfg-import-profile" v-model="draft.defaultImportProfile">
                  <option v-for="profile in importProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
              <p class="field__hint">Se preselecciona al abrir el asistente.</p>
            </div>

            <div class="field">
              <label for="cfg-export-profile">Perfil de exportación por defecto</label>
              <div class="input-shell">
                <app-icon name="download"></app-icon>
                <select id="cfg-export-profile" v-model="draft.defaultExportProfile">
                  <option v-for="profile in exportProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
              <p class="field__hint">Los perfiles propios aparecen al final de la lista.</p>
            </div>

            <div class="field">
              <label for="cfg-data-format">Formato de salida</label>
              <div class="input-shell">
                <app-icon name="file-text"></app-icon>
                <select id="cfg-data-format" v-model="draft.defaultFormat">
                  <option value="csv">CSV delimitado</option>
                  <option value="xlsx">Libro Excel</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
            </div>

            <div class="field">
              <label for="cfg-data-duplicates">Duplicados en el archivo</label>
              <div class="input-shell">
                <app-icon name="layers"></app-icon>
                <select id="cfg-data-duplicates" v-model="draft.duplicatePolicy">
                  <option value="ask">Preguntar en cada importación</option>
                  <option value="skip">Omitir el segundo registro</option>
                  <option value="create">Crear un activo distinto</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
              <p class="field__hint">El asistente siempre muestra los duplicados detectados.</p>
            </div>
          </div>

          <div class="tx-setting-list">
            <label class="tx-rule tx-rule--toggle">
              <span class="switch">
                <input v-model="draft.confirmUpdates" type="checkbox">
                <span class="switch__track"><span class="switch__thumb"></span></span>
              </span>
              <div><strong>Pedir confirmación antes de aplicar</strong><span>Muestra el detalle de las actualizaciones y de las altas previstas.</span></div>
            </label>
            <label class="tx-rule tx-rule--toggle">
              <span class="switch">
                <input v-model="draft.keepHistory" type="checkbox">
                <span class="switch__track"><span class="switch__thumb"></span></span>
              </span>
              <div><strong>Guardar el historial de importaciones</strong><span>Conserva el archivo, el perfil y el resultado de las últimas ocho importaciones en este navegador.</span></div>
            </label>
            <label class="tx-rule tx-rule--toggle">
              <span class="switch">
                <input v-model="draft.headerRow" type="checkbox">
                <span class="switch__track"><span class="switch__thumb"></span></span>
              </span>
              <div><strong>Exportar con fila de encabezados</strong><span>La primera fila del archivo repite el nombre de cada campo.</span></div>
            </label>
            <label class="tx-rule tx-rule--toggle">
              <span class="switch">
                <input v-model="draft.includeEmpty" type="checkbox">
                <span class="switch__track"><span class="switch__thumb"></span></span>
              </span>
              <div><strong>Incluir columnas sin datos</strong><span>Si se desactiva, se omiten las columnas vacías en todos los registros.</span></div>
            </label>
          </div>

          <div class="config-note">
            <app-icon name="lock"></app-icon>
            <p><strong>Reglas fijas del módulo.</strong> El ID permanente nunca se reemplaza en una actualización, los campos vacíos no sobrescriben valores y toda importación queda registrada con el archivo de origen.</p>
          </div>

          <div class="tx-profile-summary">
            <div>
              <span class="tx-kpi__label">Perfiles</span>
              <strong class="mono">{{ importProfiles.length + exportProfiles.length }}</strong>
            </div>
            <div>
              <span class="tx-kpi__label">Propios</span>
              <strong class="mono">{{ customCount }}</strong>
            </div>
            <div class="tx-profile-summary__links">
              <button type="button" class="text-button" @click="openImport"><app-icon name="upload"></app-icon> Abrir importación</button>
              <button type="button" class="text-button" @click="openExport"><app-icon name="download"></app-icon> Abrir exportación</button>
            </div>
          </div>

          <div class="config-form-foot">
            <p class="config-form-foot__note">{{ savedNote }}</p>
            <button type="submit" class="btn btn--primary" data-od-id="export-settings-save">Guardar preferencias</button>
          </div>
        </form>
      </section>
    `
  };
})();
