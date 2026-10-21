(function () {
  'use strict';

  const BUCKETS = [
    { id: 'quick', label: 'Rápido' },
    { id: 'advanced', label: 'Avanzado' },
    { id: 'hidden', label: 'Oculto' }
  ];

  const AssetFieldsPanel = {
    name: 'AssetFieldsPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return { buckets: BUCKETS };
    },
    computed: {
      real() {
        return this.app.inventoryCatalogReady;
      },
      fields() {
        return this.app.inventoryConfigFields();
      },
      canEdit() {
        return this.real ? this.app.inventoryCanConfigure('fields') : true;
      }
    },
    template: `
      <section class="config-section" data-od-id="config-asset-fields">
        <div class="config-section__head">
          <div>
            <span class="eyebrow">Configuración de activos</span>
            <h2>Biblioteca de campos</h2>
            <p v-if="real">Campos técnicos reutilizables entre categorías. El tipo y las opciones de un campo existente no se pueden cambiar; los campos se desactivan sin borrar los valores guardados.</p>
            <p v-else>Campos técnicos reutilizables entre categorías. Edita el nombre, el tipo o las opciones y se actualiza en todos los formularios que los usan.</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="create-asset-field" @click="app.openAssetField()">
            <app-icon name="plus" />
            <span>Nuevo campo</span>
          </button>
        </div>

        <p v-if="real && app.inventoryConfigError" class="field__error" role="alert">{{ app.inventoryConfigError }}</p>

        <div class="asset-row-list">
          <article v-for="field in fields" :key="field.key" class="asset-field-row" :data-od-id="'asset-field-' + field.key">
            <div class="asset-field-row__main">
              <strong>{{ field.label }}</strong>
              <span class="mono asset-field-row__key">{{ field.key }}</span>
            </div>
            <span v-if="field.active === false" class="chip chip--muted">Inactivo</span>
            <span v-if="field.required" class="chip chip--outline">Obligatorio</span>
            <span class="chip chip--muted">{{ app.assetFieldTypeLabel(field.type) }}</span>
            <span class="asset-field-row__meta">{{ app.assetFieldUsage(field) }} formulario(s)</span>
            <span v-if="field.unit" class="asset-field-row__meta mono">{{ field.unit }}</span>
            <div class="row-actions">
              <button v-if="canEdit" type="button" class="icon-button" :aria-label="'Editar ' + field.label" @click="app.openAssetField(field)">
                <app-icon name="pencil" />
              </button>
              <button
                v-if="real && canEdit"
                type="button"
                class="text-button"
                :aria-label="(field.active === false ? 'Activar ' : 'Desactivar ') + field.label"
                @click="app.setAssetFieldActive(field, field.active === false)"
              >{{ field.active === false ? 'Activar' : 'Desactivar' }}</button>
              <button v-else type="button" class="icon-button icon-button--danger" :aria-label="'Eliminar ' + field.label" @click="app.requestDeleteAssetField(field)">
                <app-icon name="trash" />
              </button>
            </div>
          </article>
        </div>
      </section>
    `
  };

  const AssetFormsPanel = {
    name: 'AssetFormsPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return { buckets: BUCKETS };
    },
    computed: {
      real() {
        return this.app.inventoryCatalogReady;
      },
      draft() {
        return this.app.formDraft;
      },
      categoryLabel() {
        if (!this.draft) return '';
        const category = this.categories.find((item) => item.id === this.draft.categoryId);
        return category ? category.label : this.draft.categoryId;
      },
      categories() {
        return this.app.inventoryConfigCategories();
      },
      commonFields() {
        const server = this.app.inventoryCommonFieldOptions();
        if (server) return server;
        return window.AssetSchema.COMMON_FIELDS.filter((field) => ['category', 'image', 'warranty'].indexOf(field.key) === -1);
      },
      techFields() {
        return this.app.inventoryConfigFields().filter((field) => field.active !== false);
      },
      canEdit() {
        return this.real ? this.app.inventoryCanConfigure('fields') : true;
      }
    },
    methods: {
      formFor(categoryId) {
        return this.app.assetForm(categoryId);
      },
      bucketFor(key) {
        return this.app.formFieldBucket(key);
      },
      countTech(categoryId) {
        return this.app.assetForm(categoryId).tech.length;
      }
    },
    template: `
      <section class="config-section" data-od-id="config-asset-forms">
        <div class="config-section__head">
          <div>
            <span class="eyebrow">Configuración de activos</span>
            <h2>Formularios por categoría</h2>
            <p v-if="real">Cada categoría define su prefijo de código rápido y qué campos aparecen en el alta rápida, en los datos avanzados y en la ficha técnica. Los cambios se guardan en el servidor.</p>
            <p v-else>Cada categoría define su prefijo de código rápido y qué campos aparecen en el alta rápida, en los datos avanzados y en la ficha técnica.</p>
          </div>
        </div>

        <div class="asset-forms-layout">
          <nav class="form-category-list" aria-label="Categorías con formulario">
            <button
              v-for="category in categories"
              :key="category.id"
              type="button"
              class="form-category"
              :disabled="!canEdit"
              :class="{ 'form-category--active': app.formDraft && app.formDraft.categoryId === category.id }"
              :aria-pressed="app.formDraft && app.formDraft.categoryId === category.id ? 'true' : 'false'"
              @click="app.openFormDraft(category.id)"
            >
              <app-icon :name="category.icon" />
              <span class="form-category__copy">
                <strong>{{ category.label }}</strong>
                <span class="mono">{{ formFor(category.id).prefix }} · {{ countTech(category.id) }} campos técnicos</span>
              </span>
              <app-icon name="chevron-right" />
            </button>
          </nav>

          <div v-if="!draft" class="config-note asset-forms-empty">
            <app-icon name="sliders" />
            <div>
              <strong>Elige una categoría</strong>
              <p>Vas a poder mover los campos entre alta rápida y datos avanzados, y activar los campos técnicos que correspondan.</p>
            </div>
          </div>

          <div v-else class="form-editor" data-od-id="asset-form-editor">
            <div class="form-editor__head">
              <div>
                <span class="eyebrow">Formulario</span>
                <h3>{{ categoryLabel }}</h3>
              </div>
              <button type="button" class="text-button" @click="app.closeFormDraft()">Cerrar</button>
            </div>

            <div class="config-form-grid">
              <div class="field">
                <label :for="'form-prefix-' + draft.categoryId">Prefijo del código rápido</label>
                <span class="input-shell">
                  <input :id="'form-prefix-' + draft.categoryId" type="text" maxlength="6" v-model="draft.form.prefix" :disabled="!canEdit" />
                </span>
                <span class="field__hint">Se combina con la sede y el correlativo, por ejemplo {{ draft.form.prefix }}-CEN-001.</span>
              </div>
              <div class="field">
                <label :for="'form-type-' + draft.categoryId">Nombre del tipo</label>
                <span class="input-shell">
                  <input :id="'form-type-' + draft.categoryId" type="text" v-model="draft.form.type" :disabled="!canEdit" />
                </span>
              </div>
              <div class="field form-grid__full">
                <label class="switch">
                  <input type="checkbox" v-model="draft.form.fov" :disabled="!canEdit" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                  <span class="switch__text">Campo de visión</span>
                </label>
                <span class="field__hint">Habilita una imagen de cobertura independiente de la fotografía del activo.</span>
              </div>
            </div>

            <h4 class="form-editor__subhead">Campos comunes</h4>
            <div class="bucket-table">
              <div class="bucket-table__head">
                <span>Campo</span>
                <span>Ubicación</span>
              </div>
              <div v-for="field in commonFields" :key="field.key" class="bucket-row">
                <span class="bucket-row__label">{{ field.label }}</span>
                <div class="bucket-control" role="group" :aria-label="'Ubicación de ' + field.label">
                  <button
                    v-for="bucket in buckets"
                    :key="bucket.id"
                    type="button"
                    :disabled="!canEdit"
                    :class="{ 'bucket-control__option--active': bucketFor(field.key) === bucket.id }"
                    :aria-pressed="bucketFor(field.key) === bucket.id ? 'true' : 'false'"
                    @click="app.setFormFieldBucket(field.key, bucket.id)"
                  >{{ bucket.label }}</button>
                </div>
              </div>
            </div>

            <h4 class="form-editor__subhead">Campos técnicos disponibles</h4>
            <div class="tech-toggle-grid">
              <button
                v-for="field in techFields"
                :key="field.key"
                type="button"
                class="tech-toggle"
                :disabled="!canEdit"
                :class="{ 'tech-toggle--active': draft.form.tech.indexOf(field.key) !== -1 }"
                :aria-pressed="draft.form.tech.indexOf(field.key) !== -1 ? 'true' : 'false'"
                @click="app.toggleFormTech(field.key)"
              >
                <app-icon :name="draft.form.tech.indexOf(field.key) !== -1 ? 'check' : 'plus'" />
                <span>{{ field.label }}</span>
              </button>
            </div>

            <p v-if="app.formDraftError" class="field__error" role="alert">{{ app.formDraftError }}</p>

            <div class="form-editor__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="app.closeFormDraft()">Descartar</button>
              <button v-if="canEdit" type="button" class="btn btn--primary btn--small" @click="app.saveFormDraft()">Guardar formulario</button>
            </div>
          </div>
        </div>
      </section>
    `
  };

  const AssetStatusesPanel = {
    name: 'AssetStatusesPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    computed: {
      real() {
        return this.app.inventoryCatalogReady;
      },
      statuses() {
        return this.app.inventoryConfigStatuses();
      },
      canEdit() {
        return this.real ? this.app.inventoryCanConfigure('statuses') : true;
      }
    },
    template: `
      <section class="config-section" data-od-id="config-asset-statuses">
        <div class="config-section__head">
          <div>
            <span class="eyebrow">Configuración de activos</span>
            <h2>Estados del activo</h2>
            <p v-if="real">Los estados se guardan en el servidor. Desactivar un estado no cambia el estado de los activos que ya lo usan.</p>
            <p v-else>Los estados operativos se pueden renombrar y reordenar según el proceso. Solo el estado final retira el activo del inventario operativo.</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="create-asset-status" @click="app.openAssetStatusDialog()">
            <app-icon name="plus" />
            <span>Nuevo estado</span>
          </button>
        </div>

        <p v-if="real && app.inventoryConfigError" class="field__error" role="alert">{{ app.inventoryConfigError }}</p>

        <div class="asset-row-list">
          <article v-for="status in statuses" :key="status.id" class="asset-status-row" :data-od-id="'asset-status-' + status.id">
            <span class="status-dot" :class="'status-dot--' + status.tone"></span>
            <div class="asset-status-row__main">
              <strong>{{ status.label }}</strong>
              <span class="mono asset-status-row__tone">{{ app.assetToneLabel(status.tone) }}</span>
            </div>
            <span v-if="status.active === false" class="chip chip--muted">Inactivo</span>
            <span v-if="status.final" class="chip chip--outline">Estado final</span>
            <span class="asset-field-row__meta">{{ app.assetStatusUsage(status) }}</span>
            <div class="row-actions">
              <button v-if="canEdit" type="button" class="icon-button" :aria-label="'Editar ' + status.label" @click="app.openAssetStatusDialog(status)">
                <app-icon name="pencil" />
              </button>
              <button
                v-if="real && canEdit"
                type="button"
                class="text-button"
                :aria-label="(status.active === false ? 'Activar ' : 'Desactivar ') + status.label"
                @click="app.setAssetStatusActive(status, status.active === false)"
              >{{ status.active === false ? 'Activar' : 'Desactivar' }}</button>
              <button v-else type="button" class="icon-button icon-button--danger" :aria-label="'Eliminar ' + status.label" @click="app.requestDeleteAssetStatus(status)">
                <app-icon name="trash" />
              </button>
            </div>
          </article>
        </div>
      </section>
    `
  };

  const AssetIdentityPanel = {
    name: 'AssetIdentityPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    computed: {
      real() {
        return this.app.inventoryCatalogReady;
      },
      rules() {
        return this.real ? this.app.inventoryRulesDraft() : this.app.assetIdRulesDraft;
      },
      errors() {
        return this.real ? {} : (this.app.assetIdRulesErrors || {});
      },
      permanentPreview() {
        return window.AssetSchema.nextPermanentId(this.app.assets, this.app.assetAdmin);
      },
      quickPreview() {
        return this.app.assetQuickPreview();
      },
      mode() {
        return this.real ? '' : this.app.assetAdmin.operations.mode;
      },
      purge() {
        return this.real ? this.app.inventoryPurgePolicy() : null;
      },
      statuses() {
        return this.real ? this.app.inventoryConfigStatuses() : [];
      },
      canEdit() {
        return this.real ? this.app.inventoryCanConfigure('rules') : true;
      }
    },
    template: `
      <section class="config-section" data-od-id="config-asset-identity">
        <div class="config-section__head">
          <div>
            <span class="eyebrow">Configuración de activos</span>
            <h2>Identificación</h2>
            <p v-if="real">El servidor asigna un identificador permanente que nunca cambia ni se reutiliza. El código rápido se puede editar y cada cambio queda registrado en el historial.</p>
            <p v-else>Reglas del ID permanente y del código rápido. El ID nunca cambia; el código rápido se adapta a la sede y al tipo del activo.</p>
          </div>
        </div>

        <p v-if="real && app.inventoryConfigError" class="field__error" role="alert">{{ app.inventoryConfigError }}</p>

        <div class="identity-preview">
          <div class="identity-preview__cell">
            <span class="eyebrow">{{ real ? 'Identificador permanente' : 'Próximo ID permanente' }}</span>
            <strong class="mono">{{ real ? 'UUID del servidor' : permanentPreview }}</strong>
            <span class="identity-preview__hint">{{ real ? 'Inmutable e independiente de la sede y del tipo.' : 'Secuencial e inmutable.' }}</span>
          </div>
          <div class="identity-preview__cell">
            <span class="eyebrow">Ejemplo de código rápido</span>
            <strong class="mono">{{ quickPreview }}</strong>
            <span class="identity-preview__hint">Tipo · sede · correlativo.</span>
          </div>
        </div>

        <div class="config-form-grid">
          <div v-if="!real" class="field" :class="{ 'field--invalid': !!errors.permanentPrefix }">
            <label for="rules-permanent-prefix">Prefijo del ID</label>
            <span class="input-shell">
              <input id="rules-permanent-prefix" type="text" maxlength="6" v-model="rules.permanentPrefix" />
            </span>
            <span class="field__hint">Se antepone al número correlativo.</span>
          </div>
          <div class="field">
            <label for="rules-separator">Separador</label>
            <span class="input-shell">
              <input id="rules-separator" type="text" maxlength="2" v-model="rules.separator" />
            </span>
            <span class="field__hint">Se usa entre prefijo, sede y número.</span>
          </div>
          <div v-if="!real" class="field" :class="{ 'field--invalid': !!errors.permanentPad }">
            <label for="rules-permanent-pad">Dígitos del ID</label>
            <span class="input-shell">
              <input id="rules-permanent-pad" type="number" min="3" max="8" v-model="rules.permanentPad" />
            </span>
            <span v-if="errors.permanentPad" class="field__error">{{ errors.permanentPad }}</span>
          </div>
          <div class="field" :class="{ 'field--invalid': !!errors.quickPad }">
            <label for="rules-quick-pad">Dígitos del correlativo</label>
            <span class="input-shell">
              <input id="rules-quick-pad" type="number" min="2" max="5" v-model="rules.quickPad" />
            </span>
            <span v-if="errors.quickPad" class="field__error">{{ errors.quickPad }}</span>
          </div>
          <div class="field">
            <label for="rules-site-length">Letras de la sede en el código</label>
            <span class="input-shell">
              <input id="rules-site-length" type="number" min="2" max="5" v-model="rules.siteCodeLength" />
            </span>
            <span class="field__hint">Ej. «Central» se abrevia como CEN.</span>
          </div>
          <div class="field">
            <label class="switch">
              <input type="checkbox" v-model="rules.includeSite" />
              <span class="switch__track"><span class="switch__thumb"></span></span>
              <span class="switch__text">Incluir la sede</span>
            </label>
            <span class="field__hint">Si se desactiva, el código queda como PREFIJO-001.</span>
          </div>
          <div v-if="real" class="field">
            <label for="rules-order">Orden del código</label>
            <span class="input-shell">
              <select id="rules-order" v-model="rules.order">
                <option value="site-type">Sede y después tipo</option>
                <option value="type-site">Tipo y después sede</option>
              </select>
            </span>
            <span class="field__hint">Cambia solo el orden visible del código rápido.</span>
          </div>
        </div>

        <div v-if="canEdit" class="form-editor__actions">
          <button type="button" class="btn btn--ghost btn--small" @click="app.resetAssetIdRules()">Restablecer</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="save-asset-identity" @click="app.saveAssetIdRules()">Guardar reglas</button>
        </div>
        <p v-else class="config-note"><app-icon name="info" /><span>Tu rol puede consultar estas reglas, pero no modificarlas.</span></p>

        <template v-if="real">
          <h3 class="identity-subhead">Transiciones de estado</h3>
          <p class="identity-lead">Cada fila autoriza un cambio de estado. El servidor aplica la tabla de la categoría cuando existe y, si no, esta tabla global.</p>
          <div v-if="app.inventoryTransitionRows().length" class="transition-rows">
            <div v-for="(row, index) in app.inventoryTransitionRows()" :key="index" class="transition-row">
              <span class="input-shell">
                <select v-model="row.from" :aria-label="'Estado de origen de la transición ' + (index + 1)">
                  <option value="">Origen</option>
                  <option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.label }}</option>
                </select>
              </span>
              <app-icon name="arrow-right" />
              <span class="input-shell">
                <select v-model="row.to" :aria-label="'Estado de destino de la transición ' + (index + 1)">
                  <option value="">Destino</option>
                  <option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.label }}</option>
                </select>
              </span>
              <button type="button" class="config-icon-action" :aria-label="'Quitar la transición ' + (index + 1)" @click="app.removeInventoryTransition(index)">
                <app-icon name="trash" />
              </button>
            </div>
          </div>
          <p v-else class="config-note">Sin transiciones configuradas: el servidor permite cualquier cambio entre estados activos.</p>
          <div class="form-editor__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="app.addInventoryTransition()">Añadir transición</button>
            <button type="button" class="btn btn--secondary btn--small" @click="app.saveInventoryTransitionsDraft()">Guardar transiciones</button>
          </div>

          <h3 class="identity-subhead">Entorno del servidor</h3>
          <p class="identity-lead">El entorno y la política de baja los define el servidor. El navegador no puede cambiarlos.</p>
          <dl class="identity-policy">
            <div>
              <dt>Entorno</dt>
              <dd class="mono">{{ app.inventoryEnvironmentLabel() }}</dd>
            </div>
            <div>
              <dt>Eliminación definitiva</dt>
              <dd>{{ purge ? 'Permiso ' + purge.permission + (purge.archivedRequired ? ' · exige archivar antes' : ' · no exige archivar') + (purge.typedIdRequired ? ' · exige escribir el ID' : '') + (purge.reasonRequired ? ' · exige motivo' : '') : 'El servidor no informó la política de eliminación; la acción no se ofrece.' }}</dd>
            </div>
          </dl>
        </template>

        <template v-else>
          <h3 class="identity-subhead">Modo de operación</h3>
          <p class="identity-lead">Comportamiento de la baja y protección de la eliminación definitiva.</p>
          <div class="mode-grid">
            <button
              type="button"
              class="mode-card"
              :class="{ 'mode-card--active': mode === 'development' }"
              :aria-pressed="mode === 'development' ? 'true' : 'false'"
              data-od-id="asset-mode-development"
              @click="app.setOperationsMode('development')"
            >
              <span class="mode-card__head">
                <app-icon name="sliders" />
                <strong>Desarrollo</strong>
                <span v-if="mode === 'development'" class="mode-card__badge">Activo</span>
              </span>
              <span class="mode-card__copy">Eliminación definitiva con una confirmación simple. Pensado para pruebas y datos de demostración.</span>
            </button>
            <button
              type="button"
              class="mode-card"
              :class="{ 'mode-card--active': mode === 'production' }"
              :aria-pressed="mode === 'production' ? 'true' : 'false'"
              data-od-id="asset-mode-production"
              @click="app.setOperationsMode('production')"
            >
              <span class="mode-card__head">
                <app-icon name="shield" />
                <strong>Producción</strong>
                <span v-if="mode === 'production'" class="mode-card__badge">Activo</span>
              </span>
              <span class="mode-card__copy">La baja conserva el registro y su historial. La eliminación definitiva exige escribir el ID y el motivo.</span>
            </button>
          </div>
        </template>
      </section>
    `
  };

  window.AssetConfigViews = {
    AssetFieldsPanel,
    AssetFormsPanel,
    AssetStatusesPanel,
    AssetIdentityPanel
  };
})();
