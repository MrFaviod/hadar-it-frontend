(function () {
  'use strict';
  const Store = window.AssetStore || {};
  const ACCESS_KEY = 'asset-manager.access';
  const SESSION_KEY = (Store.KEYS && Store.KEYS.session) || 'asset-manager.session';
  const DEFAULT_SESSION_MINUTES = 30;
  const CATALOG_SOURCE = [
    {
      id: 'assets',
      label: 'Activos',
      icon: 'desktop',
      permissions: [
        { id: 'assets.view', label: 'Ver' },
        { id: 'assets.edit', label: 'Editar' },
        { id: 'assets.assign', label: 'Asignar responsables' },
        { id: 'assets.remote', label: 'Acceso remoto' },
        { id: 'assets.purge', label: 'Eliminar definitivamente' }
      ]
    },
    {
      id: 'reports',
      label: 'Reportes',
      icon: 'file-text',
      permissions: [
        { id: 'reports.share', label: 'Compartir reportes públicos' }
      ]
    },
    {
      id: 'people',
      label: 'Personas',
      icon: 'user',
      permissions: [
        { id: 'people.view', label: 'Ver' },
        { id: 'people.create', label: 'Crear' },
        { id: 'people.edit', label: 'Editar' }
      ]
    },
    {
      id: 'config',
      label: 'Configuración',
      icon: 'sliders',
      permissions: [
        { id: 'config.general', label: 'General' },
        { id: 'config.categories', label: 'Categorías' },
        { id: 'config.sites', label: 'Sedes y ubicaciones' },
        { id: 'config.departments', label: 'Departamentos' },
        { id: 'config.integrations', label: 'Integraciones' }
      ]
    },
    {
      id: 'agents',
      label: 'Inteligencia artificial',
      icon: 'layers',
      permissions: [
        { id: 'agents.providers.personal', label: 'Administrar proveedores propios' }
      ]
    },
    {
      // Installation ownership: these grants are reserved for the human
      // Superadmin and never imply business administration.
      id: 'system',
      label: 'Sistema',
      icon: 'server',
      permissions: [
        { id: 'system.view', label: 'Ver estado' },
        { id: 'system.providers', label: 'Proveedores de IA' },
        { id: 'system.modules', label: 'Módulos' },
        { id: 'system.configure', label: 'Configuración del despliegue' },
        { id: 'system.backup', label: 'Respaldos' },
        { id: 'system.update', label: 'Actualizaciones' }
      ]
    },
    {
      id: 'users',
      label: 'Usuarios',
      icon: 'user',
      permissions: [
        { id: 'users.view', label: 'Ver' },
        { id: 'users.create', label: 'Crear' },
        { id: 'users.edit', label: 'Editar' }
      ]
    },
    {
      id: 'roles',
      label: 'Roles y permisos',
      icon: 'shield',
      permissions: [
        { id: 'roles.manage', label: 'Administrar' }
      ]
    },
    {
      id: 'sessions',
      label: 'Sesiones',
      icon: 'lock',
      permissions: [
        { id: 'sessions.manage', label: 'Administrar' }
      ]
    }
  ];
  // The permission catalog is a display snapshot of server-issued grants; it
  // is never authority. Extension groups are merged from discovery so a human
  // Superadmin can review revoked/disabled module permissions in role details.
  const CATALOG = window.Vue && typeof window.Vue.reactive === 'function'
    ? window.Vue.reactive(CATALOG_SOURCE)
    : CATALOG_SOURCE;

  const PERMISSION_IDS = CATALOG.reduce((result, group) => {
    group.permissions.forEach((permission) => result.push(permission.id));
    return result;
  }, []);
  const PERMISSION_SET = new Set(PERMISSION_IDS);
  const CORE_PERMISSION_SET = new Set(PERMISSION_IDS);
  let extensionPermissionIds = new Set();

  function setExtensionPermissions(groups) {
    const nextGroups = [];
    const nextIds = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      if (!group || typeof group.id !== 'string' || !group.id || !Array.isArray(group.permissions)) return;
      const permissions = [];
      group.permissions.forEach((permission) => {
        const id = permission && typeof permission.id === 'string' ? permission.id : '';
        if (!id || CORE_PERMISSION_SET.has(id) || id.indexOf('ext_') !== 0 || id.indexOf('.') === -1) return;
        if (nextIds.has(id)) return;
        nextIds.add(id);
        permissions.push({
          id,
          label: typeof permission.label === 'string' && permission.label.trim() ? permission.label.trim() : id,
          description: typeof permission.description === 'string' ? permission.description : ''
        });
      });
      if (!permissions.length) return;
      nextGroups.push({
        id: String(group.id),
        label: typeof group.label === 'string' && group.label.trim() ? group.label.trim() : String(group.id),
        icon: typeof group.icon === 'string' && group.icon ? group.icon : 'package',
        extension: true,
        permissions
      });
    });
    for (let index = CATALOG.length - 1; index >= 0; index -= 1) {
      if (CATALOG[index].extension) CATALOG.splice(index, 1);
    }
    extensionPermissionIds.forEach((id) => PERMISSION_SET.delete(id));
    nextGroups.forEach((group) => {
      CATALOG.push(group);
      group.permissions.forEach((permission) => PERMISSION_SET.add(permission.id));
    });
    extensionPermissionIds = nextIds;
  }

  // The catalog tab holds field/category forms (config.categories) and
  // status/rule forms (config.general); either grant reaches the section, and
  // each control still checks its own backend permission.
  const CONFIG_SECTION_PERMISSIONS = { activos: ['config.categories', 'config.general'] };
  const CONFIG_PERMISSION_BY_SECTION = {
    // Installation status and operations: the reserved system grants never
    // travel with business administration. The section route itself needs
    // system.view; each control checks its own backend permission.
    sistema: 'system.view',
    activos: 'config.categories',
    general: 'config.general',
    apariencia: 'config.general',
    categorias: 'config.categories',
    sedes: 'config.sites',
    personas: 'config.departments',
    integraciones: 'config.integrations',
    // Chat preferences and the IA page are available to any signed-in user;
    // administration controls inside the page require system.providers.
    ia: 'assets.view',
    // The relationship vocabulary is general configuration on the server, not
    // an asset edit: administering types needs config.general, while editing an
    // individual relation still needs assets.edit.
    relaciones: 'config.general',
    mantenimiento: 'assets.edit',
    supervision: 'assets.edit',
    alertas: 'assets.edit',
    notificaciones: 'config.integrations',
    mapas: 'config.sites',
    datos: 'assets.edit',
    reportes: 'config.general',
    // The only stored warranty preference is the expiring-day threshold, which
    // the server guards with config.general (phase 6, S7).
    garantias: 'config.general',
    qr: 'config.general',
    etiquetas: 'config.general',
    // Installation approval is a reserved human Superadmin capability. The
    // section is reachable for review, and every lifecycle control still
    // requires the exact server check.
    extensiones: 'system.modules'
  };

  const SENSITIVE_DIALOG_KEYS = [
    'assetConfig', 'remoteDialog', 'assignDialog', 'personDialog',
    'departmentDialog', 'categoryDialog', 'siteDialog', 'locationDialog',
    'confirmDialog', 'userDialog', 'roleDialog', 'securityDialog',
    'accessUserDialog', 'accessRoleDialog', 'sessionDialog'
  ];


  function text(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim() : (fallback || ''); }
  function canonicalRoleId(value) { return text(value, ''); }
  function safePermissions(value) {
    return Array.isArray(value) ? value.filter(id => typeof id === 'string' &&
      (PERMISSION_SET.has(id) || /^ext_[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(id))) : [];
  }
  function makeResult(ok, error, fieldErrors, extra) { return Object.assign({ ok: !!ok, error: error || '', fieldErrors: fieldErrors || {} }, extra || {}); }
  function roleFor(vm, id) { return vm.security.roles.find(role => role.id === id) || null; }
  function userFor(vm, id) { return vm.security.users.find(user => user.id === id) || null; }
  function loginRoute() { return { name: 'login', assetId: null, personId: null, userId: null, section: null }; }
  function deniedRoute() { return { name: 'denied', assetId: null, personId: null, userId: null, section: null }; }
  function homeRoute() { return { name: 'panel', assetId: null, personId: null, userId: null, section: null }; }
  function configPermission(section) { return CONFIG_PERMISSION_BY_SECTION[text(section, '')] || null; }
  function sectionPermissions(section) {
    const id = text(section, '');
    if (CONFIG_SECTION_PERMISSIONS[id]) return CONFIG_SECTION_PERMISSIONS[id].slice();
    const permission = configPermission(id);
    return permission ? [permission] : ['security'];
  }
  function allows(vm, permissions) { return permissions.some(permission => vm.can(permission)); }
  function isPublicReportRoute(route) {
    return !!route && route.name === 'reportAsset' && route.section === 'publico' && !!route.shareToken;
  }
  function routePermissions(route) {
    if (isPublicReportRoute(route)) return [];
    if (['users', 'user'].includes(route.name)) return ['users.view'];
    if (['people', 'person'].includes(route.name)) return ['people.view'];
    // A native extension page is a shell route: the enabled module's declared
    // page permission is enforced by the page component before rendering, and
    // every operation is re-authorized by the server.
    if (route && route.name === 'extension') return [];
    if (route.name === 'config') return sectionPermissions(route.section);
    if (['login', 'denied'].includes(route.name)) return [];
    return ['assets.view'];
  }
  function closeSensitiveDialogs(vm) {
    SENSITIVE_DIALOG_KEYS.forEach(key => { if (vm[key] && typeof vm[key] === 'object') vm[key].open = false; });
    if (vm.loginForm) vm.loginForm.password = '';
    vm.showPassword = false;
  }
  function discardLegacyStorage() {
    // Remove only obsolete prototype authentication, never domain inventory or preferences.
    try { window.localStorage.removeItem(ACCESS_KEY); } catch (_) { /* Storage may be unavailable. */ }
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* Cookies remain the session transport. */ }
  }
  function clearIdentity(vm) {
    vm.authenticated = false; vm.activeUserId = null; vm.serverPermissions = []; vm.csrfToken = '';
    // The demo marker belongs to the session identity: logout, expiry and a
    // fresh start must not leave a stale notice behind.
    vm.demoMode = false;
    vm.security = { users: [], roles: [], sessionMinutes: DEFAULT_SESSION_MINUTES };
    closeSensitiveDialogs(vm); discardLegacyStorage();
    // The tokenized public report is a sessionless screen: an expired private
    // session must not replace it with the login form.
    const publicRoute = isPublicReportRoute(vm.route);
    vm.route = publicRoute ? vm.route : loginRoute();
    if (!publicRoute && vm.ensureHash) vm.ensureHash('#/login');
  }
  const messages = {
    unauthorized: 'La sesión ha vencido. Inicia sesión de nuevo.',
    forbidden: 'No tienes permisos para realizar esta acción.',
    conflict: 'La operación no se puede completar con el estado actual.',
    validation_error: 'Revisa los campos indicados.',
    not_found: 'El registro no está disponible.',
    rate_limited: 'Demasiados intentos. Espera antes de volver a intentarlo.',
    too_many_requests: 'Se alcanzó el límite diario de tokens. Un motor externo pudo haber procesado la solicitud y la cuota estricta no está garantizada.',
    unavailable: 'El motor no está disponible en este momento.'
  };
  function responseError(vm, path, response, payload) {
    if (response.status === 401 && path !== '/auth/login' && !path.startsWith('/reports/public/')) clearIdentity(vm);
    const code = payload && payload.error && payload.error.code;
    const serverMessage = payload && payload.error && typeof payload.error.message === 'string' ? payload.error.message.trim() : '';
    const details = Array.isArray(payload && payload.details) ? payload.details : [];
    const detailText = details.map(item => {
      const field = typeof item.field === 'string' ? item.field.trim() : '';
      const message = typeof item.message === 'string' ? item.message.trim() : '';
      return message ? (field ? field + ': ' + message : message) : '';
    }).filter(Boolean).join(' · ');
    const reason = code === 'validation_error' ? (detailText || serverMessage) : '';
    const error = new Error(path === '/auth/login' && response.status === 401 ? 'Usuario o contraseña incorrectos.' : (reason ? 'El servidor rechazó la solicitud: ' + reason : (messages[code] || 'No se pudo completar la solicitud.')));
    error.status = response.status;
    error.code = code || '';
    error.serverMessage = serverMessage;
    error.details = details.map(item => ({ field: String(item.field || ''), message: String(item.message || '') }));
    error.fieldErrors = {};
    details.forEach(item => { const field = String(item.field || '').split('.').pop(); if (field) error.fieldErrors[field] = 'Revisa este campo.'; });
    return error;
  }
  function takeFrame(buffer) {
    const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
    if (!match) return null;
    return { frame: buffer.slice(0, match.index), rest: buffer.slice(match.index + match[0].length) };
  }
  function parseFrame(raw) {
    const data = [];
    String(raw || '').split(/\r\n|\r|\n/).forEach(line => {
      if (!line || line.charAt(0) === ':') return;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
    });
    if (!data.length) return null;
    const event = JSON.parse(data.join('\n'));
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null;
  }
  async function request(vm, path, options) {
    const init = Object.assign({ method: 'GET' }, options || {});
    const headers = { Accept: 'application/json' };
    // Inventory images travel as raw bytes; every other write stays JSON. The
    // browser owns the binary Content-Type, so no JSON header is invented.
    const binary = typeof ArrayBuffer !== 'undefined' && (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body) || (typeof Blob !== 'undefined' && init.body instanceof Blob));
    if (init.body !== undefined && !binary) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body); }
    if (init.method !== 'GET' && vm.csrfToken) headers['X-CSRF-Token'] = vm.csrfToken;
    const state = vm.__assetAccess;
    const signal = init.signal || (state && state.controller.signal);
    const response = await window.fetch('/api/v1' + path, Object.assign(init, { credentials: 'same-origin', headers, signal }));
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch (_) { /* Text/HTML failures keep their HTTP status and use the Spanish status mapping. */ }
      if (state && state.stopped) throw new Error('Solicitud cancelada.');
      throw responseError(vm, path, response, payload);
    }
    const payload = init.responseType === 'blob'
      ? await response.blob()
      : response.status === 204 ? null : await response.json();
    if (state && state.stopped) throw new Error('Solicitud cancelada.');
    return payload;
  }
  // POST streaming: the message body must be sent as a request, so EventSource
  // is not usable. This reads the response incrementally with the same cookie,
  // CSRF, origin and abort semantics as `request`, and yields parsed SSE events.
  async function* stream(vm, path, options) {
    const init = Object.assign({ method: 'GET' }, options || {});
    const headers = { Accept: 'text/event-stream' };
    if (init.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body); }
    if (init.method !== 'GET' && vm.csrfToken) headers['X-CSRF-Token'] = vm.csrfToken;
    const state = vm.__assetAccess;
    const signal = init.signal || (state && state.controller.signal);
    const response = await window.fetch('/api/v1' + path, Object.assign(init, { credentials: 'same-origin', headers, signal }));
    if (state && state.stopped) throw new Error('Solicitud cancelada.');
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch (_) { /* non-JSON failures use the status mapping */ }
      throw responseError(vm, path, response, payload);
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('El servidor no envió un flujo de eventos.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let taken = takeFrame(buffer);
        while (taken) {
          buffer = taken.rest;
          const event = parseFrame(taken.frame);
          if (event) yield event;
          taken = takeFrame(buffer);
        }
        if (state && state.stopped) throw new Error('Solicitud cancelada.');
      }
      buffer += decoder.decode();
      const trailing = parseFrame(buffer);
      if (trailing) yield trailing;
    } finally {
      try { await reader.cancel(); } catch (_) { /* already closed or aborted */ }
    }
  }
  function applySession(vm, payload) {
    if (!payload.user || !payload.user.active) throw new Error('La sesión no está disponible.');
    vm.csrfToken = payload.csrfToken || '';
    vm.serverPermissions = safePermissions(payload.permissions);
    // Only the server's exact boolean marks a demo installation. Missing or
    // malformed values keep an ordinary installation, never a stringified one.
    vm.demoMode = payload.demoMode === true;
    vm.security.users = [payload.user];
    vm.security.sessionMinutes = payload.sessionMinutes || DEFAULT_SESSION_MINUTES;
    vm.activeUserId = payload.user.id;
    vm.authenticated = true;
  }
  async function loadState(vm) {
    const payload = await request(vm, '/identity/state');
    const current = vm.currentUser;
    vm.security = { users: Array.isArray(payload.users) ? payload.users : [current], roles: Array.isArray(payload.roles) ? payload.roles : [], sessionMinutes: payload.sessionMinutes || vm.security.sessionMinutes };
    if (current && !userFor(vm, current.id)) vm.security.users.unshift(current);
  }
  function moveTo(vm, route) {
    vm.route = vm.accessRoute(route);
    if (vm.ensureHash && vm.hashFor) vm.ensureHash(vm.hashFor(vm.route));
  }
  async function save(vm, path, method, body, permission) {
    if (!vm.requirePermission(permission)) return makeResult(false, messages.forbidden);
    try {
      const payload = await request(vm, path, { method, body });
      const session = await request(vm, '/auth/me');
      applySession(vm, session);
      await loadState(vm);
      vm.syncAccess();
      return makeResult(true, '', {}, payload);
    } catch (error) { return makeResult(false, error.message || 'No se pudo guardar el cambio.', error.fieldErrors); }
  }
  const methods = {
    can(permission) {
      if (permission === 'security') return this.can('roles.manage') || this.can('sessions.manage');
      return !!(this.authenticated && this.currentUser && this.currentUser.active && this.effectivePermissions.includes(permission));
    },
    canConfig(section) { return allows(this, sectionPermissions(section)); },
    requirePermission(permission) { const allowed = this.can(permission); if (!allowed && this.showToast) this.showToast(messages.forbidden, 'error'); return allowed; },
    roleLabel(id) { const role = roleFor(this, id); return role ? role.name : 'Sin rol'; },
    userPersonLabel(user) { const person = user && user.personId && (this.people || []).find(item => item.id === user.personId); return person ? person.name : user && user.personId ? 'Persona no disponible' : 'Sin vincular'; },
    userPermissions(user) { const role = roleFor(this, user && user.roleId); return role ? safePermissions(role.permissions) : []; },
    permissionGroups() { return CATALOG; },
    closeAccessDialogs() { closeSensitiveDialogs(this); },
    securityPersist() { return false; },
    mapSecurityState() { return this.security; },
    syncAccess() { if (!this.authenticated) return false; moveTo(this, this.route); return true; },
    accessRoute(route) {
      if (isPublicReportRoute(route)) return route;
      if (!this.authenticated || !this.currentUser || !this.currentUser.active) return loginRoute();
      const next = route && route.name === 'login' ? homeRoute() : route || homeRoute();
      const permissions = routePermissions(next);
      return !permissions.length || allows(this, permissions) ? next : deniedRoute();
    },
    async checkAccessSession() {
      if (!this.authenticated || this.__assetAccess && this.__assetAccess.stopped) return false;
      try { applySession(this, await request(this, '/auth/me')); await loadState(this); this.syncAccess(); return true; }
      catch (error) { if (error.status !== 401) clearIdentity(this); return false; }
    },
    scheduleAccessCheck() {
      const state = this.__assetAccess;
      if (!state || state.stopped) return;
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = window.setTimeout(async () => {
        state.timer = null;
        if (this.authenticated) await this.checkAccessSession();
        if (!state.stopped && this.authenticated) this.scheduleAccessCheck();
      }, 60000);
    },
    touchAccessSession() { /* The server owns expiry; browser activity cannot extend it. */ },
    startSessionListeners() { this.scheduleAccessCheck(); },
    stopSessionListeners() { const state = this.__assetAccess; if (state && state.timer) window.clearTimeout(state.timer); },
    async submitLogin() {
      if (this.loginBusy) return makeResult(false, 'Solicitud en curso.');
      const form = this.loginForm || {};
      this.loginErrors = { username: text(form.username) ? '' : 'Introduce tu usuario.', password: form.password ? '' : 'Introduce tu contraseña.', general: '' };
      if (this.loginErrors.username || this.loginErrors.password) return makeResult(false, 'Completa los campos requeridos.', this.loginErrors);
      this.loginBusy = true;
      try {
        applySession(this, await request(this, '/auth/login', { method: 'POST', body: { username: text(form.username), password: form.password } }));
        await loadState(this);
        this.loginForm.password = ''; this.showPassword = false;
        moveTo(this, homeRoute()); this.startSessionListeners();
        return makeResult(true, '', {}, { user: this.currentUser });
      } catch (error) {
        const typedPassword = this.loginForm.password;
        clearIdentity(this);
        this.loginForm.password = typedPassword;
        this.loginErrors.general = error.message || 'No se pudo conectar con el servidor.';
        return makeResult(false, this.loginErrors.general);
      } finally { this.loginBusy = false; }
    },
    async logout() {
      try { await request(this, '/auth/logout', { method: 'POST' }); }
      catch (error) { if (error.status !== 401) { if (this.showToast) this.showToast('No se pudo cerrar la sesión en el servidor.', 'error'); return false; } }
      this.stopSessionListeners(); clearIdentity(this); return true;
    },
    saveUser(draft) {
      const body = { username: draft.username, name: draft.name, email: draft.email || '', roleId: draft.roleId, personId: draft.personId || '', active: draft.active !== false };
      if (draft.password) body.password = draft.password;
      return save(this, '/identity/users' + (draft.id ? '/' + encodeURIComponent(draft.id) : ''), draft.id ? 'PUT' : 'POST', body, draft.id ? 'users.edit' : 'users.create');
    },
    setUserActive(user, active) { return save(this, '/identity/users/' + encodeURIComponent(user.id) + '/active', 'PATCH', { active: !!active }, 'users.edit'); },
    saveRole(draft) { return save(this, '/identity/roles' + (draft.id ? '/' + encodeURIComponent(draft.id) : ''), draft.id ? 'PUT' : 'POST', { name: draft.name, permissions: safePermissions(draft.permissions) }, 'roles.manage'); },
    saveSecurityPreferences(minutes) { return save(this, '/identity/settings', 'PUT', { sessionMinutes: Number(minutes) }, 'sessions.manage'); }
  };
  const wrapperPermissions = {
    saveCategory: () => 'config.categories',
    handleCategoryImageUpload: () => 'config.categories',
    applyImagePreset: () => 'config.categories',
    requestDeleteCategory: () => 'config.categories',
    saveSite: () => 'config.sites',
    requestDeleteSite: () => 'config.sites',
    saveLocation: () => 'config.sites',
    requestDeleteLocation: () => 'config.sites',
    saveDepartment: () => 'config.departments',
    requestDeleteDepartment: () => 'config.departments',
    saveIntegrations: () => 'config.integrations',
    saveAssetConfig: () => 'assets.edit',
    openAssetConfig: () => 'assets.edit',
    openRemote: () => 'assets.remote',
    simulateRemote: () => 'assets.remote',
    openAssignAsset: () => 'assets.assign',
    openAssignPerson: () => 'assets.assign',
    selectAssignPerson: () => 'assets.assign',
    selectAssignAsset: () => 'assets.assign',
    confirmAssignment: () => 'assets.assign',
    removeAssignment: () => 'assets.assign',
    savePerson: (vm) => vm.personDialog && vm.personDialog.mode === 'edit' ? 'people.edit' : 'people.create',
    setPersonActive: () => 'people.edit',
    openAssetCreate: () => 'assets.edit',
    openAssetEdit: () => 'assets.edit',
    openAssetDuplicate: () => 'assets.edit',
    duplicateAsset: () => 'assets.edit',
    saveAsset: () => 'assets.edit',
    openStatusDialog: () => 'assets.edit',
    confirmStatusChange: () => 'assets.edit',
    openRetireDialog: () => 'assets.edit',
    confirmRetire: () => 'assets.edit',
    restoreAsset: () => 'assets.edit',
    openDeleteAsset: (vm) => purgePermission(vm),
    confirmDeleteAsset: (vm) => purgePermission(vm),
    openAssetField: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    saveAssetField: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    setAssetFieldActive: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    requestDeleteAssetField: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    openAssetStatusDialog: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    saveAssetStatus: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    setAssetStatusActive: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    requestDeleteAssetStatus: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    openFormDraft: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    saveFormDraft: (vm) => serverMode(vm) ? 'config.categories' : 'assets.edit',
    saveAssetIdRules: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    resetAssetIdRules: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    saveInventoryTransitionsDraft: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    applyAssetAdminConfirm: (vm) => serverMode(vm) ? 'config.general' : 'assets.edit',
    setOperationsMode: (vm) => serverMode(vm) ? null : 'assets.edit'
  };

  function serverMode(vm) { return !!(vm.inventoryServerMode ? vm.inventoryServerMode() : vm.authenticated); }
  function purgePermission(vm) {
    const policy = vm.inventoryPurgePolicy ? vm.inventoryPurgePolicy() : null;
    return policy && policy.permission ? policy.permission : 'assets.edit';
  }

  function confirmPermission(vm) {
    const kind = vm.confirmDialog && vm.confirmDialog.kind;
    if (kind === 'delete-category') return 'config.categories';
    if (kind === 'delete-site' || kind === 'delete-location') return 'config.sites';
    if (kind === 'delete-department') return 'config.departments';
    if (kind === 'delete-asset-field') return serverMode(vm) ? 'config.categories' : 'assets.edit';
    if (kind === 'delete-asset-status') return serverMode(vm) ? 'config.general' : 'assets.edit';
    if (kind === 'delete-user') return 'users.edit';
    if (kind === 'delete-role') return 'roles.manage';
    return null;
  }

  function guardMethods(source) {
    const result = Object.assign({}, source || {});
    Object.keys(wrapperPermissions).forEach((name) => {
      const original = result[name];
      if (typeof original !== 'function') return;
      result[name] = function () {
        const permission = wrapperPermissions[name](this);
        if (permission && !this.requirePermission(permission)) return false;
        return original.apply(this, arguments);
      };
    });

    if (typeof result.executeConfirm === 'function') {
      const originalConfirm = result.executeConfirm;
      result.executeConfirm = function () {
        const permission = confirmPermission(this);
        if (permission && !this.requirePermission(permission)) return false;
        return originalConfirm.apply(this, arguments);
      };
    }

    return result;
  }

  const computed = {
    currentUser() {
      const users = this.security && Array.isArray(this.security.users) ? this.security.users : [];
      return users.find((user) => user.id === this.activeUserId) || null;
    },

    currentRole() {
      const roleId = this.currentUser && this.currentUser.roleId;
      const roles = this.security && Array.isArray(this.security.roles) ? this.security.roles : [];
      return roles.find((role) => role.id === canonicalRoleId(roleId)) || null;
    },

    effectivePermissions() {
      return this.authenticated ? this.serverPermissions : [];
    },

    filteredUsers() {
      const users = this.security && Array.isArray(this.security.users) ? this.security.users : [];
      const search = text(this.userSearch, '').toLocaleLowerCase('es');
      const roleFilter = this.userRoleFilter || 'all';
      const stateFilter = this.userStateFilter || 'all';
      return users.filter((user) => {
        if (roleFilter !== 'all' && user.roleId !== canonicalRoleId(roleFilter)) return false;
        if (stateFilter === 'active' && !user.active) return false;
        if (stateFilter === 'inactive' && user.active) return false;
        if (!search) return true;
        const haystack = [user.username, user.name, user.email, methods.roleLabel.call(this, user.roleId), methods.userPersonLabel.call(this, user)].join(' ').toLocaleLowerCase('es');
        return haystack.indexOf(search) !== -1;
      }).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    },

    currentAccount() {
      const users = this.security && Array.isArray(this.security.users) ? this.security.users : [];
      const id = this.route && this.route.userId;
      return id ? users.find((user) => user.id === id) || null : null;
    },

    permittedConfigSections() {
      const sections = Array.isArray(this.configSections) ? this.configSections : [];
      return sections.filter((section) => methods.canConfig.call(this, section.id));
    },

    canOpenConfig() {
      return this.permittedConfigSections.length > 0;
    }
  };


  function start(vm) {
    discardLegacyStorage();
    const requested = vm.parseRoute ? vm.parseRoute() : homeRoute();
    vm.authenticated = false; vm.activeUserId = null; vm.demoMode = false;
    const state = { timer: null, stopped: false, controller: new AbortController() };
    vm.__assetAccess = state;
    if (isPublicReportRoute(requested)) {
      // An anonymous public share boots without touching identity or any
      // private endpoint; only the exact tokenized route is admitted.
      vm.route = requested;
      vm.accessReady = Promise.resolve(false);
      return;
    }
    vm.accessReady = (async () => {
      try {
        const session = await request(vm, '/auth/me');
        if (state.stopped) return;
        applySession(vm, session); await loadState(vm);
        if (!state.stopped) { moveTo(vm, requested); vm.startSessionListeners(); }
      } catch (_) { if (!state.stopped) clearIdentity(vm); }
    })();
  }
  function stop(vm) {
    const state = vm.__assetAccess;
    if (state) { state.stopped = true; state.controller.abort(); if (state.timer) window.clearTimeout(state.timer); }
  }
  // A presentation-only component: server deadline is authoritative; no identity
  // or countdown is persisted in browser storage. Existing Options API is retained.
  const DemoCountdown = {
    data() { return { remainingSeconds: null, sampledAt: 0, ticks: 0, timer: null, stopped: false, controller: new AbortController() }; },
    computed: {
      label() {
        if (this.remainingSeconds === null) return 'Próximo reinicio no disponible';
        const seconds = Math.max(0, Math.ceil(this.remainingSeconds));
        if (seconds === 0) return 'Reinicio pendiente';
        return 'Reinicio en ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      }
    },
    methods: {
      tick() {
        if (this.stopped) return;
        this.ticks += 1;
        if (this.ticks >= 15) { this.ticks = 0; this.refresh(); return; }
        if (this.remainingSeconds !== null) this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
        this.timer = window.setTimeout(() => this.tick(), 1000);
      },
      async refresh() {
        try {
          const response = await window.fetch('/api/v1/demo/status', { credentials: 'same-origin', cache: 'no-store', signal: this.controller.signal });
          if (!response.ok) throw new Error('demo status unavailable');
          const status = await response.json();
          if (this.stopped) return;
          const remaining = (Date.parse(status.nextResetAt) - Date.parse(status.serverTime)) / 1000;
          this.remainingSeconds = status.enabled === true && Number.isFinite(remaining) ? Math.max(0, remaining) : null;
          this.sampledAt = Date.now();
        } catch (_) { if (!this.stopped) this.remainingSeconds = null; }
        if (!this.stopped) this.timer = window.setTimeout(() => this.tick(), 1000);
      }
    },
    mounted() { this.refresh(); },
    beforeUnmount() {
      this.stopped = true;
      this.controller.abort();
      if (this.timer !== null) window.clearTimeout(this.timer);
    },
    template: '<span class="demo-countdown" role="timer" aria-live="off">{{ label }}</span>'
  };
  window.AssetAccess = {
    DemoCountdown,
    catalog: CATALOG,
    data() { return { security: { users: [], roles: [], sessionMinutes: DEFAULT_SESSION_MINUTES }, serverPermissions: [], demoMode: false, csrfToken: '', activeUserId: null, userSearch: '', userRoleFilter: 'all', userStateFilter: 'all' }; },
    computed, methods, start, stop, guardMethods, request, stream, setExtensionPermissions
  };
})();
