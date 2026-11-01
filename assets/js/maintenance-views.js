(function () {
  'use strict';

  const Engine = window.AssetMaintEngine;
  const Data = window.ASSET_MAINT;
  const Views = window.AssetMaintViews = window.AssetMaintViews || {};

  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function fmtDay(value) {
    const day = Engine.toDay(value);
    if (!day || !Engine.validDay(day)) return 'Sin fecha';
    const date = new Date(day + 'T12:00:00');
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function fmtDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fmtDay(value);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return fmtDay(value) + ' · ' + hours + ':' + minutes;
  }

  function relLabel(days) {
    if (days === null || days === undefined) return 'Sin programar';
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Mañana';
    if (days === -1) return 'Ayer';
    if (days < 0) return 'Hace ' + Math.abs(days) + ' días';
    return 'En ' + days + ' días';
  }

  function money(value) {
    if (value === null || value === undefined || value === '') return '—';
    return window.ItsmI18n
      ? window.ItsmI18n.amount(value, { maximumFractionDigits: 2 })
      : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function findMeta(list, id, fallback) {
    return (list || []).find((item) => item.id === id) || fallback;
  }

  function priorityMeta(id) {
    return findMeta(Data.PRIORITIES, id, Data.PRIORITIES[2]);
  }

  function incidentStateMeta(id) {
    return findMeta(Data.INCIDENT_STATES, id, Data.INCIDENT_STATES[0]);
  }

  function interventionStateMeta(id) {
    return findMeta(Data.INTERVENTION_STATES, id, Data.INTERVENTION_STATES[0]);
  }

  function alertStateMeta(id) {
    return findMeta(Data.ALERT_STATES, id, Data.ALERT_STATES[0]);
  }

  function alertKindMeta(id) {
    return findMeta(Data.ALERT_KINDS, id, Data.ALERT_KINDS[0]);
  }

  // Shared by the asset panel and dialogs after this module loads.
  Views.helpers = {
    fmtDay,
    fmtDateTime,
    relLabel,
    money,
    plural,
    priorityMeta,
    incidentStateMeta,
    interventionStateMeta,
    alertStateMeta,
    alertKindMeta
  };

  const GROUPS = [
    { id: 'overdue', label: 'Vencidos', hint: 'Requieren atención inmediata' },
    { id: 'today', label: 'Vence hoy', hint: 'Dentro de la jornada' },
    { id: 'soon', label: 'Próximas dos semanas', hint: 'Planifica la ventana' },
    { id: 'scheduled', label: 'Programado', hint: 'Sin urgencia' }
  ];

  function today() {
    return Engine.today();
  }

  Views.MaintenanceCenter = {
    name: 'MaintenanceCenter',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog,
      IncidentDialog: window.AssetMaintDialogs.IncidentDialog,
      PostponeDialog: window.AssetMaintDialogs.PostponeDialog,
      PlanCompleteDialog: window.AssetMaintDialogs.PlanCompleteDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      const prefs = (this.app.maintenance && this.app.maintenance.prefs) || {};
      return {
        view: prefs.defaultView || 'agenda',
        filters: {
          query: '', state: '', planStatus: '', category: '', siteId: '', type: '',
          priority: '', technicianId: '', from: '', to: ''
        },
        dialogs: { intervention: false, complete: false, incident: false, postpone: false },
        active: { assetId: '', interventionId: '', planId: '', planLabel: '', incidentAsset: '' },
        reloadTimer: null
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      planning() {
        return this.app.maintenancePlanning;
      },
      assets() {
        return this.app.assets || [];
      },
      people() {
        return (this.app.people || []).filter((person) => person.active);
      },
      sites() {
        return this.app.sites || [];
      },
      categories() {
        return this.app.categories || [];
      },
      types() {
        return this.maintenance.types || [];
      },
      plansPage() {
        return this.app.maintenanceApi ? this.app.maintenanceApi.plans : null;
      },
      interventionsPage() {
        return this.app.maintenanceApi ? this.app.maintenanceApi.interventions : null;
      },
      incidentsPage() {
        return this.app.maintenanceApi ? this.app.maintenanceApi.incidents : null;
      },
      overview() {
        return this.app.maintenanceApi ? this.app.maintenanceApi.overview : {};
      },
      costs() {
        return this.app.maintenanceCosts;
      },
      priorities() {
        return Data.PRIORITIES;
      },
      stats() {
        return Engine.stats(this.maintenance, this.assets, today());
      },
      kpis() {
        const stats = this.stats;
        return [
          { id: 'overdue', label: 'Preventivos vencidos', value: stats.overdue, hint: 'Planes fuera de fecha', tone: stats.overdue ? 'down' : 'ok' },
          { id: 'soon', label: 'Próximos 14 días', value: stats.soon, hint: 'Ventanas por reservar', tone: stats.soon ? 'warn' : 'ok' },
          { id: 'progress', label: 'Trabajos en curso', value: stats.inProgress, hint: plural(stats.planned, 'abierto', 'abiertos') + ' sin iniciar', tone: 'neutral' },
          { id: 'incidents', label: 'Incidentes abiertos', value: stats.openIncidents, hint: stats.criticalIncidents ? plural(stats.criticalIncidents, 'crítico', 'críticos') : 'Sin criticidad alta', tone: stats.criticalIncidents ? 'down' : 'neutral' }
        ];
      },
      agendaRows() {
        return Engine.agenda(this.maintenance, this.assets, {
          query: this.filters.query,
          category: this.filters.category,
          siteId: this.filters.siteId,
          technicianId: this.filters.technicianId,
          from: this.filters.from,
          to: this.filters.to,
          planStatus: this.filters.planStatus || 'all'
        }, today());
      },
      groups() {
        return GROUPS.map((group) => ({
          id: group.id,
          label: group.label,
          hint: group.hint,
          rows: this.agendaRows.filter((row) => row.status === group.id)
        })).filter((group) => group.rows.length);
      },
      interventions() {
        return (this.planning.interventions || [])
          .filter((item) => Engine.interventionMatches(item, this.maintenance, this.assets, this.people, {
            query: this.filters.query,
            category: this.filters.category,
            siteId: this.filters.siteId,
            type: this.filters.type,
            technicianId: this.filters.technicianId,
            from: this.filters.from,
            to: this.filters.to
          }))
          .slice()
          .sort((a, b) => String(b.occurredOn).localeCompare(String(a.occurredOn)));
      },
      incidents() {
        return (this.planning.incidents || [])
          .filter((item) => Engine.incidentMatches(item, this.assets, this.people, {
            query: this.filters.query,
            priority: this.filters.priority,
            siteId: this.filters.siteId,
            responsiblePersonId: this.filters.technicianId
          }))
          .slice()
          .sort((a, b) => {
            const openA = a.status === 'open' || a.status === 'in_progress' ? 0 : 1;
            const openB = b.status === 'open' || b.status === 'in_progress' ? 0 : 1;
            if (openA !== openB) return openA - openB;
            const weight = priorityMeta(b.priority).weight - priorityMeta(a.priority).weight;
            if (weight) return weight;
            return String(b.openedOn).localeCompare(String(a.openedOn));
          });
      },
      alerts() {
        return (this.maintenance.alerts || [])
          .filter((item) => Engine.alertMatches(item, this.assets, { query: this.filters.query, state: this.filters.state }))
          .slice()
          .sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
      },
      totals() {
        return this.planning.totals || { templates: 0, plans: 0, interventions: 0, incidents: 0 };
      },
      loading() {
        return !!((this.plansPage && this.plansPage.loading) || (this.interventionsPage && this.interventionsPage.loading) || (this.incidentsPage && this.incidentsPage.loading));
      },
      error() {
        const errors = this.planning.errors || {};
        return errors.plans || errors.interventions || errors.incidents || (this.overview && this.overview.error) || '';
      },
      filterCount() {
        return ['query', 'from', 'to'].filter((key) => this.filters[key]).length +
          ['state', 'planStatus', 'category', 'siteId', 'type', 'priority', 'technicianId'].filter((key) => this.filters[key] && this.filters[key] !== 'all').length;
      },
      emptyMessage() {
        const filtered = this.filterCount > 0;
        if (this.view === 'incidents') return filtered ? 'Ningún incidente coincide con los filtros activos.' : 'Todavía no hay incidentes registrados.';
        if (this.view === 'interventions') return filtered ? 'Ninguna intervención coincide con los filtros activos.' : 'Todavía no hay intervenciones registradas.';
        if (this.view === 'alerts') return 'No hay alertas de supervisión con estos filtros.';
        return filtered ? 'No hay trabajos preventivos con estos filtros.' : 'Todavía no hay trabajos preventivos programados.';
      },
      openPlan() {
        const detail = this.app.maintenanceApi && this.app.maintenanceApi.planDetail;
        return detail && detail.record ? detail.record : null;
      }
    },
    watch: {
      view(value) {
        this.filters.state = '';
        this.filters.type = '';
        this.filters.priority = '';
        const prefs = Object.assign({}, this.maintenance.prefs, { defaultView: value });
        this.app.maintenanceApi.prefs = prefs;
        this.scheduleReload();
      },
      filters: {
        deep: true,
        handler() {
          this.scheduleReload();
        }
      }
    },
    created() {
      const planId = this.app.workspaceMaintenanceId;
      if (planId) {
        if (typeof this.loadPlanDetail === 'function') {
          this.loadPlanDetail(planId);
        } else {
          const record = (this.app.universalRecords || []).find((item) => item.target && item.target.kind === 'plan' && item.target.id === planId);
          if (record) this.filters.query = record.target.assetId;
          this.active.planId = planId;
        }
        this.app.workspaceMaintenanceId = '';
        this.view = 'agenda';
      } else if (typeof this.loadView === 'function') {
        this.loadView();
      }
      if (typeof this.loadOverview === 'function') this.loadOverview();
    },
    beforeUnmount() {
      if (this.reloadTimer) window.clearTimeout(this.reloadTimer);
    },
    methods: {
      fmtDay,
      fmtDateTime,
      relLabel,
      money,
      plural,
      priorityMeta,
      incidentStateMeta,
      interventionStateMeta,
      alertStateMeta,
      alertKindMeta,
      assetName(id) {
        const asset = Engine.assetOf(this.assets, id);
        return asset ? asset.quickCode || asset.id : id;
      },
      assetOf(id) {
        return Engine.assetOf(this.assets, id);
      },
      technicianLabel(id) {
        return Engine.personName(this.people, id) || 'Sin asignar';
      },
      personLabel(id, fallback) {
        return Engine.personName(this.people, id) || fallback || 'Sin asignar';
      },
      planFilterParams() {
        const params = {};
        if (this.filters.state) params.state = this.filters.state;
        if (this.filters.planStatus) params.status = this.filters.planStatus;
        if (this.filters.category) params.category = this.filters.category;
        if (this.filters.siteId) params.siteId = this.filters.siteId;
        if (this.filters.type) params.maintenanceType = this.filters.type;
        if (this.filters.technicianId) params.responsiblePersonId = this.filters.technicianId;
        if (this.filters.from) params.dueFrom = this.filters.from;
        if (this.filters.to) params.dueTo = this.filters.to;
        return params;
      },
      interventionFilterParams() {
        const params = {};
        if (this.filters.state) params.status = this.filters.state;
        if (this.filters.type) params.type = this.filters.type;
        if (this.filters.category) params.category = this.filters.category;
        if (this.filters.siteId) params.siteId = this.filters.siteId;
        if (this.filters.from) params.occurredFrom = this.filters.from;
        if (this.filters.to) params.occurredTo = this.filters.to;
        return params;
      },
      incidentFilterParams() {
        const params = {};
        if (this.filters.state) params.status = this.filters.state;
        if (this.filters.priority) params.priority = this.filters.priority;
        if (this.filters.category) params.category = this.filters.category;
        if (this.filters.siteId) params.siteId = this.filters.siteId;
        if (this.filters.technicianId) params.responsiblePersonId = this.filters.technicianId;
        if (this.filters.from) params.openedFrom = this.filters.from;
        if (this.filters.to) params.openedTo = this.filters.to;
        return params;
      },
      loadView() {
        if (!this.app.authenticated) return Promise.resolve(false);
        if (this.view === 'agenda') return this.app.loadMaintenancePlans({ reset: true, filters: this.planFilterParams() });
        if (this.view === 'interventions') return this.app.loadMaintenanceInterventions({ reset: true, filters: this.interventionFilterParams() });
        if (this.view === 'incidents') return this.app.loadMaintenanceIncidents({ reset: true, filters: this.incidentFilterParams() });
        return Promise.resolve(true);
      },
      loadOverview() {
        if (!this.app.authenticated || !this.app.maintenanceAvailable) return Promise.resolve(false);
        return this.app.loadMaintenanceOverview();
      },
      scheduleReload() {
        if (!this.app.authenticated) return;
        if (this.reloadTimer) window.clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => {
          this.reloadTimer = null;
          this.loadView();
        }, 250);
      },
      loadMore() {
        if (this.view === 'agenda') return this.app.loadMoreMaintenancePlans();
        if (this.view === 'interventions') return this.app.loadMoreMaintenanceInterventions();
        if (this.view === 'incidents') return this.app.loadMoreMaintenanceIncidents();
        return Promise.resolve(false);
      },
      currentPage() {
        if (this.view === 'agenda') return this.plansPage;
        if (this.view === 'interventions') return this.interventionsPage;
        return this.incidentsPage;
      },
      hasMore() {
        const page = this.currentPage();
        return !!page && page.items.length < page.total;
      },
      loadPlanDetail(id) {
        const planId = String(id || '');
        if (!planId) return Promise.resolve(false);
        const record = (this.app.universalRecords || []).find((item) => item.target && item.target.kind === 'plan' && item.target.id === planId);
        if (record) this.filters.query = record.target.assetId;
        const known = (this.planning.plans || []).find((plan) => plan.id === planId);
        if (known) this.filters.query = known.assetId;
        this.active.planId = planId;
        if (!this.app.authenticated) return Promise.resolve(false);
        return this.app.loadMaintenancePlan(planId).then(() => {
          const plan = this.openPlan;
          if (plan) {
            this.active.planId = plan.id;
            this.active.planLabel = plan.name || plan.assetName;
          }
          return true;
        });
      },
      setView(view) {
        this.view = view;
        this.filters.query = '';
        this.filters.state = '';
      },
      clearFilters() {
        this.filters = { query: '', state: '', planStatus: '', category: '', siteId: '', type: '', priority: '', technicianId: '', from: '', to: '' };
      },
      filterByKpi(kpi) {
        this.filters.query = '';
        if (kpi.id === 'overdue') {
          this.view = 'agenda';
          this.filters.state = 'overdue';
          return;
        }
        if (kpi.id === 'soon') {
          this.view = 'agenda';
          this.filters.state = 'upcoming';
          return;
        }
        if (kpi.id === 'progress') {
          this.view = 'interventions';
          this.filters.state = 'in_progress';
          return;
        }
        this.view = 'incidents';
        this.filters.state = 'open';
      },
      openAsset(id) {
        this.app.setHash('#/activo/' + encodeURIComponent(id));
      },
      openIncident(id) {
        this.app.setHash('#/mantenimiento/incidente/' + encodeURIComponent(id));
      },
      newIntervention(assetId) {
        this.active.assetId = assetId || '';
        this.active.interventionId = '';
        this.dialogs.intervention = true;
      },
      newIncident(assetId) {
        this.active.incidentAsset = assetId || '';
        this.dialogs.incident = true;
      },
      editIntervention(item) {
        this.active.assetId = item.assetId;
        this.active.interventionId = item.id;
        this.dialogs.intervention = true;
      },
      openComplete(row) {
        this.active.planId = row.plan.id;
        this.active.assetId = row.asset.id;
        this.active.planLabel = row.asset.name + ' · ' + row.template.label;
        this.dialogs.complete = true;
      },
      openPostpone(row) {
        this.active.planId = row.plan.id;
        this.active.planLabel = row.asset.name + ' · ' + row.template.label;
        this.dialogs.postpone = true;
      },
      cancelPlan(row) {
        const plan = row.plan;
        if (!plan || !this.app.maintenanceEditable) return;
        this.app.cancelMaintenancePlan(plan.id, { notes: '' }).then((result) => {
          if (result.ok) this.app.showToast('Plan preventivo cancelado.');
          else if (result.error) this.app.showToast(result.error, 'error');
        });
      },
      incidentSaved(result) {
        this.dialogs.incident = false;
        this.active.incidentAsset = '';
        if (result && result.incident) this.openIncident(result.incident.id);
      },
      interventionSaved() {
        this.dialogs.intervention = false;
        this.active.interventionId = '';
        this.loadView();
        this.loadOverview();
      },
      async completed() {
        this.dialogs.complete = false;
        this.app.showToast('Preventivo completado.');
        await Promise.all([this.loadView(), this.loadOverview()]);
      },
      async postponed() {
        this.dialogs.postpone = false;
        this.app.showToast('Preventivo pospuesto.');
        await Promise.all([this.loadView(), this.loadOverview()]);
      },
      openAlert(id) {
        this.app.setHash('#/supervision/alerta/' + encodeURIComponent(id));
      },
      isOpenIncident(item) {
        return item.status === 'open' || item.status === 'in_progress';
      },
      interventionCost(item) {
        return item.totalCost !== null && item.totalCost !== undefined ? item.totalCost : '—';
      },
      planStatusLabel(status) {
        if (status === 'postponed') return 'Pospuesto';
        if (status === 'cancelled') return 'Cancelado';
        return 'Activo';
      },
      planStatusTone(status) {
        if (status === 'postponed') return 'warn';
        if (status === 'cancelled') return 'neutral';
        return 'ok';
      }
    },
    template: `
      <section class="page maint-page" aria-labelledby="maint-title">
        <header class="maint-head">
          <div class="maint-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Operación técnica</p>
            <h1 id="maint-title">Mantenimiento e incidentes</h1>
            <p class="page-sub">Planes preventivos, intervenciones e incidentes del parque, calculados desde el último preventivo completado.</p>
          </div>
          <div class="maint-head__actions">
            <button v-if="app.can('assets.edit')" type="button" class="btn btn--primary" data-od-id="maint-new-intervention" @click="newIntervention('')">
              <app-icon name="plus"></app-icon> Registrar intervención
            </button>
            <button v-if="app.can('assets.edit')" type="button" class="btn btn--secondary" data-od-id="maint-new-incident" @click="newIncident('')">
              <app-icon name="alert"></app-icon> Nuevo incidente
            </button>
          </div>
        </header>

        <div class="maint-kpis" data-od-id="maint-kpis">
          <button v-for="kpi in kpis" :key="kpi.id" type="button" class="maint-kpi" :class="'maint-kpi--' + kpi.tone" @click="filterByKpi(kpi)">
            <span class="maint-kpi__label">{{ kpi.label }}</span>
            <span class="maint-kpi__value mono">{{ String(kpi.value).padStart(2, '0') }}</span>
            <span class="maint-kpi__hint">{{ kpi.hint }}</span>
          </button>
        </div>

        <div class="maint-tabs" role="tablist" aria-label="Vistas de mantenimiento">
          <button type="button" class="maint-tab" :class="{ 'is-active': view === 'agenda' }" data-maint-tab="agenda" role="tab" :aria-selected="view === 'agenda'" @click="setView('agenda')">Agenda <span class="maint-tab__count mono">{{ totals.plans }}</span></button>
          <button type="button" class="maint-tab" :class="{ 'is-active': view === 'interventions' }" data-maint-tab="interventions" role="tab" :aria-selected="view === 'interventions'" @click="setView('interventions')">Intervenciones <span class="maint-tab__count mono">{{ totals.interventions }}</span></button>
          <button type="button" class="maint-tab" :class="{ 'is-active': view === 'incidents' }" data-maint-tab="incidents" role="tab" :aria-selected="view === 'incidents'" @click="setView('incidents')">Incidentes <span class="maint-tab__count mono">{{ totals.incidents }}</span></button>
          <button type="button" class="maint-tab" :class="{ 'is-active': view === 'alerts' }" data-maint-tab="alerts" role="tab" :aria-selected="view === 'alerts'" @click="setView('alerts')">Vista previa de alertas <span class="maint-tab__count mono">{{ alerts.length }}</span></button>
        </div>

        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>

        <div class="maint-toolbar" data-od-id="maint-filters">
          <div class="maint-toolbar__row">
            <label class="search-field maint-search">
              <span class="sr-only">Buscar en mantenimiento</span>
              <app-icon name="search"></app-icon>
              <input v-model="filters.query" type="search" placeholder="Buscar por activo, descripción o responsable" data-maint-filter="query">
            </label>
            <label v-if="view === 'agenda'" class="maint-filter">
              <span class="sr-only">Estado del plan</span>
              <select v-model="filters.planStatus" data-maint-filter="planStatus">
                <option value="">Todos los planes</option>
                <option value="active">Activos</option>
                <option value="postponed">Pospuestos</option>
              </select>
            </label>
            <label v-if="view === 'agenda'" class="maint-filter">
              <span class="sr-only">Vencimiento</span>
              <select v-model="filters.state" data-maint-filter="state">
                <option value="">Cualquier vencimiento</option>
                <option value="pending">Pendientes</option>
                <option value="upcoming">Próximos</option>
                <option value="overdue">Vencidos</option>
              </select>
            </label>
            <label v-if="view === 'interventions'" class="maint-filter">
              <span class="sr-only">Estado de la intervención</span>
              <select v-model="filters.state" data-maint-filter="state">
                <option value="">Todos los estados</option>
                <option value="open">Abiertas</option>
                <option value="in_progress">En curso</option>
                <option value="completed">Completadas</option>
                <option value="cancelled">Canceladas</option>
              </select>
            </label>
            <label v-if="view === 'incidents'" class="maint-filter">
              <span class="sr-only">Estado del incidente</span>
              <select v-model="filters.state" data-maint-filter="state">
                <option value="">Todos los estados</option>
                <option value="open">Abiertos</option>
                <option value="in_progress">En curso</option>
                <option value="resolved">Resueltos</option>
                <option value="closed">Cerrados</option>
              </select>
            </label>
            <label v-if="view === 'interventions'" class="maint-filter">
              <span class="sr-only">Tipo</span>
              <select v-model="filters.type" data-maint-filter="type">
                <option value="">Todos los tipos</option>
                <option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </label>
            <label v-if="view === 'incidents'" class="maint-filter">
              <span class="sr-only">Prioridad</span>
              <select v-model="filters.priority" data-maint-filter="priority">
                <option value="">Toda prioridad</option>
                <option v-for="priority in priorities" :key="priority.id" :value="priority.id">{{ priority.label }}</option>
              </select>
            </label>
            <label v-if="view !== 'alerts'" class="maint-filter">
              <span class="sr-only">Categoría</span>
              <select v-model="filters.category" data-maint-filter="category">
                <option value="">Todas las categorías</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
              </select>
            </label>
            <label v-if="view !== 'alerts'" class="maint-filter">
              <span class="sr-only">Sede</span>
              <select v-model="filters.siteId" data-maint-filter="site">
                <option value="">Todas las sedes</option>
                <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
              </select>
            </label>
            <label v-if="view === 'agenda' || view === 'interventions'" class="maint-filter">
              <span class="sr-only">Desde</span>
              <input v-model="filters.from" type="date" data-maint-filter="from">
            </label>
            <label v-if="view === 'agenda' || view === 'interventions'" class="maint-filter">
              <span class="sr-only">Hasta</span>
              <input v-model="filters.to" type="date" data-maint-filter="to">
            </label>
            <button v-if="filterCount" type="button" class="text-button text-button--quiet" @click="clearFilters">Limpiar filtros <span class="mono">{{ filterCount }}</span></button>
          </div>
        </div>

        <div v-if="view === 'agenda'" class="maint-body" data-od-id="maint-agenda" role="tabpanel">
          <div v-for="group in groups" :key="group.id" class="maint-group">
            <header class="maint-group__head">
              <h2 class="maint-group__title">{{ group.label }} <span class="mono">{{ String(group.rows.length).padStart(2, '0') }}</span></h2>
              <p>{{ group.hint }}</p>
            </header>
            <div class="maint-list maint-list--flush">
              <article v-for="row in group.rows" :key="row.plan.id" class="maint-row maint-row--plan" :data-maint-plan="row.plan.id">
                <div class="maint-row__main">
                  <button type="button" class="maint-row__name text-button" @click="openAsset(row.asset.id)">{{ row.asset.quickCode || row.asset.id }} · {{ row.asset.name }}</button>
                  <span class="maint-row__meta">
                    <span class="maint-badge" :class="'is-' + planStatusTone(row.plan.status)">{{ planStatusLabel(row.plan.status) }}</span>
                    <span>{{ row.template.label }}</span>
                    <span>cada {{ row.plan.intervalMonths }} {{ row.plan.intervalMonths === 1 ? 'mes' : 'meses' }}</span>
                    <span v-if="row.technicianId">{{ technicianLabel(row.technicianId) }}</span>
                  </span>
                </div>
                <div class="maint-row__due">
                  <strong class="mono">{{ row.dueAt ? fmtDay(row.dueAt) : 'Sin programar' }}</strong>
                  <span>{{ relLabel(row.daysUntil) }}</span>
                </div>
                <div v-if="app.can('assets.edit')" class="maint-row__actions">
                  <button type="button" class="btn btn--secondary btn--small" data-maint-action="complete" @click="openComplete(row)"><app-icon name="check"></app-icon> Completar</button>
                  <button type="button" class="btn btn--ghost btn--small" data-maint-action="postpone" @click="openPostpone(row)">Posponer</button>
                  <button v-if="row.plan.status !== 'cancelled'" type="button" class="btn btn--ghost btn--small" data-maint-action="cancel" @click="cancelPlan(row)">Cancelar</button>
                </div>
              </article>
            </div>
          </div>
          <div v-if="!groups.length && !loading && !error" class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="refresh"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button v-if="filterCount" type="button" class="text-button" @click="clearFilters">Ver toda la agenda</button>
          </div>
        </div>

        <div v-if="view === 'interventions'" class="maint-body" data-od-id="maint-interventions" role="tabpanel">
          <div class="maint-cost-strip" v-if="costs">
            <span>Coste acumulado <strong class="mono">{{ money(costs.total) }}</strong></span>
            <span class="cell-muted">{{ plural(costs.count || 0, 'intervención', 'intervenciones') }} con coste</span>
            <button type="button" class="text-button text-button--quiet" @click="app.loadMaintenanceCosts({ filters: interventionFilterParams() })">Actualizar costes</button>
          </div>
          <div class="maint-list maint-list--flush">
            <article v-for="item in interventions" :key="item.id" class="maint-row maint-row--intervention" :data-maint-intervention="item.id">
              <div class="maint-row__main">
                <span class="maint-row__type"><app-icon :name="(types.find(t => t.id === item.type) || {}).icon || 'activity'"></app-icon> {{ item.typeLabel }}</span>
                <button type="button" class="maint-row__name text-button" @click="editIntervention(item)">{{ item.title }}</button>
                <span class="maint-row__meta">
                  <button type="button" class="maint-link" @click="openAsset(item.assetId)">{{ item.assetQuickCode || item.assetId }}</button>
                  <span>{{ technicianLabel(item.technicianPersonId) }}</span>
                  <span class="mono">{{ fmtDay(item.occurredOn) }}</span>
                  <span v-if="item.attachments && item.attachments.length">{{ item.attachments.length }} adjuntos</span>
                </span>
              </div>
              <div class="maint-row__due">
                <span class="maint-status" :class="'is-' + interventionStateMeta(item.status).tone">{{ interventionStateMeta(item.status).label }}</span>
                <strong class="mono">{{ money(interventionCost(item)) }}</strong>
              </div>
              <div v-if="app.can('assets.edit')" class="maint-row__actions">
                <button type="button" class="btn btn--ghost btn--small" data-maint-action="edit" @click="editIntervention(item)">Abrir</button>
              </div>
            </article>
          </div>
          <div v-if="!interventions.length && !loading && !error" class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="activity"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button v-if="filterCount" type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <div v-if="view === 'incidents'" class="maint-body" data-od-id="maint-incidents" role="tabpanel">
          <div class="maint-list maint-list--cards">
            <article v-for="item in incidents" :key="item.id" class="maint-incident" :data-maint-incident="item.id">
              <header class="maint-incident__head">
                <span class="maint-badge" :class="'is-' + priorityMeta(item.priority).tone">{{ priorityMeta(item.priority).label }}</span>
                <span class="maint-status" :class="'is-' + incidentStateMeta(item.status).tone">{{ incidentStateMeta(item.status).label }}</span>
                <span class="mono">{{ item.id }}</span>
              </header>
              <button type="button" class="maint-incident__title text-button" data-maint-action="open" @click="openIncident(item.id)">{{ item.title }}</button>
              <p class="maint-incident__description">{{ item.description }}</p>
              <dl class="maint-incident__meta">
                <dt>Activo principal</dt><dd>{{ item.primaryAssetQuickCode || item.primaryAssetId }} · {{ item.primaryAssetName }}</dd>
                <dt>Responsable</dt><dd>{{ personLabel(item.responsiblePersonId, item.responsibleName) }}</dd>
                <dt>Apertura</dt><dd class="mono">{{ fmtDay(item.openedOn) }}</dd>
                <dt v-if="item.interventionsTotal">Intervenciones</dt><dd v-if="item.interventionsTotal" class="mono">{{ item.interventionsTotal }}</dd>
                <dt v-if="item.costs">Coste</dt><dd v-if="item.costs" class="mono">{{ money(item.costs.total) }}</dd>
              </dl>
              <footer class="maint-incident__foot">
                <button type="button" class="btn btn--ghost btn--small" @click="openIncident(item.id)">Abrir incidente</button>
              </footer>
            </article>
          </div>
          <div v-if="!incidents.length && !loading && !error" class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="alert"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button v-if="filterCount" type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <div v-if="view === 'alerts'" class="maint-body" data-od-id="maint-alerts" data-maint-alerts-demo role="tabpanel">
          <div class="maint-note maint-note--preview">
            <app-icon name="info"></app-icon>
            <p><strong>Vista previa de la próxima fase.</strong> Estas alertas son datos de demostración de supervisión y no crean ni resuelven incidentes. La conversión con un clic llegará con el motor de monitoreo real.</p>
          </div>
          <div class="maint-list maint-list--flush">
            <article v-for="alert in alerts" :key="alert.id" class="maint-row maint-row--alert" :data-maint-alert="alert.id">
              <div class="maint-row__main">
                <span class="maint-row__type"><app-icon :name="alertKindMeta(alert.kind).icon"></app-icon> {{ alertKindMeta(alert.kind).label }}</span>
                <strong class="maint-row__name">{{ alert.message }}</strong>
                <span class="maint-row__meta">
                  <span class="mono">{{ alert.id }}</span>
                  <span>{{ alert.assetId }} · {{ assetName(alert.assetId) }}</span>
                  <span v-if="alert.recoveredAt">Recuperada el {{ fmtDateTime(alert.recoveredAt) }}</span>
                </span>
              </div>
              <div class="maint-row__due">
                <span class="maint-status" :class="'is-' + alertStateMeta(alert.state).tone">{{ alertStateMeta(alert.state).label }}</span>
                <span class="mono">{{ fmtDateTime(alert.detectedAt) }}</span>
              </div>
              <div class="maint-row__actions">
                <button type="button" class="btn btn--ghost btn--small" @click="openAlert(alert.id)">Revisar en Supervisión</button>
              </div>
            </article>
          </div>
          <div v-if="!alerts.length" class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="shield"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <div v-if="view !== 'alerts'" class="maint-pager">
          <span class="cell-muted">{{ currentPage() ? currentPage().items.length : 0 }} de {{ currentPage() ? currentPage().total : 0 }}</span>
          <button v-if="view === 'agenda' && hasMore()" type="button" class="btn btn--ghost btn--small" data-maint-more="plans" :disabled="loading" @click="loadMore">
            <app-icon name="chevron-right"></app-icon> Cargar más
          </button>
          <button v-if="view === 'interventions' && hasMore()" type="button" class="btn btn--ghost btn--small" data-maint-more="interventions" :disabled="loading" @click="loadMore">
            <app-icon name="chevron-right"></app-icon> Cargar más
          </button>
          <button v-if="view === 'incidents' && hasMore()" type="button" class="btn btn--ghost btn--small" data-maint-more="incidents" :disabled="loading" @click="loadMore">
            <app-icon name="chevron-right"></app-icon> Cargar más
          </button>
        </div>

        <intervention-dialog :open="dialogs.intervention" :app="app" :asset-id="active.assetId" :intervention-id="active.interventionId" @close="dialogs.intervention = false" @saved="interventionSaved"></intervention-dialog>
        <incident-dialog :open="dialogs.incident" :app="app" :primary-asset-id="active.incidentAsset" @close="dialogs.incident = false" @saved="incidentSaved"></incident-dialog>
        <plan-complete-dialog :open="dialogs.complete" :app="app" :plan-id="active.planId" :label="active.planLabel" @close="dialogs.complete = false" @saved="completed"></plan-complete-dialog>
        <postpone-dialog :open="dialogs.postpone" :app="app" :plan-id="active.planId" :label="active.planLabel" @close="dialogs.postpone = false" @saved="postponed"></postpone-dialog>
      </section>
    `
  };

  Views.IncidentDetail = {
    name: 'IncidentDetail',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        note: '',
        actionError: '',
        dialog: false,
        busy: false,
        prepared: null
      };
    },
    computed: {
      incident() {
        const detail = this.app.maintenanceDetail;
        return (detail && detail.record) || null;
      },
      loading() {
        return !!(this.app.maintenanceDetail && this.app.maintenanceDetail.loading);
      },
      missing() {
        return !!(this.app.maintenanceDetail && this.app.maintenanceDetail.missing);
      },
      error() {
        return (this.app.maintenanceDetail && this.app.maintenanceDetail.error) || '';
      },
      preparedState() {
        const detail = this.app.maintenanceDetail;
        return this.prepared || (detail && detail.prepare) || null;
      },
      primary() {
        return this.incident ? { id: this.incident.primaryAssetId, name: this.incident.primaryAssetName, quickCode: this.incident.primaryAssetQuickCode } : null;
      },
      affected() {
        return this.incident ? (this.incident.affectedAssets || []) : [];
      },
      interventions() {
        return this.incident ? (this.incident.interventions || []) : [];
      },
      events() {
        return this.incident ? (this.incident.events || []) : [];
      },
      canEdit() {
        return this.app.can('assets.edit');
      },
      open() {
        return !!this.incident && (this.incident.status === 'open' || this.incident.status === 'in_progress');
      },
      canClose() {
        return !!this.incident && this.incident.status === 'resolved';
      }
    },
    watch: {
      'app.route.incidentId': {
        immediate: true,
        handler(id) {
          if (id && this.app.authenticated) this.app.loadMaintenanceIncident(id);
        }
      }
    },
    methods: {
      fmtDay,
      fmtDateTime,
      money,
      plural,
      incidentStateMeta,
      interventionStateMeta,
      priorityMeta,
      back() {
        this.app.setHash('#/mantenimiento');
      },
      openAsset(id) {
        this.app.setHash('#/activo/' + encodeURIComponent(id));
      },
      technicianLabel(id, fallback) {
        return Engine.personName(this.app.people, id) || fallback || 'Sin asignar';
      },
      command(action, payload) {
        if (!this.incident || this.busy) return;
        this.busy = true;
        this.actionError = '';
        const run = action === 'acknowledge' ? this.app.acknowledgeMaintenanceIncident
          : action === 'resolve' ? this.app.resolveMaintenanceIncident
            : this.app.closeMaintenanceIncident;
        run.call(this.app, this.incident.id, payload || {}).then((result) => {
          if (result && result.ok === false && result.error) this.actionError = result.error;
          else if (result && result.ok) this.note = '';
        }).finally(() => {
          this.busy = false;
        });
      },
      prepare() {
        if (!this.incident || this.busy) return;
        this.busy = true;
        this.actionError = '';
        this.app.prepareMaintenanceIncident(this.incident.id, { note: this.note }).then((result) => {
          if (!result.ok) {
            this.actionError = result.error || 'No se pudo preparar la resolución.';
            return;
          }
          this.prepared = result.prepared;
        }).finally(() => {
          this.busy = false;
        });
      },
      confirm() {
        if (!this.incident || this.busy) return;
        this.busy = true;
        this.actionError = '';
        this.app.confirmMaintenanceIncident(this.incident.id, { note: this.note }).then((result) => {
          if (!result.ok) {
            this.actionError = result.error || 'No se pudo confirmar la resolución.';
            return;
          }
          this.prepared = null;
          this.note = '';
          this.app.showToast('Resolución confirmada.');
          return this.app.loadMaintenanceIncident(this.incident.id);
        }).finally(() => {
          this.busy = false;
        });
      },
      interventionSaved() {
        this.dialog = false;
        if (this.incident) this.app.loadMaintenanceIncident(this.incident.id);
      }
    },
    template: `
      <section v-if="incident" class="page maint-page maint-incident-page" aria-labelledby="incident-title">
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <a href="#/mantenimiento" @click.prevent="back">Mantenimiento</a>
          <app-icon name="chevron-right"></app-icon>
          <span aria-current="page">{{ incident.id }}</span>
        </nav>
        <header class="maint-head maint-head--detail">
          <div class="maint-head__copy">
            <div class="eyebrow"><span class="maint-badge" :class="'is-' + priorityMeta(incident.priority).tone">{{ priorityMeta(incident.priority).label }}</span> <span class="maint-status" :class="'is-' + incidentStateMeta(incident.status).tone">{{ incidentStateMeta(incident.status).label }}</span> <span class="mono">{{ incident.id }}</span></div>
            <h1 id="incident-title">{{ incident.title }}</h1>
            <p class="page-sub">{{ incident.description }}</p>
            <dl class="maint-incident__head_meta">
              <div><dt>Activo principal</dt><dd><button type="button" class="maint-link" @click="openAsset(primary.id)">{{ primary.quickCode || primary.id }} · {{ primary.name }}</button></dd></div>
              <div><dt>Responsable</dt><dd>{{ technicianLabel(incident.responsiblePersonId, incident.responsibleName) }}</dd></div>
              <div><dt>Apertura</dt><dd class="mono">{{ fmtDay(incident.openedOn) }}</dd></div>
              <div v-if="incident.resolvedAt"><dt>Resolución</dt><dd class="mono">{{ fmtDateTime(incident.resolvedAt) }}</dd></div>
              <div v-if="incident.costs"><dt>Coste</dt><dd class="mono">{{ money(incident.costs.total) }}</dd></div>
            </dl>
          </div>
          <div class="maint-head__actions">
            <button v-if="canEdit && open" type="button" class="btn btn--primary" data-od-id="incident-new-intervention" @click="dialog = true"><app-icon name="plus"></app-icon> Registrar intervención</button>
            <button v-if="canEdit && open && incident.status === 'open'" type="button" class="btn btn--secondary" data-maint-action="acknowledge" :disabled="busy" @click="command('acknowledge')">Reconocer</button>
            <button v-if="canEdit && canClose" type="button" class="btn btn--secondary" data-maint-action="close" :disabled="busy" @click="command('close')">Cerrar incidente</button>
            <button type="button" class="btn btn--ghost" @click="back"><app-icon name="arrow-left"></app-icon> Volver</button>
          </div>
        </header>

        <div v-if="actionError || error" class="form-alert" role="alert">{{ actionError || error }}</div>

        <section v-if="canEdit && open" class="maint-panel" aria-labelledby="incident-resolution-title">
          <header class="maint-panel__head">
            <div>
              <p class="eyebrow">Cierre asistido</p>
              <h2 id="incident-resolution-title">Preparar y confirmar la resolución</h2>
            </div>
            <span class="maint-status" :class="preparedState ? 'is-warn' : 'is-neutral'">{{ preparedState ? 'Preparada' : 'Sin preparar' }}</span>
          </header>
          <p class="cell-muted">La recuperación de una señal no resuelve el incidente por sí sola. Prepara la resolución, revisa la nota y confírmala.</p>
          <label class="field">
            <span class="field__label">Nota de resolución</span>
            <textarea v-model="note" rows="3" class="input-shell input-shell--plain" placeholder="Qué se comprobó, qué se reparó y qué queda pendiente"></textarea>
          </label>
          <footer class="maint-panel__actions">
            <button type="button" class="btn btn--secondary btn--small" data-maint-action="prepare" :disabled="busy" @click="prepare">{{ preparedState ? 'Volver a preparar' : 'Preparar resolución' }}</button>
            <button v-if="preparedState" type="button" class="btn btn--primary btn--small" data-maint-action="confirm" :disabled="busy" @click="confirm">Confirmar resolución</button>
            <button v-if="!preparedState && incident.status === 'in_progress'" type="button" class="btn btn--ghost btn--small" data-maint-action="resolve" :disabled="busy" @click="command('resolve', { note: note })">Resolver sin preparación</button>
          </footer>
        </section>

        <div class="maint-detail-grid">
          <section class="maint-panel" aria-labelledby="incident-events-title">
            <header class="maint-panel__head">
              <div><p class="eyebrow">Seguimiento</p><h2 id="incident-events-title">Actuaciones</h2></div>
              <span class="mono cell-muted">{{ plural(events.length, 'registro', 'registros') }}</span>
            </header>
            <ol v-if="events.length" class="maint-timeline">
              <li v-for="event in events" :key="event.id" class="maint-timeline__item">
                <span class="maint-timeline__dot"></span>
                <div>
                  <strong>{{ event.label }}</strong>
                  <span class="mono cell-muted">{{ fmtDateTime(event.at) }}<template v-if="event.actor"> · {{ event.actor }}</template></span>
                  <p v-if="event.text">{{ event.text }}</p>
                </div>
              </li>
            </ol>
            <p v-else class="cell-muted maint-aside-note">Todavía no hay actuaciones registradas.</p>
          </section>

          <section class="maint-panel" aria-labelledby="incident-assets-title">
            <header class="maint-panel__head"><div><p class="eyebrow">Alcance</p><h2 id="incident-assets-title">Dispositivos</h2></div></header>
            <ul class="maint-mini-list">
              <li class="maint-mini-list__item">
                <span class="maint-mini-list__icon"><app-icon name="alert"></app-icon></span>
                <div>
                  <strong>{{ primary.quickCode || primary.id }} · {{ primary.name }}</strong>
                  <span class="maint-mini-list__meta">Activo principal</span>
                </div>
              </li>
              <li v-for="asset in affected" :key="asset.id" class="maint-mini-list__item">
                <span class="maint-mini-list__icon"><app-icon name="activity"></app-icon></span>
                <div>
                  <button type="button" class="maint-link maint-mini-list__title" @click="openAsset(asset.id)">{{ asset.quickCode || asset.id }} · {{ asset.name }}</button>
                  <span class="maint-mini-list__meta">Afectado</span>
                </div>
              </li>
            </ul>
            <p v-if="!affected.length" class="cell-muted maint-aside-note">Sin otros dispositivos afectados.</p>
          </section>

          <section class="maint-panel maint-panel--wide" aria-labelledby="incident-interventions-title">
            <header class="maint-panel__head">
              <div><p class="eyebrow">Reparaciones</p><h2 id="incident-interventions-title">Intervenciones vinculadas</h2></div>
              <span class="mono cell-muted">{{ interventions.length }}</span>
            </header>
            <div v-if="interventions.length" class="maint-list maint-list--flush">
              <article v-for="item in interventions" :key="item.id" class="maint-row maint-row--intervention">
                <div class="maint-row__main">
                  <strong class="maint-row__name">{{ item.title }}</strong>
                  <span class="maint-row__meta"><span>{{ technicianLabel(item.technicianPersonId, item.technicianName) }}</span><span class="mono">{{ fmtDay(item.occurredOn) }}</span><span>{{ interventionStateMeta(item.status).label }}</span></span>
                </div>
                <div class="maint-row__due"><strong class="mono">{{ money(item.totalCost) }}</strong></div>
              </article>
            </div>
            <p v-else class="cell-muted maint-aside-note">Todavía no hay intervenciones vinculadas.</p>
            <p class="cell-muted maint-aside-note">La vista previa de alertas de supervisión no modifica este incidente.</p>
          </section>
        </div>

        <intervention-dialog :open="dialog" :app="app" :asset-id="incident.primaryAssetId" :preset="{ incidentId: incident.id, assetId: incident.primaryAssetId, assetName: primary ? primary.name : '', assetQuickCode: primary ? primary.quickCode : '' }" @close="dialog = false" @saved="interventionSaved"></intervention-dialog>
      </section>
      <section v-else class="page maint-page">
        <div v-if="loading" class="loading-state" role="status">Cargando incidente…</div>
        <div v-else class="empty-state">
          <h3>{{ missing ? 'Incidente no disponible' : 'Incidente' }}</h3>
          <p>{{ error || 'El incidente solicitado no existe en este prototipo.' }}</p>
          <button type="button" class="btn btn--secondary" @click="back">Volver a mantenimiento</button>
        </div>
      </section>
    `
  };
})();
