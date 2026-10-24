(function () {
  'use strict';

  const Store = window.AssetStore;

  function blankConfirm() {
    return {
      open: false,
      kind: '',
      title: '',
      message: '',
      detail: '',
      confirmLabel: '',
      fieldKey: '',
      statusId: '',
      categoryId: '',
      siteId: '',
      locationId: '',
      departmentId: ''
    };
  }

  function labelExists(list, label, ignoredId) {
    const needle = label.toLocaleLowerCase('es');
    return list.some((item) => item.id !== ignoredId && item.label.toLocaleLowerCase('es') === needle);
  }

  window.AssetConfigMethods = {
    goToConfig(section) {
      const target = this.configSections.some((item) => item.id === section) ? section : 'general';
      this.mobileNavOpen = false;
      this.userMenuOpen = false;
      this.setHash('#/configuracion/' + target);
    },

    persistConfig() {
      const saved = Store.writeJSON(window.localStorage, Store.KEYS.config, this.config);
      if (!saved) this.showToast('No se pudo guardar la configuración en este navegador.', 'error');
      return saved;
    },

    uniqueCategoryId(label) {
      const used = new Set(this.config.categories.map((category) => category.id));
      let base = Store.slugify(label, 'categoria');
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      return id;
    },

    uniqueSiteId(label) {
      const used = new Set(this.config.sites.map((site) => site.id));
      let base = Store.slugify(label, 'sede');
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      return id;
    },

    uniqueLocationId(site, label) {
      const used = new Set(site.locations.map((location) => location.id));
      let base = Store.slugify(label, 'ubicacion');
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      return id;
    },

    assetImage(asset) {
      if (!asset) return 'assets/svg/devices/other.svg';
      if (asset.hasOwnImage && asset.image) return asset.image;
      const category = this.config.categories.find((item) => item.id === asset.category);
      return category && category.image ? category.image : (asset.image || 'assets/svg/devices/other.svg');
    },

    locationLabel(asset) {
      if (!asset) return 'Sin ubicación';
      const site = this.config.sites.find((item) => item.id === asset.site);
      if (site && asset.locationId) {
        const location = site.locations.find((item) => item.id === asset.locationId);
        if (location) return location.label;
      }
      return asset.location || 'Sin ubicación';
    },

    siteLocationCount(siteId) {
      const site = this.config.sites.find((item) => item.id === siteId);
      return site ? site.locations.length : 0;
    },

    siteAssetCount(siteId) {
      return this.assets.filter((asset) => asset.site === siteId).length;
    },

    locationAssetCount(siteId, locationId) {
      return this.assets.filter((asset) => asset.site === siteId && asset.locationId === locationId).length;
    },

    integrationById(id) {
      return this.integrationDefinitions.find((item) => item.id === id);
    },

    integrationUsage(id) {
      const field = id === 'anydesk' ? 'anydeskId' : 'rmmAgentId';
      return this.assets.filter((asset) => !!asset[field]).length;
    },

    remoteEnabled(kind) {
      const integration = this.config.integrations[kind];
      return !!(integration && integration.enabled);
    },

    assetHasRemote(asset) {
      if (!asset) return false;
      return (this.remoteEnabled('anydesk') && !!asset.anydeskId) ||
        (this.remoteEnabled('rmm') && !!asset.rmmAgentId);
    },

    assetRemoteCount(asset) {
      if (!asset) return 0;
      return (this.remoteEnabled('anydesk') && asset.anydeskId ? 1 : 0) +
        (this.remoteEnabled('rmm') && asset.rmmAgentId ? 1 : 0);
    },


    readImageFile(file, onLoad, onError) {
      if (!file) return;
      if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type)) {
        onError('Usa una imagen PNG, JPG, WebP, GIF o SVG.');
        return;
      }
      if (file.size > 1024 * 1024) {
        onError('La imagen no puede superar 1 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => onLoad(String(reader.result || ''));
      reader.onerror = () => onError('No se pudo leer la imagen. Inténtalo de nuevo.');
      reader.readAsDataURL(file);
    },


    handleCategoryImageUpload(event) {
      const file = event.target.files && event.target.files[0];
      this.readImageFile(file, (dataUrl) => {
        this.categoryDialog.image = dataUrl;
        this.categoryErrors.image = '';
      }, (message) => {
        this.categoryErrors.image = message;
      });
      event.target.value = '';
    },

    applyImagePreset(preset) {
      this.categoryDialog.image = preset.src;
      this.categoryDialog.icon = preset.icon;
      this.categoryErrors.image = '';
    },

    openCategoryDialog(category) {
      if (category) {
        this.categoryDialog = {
          open: true,
          mode: 'edit',
          id: category.id,
          label: category.label,
          description: category.description || '',
          image: category.image || 'assets/svg/devices/other.svg',
          icon: category.icon || 'package'
        };
      } else {
        this.categoryDialog = {
          open: true,
          mode: 'create',
          id: '',
          label: '',
          description: '',
          image: 'assets/svg/devices/other.svg',
          icon: 'package'
        };
      }
      this.categoryErrors = { label: '', description: '', image: '', general: '' };
    },

    closeCategoryDialog() {
      this.categoryDialog.open = false;
    },

    saveCategory() {
      const label = this.categoryDialog.label.trim();
      const description = this.categoryDialog.description.trim();
      const errors = { label: '', description: '', image: '', general: '' };

      if (!label) {
        errors.label = 'Introduce un nombre para la categoría.';
      } else if (label.length > 40) {
        errors.label = 'Usa un máximo de 40 caracteres.';
      } else if (labelExists(this.config.categories, label, this.categoryDialog.id)) {
        errors.label = 'Ya existe una categoría con ese nombre.';
      }
      if (description.length > 160) errors.description = 'La descripción no puede superar 160 caracteres.';
      this.categoryErrors = errors;
      if (errors.label || errors.description) return;

      const data = {
        label,
        description,
        image: this.categoryDialog.image || 'assets/svg/devices/other.svg',
        icon: this.categoryDialog.icon || 'package'
      };

      if (this.categoryDialog.mode === 'edit') {
        const category = this.config.categories.find((item) => item.id === this.categoryDialog.id);
        if (!category) {
          this.categoryErrors.general = 'La categoría ya no está disponible.';
          return;
        }
        Object.assign(category, data);
      } else {
        const id = this.uniqueCategoryId(label);
        this.config.categories.push(Object.assign({ id, slug: id }, data));
      }

      if (!this.persistConfig()) return;
      this.categoryDialog.open = false;
      this.showToast(this.categoryDialog.mode === 'edit' ? 'Categoría actualizada.' : 'Categoría creada.');
    },

    requestDeleteCategory(category) {
      const count = this.categoryCount(category.id);
      if (count) {
        this.confirmDialog = Object.assign(blankConfirm(), {
          open: true,
          kind: 'blocked-category',
          title: 'Categoría en uso',
          message: '“' + category.label + '” está asignada a ' + count + (count === 1 ? ' activo.' : ' activos.'),
          detail: 'Reasigna esos activos a otra categoría antes de eliminarla.',
          confirmLabel: ''
        });
        return;
      }
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-category',
        title: 'Eliminar categoría',
        message: '¿Eliminar “' + category.label + '”?',
        detail: 'No hay activos asociados. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar categoría',
        categoryId: category.id
      });
    },

    openSiteDialog(site) {
      if (this.serverOrganizationMode) {
        const record = site ? this.organizationLocationById(site.id) : null;
        return this.openOrganizationLocationDialog({ level: 'site', location: record });
      }
      if (site) {
        this.siteDialog = {
          open: true,
          mode: 'edit',
          id: site.id,
          label: site.label,
          short: site.short || ''
        };
      } else {
        this.siteDialog = { open: true, mode: 'create', id: '', label: '', short: '' };
      }
      this.siteErrors = { label: '', short: '', general: '' };
    },

    closeSiteDialog() {
      this.siteDialog.open = false;
    },

    saveSite() {
      // Under server authority the hierarchy dialog is the only writer.
      if (this.serverOrganizationMode) {
        const dialog = this.organization.dialogs.location;
        return dialog.open ? this.saveOrganizationLocationDialog() : this.openOrganizationLocationDialog({ level: 'site' });
      }
      const label = this.siteDialog.label.trim();
      const short = this.siteDialog.short.trim();
      const errors = { label: '', short: '', general: '' };

      if (!label) {
        errors.label = 'Introduce un nombre para la sede.';
      } else if (label.length > 48) {
        errors.label = 'Usa un máximo de 48 caracteres.';
      } else if (labelExists(this.config.sites, label, this.siteDialog.id)) {
        errors.label = 'Ya existe una sede con ese nombre.';
      }
      if (short.length > 24) errors.short = 'Usa un máximo de 24 caracteres.';
      this.siteErrors = errors;
      if (errors.label || errors.short) return;

      if (this.siteDialog.mode === 'edit') {
        const site = this.config.sites.find((item) => item.id === this.siteDialog.id);
        if (!site) {
          this.siteErrors.general = 'La sede ya no está disponible.';
          return;
        }
        site.label = label;
        site.short = short || label;
      } else {
        const id = this.uniqueSiteId(label);
        this.config.sites.push({ id, label, short: short || label, locations: [] });
      }

      if (!this.persistConfig()) return;
      this.siteDialog.open = false;
      this.showToast(this.siteDialog.mode === 'edit' ? 'Sede actualizada.' : 'Sede creada.');
    },

    requestDeleteSite(site) {
      // The canonical API never deletes a location: it deactivates it so stored
      // assets and history keep a resolvable reference.
      if (this.serverOrganizationMode) {
        const record = this.organizationLocationById(site && site.id);
        return this.setOrganizationLocationActive(record, record ? record.active === false : true);
      }
      const count = this.siteAssetCount(site.id);
      const peopleCount = this.people.filter((person) => person.siteId === site.id).length;
      if (count || peopleCount) {
        const pieces = [];
        if (count) pieces.push(count + (count === 1 ? ' activo asignado' : ' activos asignados'));
        if (peopleCount) pieces.push(peopleCount + (peopleCount === 1 ? ' persona asociada' : ' personas asociadas'));
        this.confirmDialog = Object.assign(blankConfirm(), {
          open: true,
          kind: 'blocked-site',
          title: 'Sede en uso',
          message: '“' + site.label + '” tiene ' + pieces.join(' y ') + '.',
          detail: 'Reasigna esos registros a otra sede antes de eliminarla.',
          confirmLabel: ''
        });
        return;
      }
      const locationCount = site.locations.length;
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-site',
        title: 'Eliminar sede',
        message: '¿Eliminar “' + site.label + '”?',
        detail: locationCount
          ? 'También se eliminarán sus ' + locationCount + (locationCount === 1 ? ' ubicación.' : ' ubicaciones.')
          : 'No tiene ubicaciones ni activos asociados. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar sede',
        siteId: site.id
      });
    },

    openLocationDialog(site, location) {
      if (this.serverOrganizationMode) {
        const record = location ? this.organizationLocationById(location.id) : null;
        return this.openOrganizationLocationDialog({ level: 'building', parentId: site && site.id, location: record });
      }
      if (!site) return;
      if (location) {
        this.locationDialog = {
          open: true,
          siteId: site.id,
          id: location.id,
          label: location.label
        };
      } else {
        this.locationDialog = { open: true, siteId: site.id, id: '', label: '' };
      }
      this.locationErrors = { label: '', general: '' };
    },

    closeLocationDialog() {
      this.locationDialog.open = false;
    },

    saveLocation() {
      if (this.serverOrganizationMode) {
        const dialog = this.organization.dialogs.location;
        return dialog.open ? this.saveOrganizationLocationDialog() : this.openOrganizationLocationDialog({ level: 'building' });
      }
      const site = this.config.sites.find((item) => item.id === this.locationDialog.siteId);
      const label = this.locationDialog.label.trim();
      const errors = { label: '', general: '' };
      if (!site) {
        this.locationErrors = { label: '', general: 'La sede ya no está disponible.' };
        return;
      }
      if (!label) {
        errors.label = 'Introduce un nombre para la ubicación.';
      } else if (label.length > 48) {
        errors.label = 'Usa un máximo de 48 caracteres.';
      } else if (labelExists(site.locations, label, this.locationDialog.id)) {
        errors.label = 'Ya existe una ubicación con ese nombre en esta sede.';
      }
      this.locationErrors = errors;
      if (errors.label) return;

      if (this.locationDialog.id) {
        const location = site.locations.find((item) => item.id === this.locationDialog.id);
        if (!location) {
          this.locationErrors.general = 'La ubicación ya no está disponible.';
          return;
        }
        location.label = label;
      } else {
        site.locations.push({ id: this.uniqueLocationId(site, label), label });
      }

      if (!this.persistConfig()) return;
      this.locationDialog.open = false;
      this.showToast(this.locationDialog.id ? 'Ubicación actualizada.' : 'Ubicación creada.');
    },

    requestDeleteLocation(site, location) {
      if (this.serverOrganizationMode) {
        const record = this.organizationLocationById(location && location.id);
        return this.setOrganizationLocationActive(record, record ? record.active === false : true);
      }
      const count = this.locationAssetCount(site.id, location.id);
      if (count) {
        this.confirmDialog = Object.assign(blankConfirm(), {
          open: true,
          kind: 'blocked-location',
          title: 'Ubicación en uso',
          message: '“' + location.label + '” tiene ' + count + (count === 1 ? ' activo asignado.' : ' activos asignados.'),
          detail: 'Reasigna esos activos a otra ubicación antes de eliminarla.',
          confirmLabel: ''
        });
        return;
      }
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-location',
        title: 'Eliminar ubicación',
        message: '¿Eliminar “' + location.label + '” de ' + site.label + '?',
        detail: 'No tiene activos asociados. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar ubicación',
        siteId: site.id,
        locationId: location.id
      });
    },

    closeConfirm() {
      this.confirmDialog = blankConfirm();
    },

    executeConfirm() {
      if (!this.confirmDialog.confirmLabel) {
        this.closeConfirm();
        return;
      }
      const kind = this.confirmDialog.kind;
      if (this.applyAssetAdminConfirm(kind)) return;
      if (kind === 'delete-category') {
        const index = this.config.categories.findIndex((item) => item.id === this.confirmDialog.categoryId);
        if (index === -1) {
          this.closeConfirm();
          return;
        }
        this.config.categories.splice(index, 1);
        if (this.prefs.category === this.confirmDialog.categoryId) this.prefs.category = 'all';
        if (!this.persistConfig()) return;
        this.closeConfirm();
        this.showToast('Categoría eliminada.');
        return;
      }
      if (kind === 'delete-site') {
        const index = this.config.sites.findIndex((item) => item.id === this.confirmDialog.siteId);
        if (index === -1) {
          this.closeConfirm();
          return;
        }
        this.config.sites.splice(index, 1);
        if (this.prefs.site === this.confirmDialog.siteId) this.prefs.site = 'all';
        if (this.prefs.people.site === this.confirmDialog.siteId) this.prefs.people.site = 'all';
        if (!this.persistConfig()) return;
        this.closeConfirm();
        this.showToast('Sede eliminada.');
        return;
      }
      if (kind === 'delete-location') {
        const site = this.config.sites.find((item) => item.id === this.confirmDialog.siteId);
        if (!site) {
          this.closeConfirm();
          return;
        }
        const index = site.locations.findIndex((item) => item.id === this.confirmDialog.locationId);
        if (index === -1) {
          this.closeConfirm();
          return;
        }
        site.locations.splice(index, 1);
        if (!this.persistConfig()) return;
        this.closeConfirm();
        this.showToast('Ubicación eliminada.');
        return;
      }
      if (kind === 'delete-department') {
        const index = this.config.departments.findIndex((item) => item.id === this.confirmDialog.departmentId);
        if (index === -1) {
          this.closeConfirm();
          return;
        }
        this.config.departments.splice(index, 1);
        if (this.prefs.people.department === this.confirmDialog.departmentId) this.prefs.people.department = 'all';
        if (!this.persistConfig()) return;
        this.closeConfirm();
        this.showToast('Departamento eliminado.');
      }
    },

    async saveIntegrations() {
      const errors = { anydesk: '', rmm: '', general: '' };
      const next = {};
      this.integrationDefinitions.forEach((definition) => {
        const draft = this.integrationDraft[definition.id] || { enabled: false, url: '' };
        const url = (draft.url || '').trim();
        if (draft.enabled && !url) {
          errors[definition.id] = 'Introduce la dirección de ' + definition.name + '.';
        } else if (draft.enabled && url && !Store.isHttpUrl(url)) {
          errors[definition.id] = 'Usa una dirección válida que empiece por http:// o https://.';
        }
        next[definition.id] = { enabled: !!draft.enabled, url };
      });
      this.integrationErrors = errors;
      if (errors.anydesk || errors.rmm) return;
      const result = await this.saveArtifactIntegrations({
        anydeskEnabled: next.anydesk.enabled, anydeskUrl: next.anydesk.url,
        rmmEnabled: next.rmm.enabled, rmmUrl: next.rmm.url
      });
      if (!result || !result.ok) {
        this.integrationErrors.general = result && result.error || 'No se pudieron guardar las integraciones.';
        return;
      }
      this.integrationDraft = Store.clone(this.config.integrations);
      this.showToast('Integraciones actualizadas.');
    }
  };
})();
