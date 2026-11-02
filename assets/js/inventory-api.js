/* Server-authoritative inventory adapter.
 *
 * The prototype collection (`this.assets`, localStorage) stays untouched for the
 * modules that still run on demo data. This adapter owns a separate collection,
 * detail record, media, history and the server catalog. It maps the canonical
 * DTOs onto the existing views and overrides only the inventory entry points at
 * final composition (app.js merges these methods last).
 */
(function () {
  'use strict';

  // Adapter copy (status fallbacks, validation, toasts, configuration errors) is
  // resolved at call time: the runtime, not a frozen literal, decides the language.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  // The archive and retirement endpoints take free text, so a caller that holds
  // the stable reason id (`theft`) sends the label of the current locale and the
  // id never leaves the browser. Text the server stores is passed through as is.
  function lifecycleReasonText(value) {
    const reasons = typeof window !== 'undefined' ? window.AssetAdminRetireReasons : null;
    return reasons && typeof reasons.label === 'function' ? reasons.label(value) : text(value);
  }

  const PAGE_LIMIT = 25;
  const MAX_NAME = 160;
  const MAX_TEXT = 120;
  const QUICK_CODE_MAX = 32;
  const HISTORY_LIMIT = 50;
  const HISTORY_MAX = 200;
  const IMAGE_MAX_BYTES = 1024 * 1024;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const IMAGE_ROLES = ['photo', 'fov'];
  const REASON_MIN = 4;
  const REASON_MAX = 500;

  // The label is a getter: the fallback vocabulary belongs to the catalog and is
  // resolved when it is rendered, never at module load.
  const STATUS_OPTIONS = [
    { value: 'in_use', get label() { return tr('ui.inventory.status.in_use'); }, tone: 'ok' },
    { value: 'in_storage', get label() { return tr('ui.inventory.status.in_storage'); }, tone: 'hold' },
    { value: 'maintenance', get label() { return tr('ui.inventory.status.maintenance'); }, tone: 'warn' },
    { value: 'retired', get label() { return tr('ui.inventory.status.retired'); }, tone: 'down' }
  ];

  const FALLBACK_IMAGE = 'assets/svg/devices/other.svg';

  // Existing device line art: the category keeps a stable illustration without a
  // second image pipeline. Camera keeps its own FOV illustration when the asset
  // has no own photo.
  const CATEGORY_IMAGES = {
    computadoras: 'assets/svg/devices/desktop.svg',
    notebooks: 'assets/svg/devices/notebook.svg',
    servidores: 'assets/svg/devices/server.svg',
    virtualizacion: 'assets/svg/devices/vm.svg',
    docker: 'assets/svg/devices/container.svg',
    lxc: 'assets/svg/devices/container.svg',
    contenedores: 'assets/svg/devices/container.svg',
    switches: 'assets/svg/devices/switch.svg',
    routers: 'assets/svg/devices/switch.svg',
    impresoras: 'assets/svg/devices/printer.svg',
    ups: 'assets/svg/devices/ups.svg',
    camaras: 'assets/svg/devices/camera.svg',
    monitores: 'assets/svg/devices/monitor.svg',
    otros: 'assets/svg/devices/other.svg'
  };

  // Server catalog keys kept for common fields; the editor draft uses the display
  // names the views already have.
  const COMMON_KEY_ALIASES = { locationId: 'location', assigneeId: 'responsible', statusId: 'status' };
  const EDITOR_COMMON_KEYS = ['name', 'type', 'brand', 'model', 'serial', 'ip', 'site', 'location', 'responsible', 'status', 'description', 'cost', 'quickCode', 'image', 'category'];

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

  function rawText(value) {
    return typeof value === 'string' ? value : '';
  }

  function copy(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function normalize(value) {
    return text(value)
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function slug(value, fallback) {
    const base = normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return base || fallback || 'campo';
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

  function createCatalog() {
    return {
      categories: [],
      fields: [],
      statuses: [],
      rules: {},
      commonFields: [],
      operations: null,
      loading: false,
      loaded: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function createHistory() {
    return {
      id: '',
      items: [],
      total: 0,
      limit: HISTORY_LIMIT,
      offset: 0,
      loading: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function createLifecycle() {
    return { open: false, kind: '', assetId: '', asset: null, reason: '', typed: '', error: '', busy: false };
  }

  function lifecycleAsset(asset) {
    if (!asset) return null;
    return {
      id: text(asset.id),
      name: text(asset.name),
      archived: !!asset.archived,
      serverAsset: !!asset.serverAsset,
      category: text(asset.category),
      categoryText: text(asset.categoryText)
    };
  }

  function makeController() {
    if (typeof AbortController === 'function') return new AbortController();
    return null;
  }

  function imageForCategory(id) {
    const key = text(id).toLocaleLowerCase('es');
    return CATEGORY_IMAGES[key] || FALLBACK_IMAGE;
  }

  window.AssetInventory = {
    PAGE_LIMIT,
    STATUS_OPTIONS,
    IMAGE_MAX_BYTES,
    IMAGE_TYPES,
    IMAGE_ROLES,
    REASON_MIN,

    data() {
      return {
        inventory: createState(),
        inventoryFilters: createFilters(),
        inventoryDetail: createDetail(),
        inventoryCatalog: createCatalog(),
        inventoryHistory: createHistory(),
        inventoryLifecycle: createLifecycle(),
        inventoryMediaError: '',
        inventoryConfigError: '',
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
        return tr('ui.inventory.page_label', { page: this.inventoryPage, pages: this.inventoryPages });
      },
      inventoryFiltersActive() {
        const filters = this.inventoryFilters || {};
        return !!text(filters.query) || (filters.category && filters.category !== 'all') || (filters.status && filters.status !== 'all');
      },
      inventoryStatusChoices() {
        const statuses = this.inventoryCatalog && this.inventoryCatalog.statuses;
        if (statuses && statuses.length) {
          return statuses
            .filter((status) => status.active !== false)
            .map((status) => ({ value: status.id, label: status.label, tone: status.tone || 'hold', final: !!status.final }));
        }
        return STATUS_OPTIONS;
      },
      serverInventory() {
        return !!(this.authenticated && this.can && this.can('assets.view'));
      },
      inventoryCatalogReady() {
        return !!(this.inventoryCatalog && this.inventoryCatalog.loaded && !this.inventoryCatalog.error);
      },
      inventoryCategoryChoices() {
        if (!this.inventoryCatalog || !this.inventoryCatalog.loaded) return [];
        return this.inventoryCatalog.categories.filter((category) => category.active !== false);
      },
      serverAssetMode() {
        return !!(this.route && this.route.name === 'detail' && this.currentAsset && this.currentAsset.serverAsset);
      },
      inventoryHistoryPage() {
        return Math.floor(this.inventoryHistory.offset / this.inventoryHistory.limit) + 1;
      },
      inventoryHistoryHasMore() {
        return this.inventoryHistory.offset + this.inventoryHistory.items.length < this.inventoryHistory.total;
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
      /* ------------------------------------------------------------ catalog */
      inventoryAvailable() {
        return !!(this.authenticated && this.can && this.can('assets.view'));
      },
      inventoryStatusOptions() {
        const editor = this.assetEditor;
        if (!editor || !editor.real) return STATUS_OPTIONS;
        const from = editor.mode === 'edit' ? (editor.originalStatus || (editor.draft && editor.draft.originalStatus) || '') : '';
        return this.inventoryStatusChoices.map((status) => ({
          value: status.value,
          label: status.label,
          tone: status.tone,
          final: !!status.final,
          disabled: !this.inventoryStatusAllowed(editor.category, from, status.value)
        }));
      },
      inventoryMapCategory(item) {
        if (!item || typeof item !== 'object' || !item.id) return null;
        const known = (window.ASSET_DATA && window.ASSET_DATA.categories) || [];
        const existing = known.find((category) => category.id === item.id || normalize(category.label) === normalize(item.label));
        return {
          id: text(item.id),
          label: text(item.label) || text(item.id),
          prefix: text(item.prefix),
          type: text(item.type),
          icon: text(item.icon),
          active: item.active !== false,
          fov: !!item.fov,
          quick: Array.isArray(item.quick) ? item.quick.slice() : [],
          advanced: Array.isArray(item.advanced) ? item.advanced.slice() : [],
          tech: Array.isArray(item.tech) ? item.tech.slice() : [],
          transitions: item.transitions && typeof item.transitions === 'object' ? copy(item.transitions) : null,
          image: existing && existing.image ? existing.image : imageForCategory(item.id),
          description: existing ? text(existing.description) : ''
        };
      },
      inventoryMapField(item) {
        if (!item || typeof item !== 'object' || !item.key) return null;
        return {
          key: text(item.key),
          label: text(item.label) || text(item.key),
          type: text(item.type) || 'text',
          unit: text(item.unit),
          hint: text(item.hint),
          options: Array.isArray(item.options) ? item.options.slice() : [],
          active: item.active !== false,
          required: !!item.required,
          maxLength: Number(item.maxLength) || 500,
          minimum: typeof item.minimum === 'number' ? item.minimum : null,
          maximum: typeof item.maximum === 'number' ? item.maximum : null,
          default: item.default === undefined ? null : item.default
        };
      },
      inventoryMapStatus(item) {
        if (!item || typeof item !== 'object' || !item.id) return null;
        return {
          id: text(item.id),
          label: text(item.label) || text(item.id),
          tone: ['ok', 'warn', 'hold', 'down'].indexOf(item.tone) !== -1 ? item.tone : 'hold',
          final: !!item.final,
          active: item.active !== false
        };
      },
      inventoryMapCatalog(payload) {
        const source = payload && typeof payload === 'object' ? payload : {};
        return {
          categories: (Array.isArray(source.categories) ? source.categories : []).map((item) => this.inventoryMapCategory(item)).filter(Boolean),
          fields: (Array.isArray(source.fields) ? source.fields : []).map((item) => this.inventoryMapField(item)).filter(Boolean),
          statuses: (Array.isArray(source.statuses) ? source.statuses : []).map((item) => this.inventoryMapStatus(item)).filter(Boolean),
          rules: source.rules && typeof source.rules === 'object' ? source.rules : {},
          commonFields: Array.isArray(source.commonFields) ? source.commonFields.slice() : [],
          operations: source.operations && typeof source.operations === 'object' ? source.operations : null
        };
      },
      async loadInventoryCatalog(options) {
        if (!this.inventoryAvailable()) return false;
        const opts = options || {};
        if (this.inventoryCatalog.loading && !opts.force) return false;
        const epoch = nextEpoch();
        if (this.inventoryCatalog.controller) this.inventoryCatalog.controller.abort();
        const controller = makeController();
        this.inventoryCatalog.epoch = epoch;
        this.inventoryCatalog.controller = controller;
        this.inventoryCatalog.loading = true;
        this.inventoryCatalog.error = '';
        try {
          const payload = await window.AssetAccess.request(this, '/inventory/config', {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== this.inventoryCatalog.epoch || !this.authenticated) return false;
          const mapped = this.inventoryMapCatalog(payload);
          Object.assign(this.inventoryCatalog, mapped, { loaded: true });
          this.assetIdRulesDraftReal = JSON.parse(JSON.stringify((mapped.rules && mapped.rules.identification) || {}));
          const transitions = (mapped.rules && mapped.rules.transitions && mapped.rules.transitions.transitions) || {};
          this.inventoryTransitionsDraft = Object.keys(transitions).reduce((rows, from) => {
            (transitions[from] || []).forEach((to) => rows.push({ from, to }));
            return rows;
          }, []);
          return true;
        } catch (error) {
          if (epoch !== this.inventoryCatalog.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) {
            this.clearInventoryState();
            return false;
          }
          this.inventoryCatalog.categories = [];
          this.inventoryCatalog.fields = [];
          this.inventoryCatalog.statuses = [];
          this.inventoryCatalog.rules = {};
          this.inventoryCatalog.operations = null;
          this.inventoryCatalog.loaded = false;
          const detail = (error && error.message) || '';
          const generic = tr('ui.errors.request_failed');
          this.inventoryCatalog.error = (error && error.status === 403)
            ? tr('ui.inventory.error.config_forbidden')
            : (tr('ui.inventory.error.config_load_failed')
              + (detail && detail !== generic ? ' ' + detail : ''));
          return false;
        } finally {
          if (epoch === this.inventoryCatalog.epoch) this.inventoryCatalog.loading = false;
          if (this.inventoryCatalog.controller === controller) this.inventoryCatalog.controller = null;
        }
      },
      inventoryStatusMeta(value) {
        const key = text(value).toLowerCase();
        const statuses = (this.inventoryCatalog && this.inventoryCatalog.statuses) || [];
        const found = statuses.find((status) => status.id.toLowerCase() === key);
        if (found) return { value: found.id, label: found.label, tone: found.tone, final: found.final, active: found.active };
        return statusMeta(key);
      },
      inventoryStatusLabel(value) {
        return this.inventoryStatusMeta(value).label;
      },
      inventoryStatusTone(value) {
        return this.inventoryStatusMeta(value).tone;
      },
      inventoryCategoryById(ref) {
        const needle = normalize(ref);
        if (!needle) return null;
        const categories = (this.inventoryCatalog && this.inventoryCatalog.categories) || [];
        return categories.find((category) => normalize(category.id) === needle || normalize(category.label) === needle) || null;
      },
      inventoryCategoryHasFov(ref) {
        const category = typeof ref === 'object' && ref ? this.inventoryCategoryById(ref.categoryText || ref.category) : this.inventoryCategoryById(ref);
        return !!(category && category.fov);
      },
      inventoryFieldByKey(key) {
        const fields = (this.inventoryCatalog && this.inventoryCatalog.fields) || [];
        return fields.find((field) => field.key === key) || null;
      },
      inventoryAssociatedFields(categoryRef) {
        const category = typeof categoryRef === 'object' && categoryRef ? categoryRef : this.inventoryCategoryById(categoryRef);
        if (!category) return [];
        const fields = this.inventoryCatalog.fields || [];
        return category.tech
          .map((key) => fields.find((field) => field.key === key))
          .filter((field) => field && field.active !== false);
      },
      inventoryTechnicalFields(categoryRef) {
        return this.inventoryAssociatedFields(categoryRef);
      },
      inventoryFormKeys(bucket, categoryRef) {
        const category = typeof categoryRef === 'object' && categoryRef ? categoryRef : this.inventoryCategoryById(categoryRef);
        if (!category) return [];
        const keys = bucket === 'advanced' ? category.advanced : category.quick;
        return keys
          .map((key) => COMMON_KEY_ALIASES[key] || key)
          .filter((key, index, list) => EDITOR_COMMON_KEYS.indexOf(key) !== -1 && key !== 'category' && key !== 'image' && list.indexOf(key) === index);
      },
      inventoryStatusAllowed(categoryRef, from, to) {
        if (!from || !to || from === to) return true;
        const statuses = (this.inventoryCatalog && this.inventoryCatalog.statuses) || [];
        const current = statuses.find((status) => status.id === from);
        if (current && current.final) return false;
        const target = statuses.find((status) => status.id === to);
        if (!target || target.active === false) return false;
        const category = typeof categoryRef === 'object' && categoryRef ? categoryRef : this.inventoryCategoryById(categoryRef);
        const rules = (this.inventoryCatalog && this.inventoryCatalog.rules) || {};
        const globalTransitions = rules.transitions && rules.transitions.transitions;
        const table = (category && category.transitions) || globalTransitions;
        if (!table || typeof table !== 'object' || !Object.keys(table).length) return true;
        const allowed = table[from];
        if (!Array.isArray(allowed)) return false;
        return allowed.indexOf(to) !== -1;
      },
      inventoryPurgePolicy() {
        const operations = this.inventoryCatalog && this.inventoryCatalog.operations;
        if (!operations || !operations.purge || typeof operations.purge !== 'object') return null;
        return Object.assign({ environment: text(operations.environment) }, operations.purge);
      },
      inventoryEnvironmentLabel() {
        const policy = this.inventoryPurgePolicy();
        if (!policy) return tr('ui.inventory.placeholder.unknown_environment');
        if (policy.environment === 'production') return tr('ui.inventory.environment.production');
        if (policy.environment === 'development') return tr('ui.inventory.environment.development');
        return policy.environment || tr('ui.inventory.placeholder.unknown_environment');
      },
      inventoryPhotoUrl(asset) {
        if (!asset) return '';
        return text(asset.photoUrl) || text(asset.images && asset.images.photo);
      },
      inventoryFovUrl(asset) {
        if (!asset) return '';
        return text(asset.fovUrl) || text(asset.images && asset.images.fov);
      },
      inventoryCategoryText(categoryRef) {
        const category = this.inventoryCategoryById(categoryRef);
        if (category) return category.label;
        return text(categoryRef);
      },
      inventoryCategoryId(categoryText) {
        const category = this.inventoryCategoryById(categoryText);
        return category ? category.id : '';
      },
      inventoryCategoryLabel(asset) {
        if (!asset) return '—';
        return asset.categoryText || this.inventoryCategoryText(asset.category) || tr('ui.inventory.placeholder.no_category');
      },
      inventoryCategoryImage(categoryRef) {
        const category = this.inventoryCategoryById(categoryRef);
        if (category && category.image) return category.image;
        return imageForCategory(categoryRef);
      },
      filterFromSidebar(categoryId) {
        if (!this.serverInventory) return window.AssetMethods.filterFromSidebar.call(this, categoryId);
        this.inventoryFilters.category = categoryId || 'all';
        if (this.route.name !== 'inventory') this.setHash('#/inventario');
      },
      assetSiteText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.site) || tr('ui.inventory.placeholder.no_site');
        return this.siteLabel(asset.site) || '—';
      },
      assetLocationText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.location) || tr('ui.inventory.placeholder.no_location');
        return this.locationLabel(asset);
      },
      assetResponsibleText(asset) {
        if (!asset) return '—';
        if (asset.serverAsset) return text(asset.responsible);
        return this.assigneeLabel(asset);
      },

      /* ------------------------------------------------------------ assets */
      inventoryMapAsset(dto) {
        if (!dto || typeof dto !== 'object' || !dto.id) return null;
        const meta = this.inventoryStatusMeta(dto.status);
        const categoryText = text(dto.category);
        const category = this.inventoryCategoryId(categoryText) || categoryText;
        const images = dto.images && typeof dto.images === 'object' ? dto.images : {};
        const photoUrl = text(images.photo);
        // The canonical label is display text; the person id is the identity the
        // detail header and the assign dialog act on. Legacy payloads carry only
        // the free-text responsible, so the display falls back to it and no id or
        // canonical label is ever invented from a name.
        const responsibleLabel = text(dto.responsibleLabel);
        const responsibleText = text(dto.responsible) || responsibleLabel;
        const responsiblePersonId = text(dto.responsiblePersonId);
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
          siteId: text(dto.siteId),
          location: text(dto.location),
          locationId: text(dto.locationId),
          responsible: responsibleText,
          responsibleLabel,
          responsiblePersonId,
          assignee: responsibleText,
          assigneeId: responsiblePersonId,
          positionX: text(dto.positionX),
          positionY: text(dto.positionY),
          statusId: meta.value,
          status: meta.label,
          statusTone: meta.tone,
          description: text(dto.description),
          cost: text(dto.cost),
          technical: dto.technical && typeof dto.technical === 'object' ? copy(dto.technical) : {},
          archived: !!dto.archived,
          archivedAt: text(dto.archivedAt),
          archivedBy: text(dto.archivedBy),
          retired: meta.value === 'retired' ? { at: text(dto.updatedAt), reason: '', note: '' } : null,
          createdAt: text(dto.createdAt),
          updatedAt: text(dto.updatedAt),
          images,
          photoUrl,
          fovUrl: text(images.fov),
          image: photoUrl || this.inventoryCategoryImage(category || categoryText),
          hasOwnImage: !!photoUrl,
          fovImage: text(images.fov),
          tech: dto.technical && typeof dto.technical === 'object' ? copy(dto.technical) : {},
          warranty: null,
          history: [],
          anydeskId: text(dto.technical && dto.technical.anydeskId),
          rmmAgentId: text(dto.technical && dto.technical.rmmAgentId),
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
      abortInventoryHistory() {
        const controller = this.inventoryHistory && this.inventoryHistory.controller;
        if (controller) controller.abort();
        if (this.inventoryHistory) this.inventoryHistory.controller = null;
      },
      abortInventoryCatalog() {
        const controller = this.inventoryCatalog && this.inventoryCatalog.controller;
        if (controller) controller.abort();
        if (this.inventoryCatalog) this.inventoryCatalog.controller = null;
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
          this.inventory.error = (error && error.message) || tr('ui.inventory.error.inventory_load_failed');
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
          if (!asset) throw new Error(tr('ui.inventory.error.asset_missing'));
          this.inventoryDetail.asset = asset;
          return true;
        } catch (error) {
          if (epoch !== this.inventoryDetail.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          if (!this.authenticated) return false;
          this.inventoryDetail.asset = error && error.status === 404 ? null : this.inventoryDetail.asset;
          this.inventoryDetail.error = error && error.status === 404
            ? tr('ui.inventory.error.asset_unavailable')
            : (error && error.message) || tr('ui.inventory.error.asset_load_failed');
          return false;
        } finally {
          if (epoch === this.inventoryDetail.epoch) this.inventoryDetail.loading = false;
        }
      },
      async loadInventoryHistory(id, options) {
        const assetId = text(id);
        if (!assetId || !this.inventoryAvailable()) return false;
        const opts = options || {};
        const limit = Math.max(1, Math.min(HISTORY_MAX, Number(opts.limit) || HISTORY_LIMIT));
        const offset = Math.max(0, Number(opts.offset) || 0);
        const epoch = nextEpoch();
        this.abortInventoryHistory();
        const controller = makeController();
        this.inventoryHistory = {
          id: assetId,
          items: this.inventoryHistory && this.inventoryHistory.id === assetId ? this.inventoryHistory.items : [],
          total: this.inventoryHistory && this.inventoryHistory.id === assetId ? this.inventoryHistory.total : 0,
          limit,
          offset,
          loading: true,
          error: '',
          epoch,
          controller
        };
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/assets/' + encodeURIComponent(assetId) + '/history?limit=' + limit + '&offset=' + offset,
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== this.inventoryHistory.epoch || !this.authenticated) return false;
          this.inventoryHistory.items = (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
            id: text(item.id),
            sequence: Number(item.sequence) || 0,
            action: text(item.action),
            title: this.inventoryHistoryTitle(item.action),
            reason: text(item.reason),
            notes: text(item.notes),
            actor: text(item.actorUsername),
            actorId: text(item.actorId),
            source: text(item.source),
            entityType: text(item.entityType) || 'asset',
            entityId: text(item.entityId) || text(item.assetId),
            effectiveAt: text(item.effectiveAt),
            quickCodeOld: text(item.quickCodeOld),
            quickCodeNew: text(item.quickCodeNew),
            statusOld: text(item.statusOld),
            statusNew: text(item.statusNew),
            archivedOld: item.archivedOld === null || item.archivedOld === undefined ? null : !!item.archivedOld,
            archivedNew: item.archivedNew === null || item.archivedNew === undefined ? null : !!item.archivedNew,
            changes: item.changes && typeof item.changes === 'object' ? copy(item.changes) : {},
            recordedAt: text(item.createdAt),
            createdAt: text(item.createdAt)
          }));
          this.inventoryHistory.total = Number(payload.total) || 0;
          this.inventoryHistory.limit = Number(payload.limit) || limit;
          this.inventoryHistory.offset = Number(payload.offset) || offset;
          return true;
        } catch (error) {
          if (epoch !== this.inventoryHistory.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          this.inventoryHistory.error = (error && error.message) || tr('ui.inventory.error.history_load_failed');
          return false;
        } finally {
          if (epoch === this.inventoryHistory.epoch) this.inventoryHistory.loading = false;
        }
      },
      inventoryHistoryTitle(action) {
        const titles = {
          created: 'ui.inventory.history.created',
          updated: 'ui.inventory.history.updated',
          cloned: 'ui.inventory.history.cloned',
          archived: 'ui.inventory.history.archived',
          restored: 'ui.inventory.history.restored',
          retired: 'ui.inventory.history.retired',
          purged: 'ui.inventory.history.purged',
          assigned: 'ui.inventory.history.assigned',
          returned: 'ui.inventory.history.returned',
          transferred: 'ui.inventory.history.transferred',
          relationship_created: 'ui.inventory.history.relationship_created',
          relationship_updated: 'ui.inventory.history.relationship_updated',
          relationship_removed: 'ui.inventory.history.relationship_removed',
          host_moved: 'ui.inventory.history.host_moved'
        };
        const key = titles[text(action)];
        return key ? tr(key) : tr('ui.inventory.history.fallback');
      },
      inventoryHistoryNextPage() {
        const next = this.inventoryHistory.offset + this.inventoryHistory.limit;
        if (next >= this.inventoryHistory.total) return false;
        return this.loadInventoryHistory(this.inventoryHistory.id, { limit: this.inventoryHistory.limit, offset: next });
      },
      clearInventoryState() {
        this.abortInventoryRequest();
        this.abortInventoryDetail();
        this.abortInventoryHistory();
        this.abortInventoryCatalog();
        if (this.inventorySearchTimer) {
          clearTimeout(this.inventorySearchTimer);
          this.inventorySearchTimer = null;
        }
        this.inventory = createState();
        this.inventoryFilters = createFilters();
        this.inventoryDetail = createDetail();
        this.inventoryCatalog = createCatalog();
        this.inventoryHistory = createHistory();
        this.inventoryLifecycle = createLifecycle();
        this.inventoryMediaError = '';
        this.inventoryConfigError = '';
      },
      handleInventoryRoute(next) {
        if (!this.authenticated) {
          this.clearInventoryState();
          return;
        }
        if (next && next.name === 'config' && (next.section === 'activos' || next.section === 'categorias')) {
          if (this.inventoryCatalog.loaded) return Promise.resolve(true);
          return this.loadInventoryCatalog();
        }
        if (next && next.name === 'inventory') {
          const tasks = [];
          if (!this.inventoryCatalog.loaded) tasks.push(this.loadInventoryCatalog());
          if (!this.inventory.loaded) tasks.push(this.loadInventory());
          return Promise.all(tasks);
        }
        if (next && next.name === 'datos') {
          // The Data workspace header reports the canonical inventory total, so
          // every entry re-reads the same state the inventory screen uses. The
          // retained filters stay untouched and the read is not followed by the
          // non-inventory abort fallthrough below, which would cancel it.
          this.abortInventoryDetail();
          this.abortInventoryHistory();
          this.inventoryHistory = createHistory();
          return this.loadInventory();
        }
        if (next && next.name === 'detail' && next.assetId) {
          const tasks = [];
          if (!this.inventoryCatalog.loaded) tasks.push(this.loadInventoryCatalog());
          if (this.inventoryDetail.id !== next.assetId || this.inventoryDetail.error) tasks.push(this.loadInventoryDetail(next.assetId));
          if (this.inventoryHistory.id !== next.assetId) tasks.push(this.loadInventoryHistory(next.assetId));
          return Promise.all(tasks);
        }
        this.abortInventoryRequest();
        this.abortInventoryDetail();
        if (next && next.name !== 'detail') {
          this.abortInventoryHistory();
          this.inventoryHistory = createHistory();
        }
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
      inventoryTechDraft(categoryRef, technical) {
        const fields = this.inventoryAssociatedFields(categoryRef);
        const source = technical && typeof technical === 'object' ? technical : {};
        const draft = {};
        fields.forEach((field) => {
          const value = source[field.key];
          if (value === undefined || value === null || value === '') {
            draft[field.key] = field.default !== null && field.default !== undefined ? field.default : '';
          } else {
            draft[field.key] = value;
          }
        });
        return draft;
      },
      openAssetCreate() {
        if (!this.inventoryCatalogReady) {
          this.assetEditor = { open: false, mode: 'create', real: true, id: '', advancedOpen: false, category: '', error: tr('ui.inventory.error.config_missing'), saving: false, draft: {} };
          this.assetEditorErrors = {};
          return false;
        }
        const active = this.inventoryCategoryChoices;
        const preferred = active.find((category) => category.id === (this.prefs && this.prefs.category)) || active[0] || null;
        if (!preferred) {
          this.assetEditor = { open: false, mode: 'create', real: true, id: '', advancedOpen: false, category: '', error: tr('ui.inventory.error.no_active_categories'), saving: false, draft: {} };
          this.assetEditorErrors = {};
          return false;
        }
        const activeStatuses = this.inventoryStatusChoices;
        this.assetEditor = {
          open: true,
          mode: 'create',
          real: true,
          id: '',
          advancedOpen: false,
          category: preferred.id,
          error: '',
          saving: false,
          draft: {
            id: '',
            quickCode: '',
            name: '',
            category: preferred.id,
            categoryText: preferred.label,
            type: preferred.type,
            brand: '',
            model: '',
            serial: '',
            ip: '',
            site: '',
            location: '',
            responsible: '',
            statusId: activeStatuses.length ? activeStatuses[0].value : 'in_use',
            description: '',
            cost: '',
            technical: this.inventoryTechDraft(preferred, {}),
            photoUrl: '',
            fovUrl: ''
          }
        };
        this.assetEditorErrors = {};
        this.inventoryMediaError = '';
        return true;
      },
      openAssetEdit(asset) {
        if (!asset) return false;
        if (!asset.serverAsset) return window.AssetAdminMethods.openAssetEdit.call(this, asset);
        const category = this.inventoryCategoryById(asset.categoryText || asset.category);
        this.assetEditor = {
          open: true,
          mode: 'edit',
          real: true,
          id: asset.id,
          advancedOpen: false,
          category: category ? category.id : asset.category,
          error: '',
          saving: false,
          draft: {
            id: asset.id,
            quickCode: asset.quickCode,
            name: asset.name,
            category: category ? category.id : asset.category,
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
            originalStatus: asset.statusId,
            description: asset.description,
            cost: this.inventoryCostInput(asset.cost),
            technical: this.inventoryTechDraft(asset.categoryText || asset.category, asset.technical),
            photoUrl: this.inventoryPhotoUrl(asset),
            fovUrl: this.inventoryFovUrl(asset),
            originalQuickCode: asset.quickCode
          }
        };
        this.assetEditorErrors = {};
        this.inventoryMediaError = '';
        return true;
      },
      inventoryCostInput(value) {
        const raw = text(typeof value === 'number' ? value.toFixed(2) : value);
        return raw ? raw : '';
      },
      inventoryCostValue(value) {
        const raw = text(value);
        if (!raw) return null;
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) return null;
        return amount.toFixed(2);
      },
      inventoryTechnicalPayload(categoryRef, technical, editing) {
        const fields = this.inventoryAssociatedFields(categoryRef);
        const source = technical && typeof technical === 'object' ? technical : {};
        const payload = {};
        fields.forEach((field) => {
          const value = source[field.key];
          const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
          if (empty) {
            if (editing) payload[field.key] = null;
            return;
          }
          if (field.type === 'number') {
            const parsed = Number(value);
            payload[field.key] = Number.isFinite(parsed) ? parsed : value;
          } else if (field.type === 'boolean') {
            payload[field.key] = value === true || value === 'true' || value === 1 || value === '1';
          } else {
            payload[field.key] = String(value).trim();
          }
        });
        return payload;
      },
      applyAssetCategory(categoryId) {
        window.AssetAdminMethods.applyAssetCategory.call(this, categoryId);
        if (!this.assetEditor || !this.assetEditor.real || !this.assetEditor.draft) return;
        const draft = this.assetEditor.draft;
        draft.technical = this.inventoryTechDraft(categoryId, draft.technical || {});
      },
      assetCommonField(key) {
        const inventoryFields = {
          location: { key: 'location', label: tr('ui.inventory.field.location') },
          responsible: { key: 'responsible', label: tr('ui.inventory.field.responsible') },
          quickCode: { key: 'quickCode', label: tr('ui.inventory.field.quick_code') },
          cost: { key: 'cost', label: tr('ui.inventory.field.cost') },
          description: { key: 'description', label: tr('ui.inventory.field.description') },
          status: { key: 'status', label: tr('ui.inventory.field.status') }
        };
        if (inventoryFields[key]) return inventoryFields[key];
        return window.AssetSchema.COMMON_FIELDS.find((field) => field.key === key) || null;
      },
      assetFormKeys(bucket, categoryId) {
        if (this.assetEditor && this.assetEditor.real) {
          return this.inventoryFormKeys(bucket, categoryId || this.assetEditor.category);
        }
        return window.AssetAdminMethods.assetFormKeys.call(this, bucket, categoryId);
      },
      validateInventoryDraft(draft) {
        const errors = {};
        if (!text(draft.name)) errors.name = tr('ui.inventory.validation.name_required');
        else if (text(draft.name).length > MAX_NAME) errors.name = tr('ui.inventory.validation.max_length', { max: MAX_NAME });
        if (!this.inventoryCategoryById(draft.category || draft.categoryText)) errors.category = tr('ui.inventory.validation.category_required');
        if (draft.ip && !/^[0-9a-zA-Z.:-]+$/.test(text(draft.ip))) errors.ip = tr('ui.inventory.validation.ip_format');
        if (text(draft.site).length > MAX_TEXT) errors.site = tr('ui.inventory.validation.max_length', { max: MAX_TEXT });
        if (text(draft.location).length > MAX_TEXT) errors.location = tr('ui.inventory.validation.max_length', { max: MAX_TEXT });
        if (text(draft.responsible).length > MAX_TEXT) errors.responsible = tr('ui.inventory.validation.max_length', { max: MAX_TEXT });
        if (text(draft.quickCode).length > QUICK_CODE_MAX) errors.quickCode = tr('ui.inventory.validation.max_length', { max: QUICK_CODE_MAX });
        const status = (this.inventoryCatalog.statuses || []).find((item) => item.id === draft.statusId);
        if (!status || status.active === false) {
          errors.statusId = tr('ui.inventory.validation.status_required');
        } else if (this.assetEditor && this.assetEditor.mode === 'edit') {
          const original = (this.inventoryDetail.asset && this.inventoryDetail.asset.statusId) || draft.statusId;
          if (draft.statusId !== original && !this.inventoryStatusAllowed(draft.category, original, draft.statusId)) {
            errors.statusId = tr('ui.inventory.validation.status_transition');
          }
        }
        const cost = text(draft.cost);
        if (cost && this.inventoryCostValue(cost) === null) errors.cost = tr('ui.inventory.validation.cost_format');
        const technical = draft.technical && typeof draft.technical === 'object' ? draft.technical : {};
        this.inventoryAssociatedFields(draft.category).forEach((field) => {
          const value = technical[field.key];
          const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
          if (field.required && empty) {
            errors['technical.' + field.key] = tr('ui.inventory.validation.field_required');
            return;
          }
          if (empty) return;
          if (field.type === 'number') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) errors['technical.' + field.key] = tr('ui.inventory.validation.number_invalid');
            else if (field.minimum !== null && parsed < field.minimum) errors['technical.' + field.key] = tr('ui.inventory.validation.number_min', { min: field.minimum });
            else if (field.maximum !== null && parsed > field.maximum) errors['technical.' + field.key] = tr('ui.inventory.validation.number_max', { max: field.maximum });
          } else if (field.type === 'select' && field.options.length && field.options.indexOf(String(value)) === -1) {
            errors['technical.' + field.key] = tr('ui.inventory.validation.option_required');
          } else if (field.type !== 'boolean' && String(value).length > (field.maxLength || 500)) {
            errors['technical.' + field.key] = tr('ui.inventory.validation.max_length', { max: field.maxLength || 500 });
          }
        });
        return errors;
      },
      canAssignResponsible() {
        return !!(this.can && this.can('assets.assign'));
      },
      assetFieldLocked(key) {
        return key === 'responsible' && !this.canAssignResponsible();
      },
      inventoryPayload(draft, mode) {
        const editing = mode === 'edit' || (this.assetEditor && this.assetEditor.mode === 'edit');
        const payload = { name: text(draft.name) };
        ['type', 'brand', 'model', 'serial', 'ip', 'site', 'location', 'description'].forEach((key) => {
          const value = text(draft[key]);
          if (value) payload[key] = value;
          else if (editing) payload[key] = '';
        });
        const category = this.inventoryCategoryById(draft.category || draft.categoryText);
        const categoryLabel = category ? category.label : text(draft.categoryText);
        if (categoryLabel) payload.category = categoryLabel;
        else if (editing) payload.category = '';
        payload.status = draft.statusId;
        const cost = this.inventoryCostValue(draft.cost);
        if (cost !== null) payload.cost = cost;
        else if (editing) payload.cost = null;
        const technical = this.inventoryTechnicalPayload(draft.category, draft.technical, editing);
        if (Object.keys(technical).length) payload.technical = technical;
        else if (editing) payload.technical = {};
        // The server requires assets.assign to change the responsible person, so a
        // caller without it never proposes that field.
        if (!this.assetFieldLocked('responsible')) {
          const responsible = text(draft.responsible);
          if (responsible) payload.responsible = responsible;
          else if (editing) payload.responsible = '';
        }
        const quickCode = text(draft.quickCode);
        const originalQuickCode = text(draft.originalQuickCode);
        if (quickCode && (!editing || quickCode !== originalQuickCode)) payload.quickCode = quickCode;
        else if (editing && originalQuickCode && !quickCode) payload.quickCode = null;
        return payload;
      },
      async saveAsset() {
        if (!this.assetEditor.real) return window.AssetAdminMethods.saveAsset.call(this);
        if (this.assetEditor.saving) return false;
        if (!this.inventoryCatalogReady) {
          this.assetEditor.error = tr('ui.inventory.error.save_config_missing');
          return false;
        }
        const draft = this.assetEditor.draft;
        const errors = this.validateInventoryDraft(draft);
        this.assetEditorErrors = errors;
        if (Object.keys(errors).length) {
          this.assetEditor.error = tr('ui.inventory.error.draft_invalid');
          return false;
        }
        const isCreate = this.assetEditor.mode === 'create';
        const path = isCreate ? '/assets' : '/assets/' + encodeURIComponent(this.assetEditor.id);
        // The save is only surfaced if the session and inventory epoch are still
        // the ones that started it; a logout or reset must not revive the UI.
        const epoch = this.inventory.epoch;
        this.assetEditor.saving = true;
        this.assetEditor.error = '';
        this.inventoryMediaError = '';
        try {
          const payload = await window.AssetAccess.request(this, path, {
            method: isCreate ? 'POST' : 'PATCH',
            body: this.inventoryPayload(draft, isCreate ? 'create' : 'edit')
          });
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const saved = this.inventoryMapAsset(payload);
          this.assetEditor.saving = false;
          this.closeAssetEditor();
          await this.loadInventory();
          if (saved) {
            if (this.inventoryDetail.id === saved.id) await this.loadInventoryDetail(saved.id);
            this.showToast(isCreate
              ? tr('ui.inventory.toast.asset_created', { id: saved.id })
              : tr('ui.inventory.toast.asset_updated', { id: saved.id }));
            this.openAsset(saved);
          }
          return saved || true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const fieldErrors = Object.assign({}, error.fieldErrors || {});
          if (error.status === 409) {
            fieldErrors.quickCode = tr('ui.inventory.error.quick_code_taken');
            this.assetEditor.error = tr('ui.inventory.error.quick_code_unique');
          } else if (error.status === 403) {
            this.assetEditor.error = error.message || tr('ui.inventory.error.asset_save_forbidden');
          } else if (error.status === 422) {
            this.assetEditor.error = error.message || tr('ui.inventory.error.draft_invalid');
          } else {
            this.assetEditor.error = error.message || tr('ui.inventory.error.asset_save_failed');
          }
          this.assetEditorErrors = fieldErrors;
          return false;
        } finally {
          if (this.assetEditor) this.assetEditor.saving = false;
        }
      },

      /* --------------------------------------------------------- lifecycle */
      inventoryLifecycleAllowed(kind, asset) {
        if (!asset || !asset.serverAsset) return tr('ui.inventory.error.lifecycle_server_only');
        if (kind === 'purge') {
          const policy = this.inventoryPurgePolicy();
          if (!policy) return tr('ui.inventory.error.purge_policy_missing');
          if (!this.can || !this.can(policy.permission)) return tr('ui.inventory.error.purge_forbidden');
          if (policy.archivedRequired && !asset.archived) return tr('ui.inventory.error.purge_needs_archive');
          return '';
        }
        if (kind === 'archive' && asset.archived) return tr('ui.inventory.error.already_archived');
        if (kind === 'restore' && !asset.archived) return tr('ui.inventory.error.restore_requires_archive');
        if (kind === 'retire' && asset.archived) return tr('ui.inventory.error.retire_requires_restore');
        if (!this.can || !this.can('assets.edit')) return tr('ui.inventory.error.lifecycle_forbidden');
        return '';
      },
      openInventoryLifecycle(asset, kind) {
        const action = ['archive', 'restore', 'retire', 'purge'].indexOf(kind) !== -1 ? kind : '';
        if (!action || !asset) return false;
        const problem = this.inventoryLifecycleAllowed(action, asset);
        this.inventoryLifecycle = {
          open: !problem,
          kind: action,
          assetId: asset.id,
          asset: lifecycleAsset(asset),
          assetName: asset.name,
          reason: '',
          typed: '',
          error: problem,
          busy: false
        };
        return !problem;
      },
      closeInventoryLifecycle() {
        if (this.inventoryLifecycle && this.inventoryLifecycle.busy) return false;
        this.inventoryLifecycle = createLifecycle();
        return true;
      },
      async confirmInventoryLifecycle() {
        const dialog = this.inventoryLifecycle;
        if (!dialog || !dialog.open || dialog.busy) return false;
        const asset = dialog.asset
          || (this.inventoryDetail.asset && this.inventoryDetail.asset.id === dialog.assetId ? this.inventoryDetail.asset : null)
          || (this.inventory.items || []).find((item) => item.id === dialog.assetId)
          || null;
        const problem = this.inventoryLifecycleAllowed(dialog.kind, asset);
        if (problem) {
          dialog.error = problem;
          return false;
        }
        const reason = text(dialog.reason);
        const body = {};
        if (dialog.kind === 'purge') {
          const policy = this.inventoryPurgePolicy();
          body.confirm = true;
          if (policy.typedIdRequired) {
            if (text(dialog.typed) !== dialog.assetId) {
              dialog.error = tr('ui.inventory.error.purge_typed_id');
              return false;
            }
            body.typedId = dialog.assetId;
          }
          if (policy.reasonRequired) {
            if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
              dialog.error = tr('ui.inventory.error.reason_range', { min: REASON_MIN, max: REASON_MAX });
              return false;
            }
            body.reason = reason;
          } else if (reason) {
            body.reason = reason;
          }
        } else if (dialog.kind === 'archive') {
          if (reason.length > REASON_MAX) {
            dialog.error = tr('ui.inventory.validation.max_length', { max: REASON_MAX });
            return false;
          }
          if (reason) body.reason = reason;
        } else if (dialog.kind === 'retire') {
          if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
            dialog.error = tr('ui.inventory.error.reason_range', { min: REASON_MIN, max: REASON_MAX });
            return false;
          }
          body.reason = reason;
        }
        const path = '/assets/' + encodeURIComponent(dialog.assetId) + '/' + dialog.kind;
        const epoch = this.inventory.epoch;
        dialog.busy = true;
        dialog.error = '';
        try {
          await window.AssetAccess.request(this, path, { method: 'POST', body: body });
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const kind = dialog.kind;
          this.inventoryLifecycle = createLifecycle();
          await this.loadInventory();
          if (this.inventoryDetail.id === dialog.assetId) await this.loadInventoryDetail(dialog.assetId);
          if (this.inventoryHistory.id === dialog.assetId) await this.loadInventoryHistory(dialog.assetId);
          const messages = {
            archive: 'ui.inventory.toast.archived',
            restore: 'ui.inventory.toast.restored',
            retire: 'ui.inventory.toast.retired',
            purge: 'ui.inventory.toast.purged'
          };
          this.showToast(messages[kind] ? tr(messages[kind]) : tr('ui.inventory.toast.operation_done'));
          if (kind === 'purge') this.setHash('#/inventario');
          return true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          dialog.error = (error && error.message) || tr('ui.inventory.error.operation_incomplete');
          return false;
        } finally {
          if (this.inventoryLifecycle) this.inventoryLifecycle.busy = false;
        }
      },
      async cloneInventoryAsset(asset, quickCode) {
        if (!asset || !asset.serverAsset) return false;
        if (!this.can || !this.can('assets.edit')) return false;
        const epoch = this.inventory.epoch;
        const body = text(quickCode) ? { quickCode: text(quickCode) } : {};
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(asset.id) + '/clone', { method: 'POST', body: body });
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const saved = this.inventoryMapAsset(payload);
          await this.loadInventory();
          this.showToast(saved ? tr('ui.inventory.toast.cloned', { id: saved.id }) : tr('ui.inventory.toast.clone_done'));
          if (saved) this.openAsset(saved);
          return saved || true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          this.showToast((error && error.message) || tr('ui.inventory.error.clone_failed'), 'error');
          return false;
        }
      },
      async archiveInventoryAsset(asset, reason) {
        const opened = this.openInventoryLifecycle(asset, 'archive');
        if (!opened) return false;
        this.inventoryLifecycle.reason = lifecycleReasonText(reason);
        return this.confirmInventoryLifecycle();
      },
      async restoreInventoryAsset(asset) {
        const opened = this.openInventoryLifecycle(asset, 'restore');
        if (!opened) return false;
        return this.confirmInventoryLifecycle();
      },
      async retireInventoryAsset(asset, reason) {
        const reasonText = lifecycleReasonText(reason);
        if (reasonText.length < REASON_MIN) {
          this.inventoryLifecycle = Object.assign(createLifecycle(), {
            kind: 'retire',
            assetId: asset ? asset.id : '',
            error: tr('ui.inventory.error.retire_reason_short', { min: REASON_MIN })
          });
          return false;
        }
        const opened = this.openInventoryLifecycle(asset, 'retire');
        if (!opened) return false;
        this.inventoryLifecycle.reason = reasonText;
        return this.confirmInventoryLifecycle();
      },
      async purgeInventoryAsset(asset, options) {
        const opts = options || {};
        const opened = this.openInventoryLifecycle(asset, 'purge');
        if (!opened) return false;
        this.inventoryLifecycle.typed = text(opts.typedId);
        this.inventoryLifecycle.reason = text(opts.reason);
        return this.confirmInventoryLifecycle();
      },

      /* -------------------------------------------------------------- media */
      inventoryImageAllowed(asset, role) {
        if (!asset || !asset.id) return false;
        if (IMAGE_ROLES.indexOf(role) === -1) return false;
        if (role === 'fov') return this.inventoryCategoryHasFov(asset.categoryText || asset.category);
        return true;
      },
      async uploadInventoryImage(asset, role, file) {
        this.inventoryMediaError = '';
        if (!this.can || !this.can('assets.edit')) {
          this.inventoryMediaError = tr('ui.inventory.error.media_forbidden');
          return false;
        }
        if (!this.inventoryImageAllowed(asset, role)) {
          this.inventoryMediaError = role === 'fov'
            ? tr('ui.inventory.error.fov_camera_only')
            : tr('ui.inventory.error.image_not_allowed');
          return false;
        }
        const type = text(file && file.type);
        const size = Number(file && file.size) || 0;
        if (IMAGE_TYPES.indexOf(type) === -1) {
          this.inventoryMediaError = tr('ui.inventory.error.image_type');
          return false;
        }
        if (!size || size > IMAGE_MAX_BYTES) {
          this.inventoryMediaError = tr('ui.inventory.error.image_size');
          return false;
        }
        if (typeof file.arrayBuffer !== 'function') {
          this.inventoryMediaError = tr('ui.inventory.error.file_read');
          return false;
        }
        const epoch = this.inventory.epoch;
        try {
          const buffer = await file.arrayBuffer();
          const payload = await window.AssetAccess.request(
            this,
            '/assets/' + encodeURIComponent(asset.id) + '/images/' + role,
            { method: 'PUT', body: buffer }
          );
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          const url = text(payload && payload.url);
          if (this.assetEditor && this.assetEditor.open && this.assetEditor.id === asset.id) {
            if (role === 'photo') this.assetEditor.draft.photoUrl = url;
            else this.assetEditor.draft.fovUrl = url;
          }
          await this.loadInventory();
          if (this.inventoryDetail.id === asset.id) await this.loadInventoryDetail(asset.id);
          this.showToast(role === 'fov' ? tr('ui.inventory.toast.fov_updated') : tr('ui.inventory.toast.photo_updated'));
          return true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          this.inventoryMediaError = (error && error.message) || tr('ui.inventory.error.image_upload_failed');
          return false;
        }
      },
      async removeInventoryImage(asset, role) {
        this.inventoryMediaError = '';
        if (!asset || !asset.id || IMAGE_ROLES.indexOf(role) === -1) return false;
        if (!this.can || !this.can('assets.edit')) {
          this.inventoryMediaError = tr('ui.inventory.error.media_forbidden');
          return false;
        }
        const epoch = this.inventory.epoch;
        try {
          await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(asset.id) + '/images/' + role, { method: 'DELETE' });
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          if (this.assetEditor && this.assetEditor.open && this.assetEditor.id === asset.id) {
            if (role === 'photo') this.assetEditor.draft.photoUrl = '';
            else this.assetEditor.draft.fovUrl = '';
          }
          await this.loadInventory();
          if (this.inventoryDetail.id === asset.id) await this.loadInventoryDetail(asset.id);
          this.showToast(role === 'fov' ? tr('ui.inventory.toast.fov_removed') : tr('ui.inventory.toast.photo_removed'));
          return true;
        } catch (error) {
          if (!this.authenticated || epoch !== this.inventory.epoch) return false;
          this.inventoryMediaError = (error && error.message) || tr('ui.inventory.error.image_delete_failed');
          return false;
        }
      },

      /* ------------------------------------------------------- configuration */
      inventoryFieldValue(asset, field) {
        if (!asset || !field) return '—';
        const values = asset.technical || {};
        const value = values[field.key];
        if (value === undefined || value === null || value === '') return '—';
        if (field.type === 'boolean' || typeof value === 'boolean') return value ? tr('ui.inventory.boolean_yes') : tr('ui.inventory.boolean_no');
        const suffix = field.unit ? ' ' + field.unit : '';
        return String(value) + suffix;
      },
      openDeleteAsset(asset) {
        if (asset && asset.serverAsset) return this.openInventoryLifecycle('purge', asset);
        return window.AssetAdminMethods.openDeleteAsset.call(this, asset);
      },
      deleteAssetIsProtected() {
        if (this.inventoryCatalogReady) {
          const policy = this.inventoryPurgePolicy();
          return !!(policy && policy.typedIdRequired);
        }
        return window.AssetAdminMethods.deleteAssetIsProtected.call(this);
      },
      assetImage(asset) {
        if (!asset) return FALLBACK_IMAGE;
        if (!asset.serverAsset) return window.AssetConfigMethods.assetImage.call(this, asset);
        const own = this.inventoryPhotoUrl(asset);
        if (own) return own;
        const category = this.inventoryCategoryById(asset.categoryText || asset.category);
        return (category && category.image) || CATEGORY_IMAGES[category ? category.id : ''] || FALLBACK_IMAGE;
      },
      inventoryServerMode() {
        // A started session or an authenticated user means the server owns the
        // catalog; prototype configuration is only valid without either.
        return !!(this.authenticated || this.__assetAccess);
      },
      inventoryPrototypeMode() {
        return !this.inventoryServerMode();
      },
      inventoryConfigUnavailable() {
        this.inventoryConfigError = tr('ui.inventory.error.config_unavailable');
        if (this.showToast) this.showToast(this.inventoryConfigError, 'error');
        return false;
      },
      inventoryConfigFields() {
        if (this.inventoryCatalogReady) return this.inventoryCatalog.fields;
        return this.inventoryPrototypeMode() ? this.assetAdmin.fields : [];
      },
      inventoryConfigStatuses() {
        if (this.inventoryCatalogReady) return this.inventoryCatalog.statuses;
        return this.inventoryPrototypeMode() ? this.assetAdmin.statuses : [];
      },
      inventoryConfigCategories() {
        if (this.inventoryCatalogReady) return this.inventoryCatalog.categories;
        return this.inventoryPrototypeMode() ? this.config.categories : [];
      },
      inventoryCommonFieldOptions() {
        if (!this.inventoryCatalogReady) return this.inventoryPrototypeMode() ? null : [];
        const keys = this.inventoryCatalog.commonFields || [];
        return keys
          .filter((key) => ['category', 'image', 'warranty'].indexOf(key) === -1)
          .map((key) => {
            const aliased = COMMON_KEY_ALIASES[key] || key;
            const meta = window.AssetAdminMethods.assetCommonField.call(this, aliased);
            return { key: key, label: meta ? meta.label : key };
          });
      },
      inventoryRules() {
        const rules = (this.inventoryCatalog && this.inventoryCatalog.rules) || {};
        const identification = rules.identification || {};
        return Object.assign({ separator: '-', quickPad: 3, siteCodeLength: 3, includeSite: true, order: 'site-type', siteCodes: {} }, identification);
      },
      inventoryRulesDraft() {
        return this.assetIdRulesDraftReal || this.inventoryRules();
      },
      setOperationsMode() {
        if (this.inventoryServerMode()) {
          this.showToast(tr('ui.inventory.environment_server_defined', { environment: this.inventoryEnvironmentLabel() }), 'error');
          return false;
        }
        return window.AssetAdminMethods.setOperationsMode.apply(this, arguments);
      },
      assetForm(categoryId) {
        if (this.inventoryCatalogReady) {
          const category = this.inventoryCategoryById(categoryId);
          if (category) {
            return {
              prefix: category.prefix,
              type: category.type,
              fov: !!category.fov,
              quick: category.quick.slice(),
              advanced: category.advanced.slice(),
              tech: category.tech.slice()
            };
          }
        }
        if (this.inventoryServerMode()) return { prefix: '', type: '', fov: false, quick: [], advanced: [], tech: [] };
        return window.AssetAdminMethods.assetForm.call(this, categoryId);
      },
      assetFieldUsage(field) {
        if (!this.inventoryCatalogReady) return this.inventoryPrototypeMode() ? window.AssetAdminMethods.assetFieldUsage.call(this, field) : 0;
        const key = field && field.key;
        return this.inventoryCatalog.categories.filter((category) => [].concat(category.quick, category.advanced, category.tech).indexOf(key) !== -1).length;
      },
      assetStatusUsage(status) {
        if (!this.inventoryCatalogReady) return this.inventoryPrototypeMode() ? window.AssetAdminMethods.assetStatusUsage.call(this, status) : tr('ui.inventory.status_usage');
        return tr('ui.inventory.status_usage');
      },
      assetQuickPreview() {
        if (!this.inventoryCatalogReady) return this.inventoryPrototypeMode() ? window.AssetAdminMethods.assetQuickPreview.call(this) : '';
        const rules = this.inventoryRules();
        const category = this.inventoryCategoryChoices[0];
        const prefix = category ? category.prefix : 'TIPO';
        const pad = Number(rules.quickPad) || 2;
        const number = '1'.padStart(pad, '0');
        if (rules.includeSite === false) return prefix + rules.separator + number;
        const site = 'CEN';
        return rules.order === 'type-site'
          ? prefix + rules.separator + site + rules.separator + number
          : site + rules.separator + prefix + rules.separator + number;
      },
      resetAssetIdRules() {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.resetAssetIdRules.call(this);
        }
        this.assetIdRulesDraftReal = JSON.parse(JSON.stringify(this.inventoryRules()));
        const transitions = (this.inventoryCatalog.rules && this.inventoryCatalog.rules.transitions && this.inventoryCatalog.rules.transitions.transitions) || {};
        this.inventoryTransitionsDraft = Object.keys(transitions).reduce((rows, from) => {
          (transitions[from] || []).forEach((to) => rows.push({ from, to }));
          return rows;
        }, []);
        this.inventoryConfigError = '';
      },
      async saveAssetIdRules() {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.saveAssetIdRules.call(this);
        }
        return this.saveInventoryRules(this.assetIdRulesDraftReal || this.inventoryRules());
      },
      openAssetField(field) {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.openAssetField.call(this, field);
        }
        if (!this.inventoryCanConfigure('fields')) return false;
        const source = field || {};
        this.fieldDialog = {
          open: true,
          mode: field ? 'edit' : 'create',
          key: source.key || '',
          label: source.label || '',
          type: source.type || 'text',
          unit: source.unit || '',
          options: (source.options || []).join(', '),
          hint: source.hint || '',
          active: source.active !== false,
          required: !!source.required,
          maxLength: source.maxLength !== undefined ? source.maxLength : ''
        };
        this.fieldDialogErrors = {};
        this.inventoryConfigError = '';
        return true;
      },
      async saveAssetField() {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.saveAssetField.call(this);
        }
        const saved = await this.saveInventoryField(this.fieldDialog);
        if (saved) {
          this.fieldDialog = Object.assign({}, this.fieldDialog, { open: false });
          this.showToast(tr('ui.inventory.toast.field_saved'));
        }
        return saved;
      },
      async setAssetFieldActive(field, active) {
        if (!field) return false;
        const saved = await this.saveInventoryField({
          mode: 'edit',
          key: field.key,
          label: field.label,
          type: field.type,
          unit: field.unit,
          hint: field.hint,
          options: (field.options || []).join(', '),
          active: active,
          required: !!field.required,
          maxLength: field.maxLength,
          minimum: field.minimum,
          maximum: field.maximum,
          default: field.default
        });
        if (saved) this.showToast(active ? tr('ui.inventory.toast.field_activated') : tr('ui.inventory.toast.field_deactivated'));
        return saved;
      },
      openAssetStatusDialog(status) {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.openAssetStatusDialog.call(this, status);
        }
        if (!this.inventoryCanConfigure('statuses')) return false;
        const source = status || {};
        this.assetStatusDialog = {
          open: true,
          mode: status ? 'edit' : 'create',
          id: source.id || '',
          label: source.label || '',
          tone: source.tone || 'hold',
          final: !!source.final,
          active: source.active !== false
        };
        this.assetStatusErrors = {};
        this.inventoryConfigError = '';
        return true;
      },
      async saveAssetStatus() {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.saveAssetStatus.call(this);
        }
        const saved = await this.saveInventoryStatus(this.assetStatusDialog);
        if (saved) {
          this.assetStatusDialog = Object.assign({}, this.assetStatusDialog, { open: false });
          this.showToast(tr('ui.inventory.toast.status_saved'));
        }
        return saved;
      },
      async setAssetStatusActive(status, active) {
        if (!status) return false;
        const saved = await this.saveInventoryStatus({
          id: status.id,
          label: status.label,
          tone: status.tone,
          final: !!status.final,
          active: active
        });
        if (saved) this.showToast(active ? tr('ui.inventory.toast.status_activated') : tr('ui.inventory.toast.status_deactivated'));
        return saved;
      },
      openFormDraft(categoryId) {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.openFormDraft.call(this, categoryId);
        }
        if (!this.inventoryCanConfigure('fields')) return false;
        const category = this.inventoryCategoryById(categoryId);
        if (!category) return false;
        this.formDraft = {
          categoryId: category.id,
          form: {
            prefix: category.prefix,
            type: category.type,
            fov: !!category.fov,
            quick: category.quick.slice(),
            advanced: category.advanced.slice(),
            tech: category.tech.slice()
          }
        };
        this.formDraftError = '';
        return true;
      },
      async saveFormDraft() {
        if (!this.inventoryCatalogReady) {
          return this.inventoryServerMode() ? this.inventoryConfigUnavailable() : window.AssetAdminMethods.saveFormDraft.call(this);
        }
        if (!this.formDraft) return false;
        if (!text(this.formDraft.form.prefix)) {
          this.formDraftError = tr('ui.inventory.error.form_prefix_required');
          return false;
        }
        const saved = await this.saveInventoryForm(this.formDraft.categoryId);
        if (saved) {
          this.showToast(tr('ui.inventory.toast.form_saved'));
          this.closeFormDraft();
        } else if (!this.formDraftError) {
          this.formDraftError = this.inventoryConfigError || tr('ui.inventory.error.form_save_failed');
        }
        return saved;
      },
      openCategoryDialog(category) {
        if (!this.inventoryServerMode()) return window.AssetConfigMethods.openCategoryDialog.call(this, category);
        if (!this.inventoryCatalogReady) return this.inventoryConfigUnavailable();
        if (!this.can('config.categories')) { this.requirePermission('config.categories'); return false; }
        const source = category ? this.inventoryCategoryById(category.id) : null;
        this.categoryDialog = {
          open: true,
          mode: source ? 'edit' : 'create',
          id: source ? source.id : '',
          label: source ? source.label : '',
          prefix: source ? source.prefix : '',
          type: source ? source.type : '',
          icon: source ? source.icon : 'package',
          active: source ? source.active !== false : true,
          description: source ? source.description : '',
          image: source ? source.image : FALLBACK_IMAGE
        };
        this.categoryErrors = { label: '', prefix: '', general: '' };
        return true;
      },
      async saveCategory() {
        if (!this.inventoryServerMode()) return window.AssetConfigMethods.saveCategory.call(this);
        if (!this.inventoryCatalogReady) return this.inventoryConfigUnavailable();
        if (!this.can('config.categories')) { this.requirePermission('config.categories'); return false; }
        const dialog = this.categoryDialog || {};
        const label = text(dialog.label);
        const prefix = text(dialog.prefix).toLocaleUpperCase('es').replace(/[^A-Z0-9]/g, '').slice(0, 6);
        const errors = { label: '', prefix: '', general: '' };
        if (!label) errors.label = tr('ui.inventory.error.category_name_required');
        else if (label.length > 40) errors.label = tr('ui.inventory.error.category_name_too_long');
        if (!prefix) errors.prefix = tr('ui.inventory.error.category_prefix_required');
        this.categoryErrors = errors;
        if (errors.label || errors.prefix) return false;

        const editing = dialog.mode === 'edit';
        const existing = editing ? this.inventoryCategoryById(dialog.id) : null;
        if (editing && !existing) {
          this.categoryErrors.general = tr('ui.inventory.error.category_unavailable');
          return false;
        }
        const source = existing || { quick: [], advanced: [], tech: [], fov: false, transitions: null };
        const id = editing ? existing.id : slug(label, 'categoria');
        const saved = await this.saveInventoryCategory({
          id: id,
          label: label,
          prefix: prefix,
          type: text(dialog.type) || (existing ? existing.type : label),
          icon: text(dialog.icon) || (existing ? existing.icon : 'package'),
          active: dialog.active !== false,
          fov: !!source.fov,
          quick: source.quick.slice(),
          advanced: source.advanced.slice(),
          tech: source.tech.slice(),
          transitions: source.transitions
        });
        if (saved) {
          this.categoryDialog = Object.assign({}, this.categoryDialog, { open: false });
          this.showToast(editing ? tr('ui.inventory.toast.category_updated') : tr('ui.inventory.toast.category_created'));
        } else if (!this.categoryErrors.general) {
          this.categoryErrors.general = this.inventoryConfigError || tr('ui.inventory.error.category_save_failed');
        }
        return saved;
      },
      inventoryCatalogPermission(kind) {
        return kind === 'fields' || kind === 'categories' ? 'config.categories' : 'config.general';
      },
      inventoryCanConfigure(kind) {
        return !!(this.can && this.can(this.inventoryCatalogPermission(kind)));
      },
      inventoryConfigFailed(kind, error) {
        if (error && error.status === 409) {
          if (kind === 'fields') this.inventoryConfigError = tr('ui.inventory.error.field_immutable');
          else if (kind === 'categories') this.inventoryConfigError = tr('ui.inventory.error.category_conflict');
          else this.inventoryConfigError = tr('ui.inventory.error.config_conflict');
          return false;
        }
        if (error && error.status === 403) {
          this.inventoryConfigError = tr('ui.inventory.error.config_forbidden');
          return false;
        }
        if (error && error.status === 422) {
          this.inventoryConfigError = tr('ui.inventory.error.config_rejected');
          return false;
        }
        this.inventoryConfigError = (error && error.message) || tr('ui.inventory.error.config_save_failed');
        return false;
      },
      async saveInventoryConfig(kind, key, payload) {
        if (!this.inventoryAvailable()) return false;
        if (!this.inventoryCanConfigure(kind)) {
          this.inventoryConfigError = tr('ui.inventory.error.config_forbidden');
          return false;
        }
        const path = '/inventory/config/' + kind + '/' + encodeURIComponent(key);
        const epoch = this.inventoryCatalog.epoch;
        this.inventoryConfigError = '';
        try {
          await window.AssetAccess.request(this, path, { method: 'PUT', body: payload });
          if (!this.authenticated) return false;
          if (epoch !== this.inventoryCatalog.epoch) {
            // A newer catalog load already started; do not claim success for it.
            return true;
          }
          await this.loadInventoryCatalog({ force: true });
          return true;
        } catch (error) {
          if (!this.authenticated) return false;
          return this.inventoryConfigFailed(kind, error);
        }
      },
      inventoryFieldPayload(dialog) {
        const payload = {
          label: text(dialog.label),
          type: text(dialog.type) || 'text',
          active: dialog.active !== false,
          required: !!dialog.required,
          unit: text(dialog.unit),
          hint: text(dialog.hint),
          options: Array.isArray(dialog.options) ? dialog.options.slice() : String(dialog.options || '').split(',').map((item) => text(item)).filter(Boolean)
        };
        if (payload.type === 'select' && !payload.options.length) return null;
        if (dialog.maxLength !== undefined && dialog.maxLength !== '') {
          const maxLength = Number(dialog.maxLength);
          if (!Number.isFinite(maxLength) || maxLength < 1 || maxLength > 500) return null;
          payload.maxLength = maxLength;
        }
        if (dialog.minimum !== undefined && dialog.minimum !== '' && dialog.minimum !== null) {
          const minimum = Number(dialog.minimum);
          if (!Number.isFinite(minimum)) return null;
          payload.minimum = minimum;
        }
        if (dialog.maximum !== undefined && dialog.maximum !== '' && dialog.maximum !== null) {
          const maximum = Number(dialog.maximum);
          if (!Number.isFinite(maximum)) return null;
          payload.maximum = maximum;
        }
        if (dialog.default !== undefined && dialog.default !== null && dialog.default !== '') payload.default = dialog.default;
        return payload;
      },
      async saveInventoryField(dialog) {
        if (!dialog) return false;
        const key = text(dialog.key) || slug(dialog.label, 'campo');
        const payload = this.inventoryFieldPayload(dialog);
        if (!payload || !text(dialog.label)) {
          this.inventoryConfigError = tr('ui.inventory.error.field_label_required');
          return false;
        }
        if (dialog.mode === 'edit' && text(dialog.type) !== text((this.inventoryFieldByKey(key) || {}).type)) {
          this.inventoryConfigError = tr('ui.inventory.error.field_type_immutable');
          return false;
        }
        return this.saveInventoryConfig('fields', key, payload);
      },
      async saveInventoryStatus(dialog) {
        if (!dialog) return false;
        const id = text(dialog.id) || slug(dialog.label, 'estado');
        const payload = {
          label: text(dialog.label),
          tone: ['ok', 'warn', 'hold', 'down'].indexOf(dialog.tone) !== -1 ? dialog.tone : 'hold',
          final: !!dialog.final,
          active: dialog.active !== false
        };
        if (!payload.label) {
          this.inventoryConfigError = tr('ui.inventory.error.status_label_required');
          return false;
        }
        return this.saveInventoryConfig('statuses', id, payload);
      },
      inventoryCategoryPayload(category) {
        const allowed = ['id', 'label', 'prefix', 'type', 'icon', 'active', 'fov', 'quick', 'advanced', 'tech', 'transitions'];
        const payload = {};
        allowed.forEach((key) => {
          if (category[key] !== undefined) payload[key] = category[key];
        });
        return payload;
      },
      async saveInventoryCategory(category) {
        if (!category) return false;
        const label = text(category.label);
        if (!label) {
          this.inventoryConfigError = tr('ui.inventory.error.category_label_required');
          return false;
        }
        const id = text(category.id) || slug(label, 'categoria');
        const payload = this.inventoryCategoryPayload(Object.assign({}, category, {
          id: id,
          label: label,
          prefix: text(category.prefix).toLocaleUpperCase('es').replace(/[^A-Z0-9]/g, '').slice(0, 6),
          type: text(category.type) || label,
          active: category.active !== false
        }));
        if (!payload.prefix) {
          this.inventoryConfigError = tr('ui.inventory.error.category_prefix_required');
          return false;
        }
        return this.saveInventoryConfig('categories', id, payload);
      },
      async saveInventoryForm(categoryId) {
        const source = this.inventoryCategoryById(categoryId);
        if (!source) return false;
        const form = this.formDraft && this.formDraft.form ? this.formDraft.form : null;
        if (!form) return false;
        const payload = this.inventoryCategoryPayload(Object.assign({}, source, {
          prefix: text(form.prefix),
          type: text(form.type),
          fov: !!form.fov,
          quick: Array.isArray(form.quick) ? form.quick : source.quick,
          advanced: Array.isArray(form.advanced) ? form.advanced : source.advanced,
          tech: Array.isArray(form.tech) ? form.tech : source.tech
        }));
        if (!payload.prefix) {
          this.inventoryConfigError = tr('ui.inventory.error.category_prefix_required');
          return false;
        }
        return this.saveInventoryConfig('categories', source.id, payload);
      },
      async saveInventoryRules(rules) {
        const source = rules && typeof rules === 'object' ? rules : {};
        const payload = {};
        if (source.separator !== undefined) payload.separator = text(source.separator) || '-';
        if (source.quickPad !== undefined) payload.quickPad = Number(source.quickPad);
        if (source.siteCodeLength !== undefined) payload.siteCodeLength = Number(source.siteCodeLength);
        if (source.includeSite !== undefined) payload.includeSite = !!source.includeSite;
        if (source.order !== undefined) payload.order = source.order === 'type-site' ? 'type-site' : 'site-type';
        if (source.siteCodes !== undefined && source.siteCodes && typeof source.siteCodes === 'object') payload.siteCodes = source.siteCodes;
        if (!Object.keys(payload).length) return false;
        return this.saveInventoryConfig('rules', 'identification', payload);
      },
      inventoryTransitionRows() {
        const rules = this.inventoryCatalog.rules || {};
        const source = (rules.transitions && rules.transitions.transitions) || {};
        return this.inventoryTransitionsDraft || Object.keys(source).reduce((rows, from) => {
          (source[from] || []).forEach((to) => rows.push({ from, to }));
          return rows;
        }, []);
      },
      addInventoryTransition() {
        const rows = this.inventoryTransitionRows().slice();
        rows.push({ from: '', to: '' });
        this.inventoryTransitionsDraft = rows;
      },
      removeInventoryTransition(index) {
        const rows = this.inventoryTransitionRows().slice();
        rows.splice(index, 1);
        this.inventoryTransitionsDraft = rows;
      },
      async saveInventoryTransitionsDraft() {
        const rows = this.inventoryTransitionRows();
        const transitions = {};
        for (const row of rows) {
          if (!row.from || !row.to || row.from === row.to) continue;
          transitions[row.from] = (transitions[row.from] || []).concat([row.to]);
        }
        const saved = await this.saveInventoryTransitions(transitions);
        if (saved) this.inventoryTransitionsDraft = null;
        return saved;
      },
      async saveInventoryTransitions(transitions) {
        if (!transitions || typeof transitions !== 'object') return false;
        return this.saveInventoryConfig('rules', 'transitions', { transitions: transitions });
      }
    }
  };
})();
