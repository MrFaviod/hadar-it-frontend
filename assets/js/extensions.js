(function () {
  'use strict';

  // Catalog access: every visible string comes from `assets/i18n`; modules keep
  // working without the i18n runtime and render nothing for untranslated copy.
  const i18n = typeof window !== 'undefined' ? window.ItsmI18n : null;
  function tr(key, params) {
    return i18n && typeof i18n.t === 'function' ? i18n.t(key, params) : '';
  }

  const SDK_VERSION = 2;
  const DIGEST_RE = /^[a-f0-9]{64}$/;
  const EXTENSION_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9]*$/;
  const PAGE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const OPERATION_RE = /^[a-z][a-z0-9_]*$/;
  const OPERATION_KINDS = ['handler', 'list', 'get', 'put', 'delete'];
  const PERMISSION_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
  const MAX_CONTRIBUTIONS = 50;

  const runtime = {
    app: null,
    epoch: 0,
    revision: 0
  };

  // Capabilities are host services the backend grants to the module. The
  // frontend only describes them; it never enforces them.
  const CAPABILITY_LABELS = {
    'assets.read': 'Leer activos a través de los servicios públicos del núcleo.',
    'assets.write': 'Crear, actualizar y archivar activos con las reglas del servidor.',
    'incidents.read': 'Consultar incidentes autorizados.',
    'incidents.write': 'Crear incidentes por las operaciones declaradas.',
    'notify': 'Enviar notificaciones por el servicio del host.'
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function decode(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }

  function encode(value) {
    return encodeURIComponent(String(value));
  }

  function emptyState() {
    return {
      items: [],
      loading: false,
      loaded: false,
      error: '',
      identity: '',
      revision: runtime.revision
    };
  }

  function ensureState(vm) {
    if (!vm) return emptyState();
    if (!vm.extensions || typeof vm.extensions !== 'object') vm.extensions = emptyState();
    return vm.extensions;
  }

  function identityKey(vm) {
    const permissions = Array.isArray(vm && vm.serverPermissions)
      ? vm.serverPermissions.slice().sort().join(',')
      : '';
    return [vm && vm.authenticated ? '1' : '0', vm && vm.activeUserId || '', permissions].join('|');
  }

  function emit(vm) {
    runtime.revision += 1;
    const state = ensureState(vm);
    state.revision = runtime.revision;
    publishComposition(vm);
  }

  // Dashboard preferences read this narrow projection to hide/replace named
  // core widgets without persisting extension ids into the closed server
  // workspace catalogue. Disabling the extension removes the overlay again.
  function publishComposition(vm) {
    if (!vm || !vm.dashboard || !window.UIComposition) return;
    const projection = compositionFor(vm);
    const hiddenWidgets = [];
    const replacedWidgets = [];
    Object.keys(projection.hidden).forEach((target) => {
      if (target.indexOf('widget.') === 0) hiddenWidgets.push(target.slice(7));
    });
    Object.keys(projection.replacement).forEach((target) => {
      if (target.indexOf('widget.') === 0) replacedWidgets.push(target.slice(7));
    });
    vm.dashboard.extensionComposition = { hiddenWidgets, replacedWidgets };
  }

  function compositionFor(vm) {
    if (!vm || !window.UIComposition || typeof window.UIComposition.project !== 'function') {
      return { additions: {}, hidden: {}, replacement: {}, ignored: [], candidates: [] };
    }
    const state = ensureState(vm);
    const can = typeof vm.can === 'function' ? vm.can.bind(vm) : null;
    return window.UIComposition.project(state.items, can);
  }

  function componentKey(name) {
    return String(name || '').toLowerCase();
  }

  function addError(errors, message) {
    if (message && errors.indexOf(message) === -1) errors.push(message);
  }

  function normalizeContribution(raw, kind, errors, seen, operations) {
    if (!isPlainObject(raw)) {
      addError(errors, 'Una contribución de ' + kind + ' no es un objeto válido.');
      return null;
    }
    const id = text(raw.id);
    const label = text(raw.label);
    const permission = text(raw.permission);
    if (!PAGE_ID_RE.test(id) || id.length > 64) {
      addError(errors, 'La contribución ' + kind + ' tiene un id no válido.');
      return null;
    }
    if (seen.has(id)) {
      addError(errors, 'La contribución ' + kind + ' repite el id "' + id + '".');
      return null;
    }
    seen.add(id);
    if (!label || label.length > 120) {
      addError(errors, 'La contribución "' + id + '" necesita una etiqueta breve.');
      return null;
    }
    if (!PERMISSION_RE.test(permission) || permission.length > 160) {
      addError(errors, 'La contribución "' + id + '" necesita un permiso del servidor.');
      return null;
    }
    const checked = window.ExtensionViews && typeof window.ExtensionViews.normalizeView === 'function'
      ? window.ExtensionViews.normalizeView(raw.view, operations)
      : { ok: false, error: 'El host no admite vistas declarativas.' };
    if (!checked.ok) {
      addError(errors, 'La contribución "' + id + '" no declara una vista válida. ' + checked.error);
      return null;
    }
    return {
      id,
      label,
      permission,
      icon: text(raw.icon) || (kind === 'page' ? 'package' : 'box'),
      view: checked.value
    };
  }

  function normalizeAction(raw, errors, seen, operations) {
    if (!isPlainObject(raw)) {
      addError(errors, 'La extensión declara una acción no válida.');
      return null;
    }
    const id = text(raw.id);
    const label = text(raw.label);
    const permission = text(raw.permission);
    const operation = text(raw.operation);
    if (!PAGE_ID_RE.test(id) || id.length > 64) {
      addError(errors, 'La acción de activo tiene un id no válido.');
      return null;
    }
    if (seen.has(id)) {
      addError(errors, 'La acción de activo repite el id "' + id + '".');
      return null;
    }
    seen.add(id);
    if (!label || label.length > 80) {
      addError(errors, 'La acción "' + id + '" necesita una etiqueta breve.');
      return null;
    }
    if (!PERMISSION_RE.test(permission) || permission.length > 160) {
      addError(errors, 'La acción "' + id + '" necesita un permiso del servidor.');
      return null;
    }
    if (text(raw.target) !== 'asset.action') {
      addError(errors, 'La acción "' + id + '" solo puede apuntar al contrato asset.action.');
      return null;
    }
    if (!OPERATION_RE.test(operation) || !operations.some((entry) => entry.name === operation)) {
      addError(errors, 'La acción "' + id + '" necesita una operación declarada.');
      return null;
    }
    let confirm = '';
    if (raw.confirm !== undefined) {
      confirm = typeof raw.confirm === 'string' ? text(raw.confirm) : text(raw.confirm && raw.confirm.message);
      if (!confirm) {
        addError(errors, 'La confirmación de la acción "' + id + '" no es válida.');
        return null;
      }
      confirm = confirm.slice(0, 300);
    }
    return { id, label, permission, operation, target: 'asset.action', confirm, icon: text(raw.icon) || 'bolt' };
  }

  function normalizePermission(raw, errors) {
    if (!isPlainObject(raw)) {
      addError(errors, 'El manifiesto contiene un permiso no válido.');
      return null;
    }
    const code = text(raw.code);
    const label = text(raw.label);
    if (!PERMISSION_RE.test(code) || code.length > 160) {
      addError(errors, 'El manifiesto contiene un código de permiso no válido.');
      return null;
    }
    if (!label || label.length > 160) {
      addError(errors, 'El permiso "' + code + '" necesita una etiqueta.');
      return null;
    }
    return {
      code,
      label,
      description: text(raw.description).slice(0, 500)
    };
  }

  function normalizeOperation(raw, errors) {
    if (!isPlainObject(raw)) {
      addError(errors, 'La extensión declara una operación no válida.');
      return null;
    }
    const name = text(raw.name);
    if (!OPERATION_RE.test(name) || name.length > 80) {
      addError(errors, 'La extensión declara un nombre de operación no válido.');
      return null;
    }
    const permission = text(raw.permission);
    if (!PERMISSION_RE.test(permission)) {
      addError(errors, 'La operación "' + name + '" necesita un permiso.');
      return null;
    }
    // The view switch between declarative arguments (`filters`, `data`) and a
    // handler call depends on this kind, so an unknown one is rejected.
    const kind = raw.kind === undefined || raw.kind === '' ? 'handler' : text(raw.kind);
    if (OPERATION_KINDS.indexOf(kind) === -1) {
      addError(errors, 'La operación "' + name + '" declara un tipo no válido.');
      return null;
    }
    return {
      name,
      kind,
      description: text(raw.description).slice(0, 500),
      permission,
      mutation: raw.mutation === true,
      parameters: isPlainObject(raw.parameters) ? raw.parameters : {}
    };
  }

  function frontendUrlFor(rawUrl, id, digest) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('El servidor no informó la URL del módulo.');
    let url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch (_) {
      throw new Error('La URL del módulo no es válida.');
    }
    if (url.origin !== window.location.origin) throw new Error('La URL del módulo debe ser del mismo origen.');
    if (url.username || url.password || url.hash) throw new Error('La URL del módulo no puede incluir credenciales ni fragmentos.');
    const expectedPath = '/api/v1/extensions/' + encode(id) + '/frontend.js';
    if (url.pathname !== expectedPath) throw new Error('La URL del módulo no corresponde a la ruta autorizada.');
    if (url.searchParams.get('digest') !== digest) throw new Error('La URL del módulo no coincide con el digest aprobado.');
    return url.href;
  }

  function normalizeItem(raw) {
    const errors = [];
    if (!isPlainObject(raw)) {
      return {
        id: '', manifest: null, digest: '', enabled: false, version: '', revision: null,
        schemaVersion: null, frontendUrl: '', operations: [], pages: [], assetPanels: [], contributions: [],
        ignoredContributions: [], declaredComponents: [], invalid: 'El servidor devolvió un módulo no válido.', loadError: '', loading: false, loaded: false
      };
    }
    const manifest = isPlainObject(raw.manifest) ? raw.manifest : null;
    const id = manifest ? text(manifest.id) : '';
    if (!manifest) addError(errors, 'El módulo no incluye su manifiesto.');
    if (!EXTENSION_ID_RE.test(id) || id.length > 64) addError(errors, 'El módulo tiene un id no válido.');
    const digest = text(raw.digest);
    if (!DIGEST_RE.test(digest)) addError(errors, 'El módulo no está ligado a un digest SHA-256 válido.');
    const revision = Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : null;
    if (revision === null) addError(errors, 'El servidor no informó la revisión de instalación del módulo.');
    const enabled = raw.enabled === true;
    const version = text(raw.version);
    if (!version) addError(errors, 'El módulo no informa su versión activa.');
    const schemaVersion = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : null;
    if (schemaVersion === null) addError(errors, 'El módulo no informa su versión de esquema.');

    const permissions = [];
    const permissionCodes = new Set();
    list(manifest && manifest.permissions).forEach((entry) => {
      const permission = normalizePermission(entry, errors);
      if (permission && !permissionCodes.has(permission.code)) {
        permissionCodes.add(permission.code);
        permissions.push(permission);
      }
    });

    const operations = [];
    const operationNames = new Set();
    list(raw.operations).concat(list(manifest && manifest.operations)).forEach((entry) => {
      const operation = normalizeOperation(entry, errors);
      if (operation && !operationNames.has(operation.name)) {
        operationNames.add(operation.name);
        operations.push(operation);
      }
    });

    if (manifest && manifest.frontend !== undefined && !isPlainObject(manifest.frontend)) {
      addError(errors, 'El manifiesto declara un frontend no válido.');
    }
    const frontend = isPlainObject(manifest && manifest.frontend) ? manifest.frontend : {};
    const runtimeName = text(manifest && manifest.runtime);
    if (runtimeName !== 'declarative' && runtimeName !== 'sandboxed') {
      addError(errors, 'El manifiesto debe declarar runtime "declarative" o "sandboxed".');
    }
    const requiresUpgrade = text(raw.status) === 'requires_upgrade' || raw.requiresUpgrade === true ||
      !!(manifest && Number.isInteger(manifest.sdkVersion) && manifest.sdkVersion < SDK_VERSION);
    if (frontend.entry !== undefined && runtimeName === 'declarative') {
      addError(errors, 'Una extensión declarativa no puede publicar código de frontend.');
    }
    const capabilities = [];
    list(manifest && manifest.capabilities).forEach((entry) => {
      if (typeof entry !== 'string' || !CAPABILITY_LABELS[entry]) {
        addError(errors, 'El manifiesto declara una capacidad no reconocida.');
        return;
      }
      if (capabilities.indexOf(entry) === -1) capabilities.push(entry);
    });
    let storage = null;
    if (manifest && manifest.storage !== undefined) {
      if (!isPlainObject(manifest.storage) || text(manifest.storage.engine) !== 'sqlite') {
        addError(errors, 'El manifiesto solo puede declarar almacenamiento SQLite propio.');
      } else {
        storage = { engine: 'sqlite' };
      }
    }

    const pages = [];
    const assetPanels = [];
    const widgets = [];
    const pageIds = new Set();
    list(frontend.pages).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const page = normalizeContribution(entry, 'page', errors, pageIds, operations);
      if (page) pages.push(page);
    });
    if (list(frontend.pages).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiadas páginas.');
    const panelIds = new Set();
    list(frontend.assetPanels).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const panel = normalizeContribution(entry, 'assetPanel', errors, panelIds, operations);
      if (panel) assetPanels.push(panel);
    });
    if (list(frontend.assetPanels).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiados paneles de activo.');
    const widgetIds = new Set();
    list(frontend.widgets).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const widget = normalizeContribution(entry, 'widget', errors, widgetIds, operations);
      if (widget) widgets.push(widget);
    });
    if (list(frontend.widgets).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiados widgets.');
    const actions = [];
    const actionIds = new Set();
    list(frontend.actions).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const action = normalizeAction(entry, errors, actionIds, operations);
      if (action) actions.push(action);
    });
    if (list(frontend.actions).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiadas acciones.');

    const contributions = [];
    const ignoredContributions = [];
    if (list(frontend.contributions).length) {
      const seen = new Set();
      list(frontend.contributions).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
        const checked = window.UIComposition && typeof window.UIComposition.normalize === 'function'
          ? window.UIComposition.normalize(entry, { id, manifest, permissions, operations }, seen)
          : { ok: false, error: 'El host no admite composición de la interfaz.' };
        if (checked.ok) {
          seen.add(checked.value.id);
          contributions.push(checked.value);
        } else {
          ignoredContributions.push({ error: checked.error });
        }
      });
    }

    // Only an isolated view needs module code, and that code is fetched by the
    // host and inlined into a sandboxed frame. No host script is ever created.
    const isolated = pages.concat(assetPanels, widgets).some((entry) => entry.view.kind === 'isolated');
    let frontendUrl = '';
    if (isolated) {
      if (runtimeName !== 'sandboxed') {
        addError(errors, 'Solo una extensión con runtime "sandboxed" puede declarar vistas aisladas.');
      }
      try {
        frontendUrl = frontendUrlFor(raw.frontendUrl, id, digest);
      } catch (error) {
        addError(errors, error.message);
      }
    }

    const invalid = errors.join(' ');
    return {
      id,
      manifest,
      digest,
      enabled,
      version,
      revision,
      schemaVersion,
      requiresUpgrade,
      runtime: runtimeName,
      capabilities,
      storage,
      frontendUrl,
      operations,
      permissions,
      pages,
      assetPanels,
      widgets,
      actions,
      contributions,
      ignoredContributions,
      invalid,
      loadError: invalid,
      loading: false,
      loaded: true
    };
  }

  function permissionGroups(vm) {
    const state = ensureState(vm);
    return state.items
      .filter((item) => item.manifest && item.id && !item.invalid)
      .map((item) => ({
        id: 'extension:' + item.id,
        label: (text(item.manifest.name) || item.id) + (item.enabled ? '' : ' (inactiva)'),
        icon: 'package',
        extension: true,
        inactive: !item.enabled,
        permissions: item.permissions.map((permission) => ({
          id: permission.code,
          label: permission.label,
          description: permission.description
        }))
      }))
      .filter((group) => group.permissions.length);
  }

  function publishCatalog(vm) {
    if (window.AssetAccess && typeof window.AssetAccess.setExtensionPermissions === 'function') {
      window.AssetAccess.setExtensionPermissions(permissionGroups(vm));
    }
  }

  function unloadAll(vm) {
    const state = ensureState(vm);
    state.items = [];
    state.loading = false;
    state.loaded = false;
    emit(vm);
  }

  function isCurrentItem(vm, item) {
    if (!vm || !vm.authenticated || !item || !item.enabled || item.invalid || item.requiresUpgrade) return false;
    const state = ensureState(vm);
    return state.items.indexOf(item) !== -1;
  }

  function sync(vm, payload) {
    const state = ensureState(vm);
    if (!payload || payload.sdkVersion !== SDK_VERSION) {
      unloadAll(vm);
      state.error = 'El servidor usa una versión del SDK incompatible. No se cargó ninguna extensión.';
      publishCatalog(vm);
      return false;
    }
    // SDK v2 never executes a module script in this page: the views are data
    // and isolated code lives in a frame created by the host.
    state.items = list(payload.items).map((raw) => normalizeItem(raw));
    state.error = '';
    state.loaded = true;
    state.identity = identityKey(vm);
    publishCatalog(vm);
    emit(vm);
    return true;
  }

  async function load(vm, options) {
    if (!vm || !vm.authenticated || !window.AssetAccess || typeof window.AssetAccess.request !== 'function') return false;
    const state = ensureState(vm);
    const identity = identityKey(vm);
    if (!(options && options.force) && state.loaded && state.identity === identity) return true;
    if (state.identity && state.identity !== identity) unloadAll(vm);
    const epoch = ++runtime.epoch;
    state.loading = true;
    state.error = '';
    try {
      const payload = await window.AssetAccess.request(vm, '/extensions');
      if (epoch !== runtime.epoch || !vm.authenticated || identity !== identityKey(vm)) return false;
      const applied = sync(vm, payload);
      state.loading = false;
      state.identity = identity;
      return applied;
    } catch (error) {
      if (epoch !== runtime.epoch || !vm.authenticated) return false;
      state.loading = false;
      state.error = (error && (error.message || error.error)) || 'No se pudieron consultar las extensiones.';
      state.loaded = false;
      publishCatalog(vm);
      return false;
    }
  }

  function stop(vm) {
    runtime.epoch += 1;
    unloadAll(vm);
    const state = ensureState(vm);
    state.items = [];
    state.loading = false;
    state.loaded = false;
    state.error = '';
    state.identity = '';
    state.compositionFailures = {};
    state.revision = ++runtime.revision;
    publishComposition(vm);
    publishCatalog(vm);
  }

  function routeOverride(route) {
    if (!route) return route;
    if (route.name === 'config' && route.section === 'extensiones') {
      route.candidateId = route.candidateId || '';
    }
    return route;
  }

  function pageLink(extensionId, page) {
    return '#/extensiones/' + encode(extensionId) + '/' + encode(page && page.id || '');
  }

  function pageLinks(vm) {
    if (!vm || !vm.authenticated) return [];
    const state = ensureState(vm);
    const links = [];
    state.items.forEach((item) => {
      if (!item.enabled || item.invalid || item.requiresUpgrade) return;
      item.pages.forEach((page) => {
        if (typeof vm.can !== 'function' || !vm.can(page.permission)) return;
        links.push({
          key: item.id + ':' + page.id,
          extensionId: item.id,
          extensionName: text(item.manifest && item.manifest.name) || item.id,
          pageId: page.id,
          label: page.label,
          icon: page.icon || 'package',
          href: pageLink(item.id, page)
        });
      });
    });
    return links;
  }

  function panelsFor(vm) {
    if (!vm || !vm.authenticated) return [];
    const state = ensureState(vm);
    const panels = [];
    state.items.forEach((item) => {
      if (!item.enabled || item.invalid || item.requiresUpgrade) return;
      item.assetPanels.forEach((panel) => {
        if (typeof vm.can !== 'function' || !vm.can(panel.permission)) return;
        panels.push({ key: item.id + ':' + panel.id, item, panel });
      });
    });
    return panels;
  }

  function widgetsFor(vm) {
    if (!vm || !vm.authenticated) return [];
    const state = ensureState(vm);
    const widgets = [];
    state.items.forEach((item) => {
      if (!item.enabled || item.invalid || item.requiresUpgrade) return;
      item.widgets.forEach((widget) => {
        if (typeof vm.can !== 'function' || !vm.can(widget.permission)) return;
        widgets.push({
          key: item.id + ':' + widget.id,
          item,
          widget,
          extensionName: text(item.manifest && item.manifest.name) || item.id
        });
      });
    });
    return widgets;
  }

  function actionsFor(vm, asset) {
    if (!vm || !vm.authenticated || !asset || !asset.id) return [];
    const state = ensureState(vm);
    const actions = [];
    state.items.forEach((item) => {
      if (!item.enabled || item.invalid || item.requiresUpgrade) return;
      item.actions.forEach((action) => {
        if (typeof vm.can !== 'function' || !vm.can(action.permission)) return;
        actions.push({ key: item.id + ':' + action.id, item, action });
      });
    });
    return actions;
  }

  // Navigation requested by an isolated frame: own pages first, then core hash
  // routes. Another extension's pages are rejected.
  function frameNavigate(vm, item, page) {
    if (!isCurrentItem(vm, item) || typeof page !== 'string' || !page) return false;
    const own = item.pages.find((entry) => entry.id === page);
    if (own) {
      window.location.hash = pageLink(item.id, own);
      return true;
    }
    if (page.charAt(0) !== '#' || page.indexOf('#/') !== 0 || /\s/.test(page)) return false;
    if (page.indexOf('#/extensiones/') === 0 && page.indexOf('#/extensiones/' + encode(item.id) + '/') !== 0) return false;
    window.location.hash = page;
    return true;
  }

  function operationFor(item, name) {
    return item.operations.find((operation) => operation.name === name) || null;
  }

  function sdkFor(vm, item) {
    if (!isCurrentItem(vm, item)) return null;
    const allowed = new Set(item.permissions.map((permission) => permission.code));
    item.operations.forEach((operation) => allowed.add(operation.permission));
    const sdk = {
      id: item.id,
      version: item.version,
      request(operationName, args) {
        if (!isCurrentItem(vm, item)) {
          return Promise.reject(new Error('La extensión ya no está activa.'));
        }
        const operation = operationFor(item, operationName);
        if (!operation) return Promise.reject(new Error('La extensión no declara esa operación.'));
        if (args !== undefined && args !== null && (!isPlainObject(args))) {
          return Promise.reject(new Error('Los argumentos de la operación deben ser un objeto.'));
        }
        if (typeof vm.can !== 'function' || !vm.can(operation.permission)) {
          return Promise.reject(new Error('No tienes permiso para esa operación.'));
        }
        const identity = identityKey(vm);
        return window.AssetAccess.request(vm, '/extensions/' + encode(item.id) + '/invoke/' + encode(operationName), {
          method: 'POST',
          body: isPlainObject(args) ? args : {}
        }).then((response) => {
          if (!isCurrentItem(vm, item) || identity !== identityKey(vm)) {
            throw new Error('La extensión ya no está activa.');
          }
          return response;
        });
      },
      can(permission) {
        if (!isCurrentItem(vm, item)) return false;
        if (typeof permission !== 'string' || !allowed.has(permission)) return false;
        return typeof vm.can === 'function' && !!vm.can(permission);
      },
      navigate(target) {
        if (!isCurrentItem(vm, item)) throw new Error('La extensión ya no está activa.');
        if (isPlainObject(target)) {
          const page = item.pages.find((entry) => entry.id === target.page);
          if (!page) throw new Error('La extensión no declara esa página.');
          window.location.hash = pageLink(item.id, page);
          return true;
        }
        const hash = text(target);
        if (!hash || hash.charAt(0) !== '#' || hash.indexOf('#/') !== 0 || hash.indexOf('\\') !== -1 || /\s/.test(hash)) {
          return false;
        }
        if (/^#\/\/|^#\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(hash)) return false;
        if (hash.indexOf('#/extensiones/') === 0) {
          const own = '#/extensiones/' + encode(item.id) + '/';
          if (hash.indexOf(own) !== 0) return false;
        }
        window.location.hash = hash;
        return true;
      }
    };
    return Object.freeze(sdk);
  }

  function cloneReadonly(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    const memo = seen || new WeakMap();
    if (memo.has(value)) return memo.get(value);
    if (Array.isArray(value)) {
      const clone = [];
      memo.set(value, clone);
      value.forEach((entry) => clone.push(cloneReadonly(entry, memo)));
      return Object.freeze(clone);
    }
    const clone = {};
    memo.set(value, clone);
    Object.keys(value).forEach((key) => { clone[key] = cloneReadonly(value[key], memo); });
    return Object.freeze(clone);
  }

  function readonlyAsset(asset) {
    return asset && typeof asset === 'object' ? cloneReadonly(asset) : null;
  }

  function candidateLink(candidateId) {
    return '#/configuracion/extensiones?candidato=' + encode(candidateId);
  }

  const ExtensionPage = {
    name: 'ExtensionPage',
    components: window.ExtensionViews ? { ExtensionView: window.ExtensionViews.components.ExtensionView } : {},
    props: {
      app: { type: Object, required: true },
      extensionId: { type: String, default: '' },
      pageId: { type: String, default: '' }
    },
    computed: {
      item() {
        const state = this.app.extensions || {};
        return list(state.items).find((entry) => entry.id === this.extensionId) || null;
      },
      page() {
        if (!this.item) return null;
        return this.item.pages.find((entry) => entry.id === this.pageId) || null;
      },
      allowed() {
        return !!(this.page && typeof this.app.can === 'function' && this.app.can(this.page.permission));
      },
      title() {
        return this.page ? this.page.label : tr('ui.extensions.page.eyebrow');
      },
      stateLabel() {
        if (!this.item) return tr('ui.extensions.page.not_available');
        if (this.item.requiresUpgrade) return tr('ui.extensions.page.upgrade');
        return tr('ui.extensions.page.active');
      },
      stateClass() {
        if (!this.item) return 'status--hold';
        return this.item.requiresUpgrade ? 'status--warn' : 'status--ok';
      }
    },
    template: `
      <section class="page extension-page" aria-labelledby="extension-page-title">
        <header class="page-head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.extensions.page.eyebrow') }}</p>
            <h1 id="extension-page-title">{{ title }}</h1>
            <p>{{ item ? (item.manifest.name || item.id) : $t('ui.extensions.page.module_missing') }}</p>
          </div>
          <div class="page-head__meta" :aria-label="$t('ui.extensions.page.state_aria')">
            <span class="status-pill" :class="stateClass">{{ stateLabel }}</span>
          </div>
        </header>

        <div v-if="!item" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="package"></app-icon></span>
          <h2>{{ $t('ui.extensions.page.unavailable') }}</h2>
          <p>{{ $t('ui.extensions.page.unavailable_lead') }}</p>
          <a class="btn btn--secondary" href="#/panel">{{ $t('ui.extensions.page.back') }}</a>
        </div>
        <div v-else-if="item.requiresUpgrade" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="alert"></app-icon></span>
          <h2>{{ $t('ui.extensions.page.upgrade') }}</h2>
          <p>{{ $t('ui.extensions.page.upgrade_lead') }}</p>
          <a class="btn btn--secondary" href="#/configuracion/extensiones">{{ $t('ui.extensions.page.review') }}</a>
        </div>
        <div v-else-if="item.invalid" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>{{ $t('ui.extensions.page.invalid_package') }}</strong><p>{{ item.invalid }}</p></div>
        </div>
        <div v-else-if="!page" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="alert"></app-icon></span>
          <h2>{{ $t('ui.extensions.page.page_missing') }}</h2>
          <p>{{ $t('ui.extensions.page.page_unknown', { page: pageId }) }}</p>
        </div>
        <div v-else-if="!allowed" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="lock"></app-icon></span>
          <h2>{{ $t('ui.extensions.page.page_forbidden') }}</h2>
          <p>{{ $t('ui.extensions.page.permission_required', { permission: page.permission }) }}</p>
        </div>
        <extension-view v-else :app="app" :item="item" :view="page.view"></extension-view>
      </section>
    `
  };

  const ExtensionAssetPanels = {
    name: 'ExtensionAssetPanels',
    components: window.ExtensionViews ? { ExtensionView: window.ExtensionViews.components.ExtensionView } : {},
    props: {
      app: { type: Object, required: true },
      asset: { type: Object, default: null }
    },
    computed: {
      panels() {
        return panelsFor(this.app);
      },
      assetSnapshot() {
        return readonlyAsset(this.asset);
      }
    },
    methods: {
      panelTitle(entry) {
        return 'extension-panel-' + entry.key.replace(/[^a-zA-Z0-9_-]/g, '-');
      }
    },
    template: `
      <div v-if="panels.length" class="extension-asset-panels">
        <section v-for="entry in panels" :key="entry.key" class="panel extension-panel" :aria-labelledby="panelTitle(entry)">
          <header class="panel-head">
            <div>
              <p class="eyebrow">{{ $t('ui.extensions.page.eyebrow') }}</p>
              <h2 :id="panelTitle(entry)">{{ entry.panel.label }}</h2>
              <p>{{ entry.item.manifest.name || entry.item.id }}</p>
            </div>
            <span v-if="entry.item.requiresUpgrade" class="status-pill status--warn">{{ $t('ui.extensions.page.upgrade') }}</span>
            <span v-else class="chip chip--muted">{{ entry.item.version }}</span>
          </header>
          <p v-if="entry.item.requiresUpgrade" class="config-note" role="status">
            <app-icon name="alert"></app-icon>
            {{ $t('ui.extensions.page.sdk1_panel') }}
          </p>
          <div v-else-if="entry.item.invalid" class="form-alert" role="alert">
            <app-icon name="alert"></app-icon>
            <div><strong>{{ $t('ui.extensions.page.invalid_panel') }}</strong><p>{{ entry.item.invalid }}</p></div>
          </div>
          <extension-view v-else :app="app" :item="entry.item" :view="entry.panel.view" :asset="assetSnapshot"></extension-view>
        </section>
      </div>
    `
  };

  function actionLabel(action) {
    const labels = {
      'extension.submitted': 'Enviado para revisión',
      'extension.validated': 'Validación completada',
      'extension.approved': 'Aprobado',
      'extension.installed': 'Instalado',
      'extension.upgraded': 'Actualizado',
      'extension.enabled': 'Activado',
      'extension.disabled': 'Desactivado',
      'extension.rolled_back': 'Rollback aplicado',
      'extension.superseded': 'Reemplazado por otro candidato'
    };
    return labels[action] || action || 'Evento';
  }

  function candidateStateLabel(state) {
    const labels = { pending: 'Pendiente', installed: 'Instalada', superseded: 'Reemplazada' };
    return labels[state] || state || 'Desconocido';
  }

  function validationStatusLabel(status) {
    const labels = { passed: 'Correcta', failed: 'Con errores', missing: 'Sin informe' };
    return labels[status] || status || 'Sin informe';
  }

  function compareVersions(left, right) {
    const a = text(left).split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
    const b = text(right).split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  const ExtensionReview = {
    name: 'ExtensionReview',
    props: {
      app: { type: Object, required: true }
    },
    data() {
      return {
        reviewEpoch: 0,
        detailEpoch: 0,
        review: {
          loading: false,
          error: '',
          stale: false,
          candidates: [],
          filter: 'pending',
          selectedId: '',
          detail: null,
          detailLoading: false,
          detailError: ''
        },
        action: {
          message: '',
          error: ''
        },
        status: {
          byId: {}
        },
        confirm: {
          open: false,
          busy: false,
          kind: '',
          title: '',
          summary: '',
          confirmLabel: 'Confirmar',
          error: '',
          payload: null,
          itemId: '',
          candidateId: '',
          typedRequired: '',
          typedValue: ''
        }
      };
    },
    computed: {
      canManage() {
        return typeof this.app.can === 'function' && this.app.can('system.modules');
      },
      candidates() {
        const filter = this.review.filter;
        return this.review.candidates.filter((candidate) => filter === 'all' || candidate.state === filter);
      },
      installedItems() {
        const state = this.app.extensions || {};
        return list(state.items).slice().sort((left, right) => String(left.id).localeCompare(String(right.id)));
      },
      detail() {
        return this.review.detail;
      },
      history() {
        return list(this.detail && this.detail.history);
      }
    },
    watch: {
      'app.route.candidateId': {
        handler(value) {
          if (value && value !== this.review.selectedId) this.reviewDetail(value);
        }
      }
    },
    created() {
      this.reviewLoad();
      if (this.app.route && this.app.route.candidateId) this.reviewDetail(this.app.route.candidateId);
      if (this.app.extensions && !this.app.extensions.loaded && typeof this.app.extensionsLoad === 'function') {
        this.app.extensionsLoad();
      }
    },
    beforeUnmount() {
      this.reviewEpoch += 1;
      this.detailEpoch += 1;
    },
    methods: {
      formatDate(value) {
        if (!value) return 'Sin fecha';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return window.ItsmI18n
          ? window.ItsmI18n.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' })
          : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
      },
      shortDigest(value) {
        const digest = text(value);
        return digest ? digest.slice(0, 12) + '…' : 'Sin digest';
      },
      actionLabel,
      candidateStateLabel,
      validationStatusLabel,
      validationPassed() {
        const detail = this.detail;
        const report = detail && detail.validation;
        return !!(report && report.status === 'passed' && DIGEST_RE.test(detail.digest) &&
          report.digest === detail.digest && report.sdkVersion === SDK_VERSION && !list(report.errors).length);
      },
      permissionLabel(code) {
        const permissions = list(this.detail && this.detail.manifest && this.detail.manifest.permissions);
        const permission = permissions.find((entry) => entry.code === code);
        return permission ? permission.label : code;
      },
      detailTrustNotice() {
        // The server statement is an English technical record; the reviewer
        // reads the Spanish description of the same runtime.
        const trust = this.detail && isPlainObject(this.detail.trust) ? this.detail.trust : {};
        const runtime = text(trust.runtime) || (this.detail && this.detail.manifest && this.detail.manifest.runtime);
        if (runtime === 'sandboxed') return 'El código del servidor corre en un proceso restringido, sin red, sin secretos y sin acceso a la base del núcleo; cada efecto sobre el núcleo pasa por una capacidad autorizada del host. El código visual corre en un marco aislado sin acceso a la sesión, al DOM del host ni a su almacenamiento.';
        return 'Las vistas declarativas no ejecutan código del módulo en esta página: el host las dibuja con sus componentes.';
      },
      runtimeLabel(runtime) {
        if (runtime === 'sandboxed') return 'Código aislado';
        if (runtime === 'declarative') return 'Declarativa';
        return 'No informado';
      },
      capabilityLabel(code) {
        return CAPABILITY_LABELS[code] || 'Capacidad no informada por el host.';
      },
      viewSummary(view) {
        return window.ExtensionViews && typeof window.ExtensionViews.describeView === 'function'
          ? window.ExtensionViews.describeView(view)
          : 'Sin vista declarada.';
      },
      formatBytes(value) {
        if (!Number.isInteger(value) || value < 0) return 'No informado';
        if (value < 1024) return value + ' B';
        if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
        return (value / (1024 * 1024)).toFixed(1) + ' MB';
      },
      statusFacts(item) {
        const entry = this.status.byId[item.id] || {};
        const data = entry.data || {};
        const events = isPlainObject(data.events) ? data.events : {};
        const sandbox = isPlainObject(data.sandbox) ? data.sandbox : {};
        const size = Number.isInteger(data.dataSizeBytes) ? this.formatBytes(data.dataSizeBytes) : 'No informado';
        const schema = Number.isInteger(data.schemaVersion) ? data.schemaVersion : item.schemaVersion;
        const cursor = Number.isInteger(events.cursor) ? events.cursor : data.eventCursor;
        const stalled = events.stalled === true || events.state === 'stalled' || data.stalled === true;
        let eventsLabel = 'No informado';
        if (stalled) {
          eventsLabel = 'Detenidos' + (Number.isInteger(cursor) ? ' en ' + cursor : '') + (text(events.lastError) ? ' · ' + text(events.lastError) : '');
        } else if (Number.isInteger(cursor)) {
          eventsLabel = 'Al día · cursor ' + cursor;
        }
        const sandboxLabel = sandbox.available === true
          ? 'Disponible' + (Number.isInteger(sandbox.landlockAbi) ? ' · Landlock ABI ' + sandbox.landlockAbi : '')
          : sandbox.available === false
            ? 'No disponible' + (text(sandbox.detail) ? ' · ' + text(sandbox.detail) : '')
            : 'No informado';
        return [
          { label: 'Almacenamiento', value: 'Base SQLite propia · ' + size },
          { label: 'Esquema de datos', value: Number.isInteger(schema) ? String(schema) : 'No informado' },
          { label: 'Eventos', value: eventsLabel },
          { label: 'Entorno restringido', value: sandboxLabel }
        ];
      },
      async loadStatus(item) {
        if (!item || !text(item.id)) return false;
        const id = item.id;
        const identity = identityKey(this.app);
        const epoch = ++this.detailEpoch;
        this.status.byId[id] = Object.assign({}, this.status.byId[id], { loading: true, error: '', loaded: false });
        try {
          const response = await window.AssetAccess.request(this.app, '/extensions/' + encode(id) + '/status');
          if (epoch > 0 && identity !== identityKey(this.app)) return false;
          this.status.byId[id] = { loading: false, loaded: true, error: '', data: isPlainObject(response) ? response : {} };
          return true;
        } catch (error) {
          this.status.byId[id] = { loading: false, loaded: false, error: (error && (error.message || error.error)) || 'El servidor no informó el estado de la extensión.', data: null };
          return false;
        }
      },
      reviewFilterLabel(filter) {
        return filter === 'pending' ? 'Pendientes' : filter === 'installed' ? 'Instaladas' : filter === 'superseded' ? 'Reemplazadas' : 'Todas';
      },
      async reviewLoad(options) {
        const identity = identityKey(this.app);
        const epoch = ++this.reviewEpoch;
        this.review.loading = true;
        this.review.error = '';
        try {
          const response = await window.AssetAccess.request(this.app, '/extensions/candidates');
          if (epoch !== this.reviewEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.review.candidates = list(response && response.items);
          this.review.loading = false;
          const requested = this.app.route && this.app.route.candidateId;
          const selected = requested || this.review.selectedId;
          if (selected) await this.reviewDetail(selected);
          else if (!this.review.detail) this.review.detail = null;
          if (options && options.force && typeof this.app.extensionsLoad === 'function') await this.app.extensionsLoad({ force: true });
          return true;
        } catch (error) {
          if (epoch !== this.reviewEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.review.loading = false;
          this.review.error = (error && (error.message || error.error)) || 'No se pudieron consultar los candidatos.';
          return false;
        }
      },
      async reviewDetail(candidateId) {
        const id = text(candidateId);
        if (!id) return false;
        const identity = identityKey(this.app);
        this.review.selectedId = id;
        const epoch = ++this.detailEpoch;
        this.review.detailLoading = true;
        this.review.detailError = '';
        try {
          const response = await window.AssetAccess.request(this.app, '/extensions/candidates/' + encode(id));
          if (epoch !== this.detailEpoch || this.review.selectedId !== id || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.review.detail = response;
          this.review.detailLoading = false;
          return true;
        } catch (error) {
          if (epoch !== this.detailEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.review.detailLoading = false;
          this.review.detail = null;
          this.review.detailError = (error && (error.message || error.error)) || 'No se pudo consultar el candidato.';
          return false;
        }
      },
      selectCandidate(candidateId) {
        const id = text(candidateId);
        if (!id) return;
        this.review.selectedId = id;
        if (typeof this.app.setHash === 'function') this.app.setHash(candidateLink(id));
        else window.location.hash = candidateLink(id);
        if (this.app.route) this.app.route.candidateId = id;
        this.reviewDetail(id);
      },
      candidateLink,
      installedForDetail() {
        const extensionId = this.detail && this.detail.extensionId;
        return this.installedItems.find((item) => item.id === extensionId) || null;
      },
      installedForHistory() {
        return this.installedItems;
      },
      // A compatible package rolls back directly. An incompatible schema can
      // still roll back by restoring the pre-upgrade snapshot, which the server
      // demands with a typed confirmation and `restoreData: true`.
      rollbackMode(entry, item) {
        if (!entry || !item || !this.detail) return '';
        if (!Number.isInteger(item.revision)) return '';
        const action = text(entry.action);
        if (/submitted|validated|superseded|approved/.test(action)) return '';
        const target = entry.detail || {};
        if (!text(target.version) || !DIGEST_RE.test(text(target.digest))) return '';
        if (compareVersions(target.version, item.version) >= 0) return '';
        return this.detail.rollbackCompatible === true ? 'compatible' : 'restore';
      },
      canRollback(entry, item) {
        return this.rollbackMode(entry, item) !== '';
      },
      historySummary(entry) {
        const detail = entry && entry.detail;
        if (!detail) return '';
        const parts = [];
        if (detail.version) parts.push('versión ' + detail.version);
        if (detail.enabled !== undefined) parts.push(detail.enabled ? 'activa' : 'desactivada');
        if (Number.isInteger(detail.revision)) parts.push('revisión ' + detail.revision);
        if (detail.fromVersion) parts.push('desde ' + detail.fromVersion);
        return parts.join(' · ');
      },
      resetAction() {
        this.action.message = '';
        this.action.error = '';
      },
      closeConfirm() {
        if (this.confirm.busy) return;
        this.confirm.open = false;
        this.confirm.error = '';
      },
      askApprove() {
        this.resetAction();
        if (!this.canManage) {
          this.action.error = 'Solo un Superadmin humano puede aprobar extensiones.';
          return;
        }
        const detail = this.detail;
        if (!detail || detail.state !== 'pending') {
          this.action.error = 'Solo un candidato pendiente se puede aprobar.';
          return;
        }
        if (!this.validationPassed()) {
          this.action.error = 'La validación aislada del candidato no está aprobada.';
          return;
        }
        if (detail.currentRevision !== null && !Number.isInteger(detail.currentRevision)) {
          this.action.error = 'El servidor no informó la revisión activa. Actualiza antes de aprobar.';
          return;
        }
        this.confirm = {
          open: true,
          busy: false,
          kind: 'approve',
          title: 'Aprobar e instalar ' + detail.extensionId + ' ' + detail.version,
          summary: 'Se instala exactamente el paquete con este digest. La aprobación también es la instalación; el servidor comprobará la revisión activa antes de confirmar.',
          confirmLabel: 'Aprobar e instalar',
          error: '',
          payload: { digest: detail.digest, expectedVersion: detail.currentRevision },
          itemId: detail.extensionId,
          candidateId: detail.id,
          typedRequired: '',
          typedValue: ''
        };
      },
      askToggle(item, enabled) {
        this.resetAction();
        if (!this.canManage) {
          this.action.error = 'Solo un Superadmin humano puede cambiar el estado de una extensión.';
          return;
        }
        if (!item || !text(item.id)) {
          this.action.error = 'El módulo no está identificado.';
          return;
        }
        if (!Number.isInteger(item.revision)) {
          this.action.error = 'El servidor no informó la revisión activa. Actualiza antes de cambiar el estado.';
          return;
        }
        this.confirm = {
          open: true,
          busy: false,
          kind: enabled ? 'enable' : 'disable',
          title: (enabled ? 'Activar ' : 'Desactivar ') + (item.manifest && item.manifest.name || item.id),
          summary: enabled
            ? 'La interfaz y las operaciones vuelven a estar disponibles para quien tenga permisos. El servidor conserva los datos.'
            : 'La interfaz se retira y las operaciones quedan bloqueadas. Los datos y el historial se conservan.',
          confirmLabel: enabled ? 'Activar extensión' : 'Desactivar extensión',
          error: '',
          payload: { enabled: !!enabled, expectedVersion: item.revision },
          itemId: item.id,
          candidateId: '',
          typedRequired: '',
          typedValue: ''
        };
      },
      askRollback(entry, item) {
        this.resetAction();
        if (!this.canManage) {
          this.action.error = 'Solo un Superadmin humano puede aplicar un rollback.';
          return;
        }
        const mode = this.rollbackMode(entry, item);
        if (!mode) {
          this.action.error = 'Ese evento del historial no permite volver a una versión anterior.';
          return;
        }
        const target = entry.detail;
        const restore = mode === 'restore';
        this.confirm = {
          open: true,
          busy: false,
          kind: 'rollback',
          title: restore ? 'Volver a ' + target.version + ' restaurando los datos' : 'Volver a ' + target.version,
          summary: restore
            ? 'El esquema de datos actual no es compatible con esa versión. El servidor restaurará la copia previa a la actualización y descartará los cambios posteriores de la base propia de la extensión. Escribe el identificador para confirmarlo.'
            : 'El servidor comprobará que el paquete anterior sigue instalado y que su esquema es compatible con los datos actuales. Si no lo es, no cambia nada.',
          confirmLabel: restore ? 'Restaurar datos y volver' : 'Aplicar rollback',
          error: '',
          payload: restore
            ? { version: target.version, digest: target.digest, expectedVersion: item.revision, restoreData: true }
            : { version: target.version, digest: target.digest, expectedVersion: item.revision },
          itemId: item.id,
          candidateId: this.detail ? this.detail.id : '',
          typedRequired: restore ? item.id : '',
          typedValue: ''
        };
      },
      askUninstall(item) {
        this.resetAction();
        if (!this.canManage) {
          this.action.error = 'Solo un Superadmin humano puede desinstalar una extensión.';
          return;
        }
        if (!item || !text(item.id)) {
          this.action.error = 'El módulo no está identificado.';
          return;
        }
        if (!Number.isInteger(item.revision)) {
          this.action.error = 'El servidor no informó la revisión activa. Actualiza antes de desinstalar.';
          return;
        }
        this.confirm = {
          open: true,
          busy: false,
          kind: 'uninstall',
          title: 'Desinstalar ' + (item.manifest && item.manifest.name || item.id),
          summary: 'El servidor retira el paquete y su interfaz. La base SQLite propia de la extensión, sus archivos y su historial se conservan; volver a instalarla recupera esos datos.',
          confirmLabel: 'Desinstalar extensión',
          error: '',
          payload: { expectedVersion: item.revision },
          itemId: item.id,
          candidateId: '',
          typedRequired: '',
          typedValue: ''
        };
      },
      async confirmRun() {
        if (!this.confirm.open || this.confirm.busy) return false;
        const kind = this.confirm.kind;
        const payload = this.confirm.payload;
        if (this.confirm.typedRequired && this.confirm.typedValue !== this.confirm.typedRequired) {
          this.confirm.error = 'Escribe el identificador exacto para confirmar la restauración.';
          return false;
        }
        let path = '';
        if (kind === 'approve') path = '/extensions/candidates/' + encode(this.confirm.candidateId) + '/approve';
        else if (kind === 'enable' || kind === 'disable') path = '/extensions/' + encode(this.confirm.itemId) + '/enabled';
        else if (kind === 'uninstall') path = '/extensions/' + encode(this.confirm.itemId) + '/uninstall';
        else if (kind === 'rollback') path = '/extensions/' + encode(this.confirm.itemId) + '/rollback';
        else return false;
        const body = Object.assign({}, payload || {});
        if (kind === 'rollback' && body.restoreData === true) body.confirm = this.confirm.typedValue;
        const epoch = this.reviewEpoch;
        const identity = identityKey(this.app);
        this.confirm.busy = true;
        this.confirm.error = '';
        this.action.error = '';
        this.action.message = '';
        try {
          await window.AssetAccess.request(this.app, path, { method: 'POST', body });
          if (epoch !== this.reviewEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.confirm.busy = false;
          this.confirm.open = false;
          this.review.stale = false;
          this.action.message = kind === 'approve'
            ? 'El servidor confirmó la aprobación e instalación del paquete.'
            : kind === 'uninstall'
              ? 'El servidor desinstaló la extensión y conservó sus datos.'
              : kind === 'rollback'
                ? (body.restoreData === true
                  ? 'El servidor restauró la copia previa y volvió a la versión anterior.'
                  : 'El servidor confirmó el rollback y la compatibilidad de los datos.')
                : payload.enabled
                  ? 'El servidor confirmó la activación de la extensión.'
                  : 'El servidor confirmó la desactivación de la extensión.';
          if (typeof this.app.extensionsLoad === 'function') await this.app.extensionsLoad({ force: true });
          await this.reviewLoad();
          if (this.review.selectedId) await this.reviewDetail(this.review.selectedId);
          return true;
        } catch (error) {
          if (epoch !== this.reviewEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.confirm.busy = false;
          const message = (error && (error.message || error.error)) || 'El servidor rechazó la operación.';
          if (error && error.code === 'stale') {
            this.review.stale = true;
            this.confirm.open = false;
            this.action.error = message || 'El catálogo cambió. Actualiza y revisa de nuevo antes de continuar.';
            if (typeof this.app.extensionsLoad === 'function') await this.app.extensionsLoad({ force: true });
            await this.reviewLoad();
            if (this.review.selectedId) await this.reviewDetail(this.review.selectedId);
          } else {
            this.confirm.error = message;
            this.action.error = message;
          }
          return false;
        }
      }
    },
    template: `
      <section class="config-section extension-review" aria-labelledby="extension-review-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">{{ $t('ui.extensions.page.native') }}</p>
            <h2 id="extension-review-title">{{ $t('ui.extensions.review.title') }}</h2>
            <p>{{ $t('ui.extensions.review.lead') }}</p>
          </div>
          <button type="button" class="btn btn--secondary" :disabled="review.loading" @click="reviewLoad({ force: true })">
            <app-icon name="refresh"></app-icon> {{ $t('ui.extensions.review.refresh') }}
          </button>
        </header>

        <div class="form-note extension-trust" role="note">
          <app-icon name="shield"></app-icon>
          <div>
            <strong>{{ $t('ui.extensions.review.isolation') }}</strong>
            <p>{{ $t('ui.extensions.review.isolation_lead') }}</p>
          </div>
        </div>

        <div v-if="!canManage" class="form-alert" role="alert">
          <app-icon name="lock"></app-icon>
          <div><strong>{{ $t('ui.extensions.review.readonly') }}</strong><p>{{ $t('ui.extensions.review.permission_note') }}</p></div>
        </div>

        <div v-if="review.stale" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>{{ $t('ui.extensions.review.catalog_changed') }}</strong><p>{{ $t('ui.extensions.review.catalog_changed_note') }}</p></div>
        </div>
        <div v-if="review.error" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>{{ $t('ui.extensions.review.catalog_failed') }}</strong><p>{{ review.error }}</p></div>
        </div>
        <p v-if="action.message" class="config-note" role="status"><app-icon name="check"></app-icon> {{ action.message }}</p>
        <p v-if="action.error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ action.error }}</p>

        <div class="extension-review__grid">
          <section class="extension-review__inbox" aria-labelledby="extension-candidates-title">
            <header class="panel-head">
              <div><p class="eyebrow">{{ $t('ui.extensions.review.inbox') }}</p><h3 id="extension-candidates-title">{{ $t('ui.extensions.review.candidates') }}</h3></div>
              <span class="config-badge">{{ candidates.length }}</span>
            </header>
            <div class="extension-filters" role="group" :aria-label="$t('ui.extensions.review.filter_aria')">
              <button v-for="filter in ['pending', 'installed', 'superseded', 'all']" :key="filter" type="button"
                      class="chip" :class="{ 'chip--active': review.filter === filter }"
                      :aria-pressed="review.filter === filter" @click="review.filter = filter">
                {{ reviewFilterLabel(filter) }}
              </button>
            </div>
            <p v-if="review.loading" class="config-note" role="status"><app-icon name="refresh"></app-icon> {{ $t('ui.extensions.review.loading_candidates') }}</p>
            <p v-else-if="!candidates.length" class="config-note">{{ $t('ui.extensions.review.empty_inbox') }}</p>
            <ul v-else class="extension-candidates">
              <li v-for="candidate in candidates" :key="candidate.id">
                <button type="button" class="extension-candidate" :class="{ 'is-active': review.selectedId === candidate.id }"
                        :aria-pressed="review.selectedId === candidate.id" @click="selectCandidate(candidate.id)">
                  <span class="extension-candidate__top">
                    <strong>{{ candidate.extensionId }} {{ candidate.version }}</strong>
                    <span class="config-badge">{{ candidateStateLabel(candidate.state) }}</span>
                  </span>
                  <span class="cell-note">{{ $t('ui.extensions.review.validation_line', { status: validationStatusLabel(candidate.validationStatus), date: formatDate(candidate.submittedAt) }) }}</span>
                  <span class="cell-note">{{ $t('ui.extensions.candidate.active_line', { version: candidate.currentVersion || $t('ui.extensions.candidate.not_installed'), revision: candidate.currentRevision === null ? '—' : candidate.currentRevision }) }}</span>
                </button>
              </li>
            </ul>
          </section>

          <section class="extension-review__detail" aria-labelledby="extension-detail-title">
            <h3 id="extension-detail-title" class="sr-only">{{ $t('ui.extensions.candidate.detail') }}</h3>
            <p v-if="review.detailLoading" class="config-note" role="status"><app-icon name="refresh"></app-icon> {{ $t('ui.extensions.candidate.loading') }}</p>
            <div v-else-if="review.detailError" class="form-alert" role="alert"><app-icon name="alert"></app-icon><div><strong>{{ $t('ui.extensions.candidate.failed') }}</strong><p>{{ review.detailError }}</p></div></div>
            <p v-else-if="!detail" class="config-empty">{{ $t('ui.extensions.candidate.pick') }}</p>
            <div v-else class="extension-detail">
              <header class="extension-detail__head">
                <div>
                  <p class="eyebrow">{{ $t('ui.extensions.candidate.package') }}</p>
                  <h3>{{ detail.extensionId }} {{ detail.version }}</h3>
                  <p class="cell-muted">{{ detail.manifest.name || detail.extensionId }}</p>
                </div>
                <span class="config-badge">{{ candidateStateLabel(detail.state) }}</span>
              </header>

              <dl class="extension-facts">
                <div><dt>{{ $t('ui.extensions.candidate.digest') }}</dt><dd class="mono extension-digest">{{ detail.digest }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.active_version') }}</dt><dd>{{ $t('ui.extensions.candidate.version_line', { version: detail.currentVersion || $t('ui.extensions.candidate.version_none'), revision: detail.currentRevision === null ? '—' : detail.currentRevision }) }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.revision') }}</dt><dd>{{ detail.revision }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.submitted') }}</dt><dd>{{ detail.submittedBy || 'Sin identificar' }} · {{ formatDate(detail.submittedAt) }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.runtime') }}</dt><dd>{{ runtimeLabel(detail.manifest.runtime) }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.storage') }}</dt><dd>{{ detail.manifest.storage && detail.manifest.storage.engine === 'sqlite' ? 'Base SQLite propia' : 'Sin almacenamiento declarado' }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.capabilities') }}</dt><dd>{{ (detail.manifest.capabilities || []).length ? (detail.manifest.capabilities || []).join(', ') : 'Ninguna' }}</dd></div>
                <div><dt>{{ $t('ui.extensions.candidate.rollback') }}</dt><dd>{{ detail.rollbackCompatible ? 'Compatible con los datos actuales' : 'Requiere restaurar la copia de datos previa' }}</dd></div>
              </dl>

              <section class="extension-block" aria-labelledby="extension-trust-title">
                <h4 id="extension-trust-title">{{ $t('ui.extensions.trust.title') }}</h4>
                <p>{{ detailTrustNotice() }}</p>
                <ul class="extension-checks">
                  <li>{{ $t('ui.extensions.trust.declarative') }}</li>
                  <li>{{ $t('ui.extensions.trust.sandboxed') }}</li>
                  <li>{{ $t('ui.extensions.trust.server') }}</li>
                </ul>
                <ul v-if="(detail.manifest.capabilities || []).length" class="extension-checks">
                  <li v-for="capability in detail.manifest.capabilities" :key="capability"><code>{{ capability }}</code> — {{ capabilityLabel(capability) }}</li>
                </ul>
              </section>

              <section class="extension-block" aria-labelledby="extension-validation-title">
                <h4 id="extension-validation-title">{{ $t('ui.extensions.validation.title') }}</h4>
                <template v-if="detail.validation">
                  <p>{{ $t('ui.extensions.validation.result') }} <strong>{{ validationStatusLabel(detail.validation.status) }}</strong> · {{ $t('ui.extensions.validation.digest_label') }} {{ shortDigest(detail.validation.digest) }} · {{ $t('ui.extensions.validation.container_label') }} {{ detail.validation.container && detail.validation.container.image || $t('ui.extensions.validation.unknown') }} · {{ $t('ui.extensions.validation.engine_label') }} {{ detail.validation.container && detail.validation.container.engine || $t('ui.extensions.validation.unknown') }}</p>
                  <ul class="extension-checks">
                    <li v-for="check in detail.validation.checks" :key="check.name">
                      <span class="status-pill" :class="check.status === 'passed' ? 'status--ok' : 'status--down'">{{ check.status === 'passed' ? 'Correcto' : 'Fallo' }}</span>
                      <span><strong>{{ check.name }}</strong> — {{ check.detail }}</span>
                    </li>
                  </ul>
                  <ul v-if="detail.validation.errors && detail.validation.errors.length" class="extension-errors" role="alert">
                    <li v-for="error in detail.validation.errors" :key="error">{{ error }}</li>
                  </ul>
                  <p class="cell-muted">{{ $t('ui.extensions.validation.completed') }} {{ formatDate(detail.validation.completedAt) }}</p>
                </template>
                <p v-else class="config-note">{{ $t('ui.extensions.validation.missing') }}</p>
              </section>

              <section class="extension-block" aria-labelledby="extension-permissions-title">
                <h4 id="extension-permissions-title">{{ $t('ui.extensions.permissions.title') }}</h4>
                <p>{{ $t('ui.extensions.permissions.note') }}</p>
                <p class="cell-note">{{ $t('ui.extensions.permissions.granted_to') }} {{ detail.permissionDelta.grantedTo || 'Superadmin' }}</p>
                <div class="extension-permission-columns">
                  <div><strong>{{ $t('ui.extensions.permissions.new') }}</strong><ul v-if="detail.permissionDelta.added.length"><li v-for="permission in detail.permissionDelta.added" :key="'add-' + permission.code"><code>{{ permission.code }}</code> · {{ permission.label }}<p v-if="permission.description" class="cell-note">{{ permission.description }}</p></li></ul><p v-else class="cell-muted">{{ $t('ui.extensions.permissions.none') }}</p></div>
                  <div><strong>{{ $t('ui.extensions.permissions.removed') }}</strong><ul v-if="detail.permissionDelta.removed.length"><li v-for="code in detail.permissionDelta.removed" :key="'rem-' + code"><code>{{ code }}</code> · {{ permissionLabel(code) }}</li></ul><p v-else class="cell-muted">{{ $t('ui.extensions.permissions.none') }}</p></div>
                </div>
                <p v-if="detail.permissionDelta.core && detail.permissionDelta.core.length" class="cell-note">{{ $t('ui.extensions.permissions.core') }} <span class="mono">{{ detail.permissionDelta.core.join(', ') }}</span></p>
                <p v-if="detail.permissionDelta.note" class="cell-note">{{ detail.permissionDelta.note }}</p>
              </section>

              <section class="extension-block" aria-labelledby="extension-contributions-title">
                <h4 id="extension-contributions-title">{{ $t('ui.extensions.contributions.title') }}</h4>
                <p class="cell-note">{{ $t('ui.extensions.contributions.sdk_line', { sdk: detail.manifest.sdkVersion, schema: detail.manifest.schemaVersion }) }}</p>
                <h5>{{ $t('ui.extensions.contributions.sections') }}</h5>
                <ul class="extension-contributions">
                  <li v-for="page in detail.manifest.frontend && detail.manifest.frontend.pages || []" :key="'page-' + page.id">
                    {{ $t('ui.extensions.contributions.page') }} <strong>{{ page.label }}</strong> · <code>{{ page.id }}</code> · {{ viewSummary(page.view) }} · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ page.permission }}</code>
                  </li>
                  <li v-for="panel in detail.manifest.frontend && detail.manifest.frontend.assetPanels || []" :key="'panel-' + panel.id">
                    {{ $t('ui.extensions.contributions.panel') }} <strong>{{ panel.label }}</strong> · <code>{{ panel.id }}</code> · {{ viewSummary(panel.view) }} · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ panel.permission }}</code>
                  </li>
                  <li v-for="widget in detail.manifest.frontend && detail.manifest.frontend.widgets || []" :key="'widget-' + widget.id">
                    {{ $t('ui.extensions.contributions.widget') }} <strong>{{ widget.label }}</strong> · <code>{{ widget.id }}</code> · {{ viewSummary(widget.view) }} · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ widget.permission }}</code>
                  </li>
                  <li v-for="action in detail.manifest.frontend && detail.manifest.frontend.actions || []" :key="'action-' + action.id">
                    {{ $t('ui.extensions.contributions.action') }} <strong>{{ action.label }}</strong> · <code>{{ action.id }}</code> · {{ $t('ui.extensions.contributions.operation_label') }} <code>{{ action.operation }}</code> · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ action.permission }}</code>
                  </li>
                </ul>
                <h5>{{ $t('ui.extensions.contributions.operations') }}</h5>
                <p v-if="!detail.manifest.operations || !detail.manifest.operations.length" class="cell-note">{{ $t('ui.extensions.contributions.no_operations') }}</p>
                <ul v-else class="extension-contributions">
                  <li v-for="operation in detail.manifest.operations" :key="operation.name">
                    <code>{{ operation.name }}</code> · {{ operation.description }} · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ operation.permission }}</code> · {{ operation.mutation ? 'modifica datos' : 'consulta' }}
                  </li>
                </ul>
                <h5>{{ $t('ui.extensions.contributions.scheduled') }}</h5>
                <ul class="extension-contributions">
                  <li v-for="collection in detail.manifest.collections || []" :key="'collection-' + collection.name">
                    {{ $t('ui.extensions.contributions.collection') }} <code>{{ collection.name }}</code> · {{ collection.description }}
                  </li>
                  <li v-for="schedule in detail.manifest.schedules || []" :key="'schedule-' + schedule.name">
                    {{ $t('ui.extensions.contributions.task') }} <code>{{ schedule.name }}</code> · {{ $t('ui.extensions.contributions.every') }} {{ schedule.intervalSeconds }} {{ $t('ui.extensions.contributions.seconds') }} · {{ $t('ui.extensions.contributions.permission_label') }} <code>{{ schedule.permission }}</code>
                  </li>
                </ul>
                <h5>{{ $t('ui.extensions.contributions.agents') }}</h5>
                <p v-if="!detail.manifest.skills || !detail.manifest.skills.length" class="cell-note">{{ $t('ui.extensions.contributions.no_skills') }}</p>
                <ul v-else class="extension-contributions">
                  <li v-for="skill in detail.manifest.skills" :key="skill.name"><code>{{ skill.name }}</code> · {{ skill.description }} · <code>{{ skill.path }}</code></li>
                </ul>
              </section>

              <section class="extension-block" aria-labelledby="extension-migrations-title">
                <h4 id="extension-migrations-title">{{ $t('ui.extensions.migrations.title') }}</h4>
                <p v-if="!detail.migrationPlan || !detail.migrationPlan.required">{{ $t('ui.extensions.migrations.none') }}</p>
                <template v-else>
                  <p>{{ $t('ui.extensions.migrations.line', { from: detail.migrationPlan.from, to: detail.migrationPlan.to, state: detail.migrationPlan.compatible ? $t('ui.extensions.migrations.compatible') : $t('ui.extensions.migrations.incompatible') }) }}</p>
                  <ol class="extension-migrations">
                    <li v-for="revision in detail.migrationPlan.steps" :key="revision.from + '-' + revision.to">
                      {{ revision.from }} → {{ revision.to }} · <code>{{ revision.handler }}</code>
                    </li>
                  </ol>
                </template>
              </section>

              <div v-if="canManage" class="extension-actions">
                <button v-if="detail.state === 'pending'" type="button" class="btn btn--primary" @click="askApprove">
                  <app-icon name="check"></app-icon> {{ $t('ui.extensions.approval.title') }}
                </button>
                <p v-if="detail.state === 'pending'" class="config-note">{{ $t('ui.extensions.approval.lead') }}</p>
                <p v-else class="config-note">{{ $t('ui.extensions.approval.already_installed', { state: candidateStateLabel(detail.state).toLowerCase() }) }}</p>
              </div>

              <section class="extension-block" aria-labelledby="extension-history-title">
                <h4 id="extension-history-title">{{ $t('ui.extensions.history.title') }}</h4>
                <p v-if="!history.length" class="config-note">{{ $t('ui.extensions.history.empty') }}</p>
                <ol v-else class="extension-history">
                  <li v-for="entry in history" :key="entry.id">
                    <div>
                      <strong>{{ actionLabel(entry.action) }}</strong>
                      <p class="cell-note">{{ entry.actorId || 'Sistema' }} · {{ formatDate(entry.createdAt) }}</p>
                      <p v-if="historySummary(entry)" class="cell-note">{{ historySummary(entry) }}</p>
                    </div>
                    <button v-if="canRollback(entry, installedForDetail())" type="button" class="btn btn--secondary btn--small"
                            @click="askRollback(entry, installedForDetail())">
                      {{ rollbackMode(entry, installedForDetail()) === 'restore' ? 'Volver a ' + entry.detail.version + ' restaurando datos' : 'Volver a ' + entry.detail.version }}
                    </button>
                  </li>
                </ol>
              </section>
            </div>
          </section>
        </div>

        <section class="extension-installed" aria-labelledby="extension-installed-title">
          <header class="panel-head">
            <div><p class="eyebrow">{{ $t('ui.extensions.installed.title') }}</p><h3 id="extension-installed-title">{{ $t('ui.extensions.installed.modules') }}</h3></div>
            <span class="config-badge">{{ installedItems.length }}</span>
          </header>
          <p class="config-note">{{ $t('ui.extensions.installed.note') }}</p>
          <p v-if="!installedItems.length" class="config-empty">{{ $t('ui.extensions.installed.empty') }}</p>
          <ul v-else class="extension-installed__list">
            <li v-for="item in installedItems" :key="item.id">
              <div class="extension-installed__copy">
                <strong>{{ item.manifest.name || item.id }}</strong>
                <span class="cell-note">{{ $t('ui.extensions.installed.line', { id: item.id, version: item.version, revision: item.revision === null ? $t('ui.extensions.validation.unknown') : item.revision }) }}</span>
                <span class="cell-note">{{ $t('ui.extensions.contributions.operations_line', { count: item.operations.length, schema: item.schemaVersion }) }}</span>
                <span class="mono extension-digest">{{ item.digest }}</span>
              </div>
              <div class="extension-installed__actions">
                <span v-if="item.requiresUpgrade" class="status-pill status--warn">{{ $t('ui.extensions.page.upgrade') }}</span>
                <span v-else class="status-pill" :class="item.enabled ? 'status--ok' : 'status--hold'">{{ item.enabled ? 'Activa' : 'Desactivada' }}</span>
                <button v-if="item.requiresUpgrade" type="button" class="btn btn--secondary btn--small" @click="loadStatus(item)">{{ $t('ui.extensions.installed.status') }}</button>
                <template v-else>
                  <button v-if="item.enabled" type="button" class="btn btn--secondary btn--small" :disabled="!Number.isInteger(item.revision)" @click="askToggle(item, false)">{{ $t('ui.extensions.installed.disable') }}</button>
                  <button v-else type="button" class="btn btn--secondary btn--small" :disabled="!Number.isInteger(item.revision)" @click="askToggle(item, true)">{{ $t('ui.extensions.installed.enable') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="loadStatus(item)">{{ $t('ui.extensions.installed.status') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" :disabled="!Number.isInteger(item.revision)" @click="askUninstall(item)">{{ $t('ui.extensions.installed.uninstall') }}</button>
                </template>
              </div>
              <div v-if="status.byId[item.id] && (status.byId[item.id].loading || status.byId[item.id].loaded || status.byId[item.id].error)" class="extension-installed__status">
                <p v-if="status.byId[item.id].loading" class="config-note" role="status">{{ $t('ui.extensions.installed.loading') }}</p>
                <p v-else-if="status.byId[item.id].error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ status.byId[item.id].error }}</p>
                <dl v-else class="extension-facts">
                  <div v-for="fact in statusFacts(item)" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div>
                </dl>
              </div>
            </li>
          </ul>
        </section>

        <modal-shell :open="confirm.open" :title="confirm.title" eyebrow="Confirmación humana" size="small" @close="closeConfirm">
          <div class="extension-confirm">
            <p>{{ confirm.summary }}</p>
            <dl v-if="confirm.payload" class="extension-facts">
              <div v-if="confirm.payload.digest"><dt>{{ $t('ui.extensions.confirm.digest') }}</dt><dd class="mono extension-digest">{{ confirm.payload.digest }}</dd></div>
              <div v-if="confirm.payload.version"><dt>{{ $t('ui.extensions.confirm.target') }}</dt><dd>{{ confirm.payload.version }}</dd></div>
              <div><dt>{{ $t('ui.extensions.confirm.revision') }}</dt><dd>{{ confirm.payload.expectedVersion === null ? 'Primera instalación' : 'Revisión ' + confirm.payload.expectedVersion }}</dd></div>
            </dl>
            <div v-if="confirm.typedRequired" class="field">
              <label for="extension-confirm-typed">{{ $t('ui.extensions.confirm.type_id', { id: confirm.typedRequired }) }}</label>
              <div class="input-shell">
                <input id="extension-confirm-typed" v-model="confirm.typedValue" type="text" autocomplete="off" spellcheck="false" :aria-describedby="'extension-confirm-typed-hint'">
              </div>
              <p id="extension-confirm-typed-hint" class="field__hint">{{ $t('ui.extensions.confirm.restore_note') }}</p>
            </div>
            <p v-if="confirm.error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ confirm.error }}</p>
          </div>
          <template #footer>
            <button type="button" class="btn btn--ghost" :disabled="confirm.busy" @click="closeConfirm">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--primary" :disabled="confirm.busy" @click="confirmRun">
              {{ confirm.busy ? 'Enviando…' : confirm.confirmLabel }}
            </button>
          </template>
        </modal-shell>
      </section>
    `
  };

  window.ITSMExtensions = {
    sdkVersion: SDK_VERSION,
    trust: Object.freeze({
      declarativeModuleCodeInHostPage: false,
      isolatedModuleCode: 'sandboxed-frame',
      isolatedFrameSessionAccess: false,
      backendRunsInHostProcess: false,
      validationIsolated: true
    }),
    configure(options) {
      const config = options || {};
      if (config.app) runtime.app = config.app;
    },
    // Kept for diagnostic compatibility only: SDK 2 has no same-origin module
    // scripts, so a module cannot register host components here.
    register() {
      throw new Error('El SDK 2 no registra componentes en la página del host. Declara vistas en el manifiesto o usa una vista aislada.');
    }
  };

  window.AssetExtensions = {
    sdkVersion: SDK_VERSION,
    data() {
      return { extensions: emptyState() };
    },
    computed: {
      extensionPageLinks() { return pageLinks(this); }
    },
    load,
    start: load,
    stop,
    sync,
    routeOverride,
    sdkFor,
    widgetsFor,
    actionsFor,
    frameNavigate,
    compositionFor,
    readonlyAsset,
    pageLink,
    pageLinks,
    panelsFor,
    permissionGroups,
    candidateLink,
    methods: {
      extensionsLoad(options) { return load(this, options); },
      extensionsStop() { stop(this); },
      extensionsIdentityChanged() { if (this.authenticated) load(this, { force: true }); },
      handleExtensionRoute(route) {
        if (!this.authenticated || !route) return;
        if (route.name === 'extension' || (route.name === 'config' && route.section === 'extensiones')) {
          load(this);
        }
      }
    },
    components: {
      ExtensionPage,
      ExtensionAssetPanels,
      ExtensionReview,
      ...(window.ExtensionViews ? window.ExtensionViews.components : {}),
      ...(window.UIComposition ? window.UIComposition.components : {})
    }
  };
})();
