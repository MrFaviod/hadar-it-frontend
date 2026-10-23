(function () {
  'use strict';

  const Mapping = window.AssetMonitoringApiMapping;
  const Views = window.Views = window.Views || {};
  const DAYS = [
    { id: 0, label: 'L' }, { id: 1, label: 'M' }, { id: 2, label: 'X' }, { id: 3, label: 'J' },
    { id: 4, label: 'V' }, { id: 5, label: 'S' }, { id: 6, label: 'D' }
  ];
  const METRIC_LABELS = { latency: 'Latencia', cpu: 'CPU', memory: 'Memoria', disk: 'Disco', temperature: 'Temperatura' };
  const PROFILE_KEYS = ['enabled', 'checkType', 'intervalSeconds', 'metrics', 'thresholds', 'minimumDurationSeconds', 'exporterId', 'snmpModule', 'snmpAuthRef'];

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function numOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function idsFromText(value) {
    return text(value).split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  }

  function hasRawSecret(input) {
    if (!input || typeof input !== 'object') return false;
    return ['token', 'password', 'secret', 'webhook', 'webhookUrl', 'url'].some((key) => Object.prototype.hasOwnProperty.call(input, key));
  }

  function profileForm(profile) {
    return {
      category: profile ? profile.category : '',
      enabled: profile ? !!profile.enabled : false,
      checkType: profile ? profile.checkType || '' : '',
      intervalSeconds: profile ? profile.intervalSeconds : 60,
      metrics: profile ? profile.metrics.slice() : ['latency'],
      thresholds: profile && profile.thresholds ? JSON.parse(JSON.stringify(profile.thresholds)) : {},
      minimumDurationSeconds: profile ? profile.minimumDurationSeconds : 300,
      exporterId: profile ? profile.exporterId || '' : '',
      snmpModule: profile ? profile.snmpModule || '' : '',
      snmpAuthRef: profile ? profile.snmpAuthRef || '' : ''
    };
  }

  function assetForm() {
    return {
      assetId: '', enabled: '', checkType: '', target: '', intervalSeconds: '', metrics: [],
      thresholds: {}, minimumDurationSeconds: '', exporterId: '', snmpModule: '', snmpAuthRef: ''
    };
  }

  function windowForm(window) {
    return {
      id: window ? window.id : '',
      name: window ? window.name || '' : '',
      assetIds: window ? (window.assetIds || []).slice() : [],
      assetIdsText: '',
      daysOfWeek: window && window.daysOfWeek && window.daysOfWeek.length ? window.daysOfWeek.slice() : [0, 1, 2, 3, 4],
      startTime: window ? window.startTime || '22:00' : '22:00',
      endTime: window ? window.endTime || '23:00' : '23:00',
      timezone: window ? window.timezone || 'Europe/Madrid' : 'Europe/Madrid',
      enabled: window ? window.enabled !== false : true
    };
  }

  function ruleForm(rule) {
    return {
      id: rule ? rule.id : '',
      name: rule ? rule.name || '' : '',
      enabled: rule ? rule.enabled !== false : true,
      minimumSeverity: rule ? rule.minimumSeverity || 'info' : 'info',
      recipientIds: rule ? (rule.recipientIds || []).join(', ') : '',
      channelIds: rule ? (rule.channelIds || []).slice() : [],
      escalationRecipientIds: rule ? (rule.escalationRecipientIds || []).join(', ') : '',
      scheduleEnabled: !!(rule && rule.schedule),
      timezone: rule && rule.schedule ? rule.schedule.timezone || 'Europe/Madrid' : 'Europe/Madrid',
      start: rule && rule.schedule ? rule.schedule.start || '22:00' : '22:00',
      end: rule && rule.schedule ? rule.schedule.end || '06:00' : '06:00',
      acknowledgeAfterSeconds: rule ? rule.acknowledgeAfterSeconds : 900,
      retryIntervalSeconds: rule ? rule.retryIntervalSeconds : 60,
      escalateAfterSeconds: rule ? rule.escalateAfterSeconds : 0,
      maxAttempts: rule ? rule.maxAttempts : 3
    };
  }

  function channelForm(channel) {
    return {
      id: channel ? channel.id : '',
      kind: channel ? channel.kind : 'internal',
      name: channel ? channel.name || '' : '',
      enabled: channel ? channel.enabled !== false : true,
      secretRef: channel ? channel.secretRef || '' : '',
      subjectPrefix: channel && channel.config ? channel.config.subjectPrefix || '' : '',
      chatId: channel && channel.config ? channel.config.chatId || '' : ''
    };
  }

  function metricOptions(presets) {
    return (presets && presets.metrics && presets.metrics.length)
      ? presets.metrics
      : Object.keys(METRIC_LABELS).map((id) => ({ id, label: METRIC_LABELS[id], unit: '' }));
  }

  // ---------------------------------------------------------------- monitoring
  Views.MonitoringSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        tab: 'categories',
        profile: profileForm(null),
        selectedCategory: '',
        override: assetForm(),
        exporter: { name: '', kind: 'blackbox', module: 'icmp', address: '', enabled: true },
        busy: false,
        error: '',
        notice: ''
      };
    },
    computed: {
      canProfiles() { return this.app.monitoringConfigurable; },
      canExporters() { return this.app.monitoringIntegrations; },
      canAssets() { return this.app.monitoringEditable; },
      config() { return this.app.monitoringConfig; },
      loading() { return this.app.monitoringConfigLoading; },
      profiles() { return this.app.monitoringProfiles; },
      exporters() { return this.app.monitoringExporters; },
      presets() { return this.app.monitoringPresets; },
      metrics() { return metricOptions(this.presets); },
      checkTypes() {
        const presets = this.presets.checkTypes;
        return presets && presets.length
          ? presets
          : ['icmp', 'http', 'tcp', 'dns', 'snmp', 'node', 'windows'].map((id) => ({ id, label: Mapping.checkMeta(id).label }));
      },
      intervals() {
        return this.presets.intervals && this.presets.intervals.length ? this.presets.intervals : [30, 60, 300];
      },
      durations() {
        return this.presets.minimumDurations && this.presets.minimumDurations.length ? this.presets.minimumDurations : [0, 60, 300, 900];
      },
      categories() {
        return (this.app.categories || []).map((category) => ({ id: category.id, name: category.name }));
      },
      assets() {
        return this.app.monitoringAssets.map((asset) => ({
          id: asset.id,
          label: (asset.name || asset.id) + ' · ' + (asset.quickCode || asset.id)
        }));
      },
      tabs() {
        return [
          { id: 'categories', label: 'Categorías' },
          { id: 'assets', label: 'Excepciones' },
          { id: 'exporters', label: 'Exportadores' }
        ];
      }
    },
    watch: {
      profiles: {
        handler() {
          if (!this.selectedCategory && this.profiles.length) this.selectProfile(this.profiles[0].category);
        }
      }
    },
    async mounted() {
      if (this.app.monitoringAvailable) await Promise.all([this.app.loadMonitoringConfig(), this.app.loadMonitoringAssetDirectory()]);
      if (this.profiles.length && !this.selectedCategory) this.selectProfile(this.profiles[0].category);
    },
    methods: {
      fmtValue(value, unit) {
        if (value === null || value === undefined || value === '') return '—';
        return String(value) + (unit ? ' ' + unit : '');
      },
      profileFor(category) {
        return this.profiles.find((profile) => profile.category === category) || null;
      },
      selectProfile(category) {
        const profile = this.profileFor(category);
        this.selectedCategory = category;
        this.profile = profileForm(profile);
        this.error = '';
        this.notice = '';
      },
      metricLabel(id) { return METRIC_LABELS[id] || id; },
      toggleProfileMetric(id) {
        const index = this.profile.metrics.indexOf(id);
        if (index === -1) this.profile.metrics.push(id);
        else this.profile.metrics.splice(index, 1);
      },
      setThreshold(metric, level, value) {
        const parsed = numOrNull(value);
        const current = this.profile.thresholds[metric] || {};
        if (parsed === null) delete current[level];
        else current[level] = parsed;
        if (Object.keys(current).length) this.profile.thresholds[metric] = current;
        else delete this.profile.thresholds[metric];
      },
      async saveProfile() {
        if (!this.canProfiles || this.busy) return;
        if (this.profile.enabled && !this.profile.checkType) {
          this.error = 'Una comprobación activa necesita un tipo.';
          return;
        }
        this.busy = true;
        const body = {
          enabled: !!this.profile.enabled,
          checkType: this.profile.checkType || null,
          intervalSeconds: numOrNull(this.profile.intervalSeconds),
          metrics: this.profile.metrics.slice(),
          thresholds: JSON.parse(JSON.stringify(this.profile.thresholds)),
          minimumDurationSeconds: numOrNull(this.profile.minimumDurationSeconds),
          exporterId: this.profile.exporterId || null,
          snmpModule: this.profile.snmpModule || null,
          snmpAuthRef: this.profile.snmpAuthRef || null
        };
        const result = await this.app.updateMonitoringProfile(this.profile.category, body);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar el perfil.';
        else {
          this.app.showToast('Perfil de supervisión guardado.');
          this.selectProfile(this.profile.category);
          this.notice = 'Perfil de ' + this.profile.category + ' guardado.';
        }
      },
      async saveOverride() {
        if (!this.canAssets || this.busy) return;
        const assetId = text(this.override.assetId);
        if (!assetId) {
          this.error = 'Indica el identificador del activo.';
          return;
        }
        if (this.override.target && /(token|password|secret)=/i.test(this.override.target)) {
          this.error = 'El destino no puede contener credenciales.';
          return;
        }
        this.busy = true;
        const body = {};
        if (this.override.enabled === 'inherit') body.enabled = null;
        else if (this.override.enabled !== '') body.enabled = this.override.enabled === 'true';
        if (text(this.override.checkType)) body.checkType = text(this.override.checkType);
        if (text(this.override.target)) body.target = text(this.override.target);
        if (this.override.intervalSeconds !== '') body.intervalSeconds = numOrNull(this.override.intervalSeconds);
        if (this.override.metrics.length) body.metrics = this.override.metrics.slice();
        if (Object.keys(this.override.thresholds).length) body.thresholds = JSON.parse(JSON.stringify(this.override.thresholds));
        if (this.override.minimumDurationSeconds !== '') body.minimumDurationSeconds = numOrNull(this.override.minimumDurationSeconds);
        if (text(this.override.exporterId)) body.exporterId = text(this.override.exporterId);
        if (text(this.override.snmpModule)) body.snmpModule = text(this.override.snmpModule);
        if (text(this.override.snmpAuthRef)) body.snmpAuthRef = text(this.override.snmpAuthRef);
        if (!Object.keys(body).length) {
          this.busy = false;
          this.error = 'No hay ningún valor que guardar.';
          return;
        }
        const result = await this.app.updateMonitoringAsset(assetId, body);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar la excepción.';
        else {
          this.notice = 'Excepción guardada para ' + assetId + '.';
          this.app.showToast('Excepción de supervisión guardada.');
        }
      },
      toggleDraftMetric(id) {
        const index = this.override.metrics.indexOf(id);
        if (index === -1) this.override.metrics.push(id);
        else this.override.metrics.splice(index, 1);
      },
      async saveExporter() {
        if (!this.canExporters || this.busy) return;
        if (!text(this.exporter.name) || !text(this.exporter.module)) {
          this.error = 'El exportador necesita nombre y módulo.';
          return;
        }
        this.busy = true;
        const result = await this.app.saveMonitoringExporter({
          name: this.exporter.name,
          kind: this.exporter.kind,
          module: this.exporter.module,
          address: this.exporter.address,
          enabled: !!this.exporter.enabled
        });
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar el exportador.';
        else {
          this.notice = 'Exportador guardado.';
          this.exporter = { name: '', kind: 'blackbox', module: 'icmp', address: '', enabled: true };
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="mon-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Configuración</p>
            <h1 id="mon-settings-title">Supervisión</h1>
            <p class="page-sub">Comprobaciones reales, perfiles por categoría y destinos validados por el servidor.</p>
          </div>
          <div class="mon-head__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="app.loadMonitoringConfig()">
              <app-icon name="refresh"></app-icon> {{ loading ? 'Actualizando…' : 'Actualizar' }}
            </button>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" aria-label="Configuración de supervisión">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>

        <p v-if="!canProfiles && !canExporters && !canAssets" class="mon-lock">No tienes permisos para modificar la supervisión. Puedes consultar la configuración existente.</p>
        <p v-if="loading" class="mon-progress__text" role="status">Cargando la configuración del servidor…</p>
        <div v-else-if="app.monitoringConfigError" class="mon-notice" role="alert"><span class="mon-notice__text">{{ app.monitoringConfigError }}</span></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'categories'" class="mon-grid mon-grid--split">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Perfiles por categoría</h2>
              <span class="mon-panel__sub">No crean activos ni destinos</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="profile in profiles" :key="profile.category">
                <div>
                  <button type="button" class="mon-settings-table__name" :class="{ 'is-active': profile.category === selectedCategory }"
                          @click="selectProfile(profile.category)">
                    {{ profile.category }}
                    <span class="mon-tag" :class="profile.enabled ? 'mon-tag--ok' : 'mon-tag--neutral'">{{ profile.enabled ? 'Activo' : 'Inactivo' }}</span>
                  </button>
                  <span class="mon-settings-table__hint mono">{{ profile.checkType || 'Sin tipo' }} · {{ profile.intervalSeconds || '—' }} s · {{ (profile.metrics || []).join(', ') || 'Sin métricas' }}</span>
                </div>
              </li>
            </ul>
            <p v-if="!profiles.length" class="empty-state">El servidor no devolvió perfiles de categoría.</p>
          </div>

          <form class="mon-panel mon-settings__block" @submit.prevent="saveProfile">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Perfil {{ profile.category || 'sin categoría' }}</h2>
            </header>
            <label class="field">
              <span class="field__label">Categoría</span>
              <span class="select-field">
                <select v-model="profile.category" :disabled="!canProfiles" @change="selectProfile(profile.category)">
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Habilitar comprobación</span>
              <span class="select-field">
                <select v-model="profile.enabled" :disabled="!canProfiles">
                  <option :value="true">Sí</option>
                  <option :value="false">No</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Tipo de comprobación</span>
              <span class="select-field">
                <select v-model="profile.checkType" :disabled="!canProfiles">
                  <option value="">Sin tipo</option>
                  <option v-for="type in checkTypes" :key="type.id" :value="type.id">{{ type.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Intervalo (segundos)</span>
              <input v-model.number="profile.intervalSeconds" type="number" min="10" step="1" :disabled="!canProfiles">
            </label>
            <fieldset class="field">
              <legend class="field__label">Métricas</legend>
              <div class="mon-toggle-group">
                <label v-for="metric in metrics" :key="metric.id" class="mon-toggle">
                  <input type="checkbox" :value="metric.id" :checked="profile.metrics.indexOf(metric.id) !== -1"
                         :disabled="!canProfiles" @change="toggleProfileMetric(metric.id)">
                  <span>{{ metric.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-thresholds">
              <div class="mon-settings-table__head">Métrica</div>
              <div class="mon-settings-table__head">Aviso</div>
              <div class="mon-settings-table__head">Crítica</div>
              <template v-for="metric in metrics" :key="'th-' + metric.id">
                <div class="mon-settings-table__name">{{ metric.label }}</div>
                <input class="mon-input" type="number" step="0.01" :disabled="!canProfiles"
                       :aria-label="'Umbral de aviso de ' + metric.label"
                       :value="profile.thresholds[metric.id] ? profile.thresholds[metric.id].warning : ''"
                       @input="setThreshold(metric.id, 'warning', $event.target.value)">
                <input class="mon-input" type="number" step="0.01" :disabled="!canProfiles"
                       :aria-label="'Umbral crítico de ' + metric.label"
                       :value="profile.thresholds[metric.id] ? profile.thresholds[metric.id].critical : ''"
                       @input="setThreshold(metric.id, 'critical', $event.target.value)">
              </template>
            </div>
            <label class="field">
              <span class="field__label">Duración mínima antes de avisar</span>
              <span class="select-field">
                <select v-model.number="profile.minimumDurationSeconds" :disabled="!canProfiles">
                  <option v-for="duration in durations" :key="duration" :value="duration">{{ duration === 0 ? 'Sin espera' : duration + ' s' }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Exportador</span>
              <input v-model="profile.exporterId" type="text" maxlength="80" :disabled="!canProfiles" placeholder="Referencia de exportador">
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Módulo SNMP</span>
                <input v-model="profile.snmpModule" type="text" maxlength="80" :disabled="!canProfiles">
              </label>
              <label class="field">
                <span class="field__label">Credencial SNMP</span>
                <input v-model="profile.snmpAuthRef" type="text" maxlength="80" :disabled="!canProfiles" placeholder="Referencia del despliegue">
                <span class="field__hint">Solo la referencia; la credencial vive fuera de la aplicación.</span>
              </label>
            </div>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canProfiles || busy || !profile.category">{{ busy ? 'Guardando…' : 'Guardar perfil' }}</button>
            </div>
          </form>
        </div>

        <div v-if="tab === 'assets'" class="mon-stack">
          <form class="mon-panel mon-exception-form" @submit.prevent="saveOverride">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Excepción por activo</h2>
              <span class="mon-panel__sub">Sobrescribe el perfil de su categoría; los campos vacíos no se envían</span>
            </header>
            <label class="field">
              <span class="field__label">Activo</span>
              <input v-model="override.assetId" type="text" list="mon-asset-options" maxlength="80" :disabled="!canAssets" placeholder="UUID canónico del activo">
              <span class="field__hint">Lista los primeros {{ assets.length }} de {{ app.monitoringAssetsTotal }} activos del servidor; para el resto, indica su UUID canónico.</span>
              <datalist id="mon-asset-options">
                <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
              </datalist>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Supervisión</span>
                <span class="select-field">
                  <select v-model="override.enabled" :disabled="!canAssets">
                    <option value="">Sin cambio</option>
                    <option value="inherit">Heredar del perfil (limpiar excepción)</option>
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Tipo de comprobación</span>
                <span class="select-field">
                  <select v-model="override.checkType" :disabled="!canAssets">
                    <option value="">Heredar del perfil</option>
                    <option v-for="type in checkTypes" :key="type.id" :value="type.id">{{ type.label }}</option>
                  </select>
                </span>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Destino</span>
              <input v-model="override.target" type="text" maxlength="255" :disabled="!canAssets" placeholder="Host, URL o dirección IP">
              <span class="field__hint">El servidor valida el destino. No incluyas credenciales ni parámetros secretos.</span>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Intervalo (segundos)</span>
                <input v-model="override.intervalSeconds" type="number" min="10" step="1" :disabled="!canAssets" placeholder="Heredar">
              </label>
              <label class="field">
                <span class="field__label">Duración mínima</span>
                <span class="select-field">
                  <select v-model="override.minimumDurationSeconds" :disabled="!canAssets">
                    <option value="">Heredar del perfil</option>
                    <option v-for="duration in durations" :key="duration" :value="duration">{{ duration === 0 ? 'Sin espera' : duration + ' s' }}</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Exportador</span>
                <input v-model="override.exporterId" type="text" maxlength="80" :disabled="!canAssets" placeholder="Heredar">
              </label>
              <label class="field">
                <span class="field__label">Módulo SNMP</span>
                <input v-model="override.snmpModule" type="text" maxlength="80" :disabled="!canAssets" placeholder="Heredar">
              </label>
            </div>
            <label class="field">
              <span class="field__label">Credencial SNMP</span>
              <input v-model="override.snmpAuthRef" type="text" maxlength="80" :disabled="!canAssets" placeholder="Heredar o referencia del despliegue">
            </label>
            <fieldset class="field">
              <legend class="field__label">Métricas</legend>
              <div class="mon-toggle-group">
                <label v-for="metric in metrics" :key="'asset-' + metric.id" class="mon-toggle">
                  <input type="checkbox" :value="metric.id" :checked="override.metrics.indexOf(metric.id) !== -1"
                         :disabled="!canAssets" @change="toggleDraftMetric(metric.id)">
                  <span>{{ metric.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canAssets || busy">{{ busy ? 'Guardando…' : 'Guardar excepción' }}</button>
            </div>
          </form>
          <p class="mon-panel__sub">Los perfiles no crean filas por activo. Una excepción solo se guarda cuando la envías y el servidor la valida.</p>
        </div>

        <div v-if="tab === 'exporters'" class="mon-grid mon-grid--split">
          <div class="mon-panel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">Exportadores</h2></header>
            <ul class="mon-settings__list">
              <li v-for="exporter in exporters" :key="exporter.id">
                <span class="mon-settings-table__name">{{ exporter.name }}</span>
                <span class="mon-settings-table__hint mono">{{ exporter.kind }} · {{ exporter.module }} · {{ exporter.enabled ? 'activo' : 'inactivo' }}</span>
              </li>
            </ul>
            <p v-if="!exporters.length" class="empty-state">Sin exportadores configurados.</p>
          </div>
          <form class="mon-panel mon-channel__form" @submit.prevent="saveExporter">
            <header class="mon-panel__head"><h2 class="mon-panel__title">Nuevo exportador</h2></header>
            <label class="field">
              <span class="field__label">Nombre</span>
              <input v-model="exporter.name" type="text" maxlength="80" :disabled="!canExporters" required>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Tipo</span>
                <span class="select-field">
                  <select v-model="exporter.kind" :disabled="!canExporters">
                    <option value="blackbox">Blackbox</option>
                    <option value="snmp">SNMP</option>
                    <option value="node">Node exporter</option>
                    <option value="windows">Windows exporter</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Módulo</span>
                <input v-model="exporter.module" type="text" maxlength="80" :disabled="!canExporters" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Dirección</span>
              <input v-model="exporter.address" type="text" maxlength="255" :disabled="!canExporters" placeholder="Opcional; sin credenciales">
            </label>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="exporter.enabled" :disabled="!canExporters">
                  <option :value="true">Activo</option>
                  <option :value="false">Inactivo</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canExporters || busy">{{ busy ? 'Guardando…' : 'Guardar exportador' }}</button>
            </div>
          </form>
        </div>
      </section>
    `
  };

  // ---------------------------------------------------------------- alerts
  Views.AlertSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        tab: 'windows',
        window: windowForm(null),
        silence: { assetId: '', hours: 4, comment: '' },
        editingWindowId: '',
        busy: false,
        error: '',
        notice: ''
      };
    },
    computed: {
      canEdit() { return this.app.monitoringEditable; },
      windows() { return this.app.monitoringWindows; },
      loading() { return this.app.monitoringWindowsLoading; },
      assets() {
        const rows = this.app.monitoringAssets.map((asset) => ({
          id: asset.id,
          label: (asset.name || asset.id) + ' · ' + (asset.quickCode || asset.id)
        }));
        const seen = {};
        rows.forEach((row) => { seen[row.id] = true; });
        (this.window.assetIds || []).forEach((id) => {
          if (id && !seen[id]) {
            seen[id] = true;
            rows.push({ id, label: id });
          }
        });
        return rows;
      },
      days() { return DAYS; },
      tabs() { return [{ id: 'windows', label: 'Ventanas' }, { id: 'silences', label: 'Silencios' }]; }
    },
    async mounted() {
      if (this.app.monitoringAvailable) {
        await Promise.all([
          this.app.loadMonitoringConfig(),
          this.app.loadMonitoringWindows(),
          this.app.loadMonitoringAssetDirectory()
        ]);
      }
      this.prefillPreparedWindow();
    },
    methods: {
      fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; },
      prefillPreparedWindow() {
        const prepared = this.app.monitoringApi && this.app.monitoringApi.prepared;
        if (!prepared) return;
        this.window = windowForm(prepared);
        this.editingWindowId = '';
        this.tab = 'windows';
        this.error = '';
        this.notice = 'Ventana preparada desde la alerta' + (prepared.name ? ' «' + prepared.name + '»' : '') + '. Revísala y guárdala cuando quieras.';
      },
      toggleDay(id) {
        const index = this.window.daysOfWeek.indexOf(id);
        if (index === -1) this.window.daysOfWeek.push(id);
        else this.window.daysOfWeek.splice(index, 1);
      },
      toggleAsset(id) {
        const index = this.window.assetIds.indexOf(id);
        if (index === -1) this.window.assetIds.push(id);
        else this.window.assetIds.splice(index, 1);
      },
      editWindow(item) {
        this.window = windowForm(item);
        this.editingWindowId = item.id;
        this.tab = 'windows';
        this.error = '';
        this.notice = '';
        this.app.clearMonitoringPrepared();
      },
      resetWindow() {
        this.window = windowForm(null);
        this.editingWindowId = '';
        this.error = '';
        this.notice = '';
        this.app.clearMonitoringPrepared();
      },
      async saveWindow() {
        if (!this.canEdit || this.busy) return;
        if (!text(this.window.name) || !this.window.assetIds.length || !this.window.daysOfWeek.length) {
          this.error = 'La ventana necesita nombre, al menos un activo y un día.';
          return;
        }
        this.busy = true;
        const body = {
          name: text(this.window.name),
          assetIds: this.window.assetIds.slice(),
          daysOfWeek: this.window.daysOfWeek.slice().sort((a, b) => a - b),
          startTime: this.window.startTime,
          endTime: this.window.endTime,
          timezone: text(this.window.timezone),
          enabled: this.window.enabled !== false
        };
        if (this.editingWindowId) body.id = this.editingWindowId;
        const result = await this.app.saveMonitoringWindow(body);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar la ventana.';
        else {
          const updated = !!this.editingWindowId;
          this.resetWindow();
          this.notice = updated ? 'Ventana actualizada.' : 'Ventana creada.';
        }
      },
      async createSilence() {
        if (!this.canEdit || this.busy) return;
        const assetId = text(this.silence.assetId);
        if (!assetId) {
          this.error = 'Indica el activo que quieres silenciar.';
          return;
        }
        if (!text(this.silence.comment)) {
          this.error = 'Indica el motivo del silencio.';
          return;
        }
        this.busy = true;
        const result = await this.app.silenceMonitoringAsset(assetId, { hours: this.silence.hours, comment: this.silence.comment });
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo crear el silencio.';
        else {
          this.notice = 'Silencio aplicado al activo ' + assetId + '.';
          this.silence = { assetId: '', hours: 4, comment: '' };
          this.app.showToast('Silencio de supervisión aplicado.');
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="alert-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Configuración</p>
            <h1 id="alert-settings-title">Alertas</h1>
            <p class="page-sub">Ventanas de mantenimiento y silencios creados en el servidor. Las alertas no se ocultan.</p>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" aria-label="Configuración de alertas">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>
        <p v-if="!canEdit" class="mon-lock">No tienes permisos para crear silencios o ventanas.</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'windows'" class="mon-stack">
          <form class="mon-panel mon-window-form" @submit.prevent="saveWindow">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ editingWindowId ? 'Editar ventana' : 'Nueva ventana' }}</h2>
              <span class="mon-panel__sub">Se repite por día y hora; se sincroniza con Alertmanager cuando está configurado</span>
            </header>
            <label class="field">
              <span class="field__label">Nombre</span>
              <input v-model="window.name" type="text" maxlength="80" :disabled="!canEdit" required>
            </label>
            <fieldset class="field">
              <legend class="field__label">Activos</legend>
              <div class="mon-toggle-group">
                <label v-for="asset in assets" :key="asset.id" class="mon-toggle">
                  <input type="checkbox" :value="asset.id" :checked="window.assetIds.indexOf(asset.id) !== -1" :disabled="!canEdit" @change="toggleAsset(asset.id)">
                  <span>{{ asset.label }}</span>
                </label>
              </div>
              <input v-model="window.assetIdsText" type="text" class="mon-input" placeholder="Si el activo no aparece, escribe su UUID y sepáralo con comas"
                     :disabled="!canEdit" @change="window.assetIds = Array.from(new Set(window.assetIds.concat(window.assetIdsText.split(/[\\s,]+/).filter(Boolean))))">
            </fieldset>
            <fieldset class="field">
              <legend class="field__label">Días</legend>
              <div class="mon-toggle-group">
                <label v-for="day in days" :key="day.id" class="mon-toggle mon-toggle--day">
                  <input type="checkbox" :value="day.id" :checked="window.daysOfWeek.indexOf(day.id) !== -1" :disabled="!canEdit" @change="toggleDay(day.id)">
                  <span>{{ day.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-window-form__times">
              <label class="field">
                <span class="field__label">Inicio</span>
                <input v-model="window.startTime" type="time" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">Fin</span>
                <input v-model="window.endTime" type="time" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">Zona horaria</span>
                <input v-model="window.timezone" type="text" maxlength="64" :disabled="!canEdit" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="window.enabled" :disabled="!canEdit">
                  <option :value="true">Activa</option>
                  <option :value="false">Inactiva</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? 'Guardando…' : 'Guardar ventana' }}</button>
              <button v-if="editingWindowId" type="button" class="btn btn--ghost" @click="resetWindow">Cancelar edición</button>
            </div>
          </form>

          <div class="mon-panel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">Ventanas registradas</h2></header>
            <p v-if="loading" class="mon-panel__sub" role="status">Cargando ventanas…</p>
            <ul v-else class="mon-settings__list">
              <li v-for="item in windows" :key="item.id">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }}</span>
                  <span class="mon-settings-table__hint mono">{{ item.startTime }}–{{ item.endTime }} · {{ item.timezone }} · {{ item.enabled ? 'activa' : 'inactiva' }}</span>
                </div>
                <button type="button" class="text-button" :disabled="!canEdit" @click="editWindow(item)">Editar</button>
              </li>
            </ul>
            <p v-if="!windows.length && !loading" class="empty-state">No hay ventanas de mantenimiento.</p>
          </div>
        </div>

        <div v-if="tab === 'silences'" class="mon-stack">
          <form class="mon-panel mon-exception-form mon-exception-form--silence" @submit.prevent="createSilence">
            <header class="mon-panel__head"><h2 class="mon-panel__title">Silenciar un activo</h2></header>
            <p class="mon-panel__sub">El silencio detiene avisos externos, pero no cambia el estado de la alerta. Los silencios por alerta se crean desde su detalle.</p>
            <label class="field">
              <span class="field__label">Activo</span>
              <input v-model="silence.assetId" type="text" list="alert-asset-options" maxlength="80" :disabled="!canEdit" placeholder="UUID canónico">
              <datalist id="alert-asset-options">
                <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
              </datalist>
            </label>
            <div class="mon-hours">
              <label class="field mon-hours__field">
                <span class="field__label">Duración</span>
                <select v-model.number="silence.hours" :disabled="!canEdit">
                  <option :value="1">1 hora</option>
                  <option :value="4">4 horas</option>
                  <option :value="8">8 horas</option>
                  <option :value="24">24 horas</option>
                  <option :value="72">3 días</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Motivo</span>
                <input v-model="silence.comment" type="text" maxlength="200" :disabled="!canEdit" required>
              </label>
            </div>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? 'Aplicando…' : 'Silenciar activo' }}</button>
            </div>
          </form>
          <p class="mon-panel__sub">El historial de silencios de una alerta se consulta en su ficha. No se muestra aquí una lista inventada.</p>
        </div>
      </section>
    `
  };

  // ---------------------------------------------------------------- notifications
  Views.NotificationSettings = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        tab: 'channels',
        channel: channelForm(null),
        rule: ruleForm(null),
        editingRuleId: '',
        busy: false,
        error: '',
        notice: ''
      };
    },
    computed: {
      canEdit() { return this.app.monitoringIntegrations; },
      loading() { return this.app.notificationConfigLoading; },
      errorFromApi() { return this.app.notificationConfigError; },
      channels() { return this.app.notificationChannels; },
      rules() { return this.app.notificationRules; },
      defaults() { return this.app.notificationDefaults; },
      recipients() { return this.app.notificationRecipients; },
      testStates() { return this.app.notificationTestStates; },
      severities() { return [{ id: 'info', label: 'Media' }, { id: 'warning', label: 'Alta' }, { id: 'critical', label: 'Crítica' }]; },
      tabs() { return [{ id: 'channels', label: 'Canales' }, { id: 'rules', label: 'Reglas' }]; },
      channelKinds() { return [{ id: 'internal', label: 'Avisos internos' }, { id: 'smtp', label: 'SMTP' }, { id: 'telegram', label: 'Telegram' }]; }
    },
    async mounted() {
      if (this.app.monitoringAvailable) await this.app.loadNotificationConfig();
    },
    methods: {
      channelKindLabel(kind) { return (this.channelKinds.find((item) => item.id === kind) || {}).label || kind; },
      channelState(channel) {
        if (!channel.enabled) return 'Inactivo';
        return channel.configured ? 'Configurado' : 'Falta la credencial';
      },
      testState(channel) {
        const state = this.testStates[channel.id];
        return state ? (state.state === 'pending' ? 'En cola' : state.state) : '';
      },
      editChannel(item) {
        this.channel = channelForm(item);
        this.tab = 'channels';
        this.error = '';
      },
      resetChannel() { this.channel = channelForm(null); this.error = ''; },
      async saveChannel() {
        if (!this.canEdit || this.busy) return;
        if (hasRawSecret(this.channel)) {
          this.error = 'No introduzcas tokens ni contraseñas. Usa solo la referencia de credencial del despliegue.';
          return;
        }
        if (!text(this.channel.name)) {
          this.error = 'El canal necesita un nombre.';
          return;
        }
        if (this.channel.kind !== 'internal' && !text(this.channel.secretRef)) {
          this.error = 'Indica la referencia de credencial configurada en el despliegue.';
          return;
        }
        this.busy = true;
        const config = {};
        if (this.channel.kind === 'smtp' && text(this.channel.subjectPrefix)) config.subjectPrefix = text(this.channel.subjectPrefix);
        if (this.channel.kind === 'telegram' && text(this.channel.chatId)) config.chatId = text(this.channel.chatId);
        const body = {
          kind: this.channel.kind,
          name: text(this.channel.name),
          enabled: !!this.channel.enabled,
          secretRef: this.channel.kind === 'internal' ? null : text(this.channel.secretRef),
          config
        };
        if (this.channel.id) body.id = this.channel.id;
        const result = await this.app.saveNotificationChannel(body);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar el canal.';
        else {
          this.notice = 'Canal guardado.';
          this.resetChannel();
        }
      },
      async testChannel(item) {
        if (!this.canEdit || this.busy) return;
        this.busy = true;
        this.error = '';
        this.notice = '';
        const result = await this.app.testNotificationChannel(item.id);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo encolar la prueba.';
        else this.notice = 'Prueba encolada. El servidor confirmará el resultado en la bandeja; no se declara entregada.';
      },
      editRule(item) {
        this.rule = ruleForm(item);
        this.editingRuleId = item.id;
        this.tab = 'rules';
        this.error = '';
      },
      resetRule() { this.rule = ruleForm(null); this.editingRuleId = ''; this.error = ''; },
      toggleChannel(id) {
        const index = this.rule.channelIds.indexOf(id);
        if (index === -1) this.rule.channelIds.push(id);
        else this.rule.channelIds.splice(index, 1);
      },
      async saveRule() {
        if (!this.canEdit || this.busy) return;
        if (!text(this.rule.name)) {
          this.error = 'La regla necesita un nombre.';
          return;
        }
        if (!this.rule.channelIds.length) {
          this.error = 'La regla necesita al menos un canal.';
          return;
        }
        if (!this.editingRuleId && !idsFromText(this.rule.recipientIds).length) {
          this.error = 'Una regla nueva necesita al menos un destinatario canónico.';
          return;
        }
        this.busy = true;
        const body = {
          name: text(this.rule.name),
          enabled: !!this.rule.enabled,
          minimumSeverity: this.rule.minimumSeverity,
          recipientIds: idsFromText(this.rule.recipientIds),
          channelIds: this.rule.channelIds.slice(),
          escalationRecipientIds: idsFromText(this.rule.escalationRecipientIds),
          schedule: this.rule.scheduleEnabled ? {
            timezone: text(this.rule.timezone),
            start: text(this.rule.start),
            end: text(this.rule.end)
          } : null,
          acknowledgeAfterSeconds: Number(this.rule.acknowledgeAfterSeconds) || 0,
          retryIntervalSeconds: Number(this.rule.retryIntervalSeconds) || 0,
          escalateAfterSeconds: Number(this.rule.escalateAfterSeconds) || 0,
          maxAttempts: Number(this.rule.maxAttempts) || 1
        };
        if (this.editingRuleId) body.id = this.editingRuleId;
        const result = await this.app.saveNotificationRule(body);
        this.busy = false;
        if (!result.ok) this.error = result.error || 'No se pudo guardar la regla.';
        else {
          this.notice = 'Regla guardada.';
          this.resetRule();
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="notif-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Configuración</p>
            <h1 id="notif-settings-title">Notificaciones</h1>
            <p class="page-sub">Canales y reglas del servidor. Las credenciales solo se referencian; nunca se guardan en el navegador.</p>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" aria-label="Configuración de notificaciones">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>

        <p v-if="!canEdit" class="mon-lock">No tienes permisos para modificar canales ni reglas.</p>
        <p v-if="loading" class="mon-progress__text" role="status">Cargando la configuración de notificaciones…</p>
        <div v-else-if="errorFromApi" class="mon-notice" role="alert"><span class="mon-notice__text">{{ errorFromApi }}</span></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'channels'" class="mon-stack">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Canales</h2>
              <span class="mon-panel__sub">Retención {{ app.notificationRetentionDays || '—' }} días · el aviso interno no necesita credenciales</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="item in channels" :key="item.id" class="mon-channel">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }}</span>
                  <span class="mon-settings-table__hint mono">{{ channelKindLabel(item.kind) }} · {{ channelState(item) }}<template v-if="item.secretRef"> · ref {{ item.secretRef }}</template></span>
                  <span v-if="testState(item)" class="mon-panel__sub">Prueba {{ testState(item) }}. El servidor no expone el resultado externo.</span>
                </div>
                <div class="mon-channel__actions">
                  <button type="button" class="text-button" :disabled="!canEdit" @click="editChannel(item)">Editar</button>
                  <button type="button" class="text-button" :disabled="!canEdit" @click="testChannel(item)">Enviar prueba</button>
                </div>
              </li>
            </ul>
            <p v-if="!channels.length" class="empty-state">Sin canales configurados.</p>
          </div>

          <form class="mon-panel mon-channel__form" @submit.prevent="saveChannel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ channel.id ? 'Editar canal' : 'Nuevo canal' }}</h2></header>
            <div class="mon-channel__note">
              La contraseña SMTP o el token de Telegram viven en el despliegue. Aquí solo se indica la referencia que los resuelve.
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Tipo</span>
                <span class="select-field">
                  <select v-model="channel.kind" :disabled="!canEdit">
                    <option v-for="kind in channelKinds" :key="kind.id" :value="kind.id">{{ kind.label }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Nombre</span>
                <input v-model="channel.name" type="text" maxlength="80" :disabled="!canEdit" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Referencia de credencial</span>
              <input v-model="channel.secretRef" type="text" maxlength="80" :disabled="!canEdit || channel.kind === 'internal'"
                     placeholder="monitoring_smtp_ops">
              <span class="field__hint">Nombre definido en monitoring_secrets. Nunca escribas aquí el token ni la contraseña.</span>
            </label>
            <label v-if="channel.kind === 'smtp'" class="field">
              <span class="field__label">Prefijo del asunto</span>
              <input v-model="channel.subjectPrefix" type="text" maxlength="60" :disabled="!canEdit" placeholder="[ITMS]">
            </label>
            <label v-if="channel.kind === 'telegram'" class="field">
              <span class="field__label">Chat de destino</span>
              <input v-model="channel.chatId" type="text" maxlength="80" :disabled="!canEdit" placeholder="Opcional si la referencia ya incluye el chat">
              <span class="field__hint">Dato no secreto. Si la referencia es un token, indica aquí el chat.</span>
            </label>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="channel.enabled" :disabled="!canEdit">
                  <option :value="true">Activo</option>
                  <option :value="false">Inactivo</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? 'Guardando…' : 'Guardar canal' }}</button>
              <button v-if="channel.id" type="button" class="btn btn--ghost" @click="resetChannel">Cancelar edición</button>
            </div>
          </form>
        </div>

        <div v-if="tab === 'rules'" class="mon-stack">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Reglas</h2>
              <span class="mon-panel__sub">Severidad mínima, destinatarios canónicos, canales, horario, reconocimiento y reintentos</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="item in rules" :key="item.id">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }} <span v-if="item.builtIn" class="mon-tag">Predeterminada</span></span>
                  <span class="mon-settings-table__hint">
                    {{ item.minimumSeverity }} · {{ item.channelIds.length }} canales · reconocer {{ item.acknowledgeAfterSeconds }} s · reintento {{ item.retryIntervalSeconds }} s
                  </span>
                  <span class="mon-settings-table__hint mono">
                    Destinatarios: {{ item.recipientIds.length ? item.recipientIds.join(', ') : 'todas las identidades activas' }}
                  </span>
                </div>
                <button type="button" class="text-button" :disabled="!canEdit" @click="editRule(item)">Editar</button>
              </li>
            </ul>
            <p v-if="!rules.length" class="empty-state">Sin reglas configuradas.</p>
          </div>

          <form class="mon-panel mon-rule-form" @submit.prevent="saveRule">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ editingRuleId ? 'Editar regla' : 'Nueva regla' }}</h2></header>
            <div class="mon-rule-form__title">
              <label class="field">
                <span class="field__label">Nombre</span>
                <input v-model="rule.name" type="text" maxlength="80" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">Severidad mínima</span>
                <span class="select-field">
                  <select v-model="rule.minimumSeverity" :disabled="!canEdit">
                    <option v-for="severity in severities" :key="severity.id" :value="severity.id">{{ severity.label }}</option>
                  </select>
                </span>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Destinatarios (IDs canónicos)</span>
              <input v-model="rule.recipientIds" type="text" list="notification-recipients" maxlength="400" :disabled="!canEdit"
                     placeholder="u-..., u-... o vacío en la regla predeterminada">
              <datalist id="notification-recipients">
                <option v-for="recipient in recipients" :key="recipient.id" :value="recipient.id">{{ recipient.label }}</option>
              </datalist>
              <span class="field__hint">Solo identidades existentes. El servidor valida que sean personas activas.</span>
            </label>
            <fieldset class="field">
              <legend class="field__label">Canales</legend>
              <div class="mon-toggle-group">
                <label v-for="item in channels" :key="'rule-channel-' + item.id" class="mon-toggle">
                  <input type="checkbox" :value="item.id" :checked="rule.channelIds.indexOf(item.id) !== -1" :disabled="!canEdit" @change="toggleChannel(item.id)">
                  <span>{{ item.name }}</span>
                </label>
              </div>
            </fieldset>
            <label class="field">
              <span class="field__label">Escalado a</span>
              <input v-model="rule.escalationRecipientIds" type="text" list="notification-recipients" maxlength="400" :disabled="!canEdit"
                     placeholder="IDs separados por comas; vacío para no escalar">
            </label>
            <label class="field">
              <span class="field__label">
                <input v-model="rule.scheduleEnabled" type="checkbox" :disabled="!canEdit"> Limitar a una franja horaria
              </span>
            </label>
            <div v-if="rule.scheduleEnabled" class="mon-window-form__times">
              <label class="field">
                <span class="field__label">Zona horaria</span>
                <input v-model="rule.timezone" type="text" maxlength="64" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">Inicio</span>
                <input v-model="rule.start" type="time" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">Fin</span>
                <input v-model="rule.end" type="time" :disabled="!canEdit">
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Espera de reconocimiento (s)</span>
                <input v-model.number="rule.acknowledgeAfterSeconds" type="number" min="0" step="30" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">Reintento (s)</span>
                <input v-model.number="rule.retryIntervalSeconds" type="number" min="0" step="10" :disabled="!canEdit">
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">Escalado tras (s)</span>
                <input v-model.number="rule.escalateAfterSeconds" type="number" min="0" step="60" :disabled="!canEdit">
                <span class="field__hint">0 desactiva el escalado.</span>
              </label>
              <label class="field">
                <span class="field__label">Intentos máximos</span>
                <input v-model.number="rule.maxAttempts" type="number" min="1" max="20" step="1" :disabled="!canEdit">
              </label>
            </div>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="rule.enabled" :disabled="!canEdit">
                  <option :value="true">Activa</option>
                  <option :value="false">Inactiva</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? 'Guardando…' : 'Guardar regla' }}</button>
              <button v-if="editingRuleId" type="button" class="btn btn--ghost" @click="resetRule">Cancelar edición</button>
            </div>
          </form>
        </div>
      </section>
    `
  };
})();
