(function () {
  'use strict';

  const M = window.AssetMonitorEngine;
  const Data = window.ASSET_MONITOR;
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

  function fmtValue(row) {
    if (!row || row.value === null || row.value === undefined) return '—';
    if (row.check.id === 'services' && Number.isFinite(row.up) && Number.isFinite(row.total)) {
      return row.up + ' de ' + row.total + ' · ' + fmtNumber(row.value, '%');
    }
    return fmtNumber(row.value, row.check.unit);
  }

  function duration(minutes) {
    if (minutes === null || minutes === undefined) return '—';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
    return Math.floor(hours / 24) + ' d ' + (hours % 24) + ' h';
  }

  function toneOfStatus(id) {
    return M.statusMeta(id).tone;
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
      geometry() {
        const points = (this.points || []).filter((point) => point && Number.isFinite(point.value));
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
          // A sample outside the visible domain (a full outage under an 80 %
          // floor) is pinned to the edge instead of drawing outside the box.
          y: top + clamp(1 - (point.value - low) / (high - low), 0, 1) * spanY,
          value: point.value,
          label: point.label
        }));
        const line = coords.map((coord, index) => (index ? 'L' : 'M') + coord.x.toFixed(1) + ' ' + coord.y.toFixed(1)).join(' ');
        const area = line + ' L' + width + ' ' + (height - bottom) + ' L0 ' + (height - bottom) + ' Z';
        const last = coords[coords.length - 1];
        const midIndex = Math.round((coords.length - 1) / 2);
        return {
          width: width,
          height: height,
          line: line,
          area: area,
          low: low,
          high: high,
          last: last,
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
        const points = (this.points || []).filter((point) => point && Number.isFinite(point.value));
        if (!points.length) return null;
        const values = points.map((point) => point.value);
        const total = values.reduce((sum, value) => sum + value, 0);
        return {
          last: values[values.length - 1],
          min: Math.min.apply(null, values),
          max: Math.max.apply(null, values),
          avg: Math.round((total / values.length) * 100) / 100
        };
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
        <p v-else class="mon-chart__empty">Sin datos en el período seleccionado.</p>
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
      meta() { return M.statusMeta(this.status); }
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
      app: { type: Object, required: true }
    },
    emits: ['close', 'saved'],
    data() {
      return { hours: 4, reason: '', errors: [] };
    },
    watch: {
      open(value) {
        if (value) {
          this.hours = 4;
          this.reason = '';
          this.errors = [];
        }
      }
    },
    methods: {
      submit() {
        if (!this.alert) return;
        const result = M.silence(this.app.monitoring, this.app.maintenance, this.alert.id, this.hours, this.reason, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        if (!result.ok) {
          this.errors = result.errors;
          return;
        }
        this.app.showToast(this.alert.id + ' silenciada durante ' + this.hours + ' h.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Silenciar alerta" eyebrow="Notificaciones" size="normal" @close="$emit('close')">
        <div class="form-stack">
          <p class="form-intro">
            El silenciamiento detiene los avisos externos. La alerta sigue visible y su estado operativo no cambia.
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
            <span class="field__hint">Queda registrado en los acontecimientos de la alerta.</span>
          </label>
          <p v-if="errors.length" class="form-error">{{ errors[0] }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="$emit('close')">Cancelar</button>
          <button type="button" class="btn btn--primary" @click="submit">Silenciar</button>
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
      return { form: { title: '', priority: 'alta', assigneeId: '', description: '' }, errors: [] };
    },
    computed: {
      asset() {
        if (!this.alert) return null;
        return (this.app.assets || []).find((asset) => asset.id === this.alert.assetId) || null;
      },
      people() {
        return (this.app.people || []).filter((person) => person.active !== false);
      }
    },
    watch: {
      open(value) {
        if (!value || !this.alert) return;
        const asset = this.asset;
        this.errors = [];
        this.form = {
          title: (asset ? asset.name : this.alert.assetId) + ' · ' + M.alertKindMeta(this.alert.kind).label,
          priority: this.alert.severity === 'critica' ? 'critica' : (this.alert.severity || 'alta'),
          assigneeId: '',
          description: this.alert.message
        };
      }
    },
    methods: {
      submit() {
        if (!this.form.title.trim()) {
          this.errors = ['El incidente necesita un título.'];
          return;
        }
        const result = M.convertToIncident(this.app.monitoring, this.app.maintenance, this.app.assets, this.alert.id, {
          title: this.form.title,
          description: this.form.description,
          priority: this.form.priority,
          assigneeId: this.form.assigneeId,
          assetId: this.alert.assetId
        }, { actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador' });
        if (!result.ok) {
          this.errors = result.errors;
          return;
        }
        this.app.showToast('Incidente ' + result.incident.id + ' creado desde ' + this.alert.id + '.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Crear incidente desde la alerta" eyebrow="Mantenimiento" size="wide" @close="$emit('close')">
        <div class="form-stack">
          <p class="form-intro">
            Los datos del dispositivo y del evento se reutilizan. No se crea nada hasta confirmar este formulario.
          </p>
          <label class="field">
            <span class="field__label">Título</span>
            <input v-model="form.title" type="text" maxlength="120">
          </label>
          <div class="form-grid--two">
            <label class="field">
              <span class="field__label">Prioridad</span>
              <span class="select-field">
                <select v-model="form.priority">
                  <option value="critica">Crítica</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Responsable</span>
              <span class="select-field">
                <select v-model="form.assigneeId">
                  <option value="">Sin asignar</option>
                  <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
              </span>
            </label>
          </div>
          <label class="field">
            <span class="field__label">Descripción</span>
            <textarea v-model="form.description" rows="4" maxlength="600"></textarea>
          </label>
          <p v-if="errors.length" class="form-error">{{ errors[0] }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="$emit('close')">Cancelar</button>
          <button type="button" class="btn btn--primary" @click="submit">Crear incidente</button>
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
      const section = this.app.route && this.app.route.section ? this.app.route.section : (this.app.monitoring.prefs.defaultTab || 'estado');
      return {
        tab: ['estado', 'dispositivos', 'alertas'].indexOf(section) !== -1 ? section : 'estado',
        range: this.app.monitoring.prefs.range,
        filters: { query: '', category: 'all', site: 'all', status: 'all', severity: 'all', state: 'active', ack: 'all', silenced: 'all', assetId: 'all' },
        deviceFilters: { query: '', category: 'all', site: 'all', status: 'all' },
        dialogs: { silence: false, convert: false },
        activeAlert: null,
        sweep: { running: false, progress: 0, checked: 0, created: 0 },
        now: Date.now()
      };
    },
    beforeUnmount() {
      // A sweep left running after navigation would keep creating alerts in the background.
      if (this.sweepTimer) clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      assets() { return this.app.assets || []; },
      alerts() { return (this.app.maintenance && this.app.maintenance.alerts) || []; },
      rows() { return M.deviceRows(this.monitoring, this.assets, this.alerts, this.now); },
      stats() { return M.stats(this.monitoring, this.assets, this.alerts, this.now); },
      statusCards() {
        const stats = this.stats;
        return [
          { id: 'up', label: 'Disponibles', value: stats.up, hint: 'Responden a todas las comprobaciones', tone: 'ok', icon: 'check' },
          { id: 'down', label: 'No disponibles', value: stats.down, hint: 'Sin respuesta a la disponibilidad', tone: 'down', icon: 'x-circle' },
          { id: 'degraded', label: 'Degradados', value: stats.degraded, hint: 'Alguna métrica fuera de rango', tone: 'warn', icon: 'alert' },
          { id: 'unmonitored', label: 'Sin supervisión', value: stats.unmonitored, hint: 'Fuera de las comprobaciones', tone: 'neutral', icon: 'minus' }
        ];
      },
      availabilitySeries() { return M.aggregateAvailability(this.monitoring, this.assets, this.range, this.now); },
      latencySeries() { return M.aggregateLatency(this.monitoring, this.assets, this.range, this.now); },
      deviceRows() {
        const filters = this.deviceFilters;
        return this.rows
          .filter((row) => this.monitoring.prefs.showUnmonitored || row.monitored)
          .filter((row) => filters.status === 'all' ? true : row.status === filters.status)
          .filter((row) => filters.category === 'all' ? true : row.asset.category === filters.category)
          .filter((row) => filters.site === 'all' ? true : row.asset.site === filters.site)
          .filter((row) => {
            const term = filters.query.trim().toLocaleLowerCase('es');
            if (!term) return true;
            return (row.asset.name + ' ' + row.asset.id + ' ' + row.asset.type + ' ' + (row.asset.ip || ''))
              .toLocaleLowerCase('es').indexOf(term) !== -1;
          })
          .sort((a, b) => {
            const order = { down: 0, degraded: 1, up: 2, unmonitored: 3 };
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
        return this.rows.filter((row) => row.status === 'unmonitored');
      },
      alertRows() {
        return M.filteredAlerts(this.monitoring, this.alerts, this.assets, this.filters, this.now).map((alert) => M.alertRow(this.monitoring, alert, this.assets, this.now));
      },
      activeAlertRows() {
        return M.sortAlerts(this.alerts.filter((alert) => alert.state === 'open')).slice(0, 4)
          .map((alert) => M.alertRow(this.monitoring, alert, this.assets, this.now));
      },
      categories() { return this.app.categories || []; },
      sites() { return this.app.sites || []; },
      ranges() { return Data.RANGES; },
      canEdit() { return this.app.can('assets.edit'); },
      canIncident() { return this.app.can('assets.edit'); },
      rangeLabel() { return M.rangeMeta(this.range).label; },
      filteredAlertCount() { return this.alertRows.length; }
    },
    methods: {
      fmtNumber: fmtNumber,
      fmtValue: fmtValue,
      fmtDateTime: fmtDateTime,
      fmtDay: fmtDay,
      fmtClock: fmtClock,
      rel: rel,
      duration: duration,
      toLocale(value, unit) { return fmtNumber(value, unit); },
      setTab(tab) {
        this.tab = tab;
        if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: tab });
      },
      filterStatus(status) {
        this.deviceFilters.status = this.deviceFilters.status === status ? 'all' : status;
        this.setTab('dispositivos');
      },
      openDevice(id) {
        if (this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: id });
      },
      openAlert(id) {
        if (this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: id });
      },
      openAsset(id) {
        if (this.app.setHash) this.app.setHash({ name: 'detail', assetId: id });
      },
      statusTone(row) { return toneOfStatus(row.status); },
      checkTone(row) {
        if (row.status === 'crit') return 'down';
        if (row.status === 'warn') return 'warn';
        if (row.status === 'unknown') return 'neutral';
        return 'ok';
      },
      deviceTone(row) { return row.status === 'unmonitored' ? 'neutral' : toneOfStatus(row.status); },
      rowStatus(row) { return M.statusMeta(row.status).label; },
      seriesFor(assetId, kind) {
        const asset = this.assets.find((item) => item.id === assetId);
        if (!asset) return [];
        return kind === 'latency'
          ? M.latencySeries(this.monitoring, asset, this.range, this.now)
          : M.availabilitySeries(this.monitoring, asset, this.range, this.now);
      },
      setRange(id) {
        this.range = id;
        M.savePrefs(this.monitoring, { range: id });
        this.now = Date.now();
      },
      refresh() {
        this.now = Date.now();
        this.app.showToast('Indicadores actualizados con las últimas lecturas.');
      },
      runSweep() {
        if (this.sweep.running) return;
        this.sweep = { running: true, progress: 0, checked: 0, created: 0 };
        const total = this.stats.monitored;
        const timer = this.sweepTimer = setInterval(() => {
          if (this.sweep.progress < 92) {
            this.sweep.progress = Math.min(92, this.sweep.progress + 9);
            this.sweep.checked = Math.round((this.sweep.progress / 100) * total);
            return;
          }
          clearInterval(timer);
          this.sweepTimer = null;
          const result = M.sweep(this.monitoring, this.app.maintenance, this.assets, {
            actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
          });
          this.now = Date.now();
          this.sweep = { running: false, progress: 100, checked: result.checked, created: result.created };
          const detail = result.created
            ? result.checked + ' dispositivos comprobados · ' + result.created + ' alerta nueva'
            : result.checked + ' dispositivos comprobados · sin alertas nuevas';
          this.app.showToast('Comprobación completada: ' + detail + '.');
          setTimeout(() => { this.sweep.progress = 0; }, 1800);
        }, 90);
      },
      ack(alert) {
        const result = M.acknowledge(this.monitoring, this.app.maintenance, alert.id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok ? alert.id + ' reconocida. Sigue visible mientras el problema continúe.' : result.errors[0]);
      },
      askSilence(alert) {
        this.activeAlert = alert;
        this.dialogs.silence = true;
      },
      askConvert(alert) {
        this.activeAlert = alert;
        this.dialogs.convert = true;
      },
      recover(assetId) {
        const result = M.recoverDevice(this.monitoring, this.app.maintenance, this.assets, assetId, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok
          ? 'Recuperación simulada: ' + result.recovered + ' alerta(s) quedan pendientes de resolución.'
          : result.errors[0]);
      },
      resolve(alert) {
        const result = M.resolveAlert(this.monitoring, this.app.maintenance, this.assets, alert.id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok ? alert.id + ' resuelta y registrada en el historial del activo.' : result.errors[0]);
      },
      dismiss(alert) {
        if (!alert.silenced) return;
        const result = M.clearSilence(this.monitoring, this.app.maintenance, alert.id);
        this.app.showToast(result.ok ? 'Silenciamiento cancelado.' : result.errors[0]);
      },
      silenceSaved() { this.now = Date.now(); },
      convertSaved() { this.now = Date.now(); },
      alertStateTone(alert) { return M.alertStateMeta(alert.state).tone; },
      severityTone(alert) { return M.severityMeta(alert.severity).tone; },
      openIncident(id) {
        if (this.app.setHash) this.app.setHash({ name: 'incident', incidentId: id });
      },
      enabledChannels() {
        return ['smtp', 'telegram'].filter((id) => M.channelState(this.monitoring, id).enabled).length;
      },
      chunks(list, size) {
        const result = [];
        for (let index = 0; index < list.length; index += size) result.push(list.slice(index, index + size));
        return result;
      }
    },
    template: `
      <section class="page mon-page" aria-labelledby="mon-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Operación técnica</p>
            <h1 id="mon-title">Supervisión de infraestructura</h1>
            <p class="page-sub">Disponibilidad, latencia y métricas. Datos simulados.</p>
          </div>
          <div class="mon-head__actions">
            <div class="mon-range" role="group" aria-label="Período de las gráficas">
              <button v-for="option in ranges" :key="option.id" type="button" class="mon-range__button"
                      :class="{ 'is-active': option.id === range }" :aria-pressed="option.id === range"
                      @click="setRange(option.id)">{{ option.label }}</button>
            </div>
            <button v-if="canEdit" type="button" class="btn btn--secondary" data-od-id="mon-sweep" :disabled="sweep.running" @click="runSweep">
              <app-icon name="refresh"></app-icon> {{ sweep.running ? 'Comprobando…' : 'Comprobar ahora' }}
            </button>
          </div>
        </header>

        <div v-if="sweep.running || sweep.progress" class="mon-progress" role="status" aria-live="polite">
          <div class="mon-progress__bar"><span :style="{ width: sweep.progress + '%' }"></span></div>
          <p class="mon-progress__text">{{ sweep.running ? 'Comprobando ' + sweep.checked + ' de ' + stats.monitored + ' dispositivos' : sweep.checked + ' dispositivos comprobados · ' + sweep.created + ' alertas nuevas' }}</p>
        </div>

        <div class="mon-kpis" data-od-id="mon-kpis">
          <button v-for="card in statusCards" :key="card.id" type="button" class="mon-kpi"
                  :class="['mon-kpi--' + card.tone, { 'is-active': deviceFilters.status === card.id }]"
                  @click="filterStatus(card.id)">
            <span class="mon-kpi__icon"><app-icon :name="card.icon"></app-icon></span>
            <span class="mon-kpi__label">{{ card.label }}</span>
            <span class="mon-kpi__value mono">{{ String(card.value).padStart(2, '0') }}</span>
            <span class="mon-kpi__hint">{{ card.hint }}</span>
          </button>
        </div>

        <div class="mon-tabs" role="tablist" aria-label="Vistas de supervisión">
          <button type="button" role="tab" class="mon-tab" :class="{ 'is-active': tab === 'estado' }" :aria-selected="tab === 'estado'"
                  data-od-id="mon-tab-estado" @click="setTab('estado')">Estado</button>
          <button type="button" role="tab" class="mon-tab" :class="{ 'is-active': tab === 'dispositivos' }" :aria-selected="tab === 'dispositivos'"
                  data-od-id="mon-tab-dispositivos" @click="setTab('dispositivos')">
            Dispositivos <span class="mon-tab__count mono">{{ stats.monitored }}</span>
          </button>
          <button type="button" role="tab" class="mon-tab" :class="{ 'is-active': tab === 'alertas' }" :aria-selected="tab === 'alertas'"
                  data-od-id="mon-tab-alertas" @click="setTab('alertas')">
            Alertas <span class="mon-tab__count mono">{{ stats.activeAlerts }}</span>
          </button>
        </div>

        <!-- ------------------------------------------------ estado -->
        <div v-show="tab === 'estado'" class="mon-view" id="mon-view-estado" role="tabpanel" aria-labelledby="mon-tab-estado">
          <div class="mon-grid mon-grid--charts">
            <mon-chart :points="availabilitySeries" tone="teal" unit="%" :min="80" :max="100" :height="180"
                       :label="'Disponibilidad media · ' + rangeLabel"></mon-chart>
            <mon-chart :points="latencySeries" tone="hold" unit="ms" :height="180" :label="'Latencia media · ' + rangeLabel"></mon-chart>
          </div>

          <div class="mon-grid mon-grid--split">
            <section class="mon-panel" aria-labelledby="mon-attention-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-attention-title" class="mon-panel__title">Requieren atención</h2>
                  <p class="mon-panel__sub">{{ attention.length }} equipos no disponibles o degradados</p>
                </div>
                <span class="chip" :class="{ 'chip--warn': attention.length }">{{ attention.length }}</span>
              </header>
              <ul v-if="attention.length" class="mon-attention">
                <li v-for="row in attention" :key="row.asset.id" class="mon-attention__item">
                  <button type="button" class="mon-attention__main" @click="openDevice(row.asset.id)">
                    <span class="mon-attention__name">{{ row.asset.name }}</span>
                    <span class="mon-attention__meta">{{ row.asset.id }} · {{ row.asset.ip }} · {{ rel(row.lastCheckAt) }}</span>
                  </button>
                  <mon-spark :points="seriesFor(row.asset.id, 'availability')" :tone="row.status === 'down' ? 'down' : 'warn'"></mon-spark>
                  <mon-status-pill :status="row.status"></mon-status-pill>
                  <div class="mon-attention__actions">
                    <button v-if="canEdit && row.status === 'down'" type="button" class="text-button" @click="recover(row.asset.id)">Simular recuperación</button>
                    <button type="button" class="text-button text-button--quiet" @click="openDevice(row.asset.id)">Ver ficha</button>
                  </div>
                </li>
              </ul>
              <p v-else class="empty-state">Sin equipos fuera de umbral.</p>
            </section>

            <section class="mon-panel" aria-labelledby="mon-alerts-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-alerts-title" class="mon-panel__title">Alertas activas</h2>
                  <p class="mon-panel__sub">{{ stats.unacknowledged }} sin reconocer · {{ stats.silenced }} {{ stats.silenced === 1 ? 'silenciada' : 'silenciadas' }}</p>
                </div>
                <button type="button" class="text-button" @click="setTab('alertas')">Ver todas</button>
              </header>
              <ul v-if="activeAlertRows.length" class="mon-alert-list mon-alert-list--compact">
                <li v-for="row in activeAlertRows" :key="row.alert.id" class="mon-alert" :class="'mon-alert--' + severityTone(row)">
                  <div class="mon-alert__body">
                    <button type="button" class="mon-alert__title" @click="openAlert(row.alert.id)">{{ row.asset ? row.asset.name : row.alert.assetId }}</button>
                    <p class="mon-alert__message">{{ row.alert.message }}</p>
                    <div class="mon-alert__meta">
                      <span class="mon-tag" :class="'mon-tag--' + severityTone(row)">{{ row.severity.label }}</span>
                      <span class="mon-tag">{{ row.kind.label }}</span>
                      <span class="mon-tag">{{ rel(row.alert.detectedAt) }}</span>
                      <span v-if="row.groupCount > 1" class="mon-tag mon-tag--hold">{{ row.groupCount }} eventos</span>
                      <span v-if="row.acknowledged" class="mon-tag mon-tag--ok">Reconocida</span>
                      <span v-if="row.silenced" class="mon-tag">Silenciada</span>
                    </div>
                  </div>
                </li>
              </ul>
              <p v-else class="empty-state">No hay alertas activas.</p>
            </section>
          </div>

          <section class="mon-panel" aria-labelledby="mon-unmonitored-title">
            <header class="mon-panel__head">
              <div>
                <h2 id="mon-unmonitored-title" class="mon-panel__title">Fuera de supervisión</h2>
                <p class="mon-panel__sub">{{ unmonitoredRows.length }} activos sin comprobaciones configuradas</p>
              </div>
              <app-icon name="info"></app-icon>
            </header>
            <ul class="mon-unmonitored">
              <li v-for="row in unmonitoredRows" :key="row.asset.id" class="mon-unmonitored__item">
                <span class="mon-unmonitored__name">{{ row.asset.name }}</span>
                <span class="mon-unmonitored__meta">{{ row.asset.id }} · {{ row.asset.category }}</span>
                <span class="mon-unmonitored__state">Sin porcentajes de disponibilidad</span>
                <button type="button" class="text-button" @click="openDevice(row.asset.id)">Ver equipo</button>
              </li>
            </ul>
          </section>
        </div>

        <!-- ------------------------------------------------ dispositivos -->
        <div v-show="tab === 'dispositivos'" class="mon-view" id="mon-view-dispositivos" role="tabpanel" aria-labelledby="mon-tab-dispositivos">
          <div class="mon-toolbar">
            <label class="search-field mon-search">
              <app-icon name="search"></app-icon>
              <span class="sr-only">Buscar dispositivo</span>
              <input v-model="deviceFilters.query" type="search" placeholder="Buscar por nombre, código o IP">
            </label>
            <label class="mon-filter">
              <span class="sr-only">Categoría</span>
              <span class="select-field">
                <select v-model="deviceFilters.category">
                  <option value="all">Todas las categorías</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Sede</span>
              <span class="select-field">
                <select v-model="deviceFilters.site">
                  <option value="all">Todas las sedes</option>
                  <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Estado</span>
              <span class="select-field">
                <select v-model="deviceFilters.status">
                  <option value="all">Todos los estados</option>
                  <option value="up">Disponibles</option>
                  <option value="degraded">Degradados</option>
                  <option value="down">No disponibles</option>
                  <option value="unmonitored">Sin supervisión</option>
                </select>
              </span>
            </label>
            <span class="filter-count mono">{{ deviceRows.length }}</span>
          </div>

          <div class="mon-table-wrap">
            <table class="mon-table">
              <caption class="sr-only">Dispositivos supervisados con su estado actual y sus métricas</caption>
              <thead>
                <tr>
                  <th scope="col">Dispositivo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Latencia</th>
                  <th scope="col">Uptime</th>
                  <th scope="col">Última comprobación</th>
                  <th scope="col">Comprobaciones</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in deviceRows" :key="row.asset.id" class="mon-table__row" @click="openDevice(row.asset.id)">
                  <th scope="row" class="mon-table__name">
                    <button type="button" class="mon-table__device" @click.stop="openDevice(row.asset.id)">
                      <span class="mon-table__title">{{ row.asset.name }}</span>
                      <span class="mon-table__meta mono">{{ row.asset.id }} · {{ row.asset.ip }}</span>
                    </button>
                  </th>
                  <td><mon-status-pill :status="row.status"></mon-status-pill></td>
                  <td class="mono">{{ row.latencyMs === null ? '—' : fmtNumber(row.latencyMs, 'ms') }}</td>
                  <td class="mono">{{ row.uptimePct === null ? '—' : fmtNumber(row.uptimePct, '%') }}</td>
                  <td>
                    <span class="mon-table__time">{{ rel(row.lastCheckAt) }}</span>
                    <span class="mon-table__meta">cada {{ row.intervalMinutes }} min</span>
                  </td>
                  <td>
                    <span v-if="!row.monitored" class="mon-table__meta">Sin supervisión</span>
                    <span v-else class="mon-checks">
                      <span v-for="check in row.checks" :key="check.check.id" class="mon-check-dot"
                            :class="'mon-check-dot--' + checkTone(check)"
                            :title="check.check.label + ': ' + fmtValue(check)"></span>
                    </span>
                  </td>
                  <td class="mon-table__actions">
                    <app-icon name="chevron-right"></app-icon>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!deviceRows.length" class="empty-state">Ningún dispositivo coincide con los filtros.</p>
          </div>
        </div>

        <!-- ------------------------------------------------ alertas -->
        <div v-show="tab === 'alertas'" class="mon-view" id="mon-view-alertas" role="tabpanel" aria-labelledby="mon-tab-alertas">
          <div class="mon-toolbar mon-toolbar--wrap">
            <label class="search-field mon-search">
              <app-icon name="search"></app-icon>
              <span class="sr-only">Buscar alerta</span>
              <input v-model="filters.query" type="search" placeholder="Buscar alerta, dispositivo o incidente">
            </label>
            <label class="mon-filter">
              <span class="sr-only">Severidad</span>
              <span class="select-field">
                <select v-model="filters.severity">
                  <option value="all">Toda severidad</option>
                  <option value="critica">Crítica</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Estado</span>
              <span class="select-field">
                <select v-model="filters.state">
                  <option value="active">Activas</option>
                  <option value="history">Históricas</option>
                  <option value="all">Todas</option>
                  <option value="recovered">Recuperadas</option>
                  <option value="resolved">Resueltas</option>
                  <option value="converted">Convertidas</option>
                  <option value="linked">Vinculadas</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Categoría</span>
              <span class="select-field">
                <select v-model="filters.category">
                  <option value="all">Toda categoría</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Sede</span>
              <span class="select-field">
                <select v-model="filters.site">
                  <option value="all">Toda sede</option>
                  <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
                </select>
              </span>
            </label>
            <label class="mon-filter">
              <span class="sr-only">Reconocimiento</span>
              <span class="select-field">
                <select v-model="filters.ack">
                  <option value="all">Reconocidas y no</option>
                  <option value="no">Sin reconocer</option>
                  <option value="yes">Reconocidas</option>
                </select>
              </span>
            </label>
            <span class="filter-count mono">{{ filteredAlertCount }}</span>
          </div>

          <ul v-if="alertRows.length" class="mon-alert-list">
            <li v-for="row in alertRows" :key="row.alert.id" class="mon-alert" :class="['mon-alert--' + severityTone(row), { 'is-silenced': row.silenced }]">
              <div class="mon-alert__rail"></div>
              <div class="mon-alert__body">
                <div class="mon-alert__head">
                  <button type="button" class="mon-alert__title" @click="openAlert(row.alert.id)">
                    {{ row.asset ? row.asset.name : row.alert.assetId }}
                  </button>
                  <span class="mon-tag mono">{{ row.alert.id }}</span>
                  <span class="mon-tag" :class="'mon-tag--' + severityTone(row)">{{ row.severity.label }}</span>
                  <span class="mon-tag" :class="'mon-tag--' + alertStateTone(row)">{{ row.state.label }}</span>
                  <span v-if="row.alert.intermittent" class="mon-tag mon-tag--hold">Intermitente</span>
                </div>
                <p class="mon-alert__message">{{ row.alert.message }}</p>
                <div class="mon-alert__meta">
                  <span>{{ row.kind.label }}</span>
                  <span>Detectada {{ fmtDateTime(row.alert.detectedAt) }}</span>
                  <span v-if="row.groupCount > 1">{{ row.groupCount }} eventos agrupados</span>
                  <span v-if="row.acknowledged">Reconocida por {{ row.alert.acknowledgedBy }}</span>
                  <span v-if="row.silenced">Silenciada hasta {{ fmtDateTime(row.silence.until) }}</span>
                  <span v-if="row.incidentId" class="mon-alert__incident">{{ row.incidentId }}</span>
                </div>
                <div v-if="canEdit" class="mon-alert__actions">
                  <button v-if="row.active && !row.acknowledged" type="button" class="text-button" @click="ack(row.alert)">Reconocer</button>
                  <button v-if="row.active && !row.silenced" type="button" class="text-button text-button--quiet" @click="askSilence(row.alert)">Silenciar</button>
                  <button v-if="row.silenced" type="button" class="text-button text-button--quiet" @click="dismiss(row.alert)">Cancelar silencio</button>
                  <button v-if="row.active && row.incidentId" type="button" class="text-button" @click="openIncident(row.incidentId)">Ver incidente</button>
                  <button v-else-if="row.active && canIncident" type="button" class="text-button" @click="askConvert(row.alert)">Crear incidente</button>
                  <button v-if="row.alert.state === 'open'" type="button" class="text-button text-button--quiet" @click="recover(row.alert.assetId)">Simular recuperación</button>
                  <button v-else-if="row.alert.state === 'recovered'" type="button" class="text-button" @click="resolve(row.alert)">Resolver</button>
                  <button type="button" class="text-button text-button--quiet" @click="openAlert(row.alert.id)">Detalles</button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="empty-state">Ninguna alerta coincide con los filtros seleccionados.</p>
        </div>

        <mon-silence-dialog :open="dialogs.silence" :alert="activeAlert" :app="app" @close="dialogs.silence = false" @saved="silenceSaved"></mon-silence-dialog>
        <mon-convert-dialog :open="dialogs.convert" :alert="activeAlert" :app="app" @close="dialogs.convert = false" @saved="convertSaved"></mon-convert-dialog>
      </section>
    `
  };

  // ---------------------------------------------------------------- device
  Views.MonitorDevice = {
    components: {
      AppIcon: window.AppIcon,
      MonChart: Views.MonChart,
      MonStatusPill: Views.MonStatusPill,
      MonMetric: Views.MonMetric,
      MonSilenceDialog: Views.MonSilenceDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        range: this.app.monitoring.prefs.range,
        now: Date.now(),
        dialogs: { silence: false },
        activeAlert: null
      };
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      assetId() { return this.app.route ? this.app.route.assetId : ''; },
      asset() { return (this.app.assets || []).find((item) => item.id === this.assetId) || null; },
      alerts() { return (this.app.maintenance && this.app.maintenance.alerts) || []; },
      row() { return this.asset ? M.deviceRow(this.monitoring, this.asset, this.alerts, this.now) : null; },
      deviceAlerts() {
        return this.alerts
          .filter((alert) => alert.assetId === this.assetId)
          .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
          .map((alert) => M.alertRow(this.monitoring, alert, this.app.assets, this.now));
      },
      availability() { return this.asset ? M.availabilitySeries(this.monitoring, this.asset, this.range, this.now) : []; },
      latency() { return this.asset ? M.latencySeries(this.monitoring, this.asset, this.range, this.now) : []; },
      ranges() { return Data.RANGES; },
      canEdit() { return this.app.can('assets.edit'); },
      exception() { return M.exceptionFor(this.monitoring, this.assetId); },
      policy() { return this.asset ? M.policyFor(this.monitoring, this.asset.category) : null; },
      monitoringLabel() {
        if (this.row && this.row.monitored) return 'Supervisado cada ' + this.row.intervalMinutes + ' min';
        return 'Sin comprobaciones configuradas';
      },
      statusPill() { return this.row ? this.row.status : 'unmonitored'; }
    },
    methods: {
      fmtNumber: fmtNumber,
      fmtValue: fmtValue,
      fmtDateTime: fmtDateTime,
      fmtClock: fmtClock,
      rel: rel,
      duration: duration,
      setRange(id) { this.range = id; this.now = Date.now(); },
      back() { if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: 'dispositivos' }); },
      openAsset() { if (this.app.setHash) this.app.setHash({ name: 'detail', assetId: this.assetId }); },
      openAlert(id) { if (this.app.setHash) this.app.setHash({ name: 'monitorAlert', alertId: id }); },
      checkNow() {
        const probe = M.ensureProbe(this.monitoring, this.asset);
        if (!probe) {
          this.app.showToast('El equipo no está incluido en la supervisión.');
          return;
        }
        probe.checks = (probe.checks || 0) + 1;
        probe.lastCheckAt = M.nowIso();
        M.evaluateAlert(this.monitoring, this.app.maintenance, this.app.assets, this.assetId, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.now = Date.now();
        this.app.showToast('Comprobación ejecutada sobre ' + this.asset.name + '.');
      },
      recover() {
        const result = M.recoverDevice(this.monitoring, this.app.maintenance, this.app.assets, this.assetId, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Recuperación simulada registrada.' : result.errors[0]);
      },
      ack(alert) {
        const result = M.acknowledge(this.monitoring, this.app.maintenance, alert.id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok ? alert.id + ' reconocida.' : result.errors[0]);
      },
      askSilence(alert) { this.activeAlert = alert; this.dialogs.silence = true; },
      silenceSaved() { this.now = Date.now(); },
      includeInMonitoring() {
        const result = M.saveException(this.monitoring, this.assetId, {
          enabled: true,
          intervalMinutes: 15,
          checkIds: ['availability'],
          asset: this.asset
        });
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Equipo incorporado a la supervisión con la comprobación básica.' : result.errors[0]);
      },
      removeFromMonitoring() {
        const result = M.removeException(this.monitoring, this.assetId);
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Equipo devuelto a la política de su categoría.' : result.errors[0]);
      },
      checkTone(check) {
        if (check.status === 'crit') return 'down';
        if (check.status === 'warn') return 'warn';
        if (check.status === 'unknown') return 'neutral';
        return 'ok';
      },
      severityTone(alert) { return M.severityMeta(alert.severity).tone; },
      stateTone(alert) { return M.alertStateMeta(alert.state).tone; }
    },
    template: `
      <section v-if="asset && row" class="page mon-page mon-device" aria-labelledby="mon-device-title">
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <button type="button" class="back-link" @click="back"><app-icon name="arrow-left"></app-icon> Supervisión</button>
          <span class="crumb">{{ asset.name }}</span>
        </nav>

        <header class="mon-device__head">
          <div class="mon-device__identity">
            <span class="mon-device__thumb"><img :src="asset.image" :alt="''" loading="lazy"></span>
            <div>
              <p class="eyebrow"><span class="eyebrow__line"></span> {{ asset.type }} · {{ asset.id }}</p>
              <h1 id="mon-device-title">{{ asset.name }}</h1>
              <p class="page-sub">{{ asset.ip }} · {{ asset.location }} · {{ monitoringLabel }}</p>
            </div>
          </div>
          <div class="mon-device__actions">
            <mon-status-pill :status="statusPill"></mon-status-pill>
            <div class="mon-range" role="group" aria-label="Período de las gráficas">
              <button v-for="option in ranges" :key="option.id" type="button" class="mon-range__button"
                      :class="{ 'is-active': option.id === range }" :aria-pressed="option.id === range"
                      @click="setRange(option.id)">{{ option.label }}</button>
            </div>
            <button v-if="canEdit" type="button" class="btn btn--secondary" @click="checkNow">
              <app-icon name="refresh"></app-icon> Comprobar
            </button>
            <button type="button" class="btn btn--ghost" @click="openAsset">
              <app-icon name="arrow-up-right"></app-icon> Ficha del activo
            </button>
          </div>
        </header>

        <div class="mon-metrics">
          <mon-metric label="Disponibilidad" :value="row.uptimePct === null ? '—' : fmtNumber(row.uptimePct, '%')" :hint="row.monitored ? 'Período ' + range : 'Sin supervisión'" icon="activity" :tone="row.status === 'down' ? 'down' : 'ok'"></mon-metric>
          <mon-metric label="Latencia" :value="row.latencyMs === null ? '—' : fmtNumber(row.latencyMs, 'ms')" hint="Última comprobación" icon="wifi" :tone="row.latencyMs === null ? 'neutral' : 'hold'"></mon-metric>
          <mon-metric label="Uptime" :value="row.uptimeDays === null ? '—' : duration(row.uptimeDays * 1440)" hint="Desde el último reinicio" icon="clock"></mon-metric>
          <mon-metric label="Última comprobación" :value="row.monitored ? rel(row.lastCheckAt) : '—'" :hint="row.monitored ? 'Cada ' + row.intervalMinutes + ' min' : 'Sin comprobaciones'" icon="refresh"></mon-metric>
        </div>

        <div v-if="!row.monitored" class="mon-notice">
          <app-icon name="info"></app-icon>
          <div>
            <p class="mon-notice__title">Este equipo no tiene datos de supervisión</p>
            <p class="mon-notice__text">No se muestran porcentajes de disponibilidad porque no existe ninguna comprobación ejecutándose. Puedes incorporarlo con la comprobación básica.</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--primary" @click="includeInMonitoring">Incorporar a supervisión</button>
        </div>

        <template v-if="row.monitored">
          <div class="mon-grid mon-grid--charts">
            <mon-chart :points="availability" tone="teal" unit="%" :min="80" :max="100" :height="180" :label="'Disponibilidad · ' + range"></mon-chart>
            <mon-chart :points="latency" tone="hold" unit="ms" :height="180" :label="'Evolución de latencia · ' + range"></mon-chart>
          </div>

          <div class="mon-grid mon-grid--split">
            <section class="mon-panel" aria-labelledby="mon-checks-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-checks-title" class="mon-panel__title">Comprobaciones</h2>
                  <p class="mon-panel__sub">Umbrales de aviso y crítico por métrica</p>
                </div>
              </header>
              <ul class="mon-checks-list">
                <li v-for="check in row.checks" :key="check.check.id" class="mon-checks-list__item">
                  <span class="mon-checks-list__icon" :class="'mon-checks-list__icon--' + checkTone(check)">
                    <app-icon :name="check.check.icon"></app-icon>
                  </span>
                  <span class="mon-checks-list__label">{{ check.check.label }}</span>
                  <span class="mon-checks-list__value mono">{{ fmtValue(check) }}</span>
                  <span class="mon-checks-list__limit mono">aviso {{ fmtNumber(check.check.warn, check.check.unit) }} · crítico {{ fmtNumber(check.check.crit, check.check.unit) }}</span>
                </li>
              </ul>
              <p v-if="!row.checks.length" class="empty-state">La categoría no tiene comprobaciones activas.</p>
            </section>

            <section class="mon-panel" aria-labelledby="mon-device-alerts-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-device-alerts-title" class="mon-panel__title">Alertas del equipo</h2>
                  <p class="mon-panel__sub">{{ deviceAlerts.length }} registros entre activas e históricas</p>
                </div>
              </header>
              <ul v-if="deviceAlerts.length" class="mon-alert-list mon-alert-list--compact">
                <li v-for="alert in deviceAlerts" :key="alert.alert.id" class="mon-alert" :class="'mon-alert--' + severityTone(alert)">
                  <div class="mon-alert__body">
                    <button type="button" class="mon-alert__title" @click="openAlert(alert.alert.id)">{{ alert.alert.id }} · {{ alert.kind.label }}</button>
                    <p class="mon-alert__message">{{ alert.alert.message }}</p>
                    <div class="mon-alert__meta">
                      <span class="mon-tag" :class="'mon-tag--' + severityTone(alert)">{{ alert.severity.label }}</span>
                      <span class="mon-tag" :class="'mon-tag--' + stateTone(alert)">{{ alert.state.label }}</span>
                      <span class="mon-tag">{{ rel(alert.alert.detectedAt) }}</span>
                      <span v-if="alert.silenced" class="mon-tag">Silenciada</span>
                    </div>
                  </div>
                </li>
              </ul>
              <p v-else class="empty-state">El equipo no tiene alertas registradas.</p>
            </section>
          </div>

          <div v-if="canEdit" class="mon-actions">
            <button v-if="row.status !== 'up'" type="button" class="btn btn--secondary" @click="recover">
              <app-icon name="restore"></app-icon> Simular recuperación
            </button>
            <button v-if="exception" type="button" class="btn btn--ghost" @click="removeFromMonitoring">
              <app-icon name="slash"></app-icon> Quitar excepción de supervisión
            </button>
          </div>
        </template>

        <mon-silence-dialog :open="dialogs.silence" :alert="activeAlert" :app="app" @close="dialogs.silence = false" @saved="silenceSaved"></mon-silence-dialog>
      </section>
      <section v-else class="page">
        <p class="empty-state">El dispositivo solicitado no está disponible.</p>
      </section>
    `
  };

  // ---------------------------------------------------------------- alert
  Views.MonitorAlert = {
    components: {
      AppIcon: window.AppIcon,
      MonStatusPill: Views.MonStatusPill,
      MonSilenceDialog: Views.MonSilenceDialog,
      MonConvertDialog: Views.MonConvertDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      return { now: Date.now(), dialogs: { silence: false, convert: false }, tab: 'acontecimientos' };
    },
    computed: {
      monitoring() { return this.app.monitoring; },
      alert() {
        const id = this.app.route ? this.app.route.alertId : '';
        return ((this.app.maintenance && this.app.maintenance.alerts) || []).find((item) => item.id === id) || null;
      },
      row() { return this.alert ? M.alertRow(this.monitoring, this.alert, this.app.assets, this.now) : null; },
      asset() { return this.row ? this.row.asset : null; },
      device() { return this.asset ? M.deviceRow(this.monitoring, this.asset, this.app.assets ? ((this.app.maintenance && this.app.maintenance.alerts) || []) : [], this.now) : null; },
      plan() { return this.alert ? M.escalationPlan(this.monitoring, this.alert, this.app.assets, this.now) : null; },
      events() {
        if (!this.alert) return [];
        return (this.alert.events || []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      },
      smtpPreview() { return this.alert ? M.preview(this.monitoring, 'smtp', this.alert, this.app.assets) : null; },
      telegramPreview() { return this.alert ? M.preview(this.monitoring, 'telegram', this.alert, this.app.assets) : null; },
      canEdit() { return this.app.can('assets.edit'); },
      threshold() { return this.alert ? M.thresholdText(this.alert) : ''; },
      silenceState() { return this.alert ? M.activeSilence(this.monitoring, this.alert, this.now) : { silenced: false }; }
    },
    methods: {
      fmtDateTime: fmtDateTime,
      fmtDay: fmtDay,
      fmtClock: fmtClock,
      rel: rel,
      back() { if (this.app.setHash) this.app.setHash({ name: 'monitoring', section: 'alertas' }); },
      openDevice() { if (this.asset && this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: this.asset.id }); },
      openIncident(id) { if (this.app.setHash) this.app.setHash({ name: 'incident', incidentId: id }); },
      ack() {
        const result = M.acknowledge(this.monitoring, this.app.maintenance, this.alert.id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.app.showToast(result.ok ? 'Alerta reconocida. Sigue visible mientras el problema continúe.' : result.errors[0]);
      },
      recover() {
        const result = M.recoverDevice(this.monitoring, this.app.maintenance, this.app.assets, this.alert.assetId, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Recuperación simulada registrada.' : result.errors[0]);
      },
      resolve() {
        const result = M.resolveAlert(this.monitoring, this.app.maintenance, this.app.assets, this.alert.id, {
          actor: this.app.currentUser ? this.app.currentUser.name : 'Administrador'
        });
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Alerta resuelta y registrada en el historial.' : result.errors[0]);
      },
      askSilence() { this.dialogs.silence = true; },
      askConvert() { this.dialogs.convert = true; },
      cancelSilence() {
        const result = M.clearSilence(this.monitoring, this.app.maintenance, this.alert.id);
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Silenciamiento cancelado.' : result.errors[0]);
      },
      saved() { this.now = Date.now(); },
      severityTone() { return M.severityMeta(this.alert.severity).tone; },
      stateTone() { return M.alertStateMeta(this.alert.state).tone; },
      kindMeta() { return M.alertKindMeta(this.alert.kind); },
      planTone(item) {
        if (item.status === 'sent') return 'ok';
        if (item.status === 'scheduled') return 'hold';
        if (item.status === 'window' || item.status === 'silenced') return 'warn';
        return 'neutral';
      },
      planLabel(item) {
        const labels = {
          sent: 'Enviada',
          scheduled: 'Programada',
          window: 'Bloqueada por ventana',
          silenced: 'Bloqueada por silencio',
          channel: 'Canal sin configurar',
          disabled: 'Canal desactivado',
          acknowledged: 'Omitida: ya reconocida',
          skipped: 'No aplica',
          closed: 'Alerta cerrada'
        };
        return labels[item.status] || item.status;
      },
      channelLabel(id) { return M.channelMeta(id).label; },
      eventIcon(type) {
        const icons = {
          detected: 'alert', repeated: 'layers', acknowledged: 'check', silenced: 'slash',
          unsilenced: 'activity', recovered: 'restore', resolved: 'check', converted: 'shield', notified: 'send'
        };
        return icons[type] || 'info';
      }
    },
    template: `
      <section v-if="alert && row" class="page mon-page mon-alert-page" aria-labelledby="mon-alert-title">
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <button type="button" class="back-link" @click="back"><app-icon name="arrow-left"></app-icon> Alertas</button>
          <span class="crumb mono">{{ alert.id }}</span>
        </nav>

        <header class="mon-alert-head" :class="'mon-alert-head--' + severityTone()">
          <div class="mon-alert-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Alerta de supervisión · {{ alert.id }}</p>
            <h1 id="mon-alert-title">{{ asset ? asset.name : alert.assetId }}</h1>
            <p class="page-sub">{{ alert.message }}</p>
            <div class="mon-alert-head__tags">
              <span class="mon-tag" :class="'mon-tag--' + severityTone()">Severidad {{ row.severity.label }}</span>
              <span class="mon-tag" :class="'mon-tag--' + stateTone()">{{ row.state.label }}</span>
              <span class="mon-tag">{{ kindMeta().label }}</span>
              <span v-if="row.acknowledged" class="mon-tag mon-tag--ok">Reconocida</span>
              <span v-if="silenceState.silenced" class="mon-tag mon-tag--warn">Silenciada</span>
              <span v-if="alert.intermittent" class="mon-tag mon-tag--hold">Fallo intermitente</span>
              <span v-if="alert.groupCount > 1" class="mon-tag">{{ alert.groupCount }} eventos agrupados</span>
            </div>
          </div>
          <div class="mon-alert-head__actions">
            <button v-if="canEdit && alert.state === 'open' && !row.acknowledged" type="button" class="btn btn--primary" @click="ack">
              <app-icon name="check"></app-icon> Reconocer
            </button>
            <button v-if="canEdit && alert.state === 'open'" type="button" class="btn btn--secondary" @click="recover">
              <app-icon name="restore"></app-icon> Simular recuperación
            </button>
            <button v-if="canEdit && alert.state === 'recovered'" type="button" class="btn btn--primary" @click="resolve">
              <app-icon name="check"></app-icon> Resolver
            </button>
            <button v-if="canEdit && !silenceState.silenced" type="button" class="btn btn--ghost" @click="askSilence">
              <app-icon name="slash"></app-icon> Silenciar
            </button>
            <button v-if="canEdit && silenceState.silenced" type="button" class="btn btn--ghost" @click="cancelSilence">
              <app-icon name="activity"></app-icon> Cancelar silencio
            </button>
            <button v-if="canEdit && alert.incidentId" type="button" class="btn btn--secondary" @click="openIncident(alert.incidentId)">
              <app-icon name="shield"></app-icon> {{ alert.incidentId }}
            </button>
            <button v-else-if="canEdit" type="button" class="btn btn--secondary" @click="askConvert">
              <app-icon name="shield"></app-icon> Crear incidente
            </button>
          </div>
        </header>

        <div class="mon-metrics">
          <mon-metric label="Detectada" :value="fmtDateTime(alert.detectedAt)" :hint="rel(alert.detectedAt)" icon="clock"></mon-metric>
          <mon-metric label="Último acontecimiento" :value="fmtDateTime(alert.lastEventAt || alert.detectedAt)" :hint="rel(alert.lastEventAt || alert.detectedAt)" icon="activity"></mon-metric>
          <mon-metric v-if="alert.recoveredAt" label="Recuperada" :value="fmtDateTime(alert.recoveredAt)" :hint="'Sin resolver'" icon="restore" tone="ok"></mon-metric>
          <mon-metric v-if="alert.resolvedAt" label="Resuelta" :value="fmtDateTime(alert.resolvedAt)" :hint="alert.resolvedBy" icon="check" tone="ok"></mon-metric>
          <mon-metric v-if="threshold" label="Umbral" :value="threshold.split(' · ')[0]" :hint="'Límite ' + threshold.split(' · ')[1]" icon="gauge"></mon-metric>
        </div>

        <div class="mon-grid mon-grid--split">
          <section class="mon-panel" aria-labelledby="mon-events-title">
            <header class="mon-panel__head">
              <div>
                <h2 id="mon-events-title" class="mon-panel__title">Acontecimientos</h2>
                <p class="mon-panel__sub">Detección, reconocimiento, silencios y recuperación</p>
              </div>
              <span class="chip">{{ events.length }}</span>
            </header>
            <ol class="mon-timeline">
              <li v-for="event in events" :key="event.id" class="mon-timeline__item">
                <span class="mon-timeline__icon"><app-icon :name="eventIcon(event.type)"></app-icon></span>
                <div class="mon-timeline__body">
                  <p class="mon-timeline__text">{{ event.text }}</p>
                  <p class="mon-timeline__time mono">{{ fmtDateTime(event.at) }} · {{ rel(event.at) }}</p>
                </div>
              </li>
            </ol>
            <p v-if="!events.length" class="empty-state">La alerta no tiene acontecimientos registrados.</p>
          </section>

          <div class="mon-stack">
            <section v-if="asset" class="mon-panel" aria-labelledby="mon-alert-device-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-alert-device-title" class="mon-panel__title">Dispositivo</h2>
                  <p class="mon-panel__sub">{{ asset.id }} · {{ asset.ip }}</p>
                </div>
                <button type="button" class="text-button" @click="openDevice">Abrir supervisión</button>
              </header>
              <div class="mon-device-mini">
                <span class="mon-device-mini__thumb"><img :src="asset.image" alt="" loading="lazy"></span>
                <div class="mon-device-mini__text">
                  <p class="mon-device-mini__name">{{ asset.name }}</p>
                  <p class="mon-device-mini__meta">{{ asset.type }} · {{ asset.location }}</p>
                </div>
                <mon-status-pill :status="device.status"></mon-status-pill>
              </div>
              <dl class="mon-facts">
                <div class="mon-facts__row"><dt>Latencia</dt><dd class="mono">{{ device.latencyMs === null ? '—' : device.latencyMs + ' ms' }}</dd></div>
                <div class="mon-facts__row"><dt>Uptime</dt><dd class="mono">{{ device.uptimePct === null ? '—' : device.uptimePct + ' %' }}</dd></div>
                <div class="mon-facts__row"><dt>Última comprobación</dt><dd>{{ rel(device.lastCheckAt) }}</dd></div>
                <div class="mon-facts__row"><dt>Categoría</dt><dd>{{ asset.category }}</dd></div>
                <div class="mon-facts__row"><dt>Sede</dt><dd>{{ asset.site }}</dd></div>
              </dl>
            </section>

            <section class="mon-panel" aria-labelledby="mon-escalation-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-escalation-title" class="mon-panel__title">Escalamiento</h2>
                  <p class="mon-panel__sub">Qué se enviaría y cuándo, según las reglas activas</p>
                </div>
                <app-icon name="send"></app-icon>
              </header>
              <ul v-if="plan" class="mon-plan">
                <li v-for="item in plan.items" :key="item.rule.id" class="mon-plan__item" :class="'mon-plan__item--' + planTone(item)">
                  <div class="mon-plan__head">
                    <span class="mon-plan__label">{{ item.rule.label }}</span>
                    <span class="mon-tag" :class="'mon-tag--' + planTone(item)">{{ planLabel(item) }}</span>
                  </div>
                  <p class="mon-plan__meta">
                    {{ item.rule.afterMinutes === 0 ? 'Inmediato' : 'A los ' + item.rule.afterMinutes + ' min' }} ·
                    {{ item.channels.map(channel => channel.label).join(' + ') }} ·
                    {{ fmtClock(item.at) }}
                  </p>
                </li>
              </ul>
              <p v-if="plan && plan.silence.silenced" class="mon-plan__note">Silencio activo hasta {{ fmtDateTime(plan.silence.until) }}: {{ plan.silence.reason || 'sin motivo indicado' }}.</p>
              <p v-if="plan && plan.window" class="mon-plan__note">Ventana de mantenimiento activa: {{ plan.window.label }}. Las alertas quedan visibles y solo se detienen los avisos externos.</p>
              <p v-if="plan && plan.next" class="mon-plan__note">Siguiente envío: {{ plan.next.rule.label }} a las {{ fmtClock(plan.next.at) }} por {{ plan.next.channels.map(channel => channel.label).join(' y ') }}.</p>
              <p v-else-if="plan" class="mon-plan__note">No queda ningún envío programado con las reglas actuales.</p>
            </section>

            <section class="mon-panel" aria-labelledby="mon-preview-title">
              <header class="mon-panel__head">
                <div>
                  <h2 id="mon-preview-title" class="mon-panel__title">Mensajes preparados</h2>
                  <p class="mon-panel__sub">Vista previa de los canales configurados</p>
                </div>
              </header>
              <div v-if="smtpPreview" class="mon-preview">
                <p class="mon-preview__head"><app-icon name="mail"></app-icon> Correo SMTP</p>
                <p class="mon-preview__line"><span>Para</span> {{ smtpPreview.to }}</p>
                <p class="mon-preview__line"><span>Asunto</span> {{ smtpPreview.subject }}</p>
                <pre class="mon-preview__body">{{ smtpPreview.body }}</pre>
              </div>
              <div v-if="telegramPreview" class="mon-preview mon-preview--chat">
                <p class="mon-preview__head"><app-icon name="send"></app-icon> Telegram · {{ telegramPreview.bot }}</p>
                <pre class="mon-preview__body mon-preview__body--chat">{{ telegramPreview.body }}</pre>
              </div>
            </section>
          </div>
        </div>

        <mon-silence-dialog :open="dialogs.silence" :alert="alert" :app="app" @close="dialogs.silence = false" @saved="saved"></mon-silence-dialog>
        <mon-convert-dialog :open="dialogs.convert" :alert="alert" :app="app" @close="dialogs.convert = false" @saved="saved"></mon-convert-dialog>
      </section>
      <section v-else class="page">
        <p class="empty-state">La alerta solicitada no está disponible.</p>
      </section>
    `
  };

  // ---------------------------------------------------------------- inbox
  Views.NotificationBell = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return { open: false };
    },
    computed: {
      notifications() { return this.app.monitoring ? this.app.monitoring.notifications || [] : []; },
      unread() { return this.notifications.filter((item) => !item.readAt); },
      pending() { return this.unread.filter((item) => item.severity === 'alta' || item.severity === 'critica'); },
      latest() { return this.notifications.slice(0, 5); }
    },
    watch: {
      'app.route.name'() { this.open = false; }
    },
    mounted() {
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
      rel: rel,
      toggle() {
        if (this.open) { this.open = false; return; }
        this.open = true;
        this.$nextTick(() => this.$refs.panel?.focus());
      },
      close() { this.open = false; },
      onKeydown(event) {
        if (!this.open || event.key !== 'Escape') return;
        event.preventDefault();
        this.open = false;
        this.$nextTick(() => this.$refs.trigger?.focus());
      },
      tone(item) { return M.notificationKindMeta(item.kind).tone; },
      icon(item) { return M.notificationKindMeta(item.kind).icon; },
      providerLabel(item) { return M.notificationKindMeta(item.kind).label; },
      openNotification(item) {
        M.markNotificationRead(this.app.monitoring, item.id);
        this.open = false;
        if (!this.app.setHash) return;
        if (item.alertId) this.app.setHash({ name: 'monitorAlert', alertId: item.alertId });
        else if (item.incidentId) this.app.setHash({ name: 'incident', incidentId: item.incidentId });
        else if (item.assetId) this.app.setHash({ name: 'monitorDevice', assetId: item.assetId });
        else this.app.setHash({ name: 'notifications' });
      },
      openCenter() {
        this.open = false;
        if (this.app.setHash) this.app.setHash({ name: 'notifications' });
      },
      markAll() {
        M.markAllNotificationsRead(this.app.monitoring);
        this.app.showToast('Todas las notificaciones quedan como consultadas.');
      }
    },
    template: `
      <div class="notif" ref="bell" @keydown="onKeydown">
        <button type="button" class="icon-button notif__trigger" ref="trigger" data-od-id="topbar-notifications"
                :aria-expanded="open" aria-haspopup="dialog" aria-controls="notif-panel"
                :aria-label="'Notificaciones: ' + unread.length + ' sin consultar'" @click="toggle">
          <app-icon name="bell"></app-icon>
          <span v-if="unread.length" class="notif__badge mono">{{ unread.length > 9 ? '9+' : unread.length }}</span>
        </button>
        <transition name="dropdown">
          <div v-if="open" id="notif-panel" ref="panel" class="notif__panel" role="dialog" tabindex="-1" aria-labelledby="notif-title">
            <header class="notif__head">
              <div>
                <p class="notif__title" id="notif-title">Notificaciones</p>
                <p class="notif__sub">{{ unread.length }} sin consultar · {{ pending.length }} pendientes de atención</p>
              </div>
              <button type="button" class="text-button text-button--quiet" @click="markAll">Marcar todas</button>
            </header>
            <ul v-if="latest.length" class="notif__list">
              <li v-for="item in latest" :key="item.id" class="notif__item" :class="{ 'is-unread': !item.readAt }">
                <button type="button" class="notif__button" @click="openNotification(item)">
                  <span class="notif__icon" :class="'notif__icon--' + tone(item)"><app-icon :name="icon(item)"></app-icon></span>
                  <span class="notif__text">
                    <span class="notif__item-title">{{ item.title }}</span>
                    <span class="notif__item-body">{{ item.body }}</span>
                    <span class="notif__item-meta mono">{{ providerLabel(item) }} · {{ rel(item.at) }}</span>
                  </span>
                </button>
              </li>
            </ul>
            <p v-else class="notif__empty">Sin notificaciones por ahora.</p>
            <footer class="notif__foot">
              <button type="button" class="text-button" @click="openCenter">Ver todas las notificaciones</button>
            </footer>
          </div>
        </transition>
      </div>
    `
  };

  Views.NotificationCenter = {
    components: { AppIcon: window.AppIcon },
    props: { app: { type: Object, required: true } },
    data() {
      return { filter: 'all', now: Date.now() };
    },
    computed: {
      notifications() { return this.app.monitoring ? this.app.monitoring.notifications || [] : []; },
      unread() { return this.notifications.filter((item) => !item.readAt); },
      pending() { return this.unread.filter((item) => item.severity === 'alta' || item.severity === 'critica'); },
      read() { return this.notifications.filter((item) => !!item.readAt); },
      filters() {
        return [
          { id: 'all', label: 'Todas', count: this.notifications.length },
          { id: 'new', label: 'Nuevas', count: this.unread.length },
          { id: 'pending', label: 'Pendientes de atención', count: this.pending.length },
          { id: 'read', label: 'Consultadas', count: this.read.length },
          { id: 'alert', label: 'Alertas', count: this.notifications.filter((item) => item.kind === 'alert').length },
          { id: 'incident', label: 'Incidentes', count: this.notifications.filter((item) => item.kind === 'incident').length }
        ];
      },
      list() {
        return this.notifications.filter((item) => M.notificationMatches(item, this.filter));
      }
    },
    methods: {
      rel: rel,
      fmtDateTime: fmtDateTime,
      tone(item) { return M.notificationKindMeta(item.kind).tone; },
      icon(item) { return M.notificationKindMeta(item.kind).icon; },
      kindLabel(item) { return M.notificationKindMeta(item.kind).label; },
      severityLabel(item) { return M.severityMeta(item.severity).label; },
      open(item) {
        M.markNotificationRead(this.app.monitoring, item.id);
        if (!this.app.setHash) return;
        if (item.alertId) this.app.setHash({ name: 'monitorAlert', alertId: item.alertId });
        else if (item.incidentId) this.app.setHash({ name: 'incident', incidentId: item.incidentId });
        else if (item.assetId) this.app.setHash({ name: 'monitorDevice', assetId: item.assetId });
      },
      channelsLabel(item) {
        return (item.channels || []).map((id) => M.channelMeta(id).label).join(' · ');
      },
      markAll() {
        M.markAllNotificationsRead(this.app.monitoring);
        this.now = Date.now();
        this.app.showToast('Todas las notificaciones quedan como consultadas.');
      }
    },
    template: `
      <section class="page mon-page mon-inbox" aria-labelledby="inbox-title">
        <header class="mon-head">
          <div class="mon-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Actividad</p>
            <h1 id="inbox-title">Notificaciones</h1>
            <p class="page-sub">Alertas, incidentes y avisos del sistema.</p>
          </div>
          <div class="mon-head__actions">
            <button type="button" class="btn btn--secondary" :disabled="!unread.length" @click="markAll">
              <app-icon name="check"></app-icon> Marcar todas como consultadas
            </button>
          </div>
        </header>

        <div class="mon-pills" role="group" aria-label="Filtros de notificaciones">
          <button v-for="item in filters" :key="item.id" type="button" class="mon-pill-button"
                  :class="{ 'is-active': filter === item.id }" :aria-pressed="filter === item.id" @click="filter = item.id">
            {{ item.label }} <span class="mono">{{ item.count }}</span>
          </button>
        </div>

        <ul v-if="list.length" class="mon-inbox__list">
          <li v-for="item in list" :key="item.id" class="mon-inbox__item" :class="{ 'is-unread': !item.readAt }">
            <span class="mon-inbox__icon" :class="'mon-inbox__icon--' + tone(item)"><app-icon :name="icon(item)"></app-icon></span>
            <div class="mon-inbox__body">
              <div class="mon-inbox__head">
                <button type="button" class="mon-inbox__title" @click="open(item)">{{ item.title }}</button>
                <span class="mon-tag">{{ kindLabel(item) }}</span>
                <span class="mon-tag" :class="'mon-tag--' + tone(item)">{{ severityLabel(item) }}</span>
                <span v-if="!item.readAt" class="mon-tag mon-tag--hold">Nueva</span>
              </div>
              <p class="mon-inbox__text">{{ item.body }}</p>
              <div class="mon-inbox__meta">
                <span class="mono">{{ fmtDateTime(item.at) }} · {{ rel(item.at) }}</span>
                <span v-if="item.channels.length">{{ channelsLabel(item) }}</span>
                <span v-if="item.readAt">Consultada {{ rel(item.readAt) }}</span>
                <span v-else-if="item.severity === 'alta' || item.severity === 'critica'" class="mon-inbox__pending">Pendiente de atención</span>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="empty-state">No hay notificaciones con este filtro.</p>
      </section>
    `
  };

  // ---------------------------------------------------------------- asset panel
  Views.AssetMonitoringPanel = {
    components: { AppIcon: window.AppIcon, MonSpark: Views.MonSpark, MonStatusPill: Views.MonStatusPill },
    props: { app: { type: Object, required: true }, asset: { type: Object, required: true } },
    data() { return { now: Date.now() }; },
    computed: {
      monitoring() { return this.app.monitoring; },
      alerts() { return (this.app.maintenance && this.app.maintenance.alerts) || []; },
      row() { return M.deviceRow(this.monitoring, this.asset, this.alerts, this.now); },
      availability() { return M.availabilitySeries(this.monitoring, this.asset, this.app.monitoring.prefs.range, this.now); },
      deviceAlerts() { return this.row.alerts.filter((alert) => alert.state === 'open'); },
      canEdit() { return this.app.can('assets.edit'); }
    },
    methods: {
      rel: rel,
      fmtNumber: fmtNumber,
      openDevice() { if (this.app.setHash) this.app.setHash({ name: 'monitorDevice', assetId: this.asset.id }); },
      include() {
        const result = M.saveException(this.monitoring, this.asset.id, {
          enabled: true, intervalMinutes: 15, checkIds: ['availability'], asset: this.asset
        });
        this.now = Date.now();
        this.app.showToast(result.ok ? 'Equipo incorporado a la supervisión.' : result.errors[0]);
      }
    },
    template: `
      <section class="info-panel asset-monitor" aria-labelledby="asset-monitor-title">
        <header class="panel-head">
          <div>
            <p class="panel-note">Operación</p>
            <h2 id="asset-monitor-title">Supervisión</h2>
          </div>
          <mon-status-pill :status="row.status"></mon-status-pill>
        </header>

        <div v-if="row.monitored" class="asset-monitor__body">
          <div class="asset-monitor__grid">
            <div class="asset-monitor__fact">
              <span class="asset-monitor__label">Disponibilidad</span>
              <span class="asset-monitor__value mono">{{ fmtNumber(row.uptimePct, '%') }}</span>
            </div>
            <div class="asset-monitor__fact">
              <span class="asset-monitor__label">Latencia</span>
              <span class="asset-monitor__value mono">{{ row.latencyMs === null ? '—' : fmtNumber(row.latencyMs, 'ms') }}</span>
            </div>
            <div class="asset-monitor__fact">
              <span class="asset-monitor__label">Última comprobación</span>
              <span class="asset-monitor__value">{{ rel(row.lastCheckAt) }}</span>
            </div>
            <div class="asset-monitor__fact">
              <span class="asset-monitor__label">Alertas activas</span>
              <span class="asset-monitor__value mono">{{ deviceAlerts.length }}</span>
            </div>
          </div>
          <mon-spark :points="availability" :tone="row.status === 'down' ? 'down' : (row.status === 'degraded' ? 'warn' : 'teal')"></mon-spark>
          <div class="asset-monitor__foot">
            <button type="button" class="text-button" @click="openDevice">Ver supervisión completa</button>
            <span class="asset-monitor__hint">{{ row.checks.length }} comprobaciones cada {{ row.intervalMinutes }} min</span>
          </div>
        </div>
        <div v-else class="asset-monitor__empty">
          <p class="panel-note">Este activo no tiene comprobaciones configuradas. No se muestra disponibilidad para no inventar porcentajes.</p>
          <button v-if="canEdit" type="button" class="text-button" @click="include">Incorporar a la supervisión</button>
        </div>
      </section>
    `
  };

  Views.helpers = Object.assign({}, Views.helpers, {
    monFmtNumber: fmtNumber,
    monFmtValue: fmtValue,
    monRel: rel,
    monDateTime: fmtDateTime,
    monClock: fmtClock
  });
})();
