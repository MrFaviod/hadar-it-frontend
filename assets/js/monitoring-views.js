(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }

  const Mapping = window.AssetMonitoringApiMapping;
  const Views = window.Views = window.Views || {};
  let chartSeq = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Catalog access for copy assembled in JavaScript; templates use $t.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  // Device reasons arrive as stable server codes. Every code the backend emits
  // owns a catalog sentence; an unknown code is withheld instead of painted raw.
  const REASON_KEYS = {
    target_missing: 'ui.monitoring.reason.target_missing',
    prometheus_unavailable: 'ui.monitoring.reason.prometheus_unavailable',
    prometheus_not_configured: 'ui.monitoring.reason.prometheus_not_configured'
  };

  // Category labels belong to the server-owned inventory catalog. Prototype
  // configuration (`app.categories`) only applies while the installation has no
  // server at all; the owner itself returns the bounded fallback ([] when a
  // server-driven catalog is not loaded), so a stale local entry never wins and
  // no name is guessed.
  function categoryEntries(app) {
    if (!app || typeof app.inventoryConfigCategories !== 'function') return [];
    const list = app.inventoryConfigCategories();
    return (Array.isArray(list) ? list : [])
      .map((category) => ({
        id: String((category && category.id) || ''),
        label: String((category && (category.label || category.name)) || '').trim()
      }))
      .filter((category) => category.id);
  }

  // Asking the catalog owner to load is the only canonical way to obtain the
  // labels; it is idempotent and guarded by the owner's own availability check.
  function ensureCategoryCatalog(app) {
    if (!app || app.inventoryCatalogReady) return null;
    if (typeof app.inventoryAvailable !== 'function' || !app.inventoryAvailable()) return null;
    if (typeof app.loadInventoryCatalog !== 'function') return null;
    return app.loadInventoryCatalog();
  }

  // Server categories arrive as ids. A category the catalog does not translate
  // is still printed as a readable sentence instead of a slug.
  function fallbackLabel(id) {
    const parts = String(id || '').split(/[-_\s]+/).filter(Boolean);
    if (!parts.length) return '';
    return parts
      .map((part) => (part.length > 3 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(' ');
  }

  // Override keys come from the API payload; each one owns a catalog label so
  // the panel never prints snake_case identifiers.
  const OVERRIDE_LABELS = {
    enabled: 'ui.monitoring.config.enabled',
    checkType: 'ui.monitoring.config.check',
    target: 'ui.monitoring.config.target',
    intervalSeconds: 'ui.monitoring.config.interval',
    minimumDurationSeconds: 'ui.monitoring.config.min_duration',
    exporterId: 'ui.monitoring.config.exporter',
    snmpModule: 'ui.monitoring.config.snmp_module',
    snmpAuthRef: 'ui.monitoring.config.snmp_credential',
    metrics: 'ui.monitoring.settings.field.metrics',
    thresholds: 'ui.monitoring.config.thresholds'
  };

  // The mapper localises event labels once, at map time; the timeline resolves
  // them again so a language switch is not frozen in the fetched copy.
  const EVENT_LABEL_KEYS = {
    opened: 'ui.monitoring.event.opened',
    fired: 'ui.monitoring.event.fired',
    acknowledged: 'ui.monitoring.event.acknowledged',
    resolved: 'ui.monitoring.event.resolved',
    silenced: 'ui.monitoring.event.silenced',
    unsilenced: 'ui.monitoring.event.unsilenced',
    incident_linked: 'ui.monitoring.event.incident_linked',
    incident_created: 'ui.monitoring.event.incident_created',
    maintenance_prepared: 'ui.monitoring.event.maintenance_prepared'
  };

  function reasonCopy(reason) {
    if (!reason) return '';
    const key = REASON_KEYS[reason];
    return key ? tr(key) : '';
  }

  // A linked incident carries the canonical lifecycle code; the catalog owns
  // its label so the metric hint never paints a snake_case status.
  const INCIDENT_STATE_KEYS = {
    open: 'ui.incidents.state.open',
    in_progress: 'ui.incidents.state.in_progress',
    resolved: 'ui.incidents.state.resolved',
    closed: 'ui.incidents.state.closed'
  };

  function incidentStateCopy(status) {
    const key = INCIDENT_STATE_KEYS[status];
    return key ? tr(key) : '';
  }

  function fmtDay(iso) {
    if (!iso) return '—';
    return window.ItsmI18n.formatDate(iso, { day: '2-digit', month: 'short' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    return window.ItsmI18n.formatDate(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtClock(iso) {
    if (!iso) return '—';
    return window.ItsmI18n.formatDate(iso, { hour: '2-digit', minute: '2-digit' });
  }

  function rel(iso) {
    if (!iso) return tr('ui.monitoring.rel.none');
    const diff = Date.now() - Date.parse(iso);
    if (!Number.isFinite(diff)) return tr('ui.monitoring.rel.none');
    if (diff < 0) return tr('ui.monitoring.rel.scheduled');
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return tr('ui.monitoring.rel.now');
    if (minutes < 60) return tr('ui.monitoring.rel.minutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return tr('ui.monitoring.rel.hours', { count: hours });
    const days = Math.round(hours / 24);
    if (days < 30) return tr('ui.monitoring.rel.days', { count: days });
    return fmtDay(iso);
  }

  function fmtNumber(value, unit) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    const rounded = Math.abs(number) >= 100 ? Math.round(number) : Math.round(number * 10) / 10;
    const formatted = window.ItsmI18n.number(rounded);
    return unit ? formatted + ' ' + unit : formatted;
  }

  function duration(minutes) {
    if (minutes === null || minutes === undefined) return '—';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
    return Math.floor(hours / 24) + ' d ' + (hours % 24) + ' h';
  }

  function periodLabel(period) {
    if (period === '7d') return tr('ui.monitoring.period.7d');
    if (period === '30d') return tr('ui.monitoring.period.30d');
    return tr('ui.monitoring.period.24h');
  }

  function secondsLabel(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return tr('ui.monitoring.duration.no_wait');
    if (value < 60) return value + ' s';
    if (value < 3600) return Math.round(value / 60) + ' min';
    return Math.round(value / 360) / 10 + ' h';
  }

  function hashFromUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.hash || '';
    } catch (error) {
      return url.charAt(0) === '#' ? url : '';
    }
  }

  // ---------------------------------------------------------------- charts
  Views.MonChart = {
    props: {
      points: { type: Array, default: function () { return []; } },
      tone: { type: String, default: 'teal' },
      unit: { type: String, default: '' },
      height: { type: Number, default: 170 },
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      label: { type: String, required: true },
      zeroBase: { type: Boolean, default: false }
    },
    data() {
      return { uid: 'mon-chart-' + (chartSeq += 1) };
    },
    computed: {
      validPoints() {
        return (this.points || []).filter((point) => point && Number.isFinite(point.value));
      },
      geometry() {
        const points = this.validPoints;
        const width = 640;
        const height = this.height;
        const top = 12;
        const bottom = 20;
        // Y tick labels are drawn at the left edge; the series starts after them
        // so a minimum reading is never crossed by its own axis label.
        const left = 54;
        if (points.length < 2) return null;
        const values = points.map((point) => point.value);
        let low = Number.isFinite(this.min) ? this.min : Math.min.apply(null, values);
        let high = Number.isFinite(this.max) ? this.max : Math.max.apply(null, values);
        if (this.zeroBase) low = 0;
        if (high - low < 0.5) high = low + 0.5;
        const spanY = height - top - bottom;
        const stepX = (width - left) / (points.length - 1);
        const coords = points.map((point, index) => ({
          x: left + index * stepX,
          y: top + clamp(1 - (point.value - low) / (high - low), 0, 1) * spanY,
          value: point.value,
          label: point.label
        }));
        const line = coords.map((coord, index) => (index ? 'L' : 'M') + coord.x.toFixed(1) + ' ' + coord.y.toFixed(1)).join(' ');
        const area = line + ' L' + width.toFixed(1) + ' ' + (height - bottom) + ' L' + left + ' ' + (height - bottom) + ' Z';
        const last = coords[coords.length - 1];
        const midIndex = Math.round((coords.length - 1) / 2);
        return {
          width, height, left, line, area, low, high, last,
          ticks: [
            { y: top, value: high },
            { y: top + spanY / 2, value: (high + low) / 2 },
            { y: top + spanY, value: low }
          ],
          xLabels: [
            { x: left, label: coords[0].label, anchor: 'start' },
            { x: coords[midIndex].x, label: coords[midIndex].label, anchor: 'middle' },
            { x: last.x, label: last.label, anchor: 'end' }
          ]
        };
      },
      summary() {
        const points = this.validPoints;
        if (!points.length) return null;
        const values = points.map((point) => point.value);
        const total = values.reduce((sum, value) => sum + value, 0);
        return {
          last: values[values.length - 1],
          min: Math.min.apply(null, values),
          max: Math.max.apply(null, values),
          avg: Math.round((total / values.length) * 100) / 100
        };
      },
      emptyText() {
        return this.validPoints.length
          ? tr('ui.monitoring.chart.needs_samples')
          : tr('ui.monitoring.chart.no_samples');
      }
    },
    methods: {
      tickLabel(value) {
        return fmtNumber(value, this.unit);
      }
    },
    template: `
      <figure class="mon-chart" :class="'mon-chart--' + tone">
        <figcaption class="mon-chart__head">
          <span class="mon-chart__label">{{ label }}</span>
          <span v-if="summary" class="mon-chart__stats mono">
            <span>{{ $t('ui.monitoring.chart.min') }} {{ tickLabel(summary.min) }}</span>
            <span>{{ $t('ui.monitoring.chart.avg') }} {{ tickLabel(summary.avg) }}</span>
            <span>{{ $t('ui.monitoring.chart.max') }} {{ tickLabel(summary.max) }}</span>
          </span>
        </figcaption>
        <svg v-if="geometry" class="mon-chart__svg" :viewBox="'0 0 ' + geometry.width + ' ' + geometry.height"
             role="img" :aria-label="label + ': ' + tickLabel(geometry.last.value)">
          <defs>
            <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" class="mon-chart__stop-top"></stop>
              <stop offset="100%" class="mon-chart__stop-bottom"></stop>
            </linearGradient>
          </defs>
          <line v-for="tick in geometry.ticks" :key="'g' + tick.y" class="mon-chart__grid"
                :x1="geometry.left" :y1="tick.y" :x2="geometry.width" :y2="tick.y"></line>
          <path class="mon-chart__area" :d="geometry.area" :fill="'url(#' + uid + ')'"></path>
          <path class="mon-chart__line" :d="geometry.line"></path>
          <circle class="mon-chart__dot" :cx="geometry.last.x" :cy="geometry.last.y" r="3.4"></circle>
          <text v-for="tick in geometry.ticks" :key="'t' + tick.y" class="mon-chart__tick"
                x="0" :y="tick.y - 4">{{ tickLabel(tick.value) }}</text>
          <text v-for="entry in geometry.xLabels" :key="'x' + entry.x" class="mon-chart__axis"
                :x="entry.x" :y="geometry.height - 4" :text-anchor="entry.anchor">{{ entry.label }}</text>
        </svg>
        <p v-else class="mon-chart__empty">{{ emptyText }}</p>
      </figure>
    `
  };

  Views.MonSpark = {
    props: {
      points: { type: Array, default: function () { return []; } },
      tone: { type: String, default: 'teal' }
    },
    computed: {
      path() {
        const points = (this.points || []).filter((point) => point && Number.isFinite(point.value));
        if (points.length < 2) return '';
        const values = points.map((point) => point.value);
        const low = Math.min.apply(null, values);
        const high = Math.max.apply(null, values);
        const span = high - low || 1;
        return points.map((point, index) => {
          const x = (index / (points.length - 1)) * 100;
          const y = 30 - ((point.value - low) / span) * 26 - 2;
          return (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }).join(' ');
      }
    },
    template: `
      <svg class="mon-spark" :class="'mon-spark--' + tone" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <path v-if="path" :d="path"></path>
      </svg>
    `
  };

  Views.MonStatusPill = {
    props: { status: { type: String, required: true } },
    computed: {
      meta() { return Mapping.statusMeta(this.status); }
    },
    template: `
      <span class="mon-pill" :class="'mon-pill--' + meta.tone">
        <app-icon :name="meta.icon"></app-icon>{{ meta.label }}
      </span>
    `
  };

  Views.MonMetric = {
    props: {
      label: { type: String, required: true },
      value: { type: String, default: '—' },
      hint: { type: String, default: '' },
      icon: { type: String, default: 'activity' },
      tone: { type: String, default: 'neutral' }
    },
    template: `
      <div class="mon-metric" :class="'mon-metric--' + tone">
        <span class="mon-metric__icon"><app-icon :name="icon"></app-icon></span>
        <span class="mon-metric__label">{{ label }}</span>
        <span class="mon-metric__value mono">{{ value }}</span>
        <span v-if="hint" class="mon-metric__hint">{{ hint }}</span>
      </div>
    `
  };

  // ---------------------------------------------------------------- dialogs
  Views.MonSilenceDialog = {
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      alert: { type: Object, default: null },
      assetId: { type: String, default: '' },
      app: { type: Object, required: true }
    },
    emits: ['close', 'saved'],
    data() {
      return { hours: 4, reason: '', busy: false, error: '' };
    },
    watch: {
      open(value) {
        if (!value) return;
        this.hours = 4;
        this.reason = '';
        this.busy = false;
        this.error = '';
      }
    },
    computed: {
      targetLabel() {
        if (this.alert) return this.alert.quickCode || this.alert.assetName || tr('ui.monitoring.silence.target_alert');
        return this.assetId
          ? tr('ui.monitoring.silence.target_asset', { asset: this.assetId })
          : tr('ui.monitoring.silence.target_resource');
      }
    },
    methods: {
      async submit() {
        if (this.busy) return;
        this.busy = true;
        this.error = '';
        const options = { hours: this.hours, comment: this.reason };
        const result = this.alert
          ? await this.app.silenceMonitoringAlert(this.alert.id, options)
          : await this.app.silenceMonitoringAsset(this.assetId, options);
        this.busy = false;
        if (!result.ok) {
          this.error = result.error || tr('ui.monitoring.silence.failed');
          return;
        }
        this.app.showToast(tr('ui.monitoring.silence.applied', { hours: this.hours, target: this.targetLabel }));
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.monitoring.silence.title')" :eyebrow="$t('ui.monitoring.silence.eyebrow')" size="normal" @close="$emit('close')">
        <div class="form-stack mon-dialog">
          <p class="form-intro">{{ $t('ui.monitoring.silence.intro') }}</p>
          <label class="field">
            <span class="field__label">{{ $t('ui.monitoring.silence.duration') }}</span>
            <span class="select-field">
              <select v-model.number="hours">
                <option :value="1">{{ $t('ui.monitoring.silence.hours_1') }}</option>
                <option :value="4">{{ $t('ui.monitoring.silence.hours_4') }}</option>
                <option :value="8">{{ $t('ui.monitoring.silence.hours_8') }}</option>
                <option :value="12">{{ $t('ui.monitoring.silence.hours_12') }}</option>
                <option :value="24">{{ $t('ui.monitoring.silence.hours_24') }}</option>
                <option :value="72">{{ $t('ui.monitoring.silence.hours_72') }}</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">{{ $t('ui.monitoring.silence.reason') }}</span>
            <input v-model="reason" type="text" maxlength="200" :placeholder="$t('ui.monitoring.silence.reason_placeholder')">
            <span class="field__hint">{{ $t('ui.monitoring.silence.reason_hint') }}</span>
          </label>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="$emit('close')">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
            {{ busy ? $t('ui.monitoring.silence.submitting') : $t('ui.monitoring.silence.submit') }}
          </button>
        </template>
      </modal-shell>
    `
  };

  Views.MonConvertDialog = {
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      alert: { type: Object, default: null },
      app: { type: Object, required: true }
    },
    emits: ['close', 'saved'],
    data() {
      return { incidentId: '', busy: false, error: '' };
    },
    watch: {
      open: {
        // A dialog mounted already open, as on a direct alert link, must load
        // the canonical incident choices too.
        immediate: true,
        handler(value) {
          if (!value) return;
          this.incidentId = this.alert && this.alert.incident ? this.alert.incident.id : '';
          this.busy = false;
          this.error = '';
          this.loadIncidents();
        }
      }
    },
    computed: {
      incidentState() {
        const api = this.app.maintenanceApi;
        return api && api.incidents ? api.incidents : null;
      },
      incidents() {
        return this.incidentState ? this.incidentState.items || [] : [];
      },
      incidentsLoading() {
        return !!(this.incidentState && this.incidentState.loading);
      },
      incidentsLoaded() {
        return !!(this.incidentState && this.incidentState.loaded);
      },
      incidentsError() {
        return this.incidentState ? this.incidentState.error : '';
      }
    },
    methods: {
      async loadIncidents(force) {
        const state = this.incidentState;
        if (!state || state.loading) return false;
        if (!force && state.loaded && !state.error) return true;
        return this.app.loadMaintenanceIncidents({ reset: true });
      },
      retryIncidents() {
        return this.loadIncidents(true);
      },
      async submit() {
        if (!this.alert || this.busy) return;
        this.busy = true;
        this.error = '';
        const result = await this.app.linkMonitoringIncident(this.alert.id, this.incidentId);
        this.busy = false;
        if (!result.ok) {
          this.error = result.error || tr('ui.monitoring.convert.link_failed');
          return;
        }
        this.app.showToast(this.incidentId ? tr('ui.monitoring.convert.linked') : tr('ui.monitoring.convert.created'));
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.monitoring.convert.title')" :eyebrow="$t('ui.monitoring.convert.incident')" size="normal" @close="$emit('close')">
        <div class="form-stack mon-dialog">
          <p class="form-intro">{{ $t('ui.monitoring.convert.intro') }}</p>
          <label class="field">
            <span class="field__label">{{ $t('ui.monitoring.convert.incident') }}</span>
            <span class="select-field">
              <select v-model="incidentId">
                <option value="">{{ $t('ui.monitoring.convert.create_new') }}</option>
                <option v-for="incident in incidents" :key="incident.id" :value="incident.id">
                  {{ incident.code || incident.id }} · {{ incident.title || incident.summary || $t('ui.monitoring.convert.untitled') }}
                </option>
              </select>
            </span>
            <span class="field__hint">{{ $t('ui.monitoring.convert.hint') }}</span>
          </label>
          <p v-if="incidentsLoading" class="field__hint" role="status">{{ $t('ui.monitoring.convert.loading') }}</p>
          <div v-else-if="incidentsError" class="mon-notice mon-notice--warn" role="alert">
            <span class="mon-notice__text">{{ incidentsError }}</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--ghost" @click="retryIncidents">{{ $t('ui.common.retry') }}</button>
            </div>
          </div>
          <p v-else-if="incidentsLoaded && !incidents.length" class="field__hint">
            {{ $t('ui.monitoring.convert.empty') }}
          </p>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="$emit('close')">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
            {{ busy ? $t('ui.common.saving') : (incidentId ? $t('ui.monitoring.convert.link') : $t('ui.monitoring.convert.create')) }}
          </button>
        </template>
      </modal-shell>
    `
  };

  // ---------------------------------------------------------------- center
  Views.MonitoringCenter = {
    components: {
      AppIcon: window.AppIcon,
      MonChart: Views.MonChart,
      MonSpark: Views.MonSpark,
      MonStatusPill: Views.MonStatusPill,
      MonMetric: Views.MonMetric,
      MonSilenceDialog: Views.MonSilenceDialog,
      MonConvertDialog: Views.MonConvertDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      const section = this.app.route && this.app.route.section ? this.app.route.section : 'estado';
      // The route loads the alert page from the shared filters; the controls
      // start from that same state so they can never describe another scope.
      const alerts = (this.app.monitoringApi && this.app.monitoringApi.alertFilters) || {};
      return {
        tab: ['estado', 'dispositivos', 'alertas'].indexOf(section) !== -1 ? section : 'estado',
        filters: {
          query: '', category: 'all', site: 'all', status: 'all',
          severity: alerts.severity || 'all',
          state: alerts.state || 'firing',
          ack: 'all', silenced: 'all',
          assetId: alerts.assetId || 'all'
        },
        deviceFilters: { query: '', category: 'all', site: 'all', status: 'all' },
        dialogs: { silence: false, convert: false },
        activeAlert: null,
        alertLoading: false
      };
    },
    async mounted() {
      // Figure labels come from the inventory catalog the server owns; asking
      // its owner to load keeps a single canonical source for them.
      const task = ensureCategoryCatalog(this.app);
      if (task) await task;
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      rows() { return this.app.monitoringDevices; },
      stats() { return this.app.monitoringStats; },
      statusCards() {
        const stats = this.stats;
        return [
          { id: 'up', label: tr('ui.monitoring.card.up'), value: stats.up, hint: tr('ui.monitoring.card.up_hint'), tone: 'ok', icon: 'check' },
          { id: 'down', label: tr('ui.monitoring.card.down'), value: stats.down, hint: tr('ui.monitoring.card.down_hint'), tone: 'down', icon: 'x-circle' },
          { id: 'degraded', label: tr('ui.monitoring.card.degraded'), value: stats.degraded, hint: tr('ui.monitoring.card.degraded_hint'), tone: 'warn', icon: 'alert' },
          { id: 'unmonitored', label: tr('ui.monitoring.status.unmonitored'), value: stats.unmonitored, hint: tr('ui.monitoring.card.unmonitored_hint', { noData: stats.noData, unavailable: stats.unavailable }), tone: 'neutral', icon: 'minus' }
        ];
      },
      availabilityPoints() { return this.app.monitoringAvailabilityPoints; },
      latencyPoints() { return this.app.monitoringLatencyPoints; },
      loading() { return this.app.monitoringDevicesLoading; },
      alertsLoading() { return this.app.monitoringAlertsLoading || this.alertLoading; },
      error() { return this.app.monitoringDevicesError; },
      alertsError() { return this.app.monitoringAlertsError; },
      truncated() { return this.app.monitoringDevicesTruncated; },
      alertsTruncated() { return this.app.monitoringApi.alerts.total > this.monitoringAlerts.length; },
      // The KPI cards count every loaded device; the list below may narrow them.
      // Both numbers are disclosed so a filtered row is never mistaken for the
      // population the counters describe, and a page read is never presented as
      // the whole server.
      populationNote() {
        const loaded = this.rows.length;
        const visible = this.deviceRows.length;
        const total = this.stats.total;
        if (this.truncated) return tr('ui.monitoring.center.counts_loaded', { loaded, visible, total });
        if (visible !== loaded) return tr('ui.monitoring.center.counts_visible', { loaded, visible });
        return '';
      },
      monitoringAlerts() { return this.app.monitoringAlerts; },
      // "No devices match these filters" is a false claim on an installation
      // that has no assets at all and no filter applied.
      devicesEmptyKey() {
        // 'all' is the absence of a filter, not a filter value: an installation
        // with no inventoried asset must not claim that a filter emptied it.
        const narrowed = (value) => !!value && value !== 'all';
        const filters = this.deviceFilters;
        const filtered = !!filters.query.trim()
          || narrowed(filters.status) || narrowed(filters.category) || narrowed(filters.site);
        return filtered || this.stats.total > 0 ? 'ui.monitoring.devices.empty' : 'ui.monitoring.devices.empty_install';
      },
      deviceRows() {
        const filters = this.deviceFilters;
        return this.rows
          .filter((row) => filters.status === 'all' ? true : row.status === filters.status)
          .filter((row) => filters.category === 'all' ? true : row.asset.category === filters.category)
          .filter((row) => filters.site === 'all' ? true : row.asset.siteId === filters.site)
          .filter((row) => {
            const term = filters.query.trim().toLocaleLowerCase();
            if (!term) return true;
            return (row.asset.name + ' ' + row.asset.id + ' ' + row.asset.quickCode + ' ' + (row.checkType || '') + ' ' + (row.target || ''))
              .toLocaleLowerCase().indexOf(term) !== -1;
          })
          .sort((a, b) => {
            const order = { down: 0, degraded: 1, unavailable: 2, no_data: 3, up: 4, unmonitored: 5 };
            const diff = order[a.status] - order[b.status];
            return diff || compareText(a.asset.name, b.asset.name, { sensitivity: 'variant' });
          });
      },
      attention() {
        return this.rows
          .filter((row) => row.status === 'down' || row.status === 'degraded')
          .sort((a, b) => (a.status === b.status ? 0 : a.status === 'down' ? -1 : 1));
      },
      unmonitoredRows() {
        return this.rows.filter((row) => row.status === 'unmonitored' || row.status === 'no_data' || row.status === 'unavailable');
      },
      alertRows() {
        const filters = this.filters;
        const term = filters.query.trim().toLocaleLowerCase();
        return this.monitoringAlerts
          .filter((alert) => filters.ack === 'ack' ? alert.acknowledged : (filters.ack === 'unack' ? !alert.acknowledged : true))
          .filter((alert) => filters.silenced === 'silenced' ? alert.silenced : (filters.silenced === 'active' ? !alert.silenced : true))
          .filter((alert) => filters.assetId === 'all' ? true : alert.assetId === filters.assetId)
          .filter((alert) => {
            if (!term) return true;
            return (alert.alertName + ' ' + alert.assetName + ' ' + alert.quickCode + ' ' + alert.summary)
              .toLocaleLowerCase().indexOf(term) !== -1;
          });
      },
      activeAlertRows() {
        return this.alertRows.filter((alert) => alert.state === 'firing' || alert.state === 'pending').slice(0, 4);
      },
      // Labels come from the canonical inventory catalog by id. Categories the
      // catalog does not list stay visible when loaded rows reference them, with
      // the bounded sentence-case fallback instead of a guessed name.
      categories() {
        const entries = categoryEntries(this.app);
        const names = new Map(entries.map((category) => [category.id, category.label]));
        this.rows.forEach((row) => {
          const id = String((row.asset && row.asset.category) || '');
          if (id && !names.has(id)) names.set(id, fallbackLabel(id));
        });
        return Array.from(names, ([id, name]) => ({ id, name: name || id }));
      },
      categoryName(id) {
        const key = String(id || '');
        if (!key) return '—';
        const found = this.categories.find((category) => category.id === key);
        return found && found.name ? found.name : (fallbackLabel(key) || '—');
      },
      // Configuration sites carry {id, label}; the server directory carries
      // {id, label} as well, so the option label is resolved here instead of
      // relying on a `name` field the shipped data never had.
      sites() {
        return (this.app.sites || []).map((site) => ({ id: site.id, name: site.name || site.label || site.id }));
      },
      assetOptions() { return this.rows.map((row) => row.asset); },
      ranges() {
        const presets = this.app.monitoringPresets.periods;
        return presets && presets.length ? presets : ['24h', '7d', '30d'];
      },
      range() { return this.app.monitoringApi.overview.period || '24h'; },
      rangeLabel() { return periodLabel(this.range); },
      canEdit() { return this.app.monitoringEditable; },
      canIncident() { return this.app.monitoringEditable; },
      provenance() { return this.app.monitoringProvenance; },
      provenanceNote() {
        if (this.error) return tr('ui.monitoring.center.provenance_error');
        if (this.loading && !this.deviceRows.length) return tr('ui.monitoring.center.provenance_error');
        const configured = this.provenance.prometheusConfigured;
        const base = tr('ui.monitoring.center.provenance', { period: this.rangeLabel, total: this.stats.total });
        if (configured === false) return base + tr('ui.monitoring.center.provenance_unconfigured');
        return base;
      },
      alertStateOptions() {
        return [
          { id: 'firing', label: tr('ui.monitoring.alert_state.firing_plural') },
          { id: 'pending', label: tr('ui.monitoring.alert_state.pending_plural') },
          { id: 'resolved', label: tr('ui.monitoring.alert_state.resolved_plural') },
          { id: 'all', label: tr('ui.monitoring.filter.all_f') }
        ];
      },
      severityOptions() {
        return [
          { id: 'critical', label: tr('ui.monitoring.severity.critical') },
          { id: 'warning', label: tr('ui.monitoring.severity.warning') },
          { id: 'info', label: tr('ui.monitoring.severity.info') }
        ];
      }
    },
    methods: {
      fmtNumber,
      fmtDateTime,
      fmtDay,
      fmtClock,
      rel,
      duration,
      periodLabel,
      statusMeta: Mapping.statusMeta,
      severityMeta: Mapping.severityMeta,
      alertStateMeta: Mapping.alertStateMeta,
      checkMeta: Mapping.checkMeta,
      reasonLabel: reasonCopy,
      setTab(tab) {
        this.tab = tab;
        if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: tab });
      },
      filterStatus(status) {
        this.deviceFilters.status = this.deviceFilters.status === status ? 'all' : status;
        this.setTab('dispositivos');
      },
      setRange(period) {
        if (period === this.range) return;
        this.app.monitoringApi.overview.period = period;
        this.refresh();
      },
      async refresh() {
        const results = await Promise.all([
          this.app.loadMonitoringDevices({ period: this.range }),
          this.app.loadMonitoringAlerts({ state: this.filters.state }),
          this.app.loadMonitoringConfig()
        ]);
        if (results.some(Boolean)) this.app.showToast(tr('ui.monitoring.center.refreshed'));
      },
      async applyAlertFilters() {
        this.alertLoading = true;
        await this.app.loadMonitoringAlerts({ state: this.filters.state, severity: this.filters.severity, assetId: this.filters.assetId });
        this.alertLoading = false;
      },
      openDevice(id) {
        if (this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: id });
      },
      openAlert(id) {
        if (this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: id });
      },
      openAsset(id) {
        this.openDevice(id);
      },
      openConfig(anchor) {
        if (this.app.setHash) this.app.setHash('#/configuracion/' + (anchor || 'supervision'));
      },
      async acknowledge(alert) {
        if (!alert || !this.canEdit) return;
        const result = await this.app.acknowledgeMonitoringAlert(alert.id, '');
        if (result.ok) this.app.showToast(tr('ui.monitoring.center.acknowledged'));
      },
      askSilence(alert) {
        this.activeAlert = alert;
        this.dialogs.silence = true;
      },
      askConvert(alert) {
        this.activeAlert = alert;
        this.dialogs.convert = true;
      },
      openIncident(alert) {
        if (!alert || !alert.incident || !alert.incident.id) {
          this.askConvert(alert);
          return;
        }
        if (this.app.setHash) this.app.setHash({ name: 'incident', incidentId: alert.incident.id });
      },
      openMoreDevices() { this.app.loadMoreMonitoringDevices(); },
      openMoreAlerts() { this.app.loadMoreMonitoringAlerts(); }
    },
    template: `
      <section class="page mon-page" aria-labelledby="mon-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.center.eyebrow') }}</p>
            <h1 id="mon-title">{{ $t('ui.monitoring.center.title') }}</h1>
            <p class="page-sub">{{ $t('ui.monitoring.center.sub') }}</p>
            <p class="mon-panel__sub">{{ provenanceNote }}</p>
          </div>
          <div class="mon-head__actions">
            <div class="mon-range" role="group" :aria-label="$t('ui.monitoring.center.range_aria')">
              <button v-for="period in ranges" :key="period" type="button" class="mon-range__button"
                      :class="{ 'is-active': range === period }" :aria-pressed="range === period"
                      :disabled="loading" @click="setRange(period)">{{ periodLabel(period) }}</button>
            </div>
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? $t('ui.monitoring.action.refreshing') : $t('ui.monitoring.action.refresh') }}
            </button>
          </div>
        </header>

        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.monitoring.center.loading') }}</p>
        <div v-if="error" class="mon-notice" role="alert">
          <strong class="mon-notice__title">{{ $t('ui.monitoring.center.error_title') }}</strong>
          <span class="mon-notice__text">{{ error }}</span>
          <div class="mon-notice__actions">
            <button type="button" class="btn btn--secondary" @click="refresh">{{ $t('ui.common.retry') }}</button>
          </div>
        </div>

        <div v-if="!error && !(loading && !deviceRows.length)" class="mon-kpis">
          <button v-for="card in statusCards" :key="card.id" type="button" class="mon-kpi" :class="'mon-kpi--' + card.tone"
                  @click="filterStatus(card.id)">
            <span class="mon-kpi__icon"><app-icon :name="card.icon"></app-icon></span>
            <span class="mon-kpi__label">{{ card.label }}</span>
            <span class="mon-kpi__value mono">{{ card.value }}</span>
            <span class="mon-kpi__hint">{{ card.hint }}</span>
          </button>
        </div>

          <p v-if="populationNote" class="mon-panel__sub">{{ populationNote }}</p>

        <div class="mon-tabs" role="tablist" :aria-label="$t('ui.monitoring.center.tabs_aria')">
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'estado'" :class="{ 'is-active': tab === 'estado' }" @click="setTab('estado')">{{ $t('ui.monitoring.field.state') }}</button>
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'dispositivos'" :class="{ 'is-active': tab === 'dispositivos' }" @click="setTab('dispositivos')">
            {{ $t('ui.monitoring.tab.devices') }} <span class="mon-tab__count mono">{{ stats.total }}</span>
          </button>
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'alertas'" :class="{ 'is-active': tab === 'alertas' }" @click="setTab('alertas')">
            {{ $t('ui.monitoring.tab.alerts') }} <span class="mon-tab__count mono">{{ app.monitoringActiveAlertCount }}</span>
          </button>
        </div>

        <div v-if="tab === 'estado'" role="tabpanel" class="mon-stack">
          <div class="mon-grid mon-grid--charts">
            <mon-chart :label="$t('ui.monitoring.center.chart_availability')" :points="availabilityPoints" unit="%" :min="0" :max="100" tone="teal"></mon-chart>
            <mon-chart :label="$t('ui.monitoring.center.chart_latency')" :points="latencyPoints" unit="ms" :zero-base="true" tone="warn"></mon-chart>
          </div>
          <p class="mon-panel__sub">{{ $t('ui.monitoring.center.charts_sub') }}</p>

          <div v-if="attention.length" class="mon-panel mon-attention">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.center.attention') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.monitoring.center.attention_sub') }}</span>
            </header>
            <ul class="mon-attention__list">
              <li v-for="row in attention" :key="row.assetId" class="mon-attention__item">
                <div class="mon-attention__main">
                  <span class="mon-attention__name">{{ row.asset.name }}</span>
                  <span class="mon-attention__meta mono">{{ row.asset.quickCode }} · {{ reasonLabel(row.reason) || statusMeta(row.status).label }}</span>
                </div>
                <span class="mon-attention__meta">{{ rel(row.lastCheckAt) }}</span>
                <div class="mon-attention__actions">
                  <button type="button" class="text-button" @click="openDevice(row.assetId)">{{ $t('ui.monitoring.action.view_asset') }}</button>
                </div>
              </li>
            </ul>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.center.active_alerts') }}</h2>
              <button type="button" class="text-button" @click="setTab('alertas')">{{ $t('ui.monitoring.action.view_all') }}</button>
            </header>
            <p v-if="alertsLoading" class="mon-panel__sub" role="status">{{ $t('ui.monitoring.center.alerts_loading') }}</p>
            <p v-else-if="alertsError" class="form-error" role="alert">{{ alertsError }}</p>
            <ul v-else-if="activeAlertRows.length" class="mon-alert-list mon-alert-list--compact">
              <li v-for="alert in activeAlertRows" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
                <div class="mon-alert__rail"></div>
                <div class="mon-alert__body">
                  <div class="mon-alert__head">
                    <button type="button" class="mon-alert__title" @click="openAlert(alert.id)">{{ alert.alertName }}</button>
                    <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ severityMeta(alert.severity).label }}</span>
                    <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alertStateMeta(alert.state).label }}</span>
                    <span v-if="alert.acknowledged" class="mon-tag">{{ $t('ui.monitoring.tag.acknowledged') }}</span>
                    <span v-if="alert.silenced" class="mon-tag">{{ $t('ui.monitoring.tag.silenced') }}</span>
                  </div>
                  <p class="mon-alert__message">{{ alert.message }}</p>
                  <p class="mon-alert__meta mono">{{ alert.quickCode }} · {{ rel(alert.lastSeenAt) }}</p>
                  <div class="mon-alert__actions">
                    <button v-if="canEdit && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">{{ $t('ui.monitoring.action.acknowledge') }}</button>
                    <button v-if="canEdit && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">{{ $t('ui.monitoring.silence.submit') }}</button>
                    <button v-if="canIncident" type="button" class="text-button" @click="openIncident(alert)">
                      {{ alert.incident ? $t('ui.monitoring.action.view_incident') : $t('ui.monitoring.action.link_incident') }}
                    </button>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="empty-state">{{ $t('ui.monitoring.center.no_active_alerts') }}</p>
          </div>

          <div v-if="unmonitoredRows.length" class="mon-panel mon-unmonitored">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.unmonitored.title') }}</h2>
              <button type="button" class="text-button" @click="openConfig('supervision')">{{ $t('ui.monitoring.action.configure_checks') }}</button>
            </header>
            <ul class="mon-unmonitored__list">
              <li v-for="row in unmonitoredRows" :key="row.assetId" class="mon-unmonitored__item">
                <div>
                  <span class="mon-unmonitored__name">{{ row.asset.name }}</span>
                  <span class="mon-unmonitored__meta mono">{{ row.asset.quickCode }}</span>
                </div>
                <span class="mon-unmonitored__state">{{ reasonLabel(row.reason) || statusMeta(row.status).label }}</span>
              </li>
            </ul>
            <p class="mon-panel__sub">{{ $t('ui.monitoring.unmonitored.sub') }}</p>
          </div>
        </div>

        <div v-if="tab === 'dispositivos'" role="tabpanel" class="mon-stack">
          <div class="mon-toolbar mon-toolbar--wrap">
            <label class="field mon-search">
              <span class="field__label">{{ $t('ui.monitoring.field.search') }}</span>
              <span class="search-field">
                <app-icon name="search"></app-icon>
                <input v-model="deviceFilters.query" type="search" :placeholder="$t('ui.monitoring.placeholder.device_search')">
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="deviceFilters.status">
                  <option value="all">{{ $t('ui.monitoring.filter.all') }}</option>
                  <option value="up">{{ $t('ui.monitoring.status.up') }}</option>
                  <option value="degraded">{{ $t('ui.monitoring.status.degraded') }}</option>
                  <option value="down">{{ $t('ui.monitoring.status.down') }}</option>
                  <option value="unmonitored">{{ $t('ui.monitoring.status.unmonitored') }}</option>
                  <option value="no_data">{{ $t('ui.monitoring.status.no_data') }}</option>
                  <option value="unavailable">{{ $t('ui.monitoring.status.unavailable') }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.category') }}</span>
              <span class="select-field">
                <select v-model="deviceFilters.category">
                  <option value="all">{{ $t('ui.monitoring.filter.all_f') }}</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.site') }}</span>
              <span class="select-field">
                <select v-model="deviceFilters.site">
                  <option value="all">{{ $t('ui.monitoring.filter.all_f') }}</option>
                  <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
                </select>
              </span>
            </label>
          </div>

          <p v-if="loading" class="mon-panel__sub" role="status">{{ $t('ui.monitoring.devices.loading') }}</p>
          <div v-else-if="!error" class="mon-table-wrap" role="region" tabindex="0" :aria-label="$t('ui.monitoring.devices.caption')">
            <table class="mon-table">
              <caption class="sr-only">{{ $t('ui.monitoring.devices.caption') }}</caption>
              <thead>
                <tr>
                  <th scope="col">{{ $t('ui.monitoring.field.asset') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.field.state') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.table.check') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.table.latency') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.table.availability') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.table.last_read') }}</th>
                  <th scope="col">{{ $t('ui.monitoring.tab.alerts') }}</th>
                  <th scope="col"><span class="sr-only">{{ $t('ui.monitoring.table.actions') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in deviceRows" :key="row.assetId" class="mon-table__row">
                  <td>
                    <button type="button" class="mon-table__device" @click="openDevice(row.assetId)">
                      <span class="mon-table__name">{{ row.asset.name }}</span>
                      <span class="mon-table__meta mono">{{ row.asset.quickCode }} · {{ row.asset.site || $t('ui.monitoring.device.no_site') }}</span>
                    </button>
                  </td>
                  <td>
                    <mon-status-pill :status="row.status"></mon-status-pill>
                    <span v-if="reasonLabel(row.reason)" class="mon-table__meta">{{ reasonLabel(row.reason) }}</span>
                  </td>
                  <td>
                    <span>{{ checkMeta(row.checkType).label || '—' }}</span>
                    <span class="mon-table__meta mono">{{ row.target || $t('ui.monitoring.field.no_target') }}</span>
                  </td>
                  <td class="mono">{{ fmtNumber(row.latencyMs, 'ms') }}</td>
                  <td class="mono">{{ row.uptimePct === null ? '—' : fmtNumber(row.uptimePct, '%') }}</td>
                  <td class="mon-table__time">{{ row.lastCheckAt ? fmtDateTime(row.lastCheckAt) : $t('ui.monitoring.status.unavailable') }}</td>
                  <td class="mono">{{ row.activeAlerts }}</td>
                  <td class="mon-table__actions">
                    <button type="button" class="text-button" @click="openDevice(row.assetId)">{{ $t('ui.monitoring.action.view') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!deviceRows.length" class="empty-state">{{ $t(devicesEmptyKey) }}</p>
          </div>
          <div v-if="truncated" class="mon-settings__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="openMoreDevices">{{ $t('ui.monitoring.action.load_more_devices') }}</button>
            <span class="mon-panel__sub">{{ $t('ui.monitoring.count_of', { shown: rows.length, total: stats.total }) }}</span>
          </div>
        </div>

        <div v-if="tab === 'alertas'" role="tabpanel" class="mon-stack">
          <div class="mon-toolbar mon-toolbar--wrap">
            <label class="field mon-search">
              <span class="field__label">{{ $t('ui.monitoring.field.search') }}</span>
              <span class="search-field">
                <app-icon name="search"></app-icon>
                <input v-model="filters.query" type="search" :placeholder="$t('ui.monitoring.placeholder.alert_search')">
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.state') }}</span>
              <span class="select-field">
                <select v-model="filters.state" @change="applyAlertFilters">
                  <option v-for="option in alertStateOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.severity') }}</span>
              <span class="select-field">
                <select v-model="filters.severity" @change="applyAlertFilters">
                  <option value="all">{{ $t('ui.monitoring.filter.all_f') }}</option>
                  <option v-for="option in severityOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.asset') }}</span>
              <span class="select-field">
                <select v-model="filters.assetId" @change="applyAlertFilters">
                  <option value="all">{{ $t('ui.monitoring.filter.all') }}</option>
                  <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.acknowledgement') }}</span>
              <span class="select-field">
                <select v-model="filters.ack">
                  <option value="all">{{ $t('ui.monitoring.filter.all_f') }}</option>
                  <option value="ack">{{ $t('ui.monitoring.filter.acknowledged') }}</option>
                  <option value="unack">{{ $t('ui.monitoring.filter.unacknowledged') }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.monitoring.field.silence') }}</span>
              <span class="select-field">
                <select v-model="filters.silenced">
                  <option value="all">{{ $t('ui.monitoring.filter.all_f') }}</option>
                  <option value="silenced">{{ $t('ui.monitoring.filter.silenced') }}</option>
                  <option value="active">{{ $t('ui.monitoring.filter.not_silenced') }}</option>
                </select>
              </span>
            </label>
          </div>

          <p v-if="alertsLoading" class="mon-panel__sub" role="status">{{ $t('ui.monitoring.center.alerts_loading') }}</p>
          <div v-else-if="alertsError" class="mon-notice" role="alert">
            <span class="mon-notice__text">{{ alertsError }}</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--secondary" @click="refresh">{{ $t('ui.common.retry') }}</button>
            </div>
          </div>
          <ul v-else-if="alertRows.length" class="mon-alert-list">
            <li v-for="alert in alertRows" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
              <div class="mon-alert__rail"></div>
              <div class="mon-alert__body">
                <div class="mon-alert__head">
                  <button type="button" class="mon-alert__title" @click="openAlert(alert.id)">{{ alert.alertName }}</button>
                  <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ severityMeta(alert.severity).label }}</span>
                  <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alertStateMeta(alert.state).label }}</span>
                  <span v-if="alert.acknowledged" class="mon-tag mon-tag--ok">{{ $t('ui.monitoring.tag.acknowledged') }}</span>
                  <span v-if="alert.silenced" class="mon-tag">{{ $t('ui.monitoring.tag.silenced') }}</span>
                  <span v-if="alert.incident" class="mon-tag">{{ $t('ui.monitoring.tag.incident') }}</span>
                </div>
                <p class="mon-alert__message">{{ alert.message }}</p>
                <p class="mon-alert__meta mono">{{ alert.quickCode || alert.assetName }} · {{ fmtDateTime(alert.lastSeenAt || alert.startsAt) }}</p>
                <div class="mon-alert__actions">
                  <button v-if="canEdit && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">{{ $t('ui.monitoring.action.acknowledge') }}</button>
                  <button v-if="canEdit && alert.state !== 'resolved' && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">{{ $t('ui.monitoring.silence.submit') }}</button>
                  <button type="button" class="text-button text-button--quiet" @click="openAlert(alert.id)">{{ $t('ui.monitoring.action.detail') }}</button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="empty-state">{{ $t('ui.monitoring.alerts.empty') }}</p>
          <div v-if="alertsTruncated" class="mon-settings__actions">
            <button type="button" class="btn btn--secondary" :disabled="alertsLoading" @click="openMoreAlerts">{{ $t('ui.monitoring.action.load_more_alerts') }}</button>
            <span class="mon-panel__sub">{{ $t('ui.monitoring.count_of', { shown: monitoringAlerts.length, total: app.monitoringApi.alerts.total }) }}</span>
          </div>
        </div>

        <mon-silence-dialog :open="dialogs.silence" :alert="activeAlert" :asset-id="activeAlert ? activeAlert.assetId : ''"
                            :app="app" @close="dialogs.silence = false" @saved="refresh"></mon-silence-dialog>
        <mon-convert-dialog :open="dialogs.convert" :alert="activeAlert" :app="app"
                            @close="dialogs.convert = false" @saved="refresh"></mon-convert-dialog>
      </section>
    `
  };

  // ---------------------------------------------------------------- device
  Views.MonitorDevice = {
    components: { AppIcon: window.AppIcon, MonChart: Views.MonChart, MonSpark: Views.MonSpark, MonStatusPill: Views.MonStatusPill, MonMetric: Views.MonMetric, MonSilenceDialog: Views.MonSilenceDialog, MonConvertDialog: Views.MonConvertDialog },
    props: { app: { type: Object, required: true } },
    data() {
      return { metric: 'latency', dialogs: { silence: false, convert: false }, activeAlert: null, thumbMissing: false };
    },
    computed: {
      record() { return this.app.monitoringDeviceRecord; },
      asset() {
        if (this.record && this.record.asset) return this.record.asset;
        return this.app.currentAsset || { id: this.app.route.assetId, name: this.app.route.assetId, quickCode: '', category: '', image: '' };
      },
      loading() { return this.app.monitoringDeviceLoading; },
      error() { return this.app.monitoringDeviceError; },
      missing() { return this.app.monitoringDeviceMissing; },
      period() { return this.app.monitoringDevicePeriod; },
      ranges() {
        const presets = this.app.monitoringPresets.periods;
        return presets && presets.length ? presets : ['24h', '7d', '30d'];
      },
      status() { return this.record ? this.record.status : 'no_data'; },
      provenance() { return this.record ? this.record.provenance : { source: 'prometheus', period: { preset: this.period } }; },
      uptimePercent() { return this.record && this.record.uptime ? this.record.uptime.percent : null; },
      uptimeSamples() { return this.record && this.record.uptime ? this.record.uptime.samples : null; },
      alertList() { return this.record && this.record.alerts ? this.record.alerts.recent || [] : []; },
      activeAlerts() { return this.alertList.filter((alert) => alert.state === 'firing' || alert.state === 'pending'); },
      checks() { return this.record ? this.record.checks || [] : []; },
      series() { return this.record ? this.record.series || [] : []; },
      metricOptions() {
        return this.series.map((item) => ({ id: item.metric, label: this.metricLabel(item.metric), unit: item.unit, points: item.points }))
          .filter((item) => item.points.length);
      },
      activeSeries() {
        return this.series.find((item) => item.metric === this.metric) || this.series[0] || { metric: 'latency', unit: 'seconds', points: [] };
      },
      chartPoints() {
        return this.activeSeries.points.map((point) => ({
          at: point.at,
          label: point.label,
          value: this.activeSeries.metric === 'latency' ? Math.round(point.value * 1000 * 10) / 10 : point.value
        }));
      },
      chartUnit() { return this.activeSeries.metric === 'latency' ? 'ms' : (this.activeSeries.unit === 'percent' ? '%' : (this.activeSeries.unit === 'celsius' ? '°C' : '')); },
      chartLabel() { return tr('ui.monitoring.device.chart_label', { metric: this.metricLabel(this.activeSeries.metric) }); },
      config() { return this.record ? this.record.config : null; },
      configRows() {
        const config = this.config;
        if (!config) return [];
        return [
          { label: tr('ui.monitoring.config.enabled'), value: config.enabled ? tr('ui.monitoring.common.yes') : tr('ui.monitoring.common.no') },
          { label: tr('ui.monitoring.config.check'), value: Mapping.checkMeta(config.checkType).label || '—' },
          { label: tr('ui.monitoring.config.target'), value: config.target || tr('ui.monitoring.field.no_target') },
          { label: tr('ui.monitoring.config.interval'), value: config.intervalSeconds ? config.intervalSeconds + ' s' : '—' },
          { label: tr('ui.monitoring.config.min_duration'), value: config.minimumDurationSeconds === null ? '—' : config.minimumDurationSeconds + ' s' },
          { label: tr('ui.monitoring.config.exporter'), value: config.exporterId || '—' },
          { label: tr('ui.monitoring.config.snmp_module'), value: config.snmpModule || '—' },
          { label: tr('ui.monitoring.config.snmp_credential'), value: config.snmpAuthRef ? tr('ui.monitoring.config.credential_configured') : '—' }
        ];
      },
      overriddenLabel() {
        const keys = (this.config && this.config.overridden) || [];
        const labels = keys.map((key) => OVERRIDE_LABELS[key]).filter(Boolean).map((key) => tr(key));
        return labels.length ? labels.join(', ') : tr('ui.monitoring.device.no_overrides');
      },
      metrics() {
        return [
          { label: tr('ui.monitoring.device.metric_availability'), value: this.uptimePercent === null ? '—' : fmtNumber(this.uptimePercent, '%'), hint: this.uptimeSamples === null ? tr('ui.monitoring.device.no_samples') : tr('ui.monitoring.device.samples', { count: this.uptimeSamples }), icon: 'activity', tone: this.uptimePercent === null ? 'neutral' : 'ok' },
          { label: tr('ui.monitoring.device.metric_latency'), value: this.record && this.record.latency ? fmtNumber(this.record.latency.currentMs, 'ms') : '—', hint: this.record && this.record.latency ? tr('ui.monitoring.device.p95', { value: fmtNumber(this.record.latency.p95Ms, 'ms') }) : tr('ui.monitoring.device.no_summary'), icon: 'clock', tone: 'neutral' },
          { label: tr('ui.monitoring.device.metric_last_check'), value: this.checks.length ? fmtDateTime(this.checks[0].lastCheckAt) : tr('ui.monitoring.status.unavailable'), hint: !this.checks.length ? tr('ui.monitoring.device.no_sample') : (this.checks[0].latencyMs === null || this.checks[0].latencyMs === undefined ? rel(this.checks[0].lastCheckAt) : fmtNumber(this.checks[0].latencyMs, 'ms')), icon: 'check', tone: 'neutral' },
          { label: tr('ui.monitoring.center.active_alerts'), value: String(this.activeAlerts.length), hint: tr('ui.monitoring.device.recent', { count: this.alertList.length }), icon: 'alert', tone: this.activeAlerts.length ? 'warn' : 'ok' }
        ];
      }
    },
    async mounted() {
      // The profile category label is a catalog value; the device page asks the
      // canonical owner for it instead of printing a slug or a local guess.
      const task = ensureCategoryCatalog(this.app);
      if (task) await task;
    },
    watch: {
      'app.route.assetId'(id) {
        this.thumbMissing = false;
        if (id) this.app.loadMonitoringDevice(id, this.period);
      },
      metric(value) {
        if (value && !this.series.some((item) => item.metric === value)) this.metric = this.activeSeries.metric;
      }
    },
    methods: {
      fmtNumber,
      fmtDateTime,
      fmtDay,
      fmtClock,
      rel,
      duration,
      periodLabel,
      statusMeta: Mapping.statusMeta,
      checkMeta: Mapping.checkMeta,
      severityMeta: Mapping.severityMeta,
      alertStateMeta: Mapping.alertStateMeta,
      metricLabel(metric) {
        const keys = {
          latency: 'ui.monitoring.metric.latency',
          cpu: 'ui.monitoring.metric.cpu',
          memory: 'ui.monitoring.metric.memory',
          disk: 'ui.monitoring.metric.disk',
          temperature: 'ui.monitoring.metric.temperature'
        };
        return keys[metric] ? tr(keys[metric]) : metric;
      },
      setRange(period) {
        if (this.app.route.assetId) this.app.loadMonitoringDevice(this.app.route.assetId, period);
      },
      refresh() {
        if (this.app.route.assetId) this.app.loadMonitoringDevice(this.app.route.assetId, this.period);
      },
      back() { if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: 'dispositivos' }); },
      openAsset() { if (this.app.setHash) this.app.setHash({ name: 'detail', assetId: this.asset.id }); },
      openAlert(alert) {
        if (alert && alert.id && this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: alert.id });
      },
      openIncident(alert) {
        if (this.app.setHash && alert.incident) this.app.setHash({ name: 'incident', incidentId: alert.incident.id });
      },
      configure() { if (this.app.setHash) this.app.setHash('#/configuracion/supervision'); },
      async acknowledge(alert) {
        const result = await this.app.acknowledgeMonitoringAlert(alert.id, '');
        if (result.ok) this.refresh();
      },
      askSilence(alert) { this.activeAlert = alert; this.dialogs.silence = true; },
      askConvert(alert) { this.activeAlert = alert; this.dialogs.convert = true; },
      reasonLabel: reasonCopy,
      thumb() {
        if (this.thumbMissing || !this.asset || !this.asset.image) return '';
        return /\/other\.svg$/.test(this.asset.image) ? '' : this.asset.image;
      },
      categoryName(id) {
        const key = String(id || '');
        if (!key) return '—';
        const found = categoryEntries(this.app).find((category) => category.id === key);
        return found && found.label ? found.label : (fallbackLabel(key) || '—');
      },
      checkTone(state) { return state === 'up' ? 'ok' : (state === 'down' ? 'down' : 'neutral'); }
    },
    template: `
      <section class="page mon-page mon-device" aria-labelledby="mon-device-title">
        <nav class="breadcrumbs" :aria-label="$t('ui.monitoring.breadcrumbs')">
          <button type="button" class="text-button" @click="back">{{ $t('ui.monitoring.nav.monitoring') }}</button>
          <span aria-hidden="true">/</span>
          <span>{{ asset.name }}</span>
        </nav>

        <h1 v-if="!record" id="mon-device-title" class="sr-only">{{ $t('ui.monitoring.device.eyebrow') }}</h1>
        <header v-if="record" class="mon-device__head">
          <div class="mon-device__identity">
            <img v-if="thumb()" class="mon-device__thumb" :src="thumb()" alt="" aria-hidden="true" @error="thumbMissing = true">
            <div>
              <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.device.eyebrow') }}</p>
              <h1 id="mon-device-title">{{ asset.name }}</h1>
              <p class="page-sub mono">{{ asset.quickCode || asset.id }} · {{ categoryName(asset.category) || $t('ui.monitoring.device.no_category') }} · {{ asset.site || $t('ui.monitoring.device.no_site') }}</p>
            </div>
          </div>
          <div class="mon-head__actions">
            <mon-status-pill :status="status"></mon-status-pill>
            <div class="mon-range" role="group" :aria-label="$t('ui.monitoring.device.range_aria')">
              <button v-for="period in ranges" :key="period" type="button" class="mon-range__button"
                      :class="{ 'is-active': app.monitoringDevicePeriod === period }" :aria-pressed="app.monitoringDevicePeriod === period" @click="setRange(period)">{{ periodLabel(period) }}</button>
            </div>
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? $t('ui.monitoring.action.refreshing') : $t('ui.monitoring.action.refresh') }}
            </button>
            <button type="button" class="btn btn--ghost" @click="openAsset">{{ $t('ui.monitoring.action.asset_sheet') }}</button>
          </div>
        </header>

        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.monitoring.device.loading') }}</p>
        <div v-else-if="missing" class="mon-notice" role="alert">
          <strong class="mon-notice__title">{{ $t('ui.monitoring.device.missing') }}</strong>
          <span class="mon-notice__text">{{ $t('ui.monitoring.error.record_missing') }}</span>
        </div>
        <div v-else-if="error" class="mon-notice" role="alert">
          <span class="mon-notice__text">{{ error }}</span>
          <div class="mon-notice__actions">
            <button type="button" class="btn btn--secondary" @click="refresh">{{ $t('ui.common.retry') }}</button>
          </div>
        </div>

        <template v-if="record">
          <p v-if="reasonLabel(record.reason)" class="mon-panel__sub">{{ reasonLabel(record.reason) }}</p>
          <div class="mon-metrics">
            <mon-metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value"
                        :hint="metric.hint" :icon="metric.icon" :tone="metric.tone"></mon-metric>
          </div>

          <p class="mon-panel__sub">
            {{ $t('ui.monitoring.device.provenance', {
              source: provenance.source,
              period: periodLabel(provenance.period.preset),
              from: provenance.period.from ? fmtDateTime(provenance.period.from) : $t('ui.monitoring.device.no_date'),
              to: provenance.period.to ? fmtDateTime(provenance.period.to) : $t('ui.monitoring.device.no_date')
            }) }}
          </p>

          <div v-if="status === 'unmonitored'" class="mon-notice">
            <strong class="mon-notice__title">{{ $t('ui.monitoring.device.not_monitored_title') }}</strong>
            <span class="mon-notice__text">{{ $t('ui.monitoring.device.not_monitored_text') }}</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--secondary" @click="configure">{{ $t('ui.monitoring.action.configure_monitoring') }}</button>
            </div>
          </div>

          <div class="mon-grid mon-grid--split">
            <div class="mon-panel">
              <header class="mon-panel__head">
                <h2 class="mon-panel__title">{{ $t('ui.monitoring.device.checks') }}</h2>
                <span class="mon-panel__sub">{{ $t('ui.monitoring.device.check_types', { count: checks.length }) }}</span>
              </header>
              <ul v-if="checks.length" class="mon-checks-list">
                <li v-for="check in checks" :key="check.checkType + ':' + check.module" class="mon-checks-list__item">
                  <span class="mon-checks-list__icon" :class="'mon-check-dot--' + checkTone(check.state)"></span>
                  <span class="mon-checks-list__label">{{ checkMeta(check.checkType).label }} <span class="mono">{{ check.module }}</span></span>
                  <span class="mon-checks-list__value">{{ check.latencyMs === null ? $t('ui.monitoring.device.no_latency') : fmtNumber(check.latencyMs, 'ms') }}</span>
                  <span class="mon-checks-list__limit">{{ check.lastCheckAt ? fmtDateTime(check.lastCheckAt) : $t('ui.monitoring.device.no_sample') }}</span>
                </li>
              </ul>
              <p v-else class="empty-state">{{ $t('ui.monitoring.device.no_checks') }}</p>
            </div>

            <div class="mon-panel">
              <header class="mon-panel__head">
                <h2 class="mon-panel__title">{{ $t('ui.monitoring.device.effective_config') }}</h2>
                <span class="mon-panel__sub">{{ $t('ui.monitoring.device.profile', { category: categoryName(config.profileCategory) }) }}</span>
              </header>
              <dl class="mon-facts">
                <div v-for="row in configRows" :key="row.label" class="mon-facts__row">
                  <dt>{{ row.label }}</dt><dd class="mono">{{ row.value }}</dd>
                </div>
              </dl>
              <p class="mon-panel__sub">{{ $t('ui.monitoring.device.overrides', { list: overriddenLabel }) }}</p>
            </div>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.device.series') }}</h2>
              <label v-if="metricOptions.length" class="field mon-series-select">
                <span class="sr-only">{{ $t('ui.monitoring.device.metric_aria') }}</span>
                <span class="select-field">
                  <select v-model="metric">
                    <option v-for="option in metricOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                </span>
              </label>
            </header>
            <mon-chart v-if="activeSeries.points.length" :label="chartLabel" :points="chartPoints" :unit="chartUnit" :zero-base="activeSeries.metric !== 'latency'" :tone="activeSeries.metric === 'latency' ? 'teal' : 'warn'"></mon-chart>
            <p v-if="!metricOptions.length" class="mon-panel__sub">{{ $t('ui.monitoring.device.no_series') }}</p>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">{{ $t('ui.monitoring.device.alerts') }}</h2>
              <span class="mon-panel__sub">{{ $t('ui.monitoring.device.active_count', { count: activeAlerts.length }) }}</span>
            </header>
            <ul v-if="alertList.length" class="mon-alert-list mon-alert-list--compact">
              <li v-for="alert in alertList" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
                <div class="mon-alert__rail"></div>
                <div class="mon-alert__body">
                  <div class="mon-alert__head">
                    <button type="button" class="mon-alert__title" @click="openAlert(alert)">{{ alert.alertName }}</button>
                    <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ severityMeta(alert.severity).label }}</span>
                    <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alertStateMeta(alert.state).label }}</span>
                    <span v-if="alert.acknowledged" class="mon-tag">{{ $t('ui.monitoring.tag.acknowledged') }}</span>
                  </div>
                  <p class="mon-alert__message">{{ alert.message }}</p>
                  <div class="mon-alert__actions">
                    <button v-if="app.monitoringEditable && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">{{ $t('ui.monitoring.action.acknowledge') }}</button>
                    <button v-if="app.monitoringEditable && alert.state !== 'resolved' && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">{{ $t('ui.monitoring.silence.submit') }}</button>
                    <button v-if="app.monitoringEditable" type="button" class="text-button" @click="askConvert(alert)">{{ alert.incident ? $t('ui.monitoring.action.view_incident') : $t('ui.monitoring.action.link_incident') }}</button>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="empty-state">{{ $t('ui.monitoring.device.no_alerts') }}</p>
          </div>
        </template>

        <mon-silence-dialog :open="dialogs.silence" :alert="activeAlert" :app="app" @close="dialogs.silence = false" @saved="refresh"></mon-silence-dialog>
        <mon-convert-dialog :open="dialogs.convert" :alert="activeAlert" :app="app" @close="dialogs.convert = false" @saved="refresh"></mon-convert-dialog>
      </section>
    `
  };

  // ---------------------------------------------------------------- alert
  Views.MonitorAlert = {
    components: { AppIcon: window.AppIcon, MonStatusPill: Views.MonStatusPill, MonMetric: Views.MonMetric, MonSilenceDialog: Views.MonSilenceDialog, MonConvertDialog: Views.MonConvertDialog },
    props: { app: { type: Object, required: true } },
    data() { return { dialogs: { silence: false, convert: false }, busy: false }; },
    computed: {
      alert() { return this.app.monitoringAlertRecord; },
      row() { return this.app.monitoringAlertRow; },
      loading() { return this.app.monitoringAlertLoading; },
      error() { return this.app.monitoringAlertError; },
      missing() { return this.app.monitoringAlertMissing; },
      canEdit() { return this.app.monitoringEditable; },
      events() {
        return this.app.monitoringAlertEvents
          .slice()
          .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
          .map((event) => Object.assign({}, event, { display: this.eventText(event) }));
      },
      metrics() {
        const alert = this.alert;
        if (!alert) return [];
        return [
          { label: tr('ui.monitoring.alert.start'), value: fmtDateTime(alert.startsAt), hint: rel(alert.startsAt), icon: 'clock', tone: 'neutral' },
          { label: tr('ui.monitoring.alert.last_signal'), value: fmtDateTime(alert.lastSeenAt), hint: rel(alert.lastSeenAt), icon: 'activity', tone: 'neutral' },
          { label: tr('ui.monitoring.alert.source'), value: alert.source || '—', hint: alert.groupKey ? tr('ui.monitoring.alert.group', { key: alert.groupKey.slice(0, 28) }) : '', icon: 'server', tone: 'neutral' },
          { label: tr('ui.monitoring.convert.incident'), value: alert.incident ? alert.incident.id : tr('ui.monitoring.alert.unlinked'), hint: alert.incident ? (incidentStateCopy(alert.incident.status) || tr('ui.monitoring.alert.link_hint')) : tr('ui.monitoring.alert.link_hint'), icon: 'link', tone: 'neutral' }
        ];
      },
      silence() { return this.alert ? this.alert.silences.find((item) => item.active) || null : null; },
      stateLabel() {
        if (!this.alert) return '—';
        return this.alert.state === 'resolved' ? tr('ui.monitoring.alert.recovered') : this.alertStateMeta(this.alert.state).label;
      },
      suggestedClose() { return !!(this.alert && this.alert.incident && this.alert.incident.suggestedClose); }
    },
    methods: {
      fmtDateTime,
      rel,
      severityMeta: Mapping.severityMeta,
      alertStateMeta: Mapping.alertStateMeta,
      back() { if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: 'alertas' }); },
      openDevice() { if (this.alert && this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: this.alert.assetId }); },
      openIncident() {
        if (this.alert && this.alert.incident && this.app.setHash) this.app.setHash({ name: 'incident', incidentId: this.alert.incident.id });
      },
      async acknowledge() {
        if (!this.alert || this.busy) return;
        this.busy = true;
        const result = await this.app.acknowledgeMonitoringAlert(this.alert.id, '');
        this.busy = false;
        if (result.ok) this.app.showToast(tr('ui.monitoring.center.acknowledged'));
      },
      askSilence() { this.dialogs.silence = true; },
      askConvert() { this.dialogs.convert = true; },
      async prepareMaintenance() {
        if (!this.alert) return;
        const result = await this.app.prepareMonitoringMaintenance(this.alert.id);
        if (!result.ok) return;
        this.app.showToast(result.existingWindow
          ? tr('ui.monitoring.alert.toast_window_exists')
          : tr('ui.monitoring.alert.toast_window_prepared'));
        if (this.app.setHash) this.app.setHash('#/configuracion/alertas');
      },
      // The mapped text mixes a raw catalog key with a Spanish connector; the
      // timeline composes the sentence from the localized label and parts.
      eventText(event) {
        const label = EVENT_LABEL_KEYS[event.action] ? tr(EVENT_LABEL_KEYS[event.action]) : (event.label || event.action);
        const from = event.fromState ? this.alertStateMeta(event.fromState).label : '';
        const to = event.toState ? this.alertStateMeta(event.toState).label : '';
        const transition = from && to && event.fromState !== event.toState
          ? from + ' → ' + to
          : (to || from);
        const parts = [label];
        if (transition) parts.push(transition);
        if (event.note) parts.push(event.note);
        if (event.actor) parts.push(tr('ui.monitoring.alert.by', { actor: event.actor }));
        return parts.filter(Boolean).join(' · ');
      },
      eventTone(event) {
        if (event.action === 'resolved') return 'ok';
        if (event.action === 'acknowledged') return 'hold';
        if (event.action === 'opened' || event.action === 'fired') return 'down';
        return 'neutral';
      },
      refresh() { if (this.app.route.alertId) this.app.loadMonitoringAlert(this.app.route.alertId); }
    },
    template: `
      <section class="page mon-page mon-alert-page" aria-labelledby="mon-alert-title">
        <nav class="breadcrumbs" :aria-label="$t('ui.monitoring.breadcrumbs')">
          <button type="button" class="text-button" @click="back">{{ $t('ui.monitoring.nav.monitoring') }}</button>
          <span aria-hidden="true">/</span>
          <span>{{ $t('ui.monitoring.alert.breadcrumb') }}</span>
        </nav>

        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.monitoring.alert.loading') }}</p>
        <div v-else-if="missing" class="mon-notice" role="alert">
          <strong class="mon-notice__title">{{ $t('ui.monitoring.alert.missing') }}</strong>
          <span class="mon-notice__text">{{ $t('ui.monitoring.error.record_missing') }}</span>
        </div>
        <div v-else-if="error" class="mon-notice" role="alert">
          <span class="mon-notice__text">{{ error }}</span>
          <div class="mon-notice__actions">
            <button type="button" class="btn btn--secondary" @click="refresh">{{ $t('ui.common.retry') }}</button>
          </div>
        </div>

        <template v-if="alert">
          <header class="mon-alert-head" :class="'mon-alert-head--' + alert.severityTone">
            <div class="mon-alert-head__copy">
              <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.monitoring.alert.eyebrow') }}</p>
              <h1 id="mon-alert-title">{{ alert.alertName }}</h1>
              <p class="page-sub">{{ alert.assetName }} · {{ alert.quickCode }} · {{ alert.message }}</p>
            </div>
            <div class="mon-alert-head__tags">
              <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ severityMeta(alert.severity).label }}</span>
              <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ stateLabel }}</span>
              <span v-if="alert.acknowledged" class="mon-tag mon-tag--ok">{{ $t('ui.monitoring.tag.acknowledged') }}</span>
              <span v-if="alert.silenced" class="mon-tag">{{ $t('ui.monitoring.tag.silenced') }}</span>
              <span v-if="alert.incident" class="mon-tag">{{ $t('ui.monitoring.alert.incident_tag', { id: alert.incident.id }) }}</span>
            </div>
            <div class="mon-alert-head__actions">
              <button v-if="canEdit && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="btn btn--secondary" :disabled="busy" @click="acknowledge">{{ $t('ui.monitoring.action.acknowledge') }}</button>
              <button v-if="canEdit && alert.state !== 'resolved' && !alert.silenced" type="button" class="btn btn--ghost" @click="askSilence">{{ $t('ui.monitoring.silence.submit') }}</button>
              <button v-if="canEdit && !alert.incident" type="button" class="btn btn--ghost" @click="askConvert">{{ $t('ui.monitoring.action.link_incident') }}</button>
              <button v-if="alert.incident" type="button" class="btn btn--ghost" @click="openIncident">{{ $t('ui.monitoring.action.view_incident') }}</button>
            </div>
          </header>

          <div class="mon-metrics">
            <mon-metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value"
                        :hint="metric.hint" :icon="metric.icon" :tone="metric.tone"></mon-metric>
          </div>

          <div v-if="suggestedClose" class="mon-notice mon-notice--warn">
            <strong class="mon-notice__title">{{ $t('ui.monitoring.alert.suggested_title') }}</strong>
            <span class="mon-notice__text">{{ $t('ui.monitoring.alert.suggested_text') }}</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--secondary" @click="openIncident">{{ $t('ui.monitoring.alert.review_close') }}</button>
            </div>
          </div>

          <div class="mon-grid mon-grid--split">
            <div class="mon-panel">
              <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.alert.history') }}</h2></header>
              <ol v-if="events.length" class="mon-timeline">
                <li v-for="event in events" :key="event.id" class="mon-timeline__item">
                  <span class="mon-timeline__icon" :class="'mon-check-dot--' + eventTone(event)"></span>
                  <div class="mon-timeline__body">
                    <p class="mon-timeline__text">{{ event.display }}</p>
                    <p class="mon-timeline__time mono">{{ fmtDateTime(event.at) }} · {{ event.source || $t('ui.monitoring.alert.server') }}</p>
                  </div>
                </li>
              </ol>
              <p v-else class="empty-state">{{ $t('ui.monitoring.alert.no_events') }}</p>
            </div>

            <div class="mon-stack">
              <div class="mon-panel mon-device-mini">
                <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.field.asset') }}</h2></header>
                <div class="mon-device-mini__text">
                  <span class="mon-device-mini__name">{{ alert.assetName }}</span>
                  <span class="mon-device-mini__meta mono">{{ alert.quickCode }} · {{ alert.assetId }}</span>
                </div>
                <div class="mon-device-mini__actions">
                  <button type="button" class="btn btn--ghost" @click="openDevice">{{ $t('ui.monitoring.alert.view_device') }}</button>
                </div>
              </div>

              <div class="mon-panel">
                <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.alert.silences') }}</h2></header>
                <p v-if="silence" class="mon-panel__sub">{{ $t('ui.monitoring.alert.silenced_until', { when: fmtDateTime(silence.endsAt), source: silence.source }) }}</p>
                <p v-else class="mon-panel__sub">{{ $t('ui.monitoring.alert.no_silence') }}</p>
                <button v-if="canEdit && alert.state !== 'resolved'" type="button" class="btn btn--ghost" @click="askSilence">{{ $t('ui.monitoring.alert.create_silence') }}</button>
              </div>

              <div class="mon-panel">
                <header class="mon-panel__head"><h2 class="mon-panel__title">{{ $t('ui.monitoring.alert.maintenance') }}</h2></header>
                <p class="mon-panel__sub">{{ $t('ui.monitoring.alert.maintenance_sub') }}</p>
                <button v-if="canEdit" type="button" class="btn btn--ghost" @click="prepareMaintenance">{{ $t('ui.monitoring.alert.prepare_window') }}</button>
              </div>
            </div>
          </div>

          <mon-silence-dialog :open="dialogs.silence" :alert="alert" :app="app" @close="dialogs.silence = false" @saved="refresh"></mon-silence-dialog>
          <mon-convert-dialog :open="dialogs.convert" :alert="alert" :app="app" @close="dialogs.convert = false" @saved="refresh"></mon-convert-dialog>
        </template>
      </section>
    `
  };

  // ---------------------------------------------------------------- notifications
  Views.NotificationBell = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() { return { open: false }; },
    computed: {
      notifications() { return this.app.monitoringInbox || []; },
      unread() { return this.app.monitoringUnreadCount || 0; },
      latest() { return this.notifications.slice(0, 5); },
      badge() { return this.unread > 9 ? '9+' : this.unread; }
    },
    watch: {
      'app.route.name'() { this.open = false; }
    },
    mounted() {
      if (this.app.monitoringAvailable) this.app.loadMonitoringUnreadCount();
      this.onPointer = (event) => {
        if (!this.$el || this.$el.contains(event.target)) return;
        this.open = false;
      };
      document.addEventListener('pointerdown', this.onPointer, true);
    },
    beforeUnmount() {
      document.removeEventListener('pointerdown', this.onPointer, true);
    },
    methods: {
      rel,
      fmtDateTime,
      tone(item) { return Mapping.severityMeta(item.severity).tone; },
      icon(item) { return item.eventType === 'resolved' ? 'check' : (item.severity === 'critical' ? 'alert' : 'bell'); },
      kindLabel(item) { return item.eventType === 'resolved' ? tr('ui.notifications.kind.recovery') : (item.eventType === 'firing' ? tr('ui.notifications.kind.firing') : tr('ui.notifications.kind.notice')); },
      toggle() {
        if (this.open) { this.open = false; return; }
        this.open = true;
        if (this.app.monitoringAvailable && !this.app.monitoringApi.inbox.loaded) this.app.loadMonitoringInbox();
        this.$nextTick(() => this.$refs.panel?.focus());
      },
      close() { this.open = false; },
      onKeydown(event) {
        if (!this.open || event.key !== 'Escape') return;
        event.preventDefault();
        this.open = false;
        this.$nextTick(() => this.$refs.trigger?.focus());
      },
      async openNotification(item) {
        await this.app.markMonitoringNotificationRead(item.id);
        this.open = false;
        const hash = hashFromUrl(item.url);
        if (hash && this.app.setHash) this.app.setHash(hash);
        else if (item.alertId && this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: item.alertId });
        else if (item.assetId && this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: item.assetId });
      },
      openCenter() {
        this.open = false;
        if (this.app.setHash) this.app.setHash({ name: 'notifications' });
      }
    },
    template: `
      <div class="notif" ref="bell" @keydown="onKeydown">
        <button type="button" class="icon-button notif__trigger" ref="trigger" data-od-id="topbar-notifications"
                :aria-expanded="open" aria-haspopup="dialog" aria-controls="notif-panel"
                :aria-label="$t('ui.notifications.bell.aria', { count: unread })" @click="toggle">
          <app-icon name="bell"></app-icon>
          <span v-if="unread" class="notif__badge mono">{{ badge }}</span>
        </button>
        <transition name="dropdown">
          <div v-if="open" id="notif-panel" ref="panel" class="notif__panel" role="dialog" tabindex="-1" aria-labelledby="notif-title">
            <header class="notif__head">
              <div>
                <p class="notif__title" id="notif-title">{{ $t('ui.notifications.bell.title') }}</p>
                <p class="notif__sub">{{ $t('ui.notifications.bell.unread', { count: unread }) }}</p>
              </div>
              <button type="button" class="text-button text-button--quiet" @click="openCenter">{{ $t('ui.notifications.bell.open_inbox') }}</button>
            </header>
            <ul v-if="latest.length" class="notif__list">
              <li v-for="item in latest" :key="item.id" class="notif__item" :class="{ 'is-unread': item.unread }">
                <button type="button" class="notif__button" @click="openNotification(item)">
                  <span class="notif__icon" :class="'notif__icon--' + tone(item)"><app-icon :name="icon(item)"></app-icon></span>
                  <span class="notif__text">
                    <span class="notif__item-title">{{ item.title }}</span>
                    <span class="notif__item-body">{{ item.body }}</span>
                    <span class="notif__item-meta mono">{{ kindLabel(item) }} · {{ rel(item.createdAt) }}</span>
                  </span>
                </button>
              </li>
            </ul>
            <p v-else class="notif__empty">{{ $t('ui.notifications.bell.empty') }}</p>
            <footer class="notif__foot">
              <button type="button" class="text-button" @click="openCenter">{{ $t('ui.notifications.bell.open_all') }}</button>
            </footer>
          </div>
        </transition>
      </div>
    `
  };

  Views.NotificationCenter = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() { return { filter: 'all' }; },
    computed: {
      notifications() { return this.app.monitoringInbox || []; },
      unread() { return this.notifications.filter((item) => item.unread); },
      loading() { return this.app.monitoringInboxLoading; },
      error() { return this.app.monitoringInboxError; },
      truncated() { return this.app.monitoringInboxTotal > this.notifications.length; },
      filters() {
        return [
          { id: 'all', label: tr('ui.notifications.filter.all'), count: this.app.monitoringInboxTotal },
          { id: 'unread', label: tr('ui.notifications.filter.unread'), count: this.app.monitoringUnreadCount }
        ];
      },
      inboxEmptyKey() {
        return this.filter === 'unread' || this.notifications.length ? 'ui.notifications.empty' : 'ui.notifications.empty_install';
      },
      list() {
        return this.notifications.filter((item) => this.filter === 'unread' ? item.unread : true);
      }
    },
    methods: {
      rel,
      fmtDateTime,
      tone(item) { return Mapping.severityMeta(item.severity).tone; },
      icon(item) { return item.eventType === 'resolved' ? 'check' : (item.severity === 'critical' ? 'alert' : 'bell'); },
      kindLabel(item) { return item.eventType === 'resolved' ? tr('ui.notifications.kind.recovery') : (item.eventType === 'firing' ? tr('ui.notifications.kind.firing') : tr('ui.notifications.kind.notice')); },
      severityLabel(item) { return Mapping.severityMeta(item.severity).label; },
      async open(item) {
        await this.app.markMonitoringNotificationRead(item.id);
        const hash = hashFromUrl(item.url);
        if (hash && this.app.setHash) this.app.setHash(hash);
        else if (item.alertId && this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: item.alertId });
        else if (item.assetId && this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: item.assetId });
      },
      refresh() { this.app.loadMonitoringInbox(); this.app.loadMonitoringUnreadCount(); },
      loadMore() { this.app.loadMonitoringInbox({ append: true }); }
    },
    template: `
      <section class="page mon-page mon-inbox" aria-labelledby="inbox-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.notifications.eyebrow') }}</p>
            <h1 id="inbox-title">{{ $t('ui.notifications.title') }}</h1>
            <p class="page-sub">{{ $t('ui.notifications.sub') }}</p>
          </div>
          <div class="mon-head__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? $t('ui.monitoring.action.refreshing') : $t('ui.monitoring.action.refresh') }}
            </button>
          </div>
        </header>

        <div class="mon-pills" role="group" :aria-label="$t('ui.notifications.filters_aria')">
          <button v-for="item in filters" :key="item.id" type="button" class="mon-pill-button"
                  :class="{ 'is-active': filter === item.id }" :aria-pressed="filter === item.id" @click="filter = item.id">
            {{ item.label }} <span v-if="!error || notifications.length" class="mono">{{ item.count }}</span>
          </button>
        </div>

        <p v-if="loading" class="mon-progress__text" role="status">{{ $t('ui.notifications.loading') }}</p>
        <div v-else-if="error" class="mon-notice" role="alert"><span class="mon-notice__text">{{ error }}</span></div>
        <ul v-else-if="list.length" class="mon-inbox__list">
          <li v-for="item in list" :key="item.id" class="mon-inbox__item" :class="{ 'is-unread': item.unread }">
            <span class="mon-inbox__icon" :class="'mon-inbox__icon--' + tone(item)"><app-icon :name="icon(item)"></app-icon></span>
            <div class="mon-inbox__body">
              <div class="mon-inbox__head">
                <button type="button" class="mon-inbox__title" @click="open(item)">{{ item.title }}</button>
                <span class="mon-tag">{{ kindLabel(item) }}</span>
                <span class="mon-tag" :class="'mon-tag--' + tone(item)">{{ severityLabel(item) }}</span>
                <span v-if="item.unread" class="mon-tag mon-tag--hold">{{ $t('ui.notifications.tag.new') }}</span>
              </div>
              <p class="mon-inbox__text">{{ item.body }}</p>
              <div class="mon-inbox__meta">
                <span class="mono">{{ fmtDateTime(item.createdAt) }} · {{ rel(item.createdAt) }}</span>
                <span v-if="item.readAt">{{ $t('ui.notifications.read_at', { when: rel(item.readAt) }) }}</span>
                <span v-if="item.assetId" class="mono">{{ $t('ui.notifications.asset', { id: item.assetId }) }}</span>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="empty-state">{{ $t(inboxEmptyKey) }}</p>
        <div v-if="truncated" class="mon-settings__actions">
          <button type="button" class="btn btn--secondary" :disabled="loading" @click="loadMore">{{ $t('ui.notifications.load_more') }}</button>
          <span class="mon-panel__sub">{{ $t('ui.monitoring.count_of', { shown: notifications.length, total: app.monitoringInboxTotal }) }}</span>
        </div>
      </section>
    `
  };

  // ---------------------------------------------------------------- asset panel
  Views.AssetMonitoringPanel = {
    components: { AppIcon: window.AppIcon, MonSpark: Views.MonSpark, MonStatusPill: Views.MonStatusPill },
    props: { app: { type: Object, required: true }, asset: { type: Object, required: true } },
    data() { return { loading: false, error: '', missing: false }; },
    computed: {
      available() { return this.app.monitoringAvailable; },
      record() {
        const record = this.app.monitoringDeviceRecord;
        return record && record.assetId === this.asset.id ? record : null;
      },
      current() {
        if (!this.record || !this.record.assetId) return null;
        return this.record;
      },
      status() { return this.current ? this.current.status : 'no_data'; },
      latencyPoints() { return this.current && this.current.latencySeries ? this.current.latencySeries.points : []; },
      activeAlerts() { return this.current && this.current.alerts ? this.current.alerts.recent.filter((alert) => alert.state === 'firing' || alert.state === 'pending') : []; },
      uptime() { return this.current && this.current.uptime ? this.current.uptime.percent : null; },
      canEdit() { return this.app.monitoringEditable; }
    },
    watch: {
      'asset.id'() { this.load(); }
    },
    mounted() { this.load(); },
    methods: {
      fmtNumber,
      fmtDateTime,
      rel,
      async load() {
        if (!this.available || !this.asset || !this.asset.id) return;
        this.loading = true;
        this.error = '';
        const applied = await this.app.loadMonitoringDevice(this.asset.id, this.app.monitoringApi.overview.period || '24h');
        const record = this.app.monitoringDeviceRecord;
        this.missing = !applied && this.app.monitoringDeviceMissing;
        this.error = applied ? '' : this.app.monitoringDeviceError;
        this.loading = false;
        if (record && record.assetId === this.asset.id && !applied) this.error = this.error || '';
      },
      openMonitoring() {
        if (this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: this.asset.id });
      },
      configure() {
        if (this.app.setHash) this.app.setHash('#/configuracion/supervision');
      }
    },
    template: `
      <section class="panel mon-panel" aria-labelledby="asset-mon-title">
        <header class="mon-panel__head">
          <h2 class="mon-panel__title" id="asset-mon-title">{{ $t('ui.monitoring.nav.monitoring') }}</h2>
          <div class="mon-panel__actions">
            <mon-status-pill :status="status"></mon-status-pill>
            <button v-if="current" type="button" class="text-button" @click="openMonitoring">{{ $t('ui.monitoring.asset_panel.full') }}</button>
          </div>
        </header>
        <p v-if="loading" class="mon-panel__sub" role="status">{{ $t('ui.monitoring.center.loading') }}</p>
        <div v-else-if="error" class="form-error" role="alert">{{ error }}</div>
        <template v-else-if="current">
          <div class="mon-grid mon-grid--split">
            <div class="mon-metrics">
              <mon-metric :label="$t('ui.monitoring.device.metric_availability')" :value="uptime === null ? '—' : fmtNumber(uptime, '%')" :hint="$t('ui.monitoring.asset_panel.samples_hint')" icon="activity" tone="ok"></mon-metric>
              <mon-metric :label="$t('ui.monitoring.metric.latency')" :value="current.latency ? fmtNumber(current.latency.currentMs, 'ms') : '—'" :hint="$t('ui.monitoring.asset_panel.latency_hint')" icon="clock" tone="neutral"></mon-metric>
              <mon-metric :label="$t('ui.monitoring.center.active_alerts')" :value="String(activeAlerts.length)" :hint="$t('ui.monitoring.asset_panel.alerts_hint')" icon="alert" :tone="activeAlerts.length ? 'warn' : 'ok'"></mon-metric>
            </div>
            <div>
              <mon-spark :points="latencyPoints" tone="teal"></mon-spark>
              <p class="mon-panel__sub mono">{{ $t('ui.monitoring.asset_panel.checks', { count: current.checks.length, when: fmtDateTime(current.checks.length ? current.checks[0].lastCheckAt : '') }) }}</p>
            </div>
          </div>
          <ul v-if="current.checks.length" class="mon-checks">
            <li v-for="check in current.checks" :key="check.checkType + ':' + check.module">{{ check.checkType }} · {{ check.module }}</li>
          </ul>
        </template>
        <div v-else-if="missing" class="mon-notice">
          <strong class="mon-notice__title">{{ $t('ui.monitoring.unmonitored.title') }}</strong>
          <span class="mon-notice__text">{{ $t('ui.monitoring.asset_panel.no_data_text') }}</span>
          <button v-if="canEdit" type="button" class="btn btn--ghost" @click="configure">{{ $t('ui.monitoring.action.configure_monitoring') }}</button>
        </div>
        <p v-else class="mon-panel__sub">{{ $t('ui.monitoring.asset_panel.error') }}</p>
      </section>
    `
  };

  Views.helpers = Views.helpers || {};
  Object.assign(Views.helpers, { monFmtNumber: fmtNumber, monRel: rel, monDateTime: fmtDateTime, monClock: fmtClock });
})();
