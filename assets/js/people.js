(function () {
  'use strict';

  const Store = window.AssetStore;
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
      return department ? department.label : 'Sin departamento';
    },

    departmentPeopleCount(id) {
      return this.people.filter((person) => person.departmentId === id).length;
    },

    personAssetCount(id) {
      return this.assets.filter((asset) => asset.assigneeId === id).length;
    },

    personSiteLabel(id) {
      return this.siteLabel(id) || 'Sin sede';
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
      return person && person.active ? 'Activa' : 'Inactiva';
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
        this.showToast('No se pudieron guardar las personas en este navegador.', 'error');
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
      if (!saved) this.showToast('No se pudo guardar la asignación.', 'error');
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
        this.personErrors.name = dialog.name.trim() ? '' : 'Introduce el nombre de la persona.';
      } else if (field === 'email') {
        const email = dialog.email.trim();
        this.personErrors.email = email && !isValidEmail(email) ? 'Introduce un correo válido.' : '';
      } else if (field === 'role') {
        this.personErrors.role = dialog.role.trim().length > 80 ? 'Usa un máximo de 80 caracteres.' : '';
      } else if (field === 'phone') {
        this.personErrors.phone = dialog.phone.trim().length > 40 ? 'Usa un máximo de 40 caracteres.' : '';
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
        errors.name = 'Introduce el nombre de la persona.';
      } else if (name.length > 80) {
        errors.name = 'Usa un máximo de 80 caracteres.';
      }
      if (role.length > 80) errors.role = 'Usa un máximo de 80 caracteres.';
      if (email && !isValidEmail(email)) errors.email = 'Introduce un correo válido.';
      if (email.length > 120) errors.email = 'Usa un máximo de 120 caracteres.';
      if (phone.length > 40) errors.phone = 'Usa un máximo de 40 caracteres.';
      if (dialog.departmentId && !this.departments.some((item) => item.id === dialog.departmentId)) {
        errors.departmentId = 'El departamento ya no está disponible.';
      }
      if (dialog.siteId && !this.sites.some((item) => item.id === dialog.siteId)) {
        errors.siteId = 'La sede ya no está disponible.';
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
          this.personErrors.general = 'La persona ya no está disponible.';
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
      this.showToast(dialog.mode === 'edit' ? 'Persona actualizada.' : 'Persona creada.');
    },

    setPersonActive(person, active) {
      if (!person) return;
      person.active = !!active;
      this.assets.forEach((asset) => {
        if (asset.assigneeId === person.id) asset.assignee = person.name;
      });
      if (this.persistPeople()) {
        this.showToast(person.active ? 'Persona reactivada.' : 'Persona desactivada.');
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
        this.showToast('Reactiva la persona antes de asignarle activos.', 'error');
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
          this.showToast('El activo ya no está disponible.', 'error');
          this.closeAssignDialog();
          return;
        }
        const person = this.personById(dialog.selectedId);
        if (dialog.selectedId && !person) {
          this.showToast('La persona ya no está disponible.', 'error');
          return;
        }
        if (person && !person.active && person.id !== asset.assigneeId) {
          this.showToast('La persona seleccionada está inactiva.', 'error');
          return;
        }
        asset.assigneeId = person ? person.id : '';
        asset.assignee = person ? person.name : '';
        if (!this.persistAssignments()) return;
        this.closeAssignDialog();
        this.showToast(person ? 'Responsable actualizado.' : 'Activo sin responsable.');
        return;
      }

      const person = this.personById(dialog.personId);
      if (!person || !person.active) {
        this.showToast('La persona ya no está disponible o está inactiva.', 'error');
        return;
      }
      const asset = this.assets.find((item) => item.id === dialog.selectedId);
      if (!asset) {
        this.showToast('Selecciona un activo para asignar.', 'error');
        return;
      }
      asset.assigneeId = person.id;
      asset.assignee = person.name;
      if (!this.persistAssignments()) return;
      this.closeAssignDialog();
      this.showToast('Activo asignado a ' + person.name + '.');
    },

    removeAssignment(asset) {
      if (!asset) return;
      asset.assigneeId = '';
      asset.assignee = '';
      if (this.persistAssignments()) this.showToast('Activo sin responsable.');
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
        errors.label = 'Introduce un nombre para el departamento.';
      } else if (label.length > 48) {
        errors.label = 'Usa un máximo de 48 caracteres.';
      } else if (labelExists(this.departments, label, this.departmentDialog.id)) {
        errors.label = 'Ya existe un departamento con ese nombre.';
      }
      this.departmentErrors = errors;
      if (errors.label) return;

      if (this.departmentDialog.mode === 'edit') {
        const department = this.departments.find((item) => item.id === this.departmentDialog.id);
        if (!department) {
          this.departmentErrors.general = 'El departamento ya no está disponible.';
          return;
        }
        department.label = label;
      } else {
        this.departments.push({ id: this.uniqueDepartmentId(label), label });
      }

      if (!this.persistConfig()) return;
      this.departmentDialog.open = false;
      this.showToast(this.departmentDialog.mode === 'edit' ? 'Departamento actualizado.' : 'Departamento creado.');
    },

    requestDeleteDepartment(department) {
      const count = this.departmentPeopleCount(department.id);
      if (count) {
        this.confirmDialog = {
          open: true,
          kind: 'blocked-department',
          title: 'Departamento en uso',
          message: '“' + department.label + '” tiene ' + count + (count === 1 ? ' persona asociada.' : ' personas asociadas.'),
          detail: 'Reasigna esas personas a otro departamento antes de eliminarlo.',
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
        title: 'Eliminar departamento',
        message: '¿Eliminar “' + department.label + '”?',
        detail: 'No tiene personas asociadas. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar departamento',
        categoryId: '',
        siteId: '',
        locationId: '',
        departmentId: department.id
      };
    }
  };
})();
