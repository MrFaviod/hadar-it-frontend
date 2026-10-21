(function () {
  'use strict';

  const Schema = window.AssetSchema;
  const Store = window.AssetStore;

  const RETIRE_REASONS = [
    'Fin de vida útil',
    'Avería irreparable',
    'Robo o extravío',
    'Sustitución por renovación',
    'Otro motivo'
  ];

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
    return { open: false, assetId: '', reason: RETIRE_REASONS[0], note: '', acknowledged: false };
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
      if (field.type === 'boolean') return value === true ? 'Sí' : (value === false ? 'No' : '—');
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
      if (!asset || !asset.warranty || !asset.warranty.until) return { label: 'Sin garantía registrada', tone: 'hold' };
      const days = Math.round((Date.parse(asset.warranty.until + 'T12:00:00') - Date.now()) / 86400000);
      if (days < 0) return { label: 'Garantía vencida', tone: 'down' };
      if (days <= 60) return { label: 'Vence en ' + days + ' días', tone: 'warn' };
      return { label: 'Vigente hasta el ' + Schema.formatDate(asset.warranty.until), tone: 'ok' };
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
      return entry ? entry.label : 'Texto';
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
      return Schema.TONE_LABELS[tone] || 'Sin asignar';
    },
    assetFormTypes() {
      return Object.keys(this.assetAdmin.forms).map((key) => this.assetAdmin.forms[key].type);
    },

    // ------------------------------------------------------------ persistence
    assetActor() {
      if (window.AssetOpsEngine && typeof window.AssetOpsEngine.actorOf === 'function') {
        return window.AssetOpsEngine.actorOf(this);
      }
      return this.currentUser && this.currentUser.name ? this.currentUser.name : 'Administrador';
    },
    persistAssets() {
      const saved = Store.writeJSON(window.localStorage, Store.KEYS.assets, this.assets);
      if (!saved) this.showToast('No se pudo guardar el activo en este navegador.', 'error');
      return saved;
    },
    persistAssetAdmin() {
      const saved = Store.writeJSON(window.localStorage, Store.KEYS.assetAdmin, this.assetAdmin);
      if (!saved) this.showToast('No se pudo guardar la configuración de activos.', 'error');
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
      draft.name = 'Copia de ' + asset.name;
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
      this.showToast('Duplicado listo para revisar antes de guardar.');
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
      if (!Schema.text(draft.name)) errors.name = 'El nombre del activo es obligatorio.';
      if (!draft.category) errors.category = 'Selecciona una categoría.';
      if (draft.ip && !/^[0-9a-zA-Z.:-]+$/.test(draft.ip.trim())) {
        errors.ip = 'Usa una IP o un nombre de host sin espacios.';
      }
      if (draft.cost !== '' && draft.cost !== null && !(Number(draft.cost) >= 0)) {
        errors.cost = 'El coste debe ser un número igual o mayor a cero.';
      }
      const warranty = draft.warranty || {};
      if (warranty.until && !Schema.isoDate(warranty.until)) {
        errors.warranty = 'La fecha de garantía no es válida.';
      }
      if (warranty.until && draft.createdAt && Schema.isoDate(warranty.until) < Schema.isoDate(draft.createdAt)) {
        errors.warranty = 'La garantía no puede vencer antes del alta del activo.';
      }
      return errors;
    },
    saveAsset() {
      const draft = this.assetEditor.draft;
      const errors = this.validateAssetDraft(draft);
      this.assetEditorErrors = errors;
      if (Object.keys(errors).length) {
        this.assetEditor.error = 'Revisa los campos marcados antes de guardar.';
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
          history: [Schema.historyEntry('created', 'Alta en el inventario', 'Ficha creada desde el formulario de ' + (category ? category.label : 'activo') + '.', {
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
        this.showToast('Activo ' + id + ' registrado.');
        this.openAsset(asset);
        return;
      }

      const asset = this.assets.find((item) => item.id === this.assetEditor.id);
      if (!asset) {
        this.assetEditor.error = 'El activo ya no existe en el inventario.';
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
          asset.history.unshift(Schema.historyEntry('code', 'Código rápido recalculado', before.code + ' → ' + recalculated + ' · ' + (before.site !== asset.site ? 'cambio de ubicación' : 'cambio de tipo') + '.', {
            actor: this.assetActor(),
            movement: 'code',
            changes: [{ field: 'code', label: 'Código rápido', before: before.code, after: recalculated }]
          }));
          asset.code = recalculated;
        }
      }
      if (before.status !== asset.status) {
        asset.history.unshift(Schema.historyEntry('status', 'Estado actualizado', before.status + ' → ' + asset.status + '.', {
          actor: this.assetActor(),
          movement: 'status',
          changes: [{ field: 'statusId', label: 'Estado', before: before.status, after: asset.status }]
        }));
      }
      if ((before.assigneeId || '') !== (asset.assigneeId || '')) {
        asset.history.unshift(Schema.historyEntry('assigned', 'Responsable actualizado', (before.assignee || 'Sin asignar') + ' → ' + (asset.assignee || 'Sin asignar') + '.', {
          actor: this.assetActor(),
          movement: 'assigned',
          changes: [{ field: 'assigneeId', label: 'Responsable', before: before.assignee || 'Sin asignar', after: asset.assignee || 'Sin asignar' }]
        }));
      }
      const touched = ['name', 'brand', 'model', 'serial', 'ip', 'cost', 'warranty', 'tech'].filter((key) => {
        return JSON.stringify(before[key] || '') !== JSON.stringify(asset[key] || '');
      });
      if (touched.length) {
        const labels = touched.slice(0, 4).map((key) => {
          if (key === 'tech') return 'campos técnicos';
          if (key === 'warranty') return 'garantía';
          return this.assetCommonField(key) ? this.assetCommonField(key).label.toLocaleLowerCase('es') : key;
        });
        const changes = touched.map((key) => {
          if (key === 'tech') {
            return { field: 'tech', label: 'Campos técnicos', before: 'Valores anteriores', after: 'Valores actualizados' };
          }
          if (key === 'warranty') {
            const until = asset.warranty && asset.warranty.until ? asset.warranty.until : 'Sin garantía';
            const previous = before.warranty && before.warranty.until ? before.warranty.until : 'Sin garantía';
            return { field: 'warranty', label: 'Garantía', before: previous, after: until };
          }
          const label = this.assetCommonField(key) ? this.assetCommonField(key).label : key;
          return {
            field: key,
            label: label,
            before: String(before[key] === '' || before[key] === undefined ? 'Sin valor' : before[key]),
            after: String(asset[key] === '' || asset[key] === undefined ? 'Sin valor' : asset[key])
          };
        });
        asset.history.unshift(Schema.historyEntry('updated', 'Ficha actualizada', 'Cambios en ' + labels.join(', ') + '.', {
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
      this.showToast('Activo ' + asset.id + ' actualizado.');
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
        this.statusDialogError = 'No se encontró el activo o el estado seleccionado.';
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
      const changes = [{ field: 'statusId', label: 'Estado', before: before, after: status.label }];
      if (dialog.note.trim()) changes.push({ field: 'note', label: 'Observación', before: '', after: dialog.note.trim() });
      asset.history.unshift(Schema.historyEntry('status', 'Estado actualizado', before + ' → ' + status.label + (dialog.note.trim() ? ' · ' + dialog.note.trim() : '') + '.', {
        actor: this.assetActor(),
        movement: 'status',
        changes: changes
      }));
      this.persistAssets();
      this.closeStatusDialog();
      this.showToast('Estado actualizado a «' + status.label + '».');
    },

    // ------------------------------------------------------------------- baja
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
        this.retireDialogError = 'El activo ya no existe en el inventario.';
        return;
      }
      if (!dialog.acknowledged) {
        this.retireDialogError = 'Confirma que el activo deja de estar operativo.';
        return;
      }
      const finalStatus = this.assetFinalStatus();
      const note = dialog.note.trim();
      asset.retired = {
        at: new Date().toISOString(),
        reason: dialog.reason,
        note
      };
      asset.statusId = finalStatus.id;
      asset.status = finalStatus.label;
      asset.statusTone = finalStatus.tone;
      asset.assigneeId = '';
      asset.assignee = '';
      asset.updatedAt = new Date().toISOString();
      const retireChanges = [{ field: 'statusId', label: 'Estado', before: asset.status, after: finalStatus.label }];
      if (asset.assignee) retireChanges.push({ field: 'assigneeId', label: 'Responsable', before: asset.assignee, after: 'Sin asignar' });
      retireChanges.push({ field: 'retired', label: 'Conservación', before: 'Inventario operativo', after: 'Ficha, adjuntos e historial conservados' });
      asset.history.unshift(Schema.historyEntry('retired', 'Activo dado de baja', dialog.reason + (note ? ' · ' + note : '') + '. El registro y su historial se conservan.', {
        actor: this.assetActor(),
        movement: 'retired',
        changes: retireChanges
      }));
      this.persistAssets();
      this.persistAssignments();
      this.closeRetireDialog();
      this.showToast('Activo dado de baja. El historial se conserva.');
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
      asset.history.unshift(Schema.historyEntry('restored', 'Activo restaurado', 'Vuelve al inventario operativo en estado «' + target.label + '».', {
        actor: this.assetActor(),
        movement: 'restored',
        changes: [{ field: 'statusId', label: 'Estado', before: 'Dado de baja', after: target.label }]
      }));
      this.persistAssets();
      this.showToast('Activo restaurado en estado «' + target.label + '».');
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
          this.deleteDialogError = 'Escribe el ID permanente ' + asset.id + ' para habilitar la eliminación.';
          return;
        }
        if (dialog.reason.trim().length < 4) {
          this.deleteDialogError = 'Indica el motivo de la eliminación definitiva.';
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
      this.showToast('Activo ' + asset.id + ' eliminado definitivamente.');
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
      if (!Schema.text(dialog.label)) errors.label = 'El nombre del campo es obligatorio.';
      const key = Schema.slug(dialog.key || dialog.label, 'campo');
      const duplicate = this.assetAdmin.fields.some((field) => field.key === key && field.key !== dialog.key);
      if (duplicate) errors.label = 'Ya existe un campo con esa clave. Cambia el nombre.';
      if (dialog.type === 'select' && !Schema.text(dialog.options)) {
        errors.options = 'Define al menos una opción separada por comas.';
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
      this.showToast('Biblioteca de campos actualizada.');
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
        title: 'Eliminar campo técnico',
        message: 'El campo «' + field.label + '» se quitará de la biblioteca y de los formularios que lo usan.',
        detail: categories.length ? 'Afecta a: ' + categories.join(', ') + '.' : 'Ningún formulario lo está usando.',
        confirmLabel: 'Eliminar campo',
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
        this.showToast('Campo eliminado de la biblioteca.');
        return true;
      }
      if (kind === 'delete-asset-status') {
        this.assetAdmin.statuses = this.assetAdmin.statuses.filter((status) => status.id !== dialog.statusId);
        this.persistAssetAdmin();
        this.closeConfirm();
        this.showToast('Estado eliminado.');
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
      if (!Schema.text(dialog.label)) errors.label = 'El nombre del estado es obligatorio.';
      const label = Schema.text(dialog.label).toLocaleLowerCase('es');
      const duplicate = this.assetAdmin.statuses.some((status) => status.label.toLocaleLowerCase('es') === label && status.id !== dialog.id);
      if (duplicate) errors.label = 'Ya existe un estado con ese nombre.';
      if (dialog.final && this.assetAdmin.statuses.some((status) => status.final && status.id !== dialog.id)) {
        errors.final = 'Solo puede haber un estado final (baja).';
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
      this.showToast('Estados de activo actualizados.');
    },
    requestDeleteAssetStatus(status) {
      const inUse = this.assets.filter((asset) => asset.statusId === status.id).length;
      const remaining = this.assetAdmin.statuses.filter((item) => item.id !== status.id && !item.final).length;
      const blocked = inUse > 0 || remaining < 1 || this.assetAdmin.statuses.length <= 2;
      this.confirmDialog = {
        open: true,
        kind: blocked ? 'blocked-asset-status' : 'delete-asset-status',
        title: blocked ? 'No se puede eliminar el estado' : 'Eliminar estado',
        message: blocked
          ? (inUse > 0
            ? 'Hay ' + inUse + ' activo(s) en este estado. Cambia su estado antes de eliminarlo.'
            : 'El inventario necesita al menos un estado operativo además del estado final.')
          : 'El estado «' + status.label + '» se quitará de la lista de estados disponibles.',
        detail: '',
        confirmLabel: blocked ? '' : 'Eliminar estado',
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
        this.formDraftError = 'El prefijo del código rápido es obligatorio.';
        return;
      }
      this.assetAdmin.forms[draft.categoryId] = Schema.normalizeForm(draft.form, draft.form);
      this.persistAssetAdmin();
      const category = this.categories.find((item) => item.id === draft.categoryId);
      this.showToast('Formulario de ' + (category ? category.label : 'activo') + ' guardado.');
      this.closeFormDraft();
    },

    // ---------------------------------------------- asset admin: identificación
    saveAssetIdRules() {
      const rules = this.assetIdRulesDraft;
      const errors = {};
      if (!Schema.text(rules.permanentPrefix)) errors.permanentPrefix = 'El prefijo del ID es obligatorio.';
      if (Schema.number(rules.permanentPad, 0) < 3 || Schema.number(rules.permanentPad, 0) > 8) {
        errors.permanentPad = 'Usa entre 3 y 8 dígitos.';
      }
      if (Schema.number(rules.quickPad, 0) < 2 || Schema.number(rules.quickPad, 0) > 5) {
        errors.quickPad = 'Usa entre 2 y 5 dígitos.';
      }
      if (!/^[A-Za-z0-9-]{1,2}$/.test(rules.separator)) errors.separator = 'El separador admite hasta 2 caracteres.';
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
      this.showToast('Reglas de identificación guardadas.');
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
        ? 'Modo producción: la baja conserva el historial y la eliminación requiere confirmación escrita.'
        : 'Modo desarrollo: la eliminación definitiva pide una confirmación simple.');
    }
  };

  window.AssetAdminReasons = RETIRE_REASONS;
})();
