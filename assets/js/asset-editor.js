(function () {
  'use strict';

  const PLACEHOLDERS = {
    name: 'ui.asset.editor.placeholder_name',
    brand: 'ui.asset.editor.placeholder_brand',
    model: 'ui.asset.editor.placeholder_model',
    serial: 'ui.asset.editor.placeholder_serial',
    ip: 'ui.asset.editor.placeholder_ip',
    type: 'ui.asset.editor.placeholder_type',
    anydesk: 'ui.asset.editor.placeholder_anydesk',
    rmm: 'ui.asset.editor.placeholder_rmm',
    cost: 'ui.asset.editor.placeholder_cost',
    site: 'ui.asset.editor.placeholder_site',
    location: 'ui.asset.editor.placeholder_location',
    responsible: 'ui.asset.editor.placeholder_responsible',
    quickCode: 'ui.asset.editor.placeholder_quick_code'
  };

  function t(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : key;
  }

  const AssetCommonField = {
    name: 'AssetCommonField',
    components: { AppIcon: window.AppIcon },
    props: {
      app: { type: Object, required: true },
      draft: { type: Object, required: true },
      fieldKey: { type: String, required: true },
      errors: { type: Object, default: () => ({}) },
      idPrefix: { type: String, default: 'asset' }
    },
    computed: {
      meta() {
        return this.app.assetCommonField(this.fieldKey) || { label: this.fieldKey };
      },
      inputId() {
        return this.idPrefix + '-' + this.fieldKey;
      },
      errorId() {
        return this.inputId + '-error';
      },
      error() {
        return this.errors[this.fieldKey] || '';
      },
      locations() {
        return this.app.assetSiteLocations(this.draft.site);
      },
      people() {
        return this.app.assetActivePeople();
      },
      statuses() {
        return this.app.assetAdmin.statuses;
      },
      real() {
        return !!(this.app.assetEditor && this.app.assetEditor.real);
      },
      statusChoices() {
        if (this.real) return this.app.inventoryStatusOptions().map((status) => ({ id: status.value, label: status.label, disabled: !!status.disabled }));
        return this.statuses.map((status) => ({ id: status.id, label: status.label, disabled: false }));
      },
      sites() {
        return this.app.sites;
      },
      localeRevision() {
        return window.ItsmI18n ? window.ItsmI18n.version.value : 0;
      },
      placeholder() {
        this.localeRevision;
        if (this.fieldKey === 'anydeskId') return t(PLACEHOLDERS.anydesk);
        if (this.fieldKey === 'rmmAgentId') return t(PLACEHOLDERS.rmm);
        return PLACEHOLDERS[this.fieldKey] ? t(PLACEHOLDERS[this.fieldKey]) : '';
      },
      isSelect() {
        return ['site', 'locationId', 'assigneeId', 'statusId'].indexOf(this.fieldKey) !== -1;
      },
      locked() {
        return !!(this.real && this.app.assetFieldLocked && this.app.assetFieldLocked(this.fieldKey));
      },
      // The installation currency is a server format, never derived from the
      // interface language.
      currencyCode() {
        return window.ItsmI18n ? window.ItsmI18n.currency : 'PYG';
      }
    },
    methods: {
      t,
      setText(event) {
        this.draft[this.fieldKey] = event.target.value;
      },
      setSite(event) {
        this.app.applyAssetSite(event.target.value);
      }
    },
    template: `
      <div class="field" :class="{ 'field--invalid': !!error }">
        <label :for="inputId">{{ meta.label }}</label>

        <span v-if="fieldKey === 'site' && !real" class="input-shell">
          <app-icon name="building" />
          <select :id="inputId" :value="draft.site" @change="setSite">
            <option value="">{{ t('ui.asset.field.no_site') }}</option>
            <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'locationId'" class="input-shell" :class="{ 'input-shell--muted': !draft.site }">
          <app-icon name="map-pin" />
          <select :id="inputId" :value="draft.locationId" :disabled="!draft.site" @change="draft.locationId = $event.target.value">
            <option value="">{{ draft.site ? t('ui.asset.field.no_location') : t('ui.asset.field.choose_site') }}</option>
            <option v-for="location in locations" :key="location.id" :value="location.id">{{ location.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'assigneeId'" class="input-shell">
          <app-icon name="user" />
          <select :id="inputId" :value="draft.assigneeId" :disabled="locked" :aria-describedby="locked ? errorId : null" @change="draft.assigneeId = $event.target.value">
            <option value="">{{ t('ui.asset.field.unassigned') }}</option>
            <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }} · {{ person.role }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'statusId'" class="input-shell">
          <app-icon name="activity" />
          <select :id="inputId" :value="draft.statusId" @change="draft.statusId = $event.target.value">
            <option v-for="status in statusChoices" :key="status.id" :value="status.id" :disabled="status.disabled">{{ status.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'description'" class="input-shell input-shell--area">
          <textarea :id="inputId" rows="3" :value="draft.description" :placeholder="placeholder" :aria-invalid="!!error" :aria-describedby="error ? errorId : null" @input="setText"></textarea>
        </span>

        <span v-else-if="fieldKey === 'cost'" class="input-shell">
          <input :id="inputId" type="number" min="0" step="0.01" :value="draft.cost" :placeholder="placeholder" :aria-invalid="!!error" :aria-describedby="error ? errorId : null" @input="setText" />
          <span class="input-suffix">{{ currencyCode }}</span>
        </span>

        <span v-else class="input-shell">
          <input :id="inputId" type="text" :value="draft[fieldKey]" :placeholder="placeholder" :aria-invalid="!!error" :aria-describedby="error ? errorId : null" :disabled="locked" autocomplete="off" @input="setText" />
        </span>

        <span v-if="locked" :id="errorId" class="field__hint">{{ t('ui.asset.field.responsible_locked') }}</span>
        <span v-if="error" class="field__error" role="alert">{{ error }}</span>
      </div>
    `
  };

  window.AssetEditor = {
    name: 'AssetEditor',
    components: {
      AppIcon: window.AppIcon,
      ModalShell: window.ModalShell,
      AssetCommonField
    },
    props: { app: { type: Object, required: true } },
    computed: {
      editor() {
        return this.app.assetEditor;
      },
      draft() {
        return this.editor.draft;
      },
      errors() {
        return this.app.assetEditorErrors || {};
      },
      categories() {
        return this.real ? this.app.inventoryCategoryChoices : this.app.config.categories;
      },
      categoryLabel() {
        const category = this.categories.find((item) => item.id === this.draft.category);
        return category ? category.label : t('ui.asset.editor.default_category');
      },
      quickKeys() {
        return this.app.assetFormKeys('quick', this.draft.category);
      },
      advancedKeys() {
        return this.app.assetFormKeys('advanced', this.draft.category);
      },
      techFields() {
        return this.real ? this.app.inventoryTechnicalFields(this.draft.category) : this.app.assetTechFields(this.draft.category);
      },
      showWarranty() {
        if (this.real) return false;
        return this.app.assetForm(this.draft.category).advanced.indexOf('warranty') !== -1;
      },
      showFov() {
        if (this.real) return this.app.inventoryCategoryHasFov(this.draft.category);
        return !!this.app.assetForm(this.draft.category).fov;
      },
      codePreview() {
        return this.app.assetNextCode(this.draft.category, this.draft.site, this.draft.id);
      },
      fallbackImage() {
        const category = this.categories.find((item) => item.id === this.draft.category);
        return (category && category.image) || 'assets/svg/devices/other.svg';
      },
      ownPhoto() {
        return this.real ? (this.draft.photoUrl || '') : (this.draft.image || '');
      },
      ownFov() {
        return this.real ? (this.draft.fovUrl || '') : (this.draft.fovImage || '');
      },
      mediaAsset() {
        return {
          id: this.editor.id,
          serverAsset: true,
          archived: false,
          category: this.draft.categoryText || this.draft.category,
          categoryText: this.draft.categoryText || this.draft.category
        };
      },
      mediaReady() {
        return !this.real || (this.editor.mode === 'edit' && !!this.editor.id);
      },
      warranty() {
        return this.draft.warranty || { until: '', provider: '', note: '' };
      },
      localeRevision() {
        return window.ItsmI18n ? window.ItsmI18n.version.value : 0;
      },
      title() {
        this.localeRevision;
        return this.editor.mode === 'create' ? t('ui.asset.editor.create_title') : t('ui.asset.editor.edit_title');
      },
      real() {
        return !!this.editor.real;
      },
      identCode() {
        this.localeRevision;
        if (this.real) return this.editor.mode === 'create' ? t('ui.asset.editor.server_assigns') : this.draft.quickCode;
        return this.editor.mode === 'create' ? this.codePreview : this.draft.code;
      },
      identNote() {
        this.localeRevision;
        return this.real ? t('ui.asset.editor.ident_note_server') : t('ui.asset.editor.ident_note_local');
      }
    },
    methods: {
      t,
      techValue(field) {
        const tech = this.draft.technical || this.draft.tech || {};
        return field.type === 'boolean' ? tech[field.key] === true : (tech[field.key] === undefined ? '' : tech[field.key]);
      },
      setTech(field, value) {
        if (this.real) {
          if (!this.draft.technical) this.draft.technical = {};
          this.draft.technical[field.key] = value;
          return;
        }
        if (!this.draft.tech) this.draft.tech = {};
        this.draft.tech[field.key] = value;
      },
      setTechBoolean(field, event) {
        this.setTech(field, event.target.checked);
      },
      setWarranty(key, value) {
        if (!this.draft.warranty) this.draft.warranty = { until: '', provider: '', note: '' };
        this.draft.warranty[key] = value;
      },
      async handlePhoto(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        await this.app.uploadInventoryImage(this.mediaAsset, 'photo', file);
      },
      async handleFov(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        await this.app.uploadInventoryImage(this.mediaAsset, 'fov', file);
      },
      async removePhoto() {
        await this.app.removeInventoryImage(this.mediaAsset, 'photo');
      },
      async removeFov() {
        await this.app.removeInventoryImage(this.mediaAsset, 'fov');
      }
    },
    template: `
      <modal-shell
        :open="editor.open"
        size="wide"
        :eyebrow="t('ui.asset.editor.eyebrow')"
        :title="title"
        @close="app.closeAssetEditor()"
      >
        <form class="asset-editor" id="asset-editor-form" novalidate @submit.prevent="app.saveAsset()">
          <div class="editor-ident">
            <div class="editor-ident__cell">
              <span class="eyebrow">{{ t('ui.asset.common.permanent_id') }}</span>
              <strong class="mono">{{ editor.mode === 'create' ? t('ui.asset.editor.assigned_on_save') : draft.id }}</strong>
            </div>
            <div class="editor-ident__cell">
              <span class="eyebrow">{{ t('ui.asset.common.quick_code') }}</span>
              <strong class="mono">{{ identCode }}</strong>
            </div>
            <p class="editor-ident__note">
              <app-icon name="info" />
              <span>{{ identNote }}</span>
            </p>
          </div>

          <p v-if="editor.error" class="editor-alert" role="alert">
            <app-icon name="alert" />
            <span>{{ editor.error }}</span>
          </p>

          <section class="editor-section" data-od-id="asset-editor-essentials">
            <div class="editor-section__head">
              <h3>{{ real ? t('ui.asset.editor.essentials_server') : t('ui.asset.editor.essentials_local') }}</h3>
              <p>{{ real ? t('ui.asset.editor.essentials_server_hint') : t('ui.asset.editor.essentials_local_hint') }}</p>
            </div>
            <div class="form-grid">
              <div v-if="errors.category" class="field field--invalid form-grid__full">
                <span class="field__error" role="alert">{{ errors.category }}</span>
              </div>
              <div class="field form-grid__full">
                <label for="asset-editor-category">{{ t('ui.asset.common.category') }}</label>
                <span class="input-shell">
                  <app-icon name="grid" />
                  <select id="asset-editor-category" :value="draft.category" @change="app.applyAssetCategory($event.target.value)">
                    <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                  </select>
                </span>
                <span class="field__hint">{{ t('ui.asset.editor.category_hint', { category: categoryLabel }) }}</span>
              </div>
              <asset-common-field
                v-for="key in quickKeys"
                :key="'quick-' + key"
                :app="app"
                :draft="draft"
                :field-key="key"
                :errors="errors"
                id-prefix="asset-quick"
              />
            </div>
          </section>

          <section class="editor-section" data-od-id="asset-editor-photo">
            <div class="editor-section__head">
              <h3>{{ t('ui.asset.editor.photo') }}</h3>
              <p>{{ real ? t('ui.asset.editor.photo_hint_server') : t('ui.asset.editor.photo_hint_local') }}</p>
            </div>
            <div class="photo-editor">
              <figure class="photo-editor__frame">
                <img :src="ownPhoto || fallbackImage" :alt="draft.name ? t('ui.asset.editor.photo_alt', { name: draft.name }) : t('ui.asset.editor.image_alt')" />
                <figcaption class="mono">{{ ownPhoto ? t('ui.asset.editor.own_image') : t('ui.asset.editor.category_illustration') }}</figcaption>
              </figure>
              <div class="photo-editor__controls">
                <template v-if="mediaReady">
                  <label class="btn btn--secondary btn--small photo-upload">
                    <app-icon name="upload" />
                    <span>{{ t('ui.asset.editor.upload_photo') }}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" @change="handlePhoto" />
                  </label>
                  <button v-if="ownPhoto" type="button" class="text-button" @click="removePhoto">{{ t('ui.asset.editor.reset_photo') }}</button>
                  <p class="field__hint">{{ real ? t('ui.asset.editor.photo_limits_server') : t('ui.asset.editor.photo_limits_local') }}</p>
                  <p v-if="errors.image || app.inventoryMediaError" class="field__error" role="alert">{{ errors.image || app.inventoryMediaError }}</p>
                </template>
                <p v-else class="field__hint">{{ t('ui.asset.editor.save_for_photo') }}</p>
                <div v-if="!real" class="preset-grid preset-grid--compact">
                  <button
                    v-for="preset in app.deviceImagePresets"
                    :key="preset.src"
                    type="button"
                    class="photo-preset"
                    :class="{ 'photo-preset--active': draft.image === preset.src }"
                    :aria-pressed="draft.image === preset.src"
                    @click="app.applyAssetImage(preset)"
                  >
                    <app-icon :name="preset.icon" />
                    <span>{{ preset.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="showFov" class="editor-section" data-od-id="asset-editor-fov">
            <div class="editor-section__head">
              <h3>{{ t('ui.asset.editor.fov') }}</h3>
              <p>{{ t('ui.asset.editor.fov_hint') }}</p>
            </div>
            <div class="photo-editor photo-editor--compact">
              <figure class="photo-editor__frame photo-editor__frame--diagram">
                <img v-if="ownFov" :src="ownFov" :alt="t('ui.asset.editor.fov_alt')" />
                <div v-else class="photo-editor__empty">
                  <app-icon name="camera" />
                  <span>{{ t('ui.asset.editor.no_fov') }}</span>
                </div>
                <figcaption class="mono">{{ t('ui.asset.editor.fov_caption') }}</figcaption>
              </figure>
              <div class="photo-editor__controls">
                <template v-if="mediaReady">
                  <label class="btn btn--secondary btn--small photo-upload">
                    <app-icon name="upload" />
                    <span>{{ t('ui.asset.editor.upload_fov') }}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" @change="handleFov" />
                  </label>
                  <button v-if="ownFov" type="button" class="text-button" @click="removeFov">{{ t('ui.asset.editor.remove_fov') }}</button>
                  <p v-if="errors.fov || app.inventoryMediaError" class="field__error" role="alert">{{ errors.fov || app.inventoryMediaError }}</p>
                </template>
                <p v-else class="field__hint">{{ t('ui.asset.editor.save_for_fov') }}</p>
              </div>
            </div>
          </section>

          <section class="editor-section" data-od-id="asset-editor-advanced">
            <button
              type="button"
              class="editor-toggle"
              :aria-expanded="editor.advancedOpen ? 'true' : 'false'"
              aria-controls="asset-editor-advanced-fields"
              @click="app.toggleAssetAdvanced()"
            >
              <app-icon :name="editor.advancedOpen ? 'chevron-down' : 'chevron-right'" />
              <span class="editor-toggle__label">{{ t('ui.asset.editor.advanced') }}</span>
              <span class="editor-toggle__hint">{{ editor.advancedOpen ? t('ui.asset.editor.hide') : (real ? t('ui.asset.editor.advanced_hint_server') : t('ui.asset.editor.advanced_hint_local')) }}</span>
            </button>

            <div v-if="editor.advancedOpen" id="asset-editor-advanced-fields" class="editor-advanced">
              <div v-if="advancedKeys.length" class="form-grid">
                <asset-common-field
                  v-for="key in advancedKeys"
                  :key="'adv-' + key"
                  :app="app"
                  :draft="draft"
                  :field-key="key"
                  :errors="errors"
                  id-prefix="asset-adv"
                />
              </div>

              <div v-if="real" class="form-grid">
                <div class="field">
                  <label for="asset-editor-quick-code">{{ t('ui.asset.editor.manual_quick_code') }}</label>
                  <span class="input-shell">
                    <input id="asset-editor-quick-code" type="text" maxlength="32" :value="draft.quickCode" :placeholder="t('ui.asset.editor.optional')" autocomplete="off" @input="draft.quickCode = $event.target.value" />
                  </span>
                  <span class="field__hint">{{ t('ui.asset.editor.manual_quick_hint') }}</span>
                  <span v-if="errors.quickCode" class="field__error" role="alert">{{ errors.quickCode }}</span>
                </div>
              </div>

              <div v-if="showWarranty" class="warranty-editor">
                <div class="warranty-editor__head">
                  <h4>{{ t('ui.warranty.editor.title') }}</h4>
                  <div class="warranty-editor__quick">
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(12)">{{ t('ui.warranty.editor.preset_months', { months: 12 }) }}</button>
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(24)">{{ t('ui.warranty.editor.preset_months', { months: 24 }) }}</button>
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(36)">{{ t('ui.warranty.editor.preset_months', { months: 36 }) }}</button>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="field" :class="{ 'field--invalid': !!errors.warranty }">
                    <label :for="'asset-warranty-until'">{{ t('ui.warranty.field.until') }}</label>
                    <span class="input-shell">
                      <input id="asset-warranty-until" type="date" :value="warranty.until" @input="setWarranty('until', $event.target.value)" />
                    </span>
                    <span v-if="errors.warranty" class="field__error" role="alert">{{ errors.warranty }}</span>
                  </div>
                  <div class="field">
                    <label :for="'asset-warranty-provider'">{{ t('ui.warranty.field.provider') }}</label>
                    <span class="input-shell">
                      <input id="asset-warranty-provider" type="text" :value="warranty.provider" :placeholder="t('ui.warranty.editor.placeholder_provider')" @input="setWarranty('provider', $event.target.value)" />
                    </span>
                  </div>
                  <div class="field form-grid__full">
                    <label :for="'asset-warranty-note'">{{ t('ui.warranty.field.note') }}</label>
                    <span class="input-shell">
                      <input id="asset-warranty-note" type="text" :value="warranty.note" :placeholder="t('ui.warranty.editor.placeholder_note')" @input="setWarranty('note', $event.target.value)" />
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="techFields.length" class="tech-editor">
                <h4>{{ t('ui.asset.editor.tech_fields_title', { category: categoryLabel }) }}</h4>
                <div class="form-grid">
                  <div v-for="field in techFields" :key="field.key" class="field" :class="{ 'field--inline': field.type === 'boolean', 'field--invalid': !!errors['technical.' + field.key] }">
                    <label :for="'asset-tech-' + field.key">
                      {{ field.label }}<span v-if="field.unit" class="field__unit">({{ field.unit }})</span>
                      <span v-if="field.required" class="field__required" aria-hidden="true">*</span>
                    </label>
                    <label v-if="field.type === 'boolean'" class="switch">
                      <input
                        :id="'asset-tech-' + field.key"
                        type="checkbox"
                        :checked="techValue(field) === true"
                        @change="setTechBoolean(field, $event)"
                      />
                      <span class="switch__track"><span class="switch__thumb"></span></span>
                      <span class="switch__text">{{ techValue(field) === true ? t('ui.asset.editor.yes') : t('ui.asset.editor.no') }}</span>
                    </label>
                    <span v-else-if="field.type === 'select'" class="input-shell">
                      <select :id="'asset-tech-' + field.key" :value="techValue(field)" @change="setTech(field, $event.target.value)">
                        <option value="">{{ t('ui.asset.editor.undefined') }}</option>
                        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                      </select>
                    </span>
                    <span v-else-if="field.type === 'textarea'" class="input-shell input-shell--area">
                      <textarea :id="'asset-tech-' + field.key" rows="3" :value="techValue(field)" :maxlength="field.maxLength || null" @input="setTech(field, $event.target.value)"></textarea>
                    </span>
                    <span v-else class="input-shell">
                      <input
                        :id="'asset-tech-' + field.key"
                        :type="field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text')"
                        :value="techValue(field)"
                        :placeholder="field.hint || ''"
                        :min="field.minimum !== null && field.minimum !== undefined ? field.minimum : null"
                        :max="field.maximum !== null && field.maximum !== undefined ? field.maximum : null"
                        :maxlength="field.maxLength || null"
                        :aria-invalid="!!errors['technical.' + field.key]"
                        :aria-describedby="errors['technical.' + field.key] ? 'asset-tech-error-' + field.key : null"
                        @input="setTech(field, $event.target.value)"
                      />
                    </span>
                    <span v-if="field.hint && field.type !== 'text' && field.type !== 'number'" class="field__hint">{{ field.hint }}</span>
                    <span v-if="errors['technical.' + field.key]" :id="'asset-tech-error-' + field.key" class="field__error" role="alert">{{ errors['technical.' + field.key] }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </form>

        <template #footer>
          <p class="modal-foot__hint">{{ t('ui.asset.editor.footer_hint') }}</p>
          <button type="button" class="btn btn--ghost" @click="app.closeAssetEditor()">{{ t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="editor.saving" @click="app.saveAsset()">
            {{ editor.mode === 'create' ? t('ui.asset.editor.create_title') : t('ui.asset.editor.save_changes') }}
          </button>
        </template>
      </modal-shell>
    `
  };
})();
