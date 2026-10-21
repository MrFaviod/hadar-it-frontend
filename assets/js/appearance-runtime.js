(function () {
  'use strict';
  const E = window.AssetAppearanceEngine;
  window.AssetAppearanceMethods = {
    syncAppearance() {
      const root = document.documentElement;
      if (!root?.style) return;
      const mode = window.AssetTheme ? window.AssetTheme.getResolved() : (this.themeMode === 'dark' ? 'dark' : 'light');
      this.themeResolvedMode = mode;
      const preset = this.appearance.active;
      const original = preset.id === 'generic' && JSON.stringify(preset.colors) === JSON.stringify(this.appearance.presets[0].colors);
      root.dataset.branding = original ? 'generic' : 'custom';
      root.dataset.density = preset.preferences?.compact ? 'compact' : 'comfortable';
      for (const [key, value] of Object.entries(E.tokens(preset, mode))) {
        if (original) root.style.removeProperty(key); else root.style.setProperty(key, value);
      }
      let icon = document.querySelector('link[rel="icon"]');
      if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
      icon.href = preset.branding.favicon || preset.branding.logo || 'assets/svg/logo.svg';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && !original) meta.setAttribute('content', E.tokens(preset, mode)['--brand-primary']);
    },
    applyAppearance(preset) {
      E.applyPreset(this.appearance, preset);
      this.config.general = { appName: preset.branding.appName.trim(), organizationName: preset.branding.organizationName.trim(), logo: preset.branding.logo || 'assets/svg/logo.svg' };
      this.generalDraft = E.clone(this.config.general);
      this.syncAppearance();
      if (this.updateDocumentTitle) this.updateDocumentTitle();
      this.showToast('Apariencia aplicada a toda la aplicación.');
    },
    setAppearanceMode(mode) {
      E.setUserMode(this.appearance, this.activeUserId || this.currentUser?.id, mode);
      this.themeMode = mode;
      if (window.AssetTheme) window.AssetTheme.set(mode);
      this.syncAppearance();
    },
    changeAppearanceUser() {
      const userId = this.activeUserId || this.currentUser?.id || 'guest';
      if (!Object.keys(this.appearance.userModes).length && window.AssetTheme) E.setUserMode(this.appearance, userId, window.AssetTheme.getPreference());
      const mode = E.getUserMode(this.appearance, userId);
      this.themeMode = mode;
      if (window.AssetTheme) window.AssetTheme.set(mode);
      this.syncAppearance();
    },
    toggleTheme() {
      const mode = window.AssetTheme ? window.AssetTheme.getResolved() : this.themeMode;
      this.setAppearanceMode(mode === 'dark' ? 'light' : 'dark');
    },
    handleThemeChange(event) {
      this.themeMode = event?.detail?.preference || window.AssetTheme?.getPreference() || 'system';
      this.themeResolvedMode = event?.detail?.resolved || window.AssetTheme?.getResolved() || 'light';
      E.setUserMode(this.appearance, this.activeUserId || this.currentUser?.id, this.themeMode);
      this.syncAppearance();
    }
  };
})();
