(function () {
  'use strict';

  const SDK_VERSION = 1;
  const DIGEST_RE = /^[a-f0-9]{64}$/;
  const EXTENSION_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9]*$/;
  const PAGE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const OPERATION_RE = /^[a-z][a-z0-9_]*$/;
  const PERMISSION_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
  const MAX_CONTRIBUTIONS = 50;

  const runtime = {
    app: null,
    reserved: new Set(['appicon', 'modalshell', 'itsmtable', 'itsmfield', 'itsmstatus', 'itsmerror']),
    definitions: new Map(),
    pending: new Map(),
    scripts: new Map(),
    epoch: 0,
    revision: 0
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

  // A replacement component that cannot render must not leave the core surface
  // suppressed. The failure is recorded per declaration; `project` then ignores
  // that declaration and the overlay is republished, which restores the core
  // widget and navigation link. Any later successful sync clears the record.
  function compositionFailure(vm, entry) {
    if (!vm || !entry || !entry.extensionId || !entry.contributionId) return false;
    const state = ensureState(vm);
    const failures = state.compositionFailures || (state.compositionFailures = {});
    const key = entry.extensionId + ':' + entry.contributionId;
    if (failures[key]) return true;
    failures[key] = true;
    emit(vm);
    return true;
  }

  function compositionFor(vm) {
    if (!vm || !window.UIComposition || typeof window.UIComposition.project !== 'function') {
      return { additions: {}, hidden: {}, replacement: {}, ignored: [], candidates: [] };
    }
    const state = ensureState(vm);
    const can = typeof vm.can === 'function' ? vm.can.bind(vm) : null;
    const failures = state.compositionFailures;
    return window.UIComposition.project(state.items, can, componentFor, failures && typeof failures === 'object' ? failures : null);
  }

  function componentKey(name) {
    return String(name || '').toLowerCase();
  }

  function addError(errors, message) {
    if (message && errors.indexOf(message) === -1) errors.push(message);
  }

  function normalizeContribution(raw, kind, errors, seen) {
    if (!isPlainObject(raw)) {
      addError(errors, 'Una contribución de ' + kind + ' no es un objeto válido.');
      return null;
    }
    const id = text(raw.id);
    const label = text(raw.label);
    const component = text(raw.component);
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
    if (!COMPONENT_RE.test(component) || component.length > 64) {
      addError(errors, 'La contribución "' + id + '" declara un componente no válido.');
      return null;
    }
    if (componentKey(component) && runtime.reserved.has(componentKey(component))) {
      addError(errors, 'El componente "' + component + '" usa un nombre reservado del núcleo.');
      return null;
    }
    if (!PERMISSION_RE.test(permission) || permission.length > 160) {
      addError(errors, 'La contribución "' + id + '" necesita un permiso del servidor.');
      return null;
    }
    return {
      id,
      label,
      component,
      permission,
      icon: text(raw.icon) || (kind === 'page' ? 'package' : 'box')
    };
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
    return {
      name,
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
    list(raw.operations).forEach((entry) => {
      const operation = normalizeOperation(entry, errors);
      if (operation && !operationNames.has(operation.name)) {
        operationNames.add(operation.name);
        operations.push(operation);
      }
    });

    const pages = [];
    const assetPanels = [];
    const frontend = isPlainObject(manifest && manifest.frontend) ? manifest.frontend : {};
    if (manifest && manifest.frontend !== undefined && !isPlainObject(manifest.frontend)) {
      addError(errors, 'El manifiesto declara un frontend no válido.');
    }
    if (isPlainObject(manifest && manifest.frontend) && frontend.entry !== undefined && frontend.entry !== 'frontend.js') {
      addError(errors, 'El manifiesto debe apuntar a frontend.js.');
    }
    const pageIds = new Set();
    list(frontend.pages).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const page = normalizeContribution(entry, 'page', errors, pageIds);
      if (page) pages.push(page);
    });
    if (list(frontend.pages).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiadas páginas.');
    const panelIds = new Set();
    list(frontend.assetPanels).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const panel = normalizeContribution(entry, 'assetPanel', errors, panelIds);
      if (panel) assetPanels.push(panel);
    });
    if (list(frontend.assetPanels).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiados paneles de activo.');

    // Optional SDK v1 UI composition. Entries are validated against the exact
    // shipped catalogue; one malformed or unknown entry is ignored at runtime
    // so the core surfaces and the rest of the module keep working.
    const contributions = [];
    const ignoredContributions = [];
    const contributionIds = new Set(pages.concat(assetPanels).map((entry) => entry.id));
    list(frontend.contributions).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const checked = window.UIComposition && typeof window.UIComposition.normalize === 'function'
        ? window.UIComposition.normalize(entry, { permissions, operations }, contributionIds)
        : { ok: false, error: 'El host no admite composición de interfaz.' };
      if (checked.ok) {
        contributionIds.add(checked.value.id);
        contributions.push(checked.value);
      } else {
        ignoredContributions.push({ raw: entry, error: checked.error });
      }
    });
    if (list(frontend.contributions).length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiadas contribuciones de interfaz.');

    const declaredComponents = [];
    pages.concat(assetPanels, contributions).forEach((entry) => {
      if (entry.component && declaredComponents.indexOf(entry.component) === -1) declaredComponents.push(entry.component);
    });
    if (declaredComponents.length > MAX_CONTRIBUTIONS) addError(errors, 'El módulo declara demasiados componentes.');

    let frontendUrl = '';
    if (enabled && declaredComponents.length) {
      try {
        frontendUrl = frontendUrlFor(raw.frontendUrl, id, digest);
      } catch (error) {
        addError(errors, error.message);
      }
    } else if (enabled && raw.frontendUrl) {
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
      frontendUrl,
      operations,
      permissions,
      pages,
      assetPanels,
      contributions,
      ignoredContributions,
      declaredComponents,
      invalid,
      loadError: invalid,
      loading: false,
      loaded: false
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

  function unload(id) {
    runtime.pending.delete(id);
    const script = runtime.scripts.get(id);
    if (script) {
      if (script.node && typeof script.node.remove === 'function') script.node.remove();
      runtime.scripts.delete(id);
    }
    runtime.definitions.forEach((claim, name) => {
      if (claim.id === id) runtime.definitions.delete(name);
    });
  }

  function unloadAll(vm) {
    Array.from(runtime.scripts.keys()).forEach((id) => unload(id));
    runtime.pending.clear();
    runtime.definitions.clear();
    const state = ensureState(vm);
    state.items = [];
    state.loading = false;
    state.loaded = false;
    emit(vm);
  }

  function isCurrentItem(vm, item) {
    if (!vm || !vm.authenticated || !item || !item.enabled || item.invalid) return false;
    const state = ensureState(vm);
    return state.items.indexOf(item) !== -1;
  }

  function loadScript(vm, item) {
    if (!item.enabled || item.invalid || !item.declaredComponents.length) return;
    const existing = runtime.scripts.get(item.id);
    if (existing && existing.digest === item.digest) return;
    unload(item.id);
    const pending = {
      id: item.id,
      digest: item.digest,
      vm,
      item,
      identity: identityKey(vm),
      components: new Map(),
      errors: [],
      names: new Set()
    };
    runtime.pending.set(item.id, pending);
    const node = window.document.createElement('script');
    node.src = item.frontendUrl;
    node.async = true;
    node.dataset.extensionId = item.id;
    node.dataset.extensionDigest = item.digest;
    node.onload = function () { commit(vm, pending, node); };
    node.onerror = function () {
      if (runtime.pending.get(item.id) !== pending || pending.identity !== identityKey(vm) || !isCurrentItem(vm, item)) return;
      runtime.pending.delete(item.id);
      item.loading = false;
      item.loadError = 'No se pudo cargar el módulo de la extensión.';
      runtime.scripts.delete(item.id);
      emit(vm);
    };
    pending.node = node;
    window.document.head.appendChild(node);
    runtime.scripts.set(item.id, { digest: item.digest, node, url: item.frontendUrl });
    item.loading = true;
    item.loaded = false;
    item.loadError = '';
    emit(vm);
  }

  function commit(vm, pending, node) {
    if (runtime.pending.get(pending.id) !== pending || pending.identity !== identityKey(vm) || !isCurrentItem(vm, pending.item)) {
      if (node && typeof node.remove === 'function') node.remove();
      return;
    }
    const item = pending.item;
    pending.item.declaredComponents.forEach((name) => {
      if (!pending.components.has(componentKey(name))) {
        addError(pending.errors, 'El módulo no registró el componente "' + name + '".');
      }
    });
    pending.components.forEach((claim, key) => {
      const existing = runtime.definitions.get(key);
      if (existing && existing.id !== pending.id) {
        addError(pending.errors, 'El componente "' + claim.name + '" ya pertenece a otra extensión.');
      }
    });
    runtime.pending.delete(pending.id);
    item.loading = false;
    if (pending.errors.length) {
      item.loadError = pending.errors.join(' ');
      emit(vm);
      return;
    }
    pending.components.forEach((claim, key) => {
      runtime.definitions.set(key, { id: pending.id, name: claim.name, definition: claim.definition });
      if (runtime.app && typeof runtime.app.component === 'function') {
        runtime.app.component(claim.name, claim.definition);
      }
    });
    item.loaded = true;
    item.loadError = '';
    emit(vm);
  }

  function sync(vm, payload) {
    const state = ensureState(vm);
    if (!payload || payload.sdkVersion !== SDK_VERSION) {
      unloadAll(vm);
      state.error = 'El servidor usa una versión del SDK incompatible. No se cargó ninguna extensión.';
      publishCatalog(vm);
      return false;
    }
    const nextItems = list(payload.items).map((raw) => normalizeItem(raw));
    const nextById = new Map(nextItems.map((item) => [item.id, item]));
    state.items.forEach((current) => {
      const next = nextById.get(current.id);
      if (!next || !next.enabled || next.digest !== current.digest || next.invalid) unload(current.id);
    });
    const currentById = new Map(state.items.map((item) => [item.id, item]));
    state.items = nextItems.map((next) => {
      const current = currentById.get(next.id);
      if (!current || current.digest !== next.digest || !current.enabled || !next.enabled || current.invalid || next.invalid) return next;
      const lifecycle = { loaded: current.loaded, loading: current.loading, loadError: current.loadError };
      Object.assign(current, next, lifecycle);
      return current;
    });
    state.error = '';
    state.loaded = true;
    state.identity = identityKey(vm);
    state.compositionFailures = {};
    publishCatalog(vm);
    state.items.forEach((item) => loadScript(vm, item));
    emit(vm);
    return true;
  }

  async function load(vm, options) {
    if (!vm || !vm.authenticated || !window.AssetAccess || typeof window.AssetAccess.request !== 'function') return false;
    const state = ensureState(vm);
    const identity = identityKey(vm);
    if (!(options && options.force) && state.loaded && state.identity === identity) return true;
    if (state.identity && state.identity !== identity) {
      unloadAll(vm);
      state.items = [];
      state.loaded = false;
    }
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
    runtime.definitions.clear();
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
      if (!item.enabled || item.invalid || item.loadError && !item.loaded) return;
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
      if (!item.enabled || item.invalid) return;
      item.assetPanels.forEach((panel) => {
        if (typeof vm.can !== 'function' || !vm.can(panel.permission)) return;
        panels.push({
          key: item.id + ':' + panel.id,
          item,
          panel,
          component: componentFor(panel.component),
          sdk: item.loaded ? sdkFor(vm, item) : null
        });
      });
    });
    return panels;
  }

  function componentFor(name) {
    const claim = runtime.definitions.get(componentKey(name));
    return claim ? claim.definition : null;
  }

  function operationFor(item, name) {
    return item.operations.find((operation) => operation.name === name) || null;
  }

  function sdkFor(vm, item) {
    if (!isCurrentItem(vm, item) || !item.loaded) return null;
    const allowed = new Set(item.permissions.map((permission) => permission.code));
    item.operations.forEach((operation) => allowed.add(operation.permission));
    const sdk = {
      id: item.id,
      version: item.version,
      request(operationName, args) {
        if (!isCurrentItem(vm, item) || !item.loaded) {
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
          if (!isCurrentItem(vm, item) || !item.loaded || identity !== identityKey(vm)) {
            throw new Error('La extensión ya no está activa.');
          }
          return response;
        });
      },
      can(permission) {
        if (!isCurrentItem(vm, item) || !item.loaded) return false;
        if (typeof permission !== 'string' || !allowed.has(permission)) return false;
        return typeof vm.can === 'function' && !!vm.can(permission);
      },
      navigate(target) {
        if (!isCurrentItem(vm, item) || !item.loaded) throw new Error('La extensión ya no está activa.');
        if (isPlainObject(target)) {
          const page = item.pages.find((entry) => entry.id === target.page);
          if (!page) throw new Error('La extensión no declara esa página.');
          const hash = pageLink(item.id, page);
          window.location.hash = hash;
          return hash;
        }
        const hash = text(target);
        if (!hash || hash.charAt(0) !== '#' || hash.indexOf('#/') !== 0 || hash.indexOf('\\') !== -1 || /\s/.test(hash)) {
          throw new Error('La ruta de navegación no es válida.');
        }
        if (/^#\/\/|^#\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(hash)) throw new Error('La ruta de navegación no es válida.');
        if (hash.indexOf('#/extensiones/') === 0) {
          const own = '#/extensiones/' + encode(item.id) + '/';
          if (hash.indexOf(own) !== 0) throw new Error('La ruta de otra extensión no está permitida.');
        }
        window.location.hash = hash;
        return hash;
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
    props: {
      app: { type: Object, required: true },
      extensionId: { type: String, default: '' },
      pageId: { type: String, default: '' }
    },
    computed: {
      item() {
        const state = this.app.extensions || {};
        return list(state.items).find((entry) => entry.id === this.extensionId && entry.enabled) || null;
      },
      page() {
        if (!this.item) return null;
        return this.item.pages.find((entry) => entry.id === this.pageId) || null;
      },
      allowed() {
        return !!(this.page && typeof this.app.can === 'function' && this.app.can(this.page.permission));
      },
      pageComponent() {
        return this.page ? componentFor(this.page.component) : null;
      },
      sdk() {
        return this.item && this.allowed ? sdkFor(this.app, this.item) : null;
      },
      title() {
        return this.page ? this.page.label : 'Extensión';
      }
    },
    template: `
      <section class="page extension-page" aria-labelledby="extension-page-title">
        <header class="page-head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Extensión nativa</p>
            <h1 id="extension-page-title">{{ title }}</h1>
            <p>{{ item ? (item.manifest.name || item.id) : 'Módulo no instalado o no autorizado' }}</p>
          </div>
          <div class="page-head__meta" aria-label="Estado de la extensión">
            <span v-if="item" class="status-pill status--ok">Activa</span>
            <span v-else class="status-pill status--hold">No disponible</span>
          </div>
        </header>

        <div v-if="!item" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="package"></app-icon></span>
          <h2>Extensión no disponible</h2>
          <p>El servidor no ofrece esta extensión a tu sesión. Puede estar desactivada o retirada.</p>
          <a class="btn btn--secondary" href="#/panel">Volver al panel</a>
        </div>
        <div v-else-if="!page" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="alert"></app-icon></span>
          <h2>Página no declarada</h2>
          <p>La extensión activa no publica la página {{ pageId }}.</p>
        </div>
        <div v-else-if="!allowed" class="config-empty" role="status">
          <span class="config-empty__icon"><app-icon name="lock"></app-icon></span>
          <h2>Sin permiso para esta página</h2>
          <p>La extensión exige el permiso <code>{{ page.permission }}</code>. El servidor vuelve a comprobarlo en cada operación.</p>
        </div>
        <p v-else-if="item.loading" class="config-note" role="status">
          <app-icon name="refresh"></app-icon>
          Cargando el módulo de {{ item.manifest.name || item.id }}…
        </p>
        <div v-else-if="item.loadError" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>El módulo no se pudo cargar.</strong><p>{{ item.loadError }}</p></div>
        </div>
        <p v-else-if="!pageComponent" class="config-note" role="status">
          <app-icon name="info"></app-icon>
          El módulo no expone el componente {{ page.component }}.
        </p>
        <component v-else :is="pageComponent" :sdk="sdk"></component>
      </section>
    `
  };

  const ExtensionAssetPanels = {
    name: 'ExtensionAssetPanels',
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
              <p class="eyebrow">Extensión nativa</p>
              <h2 :id="panelTitle(entry)">{{ entry.panel.label }}</h2>
              <p>{{ entry.item.manifest.name || entry.item.id }}</p>
            </div>
            <span class="chip chip--muted">{{ entry.item.version }}</span>
          </header>
          <div v-if="entry.item.loadError" class="form-alert" role="alert">
            <app-icon name="alert"></app-icon>
            <div><strong>El panel no se pudo cargar.</strong><p>{{ entry.item.loadError }}</p></div>
          </div>
          <p v-else-if="!entry.component || !entry.sdk" class="config-note" role="status">
            <app-icon name="refresh"></app-icon>
            Cargando el panel de la extensión…
          </p>
          <component v-else :is="entry.component" :sdk="entry.sdk" :asset="assetSnapshot"></component>
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
          candidateId: ''
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
        return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
        return this.detail && this.detail.trust && this.detail.trust.statement
          ? this.detail.trust.statement
          : 'Código aprobado que se ejecuta dentro del host. No es un sandbox para código hostil.';
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
      canRollback(entry, item) {
        if (!entry || !item || !this.detail || this.detail.rollbackCompatible !== true) return false;
        if (!Number.isInteger(item.revision)) return false;
        const action = text(entry.action);
        if (/submitted|validated|superseded|approved/.test(action)) return false;
        const target = entry.detail || {};
        if (!text(target.version) || !DIGEST_RE.test(text(target.digest))) return false;
        return compareVersions(target.version, item.version) < 0;
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
          candidateId: detail.id
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
          candidateId: ''
        };
      },
      askRollback(entry, item) {
        this.resetAction();
        if (!this.canManage) {
          this.action.error = 'Solo un Superadmin humano puede aplicar un rollback.';
          return;
        }
        if (!this.canRollback(entry, item)) {
          this.action.error = 'Ese evento del historial no permite un rollback compatible con la versión activa.';
          return;
        }
        const target = entry.detail;
        this.confirm = {
          open: true,
          busy: false,
          kind: 'rollback',
          title: 'Volver a ' + target.version,
          summary: 'El servidor comprobará que el paquete anterior sigue instalado y que su esquema es compatible con los datos actuales. Si no lo es, no cambia nada.',
          confirmLabel: 'Aplicar rollback',
          error: '',
          payload: { version: target.version, digest: target.digest, expectedVersion: item.revision },
          itemId: item.id,
          candidateId: this.detail ? this.detail.id : ''
        };
      },
      async confirmRun() {
        if (!this.confirm.open || this.confirm.busy) return false;
        const kind = this.confirm.kind;
        const payload = this.confirm.payload;
        let path = '';
        if (kind === 'approve') path = '/extensions/candidates/' + encode(this.confirm.candidateId) + '/approve';
        else if (kind === 'enable' || kind === 'disable') path = '/extensions/' + encode(this.confirm.itemId) + '/enabled';
        else if (kind === 'rollback') path = '/extensions/' + encode(this.confirm.itemId) + '/rollback';
        else return false;
        const epoch = this.reviewEpoch;
        const identity = identityKey(this.app);
        this.confirm.busy = true;
        this.confirm.error = '';
        this.action.error = '';
        this.action.message = '';
        try {
          await window.AssetAccess.request(this.app, path, { method: 'POST', body: payload });
          if (epoch !== this.reviewEpoch || !this.app.authenticated || identity !== identityKey(this.app)) return false;
          this.confirm.busy = false;
          this.confirm.open = false;
          this.review.stale = false;
          this.action.message = kind === 'approve'
            ? 'El servidor confirmó la aprobación e instalación del paquete.'
            : kind === 'rollback'
              ? 'El servidor confirmó el rollback y la compatibilidad de los datos.'
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
            <p class="eyebrow">Extensiones nativas</p>
            <h2 id="extension-review-title">Revisión e instalación</h2>
            <p>El servidor prepara cada candidato. Un Superadmin humano revisa el paquete exacto y decide. El texto de un agente nunca es una aprobación.</p>
          </div>
          <button type="button" class="btn btn--secondary" :disabled="review.loading" @click="reviewLoad({ force: true })">
            <app-icon name="refresh"></app-icon> Actualizar
          </button>
        </header>

        <div class="form-note extension-trust" role="note">
          <app-icon name="shield"></app-icon>
          <div>
            <strong>Nativas de confianza no significa código hostil aislado.</strong>
            <p>El código aprobado se ejecuta dentro del proceso del host con los permisos del servidor. La validación se ejecuta en un contenedor aislado antes de la aprobación, pero el módulo instalado no es un sandbox. Revisa el digest, los permisos, las migraciones y el historial antes de aprobar.</p>
          </div>
        </div>

        <div v-if="!canManage" class="form-alert" role="alert">
          <app-icon name="lock"></app-icon>
          <div><strong>Vista de solo lectura.</strong><p>Necesitas el permiso de módulos del sistema para aprobar, instalar o cambiar el estado. El servidor exige además un Superadmin humano.</p></div>
        </div>

        <div v-if="review.stale" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>El catálogo cambió durante la operación.</strong><p>No se aplicó ningún cambio local. Actualiza y revisa los datos exactos antes de volver a intentarlo.</p></div>
        </div>
        <div v-if="review.error" class="form-alert" role="alert">
          <app-icon name="alert"></app-icon>
          <div><strong>No se pudo consultar el catálogo.</strong><p>{{ review.error }}</p></div>
        </div>
        <p v-if="action.message" class="config-note" role="status"><app-icon name="check"></app-icon> {{ action.message }}</p>
        <p v-if="action.error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ action.error }}</p>

        <div class="extension-review__grid">
          <section class="extension-review__inbox" aria-labelledby="extension-candidates-title">
            <header class="panel-head">
              <div><p class="eyebrow">Bandeja</p><h3 id="extension-candidates-title">Candidatos</h3></div>
              <span class="config-badge">{{ candidates.length }}</span>
            </header>
            <div class="extension-filters" role="group" aria-label="Filtrar candidatos">
              <button v-for="filter in ['pending', 'installed', 'superseded', 'all']" :key="filter" type="button"
                      class="chip" :class="{ 'chip--active': review.filter === filter }"
                      :aria-pressed="review.filter === filter" @click="review.filter = filter">
                {{ reviewFilterLabel(filter) }}
              </button>
            </div>
            <p v-if="review.loading" class="config-note" role="status"><app-icon name="refresh"></app-icon> Consultando candidatos…</p>
            <p v-else-if="!candidates.length" class="config-note">No hay candidatos en este filtro. El servidor no ha recibido paquetes nuevos.</p>
            <ul v-else class="extension-candidates">
              <li v-for="candidate in candidates" :key="candidate.id">
                <button type="button" class="extension-candidate" :class="{ 'is-active': review.selectedId === candidate.id }"
                        :aria-pressed="review.selectedId === candidate.id" @click="selectCandidate(candidate.id)">
                  <span class="extension-candidate__top">
                    <strong>{{ candidate.extensionId }} {{ candidate.version }}</strong>
                    <span class="config-badge">{{ candidateStateLabel(candidate.state) }}</span>
                  </span>
                  <span class="cell-note">Validación: {{ validationStatusLabel(candidate.validationStatus) }} · {{ formatDate(candidate.submittedAt) }}</span>
                  <span class="cell-note">Activa: {{ candidate.currentVersion || 'Sin instalar' }} · revisión {{ candidate.currentRevision === null ? '—' : candidate.currentRevision }}</span>
                </button>
              </li>
            </ul>
          </section>

          <section class="extension-review__detail" aria-labelledby="extension-detail-title">
            <h3 id="extension-detail-title" class="sr-only">Detalle del candidato</h3>
            <p v-if="review.detailLoading" class="config-note" role="status"><app-icon name="refresh"></app-icon> Consultando el paquete exacto…</p>
            <div v-else-if="review.detailError" class="form-alert" role="alert"><app-icon name="alert"></app-icon><div><strong>No se pudo abrir el candidato.</strong><p>{{ review.detailError }}</p></div></div>
            <p v-else-if="!detail" class="config-empty">Selecciona un candidato de la bandeja para revisar su digest, permisos y validación.</p>
            <div v-else class="extension-detail">
              <header class="extension-detail__head">
                <div>
                  <p class="eyebrow">Paquete exacto</p>
                  <h3>{{ detail.extensionId }} {{ detail.version }}</h3>
                  <p class="cell-muted">{{ detail.manifest.name || detail.extensionId }}</p>
                </div>
                <span class="config-badge">{{ candidateStateLabel(detail.state) }}</span>
              </header>

              <dl class="extension-facts">
                <div><dt>Digest SHA-256</dt><dd class="mono extension-digest">{{ detail.digest }}</dd></div>
                <div><dt>Versión activa</dt><dd>{{ detail.currentVersion || 'Ninguna' }} · revisión {{ detail.currentRevision === null ? '—' : detail.currentRevision }}</dd></div>
                <div><dt>Revisión del candidato</dt><dd>{{ detail.revision }}</dd></div>
                <div><dt>Enviado</dt><dd>{{ detail.submittedBy || 'Sin identificar' }} · {{ formatDate(detail.submittedAt) }}</dd></div>
                <div><dt>Rollback compatible</dt><dd>{{ detail.rollbackCompatible ? 'Sí, el servidor lo comprobará al aplicar' : 'No ofrecido por el servidor' }}</dd></div>
              </dl>

              <section class="extension-block" aria-labelledby="extension-trust-title">
                <h4 id="extension-trust-title">Modelo de confianza</h4>
                <p>{{ detailTrustNotice() }}</p>
                <ul class="extension-checks">
                  <li>Modelo: <strong>{{ detail.trust && detail.trust.model || 'no informado' }}</strong></li>
                  <li>Sandbox del módulo instalado: <strong>{{ detail.trust && detail.trust.sandboxed === false ? 'no' : 'no informado' }}</strong></li>
                  <li>La validación previa no limita el código aprobado dentro del host.</li>
                </ul>
              </section>

              <section class="extension-block" aria-labelledby="extension-validation-title">
                <h4 id="extension-validation-title">Validación aislada</h4>
                <template v-if="detail.validation">
                  <p>Resultado: <strong>{{ validationStatusLabel(detail.validation.status) }}</strong> · digest {{ shortDigest(detail.validation.digest) }} · contenedor {{ detail.validation.container && detail.validation.container.image || 'no informado' }} · motor {{ detail.validation.container && detail.validation.container.engine || 'no informado' }}</p>
                  <ul class="extension-checks">
                    <li v-for="check in detail.validation.checks" :key="check.name">
                      <span class="status-pill" :class="check.status === 'passed' ? 'status--ok' : 'status--down'">{{ check.status === 'passed' ? 'Correcto' : 'Fallo' }}</span>
                      <span><strong>{{ check.name }}</strong> — {{ check.detail }}</span>
                    </li>
                  </ul>
                  <ul v-if="detail.validation.errors && detail.validation.errors.length" class="extension-errors" role="alert">
                    <li v-for="error in detail.validation.errors" :key="error">{{ error }}</li>
                  </ul>
                  <p class="cell-muted">Completada: {{ formatDate(detail.validation.completedAt) }}</p>
                </template>
                <p v-else class="config-note">El servidor no adjuntó un informe de validación. No se puede aprobar.</p>
              </section>

              <section class="extension-block" aria-labelledby="extension-permissions-title">
                <h4 id="extension-permissions-title">Cambios de permisos</h4>
                <p>Los permisos de la extensión se conceden con la aprobación y los aplica el servidor. El navegador no los guarda como autoridad.</p>
                <p class="cell-note">Concedidos a: {{ detail.permissionDelta.grantedTo || 'Superadmin' }}</p>
                <div class="extension-permission-columns">
                  <div><strong>Permisos nuevos</strong><ul v-if="detail.permissionDelta.added.length"><li v-for="permission in detail.permissionDelta.added" :key="'add-' + permission.code"><code>{{ permission.code }}</code> · {{ permission.label }}<p v-if="permission.description" class="cell-note">{{ permission.description }}</p></li></ul><p v-else class="cell-muted">Ninguno.</p></div>
                  <div><strong>Permisos retirados</strong><ul v-if="detail.permissionDelta.removed.length"><li v-for="code in detail.permissionDelta.removed" :key="'rem-' + code"><code>{{ code }}</code> · {{ permissionLabel(code) }}</li></ul><p v-else class="cell-muted">Ninguno.</p></div>
                </div>
                <p v-if="detail.permissionDelta.core && detail.permissionDelta.core.length" class="cell-note">Permisos del núcleo implicados: <span class="mono">{{ detail.permissionDelta.core.join(', ') }}</span></p>
                <p v-if="detail.permissionDelta.note" class="cell-note">{{ detail.permissionDelta.note }}</p>
              </section>

              <section class="extension-block" aria-labelledby="extension-contributions-title">
                <h4 id="extension-contributions-title">Aportaciones del paquete</h4>
                <p class="cell-note">SDK {{ detail.manifest.sdkVersion }} · esquema {{ detail.manifest.schemaVersion }}. Estos son los recursos declarados del paquete exacto que estás revisando.</p>
                <h5>Páginas y paneles de activos</h5>
                <ul class="extension-contributions">
                  <li v-for="page in detail.manifest.frontend && detail.manifest.frontend.pages || []" :key="'page-' + page.id">
                    Página <strong>{{ page.label }}</strong> · <code>{{ page.id }}</code> · componente <code>{{ page.component }}</code> · permiso <code>{{ page.permission }}</code>
                  </li>
                  <li v-for="panel in detail.manifest.frontend && detail.manifest.frontend.assetPanels || []" :key="'panel-' + panel.id">
                    Panel <strong>{{ panel.label }}</strong> · <code>{{ panel.id }}</code> · componente <code>{{ panel.component }}</code> · permiso <code>{{ panel.permission }}</code>
                  </li>
                </ul>
                <h5>Operaciones</h5>
                <p v-if="!detail.manifest.operations || !detail.manifest.operations.length" class="cell-note">No declara operaciones.</p>
                <ul v-else class="extension-contributions">
                  <li v-for="operation in detail.manifest.operations" :key="operation.name">
                    <code>{{ operation.name }}</code> · {{ operation.description }} · permiso <code>{{ operation.permission }}</code> · {{ operation.mutation ? 'modifica datos' : 'consulta' }}
                  </li>
                </ul>
                <h5>Persistencia y tareas periódicas</h5>
                <ul class="extension-contributions">
                  <li v-for="collection in detail.manifest.collections || []" :key="'collection-' + collection.name">
                    Colección <code>{{ collection.name }}</code> · {{ collection.description }}
                  </li>
                  <li v-for="schedule in detail.manifest.schedules || []" :key="'schedule-' + schedule.name">
                    Tarea <code>{{ schedule.name }}</code> · cada {{ schedule.intervalSeconds }} segundos · permiso <code>{{ schedule.permission }}</code>
                  </li>
                </ul>
                <h5>Referencias para agentes</h5>
                <p v-if="!detail.manifest.skills || !detail.manifest.skills.length" class="cell-note">No declara skills.</p>
                <ul v-else class="extension-contributions">
                  <li v-for="skill in detail.manifest.skills" :key="skill.name"><code>{{ skill.name }}</code> · {{ skill.description }} · <code>{{ skill.path }}</code></li>
                </ul>
              </section>

              <section class="extension-block" aria-labelledby="extension-migrations-title">
                <h4 id="extension-migrations-title">Plan de migraciones</h4>
                <p v-if="!detail.migrationPlan || !detail.migrationPlan.required">No se aplicarán migraciones para este candidato.</p>
                <template v-else>
                  <p>Esquema {{ detail.migrationPlan.from }} → {{ detail.migrationPlan.to }} · {{ detail.migrationPlan.compatible ? 'Compatible' : 'No compatible' }}. El rollback queda bloqueado si el esquema de datos deja de ser compatible.</p>
                  <ol class="extension-migrations">
                    <li v-for="revision in detail.migrationPlan.steps" :key="revision.from + '-' + revision.to">
                      {{ revision.from }} → {{ revision.to }} · <code>{{ revision.handler }}</code>
                    </li>
                  </ol>
                </template>
              </section>

              <div v-if="canManage" class="extension-actions">
                <button v-if="detail.state === 'pending'" type="button" class="btn btn--primary" @click="askApprove">
                  <app-icon name="check"></app-icon> Aprobar e instalar
                </button>
                <p v-if="detail.state === 'pending'" class="config-note">La aprobación humana instala este digest y activa una primera instalación. Una actualización conserva el estado activo o desactivado. Si el catálogo cambió, el servidor rechaza la operación como obsoleta.</p>
                <p v-else class="config-note">Este candidato ya está {{ candidateStateLabel(detail.state).toLowerCase() }}. Los cambios se gestionan desde los módulos instalados.</p>
              </div>

              <section class="extension-block" aria-labelledby="extension-history-title">
                <h4 id="extension-history-title">Historial</h4>
                <p v-if="!history.length" class="config-note">El servidor no adjuntó historial para este candidato.</p>
                <ol v-else class="extension-history">
                  <li v-for="entry in history" :key="entry.id">
                    <div>
                      <strong>{{ actionLabel(entry.action) }}</strong>
                      <p class="cell-note">{{ entry.actorId || 'Sistema' }} · {{ formatDate(entry.createdAt) }}</p>
                      <p v-if="historySummary(entry)" class="cell-note">{{ historySummary(entry) }}</p>
                    </div>
                    <button v-if="canRollback(entry, installedForDetail())" type="button" class="btn btn--secondary btn--small"
                            @click="askRollback(entry, installedForDetail())">
                      Volver a {{ entry.detail.version }}
                    </button>
                  </li>
                </ol>
              </section>
            </div>
          </section>
        </div>

        <section class="extension-installed" aria-labelledby="extension-installed-title">
          <header class="panel-head">
            <div><p class="eyebrow">Estado del servidor</p><h3 id="extension-installed-title">Módulos instalados</h3></div>
            <span class="config-badge">{{ installedItems.length }}</span>
          </header>
          <p class="config-note">Desactivar retira la interfaz y bloquea operaciones sin borrar datos. El servidor conserva el paquete y su historial para poder reactivarlo.</p>
          <p v-if="!installedItems.length" class="config-empty">No hay módulos instalados en este servidor.</p>
          <ul v-else class="extension-installed__list">
            <li v-for="item in installedItems" :key="item.id">
              <div class="extension-installed__copy">
                <strong>{{ item.manifest.name || item.id }}</strong>
                <span class="cell-note"><code>{{ item.id }}</code> · {{ item.version }} · revisión {{ item.revision === null ? 'no informada' : item.revision }}</span>
                <span class="cell-note">Operaciones autorizadas: {{ item.operations.length }} · esquema {{ item.schemaVersion }}</span>
                <span class="mono extension-digest">{{ item.digest }}</span>
              </div>
              <div class="extension-installed__actions">
                <span class="status-pill" :class="item.enabled ? 'status--ok' : 'status--hold'">{{ item.enabled ? 'Activa' : 'Desactivada' }}</span>
                <button v-if="item.enabled" type="button" class="btn btn--secondary btn--small" :disabled="!Number.isInteger(item.revision)" @click="askToggle(item, false)">Desactivar</button>
                <button v-else type="button" class="btn btn--secondary btn--small" :disabled="!Number.isInteger(item.revision)" @click="askToggle(item, true)">Activar</button>
              </div>
            </li>
          </ul>
        </section>

        <modal-shell :open="confirm.open" :title="confirm.title" eyebrow="Confirmación humana" size="small" @close="closeConfirm">
          <div class="extension-confirm">
            <p>{{ confirm.summary }}</p>
            <dl v-if="confirm.payload" class="extension-facts">
              <div v-if="confirm.payload.digest"><dt>Digest</dt><dd class="mono extension-digest">{{ confirm.payload.digest }}</dd></div>
              <div v-if="confirm.payload.version"><dt>Versión destino</dt><dd>{{ confirm.payload.version }}</dd></div>
              <div><dt>Revisión esperada del servidor</dt><dd>{{ confirm.payload.expectedVersion === null ? 'Primera instalación' : 'Revisión ' + confirm.payload.expectedVersion }}</dd></div>
            </dl>
            <p v-if="confirm.error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ confirm.error }}</p>
          </div>
          <template #footer>
            <button type="button" class="btn btn--ghost" :disabled="confirm.busy" @click="closeConfirm">Cancelar</button>
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
      model: 'trusted-native',
      approvedCodeRunsInHostProcess: true,
      hostileCodeSandbox: false,
      validationIsolated: true
    }),
    configure(options) {
      const config = options || {};
      if (config.app && typeof config.app.component === 'function') runtime.app = config.app;
      list(config.coreComponents).forEach((name) => {
        if (name) runtime.reserved.add(componentKey(name));
      });
      if (runtime.app) {
        runtime.definitions.forEach((claim) => runtime.app.component(claim.name, claim.definition));
      }
    },
    register(id, definition) {
      const extensionId = text(id);
      const pending = runtime.pending.get(extensionId);
      if (!pending) throw new Error('ITSMExtensions.register: la extensión "' + extensionId + '" no está cargando.');
      if (!isCurrentItem(pending.vm, pending.item) || pending.identity !== identityKey(pending.vm)) {
        throw new Error('ITSMExtensions.register: la carga de la extensión ya no está activa.');
      }
      if (window.document.currentScript && window.document.currentScript !== pending.node) {
        throw new Error('ITSMExtensions.register: el script no corresponde a la carga activa.');
      }
      if (!isPlainObject(definition) || !isPlainObject(definition.components)) {
        throw new Error('ITSMExtensions.register: se esperaba { components: { Nombre: definición } }.');
      }
      const names = Object.keys(definition.components);
      if (!names.length) throw new Error('ITSMExtensions.register: no se declaró ningún componente.');
      const accepted = [];
      names.forEach((name) => {
        const key = componentKey(name);
        if (!COMPONENT_RE.test(name) || name.length > 64) {
          pending.errors.push('El componente "' + name + '" no tiene un nombre válido.');
          throw new Error('ITSMExtensions.register: nombre de componente no válido: ' + name);
        }
        if (runtime.reserved.has(key)) {
          pending.errors.push('El componente "' + name + '" usa un nombre reservado del núcleo.');
          throw new Error('ITSMExtensions.register: el componente "' + name + '" es un nombre reservado del núcleo.');
        }
        const claim = runtime.definitions.get(key);
        if (claim && claim.id !== extensionId) {
          pending.errors.push('El componente "' + name + '" ya pertenece a otra extensión.');
          throw new Error('ITSMExtensions.register: el componente "' + name + '" ya está registrado por otra extensión.');
        }
        if (pending.components.has(key)) {
          pending.errors.push('El componente "' + name + '" está duplicado.');
          throw new Error('ITSMExtensions.register: el componente "' + name + '" está duplicado.');
        }
        if (!definition.components[name] || (typeof definition.components[name] !== 'object' && typeof definition.components[name] !== 'function')) {
          throw new Error('ITSMExtensions.register: la definición de "' + name + '" no es válida.');
        }
        accepted.push({ key, name, definition: definition.components[name] });
      });
      accepted.forEach((entry) => pending.components.set(entry.key, entry));
      return true;
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
    componentFor,
    sdkFor,
    compositionFor,
    compositionFailure,
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
      ...(window.UIComposition ? window.UIComposition.components : {})
    }
  };
})();
