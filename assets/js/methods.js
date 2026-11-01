(function () {
  'use strict';

  const Store = window.AssetStore;
  const KEYS = Store.KEYS;
  const CONFIG_SECTIONS = ['apariencia', 'general', 'categorias', 'activos', 'sedes', 'personas', 'integraciones', 'relaciones', 'mantenimiento', 'supervision', 'alertas', 'notificaciones', 'mapas', 'datos', 'seguridad', 'reportes', 'garantias', 'qr', 'etiquetas', 'extensiones'];
  const MONITOR_TABS = ['estado', 'dispositivos', 'alertas'];

  // This module is also evaluated without app.js in component harnesses, so it
  // resolves its own runtime handle instead of relying on a global helper.
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  window.AssetMethods = {
    parseRoute() {
      const hash = window.location.hash.replace(/^#\/?/, '');
      const queryAt = hash.indexOf('?');
      const raw = queryAt === -1 ? hash : hash.slice(0, queryAt);
      const query = queryAt === -1 ? '' : hash.slice(queryAt + 1);
      const match = /(?:^|&)share=([^&]*)/.exec(query);
      let shareToken = '';
      if (match) { try { shareToken = decodeURIComponent(match[1]); } catch (_) { shareToken = match[1]; } }
      const candidateMatch = /(?:^|&)candidato=([^&]*)/.exec(query);
      let candidateId = '';
      if (candidateMatch) { try { candidateId = decodeURIComponent(candidateMatch[1]); } catch (_) { candidateId = candidateMatch[1]; } }
      const parts = raw.split('/').filter(Boolean);
      if (parts[0] === 'ayuda') return { name: 'help' };
      if (parts[0] === 'usuarios') return { name: 'users', userId: null };
      if (parts[0] === 'usuario' && parts[1]) {
        let userId;
        try { userId = decodeURIComponent(parts[1]); } catch (_) { userId = parts[1]; }
        return { name: 'user', userId };
      }
      if (parts[0] === 'acceso-denegado') return { name: 'denied' };
      if (parts[0] === 'reportes') return { name: 'reports', assetId: null, personId: null, section: null };
      if (parts[0] === 'garantias') return { name: 'warranties', assetId: null, personId: null, section: null };
      if (parts[0] === 'etiquetas') return { name: 'labels', assetId: null, personId: null, section: null };
      if (parts[0] === 'reporte' && parts[1]) {
        let id; try { id = decodeURIComponent(parts[1]); } catch (_) { id = parts[1]; }
        return { name: 'reportAsset', assetId: id, personId: null, section: parts[2] === 'publico' && shareToken ? 'publico' : null, shareToken };
      }
      if (parts[0] === 'panel') return { name: 'panel', assetId: null, personId: null, section: null };
      if (parts[0] === 'inventario') return { name: 'inventory', assetId: null, personId: null, section: null };
      if (parts[0] === 'conversacion') {
        let assetId = null;
        if (parts[1] === 'activo' && parts[2]) {
          try { assetId = decodeURIComponent(parts[2]); } catch (_) { assetId = parts[2]; }
        }
        return { name: 'conversation', assetId, personId: null, section: null };
      }
      if (parts[0] === 'login') return { name: 'login', assetId: null, personId: null, section: null };
      if (parts[0] === 'extensiones' && parts[1] && parts[2]) {
        let extensionId = parts[1];
        let pageId = parts[2];
        try { extensionId = decodeURIComponent(parts[1]); } catch (_) { extensionId = parts[1]; }
        try { pageId = decodeURIComponent(parts[2]); } catch (_) { pageId = parts[2]; }
        return { name: 'extension', extensionId, pageId, assetId: null, personId: null, section: null, candidateId: '' };
      }
      if (parts[0] === 'configuracion') {
        return {
          name: 'config',
          assetId: null,
          personId: null,
          section: CONFIG_SECTIONS.indexOf(parts[1]) !== -1 ? parts[1] : 'general',
          candidateId: parts[1] === 'extensiones' ? candidateId : ''
        };
      }
      if (parts[0] === 'datos') {
        return {
          name: 'datos',
          assetId: null,
          personId: null,
          section: parts[1] === 'exportar' ? 'exportar' : 'importar'
        };
      }
      if (parts[0] === 'infra' || parts[0] === 'mapa' || parts[0] === 'grafo') {
        // Both explorer modes live under #/infra/<modo>; #/grafo and #/mapa stay
        // as aliases so links written before the workspace existed keep working.
        const mode = parts[0] === 'grafo' ? 'grafo' : (parts[0] === 'mapa' ? 'mapa' : (parts[1] === 'grafo' ? 'grafo' : 'mapa'));
        const rest = parts[0] === 'infra' ? parts.slice(2) : parts.slice(1);
        const raw = rest[0] === 'activo' ? rest[1] : rest[0];
        let focusId = '';
        if (raw) {
          try { focusId = decodeURIComponent(raw); } catch (error) { focusId = raw; }
        }
        return {
          name: mode === 'grafo' ? 'graph' : 'map',
          assetId: null,
          personId: null,
          section: null,
          focusId: focusId
        };
      }
      if (parts[0] === 'mantenimiento') {
        if (parts[1] === 'incidente' && parts[2]) {
          let incidentId = parts[2];
          try { incidentId = decodeURIComponent(parts[2]); } catch (error) { incidentId = parts[2]; }
          return { name: 'incident', incidentId, assetId: null, personId: null, section: null };
        }
        return { name: 'maintenance', incidentId: '', assetId: null, personId: null, section: null };
      }
      if (parts[0] === 'supervision') {
        if (parts[1] === 'activo' && parts[2]) {
          let assetId = parts[2];
          try { assetId = decodeURIComponent(parts[2]); } catch (error) { assetId = parts[2]; }
          return { name: 'monitorDevice', assetId, personId: null, section: null, incidentId: '', alertId: '' };
        }
        if (parts[1] === 'alerta' && parts[2]) {
          let alertId = parts[2];
          try { alertId = decodeURIComponent(parts[2]); } catch (error) { alertId = parts[2]; }
          return { name: 'monitorAlert', alertId, assetId: null, personId: null, section: null, incidentId: '' };
        }
        if (parts[1] === 'notificaciones') {
          return { name: 'notifications', assetId: null, personId: null, section: null, incidentId: '', alertId: '' };
        }
        return {
          name: 'monitoring',
          assetId: null,
          personId: null,
          incidentId: '',
          alertId: '',
          section: MONITOR_TABS.indexOf(parts[1]) !== -1 ? parts[1] : 'estado'
        };
      }
      if (parts[0] === 'personas') {
        return { name: 'people', assetId: null, personId: null, section: null };
      }
      if (parts[0] === 'persona' && parts[1]) {
        let personId = parts[1];
        try {
          personId = decodeURIComponent(parts[1]);
        } catch (error) {
          personId = parts[1];
        }
        return { name: 'person', assetId: null, personId, section: null };
      }
      if (parts[0] === 'activo' && parts[1]) {
        let assetId = parts[1];
        try {
          assetId = decodeURIComponent(parts[1]);
        } catch (error) {
          assetId = parts[1];
        }
        return { name: 'detail', assetId, personId: null, section: null };
      }
      return { name: this.authenticated ? 'panel' : 'login', assetId: null, personId: null, section: null };
    },
    openDocuments(kind, ids) {
      this.documentContext = { ids: Array.isArray(ids) ? ids.slice() : [], category: this.prefs.category || 'all', site: this.prefs.site || 'all', search: this.prefs.search || '' };
      if (this.documentContext.ids.length) Object.assign(this.documentContext, { category: 'all', site: 'all', search: '' });
      this.documentContext.workspaceFresh = true;
      this.setHash(kind === 'labels' ? '#/etiquetas' : '#/reportes');
    },
    openReportAsset(id) { this.setHash('#/reporte/' + encodeURIComponent(id)); },
    hashFor(route) {
      if (route.name === 'help') return '#/ayuda';
      if (route.name === 'reports') return '#/reportes';
      if (route.name === 'warranties') return '#/garantias';
      if (route.name === 'labels') return '#/etiquetas';
      if (route.name === 'extension' && route.extensionId && route.pageId) {
        return '#/extensiones/' + encodeURIComponent(route.extensionId) + '/' + encodeURIComponent(route.pageId);
      }
      if (route.name === 'reportAsset') {
        const base = '#/reporte/' + encodeURIComponent(route.assetId) + (route.section === 'publico' ? '/publico' : '');
        return route.section === 'publico' && route.shareToken ? base + '?share=' + encodeURIComponent(route.shareToken) : base;
      }
      if (route.name === 'panel') return '#/panel';
      if (route.name === 'conversation') return route.assetId ? '#/conversacion/activo/' + encodeURIComponent(route.assetId) : '#/conversacion';
      if (route.name === 'users') return '#/usuarios';
      if (route.name === 'user') return '#/usuario/' + encodeURIComponent(route.userId || '');
      if (route.name === 'denied') return '#/acceso-denegado';
      if (route.name === 'login') return '#/login';
      if (route.name === 'config') {
        const section = CONFIG_SECTIONS.indexOf(route.section) !== -1 ? route.section : 'general';
        const candidateQuery = section === 'extensiones' && route.candidateId ? '?candidato=' + encodeURIComponent(route.candidateId) : '';
        return '#/configuracion/' + section + candidateQuery;
      }
      if (route.name === 'datos') return '#/datos/' + (route.section === 'exportar' ? 'exportar' : 'importar');
      if (route.name === 'maintenance') return '#/mantenimiento';
      if (route.name === 'incident' && route.incidentId) return '#/mantenimiento/incidente/' + encodeURIComponent(route.incidentId);
      if (route.name === 'monitoring') {
        const section = MONITOR_TABS.indexOf(route.section) !== -1 ? route.section : 'estado';
        return section === 'estado' ? '#/supervision' : '#/supervision/' + section;
      }
      if (route.name === 'monitorDevice' && route.assetId) return '#/supervision/activo/' + encodeURIComponent(route.assetId);
      if (route.name === 'monitorAlert' && route.alertId) return '#/supervision/alerta/' + encodeURIComponent(route.alertId);
      if (route.name === 'notifications') return '#/supervision/notificaciones';
      if (route.name === 'people') return '#/personas';
      if (route.name === 'graph' || route.name === 'map') {
        const base = route.name === 'graph' ? '#/infra/grafo' : '#/infra/mapa';
        return route.focusId ? base + '/activo/' + encodeURIComponent(route.focusId) : base;
      }
      if (route.name === 'person' && route.personId) return '#/persona/' + encodeURIComponent(route.personId);
      if (route.name === 'detail' && route.assetId) return '#/activo/' + encodeURIComponent(route.assetId);
      return '#/inventario';
    },
    ensureHash(hash) {
      if (window.location.hash === hash) return;
      try {
        window.history.replaceState(null, '', hash);
      } catch (error) {
        window.location.hash = hash;
      }
    },
    setHash(target) {
      // Views may pass a route object ({ name, assetId, ... }); resolve it like the router does.
      const hash = target && typeof target === 'object' ? this.hashFor(target) : target;
      if (window.location.hash === hash) {
        this.handleHashChange();
      } else {
        window.location.hash = hash;
      }
    },
    assetExists(id) {
      return (this.assets || []).some((asset) => asset.id === id);
    },
    handleHashChange() {
      let parsed = this.parseRoute();
      if (!this.authenticated) {
        if (parsed.name === 'reportAsset' && parsed.section === 'publico' && parsed.shareToken) {
          this.applyRoute(parsed);
          return;
        }
        this.ensureHash('#/login');
        this.applyRoute({ name: 'login', assetId: null, personId: null, section: null });
        return;
      }
      if (parsed.name === 'login') {
        this.ensureHash('#/panel');
        parsed = { name: 'panel', assetId: null, personId: null, section: null };
      }
      if (parsed.name === 'panel' && window.location.hash !== '#/panel') {
        // Unknown or empty hashes fall back to the panel; keep the address bar in sync.
        this.ensureHash('#/panel');
      }
      if (parsed.name === 'detail' && !this.assetExists(parsed.assetId)) {
        this.ensureHash('#/inventario');
        this.showToast(tr('ui.shell.asset_missing'), 'error');
        parsed = { name: 'inventory', assetId: null, personId: null, section: null };
      }
      // Server incident routes are authoritative: the detail view loads the
      // incident from the API instead of checking a local prototype list.
      if (parsed.name === 'incident' && !parsed.incidentId) {
        this.ensureHash('#/mantenimiento');
        parsed = { name: 'maintenance', incidentId: '', assetId: null, personId: null, section: null };
      }
      if (parsed.name === 'person' && !this.serverOrganizationMode && !this.people.some((person) => person.id === parsed.personId)) {
        this.ensureHash('#/personas');
        this.showToast(tr('ui.shell.person_missing'), 'error');
        parsed = { name: 'people', assetId: null, personId: null, section: null };
      }
      if ((parsed.name === 'graph' || parsed.name === 'map') && !this.serverOrganizationMode && parsed.focusId && !this.assets.some((asset) => asset.id === parsed.focusId)) {
        this.ensureHash(this.hashFor({ name: parsed.name }));
        this.showToast(tr('ui.shell.focus_missing'), 'error');
        parsed = { name: parsed.name, assetId: null, personId: null, section: null, focusId: '' };
      }
      // Device and alert routes are server-owned: the route is applied while the
      // canonical detail loads, and only the API's 404 becomes an empty state.
      this.applyRoute(parsed);
    },
    applyRoute(next) {
      next = this.accessRoute(next);
      const previous = this.route.name;
      this.route = next;
      this.mobileNavOpen = false;
      this.userMenuOpen = false;
      this.$nextTick(() => {
        if (next.name === 'inventory' && previous === 'detail') {
          window.scrollTo(0, this.inventoryScrollY);
        } else {
          window.scrollTo(0, 0);
        }
      });
    },
    openAsset(asset) {
      this.recordInventoryScroll();
      this.setHash('#/activo/' + encodeURIComponent(asset.id));
    },
    recordInventoryScroll() {
      if (this.route.name === 'inventory') this.inventoryScrollY = window.scrollY;
    },
    backToInventory() {
      this.setHash('#/inventario');
    },
    setView(view) {
      this.prefs.view = view === 'cards' ? 'cards' : 'table';
    },
    clearFilters() {
      if (this.workspaceInventory) { this.workspaceInventory.status = 'all'; this.workspaceInventory.location = 'all'; }
      this.prefs.search = '';
      this.prefs.category = 'all';
      this.prefs.site = 'all';
    },
    filterFromSidebar(categoryId) {
      this.prefs.category = categoryId;
      this.mobileNavOpen = false;
      if (this.route.name !== 'inventory') {
        this.inventoryScrollY = 0;
        this.setHash('#/inventario');
      }
    },
    categoryLabel(id) {
      const category = this.categories.find((item) => item.id === id);
      return category ? category.label : id;
    },
    siteLabel(id) {
      const site = this.sites.find((item) => item.id === id);
      return site ? site.label : id;
    },
    categoryCount(id) {
      return this.assets.filter((asset) => asset.category === id).length;
    },
    formatCurrency(value) {
      return window.ItsmI18n
        ? window.ItsmI18n.amount(value)
        : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value) || 0);
    },
    copyText(value, message) {
      const text = String(value || '');
      if (!text) return;
      const done = () => this.showToast(message || tr('ui.shell.copied'));
      const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
          if (document.execCommand('copy')) {
            done();
          } else {
            this.showToast(tr('ui.shell.copy_failed'), 'error');
          }
        } catch (error) {
          this.showToast(tr('ui.shell.copy_failed'), 'error');
        }
        document.body.removeChild(area);
      };
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
    },
    updateDocumentTitle() {
      const appName = this.appName || tr('ui.shell.brand');
      // Document titles are composed from catalog entries; no page name is a literal.
      const title = (page) => tr('ui.shell.document_title', { page, app: appName });
      const nested = (section, page) => tr('ui.shell.document_title_nested', { section, page, app: appName });
      const PAGE_KEYS = {
        users: 'ui.page.users', user: 'ui.page.user', denied: 'ui.page.denied', reports: 'ui.page.reports',
        warranties: 'ui.page.warranties', labels: 'ui.page.labels', reportAsset: 'ui.page.report_asset',
        conversation: 'ui.page.conversation', login: 'ui.page.login', extension: 'ui.shell.title_extension',
        datos: 'ui.page.data', people: 'ui.page.people', maintenance: 'ui.shell.title_maintenance',
        monitoring: 'ui.shell.title_monitoring', notifications: 'ui.page.notifications', panel: 'ui.page.panel'
      };
      if (PAGE_KEYS[this.route.name]) {
        document.title = title(tr(PAGE_KEYS[this.route.name]));
      } else if (this.route.name === 'detail' && this.currentAsset) {
        document.title = title(this.currentAsset.name);
      } else if (this.route.name === 'config') {
        document.title = title(this.configSectionLabel || tr('ui.page.settings'));
      } else if (this.route.name === 'graph' || this.route.name === 'map') {
        const focused = this.route.focusId
          ? (this.assets || []).find((asset) => asset.id === this.route.focusId)
          : null;
        const modeLabel = tr(this.route.name === 'map' ? 'ui.shell.mode_map' : 'ui.shell.mode_graph');
        document.title = focused
          ? nested(modeLabel, focused.name)
          : title(tr('ui.shell.title_infrastructure'));
      } else if (this.route.name === 'monitorDevice') {
        const device = (this.assets || []).find((asset) => asset.id === this.route.assetId);
        document.title = nested(tr('ui.nav.monitoring'), device ? device.name : tr('ui.page.device'));
      } else if (this.route.name === 'monitorAlert') {
        const alert = ((this.maintenance || {}).alerts || []).find((item) => item.id === this.route.alertId);
        const alertAsset = alert ? (this.assets || []).find((asset) => asset.id === alert.assetId) : null;
        document.title = nested(tr('ui.nav.monitoring'), alertAsset ? alertAsset.name : tr('ui.page.alert'));
      } else if (this.route.name === 'incident') {
        const incident = ((this.maintenance || {}).incidents || []).find((item) => item.id === this.route.incidentId);
        document.title = title(incident ? incident.title : tr('ui.shell.title_incident'));
      } else if (this.route.name === 'person' && this.currentPerson) {
        document.title = title(this.currentPerson.name);
      } else {
        document.title = title(tr('ui.page.inventory'));
      }
    },
    async submitLoginWithFocus() {
      await this.submitLogin();
      await this.$nextTick(() => {
        const field = this.loginErrors.username ? 'login-user' : this.loginErrors.password ? 'login-password' : null;
        const target = field
          ? document.getElementById(field)
          : document.querySelector('.login-form .form-alert');
        if (target && typeof target.focus === 'function') target.focus();
      });
    },
    validateLoginField(field) {
      if (field === 'username' && !this.loginForm.username.trim()) {
        this.loginErrors.username = 'Introduce tu usuario.';
      } else if (field === 'password' && !this.loginForm.password) {
        this.loginErrors.password = tr('ui.login.error_password_required');
      } else {
        this.loginErrors[field] = '';
      }
    },
    clearLoginError(field) {
      this.loginErrors[field] = '';
      this.loginErrors.general = '';
    },
    openAssetConfig(asset) {
      if (!asset) return;
      this.assetConfig = {
        open: true,
        asset,
        anydeskId: asset.anydeskId || '',
        rmmAgentId: asset.rmmAgentId || ''
      };
      this.assetConfigErrors = { anydeskId: '', rmmAgentId: '', general: '' };
    },
    closeAssetConfig() {
      this.assetConfig.open = false;
    },
    async saveAssetConfig() {
      const dialog = this.assetConfig;
      const anydeskId = dialog.anydeskId.trim();
      const rmmAgentId = dialog.rmmAgentId.trim();
      const errors = { anydeskId: '', rmmAgentId: '', general: '' };
      if (anydeskId && !/^\d{5,12}$/.test(anydeskId)) {
        errors.anydeskId = tr('ui.shell.error_anydesk_id');
      }
      if (rmmAgentId && !/^[A-Za-z0-9._-]{3,64}$/.test(rmmAgentId)) {
        errors.rmmAgentId = tr('ui.shell.error_rmm_id');
      }
      this.assetConfigErrors = errors;
      if (errors.anydeskId || errors.rmmAgentId) return false;
      const asset = dialog.asset;
      if (!asset || !asset.serverAsset || !this.authenticated) {
        errors.general = 'No se ha encontrado el activo en el servidor.';
        return false;
      }
      if (!this.can('assets.edit')) {
        errors.general = 'Tu rol no permite modificar las integraciones del activo.';
        return false;
      }
      const epoch = this.inventory.epoch;
      const current = () => this.authenticated && this.inventory.epoch === epoch && this.assetConfig === dialog;
      try {
        const technical = Object.assign({}, asset.technical || {}, { anydeskId, rmmAgentId });
        const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(asset.id), {
          method: 'PATCH', body: { technical }
        });
        if (!current()) return false;
        const saved = this.inventoryMapAsset(payload);
        if (this.inventoryDetail.asset && this.inventoryDetail.asset.id === asset.id) this.inventoryDetail.asset = saved;
        const index = this.inventory.items.findIndex((item) => item.id === asset.id);
        if (index !== -1) this.inventory.items.splice(index, 1, saved);
        dialog.open = false;
        this.showToast('Integraciones del activo actualizadas.');
        return true;
      } catch (error) {
        if (!current()) return false;
        this.assetConfigErrors.general = (error && error.message) || 'No se pudieron guardar las integraciones del activo.';
        return false;
      }
    },
    openRemote(asset, kind) {
      if (!asset) return;
      if (!this.remoteEnabled(kind)) {
        this.showToast(tr('ui.shell.integration_disabled'), 'error');
        return;
      }
      const id = kind === 'anydesk' ? asset.anydeskId : asset.rmmAgentId;
      if (!id) {
        this.showToast(tr('ui.shell.integration_unconfigured'), 'error');
        return;
      }
      if (this.remoteTimer) {
        window.clearTimeout(this.remoteTimer);
        this.remoteTimer = null;
      }
      this.remoteDialog = { open: true, asset, kind, state: 'idle' };
    },
    closeRemote() {
      if (this.remoteTimer) {
        window.clearTimeout(this.remoteTimer);
        this.remoteTimer = null;
      }
      this.remoteDialog.open = false;
      this.remoteDialog.state = 'idle';
    },
    simulateRemote() {
      if (!this.remoteDialog.open || this.remoteDialog.state === 'connecting') return;
      this.remoteDialog.state = 'connecting';
      this.remoteTimer = window.setTimeout(() => {
        this.remoteTimer = null;
        if (this.remoteDialog.open) this.remoteDialog.state = 'connected';
      }, 900);
    },
    showToast(text, tone) {
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
      this.toast = { text, tone: tone === 'error' ? 'error' : 'success' };
      this.toastTimer = window.setTimeout(() => {
        this.toast.text = '';
        this.toastTimer = null;
      }, 3600);
    },
    handleDocumentPointerDown(event) {
      if (!this.userMenuOpen) return;
      const menu = this.$refs.userMenu;
      if (menu && !menu.contains(event.target)) this.userMenuOpen = false;
    },
    handleGlobalKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (this.authenticated) { event.preventDefault(); this.universalOpen ? this.universalOpen = false : this.openUniversalSearch(); }
        return;
      }
      if (event.key !== 'Escape') return;
      this.universalOpen = false;
      this.userMenuOpen = false;
      this.mobileNavOpen = false;
    }
  };
})();
