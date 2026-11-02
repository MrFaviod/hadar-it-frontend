(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }

  // Non-template copy (validation, toasts) resolves through the same runtime.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const Vue = window.Vue;
  const ModalShell = window.ModalShell;
  const AppIcon = window.AppIcon;

  // The access core is loaded first and owns the single permission catalog.
  const catalog = window.AssetAccess.catalog;

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function appCan(app, permission) {
    return !!(app && typeof app.can === 'function' && app.can(permission));
  }

  function appToast(app, message, tone) {
    if (app && typeof app.showToast === 'function' && message) {
      app.showToast(message, tone || 'success');
    }
  }

  function normalizeResult(result) {
    if (result && typeof result === 'object') {
      return {
        ok: result.ok === true,
        error: result.error || '',
        fieldErrors: result.fieldErrors || {}
      };
    }
    return { ok: result === true, error: '', fieldErrors: {} };
  }

  function dateLabel(value) {
    if (!value) return tr('ui.access.never');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return window.ItsmI18n
      ? window.ItsmI18n.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' })
      : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function roleName(app, id) {
    if (app && typeof app.roleLabel === 'function') return app.roleLabel(id);
    const role = list(app && app.security && app.security.roles).find((item) => item.id === id);
    return role ? role.name : tr('ui.shell.role_none');
  }

  function personName(app, user) {
    if (!user) return tr('ui.access.person_none');
    if (app && typeof app.userPersonLabel === 'function') return app.userPersonLabel(user);
    const person = list(app && app.people).find((item) => item.id === user.personId);
    return person ? person.name : tr('ui.access.person_none');
  }

  function userInitials(app, user) {
    if (app && typeof app.personInitials === 'function') {
      return app.personInitials(user && (user.name || user.username));
    }
    const source = String(user && (user.name || user.username) || '?').trim();
    return source.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
  }

  function userPermissionIds(app, user) {
    if (!user) return [];
    const result = app && typeof app.userPermissions === 'function' ? app.userPermissions(user) : [];
    if (Array.isArray(result)) {
      return result.map((item) => typeof item === 'string' ? item : item && item.id).filter(Boolean);
    }
    if (result && typeof result === 'object') return Object.keys(result).filter((id) => result[id]);
    const role = list(app && app.security && app.security.roles).find((item) => item.id === user.roleId);
    return list(role && role.permissions);
  }

  function permissionIds(value) {
    if (Array.isArray(value)) {
      return value.map((item) => typeof item === 'string' ? item : item && item.id).filter(Boolean);
    }
    if (value && typeof value === 'object') return Object.keys(value).filter((id) => value[id]);
    return [];
  }

  function rolePermissionIds(app, role) {
    if (app && typeof app.userPermissions === 'function') {
      const computed = permissionIds(app.userPermissions({ roleId: role.id }));
      if (computed.length) return computed;
    }
    return permissionIds(role && role.permissions);
  }

  function canAssignRole(app, role) {
    return !!role && rolePermissionIds(app, role).every((permission) => appCan(app, permission));
  }

  function canEditAccount(app, user) {
    const role = list(app && app.security && app.security.roles).find((item) => item.id === (user && user.roleId));
    return appCan(app, 'users.edit') && canAssignRole(app, role);
  }

  function userPath(user) {
    return '#/usuario/' + encodeURIComponent(user.id);
  }

  function goToUser(app, user) {
    if (!user) return;
    if (app && typeof app.openUser === 'function') {
      app.openUser(user);
      return;
    }
    if (app && typeof app.setHash === 'function') {
      app.setHash(userPath(user));
    } else {
      window.location.hash = userPath(user);
    }
  }

  function blankUser(app) {
    const roles = list(app && app.security && app.security.roles);
    return {
      id: '',
      username: '',
      name: '',
      email: '',
      roleId: roles.length ? roles[0].id : '',
      active: true,
      lastAccess: '',
      personId: '',
      password: ''
    };
  }

  function blankRole() {
    return { id: '', name: '', permissions: [] };
  }

  function mergeErrors(target, result) {
    const next = Object.assign({}, target);
    Object.keys(next).forEach((key) => { next[key] = ''; });
    Object.keys(result.fieldErrors || {}).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = result.fieldErrors[key];
    });
    if (result.error && next.general !== undefined) next.general = result.error;
    return next;
  }

  const AccessAccountForm = {
    name: 'AccessAccountForm',
    components: { AppIcon },
    props: {
      app: { type: Object, required: true },
      draft: { type: Object, required: true },
      errors: { type: Object, required: true },
      mode: { type: String, default: 'create' },
      formId: { type: String, default: 'access-account-form' }
    },
    computed: {
      roles() {
        return list(this.app.security && this.app.security.roles);
      },
      roleChoices() {
        return this.roles.filter((role) => canAssignRole(this.app, role) || (this.draft.id && role.id === this.draft.roleId));
      },
      people() {
        const currentId = this.draft.personId || '';
        return list(this.app.people)
          .filter((person) => person.active || person.id === currentId)
          .sort((a, b) => compareText(a.name, b.name, { sensitivity: 'base' }));
      },
      editing() {
        return this.mode === 'edit';
      }
    },
    methods: {
      validate(field) {
        this.$emit('blur', field);
      },
      canAssign(role) {
        return canAssignRole(this.app, role);
      }
    },
    emits: ['submit', 'blur'],
    template: `
      <form :id="formId" class="access-account-form form-stack" novalidate @submit.prevent="$emit('submit')">
        <div v-if="errors.general" class="form-error" role="alert"><app-icon name="alert"></app-icon><p>{{ errors.general }}</p></div>
        <div class="access-form-grid">
          <div class="field" :class="{ 'field--invalid': errors.username }">
            <label for="access-username">{{ $t('ui.access.field_username') }}</label>
            <div class="input-shell input-shell--plain"><app-icon name="user"></app-icon><input id="access-username" v-model.trim="draft.username" type="text" autocomplete="username" maxlength="64" @blur="validate('username')"></div>
            <p v-if="errors.username" class="field__error">{{ errors.username }}</p>
          </div>
          <div class="field" :class="{ 'field--invalid': errors.name }">
            <label for="access-name">{{ $t('ui.access.field_display_name') }}</label>
            <div class="input-shell input-shell--plain"><app-icon name="user"></app-icon><input id="access-name" v-model.trim="draft.name" type="text" autocomplete="name" maxlength="100" @blur="validate('name')"></div>
            <p v-if="errors.name" class="field__error">{{ errors.name }}</p>
          </div>
          <div class="field" :class="{ 'field--invalid': errors.email }">
            <label for="access-email">{{ $t('ui.access.field_email') }} <span class="field__optional">{{ $t('ui.common.optional') }}</span></label>
            <div class="input-shell input-shell--plain"><app-icon name="mail"></app-icon><input id="access-email" v-model.trim="draft.email" type="email" autocomplete="email" maxlength="160" @blur="validate('email')"></div>
            <p v-if="errors.email" class="field__error">{{ errors.email }}</p>
          </div>
          <div class="field" :class="{ 'field--invalid': errors.roleId }">
            <label for="access-role">{{ $t('ui.access.field_role') }}</label>
            <div class="select-field"><app-icon name="shield"></app-icon><select id="access-role" v-model="draft.roleId" @blur="validate('roleId')"><option value="" disabled>{{ $t('ui.access.select_role') }}</option><option v-for="role in roleChoices" :key="role.id" :value="role.id">{{ canAssign(role) ? role.name : $t('ui.access.role_restricted', { name: role.name }) }}</option></select><app-icon name="chevron-down"></app-icon></div>
            <p v-if="errors.roleId" class="field__error">{{ errors.roleId }}</p>
          </div>
          <div class="field" :class="{ 'field--invalid': errors.personId }">
            <label for="access-person">{{ $t('ui.access.field_person') }} <span class="field__optional">{{ $t('ui.common.optional') }}</span></label>
            <div class="select-field"><app-icon name="user"></app-icon><select id="access-person" v-model="draft.personId" @blur="validate('personId')"><option value="">{{ $t('ui.access.person_none') }}</option><option v-for="person in people" :key="person.id" :value="person.id">{{ person.active ? person.name : $t('ui.access.person_inactive', { name: person.name }) }}</option></select><app-icon name="chevron-down"></app-icon></div>
            <p v-if="errors.personId" class="field__error">{{ errors.personId }}</p>
          </div>
          <div class="field" :class="{ 'field--invalid': errors.password }">
            <label for="access-password">{{ $t('ui.access.field_password') }} <span class="field__optional">{{ editing ? $t('ui.common.optional') : $t('ui.common.required') }}</span></label>
            <div class="input-shell input-shell--plain"><app-icon name="lock"></app-icon><input id="access-password" v-model="draft.password" type="password" autocomplete="new-password" maxlength="128" :placeholder="editing ? $t('ui.access.password_keep') : $t('ui.access.password_new')" @blur="validate('password')"></div>
            <p class="field__hint">{{ $t('ui.access.password_hint') }}</p>
            <p v-if="errors.password" class="field__error">{{ errors.password }}</p>
          </div>
        </div>
        <label class="access-active-control">
          <input v-model="draft.active" type="checkbox">
          <span class="access-active-control__box" aria-hidden="true"><app-icon name="check"></app-icon></span>
          <span><strong>{{ $t('ui.access.active_label') }}</strong><small>{{ $t('ui.access.active_hint') }}</small></span>
        </label>
      </form>
    `
  };

  const AccessUsers = {
    name: 'AccessUsers',
    components: { AppIcon, ModalShell, AccessAccountForm },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        dialog: { open: false, mode: 'create' },
        draft: blankUser(this.app),
        errors: { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' },
        saving: false,
        confirm: { open: false, user: null },
        changing: false
      };
    },
    computed: {
      security() { return this.app.security || { users: [], roles: [] }; },
      users() {
        if (Array.isArray(this.app.filteredUsers)) return this.app.filteredUsers;
        const term = String(this.app.userSearch || '').trim().toLocaleLowerCase('es');
        return list(this.security.users).filter((user) => {
          if (this.app.userRoleFilter && this.app.userRoleFilter !== 'all' && user.roleId !== this.app.userRoleFilter) return false;
          if (this.app.userStateFilter === 'active' && !user.active) return false;
          if (this.app.userStateFilter === 'inactive' && user.active) return false;
          return !term || [user.username, user.name, user.email, roleName(this.app, user.roleId), personName(this.app, user)].join(' ').toLocaleLowerCase('es').indexOf(term) !== -1;
        });
      },
      roles() { return list(this.security.roles); },
      totalCount() { return list(this.security.users).length; },
      activeCount() { return list(this.security.users).filter((user) => user.active).length; },
      inactiveCount() { return this.totalCount - this.activeCount; },
      canView() { return appCan(this.app, 'users.view'); },
      canCreate() { return appCan(this.app, 'users.create'); },
      canEdit() { return appCan(this.app, 'users.edit'); }
    },
    watch: {
      'app.authenticated'(value) {
        if (!value) {
          this.dialog.open = false;
          this.confirm.open = false;
        }
      },
      canEdit(value) {
        if (!value) {
          this.dialog.open = false;
          this.confirm.open = false;
        }
      }
    },
    methods: {
      roleLabel(id) { return roleName(this.app, id); },
      personLabel(user) { return personName(this.app, user); },
      initials(user) { return userInitials(this.app, user); },
      lastAccess(value) { return dateLabel(value); },
      userHref(user) { return userPath(user); },
      openDetail(user) { goToUser(this.app, user); },
      clearFilters() {
        if (typeof this.app.clearUserFilters === 'function') this.app.clearUserFilters();
        else {
          this.app.userSearch = '';
          this.app.userRoleFilter = 'all';
          this.app.userStateFilter = 'all';
        }
      },
      openCreate() {
        if (!this.canCreate) return;
        this.dialog = { open: true, mode: 'create' };
        this.draft = blankUser(this.app);
        this.errors = { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' };
      },
      editable(user) { return canEditAccount(this.app, user); },
      openEdit(user) {
        if (!this.editable(user)) return;
        this.dialog = { open: true, mode: 'edit' };
        this.draft = Object.assign(blankUser(this.app), clone(user), { password: '' });
        this.errors = { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' };
      },
      closeDialog() {
        if (this.saving) return;
        this.dialog.open = false;
      },
      validateField(field) {
        const errors = Object.assign({}, this.errors, { general: '' });
        errors[field] = '';
        const value = String(this.draft[field] || '').trim();
        if (field === 'username' && !value) errors.username = tr('ui.access.error_username_required');
        if (field === 'name' && !value) errors.name = tr('ui.access.error_name_required');
        if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.email = tr('ui.access.error_email_invalid');
        if (field === 'roleId' && !this.draft.roleId) errors.roleId = tr('ui.access.error_role_required');
        if (field === 'password' && this.dialog.mode === 'create' && !this.draft.password) errors.password = tr('ui.access.error_password_required');
        this.errors = errors;
      },
      validDraft() {
        ['username', 'name', 'email', 'roleId', 'password'].forEach((field) => this.validateField(field));
        return !this.errors.username && !this.errors.name && !this.errors.email && !this.errors.roleId && !this.errors.password;
      },
      save() {
        if (this.saving || !this.validDraft() || typeof this.app.saveUser !== 'function') return;
        this.saving = true;
        const payload = clone(this.draft);
        const result = this.app.saveUser(payload);
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.saving = false;
          if (!normalized.ok) {
            this.errors = mergeErrors(this.errors, normalized);
            return;
          }
          this.dialog.open = false;
          appToast(this.app, tr(this.dialog.mode === 'create' ? 'ui.access.toast_user_created' : 'ui.access.toast_user_updated'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_save_user') }));
        else finish(result);
      },
      requestDeactivate(user) {
        if (!canEditAccount(this.app, user)) return;
        this.confirm = { open: true, user };
      },
      closeConfirm() {
        if (this.changing) return;
        this.confirm = { open: false, user: null };
      },
      confirmDeactivate() {
        if (!this.confirm.user || this.changing || typeof this.app.setUserActive !== 'function') return;
        this.changing = true;
        const user = this.confirm.user;
        const result = this.app.setUserActive(user, false);
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.changing = false;
          if (!normalized.ok) {
            appToast(this.app, normalized.error || tr('ui.access.error_deactivate'), 'error');
            return;
          }
          this.closeConfirm();
          appToast(this.app, tr('ui.access.toast_deactivated'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_deactivate') }));
        else finish(result);
      },
      activate(user) {
        if (!canEditAccount(this.app, user) || typeof this.app.setUserActive !== 'function') return;
        const result = this.app.setUserActive(user, true);
        const finish = (value) => {
          const normalized = normalizeResult(value);
          if (!normalized.ok) appToast(this.app, normalized.error || tr('ui.access.error_activate'), 'error');
          else appToast(this.app, tr('ui.access.toast_activated'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_activate') }));
        else finish(result);
      }
    },
    template: `
      <section class="page access-page access-users" aria-labelledby="access-users-title">
        <header class="page-head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.access.eyebrow_admin') }}</p>
            <h1 id="access-users-title">{{ $t('ui.nav.users') }}</h1>
            <p class="page-sub">{{ $t('ui.access.lead') }}</p>
          </div>
          <div class="page-head__actions access-page__actions">
            <button v-if="canCreate" type="button" class="btn btn--primary" @click="openCreate"><app-icon name="plus"></app-icon> {{ $t('ui.access.new_user') }}</button>
          </div>
        </header>

        <div class="access-stats" :aria-label="$t('ui.access.stats_aria')">
          <div class="access-stat"><span class="access-stat__icon"><app-icon name="user"></app-icon></span><span><strong>{{ totalCount }}</strong><small>{{ $t('ui.access.stat_total') }}</small></span></div>
          <div class="access-stat"><span class="access-stat__icon access-stat__icon--ok"><app-icon name="check"></app-icon></span><span><strong>{{ activeCount }}</strong><small>{{ $t('ui.access.stat_active') }}</small></span></div>
          <div class="access-stat"><span class="access-stat__icon access-stat__icon--muted"><app-icon name="lock"></app-icon></span><span><strong>{{ inactiveCount }}</strong><small>{{ $t('ui.access.stat_inactive') }}</small></span></div>
        </div>

        <div class="toolbar access-toolbar" :aria-label="$t('ui.access.filters_aria')">
          <label class="search-field"><app-icon name="search"></app-icon><span class="sr-only">{{ $t('ui.access.search_label') }}</span><input v-model="app.userSearch" type="search" :placeholder="$t('ui.access.search_placeholder')"><button v-if="app.userSearch" type="button" class="search-clear" :aria-label="$t('ui.access.search_clear')" @click="app.userSearch = ''"><app-icon name="close"></app-icon></button></label>
          <label class="select-field"><app-icon name="shield"></app-icon><span class="sr-only">{{ $t('ui.access.filter_role') }}</span><select v-model="app.userRoleFilter"><option value="all">{{ $t('ui.access.all_roles') }}</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select><app-icon name="chevron-down"></app-icon></label>
          <label class="select-field"><app-icon name="activity"></app-icon><span class="sr-only">{{ $t('ui.access.filter_state') }}</span><select v-model="app.userStateFilter"><option value="all">{{ $t('ui.shell.filter_all_statuses') }}</option><option value="active">{{ $t('ui.access.stat_active') }}</option><option value="inactive">{{ $t('ui.access.stat_inactive') }}</option></select><app-icon name="chevron-down"></app-icon></label>
          <button v-if="app.userSearch || app.userRoleFilter !== 'all' || app.userStateFilter !== 'all'" type="button" class="btn btn--ghost access-clear" @click="clearFilters"><app-icon name="close"></app-icon> {{ $t('ui.common.clear') }}</button>
        </div>

        <div class="results-bar access-results"><span>{{ $t('ui.access.results_count', { shown: users.length, total: totalCount }) }}</span><span v-if="!canView" class="access-restricted"><app-icon name="lock"></app-icon> {{ $t('ui.access.restricted_short') }}</span></div>

        <section v-if="canView && users.length" class="access-list-panel" :aria-label="$t('ui.access.list_aria')">
          <div class="access-table-wrap">
            <table class="asset-table access-users-table">
              <thead><tr><th scope="col">{{ $t('ui.access.col_user') }}</th><th scope="col">{{ $t('ui.access.field_role') }}</th><th scope="col">{{ $t('ui.access.field_person') }}</th><th scope="col">{{ $t('ui.access.col_last_access') }}</th><th scope="col">{{ $t('ui.people.col_status') }}</th><th scope="col"><span class="sr-only">{{ $t('ui.people.col_actions') }}</span></th></tr></thead>
              <tbody>
                <tr v-for="user in users" :key="user.id" :class="{ 'is-inactive': !user.active }">
                  <td :data-label="$t('ui.access.col_user')"><div class="access-user-cell"><span class="access-avatar" :class="{ 'is-inactive': !user.active }">{{ initials(user) }}</span><span class="access-user-cell__copy"><a class="access-user-cell__name" :href="userHref(user)" @click.prevent="openDetail(user)">{{ user.name || user.username }}</a><small class="mono">{{ user.username }}<span v-if="user.email"> · {{ user.email }}</span></small></span></div></td>
                  <td :data-label="$t('ui.access.field_role')"><span class="access-role-label">{{ roleLabel(user.roleId) }}</span></td>
                  <td :data-label="$t('ui.access.field_person')"><span :class="{ 'cell-muted': !user.personId }">{{ personLabel(user) }}</span></td>
                  <td :data-label="$t('ui.access.col_last_access')"><span class="cell-note">{{ lastAccess(user.lastAccess) }}</span></td>
                  <td :data-label="$t('ui.people.col_status')"><span class="status-pill" :class="user.active ? 'status--ok' : 'status--hold'">{{ $t(user.active ? 'ui.access.status_active' : 'ui.access.status_inactive') }}</span></td>
                  <td :data-label="$t('ui.people.col_actions')" class="access-actions"><div class="quick-actions"><button type="button" class="quick-action" @click="openDetail(user)"><app-icon name="arrow-right"></app-icon><span>{{ $t('ui.people.open_record') }}</span></button><button v-if="editable(user)" type="button" class="quick-action" @click="openEdit(user)"><app-icon name="pencil"></app-icon><span>{{ $t('ui.people.edit') }}</span></button><button v-if="editable(user) && user.active" type="button" class="quick-action quick-action--danger" @click="requestDeactivate(user)"><app-icon name="lock"></app-icon><span>{{ $t('ui.access.deactivate') }}</span></button><button v-if="editable(user) && !user.active" type="button" class="quick-action" @click="activate(user)"><app-icon name="check"></app-icon><span>{{ $t('ui.access.activate') }}</span></button></div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section v-else-if="!canView" class="empty-state access-empty"><span class="empty-state__icon"><app-icon name="lock"></app-icon></span><h2>{{ $t('ui.access.restricted_title') }}</h2><p>{{ $t('ui.access.restricted_body') }}</p></section>
        <section v-else class="empty-state access-empty"><span class="empty-state__icon"><app-icon name="user"></app-icon></span><h2>{{ $t(totalCount ? 'ui.access.empty_no_results' : 'ui.access.empty_no_users') }}</h2><p>{{ $t(totalCount ? 'ui.access.empty_filtered_body' : 'ui.access.empty_body') }}</p><div class="empty-state__actions"><button v-if="totalCount" type="button" class="btn btn--secondary" @click="clearFilters">{{ $t('ui.common.clear_filters') }}</button><button v-if="!totalCount && canCreate" type="button" class="btn btn--primary" @click="openCreate"><app-icon name="plus"></app-icon> {{ $t('ui.access.new_user') }}</button></div></section>

        <modal-shell :open="dialog.open" :title="dialog.mode === 'edit' ? $t('ui.access.edit_user') : $t('ui.access.new_user')" :eyebrow="$t('ui.access.eyebrow_access')" size="wide" @close="closeDialog">
          <access-account-form :app="app" :draft="draft" :errors="errors" :mode="dialog.mode" form-id="access-users-form" @blur="validateField" @submit="save"></access-account-form>
          <template #footer><button type="button" class="btn btn--ghost" @click="closeDialog">{{ $t('ui.common.cancel') }}</button><button type="submit" form="access-users-form" class="btn btn--primary" :disabled="saving"><span v-if="saving" class="spinner" aria-hidden="true"></span><span v-else><app-icon name="check"></app-icon></span>{{ saving ? $t('ui.common.saving') : $t('ui.access.save_user') }}</button></template>
        </modal-shell>

        <modal-shell :open="confirm.open" :title="$t('ui.access.deactivate_title')" :eyebrow="$t('ui.access.confirm_eyebrow')" @close="closeConfirm">
          <div class="access-confirm"><span class="access-confirm__icon"><app-icon name="lock"></app-icon></span><div><p>{{ $t('ui.access.confirm_body', { name: confirm.user && (confirm.user.name || confirm.user.username) }) }}</p><p class="access-confirm__note">{{ $t('ui.access.confirm_note') }}</p></div></div>
          <template #footer><button type="button" class="btn btn--ghost" @click="closeConfirm">{{ $t('ui.common.cancel') }}</button><button type="button" class="btn btn--danger" :disabled="changing" @click="confirmDeactivate">{{ changing ? $t('ui.common.saving') : $t('ui.access.deactivate_confirm') }}</button></template>
        </modal-shell>
      </section>
    `
  };

  const AccessUserDetail = {
    name: 'AccessUserDetail',
    components: { AppIcon, ModalShell, AccessAccountForm },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        dialog: { open: false },
        draft: blankUser(this.app),
        errors: { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' },
        saving: false,
        confirm: { open: false },
        changing: false
      };
    },
    computed: {
      account() {
        if (this.app.currentAccount) return this.app.currentAccount;
        const id = this.app.route && this.app.route.userId;
        return list(this.app.security && this.app.security.users).find((user) => user.id === id) || null;
      },
      roles() { return list(this.app.security && this.app.security.roles); },
      linkedPerson() {
        if (!this.account || !this.account.personId) return null;
        return list(this.app.people).find((person) => person.id === this.account.personId) || null;
      },
      permissionIds() { return userPermissionIds(this.app, this.account); },
      permissionGroups() {
        const ids = this.permissionIds;
        return catalog.map((module) => ({
          module,
          permissions: module.permissions.filter((permission) => ids.indexOf(permission.id) !== -1)
        })).filter((group) => group.permissions.length);
      },
      canView() { return appCan(this.app, 'users.view'); },
      canEdit() { return appCan(this.app, 'users.edit'); },
      canEditTarget() { return !!this.account && canEditAccount(this.app, this.account); }
    },
    watch: {
      'app.route.userId'(value) {
        if (value !== (this.account && this.account.id)) {
          this.dialog.open = false;
          this.confirm.open = false;
        }
      },
      'app.authenticated'(value) {
        if (!value) {
          this.dialog.open = false;
          this.confirm.open = false;
        }
      },
      canEdit(value) {
        if (!value) {
          this.dialog.open = false;
          this.confirm.open = false;
        }
      }
    },
    methods: {
      roleLabel(id) { return roleName(this.app, id); },
      personLabel(user) { return personName(this.app, user); },
      initials(user) { return userInitials(this.app, user); },
      lastAccess(value) { return dateLabel(value); },
      goBack() {
        if (this.app && typeof this.app.openUsers === 'function') this.app.openUsers();
        else if (this.app && typeof this.app.setHash === 'function') this.app.setHash('#/usuarios');
        else window.location.hash = '#/usuarios';
      },
      openEdit() {
        if (!this.canEditTarget) return;
        this.dialog.open = true;
        this.draft = Object.assign(blankUser(this.app), clone(this.account), { password: '' });
        this.errors = { username: '', name: '', email: '', roleId: '', personId: '', password: '', general: '' };
      },
      closeDialog() { if (!this.saving) this.dialog.open = false; },
      validateField(field) {
        const errors = Object.assign({}, this.errors, { general: '' });
        errors[field] = '';
        const value = String(this.draft[field] || '').trim();
        if (field === 'username' && !value) errors.username = tr('ui.access.error_username_required');
        if (field === 'name' && !value) errors.name = tr('ui.access.error_name_required');
        if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.email = tr('ui.access.error_email_invalid');
        if (field === 'roleId' && !this.draft.roleId) errors.roleId = tr('ui.access.error_role_required');
        this.errors = errors;
      },
      validDraft() {
        ['username', 'name', 'email', 'roleId'].forEach((field) => this.validateField(field));
        return !this.errors.username && !this.errors.name && !this.errors.email && !this.errors.roleId;
      },
      save() {
        if (this.saving || !this.validDraft() || typeof this.app.saveUser !== 'function') return;
        this.saving = true;
        const result = this.app.saveUser(clone(this.draft));
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.saving = false;
          if (!normalized.ok) {
            this.errors = mergeErrors(this.errors, normalized);
            return;
          }
          this.dialog.open = false;
          appToast(this.app, tr('ui.access.toast_user_updated'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_save_user') }));
        else finish(result);
      },
      requestDeactivate() {
        if (!this.canEditTarget || !this.account.active) return;
        this.confirm.open = true;
      },
      closeConfirm() { if (!this.changing) this.confirm.open = false; },
      setActive(active) {
        if (!this.canEdit || !this.account || typeof this.app.setUserActive !== 'function') return;
        if (!active) { this.requestDeactivate(); return; }
        this.changeActive(true);
      },
      changeActive(active) {
        if (this.changing || !this.account) return;
        this.changing = true;
        const result = this.app.setUserActive(this.account, active);
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.changing = false;
          if (!normalized.ok) appToast(this.app, normalized.error || tr('ui.access.error_update_account'), 'error');
          else { this.confirm.open = false; appToast(this.app, tr(active ? 'ui.access.toast_activated' : 'ui.access.toast_deactivated')); }
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_update_account') }));
        else finish(result);
      }
    },
    template: `
      <section v-if="account && canView" class="page access-page access-detail" aria-labelledby="access-detail-title">
        <nav class="breadcrumbs" :aria-label="$t('ui.people.breadcrumb_aria')"><a href="#/usuarios" @click.prevent="goBack">{{ $t('ui.nav.users') }}</a><app-icon name="chevron-right"></app-icon><span aria-current="page">{{ account.username }}</span></nav>
        <button type="button" class="back-link" @click="goBack"><app-icon name="arrow-left"></app-icon> {{ $t('ui.access.back_users') }}</button>
        <header class="access-detail-head"><span class="access-avatar access-avatar--xl" :class="{ 'is-inactive': !account.active }">{{ initials(account) }}</span><div class="access-detail-head__copy"><div class="detail-eyebrow"><span class="access-role-label">{{ roleLabel(account.roleId) }}</span><span class="status-pill" :class="account.active ? 'status--ok' : 'status--hold'">{{ $t(account.active ? 'ui.access.status_active' : 'ui.access.status_inactive') }}</span></div><h1 id="access-detail-title">{{ account.name || account.username }}</h1><p class="detail-sub"><span class="mono">{{ account.username }}</span><span v-if="account.email"> · {{ account.email }}</span></p></div><div class="access-detail-head__actions"><button v-if="canEditTarget" type="button" class="btn btn--secondary" @click="openEdit"><app-icon name="pencil"></app-icon> {{ $t('ui.people.edit') }}</button><button v-if="canEditTarget && account.active" type="button" class="btn btn--ghost" @click="requestDeactivate"><app-icon name="lock"></app-icon> {{ $t('ui.access.deactivate') }}</button><button v-if="canEditTarget && !account.active" type="button" class="btn btn--secondary" @click="setActive(true)"><app-icon name="check"></app-icon> {{ $t('ui.access.activate') }}</button></div></header>

        <div class="access-detail-grid"><section class="access-account-card"><header class="panel-head"><div><p class="eyebrow">{{ $t('ui.access.eyebrow_account') }}</p><h2>{{ $t('ui.access.info_title') }}</h2></div></header><dl class="access-facts"><div><dt>{{ $t('ui.access.field_username') }}</dt><dd class="mono">{{ account.username }}</dd></div><div><dt>{{ $t('ui.people.email') }}</dt><dd><a v-if="account.email" :href="'mailto:' + account.email">{{ account.email }}</a><span v-else class="cell-muted">{{ $t('ui.access.not_registered') }}</span></dd></div><div><dt>{{ $t('ui.access.field_person') }}</dt><dd><a v-if="linkedPerson" :href="'#/persona/' + linkedPerson.id">{{ linkedPerson.name }}</a><span v-else class="cell-muted">{{ personLabel(account) }}</span></dd></div><div><dt>{{ $t('ui.access.col_last_access') }}</dt><dd>{{ lastAccess(account.lastAccess) }}</dd></div><div><dt>{{ $t('ui.access.field_role') }}</dt><dd>{{ roleLabel(account.roleId) }}</dd></div></dl></section><section class="access-permissions-card"><header class="panel-head"><div><p class="eyebrow">{{ $t('ui.access.eyebrow_rbac') }}</p><h2>{{ $t('ui.access.permissions_title') }}</h2></div><span class="config-badge"><app-icon name="shield"></app-icon> {{ permissionIds.length }}</span></header><div v-if="permissionGroups.length" class="effective-permissions"><section v-for="group in permissionGroups" :key="group.module.id" class="effective-permission-group"><h3><app-icon :name="group.module.icon"></app-icon>{{ group.module.label }}</h3><div class="effective-permission-list"><span v-for="permission in group.permissions" :key="permission.id" class="permission-chip"><app-icon name="check"></app-icon>{{ permission.label }}</span></div></section></div><p v-else class="access-empty-inline"><app-icon name="info"></app-icon> {{ $t('ui.access.permissions_empty') }}</p></section></div>

        <modal-shell :open="dialog.open" :title="$t('ui.access.edit_user')" :eyebrow="$t('ui.access.eyebrow_access')" size="wide" @close="closeDialog"><access-account-form :app="app" :draft="draft" :errors="errors" mode="edit" form-id="access-detail-form" @blur="validateField" @submit="save"></access-account-form><template #footer><button type="button" class="btn btn--ghost" @click="closeDialog">{{ $t('ui.common.cancel') }}</button><button type="submit" form="access-detail-form" class="btn btn--primary" :disabled="saving"><span v-if="saving" class="spinner" aria-hidden="true"></span><app-icon v-else name="check"></app-icon>{{ saving ? $t('ui.common.saving') : $t('ui.access.save_user') }}</button></template></modal-shell>
        <modal-shell :open="confirm.open" :title="$t('ui.access.deactivate_title')" :eyebrow="$t('ui.access.confirm_eyebrow')" @close="closeConfirm"><div class="access-confirm"><span class="access-confirm__icon"><app-icon name="lock"></app-icon></span><div><p>{{ $t('ui.access.confirm_body', { name: account.name || account.username }) }}</p><p class="access-confirm__note">{{ $t('ui.access.confirm_note') }}</p></div></div><template #footer><button type="button" class="btn btn--ghost" @click="closeConfirm">{{ $t('ui.common.cancel') }}</button><button type="button" class="btn btn--danger" :disabled="changing" @click="changeActive(false)">{{ changing ? $t('ui.common.saving') : $t('ui.access.deactivate_confirm') }}</button></template></modal-shell>
      </section>
      <section v-else class="page access-page access-empty-page"><section class="empty-state access-empty"><span class="empty-state__icon"><app-icon name="lock"></app-icon></span><h2>{{ $t(canView ? 'ui.access.not_found_title' : 'ui.access.restricted_title') }}</h2><p>{{ $t(canView ? 'ui.access.not_found_body' : 'ui.access.restricted_body') }}</p><div v-if="canView" class="empty-state__actions"><button type="button" class="btn btn--secondary" @click="goBack"><app-icon name="arrow-left"></app-icon> {{ $t('ui.access.back_users') }}</button></div></section></section>
    `
  };

  const AccessSecurity = {
    name: 'AccessSecurity',
    components: { AppIcon, ModalShell },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        roleDialog: { open: false, mode: 'create' },
        roleDraft: blankRole(),
        roleErrors: { name: '', permissions: '', general: '' },
        roleSaving: false,
        sessionDraft: Number(this.app.security && this.app.security.sessionMinutes) || 30,
        sessionErrors: { minutes: '', general: '' },
        sessionSaving: false
      };
    },
    computed: {
      security() { return this.app.security || { users: [], roles: [], sessionMinutes: 30 }; },
      catalog() { return catalog; },
      roles() { return list(this.security.roles); },
      canManageRoles() { return appCan(this.app, 'roles.manage'); },
      canManageSessions() { return appCan(this.app, 'sessions.manage'); },
      sessionMinutes() { return Number(this.security.sessionMinutes) || 30; }
    },
    watch: {
      'security.sessionMinutes'(value) {
        if (!this.sessionSaving) this.sessionDraft = Number(value) || 30;
      },
      'app.authenticated'(value) {
        if (!value) this.roleDialog.open = false;
      },
      canManageRoles(value) {
        if (!value) this.roleDialog.open = false;
      }
    },
    methods: {
      canAssign(role) { return canAssignRole(this.app, role); },
      rolePermissionCount(role) { return list(role && role.permissions).length; },
      // Whether a role is a persisted default is server metadata; the browser
      // never infers it from a role id or name.
      isBuiltIn(role) { return !!(role && (role.builtIn === true || role.system === true)); },
      openCreateRole() {
        if (!this.canManageRoles) return;
        this.roleDialog = { open: true, mode: 'create' };
        this.roleDraft = blankRole();
        this.roleErrors = { name: '', permissions: '', general: '' };
      },
      openEditRole(role) {
        if (!this.canManageRoles || !canAssignRole(this.app, role)) return;
        this.roleDialog = { open: true, mode: 'edit' };
        this.roleDraft = Object.assign(blankRole(), clone(role), { permissions: list(role.permissions).slice() });
        this.roleErrors = { name: '', permissions: '', general: '' };
      },
      closeRoleDialog() { if (!this.roleSaving) this.roleDialog.open = false; },
      hasPermission(id) { return list(this.roleDraft.permissions).indexOf(id) !== -1; },
      viewPermission(module) { return module.permissions.find((permission) => permission.id === module.id + '.view'); },
      mutationDisabled(module, permission) {
        const operation = permission.id.split('.').pop();
        return !appCan(this.app, permission.id) || (operation !== 'view' && !!this.viewPermission(module) && !this.hasPermission(module.id + '.view'));
      },
      togglePermission(module, permission, checked) {
        if (!this.canManageRoles || this.mutationDisabled(module, permission)) return;
        const permissions = list(this.roleDraft.permissions).filter((id) => id !== permission.id);
        if (checked) permissions.push(permission.id);
        if (!checked && permission.id === module.id + '.view') {
          module.permissions.forEach((item) => {
            const operation = item.id.split('.').pop();
            if (operation !== 'view') {
              const index = permissions.indexOf(item.id);
              if (index !== -1) permissions.splice(index, 1);
            }
          });
        }
        this.roleDraft.permissions = permissions;
      },
      validateRole() {
        const name = String(this.roleDraft.name || '').trim();
        const duplicate = this.roles.some((role) => role.id !== this.roleDraft.id && String(role.name).trim().toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
        this.roleErrors = { name: !name ? tr('ui.access.error_role_name') : duplicate ? tr('ui.access.error_role_duplicate') : '', permissions: '', general: '' };
        return !this.roleErrors.name;
      },
      saveRole() {
        if (!this.canManageRoles || this.roleSaving || !this.validateRole() || typeof this.app.saveRole !== 'function') return;
        this.roleSaving = true;
        const result = this.app.saveRole(clone(this.roleDraft));
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.roleSaving = false;
          if (!normalized.ok) {
            this.roleErrors = mergeErrors(this.roleErrors, normalized);
            return;
          }
          this.roleDialog.open = false;
          appToast(this.app, tr(this.roleDialog.mode === 'create' ? 'ui.access.toast_role_created' : 'ui.access.toast_role_updated'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_save_role') }));
        else finish(result);
      },
      validateSession() {
        const value = Number(this.sessionDraft);
        this.sessionErrors = { minutes: '', general: '' };
        if (!Number.isFinite(value) || value < 5 || value > 1440) this.sessionErrors.minutes = tr('ui.access.error_session_range');
        return !this.sessionErrors.minutes;
      },
      saveSession() {
        if (!this.canManageSessions || this.sessionSaving || !this.validateSession() || typeof this.app.saveSecurityPreferences !== 'function') return;
        this.sessionSaving = true;
        const result = this.app.saveSecurityPreferences(Number(this.sessionDraft));
        const finish = (value) => {
          const normalized = normalizeResult(value);
          this.sessionSaving = false;
          if (!normalized.ok) {
            this.sessionErrors = mergeErrors(this.sessionErrors, normalized);
            return;
          }
          appToast(this.app, tr('ui.access.toast_session_saved'));
        };
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: tr('ui.access.error_save_prefs') }));
        else finish(result);
      }
    },
    template: `
      <section class="page access-page access-security" aria-labelledby="access-security-title">
        <header class="page-head"><div class="page-head__copy"><p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.nav.settings') }}</p><h1 id="access-security-title">{{ $t('ui.access.security_title') }}</h1><p class="page-sub">{{ $t('ui.access.security_lead') }}</p></div></header>
        <div class="security-layout"><section class="security-card security-roles"><header class="security-card__head"><div><p class="eyebrow">{{ $t('ui.access.eyebrow_rbac') }}</p><h2>{{ $t('ui.access.roles_title') }}</h2><p>{{ $t('ui.access.roles_lead') }}</p></div><button v-if="canManageRoles" type="button" class="btn btn--primary btn--small" @click="openCreateRole"><app-icon name="plus"></app-icon> {{ $t('ui.access.new_role') }}</button></header><div v-if="roles.length" class="role-list"><article v-for="role in roles" :key="role.id" class="role-row"><span class="role-row__icon"><app-icon name="shield"></app-icon></span><div class="role-row__copy"><div><strong>{{ role.name }}</strong><span v-if="isBuiltIn(role)" class="role-badge">{{ $t('ui.access.role_builtin') }}</span></div><small>{{ $t('ui.access.role_meta', { permissions: rolePermissionCount(role), accounts: (security.users || []).filter((user) => user.roleId === role.id).length }) }}</small></div><button v-if="canManageRoles && !isBuiltIn(role) && canAssign(role)" type="button" class="icon-button" :aria-label="$t('ui.access.edit_role_aria', { name: role.name })" @click="openEditRole(role)"><app-icon name="pencil"></app-icon></button></article></div><div v-else class="access-empty-inline"><app-icon name="shield"></app-icon><span>{{ $t('ui.access.roles_empty') }}</span></div></section>
          <section class="security-card security-session"><header class="security-card__head"><div><p class="eyebrow">{{ $t('ui.access.eyebrow_session') }}</p><h2>{{ $t('ui.access.session_title') }}</h2><p>{{ $t('ui.access.session_lead') }}</p></div><span class="config-badge"><app-icon name="lock"></app-icon> {{ $t('ui.access.server_badge') }}</span></header><form class="form-stack" novalidate @submit.prevent="saveSession"><div class="field" :class="{ 'field--invalid': sessionErrors.minutes }"><label for="session-minutes">{{ $t('ui.access.session_field') }}</label><div class="input-with-suffix"><input id="session-minutes" v-model.number="sessionDraft" type="number" min="5" max="1440" step="5" :disabled="!canManageSessions" @blur="validateSession"><span>{{ $t('ui.access.minutes_suffix') }}</span></div><p class="field__hint">{{ $t('ui.access.session_hint') }}</p><p v-if="sessionErrors.minutes" class="field__error">{{ sessionErrors.minutes }}</p><p v-if="sessionErrors.general" class="field__error">{{ sessionErrors.general }}</p></div><div v-if="!canManageSessions" class="form-note"><app-icon name="lock"></app-icon><p>{{ $t('ui.access.session_locked') }}</p></div><div class="security-form-foot"><span class="field__hint">{{ $t('ui.access.session_current', { minutes: sessionMinutes }) }}</span><button v-if="canManageSessions" type="submit" class="btn btn--secondary" :disabled="sessionSaving">{{ sessionSaving ? $t('ui.common.saving') : $t('ui.access.save_prefs') }}</button></div></form></section></div>

        <section class="security-card permission-card"><header class="security-card__head"><div><p class="eyebrow">{{ $t('ui.access.eyebrow_catalog') }}</p><h2>{{ $t('ui.access.catalog_title') }}</h2><p>{{ $t('ui.access.catalog_lead') }}</p></div><span class="config-badge"><app-icon name="info"></app-icon> {{ $t('ui.access.modules_count', { count: catalog.length }) }}</span></header><div class="permission-matrix" :aria-label="$t('ui.access.catalog_aria')"><div v-for="module in catalog" :key="module.id" class="permission-module"><div class="permission-module__head"><span class="permission-module__icon"><app-icon :name="module.icon"></app-icon></span><div><strong>{{ module.label }}</strong><small>{{ $t('ui.access.perm_count', { count: module.permissions.length }) }}</small></div></div><div class="permission-options"><label v-for="permission in module.permissions" :key="permission.id" class="permission-option" :class="{ 'is-disabled': mutationDisabled(module, permission) || !canManageRoles }"><input type="checkbox" :checked="hasPermission(permission.id)" :disabled="mutationDisabled(module, permission) || !canManageRoles" @change="togglePermission(module, permission, $event.target.checked)"><span class="permission-option__box" aria-hidden="true"><app-icon name="check"></app-icon></span><span>{{ permission.label }}</span></label></div><p v-if="viewPermission(module) && !hasPermission(module.id + '.view')" class="permission-help"><app-icon name="info"></app-icon> {{ $t('ui.access.enable_view_module') }}</p></div></div></section>

        <modal-shell :open="roleDialog.open" :title="roleDialog.mode === 'edit' ? $t('ui.access.edit_role') : $t('ui.access.new_role')" :eyebrow="$t('ui.access.eyebrow_rbac')" size="wide" @close="closeRoleDialog"><form id="access-role-form" class="form-stack" novalidate @submit.prevent="saveRole"><div class="field" :class="{ 'field--invalid': roleErrors.name }"><label for="access-role-name">{{ $t('ui.access.role_name') }}</label><div class="input-shell input-shell--plain"><app-icon name="shield"></app-icon><input id="access-role-name" v-model.trim="roleDraft.name" type="text" maxlength="80" @blur="validateRole"></div><p v-if="roleErrors.name" class="field__error">{{ roleErrors.name }}</p></div><div class="permission-matrix permission-matrix--editor"><div v-for="module in catalog" :key="module.id" class="permission-module"><div class="permission-module__head"><span class="permission-module__icon"><app-icon :name="module.icon"></app-icon></span><div><strong>{{ module.label }}</strong><small>{{ $t('ui.access.module_permissions') }}</small></div></div><div class="permission-options"><label v-for="permission in module.permissions" :key="permission.id" class="permission-option" :class="{ 'is-disabled': mutationDisabled(module, permission) }"><input type="checkbox" :checked="hasPermission(permission.id)" :disabled="mutationDisabled(module, permission)" @change="togglePermission(module, permission, $event.target.checked)"><span class="permission-option__box" aria-hidden="true"><app-icon name="check"></app-icon></span><span>{{ permission.label }}</span></label></div><p v-if="viewPermission(module) && !hasPermission(module.id + '.view')" class="permission-help"><app-icon name="info"></app-icon> {{ $t('ui.access.enable_view') }}</p></div></div><p v-if="roleErrors.general" class="form-error" role="alert"><app-icon name="alert"></app-icon>{{ roleErrors.general }}</p></form><template #footer><button type="button" class="btn btn--ghost" @click="closeRoleDialog">{{ $t('ui.common.cancel') }}</button><button type="submit" form="access-role-form" class="btn btn--primary" :disabled="roleSaving"><span v-if="roleSaving" class="spinner" aria-hidden="true"></span><app-icon v-else name="check"></app-icon>{{ roleSaving ? $t('ui.common.saving') : $t('ui.access.save_role') }}</button></template></modal-shell>
      </section>
    `
  };

  window.AssetAccessViews = {
    AccessUsers,
    AccessUserDetail,
    AccessSecurity,
    AccessAccountForm
  };
})();
