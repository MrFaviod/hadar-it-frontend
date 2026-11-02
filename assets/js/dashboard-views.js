(function () {
  'use strict';
  const components = { AppIcon: window.AppIcon, MonChart: window.Views.MonChart, MonStatusPill: window.Views.MonStatusPill };
  // The dashboard renders outside a mounted template too (KPI cards), so copy
  // and formats come from the runtime instead of a module-level literal.
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  const format = value => value === null || value === undefined ? '—' : (window.ItsmI18n ? window.ItsmI18n.number(value, { maximumFractionDigits: 2 }) : String(value));
  const DashboardKpis = {
    props: ['app', 'filters', 'snapshot'],
    computed: {
      model() { return this.snapshot || window.AssetDashboardModel.build(this.app, this.filters); },
      alertTotal() { return this.model.severity.reduce((total, item) => total + item.count, 0); }
    },
    methods: { format },
    template: `<div class="noc-kpis" data-od-id="dashboard-kpis">
      <a href="#/supervision" class="noc-kpi" data-od-id="kpi-availability"><span>{{ $t('ui.dashboard.kpi_availability', { period: filters.period }) }}</span><strong>{{ format(model.stats.availability) }}<small v-if="model.stats.availability !== null"> %</small></strong><em>{{ $t('ui.dashboard.kpi_monitored', { count: model.stats.monitored }) }}</em></a>
      <a href="#/supervision/dispositivos" class="noc-kpi" data-od-id="kpi-devices"><span>{{ $t('ui.dashboard.kpi_up') }}</span><strong>{{ model.stats.up }}<small> / {{ model.stats.monitored }}</small></strong><em>{{ $t('ui.dashboard.kpi_unmonitored_note', { count: model.stats.unmonitored }) }}</em></a>
      <a href="#/supervision/dispositivos" class="noc-kpi noc-kpi--attention" data-od-id="kpi-problems"><span>{{ $t('ui.dashboard.kpi_attention') }}</span><strong>{{ model.stats.down + model.stats.degraded }}</strong><em>{{ $t('ui.dashboard.kpi_attention_detail', { down: model.stats.down, degraded: model.stats.degraded }) }}</em></a>
      <a href="#/supervision/alertas" class="noc-kpi" data-od-id="kpi-alerts"><span>{{ $t('ui.dashboard.kpi_alerts') }}</span><strong>{{ alertTotal }}</strong><em>{{ $t('ui.dashboard.kpi_alerts_detail', { critical: model.stats.criticalAlerts, unacknowledged: model.stats.unacknowledged }) }}</em></a>
    </div>`
  };
  const DashboardWidget = {
    components,
    props: ['app', 'filters', 'widget', 'snapshot'],
    data() { return { activityKind: '', breakdown: 'category', pointIndex: -1 }; },
    computed: {
      model() { return this.snapshot || window.AssetDashboardModel.build(this.app, this.filters); },
      activity() { return this.model.activity.filter(e => !this.activityKind || e.kind === this.activityKind).slice(0, 8); },
      groups() { return this.breakdown === 'site' ? this.model.bySite : this.model.byCategory; },
      currentPoint() { const s = this.widget === 'latency' ? this.model.latency : this.model.availability; return s[this.pointIndex < 0 ? s.length - 1 : this.pointIndex]; },
      series() { return this.widget === 'latency' ? this.model.latency : this.model.availability; }
    },
    methods: {
      format,
      when(value) {
        const formatted = value && window.ItsmI18n ? window.ItsmI18n.formatDate(value, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        return formatted || tr('ui.dashboard.time_none');
      },
      day(value) {
        const formatted = value && window.ItsmI18n ? window.ItsmI18n.formatDate(value + (value.length === 10 ? 'T12:00:00' : ''), { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        return formatted || tr('ui.dashboard.date_none');
      },
      fraction(n, total) { return total ? Math.max(0, n / total * 100) + '%' : '0%'; },
      assetName(alert) { const asset = this.model.assets.find(item => item.id === alert.assetId); return asset ? asset.name : ''; },
      open(asset) { this.app.openAsset(asset); }
    },
    template: `<div class="noc-widget-body">
      <template v-if="widget === 'availability' || widget === 'latency'">
        <div v-if="series.length" class="noc-chart-wrap">
          <mon-chart :points="series" :label="widget === 'availability' ? $t('ui.dashboard.chart_availability') : $t('ui.dashboard.chart_latency')" :unit="widget === 'availability' ? '%' : 'ms'" :height="190" :min="widget === 'availability' ? 0 : null" :max="widget === 'availability' ? 100 : null"></mon-chart>
          <div class="noc-chart-inspect"><label :for="'sample-'+widget">{{ $t('ui.dashboard.inspect_label') }}</label><input :id="'sample-'+widget" type="range" min="0" :max="series.length-1" :value="pointIndex < 0 ? series.length-1 : Math.min(pointIndex,series.length-1)" @input="pointIndex=Number($event.target.value)" :aria-label="widget === 'availability' ? $t('ui.dashboard.sample_availability') : $t('ui.dashboard.sample_latency')" data-od-id="dashboard-chart-sample"><output v-if="currentPoint">{{ currentPoint.label }} · {{ format(currentPoint.value) }} {{ widget === 'availability' ? '%' : 'ms' }}</output></div>
          <div class="noc-chart-footer"><span>{{ $t('ui.dashboard.uptime_label') }} <b>{{ model.uptimeDays === null ? $t('ui.dashboard.no_data') : $t('ui.dashboard.uptime_days', { count: model.uptimeDays }) }}</b></span><span>{{ $t('ui.dashboard.last_check') }} <b>{{ when(model.lastCheck) }}</b></span></div>
        </div>
        <p v-else class="noc-empty">{{ $t('ui.dashboard.no_samples') }}</p>
        <div v-if="widget === 'availability'" class="noc-outages"><h3>{{ $t('ui.dashboard.outages_title', { period: filters.period }) }}</h3><a v-for="event in model.outages.slice(0,3)" :key="event.id" :href="event.href"><span>{{ event.title }}<small>{{ event.asset.name }}</small></span><time>{{ when(event.at) }}</time></a><p v-if="!model.outages.length" class="noc-empty">{{ $t('ui.dashboard.outages_empty') }}</p></div>
      </template>
      <template v-else-if="widget === 'alerts'">
        <div class="noc-severity"><a v-for="item in model.severity" :key="item.id" href="#/supervision/alertas" :class="'noc-severity--'+item.id"><strong>{{ item.count }}</strong><span>{{ item.label }}</span><i :style="{width:fraction(item.count,model.activeAlerts.length)}"></i></a></div>
        <div class="noc-alert-list"><a v-for="alert in model.activeAlerts.slice().sort((a,b)=>appAlertRank(b)-appAlertRank(a)).slice(0,4)" :key="alert.id" :href="'#/supervision/alerta/'+encodeURIComponent(alert.id)" :data-od-id="'dashboard-alert-'+alert.id"><span class="noc-alert-dot" :class="'noc-alert-dot--'+alert.severity"></span><span><b>{{ alert.title || alert.description }}</b><small>{{ assetName(alert) }} · {{ alert.acknowledgedAt ? $t('ui.dashboard.acknowledged_active') : $t('ui.dashboard.pending_attention') }}</small></span><app-icon name="chevron-right"></app-icon></a></div>
        <p v-if="!model.activeAlerts.length" class="noc-empty">{{ $t('ui.dashboard.alerts_empty') }}</p>
        <a class="noc-text-link" href="#/supervision/alertas">{{ $t('ui.dashboard.all_alerts') }} <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'distribution'">
        <div class="noc-distribution" role="img" :aria-label="model.distribution.map(r=>r.label+': '+r.count).join(', ')"><span v-for="item in model.distribution.filter(r=>r.count)" :key="item.id" :class="'noc-state--'+item.id" :style="{width:fraction(item.count,model.stats.total)}"></span></div>
        <a v-for="item in model.distribution.filter(r=>r.count || ['up','degraded','down','unmonitored'].includes(r.id))" :key="item.id" class="noc-state-row" href="#/supervision/dispositivos"><i :class="'noc-state--'+item.id"></i><span>{{ item.label }}</span><strong>{{ item.count }}</strong><small>{{ format(model.stats.total ? item.count/model.stats.total*100 : 0) }} %</small></a>
        <p class="noc-footnote">{{ $t('ui.dashboard.distribution_note') }}</p>
      </template>
      <template v-else-if="widget === 'infrastructure'">
        <div class="noc-segment" role="group" :aria-label="$t('ui.dashboard.breakdown_aria')"><button type="button" :aria-pressed="breakdown==='category'" @click="breakdown='category'">{{ $t('ui.dashboard.by_category') }}</button><button type="button" :aria-pressed="breakdown==='site'" @click="breakdown='site'">{{ $t('ui.dashboard.by_site') }}</button></div>
        <a v-for="group in groups" :key="group.id" :href="breakdown==='site' ? '#/infra/mapa' : '#/supervision/dispositivos'" class="noc-group"><span>{{ group.label }}<small>{{ $t('ui.dashboard.group_devices', { count: group.total }) }}</small></span><div class="noc-group-bar" :aria-label="$t('ui.dashboard.group_aria', { up: group.up, degraded: group.degraded, down: group.down, other: group.other })\"><i class="noc-state--up" :style="{width:fraction(group.up,group.total)}"></i><i class="noc-state--degraded" :style="{width:fraction(group.degraded,group.total)}"></i><i class="noc-state--down" :style="{width:fraction(group.down,group.total)}"></i><i class="noc-state--unmonitored" :style="{width:fraction(group.other,group.total)}"></i></div></a>
        <p v-if="!groups.length" class="noc-empty">{{ $t('ui.dashboard.empty_filters') }}</p><p class="noc-footnote">{{ $t('ui.dashboard.legend') }}</p>
      </template>
      <template v-else-if="widget === 'activity'">
        <label class="noc-inline-filter">{{ $t('ui.dashboard.activity_type') }}<select v-model="activityKind" data-od-id="dashboard-log-filter"><option value="">{{ $t('ui.dashboard.all_events') }}</option><option value="alert">{{ $t('ui.dashboard.events_alert') }}</option><option value="recovery">{{ $t('ui.dashboard.events_recovery') }}</option><option value="inventory">{{ $t('ui.dashboard.events_inventory') }}</option><option value="technical">{{ $t('ui.dashboard.events_technical') }}</option></select></label>
        <div class="noc-log"><a v-for="event in activity" :key="event.id" :href="event.href" :data-od-id="'dashboard-log-'+event.id"><span class="noc-log-mark" :class="'noc-log-mark--'+event.kind"></span><span><b>{{ event.title }}</b><small>{{ event.asset.name }} · {{ event.asset.code || event.asset.id }}</small></span><time>{{ when(event.at) }}</time></a><p v-if="!activity.length" class="noc-empty">{{ $t('ui.dashboard.activity_empty') }}</p></div>
      </template>
      <template v-else-if="widget === 'maintenance'">
        <a v-for="row in model.maintenance.slice(0,5)" :key="row.planId" href="#/mantenimiento" class="noc-work"><span><b>{{ row.asset.name }}</b><small>{{ row.template ? row.template.label : $t('ui.dashboard.preventive_default') }}</small></span><span class="status-pill" :class="'status-pill--'+row.statusMeta.tone">{{ row.statusMeta.label }}</span><time>{{ day(row.dueAt) }}</time></a>
        <p v-if="!model.maintenance.length" class="noc-empty">{{ $t('ui.dashboard.maintenance_empty') }}</p><a class="noc-text-link" href="#/mantenimiento">{{ $t('ui.dashboard.open_maintenance') }} <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'warranties'">
        <button type="button" v-for="row in model.warranties.slice(0,5)" :key="row.asset.id" class="noc-work noc-work--button" @click="open(row.asset)"><span><b>{{ row.asset.name }}</b><small>{{ row.asset.code || row.asset.id }}</small></span><strong>{{ row.days === 0 ? $t('ui.dashboard.warranty_today') : $t('ui.dashboard.warranty_in_days', { days: row.days }) }}</strong><time>{{ day(row.until) }}</time></button>
        <p v-if="!model.warranties.length" class="noc-empty">{{ $t('ui.dashboard.warranties_empty') }}</p><p class="noc-footnote">{{ $t('ui.dashboard.warranties_note') }}</p>
      </template>
      <template v-else-if="widget === 'inventory'">
        <div class="noc-inventory"><a href="#/inventario"><strong>{{ model.inventory.total }}</strong><span>{{ $t('ui.dashboard.inventory_records') }}</span></a><a href="#/inventario"><strong>{{ model.inventory.active }}</strong><span>{{ $t('ui.dashboard.inventory_active') }}</span></a><a href="#/inventario"><strong>{{ model.inventory.unassigned }}</strong><span>{{ $t('ui.dashboard.inventory_unassigned') }}</span></a></div>
        <div v-if="model.inventory.attention.length" class="noc-inventory-attention"><h3>{{ $t('ui.dashboard.inventory_attention') }}</h3><a v-for="item in model.inventory.attention" :key="item.assetId" :href="'#/activo/'+encodeURIComponent(item.assetId)"><span>{{ item.assetName }}<small>{{ item.assetCode || '' }} · {{ item.status }}</small></span></a></div><a class="noc-text-link" href="#/inventario">{{ $t('ui.dashboard.inventory_open') }} <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'incidents'">
        <div class="noc-alert-list"><a v-for="item in model.incidents" :key="item.id" :href="'#/mantenimiento/incidente/'+encodeURIComponent(item.id)" :data-od-id="'dashboard-incident-'+item.id"><span class="noc-alert-dot" :class="'noc-alert-dot--'+item.severity"></span><span><b>{{ item.title }}</b><small>{{ item.assetName || $t('ui.dashboard.no_asset') }} · {{ item.status }}</small></span><app-icon name="chevron-right"></app-icon></a></div>
        <p v-if="!model.incidents.length" class="noc-empty">{{ $t('ui.dashboard.incidents_empty') }}</p>
        <a class="noc-text-link" href="#/mantenimiento">{{ $t('ui.dashboard.open_maintenance') }} <app-icon name="arrow-right"></app-icon></a>
      </template>
    </div>`
  };
  DashboardWidget.methods.appAlertRank = alert => window.AssetMonitorEngine.severityRank(alert.severity);
  window.AssetDashboardViews = { DashboardKpis, DashboardWidget };
})();
