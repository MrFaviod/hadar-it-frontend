(function () {
  'use strict';
  const components = { AppIcon: window.AppIcon, MonChart: window.Views.MonChart, MonStatusPill: window.Views.MonStatusPill };
  const format = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  const DashboardKpis = {
    props: ['app', 'filters', 'snapshot'],
    computed: {
      model() { return this.snapshot || window.AssetDashboardModel.build(this.app, this.filters); },
      alertTotal() { return this.model.severity.reduce((total, item) => total + item.count, 0); }
    },
    methods: { format },
    template: `<div class="noc-kpis" data-od-id="dashboard-kpis">
      <a href="#/supervision" class="noc-kpi" data-od-id="kpi-availability"><span>Disponibilidad · {{ filters.period }}</span><strong>{{ format(model.stats.availability) }}<small v-if="model.stats.availability !== null"> %</small></strong><em>{{ model.stats.monitored }} equipos supervisados · media del período</em></a>
      <a href="#/supervision/dispositivos" class="noc-kpi" data-od-id="kpi-devices"><span>Disponibles ahora</span><strong>{{ model.stats.up }}<small> / {{ model.stats.monitored }}</small></strong><em>{{ model.stats.unmonitored }} sin supervisión, no fuera de línea</em></a>
      <a href="#/supervision/dispositivos" class="noc-kpi noc-kpi--attention" data-od-id="kpi-problems"><span>Requieren atención</span><strong>{{ model.stats.down + model.stats.degraded }}</strong><em>{{ model.stats.down }} fuera de línea · {{ model.stats.degraded }} degradados</em></a>
      <a href="#/supervision/alertas" class="noc-kpi" data-od-id="kpi-alerts"><span>Alertas activas</span><strong>{{ alertTotal }}</strong><em>{{ model.stats.criticalAlerts }} críticas · {{ model.stats.unacknowledged }} sin reconocer</em></a>
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
      when(value) { return value ? new Date(value).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin registro'; },
      day(value) { return value ? new Date(value + (value.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha'; },
      fraction(n, total) { return total ? Math.max(0, n / total * 100) + '%' : '0%'; },
      open(asset) { this.app.openAsset(asset); }
    },
    template: `<div class="noc-widget-body">
      <template v-if="widget === 'availability' || widget === 'latency'">
        <div v-if="series.length" class="noc-chart-wrap">
          <mon-chart :points="series" :label="widget === 'availability' ? 'Disponibilidad media de la infraestructura' : 'Latencia de equipos con datos'" :unit="widget === 'availability' ? '%' : 'ms'" :height="190" :min="widget === 'availability' ? 0 : null" :max="widget === 'availability' ? 100 : null"></mon-chart>
          <div class="noc-chart-inspect"><label :for="'sample-'+widget">Explorar muestras</label><input :id="'sample-'+widget" type="range" min="0" :max="series.length-1" :value="pointIndex < 0 ? series.length-1 : Math.min(pointIndex,series.length-1)" @input="pointIndex=Number($event.target.value)" :aria-label="'Muestra de '+(widget === 'availability' ? 'disponibilidad' : 'latencia')" data-od-id="dashboard-chart-sample"><output v-if="currentPoint">{{ currentPoint.label }} · {{ format(currentPoint.value) }} {{ widget === 'availability' ? '%' : 'ms' }}</output></div>
          <div class="noc-chart-footer"><span>Uptime medio actual <b>{{ model.uptimeDays === null ? 'Sin datos' : model.uptimeDays+' días' }}</b></span><span>Última comprobación <b>{{ when(model.lastCheck) }}</b></span></div>
        </div>
        <p v-else class="noc-empty">No hay muestras para esta selección. Los equipos sin datos no se incluyen en los porcentajes.</p>
        <div v-if="widget === 'availability'" class="noc-outages"><h3>Caídas y recuperaciones · {{ filters.period }}</h3><a v-for="event in model.outages.slice(0,3)" :key="event.id" :href="event.href"><span>{{ event.title }}<small>{{ event.asset.name }}</small></span><time>{{ when(event.at) }}</time></a><p v-if="!model.outages.length" class="noc-empty">Sin caídas ni recuperaciones registradas en este período.</p></div>
      </template>
      <template v-else-if="widget === 'alerts'">
        <div class="noc-severity"><a v-for="item in model.severity" :key="item.id" href="#/supervision/alertas" :class="'noc-severity--'+item.id"><strong>{{ item.count }}</strong><span>{{ item.label }}</span><i :style="{width:fraction(item.count,model.activeAlerts.length)}"></i></a></div>
        <div class="noc-alert-list"><a v-for="alert in model.activeAlerts.slice().sort((a,b)=>appAlertRank(b)-appAlertRank(a)).slice(0,4)" :key="alert.id" :href="'#/supervision/alerta/'+encodeURIComponent(alert.id)" :data-od-id="'dashboard-alert-'+alert.id"><span class="noc-alert-dot" :class="'noc-alert-dot--'+alert.severity"></span><span><b>{{ alert.title || alert.description }}</b><small>{{ (model.assets.find(a=>a.id===alert.assetId)||{}).name }} · {{ alert.acknowledgedAt ? 'Reconocida · problema activo' : 'Pendiente de atención' }}</small></span><app-icon name="chevron-right"></app-icon></a></div>
        <p v-if="!model.activeAlerts.length" class="noc-empty">Sin alertas activas para esta selección.</p>
        <a class="noc-text-link" href="#/supervision/alertas">Consultar todas las alertas <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'distribution'">
        <div class="noc-distribution" role="img" :aria-label="model.distribution.map(r=>r.label+': '+r.count).join(', ')"><span v-for="item in model.distribution.filter(r=>r.count)" :key="item.id" :class="'noc-state--'+item.id" :style="{width:fraction(item.count,model.stats.total)}"></span></div>
        <a v-for="item in model.distribution.filter(r=>r.count || ['up','degraded','down','unmonitored'].includes(r.id))" :key="item.id" class="noc-state-row" href="#/supervision/dispositivos"><i :class="'noc-state--'+item.id"></i><span>{{ item.label }}</span><strong>{{ item.count }}</strong><small>{{ format(model.stats.total ? item.count/model.stats.total*100 : 0) }} %</small></a>
        <p class="noc-footnote">El estado operativo es independiente del estado administrativo del inventario.</p>
      </template>
      <template v-else-if="widget === 'infrastructure'">
        <div class="noc-segment" role="group" aria-label="Agrupación de infraestructura"><button type="button" :aria-pressed="breakdown==='category'" @click="breakdown='category'">Por categoría</button><button type="button" :aria-pressed="breakdown==='site'" @click="breakdown='site'">Por sede</button></div>
        <a v-for="group in groups" :key="group.id" :href="breakdown==='site' ? '#/infra/mapa' : '#/supervision/dispositivos'" class="noc-group"><span>{{ group.label }}<small>{{ group.total }} equipos</small></span><div class="noc-group-bar" :aria-label="group.up+' disponibles, '+group.degraded+' degradados, '+group.down+' fuera de línea y '+group.other+' sin datos operativos'"><i class="noc-state--up" :style="{width:fraction(group.up,group.total)}"></i><i class="noc-state--degraded" :style="{width:fraction(group.degraded,group.total)}"></i><i class="noc-state--down" :style="{width:fraction(group.down,group.total)}"></i><i class="noc-state--unmonitored" :style="{width:fraction(group.other,group.total)}"></i></div></a>
        <p v-if="!groups.length" class="noc-empty">Sin equipos para estos filtros.</p><p class="noc-footnote">Verde: disponible · ámbar: degradado · rojo: fuera de línea · gris: sin datos o supervisión</p>
      </template>
      <template v-else-if="widget === 'activity'">
        <label class="noc-inline-filter">Tipo de evento<select v-model="activityKind" data-od-id="dashboard-log-filter"><option value="">Todos los eventos</option><option value="alert">Alertas</option><option value="recovery">Recuperaciones</option><option value="inventory">Inventario y movimientos</option><option value="technical">Intervenciones e incidentes</option></select></label>
        <div class="noc-log"><a v-for="event in activity" :key="event.id" :href="event.href" :data-od-id="'dashboard-log-'+event.id"><span class="noc-log-mark" :class="'noc-log-mark--'+event.kind"></span><span><b>{{ event.title }}</b><small>{{ event.asset.name }} · {{ event.asset.code || event.asset.id }}</small></span><time>{{ when(event.at) }}</time></a><p v-if="!activity.length" class="noc-empty">Sin eventos de este tipo en el período seleccionado.</p></div>
      </template>
      <template v-else-if="widget === 'maintenance'">
        <a v-for="row in model.maintenance.slice(0,5)" :key="row.planId" href="#/mantenimiento" class="noc-work"><span><b>{{ row.asset.name }}</b><small>{{ row.template ? row.template.label : 'Mantenimiento preventivo' }}</small></span><span class="status-pill" :class="'status-pill--'+row.statusMeta.tone">{{ row.statusMeta.label }}</span><time>{{ day(row.dueAt) }}</time></a>
        <p v-if="!model.maintenance.length" class="noc-empty">No hay trabajos preventivos pendientes para esta selección.</p><a class="noc-text-link" href="#/mantenimiento">Abrir mantenimiento <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'warranties'">
        <button type="button" v-for="row in model.warranties.slice(0,5)" :key="row.asset.id" class="noc-work noc-work--button" @click="open(row.asset)"><span><b>{{ row.asset.name }}</b><small>{{ row.asset.code || row.asset.id }}</small></span><strong>{{ row.days === 0 ? 'Hoy' : 'En '+row.days+' días' }}</strong><time>{{ day(row.until) }}</time></button>
        <p v-if="!model.warranties.length" class="noc-empty">No hay garantías que venzan en los próximos 90 días para esta selección.</p><p class="noc-footnote">Solo se consideran fechas de cobertura registradas en las fichas.</p>
      </template>
      <template v-else-if="widget === 'inventory'">
        <div class="noc-inventory"><a href="#/inventario"><strong>{{ model.inventory.total }}</strong><span>Registros</span></a><a href="#/inventario"><strong>{{ model.inventory.active }}</strong><span>En inventario activo</span></a><a href="#/inventario"><strong>{{ model.inventory.unassigned }}</strong><span>Sin responsable</span></a></div>
        <div v-if="model.inventory.attention.length" class="noc-inventory-attention"><h3>Equipos que requieren atención</h3><a v-for="item in model.inventory.attention" :key="item.assetId" :href="'#/activo/'+encodeURIComponent(item.assetId)"><span>{{ item.assetName }}<small>{{ item.assetCode || '' }} · {{ item.status }}</small></span></a></div><a class="noc-text-link" href="#/inventario">Explorar el inventario <app-icon name="arrow-right"></app-icon></a>
      </template>
      <template v-else-if="widget === 'incidents'">
        <div class="noc-alert-list"><a v-for="item in model.incidents" :key="item.id" :href="'#/mantenimiento/incidente/'+encodeURIComponent(item.id)" :data-od-id="'dashboard-incident-'+item.id"><span class="noc-alert-dot" :class="'noc-alert-dot--'+item.severity"></span><span><b>{{ item.title }}</b><small>{{ item.assetName || 'Sin activo' }} · {{ item.status }}</small></span><app-icon name="chevron-right"></app-icon></a></div>
        <p v-if="!model.incidents.length" class="noc-empty">Sin incidencias activas para esta selección.</p>
        <a class="noc-text-link" href="#/mantenimiento">Abrir mantenimiento <app-icon name="arrow-right"></app-icon></a>
      </template>
    </div>`
  };
  DashboardWidget.methods.appAlertRank = alert => window.AssetMonitorEngine.severityRank(alert.severity);
  window.AssetDashboardViews = { DashboardKpis, DashboardWidget };
})();
