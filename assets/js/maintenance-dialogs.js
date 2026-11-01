(function () {
  'use strict';

  const Engine = window.AssetMaintEngine;
  const Data = window.ASSET_MAINT;

  const Dialogs = window.AssetMaintDialogs = window.AssetMaintDialogs || {};

  function T(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function dayInput(value) {
    const day = Engine.toDay(value);
    return day && Engine.validDay(day) ? day : Engine.today();
  }

  function timeInput(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function isoInput(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function fmtDay(value) {
    const helpers = window.AssetMaintViews && window.AssetMaintViews.helpers;
    if (helpers && helpers.fmtDay) return helpers.fmtDay(value);
    const day = Engine.toDay(value);
    if (!day || !Engine.validDay(day)) return T('ui.maintenance.no_date');
    return day;
  }

  const PLAN_STATUS_LABELS = {
    get active() { return T('ui.maintenance.plan_status.active'); },
    get postponed() { return T('ui.maintenance.plan_status.postponed'); },
    get cancelled() { return T('ui.maintenance.plan_status.cancelled'); }
  };

  function planStatusLabel(status) {
    return PLAN_STATUS_LABELS[status] || status || T('ui.maintenance.no_status');
  }

  function money(value) {
    if (value === null || value === undefined || value === '') return '—';
    return window.ItsmI18n
      ? window.ItsmI18n.amount(value, { maximumFractionDigits: 2 })
      : String(Number(value) || 0);
  }

  function addDays(day, amount) {
    return Engine.addDays(day, amount);
  }

  function personLabel(person) {
    return person ? (person.label || person.name) : '';
  }

  function assetLabel(asset) {
    if (!asset) return '';
    const code = asset.quickCode || asset.id || '';
    const name = asset.name || '';
    if (name && name !== code) return code + ' · ' + name;
    return code || name;
  }

  function searchDebounce(vm, key, run) {
    if (vm[key]) window.clearTimeout(vm[key]);
    vm[key] = window.setTimeout(() => {
      vm[key] = null;
      run();
    }, 250);
  }

  const baseProps = {
    open: { type: Boolean, default: false },
    app: { type: Object, required: true }
  };

  Dialogs.InterventionDialog = {
    name: 'InterventionDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      mode: { type: String, default: 'create' },
      assetId: { type: String, default: '' },
      interventionId: { type: String, default: '' },
      preset: { type: Object, default: null }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: {
          assetId: '', type: 'preventive', description: '', technicianPersonId: '', occurredOn: Engine.today(),
          status: 'open', notes: '', laborCost: '', incidentId: '', planId: ''
        },
        parts: [],
        attachments: [],
        selectedAsset: null,
        selectedPerson: null,
        assetQuery: '',
        assetResults: [],
        assetLoading: false,
        personQuery: '',
        personResults: [],
        personLoading: false,
        uploading: false,
        saving: false,
        error: '',
        searchTimer: null,
        personTimer: null,
        loadedRecord: null
      };
    },
    computed: {
      isComplete() {
        return this.mode === 'complete';
      },
      types() {
        return Data.INTERVENTION_TYPES || [];
      },
      typeOptions() {
        const current = this.form && this.form.type;
        if (!current || this.types.some((type) => type.id === current)) return this.types;
        return this.types.concat([{ id: current, label: Engine.typeMeta(current).label }]);
      },
      priorities() {
        return Data.PRIORITIES;
      },
      canEdit() {
        return this.app.can('assets.edit');
      },
      contextIncident() {
        return (this.preset && this.preset.incidentId) || this.form.incidentId;
      },
      contextPlan() {
        return (this.preset && this.preset.planId) || this.form.planId;
      }
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (value) this.reset();
        }
      }
    },
    beforeUnmount() {
      if (this.searchTimer) window.clearTimeout(this.searchTimer);
      if (this.personTimer) window.clearTimeout(this.personTimer);
    },
    methods: {
      fmtDay,
      money,
      assetLabel,
      reset() {
        const preset = this.preset || {};
        this.error = '';
        this.parts = [];
        this.attachments = [];
        this.assetResults = [];
        this.personResults = [];
        this.assetQuery = '';
        this.personQuery = '';
        this.loadedRecord = null;
        this.selectedPerson = null;
        const initialAssetId = this.assetId || preset.assetId || '';
        const known = this.app.assets.find((asset) => asset.id === initialAssetId);
        const presetName = preset.assetName || '';
        const presetCode = preset.assetQuickCode || '';
        this.selectedAsset = known || (initialAssetId ? { id: initialAssetId, name: presetName, quickCode: presetCode, serverAsset: true } : null);
        this.form = {
          assetId: initialAssetId,
          type: preset.type || 'preventive',
          description: preset.description || '',
          technicianPersonId: preset.technicianPersonId || '',
          occurredOn: preset.occurredOn || Engine.today(),
          status: this.isComplete ? 'completed' : (preset.status || 'open'),
          notes: '',
          laborCost: '',
          incidentId: preset.incidentId || '',
          planId: preset.planId || ''
        };
        if (this.isComplete || this.interventionId) {
          this.loadRecord();
        }
      },
      loadRecord() {
        if (!this.interventionId) return;
        const cached = (this.app.maintenanceInterventions || []).find((item) => item.id === this.interventionId);
        if (cached) this.applyRecord(cached);
        this.app.loadMaintenanceIntervention(this.interventionId).then(() => {
          const detail = this.app.maintenanceApi && this.app.maintenanceApi.interventionDetail;
          if (detail && detail.record) this.applyRecord(detail.record);
        });
      },
      applyRecord(record) {
        if (!record) return;
        this.loadedRecord = record;
        this.selectedAsset = record.asset || { id: record.assetId, name: record.assetName, quickCode: record.assetQuickCode, serverAsset: true };
        this.selectedPerson = record.technicianPersonId ? { id: record.technicianPersonId, name: record.technicianName, label: record.technicianName } : null;
        this.form = {
          assetId: record.assetId,
          type: record.type,
          description: record.description || record.title || '',
          technicianPersonId: record.technicianPersonId,
          occurredOn: Engine.toDay(record.occurredOn),
          status: this.isComplete ? 'completed' : record.status,
          notes: record.notes || '',
          laborCost: record.laborCost || '',
          incidentId: record.incidentId || (this.preset && this.preset.incidentId) || '',
          planId: record.planId || (this.preset && this.preset.planId) || ''
        };
        this.parts = (record.parts || []).map((part) => ({ name: part.name, quantity: part.quantity, unitCost: part.unitCost }));
        this.attachments = (record.attachments || []).map((item) => ({ id: item.id, filename: item.filename, name: item.filename }));
      },
      chooseAsset(asset) {
        this.selectedAsset = asset;
        this.form.assetId = asset.id;
        this.assetResults = [];
        this.assetQuery = '';
      },
      clearAsset() {
        this.selectedAsset = null;
        this.form.assetId = '';
      },
      searchAssets() {
        const query = this.assetQuery.trim();
        if (query.length < 2) {
          this.assetResults = [];
          return;
        }
        searchDebounce(this, 'searchTimer', async () => {
          this.assetLoading = true;
          try {
            this.assetResults = await this.app.searchMaintenanceAssets(query);
          } catch (error) {
            this.error = (error && error.message) || T('ui.maintenance.error.search_assets');
          } finally {
            this.assetLoading = false;
          }
        });
      },
      choosePerson(person) {
        this.selectedPerson = person;
        this.form.technicianPersonId = person.id;
        this.personResults = [];
        this.personQuery = '';
      },
      clearPerson() {
        this.selectedPerson = null;
        this.form.technicianPersonId = '';
      },
      searchPeople() {
        const query = this.personQuery.trim();
        if (query.length < 2) {
          this.personResults = [];
          return;
        }
        searchDebounce(this, 'personTimer', async () => {
          this.personLoading = true;
          try {
            this.personResults = await this.app.searchMaintenancePeople(query);
          } catch (error) {
            this.error = (error && error.message) || T('ui.maintenance.error.search_people');
          } finally {
            this.personLoading = false;
          }
        });
      },
      addPart() {
        this.parts.push({ name: '', quantity: 1, unitCost: '' });
      },
      removePart(index) {
        this.parts.splice(index, 1);
      },
      async onFile(event) {
        const file = event && event.target && event.target.files ? event.target.files[0] : null;
        if (!file || !this.form.assetId) return;
        this.uploading = true;
        this.error = '';
        const result = await this.app.uploadMaintenanceAttachment(this.form.assetId, file);
        this.uploading = false;
        if (event.target) event.target.value = '';
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.error.upload');
          return;
        }
        if (result.attachment) this.attachments.push(result.attachment);
      },
      removeAttachment(index) {
        this.attachments.splice(index, 1);
      },
      payload() {
        const parts = this.parts
          .filter((part) => String(part.name || '').trim())
          .map((part) => ({ name: String(part.name).trim(), quantity: Number(part.quantity) || 1, unitCost: part.unitCost === '' ? undefined : String(part.unitCost) }));
        const payload = {
          assetId: this.form.assetId,
          type: this.form.type,
          description: String(this.form.description || '').trim(),
          technicianPersonId: this.form.technicianPersonId || undefined,
          occurredOn: this.form.occurredOn,
          status: this.form.status,
          notes: String(this.form.notes || '').trim() || undefined,
          parts,
          laborCost: this.form.laborCost === '' ? undefined : String(this.form.laborCost),
          attachmentIds: this.attachments.map((item) => item.id),
          incidentId: this.contextIncident || undefined,
          planId: this.contextPlan || undefined
        };
        if (!payload.incidentId) delete payload.incidentId;
        if (!payload.planId) delete payload.planId;
        return payload;
      },
      async save() {
        if (!this.form.assetId) {
          this.error = T('ui.maintenance.dialog.error_asset');
          return;
        }
        if (!String(this.form.description || '').trim()) {
          this.error = T('ui.maintenance.dialog.error_description');
          return;
        }
        if (!this.form.occurredOn) {
          this.error = T('ui.maintenance.dialog.error_date');
          return;
        }
        this.saving = true;
        this.error = '';
        const payload = this.payload();
        const result = this.interventionId
          ? await this.app.updateMaintenanceIntervention(this.interventionId, payload)
          : await this.app.saveMaintenanceIntervention(payload);
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.dialog.error_save');
          return;
        }
        this.app.showToast(this.isComplete ? T('ui.maintenance.dialog.saved_complete') : (this.interventionId ? T('ui.maintenance.dialog.saved_update') : T('ui.maintenance.dialog.saved_create')));
        const record = result.intervention || this.loadedRecord;
        this.$emit('saved', { intervention: record, result });
        this.$emit('close');
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="isComplete ? $t('ui.maintenance.dialog.complete_intervention_title') : (interventionId ? $t('ui.maintenance.dialog.edit_title') : $t('ui.maintenance.dialog.create_title'))"
                   :eyebrow="isComplete ? $t('ui.maintenance.dialog.close_eyebrow') : $t('ui.maintenance.dialog.work_eyebrow')" size="wide" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>

        <div v-if="contextIncident || contextPlan" class="maint-modal-context">
          <span class="maint-modal-context__icon"><app-icon name="activity"></app-icon></span>
          <div>
            <strong>{{ contextIncident ? $t('ui.maintenance.dialog.linked_incident', { id: contextIncident }) : $t('ui.maintenance.dialog.linked_plan') }}</strong>
            <span class="mono">{{ contextPlan || '' }}</span>
          </div>
        </div>

        <div class="form-grid form-grid--two">
          <div class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.dialog.asset') }} <em>*</em></span>
            <div v-if="selectedAsset" class="maint-picker">
              <span class="maint-picker__value">{{ assetLabel(selectedAsset) }}</span>
              <button v-if="!interventionId" type="button" class="icon-button" :aria-label="$t('ui.maintenance.dialog.change_asset')" @click="clearAsset"><app-icon name="x"></app-icon></button>
            </div>
            <div v-else class="maint-picker">
              <label class="search-field maint-picker__search">
                <span class="sr-only">{{ $t('ui.maintenance.dialog.search_asset') }}</span>
                <app-icon name="search"></app-icon>
                <input v-model="assetQuery" type="search" :placeholder="$t('ui.maintenance.field.search_asset')" data-maint-picker="asset" @input="searchAssets">
              </label>
              <span v-if="assetLoading" class="cell-muted">{{ $t('ui.maintenance.searching') }}</span>
            </div>
            <ul v-if="assetResults.length" class="maint-picker__results" role="listbox">
              <li v-for="asset in assetResults" :key="asset.id">
                <button type="button" class="maint-picker__option" @click="chooseAsset(asset)">
                  <strong>{{ asset.quickCode || asset.id }}</strong> · {{ asset.name }} <span class="cell-muted">{{ asset.category }}</span>
                </button>
              </li>
            </ul>
          </div>

          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.work_type') }} <em>*</em></span>
            <span class="select-field">
              <select v-model="form.type" data-maint-field="type">
                <option v-for="type in typeOptions" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </span>
          </label>

          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.status') }}</span>
            <span class="select-field">
              <select v-model="form.status" data-maint-field="status">
                <option value="open">{{ $t('ui.maintenance.state.open') }}</option>
                <option value="in_progress">{{ $t('ui.maintenance.state.in_progress') }}</option>
                <option value="completed">{{ $t('ui.maintenance.state.completed') }}</option>
                <option value="cancelled">{{ $t('ui.maintenance.state.cancelled') }}</option>
              </select>
            </span>
          </label>

          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.date') }} <em>*</em></span>
            <input v-model="form.occurredOn" type="date" max="2100-12-31" class="input-shell input-shell--plain" data-maint-field="occurredOn">
          </label>

          <div class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.technician') }}</span>
            <div v-if="selectedPerson" class="maint-picker">
              <span class="maint-picker__value">{{ personLabel(selectedPerson) }}</span>
              <button type="button" class="icon-button" :aria-label="$t('ui.maintenance.dialog.remove_technician')" @click="clearPerson"><app-icon name="x"></app-icon></button>
            </div>
            <div v-else class="maint-picker">
              <label class="search-field maint-picker__search">
                <span class="sr-only">{{ $t('ui.maintenance.dialog.search_technician') }}</span>
                <app-icon name="search"></app-icon>
                <input v-model="personQuery" type="search" :placeholder="$t('ui.maintenance.field.search_person')" data-maint-picker="person" @input="searchPeople">
              </label>
              <span v-if="personLoading" class="cell-muted">{{ $t('ui.maintenance.searching') }}</span>
            </div>
            <ul v-if="personResults.length" class="maint-picker__results" role="listbox">
              <li v-for="person in personResults" :key="person.id">
                <button type="button" class="maint-picker__option" @click="choosePerson(person)">{{ person.label || person.name }}</button>
              </li>
            </ul>
          </div>

          <label class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.field.description') }} <em>*</em></span>
            <textarea v-model="form.description" rows="3" maxlength="600" class="input-shell input-shell--plain" data-maint-field="description" :placeholder="$t('ui.maintenance.dialog.description_placeholder')"></textarea>
          </label>

          <label class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.field.notes') }} <span class="cell-muted">{{ $t('ui.maintenance.optional') }}</span></span>
            <textarea v-model="form.notes" rows="2" maxlength="1200" class="input-shell input-shell--plain"></textarea>
          </label>
        </div>

        <section class="maint-subsection" aria-labelledby="maint-parts-title">
          <header class="maint-subsection__head">
            <h3 id="maint-parts-title">{{ $t('ui.maintenance.dialog.parts') }}</h3>
            <button type="button" class="text-button" @click="addPart"><app-icon name="plus"></app-icon> {{ $t('ui.maintenance.dialog.add_part') }}</button>
          </header>
          <div v-for="(part, index) in parts" :key="index" class="maint-part-row">
            <input v-model="part.name" type="text" class="input-shell input-shell--plain" :placeholder="$t('ui.maintenance.dialog.part_name')" :aria-label="$t('ui.maintenance.dialog.part_name')">
            <input v-model.number="part.quantity" type="number" min="1" class="input-shell input-shell--plain" :placeholder="$t('ui.maintenance.dialog.quantity')" :aria-label="$t('ui.maintenance.dialog.quantity')">
            <input v-model="part.unitCost" type="number" min="0" step="0.01" class="input-shell input-shell--plain" :placeholder="$t('ui.maintenance.dialog.unit_cost')" :aria-label="$t('ui.maintenance.dialog.unit_cost')">
            <button type="button" class="icon-button" :aria-label="$t('ui.maintenance.dialog.remove_part')" @click="removePart(index)"><app-icon name="trash"></app-icon></button>
          </div>
          <p v-if="!parts.length" class="cell-muted maint-aside-note">{{ $t('ui.maintenance.dialog.no_parts') }}</p>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.labor') }}</span>
            <input v-model="form.laborCost" type="number" min="0" step="0.01" class="input-shell input-shell--plain">
          </label>
        </section>

        <section class="maint-subsection" aria-labelledby="maint-files-title">
          <header class="maint-subsection__head">
            <h3 id="maint-files-title">{{ $t('ui.maintenance.dialog.files') }}</h3>
            <span v-if="uploading" class="cell-muted">{{ $t('ui.maintenance.dialog.uploading') }}</span>
          </header>
          <label class="btn btn--ghost btn--small maint-file">
            <input type="file" class="sr-only" data-maint-field="attachment" :disabled="!form.assetId || uploading" @change="onFile">
            <app-icon name="file"></app-icon> {{ $t('ui.maintenance.dialog.attach') }}
          </label>
          <ul v-if="attachments.length" class="maint-attachment-list">
            <li v-for="(file, index) in attachments" :key="file.id">
              <span class="mono">{{ file.filename || file.name }}</span>
              <button type="button" class="icon-button" :aria-label="$t('ui.maintenance.dialog.remove_attachment')" @click="removeAttachment(index)"><app-icon name="x"></app-icon></button>
            </li>
          </ul>
          <p v-else class="cell-muted maint-aside-note">{{ $t('ui.maintenance.dialog.files_hint') }}</p>
        </section>

        <template #footer>
          <button type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="close">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="maint-intervention-save" :disabled="saving || uploading" @click="save">{{ saving ? $t('ui.maintenance.saving') : $t('ui.maintenance.dialog.save_intervention') }}</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.IncidentDialog = {
    name: 'IncidentDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      primaryAssetId: { type: String, default: '' },
      preset: { type: Object, default: null }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: { primaryAssetId: '', description: '', priority: 'normal', responsiblePersonId: '', openedOn: Engine.today() },
        primaryAsset: null,
        responsible: null,
        affected: [],
        assetQuery: '',
        assetResults: [],
        assetLoading: false,
        personQuery: '',
        personResults: [],
        personLoading: false,
        saving: false,
        error: '',
        searchTimer: null,
        personTimer: null
      };
    },
    computed: {
      priorities() {
        return Data.PRIORITIES;
      },
      canEdit() {
        return this.app.can('assets.edit');
      }
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (!value) return;
          this.error = '';
          this.affected = [];
          this.assetResults = [];
          this.personResults = [];
          this.assetQuery = '';
          this.personQuery = '';
          this.responsible = null;
          const assetId = this.primaryAssetId || (this.preset && this.preset.primaryAssetId) || '';
          this.primaryAsset = this.app.assets.find((asset) => asset.id === assetId) || (assetId ? { id: assetId, name: assetId, quickCode: assetId, serverAsset: true } : null);
          this.form = {
            primaryAssetId: assetId,
            description: (this.preset && this.preset.description) || '',
            priority: (this.preset && this.preset.priority) || 'normal',
            responsiblePersonId: '',
            openedOn: Engine.today()
          };
        }
      }
    },
    beforeUnmount() {
      if (this.searchTimer) window.clearTimeout(this.searchTimer);
      if (this.personTimer) window.clearTimeout(this.personTimer);
    },
    methods: {
      assetLabel,
      choosePrimary(asset) {
        this.primaryAsset = asset;
        this.form.primaryAssetId = asset.id;
        this.assetResults = [];
        this.assetQuery = '';
      },
      clearPrimary() {
        this.primaryAsset = null;
        this.form.primaryAssetId = '';
      },
      searchAssets() {
        const query = this.assetQuery.trim();
        if (query.length < 2) {
          this.assetResults = [];
          return;
        }
        searchDebounce(this, 'searchTimer', async () => {
          this.assetLoading = true;
          try {
            this.assetResults = await this.app.searchMaintenanceAssets(query);
          } catch (error) {
            this.error = (error && error.message) || T('ui.maintenance.error.search_assets');
          } finally {
            this.assetLoading = false;
          }
        });
      },
      addAffected(asset) {
        if (!asset || this.form.primaryAssetId === asset.id) return;
        if (this.affected.some((item) => item.id === asset.id)) return;
        this.affected.push(asset);
        this.assetResults = [];
        this.assetQuery = '';
      },
      removeAffected(id) {
        this.affected = this.affected.filter((asset) => asset.id !== id);
      },
      choosePerson(person) {
        this.responsible = person;
        this.form.responsiblePersonId = person.id;
        this.personResults = [];
        this.personQuery = '';
      },
      clearPerson() {
        this.responsible = null;
        this.form.responsiblePersonId = '';
      },
      searchPeople() {
        const query = this.personQuery.trim();
        if (query.length < 2) {
          this.personResults = [];
          return;
        }
        searchDebounce(this, 'personTimer', async () => {
          this.personLoading = true;
          try {
            this.personResults = await this.app.searchMaintenancePeople(query);
          } catch (error) {
            this.error = (error && error.message) || T('ui.maintenance.error.search_people');
          } finally {
            this.personLoading = false;
          }
        });
      },
      async save() {
        if (!this.form.primaryAssetId) {
          this.error = T('ui.incidents.dialog.error_primary');
          return;
        }
        if (!String(this.form.description || '').trim()) {
          this.error = T('ui.incidents.dialog.error_description');
          return;
        }
        this.saving = true;
        this.error = '';
        const payload = {
          primaryAssetId: this.form.primaryAssetId,
          description: String(this.form.description).trim(),
          priority: this.form.priority,
          affectedAssetIds: this.affected.map((asset) => asset.id),
          responsiblePersonId: this.form.responsiblePersonId || undefined,
          openedOn: this.form.openedOn
        };
        const result = await this.app.createMaintenanceIncident(payload);
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.incidents.dialog.error_create');
          return;
        }
        this.app.showToast(T('ui.incidents.dialog.created'));
        this.$emit('saved', { incident: result.incident, result });
        this.$emit('close');
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.incidents.dialog.title')" :eyebrow="$t('ui.incidents.dialog.eyebrow')" size="wide" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <div v-if="!canEdit" class="config-lock"><app-icon name="lock"></app-icon><p>{{ $t('ui.incidents.dialog.lock') }}</p></div>
        <div v-else class="form-grid form-grid--two">
          <div class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.incident.primary_asset') }} <em>*</em></span>
            <div v-if="primaryAsset" class="maint-picker">
              <span class="maint-picker__value">{{ assetLabel(primaryAsset) }}</span>
              <button type="button" class="icon-button" :aria-label="$t('ui.incidents.dialog.change_primary')" @click="clearPrimary"><app-icon name="x"></app-icon></button>
            </div>
            <div v-else class="maint-picker">
              <label class="search-field maint-picker__search">
                <span class="sr-only">{{ $t('ui.incidents.dialog.search_primary') }}</span>
                <app-icon name="search"></app-icon>
                <input v-model="assetQuery" type="search" :placeholder="$t('ui.maintenance.field.search_asset')" data-maint-picker="primary-asset" @input="searchAssets">
              </label>
              <span v-if="assetLoading" class="cell-muted">{{ $t('ui.maintenance.searching') }}</span>
            </div>
            <ul v-if="assetResults.length" class="maint-picker__results" role="listbox">
              <li v-for="asset in assetResults" :key="asset.id">
                <button type="button" class="maint-picker__option" @click="choosePrimary(asset)"><strong>{{ asset.quickCode || asset.id }}</strong> · {{ asset.name }}</button>
              </li>
            </ul>
          </div>

          <label class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.field.description') }} <em>*</em></span>
            <textarea v-model="form.description" rows="3" maxlength="600" class="input-shell input-shell--plain" data-maint-field="description" :placeholder="$t('ui.incidents.dialog.description_placeholder')"></textarea>
          </label>

          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.filter.priority') }}</span>
            <span class="select-field">
              <select v-model="form.priority" data-maint-field="priority">
                <option v-for="priority in priorities" :key="priority.id" :value="priority.id">{{ priority.label }}</option>
              </select>
            </span>
          </label>

          <label class="field">
            <span class="field__label">{{ $t('ui.incidents.dialog.opened_on') }}</span>
            <input v-model="form.openedOn" type="date" class="input-shell input-shell--plain" data-maint-field="openedOn">
          </label>

          <div class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.field.responsible') }} <span class="cell-muted">{{ $t('ui.maintenance.optional') }}</span></span>
            <div v-if="responsible" class="maint-picker">
              <span class="maint-picker__value">{{ personLabel(responsible) }}</span>
              <button type="button" class="icon-button" :aria-label="$t('ui.incidents.dialog.remove_responsible')" @click="clearPerson"><app-icon name="x"></app-icon></button>
            </div>
            <div v-else class="maint-picker">
              <label class="search-field maint-picker__search">
                <span class="sr-only">{{ $t('ui.maintenance.field.search_person') }}</span>
                <app-icon name="search"></app-icon>
                <input v-model="personQuery" type="search" :placeholder="$t('ui.maintenance.field.search_person')" data-maint-picker="person" @input="searchPeople">
              </label>
              <span v-if="personLoading" class="cell-muted">{{ $t('ui.maintenance.searching') }}</span>
            </div>
            <ul v-if="personResults.length" class="maint-picker__results" role="listbox">
              <li v-for="person in personResults" :key="person.id"><button type="button" class="maint-picker__option" @click="choosePerson(person)">{{ person.label || person.name }}</button></li>
            </ul>
          </div>

          <div class="field field--span">
            <span class="field__label">{{ $t('ui.incidents.dialog.affected') }}</span>
            <ul v-if="affected.length" class="maint-picker__chips">
              <li v-for="asset in affected" :key="asset.id">
                <span>{{ asset.quickCode || asset.id }} · {{ asset.name }}</span>
                <button type="button" class="icon-button" :aria-label="$t('ui.incidents.dialog.remove_affected')" @click="removeAffected(asset.id)"><app-icon name="x"></app-icon></button>
              </li>
            </ul>
            <label class="search-field maint-picker__search">
              <span class="sr-only">{{ $t('ui.incidents.dialog.add_affected') }}</span>
              <app-icon name="plus"></app-icon>
              <input v-model="assetQuery" type="search" :placeholder="$t('ui.incidents.dialog.search_other')" data-maint-picker="affected-asset" @input="searchAssets">
            </label>
            <ul v-if="assetResults.length" class="maint-picker__results" role="listbox">
              <li v-for="asset in assetResults" :key="asset.id">
                <button type="button" class="maint-picker__option" @click="addAffected(asset)"><strong>{{ asset.quickCode || asset.id }}</strong> · {{ asset.name }}</button>
              </li>
            </ul>
          </div>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="close">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="maint-incident-save" :disabled="saving || !canEdit" @click="save">{{ saving ? $t('ui.incidents.dialog.creating') : $t('ui.incidents.dialog.create') }}</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.PlanCompleteDialog = {
    name: 'PlanCompleteDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      planId: { type: String, default: '' },
      label: { type: String, default: '' }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return { completedOn: Engine.today(), notes: '', saving: false, error: '' };
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (!value) return;
          this.completedOn = Engine.today();
          this.notes = '';
          this.error = '';
        }
      }
    },
    methods: {
      fmtDay,
      async save() {
        if (!this.completedOn) {
          this.error = T('ui.maintenance.dialog.error_completed_on');
          return;
        }
        this.saving = true;
        this.error = '';
        const result = await this.app.completeMaintenancePlan(this.planId, { completedOn: this.completedOn, notes: this.notes || undefined });
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.dialog.error_complete');
          return;
        }
        this.$emit('saved', result);
        this.$emit('close');
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.maintenance.dialog.complete_plan_title')" :eyebrow="$t('ui.maintenance.dialog.complete_eyebrow')" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <p class="cell-muted">{{ label }}</p>
        <p class="cell-muted">{{ $t('ui.maintenance.dialog.complete_lead') }}</p>
        <div class="form-grid">
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.completed_on') }} <em>*</em></span>
            <input v-model="completedOn" type="date" class="input-shell input-shell--plain" data-maint-field="completedOn">
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.notes') }} <span class="cell-muted">{{ $t('ui.maintenance.optional') }}</span></span>
            <textarea v-model="notes" rows="3" class="input-shell input-shell--plain"></textarea>
          </label>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="close">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="maint-plan-complete-save" :disabled="saving" @click="save">{{ saving ? $t('ui.maintenance.saving') : $t('ui.maintenance.panel.complete_preventive') }}</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.PostponeDialog = {
    name: 'PostponeDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      planId: { type: String, default: '' },
      label: { type: String, default: '' }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return { dueOn: addDays(Engine.today(), 7), notes: '', saving: false, error: '' };
    },
    computed: {
      quickOptions() {
        return [7, 14, 30].map((days) => ({ days, label: T('ui.maintenance.dialog.days', { count: days }), dueOn: addDays(Engine.today(), days) }));
      }
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (!value) return;
          this.dueOn = addDays(Engine.today(), 7);
          this.notes = '';
          this.error = '';
        }
      }
    },
    methods: {
      pick(dueOn) {
        this.dueOn = dueOn;
      },
      async save() {
        if (!this.dueOn) {
          this.error = T('ui.maintenance.dialog.error_due');
          return;
        }
        this.saving = true;
        this.error = '';
        const result = await this.app.postponeMaintenancePlan(this.planId, { dueOn: this.dueOn, notes: this.notes || undefined });
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.dialog.error_postpone');
          return;
        }
        this.$emit('saved', result);
        this.$emit('close');
      },
      close() {
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.maintenance.dialog.postpone_title')" :eyebrow="$t('ui.maintenance.dialog.postpone_eyebrow')" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <p class="cell-muted">{{ label }}</p>
        <div class="maint-quick-dates">
          <button v-for="option in quickOptions" :key="option.days" type="button" class="chip chip--muted" :class="{ 'is-active': dueOn === option.dueOn }" @click="pick(option.dueOn)">+{{ option.label }}</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.new_due') }} <em>*</em></span>
            <input v-model="dueOn" type="date" class="input-shell input-shell--plain" data-maint-field="dueOn">
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.reason') }} <span class="cell-muted">{{ $t('ui.maintenance.optional') }}</span></span>
            <textarea v-model="notes" rows="3" class="input-shell input-shell--plain"></textarea>
          </label>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="close">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="maint-plan-postpone-save" :disabled="saving" @click="save">{{ saving ? $t('ui.maintenance.saving') : $t('ui.maintenance.dialog.postpone') }}</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.PlanDialog = {
    name: 'PlanDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      assetId: { type: String, required: true },
      preset: { type: Object, default: null }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: { maintenanceType: 'preventivo', intervalMonths: 6, dueOn: '', responsiblePersonId: '' },
        tasksText: '',
        plan: null,
        templates: [],
        responsible: null,
        personQuery: '',
        personResults: [],
        personLoading: false,
        personTimer: null,
        saving: false,
        loading: false,
        error: ''
      };
    },
    computed: {
      types() {
        return Data.INTERVENTION_TYPES.filter((type) => type.id === 'preventive' || type.id === 'inspection');
      },
      typeOptions() {
        const current = this.form && this.form.maintenanceType;
        if (!current || this.types.some((type) => type.id === current)) return this.types;
        return this.types.concat([{ id: current, label: Engine.typeMeta(current).label }]);
      },
      asset() {
        const source = this.plan || {};
        const preset = this.preset || {};
        return {
          id: this.assetId,
          name: source.assetName || preset.assetName || this.assetId,
          quickCode: source.assetQuickCode || preset.assetQuickCode || '',
          category: source.assetCategory || preset.assetCategory || ''
        };
      },
      availableTemplates() {
        return this.templates.filter((template) => !this.asset.category || template.category === this.asset.category);
      },
      paused() {
        return !!this.plan && this.plan.status === 'postponed';
      }
    },
    watch: {
      open: {
        immediate: true,
        handler(value) {
          if (value) this.load();
        }
      }
    },
    beforeUnmount() {
      if (this.personTimer) window.clearTimeout(this.personTimer);
    },
    methods: {
      fmtDay,
      planStatusLabel,
      responsibleName() {
        return personLabel(this.responsible);
      },
      searchPeople() {
        const query = this.personQuery.trim();
        if (query.length < 2) {
          this.personResults = [];
          return;
        }
        searchDebounce(this, 'personTimer', async () => {
          this.personLoading = true;
          try {
            this.personResults = await this.app.searchMaintenancePeople(query);
          } catch (error) {
            this.error = (error && error.message) || T('ui.maintenance.error.search_people');
          } finally {
            this.personLoading = false;
          }
        });
      },
      choosePerson(person) {
        this.responsible = person;
        this.form.responsiblePersonId = person.id;
        this.personResults = [];
        this.personQuery = '';
      },
      clearPerson() {
        this.responsible = null;
        this.form.responsiblePersonId = '';
        this.personQuery = '';
        this.personResults = [];
      },
      async load() {
        this.error = '';
        this.loading = true;
        this.tasksText = '';
        this.plan = null;
        this.responsible = null;
        this.personQuery = '';
        this.personResults = [];
        await this.app.loadAssetMaintenanceWork(this.assetId);
        await this.app.loadMaintenanceTemplates({ reset: true });
        this.templates = this.app.maintenanceTemplates || [];
        const work = this.app.maintenanceAssetWork;
        const plans = work && work.assetId === this.assetId ? work.plans.items : [];
        this.plan = plans.find((plan) => plan.status !== 'cancelled') || plans[0] || null;
        const source = this.plan || {};
        this.form = {
          maintenanceType: source.maintenanceType || 'preventivo',
          intervalMonths: source.intervalMonths || 6,
          dueOn: Engine.toDay(source.dueOn) || '',
          responsiblePersonId: source.responsiblePersonId || ''
        };
        this.responsible = source.responsiblePersonId
          ? { id: source.responsiblePersonId, label: source.responsibleLabel || source.responsibleName || source.responsiblePersonId }
          : null;
        this.tasksText = (source.tasks || []).join('\n');
        this.loading = false;
      },
      applyTemplate(id) {
        const template = this.templates.find((item) => item.id === id);
        if (!template) return;
        this.form.maintenanceType = template.maintenanceType;
        this.form.intervalMonths = template.intervalMonths || this.form.intervalMonths;
        this.form.responsiblePersonId = template.responsiblePersonId || this.form.responsiblePersonId;
        this.tasksText = (template.tasks || []).join('\n');
      },
      async save() {
        if (!this.form.intervalMonths || this.form.intervalMonths < 1) {
          this.error = T('ui.maintenance.settings.error_interval');
          return;
        }
        this.saving = true;
        this.error = '';
        const tasks = this.tasksText.split('\n').map((line) => line.trim()).filter(Boolean);
        const payload = {
          intervalMonths: Number(this.form.intervalMonths),
          tasks,
          responsiblePersonId: this.form.responsiblePersonId || null,
          dueOn: this.form.dueOn || undefined
        };
        const result = this.plan
          ? await this.app.updateMaintenancePlan(this.plan.id, payload)
          : await this.app.saveMaintenancePlan(Object.assign({ assetId: this.assetId, maintenanceType: this.form.maintenanceType }, payload));
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.dialog.error_save_plan');
          return;
        }
        this.app.showToast(this.plan ? T('ui.maintenance.dialog.plan_updated') : T('ui.maintenance.dialog.plan_created'));
        this.$emit('saved', result);
        this.$emit('close');
      },
      async cancelPlan() {
        if (!this.plan) return;
        this.saving = true;
        this.error = '';
        const result = await this.app.cancelMaintenancePlan(this.plan.id, { notes: '' });
        this.saving = false;
        if (!result.ok) {
          this.error = result.error || T('ui.maintenance.dialog.error_cancel_plan');
          return;
        }
        this.app.showToast(T('ui.maintenance.dialog.plan_cancelled'));
        this.$emit('saved', result);
        this.$emit('close');
      },
      close() {
        this.$emit('close');
      },
      fmtDay
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.maintenance.dialog.plan_title')" :eyebrow="$t('ui.maintenance.dialog.plan_eyebrow')" size="wide" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <div v-if="loading" class="cell-muted">{{ $t('ui.maintenance.dialog.loading_plan') }}</div>
        <div v-else class="form-grid form-grid--two">
          <p class="field field--span cell-muted">{{ $t('ui.maintenance.dialog.asset_scope', { asset: (asset.quickCode ? asset.quickCode + ' · ' : '') + asset.name }) }}</p>
          <label v-if="!plan" class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.dialog.category_template') }}</span>
            <span class="select-field">
              <select data-maint-field="template" @change="applyTemplate($event.target.value)">
                <option value="">{{ $t('ui.maintenance.dialog.no_template') }}</option>
                <option v-for="template in availableTemplates" :key="template.id" :value="template.id">{{ $t('ui.maintenance.dialog.template_option', { name: template.label, count: template.intervalMonths }) }}</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.type') }}</span>
            <span class="select-field">
              <select v-model="form.maintenanceType" :disabled="!!plan" data-maint-field="maintenanceType">
                <option v-for="type in typeOptions" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.interval') }}</span>
            <input v-model.number="form.intervalMonths" type="number" min="1" max="60" class="input-shell input-shell--plain" data-maint-field="intervalMonths">
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.dialog.next_due_optional') }}</span>
            <input v-model="form.dueOn" type="date" class="input-shell input-shell--plain">
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.maintenance.field.responsible') }}</span>
            <div class="maint-picker" data-maint-picker="responsible">
              <input v-model="personQuery" type="search" class="input-shell input-shell--plain maint-picker__search" :placeholder="$t('ui.maintenance.field.search_directory')" data-maint-field="responsible" @input="searchPeople">
              <span v-if="responsible" class="maint-picker__value">{{ responsibleName() }}</span>
              <span v-else class="maint-picker__value">{{ $t('ui.maintenance.unassigned') }}</span>
              <button v-if="responsible" type="button" class="text-button text-button--quiet" @click="clearPerson">{{ $t('ui.maintenance.field.remove') }}</button>
              <ul v-if="personResults.length" class="maint-picker__results">
                <li v-for="person in personResults" :key="person.id">
                  <button type="button" class="maint-picker__option" @click="choosePerson(person)">{{ person.label || person.name }}</button>
                </li>
              </ul>
              <span v-if="personLoading" class="cell-muted">{{ $t('ui.maintenance.searching') }}</span>
            </div>
          </label>
          <label class="field field--span">
            <span class="field__label">{{ $t('ui.maintenance.field.tasks') }} <span class="cell-muted">{{ $t('ui.maintenance.field.tasks_hint') }}</span></span>
            <textarea v-model="tasksText" rows="5" class="input-shell input-shell--plain" data-maint-field="tasks"></textarea>
          </label>
          <p v-if="plan" class="field field--span cell-muted">{{ $t('ui.maintenance.dialog.last_preventive', { date: fmtDay(plan.lastCompletedOn), status: planStatusLabel(plan.status) }) }}</p>
        </div>
        <template #footer>
          <button v-if="plan" type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="cancelPlan">{{ $t('ui.maintenance.dialog.cancel_plan') }}</button>
          <button type="button" class="btn btn--ghost btn--small" :disabled="saving" @click="close">{{ $t('ui.common.close') }}</button>
          <button type="button" class="btn btn--primary btn--small" data-od-id="asset-plan-save" :disabled="saving || loading" @click="save">{{ saving ? $t('ui.maintenance.saving') : (plan ? $t('ui.maintenance.dialog.save_plan') : $t('ui.maintenance.dialog.create_plan')) }}</button>
        </template>
      </modal-shell>
    `
  };
})();
