(function () {
  'use strict';

  // Visible copy resolves through the shipped runtime so a language switch
  // re-renders the adapter messages without reloading the page.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }
  const WIDGETS = ['availability', 'alerts', 'distribution', 'infrastructure', 'activity', 'maintenance', 'warranties', 'inventory', 'latency', 'incidents'];
  const DEFAULTS = ['availability', 'alerts', 'distribution', 'infrastructure', 'activity', 'maintenance', 'warranties', 'inventory'];
  const THEMES = ['light', 'dark', 'auto'];
  const states = new WeakMap();
  const clone = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
  const text = value => value === null || value === undefined ? '' : String(value);

  function createWorkspaceState() {
    return { users: {}, views: [], nextId: 1, widgets: null, themeMode: 'auto', shortcuts: [], loaded: false, loading: false, error: '', epoch: 0, ownerId: '' };
  }
  function createDashboardState() {
    return { widgets: null, layouts: {}, temporary: {}, links: [], nextLink: 1, summary: null, meta: { loading: false, error: '', loaded: false, epoch: 0, generatedAt: '' } };
  }
  function createState() { return { bound: false, sessionEpoch: 0, workspaceEpoch: 0, dashboardEpoch: 0, searchEpoch: 0, integrationsEpoch: 0, writeVersion: 0, writeQueue: Promise.resolve(), dashboardController: null, searchController: null }; }
  function stateFor(vm) {
    let state = states.get(vm);
    if (!state) { state = createState(); states.set(vm, state); }
    return state;
  }
  function ownerOf(vm) { return String((vm && vm.currentUser && vm.currentUser.id) || (vm && vm.activeUserId) || ''); }
  function authenticated(vm) { return !!(vm && vm.authenticated && ownerOf(vm)); }
  function message(error) { return (error && error.message) || tr('ui.shell.request_failed'); }
  // Writes capture the identity that requested them. A queued or in-flight
  // request must never read or mutate the next account's workspace.
  function sessionGuard(vm) {
    const state = stateFor(vm), session = state.sessionEpoch, owner = ownerOf(vm), signedIn = authenticated(vm);
    return () => session !== state.sessionEpoch || owner !== ownerOf(vm) || signedIn !== authenticated(vm);
  }
  function sessionChanged() { return { ok: false, error: tr('ui.shell.session_changed') }; }

  function ensure(vm) {
    const state = stateFor(vm);
    if (!state.bound && vm && typeof vm.$watch === 'function') {
      state.bound = true;
      try {
        vm.$watch('activeUserId', () => invalidate(vm), { flush: 'sync' });
        vm.$watch('authenticated', value => { if (!value) invalidate(vm); });
      } catch (_) { /* isolated tests without a Vue instance stay epoch-guarded */ }
    }
    return state;
  }
  function abort(controller) { if (controller) { try { controller.abort(); } catch (_) { /* already aborted */ } } }
  function freshDashboard(state) { return { ...createDashboardState(), ...state, summary: null, meta: { ...createDashboardState().meta, ...(state && state.meta), loading: false, error: '', epoch: 0 } }; }
  function invalidate(vm) {
    const state = stateFor(vm);
    state.sessionEpoch += 1; state.workspaceEpoch += 1; state.dashboardEpoch += 1; state.searchEpoch += 1; state.integrationsEpoch += 1; state.writeVersion += 1;
    abort(state.dashboardController); abort(state.searchController);
    state.dashboardController = null; state.searchController = null;
    vm.workspaceState = createWorkspaceState();
    vm.dashboard = freshDashboard(vm.dashboard);
    if (typeof vm.resetThemeMode === 'function') vm.resetThemeMode();
  }

  function request(vm, path, options) {
    if (!window.AssetAccess || typeof window.AssetAccess.request !== 'function') return Promise.reject(new Error(tr('ui.shell.session_client_missing')));
    return window.AssetAccess.request(vm, path, options);
  }
  function params(values) {
    const out = [];
    Object.keys(values || {}).forEach(key => {
      const value = values[key];
      if (value === undefined || value === null || value === '') return;
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return out.length ? '?' + out.join('&') : '';
  }
  function mode(value) { return value === 'system' ? 'auto' : THEMES.includes(value) ? value : 'auto'; }
  function numeric(value) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }

  function workspaceFromDto(dto, ownerId, epoch) {
    const source = dto || {};
    const favorites = Array.isArray(source.favorites) ? clone(source.favorites) : [];
    const usage = source.usage && typeof source.usage === 'object' ? clone(source.usage) : {};
    const lastViews = source.lastViews && typeof source.lastViews === 'object' ? clone(source.lastViews) : {};
    const views = Array.isArray(source.views) ? clone(source.views) : [];
    const shortcuts = Array.isArray(source.shortcuts) ? clone(source.shortcuts) : [];
    const users = ownerId ? { [ownerId]: { favorites, usage, lastViews } } : {};
    return { users, views, nextId: views.reduce((next, view) => Math.max(next, Number(view.id.replace(/^view-/, '')) || 0), 0) + 1,
      widgets: Array.isArray(source.widgets) ? source.widgets.filter(id => WIDGETS.includes(id)) : null,
      themeMode: mode(source.themeMode), shortcuts, loaded: true, loading: false, error: '', epoch, ownerId };
  }
  function applyWorkspace(vm, workspace) {
    vm.workspaceState = workspace;
    const dashboard = { ...createDashboardState(), ...(vm.dashboard || {}) };
    vm.dashboard = { ...dashboard, meta: { ...createDashboardState().meta, ...(dashboard.meta || {}) }, widgets: workspace.widgets, links: workspace.shortcuts.slice(), loaded: workspace.loaded, loading: false, error: workspace.error, epoch: workspace.epoch };
    if (typeof vm.applyThemeMode === 'function') vm.applyThemeMode(workspace.themeMode);
    return workspace;
  }
  function hydrateWorkspace(vm, dto, options = {}) {
    const workspace = workspaceFromDto(dto, ownerOf(vm), options.epoch || 0);
    return applyWorkspace(vm, workspace);
  }

  async function loadWorkspace(vm) {
    ensure(vm);
    if (!authenticated(vm)) return null;
    const state = stateFor(vm);
    const epoch = ++state.workspaceEpoch;
    const session = state.sessionEpoch;
    const owner = ownerOf(vm);
    vm.workspaceState = { ...(vm.workspaceState || createWorkspaceState()), loading: true, error: '' };
    try {
      const dto = await request(vm, '/workspace/state');
      if (epoch !== state.workspaceEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || !authenticated(vm)) return null;
      hydrateWorkspace(vm, dto, { epoch });
      return vm.workspaceState;
    } catch (error) {
      if (epoch !== state.workspaceEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm)) return null;
      vm.workspaceState = { ...vm.workspaceState, loading: false, error: message(error) };
      return null;
    }
  }

  function normalizePatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(tr('ui.shell.patch_invalid'));
    const clean = {};
    for (const key of Object.keys(patch)) {
      if (!['widgets', 'favorites', 'usage', 'lastViews', 'themeMode'].includes(key)) throw new Error(tr('ui.shell.patch_field_invalid', { field: key }));
    }
    if (patch.widgets !== undefined) {
      if (!Array.isArray(patch.widgets) || patch.widgets.length > 50 || patch.widgets.some(id => typeof id !== 'string' || !WIDGETS.includes(id))) throw new Error(tr('ui.shell.patch_widgets_invalid'));
      clean.widgets = patch.widgets.slice();
    }
    if (patch.favorites !== undefined) {
      if (!Array.isArray(patch.favorites) || patch.favorites.length > 500) throw new Error(tr('ui.shell.patch_favorites_invalid'));
      clean.favorites = clone(patch.favorites);
    }
    if (patch.usage !== undefined) {
      if (!patch.usage || typeof patch.usage !== 'object' || Array.isArray(patch.usage) || Object.keys(patch.usage).length > 500) throw new Error(tr('ui.shell.patch_usage_invalid'));
      clean.usage = clone(patch.usage);
    }
    if (patch.lastViews !== undefined) {
      if (!patch.lastViews || typeof patch.lastViews !== 'object' || Array.isArray(patch.lastViews) || Object.keys(patch.lastViews).length > 30) throw new Error(tr('ui.shell.patch_last_views_invalid'));
      clean.lastViews = clone(patch.lastViews);
    }
    if (patch.themeMode !== undefined) {
      if (!THEMES.includes(patch.themeMode) && patch.themeMode !== 'system') throw new Error(tr('ui.shell.patch_theme_invalid'));
      clean.themeMode = mode(patch.themeMode);
    }
    return clean;
  }
  function pickState(dto) {
    const source = dto || {};
    return { widgets: Array.isArray(source.widgets) ? source.widgets : null, favorites: Array.isArray(source.favorites) ? source.favorites : [],
      usage: source.usage && typeof source.usage === 'object' ? source.usage : {}, lastViews: source.lastViews && typeof source.lastViews === 'object' ? source.lastViews : {},
      themeMode: mode(source.themeMode) };
  }
  function patchState(vm, patch) {
    ensure(vm);
    if (!authenticated(vm)) return Promise.reject(new Error(tr('ui.shell.session_unauthenticated')));
    let clean;
    try { clean = normalizePatch(patch); } catch (error) { return Promise.reject(error); }
    const state = stateFor(vm);
    const stale = sessionGuard(vm);
    const version = ++state.writeVersion;
    const run = async () => {
      if (stale()) throw new Error(tr('ui.shell.session_changed'));
      const current = await request(vm, '/workspace/state');
      if (stale()) throw new Error(tr('ui.shell.session_changed'));
      const body = { ...pickState(current), ...clean };
      if (clean.lastViews) body.lastViews = { ...(current.lastViews || {}), ...clean.lastViews };
      const saved = await request(vm, '/workspace/state', { method: 'PUT', body });
      if (stale()) throw new Error(tr('ui.shell.session_changed'));
      if (version === state.writeVersion) hydrateWorkspace(vm, saved, { epoch: state.workspaceEpoch });
      return vm.workspaceState;
    };
    const next = state.writeQueue.then(run, run);
    state.writeQueue = next.catch(() => {});
    return next;
  }
  function localWorkspace(vm) {
    if (!vm.workspaceState || !vm.workspaceState.users) vm.workspaceState = { ...(vm.workspaceState || createWorkspaceState()), users: {} };
    return vm.workspaceState;
  }
  function localUser(vm) {
    const workspace = localWorkspace(vm), owner = ownerOf(vm);
    if (window.AssetWorkspace && window.AssetWorkspace.user) return window.AssetWorkspace.user(workspace, owner);
    if (!Object.hasOwn(workspace.users, owner)) workspace.users[owner] = { favorites: [], usage: {}, lastViews: {} };
    return workspace.users[owner];
  }
  async function toggleFavorite(vm, record) {
    if (!record || !record.key) return false;
    ensure(vm);
    const user = localUser(vm);
    const index = user.favorites.findIndex(item => item.key === record.key);
    user.favorites = index < 0 ? user.favorites.concat(clone(record)) : user.favorites.filter(item => item.key !== record.key);
    const added = index < 0;
    try { await patchState(vm, { favorites: user.favorites }); }
    catch (error) { await loadWorkspace(vm); throw error; }
    return added;
  }
  async function recordUsage(vm, key) {
    if (!key) return;
    const user = localUser(vm);
    user.usage = { ...user.usage, [key]: Number(user.usage[key] || 0) + 1 };
    await patchState(vm, { usage: user.usage }).catch(() => {});
  }
  async function rememberLastView(vm, route, snapshot) {
    if (!route || !authenticated(vm)) return;
    const user = localUser(vm);
    user.lastViews = { ...user.lastViews, [route]: clone(snapshot) };
    await patchState(vm, { lastViews: user.lastViews }).catch(() => {});
  }

  function shared(vm) { return typeof vm.can === 'function' ? !!vm.can('config.general') : false; }
  function localShortcuts(vm) {
    if (vm.workspaceState && Array.isArray(vm.workspaceState.shortcuts)) return vm.workspaceState.shortcuts;
    return (vm.dashboard && Array.isArray(vm.dashboard.links)) ? vm.dashboard.links : [];
  }
  function writeShortcuts(vm, shortcuts) {
    if (vm.workspaceState) vm.workspaceState = { ...vm.workspaceState, shortcuts: shortcuts.slice() };
    if (!vm.dashboard) vm.dashboard = createDashboardState();
    vm.dashboard = { ...vm.dashboard, links: shortcuts.slice() };
  }
  function normalizeShortcut(vm, draft) {
    if (window.AssetDashboardPrefs && window.AssetDashboardPrefs.normalizeShortcut) return window.AssetDashboardPrefs.normalizeShortcut(draft, localShortcuts(vm), ownerOf(vm), shared(vm));
    return { ok: false, error: 'Validador de accesos no disponible.' };
  }
  async function saveShortcut(vm, draft) {
    const normalized = normalizeShortcut(vm, draft || {});
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const shortcut = normalized.shortcut;
    const stale = sessionGuard(vm);
    try {
      const { name, url, icon, category, scope } = shortcut;
      const response = await request(vm, '/workspace/shortcuts' + (shortcut.id ? '/' + encodeURIComponent(shortcut.id) : ''), { method: shortcut.id ? 'PATCH' : 'POST', body: { name, url, icon, category, scope } });
      if (stale()) return sessionChanged();
      const saved = response && response.shortcut ? response.shortcut : response;
      const list = localShortcuts(vm).filter(item => item.id !== saved.id).concat(saved);
      writeShortcuts(vm, list);
      return { ok: true, link: saved };
    } catch (error) { return { ok: false, error: message(error) }; }
  }
  async function deleteShortcut(vm, id) {
    if (!id) return { ok: false, error: tr('ui.shell.shortcut_unavailable') };
    const stale = sessionGuard(vm);
    try {
      await request(vm, '/workspace/shortcuts/' + encodeURIComponent(id), { method: 'DELETE' });
      if (stale()) return sessionChanged();
      writeShortcuts(vm, localShortcuts(vm).filter(item => item.id !== id));
      return { ok: true };
    } catch (error) { return { ok: false, error: message(error) }; }
  }
  function localViews(vm) { return vm.workspaceState && Array.isArray(vm.workspaceState.views) ? vm.workspaceState.views : []; }
  function writeViews(vm, views) { if (vm.workspaceState) vm.workspaceState = { ...vm.workspaceState, views: views.slice() }; }
  async function saveView(vm, draft) {
    const engine = window.AssetWorkspace;
    const result = engine && engine.validateView ? engine.validateView(draft || {}, ownerOf(vm), localViews(vm)) : { ok: false, error: 'Validador de vistas no disponible.' };
    if (!result.ok) return { ok: false, error: result.error };
    const stale = sessionGuard(vm);
    try {
      const { name, route, snapshot, scope } = result.view;
      const response = await request(vm, '/workspace/views' + (result.view.id ? '/' + encodeURIComponent(result.view.id) : ''), { method: result.view.id ? 'PATCH' : 'POST', body: { name, route, snapshot, scope } });
      if (stale()) return sessionChanged();
      const saved = response && response.view ? response.view : response;
      writeViews(vm, localViews(vm).filter(view => view.id !== saved.id).concat(saved));
      return { ok: true, view: saved };
    } catch (error) { return { ok: false, error: message(error) }; }
  }
  async function deleteView(vm, id) {
    if (!id) return { ok: false, error: tr('ui.shell.view_unavailable') };
    const stale = sessionGuard(vm);
    try {
      await request(vm, '/workspace/views/' + encodeURIComponent(id), { method: 'DELETE' });
      if (stale()) return sessionChanged();
      writeViews(vm, localViews(vm).filter(view => view.id !== id));
      const user = localUser(vm);
      user.favorites = user.favorites.filter(item => item.key !== 'view:' + id);
      return { ok: true };
    } catch (error) { return { ok: false, error: message(error) }; }
  }

  function normalizeSummary(dto) {
    const source = dto && dto.summary ? dto.summary : dto;
    if (!source || typeof source !== 'object') return null;
    return source;
  }
  function loadDashboard(vm, filters) {
    ensure(vm);
    if (!authenticated(vm)) return Promise.resolve(null);
    const state = stateFor(vm);
    const f = filters || {};
    const period = ['24h', '7d', '30d'].includes(f.period) ? f.period : '24h';
    const epoch = ++state.dashboardEpoch;
    const session = state.sessionEpoch;
    const owner = ownerOf(vm);
    abort(state.dashboardController);
    const controller = new AbortController();
    state.dashboardController = controller;
    const dashboard = vm.dashboard || createDashboardState();
    vm.dashboard = { ...dashboard, summary: null, meta: { ...dashboard.meta, loading: true, error: '', loaded: false, epoch, generatedAt: '' } };
    const path = '/dashboard' + params({ period, category: f.category || '', siteId: f.siteId || f.site || '' });
    const task = (async () => {
      try {
        const dto = await request(vm, path, { signal: controller.signal });
        if (epoch !== state.dashboardEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || !authenticated(vm)) return null;
        const summary = normalizeSummary(dto);
        vm.dashboard = { ...vm.dashboard, summary, meta: { loading: false, error: summary ? '' : tr('ui.shell.dashboard_no_data'), loaded: !!summary, epoch, generatedAt: (summary && summary.generatedAt) || '' } };
        return summary;
      } catch (error) {
        if (epoch !== state.dashboardEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || (error && error.name === 'AbortError')) return null;
        vm.dashboard = { ...vm.dashboard, summary: null, meta: { loading: false, error: message(error), loaded: false, epoch, generatedAt: '' } };
        return null;
      } finally {
        if (epoch === state.dashboardEpoch) state.dashboardController = null;
      }
    })();
    return task;
  }

  async function search(vm, query, options = {}) {
    ensure(vm);
    const state = stateFor(vm);
    const scope = options.scope || 'all';
    state.searchEpoch += 1;
    const epoch = state.searchEpoch;
    abort(state.searchController); state.searchController = null;
    if (!authenticated(vm)) throw new Error(tr('ui.shell.session_unauthenticated'));
    const engine = window.AssetSearch;
    const local = () => {
      const favorites = localUser(vm).favorites;
      const actions = engine && engine.actions ? engine.actions(vm) : [];
      const records = scope === 'actions' ? actions : favorites;
      return { records, total: records.length, limit: records.length, offset: 0, engine: 'local', fallback: false };
    };
    if (scope === 'actions' || scope === 'favorites') return local();
    const session = state.sessionEpoch;
    const owner = ownerOf(vm);
    const controller = new AbortController();
    state.searchController = controller;
    const kind = scope === 'views' ? 'view' : options.kind || '';
    const path = '/search' + params({ q: query || '', kind, limit: options.limit || 20, offset: options.offset || 0 });
    try {
      const dto = await request(vm, path, { signal: controller.signal });
      if (epoch !== state.searchEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || !authenticated(vm)) return null;
      const items = dto && Array.isArray(dto.items) ? dto.items : [];
      const records = items.map(item => engine && engine.fromServer ? engine.fromServer(item) : item);
      return { records, total: Number(dto && dto.total) || 0, limit: Number(dto && dto.limit) || options.limit || 20, offset: Number(dto && dto.offset) || options.offset || 0, engine: dto && dto.engine === 'meilisearch' ? 'meilisearch' : 'sql', fallback: !!(dto && dto.fallback) };
    } catch (error) {
      if (epoch !== state.searchEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || (error && error.name === 'AbortError')) return null;
      throw error;
    } finally {
      if (epoch === state.searchEpoch) state.searchController = null;
    }
  }

  function applyIntegrations(vm, dto) {
    const source = dto || {};
    const anydeskUrl = text(source.anydeskUrl), rmmUrl = text(source.rmmUrl);
    const integrations = { anydesk: { enabled: !!source.anydeskEnabled, url: anydeskUrl }, rmm: { enabled: !!source.rmmEnabled, url: rmmUrl } };
    if (vm.config && typeof vm.config === 'object') vm.config.integrations = integrations;
    return integrations;
  }
  async function loadIntegrations(vm) {
    ensure(vm);
    if (!authenticated(vm)) return null;
    const state = stateFor(vm);
    const epoch = ++state.integrationsEpoch;
    const session = state.sessionEpoch;
    const owner = ownerOf(vm);
    try {
      const dto = await request(vm, '/workspace/integrations');
      if (epoch !== state.integrationsEpoch || session !== state.sessionEpoch || owner !== ownerOf(vm) || !authenticated(vm)) return null;
      return applyIntegrations(vm, dto);
    } catch (_) { return null; }
  }
  async function saveIntegrations(vm, draft) {
    ensure(vm);
    if (!authenticated(vm)) return { ok: false, error: tr('ui.shell.session_unauthenticated') };
    const state = stateFor(vm);
    const session = state.sessionEpoch;
    const owner = ownerOf(vm);
    const anydesk = (draft && draft.anydesk) || {};
    const rmm = (draft && draft.rmm) || {};
    const body = {
      anydeskEnabled: draft && draft.anydeskEnabled !== undefined ? !!draft.anydeskEnabled : !!anydesk.enabled,
      anydeskUrl: text(draft && draft.anydeskUrl !== undefined ? draft.anydeskUrl : anydesk.url).trim(),
      rmmEnabled: draft && draft.rmmEnabled !== undefined ? !!draft.rmmEnabled : !!rmm.enabled,
      rmmUrl: text(draft && draft.rmmUrl !== undefined ? draft.rmmUrl : rmm.url).trim()
    };
    for (const pair of [['anydesk', body.anydeskUrl, body.anydeskEnabled], ['rmm', body.rmmUrl, body.rmmEnabled]]) {
      if (pair[2] && !pair[1]) return { ok: false, error: tr('ui.shell.integration_url_required', { name: pair[0] === 'anydesk' ? 'AnyDesk' : 'Tactical RMM' }) };
      if (pair[1]) {
        let url;
        try { url = new URL(pair[1]); } catch (_) { return { ok: false, error: tr('ui.shell.integration_url_invalid') }; }
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return { ok: false, error: tr('ui.shell.integration_url_invalid') };
      }
    }
    try {
      const dto = await request(vm, '/workspace/integrations', { method: 'PUT', body });
      if (session !== state.sessionEpoch || owner !== ownerOf(vm) || !authenticated(vm)) return { ok: false, error: tr('ui.shell.session_changed') };
      applyIntegrations(vm, dto);
      return { ok: true, integrations: vm.config.integrations };
    } catch (error) { return { ok: false, error: message(error) }; }
  }

  async function start(vm) {
    ensure(vm);
    if (!authenticated(vm)) return;
    await loadWorkspace(vm);
    loadIntegrations(vm);
  }
  function stop(vm) {
    const state = ensure(vm);
    state.integrationsEpoch += 1;
    abort(state.dashboardController); abort(state.searchController);
    state.dashboardController = null; state.searchController = null;
  }
  function clear(vm) { invalidate(vm); }

  const methods = {
    phase10Start() { if (!this.authenticated) return; window.AssetPhase10Api.start(this); },
    phase10Stop() { window.AssetPhase10Api.stop(this); },
    phase10Clear() { window.AssetPhase10Api.clear(this); },
    phase10IdentityChanged() { if (!this.authenticated) { window.AssetPhase10Api.clear(this); return; } window.AssetPhase10Api.start(this); if (this.route && this.route.name === 'panel') this.loadDashboardSummary(); },
    handlePhase10Route(next) { if (!this.authenticated) return; const meta = this.dashboard && this.dashboard.meta; if (next && next.name === 'panel' && !(meta && (meta.loading || meta.loaded))) this.loadDashboardSummary(); },
    patchWorkspaceState(patch) { return window.AssetPhase10Api.patchState(this, patch); },
    loadDashboardSummary(filters) { const child = this.$refs && this.$refs.workspaceView; return window.AssetPhase10Api.loadDashboard(this, filters || (child && child.filters) || {}); },
    loadWorkspaceState() { return window.AssetPhase10Api.loadWorkspace(this); },
    loadArtifactIntegrations() { return window.AssetPhase10Api.loadIntegrations(this); },
    saveArtifactIntegrations(draft) { return window.AssetPhase10Api.saveIntegrations(this, draft); },
    phase10RememberLastView(route, snapshot) { return window.AssetPhase10Api.rememberLastView(this, route, snapshot); },
    saveWorkspaceShortcut(draft) { return window.AssetPhase10Api.saveShortcut(this, draft); },
    deleteWorkspaceShortcut(id) { return window.AssetPhase10Api.deleteShortcut(this, id); },
    saveWorkspaceViewServer(draft) { return window.AssetPhase10Api.saveView(this, draft); },
    deleteWorkspaceViewServer(id) { return window.AssetPhase10Api.deleteView(this, id); }
  };

  window.AssetPhase10Api = { WIDGETS, DEFAULTS, THEMES, createState, createWorkspaceState, createDashboardState, ensure, ownerOf,
    loadWorkspace, hydrateWorkspace, applyWorkspace, patchState, toggleFavorite, recordUsage, rememberLastView,
    saveShortcut, deleteShortcut, saveView, deleteView,
    loadDashboard, search, loadIntegrations, saveIntegrations, start, stop, clear, methods };
  window.AssetPhase10 = { data() { return {}; }, computed: {}, methods };
})();
