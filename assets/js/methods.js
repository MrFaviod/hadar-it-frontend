(function () {
  'use strict';

  const Store = window.AssetStore;
  const KEYS = Store.KEYS;
  const CONFIG_SECTIONS = ['apariencia', 'general', 'categorias', 'activos', 'sedes', 'personas', 'integraciones', 'relaciones', 'mantenimiento', 'supervision', 'alertas', 'notificaciones', 'mapas', 'datos', 'seguridad', 'reportes', 'garantias', 'qr', 'etiquetas'];
  const MONITOR_TABS = ['estado', 'dispositivos', 'alertas'];

  window.AssetMethods = {
    parseRoute() {
      const raw = window.location.hash.replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
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
        return { name: 'reportAsset', assetId: id, personId: null, section: parts[2] === 'publico' ? 'publico' : null };
      }
      if (parts[0] === 'panel') return { name: 'panel', assetId: null, personId: null, section: null };
      if (parts[0] === 'inventario') return { name: 'inventory', assetId: null, personId: null, section: null };
      if (parts[0] === 'login') return { name: 'login', assetId: null, personId: null, section: null };
      if (parts[0] === 'configuracion') {
        return {
          name: 'config',
          assetId: null,
          personId: null,
          section: CONFIG_SECTIONS.indexOf(parts[1]) !== -1 ? parts[1] : 'general'
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
      if (route.name === 'reports') return '#/reportes';
      if (route.name === 'warranties') return '#/garantias';
      if (route.name === 'labels') return '#/etiquetas';
      if (route.name === 'reportAsset') return '#/reporte/' + encodeURIComponent(route.assetId) + (route.section === 'publico' ? '/publico' : '');
      if (route.name === 'panel') return '#/panel';
      if (route.name === 'users') return '#/usuarios';
      if (route.name === 'user') return '#/usuario/' + encodeURIComponent(route.userId || '');
      if (route.name === 'denied') return '#/acceso-denegado';
      if (route.name === 'login') return '#/login';
      if (route.name === 'config') {
        const section = CONFIG_SECTIONS.indexOf(route.section) !== -1 ? route.section : 'general';
        return '#/configuracion/' + section;
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
    handleHashChange() {
      let parsed = this.parseRoute();
      if (!this.authenticated) {
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
      if (parsed.name === 'detail' && !this.assets.some((asset) => asset.id === parsed.assetId)) {
        this.ensureHash('#/inventario');
        this.showToast('El activo solicitado ya no está disponible.', 'error');
        parsed = { name: 'inventory', assetId: null, personId: null, section: null };
      }
      if (parsed.name === 'incident') {
        const incidents = (this.maintenance && this.maintenance.incidents) || [];
        if (!incidents.some((incident) => incident.id === parsed.incidentId)) {
          this.ensureHash('#/mantenimiento');
          this.showToast('El incidente solicitado ya no está disponible.', 'error');
          parsed = { name: 'maintenance', incidentId: '', assetId: null, personId: null, section: null };
        }
      }
      if (parsed.name === 'person' && !this.people.some((person) => person.id === parsed.personId)) {
        this.ensureHash('#/personas');
        this.showToast('La persona solicitada ya no está disponible.', 'error');
        parsed = { name: 'people', assetId: null, personId: null, section: null };
      }
      if ((parsed.name === 'graph' || parsed.name === 'map') && parsed.focusId && !this.assets.some((asset) => asset.id === parsed.focusId)) {
        this.ensureHash(this.hashFor({ name: parsed.name }));
        this.showToast('El activo enfocado ya no está disponible.', 'error');
        parsed = { name: parsed.name, assetId: null, personId: null, section: null, focusId: '' };
      }
      if (parsed.name === 'monitorDevice' && !this.assets.some((asset) => asset.id === parsed.assetId)) {
        this.ensureHash('#/supervision');
        this.showToast('El dispositivo solicitado ya no está disponible.', 'error');
        parsed = { name: 'monitoring', assetId: null, personId: null, section: 'dispositivos', incidentId: '', alertId: '' };
      }
      if (parsed.name === 'monitorAlert' && !((this.maintenance && this.maintenance.alerts) || []).some((alert) => alert.id === parsed.alertId)) {
        this.ensureHash('#/supervision/alertas');
        this.showToast('La alerta solicitada ya no está disponible.', 'error');
        parsed = { name: 'monitoring', assetId: null, personId: null, section: 'alertas', incidentId: '', alertId: '' };
      }
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
      return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
      }).format(Number(value) || 0);
    },
    copyText(value, message) {
      const text = String(value || '');
      if (!text) return;
      const done = () => this.showToast(message || 'Texto copiado.');
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
            this.showToast('No se pudo copiar el identificador.', 'error');
          }
        } catch (error) {
          this.showToast('No se pudo copiar el identificador.', 'error');
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
      const appName = this.appName || 'Asset Manager';
      if (this.route.name === 'users' || this.route.name === 'user' || this.route.name === 'denied') {
        document.title = this.pageLabel + ' · ' + appName;
      } else if (['reports', 'warranties', 'labels', 'reportAsset'].includes(this.route.name)) {
        document.title = this.pageLabel + ' · ' + appName;
      } else if (this.route.name === 'login') {
        document.title = 'Acceso · ' + appName;
      } else if (this.route.name === 'detail' && this.currentAsset) {
        document.title = this.currentAsset.name + ' · ' + appName;
      } else if (this.route.name === 'config') {
        document.title = (this.configSectionLabel || 'Configuración') + ' · ' + appName;
      } else if (this.route.name === 'datos') {
        document.title = 'Importar y exportar · ' + appName;
      } else if (this.route.name === 'people') {
        document.title = 'Personas · ' + appName;
      } else if (this.route.name === 'graph' || this.route.name === 'map') {
        const focused = this.route.focusId
          ? (this.assets || []).find((asset) => asset.id === this.route.focusId)
          : null;
        const modeLabel = this.route.name === 'map' ? 'Mapa' : 'Grafo';
        document.title = focused
          ? modeLabel + ' · ' + focused.name + ' · ' + appName
          : 'Explorador de infraestructura · ' + appName;
      } else if (this.route.name === 'maintenance') {
        document.title = 'Mantenimiento e incidentes · ' + appName;
      } else if (this.route.name === 'monitoring') {
        document.title = 'Supervisión de dispositivos · ' + appName;
      } else if (this.route.name === 'monitorDevice') {
        const device = (this.assets || []).find((asset) => asset.id === this.route.assetId);
        document.title = (device ? device.name : 'Dispositivo') + ' · Supervisión · ' + appName;
      } else if (this.route.name === 'monitorAlert') {
        const alert = ((this.maintenance || {}).alerts || []).find((item) => item.id === this.route.alertId);
        const alertAsset = alert ? (this.assets || []).find((asset) => asset.id === alert.assetId) : null;
        document.title = (alertAsset ? alertAsset.name : 'Alerta') + ' · Supervisión · ' + appName;
      } else if (this.route.name === 'notifications') {
        document.title = 'Notificaciones · ' + appName;
      } else if (this.route.name === 'incident') {
        const incident = ((this.maintenance || {}).incidents || []).find((item) => item.id === this.route.incidentId);
        document.title = (incident ? incident.title : 'Incidente') + ' · ' + appName;
      } else if (this.route.name === 'panel') {
        document.title = 'Panel · ' + appName;
      } else if (this.route.name === 'person' && this.currentPerson) {
        document.title = this.currentPerson.name + ' · ' + appName;
      } else {
        document.title = 'Inventario · ' + appName;
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
        this.loginErrors.password = 'Introduce tu contraseña.';
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
    persistOverrides() {
      const map = {};
      this.assets.forEach((asset) => {
        map[asset.id] = {
          anydeskId: asset.anydeskId,
          rmmAgentId: asset.rmmAgentId,
          rmmOnline: asset.rmmOnline
        };
      });
      Store.writeJSON(window.localStorage, KEYS.overrides, map);
    },
    saveAssetConfig() {
      const anydeskId = this.assetConfig.anydeskId.trim();
      const rmmAgentId = this.assetConfig.rmmAgentId.trim();
      const errors = { anydeskId: '', rmmAgentId: '', general: '' };

      if (this.settings.anydeskEnabled && anydeskId && !/^\d{5,12}$/.test(anydeskId)) {
        errors.anydeskId = 'Usa solo números, entre 5 y 12 dígitos.';
      }
      if (this.settings.rmmEnabled && rmmAgentId && !/^[A-Za-z0-9._-]{3,64}$/.test(rmmAgentId)) {
        errors.rmmAgentId = 'Usa entre 3 y 64 caracteres: letras, números, punto, guion o guion bajo.';
      }
      this.assetConfigErrors = errors;
      if (errors.anydeskId || errors.rmmAgentId) return;

      if (!this.assetConfig.asset) {
        this.assetConfigErrors.general = 'No se ha encontrado el activo.';
        return;
      }
      const asset = this.assets.find((item) => item.id === this.assetConfig.asset.id);
      if (!asset) {
        this.assetConfigErrors.general = 'No se ha encontrado el activo.';
        return;
      }
      asset.anydeskId = anydeskId;
      asset.rmmAgentId = rmmAgentId;
      asset.rmmOnline = rmmAgentId ? !!asset.rmmOnline : false;
      this.persistOverrides();
      this.assetConfig.open = false;
      this.showToast('Integraciones del activo actualizadas.');
    },
    openRemote(asset, kind) {
      if (!asset) return;
      if (!this.remoteEnabled(kind)) {
        this.showToast('Esta integración está desactivada en Configuración.', 'error');
        return;
      }
      const id = kind === 'anydesk' ? asset.anydeskId : asset.rmmAgentId;
      if (!id) {
        this.showToast('Configura primero el identificador de esta integración.', 'error');
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
