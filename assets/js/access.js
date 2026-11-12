(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }
  const Store = window.AssetStore || {};
  const ACCESS_KEY = 'asset-manager.access';
  const SESSION_KEY = (Store.KEYS && Store.KEYS.session) || 'asset-manager.session';
  const DEFAULT_SESSION_MINUTES = 30;
  const CATALOG_SOURCE = [
    {
      id: 'assets',
      labelKey: 'ui.access.module_assets',
      icon: 'desktop',
      permissions: [
        { id: 'assets.view', labelKey: 'ui.access.perm_assets_view' },
        { id: 'assets.edit', labelKey: 'ui.access.perm_assets_edit' },
        { id: 'assets.assign', labelKey: 'ui.access.perm_assets_assign' },
        { id: 'assets.remote', labelKey: 'ui.access.perm_assets_remote' },
        { id: 'assets.purge', labelKey: 'ui.access.perm_assets_purge' }
      ]
    },
    {
      id: 'reports',
      labelKey: 'ui.access.module_reports',
      icon: 'file-text',
      permissions: [
        { id: 'reports.share', labelKey: 'ui.access.perm_reports_share' }
      ]
    },
    {
      id: 'people',
      labelKey: 'ui.access.module_people',
      icon: 'user',
      permissions: [
        { id: 'people.view', labelKey: 'ui.access.perm_people_view' },
        { id: 'people.create', labelKey: 'ui.access.perm_people_create' },
        { id: 'people.edit', labelKey: 'ui.access.perm_people_edit' }
      ]
    },
    {
      id: 'config',
      labelKey: 'ui.access.module_config',
      icon: 'sliders',
      permissions: [
        { id: 'config.general', labelKey: 'ui.access.perm_config_general' },
        { id: 'config.categories', labelKey: 'ui.access.perm_config_categories' },
        { id: 'config.sites', labelKey: 'ui.access.perm_config_sites' },
        { id: 'config.departments', labelKey: 'ui.access.perm_config_departments' },
        { id: 'config.integrations', labelKey: 'ui.access.perm_config_integrations' }
      ]
    },
    {
      id: 'agents',
      labelKey: 'ui.access.module_agents',
      icon: 'layers',
      permissions: [
        { id: 'agents.providers.personal', labelKey: 'ui.access.perm_agents_providers_personal' }
      ]
    },
    {
      // Installation ownership: these grants are reserved for the human
      // Superadmin and never imply business administration.
      id: 'system',
      labelKey: 'ui.access.module_system',
      icon: 'server',
      permissions: [
        { id: 'system.view', labelKey: 'ui.access.perm_system_view' },
        { id: 'system.providers', labelKey: 'ui.access.perm_system_providers' },
        { id: 'system.modules', labelKey: 'ui.access.perm_system_modules' },
        { id: 'system.configure', labelKey: 'ui.access.perm_system_configure' },
        { id: 'system.backup', labelKey: 'ui.access.perm_system_backup' },
        { id: 'system.update', labelKey: 'ui.access.perm_system_update' }
      ]
    },
    {
      id: 'users',
      labelKey: 'ui.access.module_users',
      icon: 'user',
      permissions: [
        { id: 'users.view', labelKey: 'ui.access.perm_users_view' },
        { id: 'users.create', labelKey: 'ui.access.perm_users_create' },
        { id: 'users.edit', labelKey: 'ui.access.perm_users_edit' }
      ]
    },
    {
      id: 'roles',
      labelKey: 'ui.access.module_roles',
      icon: 'shield',
      permissions: [
        { id: 'roles.manage', labelKey: 'ui.access.perm_roles_manage' }
      ]
    },
    {
      id: 'sessions',
      labelKey: 'ui.access.module_sessions',
      icon: 'lock',
      permissions: [
        { id: 'sessions.manage', labelKey: 'ui.access.perm_sessions_manage' }
      ]
    }
  ];
  // The permission catalog is a display snapshot of server-issued grants; it
  // is never authority. Extension groups are merged from discovery so a human
  // Superadmin can review revoked/disabled module permissions in role details.
  // Catalog labels are catalog keys, resolved on read so a locale change
  // re-renders them; the ids stay the stable authority.
  const CATALOG = (window.Vue && typeof window.Vue.reactive === 'function'
    ? window.Vue.reactive(CATALOG_SOURCE)
    : CATALOG_SOURCE).map((module) => ({
    id: module.id,
    icon: module.icon,
    get label() { return tr(module.labelKey); },
    permissions: module.permissions.map((permission) => ({
      id: permission.id,
      get label() { return tr(permission.labelKey); }
    }))
  }));

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
    // The translator page is read with system.view; every write inside it
    // checks system.configure in the component and on the server.
    idiomas: 'system.view',
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
  // The i18n runtime is part of the shipped script chain; these helpers keep the
  // module loadable on its own and every message routed through the catalog.
  function i18nRuntime() { return typeof window !== 'undefined' ? window.ItsmI18n || null : null; }
  function tr(key, params) { const runtime = i18nRuntime(); return runtime ? runtime.t(key, params) : ''; }
  function acceptLanguage() {
    const runtime = i18nRuntime();
    return runtime && runtime.activeLocale ? runtime.activeLocale : 'es';
  }
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
    // Any response still in flight belongs to the identity being cleared.
    if (vm.__assetAccess) vm.__assetAccess.epoch += 1;
    vm.authenticated = false; vm.activeUserId = null; vm.serverPermissions = []; vm.csrfToken = '';
    // The demo marker belongs to the session identity: logout, expiry and a
    // fresh start must not leave a stale notice behind.
    vm.demoMode = false;
    vm.security = { users: [], roles: [], sessionMinutes: DEFAULT_SESSION_MINUTES };
    closeSensitiveDialogs(vm); discardLegacyStorage();
    // Leaving the session drops the account preference; the anonymous choice (or
    // the installation default) takes over again.
    if (window.ItsmI18n) window.ItsmI18n.clearSession();
    // The tokenized public report is a sessionless screen: an expired private
    // session must not replace it with the login form.
    const publicRoute = isPublicReportRoute(vm.route);
    vm.route = publicRoute ? vm.route : loginRoute();
    if (!publicRoute && vm.ensureHash) vm.ensureHash('#/login');
  }
  const codeMessageKeys = {
    unauthorized: 'ui.errors.unauthorized',
    forbidden: 'ui.errors.forbidden',
    conflict: 'ui.errors.conflict',
    validation_error: 'ui.errors.validation_error',
    not_found: 'ui.errors.not_found',
    rate_limited: 'ui.errors.rate_limited',
    too_many_requests: 'ui.errors.too_many_requests',
    unavailable: 'ui.errors.unavailable'
  };
  function codeMessage(code) {
    const key = codeMessageKeys[text(code, '')];
    const translated = key ? tr(key) : '';
    return translated || tr('ui.errors.request_failed');
  }
  function responseError(vm, path, response, payload) {
    if (response.status === 401 && path !== '/auth/login' && !path.startsWith('/reports/public/')) clearIdentity(vm);
    const code = payload && payload.error && payload.error.code;
    const serverMessage = payload && payload.error && typeof payload.error.message === 'string' ? payload.error.message.trim() : '';
    // D8/D11: the server translation wins only when the envelope names a key.
    // Without one the client keeps its translated code table and, for
    // validation failures, the composed server reason.
    const translated = payload && payload.error && typeof payload.error.key === 'string' && payload.error.key.trim() ? serverMessage : '';
    const details = Array.isArray(payload && payload.details) ? payload.details : [];
    const detailText = details.map(item => {
      const field = typeof item.field === 'string' ? item.field.trim() : '';
      const message = typeof item.message === 'string' ? item.message.trim() : '';
      return message ? (field ? field + ': ' + message : message) : '';
    }).filter(Boolean).join(' · ');
    const reason = !translated && code === 'validation_error' ? (detailText || serverMessage) : '';
    const message = translated
      || (path === '/auth/login' && response.status === 401 ? tr('ui.login.error_invalid') : '')
      || (reason ? tr('ui.errors.request_rejected', { reason: reason }) : '')
      || codeMessage(code);
    const error = new Error(message);
    error.status = response.status;
    error.code = code || '';
    error.serverMessage = serverMessage;
    error.details = details.map(item => ({ field: String(item.field || ''), message: String(item.message || '') }));
    error.fieldErrors = {};
    // D11 additive: a rejected write may carry the full report beside the error
    // envelope (the translator import returns one). It rides on the error so a
    // caller can show every problem instead of only the summary message; the
    // existing fields and every caller stay unchanged.
    if (payload && payload.report && typeof payload.report === 'object') error.report = payload.report;
    details.forEach(item => { const field = String(item.field || '').split('.').pop(); if (field) error.fieldErrors[field] = tr('ui.errors.field_invalid'); });
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
    const headers = { Accept: 'application/json', 'Accept-Language': acceptLanguage() };
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
      if (state && state.stopped) throw new Error(tr('ui.errors.cancelled'));
      throw responseError(vm, path, response, payload);
    }
    const payload = init.responseType === 'blob'
      ? await response.blob()
      : response.status === 204 ? null : await response.json();
    if (state && state.stopped) throw new Error(tr('ui.errors.cancelled'));
    return payload;
  }
  // POST streaming: the message body must be sent as a request, so EventSource
  // is not usable. This reads the response incrementally with the same cookie,
  // CSRF, origin and abort semantics as `request`, and yields parsed SSE events.
  async function* stream(vm, path, options) {
    const init = Object.assign({ method: 'GET' }, options || {});
    const headers = { Accept: 'text/event-stream', 'Accept-Language': acceptLanguage() };
    if (init.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body); }
    if (init.method !== 'GET' && vm.csrfToken) headers['X-CSRF-Token'] = vm.csrfToken;
    const state = vm.__assetAccess;
    const signal = init.signal || (state && state.controller.signal);
    const response = await window.fetch('/api/v1' + path, Object.assign(init, { credentials: 'same-origin', headers, signal }));
    if (state && state.stopped) throw new Error(tr('ui.errors.cancelled'));
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch (_) { /* non-JSON failures use the status mapping */ }
      throw responseError(vm, path, response, payload);
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error(tr('ui.errors.stream_unavailable'));
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
        if (state && state.stopped) throw new Error(tr('ui.errors.cancelled'));
      }
      buffer += decoder.decode();
      const trailing = parseFrame(buffer);
      if (trailing) yield trailing;
    } finally {
      try { await reader.cancel(); } catch (_) { /* already closed or aborted */ }
    }
  }
  function applySession(vm, payload) {
    if (!payload.user || !payload.user.active) throw new Error(tr('ui.errors.session_unavailable'));
    vm.csrfToken = payload.csrfToken || '';
    vm.serverPermissions = safePermissions(payload.permissions);
    // Only the server's exact boolean marks a demo installation. Missing or
    // malformed values keep an ordinary installation, never a stringified one.
    vm.demoMode = payload.demoMode === true;
    vm.security.users = [payload.user];
    vm.security.sessionMinutes = payload.sessionMinutes || DEFAULT_SESSION_MINUTES;
    vm.activeUserId = payload.user.id;
    vm.authenticated = true;
    // D11: the envelope's locale, preference and installation formats are
    // additive; the runtime keeps its current locale when they are absent.
    if (window.ItsmI18n) window.ItsmI18n.applySession(payload);
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
    if (!vm.requirePermission(permission)) return makeResult(false, tr('ui.errors.forbidden'));
    try {
      const payload = await request(vm, path, { method, body });
      const session = await request(vm, '/auth/me');
      applySession(vm, session);
      await loadState(vm);
      vm.syncAccess();
      return makeResult(true, '', {}, payload);
    } catch (error) { return makeResult(false, error.message || tr('ui.access.error_save_change'), error.fieldErrors); }
  }
  const methods = {
    can(permission) {
      if (permission === 'security') return this.can('roles.manage') || this.can('sessions.manage');
      return !!(this.authenticated && this.currentUser && this.currentUser.active && this.effectivePermissions.includes(permission));
    },
    canConfig(section) { return allows(this, sectionPermissions(section)); },
    requirePermission(permission) { const allowed = this.can(permission); if (!allowed && this.showToast) this.showToast(tr('ui.errors.forbidden'), 'error'); return allowed; },
    roleLabel(id) { const role = roleFor(this, id); return role ? role.name : tr('ui.shell.role_none'); },
    userPersonLabel(user) { const person = user && user.personId && (this.people || []).find(item => item.id === user.personId); return person ? person.name : user && user.personId ? tr('ui.access.person_unavailable') : tr('ui.access.person_none'); },
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
      const epoch = this.__assetAccess ? this.__assetAccess.epoch : 0;
      try {
        const session = await request(this, '/auth/me');
        if (epoch !== (this.__assetAccess ? this.__assetAccess.epoch : 0)) return false;
        applySession(this, session); await loadState(this); this.syncAccess(); return true;
      }
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
      if (this.loginBusy) return makeResult(false, tr('ui.login.error_in_progress'));
      const form = this.loginForm || {};
      this.loginErrors = { username: text(form.username) ? '' : tr('ui.login.error_username_required'), password: form.password ? '' : tr('ui.login.error_password_required'), general: '' };
      if (this.loginErrors.username || this.loginErrors.password) return makeResult(false, tr('ui.login.error_required'), this.loginErrors);
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
        this.loginErrors.general = error.message || tr('ui.login.error_unavailable');
        return makeResult(false, this.loginErrors.general);
      } finally { this.loginBusy = false; }
    },
    async logout() {
      try { await request(this, '/auth/logout', { method: 'POST' }); }
      catch (error) { if (error.status !== 401) { if (this.showToast) this.showToast(tr('ui.shell.logout_failed'), 'error'); return false; } }
      this.stopSessionListeners(); clearIdentity(this); return true;
    },
    // S2: the anonymous selector only remembers a preference, while the signed-in
    // selector saves it on the caller's own account and then applies it.
    async changeLocale(tag) {
      const runtime = i18nRuntime();
      if (!runtime) return false;
      const target = text(tag, '');
      if (!target) return false;
      if (!this.authenticated) return runtime.setLocale(target, { persist: true }) === target;
      try {
        applySession(this, await request(this, '/auth/me/preferences', { method: 'PATCH', body: { locale: target } }));
        return runtime.activeLocale === target;
      } catch (error) {
        if (this.showToast) this.showToast(error.message || runtime.t('ui.i18n.save_failed'), 'error');
        return false;
      }
    },
    saveUser(draft) {
      const role = roleFor(this, draft.roleId);
      if (!window.AssetAccessViews?.canAssignRole(this, role)) {
        const error = tr('ui.access.error_role_required');
        return Promise.resolve(makeResult(false, error, { roleId: error }));
      }
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
      }).sort((a, b) => compareText(a.name, b.name, { sensitivity: 'base' }));
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
    },

    // S2: locale options come from the public installation endpoint and the
    // runtime's own built-in catalogs; the active locale stays a tracked ref so
    // a hot switch re-renders the selector without a reload.
    i18nLocales() {
      const runtime = i18nRuntime();
      if (!runtime) return [];
      if (runtime.version) runtime.version.value;
      return (runtime.locales || []).map((locale) => ({ tag: locale.tag, name: locale.name, nativeName: locale.nativeName }));
    },

    interfaceLocale() {
      const runtime = i18nRuntime();
      return runtime && runtime.i18n ? runtime.i18n.global.locale.value : 'es';
    }
  };


  function start(vm) {
    discardLegacyStorage();
    const requested = vm.parseRoute ? vm.parseRoute() : homeRoute();
    vm.authenticated = false; vm.activeUserId = null; vm.demoMode = false;
    const state = { timer: null, stopped: false, epoch: 0, controller: new AbortController() };
    vm.__assetAccess = state;
    if (isPublicReportRoute(requested)) {
      // An anonymous public share boots without touching identity or any
      // private endpoint; only the exact tokenized route is admitted.
      vm.route = requested;
      vm.accessReady = Promise.resolve(false);
      return;
    }
    const epoch = state.epoch;
    vm.accessReady = (async () => {
      try {
        const session = await request(vm, '/auth/me');
        if (state.stopped || epoch !== state.epoch) return;
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
        if (this.remainingSeconds === null) return tr('ui.shell.demo_restart_unknown');
        const seconds = Math.max(0, Math.ceil(this.remainingSeconds));
        if (seconds === 0) return tr('ui.shell.demo_restart_pending');
        const time = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        return tr('ui.shell.demo_restart_in', { time: time });
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
          const response = await window.fetch('/api/v1/demo/status', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Accept-Language': acceptLanguage() },
            signal: this.controller.signal
          });
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
