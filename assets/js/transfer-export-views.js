/* Generador de exportaciones y preferencias del módulo. */
(function () {
  'use strict';

  const Data = window.AssetTransferData;
  const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

  window.AssetTransferViews = window.AssetTransferViews || {};

  /*
   * Contrato real de POST /assets/export (itsm/workflows/service.py -> export()):
   * filtros de igualdad exacta, CSV separado por comas con fila de encabezados y
   * BOM UTF-8. Todavía no acepta texto libre, separador, supresión de encabezados
   * o BOM, columnas vacías ni una opción de inventario completo.
   */
  const SERVER_FIELDS = [
    'id', 'quick_code', 'name', 'category', 'type', 'brand', 'model', 'serial',
    'ip', 'site', 'location', 'responsible', 'status', 'description', 'cost',
    'technical', 'site_id', 'location_id', 'responsible_person_id', 'position_x',
    'position_y'
  ];
  const SERVER_FILTERS = ['category', 'status', 'site_id', 'location_id', 'responsible_person_id', 'archived'];

  // POST /assets/export recibe el separador por nombre, nunca el delimitador
  // literal: la vista conserva las etiquetas visibles y traduce en el envío.
  const SEPARATOR_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

  // Clave del catálogo original -> columna del servidor. Las claves sin
  // correspondencia se muestran deshabilitadas en lugar de enviarse y perderse.
  const FIELD_MAP = {
    id: 'id',
    code: 'quick_code',
    name: 'name',
    category: 'category',
    type: 'type',
    brand: 'brand',
    model: 'model',
    serial: 'serial',
    ip: 'ip',
    site: 'site',
    location: 'location',
    assignee: 'responsible',
    status: 'status',
    cost: 'cost'
  };

  const DEFAULT_FIELDS = ['id', 'name', 'category', 'status'];

  const SCOPE_OPTIONS = [
    {
      id: 'filters',
      label: 'Filtros de la vista',
      description: 'El servidor aplica la categoría, el estado y la ubicación del inventario; no incluye activos archivados.',
      icon: 'search',
      enabled: true
    },
    {
      id: 'all',
      label: 'Todo el inventario',
      description: 'El servidor exporta el inventario completo, sin los filtros de la vista.',
      icon: 'layers',
      enabled: true
    },
    {
      id: 'selection',
      label: 'Selección manual',
      description: 'Exporta los activos marcados en la lista cargada de esta vista.',
      icon: 'check',
      enabled: true
    }
  ];

  function normalizeFields(list) {
    const keys = [];
    (Array.isArray(list) ? list : []).forEach((key) => {
      if (key === 'id' || !FIELD_MAP[key] || keys.indexOf(key) !== -1) return;
      keys.push(key);
    });
    return ['id'].concat(keys);
  }

  function serverName(key) {
    return FIELD_MAP[key] || '';
  }

  function catalogKey(field) {
    const keys = Object.keys(FIELD_MAP);
    for (let index = 0; index < keys.length; index += 1) {
      if (FIELD_MAP[keys[index]] === field) return keys[index];
    }
    return '';
  }

  window.AssetTransferViews.TransferExport = {
    name: 'TransferExport',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell, TransferProfileDialog: window.AssetTransferViews.TransferProfileDialog },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        scope: 'filters',
        selectedIds: [],
        assetSearch: '',
        fields: DEFAULT_FIELDS.slice(),
        profileId: '',
        format: 'csv',
        // Valores reales del servidor: no son preferencias editables del navegador.
        options: {
          headerRow: true,
          separator: ',',
          bom: true,
          includeEmpty: true
        },
        profilesOpen: false,
        profilesError: '',
        exportRun: { epoch: 0, controller: null },
        generating: false,
        progress: 0,
        progressLabel: '',
        result: null,
        error: ''
      };
    },
    created() {
      // El importador ya carga los perfiles del servidor al montar el módulo;
      // no se repite la lectura si la página ya tiene resultados o está en curso.
      const page = this.app.phase6 && this.app.phase6.profiles;
      if (page && (page.loading || (Array.isArray(page.items) && page.items.length))) return;
      this.refreshProfiles();
    },
    computed: {
      profileOptions() {
        const page = this.app.phase6 && this.app.phase6.profiles;
        const items = page && Array.isArray(page.items) ? page.items : [];
        return items
          .filter((profile) => profile && profile.options && profile.options.kind === 'export')
          .map((profile) => ({
            id: profile.id,
            name: profile.name,
            description: text(profile.options.description),
            fields: Array.isArray(profile.options.fields) ? profile.options.fields.slice() : [],
            format: 'csv'
          }));
      },
      activeProfile() {
        return this.profileOptions.find((profile) => profile.id === this.profileId) || null;
      },
      scopes() {
        return SCOPE_OPTIONS.map((option) => Object.assign({}, option, {
          count: option.id === 'selection' ? this.selectedIds.length : '—'
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
        return this.fields.map((key) => this.fieldInfo(key)).filter(Boolean);
      },
      availableFields() {
        return Data.EXPORT_FIELDS
          .filter((field) => this.fields.indexOf(field.key) === -1)
          .map((field) => Object.assign({}, field, { supported: !!FIELD_MAP[field.key] }));
      },
      previewFields() {
        return this.fields.slice(0, 2);
      },
      previewAssets() {
        return this.scopeAssets.slice(0, 3);
      },
      previewRows() {
        return this.previewAssets.map((asset) => this.previewFields.map((key) => this.previewValue(asset, key)));
      },
      exportFields() {
        const mapped = this.fields.map(serverName).filter(Boolean);
        return ['id'].concat(mapped.filter((field, index) => field !== 'id' && mapped.indexOf(field) === index));
      },
      exportFilters() {
        const filters = { archived: false };
        const inventory = this.app.inventoryFilters || {};
        ['category', 'status'].forEach((key) => {
          const value = text(inventory[key]);
          if (value && value !== 'all') filters[key] = value;
        });
        const location = this.app.workspaceInventory && text(this.app.workspaceInventory.location);
        if (location && location !== 'all') filters.location_id = location;
        return filters;
      },
      blockedFilters() {
        const blocked = [];
        const inventory = this.app.inventoryFilters || {};
        const prefs = this.app.prefs || {};
        if (text(inventory.query)) blocked.push('la búsqueda de texto del inventario');
        if (text(prefs.search)) blocked.push('la búsqueda de la vista');
        if (text(prefs.site) && prefs.site !== 'all') blocked.push('el filtro de sede');
        return blocked.join(' y ');
      },
      scopeLabel() {
        const option = SCOPE_OPTIONS.find((item) => item.id === this.scope);
        return option ? option.label : '';
      },
      scopeCountLabel() {
        if (this.scope === 'selection') return String(this.selectedIds.length);
        if (this.scope === 'filters') return 'Según filtros';
        return '—';
      },
      scopeFootNote() {
        const columns = this.exportFields.length;
        if (this.scope === 'selection') {
          return this.selectedIds.length + ' activos seleccionados · ' + columns + ' columnas · el archivo lo genera el servidor.';
        }
        if (this.scope === 'all') return 'Todo el inventario del servidor · ' + columns + ' columnas.';
        return 'Filtros del servidor · ' + columns + ' columnas · vista previa de los activos cargados.';
      },
      canGenerate() {
        if (this.generating || !this.exportFields.length) return false;
        if (this.scope === 'selection') return this.selectedIds.length > 0;
        return true;
      }
    },
    methods: {
      fieldInfo(key) {
        const field = Data.EXPORT_FIELDS.find((item) => item.key === key);
        if (field) return field;
        if (key === 'id') return { key: 'id', label: 'ID permanente', group: 'Identificación' };
        const name = catalogKey(key);
        return name ? (Data.EXPORT_FIELDS.find((item) => item.key === name) || null) : null;
      },
      fieldLabel(key) {
        const field = this.fieldInfo(key);
        if (field) return field.label;
        return catalogKey(key) || key;
      },
      fieldGroup(key) {
        const field = this.fieldInfo(key);
        if (field) return field.group;
        return '';
      },
      fieldNote(field) {
        if (!field || field.supported) return field ? field.group : '';
        return field.group + ' · No disponible en el servidor';
      },
      previewValue(asset, key) {
        if (!asset) return '';
        if (key === 'id') return text(asset.id);
        if (key === 'code') return text(asset.code || asset.quickCode);
        if (key === 'category') return text(asset.categoryText || asset.category);
        if (key === 'assignee') return text(asset.responsible || asset.assignee);
        if (key === 'site') return text(asset.site);
        if (key === 'location') return text(asset.location);
        if (key === 'status') return text(asset.status);
        return text(asset[key]);
      },
      formatSize(value) {
        return Data.formatBytes(value);
      },
      setScope(id) {
        const option = SCOPE_OPTIONS.find((item) => item.id === id);
        if (!option || option.enabled === false) return;
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
        if (key === 'id') {
          this.error = 'El ID permanente siempre forma parte de la exportación.';
          return;
        }
        if (!FIELD_MAP[key]) {
          this.error = 'Ese campo no lo admite la exportación del servidor.';
          return;
        }
        if (this.fields.indexOf(key) !== -1) {
          this.fields = this.fields.filter((item) => item !== key);
        } else {
          this.fields = this.fields.concat([key]);
        }
        this.result = null;
        this.error = '';
      },
      moveField(index, delta) {
        if (index === 0) return;
        const target = index + delta;
        if (target <= 0 || target >= this.fields.length) return;
        const next = this.fields.slice();
        const value = next[index];
        next[index] = next[target];
        next[target] = value;
        this.fields = normalizeFields(next);
      },
      resetFields() {
        if (this.activeProfile) this.applyProfile(this.activeProfile);
        else {
          this.fields = normalizeFields(DEFAULT_FIELDS);
          this.profileId = '';
        }
      },
      applyProfile(profile) {
        if (!profile) return;
        const options = profile.options && typeof profile.options === 'object' ? profile.options : null;
        if (options && options.kind !== 'export') {
          this.error = 'Ese perfil no es de exportación.';
          return;
        }
        const fields = options ? options.fields : profile.fields;
        const keys = (Array.isArray(fields) ? fields : []).map((field) => catalogKey(field) || field);
        this.profileId = profile.id;
        this.fields = normalizeFields(keys);
        this.format = 'csv';
        this.result = null;
        this.error = '';
        this.profilesOpen = false;
      },
      applyProfileById(event) {
        const id = event && event.target ? text(event.target.value) : '';
        const profile = this.profileOptions.find((item) => item.id === id) || null;
        if (profile) this.applyProfile(profile);
        else this.profileId = '';
        if (event && event.target) event.target.value = this.profileId;
      },
      async refreshProfiles() {
        if (!this.app || typeof this.app.loadImportProfiles !== 'function') return false;
        this.profilesError = '';
        try {
          const loaded = await this.app.loadImportProfiles();
          if (loaded === false) this.profilesError = 'No se pudieron cargar los perfiles del servidor.';
          return loaded !== false;
        } catch (error) {
          this.profilesError = 'No se pudieron cargar los perfiles del servidor.';
          return false;
        }
      },
      async saveProfile(name) {
        const label = text(name);
        if (!label) return;
        if (!this.app || typeof this.app.saveImportProfile !== 'function') {
          this.error = 'El servidor no permite guardar perfiles.';
          return;
        }
        const result = await this.app.saveImportProfile(label, {
          kind: 'export',
          fields: this.exportFields.slice(),
          format: 'csv'
        });
        if (!result || !result.ok) {
          this.error = (result && result.error) || 'No se pudo guardar el perfil.';
          return;
        }
        this.profilesOpen = false;
        this.error = '';
        this.app.showToast('Perfil «' + label + '» guardado.');
      },
      sessionToken() {
        const state = this.app.phase6;
        return {
          session: state ? state.sessionEpoch : 0,
          identity: this.app.activeUserId || '',
          authenticated: this.app.authenticated === true
        };
      },
      sessionOpen(token) {
        return !!this.app.phase6
          && this.app.authenticated === true
          && token.authenticated === true
          && this.app.phase6.sessionEpoch === token.session
          && (this.app.activeUserId || '') === token.identity;
      },
      // El adaptador de fase 6 no reenvía `options`; se llama al mismo endpoint
      // con su guarda de sesión y de ejecución viva en lugar de tocarlo.
      async requestExport(body) {
        if (!this.app.phase6CanView) return { ok: false, error: 'No hay permiso para exportar activos.' };
        const token = this.sessionToken();
        const run = this.exportRun;
        if (run.controller) run.controller.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        run.epoch += 1;
        const epoch = run.epoch;
        run.controller = controller;
        try {
          const blob = await window.AssetAccess.request(this.app, '/assets/export', {
            method: 'POST',
            body,
            responseType: 'blob',
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== run.epoch || !this.sessionOpen(token)) return { ok: false, cancelled: true };
          return { ok: true, blob };
        } catch (error) {
          if (epoch !== run.epoch || !this.sessionOpen(token)) return { ok: false, cancelled: true };
          if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
          return { ok: false, error: text(error && error.message) || 'No se pudo exportar.' };
        } finally {
          if (epoch === run.epoch) run.controller = null;
        }
      },
      async generate() {
        this.error = '';
        if (!this.exportFields.length) {
          this.error = 'Elige al menos un campo disponible para exportar.';
          return;
        }
        if (this.scope === 'selection' && !this.selectedIds.length) {
          this.error = 'Selecciona al menos un activo para exportar.';
          return;
        }
        if (this.scope === 'filters' && this.blockedFilters) {
          this.error = 'La exportación por filtros no puede aplicar ' + this.blockedFilters + '. Quita ese filtro o exporta una selección manual.';
          return;
        }
        const input = {
          fields: this.exportFields.slice(),
          options: {
            separator: SEPARATOR_NAMES[this.options.separator] || 'comma',
            headerRow: !!this.options.headerRow,
            bom: !!this.options.bom,
            includeEmpty: !!this.options.includeEmpty
          }
        };
        if (this.scope === 'selection') input.assetIds = this.selectedIds.slice();
        else if (this.scope === 'all') input.filters = { all: true };
        else input.filters = this.exportFilters;
        this.generating = true;
        this.progress = 0;
        this.progressLabel = 'Esperando el archivo del servidor…';
        this.result = null;
        try {
          const response = await this.requestExport(input);
          if (!response || !response.ok) {
            this.error = response && response.cancelled
              ? 'La exportación se canceló.'
              : (response && response.error) || 'No se pudo exportar.';
            return;
          }
          if (!response.blob) {
            this.error = 'El servidor no devolvió el archivo.';
            return;
          }
          this.progress = 100;
          this.progressLabel = 'Archivo recibido.';
          this.result = {
            fileName: text(response.filename) || 'assets.csv',
            blob: response.blob,
            size: response.blob.size,
            fields: this.exportFields.slice(),
            format: 'csv',
            rows: null
          };
          this.app.showToast('Exportación lista: ' + this.exportFields.length + ' columnas.');
        } catch (error) {
          this.error = (error && error.message) || 'No se pudo exportar.';
        } finally {
          this.generating = false;
        }
      },
      download() {
        if (!this.result || !this.result.blob) return;
        try {
          // Se descarga el blob del servidor sin volver a codificarlo.
          const url = URL.createObjectURL(this.result.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = this.result.fileName;
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
                <p>El servidor genera la exportación con los filtros del inventario y nunca incluye el histórico de cambios.</p>
              </div>
            </header>

            <div class="tx-scope">
              <button v-for="option in scopes" :key="option.id" type="button" class="tx-scope__card"
                      :class="{ 'is-active': scope === option.id }" :aria-pressed="scope === option.id"
                      :disabled="option.enabled === false" :aria-disabled="option.enabled === false ? 'true' : 'false'"
                      @click="setScope(option.id)">
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
                      <small class="mono">{{ asset.id }} · {{ asset.site || 'Sin sede' }}</small>
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
                <p>El orden de los campos se traduce en el orden de las columnas del archivo. El ID permanente siempre se exporta.</p>
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
                    <option value="">Sin perfil</option>
                    <option v-for="profile in profileOptions" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                  </select>
                  <app-icon name="chevron-down"></app-icon>
                </div>
              </div>
              <p v-if="activeProfile" class="tx-profile-row__note">{{ activeProfile.description }}</p>
              <p v-else-if="profilesError" class="tx-profile-row__note">{{ profilesError }}</p>
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
                    <button type="button" class="icon-button" :disabled="index === 0 || index === fields.length - 1" aria-label="Bajar campo" @click="moveField(index, 1)">
                      <app-icon name="chevron-down"></app-icon>
                    </button>
                    <button type="button" class="icon-button" :disabled="key === 'id'" aria-label="Quitar campo" @click="toggleField(key)">
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
                  <button v-for="field in availableFields" :key="field.key" type="button" class="tx-available__item"
                          :disabled="!field.supported" :aria-disabled="!field.supported ? 'true' : 'false'"
                          @click="toggleField(field.key)">
                    <app-icon name="plus"></app-icon>
                    <span>{{ field.label }}</span>
                    <small>{{ fieldNote(field) }}</small>
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
                <p>El servidor entrega un CSV separado por comas; no hay otro formato disponible.</p>
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
              <button type="button" class="tx-scope__card" :class="{ 'is-active': false }" :aria-pressed="false"
                      :disabled="true" aria-disabled="true">
                <span class="tx-scope__icon"><app-icon name="table"></app-icon></span>
                <span class="tx-scope__body">
                  <strong>Libro Excel</strong>
                  <small>No disponible: el servidor solo entrega CSV.</small>
                </span>
              </button>
            </div>

            <p class="form-note">
              <app-icon name="info"></app-icon>
              El servidor aplica el separador, los encabezados, el BOM y las columnas vacías al archivo CSV. El ID permanente nunca se omite.
            </p>

            <div class="tx-options">
              <label class="check-row">
                <input v-model="options.headerRow" type="checkbox">
                <span><strong>Incluir fila de encabezados</strong><small>La primera fila repite el nombre de cada campo.</small></span>
              </label>
              <label class="check-row">
                <input v-model="options.includeEmpty" type="checkbox">
                <span><strong>Incluir columnas sin datos</strong><small>Si se desactiva, el servidor omite las columnas vacías en todos los registros; el ID permanente se conserva.</small></span>
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
                <p class="field__hint">El servidor aplica el separador elegido.</p>
              </div>
            </div>

            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </section>

          <footer class="tx-foot">
            <p class="tx-foot__note">{{ scopeFootNote }}</p>
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
              <span class="tx-tag">CSV</span>
            </header>
            <dl class="tx-summary-list">
              <div><dt>Alcance</dt><dd>{{ scopeLabel }}</dd></div>
              <div><dt>Activos</dt><dd class="mono">{{ scopeCountLabel }}</dd></div>
              <div><dt>Columnas</dt><dd class="mono">{{ exportFields.length }}</dd></div>
              <div><dt>Tamaño</dt><dd class="mono">{{ result ? formatSize(result.size) : '—' }}</dd></div>
              <div><dt>Perfil</dt><dd>{{ activeProfile ? activeProfile.name : 'Personalizado' }}</dd></div>
            </dl>
          </div>

          <div class="tx-rail__card">
            <header class="tx-rail__head"><h3>Vista previa</h3></header>
            <p class="tx-muted">Datos cargados en esta vista; el archivo lo genera el servidor.</p>
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
              <div><dt>Filas</dt><dd class="mono">—</dd></div>
              <div><dt>Columnas</dt><dd class="mono">{{ result.fields.length }}</dd></div>
              <div><dt>Tamaño</dt><dd class="mono">{{ formatSize(result.size) }}</dd></div>
            </dl>
            <div class="tx-rail__actions">
              <button type="button" class="btn btn--primary btn--small" data-od-id="export-download" @click="download">
                <app-icon name="download"></app-icon> Descargar CSV
              </button>
              <button type="button" class="text-button" @click="clearResult">Descartar</button>
            </div>
          </div>

          <div class="tx-rail__card">
            <header class="tx-rail__head"><h3>Exportaciones recientes</h3></header>
            <p class="tx-muted">El servidor no guarda un historial de exportaciones.</p>
          </div>
        </aside>

        <transfer-profile-dialog :app="app" :open="profilesOpen" kind="export" @close="profilesOpen = false"
                                @apply="applyProfile" @save="saveProfile"></transfer-profile-dialog>
      </div>
    `
  };

  /* Preferencias en Configuración ----------------------------------------- */

  const BUILTIN_PROFILE_IDS = ['csv-standard', 'csv-spanish', 'xlsx-sites'];

  window.AssetTransferViews.DataTransferSettings = {
    name: 'DataTransferSettings',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return { busy: false, error: '' };
    },
    created() {
      // El importador ya carga los perfiles al abrir el módulo; no se repite la
      // lectura si la página ya tiene resultados o está en curso.
      const page = this.app.phase6 && this.app.phase6.profiles;
      if (page && (page.loading || (Array.isArray(page.items) && page.items.length))) return;
      this.refresh();
    },
    computed: {
      serverProfiles() {
        const page = this.app.phase6 && this.app.phase6.profiles;
        return page && Array.isArray(page.items) ? page.items : [];
      },
      importProfiles() {
        return this.serverProfiles.filter((profile) => this.profileKind(profile) === 'import');
      },
      exportProfiles() {
        return this.serverProfiles.filter((profile) => this.profileKind(profile) === 'export');
      },
      customCount() {
        return this.serverProfiles.filter((profile) => !this.isBuiltin(profile)).length;
      },
      savedNote() {
        return 'Los perfiles se guardan en el servidor. Este formulario no guarda preferencias en el navegador.';
      }
    },
    methods: {
      profileKind(profile) {
        return profile && profile.options && profile.options.kind === 'export' ? 'export' : 'import';
      },
      isBuiltin(profile) {
        return !!profile && BUILTIN_PROFILE_IDS.indexOf(profile.id) !== -1;
      },
      profileMeta(profile) {
        const options = profile && profile.options && typeof profile.options === 'object' ? profile.options : {};
        if (this.profileKind(profile) === 'export') {
          const fields = Array.isArray(options.fields) ? options.fields : [];
          return fields.length + (fields.length === 1 ? ' campo' : ' campos') + ' · CSV';
        }
        const mappings = options.sheetMappings && typeof options.sheetMappings === 'object' ? options.sheetMappings : null;
        let columns = 0;
        if (mappings) {
          columns = Object.keys(mappings).reduce((total, sheet) => {
            return total + Object.keys(mappings[sheet] || {}).filter((column) => mappings[sheet][column]).length;
          }, 0);
        } else if (options.mapping && typeof options.mapping === 'object') {
          columns = Object.keys(options.mapping).filter((column) => options.mapping[column]).length;
        }
        const match = Array.isArray(options.matchFields) ? options.matchFields.length : 0;
        return columns + (columns === 1 ? ' columna · ' : ' columnas · ') + (match ? match + (match === 1 ? ' criterio de identificación' : ' criterios de identificación') : 'sin criterios de identificación');
      },
      async refresh() {
        if (typeof this.app.loadImportProfiles !== 'function') {
          this.error = 'El servidor no permite cargar perfiles.';
          return false;
        }
        this.busy = true;
        this.error = '';
        try {
          const loaded = await this.app.loadImportProfiles();
          if (loaded === false) this.error = 'No se pudieron cargar los perfiles del servidor.';
          return loaded !== false;
        } catch (error) {
          this.error = 'No se pudieron cargar los perfiles del servidor.';
          return false;
        } finally {
          this.busy = false;
        }
      },
      async remove(profile) {
        if (!profile || this.isBuiltin(profile)) return false;
        if (typeof this.app.deleteImportProfile !== 'function') {
          this.error = 'El servidor no permite eliminar perfiles.';
          return false;
        }
        this.error = '';
        const result = await this.app.deleteImportProfile(profile.id);
        if (!result || result.ok !== true) {
          this.error = (result && result.error) || 'No se pudo eliminar el perfil.';
          return false;
        }
        this.app.showToast('Perfil «' + profile.name + '» eliminado del servidor.');
        return true;
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
            <p>Los perfiles reutilizables se guardan en el servidor. Cada importación y cada exportación se revisan antes de confirmar los cambios.</p>
          </div>
          <span class="config-badge"><app-icon name="lock"></app-icon> Servidor</span>
        </header>

        <div class="form-stack">
          <div class="form-grid">
            <div class="field">
              <label for="cfg-data-format">Formato de las exportaciones</label>
              <div class="input-shell">
                <app-icon name="file-text"></app-icon>
                <select id="cfg-data-format" disabled>
                  <option value="csv">CSV delimitado</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
              <p class="field__hint">El servidor genera CSV; las columnas, el separador y la cabecera se eligen en cada exportación.</p>
            </div>

            <div class="field">
              <label for="cfg-data-duplicates">Duplicados en la importación</label>
              <div class="input-shell">
                <app-icon name="layers"></app-icon>
                <select id="cfg-data-duplicates" disabled>
                  <option value="ask">Revisión antes de aplicar</option>
                </select>
                <app-icon name="chevron-down"></app-icon>
              </div>
              <p class="field__hint">El servidor clasifica cada fila como coincidencia segura, posible duplicado o error, y la muestra antes de confirmar.</p>
            </div>
          </div>

          <div class="config-note">
            <app-icon name="lock"></app-icon>
            <p><strong>Reglas fijas del módulo.</strong> El ID permanente nunca se reemplaza en una actualización, los campos vacíos no sobrescriben valores y cada importación, exportación o edición por lote queda registrada como una operación del servidor.</p>
          </div>

          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <ul class="tx-profile-list">
            <li v-for="profile in serverProfiles" :key="profile.id" class="tx-profile">
              <div class="tx-profile__body">
                <div class="tx-profile__title">
                  <strong>{{ profile.name }}</strong>
                  <span class="tx-tag" :class="{ 'tx-tag--builtin': isBuiltin(profile) }">{{ isBuiltin(profile) ? 'Predeterminado' : 'Personalizado' }}</span>
                  <span class="tx-tag">{{ profileKind(profile) === 'export' ? 'Exportación' : 'Importación' }}</span>
                </div>
                <p class="tx-profile__meta mono">{{ profileMeta(profile) }}</p>
              </div>
              <div class="tx-profile__actions">
                <button v-if="!isBuiltin(profile)" type="button" class="icon-button" :aria-label="'Eliminar el perfil ' + profile.name" @click="remove(profile)">
                  <app-icon name="trash"></app-icon>
                </button>
              </div>
            </li>
          </ul>
          <p v-if="!serverProfiles.length" class="tx-muted">El servidor no tiene perfiles guardados.</p>

          <div class="tx-profile-summary">
            <div>
              <span class="tx-kpi__label">Perfiles</span>
              <strong class="mono">{{ serverProfiles.length }}</strong>
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
            <button type="button" class="btn btn--secondary" data-od-id="export-settings-reload" :disabled="busy" @click="refresh">Recargar perfiles</button>
          </div>
        </div>
      </section>
    `
  };
})();
