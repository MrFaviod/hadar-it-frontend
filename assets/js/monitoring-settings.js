(function () {
  'use strict';

  const Mapping = window.AssetMonitoringApiMapping;
  const Views = window.Views = window.Views || {};
  // Catalog access for copy assembled in JavaScript; templates use $t.
  // Category labels are owned by the server inventory catalog; this helper is
  // only the bounded fallback for an id the catalog does not translate, so no
  // name is guessed for a category the server does know.
  function categoryLabel(id) {
    const parts = String(id || '').split(/[-_\s]+/).filter(Boolean);
    if (!parts.length) return '';
    return parts
      .map((part) => (part.length > 3 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(' ');
  }

  // Canonical labels, matched by id only. The inventory owner returns its own
  // bounded fallback (prototype categories without a server, [] when a
  // server-driven catalog is not loaded), so `app.categories` is never consulted
  // and a stale local entry cannot overwrite a canonical label.
  function canonicalCategories(app) {
    if (!app || typeof app.inventoryConfigCategories !== 'function') return [];
    const list = app.inventoryConfigCategories();
    return (Array.isArray(list) ? list : [])
      .map((category) => ({
        id: String((category && category.id) || ''),
        label: String((category && (category.label || category.name)) || '').trim()
      }))
      .filter((category) => category.id);
  }

  function ensureCategoryCatalog(app) {
    if (!app || app.inventoryCatalogReady) return null;
    if (typeof app.inventoryAvailable !== 'function' || !app.inventoryAvailable()) return null;
    if (typeof app.loadInventoryCatalog !== 'function') return null;
    return app.loadInventoryCatalog();
  }

  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const DAYS = [
    { id: 0, key: 'ui.monitoring.day.mon' }, { id: 1, key: 'ui.monitoring.day.tue' },
    { id: 2, key: 'ui.monitoring.day.wed' }, { id: 3, key: 'ui.monitoring.day.thu' },
    { id: 4, key: 'ui.monitoring.day.fri' }, { id: 5, key: 'ui.monitoring.day.sat' },
    { id: 6, key: 'ui.monitoring.day.sun' }
  ];
  const METRIC_KEYS = {
    latency: 'ui.monitoring.metric.latency',
    cpu: 'ui.monitoring.metric.cpu',
    memory: 'ui.monitoring.metric.memory',
    disk: 'ui.monitoring.metric.disk',
    temperature: 'ui.monitoring.metric.temperature'
  };
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
      : Object.keys(METRIC_KEYS).map((id) => ({ id, label: tr(METRIC_KEYS[id]), unit: '' }));
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
        // Canonical labels first, matched by id. Profiles can reference a
        // category the catalog does not list; those keep the bounded fallback so
        // the picker and the profile titles stay usable without inventing names.
        const names = new Map(canonicalCategories(this.app).map((category) => [category.id, category.label]));
        (this.profiles || []).forEach((profile) => {
          const id = String(profile.category || '');
          if (id && !names.has(id)) names.set(id, categoryLabel(id));
        });
        return Array.from(names, ([id, name]) => ({ id, name: name || categoryLabel(id) }));
      },
      assets() {
        return this.app.monitoringAssets.map((asset) => ({
          id: asset.id,
          label: tr('ui.monitoring.settings.asset_option', { name: asset.name || asset.id, code: asset.quickCode || asset.id })
        }));
      },
      tabs() {
        return [
          { id: 'categories', label: tr('ui.monitoring.settings.tab.categories') },
          { id: 'assets', label: tr('ui.monitoring.settings.tab.overrides') },
          { id: 'exporters', label: tr('ui.monitoring.settings.tab.exporters') }
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
      if (this.app.monitoringAvailable) {
        const tasks = [this.app.loadMonitoringConfig(), this.app.loadMonitoringAssetDirectory()];
        const catalog = ensureCategoryCatalog(this.app);
        if (catalog) tasks.push(catalog);
        await Promise.all(tasks);
      }
      if (this.profiles.length && !this.selectedCategory) this.selectProfile(this.profiles[0].category);
    },
    methods: {
      categoryName(id) {
        const found = this.categories.find((category) => category.id === id);
        return found ? found.name : (id || '—');
      },
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
      metricLabel(id) { return METRIC_KEYS[id] ? tr(METRIC_KEYS[id]) : id; },
      checkLabel(id) {
        const found = this.checkTypes.find((check) => check.id === id);
        return found && found.label ? found.label : Mapping.checkMeta(id).label;
      },
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
          this.error = tr('ui.monitoring.settings.error.check_type');
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
        if (!result.ok) this.error = result.error || tr('ui.monitoring.settings.error.profile_save');
        else {
          this.app.showToast(tr('ui.monitoring.settings.toast.profile_saved'));
          this.selectProfile(this.profile.category);
          this.notice = tr('ui.monitoring.settings.notice.profile_saved', { category: this.categoryName(this.profile.category) });
        }
      },
      async saveOverride() {
        if (!this.canAssets || this.busy) return;
        const assetId = text(this.override.assetId);
        if (!assetId) {
          this.error = tr('ui.monitoring.settings.error.asset_required');
          return;
        }
        if (this.override.target && /(token|password|secret)=/i.test(this.override.target)) {
          this.error = tr('ui.monitoring.settings.error.target_credentials');
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
          this.error = tr('ui.monitoring.settings.error.nothing_to_save');
          return;
        }
        const result = await this.app.updateMonitoringAsset(assetId, body);
        this.busy = false;
        if (!result.ok) this.error = result.error || tr('ui.monitoring.settings.error.override_save');
        else {
          this.notice = tr('ui.monitoring.settings.notice.override_saved', { asset: assetId });
          this.app.showToast(tr('ui.monitoring.settings.toast.override_saved'));
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
          this.error = tr('ui.monitoring.settings.error.exporter_fields');
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
        if (!result.ok) this.error = result.error || tr('ui.monitoring.settings.error.exporter_save');
        else {
          this.notice = tr('ui.monitoring.settings.notice.exporter_saved');
          this.exporter = { name: '', kind: 'blackbox', module: 'icmp', address: '', enabled: true };
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="mon-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.settings.eyebrow') }}</p>
            <h1 id="mon-settings-title">{{ $t('ui.monitoring.nav.monitoring') }}</h1>
            <p class="page-sub">{{ $t('ui.monitoring.settings.monitoring_sub') }}</p>
          </div>
          <div class="mon-head__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="app.loadMonitoringConfig()">
              <app-icon name="refresh"></app-icon> {{ loading ? $t('ui.monitoring.action.refreshing') : $t('ui.monitoring.action.refresh') }}
            </button>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" :aria-label="$t('ui.monitoring.settings.tabs_aria')">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>

        <p v-if="!canProfiles && !canExporters && !canAssets" class="mon-lock">{{ $t('ui.monitoring.settings.lock') }}</p>
        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.monitoring.settings.loading') }}</p>
        <div v-else-if="app.monitoringConfigError" class="mon-notice" role="alert"><span class="mon-notice__text">{{ app.monitoringConfigError }}</span></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'categories'" class="mon-grid mon-grid--split">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.settings.profiles') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.monitoring.settings.profiles_sub') }}</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="profile in profiles" :key="profile.category">
                <div>
                  <button type="button" class="mon-settings-table__name" :class="{ 'is-active': profile.category === selectedCategory }"
                          @click="selectProfile(profile.category)">
                    {{ categoryName(profile.category) }}
                    <span class="mon-tag" :class="profile.enabled ? 'mon-tag--ok' : 'mon-tag--neutral'">{{ profile.enabled ? $t('ui.monitoring.settings.tag.active') : $t('ui.monitoring.settings.tag.inactive') }}</span>
                  </button>
                  <span class="mon-settings-table__hint mono">{{ $t('ui.monitoring.settings.profile_meta', { check: profile.checkType ? checkLabel(profile.checkType) : $t('ui.monitoring.settings.no_type'), interval: profile.intervalSeconds || '—', metrics: (profile.metrics || []).map(id => metricLabel(id)).join(', ') || $t('ui.monitoring.settings.no_metrics') }) }}</span>
                </div>
              </li>
            </ul>
            <p v-if="!profiles.length" class="empty-state">{{ $t('ui.monitoring.settings.profiles_empty') }}</p>
          </div>

          <form class="mon-panel mon-settings__block" @submit.prevent="saveProfile">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ profile.category ? $t('ui.monitoring.settings.profile_title', { category: categoryName(profile.category) }) : $t('ui.monitoring.settings.profile_uncategorized') }}</h2>
            </header>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.category') }}</span>
              <span class="select-field">
                <select v-model="profile.category" :disabled="!canProfiles" @change="selectProfile(profile.category)">
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.settings.field.enable_check') }}</span>
              <span class="select-field">
                <select v-model="profile.enabled" :disabled="!canProfiles">
                  <option :value="true">{{ $t('ui.monitoring.common.yes') }}</option>
                  <option :value="false">{{ $t('ui.monitoring.common.no') }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.settings.field.check_type') }}</span>
              <span class="select-field">
                <select v-model="profile.checkType" :disabled="!canProfiles">
                  <option value="">{{ $t('ui.monitoring.settings.no_type') }}</option>
                  <option v-for="type in checkTypes" :key="type.id" :value="type.id">{{ type.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.settings.field.interval_seconds') }}</span>
              <input v-model.number="profile.intervalSeconds" type="number" min="10" step="1" :disabled="!canProfiles">
            </label>
            <fieldset class="field">
              <legend class="field__label">{{ $t('ui.monitoring.settings.field.metrics') }}</legend>
              <div class="mon-toggle-group">
                <label v-for="metric in metrics" :key="metric.id" class="mon-toggle">
                  <input type="checkbox" :value="metric.id" :checked="profile.metrics.indexOf(metric.id) !== -1"
                         :disabled="!canProfiles" @change="toggleProfileMetric(metric.id)">
                  <span>{{ metric.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-thresholds">
              <div class="mon-settings-table__head">{{ $t('ui.monitoring.device.metric_aria') }}</div>
              <div class="mon-settings-table__head">{{ $t('ui.monitoring.settings.threshold.warning') }}</div>
              <div class="mon-settings-table__head">{{ $t('ui.monitoring.severity.critical') }}</div>
              <template v-for="metric in metrics" :key="'th-' + metric.id">
                <div class="mon-settings-table__name">{{ metric.label }}</div>
                <input class="mon-input" type="number" step="0.01" :disabled="!canProfiles"
                       :aria-label="$t('ui.monitoring.settings.threshold.warning_aria', { metric: metric.label })"
                       :value="profile.thresholds[metric.id] ? profile.thresholds[metric.id].warning : ''"
                       @input="setThreshold(metric.id, 'warning', $event.target.value)">
                <input class="mon-input" type="number" step="0.01" :disabled="!canProfiles"
                       :aria-label="$t('ui.monitoring.settings.threshold.critical_aria', { metric: metric.label })"
                       :value="profile.thresholds[metric.id] ? profile.thresholds[metric.id].critical : ''"
                       @input="setThreshold(metric.id, 'critical', $event.target.value)">
              </template>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.settings.field.min_duration_alert') }}</span>
              <span class="select-field">
                <select v-model.number="profile.minimumDurationSeconds" :disabled="!canProfiles">
                  <option v-for="duration in durations" :key="duration" :value="duration">{{ duration === 0 ? $t('ui.monitoring.duration.no_wait') : duration + ' s' }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.config.exporter') }}</span>
              <input v-model="profile.exporterId" type="text" maxlength="80" :disabled="!canProfiles" :placeholder="$t('ui.monitoring.settings.placeholder.exporter_ref')">
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.config.snmp_module') }}</span>
                <input v-model="profile.snmpModule" type="text" maxlength="80" :disabled="!canProfiles">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.config.snmp_credential') }}</span>
                <input v-model="profile.snmpAuthRef" type="text" maxlength="80" :disabled="!canProfiles" :placeholder="$t('ui.monitoring.settings.placeholder.deployment_ref')">
                <span class="field__hint">{{ $t('ui.monitoring.settings.hint.secret_ref') }}</span>
              </label>
            </div>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canProfiles || busy || !profile.category">{{ busy ? $t('ui.common.saving') : $t('ui.monitoring.settings.action.save_profile') }}</button>
            </div>
          </form>
        </div>

        <div v-if="tab === 'assets'" class="mon-stack">
          <form class="mon-panel mon-exception-form" @submit.prevent="saveOverride">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.settings.override_title') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.monitoring.settings.override_sub') }}</span>
            </header>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.asset') }}</span>
              <input v-model="override.assetId" type="text" list="mon-asset-options" maxlength="80" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.asset_uuid')">
              <span class="field__hint">{{ $t('ui.monitoring.settings.override_assets_hint', { shown: assets.length, total: app.monitoringAssetsTotal }) }}</span>
              <datalist id="mon-asset-options">
                <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
              </datalist>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.monitoring') }}</span>
                <span class="select-field">
                  <select v-model="override.enabled" :disabled="!canAssets">
                    <option value="">{{ $t('ui.monitoring.settings.option.no_change') }}</option>
                    <option value="inherit">{{ $t('ui.monitoring.settings.option.inherit_clear') }}</option>
                    <option value="true">{{ $t('ui.monitoring.settings.option.active_f') }}</option>
                    <option value="false">{{ $t('ui.monitoring.settings.option.inactive_f') }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.check_type') }}</span>
                <span class="select-field">
                  <select v-model="override.checkType" :disabled="!canAssets">
                    <option value="">{{ $t('ui.monitoring.settings.option.inherit') }}</option>
                    <option v-for="type in checkTypes" :key="type.id" :value="type.id">{{ type.label }}</option>
                  </select>
                </span>
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.config.target') }}</span>
              <input v-model="override.target" type="text" maxlength="255" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.target')">
              <span class="field__hint">{{ $t('ui.monitoring.settings.hint.target') }}</span>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.interval_seconds') }}</span>
                <input v-model="override.intervalSeconds" type="number" min="10" step="1" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.inherit')">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.config.min_duration') }}</span>
                <span class="select-field">
                  <select v-model="override.minimumDurationSeconds" :disabled="!canAssets">
                    <option value="">{{ $t('ui.monitoring.settings.option.inherit') }}</option>
                    <option v-for="duration in durations" :key="duration" :value="duration">{{ duration === 0 ? $t('ui.monitoring.duration.no_wait') : duration + ' s' }}</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.config.exporter') }}</span>
                <input v-model="override.exporterId" type="text" maxlength="80" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.inherit')">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.config.snmp_module') }}</span>
                <input v-model="override.snmpModule" type="text" maxlength="80" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.inherit')">
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.config.snmp_credential') }}</span>
              <input v-model="override.snmpAuthRef" type="text" maxlength="80" :disabled="!canAssets" :placeholder="$t('ui.monitoring.settings.placeholder.inherit_ref')">
            </label>
            <fieldset class="field">
              <legend class="field__label">{{ $t('ui.monitoring.settings.field.metrics') }}</legend>
              <div class="mon-toggle-group">
                <label v-for="metric in metrics" :key="'asset-' + metric.id" class="mon-toggle">
                  <input type="checkbox" :value="metric.id" :checked="override.metrics.indexOf(metric.id) !== -1"
                         :disabled="!canAssets" @change="toggleDraftMetric(metric.id)">
                  <span>{{ metric.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canAssets || busy">{{ busy ? $t('ui.common.saving') : $t('ui.monitoring.settings.action.save_override') }}</button>
            </div>
          </form>
          <p class="mon-panel__sub">{{ $t('ui.monitoring.settings.override_note') }}</p>
        </div>

        <div v-if="tab === 'exporters'" class="mon-grid mon-grid--split">
          <div class="mon-panel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.settings.tab.exporters') }}</h2></header>
            <ul class="mon-settings__list">
              <li v-for="exporter in exporters" :key="exporter.id">
                <span class="mon-settings-table__name">{{ exporter.name }}</span>
                <span class="mon-settings-table__hint mono">{{ exporter.kind }} · {{ exporter.module }} · {{ exporter.enabled ? $t('ui.monitoring.settings.status.active_m') : $t('ui.monitoring.settings.status.inactive_m') }}</span>
              </li>
            </ul>
            <p v-if="!exporters.length" class="empty-state">{{ $t('ui.monitoring.settings.exporters_empty') }}</p>
          </div>
          <form class="mon-panel mon-channel__form" @submit.prevent="saveExporter">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.settings.exporter_title') }}</h2></header>
            <label class="field">
              <span class="field__label">{{ $t('ui.common.name') }}</span>
              <input v-model="exporter.name" type="text" maxlength="80" :disabled="!canExporters" required>
            </label>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.kind') }}</span>
                <span class="select-field">
                  <select v-model="exporter.kind" :disabled="!canExporters">
                    <option value="blackbox">{{ $t('ui.monitoring.exporter.blackbox') }}</option>
                    <option value="snmp">{{ $t('ui.monitoring.check.snmp') }}</option>
                    <option value="node">{{ $t('ui.monitoring.check.node') }}</option>
                    <option value="windows">{{ $t('ui.monitoring.check.windows') }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.module') }}</span>
                <input v-model="exporter.module" type="text" maxlength="80" :disabled="!canExporters" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.settings.field.address') }}</span>
              <input v-model="exporter.address" type="text" maxlength="255" :disabled="!canExporters" :placeholder="$t('ui.monitoring.settings.placeholder.address')">
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="exporter.enabled" :disabled="!canExporters">
                  <option :value="true">{{ $t('ui.monitoring.settings.tag.active') }}</option>
                  <option :value="false">{{ $t('ui.monitoring.settings.tag.inactive') }}</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canExporters || busy">{{ busy ? $t('ui.common.saving') : $t('ui.monitoring.settings.action.save_exporter') }}</button>
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
          label: tr('ui.monitoring.settings.asset_option', { name: asset.name || asset.id, code: asset.quickCode || asset.id })
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
      days() { return DAYS.map((day) => ({ id: day.id, label: tr(day.key) })); },
      tabs() {
        return [
          { id: 'windows', label: tr('ui.alerts.tab.windows') },
          { id: 'silences', label: tr('ui.alerts.tab.silences') }
        ];
      }
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
      fmtDateTime(iso) {
        return iso ? window.ItsmI18n.formatDate(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      },
      prefillPreparedWindow() {
        const prepared = this.app.monitoringApi && this.app.monitoringApi.prepared;
        if (!prepared) return;
        this.window = windowForm(prepared);
        this.editingWindowId = '';
        this.tab = 'windows';
        this.error = '';
        this.notice = tr('ui.alerts.window.prepared_notice', { name: prepared.name ? ' «' + prepared.name + '»' : '' });
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
          this.error = tr('ui.alerts.error.window_required');
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
        if (!result.ok) this.error = result.error || tr('ui.alerts.error.window_save');
        else {
          const updated = !!this.editingWindowId;
          this.resetWindow();
          this.notice = updated ? tr('ui.alerts.notice.window_updated') : tr('ui.alerts.notice.window_created');
        }
      },
      async createSilence() {
        if (!this.canEdit || this.busy) return;
        const assetId = text(this.silence.assetId);
        if (!assetId) {
          this.error = tr('ui.alerts.error.silence_asset');
          return;
        }
        if (!text(this.silence.comment)) {
          this.error = tr('ui.alerts.error.silence_reason');
          return;
        }
        this.busy = true;
        const result = await this.app.silenceMonitoringAsset(assetId, { hours: this.silence.hours, comment: this.silence.comment });
        this.busy = false;
        if (!result.ok) this.error = result.error || tr('ui.monitoring.silence.failed');
        else {
          this.notice = tr('ui.alerts.notice.silence_applied', { asset: assetId });
          this.silence = { assetId: '', hours: 4, comment: '' };
          this.app.showToast(tr('ui.alerts.toast.silence_applied'));
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="alert-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.settings.eyebrow') }}</p>
            <h1 id="alert-settings-title">{{ $t('ui.alerts.title') }}</h1>
            <p class="page-sub">{{ $t('ui.alerts.sub') }}</p>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" :aria-label="$t('ui.alerts.tabs_aria')">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>
        <p v-if="!canEdit" class="mon-lock">{{ $t('ui.alerts.lock') }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'windows'" class="mon-stack">
          <form class="mon-panel mon-window-form" @submit.prevent="saveWindow">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ editingWindowId ? $t('ui.alerts.window.edit') : $t('ui.alerts.window.new') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.alerts.window.sub') }}</span>
            </header>
            <label class="field">
              <span class="field__label">{{ $t('ui.common.name') }}</span>
              <input v-model="window.name" type="text" maxlength="80" :disabled="!canEdit" required>
            </label>
            <fieldset class="field mon-window-form__assets">
              <legend class="field__label">{{ $t('ui.alerts.window.assets') }}</legend>
              <div class="mon-toggle-group">
                <label v-for="asset in assets" :key="asset.id" class="mon-toggle">
                  <input type="checkbox" :value="asset.id" :checked="window.assetIds.indexOf(asset.id) !== -1" :disabled="!canEdit" @change="toggleAsset(asset.id)">
                  <span>{{ asset.label }}</span>
                </label>
              </div>
              <input v-model="window.assetIdsText" type="text" class="mon-input mon-input--wide" :placeholder="$t('ui.alerts.window.assets_placeholder')"
                     :disabled="!canEdit" @change="window.assetIds = Array.from(new Set(window.assetIds.concat(window.assetIdsText.split(/[\\s,]+/).filter(Boolean))))">
            </fieldset>
            <fieldset class="field mon-window-form__days">
              <legend class="field__label">{{ $t('ui.alerts.window.days') }}</legend>
              <div class="mon-toggle-group">
                <label v-for="day in days" :key="day.id" class="mon-toggle mon-toggle--day">
                  <input type="checkbox" :value="day.id" :checked="window.daysOfWeek.indexOf(day.id) !== -1" :disabled="!canEdit" @change="toggleDay(day.id)">
                  <span>{{ day.label }}</span>
                </label>
              </div>
            </fieldset>
            <div class="mon-window-form__times">
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.start') }}</span>
                <input v-model="window.startTime" type="time" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.end') }}</span>
                <input v-model="window.endTime" type="time" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.timezone') }}</span>
                <input v-model="window.timezone" type="text" maxlength="64" :disabled="!canEdit" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="window.enabled" :disabled="!canEdit">
                  <option :value="true">{{ $t('ui.monitoring.settings.option.active_f') }}</option>
                  <option :value="false">{{ $t('ui.monitoring.settings.option.inactive_f') }}</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? $t('ui.common.saving') : $t('ui.alerts.action.save_window') }}</button>
              <button v-if="editingWindowId" type="button" class="btn btn--ghost" @click="resetWindow">{{ $t('ui.alerts.action.cancel_edit') }}</button>
            </div>
          </form>

          <div class="mon-panel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.alerts.window.list') }}</h2></header>
            <p v-if="loading" class="mon-panel__sub" role="status">{{ $t('ui.alerts.window.loading') }}</p>
            <ul v-else class="mon-settings__list">
              <li v-for="item in windows" :key="item.id">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }}</span>
                  <span class="mon-settings-table__hint mono">{{ item.startTime }}–{{ item.endTime }} · {{ item.timezone }} · {{ item.enabled ? $t('ui.monitoring.settings.status.active_f') : $t('ui.monitoring.settings.status.inactive_f') }}</span>
                </div>
                <button type="button" class="text-button" :disabled="!canEdit" @click="editWindow(item)">{{ $t('ui.alerts.action.edit') }}</button>
              </li>
            </ul>
            <p v-if="!windows.length && !loading" class="empty-state">{{ $t('ui.alerts.window.empty') }}</p>
          </div>
        </div>

        <div v-if="tab === 'silences'" class="mon-stack">
          <form class="mon-panel mon-exception-form mon-exception-form--silence" @submit.prevent="createSilence">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.alerts.silence.title') }}</h2></header>
            <p class="mon-panel__sub">{{ $t('ui.alerts.silence.sub') }}</p>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.asset') }}</span>
              <input v-model="silence.assetId" type="text" list="alert-asset-options" maxlength="80" :disabled="!canEdit" :placeholder="$t('ui.alerts.silence.asset_placeholder')">
              <datalist id="alert-asset-options">
                <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
              </datalist>
            </label>
            <div class="mon-hours">
              <label class="field mon-hours__field">
                <span class="field__label">{{ $t('ui.monitoring.silence.duration') }}</span>
                <select v-model.number="silence.hours" :disabled="!canEdit">
                  <option :value="1">{{ $t('ui.monitoring.silence.hours_1') }}</option>
                  <option :value="4">{{ $t('ui.monitoring.silence.hours_4') }}</option>
                  <option :value="8">{{ $t('ui.monitoring.silence.hours_8') }}</option>
                  <option :value="24">{{ $t('ui.monitoring.silence.hours_24') }}</option>
                  <option :value="72">{{ $t('ui.monitoring.silence.hours_72') }}</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.silence.reason') }}</span>
                <input v-model="silence.comment" type="text" maxlength="200" :disabled="!canEdit" required>
              </label>
            </div>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? $t('ui.alerts.silence.applying') : $t('ui.alerts.silence.submit') }}</button>
            </div>
          </form>
          <p class="mon-panel__sub">{{ $t('ui.alerts.silence.note') }}</p>
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
      severities() {
        return [
          { id: 'info', label: tr('ui.monitoring.severity.info') },
          { id: 'warning', label: tr('ui.monitoring.severity.warning') },
          { id: 'critical', label: tr('ui.monitoring.severity.critical') }
        ];
      },
      tabs() {
        return [
          { id: 'channels', label: tr('ui.notifications.settings.tab.channels') },
          { id: 'rules', label: tr('ui.notifications.settings.tab.rules') }
        ];
      },
      channelKinds() {
        return [
          { id: 'internal', label: tr('ui.notifications.settings.kind.internal') },
          { id: 'smtp', label: 'SMTP' },
          { id: 'telegram', label: 'Telegram' }
        ];
      }
    },
    async mounted() {
      if (this.app.monitoringAvailable) await this.app.loadNotificationConfig();
    },
    methods: {
      channelKindLabel(kind) { return (this.channelKinds.find((item) => item.id === kind) || {}).label || kind; },
      severityLabel(id) { return (this.severities.find((item) => item.id === id) || {}).label || id; },
      channelState(channel) {
        if (!channel.enabled) return tr('ui.notifications.settings.state.inactive');
        return channel.configured ? tr('ui.notifications.settings.state.configured') : tr('ui.notifications.settings.state.missing_credential');
      },
      testState(channel) {
        const state = this.testStates[channel.id];
        return state ? (state.state === 'pending' ? tr('ui.notifications.settings.state.queued') : state.state) : '';
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
          this.error = tr('ui.notifications.settings.error.raw_secret');
          return;
        }
        if (!text(this.channel.name)) {
          this.error = tr('ui.notifications.settings.error.channel_name');
          return;
        }
        if (this.channel.kind !== 'internal' && !text(this.channel.secretRef)) {
          this.error = tr('ui.notifications.settings.error.channel_secret');
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
        if (!result.ok) this.error = result.error || tr('ui.notifications.settings.error.channel_save');
        else {
          this.notice = tr('ui.notifications.settings.notice.channel_saved');
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
        if (!result.ok) this.error = result.error || tr('ui.notifications.settings.error.channel_test');
        else this.notice = tr('ui.notifications.settings.notice.channel_test');
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
          this.error = tr('ui.notifications.settings.error.rule_name');
          return;
        }
        if (!this.rule.channelIds.length) {
          this.error = tr('ui.notifications.settings.error.rule_channel');
          return;
        }
        if (!this.editingRuleId && !idsFromText(this.rule.recipientIds).length) {
          this.error = tr('ui.notifications.settings.error.rule_recipient');
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
        if (!result.ok) this.error = result.error || tr('ui.notifications.settings.error.rule_save');
        else {
          this.notice = tr('ui.notifications.settings.notice.rule_saved');
          this.resetRule();
        }
      }
    },
    template: `
      <section class="page mon-page mon-settings" aria-labelledby="notif-settings-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.settings.eyebrow') }}</p>
            <h1 id="notif-settings-title">{{ $t('ui.notifications.title') }}</h1>
            <p class="page-sub">{{ $t('ui.notifications.settings.sub') }}</p>
          </div>
        </header>

        <div class="mon-tabs" role="tablist" :aria-label="$t('ui.notifications.settings.tabs_aria')">
          <button v-for="item in tabs" :key="item.id" type="button" class="mon-tab" role="tab"
                  :aria-selected="tab === item.id" :class="{ 'is-active': tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
        </div>

        <p v-if="!canEdit" class="mon-lock">{{ $t('ui.notifications.settings.lock') }}</p>
        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.notifications.settings.loading') }}</p>
        <div v-else-if="errorFromApi" class="mon-notice" role="alert"><span class="mon-notice__text">{{ errorFromApi }}</span></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="mon-panel__sub" role="status">{{ notice }}</p>

        <div v-if="tab === 'channels'" class="mon-stack">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.notifications.settings.channels') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.notifications.settings.channels_sub', { days: app.notificationRetentionDays || '—' }) }}</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="item in channels" :key="item.id" class="mon-channel">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }}</span>
                  <span class="mon-settings-table__hint mono">{{ channelKindLabel(item.kind) }} · {{ channelState(item) }}<template v-if="item.secretRef">{{ $t('ui.notifications.settings.channel_ref', { ref: item.secretRef }) }}</template></span>
                  <span v-if="testState(item)" class="mon-panel__sub">{{ $t('ui.notifications.settings.test_line', { state: testState(item) }) }}</span>
                </div>
                <div class="mon-channel__actions">
                  <button type="button" class="text-button" :disabled="!canEdit" @click="editChannel(item)">{{ $t('ui.alerts.action.edit') }}</button>
                  <button type="button" class="text-button" :disabled="!canEdit" @click="testChannel(item)">{{ $t('ui.notifications.action.send_test') }}</button>
                </div>
              </li>
            </ul>
            <p v-if="!channels.length" class="empty-state">{{ $t('ui.notifications.settings.channels_empty') }}</p>
          </div>

          <form class="mon-panel mon-channel__form" @submit.prevent="saveChannel">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ channel.id ? $t('ui.notifications.settings.channel_edit') : $t('ui.notifications.settings.channel_new') }}</h2></header>
            <div class="mon-channel__note">
              {{ $t('ui.notifications.settings.channel_note') }}
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.monitoring.settings.field.kind') }}</span>
                <span class="select-field">
                  <select v-model="channel.kind" :disabled="!canEdit">
                    <option v-for="kind in channelKinds" :key="kind.id" :value="kind.id">{{ kind.label }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.common.name') }}</span>
                <input v-model="channel.name" type="text" maxlength="80" :disabled="!canEdit" required>
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.notifications.settings.field.secret_ref') }}</span>
              <input v-model="channel.secretRef" type="text" maxlength="80" :disabled="!canEdit || channel.kind === 'internal'"
                     :placeholder="$t('ui.notifications.settings.placeholder.secret_ref')">
              <span class="field__hint">{{ $t('ui.notifications.settings.hint.secret_ref') }}</span>
            </label>
            <label v-if="channel.kind === 'smtp'" class="field">
              <span class="field__label">{{ $t('ui.notifications.settings.field.subject_prefix') }}</span>
              <input v-model="channel.subjectPrefix" type="text" maxlength="60" :disabled="!canEdit" :placeholder="$t('ui.notifications.settings.placeholder.subject_prefix')">
            </label>
            <label v-if="channel.kind === 'telegram'" class="field">
              <span class="field__label">{{ $t('ui.notifications.settings.field.chat') }}</span>
              <input v-model="channel.chatId" type="text" maxlength="80" :disabled="!canEdit" :placeholder="$t('ui.notifications.settings.placeholder.chat')">
              <span class="field__hint">{{ $t('ui.notifications.settings.hint.chat') }}</span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="channel.enabled" :disabled="!canEdit">
                  <option :value="true">{{ $t('ui.monitoring.settings.tag.active') }}</option>
                  <option :value="false">{{ $t('ui.monitoring.settings.tag.inactive') }}</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? $t('ui.common.saving') : $t('ui.notifications.settings.action.save_channel') }}</button>
              <button v-if="channel.id" type="button" class="btn btn--ghost" @click="resetChannel">{{ $t('ui.alerts.action.cancel_edit') }}</button>
            </div>
          </form>
        </div>

        <div v-if="tab === 'rules'" class="mon-stack">
          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.notifications.settings.rules') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.notifications.settings.rules_sub') }}</span>
            </header>
            <ul class="mon-settings__list">
              <li v-for="item in rules" :key="item.id">
                <div>
                  <span class="mon-settings-table__name">{{ item.name }} <span v-if="item.builtIn" class="mon-tag">{{ $t('ui.notifications.settings.builtin') }}</span></span>
                  <span class="mon-settings-table__hint">
                    {{ $t('ui.notifications.settings.rule_meta', { severity: severityLabel(item.minimumSeverity), channels: item.channelIds.length, ack: item.acknowledgeAfterSeconds, retry: item.retryIntervalSeconds }) }}
                  </span>
                  <span class="mon-settings-table__hint mono">
                    {{ $t('ui.notifications.settings.rule_recipients', { recipients: item.recipientIds.length ? item.recipientIds.join(', ') : $t('ui.notifications.settings.all_identities') }) }}
                  </span>
                </div>
                <button type="button" class="text-button" :disabled="!canEdit" @click="editRule(item)">{{ $t('ui.alerts.action.edit') }}</button>
              </li>
            </ul>
            <p v-if="!rules.length" class="empty-state">{{ $t('ui.notifications.settings.rules_empty') }}</p>
          </div>

          <form class="mon-panel mon-rule-form" @submit.prevent="saveRule">
            <header class="mon-panel__head"><h2 class="mon-panel__title">{{ editingRuleId ? $t('ui.notifications.settings.rule_edit') : $t('ui.notifications.settings.rule_new') }}</h2></header>
            <div class="mon-rule-form__title">
              <label class="field">
                <span class="field__label">{{ $t('ui.common.name') }}</span>
                <input v-model="rule.name" type="text" maxlength="80" :disabled="!canEdit" required>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.notifications.settings.field.min_severity') }}</span>
                <span class="select-field">
                  <select v-model="rule.minimumSeverity" :disabled="!canEdit">
                    <option v-for="severity in severities" :key="severity.id" :value="severity.id">{{ severity.label }}</option>
                  </select>
                </span>
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.notifications.settings.field.recipients') }}</span>
              <input v-model="rule.recipientIds" type="text" list="notification-recipients" maxlength="400" :disabled="!canEdit"
                     :placeholder="$t('ui.notifications.settings.placeholder.recipients')">
              <datalist id="notification-recipients">
                <option v-for="recipient in recipients" :key="recipient.id" :value="recipient.id">{{ recipient.label }}</option>
              </datalist>
              <span class="field__hint">{{ $t('ui.notifications.settings.hint.recipients') }}</span>
            </label>
            <fieldset class="field">
              <legend class="field__label">{{ $t('ui.notifications.settings.channels_legend') }}</legend>
              <div class="mon-toggle-group">
                <label v-for="item in channels" :key="'rule-channel-' + item.id" class="mon-toggle">
                  <input type="checkbox" :value="item.id" :checked="rule.channelIds.indexOf(item.id) !== -1" :disabled="!canEdit" @change="toggleChannel(item.id)">
                  <span>{{ item.name }}</span>
                </label>
              </div>
            </fieldset>
            <label class="field">
              <span class="field__label">{{ $t('ui.notifications.settings.field.escalation') }}</span>
              <input v-model="rule.escalationRecipientIds" type="text" list="notification-recipients" maxlength="400" :disabled="!canEdit"
                     :placeholder="$t('ui.notifications.settings.placeholder.escalation')">
            </label>
            <label class="field">
              <span class="field__label">
                <input v-model="rule.scheduleEnabled" type="checkbox" :disabled="!canEdit"> {{ $t('ui.notifications.settings.field.schedule') }}
              </span>
            </label>
            <div v-if="rule.scheduleEnabled" class="mon-window-form__times">
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.timezone') }}</span>
                <input v-model="rule.timezone" type="text" maxlength="64" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.start') }}</span>
                <input v-model="rule.start" type="time" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.alerts.field.end') }}</span>
                <input v-model="rule.end" type="time" :disabled="!canEdit">
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.notifications.settings.field.ack_wait') }}</span>
                <input v-model.number="rule.acknowledgeAfterSeconds" type="number" min="0" step="30" :disabled="!canEdit">
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.notifications.settings.field.retry') }}</span>
                <input v-model.number="rule.retryIntervalSeconds" type="number" min="0" step="10" :disabled="!canEdit">
              </label>
            </div>
            <div class="form-grid--two">
              <label class="field">
                <span class="field__label">{{ $t('ui.notifications.settings.field.escalate_after') }}</span>
                <input v-model.number="rule.escalateAfterSeconds" type="number" min="0" step="60" :disabled="!canEdit">
                <span class="field__hint">{{ $t('ui.notifications.settings.hint.escalate_zero') }}</span>
              </label>
              <label class="field">
                <span class="field__label">{{ $t('ui.notifications.settings.field.max_attempts') }}</span>
                <input v-model.number="rule.maxAttempts" type="number" min="1" max="20" step="1" :disabled="!canEdit">
              </label>
            </div>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="rule.enabled" :disabled="!canEdit">
                  <option :value="true">{{ $t('ui.monitoring.settings.option.active_f') }}</option>
                  <option :value="false">{{ $t('ui.monitoring.settings.option.inactive_f') }}</option>
                </select>
              </span>
            </label>
            <div class="mon-settings__actions">
              <button type="submit" class="btn btn--primary" :disabled="!canEdit || busy">{{ busy ? $t('ui.common.saving') : $t('ui.notifications.settings.action.save_rule') }}</button>
              <button v-if="editingRuleId" type="button" class="btn btn--ghost" @click="resetRule">{{ $t('ui.alerts.action.cancel_edit') }}</button>
            </div>
          </form>
        </div>
      </section>
    `
  };
})();
