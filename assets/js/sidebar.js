(function () {
  'use strict';

  const KEY = 'asset-manager.sidebar';
  const DOCK_QUERY = '(min-width: 720px)';
  const WIDE_QUERY = '(min-width: 1181px)';

  function query(queryString) {
    return window.matchMedia ? window.matchMedia(queryString) : null;
  }

  function matches(queryString) {
    const media = query(queryString);
    return !!(media && media.matches);
  }

  function canDock() {
    return matches(DOCK_QUERY);
  }

  function readPreference() {
    try {
      const value = window.localStorage.getItem(KEY);
      return value === 'pinned' || value === 'unpinned' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function isPinned() {
    const preference = readPreference();
    if (preference) return preference === 'pinned';
    /* Sin preferencia guardada el panel arranca acoplado en escritorio y como
       cajón en pantallas angostas, que es el comportamiento histórico. */
    return matches(WIDE_QUERY);
  }

  function writePreference(pinned) {
    try {
      window.localStorage.setItem(KEY, pinned ? 'pinned' : 'unpinned');
    } catch (error) {
      /* La preferencia vive en memoria mientras dure la sesión. */
    }
  }

  function snapshot() {
    return { pinned: isPinned(), dockable: canDock() };
  }

  function watch(handler) {
    const queries = [DOCK_QUERY, WIDE_QUERY];
    const listeners = [];

    function onMediaChange() {
      handler(snapshot());
    }

    function onStorage(event) {
      if (event.key !== KEY) return;
      handler(snapshot());
    }

    queries.forEach(function (queryString) {
      const media = query(queryString);
      if (!media) return;
      if (media.addEventListener) media.addEventListener('change', onMediaChange);
      else if (media.addListener) media.addListener(onMediaChange);
      listeners.push(function () {
        if (media.removeEventListener) media.removeEventListener('change', onMediaChange);
        else if (media.removeListener) media.removeListener(onMediaChange);
      });
    });

    window.addEventListener('storage', onStorage);
    listeners.push(function () {
      window.removeEventListener('storage', onStorage);
    });

    return function unsubscribe() {
      listeners.forEach(function (remove) { remove(); });
    };
  }

  window.AssetSidebar = {
    isPinned: isPinned,
    canDock: canDock,
    capture: snapshot,
    setPinned: writePreference,
    watch: watch
  };

  window.AssetSidebarMethods = {
    toggleSidebarPin: function () {
      if (!this.sidebarDockable) return;
      const next = !this.sidebarPinned;
      this.sidebarPinnedPref = next;
      this.mobileNavOpen = false;
      window.AssetSidebar.setPinned(next);
      this.showToast(tr(next ? 'ui.shell.sidebar_pinned_toast' : 'ui.shell.sidebar_released_toast'));
    },
    openSidebar: function () {
      this.userMenuOpen = false;
      this.mobileNavOpen = true;
    },
    closeSidebar: function () {
      this.mobileNavOpen = false;
    },
    applySidebarState: function (state) {
      if (!state) return;
      this.sidebarPinnedPref = state.pinned;
      this.sidebarDockable = state.dockable;
      if (!state.dockable) this.mobileNavOpen = false;
    }
  };
})();
