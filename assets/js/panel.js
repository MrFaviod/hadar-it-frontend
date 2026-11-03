(function () {
  'use strict';
  const P = window.AssetDashboardPrefs;
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  // Entrance stagger window: long enough for the last card and chart fill in motion.css.
  const ENTRANCE_MS = 700;
  const PanelOverview = {
    components: { AppIcon: window.AppIcon, DashboardKpis: window.AssetDashboardViews.DashboardKpis, DashboardWidget: window.AssetDashboardViews.DashboardWidget, DashboardPreferences: P.DashboardPreferences, DashboardLinks: P.DashboardLinks },
    props: { app: { type: Object, required: true } },
    data() { return { filters: { category: '', site: '', status: '', location: '', search: '', period: '24h' }, customize: false, reports: false, entering: true, entranceTimer: null }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || ''; },
      meta() { return this.app.dashboard.meta || { loading: false, loaded: false, error: '', generatedAt: '' }; },
      widgets() { return P.visibleWidgets(this.app.dashboard, this.userId).map(id => P.CATALOGUE.find(w => w.id === id)).filter(widget => this.model.widgetAvailable(widget.id)); },
      unavailableWidgets() { return P.visibleWidgets(this.app.dashboard, this.userId).map(id => P.CATALOGUE.find(w => w.id === id)).filter(widget => !this.model.widgetAvailable(widget.id)); },
      temporary() { return this.app.dashboard.temporary[this.userId] || []; },
      model() { return window.AssetDashboardModel.build(this.app, this.filters); },
      hasFilters() { return !!(this.filters.category || this.filters.site || this.filters.status || this.filters.location || this.filters.search); },
      unavailableLabels() { return this.unavailableWidgets.map(widget => widget.label).join(', '); },
      statusText() {
        if (this.meta.error) return this.meta.error;
        if (this.meta.loading) return tr('ui.panel.status_updating');
        if (!this.meta.loaded) return tr('ui.panel.status_none');
        return this.meta.generatedAt ? tr('ui.panel.status_with_time', { time: this.formatWhen(this.meta.generatedAt) }) : tr('ui.panel.status_ready');
      },
      statusTone() { return this.meta.error ? 'error' : this.meta.loading ? 'loading' : this.meta.loaded ? 'ok' : 'idle'; }
    },
    watch: {
      'filters.period'() { this.reload(); },
      'filters.site'() { this.reload(); },
      'filters.category'() { this.reload(); }
    },
    mounted() {
      this.entranceTimer = setTimeout(() => { this.entering = false; this.entranceTimer = null; }, ENTRANCE_MS);
      if (!this.meta.loaded || this.meta.error) this.reload();
    },
    beforeUnmount() { clearTimeout(this.entranceTimer); this.entranceTimer = null; },
    methods: {
      reload() {
        const params = { period: this.filters.period, category: this.filters.category, siteId: this.filters.site };
        const request = this.app.loadDashboardSummary ? this.app.loadDashboardSummary(params) : window.AssetPhase10Api.loadDashboard(this.app, params);
        return Promise.resolve(request).catch(() => null);
      },
      formatWhen(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; return window.ItsmI18n ? window.ItsmI18n.formatDate(date, { dateStyle: 'short', timeStyle: 'short' }) : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); },
      clearStatus() { this.filters.status = ''; this.filters.location = ''; this.filters.search = ''; },
      clearTemporary() { P.clearTemporary(this.app.dashboard, this.userId); },
      clearFilters() { this.filters.category = ''; this.filters.site = ''; this.filters.status = ''; this.filters.location = ''; this.filters.search = ''; },
      openReport() { this.reports = !this.reports; },
      downloadReport() {
        const rows = [[tr('ui.panel.csv_asset'), tr('ui.panel.csv_code'), tr('ui.panel.csv_status'), tr('ui.panel.csv_availability'), tr('ui.panel.csv_latency'), tr('ui.panel.csv_last_check')], ...this.model.rows.map(r => [r.asset.name, r.asset.code || r.asset.id, r.statusMeta.label, r.uptimePct === null ? '' : r.uptimePct, r.latencyMs === null ? '' : r.latencyMs, r.lastCheckAt])];
        const csv = '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = tr('ui.panel.csv_filename') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.app.showToast(tr('ui.panel.toast_downloaded'));
      }
    },
    template: `<section class="page noc" :class="{ 'noc--entering': entering }" data-od-id="dashboard-operativo" aria-labelledby="dashboard-title">
      <header class="page-header noc-header"><div><h1 id="dashboard-title">{{ $t('ui.page.panel') }}</h1></div><div class="noc-header-actions"><button type="button" class="btn btn--ghost" @click="openReport" :aria-expanded="reports" data-od-id="dashboard-reports"><app-icon name="file-text"></app-icon>{{ $t('ui.nav.reports') }}</button><button type="button" class="btn btn--secondary" @click="customize=!customize" :aria-expanded="customize" data-od-id="dashboard-customize"><app-icon name="sliders"></app-icon>{{ customize ? $t('ui.panel.close_settings') : $t('ui.panel.customize') }}</button><button v-if="app.can('assets.edit')" type="button" class="btn btn--primary" @click="app.openAssetCreate()" data-od-id="dashboard-new-asset"><app-icon name="plus"></app-icon>{{ $t('ui.panel.new_asset') }}</button></div></header>
      <div class="noc-context"><span role="status" aria-live="polite"><i :class="'noc-status-dot noc-status-dot--'+statusTone"></i>{{ statusText }}</span><a href="#/supervision">{{ $t('ui.panel.open_monitoring') }}<app-icon name="arrow-right"></app-icon></a></div>
      <div v-if="meta.loading && !meta.loaded" class="noc-loading" role="status" aria-live="polite"><span class="noc-spinner" aria-hidden="true"></span>{{ $t('ui.panel.loading') }}</div>
      <div v-else-if="meta.error && !meta.loaded" class="noc-error" role="alert"><div><b>{{ $t('ui.panel.error_title') }}</b><p>{{ meta.error }}</p></div><button type="button" class="btn btn--secondary" @click="reload">{{ $t('ui.common.retry') }}</button></div>
      <transition name="fade"><dashboard-preferences v-if="customize" :app="app"></dashboard-preferences></transition>
      <div class="noc-filters" data-od-id="dashboard-filters"><label>{{ $t('ui.shell.filter_site') }}<select v-model="filters.site" data-od-id="dashboard-site-filter"><option value="">{{ $t('ui.shell.filter_all_sites') }}</option><option v-for="site in app.sites" :key="site.id" :value="site.id">{{ site.label }}</option></select></label><label>{{ $t('ui.shell.filter_category') }}<select v-model="filters.category" data-od-id="dashboard-category-filter"><option value="">{{ $t('ui.shell.filter_all_categories') }}</option><option v-for="category in app.categories" :key="category.id" :value="category.id">{{ category.label }}</option></select></label><div class="noc-period"><span>{{ $t('ui.panel.period') }}</span><div class="noc-segment" role="group" :aria-label="$t('ui.panel.period_aria')"><button v-for="period in [{id:'24h',label:$t('ui.panel.period_24h')},{id:'7d',label:$t('ui.panel.period_7d')},{id:'30d',label:$t('ui.panel.period_30d')}]" :key="period.id" type="button" :aria-pressed="filters.period===period.id" @click="filters.period=period.id" :data-od-id="'dashboard-period-'+period.id">{{ period.label }}</button></div></div><button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">{{ $t('ui.common.clear_filters') }}</button></div>
      <div v-if="meta.error && meta.loaded" class="noc-error noc-error--inline" role="alert"><span>{{ meta.error }} {{ $t('ui.panel.stale') }}</span><button type="button" class="btn btn--secondary" @click="reload">{{ $t('ui.common.retry') }}</button></div>
      <template v-if="meta.loaded">
      <dashboard-kpis :app="app" :filters="filters" :snapshot="model"></dashboard-kpis>

      <section v-if="reports" class="noc-report" data-od-id="dashboard-report-panel"><div><h2>{{ $t('ui.panel.report_title') }}</h2><p>{{ $t('ui.panel.report_meta', { count: model.assets.length, period: filters.period }) }}</p></div><button type="button" class="btn btn--secondary" @click="downloadReport">{{ $t('ui.panel.download_csv') }}</button><button type="button" class="btn btn--ghost" @click="reports=false">{{ $t('ui.common.close') }}</button></section>
      <div v-if="temporary.length" class="noc-temporary" role="status"><span>{{ $t('ui.panel.temporary', { count: temporary.length }) }}</span><button type="button" @click="clearTemporary">{{ $t('ui.panel.end_temporary') }}</button></div>
      <p v-if="unavailableWidgets.length" class="noc-empty" role="status">{{ $t('ui.panel.unavailable', { list: unavailableLabels }) }}</p>
      <div class="noc-grid"><section v-for="widget in widgets" :key="widget.id" class="noc-widget" :class="{'noc-widget--wide':widget.wide}" :data-od-id="'dashboard-widget-'+widget.id" :aria-labelledby="'dashboard-heading-'+widget.id"><header class="noc-widget-head"><div><h2 :id="'dashboard-heading-'+widget.id">{{ widget.label }}</h2></div><span v-if="temporary.includes(widget.id)" class="noc-widget-tag">{{ $t('ui.panel.tag_temporary') }}</span><span v-else class="noc-widget-period mono">{{ ['availability','activity','latency'].includes(widget.id) ? filters.period : $t('ui.panel.period_current') }}</span></header><dashboard-widget :widget="widget.id" :app="app" :filters="filters" :snapshot="model"></dashboard-widget></section></div>
      <p v-if="!widgets.length" class="noc-empty">{{ $t('ui.panel.empty') }}</p>
      </template>
      <dashboard-links v-if="!customize" :app="app"></dashboard-links>

    </section>`
  };
  window.AssetPanel = { PanelOverview, ENTRANCE_MS };
})();
