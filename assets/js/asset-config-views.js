(function () {
  'use strict';

  const BUCKET_KEYS = [
    { id: 'quick', key: 'ui.catalog.forms.bucket_quick' },
    { id: 'advanced', key: 'ui.catalog.forms.bucket_advanced' },
    { id: 'hidden', key: 'ui.catalog.forms.bucket_hidden' }
  ];

  function t(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : key;
  }

  const AssetFieldsPanel = {
    name: 'AssetFieldsPanel',
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
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
            <span class="eyebrow">{{ $t('ui.catalog.fields.eyebrow') }}</span>
            <h2>{{ $t('ui.catalog.fields.title') }}</h2>
            <p v-if="real">{{ $t('ui.catalog.fields.lead_server') }}</p>
            <p v-else>{{ $t('ui.catalog.fields.lead_local') }}</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="create-asset-field" @click="app.openAssetField()">
            <app-icon name="plus" />
            <span>{{ $t('ui.catalog.fields.new') }}</span>
          </button>
        </div>

        <p v-if="real && app.inventoryConfigError" class="field__error" role="alert">{{ app.inventoryConfigError }}</p>

        <div class="asset-row-list">
          <article v-for="field in fields" :key="field.key" class="asset-field-row" :data-od-id="'asset-field-' + field.key">
            <div class="asset-field-row__main">
              <strong>{{ field.label }}</strong>
              <span class="mono asset-field-row__key">{{ field.key }}</span>
            </div>
            <span v-if="field.active === false" class="chip chip--muted">{{ $t('ui.catalog.fields.inactive') }}</span>
            <span v-if="field.required" class="chip chip--outline">{{ $t('ui.catalog.fields.required') }}</span>
            <span class="chip chip--muted">{{ app.assetFieldTypeLabel(field.type) }}</span>
            <span class="asset-field-row__meta">{{ $t('ui.catalog.fields.forms', { count: app.assetFieldUsage(field) }) }}</span>
            <span v-if="field.unit" class="asset-field-row__meta mono">{{ field.unit }}</span>
            <div class="row-actions">
              <button v-if="canEdit" type="button" class="icon-button" :aria-label="$t('ui.catalog.fields.edit', { label: field.label })" @click="app.openAssetField(field)">
                <app-icon name="pencil" />
              </button>
              <button
                v-if="real && canEdit"
                type="button"
                class="text-button"
                :aria-label="$t(field.active === false ? 'ui.catalog.fields.activate' : 'ui.catalog.fields.deactivate', { label: field.label })"
                @click="app.setAssetFieldActive(field, field.active === false)"
              >{{ field.active === false ? $t('ui.catalog.fields.activate_button') : $t('ui.catalog.fields.deactivate_button') }}</button>
              <button v-else type="button" class="icon-button icon-button--danger" :aria-label="$t('ui.catalog.fields.delete', { label: field.label })" @click="app.requestDeleteAssetField(field)">
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
    computed: {
      real() {
        return this.app.inventoryCatalogReady;
      },
      buckets() {
        // Reading the runtime version keeps the bucket labels reactive to a
        // language switch without remounting the panel.
        if (window.ItsmI18n) window.ItsmI18n.version.value;
        return BUCKET_KEYS.map((bucket) => ({ id: bucket.id, label: t(bucket.key) }));
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
            <span class="eyebrow">{{ $t('ui.catalog.fields.eyebrow') }}</span>
            <h2>{{ $t('ui.catalog.forms.title') }}</h2>
            <p v-if="real">{{ $t('ui.catalog.forms.lead_server') }}</p>
            <p v-else>{{ $t('ui.catalog.forms.lead_local') }}</p>
          </div>
        </div>

        <div class="asset-forms-layout">
          <nav class="form-category-list" :aria-label="$t('ui.catalog.forms.categories_aria')">
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
                <span class="mono">{{ formFor(category.id).prefix }} · {{ $t('ui.catalog.forms.tech_count', { count: countTech(category.id) }) }}</span>
              </span>
              <app-icon name="chevron-right" />
            </button>
          </nav>

          <div v-if="!draft" class="config-note asset-forms-empty">
            <app-icon name="sliders" />
            <div>
              <strong>{{ $t('ui.catalog.forms.empty_title') }}</strong>
              <p>{{ $t('ui.catalog.forms.empty_body') }}</p>
            </div>
          </div>

          <div v-else class="form-editor" data-od-id="asset-form-editor">
            <div class="form-editor__head">
              <div>
                <span class="eyebrow">{{ $t('ui.catalog.forms.eyebrow') }}</span>
                <h3>{{ categoryLabel }}</h3>
              </div>
              <button type="button" class="text-button" @click="app.closeFormDraft()">{{ $t('ui.common.close') }}</button>
            </div>

            <div class="config-form-grid">
              <div class="field">
                <label :for="'form-prefix-' + draft.categoryId">{{ $t('ui.catalog.forms.prefix') }}</label>
                <span class="input-shell">
                  <input :id="'form-prefix-' + draft.categoryId" type="text" maxlength="6" v-model="draft.form.prefix" :disabled="!canEdit" />
                </span>
                <span class="field__hint">{{ $t('ui.catalog.forms.prefix_hint', { example: draft.form.prefix + '-CEN-001' }) }}</span>
              </div>
              <div class="field">
                <label :for="'form-type-' + draft.categoryId">{{ $t('ui.catalog.forms.type_name') }}</label>
                <span class="input-shell">
                  <input :id="'form-type-' + draft.categoryId" type="text" v-model="draft.form.type" :disabled="!canEdit" />
                </span>
              </div>
              <div class="field form-grid__full">
                <label class="switch">
                  <input type="checkbox" v-model="draft.form.fov" :disabled="!canEdit" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                  <span class="switch__text">{{ $t('ui.catalog.forms.fov') }}</span>
                </label>
                <span class="field__hint">{{ $t('ui.catalog.forms.fov_hint') }}</span>
              </div>
            </div>

            <h4 class="form-editor__subhead">{{ $t('ui.catalog.forms.common_fields') }}</h4>
            <div class="bucket-table">
              <div class="bucket-table__head">
                <span>{{ $t('ui.catalog.forms.column_field') }}</span>
                <span>{{ $t('ui.catalog.forms.column_location') }}</span>
              </div>
              <div v-for="field in commonFields" :key="field.key" class="bucket-row">
                <span class="bucket-row__label">{{ field.label }}</span>
                <div class="bucket-control" role="group" :aria-label="$t('ui.catalog.forms.bucket_aria', { label: field.label })">
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

            <h4 class="form-editor__subhead">{{ $t('ui.catalog.forms.tech_fields') }}</h4>
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
              <button type="button" class="btn btn--ghost btn--small" @click="app.closeFormDraft()">{{ $t('ui.catalog.forms.discard') }}</button>
              <button v-if="canEdit" type="button" class="btn btn--primary btn--small" @click="app.saveFormDraft()">{{ $t('ui.catalog.forms.save') }}</button>
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
            <span class="eyebrow">{{ $t('ui.catalog.fields.eyebrow') }}</span>
            <h2>{{ $t('ui.catalog.statuses.title') }}</h2>
            <p v-if="real">{{ $t('ui.catalog.statuses.lead_server') }}</p>
            <p v-else>{{ $t('ui.catalog.statuses.lead_local') }}</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="create-asset-status" @click="app.openAssetStatusDialog()">
            <app-icon name="plus" />
            <span>{{ $t('ui.catalog.statuses.new') }}</span>
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
            <span v-if="status.active === false" class="chip chip--muted">{{ $t('ui.catalog.statuses.inactive') }}</span>
            <span v-if="status.final" class="chip chip--outline">{{ $t('ui.catalog.statuses.final') }}</span>
            <span class="asset-field-row__meta">{{ app.assetStatusUsage(status) }}</span>
            <div class="row-actions">
              <button v-if="canEdit" type="button" class="icon-button" :aria-label="$t('ui.catalog.statuses.edit', { label: status.label })" @click="app.openAssetStatusDialog(status)">
                <app-icon name="pencil" />
              </button>
              <button
                v-if="real && canEdit"
                type="button"
                class="text-button"
                :aria-label="$t(status.active === false ? 'ui.catalog.statuses.activate' : 'ui.catalog.statuses.deactivate', { label: status.label })"
                @click="app.setAssetStatusActive(status, status.active === false)"
              >{{ status.active === false ? $t('ui.catalog.statuses.activate_button') : $t('ui.catalog.statuses.deactivate_button') }}</button>
              <button v-else type="button" class="icon-button icon-button--danger" :aria-label="$t('ui.catalog.statuses.delete', { label: status.label })" @click="app.requestDeleteAssetStatus(status)">
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
            <span class="eyebrow">{{ $t('ui.catalog.fields.eyebrow') }}</span>
            <h2>{{ $t('ui.catalog.identity.title') }}</h2>
            <p v-if="real">{{ $t('ui.catalog.identity.lead_server') }}</p>
            <p v-else>{{ $t('ui.catalog.identity.lead_local') }}</p>
          </div>
        </div>

        <p v-if="real && app.inventoryConfigError" class="field__error" role="alert">{{ app.inventoryConfigError }}</p>

        <div class="identity-preview">
          <div class="identity-preview__cell">
            <span class="eyebrow">{{ real ? $t('ui.catalog.identity.permanent_id') : $t('ui.catalog.identity.next_id') }}</span>
            <strong class="mono">{{ real ? $t('ui.catalog.identity.server_uuid') : permanentPreview }}</strong>
            <span class="identity-preview__hint">{{ real ? $t('ui.catalog.identity.permanent_hint') : $t('ui.catalog.identity.sequential_hint') }}</span>
          </div>
          <div class="identity-preview__cell">
            <span class="eyebrow">{{ $t('ui.catalog.identity.quick_example') }}</span>
            <strong class="mono">{{ quickPreview }}</strong>
            <span class="identity-preview__hint">{{ $t('ui.catalog.identity.quick_example_hint') }}</span>
          </div>
        </div>

        <div class="config-form-grid">
          <div v-if="!real" class="field" :class="{ 'field--invalid': !!errors.permanentPrefix }">
            <label for="rules-permanent-prefix">{{ $t('ui.catalog.identity.prefix') }}</label>
            <span class="input-shell">
              <input id="rules-permanent-prefix" type="text" maxlength="6" v-model="rules.permanentPrefix" />
            </span>
            <span class="field__hint">{{ $t('ui.catalog.identity.prefix_hint') }}</span>
          </div>
          <div class="field">
            <label for="rules-separator">{{ $t('ui.catalog.identity.separator') }}</label>
            <span class="input-shell">
              <input id="rules-separator" type="text" maxlength="2" v-model="rules.separator" />
            </span>
            <span class="field__hint">{{ $t('ui.catalog.identity.separator_hint') }}</span>
          </div>
          <div v-if="!real" class="field" :class="{ 'field--invalid': !!errors.permanentPad }">
            <label for="rules-permanent-pad">{{ $t('ui.catalog.identity.digits') }}</label>
            <span class="input-shell">
              <input id="rules-permanent-pad" type="number" min="3" max="8" v-model="rules.permanentPad" />
            </span>
            <span v-if="errors.permanentPad" class="field__error">{{ errors.permanentPad }}</span>
          </div>
          <div class="field" :class="{ 'field--invalid': !!errors.quickPad }">
            <label for="rules-quick-pad">{{ $t('ui.catalog.identity.counter_digits') }}</label>
            <span class="input-shell">
              <input id="rules-quick-pad" type="number" min="2" max="5" v-model="rules.quickPad" />
            </span>
            <span v-if="errors.quickPad" class="field__error">{{ errors.quickPad }}</span>
          </div>
          <div class="field">
            <label for="rules-site-length">{{ $t('ui.catalog.identity.site_letters') }}</label>
            <span class="input-shell">
              <input id="rules-site-length" type="number" min="2" max="5" v-model="rules.siteCodeLength" />
            </span>
            <span class="field__hint">{{ $t('ui.catalog.identity.site_letters_hint') }}</span>
          </div>
          <div class="field">
            <label class="switch">
              <input type="checkbox" v-model="rules.includeSite" />
              <span class="switch__track"><span class="switch__thumb"></span></span>
              <span class="switch__text">{{ $t('ui.catalog.identity.include_site') }}</span>
            </label>
            <span class="field__hint">{{ $t('ui.catalog.identity.include_site_hint') }}</span>
          </div>
          <div v-if="real" class="field">
            <label for="rules-order">{{ $t('ui.catalog.identity.order') }}</label>
            <span class="input-shell">
              <select id="rules-order" v-model="rules.order">
                <option value="site-type">{{ $t('ui.catalog.identity.order_site_type') }}</option>
                <option value="type-site">{{ $t('ui.catalog.identity.order_type_site') }}</option>
              </select>
            </span>
            <span class="field__hint">{{ $t('ui.catalog.identity.order_hint') }}</span>
          </div>
        </div>

        <div v-if="canEdit" class="form-editor__actions">
          <button type="button" class="btn btn--ghost btn--small" @click="app.resetAssetIdRules()">{{ $t('ui.catalog.identity.reset') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="save-asset-identity" @click="app.saveAssetIdRules()">{{ $t('ui.catalog.identity.save_rules') }}</button>
        </div>
        <p v-else class="config-note"><app-icon name="info" /><span>{{ $t('ui.catalog.identity.read_only') }}</span></p>

        <template v-if="real">
          <h3 class="identity-subhead">{{ $t('ui.catalog.identity.transitions') }}</h3>
          <p class="identity-lead">{{ $t('ui.catalog.identity.transitions_lead') }}</p>
          <div v-if="app.inventoryTransitionRows().length" class="transition-rows">
            <div v-for="(row, index) in app.inventoryTransitionRows()" :key="index" class="transition-row">
              <span class="input-shell">
                <select v-model="row.from" :aria-label="$t('ui.catalog.identity.transition_from', { index: index + 1 })">
                  <option value="">Origen</option>
                  <option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.label }}</option>
                </select>
              </span>
              <app-icon name="arrow-right" />
              <span class="input-shell">
                <select v-model="row.to" :aria-label="$t('ui.catalog.identity.transition_to', { index: index + 1 })">
                  <option value="">Destino</option>
                  <option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.label }}</option>
                </select>
              </span>
              <button type="button" class="config-icon-action" :aria-label="$t('ui.catalog.identity.transition_remove', { index: index + 1 })" @click="app.removeInventoryTransition(index)">
                <app-icon name="trash" />
              </button>
            </div>
          </div>
          <p v-else class="config-note">{{ $t('ui.catalog.identity.transitions_empty') }}</p>
          <div class="form-editor__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="app.addInventoryTransition()">{{ $t('ui.catalog.identity.transition_add') }}</button>
            <button type="button" class="btn btn--secondary btn--small" @click="app.saveInventoryTransitionsDraft()">{{ $t('ui.catalog.identity.transitions_save') }}</button>
          </div>

          <h3 class="identity-subhead">{{ $t('ui.catalog.identity.environment') }}</h3>
          <p class="identity-lead">{{ $t('ui.catalog.identity.environment_lead') }}</p>
          <dl class="identity-policy">
            <div>
              <dt>{{ $t('ui.catalog.identity.environment') }}</dt>
              <dd class="mono">{{ app.inventoryEnvironmentLabel() }}</dd>
            </div>
            <div>
              <dt>{{ $t('ui.catalog.identity.purge') }}</dt>
              <dd>{{ purge ? $t('ui.catalog.identity.purge_policy', { permission: purge.permission, archived: purge.archivedRequired ? $t('ui.catalog.identity.purge_archived') : $t('ui.catalog.identity.purge_not_archived'), typed: purge.typedIdRequired ? $t('ui.catalog.identity.purge_typed') : '', reason: purge.reasonRequired ? $t('ui.catalog.identity.purge_reason') : '' }) : $t('ui.catalog.identity.purge_unknown') }}</dd>
            </div>
          </dl>
        </template>

        <template v-else>
          <h3 class="identity-subhead">{{ $t('ui.catalog.identity.mode') }}</h3>
          <p class="identity-lead">{{ $t('ui.catalog.identity.mode_lead') }}</p>
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
                <strong>{{ $t('ui.catalog.identity.mode_development') }}</strong>
                <span v-if="mode === 'development'" class="mode-card__badge">{{ $t('ui.catalog.identity.mode_active') }}</span>
              </span>
              <span class="mode-card__copy">{{ $t('ui.catalog.identity.mode_development_copy') }}</span>
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
                <strong>{{ $t('ui.catalog.identity.mode_production') }}</strong>
                <span v-if="mode === 'production'" class="mode-card__badge">{{ $t('ui.catalog.identity.mode_active') }}</span>
              </span>
              <span class="mode-card__copy">{{ $t('ui.catalog.identity.mode_production_copy') }}</span>
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
