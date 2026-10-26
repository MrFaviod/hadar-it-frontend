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

  const PROVIDER_SOURCE_LABELS = {
    installation: 'Elegida en la instalación',
    environment: 'Tomada del entorno del servidor'
  };

  const OPERATION_STATE_LABELS = {
    completed: 'Completado',
    failed: 'Fallido',
    unavailable: 'No disponible'
  };

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
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
      readyLabel() { return this.status && this.status.ready === true ? 'Preparado' : 'No preparado'; },
      readyTone() { return this.status && this.status.ready === true ? 'ok' : 'down'; },
      executor() { return object(object(this.status).executor); },
      executorConfigured() { return this.executor.configured === true; },
      executorAvailable() { return this.executor.available === true; },
      executorActions() { return list(this.executor.actions).filter(action => typeof action === 'string' && action); },
      executorNote() {
        if (!this.status) return '';
        if (!this.executorConfigured) return 'Sin ejecutor externo configurado: las operaciones de respaldo y actualización no están disponibles hasta configurarlo fuera de la aplicación.';
        if (!this.executorAvailable) {
          const detail = text(this.executor.detail);
          return 'El ejecutor externo no está disponible' + (detail ? ': ' + detail : '.');
        }
        if (!this.executorActions.length) return 'El ejecutor externo no anunció acciones; las operaciones pueden no estar disponibles.';
        return '';
      },
      deployment() { return object(object(this.configuration).deployment); },
      configurationExecutor() { return object(object(this.configuration).executor); },
      configurationExecutorConfigured() { return this.configurationExecutor.configured === true; },
      databaseLabel() { return this.readiness.database === 'ok' ? 'Disponible' : (this.readiness.database === 'unavailable' ? 'No disponible' : text(this.readiness.database, 'Sin datos')); },
      databaseTone() { return this.readiness.database === 'ok' ? 'ok' : (this.readiness.database === 'unavailable' ? 'down' : 'warn'); },
      migrationsLabel() {
        const state = this.readiness.migrations;
        const current = text(this.readiness.current);
        const head = text(this.readiness.head);
        const version = current ? (head && head !== current ? ' · ' + current + ' → ' + head : ' · ' + current) : '';
        if (state === 'ok') return 'Al día' + version;
        if (state === 'pending') return 'Pendientes' + version;
        return text(state, 'Sin datos') + version;
      },
      migrationsTone() { return this.readiness.migrations === 'ok' ? 'ok' : (this.readiness.migrations === 'pending' ? 'warn' : 'warn'); },
      providerChoices() { return this.providers.providers.filter(provider => provider && text(provider.id)); },
      providerSelection() {
        const selection = object(this.providers.selection);
        return Object.keys(selection).length ? selection : object(this.providers.selected);
      },
      providerSelectionLabel() {
        const selection = this.providerSelection;
        if (!text(selection.provider)) return 'Sin selección guardada.';
        const provider = this.providerChoices.find(item => item.id === selection.provider);
        const name = provider ? text(provider.label, provider.id) : selection.provider;
        return name + (text(selection.model) ? ' · ' + text(selection.model) : '');
      },
      providerSourceLabel() { return PROVIDER_SOURCE_LABELS[text(this.providerSelection.source)] || text(this.providerSelection.source, 'Origen no informado'); },
      providerSelectionMeta() {
        const selection = this.providerSelection;
        const parts = [];
        if (text(selection.source)) parts.push('Origen: ' + this.providerSourceLabel);
        if (selection.updatedAt) parts.push('Actualizada: ' + dateLabel(selection.updatedAt));
        if (text(selection.updatedBy)) parts.push(text(selection.updatedBy));
        return parts.join(' · ');
      },
      providerSelectOptions() {
        const options = this.providerChoices.map(provider => ({ id: provider.id, name: text(provider.label, provider.id) }));
        const current = text(this.providerDraft.provider);
        if (current && !options.some(option => option.id === current)) {
          options.push({ id: current, name: current + ' · no anunciado' });
        }
        return options;
      },
      configurationDirty() {
        if (!this.configuration) return false;
        return text(this.configurationDraft.classification) !== text(this.deployment.classification) ||
          text(this.configurationDraft.maintenanceWindow) !== text(this.deployment.maintenanceWindow);
      },
      operationState() { return text(object(this.operationResult).state); },
      operationStateLabel() { return OPERATION_STATE_LABELS[this.operationState] || (this.operationState ? 'Estado: ' + this.operationState : 'Sin estado informado'); },
      operationTone() { return OPERATION_STATE_TONES[this.operationState] || 'warn'; },
      operationMessage() { return text(object(this.operationResult).message); },
      operationReference() { return text(object(this.operationResult).reference); },
      operationMeta() {
        const result = object(this.operationResult);
        const parts = [];
        if (typeof result.exitCode === 'number') parts.push('Código de salida: ' + result.exitCode);
        if (typeof result.durationMs === 'number') parts.push('Duración: ' + result.durationMs + ' ms');
        if (text(result.startedAt)) parts.push('Inicio: ' + dateLabel(result.startedAt));
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
        if (!this.executorConfigured) return 'Sin ejecutor externo configurado.';
        if (!this.executorAvailable) return 'El ejecutor externo no está disponible.';
        if (this.executorActions.length && this.executorActions.indexOf(action) === -1) return 'El ejecutor no anuncia esta acción.';
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
          this.statusError = Object.keys(this.status).length ? '' : 'El servidor no devolvió el estado del sistema.';
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.status = null;
          this.statusError = this.errorText(error, 'No se pudo consultar el estado del sistema.');
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
          this.configurationError = this.errorText(error, 'No se pudo consultar la configuración del despliegue.');
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
          this.providersError = this.errorText(error, 'No se pudieron consultar los proveedores de IA.');
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
          this.modulesError = this.errorText(error, 'No se pudieron consultar los módulos.');
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
          this.configurationNotice = 'Preferencias del despliegue guardadas.';
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.configurationError = this.errorText(error, 'No se pudieron guardar las preferencias del despliegue.');
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.configurationSaving = false;
        }
      },
      async saveProvider() {
        if (!this.canManageProviders || this.providersSaving) return false;
        const provider = text(this.providerDraft.provider);
        const model = text(this.providerDraft.model);
        if (!provider) { this.providersError = 'Elige un proveedor anunciado por el servidor.'; return false; }
        if (!this.providerChoices.some(item => item.id === provider)) { this.providersError = 'El proveedor elegido no está en la lista del servidor.'; return false; }
        if (!model) { this.providersError = 'Escribe el identificador del modelo.'; return false; }
        const epoch = this.epoch;
        this.providersSaving = true;
        this.providersError = '';
        this.providersNotice = '';
        try {
          const payload = await apiRequest(this.app, '/providers', Object.assign({ method: 'PUT', body: { provider, model } }, this.requestOptions()));
          if (!this.isCurrent(epoch)) return false;
          this.providers = providerState(payload);
          this.providersNotice = 'Proveedor y modelo guardados. La credencial sigue configurándose fuera de la aplicación.';
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.providersError = this.errorText(error, 'No se pudo guardar la selección de proveedor.');
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
          this.modulesError = this.errorText(error, 'No se pudo cambiar el estado del módulo.');
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
            this.operationError = 'El servidor no devolvió el resultado de la operación.';
            return false;
          }
          return this.operationResult.state === 'completed';
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.operationError = this.errorText(error, 'No se pudo ejecutar la operación.');
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.operationAction = '';
        }
      },
      errorText(error, fallback) {
        if (error && (error.name === 'AbortError' || error.message === 'Solicitud cancelada.')) return '';
        if (error && error.status === 403) return 'Tu cuenta no tiene el permiso necesario para esta operación del sistema.';
        return (error && error.message) || fallback;
      }
    },
    template: `
      <section class="config-section system-operations" aria-labelledby="system-operations-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Instalación</p>
            <h2 id="system-operations-title">Sistema</h2>
            <p>Estado del despliegue y operaciones reservadas al propietario de la instalación. El servidor decide y audita cada acción.</p>
          </div>
          <span class="config-badge"><app-icon name="server"></app-icon> Instalación</span>
        </header>

        <p v-if="!canView" class="agent-note agent-note--error" role="alert">Tu cuenta no tiene el permiso para ver el sistema.</p>
        <template v-else>
          <div class="agent-panel__actions">
            <button type="button" class="btn btn--secondary btn--small" :disabled="loading" @click="load">
              <app-icon name="refresh"></app-icon> {{ loading ? 'Consultando…' : 'Actualizar estado' }}
            </button>
          </div>
          <p v-if="loading" class="agent-note" role="status">Consultando el estado del sistema…</p>

          <section class="agent-panel" aria-labelledby="system-status-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-status-title" class="agent-panel__title">Estado del servicio</h3>
                <p class="agent-panel__sub">Preparación informada por el servidor; no inspecciona el host.</p>
              </div>
            </header>
            <p v-if="statusError" class="agent-note agent-note--error" role="alert">{{ statusError }}</p>
            <template v-else-if="status">
              <dl class="access-facts">
                <div><dt>Aplicación</dt><dd>{{ application.name || 'Sin nombre informado' }}</dd></div>
                <div><dt>Versión</dt><dd class="mono">{{ application.version || 'Sin versión informada' }}</dd></div>
                <div><dt>Modo</dt><dd>{{ application.mode || 'Sin datos' }}</dd></div>
                <div><dt>Motor de base de datos</dt><dd class="mono">{{ application.database || 'Sin datos' }}</dd></div>
                <div><dt>Preparación</dt><dd><span class="status-pill" :class="'status--' + readyTone">{{ readyLabel }}</span><span v-if="checkedAtLabel" class="agent-skill__meta"> · Comprobado: {{ checkedAtLabel }}</span></dd></div>
                <div><dt>Base de datos</dt><dd><span class="status-pill" :class="'status--' + databaseTone">{{ databaseLabel }}</span></dd></div>
                <div><dt>Migraciones</dt><dd><span class="status-pill" :class="'status--' + migrationsTone">{{ migrationsLabel }}</span></dd></div>
              </dl>
              <div class="agent-skill__meta">
                <strong>Ejecutor externo:</strong>
                {{ executorConfigured ? 'configurado' : 'sin configurar' }} ·
                {{ executorConfigured ? (executorAvailable ? 'disponible' : 'no disponible') : 'sin conexión' }}
              </div>
              <p v-if="executorActions.length" class="agent-skill__meta">Acciones anunciadas: <span v-for="action in executorActions" :key="action" class="agent-tag mono">{{ action }}</span></p>
              <p v-else-if="executorConfigured" class="agent-skill__meta">El ejecutor no anunció acciones.</p>
              <p v-if="executorNote" class="agent-note" :class="{ 'agent-note--error': !executorConfigured || !executorAvailable }" role="status">{{ executorNote }}</p>
            </template>
            <p v-else class="agent-note" role="status">El servidor todavía no devolvió el estado.</p>
          </section>

          <section class="agent-panel" aria-labelledby="system-config-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-config-title" class="agent-panel__title">Configuración del despliegue</h3>
                <p class="agent-panel__sub">Solo preferencias de la aplicación. El entorno del host, las rutas y los secretos no se editan desde aquí.</p>
              </div>
            </header>
            <p v-if="configurationError" class="agent-note agent-note--error" role="alert">{{ configurationError }}</p>
            <template v-else-if="configuration">
              <dl class="access-facts">
                <div><dt>Motor de base de datos</dt><dd class="mono">{{ deployment.database || 'Sin datos' }}</dd></div>
                <div><dt>Ejecutor externo</dt><dd>{{ configurationExecutorConfigured ? 'Configurado' : 'Sin configurar' }}</dd></div>
              </dl>
              <form v-if="canConfigure" class="form-stack" novalidate @submit.prevent="saveConfiguration">
                <div class="field-grid">
                  <div class="field">
                    <label class="field__label" for="system-classification">Clasificación de despliegue</label>
                    <select id="system-classification" class="input-shell" v-model="configurationDraft.classification">
                      <option value="development">Desarrollo</option>
                      <option value="test">Pruebas</option>
                      <option value="production">Producción</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="system-maintenance">Ventana de mantenimiento</label>
                    <select id="system-maintenance" class="input-shell" v-model="configurationDraft.maintenanceWindow">
                      <option value="anytime">Cualquier momento</option>
                      <option value="outside_business_hours">Fuera del horario laboral</option>
                    </select>
                  </div>
                </div>
                <p class="field__hint">La clasificación se guarda en el servidor y no cambia el entorno real donde corre el proceso ni la base de datos.</p>
                <p v-if="configurationNotice" class="agent-note" role="status">{{ configurationNotice }}</p>
                <div class="agent-panel__actions">
                  <button type="submit" class="btn btn--primary btn--small" :disabled="configurationSaving || !configurationDirty">
                    <app-icon name="check"></app-icon> {{ configurationSaving ? 'Guardando…' : 'Guardar preferencias' }}
                  </button>
                </div>
              </form>
              <p v-else class="agent-note">Consultar es posible con el permiso de sistema; cambiar la configuración requiere el permiso de configuración del despliegue.</p>
            </template>
            <p v-else class="agent-note" role="status">El servidor todavía no devolvió la configuración.</p>
          </section>

          <section class="agent-panel" aria-labelledby="system-providers-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-providers-title" class="agent-panel__title">Proveedores de IA</h3>
                <p class="agent-panel__sub">El servidor conserva las credenciales; aquí solo se elige proveedor y modelo anunciados.</p>
              </div>
            </header>
            <p v-if="providersError" class="agent-note agent-note--error" role="alert">{{ providersError }}</p>
            <template v-else>
              <p class="agent-skill__meta">Selección actual: <strong>{{ providerSelectionLabel }}</strong></p>
              <p v-if="providerSelectionMeta" class="agent-skill__meta">{{ providerSelectionMeta }}</p>
              <p v-if="!providerChoices.length" class="agent-note">El servidor no anunció proveedores.</p>
              <ul v-else class="agent-skill-list">
                <li v-for="provider in providerChoices" :key="provider.id" class="agent-skill">
                  <div>
                    <strong>{{ provider.label || provider.id }}</strong>
                    <span class="status-pill" :class="provider.credentialConfigured ? 'status--ok' : 'status--hold'">{{ provider.credentialConfigured ? 'Credencial configurada' : 'Sin credencial' }}</span>
                  </div>
                  <p v-if="Array.isArray(provider.credentialEnv) && provider.credentialEnv.length" class="agent-skill__meta mono">Referencia de entorno: {{ provider.credentialEnv.join(', ') }}</p>
                </li>
              </ul>
              <form v-if="canManageProviders" class="form-stack" novalidate @submit.prevent="saveProvider">
                <div class="field-grid">
                  <div class="field">
                    <label class="field__label" for="system-provider">Proveedor</label>
                    <select id="system-provider" class="input-shell" v-model="providerDraft.provider">
                      <option v-for="option in providerSelectOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="system-provider-model">Modelo</label>
                    <input id="system-provider-model" class="input-shell" v-model.trim="providerDraft.model" type="text" maxlength="120" autocomplete="off">
                    <p class="field__hint">Identificador del modelo tal como lo anuncia el proveedor. No se aceptan URL ni claves.</p>
                  </div>
                </div>
                <p v-if="providersNotice" class="agent-note" role="status">{{ providersNotice }}</p>
                <div class="agent-panel__actions">
                  <button type="submit" class="btn btn--primary btn--small" :disabled="providersSaving || !providerChoices.length || !providerDraft.provider || !providerDraft.model">
                    <app-icon name="check"></app-icon> {{ providersSaving ? 'Guardando…' : 'Guardar proveedor' }}
                  </button>
                </div>
              </form>
              <p v-else class="agent-note">Cambiar el proveedor requiere el permiso de proveedores de IA.</p>
            </template>
          </section>

          <section class="agent-panel" aria-labelledby="system-modules-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-modules-title" class="agent-panel__title">Módulos</h3>
                <p class="agent-panel__sub">Los módulos retirados dejan de aportar skills y herramientas a los agentes.</p>
              </div>
            </header>
            <p v-if="!canManageModules" class="agent-note">Consultar y cambiar módulos requiere el permiso de módulos del sistema.</p>
            <template v-else>
              <p v-if="modulesError" class="agent-note agent-note--error" role="alert">{{ modulesError }}</p>
              <p v-else-if="modulesLoaded && !modules.length" class="agent-note">El servidor no devolvió módulos.</p>
              <p v-else-if="!modulesLoaded" class="agent-note" role="status">Consultando módulos…</p>
              <ul v-if="modules.length" class="agent-module-list">
                <li v-for="module in modules" :key="module.id" class="agent-module" :class="{ 'is-disabled': module.enabled === false }">
                  <div class="agent-module__head">
                    <div>
                      <strong>{{ module.name || module.id }}</strong>
                      <span v-if="module.version" class="agent-tag mono">{{ module.version }}</span>
                      <span v-if="module.official === true" class="agent-tag">Oficial</span>
                      <span class="status-pill" :class="module.enabled === false ? 'status--hold' : 'status--ok'">{{ module.enabled === false ? 'Deshabilitado' : 'Habilitado' }}</span>
                    </div>
                    <button v-if="module.official !== true" type="button" class="btn btn--secondary btn--small" :disabled="modulesBusyId === module.id" @click="toggleModule(module)">
                      {{ modulesBusyId === module.id ? 'Aplicando…' : (module.enabled === false ? 'Habilitar módulo' : 'Deshabilitar módulo') }}
                    </button>
                  </div>
                  <p v-if="module.official === true" class="field__hint">El módulo oficial se administra con la instalación y no se deshabilita aquí.</p>
                </li>
              </ul>
            </template>
          </section>

          <section class="agent-panel" aria-labelledby="system-operations-panel-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="system-operations-panel-title" class="agent-panel__title">Operaciones</h3>
                <p class="agent-panel__sub">El ejecutor externo aplica acciones fijas; esta interfaz no ejecuta comandos ni inspecciona el host.</p>
              </div>
            </header>
            <p v-if="!canUpdate && !canBackup" class="agent-note">Tu rol solo puede consultar el estado del despliegue.</p>
            <div class="agent-panel__actions">
              <button type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction" @click="runOperation('deployment.status')">
                {{ operationAction === 'deployment.status' ? 'Consultando…' : 'Comprobar despliegue' }}
              </button>
              <button v-if="canUpdate" type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction || !!actionBlockedReason('update.prepare')" @click="runOperation('update.prepare')">
                {{ operationAction === 'update.prepare' ? 'Preparando…' : 'Preparar actualización' }}
              </button>
              <button v-if="canBackup" type="button" class="btn btn--secondary btn--small" :disabled="!!operationAction || !!actionBlockedReason('backup.create')" @click="runOperation('backup.create')">
                {{ operationAction === 'backup.create' ? 'Creando…' : 'Crear respaldo' }}
              </button>
            </div>
            <p v-if="canUpdate && actionBlockedReason('update.prepare')" class="field__hint">Actualizar: {{ actionBlockedReason('update.prepare') }}</p>
            <p v-if="canBackup && actionBlockedReason('backup.create')" class="field__hint">Respaldo: {{ actionBlockedReason('backup.create') }}</p>
            <p v-if="operationError" class="agent-note agent-note--error" role="alert">{{ operationError }}</p>
            <div v-if="operationResult" class="agent-installation" role="status">
              <div class="agent-installation__head">
                <strong>Última operación</strong>
                <span class="status-pill" :class="'status--' + operationTone">{{ operationStateLabel }}</span>
              </div>
              <p v-if="operationMessage" class="agent-skill__meta">{{ operationMessage }}</p>
              <p v-if="operationReference" class="agent-skill__meta mono">Referencia: {{ operationReference }}</p>
              <p v-if="operationMeta" class="agent-skill__meta">{{ operationMeta }}</p>
            </div>
          </section>
        </template>
      </section>
    `
  };

  window.AssetSystemViews = { routeOverride, SystemOperations };
})();
