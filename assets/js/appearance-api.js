(function () {
  'use strict';
  // Server authority for the installation appearance. The engine keeps the
  // original preset schema and rendering; this adapter only moves that state
  // through the authenticated API. No preset is activated as a side effect of
  // saving, importing or previewing.
  const MAX_ZIP = 24 * 1024 * 1024;
  const states = new WeakMap();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const engine = () => window.AssetAppearanceEngine;
  const currentUser = vm => String((vm && (vm.activeUserId || (vm.currentUser && vm.currentUser.id))) || '');

  function makeError(message, status) { const error = new Error(message); error.status = status || 0; return error; }
  function ensure(vm) {
    let state = states.get(vm);
    if (!state) {
      state = { started: false, userId: undefined, builtins: ['generic', 'blue', 'forest'], epochs: { active: 0, presets: 0, session: 0, theme: 0 }, loading: { active: false, presets: false }, error: '', themeQueue: Promise.resolve() };
      states.set(vm, state);
    }
    return state;
  }
  function basePath(vm) {
    // AssetAccess.request already prefixes /api/v1; only an explicit override
    // may add a version segment here.
    const value = vm && vm.appearanceApiBase;
    return typeof value === 'string' && value.startsWith('/') ? value.replace(/\/$/, '') : '';
  }
  function request(vm, method, path, options) {
    const access = window.AssetAccess;
    if (!access || typeof access.request !== 'function') return Promise.reject(makeError('El servicio de apariencia no está disponible.', 503));
    return access.request(vm, basePath(vm) + path, Object.assign({ method: method }, options || {}));
  }
  function canManage(vm) {
    if (vm && typeof vm.can === 'function') return !!vm.can('config.general');
    return true;
  }
  function requireSession(vm) {
    if (!vm || !vm.authenticated) throw makeError('Inicia sesión para administrar la apariencia de la instalación.', 401);
  }
  function begin(vm, channel) {
    const state = ensure(vm);
    state.epochs[channel] += 1;
    return { vm: vm, state: state, channel: channel, session: state.epochs.session, epoch: state.epochs[channel] };
  }
  function fresh(token) {
    return states.get(token.vm) === token.state && token.state.epochs.session === token.session && token.state.epochs[token.channel] === token.epoch;
  }
  function normalizePreset(value, context) {
    if (!value || typeof value !== 'object') throw makeError((context || 'La apariencia') + ' no contiene un preset válido.', 422);
    const preset = clone(value);
    if (preset.version == null) preset.version = 1;
    engine().validate(preset);
    return preset;
  }
  function normalizeMode(mode) { return mode === 'light' || mode === 'dark' ? mode : 'auto'; }
  function syncGeneral(vm) {
    if (!vm || !vm.appearance || !vm.appearance.active) return;
    const branding = vm.appearance.active.branding || {};
    const next = {
      appName: (branding.appName || '').trim(),
      organizationName: (branding.organizationName || '').trim(),
      logo: branding.logo || 'assets/svg/logo.svg'
    };
    vm.config = vm.config || {};
    vm.config.general = Object.assign({}, vm.config.general, next);
  }
  function syncShell(vm) {
    if (vm && typeof vm.syncAppearance === 'function') vm.syncAppearance();
  }
  function resetLocal(vm) {
    const state = ensure(vm);
    const generic = engine().clone(engine().createState().presets[0]);
    state.error = '';
    if (!vm.appearance) vm.appearance = engine().createState();
    vm.appearance.presets = [generic];
    vm.appearance.active = generic;
    vm.appearance.previous = null;
    syncGeneral(vm);
    syncShell(vm);
  }
  function applyServer(vm, payload) {
    const state = ensure(vm), appearance = vm.appearance;
    if (!payload || !appearance) return appearance;
    const list = Array.isArray(payload.presets) ? payload.presets.map(item => normalizePreset(item, 'La galería')) : null;
    if (list) appearance.presets = list;
    const activeId = String(payload.activeId || (payload.active && payload.active.id) || '');
    let active = payload.active ? normalizePreset(payload.active, 'La apariencia activa') : null;
    if (!active && activeId) active = appearance.presets.find(item => item.id === activeId) || null;
    if (!active && !vm.authenticated && payload.active) active = normalizePreset(payload.active, 'La apariencia activa');
    if (active) appearance.active = active;
    const previousId = String(payload.previousId || (payload.previous && payload.previous.id) || '');
    if (payload.previous) appearance.previous = normalizePreset(payload.previous, 'La apariencia anterior');
    else if (previousId) appearance.previous = appearance.presets.find(item => item.id === previousId) || null;
    else if (payload.previousId === null) appearance.previous = null;
    if (Array.isArray(payload.builtinIds)) state.builtins = payload.builtinIds.slice();
    appearance.builtinIds = state.builtins.slice();
    if (active) syncGeneral(vm);
    syncShell(vm);
    return appearance;
  }
  async function loadActive(vm) {
    const state = ensure(vm), token = begin(vm, 'active');
    state.loading.active = true;
    try {
      const payload = await request(vm, 'GET', '/appearance/active');
      if (!fresh(token)) return null;
      state.error = '';
      return applyServer(vm, payload);
    } catch (error) {
      if (!fresh(token)) return null;
      state.error = error.message || 'No se pudo cargar la apariencia activa.';
      return null;
    } finally {
      if (fresh(token)) state.loading.active = false;
    }
  }
  async function loadPresets(vm) {
    if (!vm || !vm.authenticated) return null;
    const state = ensure(vm), token = begin(vm, 'presets');
    state.loading.presets = true;
    try {
      const payload = await request(vm, 'GET', '/appearance/presets');
      if (!fresh(token)) return null;
      state.error = '';
      return applyServer(vm, payload);
    } catch (error) {
      if (!fresh(token)) return null;
      state.error = error.message || 'No se pudo cargar la galería de apariencia.';
      return null;
    } finally {
      if (fresh(token)) state.loading.presets = false;
    }
  }
  async function start(vm) {
    const state = ensure(vm);
    state.started = true;
    const user = currentUser(vm);
    if (vm.authenticated && state.userId !== user) {
      state.userId = user;
      resetLocal(vm);
    }
    if (vm.authenticated) {
      const gallery = await loadPresets(vm);
      if (!gallery) await loadActive(vm);
      return gallery || vm.appearance;
    }
    await loadActive(vm);
    return vm.appearance;
  }
  function invalidate(vm) {
    const state = ensure(vm);
    state.epochs.active += 1;
    state.epochs.presets += 1;
    state.epochs.session += 1;
    state.epochs.theme += 1;
    state.loading.active = false;
    state.loading.presets = false;
    state.themeQueue = Promise.resolve();
    return state;
  }
  function clear(vm) {
    const state = invalidate(vm);
    state.error = '';
    state.userId = undefined;
    return state;
  }
  function stop(vm) {
    const state = invalidate(vm);
    state.started = false;
    state.userId = undefined;
    return state;
  }
  function identityChanged(vm) {
    const state = ensure(vm), user = currentUser(vm);
    if (state.userId === user) return false;
    invalidate(vm);
    state.userId = user;
    if (vm.authenticated) resetLocal(vm);
    if (!state.started) return true;
    if (vm.authenticated) loadPresets(vm);
    else loadActive(vm);
    return true;
  }
  async function mutate(vm, method, path, body, options) {
    requireSession(vm);
    if (!canManage(vm)) throw makeError('No tienes permisos para cambiar la apariencia de la instalación.', 403);
    const token = begin(vm, 'presets');
    try {
      const payload = await request(vm, method, path, Object.assign({}, options || {}, { body: body }));
      return fresh(token) ? payload : undefined;
    } catch (error) {
      if (!fresh(token)) return undefined;
      throw error;
    }
  }
  function bodyOf(preset) {
    return { name: preset.name, description: preset.description || '', branding: clone(preset.branding), colors: clone(preset.colors), preferences: clone(preset.preferences) };
  }
  async function savePreset(vm, preset) {
    if (!preset) throw makeError('El preset no está disponible.', 422);
    normalizePreset(preset);
    const existing = Array.isArray(vm.appearance.presets) && vm.appearance.presets.some(item => item.id === preset.id);
    const path = existing ? '/appearance/presets/' + encodeURIComponent(preset.id) : '/appearance/presets';
    const payload = await mutate(vm, existing ? 'PUT' : 'POST', path, bodyOf(preset));
    if (payload === undefined) return null;
    const saved = normalizePreset(payload && payload.preset, 'La galería');
    const index = vm.appearance.presets.findIndex(item => item.id === saved.id);
    if (index >= 0) vm.appearance.presets.splice(index, 1, saved);
    else vm.appearance.presets.push(saved);
    // Saving never activates: the active document keeps its applied snapshot
    // until an explicit apply response replaces it.
    return saved;
  }
  async function applyPreset(vm, preset) {
    const id = typeof preset === 'string' ? preset : preset && preset.id;
    if (!id) throw makeError('Selecciona una apariencia de la galería.', 422);
    const payload = await mutate(vm, 'POST', '/appearance/apply/' + encodeURIComponent(id));
    if (payload === undefined) return null;
    const appearance = applyServer(vm, payload || {});
    return appearance ? appearance.active : null;
  }
  async function restore(vm) {
    const payload = await mutate(vm, 'POST', '/appearance/restore');
    if (payload === undefined) return null;
    const appearance = applyServer(vm, payload || {});
    return appearance ? appearance.active : null;
  }
  async function revert(vm) {
    const payload = await mutate(vm, 'POST', '/appearance/revert');
    if (payload === undefined) return null;
    const appearance = applyServer(vm, payload || {});
    return appearance ? appearance.active : null;
  }
  async function removePreset(vm, preset) {
    const id = typeof preset === 'string' ? preset : preset && preset.id;
    if (!id) throw makeError('Selecciona una apariencia de la galería.', 422);
    const payload = await mutate(vm, 'DELETE', '/appearance/presets/' + encodeURIComponent(id));
    if (payload === undefined) return false;
    vm.appearance.presets = vm.appearance.presets.filter(item => item.id !== id);
    return true;
  }
  async function exportPreset(vm, preset) {
    requireSession(vm);
    if (!canManage(vm)) throw makeError('No tienes permisos para exportar la apariencia de la instalación.', 403);
    const id = typeof preset === 'string' ? preset : preset && preset.id;
    if (!id) throw makeError('Selecciona una apariencia para exportar.', 422);
    const state = ensure(vm), session = state.epochs.session;
    const blob = await request(vm, 'GET', '/appearance/presets/' + encodeURIComponent(id) + '/export', { responseType: 'blob' });
    if (state.epochs.session !== session) return null;
    return blob;
  }
  function safeFilename(name) {
    const base = String(name || 'apariencia').trim().replace(/\.zip$/i, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return (base || 'apariencia') + '.zip';
  }
  async function downloadPreset(vm, preset, name) {
    const blob = await exportPreset(vm, preset);
    if (!blob) return null;
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = safeFilename(name);
    link.rel = 'noopener';
    link.click();
    window.setTimeout(function () { window.URL.revokeObjectURL(objectUrl); }, 1000);
    return blob;
  }
  async function previewImport(vm, bytes) {
    requireSession(vm);
    if (!canManage(vm)) throw makeError('No tienes permisos para importar la apariencia de la instalación.', 403);
    const blob = bytes instanceof Blob && bytes.type === 'application/zip' ? bytes : new Blob([bytes], { type: 'application/zip' });
    if (!blob.size) throw makeError('El archivo está vacío.', 422);
    if (blob.size > MAX_ZIP) throw makeError('El paquete supera el límite de 24 MB.', 413);
    const state = ensure(vm), session = state.epochs.session;
    const payload = await request(vm, 'POST', '/appearance/import/preview', { body: blob });
    if (state.epochs.session !== session) return null;
    return {
      preset: normalizePreset(payload && payload.preset, 'El paquete'),
      resources: Array.isArray(payload && payload.resources) ? payload.resources : [],
      comparison: payload && payload.comparison ? payload.comparison : null,
      warnings: Array.isArray(payload && payload.warnings) ? payload.warnings : []
    };
  }
  async function stageImport(vm, preset, policy) {
    normalizePreset(preset);
    const payload = await mutate(vm, 'POST', '/appearance/import', { preset: Object.assign(bodyOf(preset), { version: 1 }), policy: policy === 'replace' ? 'replace' : 'both' });
    if (payload === undefined) return null;
    const staged = normalizePreset(payload && payload.preset, 'El paquete');
    const index = vm.appearance.presets.findIndex(item => item.id === staged.id);
    if (index >= 0) vm.appearance.presets.splice(index, 1, staged);
    else vm.appearance.presets.push(staged);
    return staged;
  }
  async function saveThemeMode(vm, mode) {
    const themeMode = normalizeMode(mode);
    if (vm && typeof vm.patchWorkspaceState === 'function') {
      await vm.patchWorkspaceState({ themeMode: themeMode });
      return themeMode;
    }
    requireSession(vm);
    const state = ensure(vm), token = begin(vm, 'theme');
    const run = async () => {
      const current = await request(vm, 'GET', '/workspace/state');
      if (!fresh(token)) return null;
      const body = Object.assign({}, current && typeof current === 'object' ? current : {});
      body.themeMode = themeMode;
      await request(vm, 'PUT', '/workspace/state', { body: body });
      return fresh(token) ? themeMode : null;
    };
    const next = state.themeQueue.then(run, run);
    state.themeQueue = next.catch(function () { return null; });
    return next;
  }
  function isLoading(vm) { const state = states.get(vm); return !!(state && (state.loading.active || state.loading.presets)); }
  function loadingFor(vm) { const state = ensure(vm); return { active: state.loading.active, presets: state.loading.presets }; }
  function lastError(vm) { const state = states.get(vm); return state ? state.error : ''; }
  function builtins(vm) { const state = ensure(vm); return state.builtins.slice(); }

  const api = { start, stop, clear, identityChanged, loadActive, loadPresets, savePreset, applyPreset, restore, revert, removePreset, exportPreset, downloadPreset, previewImport, stageImport, saveThemeMode, isLoading, loadingFor, lastError, builtins, normalizeMode };
  window.AssetAppearanceApi = api;
  window.AssetAppearanceApi.install = function () { return api; };
})();
