(function () {
  'use strict';

  const KEY = 'asset-manager.theme';
  const MEDIA_QUERY = '(prefers-color-scheme: dark)';
  const root = document.documentElement;
  let storageKey = KEY;
  let preference = readPreference();

  function normalize(value) {
    return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
  }

  function readPreference() {
    try {
      return normalize(window.localStorage.getItem(storageKey));
    } catch (error) {
      return 'system';
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
  }

  function resolve(value) {
    const mode = normalize(value);
    return mode === 'system' ? systemTheme() : mode;
  }

  function apply(value, notify) {
    const mode = normalize(value);
    const resolved = resolve(mode);
    root.dataset.theme = resolved;
    root.dataset.themePreference = mode;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a1820' : '#0b2331');

    if (notify) {
      window.dispatchEvent(new CustomEvent('asset-theme-change', {
        detail: { preference: mode, resolved }
      }));
    }
    return { preference: mode, resolved };
  }

  function setPreference(value) {
    preference = normalize(value);
    try {
      window.localStorage.setItem(storageKey, preference);
    } catch (error) {
      /* El tema se mantiene en memoria si el almacenamiento no está disponible. */
    }
    return apply(preference, true);
  }

  const media = window.matchMedia ? window.matchMedia(MEDIA_QUERY) : null;
  const handleSystemChange = function () {
    if (preference === 'system') apply(preference, true);
  };

  if (media) {
    if (media.addEventListener) media.addEventListener('change', handleSystemChange);
    else if (media.addListener) media.addListener(handleSystemChange);
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== storageKey) return;
    preference = normalize(event.newValue);
    apply(preference, true);
  });

  apply(preference, false);

  function setScope(id) {
    storageKey = id === null || id === undefined || id === ''
      ? KEY
      : KEY + '.user.' + encodeURIComponent(String(id));
    preference = readPreference();
    return apply(preference, true);
  }

  window.AssetTheme = {
    getPreference: function () { return preference; },
    getResolved: function () { return root.dataset.theme || resolve(preference); },
    set: setPreference,
    setScope: setScope,
    toggle: function () {
      return setPreference(resolve(preference) === 'dark' ? 'light' : 'dark');
    }
  };

  window.AssetThemeMethods = {
    toggleTheme: function () {
      const result = window.AssetTheme.toggle();
      this.themeMode = result.preference;
    },
    handleThemeChange: function (event) {
      this.themeMode = event && event.detail
        ? event.detail.preference
        : window.AssetTheme.getPreference();
    }
  };
})();
