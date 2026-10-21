(function () {
  'use strict';
  const P = window.AssetDashboardPrefs;
  // Entrance stagger window: long enough for the last card and chart fill in motion.css.
  const ENTRANCE_MS = 700;
  const PanelOverview = {
    components: { AppIcon: window.AppIcon, DashboardKpis: window.AssetDashboardViews.DashboardKpis, DashboardWidget: window.AssetDashboardViews.DashboardWidget, DashboardPreferences: P.DashboardPreferences, DashboardLinks: P.DashboardLinks },
    props: { app: { type: Object, required: true } },
    data() { return { filters: { category: '', site: '', status: '', location: '', period: '24h' }, customize: false, reports: false, entering: true, entranceTimer: null }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || 'demo'; },
      widgets() { return P.visibleWidgets(this.app.dashboard, this.userId).map(id => P.CATALOGUE.find(w => w.id === id)); },
      temporary() { return this.app.dashboard.temporary[this.userId] || []; },
      model() { return window.AssetDashboardModel.build(this.app, this.filters); },
      hasFilters() { return !!(this.filters.category || this.filters.site || this.filters.status || this.filters.location); }
    },
    mounted() { this.entranceTimer = setTimeout(() => { this.entering = false; this.entranceTimer = null; }, ENTRANCE_MS); },
    beforeUnmount() { clearTimeout(this.entranceTimer); this.entranceTimer = null; },
    methods: {
      clearTemporary() { P.clearTemporary(this.app.dashboard, this.userId); },
      clearFilters() { this.filters.category = ''; this.filters.site = ''; this.filters.status = ''; this.filters.location = ''; },
      openReport() { this.reports = !this.reports; },
      downloadReport() {
        const rows = [['Activo', 'Código', 'Estado operativo', 'Disponibilidad actual (%)', 'Latencia (ms)', 'Última comprobación'], ...this.model.rows.map(r => [r.asset.name, r.asset.code || r.asset.id, r.statusMeta.label, r.uptimePct === null ? '' : r.uptimePct, r.latencyMs === null ? '' : r.latencyMs, r.lastCheckAt])];
        const csv = '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = 'informe-operativo.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.app.showToast('Informe operativo descargado.');
      }
    },
    template: `<section class="page noc" :class="{ 'noc--entering': entering }" data-od-id="dashboard-operativo" aria-labelledby="dashboard-title">
      <header class="page-header noc-header"><div><h1 id="dashboard-title">Panel</h1></div><div class="noc-header-actions"><button type="button" class="btn btn--secondary" @click="customize=!customize" :aria-expanded="customize" data-od-id="dashboard-customize"><app-icon name="sliders"></app-icon>{{ customize ? 'Cerrar ajustes' : 'Personalizar' }}</button><button v-if="app.can('assets.edit')" type="button" class="btn btn--primary" @click="app.openAssetCreate()" data-od-id="dashboard-new-asset"><app-icon name="plus"></app-icon>Nuevo activo</button></div></header>
      <div class="noc-context"><span><i></i>Datos de demostración</span><a href="#/supervision">Abrir supervisión<app-icon name="arrow-right"></app-icon></a></div>
      <transition name="fade"><dashboard-preferences v-if="customize" :app="app"></dashboard-preferences></transition>
      <div class="noc-filters" data-od-id="dashboard-filters"><label>Sede<select v-model="filters.site" data-od-id="dashboard-site-filter"><option value="">Todas las sedes</option><option v-for="site in app.sites" :key="site.id" :value="site.id">{{ site.label }}</option></select></label><label>Categoría<select v-model="filters.category" data-od-id="dashboard-category-filter"><option value="">Todas las categorías</option><option v-for="category in app.categories" :key="category.id" :value="category.id">{{ category.label }}</option></select></label><div class="noc-period"><span>Período</span><div class="noc-segment" role="group" aria-label="Período del Dashboard"><button v-for="period in [{id:'24h',label:'24 horas'},{id:'7d',label:'7 días'},{id:'30d',label:'30 días'}]" :key="period.id" type="button" :aria-pressed="filters.period===period.id" @click="filters.period=period.id" :data-od-id="'dashboard-period-'+period.id">{{ period.label }}</button></div></div><button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Limpiar filtros</button></div>
      <dashboard-kpis :app="app" :filters="filters" :snapshot="model"></dashboard-kpis>
      <div class="noc-quick" data-od-id="dashboard-quick-actions"><span class="mono">Accesos rápidos</span><nav aria-label="Funciones habituales"><a href="#/inventario"><app-icon name="inventory"></app-icon>Inventario</a><a href="#/infra/mapa"><app-icon name="map-pin"></app-icon>Mapa</a><a href="#/infra/grafo"><app-icon name="network"></app-icon>Grafo</a><a href="#/mantenimiento"><app-icon name="refresh"></app-icon>Mantenimiento</a><a href="#/supervision/alertas"><app-icon name="bell"></app-icon>Alertas</a><a v-if="app.can('assets.edit')" href="#/datos/importar"><app-icon name="upload"></app-icon>Importación</a><button type="button" @click="openReport" :aria-expanded="reports" data-od-id="dashboard-reports"><app-icon name="file-text"></app-icon>Reportes</button></nav></div>
      <section v-if="reports" class="noc-report" data-od-id="dashboard-report-panel"><div><h2>Informe operativo</h2><p>{{ model.assets.length }} registros · {{ filters.period }} · respeta la sede y categoría seleccionadas</p><p>Estado actual, disponibilidad registrada, latencia y última comprobación. Los equipos sin supervisión se exportan sin métricas ficticias.</p></div><button type="button" class="btn btn--secondary" @click="downloadReport">Descargar CSV</button><button type="button" class="btn btn--ghost" @click="reports=false">Cerrar</button></section>
      <div v-if="temporary.length" class="noc-temporary" role="status"><span>{{ temporary.length }} widgets temporales · tu distribución habitual no cambia</span><button type="button" @click="clearTemporary">Finalizar vista temporal</button></div>
      <div class="noc-grid"><section v-for="widget in widgets" :key="widget.id" class="noc-widget" :class="{'noc-widget--wide':widget.wide}" :data-od-id="'dashboard-widget-'+widget.id" :aria-labelledby="'dashboard-heading-'+widget.id"><header class="noc-widget-head"><div><h2 :id="'dashboard-heading-'+widget.id">{{ widget.label }}</h2><p>{{ widget.description }}</p></div><span v-if="temporary.includes(widget.id)" class="noc-widget-tag">Temporal</span><span v-else class="noc-widget-period mono">{{ ['availability','activity','latency'].includes(widget.id) ? filters.period : 'Actual' }}</span></header><dashboard-widget :widget="widget.id" :app="app" :filters="filters" :snapshot="model"></dashboard-widget></section></div>
      <p v-if="!widgets.length" class="noc-empty">Tu Dashboard no tiene widgets visibles. Abre Personalizar para añadirlos o restaurar la distribución inicial.</p>
      <dashboard-links v-if="!customize" :app="app"></dashboard-links>
      <footer class="noc-footer"><span>Lectura operativa del inventario y sus comprobaciones configuradas</span><a v-if="app.can('config.general')" href="#/configuracion/general">Preferencias en Configuración</a></footer>
    </section>`
  };
  window.AssetPanel = { PanelOverview, ENTRANCE_MS };
})();
