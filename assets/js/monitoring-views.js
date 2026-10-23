(function () {
  'use strict';

  const Mapping = window.AssetMonitoringApiMapping;
  const Views = window.Views = window.Views || {};
  let chartSeq = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fmtDay(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtClock(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function rel(iso) {
    if (!iso) return 'Sin registro';
    const diff = Date.now() - Date.parse(iso);
    if (!Number.isFinite(diff)) return 'Sin registro';
    if (diff < 0) return 'Programado';
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'ahora mismo';
    if (minutes < 60) return 'hace ' + minutes + ' min';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    const days = Math.round(hours / 24);
    if (days < 30) return 'hace ' + days + ' d';
    return fmtDay(iso);
  }

  function fmtNumber(value, unit) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    const rounded = Math.abs(number) >= 100 ? Math.round(number) : Math.round(number * 10) / 10;
    return String(rounded).replace('.', ',') + (unit ? ' ' + unit : '');
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
    return period === '7d' ? '7 días' : (period === '30d' ? '30 días' : '24 horas');
  }

  function secondsLabel(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return 'Sin espera';
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
        if (points.length < 2) return null;
        const values = points.map((point) => point.value);
        let low = Number.isFinite(this.min) ? this.min : Math.min.apply(null, values);
        let high = Number.isFinite(this.max) ? this.max : Math.max.apply(null, values);
        if (this.zeroBase) low = 0;
        if (high - low < 0.5) high = low + 0.5;
        const spanY = height - top - bottom;
        const stepX = width / (points.length - 1);
        const coords = points.map((point, index) => ({
          x: index * stepX,
          y: top + clamp(1 - (point.value - low) / (high - low), 0, 1) * spanY,
          value: point.value,
          label: point.label
        }));
        const line = coords.map((coord, index) => (index ? 'L' : 'M') + coord.x.toFixed(1) + ' ' + coord.y.toFixed(1)).join(' ');
        const area = line + ' L' + width + ' ' + (height - bottom) + ' L0 ' + (height - bottom) + ' Z';
        const last = coords[coords.length - 1];
        const midIndex = Math.round((coords.length - 1) / 2);
        return {
          width, height, line, area, low, high, last,
          ticks: [
            { y: top, value: high },
            { y: top + spanY / 2, value: (high + low) / 2 },
            { y: top + spanY, value: low }
          ],
          xLabels: [
            { x: 0, label: coords[0].label, anchor: 'start' },
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
          ? 'Se necesitan al menos dos muestras para dibujar la serie.'
          : 'Sin datos en el período seleccionado.';
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
            <span>mín {{ tickLabel(summary.min) }}</span>
            <span>med {{ tickLabel(summary.avg) }}</span>
            <span>máx {{ tickLabel(summary.max) }}</span>
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
                x1="0" :y1="tick.y" :x2="geometry.width" :y2="tick.y"></line>
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
        if (this.alert) return this.alert.quickCode || this.alert.assetName || 'la alerta';
        return this.assetId ? 'el activo ' + this.assetId : 'el recurso';
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
          this.error = result.error || 'No se pudo crear el silencio.';
          return;
        }
        this.app.showToast('Silencio de ' + this.hours + ' h aplicado a ' + this.targetLabel + '.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Silenciar avisos" eyebrow="Alertas" size="normal" @close="$emit('close')">
        <div class="form-stack">
          <p class="form-intro">
            El silencio detiene las notificaciones externas, pero la alerta sigue visible y no cambia su estado.
            Se registra en el servidor con su fecha de fin.
          </p>
          <label class="field">
            <span class="field__label">Duración</span>
            <span class="select-field">
              <select v-model.number="hours">
                <option :value="1">1 hora</option>
                <option :value="4">4 horas</option>
                <option :value="8">8 horas</option>
                <option :value="12">12 horas</option>
                <option :value="24">24 horas</option>
                <option :value="72">3 días</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">Motivo</span>
            <input v-model="reason" type="text" maxlength="200" placeholder="Revisión física, ventana de trabajo…">
            <span class="field__hint">Queda registrado en el historial de la alerta.</span>
          </label>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="$emit('close')">Cancelar</button>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
            {{ busy ? 'Silenciando…' : 'Silenciar' }}
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
          this.error = result.error || 'No se pudo vincular la alerta al incidente.';
          return;
        }
        this.app.showToast(this.incidentId ? 'Alerta vinculada al incidente.' : 'Incidente creado desde la alerta.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Vincular a mantenimiento" eyebrow="Incidente" size="normal" @close="$emit('close')">
        <div class="form-stack">
          <p class="form-intro">
            La alerta se vincula a un incidente canónico. La vinculación no resuelve la alerta ni cierra el incidente.
          </p>
          <label class="field">
            <span class="field__label">Incidente</span>
            <span class="select-field">
              <select v-model="incidentId">
                <option value="">Crear un incidente nuevo</option>
                <option v-for="incident in incidents" :key="incident.id" :value="incident.id">
                  {{ incident.code || incident.id }} · {{ incident.title || incident.summary || 'Sin título' }}
                </option>
              </select>
            </span>
            <span class="field__hint">Los incidentes existentes vienen del servicio de mantenimiento.</span>
          </label>
          <p v-if="incidentsLoading" class="field__hint" role="status">Cargando incidentes existentes…</p>
          <div v-else-if="incidentsError" class="mon-notice mon-notice--warn" role="alert">
            <span class="mon-notice__text">{{ incidentsError }}</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--ghost" @click="retryIncidents">Reintentar</button>
            </div>
          </div>
          <p v-else-if="incidentsLoaded && !incidents.length" class="field__hint">
            El servicio de mantenimiento no devolvió incidentes existentes; puedes crear uno nuevo.
          </p>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="$emit('close')">Cancelar</button>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
            {{ busy ? 'Guardando…' : (incidentId ? 'Vincular alerta' : 'Crear incidente') }}
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
    computed: {
      monitoring() { return this.app.monitoring; },
      rows() { return this.app.monitoringDevices; },
      stats() { return this.app.monitoringStats; },
      statusCards() {
        const stats = this.stats;
        return [
          { id: 'up', label: 'Disponibles', value: stats.up, hint: 'Responden a la comprobación', tone: 'ok', icon: 'check' },
          { id: 'down', label: 'No disponibles', value: stats.down, hint: 'El sondeo no obtiene respuesta', tone: 'down', icon: 'x-circle' },
          { id: 'degraded', label: 'Degradados', value: stats.degraded, hint: 'Métrica fuera de umbral', tone: 'warn', icon: 'alert' },
          { id: 'unmonitored', label: 'Sin supervisión', value: stats.unmonitored, hint: stats.noData + ' sin datos · ' + stats.unavailable + ' sin lectura', tone: 'neutral', icon: 'minus' }
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
      monitoringAlerts() { return this.app.monitoringAlerts; },
      deviceRows() {
        const filters = this.deviceFilters;
        return this.rows
          .filter((row) => filters.status === 'all' ? true : row.status === filters.status)
          .filter((row) => filters.category === 'all' ? true : row.asset.category === filters.category)
          .filter((row) => filters.site === 'all' ? true : row.asset.site === filters.site)
          .filter((row) => {
            const term = filters.query.trim().toLocaleLowerCase('es');
            if (!term) return true;
            return (row.asset.name + ' ' + row.asset.id + ' ' + row.asset.quickCode + ' ' + (row.checkType || '') + ' ' + (row.target || ''))
              .toLocaleLowerCase('es').indexOf(term) !== -1;
          })
          .sort((a, b) => {
            const order = { down: 0, degraded: 1, unavailable: 2, no_data: 3, up: 4, unmonitored: 5 };
            const diff = order[a.status] - order[b.status];
            return diff || a.asset.name.localeCompare(b.asset.name, 'es');
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
        const term = filters.query.trim().toLocaleLowerCase('es');
        return this.monitoringAlerts
          .filter((alert) => filters.ack === 'ack' ? alert.acknowledged : (filters.ack === 'unack' ? !alert.acknowledged : true))
          .filter((alert) => filters.silenced === 'silenced' ? alert.silenced : (filters.silenced === 'active' ? !alert.silenced : true))
          .filter((alert) => filters.assetId === 'all' ? true : alert.assetId === filters.assetId)
          .filter((alert) => {
            if (!term) return true;
            return (alert.alertName + ' ' + alert.assetName + ' ' + alert.quickCode + ' ' + alert.summary)
              .toLocaleLowerCase('es').indexOf(term) !== -1;
          });
      },
      activeAlertRows() {
        return this.alertRows.filter((alert) => alert.state === 'firing' || alert.state === 'pending').slice(0, 4);
      },
      categories() { return this.app.categories || []; },
      sites() { return this.app.sites || []; },
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
        const configured = this.provenance.prometheusConfigured;
        const base = 'Origen Prometheus · período ' + this.rangeLabel + ' · ' + this.stats.total + ' activos';
        if (configured === false) return base + ' · Prometheus no está configurado; no se inventan lecturas.';
        return base;
      },
      alertStateOptions() {
        return [
          { id: 'firing', label: 'Activas' },
          { id: 'pending', label: 'Pendientes' },
          { id: 'resolved', label: 'Recuperadas' },
          { id: 'all', label: 'Todas' }
        ];
      },
      severityOptions() {
        return [{ id: 'critical', label: 'Crítica' }, { id: 'warning', label: 'Alta' }, { id: 'info', label: 'Media' }];
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
      reasonLabel: Mapping.reasonLabel,
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
        if (results.some(Boolean)) this.app.showToast('Supervisión actualizada.');
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
        if (result.ok) this.app.showToast('Alerta reconocida; sigue activa hasta que se recupere.');
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
            <p class="eyebrow"><span class="eyebrow__line"></span> Operación técnica</p>
            <h1 id="mon-title">Supervisión de infraestructura</h1>
            <p class="page-sub">Disponibilidad, latencia y alertas desde Prometheus.{{ provenanceNote }}</p>
          </div>
          <div class="mon-head__actions">
            <div class="mon-range" role="group" aria-label="Período de supervisión">
              <button v-for="period in ranges" :key="period" type="button" class="mon-range__button"
                      :class="{ 'is-active': range === period }" :aria-pressed="range === period"
                      :disabled="loading" @click="setRange(period)">{{ periodLabel(period) }}</button>
            </div>
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? 'Actualizando…' : 'Actualizar' }}
            </button>
          </div>
        </header>

        <p v-if="loading" class="mon-progress__text" role="status">Cargando la supervisión del servidor…</p>
        <div v-if="error" class="mon-notice" role="alert">
          <strong class="mon-notice__title">No se pudo leer la supervisión</strong>
          <span class="mon-notice__text">{{ error }}</span>
        </div>

        <div class="mon-kpis">
          <button v-for="card in statusCards" :key="card.id" type="button" class="mon-kpi" :class="'mon-kpi--' + card.tone"
                  @click="filterStatus(card.id)">
            <span class="mon-kpi__icon"><app-icon :name="card.icon"></app-icon></span>
            <span class="mon-kpi__label">{{ card.label }}</span>
            <span class="mon-kpi__value mono">{{ card.value }}</span>
            <span class="mon-kpi__hint">{{ card.hint }}</span>
          </button>
        </div>

        <div class="mon-tabs" role="tablist" aria-label="Vistas de supervisión">
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'estado'" :class="{ 'is-active': tab === 'estado' }" @click="setTab('estado')">Estado</button>
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'dispositivos'" :class="{ 'is-active': tab === 'dispositivos' }" @click="setTab('dispositivos')">
            Dispositivos <span class="mon-tab__count mono">{{ stats.total }}</span>
          </button>
          <button type="button" class="mon-tab" role="tab" :aria-selected="tab === 'alertas'" :class="{ 'is-active': tab === 'alertas' }" @click="setTab('alertas')">
            Alertas <span class="mon-tab__count mono">{{ app.monitoringActiveAlertCount }}</span>
          </button>
        </div>

        <div v-if="tab === 'estado'" role="tabpanel" class="mon-stack">
          <div class="mon-grid mon-grid--charts">
            <mon-chart label="Disponibilidad del período por dispositivo" :points="availabilityPoints" unit="%" :min="0" :max="100" tone="teal"></mon-chart>
            <mon-chart label="Latencia actual por dispositivo" :points="latencyPoints" unit="ms" :zero-base="true" tone="warn"></mon-chart>
          </div>
          <p class="mon-panel__sub">La disponibilidad usa las muestras del período y la latencia es la última lectura de cada activo. Abre un dispositivo para ver su serie temporal completa.</p>

          <div v-if="attention.length" class="mon-panel mon-attention">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Requieren atención</h2>
              <span class="mon-panel__sub">Alertas activas o degradación sostenida</span>
            </header>
            <ul class="mon-attention__list">
              <li v-for="row in attention" :key="row.assetId" class="mon-attention__item">
                <div class="mon-attention__main">
                  <span class="mon-attention__name">{{ row.asset.name }}</span>
                  <span class="mon-attention__meta mono">{{ row.asset.quickCode }} · {{ row.reasonLabel || row.statusLabel }}</span>
                </div>
                <span class="mon-attention__meta">{{ rel(row.lastCheckAt) }}</span>
                <div class="mon-attention__actions">
                  <button type="button" class="text-button" @click="openDevice(row.assetId)">Ver activo</button>
                </div>
              </li>
            </ul>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Alertas activas</h2>
              <button type="button" class="text-button" @click="setTab('alertas')">Ver todas</button>
            </header>
            <p v-if="alertsLoading" class="mon-panel__sub" role="status">Cargando alertas…</p>
            <p v-else-if="alertsError" class="form-error" role="alert">{{ alertsError }}</p>
            <ul v-else-if="activeAlertRows.length" class="mon-alert-list mon-alert-list--compact">
              <li v-for="alert in activeAlertRows" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
                <div class="mon-alert__rail"></div>
                <div class="mon-alert__body">
                  <div class="mon-alert__head">
                    <button type="button" class="mon-alert__title" @click="openAlert(alert.id)">{{ alert.alertName }}</button>
                    <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ alert.severityLabel }}</span>
                    <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alert.stateLabel }}</span>
                    <span v-if="alert.acknowledged" class="mon-tag">Reconocida</span>
                    <span v-if="alert.silenced" class="mon-tag">Silenciada</span>
                  </div>
                  <p class="mon-alert__message">{{ alert.message }}</p>
                  <p class="mon-alert__meta mono">{{ alert.quickCode }} · {{ rel(alert.lastSeenAt) }}</p>
                  <div class="mon-alert__actions">
                    <button v-if="canEdit && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">Reconocer</button>
                    <button v-if="canEdit && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">Silenciar</button>
                    <button v-if="canIncident" type="button" class="text-button" @click="openIncident(alert)">
                      {{ alert.incident ? 'Ver incidente' : 'Vincular incidencia' }}
                    </button>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="empty-state">No hay alertas activas en este momento. Las recuperadas se conservan en el historial.</p>
          </div>

          <div v-if="unmonitoredRows.length" class="mon-panel mon-unmonitored">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Sin datos de supervisión</h2>
              <button type="button" class="text-button" @click="openConfig('supervision')">Configurar comprobaciones</button>
            </header>
            <ul class="mon-unmonitored__list">
              <li v-for="row in unmonitoredRows" :key="row.assetId" class="mon-unmonitored__item">
                <div>
                  <span class="mon-unmonitored__name">{{ row.asset.name }}</span>
                  <span class="mon-unmonitored__meta mono">{{ row.asset.quickCode }}</span>
                </div>
                <span class="mon-unmonitored__state">{{ row.reasonLabel || row.statusLabel }}</span>
              </li>
            </ul>
            <p class="mon-panel__sub">Sin supervisión, sin datos y sin lectura son estados distintos: ninguno se cuenta como caída ni inventa disponibilidad.</p>
          </div>
        </div>

        <div v-if="tab === 'dispositivos'" role="tabpanel" class="mon-stack">
          <div class="mon-toolbar mon-toolbar--wrap">
            <label class="field mon-search">
              <span class="field__label">Buscar</span>
              <span class="search-field">
                <app-icon name="search"></app-icon>
                <input v-model="deviceFilters.query" type="search" placeholder="Nombre, código o destino">
              </span>
            </label>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="deviceFilters.status">
                  <option value="all">Todos</option>
                  <option value="up">Disponible</option>
                  <option value="degraded">Degradado</option>
                  <option value="down">No disponible</option>
                  <option value="unmonitored">Sin supervisión</option>
                  <option value="no_data">Sin datos</option>
                  <option value="unavailable">Sin lectura</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Categoría</span>
              <span class="select-field">
                <select v-model="deviceFilters.category">
                  <option value="all">Todas</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Sede</span>
              <span class="select-field">
                <select v-model="deviceFilters.site">
                  <option value="all">Todas</option>
                  <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
                </select>
              </span>
            </label>
          </div>

          <p v-if="loading" class="mon-panel__sub" role="status">Cargando dispositivos…</p>
          <div v-else-if="error" class="mon-notice" role="alert"><span class="mon-notice__text">{{ error }}</span></div>
          <div v-else class="mon-table-wrap">
            <table class="mon-table">
              <caption class="sr-only">Dispositivos supervisados con su estado, comprobación, latencia y disponibilidad</caption>
              <thead>
                <tr>
                  <th scope="col">Activo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Comprobación</th>
                  <th scope="col">Latencia</th>
                  <th scope="col">Disponibilidad</th>
                  <th scope="col">Última lectura</th>
                  <th scope="col">Alertas</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in deviceRows" :key="row.assetId" class="mon-table__row">
                  <td>
                    <button type="button" class="mon-table__device" @click="openDevice(row.assetId)">
                      <span class="mon-table__name">{{ row.asset.name }}</span>
                      <span class="mon-table__meta mono">{{ row.asset.quickCode }} · {{ row.asset.site || 'Sin sede' }}</span>
                    </button>
                  </td>
                  <td>
                    <mon-status-pill :status="row.status"></mon-status-pill>
                    <span v-if="row.reasonLabel" class="mon-table__meta">{{ row.reasonLabel }}</span>
                  </td>
                  <td>
                    <span>{{ checkMeta(row.checkType).label || '—' }}</span>
                    <span class="mon-table__meta mono">{{ row.target || 'Sin destino' }}</span>
                  </td>
                  <td class="mono">{{ fmtNumber(row.latencyMs, 'ms') }}</td>
                  <td class="mono">{{ row.uptimePct === null ? '—' : fmtNumber(row.uptimePct, '%') }}</td>
                  <td class="mon-table__time">{{ row.lastCheckAt ? fmtDateTime(row.lastCheckAt) : 'Sin lectura' }}</td>
                  <td class="mono">{{ row.activeAlerts }}</td>
                  <td class="mon-table__actions">
                    <button type="button" class="text-button" @click="openDevice(row.assetId)">Ver</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!deviceRows.length" class="empty-state">No hay dispositivos con estos filtros.</p>
          </div>
          <div v-if="truncated" class="mon-settings__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="openMoreDevices">Cargar más dispositivos</button>
            <span class="mon-panel__sub">{{ rows.length }} de {{ stats.total }}</span>
          </div>
        </div>

        <div v-if="tab === 'alertas'" role="tabpanel" class="mon-stack">
          <div class="mon-toolbar mon-toolbar--wrap">
            <label class="field mon-search">
              <span class="field__label">Buscar</span>
              <span class="search-field">
                <app-icon name="search"></app-icon>
                <input v-model="filters.query" type="search" placeholder="Alerta, activo o resumen">
              </span>
            </label>
            <label class="field">
              <span class="field__label">Estado</span>
              <span class="select-field">
                <select v-model="filters.state" @change="applyAlertFilters">
                  <option v-for="option in alertStateOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Severidad</span>
              <span class="select-field">
                <select v-model="filters.severity" @change="applyAlertFilters">
                  <option value="all">Todas</option>
                  <option v-for="option in severityOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Activo</span>
              <span class="select-field">
                <select v-model="filters.assetId" @change="applyAlertFilters">
                  <option value="all">Todos</option>
                  <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Reconocimiento</span>
              <span class="select-field">
                <select v-model="filters.ack">
                  <option value="all">Todas</option>
                  <option value="ack">Reconocidas</option>
                  <option value="unack">Sin reconocer</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Silencio</span>
              <span class="select-field">
                <select v-model="filters.silenced">
                  <option value="all">Todos</option>
                  <option value="silenced">Silenciadas</option>
                  <option value="active">Sin silencio</option>
                </select>
              </span>
            </label>
          </div>

          <p v-if="alertsLoading" class="mon-panel__sub" role="status">Cargando alertas…</p>
          <div v-else-if="alertsError" class="mon-notice" role="alert"><span class="mon-notice__text">{{ alertsError }}</span></div>
          <ul v-else-if="alertRows.length" class="mon-alert-list">
            <li v-for="alert in alertRows" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
              <div class="mon-alert__rail"></div>
              <div class="mon-alert__body">
                <div class="mon-alert__head">
                  <button type="button" class="mon-alert__title" @click="openAlert(alert.id)">{{ alert.alertName }}</button>
                  <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ alert.severityLabel }}</span>
                  <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alert.stateLabel }}</span>
                  <span v-if="alert.acknowledged" class="mon-tag mon-tag--ok">Reconocida</span>
                  <span v-if="alert.silenced" class="mon-tag">Silenciada</span>
                  <span v-if="alert.incident" class="mon-tag">Incidente</span>
                </div>
                <p class="mon-alert__message">{{ alert.message }}</p>
                <p class="mon-alert__meta mono">{{ alert.quickCode || alert.assetName }} · {{ fmtDateTime(alert.lastSeenAt || alert.startsAt) }}</p>
                <div class="mon-alert__actions">
                  <button v-if="canEdit && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">Reconocer</button>
                  <button v-if="canEdit && alert.state !== 'resolved' && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">Silenciar</button>
                  <button type="button" class="text-button text-button--quiet" @click="openAlert(alert.id)">Detalle</button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="empty-state">No hay alertas con estos filtros.</p>
          <div v-if="alertsTruncated" class="mon-settings__actions">
            <button type="button" class="btn btn--secondary" :disabled="alertsLoading" @click="openMoreAlerts">Cargar más alertas</button>
            <span class="mon-panel__sub">{{ monitoringAlerts.length }} de {{ app.monitoringApi.alerts.total }}</span>
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
      return { metric: 'latency', dialogs: { silence: false, convert: false }, activeAlert: null };
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
      chartLabel() { return this.metricLabel(this.activeSeries.metric) + ' en el período'; },
      config() { return this.record ? this.record.config : null; },
      configRows() {
        const config = this.config;
        if (!config) return [];
        return [
          { label: 'Habilitada', value: config.enabled ? 'Sí' : 'No' },
          { label: 'Comprobación', value: Mapping.checkMeta(config.checkType).label || '—' },
          { label: 'Destino', value: config.target || 'Sin destino' },
          { label: 'Intervalo', value: config.intervalSeconds ? config.intervalSeconds + ' s' : '—' },
          { label: 'Duración mínima', value: config.minimumDurationSeconds === null ? '—' : config.minimumDurationSeconds + ' s' },
          { label: 'Exportador', value: config.exporterId || '—' },
          { label: 'Módulo SNMP', value: config.snmpModule || '—' },
          { label: 'Credencial SNMP', value: config.snmpAuthRef ? 'Referencia configurada' : '—' }
        ];
      },
      overriddenLabel() {
        return this.config && this.config.overridden && this.config.overridden.length
          ? this.config.overridden.join(', ')
          : 'Ningún valor sobrescribe el perfil de categoría';
      },
      metrics() {
        return [
          { label: 'Disponibilidad', value: this.uptimePercent === null ? '—' : fmtNumber(this.uptimePercent, '%'), hint: this.uptimeSamples === null ? 'Sin muestras' : this.uptimeSamples + ' muestras', icon: 'activity', tone: this.uptimePercent === null ? 'neutral' : 'ok' },
          { label: 'Latencia actual', value: this.record && this.record.latency ? fmtNumber(this.record.latency.currentMs, 'ms') : '—', hint: this.record && this.record.latency ? 'P95 ' + fmtNumber(this.record.latency.p95Ms, 'ms') : 'Sin resumen', icon: 'clock', tone: 'neutral' },
          { label: 'Última comprobación', value: this.checks.length ? fmtDateTime(this.checks[0].lastCheckAt) : 'Sin lectura', hint: !this.checks.length ? 'Sin muestra' : (this.checks[0].latencyMs === null || this.checks[0].latencyMs === undefined ? rel(this.checks[0].lastCheckAt) : fmtNumber(this.checks[0].latencyMs, 'ms')), icon: 'check', tone: 'neutral' },
          { label: 'Alertas activas', value: String(this.activeAlerts.length), hint: this.alertList.length + ' recientes', icon: 'alert', tone: this.activeAlerts.length ? 'warn' : 'ok' }
        ];
      }
    },
    watch: {
      'app.route.assetId'(id) {
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
        return { latency: 'Latencia', cpu: 'CPU', memory: 'Memoria', disk: 'Disco', temperature: 'Temperatura' }[metric] || metric;
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
      checkTone(state) { return state === 'up' ? 'ok' : (state === 'down' ? 'down' : 'neutral'); }
    },
    template: `
      <section class="page mon-page mon-device" aria-labelledby="mon-device-title">
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <button type="button" class="text-button" @click="back">Supervisión</button>
          <span aria-hidden="true">/</span>
          <span>{{ asset.name }}</span>
        </nav>

        <header class="mon-device__head">
          <div class="mon-device__identity">
            <img v-if="asset.image" class="mon-device__thumb" :src="asset.image" alt="" aria-hidden="true">
            <div>
              <p class="eyebrow"><span class="eyebrow__line"></span> Dispositivo supervisado</p>
              <h1 id="mon-device-title">{{ asset.name }}</h1>
              <p class="page-sub mono">{{ asset.quickCode || asset.id }} · {{ asset.category || 'Sin categoría' }} · {{ asset.site || 'Sin sede' }}</p>
            </div>
          </div>
          <div class="mon-head__actions">
            <mon-status-pill :status="status"></mon-status-pill>
            <div class="mon-range" role="group" aria-label="Período del dispositivo">
              <button v-for="period in ranges" :key="period" type="button" class="mon-range__button"
                      :class="{ 'is-active': app.monitoringDevicePeriod === period }" :aria-pressed="app.monitoringDevicePeriod === period" @click="setRange(period)">{{ periodLabel(period) }}</button>
            </div>
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? 'Actualizando…' : 'Actualizar' }}
            </button>
            <button type="button" class="btn btn--ghost" @click="openAsset">Ficha del activo</button>
          </div>
        </header>

        <p v-if="loading" class="mon-progress__text" role="status">Cargando el dispositivo desde el servidor…</p>
        <div v-else-if="missing" class="mon-notice" role="alert">
          <strong class="mon-notice__title">Dispositivo no disponible</strong>
          <span class="mon-notice__text">{{ error }}</span>
        </div>
        <div v-else-if="error" class="mon-notice" role="alert"><span class="mon-notice__text">{{ error }}</span></div>

        <template v-if="record">
          <p v-if="record.reasonLabel" class="mon-panel__sub">{{ record.reasonLabel }}</p>
          <div class="mon-metrics">
            <mon-metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value"
                        :hint="metric.hint" :icon="metric.icon" :tone="metric.tone"></mon-metric>
          </div>

          <p class="mon-panel__sub">
            Origen {{ provenance.source }} · período {{ periodLabel(provenance.period.preset) }} ·
            ventana {{ provenance.period.from ? fmtDateTime(provenance.period.from) : 'sin fecha' }} a {{ provenance.period.to ? fmtDateTime(provenance.period.to) : 'sin fecha' }}.
          </p>

          <div v-if="status === 'unmonitored'" class="mon-notice">
            <strong class="mon-notice__title">Este activo no está incluido en la supervisión</strong>
            <span class="mon-notice__text">No se muestran porcentajes ni series inventadas. Configura una comprobación real para empezar a recibir datos.</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--secondary" @click="configure">Configurar supervisión</button>
            </div>
          </div>

          <div class="mon-grid mon-grid--split">
            <div class="mon-panel">
              <header class="mon-panel__head">
                <h2 class="mon-panel__title">Comprobaciones</h2>
                <span class="mon-panel__sub">{{ checks.length }} tipos</span>
              </header>
              <ul v-if="checks.length" class="mon-checks-list">
                <li v-for="check in checks" :key="check.checkType + ':' + check.module" class="mon-checks-list__item">
                  <span class="mon-checks-list__icon" :class="'mon-check-dot--' + checkTone(check.state)"></span>
                  <span class="mon-checks-list__label">{{ checkMeta(check.checkType).label }} <span class="mono">{{ check.module }}</span></span>
                  <span class="mon-checks-list__value">{{ check.latencyMs === null ? 'Sin latencia' : fmtNumber(check.latencyMs, 'ms') }}</span>
                  <span class="mon-checks-list__limit">{{ check.lastCheckAt ? fmtDateTime(check.lastCheckAt) : 'Sin muestra' }}</span>
                </li>
              </ul>
              <p v-else class="empty-state">Sin comprobaciones registradas para este activo.</p>
            </div>

            <div class="mon-panel">
              <header class="mon-panel__head">
                <h2 class="mon-panel__title">Configuración efectiva</h2>
                <span class="mon-panel__sub">Perfil {{ config.profileCategory || '—' }}</span>
              </header>
              <dl class="mon-facts">
                <div v-for="row in configRows" :key="row.label" class="mon-facts__row">
                  <dt>{{ row.label }}</dt><dd class="mono">{{ row.value }}</dd>
                </div>
              </dl>
              <p class="mon-panel__sub">Sobrescrituras: {{ overriddenLabel }}.</p>
            </div>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Series del período</h2>
              <label class="field mon-input">
                <span class="sr-only">Métrica</span>
                <span class="select-field">
                  <select v-model="metric">
                    <option v-for="option in metricOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                </span>
              </label>
            </header>
            <mon-chart :label="chartLabel" :points="chartPoints" :unit="chartUnit" :zero-base="activeSeries.metric !== 'latency'" :tone="activeSeries.metric === 'latency' ? 'teal' : 'warn'"></mon-chart>
            <p v-if="!metricOptions.length" class="mon-panel__sub">No hay series disponibles para este período.</p>
          </div>

          <div class="mon-panel">
            <header class="mon-panel__head">
              <h2 class="mon-panel__title">Alertas del dispositivo</h2>
              <span class="mon-panel__sub">{{ activeAlerts.length }} activas</span>
            </header>
            <ul v-if="alertList.length" class="mon-alert-list mon-alert-list--compact">
              <li v-for="alert in alertList" :key="alert.id" class="mon-alert" :class="'mon-alert--' + alert.severityTone">
                <div class="mon-alert__rail"></div>
                <div class="mon-alert__body">
                  <div class="mon-alert__head">
                    <button type="button" class="mon-alert__title" @click="openAlert(alert)">{{ alert.alertName }}</button>
                    <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ alert.severityLabel }}</span>
                    <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ alert.stateLabel }}</span>
                    <span v-if="alert.acknowledged" class="mon-tag">Reconocida</span>
                  </div>
                  <p class="mon-alert__message">{{ alert.message }}</p>
                  <div class="mon-alert__actions">
                    <button v-if="app.monitoringEditable && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="text-button" @click="acknowledge(alert)">Reconocer</button>
                    <button v-if="app.monitoringEditable && alert.state !== 'resolved' && !alert.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(alert)">Silenciar</button>
                    <button v-if="app.monitoringEditable" type="button" class="text-button" @click="askConvert(alert)">{{ alert.incident ? 'Ver incidente' : 'Vincular incidencia' }}</button>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="empty-state">Sin alertas registradas para este dispositivo.</p>
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
          .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
      },
      metrics() {
        const alert = this.alert;
        if (!alert) return [];
        return [
          { label: 'Inicio', value: fmtDateTime(alert.startsAt), hint: rel(alert.startsAt), icon: 'clock', tone: 'neutral' },
          { label: 'Última señal', value: fmtDateTime(alert.lastSeenAt), hint: rel(alert.lastSeenAt), icon: 'activity', tone: 'neutral' },
          { label: 'Fuente', value: alert.source || '—', hint: alert.groupKey ? 'Grupo ' + alert.groupKey.slice(0, 28) : '', icon: 'server', tone: 'neutral' },
          { label: 'Incidente', value: alert.incident ? alert.incident.id : 'Sin vincular', hint: alert.incident ? alert.incident.status : 'Se puede vincular sin cerrar la alerta', icon: 'link', tone: 'neutral' }
        ];
      },
      silence() { return this.alert ? this.alert.silences.find((item) => item.active) || null : null; },
      stateLabel() {
        if (!this.alert) return '—';
        return this.alert.state === 'resolved' ? 'Recuperada' : this.alert.stateLabel;
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
        if (result.ok) this.app.showToast('Alerta reconocida; sigue activa hasta que se recupere.');
      },
      askSilence() { this.dialogs.silence = true; },
      askConvert() { this.dialogs.convert = true; },
      async prepareMaintenance() {
        if (!this.alert) return;
        const result = await this.app.prepareMonitoringMaintenance(this.alert.id);
        if (!result.ok) return;
        this.app.showToast(result.existingWindow ? 'Ya existe una ventana relacionada; revísala antes de guardar otra.' : 'Propuesta de ventana preparada. Revísala antes de guardarla.');
        if (this.app.setHash) this.app.setHash('#/configuracion/alertas');
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
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <button type="button" class="text-button" @click="back">Supervisión</button>
          <span aria-hidden="true">/</span>
          <span>Alerta</span>
        </nav>

        <p v-if="loading" class="mon-progress__text" role="status">Cargando la alerta desde el servidor…</p>
        <div v-else-if="missing" class="mon-notice" role="alert">
          <strong class="mon-notice__title">Alerta no disponible</strong>
          <span class="mon-notice__text">{{ error }}</span>
        </div>
        <div v-else-if="error" class="mon-notice" role="alert"><span class="mon-notice__text">{{ error }}</span></div>

        <template v-if="alert">
          <header class="mon-alert-head" :class="'mon-alert-head--' + alert.severityTone">
            <div class="mon-alert-head__copy">
              <p class="eyebrow"><span class="eyebrow__line"></span> Alerta de supervisión</p>
              <h1 id="mon-alert-title">{{ alert.alertName }}</h1>
              <p class="page-sub">{{ alert.assetName }} · {{ alert.quickCode }} · {{ alert.message }}</p>
            </div>
            <div class="mon-alert-head__tags">
              <span class="mon-tag" :class="'mon-tag--' + alert.severityTone">{{ alert.severityLabel }}</span>
              <span class="mon-tag" :class="'mon-tag--' + alert.stateTone">{{ stateLabel }}</span>
              <span v-if="alert.acknowledged" class="mon-tag mon-tag--ok">Reconocida</span>
              <span v-if="alert.silenced" class="mon-tag">Silenciada</span>
              <span v-if="alert.incident" class="mon-tag">Incidente {{ alert.incident.id }}</span>
            </div>
            <div class="mon-alert-head__actions">
              <button v-if="canEdit && alert.state !== 'resolved' && !alert.acknowledged" type="button" class="btn btn--secondary" :disabled="busy" @click="acknowledge">Reconocer</button>
              <button v-if="canEdit && alert.state !== 'resolved' && !alert.silenced" type="button" class="btn btn--ghost" @click="askSilence">Silenciar</button>
              <button v-if="canEdit && !alert.incident" type="button" class="btn btn--ghost" @click="askConvert">Vincular incidencia</button>
              <button v-if="alert.incident" type="button" class="btn btn--ghost" @click="openIncident">Ver incidente</button>
            </div>
          </header>

          <div class="mon-metrics">
            <mon-metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value"
                        :hint="metric.hint" :icon="metric.icon" :tone="metric.tone"></mon-metric>
          </div>

          <div v-if="suggestedClose" class="mon-notice mon-notice--warn">
            <strong class="mon-notice__title">El incidente vinculado admite cierre asistido</strong>
            <span class="mon-notice__text">La alerta se ha recuperado, pero el incidente no se cierra solo. Revisa y confirma la resolución en el incidente canónico.</span>
            <div class="mon-notice__actions">
              <button type="button" class="btn btn--secondary" @click="openIncident">Revisar cierre asistido</button>
            </div>
          </div>

          <div class="mon-grid mon-grid--split">
            <div class="mon-panel">
              <header class="mon-panel__head"><h2 class="mon-panel__title">Historial</h2></header>
              <ol v-if="events.length" class="mon-timeline">
                <li v-for="event in events" :key="event.id" class="mon-timeline__item">
                  <span class="mon-timeline__icon" :class="'mon-check-dot--' + eventTone(event)"></span>
                  <div class="mon-timeline__body">
                    <p class="mon-timeline__text">{{ event.text }}</p>
                    <p class="mon-timeline__time mono">{{ fmtDateTime(event.at) }} · {{ event.source || 'servidor' }}</p>
                  </div>
                </li>
              </ol>
              <p v-else class="empty-state">Sin acontecimientos registrados.</p>
            </div>

            <div class="mon-stack">
              <div class="mon-panel mon-device-mini">
                <header class="mon-panel__head"><h2 class="mon-panel__title">Activo</h2></header>
                <div class="mon-device-mini__text">
                  <span class="mon-device-mini__name">{{ alert.assetName }}</span>
                  <span class="mon-device-mini__meta mono">{{ alert.quickCode }} · {{ alert.assetId }}</span>
                </div>
                <div class="mon-device-mini__actions">
                  <button type="button" class="btn btn--ghost" @click="openDevice">Ver supervisión del activo</button>
                </div>
              </div>

              <div class="mon-panel">
                <header class="mon-panel__head"><h2 class="mon-panel__title">Silencios</h2></header>
                <p v-if="silence" class="mon-panel__sub">Silenciada hasta {{ fmtDateTime(silence.endsAt) }} · {{ silence.source }}</p>
                <p v-else class="mon-panel__sub">Sin silencio activo.</p>
                <button v-if="canEdit && alert.state !== 'resolved'" type="button" class="btn btn--ghost" @click="askSilence">Crear silencio</button>
              </div>

              <div class="mon-panel">
                <header class="mon-panel__head"><h2 class="mon-panel__title">Mantenimiento</h2></header>
                <p class="mon-panel__sub">La ventana propuesta no se guarda hasta que la revises y confirmes.</p>
                <button v-if="canEdit" type="button" class="btn btn--ghost" @click="prepareMaintenance">Preparar ventana de mantenimiento</button>
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
      latest() { return this.notifications.slice(0, 5); }
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
      kindLabel(item) { return item.eventType === 'resolved' ? 'Recuperación' : (item.eventType === 'firing' ? 'Alerta activa' : 'Aviso'); },
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
                :aria-label="'Avisos: ' + unread + ' sin consultar'" @click="toggle">
          <app-icon name="bell"></app-icon>
          <span v-if="unread" class="notif__badge mono">{{ unread > 9 ? '9+' : unread }}</span>
        </button>
        <transition name="dropdown">
          <div v-if="open" id="notif-panel" ref="panel" class="notif__panel" role="dialog" tabindex="-1" aria-labelledby="notif-title">
            <header class="notif__head">
              <div>
                <p class="notif__title" id="notif-title">Avisos</p>
                <p class="notif__sub">{{ unread }} sin consultar</p>
              </div>
              <button type="button" class="text-button text-button--quiet" @click="openCenter">Ver bandeja</button>
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
            <p v-else class="notif__empty">No hay avisos en la bandeja.</p>
            <footer class="notif__foot">
              <button type="button" class="text-button" @click="openCenter">Abrir todas las notificaciones</button>
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
          { id: 'all', label: 'Todas', count: this.app.monitoringInboxTotal },
          { id: 'unread', label: 'Sin consultar', count: this.app.monitoringUnreadCount }
        ];
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
      kindLabel(item) { return item.eventType === 'resolved' ? 'Recuperación' : (item.eventType === 'firing' ? 'Alerta activa' : 'Aviso'); },
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
            <p class="eyebrow"><span class="eyebrow__line"></span> Actividad</p>
            <h1 id="inbox-title">Notificaciones</h1>
            <p class="page-sub">Avisos operativos entregados o puestos en cola por el servidor.</p>
          </div>
          <div class="mon-head__actions">
            <button type="button" class="btn btn--secondary" :disabled="loading" @click="refresh">
              <app-icon name="refresh"></app-icon> {{ loading ? 'Actualizando…' : 'Actualizar' }}
            </button>
          </div>
        </header>

        <div class="mon-pills" role="group" aria-label="Filtros de notificaciones">
          <button v-for="item in filters" :key="item.id" type="button" class="mon-pill-button"
                  :class="{ 'is-active': filter === item.id }" :aria-pressed="filter === item.id" @click="filter = item.id">
            {{ item.label }} <span class="mono">{{ item.count }}</span>
          </button>
        </div>

        <p v-if="loading" class="mon-progress__text" role="status">Cargando la bandeja…</p>
        <div v-else-if="error" class="mon-notice" role="alert"><span class="mon-notice__text">{{ error }}</span></div>
        <ul v-else-if="list.length" class="mon-inbox__list">
          <li v-for="item in list" :key="item.id" class="mon-inbox__item" :class="{ 'is-unread': item.unread }">
            <span class="mon-inbox__icon" :class="'mon-inbox__icon--' + tone(item)"><app-icon :name="icon(item)"></app-icon></span>
            <div class="mon-inbox__body">
              <div class="mon-inbox__head">
                <button type="button" class="mon-inbox__title" @click="open(item)">{{ item.title }}</button>
                <span class="mon-tag">{{ kindLabel(item) }}</span>
                <span class="mon-tag" :class="'mon-tag--' + tone(item)">{{ severityLabel(item) }}</span>
                <span v-if="item.unread" class="mon-tag mon-tag--hold">Nueva</span>
              </div>
              <p class="mon-inbox__text">{{ item.body }}</p>
              <div class="mon-inbox__meta">
                <span class="mono">{{ fmtDateTime(item.createdAt) }} · {{ rel(item.createdAt) }}</span>
                <span v-if="item.readAt">Consultada {{ rel(item.readAt) }}</span>
                <span v-if="item.assetId" class="mono">Activo {{ item.assetId }}</span>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="empty-state">No hay avisos con este filtro.</p>
        <div v-if="truncated" class="mon-settings__actions">
          <button type="button" class="btn btn--secondary" :disabled="loading" @click="loadMore">Cargar más avisos</button>
          <span class="mon-panel__sub">{{ notifications.length }} de {{ app.monitoringInboxTotal }}</span>
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
          <h2 class="mon-panel__title" id="asset-mon-title">Supervisión</h2>
          <div class="mon-panel__actions">
            <mon-status-pill :status="status"></mon-status-pill>
            <button v-if="current" type="button" class="text-button" @click="openMonitoring">Ver supervisión completa</button>
          </div>
        </header>
        <p v-if="loading" class="mon-panel__sub" role="status">Cargando la supervisión del servidor…</p>
        <div v-else-if="error" class="form-error" role="alert">{{ error }}</div>
        <template v-else-if="current">
          <div class="mon-grid mon-grid--split">
            <div class="mon-metrics">
              <mon-metric label="Disponibilidad" :value="uptime === null ? '—' : fmtNumber(uptime, '%')" hint="Muestras del período" icon="activity" tone="ok"></mon-metric>
              <mon-metric label="Latencia" :value="current.latency ? fmtNumber(current.latency.currentMs, 'ms') : '—'" hint="Última lectura" icon="clock" tone="neutral"></mon-metric>
              <mon-metric label="Alertas activas" :value="String(activeAlerts.length)" hint="Incidentes vinculados" icon="alert" :tone="activeAlerts.length ? 'warn' : 'ok'"></mon-metric>
            </div>
            <div>
              <mon-spark :points="latencyPoints" tone="teal"></mon-spark>
              <p class="mon-panel__sub mono">{{ current.checks.length }} comprobaciones · {{ fmtDateTime(current.checks.length ? current.checks[0].lastCheckAt : '') }}</p>
            </div>
          </div>
          <ul v-if="current.checks.length" class="mon-checks">
            <li v-for="check in current.checks" :key="check.checkType + ':' + check.module">{{ check.checkType }} · {{ check.module }}</li>
          </ul>
        </template>
        <div v-else-if="missing" class="mon-notice">
          <strong class="mon-notice__title">Sin datos de supervisión</strong>
          <span class="mon-notice__text">El servidor no tiene un registro de supervisión para este activo. No se inventan porcentajes.</span>
          <button v-if="canEdit" type="button" class="btn btn--ghost" @click="configure">Configurar supervisión</button>
        </div>
        <p v-else class="mon-panel__sub">No se pudo leer la supervisión de este activo.</p>
      </section>
    `
  };

  Views.helpers = Views.helpers || {};
  Object.assign(Views.helpers, { monFmtNumber: fmtNumber, monRel: rel, monDateTime: fmtDateTime, monClock: fmtClock });
})();
