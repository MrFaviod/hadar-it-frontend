(function () {
  'use strict';

  const Store = window.AssetStore || {};
  const DATA = window.ASSET_DATA || {};
  const ACCESS_KEY = 'asset-manager.access';
  const SESSION_KEY = (Store.KEYS && Store.KEYS.session) || 'asset-manager.session';
  const DEFAULT_SESSION_MINUTES = 30;
  const MIN_SESSION_MINUTES = 5;
  const MAX_SESSION_MINUTES = 1440;
  const SESSION_TOUCH_THROTTLE = 15000;
  const SESSION_TIMER_MAX = 60000;
  const SESSION_TIMER_MIN = 1000;

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

  const DEFAULT_ROLE_PERMISSIONS = {
    admin: PERMISSION_IDS.slice(),
    operator: [
      'assets.view', 'assets.edit', 'assets.assign', 'assets.remote',
      'people.view', 'people.create', 'people.edit'
    ],
    reader: ['assets.view', 'people.view']
  };

  const DEFAULT_ROLE_NAMES = {
    admin: 'Administrador',
    operator: 'Operador',
    reader: 'Lector'
  };

  const ROLE_ALIASES = {
    administrador: 'admin',
    admin: 'admin',
    operador: 'operator',
    operator: 'operator',
    lector: 'reader',
    reader: 'reader'
  };

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

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function clone(value) {
    if (Store.clone) return Store.clone(value);
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function storage(name) {
    try {
      return window[name];
    } catch (error) {
      return null;
    }
  }

  function readJSON(name, key, fallback) {
    const target = storage(name);
    if (!target) return fallback;
    if (Store.readJSON) return Store.readJSON(target, key, fallback);
    try {
      const raw = target.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(name, key, value) {
    const target = storage(name);
    if (!target) return false;
    if (Store.writeJSON) return Store.writeJSON(target, key, value);
    try {
      target.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStored(name, key) {
    const target = storage(name);
    if (!target) return;
    if (Store.removeStored) {
      Store.removeStored(target, key);
      return;
    }
    try {
      target.removeItem(key);
    } catch (error) {
      /* La sesión se considera cerrada aunque el almacenamiento no responda. */
    }
  }

  function slugify(value, fallback) {
    if (Store.slugify) return Store.slugify(value, fallback || 'item');
    const source = text(value, fallback || 'item')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return source || fallback || 'item';
  }

  function boundedMinutes(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_SESSION_MINUTES;
    return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(numeric)));
  }

  function canonicalRoleId(value) {
    const raw = text(value, '').toLocaleLowerCase('es');
    return ROLE_ALIASES[raw] || raw;
  }

  function safePermissions(value) {
    const source = Array.isArray(value) ? value : [];
    const used = new Set();
    return source.filter((permission) => {
      if (typeof permission !== 'string' || !PERMISSION_SET.has(permission) || used.has(permission)) return false;
      used.add(permission);
      return true;
    });
  }

  function defaultRoles() {
    return Object.keys(DEFAULT_ROLE_NAMES).map((id) => ({
      id,
      name: DEFAULT_ROLE_NAMES[id],
      permissions: DEFAULT_ROLE_PERMISSIONS[id].slice()
    }));
  }

  function defaultUsers() {
    return [
      {
        id: 'admin',
        username: 'admin',
        name: 'Administrador',
        email: 'admin@acme.test',
        roleId: 'admin',
        active: true,
        lastAccess: null,
        personId: '',
        password: 'admin'
      },
      {
        id: 'operador',
        username: 'operador',
        name: 'Operador de TI',
        email: 'operador@acme.test',
        roleId: 'operator',
        active: true,
        lastAccess: null,
        personId: '',
        password: 'operador'
      },
      {
        id: 'lector',
        username: 'lector',
        name: 'Lector de inventario',
        email: 'lector@acme.test',
        roleId: 'reader',
        active: true,
        lastAccess: null,
        personId: '',
        password: 'lector'
      },
      {
        id: 'inactivo',
        username: 'inactivo',
        name: 'Cuenta inactiva',
        email: 'inactivo@acme.test',
        roleId: 'reader',
        active: false,
        lastAccess: null,
        personId: '',
        password: 'inactivo'
      }
    ];
  }

  function isFullAdminRole(role) {
    if (!role) return false;
    const permissions = new Set(safePermissions(role.permissions));
    return PERMISSION_IDS.every((permission) => permissions.has(permission));
  }

  function normalizeRoles(value) {
    const source = Array.isArray(value) ? value : [];
    const result = [];
    const used = new Set();

    source.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const canonical = canonicalRoleId(item.id || item.slug || item.name);
      const name = text(item.name, DEFAULT_ROLE_NAMES[canonical] || '');
      if (!name) return;
      let id = canonical || slugify(name, 'rol');
      if (used.has(id)) {
        let suffix = 2;
        const base = id;
        while (used.has(id)) {
          id = base + '-' + suffix;
          suffix += 1;
        }
      }
      used.add(id);
      result.push({
        id,
        name,
        permissions: safePermissions(item.permissions)
      });
    });

    defaultRoles().forEach((fallback) => {
      if (result.some((role) => role.id === fallback.id)) return;
      result.unshift(clone(fallback));
    });

    const order = { admin: 0, operator: 1, reader: 2 };
    return result.sort((a, b) => {
      const rankA = Object.prototype.hasOwnProperty.call(order, a.id) ? order[a.id] : 10;
      const rankB = Object.prototype.hasOwnProperty.call(order, b.id) ? order[b.id] : 10;
      return rankA - rankB || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
  }

  function normalizeUsers(value, roles) {
    const source = Array.isArray(value) && value.length ? value : defaultUsers();
    const validRoles = new Set(roles.map((role) => role.id));
    const result = [];
    const usedIds = new Set();
    const usedNames = new Set();
    const fallbackRole = roles.find((role) => role.id === 'reader') || roles[roles.length - 1];

    source.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const username = text(item.username, '').slice(0, 64);
      if (!username) return;
      const usernameKey = username.toLocaleLowerCase('es');
      if (usedNames.has(usernameKey)) return;
      usedNames.add(usernameKey);

      let id = text(item.id, '') || slugify(username, 'usuario');
      if (usedIds.has(id)) {
        const base = id;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = base + '-' + suffix;
          suffix += 1;
        }
      }
      usedIds.add(id);
      const roleId = canonicalRoleId(item.roleId);
      const lastAccess = Number(item.lastAccess);
      result.push({
        id,
        username,
        name: text(item.name, username).slice(0, 120),
        email: text(item.email, '').slice(0, 160),
        roleId: validRoles.has(roleId) ? roleId : (fallbackRole ? fallbackRole.id : ''),
        active: item.active !== false,
        lastAccess: Number.isFinite(lastAccess) && lastAccess > 0 ? lastAccess : null,
        personId: text(item.personId, ''),
        password: typeof item.password === 'string' ? item.password : ''
      });
    });

    return result.length ? result : defaultUsers();
  }

  function normalizeSecurity(value) {
    const source = value && typeof value === 'object' ? value : {};
    const roles = normalizeRoles(source.roles);
    const users = normalizeUsers(source.users, roles);
    return {
      users,
      roles,
      sessionMinutes: boundedMinutes(source.sessionMinutes)
    };
  }

  function normalizeRoute(route) {
    return Object.assign({
      name: 'inventory',
      assetId: null,
      personId: null,
      userId: null,
      section: null
    }, route && typeof route === 'object' ? route : {});
  }

  function loginRoute() {
    return { name: 'login', assetId: null, personId: null, userId: null, section: null };
  }

  function deniedRoute() {
    return { name: 'denied', assetId: null, personId: null, userId: null, section: null };
  }

  function homeRoute() {
    return { name: 'panel', assetId: null, personId: null, userId: null, section: null };
  }

  function normalizedSession(value) {
    const source = value && typeof value === 'object' ? value : null;
    if (!source) return null;
    let userId = text(source.userId, '');
    let lastActivity = Number(source.lastActivity);
    let migrated = false;

    if (!userId && source.user) {
      userId = text(source.user, '');
      const prior = Number(source.lastActivity || source.at || source.timestamp);
      lastActivity = prior;
      migrated = true;
    }
    if (!userId || !Number.isFinite(lastActivity) || lastActivity <= 0) return null;
    return { userId, lastActivity, migrated };
  }

  function makeResult(ok, error, fieldErrors, extra) {
    return Object.assign({
      ok: !!ok,
      error: error || '',
      fieldErrors: fieldErrors || {}
    }, extra || {});
  }

  function permissionSet(value) {
    return new Set(Array.isArray(value) ? value : []);
  }

  function roleFor(vm, id) {
    const roles = vm && vm.security && Array.isArray(vm.security.roles) ? vm.security.roles : [];
    const canonical = canonicalRoleId(id);
    return roles.find((role) => role.id === canonical || role.id === id) || null;
  }

  function userFor(vm, id) {
    const users = vm && vm.security && Array.isArray(vm.security.users) ? vm.security.users : [];
    return users.find((user) => user.id === id) || null;
  }

  function activeFullAdminCount(users, roles) {
    const roleMap = new Map((roles || []).map((role) => [role.id, role]));
    return (users || []).filter((user) => user.active && isFullAdminRole(roleMap.get(user.roleId))).length;
  }

  function uniqueId(base, used) {
    let id = base || 'item';
    let suffix = 2;
    while (used.has(id)) {
      id = base + '-' + suffix;
      suffix += 1;
    }
    return id;
  }

  function configPermission(section) {
    const key = text(section, '').toLocaleLowerCase('es');
    if (key === 'seguridad' || key === 'usuarios' || key === 'usuarios-permisos' || key === 'acceso') return null;
    return CONFIG_PERMISSION_BY_SECTION[key] || null;
  }

  function routePermission(route) {
    const name = route && route.name;
    if (name === 'inventory' || name === 'detail') return 'assets.view';
    if (name === 'people' || name === 'person') return 'people.view';
    if (name === 'users' || name === 'user') return 'users.view';
    if (name === 'datos') return 'assets.view';
    if (name === 'graph' || name === 'map') return 'assets.view';
    if (name === 'maintenance' || name === 'incident') return 'assets.view';
    if (name === 'config') {
      return configPermission(route.section) || 'security';
    }
    if (name === 'login' || name === 'denied') return null;
    return 'assets.view';
  }

  function closeSensitiveDialogs(vm) {
    if (!vm) return;
    SENSITIVE_DIALOG_KEYS.forEach((key) => {
      const value = vm[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'open')) {
        value.open = false;
      }
    });
    if (vm.loginForm && typeof vm.loginForm === 'object') vm.loginForm.password = '';
    vm.showPassword = false;
    vm.loginBusy = false;
  }

  function sameRoute(a, b) {
    return a && b && a.name === b.name && a.assetId === b.assetId &&
      a.personId === b.personId && a.userId === b.userId && a.section === b.section;
  }

  function sessionIsFresh(vm) {
    if (!vm || !vm.authenticated || !vm.activeUserId) return false;
    const session = normalizedSession(readJSON('sessionStorage', SESSION_KEY, null));
    const user = userFor(vm, vm.activeUserId);
    if (!session || session.userId !== vm.activeUserId || !user || user.active === false) return false;
    const limit = boundedMinutes(vm.security && vm.security.sessionMinutes) * 60 * 1000;
    return Date.now() - session.lastActivity < limit;
  }

  const methods = {
    can(permission) {
      if (!permission) return false;
      if (permission === 'security') return this.can('roles.manage') || this.can('sessions.manage');
      const current = this.currentUser;
      if (!current || current.active === false || !sessionIsFresh(this)) return false;
      const permissions = this.effectivePermissions;
      return Array.isArray(permissions) && permissions.indexOf(permission) !== -1;
    },

    canConfig(section) {
      const permission = configPermission(section);
      return permission ? this.can(permission) : this.can('security');
    },

    requirePermission(permission) {
      if (this.can(permission)) return true;
      if (typeof this.showToast === 'function') this.showToast('No tienes permisos para realizar esta acción.', 'error');
      return false;
    },

    roleLabel(id) {
      const role = roleFor(this, id);
      return role ? role.name : 'Sin rol';
    },

    userPersonLabel(user) {
      if (!user || !user.personId) return 'Sin vincular';
      const people = Array.isArray(this.people) ? this.people : [];
      const person = people.find((item) => item.id === user.personId);
      return person ? person.name : 'Persona no disponible';
    },

    userPermissions(user) {
      const role = roleFor(this, user && user.roleId);
      if (!role) return [];
      return isFullAdminRole(role) ? PERMISSION_IDS.slice() : safePermissions(role.permissions);
    },

    permissionGroups() {
      return CATALOG.map((group) => ({
        id: group.id,
        label: group.label,
        icon: group.icon,
        permissions: group.permissions.map((permission) => Object.assign({}, permission))
      }));
    },

    securityPersist() {
      if (!this.security) return false;
      const normalized = normalizeSecurity(this.security);
      if (this.security !== normalized) Object.assign(this.security, normalized);
      const saved = writeJSON('localStorage', ACCESS_KEY, normalized);
      if (!saved && typeof this.showToast === 'function') {
        this.showToast('No se pudo guardar la configuración de acceso.', 'error');
      }
      return saved;
    },

    closeAccessDialogs() {
      closeSensitiveDialogs(this);
    },

    syncAccess() {
      const current = this.currentUser;
      if (!this.authenticated || !current || current.active === false) {
        if (this.authenticated && typeof this.logout === 'function') this.logout();
        return false;
      }

      const allowed = this.accessRoute(this.route);
      if (!sameRoute(allowed, this.route)) {
        closeSensitiveDialogs(this);
        if (typeof this.applyRoute === 'function') {
          this.applyRoute(allowed);
        } else {
          this.route = allowed;
        }
        if (typeof this.hashFor === 'function' && typeof this.ensureHash === 'function') {
          this.ensureHash(this.hashFor(allowed));
        }
        return false;
      }
      return true;
    },

    accessRoute(route) {
      const next = normalizeRoute(route);
      if (!this.authenticated || !this.currentUser || this.currentUser.active === false) return loginRoute();
      if (next.name === 'login') return this.can('assets.view') ? homeRoute() : deniedRoute();
      if (next.name === 'denied') return deniedRoute();
      const permission = routePermission(next);
      if (permission === 'security') {
        return this.can('roles.manage') || this.can('sessions.manage') ? next : deniedRoute();
      }
      return !permission || this.can(permission) ? next : deniedRoute();
    },

    checkAccessSession() {
      if (!this.authenticated || !this.activeUserId) return false;
      const state = this.__assetAccess;
      const session = normalizedSession(readJSON('sessionStorage', SESSION_KEY, null));
      const user = userFor(this, this.activeUserId);
      const now = Date.now();
      const limit = boundedMinutes(this.security && this.security.sessionMinutes) * 60 * 1000;
      const expired = !!(session && now - session.lastActivity >= limit);
      const inactive = !!(user && user.active === false);
      if (!session || session.userId !== this.activeUserId || !user || inactive || expired) {
        const reason = inactive
          ? 'La cuenta está desactivada.'
          : expired
            ? 'La sesión ha vencido. Inicia sesión de nuevo.'
            : '';
        if (typeof this.logout === 'function') this.logout();
        if (reason && this.loginErrors) this.loginErrors.general = reason;
        return false;
      }
      if (state) state.lastTouch = session.lastActivity;
      if (state) this.scheduleAccessCheck();
      this.syncAccess();
      return true;
    },

    scheduleAccessCheck() {
      const state = this.__assetAccess;
      if (!state || !this.authenticated || !this.activeUserId) return;
      if (state.timer) window.clearTimeout(state.timer);
      const session = normalizedSession(readJSON('sessionStorage', SESSION_KEY, null));
      const limit = boundedMinutes(this.security && this.security.sessionMinutes) * 60 * 1000;
      const remaining = session ? limit - (Date.now() - session.lastActivity) : 0;
      const delay = Math.max(SESSION_TIMER_MIN, Math.min(SESSION_TIMER_MAX, remaining > 0 ? remaining : SESSION_TIMER_MIN));
      state.timer = window.setTimeout(() => {
        state.timer = null;
        this.checkAccessSession();
      }, delay);
    },

    touchAccessSession() {
      if (!this.authenticated || !this.activeUserId) return;
      const state = this.__assetAccess;
      const now = Date.now();
      if (state && state.lastTouch && now - state.lastTouch < SESSION_TOUCH_THROTTLE) return;
      const session = normalizedSession(readJSON('sessionStorage', SESSION_KEY, null));
      if (!session || session.userId !== this.activeUserId) {
        this.checkAccessSession();
        return;
      }
      session.lastActivity = now;
      session.migrated = undefined;
      writeJSON('sessionStorage', SESSION_KEY, { userId: session.userId, lastActivity: now });
      if (state) state.lastTouch = now;
      this.scheduleAccessCheck();
    },

    submitLogin() {
      const form = this.loginForm || { username: '', password: '' };
      const errors = { username: '', password: '', general: '' };
      const username = text(form.username, '');
      const password = typeof form.password === 'string' ? form.password : '';
      if (!username) errors.username = 'Introduce tu usuario.';
      if (!password) errors.password = 'Introduce tu contraseña.';
      this.loginErrors = errors;
      if (errors.username || errors.password) return makeResult(false, 'Completa los campos requeridos.', errors);

      const users = this.security && Array.isArray(this.security.users) ? this.security.users : [];
      const user = users.find((item) => item.username.toLocaleLowerCase('es') === username.toLocaleLowerCase('es'));
      if (!user || user.password !== password) {
        this.loginErrors.general = 'Usuario o contraseña incorrectos.';
        return makeResult(false, this.loginErrors.general, this.loginErrors);
      }
      if (!user.active) {
        this.loginErrors.general = 'La cuenta está desactivada.';
        return makeResult(false, this.loginErrors.general, this.loginErrors);
      }

      const now = Date.now();
      user.lastAccess = now;
      this.activeUserId = user.id;
      this.authenticated = true;
      this.loginBusy = false;
      this.showPassword = false;
      const sessionSaved = writeJSON('sessionStorage', SESSION_KEY, { userId: user.id, lastActivity: now });
      if (!sessionSaved) {
        this.activeUserId = null;
        this.authenticated = false;
        this.loginErrors.general = 'No se pudo iniciar la sesión en este navegador.';
        return makeResult(false, this.loginErrors.general, this.loginErrors);
      }
      this.securityPersist();
      this.startSessionListeners();
      const next = this.accessRoute(homeRoute());
      this.route = next;
      if (typeof this.ensureHash === 'function' && typeof this.hashFor === 'function') this.ensureHash(this.hashFor(next));
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      if (typeof this.showToast === 'function') this.showToast('Sesión iniciada.');
      return makeResult(true, '', {}, { user });
    },

    logout() {
      removeStored('sessionStorage', SESSION_KEY);
      this.stopSessionListeners();
      this.activeUserId = null;
      this.authenticated = false;
      closeSensitiveDialogs(this);
      if (this.route) this.route = loginRoute();
      if (typeof this.ensureHash === 'function') this.ensureHash('#/login');
      if (this.toast) this.toast.text = '';
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      return true;
    },

    saveUser(draft) {
      const input = draft && typeof draft === 'object' ? draft : {};
      const id = text(input.id, '');
      const existing = id ? userFor(this, id) : null;
      const requiredPermission = existing ? 'users.edit' : 'users.create';
      if (!this.requirePermission(requiredPermission)) return makeResult(false, 'No tienes permisos para administrar usuarios.');

      const fieldErrors = {};
      const username = text(input.username, '');
      const name = text(input.name, '');
      const email = text(input.email, '');
      const roleId = canonicalRoleId(input.roleId);
      const personId = text(input.personId, '');
      const password = typeof input.password === 'string' ? input.password : '';
      const users = Array.isArray(this.security.users) ? this.security.users : [];
      const roles = Array.isArray(this.security.roles) ? this.security.roles : [];
      const role = roleFor(this, roleId);
      const duplicate = users.some((user) => user.id !== id && user.username.toLocaleLowerCase('es') === username.toLocaleLowerCase('es'));

      if (!username) fieldErrors.username = 'Introduce un nombre de usuario.';
      else if (username.length > 64) fieldErrors.username = 'Usa un máximo de 64 caracteres.';
      else if (duplicate) fieldErrors.username = 'Ya existe una cuenta con ese usuario.';
      if (!name) fieldErrors.name = 'Introduce un nombre visible.';
      else if (name.length > 120) fieldErrors.name = 'Usa un máximo de 120 caracteres.';
      if (email && (!/^\S+@\S+\.\S{2,}$/.test(email) || email.length > 160)) fieldErrors.email = 'Introduce un correo válido.';
      if (!role || !role.id) fieldErrors.roleId = 'Selecciona un rol válido.';
      if (personId && (!Array.isArray(this.people) || !this.people.some((person) => person.id === personId))) {
        fieldErrors.personId = 'La persona vinculada no está disponible.';
      }
      if (!existing && !password) fieldErrors.password = 'Introduce una contraseña para la cuenta.';
      if (password && (password.length < 4 || password.length > 128)) fieldErrors.password = 'Usa entre 4 y 128 caracteres.';
      if (Object.keys(fieldErrors).length) return makeResult(false, 'Revisa los campos de la cuenta.', fieldErrors);

      const actorPermissions = permissionSet(this.effectivePermissions);
      const targetPermissions = permissionSet(this.userPermissions({ roleId: role.id }));
      const escalation = Array.from(targetPermissions).some((permission) => !actorPermissions.has(permission));
      if (escalation && !this.can('roles.manage')) {
        return makeResult(false, 'Solo un administrador de roles puede asignar esos permisos.', { roleId: 'No puedes asignar un rol con más permisos que los tuyos.' });
      }

      const candidate = {
        id: existing ? existing.id : uniqueId(slugify(username, 'usuario'), new Set(users.map((user) => user.id))),
        username,
        name,
        email,
        roleId: role.id,
        active: input.active !== false,
        lastAccess: existing ? existing.lastAccess : null,
        personId,
        password: password || (existing ? existing.password : '')
      };
      const nextUsers = users.map((user) => user.id === candidate.id ? candidate : Object.assign({}, user));
      if (!existing) nextUsers.push(candidate);
      if (activeFullAdminCount(nextUsers, roles) < 1) {
        return makeResult(false, 'Debe quedar al menos un administrador activo.', { active: 'Mantén un administrador activo.' });
      }

      const previous = this.security.users;
      this.security.users = nextUsers;
      if (!this.securityPersist()) {
        this.security.users = previous;
        return makeResult(false, 'No se pudo guardar la cuenta.');
      }
      this.syncAccess();
      return makeResult(true, '', {}, { user: candidate });
    },

    setUserActive(user, active) {
      const target = userFor(this, user && user.id);
      if (!target) return makeResult(false, 'La cuenta ya no está disponible.');
      if (!this.requirePermission('users.edit')) return makeResult(false, 'No tienes permisos para editar usuarios.');
      const nextActive = !!active;
      if (target.active === nextActive) return makeResult(true, '', {}, { user: target });
      const users = this.security.users.map((item) => item.id === target.id ? Object.assign({}, item, { active: nextActive }) : Object.assign({}, item));
      if (activeFullAdminCount(users, this.security.roles) < 1) {
        return makeResult(false, 'Debe quedar al menos un administrador activo.', { active: 'Mantén un administrador activo.' });
      }
      const previous = this.security.users;
      this.security.users = users;
      if (!this.securityPersist()) {
        this.security.users = previous;
        return makeResult(false, 'No se pudo actualizar el estado de la cuenta.');
      }
      this.syncAccess();
      return makeResult(true, '', {}, { user: userFor(this, target.id) });
    },

    saveRole(draft) {
      if (!this.requirePermission('roles.manage')) return makeResult(false, 'No tienes permisos para administrar roles.');
      const input = draft && typeof draft === 'object' ? draft : {};
      const id = canonicalRoleId(input.id);
      const existing = id ? roleFor(this, id) : null;
      const name = text(input.name, '');
      const fieldErrors = {};
      const roles = Array.isArray(this.security.roles) ? this.security.roles : [];
      if (!name) fieldErrors.name = 'Introduce un nombre para el rol.';
      else if (name.length > 80) fieldErrors.name = 'Usa un máximo de 80 caracteres.';
      if (roles.some((role) => role.id !== (existing && existing.id) && role.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
        fieldErrors.name = 'Ya existe un rol con ese nombre.';
      }
      const permissions = safePermissions(input.permissions);
      if (Object.keys(fieldErrors).length) return makeResult(false, 'Revisa los datos del rol.', fieldErrors);

      const candidate = {
        id: existing ? existing.id : uniqueId(slugify(name, 'rol'), new Set(roles.map((role) => role.id))),
        name,
        permissions
      };
      const nextRoles = roles.map((role) => role.id === candidate.id ? candidate : Object.assign({}, role));
      if (!existing) nextRoles.push(candidate);
      if (activeFullAdminCount(this.security.users, nextRoles) < 1) {
        return makeResult(false, 'Debe quedar al menos un administrador activo.', { permissions: 'Mantén un rol de administrador activo.' });
      }
      const previous = this.security.roles;
      this.security.roles = nextRoles;
      if (!this.securityPersist()) {
        this.security.roles = previous;
        return makeResult(false, 'No se pudo guardar el rol.');
      }
      this.syncAccess();
      return makeResult(true, '', {}, { role: candidate });
    },

    saveSecurityPreferences(minutes) {
      if (!this.requirePermission('sessions.manage')) return makeResult(false, 'No tienes permisos para administrar sesiones.');
      const numeric = Number(minutes);
      if (!Number.isFinite(numeric) || numeric < MIN_SESSION_MINUTES || numeric > MAX_SESSION_MINUTES) {
        return makeResult(false, 'El tiempo debe estar entre 5 y 1440 minutos.', { sessionMinutes: 'Usa un valor entre 5 y 1440 minutos.' });
      }
      const previous = this.security.sessionMinutes;
      this.security.sessionMinutes = Math.round(numeric);
      if (!this.securityPersist()) {
        this.security.sessionMinutes = previous;
        return makeResult(false, 'No se pudo guardar la preferencia de sesión.');
      }
      this.scheduleAccessCheck();
      return makeResult(true, '', {}, { sessionMinutes: this.security.sessionMinutes });
    },

    startSessionListeners() {
      const state = this.__assetAccess || {};
      if (state.listenersStarted) {
        this.scheduleAccessCheck();
        return;
      }
      const onActivity = () => this.touchAccessSession();
      const onStorage = (event) => {
        if (event.key === ACCESS_KEY) {
          const next = normalizeSecurity(readJSON('localStorage', ACCESS_KEY, null));
          if (this.security) Object.assign(this.security, next);
          else this.security = next;
          this.syncAccess();
        } else if (event.key === SESSION_KEY) {
          this.checkAccessSession();
        }
      };
      state.onActivity = onActivity;
      state.onStorage = onStorage;
      state.listenersStarted = true;
      this.__assetAccess = state;
      document.addEventListener('pointerdown', onActivity, { passive: true });
      document.addEventListener('keydown', onActivity, { passive: true });
      window.addEventListener('storage', onStorage);
      this.scheduleAccessCheck();
    },

    stopSessionListeners() {
      const state = this.__assetAccess;
      if (!state) return;
      if (state.timer) window.clearTimeout(state.timer);
      if (state.listenersStarted) {
        document.removeEventListener('pointerdown', state.onActivity);
        document.removeEventListener('keydown', state.onActivity);
        window.removeEventListener('storage', state.onStorage);
      }
      state.timer = null;
      state.listenersStarted = false;
      this.__assetAccess = state;
    },

    mapSecurityState() {
      const persisted = normalizeSecurity(readJSON('localStorage', ACCESS_KEY, this.security));
      if (this.security) Object.assign(this.security, persisted);
      else this.security = persisted;
      return persisted;
    }
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
      return this.currentUser ? methods.userPermissions.call(this, this.currentUser) : [];
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
    if (!vm) return;
    const security = normalizeSecurity(readJSON('localStorage', ACCESS_KEY, null));
    if (vm.security) Object.assign(vm.security, security);
    else vm.security = security;
    writeJSON('localStorage', ACCESS_KEY, security);

    vm.__assetAccess = vm.__assetAccess || { timer: null, listenersStarted: false, lastTouch: 0 };
    const session = normalizedSession(readJSON('sessionStorage', SESSION_KEY, null));
    const now = Date.now();
    const limit = security.sessionMinutes * 60 * 1000;
    const user = session && security.users.find((item) => item.id === session.userId);
    const valid = !!(session && user && user.active && now - session.lastActivity < limit);
    if (valid) {
      vm.activeUserId = session.userId;
      vm.authenticated = true;
      if (session.migrated) writeJSON('sessionStorage', SESSION_KEY, { userId: session.userId, lastActivity: session.lastActivity });
      vm.startSessionListeners();
      if (vm.__assetAccess) vm.__assetAccess.lastTouch = session.lastActivity;
      vm.scheduleAccessCheck();
    } else {
      const reason = user && user.active === false
        ? 'La cuenta está desactivada.'
        : session && Number.isFinite(session.lastActivity) && now - session.lastActivity >= limit
          ? 'La sesión ha vencido. Inicia sesión de nuevo.'
          : '';
      removeStored('sessionStorage', SESSION_KEY);
      vm.activeUserId = null;
      vm.authenticated = false;
      vm.stopSessionListeners();
      if (reason && vm.loginErrors) vm.loginErrors.general = reason;
    }
  }

  function stop(vm) {
    if (!vm) return;
    if (typeof vm.stopSessionListeners === 'function') vm.stopSessionListeners();
    else if (vm.__assetAccess && vm.__assetAccess.timer) window.clearTimeout(vm.__assetAccess.timer);
  }

  window.AssetAccess = {
    catalog: CATALOG.map((group) => ({
      id: group.id,
      label: group.label,
      icon: group.icon,
      permissions: group.permissions.map((permission) => Object.assign({}, permission))
    })),
    data() {
      return {
        security: normalizeSecurity(readJSON('localStorage', ACCESS_KEY, null)),
        activeUserId: null,
        userSearch: '',
        userRoleFilter: 'all',
        userStateFilter: 'all'
      };
    },
    computed,
    methods,
    start,
    stop,
    guardMethods
  };
})();
