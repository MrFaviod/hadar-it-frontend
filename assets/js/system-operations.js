/* Installation ownership: deployment status, safe deployment preferences,
 * provider selection, module availability, backups and update preparation.
 *
 * The server owns authorization, audit and the fixed-action executor. The
 * browser never receives credentials or host paths, never sends a shell
 * command, endpoint or path, and never presents a synthetic success: an
 * unavailable executor stays explicitly unavailable.
 */
(function () {
  'use strict';

  const AppIcon = window.AppIcon;

  function T(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  const OPERATION_STATE_TONES = {
    completed: 'ok',
    failed: 'down',
    unavailable: 'hold'
  };

  const OPERATION_PERMISSIONS = {
    'deployment.status': 'system.view',
    'update.prepare': 'system.update',
    'backup.create': 'system.backup'
  };

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function dateLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return window.ItsmI18n
      ? window.ItsmI18n.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' })
      : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function apiRequest(vm, path, options) {
    return window.AssetAccess.request(vm, '/system' + path, options || {});
  }

  // GET and PUT /providers return both `selected` and `selection`; the latter
  // may be null while an installed default still exists.
  function providerState(payload) {
    const value = object(payload);
    return {
      selected: value.selected && typeof value.selected === 'object' ? value.selected : null,
      selection: value.selection && typeof value.selection === 'object' ? value.selection : null,
      providers: list(value.providers).filter(provider => provider && typeof provider === 'object')
    };
  }

  // The shared hash parser predates this section. This narrow override keeps
  // `#/configuracion/sistema` addressable without forking the route table.
  function routeOverride(route, hash) {
    if (!route || route.name !== 'config') return null;
    const clean = String(hash || '').replace(/^#/, '').replace(/\/+$/, '');
    if (clean === '/configuracion/sistema') return Object.assign({}, route, { section: 'sistema' });
    return null;
  }

  const SystemOperations = {
    name: 'SystemOperations',
    components: { AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        disposed: false,
        epoch: 0,
        requestIdentity: '',
        lifecycle: null,
        loading: true,
        status: null,
        statusError: '',
        configuration: null,
        configurationError: '',
        configurationNotice: '',
        configurationSaving: false,
        configurationDraft: { classification: '', maintenanceWindow: '' },
        providers: { selected: null, selection: null, providers: [] },
        providersError: '',
        providersSaving: false,
        providersNotice: '',
        providerDraft: { provider: '', model: '' },
        modules: [],
        modulesLoaded: false,
        modulesError: '',
        modulesBusyId: '',
        operationAction: '',
        operationError: '',
        operationResult: null
      };
    },
    computed: {
      sessionIdentity() {
        return String((this.app && this.app.activeUserId) || '') + '|' + String((this.app && this.app.csrfToken) || '');
      },
      canView() { return this.allows('system.view'); },
      canConfigure() { return this.allows('system.configure'); },
      canManageProviders() { return this.allows('system.providers'); },
      canManageModules() { return this.allows('system.modules'); },
      canBackup() { return this.allows('system.backup'); },
      canUpdate() { return this.allows('system.update'); },
      application() { return object(object(this.status).app); },
      readiness() { return object(object(this.status).readiness); },
      checkedAtLabel() { return text(object(this.status).checkedAt) ? dateLabel(this.status.checkedAt) : ''; },
      readyLabel() { return this.status && this.status.ready === true ? T('ui.system.ready') : T('ui.system.not_ready'); },
      readyTone() { return this.status && this.status.ready === true ? 'ok' : 'down'; },
      executor() { return object(object(this.status).executor); },
      executorConfigured() { return this.executor.configured === true; },
      executorAvailable() { return this.executor.available === true; },
      executorActions() { return list(this.executor.actions).filter(action => typeof action === 'string' && action); },
      executorNote() {
        if (!this.status) return '';
        if (!this.executorConfigured) return T('ui.system.executor.missing');
        if (!this.executorAvailable) {
          const detail = text(this.executor.detail);
          return detail ? T('ui.system.executor.unavailable_detail', { detail }) : T('ui.system.executor.unavailable');
        }
        if (!this.executorActions.length) return T('ui.system.executor.no_actions');
        return '';
      },
      deployment() { return object(object(this.configuration).deployment); },
      configurationExecutor() { return object(object(this.configuration).executor); },
      configurationExecutorConfigured() { return this.configurationExecutor.configured === true; },
      databaseLabel() {
        if (this.readiness.database === 'ok') return T('ui.system.value.available');
        if (this.readiness.database === 'unavailable') return T('ui.system.value.unavailable');
        return text(this.readiness.database) || T('ui.system.value.no_data');
      },
      databaseTone() { return this.readiness.database === 'ok' ? 'ok' : (this.readiness.database === 'unavailable' ? 'down' : 'warn'); },
      migrationsLabel() {
        const state = this.readiness.migrations;
        const current = text(this.readiness.current);
        const head = text(this.readiness.head);
        const version = current ? (head && head !== current ? ' · ' + current + ' → ' + head : ' · ' + current) : '';
        if (state === 'ok') return T('ui.system.migrations.current', { version });
        if (state === 'pending') return T('ui.system.migrations.pending', { version });
        return T('ui.system.migrations.unknown', { version: version || '' });
      },
      migrationsTone() { return this.readiness.migrations === 'ok' ? 'ok' : (this.readiness.migrations === 'pending' ? 'warn' : 'warn'); },
      providerChoices() { return this.providers.providers.filter(provider => provider && text(provider.id)); },
      providerSelection() {
        const selection = object(this.providers.selection);
        return Object.keys(selection).length ? selection : object(this.providers.selected);
      },
      providerSelectionLabel() {
        const selection = this.providerSelection;
        if (!text(selection.provider)) return T('ui.system.providers.no_selection');
        const provider = this.providerChoices.find(item => item.id === selection.provider);
        const name = provider ? text(provider.label, provider.id) : selection.provider;
        return name + (text(selection.model) ? ' · ' + text(selection.model) : '');
      },
      providerSourceLabel() {
        const source = text(this.providerSelection.source);
        if (source === 'installation') return T('ui.system.provider_source.installation');
        if (source === 'environment') return T('ui.system.provider_source.environment');
        return source || T('ui.system.provider_source.unknown');
      },
      providerSelectionMeta() {
        const selection = this.providerSelection;
        const parts = [];
        if (text(selection.source)) parts.push(T('ui.system.providers.origin', { source: this.providerSourceLabel }));
        if (selection.updatedAt) parts.push(T('ui.system.providers.updated', { time: dateLabel(selection.updatedAt) }));
        if (text(selection.updatedBy)) parts.push(text(selection.updatedBy));
        return parts.join(' · ');
      },
      providerSelectOptions() {
        const options = this.providerChoices.map(provider => ({ id: provider.id, name: text(provider.label, provider.id) }));
        const current = text(this.providerDraft.provider);
        if (current && !options.some(option => option.id === current)) {
          options.push({ id: current, name: T('ui.system.providers.not_announced', { name: current }) });
        }
        return options;
      },
      configurationDirty() {
        if (!this.configuration) return false;
        return text(this.configurationDraft.classification) !== text(this.deployment.classification) ||
          text(this.configurationDraft.maintenanceWindow) !== text(this.deployment.maintenanceWindow);
      },
      operationState() { return text(object(this.operationResult).state); },
      operationStateLabel() {
        const state = this.operationState;
        if (state === 'completed') return T('ui.system.operation_state.completed');
        if (state === 'failed') return T('ui.system.operation_state.failed');
        if (state === 'unavailable') return T('ui.system.operation_state.unavailable');
        return state ? T('ui.system.operation.state', { state }) : T('ui.system.operation.no_state');
      },
      operationTone() { return OPERATION_STATE_TONES[this.operationState] || 'warn'; },
      operationMessage() { return text(object(this.operationResult).message); },
      operationReference() { return text(object(this.operationResult).reference); },
      operationMeta() {
        const result = object(this.operationResult);
        const parts = [];
        if (typeof result.exitCode === 'number') parts.push(T('ui.system.operation.exit_code', { code: result.exitCode }));
        if (typeof result.durationMs === 'number') parts.push(T('ui.system.operation.duration', { duration: result.durationMs }));
        if (text(result.startedAt)) parts.push(T('ui.system.operation.started', { time: dateLabel(result.startedAt) }));
        return parts.join(' · ');
      }
    },
    watch: {
      'app.authenticated'(value) {
        if (!value) this.dispose();
      },
      sessionIdentity() {
        if (this.app.authenticated && !this.disposed) this.reset();
      }
    },
    created() {
      this.lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
      void this.load();
    },
    beforeUnmount() {
      this.dispose();
    },
    methods: {
      allows(permission) {
        return !!(this.app && typeof this.app.can === 'function' && this.app.can(permission));
      },
      requestOptions() {
        return this.lifecycle ? { signal: this.lifecycle.signal } : {};
      },
      isCurrent(epoch) {
        return !this.disposed && epoch === this.epoch && this.requestIdentity === this.sessionIdentity;
      },
      clearView() {
        this.loading = false;
        this.status = null;
        this.configuration = null;
        this.providers = { selected: null, selection: null, providers: [] };
        this.modules = [];
        this.operationResult = null;
      },
      reset() {
        if (this.lifecycle) {
          try { this.lifecycle.abort(); } catch (_) { /* already aborted */ }
        }
        this.lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
        this.clearView();
        void this.load();
      },
      dispose() {
        this.disposed = true;
        this.epoch += 1;
        if (this.lifecycle) {
          try { this.lifecycle.abort(); } catch (_) { /* already aborted */ }
          this.lifecycle = null;
        }
        this.clearView();
      },
      actionPermission(action) { return OPERATION_PERMISSIONS[action] || null; },
      allowsAction(action) {
        const permission = this.actionPermission(action);
        return !!permission && this.allows(permission);
      },
      actionBlockedReason(action) {
        if (action === 'deployment.status') return '';
        if (!this.status) return '';
        if (!this.executorConfigured) return T('ui.system.blocked.missing');
        if (!this.executorAvailable) return T('ui.system.blocked.unavailable');
        if (this.executorActions.length && this.executorActions.indexOf(action) === -1) return T('ui.system.blocked.action');
        return '';
      },
      async load() {
        if (this.disposed || !this.canView) {
          this.loading = false;
          return;
        }
        const epoch = this.epoch + 1;
        this.epoch = epoch;
        this.requestIdentity = this.sessionIdentity;
        this.loading = true;
        this.statusError = '';
        this.configurationError = '';
        this.providersError = '';
        this.modulesError = '';
        this.modulesLoaded = false;
        const tasks = [this.loadStatus(epoch), this.loadConfiguration(epoch), this.loadProviders(epoch)];
        if (this.canManageModules) tasks.push(this.loadModules(epoch));
        await Promise.all(tasks);
        if (this.isCurrent(epoch)) this.loading = false;
      },
      async loadStatus(epoch) {
        try {
          const payload = await apiRequest(this.app, '/status', this.requestOptions());
          if (!this.isCurrent(epoch)) return;
          this.status = object(payload);
          this.statusError = Object.keys(this.status).length ? '' : T('ui.system.status.empty');
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.status = null;
          this.statusError = this.errorText(error, T('ui.system.status.failed'));
        }
      },
      async loadConfiguration(epoch) {
        try {
          const payload = await apiRequest(this.app, '/configuration', this.requestOptions());
          if (!this.isCurrent(epoch)) return;
          this.configuration = object(payload);
          this.configurationDraft = {
            classification: text(this.deployment.classification),
            maintenanceWindow: text(this.deployment.maintenanceWindow)
          };
          this.configurationError = '';
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.configuration = null;
          this.configurationError = this.errorText(error, T('ui.system.configuration.failed'));
        }
      },
      async loadProviders(epoch) {
        try {
          const payload = await apiRequest(this.app, '/providers', this.requestOptions());
          if (!this.isCurrent(epoch)) return;
          this.providers = providerState(payload);
          this.providerDraft = {
            provider: text(this.providers.selection && this.providers.selection.provider, text(this.providers.selected && this.providers.selected.provider)),
            model: text(this.providers.selection && this.providers.selection.model, text(this.providers.selected && this.providers.selected.model))
          };
          this.providersError = '';
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.providers = { selected: null, selection: null, providers: [] };
          this.providersError = this.errorText(error, T('ui.system.providers.failed'));
        }
      },
      async loadModules(epoch) {
        try {
          const payload = await apiRequest(this.app, '/modules', this.requestOptions());
          if (!this.isCurrent(epoch)) return;
          this.modules = list(object(payload).modules).filter(module => module && typeof module === 'object');
          this.modulesLoaded = true;
          this.modulesError = '';
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.modules = [];
          this.modulesLoaded = false;
          this.modulesError = this.errorText(error, T('ui.system.modules.failed'));
        }
      },
      async saveConfiguration() {
        if (!this.canConfigure || this.configurationSaving || !this.configurationDirty) return false;
        const deployment = {};
        if (text(this.configurationDraft.classification) !== text(this.deployment.classification)) deployment.classification = text(this.configurationDraft.classification);
        if (text(this.configurationDraft.maintenanceWindow) !== text(this.deployment.maintenanceWindow)) deployment.maintenanceWindow = text(this.configurationDraft.maintenanceWindow);
        const body = { deployment };
        const epoch = this.epoch;
        this.configurationSaving = true;
        this.configurationError = '';
        this.configurationNotice = '';
        try {
          const payload = await apiRequest(this.app, '/configuration', Object.assign({ method: 'PATCH', body }, this.requestOptions()));
          if (!this.isCurrent(epoch)) return false;
          this.configuration = object(payload);
          this.configurationDraft = {
            classification: text(this.deployment.classification),
            maintenanceWindow: text(this.deployment.maintenanceWindow)
          };
          this.configurationNotice = T('ui.system.configuration.saved');
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.configurationError = this.errorText(error, T('ui.system.configuration.save_failed'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.configurationSaving = false;
        }
      },
      async saveProvider() {
        if (!this.canManageProviders || this.providersSaving) return false;
        const provider = text(this.providerDraft.provider);
        const model = text(this.providerDraft.model);
        if (!provider) { this.providersError = T('ui.system.providers.error_choose'); return false; }
        if (!this.providerChoices.some(item => item.id === provider)) { this.providersError = T('ui.system.providers.error_unknown'); return false; }
        if (!model) { this.providersError = T('ui.system.providers.error_model'); return false; }
        const epoch = this.epoch;
        this.providersSaving = true;
        this.providersError = '';
        this.providersNotice = '';
        try {
          const payload = await apiRequest(this.app, '/providers', Object.assign({ method: 'PUT', body: { provider, model } }, this.requestOptions()));
          if (!this.isCurrent(epoch)) return false;
          this.providers = providerState(payload);
          this.providersNotice = T('ui.system.providers.saved');
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.providersError = this.errorText(error, T('ui.system.providers.save_failed'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.providersSaving = false;
        }
      },
      async toggleModule(module) {
        if (!this.canManageModules || !module || !text(module.id) || this.modulesBusyId) return false;
        const epoch = this.epoch;
        this.modulesBusyId = module.id;
        this.modulesError = '';
        try {
          await apiRequest(this.app, '/modules/' + encodeURIComponent(module.id), Object.assign({ method: 'PATCH', body: { enabled: module.enabled === false } }, this.requestOptions()));
          if (!this.isCurrent(epoch)) return false;
          await this.loadModules(epoch);
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.modulesError = this.errorText(error, T('ui.system.modules.toggle_failed'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.modulesBusyId = '';
        }
      },
      async runOperation(action) {
        if (!this.allowsAction(action) || this.operationAction) return false;
        if (this.actionBlockedReason(action)) return false;
        const epoch = this.epoch;
        this.operationAction = action;
        this.operationError = '';
        this.operationResult = null;
        try {
          const payload = await apiRequest(this.app, '/operations', Object.assign({ method: 'POST', body: { action } }, this.requestOptions()));
          if (!this.isCurrent(epoch)) return false;
          this.operationResult = object(payload);
          if (!Object.keys(this.operationResult).length) {
            this.operationError = T('ui.system.operations.empty');
            return false;
          }
          return this.operationResult.state === 'completed';
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.operationError = this.errorText(error, T('ui.system.operations.failed'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.operationAction = '';
        }
      },
      errorText(error, fallback) {
        if (error && (error.name === 'AbortError' || error.message === 'Solicitud cancelada.')) return '';
        if (error && error.status === 403) return T('ui.system.permission_denied');
        return (error && error.message) || fallback;
      }
    },
    template: `
      <section class="config-section system-operations" aria-labelledby="system-operations-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">{{ $t('ui.system.eyebrow') }}</p>
            <h2 id="system-operations-title">{{ $t('ui.system.title') }}</h2>
            <p>{{ $t('ui.system.lead') }}</p>
          </div>
          <span class="config-badge"><app-icon name="server"></app-icon> {{ $t('ui.system.badge') }}</span>
        </header>

        <p v-if="!canView" class="agent-note agent-note--error" role="alert">{{ $t('ui.system.no_view') }}</p>
        <template v-else>
          <div class="agent-panel__actions">
            <button type="button" class="btn btn--secondary btn--small" :disabled="loading" @click="load">
              <app-icon name="refresh"></app-icon> {{ loading ? $t('ui.system.status.loading_short') : $t('ui.system.status.refresh') }}
            </button>
          </div>
          <p v-if="loading" class="agent-note" role="status">{{ $t('ui.system.status.loading') }}</p>

          <section class="agent-panel" aria-labelledby="system-status-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-status-title" class="agent-panel__title">{{ $t('ui.system.status.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.system.status.lead') }}</p>
              </div>
            </header>
            <p v-if="statusError" class="agent-note agent-note--error" role="alert">{{ statusError }}</p>
            <template v-else-if="status">
              <dl class="access-facts">
                <div><dt>{{ $t('ui.system.field.application') }}</dt><dd>{{ application.name || $t('ui.system.value.no_name') }}</dd></div>
                <div><dt>{{ $t('ui.system.field.version') }}</dt><dd class="mono">{{ application.version || $t('ui.system.value.no_version') }}</dd></div>
                <div><dt>{{ $t('ui.system.field.mode') }}</dt><dd>{{ application.mode || $t('ui.system.value.no_data') }}</dd></div>
                <div><dt>{{ $t('ui.system.field.database_engine') }}</dt><dd class="mono">{{ application.database || $t('ui.system.value.no_data') }}</dd></div>
                <div><dt>{{ $t('ui.system.field.readiness') }}</dt><dd><span class="status-pill" :class="'status--' + readyTone">{{ readyLabel }}</span><span v-if="checkedAtLabel" class="agent-skill__meta">{{ $t('ui.system.status.checked', { time: checkedAtLabel }) }}</span></dd></div>
                <div><dt>{{ $t('ui.system.field.database') }}</dt><dd><span class="status-pill" :class="'status--' + databaseTone">{{ databaseLabel }}</span></dd></div>
                <div><dt>{{ $t('ui.system.field.migrations') }}</dt><dd><span class="status-pill" :class="'status--' + migrationsTone">{{ migrationsLabel }}</span></dd></div>
              </dl>
              <div class="agent-skill__meta">
                <strong>{{ $t('ui.system.executor.label') }}</strong>
                {{ executorConfigured ? $t('ui.system.executor.configured') : $t('ui.system.executor.not_configured') }} ·
                {{ executorConfigured ? (executorAvailable ? $t('ui.system.executor.available') : $t('ui.system.executor.unavailable_short')) : $t('ui.system.executor.offline') }}
              </div>
              <p v-if="executorActions.length" class="agent-skill__meta">{{ $t('ui.system.executor.actions') }} <span v-for="action in executorActions" :key="action" class="agent-tag mono">{{ action }}</span></p>
              <p v-else-if="executorConfigured" class="agent-skill__meta">{{ $t('ui.system.executor.no_actions') }}</p>
              <p v-if="executorNote" class="agent-note" :class="{ 'agent-note--error': !executorConfigured || !executorAvailable }" role="status">{{ executorNote }}</p>
            </template>
            <p v-else class="agent-note" role="status">{{ $t('ui.system.status.missing') }}</p>
          </section>

          <section class="agent-panel" aria-labelledby="system-config-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-config-title" class="agent-panel__title">{{ $t('ui.system.configuration.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.system.configuration.lead') }}</p>
              </div>
            </header>
            <p v-if="configurationError" class="agent-note agent-note--error" role="alert">{{ configurationError }}</p>
            <template v-else-if="configuration">
              <dl class="access-facts">
                <div><dt>{{ $t('ui.system.field.database_engine') }}</dt><dd class="mono">{{ deployment.database || $t('ui.system.value.no_data') }}</dd></div>
                <div><dt>{{ $t('ui.system.executor.label_short') }}</dt><dd>{{ configurationExecutorConfigured ? $t('ui.system.executor.configured_state') : $t('ui.system.executor.unconfigured_state') }}</dd></div>
              </dl>
              <form v-if="canConfigure" class="form-stack" novalidate @submit.prevent="saveConfiguration">
                <div class="field-grid">
                  <div class="field">
                    <label class="field__label" for="system-classification">{{ $t('ui.system.configuration.classification') }}</label>
                    <select id="system-classification" class="input-shell" v-model="configurationDraft.classification">
                      <option value="development">{{ $t('ui.system.classification.development') }}</option>
                      <option value="test">{{ $t('ui.system.classification.test') }}</option>
                      <option value="production">{{ $t('ui.system.classification.production') }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="system-maintenance">{{ $t('ui.system.configuration.maintenance_window') }}</label>
                    <select id="system-maintenance" class="input-shell" v-model="configurationDraft.maintenanceWindow">
                      <option value="anytime">{{ $t('ui.system.window.anytime') }}</option>
                      <option value="outside_business_hours">{{ $t('ui.system.window.outside_business_hours') }}</option>
                    </select>
                  </div>
                </div>
                <p class="field__hint">{{ $t('ui.system.configuration.hint') }}</p>
                <p v-if="configurationNotice" class="agent-note" role="status">{{ configurationNotice }}</p>
                <div class="agent-panel__actions">
                  <button type="submit" class="btn btn--primary btn--small" :disabled="configurationSaving || !configurationDirty">
                    <app-icon name="check"></app-icon> {{ configurationSaving ? $t('ui.system.configuration.saving') : $t('ui.system.configuration.save') }}
                  </button>
                </div>
              </form>
              <p v-else class="agent-note">{{ $t('ui.system.configuration.read_only') }}</p>
            </template>
            <p v-else class="agent-note" role="status">{{ $t('ui.system.configuration.missing') }}</p>
          </section>

          <section class="agent-panel" aria-labelledby="system-providers-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-providers-title" class="agent-panel__title">{{ $t('ui.system.providers.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.system.providers.lead') }}</p>
              </div>
            </header>
            <p v-if="providersError" class="agent-note agent-note--error" role="alert">{{ providersError }}</p>
            <template v-else>
              <p class="agent-skill__meta">{{ $t('ui.system.providers.current') }} <strong>{{ providerSelectionLabel }}</strong></p>
              <p v-if="providerSelectionMeta" class="agent-skill__meta">{{ providerSelectionMeta }}</p>
              <p v-if="!providerChoices.length" class="agent-note">{{ $t('ui.system.providers.empty') }}</p>
              <ul v-else class="agent-skill-list">
                <li v-for="provider in providerChoices" :key="provider.id" class="agent-skill">
                  <div>
                    <strong>{{ provider.label || provider.id }}</strong>
                    <span class="status-pill" :class="provider.credentialConfigured ? 'status--ok' : 'status--hold'">{{ provider.credentialConfigured ? $t('ui.system.providers.credential') : $t('ui.system.providers.no_credential') }}</span>
                  </div>
                  <p v-if="Array.isArray(provider.credentialEnv) && provider.credentialEnv.length" class="agent-skill__meta mono">{{ $t('ui.system.providers.env_reference') }} {{ provider.credentialEnv.join(', ') }}</p>
                </li>
              </ul>
              <form v-if="canManageProviders" class="form-stack" novalidate @submit.prevent="saveProvider">
                <div class="field-grid">
                  <div class="field">
                    <label class="field__label" for="system-provider">{{ $t('ui.system.providers.provider') }}</label>
                    <select id="system-provider" class="input-shell" v-model="providerDraft.provider">
                      <option v-for="option in providerSelectOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="system-provider-model">{{ $t('ui.system.providers.model') }}</label>
                    <input id="system-provider-model" class="input-shell" v-model.trim="providerDraft.model" type="text" maxlength="120" autocomplete="off">
                    <p class="field__hint">{{ $t('ui.system.providers.hint') }}</p>
                  </div>
                </div>
                <p v-if="providersNotice" class="agent-note" role="status">{{ providersNotice }}</p>
                <div class="agent-panel__actions">
                  <button type="submit" class="btn btn--primary btn--small" :disabled="providersSaving || !providerChoices.length || !providerDraft.provider || !providerDraft.model">
                    <app-icon name="check"></app-icon> {{ providersSaving ? $t('ui.system.providers.saving') : $t('ui.system.providers.save') }}
                  </button>
                </div>
              </form>
              <p v-else class="agent-note">{{ $t('ui.system.providers.read_only') }}</p>
            </template>
          </section>

          <section class="agent-panel" aria-labelledby="system-modules-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-modules-title" class="agent-panel__title">{{ $t('ui.system.modules.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.system.modules.lead') }}</p>
              </div>
            </header>
            <p v-if="!canManageModules" class="agent-note">{{ $t('ui.system.modules.read_only') }}</p>
            <template v-else>
              <p v-if="modulesError" class="agent-note agent-note--error" role="alert">{{ modulesError }}</p>
              <p v-else-if="modulesLoaded && !modules.length" class="agent-note">{{ $t('ui.system.modules.empty') }}</p>
              <p v-else-if="!modulesLoaded" class="agent-note" role="status">{{ $t('ui.system.modules.loading') }}</p>
              <ul v-if="modules.length" class="agent-module-list">
                <li v-for="module in modules" :key="module.id" class="agent-module" :class="{ 'is-disabled': module.enabled === false }">
                  <div class="agent-module__head">
                    <div>
                      <strong>{{ module.name || module.id }}</strong>
                      <span v-if="module.version" class="agent-tag mono">{{ module.version }}</span>
                      <span v-if="module.official === true" class="agent-tag">{{ $t('ui.system.modules.official') }}</span>
                      <span class="status-pill" :class="module.enabled === false ? 'status--hold' : 'status--ok'">{{ module.enabled === false ? $t('ui.system.modules.disabled') : $t('ui.system.modules.enabled') }}</span>
                    </div>
                    <button v-if="module.official !== true" type="button" class="btn btn--secondary btn--small" :disabled="modulesBusyId === module.id" @click="toggleModule(module)">
                      {{ modulesBusyId === module.id ? $t('ui.system.modules.applying') : (module.enabled === false ? $t('ui.system.modules.enable') : $t('ui.system.modules.disable')) }}
                    </button>
                  </div>
                  <p v-if="module.official === true" class="field__hint">{{ $t('ui.system.modules.official_hint') }}</p>
                </li>
              </ul>
            </template>
          </section>

          <section class="agent-panel" aria-labelledby="system-operations-panel-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-operations-panel-title" class="agent-panel__title">{{ $t('ui.system.operations.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.system.operations.lead') }}</p>
              </div>
            </header>
            <p v-if="!canUpdate && !canBackup" class="agent-note">{{ $t('ui.system.operations.read_only') }}</p>
            <div class="agent-panel__actions">
              <button type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction" @click="runOperation('deployment.status')">
                {{ operationAction === 'deployment.status' ? $t('ui.system.operations.checking') : $t('ui.system.operations.check') }}
              </button>
              <button v-if="canUpdate" type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction || !!actionBlockedReason('update.prepare')" @click="runOperation('update.prepare')">
                {{ operationAction === 'update.prepare' ? $t('ui.system.operations.preparing') : $t('ui.system.operations.prepare_update') }}
              </button>
              <button v-if="canBackup" type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction || !!actionBlockedReason('backup.create')" @click="runOperation('backup.create')">
                {{ operationAction === 'backup.create' ? $t('ui.system.operations.creating') : $t('ui.system.operations.create_backup') }}
              </button>
            </div>
            <p v-if="canUpdate && actionBlockedReason('update.prepare')" class="field__hint">{{ $t('ui.system.operations.update_blocked', { reason: actionBlockedReason('update.prepare') }) }}</p>
            <p v-if="canBackup && actionBlockedReason('backup.create')" class="field__hint">{{ $t('ui.system.operations.backup_blocked', { reason: actionBlockedReason('backup.create') }) }}</p>
            <p v-if="operationError" class="agent-note agent-note--error" role="alert">{{ operationError }}</p>
            <div v-if="operationResult" class="agent-installation" role="status">
              <div class="agent-installation__head">
                <strong>{{ $t('ui.system.operations.last') }}</strong>
                <span class="status-pill" :class="'status--' + operationTone">{{ operationStateLabel }}</span>
              </div>
              <p v-if="operationMessage" class="agent-skill__meta">{{ operationMessage }}</p>
              <p v-if="operationReference" class="agent-skill__meta mono">{{ $t('ui.system.operations.reference') }} {{ operationReference }}</p>
              <p v-if="operationMeta" class="agent-skill__meta">{{ operationMeta }}</p>
            </div>
          </section>
        </template>
      </section>
    `
  };

  window.AssetSystemViews = { routeOverride, SystemOperations };
})();
