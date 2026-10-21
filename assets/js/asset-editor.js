(function () {
  'use strict';

  const PLACEHOLDERS = {
    name: 'Ej. Notebook de dirección',
    brand: 'Ej. Lenovo',
    model: 'Ej. ThinkPad T14 Gen 4',
    serial: 'Serie del fabricante',
    ip: 'Ej. 10.24.18.40',
    type: 'Ej. Notebook',
    anydesk: 'Ej. 774209618',
    rmm: 'Ej. rmm-2f6b-1042',
    cost: '0,00',
    site: 'Ej. Sede Central',
    location: 'Ej. Piso 2 · Administración',
    responsible: 'Ej. Ana Benítez',
    quickCode: 'Opcional · único en el inventario'
  };

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
        if (this.real) return this.app.inventoryStatusOptions().map((status) => ({ id: status.value, label: status.label }));
        return this.statuses;
      },
      sites() {
        return this.app.config.sites;
      },
      placeholder() {
        if (this.fieldKey === 'anydeskId') return PLACEHOLDERS.anydesk;
        if (this.fieldKey === 'rmmAgentId') return PLACEHOLDERS.rmm;
        return PLACEHOLDERS[this.fieldKey] || '';
      },
      isSelect() {
        return ['site', 'locationId', 'assigneeId', 'statusId'].indexOf(this.fieldKey) !== -1;
      },
      locked() {
        return !!(this.real && this.app.assetFieldLocked && this.app.assetFieldLocked(this.fieldKey));
      }
    },
    methods: {
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
            <option value="">Sin sede</option>
            <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'locationId'" class="input-shell" :class="{ 'input-shell--muted': !draft.site }">
          <app-icon name="map-pin" />
          <select :id="inputId" :value="draft.locationId" :disabled="!draft.site" @change="draft.locationId = $event.target.value">
            <option value="">{{ draft.site ? 'Sin ubicación' : 'Elige una sede primero' }}</option>
            <option v-for="location in locations" :key="location.id" :value="location.id">{{ location.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'assigneeId'" class="input-shell">
          <app-icon name="user" />
          <select :id="inputId" :value="draft.assigneeId" @change="draft.assigneeId = $event.target.value">
            <option value="">Sin asignar</option>
            <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }} · {{ person.role }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'statusId'" class="input-shell">
          <app-icon name="activity" />
          <select :id="inputId" :value="draft.statusId" @change="draft.statusId = $event.target.value">
            <option v-for="status in statusChoices" :key="status.id" :value="status.id">{{ status.label }}</option>
          </select>
        </span>

        <span v-else-if="fieldKey === 'description'" class="input-shell input-shell--area">
          <textarea :id="inputId" rows="3" :value="draft.description" :placeholder="placeholder" :aria-invalid="!!error" @input="setText"></textarea>
        </span>

        <span v-else-if="fieldKey === 'cost'" class="input-shell">
          <input :id="inputId" type="number" min="0" step="0.01" :value="draft.cost" :placeholder="placeholder" @input="setText" />
          <span class="input-suffix">EUR</span>
        </span>

        <span v-else class="input-shell">
          <input :id="inputId" :type="fieldKey === 'ip' ? 'text' : 'text'" :value="draft[fieldKey]" :placeholder="placeholder" :aria-invalid="!!error" :disabled="locked" autocomplete="off" @input="setText" />
        </span>

        <span v-if="locked" class="field__hint">Tu rol no permite cambiar el responsable; el valor actual se conserva.</span>
        <span v-if="error" class="field__error">{{ error }}</span>
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
      categoryLabel() {
        const category = this.app.config.categories.find((item) => item.id === this.draft.category);
        return category ? category.label : 'Activo';
      },
      quickKeys() {
        return this.app.assetFormKeys('quick', this.draft.category);
      },
      advancedKeys() {
        return this.app.assetFormKeys('advanced', this.draft.category);
      },
      techFields() {
        return this.app.assetTechFields(this.draft.category);
      },
      showWarranty() {
        return this.app.assetForm(this.draft.category).advanced.indexOf('warranty') !== -1;
      },
      showFov() {
        return !!this.app.assetForm(this.draft.category).fov;
      },
      codePreview() {
        return this.app.assetNextCode(this.draft.category, this.draft.site, this.draft.id);
      },
      fallbackImage() {
        const category = this.app.config.categories.find((item) => item.id === this.draft.category);
        return category ? category.image : 'assets/svg/devices/other.svg';
      },
      warranty() {
        return this.draft.warranty || { until: '', provider: '', note: '' };
      },
      title() {
        return this.editor.mode === 'create' ? 'Registrar activo' : 'Editar activo';
      },
      real() {
        return !!this.editor.real;
      },
      identCode() {
        if (this.real) return this.editor.mode === 'create' ? 'Opcional · el servidor lo asigna' : this.draft.quickCode;
        return this.editor.mode === 'create' ? this.codePreview : this.draft.code;
      },
      identNote() {
        return this.real
          ? 'El ID permanente lo asigna el servidor y nunca cambia. El código rápido se puede editar y debe ser único.'
          : 'El ID nunca cambia. El código rápido se recalcula si cambia el tipo o la ubicación, y el cambio queda en el historial.';
      }
    },
    methods: {
      techValue(field) {
        const tech = this.draft.tech || {};
        return field.type === 'boolean' ? tech[field.key] === true : (tech[field.key] === undefined ? '' : tech[field.key]);
      },
      setTech(field, value) {
        if (!this.draft.tech) this.draft.tech = {};
        this.draft.tech[field.key] = value;
      },
      setTechBoolean(field, event) {
        this.setTech(field, event.target.checked);
      },
      setWarranty(key, value) {
        if (!this.draft.warranty) this.draft.warranty = { until: '', provider: '', note: '' };
        this.draft.warranty[key] = value;
      }
    },
    template: `
      <modal-shell
        :open="editor.open"
        size="wide"
        eyebrow="Inventario de activos"
        :title="title"
        @close="app.closeAssetEditor()"
      >
        <form class="asset-editor" id="asset-editor-form" novalidate @submit.prevent="app.saveAsset()">
          <div class="editor-ident">
            <div class="editor-ident__cell">
              <span class="eyebrow">ID permanente</span>
              <strong class="mono">{{ editor.mode === 'create' ? 'Se asigna al guardar' : draft.id }}</strong>
            </div>
            <div class="editor-ident__cell">
              <span class="eyebrow">Código rápido</span>
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
              <h3>{{ real ? 'Datos del activo' : 'Alta rápida' }}</h3>
              <p>{{ real ? 'Solo se guardan los campos que admite el inventario del servidor.' : 'Con el nombre y la categoría ya puedes guardar. El resto puede completarse después.' }}</p>
            </div>
            <div class="form-grid">
              <div v-if="errors.category" class="field field--invalid form-grid__full">
                <span class="field__error">{{ errors.category }}</span>
              </div>
              <div class="field form-grid__full">
                <label for="asset-editor-category">Categoría</label>
                <span class="input-shell">
                  <app-icon name="grid" />
                  <select id="asset-editor-category" :value="draft.category" @change="app.applyAssetCategory($event.target.value)">
                    <option v-for="category in app.config.categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                  </select>
                </span>
                <span class="field__hint">El formulario se adapta a la categoría: {{ categoryLabel }}.</span>
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

          <section v-if="!real" class="editor-section" data-od-id="asset-editor-photo">
            <div class="editor-section__head">
              <h3>Fotografía</h3>
              <p>Imagen del equipo o una ilustración del catálogo de dispositivos.</p>
            </div>
            <div class="photo-editor">
              <figure class="photo-editor__frame">
                <img :src="draft.image || fallbackImage" :alt="draft.name ? 'Fotografía de ' + draft.name : 'Imagen del activo'" />
                <figcaption class="mono">{{ draft.hasOwnImage ? 'IMAGEN PROPIA' : 'ILUSTRACIÓN DE CATEGORÍA' }}</figcaption>
              </figure>
              <div class="photo-editor__controls">
                <label class="btn btn--secondary btn--small photo-upload">
                  <app-icon name="upload" />
                  <span>Subir fotografía</span>
                  <input type="file" accept="image/*" class="sr-only" @change="app.handleAssetPhoto" />
                </label>
                <button v-if="draft.hasOwnImage" type="button" class="text-button" @click="app.removeAssetPhoto()">Volver a la ilustración</button>
                <p class="field__hint">JPG o PNG de hasta 1 MB. La imagen se guarda en este navegador.</p>
                <p v-if="errors.image" class="field__error">{{ errors.image }}</p>
                <div class="preset-grid preset-grid--compact">
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

          <section v-if="!real && showFov" class="editor-section" data-od-id="asset-editor-fov">
            <div class="editor-section__head">
              <h3>Campo de visión</h3>
              <p>Imagen independiente de la fotografía: representa el área que cubre la cámara.</p>
            </div>
            <div class="photo-editor photo-editor--compact">
              <figure class="photo-editor__frame photo-editor__frame--diagram">
                <img v-if="draft.fovImage" :src="draft.fovImage" alt="Campo de visión de la cámara" />
                <div v-else class="photo-editor__empty">
                  <app-icon name="camera" />
                  <span>Sin imagen de cobertura</span>
                </div>
                <figcaption class="mono">CAMPO DE VISIÓN</figcaption>
              </figure>
              <div class="photo-editor__controls">
                <label class="btn btn--secondary btn--small photo-upload">
                  <app-icon name="upload" />
                  <span>Subir imagen de cobertura</span>
                  <input type="file" accept="image/*" class="sr-only" @change="app.handleAssetFov" />
                </label>
                <button v-if="draft.fovImage" type="button" class="text-button" @click="app.removeAssetFov()">Quitar imagen</button>
                <p v-if="errors.fov" class="field__error">{{ errors.fov }}</p>
              </div>
            </div>
          </section>

          <section v-if="!real" class="editor-section" data-od-id="asset-editor-advanced">
            <button
              type="button"
              class="editor-toggle"
              :aria-expanded="editor.advancedOpen ? 'true' : 'false'"
              aria-controls="asset-editor-advanced-fields"
              @click="app.toggleAssetAdvanced()"
            >
              <app-icon :name="editor.advancedOpen ? 'chevron-down' : 'chevron-right'" />
              <span class="editor-toggle__label">Datos avanzados</span>
              <span class="editor-toggle__hint">{{ editor.advancedOpen ? 'Ocultar' : 'Serie, coste, garantía, acceso remoto y campos técnicos' }}</span>
            </button>

            <div v-show="editor.advancedOpen" id="asset-editor-advanced-fields" class="editor-advanced">
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

              <div v-if="showWarranty" class="warranty-editor">
                <div class="warranty-editor__head">
                  <h4>Garantía individual</h4>
                  <div class="warranty-editor__quick">
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(12)">+12 meses</button>
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(24)">+24 meses</button>
                    <button type="button" class="chip-button" @click="app.applyAssetWarrantyPreset(36)">+36 meses</button>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="field" :class="{ 'field--invalid': !!errors.warranty }">
                    <label :for="'asset-warranty-until'">Vence el</label>
                    <span class="input-shell">
                      <input id="asset-warranty-until" type="date" :value="warranty.until" @input="setWarranty('until', $event.target.value)" />
                    </span>
                    <span v-if="errors.warranty" class="field__error">{{ errors.warranty }}</span>
                  </div>
                  <div class="field">
                    <label :for="'asset-warranty-provider'">Proveedor</label>
                    <span class="input-shell">
                      <input id="asset-warranty-provider" type="text" :value="warranty.provider" placeholder="Ej. Lenovo Premier" @input="setWarranty('provider', $event.target.value)" />
                    </span>
                  </div>
                  <div class="field form-grid__full">
                    <label :for="'asset-warranty-note'">Nota de garantía</label>
                    <span class="input-shell">
                      <input id="asset-warranty-note" type="text" :value="warranty.note" placeholder="Contrato, condiciones o número de caso" @input="setWarranty('note', $event.target.value)" />
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="techFields.length" class="tech-editor">
                <h4>Campos técnicos · {{ categoryLabel }}</h4>
                <div class="form-grid">
                  <div v-for="field in techFields" :key="field.key" class="field" :class="{ 'field--inline': field.type === 'boolean' }">
                    <label :for="'asset-tech-' + field.key">
                      {{ field.label }}<span v-if="field.unit" class="field__unit">({{ field.unit }})</span>
                    </label>
                    <label v-if="field.type === 'boolean'" class="switch">
                      <input
                        :id="'asset-tech-' + field.key"
                        type="checkbox"
                        :checked="techValue(field) === true"
                        @change="setTechBoolean(field, $event)"
                      />
                      <span class="switch__track"><span class="switch__thumb"></span></span>
                      <span class="switch__text">{{ techValue(field) === true ? 'Sí' : 'No' }}</span>
                    </label>
                    <span v-else-if="field.type === 'select'" class="input-shell">
                      <select :id="'asset-tech-' + field.key" :value="techValue(field)" @change="setTech(field, $event.target.value)">
                        <option value="">Sin definir</option>
                        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                      </select>
                    </span>
                    <span v-else-if="field.type === 'textarea'" class="input-shell input-shell--area">
                      <textarea :id="'asset-tech-' + field.key" rows="3" :value="techValue(field)" @input="setTech(field, $event.target.value)"></textarea>
                    </span>
                    <span v-else class="input-shell">
                      <input
                        :id="'asset-tech-' + field.key"
                        :type="field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text')"
                        :value="techValue(field)"
                        :placeholder="field.hint || ''"
                        @input="setTech(field, $event.target.value)"
                      />
                    </span>
                    <span v-if="field.hint && field.type !== 'text' && field.type !== 'number'" class="field__hint">{{ field.hint }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </form>

        <template #footer>
          <p class="modal-foot__hint">* El nombre es obligatorio. El servidor valida el resto de los campos.</p>
          <button type="button" class="btn btn--ghost" @click="app.closeAssetEditor()">Cancelar</button>
          <button type="button" class="btn btn--primary" :disabled="editor.saving" @click="app.saveAsset()">
            {{ editor.mode === 'create' ? 'Registrar activo' : 'Guardar cambios' }}
          </button>
        </template>
      </modal-shell>
    `
  };
})();
