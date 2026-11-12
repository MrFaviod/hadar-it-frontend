(function () {
  'use strict';
  function tr(key, params) {
    const i18n = window.ItsmI18n;
    if (!i18n || typeof i18n.t !== 'function') return key;
    return i18n.t(key, params);
  }
  const E = window.AssetAppearanceEngine;
  function userId(vm) { return vm.activeUserId || vm.currentUser?.id || ''; }
  function syncGeneral(vm, branding) {
    const next = {
      appName: branding.appName.trim(),
      organizationName: branding.organizationName.trim(),
      logo: branding.logo || 'assets/svg/logo.svg'
    };
    vm.config.general = Object.assign({}, vm.config.general, next);
  }
  window.AssetAppearanceMethods = {
    syncAppearance() {
      const root = document.documentElement;
      if (!root?.style) return;
      const mode = window.AssetTheme ? window.AssetTheme.getResolved() : (this.themeMode === 'dark' ? 'dark' : 'light');
      this.themeResolvedMode = mode;
      const preset = this.appearance.active;
      if (!preset) return;
      const original = preset.id === 'generic' && JSON.stringify(preset.colors) === JSON.stringify(this.appearance.presets[0].colors);
      root.dataset.branding = original ? 'generic' : 'custom';
      root.dataset.density = preset.preferences?.compact ? 'compact' : 'comfortable';
      for (const [key, value] of Object.entries(E.tokens(preset, mode))) {
        if (original) root.style.removeProperty(key); else root.style.setProperty(key, value);
      }
      let icon = document.querySelector('link[rel="icon"]');
      if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
      // Only bounded internal or embedded resources may reach link.href; a
      // malformed gallery entry must not turn the shell into a tracking beacon.
      icon.href = E.safeResource(preset.branding.favicon) || E.safeResource(preset.branding.logo) || 'assets/svg/favicon.svg';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', original ? (mode === 'dark' ? '#0a1820' : '#0b2331') : E.tokens(preset, mode)['--brand-primary']);
    },
    applyAppearanceState(preset) {
      if (!preset) return;
      E.validate(preset);
      this.appearance.active = E.clone(preset);
      syncGeneral(this, preset.branding);
      this.syncAppearance();
      if (this.updateDocumentTitle) this.updateDocumentTitle();
    },
    applyAppearance(preset) {
      E.applyPreset(this.appearance, preset);
      syncGeneral(this, preset.branding);
      this.syncAppearance();
      if (this.updateDocumentTitle) this.updateDocumentTitle();
      this.showToast(window.ItsmI18n ? window.ItsmI18n.t('ui.appearance.runtime.applied') : '');
    },
    applyThemeMode(mode) {
      const preference = mode === 'light' || mode === 'dark' ? mode : 'system';
      this.themeMode = preference;
      if (this.appearance) E.setUserMode(this.appearance, userId(this) || 'guest', preference);
      if (window.AssetTheme) window.AssetTheme.set(preference);
      this.syncAppearance();
    },
    persistAppearanceMode(mode) {
      if (!this.authenticated || !window.AssetAppearanceApi) return Promise.resolve(mode);
      const themeMode = window.AssetAppearanceApi.normalizeMode(mode);
      const saved = typeof this.patchWorkspaceState === 'function'
        ? this.patchWorkspaceState({ themeMode: themeMode })
        : window.AssetAppearanceApi.saveThemeMode(this, mode);
      return Promise.resolve(saved).catch(error => {
        if (this.showToast) this.showToast(error.message || tr('ui.appearance.runtime.mode_save_failed'), 'error');
        return null;
      });
    },
    setAppearanceMode(mode) {
      const preference = mode === 'light' || mode === 'dark' ? mode : 'system';
      E.setUserMode(this.appearance, userId(this) || 'guest', preference);
      this.themeMode = preference;
      if (window.AssetTheme) window.AssetTheme.set(preference);
      this.syncAppearance();
      return this.persistAppearanceMode(preference);
    },
    changeAppearanceUser() {
      const id = userId(this) || 'guest';
      if (window.AssetTheme && typeof window.AssetTheme.setScope === 'function') window.AssetTheme.setScope(this.authenticated ? id : null);
      if (window.AssetAppearanceApi) window.AssetAppearanceApi.identityChanged(this);
      if (this.authenticated) {
        // The account's mode lives in workspace state; a scoped cache may avoid
        // a flash, but the guest key or another account's preference is never
        // read. Server hydration replaces this value.
        const cached = window.AssetTheme && typeof window.AssetTheme.setScope === 'function' ? window.AssetTheme.getPreference() : 'system';
        this.applyThemeMode(cached);
        return;
      }
      if (!Object.keys(this.appearance.userModes).length && window.AssetTheme) E.setUserMode(this.appearance, id, window.AssetTheme.getPreference());
      const mode = E.getUserMode(this.appearance, id);
      this.themeMode = mode;
      if (window.AssetTheme) window.AssetTheme.set(mode);
      this.syncAppearance();
    },
    resetThemeMode() {
      if (window.AssetTheme && typeof window.AssetTheme.setScope === 'function') {
        window.AssetTheme.setScope(null);
        const guest = window.AssetTheme.getPreference();
        this.themeMode = guest === 'light' || guest === 'dark' ? guest : 'system';
        this.syncAppearance();
        return;
      }
      this.themeMode = 'system';
      if (window.AssetTheme) window.AssetTheme.set('system');
      this.syncAppearance();
    },
    startAppearance() {
      if (window.AssetTheme && typeof window.AssetTheme.setScope === 'function') window.AssetTheme.setScope(this.authenticated ? userId(this) : null);
      if (!window.AssetAppearanceApi) return Promise.resolve(this.appearance);
      return window.AssetAppearanceApi.start(this).catch(error => {
        if (this.showToast) this.showToast(error.message || (window.ItsmI18n ? window.ItsmI18n.t('ui.appearance.runtime.load_failed') : ''), 'error');
        return this.appearance;
      });
    },
    stopAppearance() {
      if (window.AssetAppearanceApi) window.AssetAppearanceApi.stop(this);
    },
    toggleTheme() {
      const mode = window.AssetTheme ? window.AssetTheme.getResolved() : this.themeMode;
      return this.setAppearanceMode(mode === 'dark' ? 'light' : 'dark');
    },
    handleThemeChange(event) {
      this.themeMode = event?.detail?.preference || window.AssetTheme?.getPreference() || 'system';
      this.themeResolvedMode = event?.detail?.resolved || window.AssetTheme?.getResolved() || 'light';
      E.setUserMode(this.appearance, userId(this) || 'guest', this.themeMode);
      this.syncAppearance();
    }
  };
})();
