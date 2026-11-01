(function () {
  'use strict';

  const Store = window.AssetStore;

  // Visible copy resolves through the shipped runtime so a language switch
  // re-renders the directory without reloading the page.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }
  const KEYS = Store.KEYS;

  function blankPerson() {
    return {
      open: false,
      mode: 'create',
      id: '',
      name: '',
      role: '',
      departmentId: '',
      siteId: '',
      email: '',
      phone: '',
      active: true
    };
  }

  function blankDepartment() {
    return { open: false, mode: 'create', id: '', label: '' };
  }

  function blankAssign() {
    return {
      open: false,
      mode: 'person',
      assetId: '',
      personId: '',
      selectedId: '',
      search: ''
    };
  }

  function labelExists(list, label, ignoredId) {
    const needle = label.toLocaleLowerCase('es');
    return list.some((item) => item.id !== ignoredId && item.label.toLocaleLowerCase('es') === needle);
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  window.AssetPeopleMethods = {
    personById(id) {
      return this.people.find((person) => person.id === id) || null;
    },

    departmentLabel(id) {
      const department = this.departments.find((item) => item.id === id);
      return department ? department.label : tr('ui.people.department_none');
    },

    departmentPeopleCount(id) {
      return this.people.filter((person) => person.departmentId === id).length;
    },

    personAssetCount(id) {
      return this.assets.filter((asset) => asset.assigneeId === id).length;
    },

    personSiteLabel(id) {
      return this.siteLabel(id) || tr('ui.people.site_none');
    },

    activePeopleCount() {
      return this.people.filter((person) => person.active).length;
    },

    peopleWithAssetsCount() {
      return this.people.filter((person) => this.personAssetCount(person.id) > 0).length;
    },

    personInitials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('es');
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toLocaleUpperCase('es');
    },

    personStatusLabel(person) {
      return person && person.active ? tr('ui.people.status_active') : tr('ui.people.status_inactive');
    },

    phoneHref(phone) {
      return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
    },

    assigneePerson(asset) {
      if (!asset) return null;
      return this.personById(asset.assigneeId);
    },

    assigneeLabel(asset) {
      if (!asset) return '';
      const person = this.assigneePerson(asset);
      return person ? person.name : (asset.assignee || '');
    },

    openPeople() {
      this.mobileNavOpen = false;
      this.userMenuOpen = false;
      this.setHash('#/personas');
    },

    openPerson(person) {
      if (!person) return;
      this.setHash('#/persona/' + encodeURIComponent(person.id));
    },

    backToPeople() {
      this.setHash('#/personas');
    },

    clearPeopleFilters() {
      this.prefs.people = {
        search: '',
        site: 'all',
        department: 'all',
        status: 'all'
      };
    },

    setPersonAssetsView(view) {
      this.prefs.personAssetsView = view === 'cards' ? 'cards' : 'table';
    },

    persistPeople() {
      const peopleSaved = Store.writeJSON(window.localStorage, KEYS.people, this.people);
      const assignmentsSaved = Store.writeJSON(window.localStorage, KEYS.assignments, this.assignmentMap());
      if (!peopleSaved || !assignmentsSaved) {
        this.showToast(tr('ui.people.persist_failed'), 'error');
        return false;
      }
      return true;
    },

    assignmentMap() {
      return this.assets.reduce((result, asset) => {
        if (asset.assigneeId) result[asset.id] = asset.assigneeId;
        return result;
      }, {});
    },

    persistAssignments() {
      const saved = Store.writeJSON(window.localStorage, KEYS.assignments, this.assignmentMap());
      if (!saved) this.showToast(tr('ui.people.assignment_save_failed'), 'error');
      return saved;
    },

    uniquePersonId(name) {
      const used = new Set(this.people.map((person) => person.id));
      let base = Store.slugify(name, 'persona');
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      return id;
    },

    uniqueDepartmentId(label) {
      const used = new Set(this.departments.map((department) => department.id));
      let base = Store.slugify(label, 'departamento');
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      return id;
    },

    openPersonDialog(person) {
      if (person) {
        this.personDialog = {
          open: true,
          mode: 'edit',
          id: person.id,
          name: person.name,
          role: person.role || '',
          departmentId: person.departmentId || '',
          siteId: person.siteId || '',
          email: person.email || '',
          phone: person.phone || '',
          active: person.active !== false
        };
      } else {
        this.personDialog = Object.assign(blankPerson(), { open: true });
      }
      this.personErrors = { name: '', role: '', departmentId: '', siteId: '', email: '', phone: '', general: '' };
    },

    closePersonDialog() {
      this.personDialog.open = false;
    },

    validatePersonField(field) {
      const dialog = this.personDialog;
      if (field === 'name') {
        this.personErrors.name = dialog.name.trim() ? '' : tr('ui.people.name_required');
      } else if (field === 'email') {
        const email = dialog.email.trim();
        this.personErrors.email = email && !isValidEmail(email) ? tr('ui.people.email_invalid') : '';
      } else if (field === 'role') {
        this.personErrors.role = dialog.role.trim().length > 80 ? tr('ui.people.name_too_long') : '';
      } else if (field === 'phone') {
        this.personErrors.phone = dialog.phone.trim().length > 40 ? tr('ui.people.phone_too_long') : '';
      }
      this.personErrors.general = '';
    },

    savePerson() {
      const dialog = this.personDialog;
      const name = dialog.name.trim();
      const role = dialog.role.trim();
      const email = dialog.email.trim();
      const phone = dialog.phone.trim();
      const errors = { name: '', role: '', departmentId: '', siteId: '', email: '', phone: '', general: '' };

      if (!name) {
        errors.name = tr('ui.people.name_required');
      } else if (name.length > 80) {
        errors.name = tr('ui.people.name_too_long');
      }
      if (role.length > 80) errors.role = tr('ui.people.name_too_long');
      if (email && !isValidEmail(email)) errors.email = tr('ui.people.email_invalid');
      if (email.length > 120) errors.email = tr('ui.people.email_too_long');
      if (phone.length > 40) errors.phone = tr('ui.people.phone_too_long');
      if (dialog.departmentId && !this.departments.some((item) => item.id === dialog.departmentId)) {
        errors.departmentId = tr('ui.people.department_unavailable');
      }
      if (dialog.siteId && !this.sites.some((item) => item.id === dialog.siteId)) {
        errors.siteId = tr('ui.people.site_unavailable');
      }
      this.personErrors = errors;
      if (errors.name || errors.role || errors.email || errors.phone || errors.departmentId || errors.siteId) return;

      const data = {
        name,
        role,
        departmentId: dialog.departmentId,
        siteId: dialog.siteId,
        email,
        phone,
        active: !!dialog.active
      };

      if (dialog.mode === 'edit') {
        const person = this.personById(dialog.id);
        if (!person) {
          this.personErrors.general = tr('ui.people.person_unavailable');
          return;
        }
        Object.assign(person, data);
        if (!data.active) {
          this.assets.forEach((asset) => {
            if (asset.assigneeId === person.id) asset.assignee = person.name;
          });
        }
      } else {
        const id = this.uniquePersonId(name);
        this.people.push(Object.assign({ id }, data));
      }

      if (!this.persistPeople()) return;
      this.personDialog.open = false;
      this.showToast(tr(dialog.mode === 'edit' ? 'ui.people.person_updated' : 'ui.people.person_created'));
    },

    setPersonActive(person, active) {
      if (!person) return;
      person.active = !!active;
      this.assets.forEach((asset) => {
        if (asset.assigneeId === person.id) asset.assignee = person.name;
      });
      if (this.persistPeople()) {
        this.showToast(tr(person.active ? 'ui.people.person_reactivated' : 'ui.people.person_deactivated'));
      }
    },

    openAssignAsset(asset) {
      if (!asset) return;
      this.assignDialog = {
        open: true,
        mode: 'person',
        assetId: asset.id,
        personId: asset.assigneeId || '',
        selectedId: asset.assigneeId || '',
        search: ''
      };
    },

    openAssignPerson(person) {
      if (!person) return;
      if (!person.active) {
        this.showToast(tr('ui.people.assign_inactive_person'), 'error');
        return;
      }
      this.assignDialog = {
        open: true,
        mode: 'asset',
        assetId: '',
        personId: person.id,
        selectedId: '',
        search: ''
      };
    },

    closeAssignDialog() {
      this.assignDialog = blankAssign();
    },

    selectAssignPerson(id) {
      const person = this.personById(id);
      const currentId = this.assignDialog.mode === 'person' ? this.assignDialog.personId : '';
      if (person && !person.active && person.id !== currentId) return;
      this.assignDialog.selectedId = id || '';
    },

    selectAssignAsset(id) {
      this.assignDialog.selectedId = id || '';
    },

    confirmAssignment() {
      const dialog = this.assignDialog;
      if (dialog.mode === 'person') {
        const asset = this.assets.find((item) => item.id === dialog.assetId);
        if (!asset) {
          this.showToast(tr('ui.people.asset_unavailable'), 'error');
          this.closeAssignDialog();
          return;
        }
        const person = this.personById(dialog.selectedId);
        if (dialog.selectedId && !person) {
          this.showToast(tr('ui.people.person_unavailable'), 'error');
          return;
        }
        if (person && !person.active && person.id !== asset.assigneeId) {
          this.showToast(tr('ui.people.selected_person_inactive'), 'error');
          return;
        }
        asset.assigneeId = person ? person.id : '';
        asset.assignee = person ? person.name : '';
        if (!this.persistAssignments()) return;
        this.closeAssignDialog();
        this.showToast(tr(person ? 'ui.people.assignee_updated' : 'ui.people.asset_unassigned'));
        return;
      }

      const person = this.personById(dialog.personId);
      if (!person || !person.active) {
        this.showToast(tr('ui.people.person_unavailable_or_inactive'), 'error');
        return;
      }
      const asset = this.assets.find((item) => item.id === dialog.selectedId);
      if (!asset) {
        this.showToast(tr('ui.people.select_asset_required'), 'error');
        return;
      }
      asset.assigneeId = person.id;
      asset.assignee = person.name;
      if (!this.persistAssignments()) return;
      this.closeAssignDialog();
      this.showToast(tr('ui.people.assigned_to', { name: person.name }));
    },

    removeAssignment(asset) {
      if (!asset) return;
      asset.assigneeId = '';
      asset.assignee = '';
      if (this.persistAssignments()) this.showToast(tr('ui.people.asset_unassigned'));
    },

    openDepartmentDialog(department) {
      if (department) {
        this.departmentDialog = {
          open: true,
          mode: 'edit',
          id: department.id,
          label: department.label
        };
      } else {
        this.departmentDialog = Object.assign(blankDepartment(), { open: true });
      }
      this.departmentErrors = { label: '', general: '' };
    },

    closeDepartmentDialog() {
      this.departmentDialog.open = false;
    },

    saveDepartment() {
      const label = this.departmentDialog.label.trim();
      const errors = { label: '', general: '' };
      if (!label) {
        errors.label = tr('ui.people.department_name_required');
      } else if (label.length > 48) {
        errors.label = tr('ui.people.department_name_too_long');
      } else if (labelExists(this.departments, label, this.departmentDialog.id)) {
        errors.label = tr('ui.people.department_duplicate');
      }
      this.departmentErrors = errors;
      if (errors.label) return;

      if (this.departmentDialog.mode === 'edit') {
        const department = this.departments.find((item) => item.id === this.departmentDialog.id);
        if (!department) {
          this.departmentErrors.general = tr('ui.people.department_unavailable');
          return;
        }
        department.label = label;
      } else {
        this.departments.push({ id: this.uniqueDepartmentId(label), label });
      }

      if (!this.persistConfig()) return;
      this.departmentDialog.open = false;
      this.showToast(tr(this.departmentDialog.mode === 'edit' ? 'ui.people.department_updated' : 'ui.people.department_created'));
    },

    requestDeleteDepartment(department) {
      // The canonical directory keeps departments for stored people, so an
      // authenticated session deactivates instead of deleting.
      if (this.serverOrganizationMode) {
        const record = this.organizationDepartmentById(department && department.id) || department;
        return this.setOrganizationDepartmentActive(record, record ? record.active === false : true);
      }
      const count = this.departmentPeopleCount(department.id);
      if (count) {
        this.confirmDialog = {
          open: true,
          kind: 'blocked-department',
          title: tr('ui.people.department_in_use_title'),
          message: tr('ui.people.department_in_use_message', { label: department.label, count }),
          detail: tr('ui.people.department_in_use_detail'),
          confirmLabel: '',
          categoryId: '',
          siteId: '',
          locationId: '',
          departmentId: department.id
        };
        return;
      }
      this.confirmDialog = {
        open: true,
        kind: 'delete-department',
        title: tr('ui.people.department_delete_title'),
        message: tr('ui.people.department_delete_message', { label: department.label }),
        detail: tr('ui.people.department_delete_detail'),
        confirmLabel: tr('ui.people.department_delete_title'),
        categoryId: '',
        siteId: '',
        locationId: '',
        departmentId: department.id
      };
    }
  };
})();
