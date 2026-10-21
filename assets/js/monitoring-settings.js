(function () {
  'use strict';

  const M = window.AssetMonitorEngine;
  const Data = window.ASSET_MONITOR;
  const Views = window.Views = window.Views || {};

  const DAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  function daysLabel(days) {
    return (days || []).slice().sort().map((day) => DAY_LABELS[day]).join(' ');
  }

  function scopeLabel(scope) {
    return scope === 'category' ? 'Categoría' : 'Dispositivo';
  }

  Views.MonitoringSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        draft: { assetId: '', checkIds: ['availability'], intervalMinutes: 15 }
      };
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      checks() { return this.monitoring.checks; },
      policies() { return this.monitoring.policies; },
      exceptions() { return this.monitoring.exceptions; },
      categories() { return this.app.categories || []; },
      assets() { return (this.app.assets || []).filter((asset) => !asset.retired); },
      canEdit() { return this.app.can('assets.edit'); },
      ranges() { return Data.RANGES; },
      tabs() {
        return [
          { id: 'estado', label: 'Estado' },
          { id: 'dispositivos', label: 'Dispositivos' },
          { id: 'alertas', label: 'Alertas' }
        ];
      },
      assetOptions() {
        return this.assets.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
      },
      enabledPolicies() { return this.policies.filter((policy) => policy.enabled).length; }
    },
    methods: {
      categoryLabel(id) {
        const category = this.categories.find((item) => item.id === id);
        return category ? category.label : id;
      },
      assetName(id) {
        const asset = this.assets.find((item) => item.id === id);
        return asset ? asset.name : id;
      },
      checkLabel(id) {
        const check = this.checks.find((item) => item.id === id);
        return check ? check.label : id;
      },
      hasCheck(list, id) { return list.indexOf(id) !== -1; },
      togglePolicyCheck(policy, id) {
        if (!this.canEdit) return;
        const next = policy.checkIds.indexOf(id) === -1
          ? policy.checkIds.concat([id])
          : policy.checkIds.filter((item) => item !== id);
        const result = M.savePolicy(this.monitoring, policy.category, {
          enabled: policy.enabled,
          intervalMinutes: policy.intervalMinutes,
          checkIds: next
        });
        if (!result.ok) this.app.showToast(result.errors[0]);
      },
      togglePolicyEnabled(policy) {
        if (!this.canEdit) return;
        const result = M.savePolicy(this.monitoring, policy.category, {
          enabled: !policy.enabled,
          intervalMinutes: policy.intervalMinutes,
          checkIds: policy.checkIds
        });
        this.app.showToast(result.ok
          ? this.categoryLabel(policy.category) + (policy.enabled ? ' supervisada.' : ' fuera de la supervisión.')
          : result.errors[0]);
      },
      setPolicyInterval(policy, event) {
        const value = Number(event.target.value);
        const result = M.savePolicy(this.monitoring, policy.category, {
          enabled: policy.enabled, intervalMinutes: value, checkIds: policy.checkIds
        });
        if (!result.ok) {
          event.target.value = policy.intervalMinutes;
          this.app.showToast(result.errors[0]);
          return;
        }
        this.app.showToast('Frecuencia de ' + this.categoryLabel(policy.category) + ': cada ' + policy.intervalMinutes + ' min.');
      },
      setThreshold(check, field, event) {
        const value = Number(event.target.value);
        const result = M.saveThresholds(this.monitoring, {
          id: check.id,
          warn: field === 'warn' ? value : check.warn,
          crit: field === 'crit' ? value : check.crit
        });
        if (!result.ok) {
          event.target.value = check[field];
          this.app.showToast(result.errors[0]);
        }
      },
      toggleDraftCheck(id) {
        this.draft.checkIds = this.draft.checkIds.indexOf(id) === -1
          ? this.draft.checkIds.concat([id])
          : this.draft.checkIds.filter((item) => item !== id);
      },
      addException() {
        if (!this.draft.assetId) {
          this.app.showToast('Selecciona el activo que quieres incorporar.');
          return;
        }
        const asset = this.assets.find((item) => item.id === this.draft.assetId);
        const result = M.saveException(this.monitoring, this.draft.assetId, {
          enabled: true,
          intervalMinutes: this.draft.intervalMinutes,
          checkIds: this.draft.checkIds,
          asset: asset
        });
        if (!result.ok) {
          this.app.showToast(result.errors[0]);
          return;
        }
        this.app.showToast(asset.name + ' incorporado a la supervisión.');
        this.draft = { assetId: '', checkIds: ['availability'], intervalMinutes: 15 };
      },
      removeException(exception) {
        const result = M.removeException(this.monitoring, exception.assetId);
        this.app.showToast(result.ok ? 'Excepción eliminada: el activo vuelve a la política de su categoría.' : result.errors[0]);
      },
      toggleExceptionEnabled(exception) {
        const result = M.saveException(this.monitoring, exception.assetId, {
          enabled: !exception.enabled,
          intervalMinutes: exception.intervalMinutes,
          checkIds: exception.checkIds
        });
        this.app.showToast(result.ok ? 'Excepción actualizada.' : result.errors[0]);
      },
      savePrefs(payload) {
        M.savePrefs(this.monitoring, payload);
      },
      fmtDateTime: fmtDateTime
    },
    template: `
      <section class="config-section mon-settings" data-od-id="mon-settings" aria-labelledby="config-mon-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Operación técnica</p>
            <h2 id="config-mon-title">Supervisión</h2>
            <p class="config-section__lead">Comprobaciones por categoría, excepciones individuales y umbrales. La disponibilidad básica es el nivel mínimo; cada categoría suma las métricas que su equipo puede reportar.</p>
          </div>
          <span class="chip chip--muted">{{ enabledPolicies }} de {{ policies.length }} categorías · {{ exceptions.length }} excepciones</span>
        </header>

        <p v-if="!canEdit" class="mon-lock">Tu rol puede consultar la configuración, pero no modificarla.</p>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Comprobaciones por categoría</h3>
              <p class="mon-settings__sub">Activa una categoría y elige qué métricas se comprueban en cada intervalo.</p>
            </div>
          </header>
          <div class="mon-table-wrap">
            <table class="mon-settings-table">
              <thead>
                <tr>
                  <th scope="col">Categoría</th>
                  <th scope="col">Comprobaciones</th>
                  <th scope="col">Frecuencia</th>
                  <th scope="col">Supervisión</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="policy in policies" :key="policy.category" :class="{ 'is-off': !policy.enabled }">
                  <th scope="row">{{ categoryLabel(policy.category) }}</th>
                  <td>
                    <span class="mon-toggle-group">
                      <button v-for="check in checks" :key="check.id" type="button" class="mon-toggle"
                              :class="{ 'is-on': hasCheck(policy.checkIds, check.id) }"
                              :aria-pressed="hasCheck(policy.checkIds, check.id)"
                              :disabled="!canEdit" @click="togglePolicyCheck(policy, check.id)">
                        {{ check.label }}
                      </button>
                    </span>
                  </td>
                  <td>
                    <span class="mon-interval">
                      <input class="mon-input mono" type="number" min="1" max="1440" :value="policy.intervalMinutes"
                             :disabled="!canEdit" aria-label="Minutos entre comprobaciones" @change="setPolicyInterval(policy, $event)">
                      <span class="mon-interval__unit">min</span>
                    </span>
                  </td>
                  <td>
                    <button type="button" class="mon-switch" :class="{ 'is-on': policy.enabled }"
                            :aria-pressed="policy.enabled" :disabled="!canEdit" @click="togglePolicyEnabled(policy)">
                      <span class="mon-switch__dot"></span>
                      {{ policy.enabled ? 'Activa' : 'Inactiva' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Umbrales</h3>
              <p class="mon-settings__sub">Valores compartidos por todas las categorías. El aviso es el primer nivel; el crítico genera alerta.</p>
            </div>
          </header>
          <div class="mon-table-wrap">
            <table class="mon-settings-table mon-settings-table--narrow">
              <thead>
                <tr>
                  <th scope="col">Comprobación</th>
                  <th scope="col">Aviso</th>
                  <th scope="col">Crítico</th>
                  <th scope="col">Unidad</th>
                  <th scope="col">Sentido</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="check in checks" :key="check.id">
                  <th scope="row">
                    <span class="mon-settings-table__name"><app-icon :name="check.icon"></app-icon> {{ check.label }}</span>
                    <span class="mon-settings-table__hint">{{ check.hint }}</span>
                  </th>
                  <td>
                    <input class="mon-input mono" type="number" step="0.1" :value="check.warn" :disabled="!canEdit"
                           :aria-label="'Umbral de aviso de ' + check.label" @change="setThreshold(check, 'warn', $event)">
                  </td>
                  <td>
                    <input class="mon-input mono" type="number" step="0.1" :value="check.crit" :disabled="!canEdit"
                           :aria-label="'Umbral crítico de ' + check.label" @change="setThreshold(check, 'crit', $event)">
                  </td>
                  <td class="mono">{{ check.unit }}</td>
                  <td class="mon-settings-table__direction">{{ check.direction === 'below' ? 'Por debajo' : 'Por encima' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Excepciones individuales</h3>
              <p class="mon-settings__sub">Un activo puede entrar o salir de la supervisión aunque su categoría no lo haga. Las computadoras de usuario se incorporan así.</p>
            </div>
          </header>

          <div class="mon-exception-form">
            <label class="field">
              <span class="field__label">Activo</span>
              <span class="select-field">
                <select v-model="draft.assetId" :disabled="!canEdit">
                  <option value="">Selecciona un activo</option>
                  <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">{{ asset.id }} · {{ asset.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Frecuencia</span>
              <span class="mon-interval">
                <input v-model.number="draft.intervalMinutes" class="mon-input mono" type="number" min="1" max="1440" :disabled="!canEdit">
                <span class="mon-interval__unit">min</span>
              </span>
            </label>
            <div class="field">
              <span class="field__label">Comprobaciones</span>
              <span class="mon-toggle-group">
                <button v-for="check in checks" :key="check.id" type="button" class="mon-toggle"
                        :class="{ 'is-on': hasCheck(draft.checkIds, check.id) }" :disabled="!canEdit"
                        :aria-pressed="hasCheck(draft.checkIds, check.id)" @click="toggleDraftCheck(check.id)">{{ check.label }}</button>
              </span>
            </div>
            <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="addException">
              <app-icon name="plus"></app-icon> Incorporar
            </button>
          </div>

          <div class="mon-table-wrap">
            <table class="mon-settings-table">
              <thead>
                <tr>
                  <th scope="col">Activo</th>
                  <th scope="col">Comprobaciones</th>
                  <th scope="col">Frecuencia</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="exception in exceptions" :key="exception.assetId">
                  <th scope="row">{{ assetName(exception.assetId) }}</th>
                  <td>
                    <span class="mon-tag-group">
                      <span v-for="id in exception.checkIds" :key="id" class="mon-tag">{{ checkLabel(id) }}</span>
                    </span>
                  </td>
                  <td class="mono">{{ exception.intervalMinutes }} min</td>
                  <td>
                    <button type="button" class="mon-switch" :class="{ 'is-on': exception.enabled }"
                            :aria-pressed="exception.enabled" :disabled="!canEdit" @click="toggleExceptionEnabled(exception)">
                      <span class="mon-switch__dot"></span>
                      {{ exception.enabled ? 'Activa' : 'Inactiva' }}
                    </button>
                  </td>
                  <td class="mon-settings-table__actions">
                    <button type="button" class="text-button text-button--quiet" :disabled="!canEdit" @click="removeException(exception)">Quitar</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!exceptions.length" class="empty-state">No hay excepciones: cada activo sigue la política de su categoría.</p>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Preferencias</h3>
              <p class="mon-settings__sub">Valores iniciales de las vistas de supervisión.</p>
            </div>
          </header>
          <div class="mon-prefs">
            <label class="field">
              <span class="field__label">Período inicial</span>
              <span class="select-field">
                <select :value="monitoring.prefs.range" :disabled="!canEdit" @change="savePrefs({ range: $event.target.value })">
                  <option v-for="range in ranges" :key="range.id" :value="range.id">{{ range.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Pestaña inicial</span>
              <span class="select-field">
                <select :value="monitoring.prefs.defaultTab" :disabled="!canEdit" @change="savePrefs({ defaultTab: $event.target.value })">
                  <option v-for="tab in tabs" :key="tab.id" :value="tab.id">{{ tab.label }}</option>
                </select>
              </span>
            </label>
            <label class="mon-check">
              <input type="checkbox" :checked="monitoring.prefs.showUnmonitored" :disabled="!canEdit"
                     @change="savePrefs({ showUnmonitored: $event.target.checked })">
              <span>Mostrar los equipos sin supervisión en la lista de dispositivos</span>
            </label>
            <label class="mon-check">
              <input type="checkbox" :checked="monitoring.prefs.autoRefresh" :disabled="!canEdit"
                     @change="savePrefs({ autoRefresh: $event.target.checked })">
              <span>Actualización automática de los indicadores cada {{ monitoring.prefs.refreshSeconds }} s</span>
            </label>
          </div>
        </div>
      </section>
    `
  };

  Views.AlertSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        silenceDraft: { scope: 'asset', target: '', hours: 4, reason: '' },
        windowDraft: { label: '', start: '01:00', end: '02:30', days: [1, 2, 3, 4, 5], categories: [], sites: [], reason: '', active: true }
      };
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      silences() { return this.monitoring.silences; },
      windows() { return this.monitoring.windows; },
      assets() { return (this.app.assets || []).filter((asset) => !asset.retired); },
      categories() { return this.app.categories || []; },
      sites() { return this.app.sites || []; },
      prefs() { return this.monitoring.prefs; },
      canEdit() { return this.app.can('assets.edit'); },
      dayLabels() { return DAY_LABELS; },
      silenceTargets() {
        return this.silenceDraft.scope === 'category' ? this.categories : this.assets;
      }
    },
    methods: {
      fmtDateTime: fmtDateTime,
      daysLabel: daysLabel,
      scopeLabel: scopeLabel,
      targetLabel(silence) {
        if (silence.scope === 'category') {
          const category = this.categories.find((item) => item.id === silence.target);
          return category ? category.label : silence.target;
        }
        const asset = this.assets.find((item) => item.id === silence.target);
        return asset ? asset.name : silence.target;
      },
      addSilence() {
        const result = M.addSilence(this.monitoring, this.silenceDraft, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        if (!result.ok) {
          this.app.showToast(result.errors[0]);
          return;
        }
        this.app.showToast('Silenciamiento programado.');
        this.silenceDraft = { scope: 'asset', target: '', hours: 4, reason: '' };
      },
      removeSilence(silence) {
        const result = M.removeSilence(this.monitoring, silence.id);
        this.app.showToast(result.ok ? 'Silenciamiento eliminado.' : result.errors[0]);
      },
      toggleDay(day) {
        this.windowDraft.days = this.windowDraft.days.indexOf(day) === -1
          ? this.windowDraft.days.concat([day])
          : this.windowDraft.days.filter((item) => item !== day);
      },
      toggleWindowCategory(id) {
        this.windowDraft.categories = this.windowDraft.categories.indexOf(id) === -1
          ? this.windowDraft.categories.concat([id])
          : this.windowDraft.categories.filter((item) => item !== id);
      },
      addWindow() {
        const result = M.saveWindow(this.monitoring, this.windowDraft);
        if (!result.ok) {
          this.app.showToast(result.errors[0]);
          return;
        }
        this.app.showToast('Ventana de mantenimiento creada.');
        this.windowDraft = { label: '', start: '01:00', end: '02:30', days: [1, 2, 3, 4, 5], categories: [], sites: [], reason: '', active: true };
      },
      toggleWindowActive(window) {
        const result = M.saveWindow(this.monitoring, Object.assign({}, window, { active: !window.active }));
        this.app.showToast(result.ok ? 'Ventana ' + (window.active ? 'activada' : 'desactivada') + '.' : result.errors[0]);
      },
      removeWindow(window) {
        const result = M.removeWindow(this.monitoring, window.id);
        this.app.showToast(result.ok ? 'Ventana eliminada.' : result.errors[0]);
      },
      savePrefs(payload) {
        M.savePrefs(this.monitoring, payload);
      },
      windowCategoryLabel(id) {
        const category = this.categories.find((item) => item.id === id);
        return category ? category.label : id;
      }
    },
    template: `
      <section class="config-section mon-settings" data-od-id="alert-settings" aria-labelledby="config-alerts-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Operación técnica</p>
            <h2 id="config-alerts-title">Alertas</h2>
            <p class="config-section__lead">Silenciamientos, ventanas de mantenimiento y agrupación de eventos. Las ventanas no ocultan la alerta: solo detienen los avisos externos mientras dura el trabajo.</p>
          </div>
          <span class="chip chip--muted">{{ silences.length }} silencios · {{ windows.length }} ventanas</span>
        </header>

        <p v-if="!canEdit" class="mon-lock">Tu rol puede consultar la configuración, pero no modificarla.</p>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Silenciamientos</h3>
              <p class="mon-settings__sub">Un silencio detiene los avisos de un dispositivo o de una categoría completa hasta su fecha de fin.</p>
            </div>
          </header>

          <div class="mon-exception-form mon-exception-form--silence">
            <label class="field">
              <span class="field__label">Alcance</span>
              <span class="select-field">
                <select v-model="silenceDraft.scope" :disabled="!canEdit">
                  <option value="asset">Dispositivo</option>
                  <option value="category">Categoría</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Destino</span>
              <span class="select-field">
                <select v-model="silenceDraft.target" :disabled="!canEdit">
                  <option value="">Selecciona</option>
                  <option v-for="item in silenceTargets" :key="item.id" :value="item.id">{{ item.name || item.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Duración</span>
              <span class="mon-interval">
                <input v-model.number="silenceDraft.hours" class="mon-input mono" type="number" min="1" max="720" :disabled="!canEdit">
                <span class="mon-interval__unit">h</span>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Motivo</span>
              <input v-model="silenceDraft.reason" type="text" maxlength="200" :disabled="!canEdit" placeholder="Trabajo programado, revisión física…">
            </label>
            <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="addSilence">
              <app-icon name="slash"></app-icon> Silenciar
            </button>
          </div>

          <div class="mon-table-wrap">
            <table class="mon-settings-table">
              <thead>
                <tr>
                  <th scope="col">Alcance</th>
                  <th scope="col">Destino</th>
                  <th scope="col">Hasta</th>
                  <th scope="col">Motivo</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="silence in silences" :key="silence.id">
                  <th scope="row">{{ scopeLabel(silence.scope) }}</th>
                  <td>{{ targetLabel(silence) }}</td>
                  <td class="mono">{{ fmtDateTime(silence.until) }}</td>
                  <td class="mon-settings-table__hint">{{ silence.reason || 'Sin motivo indicado' }}</td>
                  <td class="mon-settings-table__actions">
                    <button type="button" class="text-button text-button--quiet" :disabled="!canEdit" @click="removeSilence(silence)">Quitar</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!silences.length" class="empty-state">No hay silenciamientos programados.</p>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Ventanas de mantenimiento</h3>
              <p class="mon-settings__sub">Bloquean los envíos externos en el horario indicado. Las alertas siguen visibles y escalan cuando la ventana termina.</p>
            </div>
          </header>

          <div class="mon-window-form">
            <label class="field">
              <span class="field__label">Nombre</span>
              <input v-model="windowDraft.label" type="text" maxlength="60" :disabled="!canEdit" placeholder="Respaldo nocturno">
            </label>
            <div class="mon-window-form__times">
              <label class="field">
                <span class="field__label">Desde</span>
                <input v-model="windowDraft.start" class="mon-input mono" type="time" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">Hasta</span>
                <input v-model="windowDraft.end" class="mon-input mono" type="time" :disabled="!canEdit">
              </label>
            </div>
            <div class="field">
              <span class="field__label">Días</span>
              <span class="mon-toggle-group">
                <button v-for="(label, index) in dayLabels" :key="label + index" type="button" class="mon-toggle mon-toggle--day"
                        :class="{ 'is-on': windowDraft.days.indexOf(index) !== -1 }" :aria-pressed="windowDraft.days.indexOf(index) !== -1"
                        :disabled="!canEdit" @click="toggleDay(index)">{{ label }}</button>
              </span>
            </div>
            <div class="field">
              <span class="field__label">Categorías afectadas</span>
              <span class="mon-toggle-group">
                <button v-for="category in categories" :key="category.id" type="button" class="mon-toggle"
                        :class="{ 'is-on': windowDraft.categories.indexOf(category.id) !== -1 }"
                        :aria-pressed="windowDraft.categories.indexOf(category.id) !== -1"
                        :disabled="!canEdit" @click="toggleWindowCategory(category.id)">{{ category.label }}</button>
              </span>
              <span class="field__hint">Sin selección, la ventana aplica a todo el parque.</span>
            </div>
            <label class="field">
              <span class="field__label">Motivo</span>
              <input v-model="windowDraft.reason" type="text" maxlength="200" :disabled="!canEdit">
            </label>
            <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="addWindow">
              <app-icon name="plus"></app-icon> Crear ventana
            </button>
          </div>

          <div class="mon-table-wrap">
            <table class="mon-settings-table">
              <thead>
                <tr>
                  <th scope="col">Ventana</th>
                  <th scope="col">Horario</th>
                  <th scope="col">Días</th>
                  <th scope="col">Alcance</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="window in windows" :key="window.id" :class="{ 'is-off': !window.active }">
                  <th scope="row">
                    {{ window.label }}
                    <span class="mon-settings-table__hint">{{ window.reason }}</span>
                  </th>
                  <td class="mono">{{ window.start }} – {{ window.end }}</td>
                  <td class="mono">{{ daysLabel(window.days) }}</td>
                  <td>
                    <span v-if="window.categories.length" class="mon-tag-group">
                      <span v-for="id in window.categories" :key="id" class="mon-tag">{{ windowCategoryLabel(id) }}</span>
                    </span>
                    <span v-else class="cell-muted">Todo el parque</span>
                  </td>
                  <td>
                    <button type="button" class="mon-switch" :class="{ 'is-on': window.active }" :aria-pressed="window.active"
                            :disabled="!canEdit" @click="toggleWindowActive(window)">
                      <span class="mon-switch__dot"></span>
                      {{ window.active ? 'Activa' : 'Inactiva' }}
                    </button>
                  </td>
                  <td class="mon-settings-table__actions">
                    <button type="button" class="text-button text-button--quiet" :disabled="!canEdit" @click="removeWindow(window)">Quitar</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Preferencias de alertas</h3>
              <p class="mon-settings__sub">Cómo se agrupan y se destacan los eventos en las vistas operativas.</p>
            </div>
          </header>
          <div class="mon-prefs">
            <label class="mon-check">
              <input type="checkbox" :checked="prefs.groupRepeats" :disabled="!canEdit" @change="savePrefs({ groupRepeats: $event.target.checked })">
              <span>Agrupar los eventos repetidos de una misma condición en una sola alerta</span>
            </label>
            <label class="mon-check">
              <input type="checkbox" :checked="prefs.highlightIntermittent" :disabled="!canEdit" @change="savePrefs({ highlightIntermittent: $event.target.checked })">
              <span>Destacar los fallos intermitentes con más de un corte</span>
            </label>
          </div>
        </div>
      </section>
    `
  };

  Views.NotificationSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        editing: null,
        ruleDraft: {
          id: '', label: '', severity: '', categories: [], sites: [], channels: ['smtp'],
          afterMinutes: 15, window: 'always', requireUnack: true, recipients: '', enabled: true
        },
        consultedAlertId: ''
      };
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      channels() { return this.monitoring.channels; },
      rules() { return this.monitoring.escalations; },
      prefs() { return this.monitoring.prefs; },
      assets() { return (this.app.assets || []).filter((asset) => !asset.retired); },
      alerts() { return (this.app.maintenance && this.app.maintenance.alerts) || []; },
      activeAlerts() { return this.alerts.filter((alert) => alert.state === 'open'); },
      canEdit() { return this.app.can('config.integrations'); },
      categories() { return this.app.categories || []; },
      days() { return DAY_LABELS; },
      smtpState() { return M.channelState(this.monitoring, 'smtp'); },
      telegramState() { return M.channelState(this.monitoring, 'telegram'); },
      sampleAlert() {
        return this.alerts.find((alert) => alert.id === this.consultedAlertId)
          || this.activeAlerts[0]
          || this.alerts[0]
          || null;
      },
      smtpPreview() {
        return this.sampleAlert ? M.preview(this.monitoring, 'smtp', this.sampleAlert, this.app.assets) : null;
      },
      telegramPreview() {
        return this.sampleAlert ? M.preview(this.monitoring, 'telegram', this.sampleAlert, this.app.assets) : null;
      },
      consultedPlan() {
        return this.sampleAlert ? M.escalationPlan(this.monitoring, this.sampleAlert, this.app.assets, Date.now()) : null;
      },
      activeRuleCount() {
        return this.rules.filter((rule) => rule.enabled).length;
      }
    },
    methods: {
      fmtDateTime: fmtDateTime,
      daysLabel: daysLabel,
      channelStatusLabel(state) {
        if (!state.configured) return 'Sin configurar';
        if (!state.enabled) return 'Desactivado';
        return 'Listo para enviar';
      },
      channelTone(state) {
        if (!state.configured) return 'neutral';
        if (!state.enabled) return 'warn';
        return 'ok';
      },
      saveSmtp() {
        const result = M.saveChannel(this.monitoring, 'smtp', this.channels.smtp);
        this.app.showToast(result.ok ? 'Preferencias de correo guardadas.' : result.errors[0]);
      },
      saveTelegram() {
        const result = M.saveChannel(this.monitoring, 'telegram', this.channels.telegram);
        this.app.showToast(result.ok ? 'Preferencias de Telegram guardadas.' : result.errors[0]);
      },
      toggleSmtp() {
        const next = !this.channels.smtp.enabled;
        const result = M.saveChannel(this.monitoring, 'smtp', Object.assign({}, this.channels.smtp, { enabled: next }));
        this.app.showToast(result.ok ? (next ? 'Correo activado.' : 'Correo desactivado.') : result.errors[0]);
      },
      toggleTelegram() {
        const next = !this.channels.telegram.enabled;
        const result = M.saveChannel(this.monitoring, 'telegram', Object.assign({}, this.channels.telegram, { enabled: next }));
        this.app.showToast(result.ok ? (next ? 'Telegram activado.' : 'Telegram desactivado.') : result.errors[0]);
      },
      testChannel(id) {
        const result = M.testChannel(this.monitoring, id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok ? 'Mensaje de prueba simulado. No sale ninguna comunicación real.' : result.errors[0]);
      },
      toggleDraft(list, id) {
        const next = list.indexOf(id) === -1 ? list.concat([id]) : list.filter((item) => item !== id);
        return next;
      },
      toggleChannel(id) {
        this.ruleDraft.channels = this.toggleDraft(this.ruleDraft.channels, id);
      },
      toggleCategory(id) {
        this.ruleDraft.categories = this.toggleDraft(this.ruleDraft.categories, id);
      },
      editRule(rule) {
        this.editing = rule.id;
        this.ruleDraft = Object.assign({}, rule, {
          categories: rule.categories.slice(),
          sites: rule.sites.slice(),
          channels: rule.channels.slice()
        });
      },
      resetRule() {
        this.editing = null;
        this.ruleDraft = {
          id: '', label: '', severity: '', categories: [], sites: [], channels: ['smtp'],
          afterMinutes: 15, window: 'always', requireUnack: true, recipients: '', enabled: true
        };
      },
      saveRule() {
        const result = M.saveEscalation(this.monitoring, this.ruleDraft);
        if (!result.ok) {
          this.app.showToast(result.errors[0]);
          return;
        }
        this.app.showToast(this.editing ? 'Regla actualizada.' : 'Regla creada.');
        this.resetRule();
      },
      toggleRule(rule) {
        const result = M.saveEscalation(this.monitoring, Object.assign({}, rule, { enabled: !rule.enabled }));
        this.app.showToast(result.ok ? 'Regla ' + (rule.enabled ? 'activada' : 'desactivada') + '.' : result.errors[0]);
      },
      removeRule(rule) {
        const result = M.removeEscalation(this.monitoring, rule.id);
        this.app.showToast(result.ok ? 'Regla eliminada.' : result.errors[0]);
      },
      restoreRules() {
        M.restoreEscalations(this.monitoring);
        this.app.showToast('Reglas de escalamiento restauradas a los valores iniciales.');
      },
      savePrefs(payload) {
        M.savePrefs(this.monitoring, payload);
      },
      toggleBusinessDay(day) {
        const days = this.prefs.businessHours.days.indexOf(day) === -1
          ? this.prefs.businessHours.days.concat([day])
          : this.prefs.businessHours.days.filter((item) => item !== day);
        this.savePrefs({ businessHours: Object.assign({}, this.prefs.businessHours, { days: days }) });
      },
      planStatusLabel(item) {
        const labels = {
          sent: 'Enviada', scheduled: 'Programada', window: 'Bloqueada por ventana', silenced: 'Bloqueada por silencio',
          channel: 'Canal sin configurar', disabled: 'Canal desactivado', acknowledged: 'Omitida por reconocimiento',
          skipped: 'No aplica', closed: 'Alerta cerrada'
        };
        return labels[item.status] || item.status;
      },
      severityLabel(severity) {
        if (!severity) return 'Cualquiera';
        return M.severityMeta(severity).label;
      },
      windowLabel(value) {
        if (value === 'business') return 'Horario laboral';
        if (value === 'after_hours') return 'Fuera de horario';
        return 'Siempre';
      },
      channelLabel(id) { return M.channelMeta(id).label; },
      categoriesLabel(list) {
        if (!list.length) return 'Todas las categorías';
        return list.map((id) => {
          const category = this.categories.find((item) => item.id === id);
          return category ? category.label : id;
        }).join(', ');
      }
    },
    template: `
      <section class="config-section mon-settings" data-od-id="notification-settings" aria-labelledby="config-notif-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Operación técnica</p>
            <h2 id="config-notif-title">Notificaciones</h2>
            <p class="config-section__lead">Canales externos opcionales y reglas de escalamiento. Nada sale de la aplicación: la configuración es simulada y las vistas previas muestran el mensaje que se enviaría.</p>
          </div>
          <span class="chip chip--muted">{{ activeRuleCount }} reglas activas</span>
        </header>

        <p v-if="!canEdit" class="mon-lock">Tu rol puede consultar la configuración, pero no modificarla.</p>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Correo SMTP</h3>
              <p class="mon-settings__sub">Remitente, destinatarios y plantilla del mensaje.</p>
            </div>
            <div class="mon-settings__actions">
              <span class="mon-tag" :class="'mon-tag--' + channelTone(smtpState)">{{ channelStatusLabel(smtpState) }}</span>
              <button type="button" class="mon-switch" :class="{ 'is-on': channels.smtp.enabled }"
                      :aria-pressed="channels.smtp.enabled" :disabled="!canEdit" @click="toggleSmtp">
                <span class="mon-switch__dot"></span>{{ channels.smtp.enabled ? 'Activo' : 'Inactivo' }}
              </button>
            </div>
          </header>

          <div class="mon-channel">
            <div class="mon-channel__form">
              <div class="form-grid--two">
                <label class="field">
                  <span class="field__label">Servidor</span>
                  <input v-model="channels.smtp.host" type="text" :disabled="!canEdit" placeholder="smtp.example.invalid">
                </label>
                <label class="field">
                  <span class="field__label">Puerto</span>
                  <input v-model.number="channels.smtp.port" class="mon-input mono" type="number" min="1" max="65535" :disabled="!canEdit">
                </label>
              </div>
              <div class="form-grid--two">
                <label class="field">
                  <span class="field__label">Remitente</span>
                  <input v-model="channels.smtp.from" type="email" :disabled="!canEdit" placeholder="noc@example.invalid">
                </label>
                <label class="field">
                  <span class="field__label">Nombre visible</span>
                  <input v-model="channels.smtp.fromName" type="text" :disabled="!canEdit">
                </label>
              </div>
              <label class="field">
                <span class="field__label">Destinatarios</span>
                <input v-model="channels.smtp.recipients" type="text" :disabled="!canEdit" placeholder="guardia@example.invalid; soporte@example.invalid">
                <span class="field__hint">Separados por punto y coma.</span>
              </label>
              <label class="field">
                <span class="field__label">Asunto</span>
                <input v-model="channels.smtp.subject" type="text" :disabled="!canEdit">
                <span class="field__hint">Variables disponibles: {severity}, {asset}, {site}, {title}, {message}, {detectedAt}, {state}, {link}.</span>
              </label>
              <label class="field">
                <span class="field__label">Plantilla del cuerpo</span>
                <textarea v-model="channels.smtp.template" rows="6" :disabled="!canEdit"></textarea>
              </label>
              <label class="mon-check">
                <input type="checkbox" v-model="channels.smtp.secure" :disabled="!canEdit">
                <span>Conexión cifrada (STARTTLS)</span>
              </label>
              <div class="mon-channel__actions">
                <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="saveSmtp">Guardar</button>
                <button type="button" class="btn btn--ghost" :disabled="!canEdit" @click="testChannel('smtp')">Enviar prueba</button>
                <span v-if="channels.smtp.lastTestAt" class="mon-channel__note mono">{{ fmtDateTime(channels.smtp.lastTestAt) }} · {{ channels.smtp.lastTestResult === 'ok' ? 'prueba correcta' : 'error de prueba' }}</span>
              </div>
            </div>
            <div v-if="smtpPreview" class="mon-preview">
              <p class="mon-preview__head"><app-icon name="mail"></app-icon> Representación del mensaje</p>
              <p class="mon-preview__line"><span>De</span> {{ smtpPreview.from }}</p>
              <p class="mon-preview__line"><span>Para</span> {{ smtpPreview.to }}</p>
              <p class="mon-preview__line"><span>Asunto</span> {{ smtpPreview.subject }}</p>
              <pre class="mon-preview__body">{{ smtpPreview.body }}</pre>
            </div>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Telegram Bot</h3>
              <p class="mon-settings__sub">Bot, destinatarios y presentación del mensaje. El token es de demostración.</p>
            </div>
            <div class="mon-settings__actions">
              <span class="mon-tag" :class="'mon-tag--' + channelTone(telegramState)">{{ channelStatusLabel(telegramState) }}</span>
              <button type="button" class="mon-switch" :class="{ 'is-on': channels.telegram.enabled }"
                      :aria-pressed="channels.telegram.enabled" :disabled="!canEdit" @click="toggleTelegram">
                <span class="mon-switch__dot"></span>{{ channels.telegram.enabled ? 'Activo' : 'Inactivo' }}
              </button>
            </div>
          </header>

          <div class="mon-channel">
            <div class="mon-channel__form">
              <div class="form-grid--two">
                <label class="field">
                  <span class="field__label">Nombre del bot</span>
                  <input v-model="channels.telegram.botName" type="text" :disabled="!canEdit" placeholder="noc_bot">
                </label>
                <label class="field">
                  <span class="field__label">Token</span>
                  <input v-model="channels.telegram.token" type="text" :disabled="!canEdit" placeholder="000000:AAF-DEMO">
                </label>
              </div>
              <label class="field">
                <span class="field__label">Chats o grupos</span>
                <input v-model="channels.telegram.chatIds" type="text" :disabled="!canEdit" placeholder="-1001234567890; 482119034">
                <span class="field__hint">Separados por punto y coma.</span>
              </label>
              <div class="form-grid--two">
                <label class="field">
                  <span class="field__label">Formato</span>
                  <span class="select-field">
                    <select v-model="channels.telegram.parseMode" :disabled="!canEdit">
                      <option value="Markdown">Markdown</option>
                      <option value="HTML">HTML</option>
                      <option value="Texto">Texto plano</option>
                    </select>
                  </span>
                </label>
                <label class="field">
                  <span class="field__label">Última prueba</span>
                  <input :value="channels.telegram.lastTestAt ? fmtDateTime(channels.telegram.lastTestAt) : 'Sin pruebas'" type="text" readonly>
                </label>
              </div>
              <label class="field">
                <span class="field__label">Plantilla del mensaje</span>
                <textarea v-model="channels.telegram.template" rows="5" :disabled="!canEdit"></textarea>
              </label>
              <div class="mon-channel__actions">
                <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="saveTelegram">Guardar</button>
                <button type="button" class="btn btn--ghost" :disabled="!canEdit" @click="testChannel('telegram')">Enviar prueba</button>
                <span class="mon-channel__note">Los canales son opcionales: el escalamiento puede quedar desactivado hasta configurarlos.</span>
              </div>
            </div>
            <div v-if="telegramPreview" class="mon-preview mon-preview--chat">
              <p class="mon-preview__head"><app-icon name="send"></app-icon> Representación en Telegram</p>
              <p class="mon-preview__line"><span>Bot</span> {{ telegramPreview.bot }}</p>
              <p class="mon-preview__line"><span>Chats</span> {{ telegramPreview.chat }}</p>
              <pre class="mon-preview__body mon-preview__body--chat">{{ telegramPreview.body }}</pre>
            </div>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Reglas de escalamiento</h3>
              <p class="mon-settings__sub">Severidad, horario, categoría y tiempo sin reconocimiento definen a quién se avisa y cuándo.</p>
            </div>
            <button type="button" class="text-button" :disabled="!canEdit" @click="restoreRules">Restaurar valores iniciales</button>
          </header>

          <div class="mon-table-wrap">
            <table class="mon-settings-table">
              <thead>
                <tr>
                  <th scope="col">Regla</th>
                  <th scope="col">Condición</th>
                  <th scope="col">Espera</th>
                  <th scope="col">Canales</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in rules" :key="rule.id" :class="{ 'is-off': !rule.enabled }">
                  <th scope="row">
                    {{ rule.label }}
                    <span class="mon-settings-table__hint">{{ severityLabel(rule.severity) }} · {{ windowLabel(rule.window) }}<span v-if="rule.requireUnack"> · solo sin reconocer</span></span>
                  </th>
                  <td class="mon-settings-table__hint">{{ categoriesLabel(rule.categories) }}</td>
                  <td class="mono">{{ rule.afterMinutes === 0 ? 'Inmediato' : rule.afterMinutes + ' min' }}</td>
                  <td>
                    <span class="mon-tag-group">
                      <span v-for="id in rule.channels" :key="id" class="mon-tag">{{ channelLabel(id) }}</span>
                    </span>
                  </td>
                  <td>
                    <button type="button" class="mon-switch" :class="{ 'is-on': rule.enabled }" :aria-pressed="rule.enabled"
                            :disabled="!canEdit" @click="toggleRule(rule)">
                      <span class="mon-switch__dot"></span>{{ rule.enabled ? 'Activa' : 'Inactiva' }}
                    </button>
                  </td>
                  <td class="mon-settings-table__actions">
                    <button type="button" class="text-button" :disabled="!canEdit" @click="editRule(rule)">Editar</button>
                    <button type="button" class="text-button text-button--quiet" :disabled="!canEdit" @click="removeRule(rule)">Quitar</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mon-rule-form">
            <p class="mon-rule-form__title">{{ editing ? 'Editar regla' : 'Nueva regla' }}</p>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Nombre</span>
                <input v-model="ruleDraft.label" type="text" maxlength="60" :disabled="!canEdit" placeholder="Altas sin reconocer">
              </label>
              <label class="field">
                <span class="field__label">Severidad</span>
                <span class="select-field">
                  <select v-model="ruleDraft.severity" :disabled="!canEdit">
                    <option value="">Cualquiera</option>
                    <option value="critica">Crítica</option>
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Espera sin reconocimiento</span>
                <span class="mon-interval">
                  <input v-model.number="ruleDraft.afterMinutes" class="mon-input mono" type="number" min="0" max="10080" :disabled="!canEdit">
                  <span class="mon-interval__unit">min</span>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Horario</span>
                <span class="select-field">
                  <select v-model="ruleDraft.window" :disabled="!canEdit">
                    <option value="always">Siempre</option>
                    <option value="business">Horario laboral</option>
                    <option value="after_hours">Fuera de horario</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="field">
              <span class="field__label">Canales</span>
              <span class="mon-toggle-group">
                <button v-for="id in ['smtp', 'telegram']" :key="id" type="button" class="mon-toggle"
                        :class="{ 'is-on': ruleDraft.channels.indexOf(id) !== -1 }" :aria-pressed="ruleDraft.channels.indexOf(id) !== -1"
                        :disabled="!canEdit" @click="toggleChannel(id)">{{ channelLabel(id) }}</button>
              </span>
            </div>
            <div class="field">
              <span class="field__label">Categorías</span>
              <span class="mon-toggle-group">
                <button v-for="category in categories" :key="category.id" type="button" class="mon-toggle"
                        :class="{ 'is-on': ruleDraft.categories.indexOf(category.id) !== -1 }"
                        :aria-pressed="ruleDraft.categories.indexOf(category.id) !== -1"
                        :disabled="!canEdit" @click="toggleCategory(category.id)">{{ category.label }}</button>
              </span>
              <span class="field__hint">Sin selección, la regla aplica a todas las categorías.</span>
            </div>
            <label class="field">
              <span class="field__label">Destinatarios adicionales</span>
              <input v-model="ruleDraft.recipients" type="text" maxlength="300" :disabled="!canEdit" placeholder="opcional">
            </label>
            <div class="mon-rule-form__checks">
              <label class="mon-check">
                <input type="checkbox" v-model="ruleDraft.requireUnack" :disabled="!canEdit">
                <span>Enviar solo si la alerta sigue sin reconocer</span>
              </label>
              <label class="mon-check">
                <input type="checkbox" v-model="ruleDraft.enabled" :disabled="!canEdit">
                <span>Regla activa</span>
              </label>
            </div>
            <div class="mon-channel__actions">
              <button type="button" class="btn btn--secondary" :disabled="!canEdit" @click="saveRule">{{ editing ? 'Guardar cambios' : 'Crear regla' }}</button>
              <button v-if="editing" type="button" class="btn btn--ghost" @click="resetRule">Cancelar</button>
            </div>
          </div>
        </div>

        <div class="mon-settings__block">
          <header class="mon-settings__head">
            <div>
              <h3 class="mon-settings__title">Consulta de escalamiento</h3>
              <p class="mon-settings__sub">Elige una alerta para ver qué se enviaría y cuál sería el siguiente aviso.</p>
            </div>
            <label class="mon-consult">
              <span class="sr-only">Alerta a consultar</span>
              <span class="select-field">
                <select v-model="consultedAlertId">
                  <option value="">Alerta más reciente</option>
                  <option v-for="alert in alerts" :key="alert.id" :value="alert.id">{{ alert.id }} · {{ alert.message.slice(0, 42) }}</option>
                </select>
              </span>
            </label>
          </header>

          <ul v-if="consultedPlan" class="mon-plan mon-plan--compact">
            <li v-for="item in consultedPlan.items" :key="item.rule.id" class="mon-plan__item">
              <div class="mon-plan__head">
                <span class="mon-plan__label">{{ item.rule.label }}</span>
                <span class="mon-tag">{{ planStatusLabel(item) }}</span>
              </div>
              <p class="mon-plan__meta">
                {{ item.rule.afterMinutes === 0 ? 'Inmediato' : 'A los ' + item.rule.afterMinutes + ' min' }} ·
                {{ item.channels.map(channel => channel.label).join(' + ') }} · {{ fmtDateTime(item.at) }}
              </p>
            </li>
          </ul>

          <div class="mon-prefs">
            <div class="field">
              <span class="field__label">Horario laboral para las reglas</span>
              <div class="mon-hours">
                <label class="mon-hours__field">
                  <span>Desde</span>
                  <input class="mon-input mono" type="time" :value="prefs.businessHours.from" :disabled="!canEdit"
                         @change="savePrefs({ businessHours: Object.assign({}, prefs.businessHours, { from: $event.target.value }) })">
                </label>
                <label class="mon-hours__field">
                  <span>Hasta</span>
                  <input class="mon-input mono" type="time" :value="prefs.businessHours.to" :disabled="!canEdit"
                         @change="savePrefs({ businessHours: Object.assign({}, prefs.businessHours, { to: $event.target.value }) })">
                </label>
                <span class="mon-toggle-group">
                  <button v-for="(label, index) in days" :key="label + index" type="button" class="mon-toggle mon-toggle--day"
                          :class="{ 'is-on': prefs.businessHours.days.indexOf(index) !== -1 }"
                          :aria-pressed="prefs.businessHours.days.indexOf(index) !== -1"
                          :disabled="!canEdit" @click="toggleBusinessDay(index)">{{ label }}</button>
                </span>
              </div>
              <span class="field__hint">Sin turnos ni rotaciones: el horario solo decide cuándo aplica una regla.</span>
            </div>
          </div>
        </div>
      </section>
    `
  };
})();
