(function () {
  'use strict';

  const Store = window.AssetStore;

  // Visible copy resolves through the shipped runtime so a language switch
  // re-renders the configuration dialogs without reloading the page.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

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
      if (!saved) this.showToast(tr('ui.config.persist_failed'), 'error');
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
      if (!asset) return tr('ui.config.location_none');
      const site = this.config.sites.find((item) => item.id === asset.site);
      if (site && asset.locationId) {
        const location = site.locations.find((item) => item.id === asset.locationId);
        if (location) return location.label;
      }
      return asset.location || tr('ui.config.location_none');
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
        onError(tr('ui.config.image_format'));
        return;
      }
      if (file.size > 1024 * 1024) {
        onError(tr('ui.config.image_too_large'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => onLoad(String(reader.result || ''));
      reader.onerror = () => onError(tr('ui.config.image_read_failed'));
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
        errors.label = tr('ui.config.category_name_required');
      } else if (label.length > 40) {
        errors.label = tr('ui.config.category_name_too_long');
      } else if (labelExists(this.config.categories, label, this.categoryDialog.id)) {
        errors.label = tr('ui.config.category_duplicate');
      }
      if (description.length > 160) errors.description = tr('ui.config.category_description_too_long');
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
          this.categoryErrors.general = tr('ui.config.category_unavailable');
          return;
        }
        Object.assign(category, data);
      } else {
        const id = this.uniqueCategoryId(label);
        this.config.categories.push(Object.assign({ id, slug: id }, data));
      }

      if (!this.persistConfig()) return;
      this.categoryDialog.open = false;
      this.showToast(tr(this.categoryDialog.mode === 'edit' ? 'ui.config.category_updated' : 'ui.config.category_created'));
    },

    requestDeleteCategory(category) {
      const count = this.categoryCount(category.id);
      if (count) {
        this.confirmDialog = Object.assign(blankConfirm(), {
          open: true,
          kind: 'blocked-category',
          title: tr('ui.config.category_in_use_title'),
          message: tr('ui.config.category_in_use_message', { label: category.label, count }),
          detail: tr('ui.config.category_in_use_detail'),
          confirmLabel: ''
        });
        return;
      }
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-category',
        title: tr('ui.config.category_delete_title'),
        message: tr('ui.config.category_delete_message', { label: category.label }),
        detail: tr('ui.config.category_delete_detail'),
        confirmLabel: tr('ui.config.category_delete_title'),
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
        errors.label = tr('ui.config.site_name_required');
      } else if (label.length > 48) {
        errors.label = tr('ui.config.site_name_too_long');
      } else if (labelExists(this.config.sites, label, this.siteDialog.id)) {
        errors.label = tr('ui.config.site_duplicate');
      }
      if (short.length > 24) errors.short = tr('ui.config.short_too_long');
      this.siteErrors = errors;
      if (errors.label || errors.short) return;

      if (this.siteDialog.mode === 'edit') {
        const site = this.config.sites.find((item) => item.id === this.siteDialog.id);
        if (!site) {
          this.siteErrors.general = tr('ui.config.site_unavailable');
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
      this.showToast(tr(this.siteDialog.mode === 'edit' ? 'ui.config.site_updated' : 'ui.config.site_created'));
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
        if (count) pieces.push(tr('ui.config.site_in_use_assets', { count }));
        if (peopleCount) pieces.push(tr('ui.config.site_in_use_people', { count: peopleCount }));
        this.confirmDialog = Object.assign(blankConfirm(), {
          open: true,
          kind: 'blocked-site',
          title: tr('ui.config.site_in_use_title'),
          message: tr('ui.config.site_in_use_message', { label: site.label, records: pieces.join(' y ') }),
          detail: tr('ui.config.site_in_use_detail'),
          confirmLabel: ''
        });
        return;
      }
      const locationCount = site.locations.length;
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-site',
        title: tr('ui.config.site_delete_title'),
        message: tr('ui.config.site_delete_message', { label: site.label }),
        detail: locationCount
          ? tr('ui.config.site_delete_locations', { count: locationCount })
          : tr('ui.config.site_delete_detail'),
        confirmLabel: tr('ui.config.site_delete_title'),
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
        this.locationErrors = { label: '', general: tr('ui.config.site_unavailable') };
        return;
      }
      if (!label) {
        errors.label = tr('ui.config.location_name_required');
      } else if (label.length > 48) {
        errors.label = tr('ui.config.location_name_too_long');
      } else if (labelExists(site.locations, label, this.locationDialog.id)) {
        errors.label = tr('ui.config.location_duplicate');
      }
      this.locationErrors = errors;
      if (errors.label) return;

      if (this.locationDialog.id) {
        const location = site.locations.find((item) => item.id === this.locationDialog.id);
        if (!location) {
          this.locationErrors.general = tr('ui.config.location_unavailable');
          return;
        }
        location.label = label;
      } else {
        site.locations.push({ id: this.uniqueLocationId(site, label), label });
      }

      if (!this.persistConfig()) return;
      this.locationDialog.open = false;
      this.showToast(tr(this.locationDialog.id ? 'ui.config.location_updated' : 'ui.config.location_created'));
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
          title: tr('ui.config.location_in_use_title'),
          message: tr('ui.config.location_in_use_message', { label: location.label, count }),
          detail: tr('ui.config.location_in_use_detail'),
          confirmLabel: ''
        });
        return;
      }
      this.confirmDialog = Object.assign(blankConfirm(), {
        open: true,
        kind: 'delete-location',
        title: tr('ui.config.location_delete_title'),
        message: tr('ui.config.location_delete_message', { label: location.label, site: site.label }),
        detail: tr('ui.config.location_delete_detail'),
        confirmLabel: tr('ui.config.location_delete_title'),
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
        this.showToast(tr('ui.config.category_deleted'));
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
        this.showToast(tr('ui.config.site_deleted'));
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
        this.showToast(tr('ui.config.location_deleted'));
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
        this.showToast(tr('ui.config.department_deleted'));
      }
    },

    async saveIntegrations() {
      const errors = { anydesk: '', rmm: '', general: '' };
      const next = {};
      this.integrationDefinitions.forEach((definition) => {
        const draft = this.integrationDraft[definition.id] || { enabled: false, url: '' };
        const url = (draft.url || '').trim();
        if (draft.enabled && !url) {
          errors[definition.id] = tr('ui.config.integration_url_required', { name: definition.name });
        } else if (draft.enabled && url && !Store.isHttpUrl(url)) {
          errors[definition.id] = tr('ui.config.integration_url_invalid');
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
        this.integrationErrors.general = result && result.error || tr('ui.config.integrations_save_failed');
        return;
      }
      this.integrationDraft = Store.clone(this.config.integrations);
      this.showToast(tr('ui.config.integrations_updated'));
    }
  };
})();
