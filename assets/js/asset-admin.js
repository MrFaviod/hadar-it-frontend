(function () {
  'use strict';

  const Schema = window.AssetSchema;
  const Store = window.AssetStore;

  // Visible copy comes from the catalog. A retirement reason has two faces: the
  // stable id (`end_of_life`) that the select binds, and the localized text that
  // a record stores and a reader sees. The id never changes with the locale.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime && typeof runtime.t === 'function' ? runtime.t(key, params) : '';
  }

  const RETIRE_REASON_KEYS = [
    'ui.asset.admin.retire_reason.end_of_life',
    'ui.asset.admin.retire_reason.irreparable',
    'ui.asset.admin.retire_reason.theft',
    'ui.asset.admin.retire_reason.renewal',
    'ui.asset.admin.retire_reason.other'
  ];

  // `ui.asset.admin.retire_reason.theft` -> `theft`.
  function retireReasonId(key) {
    const value = String(key === null || key === undefined ? '' : key);
    const index = value.lastIndexOf('.');
    return index < 0 ? value : value.slice(index + 1);
  }

  // Stored records keep free text. A value that matches a known id is resolved
  // through the catalog so an id written by a newer client still reads correctly.
  function retireReasonLabel(value) {
    const raw = String(value === null || value === undefined ? '' : value);
    const key = RETIRE_REASON_KEYS.find((entry) => retireReasonId(entry) === raw);
    return key ? tr(key) : raw;
  }

  function blankEditor() {
    return {
      open: false,
      mode: 'create',
      id: '',
      advancedOpen: false,
      category: '',
      error: '',
      saving: false,
      draft: Schema.newAsset(Schema.defaultAdmin(), window.ASSET_DATA ? window.ASSET_DATA.categories : [])
    };
  }

  function blankStatusDialog() {
    return { open: false, mode: 'create', id: '', label: '', tone: 'ok', final: false };
  }

  function blankFieldDialog() {
    return { open: false, mode: 'create', key: '', label: '', type: 'text', unit: '', options: '', hint: '' };
  }

  function blankRetireDialog() {
    return { open: false, assetId: '', reason: retireReasonId(RETIRE_REASON_KEYS[0]), note: '', acknowledged: false };
  }

  function blankDeleteDialog() {
    return { open: false, assetId: '', typed: '', reason: '' };
  }

  window.AssetAdminMethods = {
    // ---------------------------------------------------------------- helpers
    assetForm(categoryId) {
      return Schema.formFor(this.assetAdmin, categoryId);
    },
    assetTechFields(categoryId) {
      return Schema.techFields(this.assetAdmin, categoryId);
    },
    assetCommonField(key) {
      return Schema.COMMON_FIELDS.find((field) => field.key === key) || null;
    },
    assetFormKeys(bucket, categoryId) {
      const form = this.assetForm(categoryId);
      const list = bucket === 'quick' ? form.quick : form.advanced;
      return list.filter((key) => key !== 'image' && key !== 'warranty' && key !== 'category');
    },
    assetStatusLabel(id) {
      return Schema.statusById(this.assetAdmin, id).label;
    },
    assetFieldLabel(key) {
      const field = this.assetAdmin.fields.find((item) => item.key === key);
      return field ? field.label : key;
    },
    assetFieldValue(asset, field) {
      const value = asset.tech ? asset.tech[field.key] : '';
      if (field.type === 'boolean') {
        if (value === true) return tr('ui.asset.editor.yes');
        return value === false ? tr('ui.asset.editor.no') : '—';
      }
      if (value === '' || value === undefined || value === null) return '—';
      return field.unit ? value + ' ' + field.unit : String(value);
    },
    assetGaps(asset) {
      return Schema.gaps(asset, this.assetAdmin);
    },
    assetDate(value) {
      return Schema.formatDate(value);
    },
    assetDateTime(value) {
      return Schema.formatDateTime(value);
    },
    assetWarrantyState(asset) {
      if (!asset || !asset.warranty || !asset.warranty.until) return { label: tr('ui.asset.admin.warranty_none'), tone: 'hold' };
      const days = Math.round((Date.parse(asset.warranty.until + 'T12:00:00') - Date.now()) / 86400000);
      if (days < 0) return { label: tr('ui.asset.admin.warranty_expired'), tone: 'down' };
      if (days <= 60) return { label: tr('ui.asset.admin.warranty_expiring', { days: days }), tone: 'warn' };
      return { label: tr('ui.asset.admin.warranty_active', { date: Schema.formatDate(asset.warranty.until) }), tone: 'ok' };
    },
    assetSiteLocations(siteId) {
      const site = this.sites.find((item) => item.id === siteId);
      return site && Array.isArray(site.locations) ? site.locations : [];
    },
    assetActivePeople() {
      return this.people.filter((person) => person.active);
    },
    assetNextCode(categoryId, siteId, ignoreId) {
      const site = this.sites.find((item) => item.id === siteId) || siteId;
      return Schema.nextCode(this.assets, categoryId, site, this.assetAdmin, ignoreId || '');
    },
    assetQuickPreview() {
      const category = this.categories.find((item) => this.assetAdmin.forms[item.id]);
      if (!category) return '—';
      const site = this.sites[0];
      return Schema.nextCode(this.assets, category.id, site ? site.id : '', this.assetAdmin, '');
    },
    assetIsRetired(asset) {
      return !!(asset && asset.retired);
    },
    assetFinalStatus() {
      return this.assetAdmin.statuses.find((status) => status.final) || this.assetAdmin.statuses[0];
    },
    assetStatusOptions() {
      return this.assetAdmin.statuses.filter((status) => !status.final);
    },
    toggleAssetAdvanced() {
      this.assetEditor.advancedOpen = !this.assetEditor.advancedOpen;
    },
    assetFieldTypeLabel(type) {
      const entry = Schema.FIELD_TYPES.find((item) => item.value === type);
      return entry ? entry.label : tr('ui.asset.schema.type.text');
    },
    assetFieldUsage(field) {
      return Object.keys(this.assetAdmin.forms).filter((categoryId) => {
        return this.assetAdmin.forms[categoryId].tech.indexOf(field.key) !== -1;
      }).length;
    },
    assetStatusUsage(status) {
      return this.assets.filter((asset) => asset.statusId === status.id).length;
    },
    assetToneLabel(tone) {
      return Schema.TONE_LABELS[tone] || tr('ui.asset.field.unassigned');
    },
    assetFormTypes() {
      return Object.keys(this.assetAdmin.forms).map((key) => this.assetAdmin.forms[key].type);
    },

    // ------------------------------------------------------------ persistence
    assetActor() {
      if (window.AssetOpsEngine && typeof window.AssetOpsEngine.actorOf === 'function') {
        return window.AssetOpsEngine.actorOf(this);
      }
      return this.currentUser && this.currentUser.name ? this.currentUser.name : tr('ui.operations.actor.administrator');
    },
    persistAssets() {
      const saved = Store.writeJSON(window.localStorage, Store.KEYS.assets, this.assets);
      if (!saved) this.showToast(tr('ui.asset.admin.error_save_assets'), 'error');
      return saved;
    },
    persistAssetAdmin() {
      const saved = Store.writeJSON(window.localStorage, Store.KEYS.assetAdmin, this.assetAdmin);
      if (!saved) this.showToast(tr('ui.asset.admin.error_save_config'), 'error');
      return saved;
    },

    // ---------------------------------------------------------------- editor
    openAssetCreate() {
      const category = this.prefs.category !== 'all' ? this.prefs.category : (this.categories[0] ? this.categories[0].id : 'otros');
      const draft = Schema.newAsset(this.assetAdmin, this.categories);
      draft.category = category;
      draft.type = this.assetForm(category).type;
      draft.statusId = (this.assetStatusOptions()[0] || this.assetFinalStatus()).id;
      if (this.prefs.site && this.prefs.site !== 'all') {
        const site = this.sites.find((item) => item.id === this.prefs.site);
        if (site) {
          draft.site = site.id;
          draft.locationId = site.locations && site.locations[0] ? site.locations[0].id : '';
        }
      }
      this.assetEditor = Object.assign(blankEditor(), {
        open: true,
        mode: 'create',
        category,
        draft
      });
      this.assetEditorErrors = {};
    },
    openAssetEdit(asset) {
      if (!asset) return;
      const draft = Store.clone(asset);
      draft.warranty = draft.warranty || { until: '', provider: '', note: '' };
      this.assetEditor = Object.assign(blankEditor(), {
        open: true,
        mode: 'edit',
        id: asset.id,
        category: draft.category,
        draft
      });
      this.assetEditorErrors = {};
    },
    openAssetDuplicate(asset) {
      if (!asset) return;
      const draft = Store.clone(asset);
      draft.id = '';
      draft.code = '';
      draft.name = tr('ui.asset.admin.copy_name', { name: asset.name });
      draft.retired = null;
      draft.history = [];
      draft.statusId = this.assetStatusOptions()[0] ? this.assetStatusOptions()[0].id : draft.statusId;
      draft.warranty = draft.warranty || { until: '', provider: '', note: '' };
      this.assetEditor = Object.assign(blankEditor(), {
        open: true,
        mode: 'create',
        category: draft.category,
        draft
      });
      this.assetEditorErrors = {};
      this.showToast(tr('ui.asset.admin.toast_duplicated'));
    },
    closeAssetEditor() {
      if (this.assetEditor.saving) return;
      this.assetEditor = blankEditor();
      this.assetEditorErrors = {};
    },
    applyAssetCategory(categoryId) {
      const draft = this.assetEditor.draft;
      const known = this.assetFormTypes();
      const replaceable = !draft.type || known.indexOf(draft.type) !== -1;
      draft.category = categoryId;
      this.assetEditor.category = categoryId;
      if (replaceable) draft.type = this.assetForm(categoryId).type;
      draft.tech = draft.tech || {};
    },
    applyAssetSite(siteId) {
      const draft = this.assetEditor.draft;
      draft.site = siteId;
      const locations = this.assetSiteLocations(siteId);
      if (!locations.some((item) => item.id === draft.locationId)) draft.locationId = '';
    },
    assetTechValue(field) {
      const tech = this.assetEditor.draft.tech || {};
      const value = tech[field.key];
      return field.type === 'boolean' ? value === true : (value === undefined || value === null ? '' : value);
    },
    setAssetTechValue(field, value) {
      if (!this.assetEditor.draft.tech) this.assetEditor.draft.tech = {};
      this.assetEditor.draft.tech[field.key] = value;
    },
    assetPhotoPresets() {
      return this.deviceImagePresets || [];
    },
    applyAssetImage(preset) {
      this.assetEditor.draft.image = preset.src;
      this.assetEditor.draft.hasOwnImage = false;
    },
    handleAssetPhoto(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      this.readImageFile(file, (dataUrl) => {
        this.assetEditor.draft.image = dataUrl;
        this.assetEditor.draft.hasOwnImage = true;
      }, (message) => {
        this.assetEditorErrors = Object.assign({}, this.assetEditorErrors, { image: message });
      });
      event.target.value = '';
    },
    removeAssetPhoto() {
      const draft = this.assetEditor.draft;
      const category = this.categories.find((item) => item.id === draft.category);
      draft.image = category ? category.image : 'assets/svg/devices/other.svg';
      draft.hasOwnImage = false;
    },
    handleAssetFov(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      this.readImageFile(file, (dataUrl) => {
        this.assetEditor.draft.fovImage = dataUrl;
      }, (message) => {
        this.assetEditorErrors = Object.assign({}, this.assetEditorErrors, { fov: message });
      });
      event.target.value = '';
    },
    removeAssetFov() {
      this.assetEditor.draft.fovImage = '';
    },
    applyAssetWarrantyPreset(months) {
      const draft = this.assetEditor.draft;
      const base = new Date();
      base.setMonth(base.getMonth() + months);
      draft.warranty = Object.assign({ until: '', provider: '', note: '' }, draft.warranty, {
        until: base.toISOString().slice(0, 10)
      });
    },

    validateAssetDraft(draft) {
      const errors = {};
      if (!Schema.text(draft.name)) errors.name = tr('ui.asset.admin.error_name_required');
      if (!draft.category) errors.category = tr('ui.asset.admin.error_category_required');
      if (draft.ip && !/^[0-9a-zA-Z.:-]+$/.test(draft.ip.trim())) {
        errors.ip = tr('ui.asset.admin.error_ip');
      }
      if (draft.cost !== '' && draft.cost !== null && !(Number(draft.cost) >= 0)) {
        errors.cost = tr('ui.asset.admin.error_cost');
      }
      const warranty = draft.warranty || {};
      if (warranty.until && !Schema.isoDate(warranty.until)) {
        errors.warranty = tr('ui.asset.admin.error_warranty_date');
      }
      if (warranty.until && draft.createdAt && Schema.isoDate(warranty.until) < Schema.isoDate(draft.createdAt)) {
        errors.warranty = tr('ui.asset.admin.error_warranty_before_created');
      }
      return errors;
    },
    saveAsset() {
      const draft = this.assetEditor.draft;
      const errors = this.validateAssetDraft(draft);
      this.assetEditorErrors = errors;
      if (Object.keys(errors).length) {
        this.assetEditor.error = tr('ui.asset.admin.error_review_fields');
        return;
      }
      const isCreate = this.assetEditor.mode === 'create';
      const site = this.sites.find((item) => item.id === draft.site);
      const location = site && Array.isArray(site.locations)
        ? site.locations.find((item) => item.id === draft.locationId)
        : null;
      const person = this.people.find((item) => item.id === draft.assigneeId);
      const status = Schema.statusById(this.assetAdmin, draft.statusId);
      const category = this.categories.find((item) => item.id === draft.category);

      if (isCreate) {
        const id = Schema.nextPermanentId(this.assets, this.assetAdmin);
        const code = this.assetNextCode(draft.category, draft.site, '');
        this.assetAdmin.sequence = Schema.number(id.replace(/\D/g, ''), this.assetAdmin.sequence);
        const asset = Object.assign({}, draft, {
          id,
          code,
          name: Schema.text(draft.name),
          cost: Number(draft.cost) || 0,
          site: draft.site || '',
          locationId: location ? location.id : '',
          location: location ? location.label : '',
          assigneeId: person ? person.id : '',
          assignee: person ? person.name : '',
          statusId: status.id,
          status: status.label,
          statusTone: status.tone,
          image: draft.image || (category ? category.image : 'assets/svg/devices/other.svg'),
          warranty: Schema.normalizeWarranty(draft.warranty),
          retired: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [Schema.historyEntry('created', tr('ui.asset.detail.created'), tr('ui.asset.admin.history_created_detail', {
            category: category ? category.label : tr('ui.asset.admin.asset_fallback')
          }), {
            actor: this.assetActor(),
            movement: 'created',
            effectiveAt: new Date().toISOString()
          })]
        });
        this.assets.unshift(asset);
        this.persistAssets();
        this.persistAssetAdmin();
        this.persistAssignments();
        this.closeAssetEditor();
        this.showToast(tr('ui.asset.admin.toast_created', { id: id }));
        this.openAsset(asset);
        return;
      }

      const asset = this.assets.find((item) => item.id === this.assetEditor.id);
      if (!asset) {
        this.assetEditor.error = tr('ui.asset.admin.error_asset_missing');
        return;
      }
      const before = Store.clone(asset);
      asset.name = Schema.text(draft.name);
      asset.category = draft.category;
      asset.type = Schema.text(draft.type, this.assetForm(draft.category).type);
      asset.brand = Schema.text(draft.brand);
      asset.model = Schema.text(draft.model);
      asset.serial = Schema.text(draft.serial);
      asset.ip = Schema.text(draft.ip);
      asset.site = draft.site || '';
      asset.locationId = location ? location.id : '';
      asset.location = location ? location.label : '';
      asset.assigneeId = person ? person.id : '';
      asset.assignee = person ? person.name : '';
      asset.cost = Number(draft.cost) || 0;
      asset.statusId = status.id;
      asset.status = status.label;
      asset.statusTone = status.tone;
      asset.tech = draft.tech || {};
      asset.warranty = Schema.normalizeWarranty(draft.warranty);
      asset.anydeskId = Schema.text(draft.anydeskId);
      asset.rmmAgentId = Schema.text(draft.rmmAgentId);
      if (draft.image) {
        asset.image = draft.image;
        asset.hasOwnImage = !!draft.hasOwnImage;
      }
      asset.fovImage = Schema.text(draft.fovImage);
      if (before.category !== asset.category || before.site !== asset.site) {
        const recalculated = this.assetNextCode(asset.category, asset.site, asset.id);
        if (recalculated !== asset.code) {
          const codeDetail = before.site !== asset.site
            ? tr('ui.asset.admin.history_code_site', { before: before.code, after: recalculated })
            : tr('ui.asset.admin.history_code_type', { before: before.code, after: recalculated });
          asset.history.unshift(Schema.historyEntry('code', tr('ui.asset.admin.history_code_title'), codeDetail, {
            actor: this.assetActor(),
            movement: 'code',
            changes: [{ field: 'code', label: tr('ui.asset.common.quick_code'), before: before.code, after: recalculated }]
          }));
          asset.code = recalculated;
        }
      }
      if (before.status !== asset.status) {
        asset.history.unshift(Schema.historyEntry('status', tr('ui.asset.admin.history_status_title'), tr('ui.asset.admin.history_status_detail', { before: before.status, after: asset.status }), {
          actor: this.assetActor(),
          movement: 'status',
          changes: [{ field: 'statusId', label: tr('ui.asset.common.status'), before: before.status, after: asset.status }]
        }));
      }
      if ((before.assigneeId || '') !== (asset.assigneeId || '')) {
        const unassigned = tr('ui.asset.field.unassigned');
        asset.history.unshift(Schema.historyEntry('assigned', tr('ui.asset.admin.history_assignee_title'), tr('ui.asset.admin.history_assignee_detail', {
          before: before.assignee || unassigned,
          after: asset.assignee || unassigned
        }), {
          actor: this.assetActor(),
          movement: 'assigned',
          changes: [{ field: 'assigneeId', label: tr('ui.asset.common.responsible'), before: before.assignee || unassigned, after: asset.assignee || unassigned }]
        }));
      }
      const touched = ['name', 'brand', 'model', 'serial', 'ip', 'cost', 'warranty', 'tech'].filter((key) => {
        return JSON.stringify(before[key] || '') !== JSON.stringify(asset[key] || '');
      });
      if (touched.length) {
        const labels = touched.slice(0, 4).map((key) => {
          if (key === 'tech') return tr('ui.asset.admin.fields_group_lower');
          if (key === 'warranty') return tr('ui.asset.admin.warranty_lower');
          return this.assetCommonField(key) ? this.assetCommonField(key).label.toLocaleLowerCase(window.ItsmI18n && window.ItsmI18n.activeLocale ? window.ItsmI18n.activeLocale : 'es') : key;
        });
        const changes = touched.map((key) => {
          if (key === 'tech') {
            return {
              field: 'tech',
              label: tr('ui.asset.admin.fields_group'),
              before: tr('ui.asset.admin.values_before'),
              after: tr('ui.asset.admin.values_after')
            };
          }
          if (key === 'warranty') {
            const none = tr('ui.asset.admin.warranty_unset');
            const until = asset.warranty && asset.warranty.until ? asset.warranty.until : none;
            const previous = before.warranty && before.warranty.until ? before.warranty.until : none;
            return { field: 'warranty', label: tr('ui.asset.schema.field.warranty'), before: previous, after: until };
          }
          const label = this.assetCommonField(key) ? this.assetCommonField(key).label : key;
          return {
            field: key,
            label: label,
            before: String(before[key] === '' || before[key] === undefined ? tr('ui.asset.admin.value_empty') : before[key]),
            after: String(asset[key] === '' || asset[key] === undefined ? tr('ui.asset.admin.value_empty') : asset[key])
          };
        });
        asset.history.unshift(Schema.historyEntry('updated', tr('ui.asset.admin.history_updated_title'), tr('ui.asset.admin.history_updated_detail', { list: labels.join(', ') }), {
          actor: this.assetActor(),
          movement: 'updated',
          changes: changes
        }));
      }
      asset.updatedAt = new Date().toISOString();
      asset.history = asset.history.slice(0, 200);
      this.persistAssets();
      this.persistAssignments();
      this.closeAssetEditor();
      this.showToast(tr('ui.asset.admin.toast_updated', { id: asset.id }));
      if (this.route.name !== 'detail' || this.route.assetId !== asset.id) this.openAsset(asset);
    },

    // -------------------------------------------------------------- duplicate
    duplicateAsset(asset) {
      if (!asset) return;
      this.openAssetDuplicate(asset);
    },

    // ----------------------------------------------------------------- status
    openStatusDialog(asset, statusId) {
      if (!asset) return;
      this.statusDialog = {
        open: true,
        assetId: asset.id,
        statusId: statusId || (this.assetStatusOptions()[0] || this.assetFinalStatus()).id,
        note: ''
      };
      this.statusDialogError = '';
    },
    closeStatusDialog() {
      this.statusDialog = { open: false, assetId: '', statusId: '', note: '' };
      this.statusDialogError = '';
    },
    confirmStatusChange() {
      const dialog = this.statusDialog;
      const asset = this.assets.find((item) => item.id === dialog.assetId);
      const status = Schema.statusById(this.assetAdmin, dialog.statusId);
      if (!asset || !status) {
        this.statusDialogError = tr('ui.asset.admin.error_status_missing');
        return;
      }
      if (status.final) {
        this.closeStatusDialog();
        this.openRetireDialog(asset);
        return;
      }
      if (asset.statusId === status.id && !dialog.note.trim()) {
        this.closeStatusDialog();
        return;
      }
      const before = asset.status;
      asset.statusId = status.id;
      asset.status = status.label;
      asset.statusTone = status.tone;
      asset.updatedAt = new Date().toISOString();
      const changes = [{ field: 'statusId', label: tr('ui.asset.common.status'), before: before, after: status.label }];
      if (dialog.note.trim()) changes.push({ field: 'note', label: tr('ui.asset.admin.change_note'), before: '', after: dialog.note.trim() });
      asset.history.unshift(Schema.historyEntry('status', tr('ui.asset.admin.history_status_title'), tr(dialog.note.trim() ? 'ui.asset.admin.history_status_note' : 'ui.asset.admin.history_status_detail', {
        before: before,
        after: status.label,
        note: dialog.note.trim()
      }), {
        actor: this.assetActor(),
        movement: 'status',
        changes: changes
      }));
      this.persistAssets();
      this.closeStatusDialog();
      this.showToast(tr('ui.asset.admin.toast_status', { status: status.label }));
    },

    // ------------------------------------------------------------------- baja
    // Resolves a retirement reason for display: a known id becomes the current
    // label, any other stored value is shown exactly as it was saved.
    retireReasonText(value) {
      return retireReasonLabel(value);
    },
    openRetireDialog(asset) {
      if (!asset) return;
      this.retireDialog = Object.assign(blankRetireDialog(), { open: true, assetId: asset.id });
      this.retireDialogError = '';
    },
    closeRetireDialog() {
      this.retireDialog = blankRetireDialog();
      this.retireDialogError = '';
    },
    confirmRetire() {
      const dialog = this.retireDialog;
      const asset = this.assets.find((item) => item.id === dialog.assetId);
      if (!asset) {
        this.retireDialogError = tr('ui.asset.admin.error_asset_missing');
        return;
      }
      if (!dialog.acknowledged) {
        this.retireDialogError = tr('ui.asset.admin.error_ack_required');
        return;
      }
      const finalStatus = this.assetFinalStatus();
      const note = dialog.note.trim();
      const reason = this.retireReasonText(dialog.reason);
      asset.retired = {
        at: new Date().toISOString(),
        reason,
        note
      };
      asset.statusId = finalStatus.id;
      asset.status = finalStatus.label;
      asset.statusTone = finalStatus.tone;
      asset.assigneeId = '';
      asset.assignee = '';
      asset.updatedAt = new Date().toISOString();
      const retireChanges = [{ field: 'statusId', label: tr('ui.asset.common.status'), before: asset.status, after: finalStatus.label }];
      if (asset.assignee) retireChanges.push({ field: 'assigneeId', label: tr('ui.asset.common.responsible'), before: asset.assignee, after: tr('ui.asset.field.unassigned') });
      retireChanges.push({
        field: 'retired',
        label: tr('ui.asset.admin.change_retention'),
        before: tr('ui.asset.admin.retention_before'),
        after: tr('ui.asset.admin.retention_after')
      });
      asset.history.unshift(Schema.historyEntry('retired', tr('ui.operations.movement.retired.title'), tr(note ? 'ui.asset.admin.history_retired_note' : 'ui.asset.admin.history_retired_detail', {
        reason,
        note: note
      }), {
        actor: this.assetActor(),
        movement: 'retired',
        changes: retireChanges
      }));
      this.persistAssets();
      this.persistAssignments();
      this.closeRetireDialog();
      this.showToast(tr('ui.asset.admin.toast_retired'));
    },
    restoreAsset(asset) {
      if (!asset || !asset.retired) return;
      const statuses = this.assetStatusOptions();
      const target = statuses.find((status) => status.id === 'resguardo') || statuses[0];
      asset.retired = null;
      asset.statusId = target.id;
      asset.status = target.label;
      asset.statusTone = target.tone;
      asset.updatedAt = new Date().toISOString();
      asset.history.unshift(Schema.historyEntry('restored', tr('ui.asset.admin.history_restored_title'), tr('ui.asset.admin.history_restored_detail', { status: target.label }), {
        actor: this.assetActor(),
        movement: 'restored',
        changes: [{ field: 'statusId', label: tr('ui.asset.common.status'), before: tr('ui.asset.schema.status.retired'), after: target.label }]
      }));
      this.persistAssets();
      this.showToast(tr('ui.asset.admin.toast_restored', { status: target.label }));
    },

    // --------------------------------------------------------------- deletion
    openDeleteAsset(asset) {
      if (!asset) return;
      this.deleteDialog = Object.assign(blankDeleteDialog(), { open: true, assetId: asset.id });
      this.deleteDialogError = '';
    },
    closeDeleteAsset() {
      this.deleteDialog = blankDeleteDialog();
      this.deleteDialogError = '';
    },
    deleteAssetIsProtected() {
      return this.assetAdmin.operations.mode === 'production';
    },
    confirmDeleteAsset() {
      const dialog = this.deleteDialog;
      const asset = this.assets.find((item) => item.id === dialog.assetId);
      if (!asset) {
        this.closeDeleteAsset();
        return;
      }
      if (this.deleteAssetIsProtected()) {
        if (dialog.typed.trim() !== asset.id) {
          this.deleteDialogError = tr('ui.asset.admin.error_typed_id', { id: asset.id });
          return;
        }
        if (dialog.reason.trim().length < 4) {
          this.deleteDialogError = tr('ui.asset.admin.error_delete_reason');
          return;
        }
      }
      const index = this.assets.findIndex((item) => item.id === asset.id);
      if (index === -1) {
        this.closeDeleteAsset();
        return;
      }
      this.assets.splice(index, 1);
      this.persistAssets();
      this.persistAssignments();
      if (this.bulk && Array.isArray(this.bulk.ids)) {
        this.bulk.ids = this.bulk.ids.filter((id) => id !== asset.id);
      }
      this.closeDeleteAsset();
      if (this.route.name === 'detail' && this.route.assetId === asset.id) this.setHash('#/inventario');
      this.showToast(tr('ui.asset.admin.toast_deleted', { id: asset.id }));
    },

    // ------------------------------------------------------- asset admin: campos
    assetFieldOptionsText(field) {
      return Array.isArray(field.options) ? field.options.join(', ') : '';
    },
    openAssetField(field) {
      this.fieldDialog = Object.assign(blankFieldDialog(), field ? {
        open: true,
        mode: 'edit',
        key: field.key,
        label: field.label,
        type: field.type,
        unit: field.unit || '',
        options: this.assetFieldOptionsText(field),
        hint: field.hint || ''
      } : { open: true, mode: 'create' });
      this.fieldDialogErrors = {};
    },
    closeAssetField() {
      this.fieldDialog = blankFieldDialog();
      this.fieldDialogErrors = {};
    },
    saveAssetField() {
      const dialog = this.fieldDialog;
      const errors = {};
      if (!Schema.text(dialog.label)) errors.label = tr('ui.asset.admin.error_field_label');
      const key = Schema.slug(dialog.key || dialog.label, 'campo');
      const duplicate = this.assetAdmin.fields.some((field) => field.key === key && field.key !== dialog.key);
      if (duplicate) errors.label = tr('ui.asset.admin.error_field_key');
      if (dialog.type === 'select' && !Schema.text(dialog.options)) {
        errors.options = tr('ui.asset.admin.error_field_options');
      }
      this.fieldDialogErrors = errors;
      if (Object.keys(errors).length) return;
      const payload = {
        key: dialog.mode === 'edit' ? dialog.key : key,
        label: Schema.text(dialog.label),
        type: dialog.type,
        unit: Schema.text(dialog.unit),
        hint: Schema.text(dialog.hint),
        options: dialog.type === 'select'
          ? dialog.options.split(',').map((item) => item.trim()).filter(Boolean)
          : []
      };
      if (dialog.mode === 'edit') {
        const field = this.assetAdmin.fields.find((item) => item.key === dialog.key);
        if (field) Object.assign(field, payload);
        if (field && dialog.key !== key) {
          Object.keys(this.assetAdmin.forms).forEach((categoryId) => {
            const form = this.assetAdmin.forms[categoryId];
            form.tech = form.tech.map((item) => (item === dialog.key ? key : item));
          });
          this.assets.forEach((asset) => {
            if (!asset.tech || asset.tech[dialog.key] === undefined) return;
            asset.tech[key] = asset.tech[dialog.key];
            delete asset.tech[dialog.key];
          });
        }
      } else {
        this.assetAdmin.fields.push(payload);
      }
      this.persistAssetAdmin();
      this.persistAssets();
      this.closeAssetField();
      this.showToast(tr('ui.asset.admin.toast_field_saved'));
    },
    requestDeleteAssetField(field) {
      const used = Object.keys(this.assetAdmin.forms).filter((categoryId) => this.assetAdmin.forms[categoryId].tech.indexOf(field.key) !== -1);
      const categories = used.map((id) => {
        const category = this.categories.find((item) => item.id === id);
        return category ? category.label : id;
      });
      this.confirmDialog = {
        open: true,
        kind: 'delete-asset-field',
        title: tr('ui.asset.admin.delete_field_title'),
        message: tr('ui.asset.admin.delete_field_message', { label: field.label }),
        detail: categories.length
          ? tr('ui.asset.admin.delete_field_detail', { list: categories.join(', ') })
          : tr('ui.asset.admin.delete_field_unused'),
        confirmLabel: tr('ui.asset.admin.delete_field_action'),
        fieldKey: field.key,
        statusId: '',
        categoryId: '',
        siteId: '',
        locationId: '',
        departmentId: ''
      };
    },

    applyAssetAdminConfirm(kind) {
      const dialog = this.confirmDialog;
      if (kind === 'delete-asset-field') {
        const key = dialog.fieldKey;
        this.assetAdmin.fields = this.assetAdmin.fields.filter((field) => field.key !== key);
        Object.keys(this.assetAdmin.forms).forEach((categoryId) => {
          const form = this.assetAdmin.forms[categoryId];
          form.tech = form.tech.filter((item) => item !== key);
        });
        this.assets.forEach((asset) => {
          if (asset.tech) delete asset.tech[key];
        });
        this.persistAssetAdmin();
        this.persistAssets();
        this.closeConfirm();
        this.showToast(tr('ui.asset.admin.toast_field_deleted'));
        return true;
      }
      if (kind === 'delete-asset-status') {
        this.assetAdmin.statuses = this.assetAdmin.statuses.filter((status) => status.id !== dialog.statusId);
        this.persistAssetAdmin();
        this.closeConfirm();
        this.showToast(tr('ui.asset.admin.toast_status_deleted'));
        return true;
      }
      return false;
    },

    // ------------------------------------------------------ asset admin: estados
    openAssetStatusDialog(status) {
      this.assetStatusDialog = Object.assign(blankStatusDialog(), status ? {
        open: true,
        mode: 'edit',
        id: status.id,
        label: status.label,
        tone: status.tone,
        final: !!status.final
      } : { open: true, mode: 'create' });
      this.assetStatusErrors = {};
    },
    closeAssetStatusDialog() {
      this.assetStatusDialog = blankStatusDialog();
      this.assetStatusErrors = {};
    },
    saveAssetStatus() {
      const dialog = this.assetStatusDialog;
      const errors = {};
      if (!Schema.text(dialog.label)) errors.label = tr('ui.asset.admin.error_status_label');
      const label = Schema.text(dialog.label).toLocaleLowerCase('es');
      const duplicate = this.assetAdmin.statuses.some((status) => status.label.toLocaleLowerCase('es') === label && status.id !== dialog.id);
      if (duplicate) errors.label = tr('ui.asset.admin.error_status_duplicate');
      if (dialog.final && this.assetAdmin.statuses.some((status) => status.final && status.id !== dialog.id)) {
        errors.final = tr('ui.asset.admin.error_status_final');
      }
      this.assetStatusErrors = errors;
      if (Object.keys(errors).length) return;
      if (dialog.mode === 'edit') {
        const status = this.assetAdmin.statuses.find((item) => item.id === dialog.id);
        if (!status) return;
        if (dialog.final && !status.final) {
          this.assetAdmin.statuses.forEach((item) => { item.final = false; });
        }
        Object.assign(status, {
          label: Schema.text(dialog.label),
          tone: dialog.tone,
          final: !!dialog.final
        });
        this.assets.forEach((asset) => {
          if (asset.statusId !== status.id) return;
          asset.status = status.label;
          asset.statusTone = status.tone;
        });
      } else {
        if (dialog.final) this.assetAdmin.statuses.forEach((item) => { item.final = false; });
        this.assetAdmin.statuses.push({
          id: Schema.slug(dialog.label, 'estado'),
          label: Schema.text(dialog.label),
          tone: dialog.tone,
          final: !!dialog.final
        });
      }
      this.persistAssetAdmin();
      this.persistAssets();
      this.closeAssetStatusDialog();
      this.showToast(tr('ui.asset.admin.toast_statuses_saved'));
    },
    requestDeleteAssetStatus(status) {
      const inUse = this.assets.filter((asset) => asset.statusId === status.id).length;
      const remaining = this.assetAdmin.statuses.filter((item) => item.id !== status.id && !item.final).length;
      const blocked = inUse > 0 || remaining < 1 || this.assetAdmin.statuses.length <= 2;
      this.confirmDialog = {
        open: true,
        kind: blocked ? 'blocked-asset-status' : 'delete-asset-status',
        title: blocked ? tr('ui.asset.admin.delete_status_blocked_title') : tr('ui.asset.admin.delete_status_title'),
        message: blocked
          ? (inUse > 0
            ? tr('ui.asset.admin.delete_status_in_use', { count: inUse })
            : tr('ui.asset.admin.delete_status_last'))
          : tr('ui.asset.admin.delete_status_message', { status: status.label }),
        detail: '',
        confirmLabel: blocked ? '' : tr('ui.asset.admin.delete_status_title'),
        fieldKey: '',
        statusId: status.id,
        categoryId: '',
        siteId: '',
        locationId: '',
        departmentId: ''
      };
    },

    // ------------------------------------------------- asset admin: formularios
    openFormDraft(categoryId) {
      const form = this.assetAdmin.forms[categoryId];
      this.formDraft = { categoryId, form: Store.clone(form) };
      this.formDraftError = '';
    },
    closeFormDraft() {
      this.formDraft = null;
      this.formDraftError = '';
    },
    formFieldBucket(key) {
      if (!this.formDraft) return 'hidden';
      if (this.formDraft.form.quick.indexOf(key) !== -1) return 'quick';
      if (this.formDraft.form.advanced.indexOf(key) !== -1) return 'advanced';
      return 'hidden';
    },
    setFormFieldBucket(key, bucket) {
      if (!this.formDraft) return;
      const form = this.formDraft.form;
      form.quick = form.quick.filter((item) => item !== key);
      form.advanced = form.advanced.filter((item) => item !== key);
      if (bucket === 'quick') form.quick.push(key);
      if (bucket === 'advanced') form.advanced.push(key);
    },
    toggleFormTech(key) {
      if (!this.formDraft) return;
      const form = this.formDraft.form;
      form.tech = form.tech.indexOf(key) !== -1
        ? form.tech.filter((item) => item !== key)
        : form.tech.concat([key]);
    },
    saveFormDraft() {
      if (!this.formDraft) return;
      const draft = this.formDraft;
      if (!Schema.text(draft.form.prefix)) {
        this.formDraftError = tr('ui.asset.admin.error_prefix_required');
        return;
      }
      this.assetAdmin.forms[draft.categoryId] = Schema.normalizeForm(draft.form, draft.form);
      this.persistAssetAdmin();
      const category = this.categories.find((item) => item.id === draft.categoryId);
      this.showToast(tr('ui.asset.admin.toast_form_saved', { category: category ? category.label : tr('ui.asset.admin.asset_fallback') }));
      this.closeFormDraft();
    },

    // ---------------------------------------------- asset admin: identificación
    saveAssetIdRules() {
      const rules = this.assetIdRulesDraft;
      const errors = {};
      if (!Schema.text(rules.permanentPrefix)) errors.permanentPrefix = tr('ui.asset.admin.error_id_prefix');
      if (Schema.number(rules.permanentPad, 0) < 3 || Schema.number(rules.permanentPad, 0) > 8) {
        errors.permanentPad = tr('ui.asset.admin.error_id_pad_permanent');
      }
      if (Schema.number(rules.quickPad, 0) < 2 || Schema.number(rules.quickPad, 0) > 5) {
        errors.quickPad = tr('ui.asset.admin.error_id_pad_quick');
      }
      if (!/^[A-Za-z0-9-]{1,2}$/.test(rules.separator)) errors.separator = tr('ui.asset.admin.error_id_separator');
      this.assetIdRulesErrors = errors;
      if (Object.keys(errors).length) return;
      this.assetAdmin.idRules = Object.assign({}, this.assetAdmin.idRules, {
        permanentPrefix: rules.permanentPrefix.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        permanentPad: Schema.number(rules.permanentPad, 4),
        separator: rules.separator,
        quickPad: Schema.number(rules.quickPad, 3),
        siteCodeLength: Schema.number(rules.siteCodeLength, 3),
        includeSite: !!rules.includeSite
      });
      this.persistAssetAdmin();
      this.showToast(tr('ui.asset.admin.toast_id_rules_saved'));
    },
    resetAssetIdRules() {
      this.assetIdRulesDraft = Store.clone(Schema.ID_RULES_SEED);
      this.assetIdRulesErrors = {};
    },
    setOperationsMode(mode) {
      if (mode !== 'production' && mode !== 'development') return;
      this.assetAdmin.operations.mode = mode;
      this.persistAssetAdmin();
      this.showToast(mode === 'production'
        ? tr('ui.asset.admin.mode_production_toast')
        : tr('ui.asset.admin.mode_development_toast'));
    }
  };

  // The reasons are catalog keys; the shell resolves them where they render.
  window.AssetAdminReasons = RETIRE_REASON_KEYS;
  window.AssetAdminRetireReasons = { id: retireReasonId, label: retireReasonLabel };
})();
