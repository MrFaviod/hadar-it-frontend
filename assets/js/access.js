(function () {
  'use strict';
  const Store = window.AssetStore || {};
  const ACCESS_KEY = 'asset-manager.access';
  const SESSION_KEY = (Store.KEYS && Store.KEYS.session) || 'asset-manager.session';
  const DEFAULT_SESSION_MINUTES = 30;
  const CATALOG = [
    {
      id: 'assets',
      label: 'Activos',
      icon: 'desktop',
      permissions: [
        { id: 'assets.view', label: 'Ver' },
        { id: 'assets.edit', label: 'Editar' },
        { id: 'assets.assign', label: 'Asignar responsables' },
        { id: 'assets.remote', label: 'Acceso remoto' }
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

  const PERMISSION_IDS = CATALOG.reduce((result, group) => {
    group.permissions.forEach((permission) => result.push(permission.id));
    return result;
  }, []);
  const PERMISSION_SET = new Set(PERMISSION_IDS);

  const CONFIG_PERMISSION_BY_SECTION = {
    activos: 'assets.edit',
    general: 'config.general',
    apariencia: 'config.general',
    categorias: 'config.categories',
    sedes: 'config.sites',
    personas: 'config.departments',
    integraciones: 'config.integrations',
    relaciones: 'assets.edit',
    mantenimiento: 'assets.edit',
    supervision: 'assets.edit',
    alertas: 'assets.edit',
    notificaciones: 'config.integrations',
    mapas: 'config.sites',
    datos: 'assets.edit',
    reportes: 'assets.edit',
    garantias: 'assets.edit',
    qr: 'config.general',
    etiquetas: 'assets.edit'
  };

  const SENSITIVE_DIALOG_KEYS = [
    'assetConfig', 'remoteDialog', 'assignDialog', 'personDialog',
    'departmentDialog', 'categoryDialog', 'siteDialog', 'locationDialog',
    'confirmDialog', 'userDialog', 'roleDialog', 'securityDialog',
    'accessUserDialog', 'accessRoleDialog', 'sessionDialog'
  ];


  function text(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim() : (fallback || ''); }
  function canonicalRoleId(value) { return text(value, ''); }
  function safePermissions(value) { return Array.isArray(value) ? value.filter(id => PERMISSION_SET.has(id)) : []; }
  function makeResult(ok, error, fieldErrors, extra) { return Object.assign({ ok: !!ok, error: error || '', fieldErrors: fieldErrors || {} }, extra || {}); }
  function roleFor(vm, id) { return vm.security.roles.find(role => role.id === id) || null; }
  function userFor(vm, id) { return vm.security.users.find(user => user.id === id) || null; }
  function loginRoute() { return { name: 'login', assetId: null, personId: null, userId: null, section: null }; }
  function deniedRoute() { return { name: 'denied', assetId: null, personId: null, userId: null, section: null }; }
  function homeRoute() { return { name: 'panel', assetId: null, personId: null, userId: null, section: null }; }
  function configPermission(section) { return CONFIG_PERMISSION_BY_SECTION[text(section, '')] || null; }
  function routePermission(route) {
    if (['users', 'user'].includes(route.name)) return 'users.view';
    if (['people', 'person'].includes(route.name)) return 'people.view';
    if (route.name === 'config') return configPermission(route.section) || 'security';
    if (['login', 'denied'].includes(route.name)) return null;
    return 'assets.view';
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
    vm.security = { users: [], roles: [], sessionMinutes: DEFAULT_SESSION_MINUTES };
    closeSensitiveDialogs(vm); discardLegacyStorage();
    vm.route = loginRoute();
    if (vm.ensureHash) vm.ensureHash('#/login');
  }
  const messages = {
    unauthorized: 'La sesión ha vencido. Inicia sesión de nuevo.',
    forbidden: 'No tienes permisos para realizar esta acción.',
    conflict: 'La operación no se puede completar con el estado actual.',
    validation_error: 'Revisa los campos indicados.',
    not_found: 'El registro no está disponible.',
    rate_limited: 'Demasiados intentos. Espera antes de volver a intentarlo.'
  };
  async function request(vm, path, options) {
    const init = Object.assign({ method: 'GET' }, options || {});
    const headers = { Accept: 'application/json' };
    if (init.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body); }
    if (init.method !== 'GET' && vm.csrfToken) headers['X-CSRF-Token'] = vm.csrfToken;
    const state = vm.__assetAccess;
    const signal = init.signal || (state && state.controller.signal);
    const response = await window.fetch('/api/v1' + path, Object.assign(init, { credentials: 'same-origin', headers, signal }));
    const payload = await response.json();
    if (state && state.stopped) throw new Error('Solicitud cancelada.');
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login') clearIdentity(vm);
      const code = payload.error && payload.error.code;
      const error = new Error(path === '/auth/login' && response.status === 401 ? 'Usuario o contraseña incorrectos.' : (messages[code] || 'No se pudo completar la solicitud.'));
      error.status = response.status;
      error.fieldErrors = {};
      (payload.details || []).forEach(item => { const field = String(item.field || '').split('.').pop(); if (field) error.fieldErrors[field] = 'Revisa este campo.'; });
      throw error;
    }
    return payload;
  }
  function applySession(vm, payload) {
    if (!payload.user || !payload.user.active) throw new Error('La sesión no está disponible.');
    vm.csrfToken = payload.csrfToken || '';
    vm.serverPermissions = safePermissions(payload.permissions);
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
    canConfig(section) { return this.can(configPermission(section) || 'security'); },
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
      if (!this.authenticated || !this.currentUser || !this.currentUser.active) return loginRoute();
      const next = route && route.name === 'login' ? homeRoute() : route || homeRoute();
      const permission = routePermission(next);
      return !permission || this.can(permission) ? next : deniedRoute();
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
    saveGeneral: () => 'config.general',
    resetGeneral: () => 'config.general',
    handleLogoUpload: () => 'config.general',
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
    openDeleteAsset: () => 'assets.edit',
    confirmDeleteAsset: () => 'assets.edit',
    openAssetField: () => 'assets.edit',
    saveAssetField: () => 'assets.edit',
    requestDeleteAssetField: () => 'assets.edit',
    openAssetStatusDialog: () => 'assets.edit',
    saveAssetStatus: () => 'assets.edit',
    requestDeleteAssetStatus: () => 'assets.edit',
    openFormDraft: () => 'assets.edit',
    saveFormDraft: () => 'assets.edit',
    saveAssetIdRules: () => 'assets.edit',
    setOperationsMode: () => 'assets.edit',
    applyAssetAdminConfirm: () => 'assets.edit'
  };

  function confirmPermission(vm) {
    const kind = vm.confirmDialog && vm.confirmDialog.kind;
    if (kind === 'delete-category') return 'config.categories';
    if (kind === 'delete-site' || kind === 'delete-location') return 'config.sites';
    if (kind === 'delete-department') return 'config.departments';
    if (kind === 'delete-asset-field' || kind === 'delete-asset-status') return 'assets.edit';
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
        if (!this.requirePermission(permission)) return false;
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
    vm.authenticated = false; vm.activeUserId = null;
    const state = { timer: null, stopped: false, controller: new AbortController() };
    vm.__assetAccess = state;
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
  window.AssetAccess = {
    catalog: CATALOG,
    data() { return { security: { users: [], roles: [], sessionMinutes: DEFAULT_SESSION_MINUTES }, serverPermissions: [], csrfToken: '', activeUserId: null, userSearch: '', userRoleFilter: 'all', userStateFilter: 'all' }; },
    computed, methods, start, stop, guardMethods, request
  };
})();
