/* Server-authoritative inventory adapter.
 *
 * The prototype collection (`this.assets`, localStorage) stays untouched for the
 * modules that still run on demo data. This adapter owns a separate collection
 * and detail record fed by the FastAPI inventory API, maps the minimal DTO onto
 * the existing views, and overrides only the inventory entry points at final
 * composition (app.js merges these methods last).
 */
(function () {
  'use strict';

  const PAGE_LIMIT = 25;
  const MAX_NAME = 160;
  const MAX_TEXT = 120;
  const QUICK_CODE_MAX = 120;

  const STATUS_OPTIONS = [
    { value: 'in_use', label: 'Asignado', tone: 'ok' },
    { value: 'in_storage', label: 'En resguardo', tone: 'hold' },
    { value: 'maintenance', label: 'Mantenimiento', tone: 'warn' },
    { value: 'retired', label: 'Dado de baja', tone: 'down' }
  ];

  const FALLBACK_IMAGE = 'assets/svg/devices/other.svg';

  // Monotonic response epoch. Clearing the session must invalidate in-flight
  // responses, so the counter is never reset: a late response can only match an
  // epoch that is still the newest one.
  let responseEpoch = 0;

  function nextEpoch() {
    responseEpoch += 1;
    return responseEpoch;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function statusMeta(value) {
    const key = text(value).toLowerCase();
    return STATUS_OPTIONS.find((option) => option.value === key) || STATUS_OPTIONS[0];
  }

  function createState() {
    return {
      items: [],
      total: 0,
      limit: PAGE_LIMIT,
      offset: 0,
      loading: false,
      loaded: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function createFilters() {
    return { query: '', category: 'all', status: 'all' };
  }

  function createDetail() {
    return { id: '', asset: null, loading: false, error: '', epoch: nextEpoch(), controller: null };
  }

  function normalize(value) {
    return text(value)
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function makeController() {
    if (typeof AbortController === 'function') return new AbortController();
    return null;
  }

  window.AssetInventory = {
    PAGE_LIMIT,
    STATUS_OPTIONS,

    data() {
      return {
        inventory: createState(),
        inventoryFilters: createFilters(),
        inventoryDetail: createDetail(),
        inventorySearchTimer: null
      };
    },

    computed: {
      inventoryItems() {
        return this.inventory.items;
      },
      inventoryTotal() {
        return this.inventory.total;
      },
      inventoryPage() {
        return Math.floor(this.inventory.offset / this.inventory.limit) + 1;
      },
      inventoryPages() {
        return Math.max(1, Math.ceil(this.inventory.total / this.inventory.limit));
      },
      inventoryHasPrev() {
        return this.inventory.offset > 0;
      },
      inventoryHasNext() {
        return this.inventory.offset + this.inventory.limit < this.inventory.total;
      },
      inventoryPageLabel() {
        return 'Página ' + this.inventoryPage + ' de ' + this.inventoryPages;
      },
      inventoryFiltersActive() {
        const filters = this.inventoryFilters || {};
        return !!text(filters.query) || (filters.category && filters.category !== 'all') || (filters.status && filters.status !== 'all');
      },
      inventoryStatusChoices() {
        return STATUS_OPTIONS;
      },
      serverInventory() {
        return !!(this.authenticated && this.can && this.can('assets.view'));
      },
      inventoryCategoryChoices() {
        return this.categories || [];
      },
      serverAssetMode() {
        return !!(this.route && this.route.name === 'detail' && this.currentAsset && this.currentAsset.serverAsset);
      },
      /* Server detail replaces the prototype lookup for server assets while the
       * demo modules keep resolving their own ids. */
      currentAsset() {
        const id = this.route && this.route.name === 'detail' ? this.route.assetId : '';
        if (!id) return null;
        if (this.inventoryDetail && this.inventoryDetail.id === id && this.inventoryDetail.asset) return this.inventoryDetail.asset;
        const inPage = (this.inventory.items || []).find((asset) => asset.id === id);
        if (inPage) return inPage;
        return (this.assets || []).find((asset) => asset.id === id) || null;
      }
    },

    methods: {
      inventoryAvailable() {
        return !!(this.authenticated && this.can && this.can('assets.view'));
      },
      inventoryStatusOptions() {
        return STATUS_OPTIONS;
      },
      filterFromSidebar(categoryId) {
        if (!this.serverInventory) return window.AssetMethods.filterFromSidebar.call(this, categoryId);
        this.inventoryFilters.category = categoryId || 'all';
        if (this.route.name !== 'inventory') this.setHash('#/inventario');
      },
      inventoryStatusLabel(value) {
        return statusMeta(value).label;
      },
      inventoryCategoryText(categoryId) {
        const category = (this.categories || []).find((item) => item.id === categoryId);
        return category ? category.label : text(categoryId);
      },
      inventoryCategoryId(categoryText) {
        const needle = normalize(categoryText);
        if (!needle) return '';
        const category = (this.categories || []).find((item) => {
          return normalize(item.id) === needle || normalize(item.slug) === needle || normalize(item.label) === needle;
        });
        return category ? category.id : '';
      },
      inventoryCategoryLabel(asset) {
        if (!asset) return '—';
        return asset.categoryText || this.categoryLabel(asset.category) || 'Sin categoría';
      },
      inventoryCategoryImage(categoryId) {
        const category = (this.categories || []).find((item) => item.id === categoryId);
        return category && category.image ? category.image : FALLBACK_IMAGE;
      },
      assetSiteText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.site) || 'Sin sede';
        return this.siteLabel(asset.site) || '—';
      },
      assetLocationText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.location) || 'Sin ubicación';
        return this.locationLabel(asset);
      },
      assetResponsibleText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.responsible);
        return this.assigneeLabel(asset);
      },
      inventoryMapAsset(dto) {
        if (!dto || typeof dto !== 'object' || !dto.id) return null;
        const meta = statusMeta(dto.status);
        const categoryText = text(dto.category);
        const category = this.inventoryCategoryId(categoryText);
        return {
          id: text(dto.id),
          code: text(dto.quickCode),
          quickCode: text(dto.quickCode),
          name: text(dto.name),
          category,
          categoryText,
          type: text(dto.type),
          brand: text(dto.brand),
          model: text(dto.model),
          serial: text(dto.serial),
          ip: text(dto.ip),
          site: text(dto.site),
          location: text(dto.location),
          responsible: text(dto.responsible),
          assignee: text(dto.responsible),
          statusId: meta.value,
          status: meta.label,
          statusTone: meta.tone,
          description: text(dto.description),
          retired: meta.value === 'retired' ? { at: text(dto.updatedAt), reason: '', note: '' } : null,
          createdAt: text(dto.createdAt),
          updatedAt: text(dto.updatedAt),
          image: this.inventoryCategoryImage(category),
          hasOwnImage: false,
          fovImage: '',
          tech: {},
          warranty: null,
          history: [],
          cost: 0,
          anydeskId: '',
          rmmAgentId: '',
          rmmOnline: false,
          serverAsset: true
        };
      },
      inventoryQueryString() {
        const url = new URL('http://inventory.local/assets/search');
        const filters = this.inventoryFilters || {};
        const query = text(filters.query);
        if (query) url.searchParams.set('query', query);
        if (filters.category && filters.category !== 'all') {
          url.searchParams.set('category', this.inventoryCategoryText(filters.category));
        }
        if (filters.status && filters.status !== 'all') url.searchParams.set('status', filters.status);
        url.searchParams.set('limit', String(this.inventory.limit));
        url.searchParams.set('offset', String(this.inventory.offset));
        return url.search;
      },
      abortInventoryRequest() {
        const controller = this.inventory && this.inventory.controller;
        if (controller) controller.abort();
        if (this.inventory) this.inventory.controller = null;
      },
      abortInventoryDetail() {
        const controller = this.inventoryDetail && this.inventoryDetail.controller;
        if (controller) controller.abort();
        if (this.inventoryDetail) this.inventoryDetail.controller = null;
      },
      async loadInventory(options) {
        if (!this.inventoryAvailable()) return false;
        const opts = options || {};
        if (opts.resetOffset) this.inventory.offset = 0;
        const epoch = nextEpoch();
        this.inventory.epoch = epoch;
        this.abortInventoryRequest();
        const controller = makeController();
        this.inventory.controller = controller;
        this.inventory.loading = true;
        this.inventory.error = '';
        try {
          const payload = await window.AssetAccess.request(this, '/assets/search' + this.inventoryQueryString(), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== this.inventory.epoch || !this.authenticated) return false;
          this.inventory.items = (Array.isArray(payload.items) ? payload.items : [])
            .map((item) => this.inventoryMapAsset(item))
            .filter(Boolean);
          this.inventory.total = Number(payload.total) || 0;
          this.inventory.limit = Number(payload.limit) || this.inventory.limit;
          this.inventory.offset = Number(payload.offset) || 0;
          this.inventory.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== this.inventory.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) {
            this.clearInventoryState();
            return false;
          }
          this.inventory.items = [];
          this.inventory.total = 0;
          this.inventory.loaded = false;
          this.inventory.error = (error && error.message) || 'No se pudo cargar el inventario del servidor.';
          return false;
        } finally {
          if (epoch === this.inventory.epoch) this.inventory.loading = false;
        }
      },
      scheduleInventorySearch() {
        if (this.inventorySearchTimer) clearTimeout(this.inventorySearchTimer);
        this.inventorySearchTimer = setTimeout(() => {
          this.inventorySearchTimer = null;
          this.loadInventory({ resetOffset: true });
        }, 250);
      },
      clearInventoryFilters() {
        this.inventoryFilters = createFilters();
        return this.loadInventory({ resetOffset: true });
      },
      goToInventoryPage(offset) {
        const limit = this.inventory.limit || PAGE_LIMIT;
        const total = Math.max(0, this.inventory.total);
        const bounded = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, Math.ceil(total / limit) - 1) * limit));
        if (bounded === this.inventory.offset) return false;
        this.inventory.offset = bounded;
        return this.loadInventory();
      },
      nextInventoryPage() {
        return this.goToInventoryPage(this.inventory.offset + this.inventory.limit);
      },
      prevInventoryPage() {
        return this.goToInventoryPage(this.inventory.offset - this.inventory.limit);
      },
      async loadInventoryDetail(id) {
        const assetId = text(id);
        if (!assetId || !this.inventoryAvailable()) return false;
        const epoch = nextEpoch();
        this.abortInventoryDetail();
        const controller = makeController();
        const cached = (this.inventory.items || []).find((asset) => asset.id === assetId) || null;
        this.inventoryDetail = {
          id: assetId,
          asset: cached,
          loading: true,
          error: '',
          epoch,
          controller
        };
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(assetId), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== this.inventoryDetail.epoch || !this.authenticated) return false;
          const asset = this.inventoryMapAsset(payload);
          if (!asset) throw new Error('El servidor no devolvió el activo solicitado.');
          this.inventoryDetail.asset = asset;
          return true;
        } catch (error) {
          if (epoch !== this.inventoryDetail.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          if (!this.authenticated) return false;
          this.inventoryDetail.asset = error && error.status === 404 ? null : this.inventoryDetail.asset;
          this.inventoryDetail.error = error && error.status === 404
            ? 'El activo solicitado ya no está disponible en el servidor.'
            : (error && error.message) || 'No se pudo cargar el activo desde el servidor.';
          return false;
        } finally {
          if (epoch === this.inventoryDetail.epoch) this.inventoryDetail.loading = false;
        }
      },
      clearInventoryState() {
        this.abortInventoryRequest();
        this.abortInventoryDetail();
        if (this.inventorySearchTimer) {
          clearTimeout(this.inventorySearchTimer);
          this.inventorySearchTimer = null;
        }
        this.inventory = createState();
        this.inventoryFilters = createFilters();
        this.inventoryDetail = createDetail();
      },
      handleInventoryRoute(next) {
        if (!this.authenticated) {
          this.clearInventoryState();
          return;
        }
        if (next && next.name === 'inventory') {
          if (!this.inventory.loaded && !this.inventory.loading) this.loadInventory();
          return;
        }
        if (next && next.name === 'detail' && next.assetId) {
          if (this.inventoryDetail.id !== next.assetId || this.inventoryDetail.error) this.loadInventoryDetail(next.assetId);
          return;
        }
        this.abortInventoryRequest();
        this.abortInventoryDetail();
      },
      assetExists(id) {
        if (this.hasAsset(id)) return true;
        // Permanent ids are resolved by GET /assets/{id}; an unknown id ends in the
        // detail error state instead of silently falling back to prototype data.
        return this.inventoryAvailable();
      },
      hasAsset(id) {
        const assetId = text(id);
        if (!assetId) return false;
        if ((this.assets || []).some((asset) => asset.id === assetId)) return true;
        if ((this.inventory.items || []).some((asset) => asset.id === assetId)) return true;
        return !!(this.inventoryDetail.asset && this.inventoryDetail.asset.id === assetId);
      },

      /* ------------------------------------------------------------ editor */
      openAssetCreate() {
        const category = this.prefs && this.prefs.category !== 'all' ? this.prefs.category : (this.categories[0] ? this.categories[0].id : 'otros');
        this.assetEditor = {
          open: true,
          mode: 'create',
          real: true,
          id: '',
          advancedOpen: false,
          category,
          error: '',
          saving: false,
          draft: {
            id: '',
            quickCode: '',
            name: '',
            category,
            type: this.assetForm(category).type,
            brand: '',
            model: '',
            serial: '',
            ip: '',
            site: '',
            location: '',
            responsible: '',
            statusId: 'in_use',
            description: ''
          }
        };
        this.assetEditorErrors = {};
      },
      openAssetEdit(asset) {
        if (!asset) return;
        if (!asset.serverAsset) return window.AssetAdminMethods.openAssetEdit.call(this, asset);
        this.assetEditor = {
          open: true,
          mode: 'edit',
          real: true,
          id: asset.id,
          advancedOpen: false,
          category: asset.category,
          error: '',
          saving: false,
          draft: {
            id: asset.id,
            quickCode: asset.quickCode,
            name: asset.name,
            category: asset.category,
            categoryText: asset.categoryText,
            type: asset.type,
            brand: asset.brand,
            model: asset.model,
            serial: asset.serial,
            ip: asset.ip,
            site: asset.site,
            location: asset.location,
            responsible: asset.responsible,
            statusId: asset.statusId,
            description: asset.description
          }
        };
        this.assetEditorErrors = {};
      },
      assetCommonField(key) {
        const inventoryFields = {
          location: { key: 'location', label: 'Ubicación' },
          responsible: { key: 'responsible', label: 'Responsable' },
          quickCode: { key: 'quickCode', label: 'Código rápido' },
          description: { key: 'description', label: 'Descripción' }
        };
        if (inventoryFields[key]) return inventoryFields[key];
        return window.AssetSchema.COMMON_FIELDS.find((field) => field.key === key) || null;
      },
      assetFormKeys(bucket, categoryId) {
        if (this.assetEditor && this.assetEditor.real) {
          return bucket === 'quick'
            ? ['name', 'type', 'brand', 'model', 'serial', 'ip', 'site', 'location', 'responsible', 'quickCode', 'statusId', 'description']
            : [];
        }
        return window.AssetAdminMethods.assetFormKeys.call(this, bucket, categoryId);
      },
      validateInventoryDraft(draft) {
        const errors = {};
        if (!text(draft.name)) errors.name = 'El nombre del activo es obligatorio.';
        else if (text(draft.name).length > MAX_NAME) errors.name = 'Usa ' + MAX_NAME + ' caracteres como máximo.';
        if (draft.ip && !/^[0-9a-zA-Z.:-]+$/.test(text(draft.ip))) errors.ip = 'Usa una IP o un nombre de host sin espacios.';
        if (text(draft.site).length > MAX_TEXT) errors.site = 'Usa ' + MAX_TEXT + ' caracteres como máximo.';
        if (text(draft.location).length > MAX_TEXT) errors.location = 'Usa ' + MAX_TEXT + ' caracteres como máximo.';
        if (text(draft.responsible).length > MAX_TEXT) errors.responsible = 'Usa ' + MAX_TEXT + ' caracteres como máximo.';
        if (text(draft.quickCode).length > QUICK_CODE_MAX) errors.quickCode = 'Usa ' + QUICK_CODE_MAX + ' caracteres como máximo.';
        if (!STATUS_OPTIONS.some((option) => option.value === draft.statusId)) errors.statusId = 'Selecciona un estado válido.';
        return errors;
      },
      canAssignResponsible() {
        return !!(this.can && this.can('assets.assign'));
      },
      assetFieldLocked(key) {
        return key === 'responsible' && !this.canAssignResponsible();
      },
      inventoryPayload(draft) {
        const payload = {
          name: text(draft.name),
          category: text(draft.categoryText || this.inventoryCategoryText(draft.category)),
          type: text(draft.type),
          brand: text(draft.brand),
          model: text(draft.model),
          serial: text(draft.serial),
          ip: text(draft.ip),
          site: text(draft.site),
          location: text(draft.location),
          status: draft.statusId || 'in_use',
          description: text(draft.description)
        };
        // The server requires assets.assign to change the responsible person, so a
        // caller without it never proposes that field.
        if (!this.assetFieldLocked('responsible')) payload.responsible = text(draft.responsible);
        const quickCode = text(draft.quickCode);
        if (quickCode) payload.quickCode = quickCode;
        return payload;
      },
      async saveAsset() {
        if (!this.assetEditor.real) return window.AssetAdminMethods.saveAsset.call(this);
        if (this.assetEditor.saving) return false;
        const draft = this.assetEditor.draft;
        const errors = this.validateInventoryDraft(draft);
        this.assetEditorErrors = errors;
        if (Object.keys(errors).length) {
          this.assetEditor.error = 'Revisa los campos marcados antes de guardar.';
          return false;
        }
        const isCreate = this.assetEditor.mode === 'create';
        const path = isCreate ? '/assets' : '/assets/' + encodeURIComponent(this.assetEditor.id);
        // The save is only surfaced if the session and inventory epoch are still
        // the ones that started it; a logout or reset must not revive the UI.
        const epoch = this.inventory.epoch;
        this.assetEditor.saving = true;
        this.assetEditor.error = '';
        try {
          const payload = await window.AssetAccess.request(this, path, {
            method: isCreate ? 'POST' : 'PATCH',
            body: this.inventoryPayload(draft)
          });
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const saved = this.inventoryMapAsset(payload);
          this.assetEditor.saving = false;
          this.closeAssetEditor();
          await this.loadInventory();
          if (saved) {
            if (this.inventoryDetail.id === saved.id) this.inventoryDetail.asset = saved;
            this.showToast(isCreate ? 'Activo ' + saved.id + ' registrado.' : 'Activo ' + saved.id + ' actualizado.');
            if (!isCreate) this.openAsset(saved);
          }
          return saved || true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const fieldErrors = Object.assign({}, error.fieldErrors || {});
          if (error.status === 409) {
            fieldErrors.quickCode = 'Ese código rápido ya está en uso.';
            this.assetEditor.error = 'El código rápido debe ser único en el inventario.';
          } else if (error.status === 403) {
            this.assetEditor.error = error.message || 'No tienes permisos para guardar este activo.';
          } else if (error.status === 422) {
            this.assetEditor.error = error.message || 'Revisa los campos marcados antes de guardar.';
          } else {
            this.assetEditor.error = error.message || 'No se pudo guardar el activo en el servidor.';
          }
          this.assetEditorErrors = fieldErrors;
          return false;
        } finally {
          if (this.assetEditor) this.assetEditor.saving = false;
        }
      }
    }
  };
})();
