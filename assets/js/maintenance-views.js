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
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return fmtDay(value) + ' · ' + hours + ':' + minutes;
  }

  function sameDay(value) {
    return Engine.toDay(value) === Engine.today();
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
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function priorityMeta(id) {
    return Data.PRIORITIES.find((item) => item.id === id) || Data.PRIORITIES[2];
  }

  function incidentStateMeta(id) {
    return Data.INCIDENT_STATES.find((item) => item.id === id) || Data.INCIDENT_STATES[0];
  }

  function interventionStateMeta(id) {
    return Data.INTERVENTION_STATES.find((item) => item.id === id) || Data.INTERVENTION_STATES[0];
  }

  function alertStateMeta(id) {
    return Data.ALERT_STATES.find((item) => item.id === id) || Data.ALERT_STATES[0];
  }

  function alertKindMeta(id) {
    return Data.ALERT_KINDS.find((item) => item.id === id) || Data.ALERT_KINDS[0];
  }

  const GROUPS = [
    { id: 'overdue', label: 'Vencidos', hint: 'Requieren atención inmediata' },
    { id: 'today', label: 'Vence hoy', hint: 'Dentro de la jornada' },
    { id: 'in_progress', label: 'En curso', hint: 'Trabajo abierto' },
    { id: 'soon', label: 'Próximas dos semanas', hint: 'Planifica la ventana' },
    { id: 'scheduled', label: 'Programado', hint: 'Sin urgencia' },
    { id: 'paused', label: 'En pausa', hint: 'Equipos de baja o planes pausados' }
  ];

  Views.MaintenanceCenter = {
    name: 'MaintenanceCenter',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog,
      IncidentDialog: window.AssetMaintDialogs.IncidentDialog,
      PostponeDialog: window.AssetMaintDialogs.PostponeDialog,
      LinkAlertDialog: window.AssetMaintDialogs.LinkAlertDialog
    },
    props: { app: { type: Object, required: true } },
    data() {
      const prefs = (this.app.maintenance && this.app.maintenance.prefs) || {};
      return {
        view: prefs.defaultView || 'agenda',
        filters: {
          query: '', status: 'all', category: 'all', site: 'all', technicianId: 'all',
          from: '', to: '', state: 'all', type: 'all', priority: 'all', assigneeId: 'all'
        },
        dialogs: { intervention: false, complete: false, incident: false, postpone: false, link: false },
        active: { assetId: '', interventionId: '', planId: '', planLabel: '', alertId: '', incidentAsset: '', preset: null }
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
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
      stats() {
        return Engine.stats(this.maintenance, this.assets, Engine.today());
      },
      kpis() {
        const stats = this.stats;
        return [
          { id: 'overdue', label: 'Preventivos vencidos', value: stats.overdue, hint: 'Planes fuera de fecha', tone: stats.overdue ? 'down' : 'ok', status: 'overdue' },
          { id: 'soon', label: 'Próximos 14 días', value: stats.soon, hint: 'Ventanas por reservar', tone: stats.soon ? 'warn' : 'ok', status: 'soon' },
          { id: 'progress', label: 'Trabajos en curso', value: stats.inProgress, hint: plural(stats.planned, 'planificado', 'planificados') + ' en cola', tone: 'neutral', status: 'in_progress' },
          { id: 'incidents', label: 'Incidentes abiertos', value: stats.openIncidents, hint: stats.criticalIncidents ? plural(stats.criticalIncidents, 'crítico', 'críticos') : 'Sin criticidad alta', tone: stats.criticalIncidents ? 'down' : 'neutral', status: 'all' }
        ];
      },
      agendaRows() {
        return Engine.agenda(this.maintenance, this.assets, {
          status: this.filters.status,
          category: this.filters.category,
          site: this.filters.site,
          technicianId: this.filters.technicianId,
          from: this.filters.from,
          to: this.filters.to,
          query: this.filters.query
        }, Engine.today());
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
        return (this.maintenance.interventions || [])
          .filter((item) => Engine.interventionMatches(item, this.maintenance, this.assets, this.people, {
            query: this.filters.query,
            state: this.filters.state,
            type: this.filters.type,
            category: this.filters.category,
            site: this.filters.site,
            technicianId: this.filters.technicianId,
            from: this.filters.from,
            to: this.filters.to
          }))
          .slice()
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      },
      incidents() {
        return (this.maintenance.incidents || [])
          .filter((item) => Engine.incidentMatches(item, this.assets, this.people, {
            query: this.filters.query,
            state: this.filters.state,
            priority: this.filters.priority,
            site: this.filters.site,
            assigneeId: this.filters.assigneeId
          }))
          .slice()
          .sort((a, b) => {
            const openA = a.state === 'abierto' || a.state === 'en_curso' ? 0 : 1;
            const openB = b.state === 'abierto' || b.state === 'en_curso' ? 0 : 1;
            if (openA !== openB) return openA - openB;
            const weight = priorityMeta(b.priority).weight - priorityMeta(a.priority).weight;
            if (weight) return weight;
            return String(b.openedAt).localeCompare(String(a.openedAt));
          });
      },
      alerts() {
        return (this.maintenance.alerts || [])
          .filter((item) => Engine.alertMatches(item, this.assets, {
            query: this.filters.query,
            state: this.filters.state
          }))
          .slice()
          .sort((a, b) => {
            const rank = { open: 0, recovered: 1, converted: 2, linked: 3 };
            const diff = (rank[a.state] === undefined ? 9 : rank[a.state]) - (rank[b.state] === undefined ? 9 : rank[b.state]);
            if (diff) return diff;
            return String(b.detectedAt).localeCompare(String(a.detectedAt));
          });
      },
      recoveredSuggestions() {
        return this.alerts.filter((alert) => alert.suggestion && alert.recoveredAt);
      },
      filterCount() {
        const filters = this.filters;
        let count = 0;
        ['query', 'from', 'to'].forEach((key) => { if (filters[key]) count += 1; });
        ['status', 'category', 'site', 'technicianId', 'state', 'type', 'priority', 'assigneeId'].forEach((key) => {
          if (filters[key] && filters[key] !== 'all') count += 1;
        });
        return count;
      },
      emptyMessage() {
        if (this.view === 'incidents') return 'Ningún incidente coincide con los filtros activos.';
        if (this.view === 'interventions') return 'Ninguna intervención coincide con los filtros activos.';
        if (this.view === 'alerts') return 'No hay alertas de supervisión con estos filtros.';
        return 'No hay trabajos preventivos con estos filtros.';
      }
    },
    watch: {
      view(value) {
        this.filters.state = value === 'agenda' ? 'all' : 'all';
        const prefs = Object.assign({}, this.maintenance.prefs, { defaultView: value });
        Engine.savePrefs(this.maintenance, prefs);
      }
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
        return asset ? asset.id + ' · ' + asset.name : id;
      },
      assetOf(id) {
        return Engine.assetOf(this.assets, id);
      },
      technicianLabel(id) {
        return Engine.personName(this.people, id) || 'Sin asignar';
      },
      setView(view) {
        this.view = view;
        this.filters.query = '';
        this.filters.status = 'all';
        this.filters.state = 'all';
      },
      clearFilters() {
        this.filters = {
          query: '', status: 'all', category: 'all', site: 'all', technicianId: 'all',
          from: '', to: '', state: 'all', type: 'all', priority: 'all', assigneeId: 'all'
        };
      },
      filterByKpi(kpi) {
        this.view = 'agenda';
        this.filters.status = kpi.status;
      },
      openAsset(id) {
        this.app.setHash('#/activo/' + encodeURIComponent(id));
      },
      openIncident(id) {
        this.app.setHash('#/mantenimiento/incidente/' + encodeURIComponent(id));
      },
      newIntervention(assetId) {
        this.active.assetId = assetId || ((this.assets[0] || {}).id || '');
        this.active.preset = { type: 'preventivo', state: 'planned' };
        this.dialogs.intervention = true;
      },
      newIncident(assetId) {
        this.active.incidentAsset = assetId || ((this.assets[0] || {}).id || '');
        this.dialogs.incident = true;
      },
      openComplete(row) {
        if (!row.openIntervention) {
          // A scheduled preventive without a registered job is completed from the same
          // form, prefilled from the category template, so the quick action stays quick.
          const template = row.template || Engine.templateFor(this.maintenance, row.asset.category);
          this.active.assetId = row.asset.id;
          this.active.preset = {
            type: 'preventivo',
            state: 'done',
            title: template ? template.label : 'Preventivo ' + row.asset.id,
            description: template && template.tasks.length ? 'Tareas del plan: ' + template.tasks.join(' · ') : '',
            technicianId: ''
          };
          this.dialogs.intervention = true;
          return;
        }
        this.active.assetId = row.asset.id;
        this.active.interventionId = row.openIntervention.id;
        this.dialogs.complete = true;
      },
      openPostpone(row) {
        this.active.planId = row.plan.id;
        this.active.planLabel = row.asset.name + ' · ' + (row.template ? row.template.label : 'Plan preventivo');
        this.dialogs.postpone = true;
      },
      openLink(alert) {
        this.active.alertId = alert.id;
        this.dialogs.link = true;
      },
      convertAlert(alert) {
        this.active.alertId = alert.id;
        this.active.incidentAsset = alert.assetId;
        this.dialogs.incident = true;
      },
      linkAlertFromIncident(payload) {
        if (!this.active.alertId) return;
        Engine.linkAlert(this.maintenance, this.assets, this.active.alertId, payload.incident.id, {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador'
        });
      },
      incidentSaved(result) {
        this.dialogs.incident = false;
        this.active.alertId = '';
        this.active.incidentAsset = '';
        if (result && result.incident) this.openIncident(result.incident.id);
      },
      resolveSuggestion(alert) {
        if (alert.incidentId) this.openIncident(alert.incidentId);
      },
      interventionAsset(id) {
        return Engine.assetOf(this.assets, id);
      },
      interventionCost(item) {
        return (item.parts || []).reduce((total, part) => total + (Number(part.cost) || 0) * (Number(part.qty) || 1), 0);
      },
      isOpenIncident(item) {
        return item.state === 'abierto' || item.state === 'en_curso';
      },
      isDone(item) {
        return item.state === 'done';
      }
    },
    template: `
      <section class="page maint-page" aria-labelledby="maint-title">
        <header class="maint-head">
          <div class="maint-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Operación técnica</p>
            <h1 id="maint-title">Mantenimiento e incidentes</h1>
            <p class="page-sub">Planes preventivos, intervenciones e incidentes del parque. Las fechas se calculan desde el último preventivo completado.</p>
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
          <button v-for="kpi in kpis" :key="kpi.id" type="button" class="maint-kpi"
                  :class="['maint-kpi--' + kpi.tone, { 'is-active': view === 'agenda' && filters.status === kpi.status }]"
                  @click="filterByKpi(kpi)">
            <span class="maint-kpi__label">{{ kpi.label }}</span>
            <span class="maint-kpi__value mono">{{ String(kpi.value).padStart(2, '0') }}</span>
            <span class="maint-kpi__hint">{{ kpi.hint }}</span>
            <span class="maint-kpi__icon"><app-icon :name="kpi.id === 'incidents' ? 'alert' : (kpi.id === 'progress' ? 'activity' : 'refresh')"></app-icon></span>
          </button>
        </div>

        <div class="maint-tabs" role="tablist" aria-label="Vistas de mantenimiento">
          <button type="button" role="tab" class="maint-tab" :class="{ 'is-active': view === 'agenda' }" :aria-selected="view === 'agenda'" aria-controls="maint-view-agenda" id="maint-tab-agenda" data-od-id="maint-tab-agenda" @click="setView('agenda')">
            Agenda <span class="maint-tab__count mono">{{ agendaRows.length }}</span>
          </button>
          <button type="button" role="tab" class="maint-tab" :class="{ 'is-active': view === 'interventions' }" :aria-selected="view === 'interventions'" aria-controls="maint-view-interventions" id="maint-tab-interventions" data-od-id="maint-tab-interventions" @click="setView('interventions')">
            Intervenciones <span class="maint-tab__count mono">{{ interventions.length }}</span>
          </button>
          <button type="button" role="tab" class="maint-tab" :class="{ 'is-active': view === 'incidents' }" :aria-selected="view === 'incidents'" aria-controls="maint-view-incidents" id="maint-tab-incidents" data-od-id="maint-tab-incidents" @click="setView('incidents')">
            Incidentes <span class="maint-tab__count mono">{{ incidents.length }}</span>
          </button>
          <button type="button" role="tab" class="maint-tab" :class="{ 'is-active': view === 'alerts' }" :aria-selected="view === 'alerts'" aria-controls="maint-view-alerts" id="maint-tab-alerts" data-od-id="maint-tab-alerts" @click="setView('alerts')">
            Alertas <span class="maint-tab__count mono">{{ alerts.length }}</span>
          </button>
        </div>

        <div class="maint-toolbar" data-od-id="maint-filters">
          <div class="maint-toolbar__row">
            <label class="search-field maint-search">
              <app-icon name="search"></app-icon>
              <span class="sr-only">Buscar trabajos, activos o responsables</span>
              <input v-model="filters.query" type="search" placeholder="Buscar activo, trabajo o responsable">
            </label>

            <label v-if="view === 'agenda'" class="maint-filter">
              <span class="sr-only">Estado del preventivo</span>
              <span class="select-field">
                <select v-model="filters.status">
                  <option value="all">Todos los estados</option>
                  <option value="overdue">Vencidos</option>
                  <option value="today">Vence hoy</option>
                  <option value="in_progress">En curso</option>
                  <option value="soon">Próximos</option>
                  <option value="scheduled">Programados</option>
                  <option value="paused">En pausa</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'interventions'" class="maint-filter">
              <span class="sr-only">Tipo de trabajo</span>
              <span class="select-field">
                <select v-model="filters.type">
                  <option value="all">Todos los tipos</option>
                  <option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }}</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'interventions'" class="maint-filter">
              <span class="sr-only">Estado de la intervención</span>
              <span class="select-field">
                <select v-model="filters.state">
                  <option value="all">Todos los estados</option>
                  <option value="planned">Planificadas</option>
                  <option value="in_progress">En curso</option>
                  <option value="done">Completadas</option>
                  <option value="cancelled">Canceladas</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'incidents'" class="maint-filter">
              <span class="sr-only">Prioridad</span>
              <span class="select-field">
                <select v-model="filters.priority">
                  <option value="all">Toda prioridad</option>
                  <option v-for="priority in app.maintenance && [] || []" :key="priority.id" :value="priority.id"></option>
                  <option value="critica">Crítica</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'incidents'" class="maint-filter">
              <span class="sr-only">Estado del incidente</span>
              <span class="select-field">
                <select v-model="filters.state">
                  <option value="all">Todos los estados</option>
                  <option value="abierto">Abiertos</option>
                  <option value="en_curso">En curso</option>
                  <option value="resuelto">Resueltos</option>
                  <option value="cerrado">Cerrados</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'alerts'" class="maint-filter">
              <span class="sr-only">Estado de la alerta</span>
              <span class="select-field">
                <select v-model="filters.state">
                  <option value="all">Todas las alertas</option>
                  <option value="open">Activas</option>
                  <option value="recovered">Recuperadas</option>
                  <option value="converted">Convertidas</option>
                  <option value="linked">Vinculadas</option>
                </select>
              </span>
            </label>

            <label v-if="view !== 'alerts'" class="maint-filter">
              <span class="sr-only">Categoría</span>
              <span class="select-field">
                <select v-model="filters.category">
                  <option value="all">Todas las categorías</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                </select>
              </span>
            </label>

            <label v-if="view !== 'alerts'" class="maint-filter">
              <span class="sr-only">Sede</span>
              <span class="select-field">
                <select v-model="filters.site">
                  <option value="all">Todas las sedes</option>
                  <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.label }}</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'interventions' || view === 'agenda'" class="maint-filter">
              <span class="sr-only">Responsable</span>
              <span class="select-field">
                <select v-model="filters.technicianId">
                  <option value="all">Todo el equipo</option>
                  <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
              </span>
            </label>

            <label v-if="view === 'incidents'" class="maint-filter">
              <span class="sr-only">Responsable del incidente</span>
              <span class="select-field">
                <select v-model="filters.assigneeId">
                  <option value="all">Todo el equipo</option>
                  <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
              </span>
            </label>

            <label v-if="view !== 'alerts'" class="maint-filter maint-filter--date">
              <span class="maint-filter__label">Desde</span>
              <input v-model="filters.from" type="date" class="input-shell input-shell--plain">
            </label>
            <label v-if="view !== 'alerts'" class="maint-filter maint-filter--date">
              <span class="maint-filter__label">Hasta</span>
              <input v-model="filters.to" type="date" class="input-shell input-shell--plain">
            </label>
          </div>
          <div class="maint-toolbar__row maint-toolbar__row--meta">
            <p class="maint-summary mono">{{ filterCount ? filterCount + ' filtros activos' : 'Sin filtros activos' }}</p>
            <button v-if="filterCount" type="button" class="text-button text-button--quiet" @click="clearFilters">
              <app-icon name="close"></app-icon> Limpiar filtros
            </button>
          </div>
        </div>

        <div v-if="view === 'agenda'" class="maint-body" id="maint-view-agenda" role="tabpanel" aria-labelledby="maint-tab-agenda" tabindex="0" data-od-id="maint-agenda">
          <div v-for="group in groups" :key="group.id" class="maint-group">
            <header class="maint-group__head">
              <h2 class="maint-group__title">{{ group.label }} <span class="mono">{{ String(group.rows.length).padStart(2, '0') }}</span></h2>
              <p class="maint-group__hint">{{ group.hint }}</p>
            </header>
            <div class="maint-list">
              <article v-for="row in group.rows" :key="row.planId" class="maint-row" :class="'is-' + row.status" :data-od-id="'maint-row-' + row.asset.id">
                <span class="maint-row__icon">
                  <app-icon :name="(categories.find(c => c.id === row.asset.category) || {}).icon || 'package'"></app-icon>
                </span>
                <div class="maint-row__main">
                  <button type="button" class="maint-row__name text-button" @click="openAsset(row.asset.id)">{{ row.asset.name }}</button>
                  <p class="maint-row__meta">
                    <span class="mono">{{ row.asset.id }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ row.template ? row.template.label : 'Plan preventivo' }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ app.siteLabel(row.asset.site) }}</span>
                  </p>
                  <p class="maint-row__plan">
                    <app-icon name="refresh"></app-icon>
                    Cada {{ row.plan.intervalMonths }} {{ row.plan.intervalMonths === 1 ? 'mes' : 'meses' }}
                    <template v-if="row.lastCompletedAt"> · último {{ fmtDay(row.lastCompletedAt) }}</template>
                    <template v-if="row.technicianId"> · {{ technicianLabel(row.technicianId) }}</template>
                  </p>
                </div>
                <div class="maint-row__due">
                  <span class="maint-status" :class="'is-' + row.status">{{ row.statusMeta.label }}</span>
                  <strong class="maint-due__value mono">{{ fmtDay(row.dueAt) }}</strong>
                  <span class="maint-due__rel">{{ relLabel(row.daysUntil) }}</span>
                </div>
                <div class="maint-row__actions">
                  <button v-if="app.can('assets.edit') && !row.plan.paused" type="button" class="btn btn--secondary btn--small" :data-od-id="'maint-complete-' + row.asset.id" @click="openComplete(row)">
                    <app-icon name="check"></app-icon> Completar
                  </button>
                  <button v-if="app.can('assets.edit') && !row.plan.paused" type="button" class="btn btn--ghost btn--small" @click="openPostpone(row)">Posponer</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="openAsset(row.asset.id)">Ficha</button>
                </div>
              </article>
            </div>
          </div>
          <div v-if="!groups.length" class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="refresh"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button type="button" class="text-button" @click="clearFilters">Ver toda la agenda</button>
          </div>
        </div>

        <div v-if="view === 'interventions'" class="maint-body" id="maint-view-interventions" role="tabpanel" aria-labelledby="maint-tab-interventions" tabindex="0" data-od-id="maint-interventions">
          <div v-if="interventions.length" class="maint-list maint-list--flush">
            <article v-for="item in interventions" :key="item.id" class="maint-row maint-row--intervention" :class="{ 'is-muted': isDone(item) }" :data-od-id="'maint-intervention-' + item.id">
              <span class="maint-row__icon maint-row__icon--type">
                <app-icon :name="(types.find(t => t.id === item.type) || {}).icon || 'activity'"></app-icon>
              </span>
              <div class="maint-row__main">
                <div class="maint-row__title-line">
                  <strong>{{ item.title }}</strong>
                  <span class="maint-badge" :class="'is-' + (types.find(t => t.id === item.type) || {}).tone">{{ (types.find(t => t.id === item.type) || {}).label || item.type }}</span>
                </div>
                <p class="maint-row__meta">
                  <span class="mono">{{ item.id }}</span>
                  <span aria-hidden="true">·</span>
                  <button type="button" class="maint-link" @click="openAsset(item.assetId)">{{ assetName(item.assetId) }}</button>
                  <span v-if="item.incidentId" aria-hidden="true">·</span>
                  <button v-if="item.incidentId" type="button" class="maint-link" @click="openIncident(item.incidentId)">{{ item.incidentId }}</button>
                </p>
                <p class="maint-row__plan">{{ item.description }}</p>
                <p v-if="item.notes" class="maint-row__note">{{ item.notes }}</p>
              </div>
              <div class="maint-row__due">
                <span class="maint-status" :class="'is-' + interventionStateMeta(item.state).tone">{{ interventionStateMeta(item.state).label }}</span>
                <strong class="maint-due__value mono">{{ fmtDay(item.date) }}</strong>
                <span class="maint-due__rel">{{ technicianLabel(item.technicianId) }}</span>
                <span v-if="interventionCost(item)" class="maint-due__cost mono">{{ money(interventionCost(item)) }}</span>
              </div>
              <div class="maint-row__actions">
                <button v-if="app.can('assets.edit') && item.state !== 'done' && item.state !== 'cancelled'" type="button" class="btn btn--secondary btn--small" @click="active.assetId = item.assetId; active.interventionId = item.id; dialogs.complete = true">
                  <app-icon name="check"></app-icon> Completar
                </button>
                <button type="button" class="btn btn--ghost btn--small" @click="openAsset(item.assetId)">Ver activo</button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="activity"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <div v-if="view === 'incidents'" class="maint-body" id="maint-view-incidents" role="tabpanel" aria-labelledby="maint-tab-incidents" tabindex="0" data-od-id="maint-incidents">
          <div v-if="incidents.length" class="maint-cards">
            <article v-for="item in incidents" :key="item.id" class="maint-incident" :class="['is-' + item.priority, { 'is-closed': item.state === 'cerrado' }]" :data-od-id="'maint-incident-' + item.id">
              <header class="maint-incident__head">
                <span class="maint-badge" :class="'is-' + priorityMeta(item.priority).tone">{{ priorityMeta(item.priority).label }}</span>
                <span class="maint-status" :class="'is-' + incidentStateMeta(item.state).tone">{{ incidentStateMeta(item.state).label }}</span>
              </header>
              <button type="button" class="maint-incident__title" @click="openIncident(item.id)">{{ item.title }}</button>
              <p class="maint-incident__description">{{ item.description }}</p>
              <dl class="maint-incident__meta">
                <div>
                  <dt>Activo principal</dt>
                  <dd>{{ assetName(item.primaryAssetId) }}</dd>
                </div>
                <div v-if="item.affectedIds && item.affectedIds.length">
                  <dt>Afectados</dt>
                  <dd>{{ plural(item.affectedIds.length, 'dispositivo', 'dispositivos') }}</dd>
                </div>
                <div>
                  <dt>Responsable</dt>
                  <dd>{{ technicianLabel(item.assigneeId) }}</dd>
                </div>
                <div>
                  <dt>Apertura</dt>
                  <dd class="mono">{{ fmtDay(item.openedAt) }}</dd>
                </div>
              </dl>
              <footer class="maint-incident__foot">
                <span class="mono">{{ item.id }}</span>
                <span class="maint-incident__links">{{ plural((item.interventionIds || []).length, 'intervención', 'intervenciones') }}</span>
                <button type="button" class="text-button" @click="openIncident(item.id)">Abrir incidente <app-icon name="chevron-right"></app-icon></button>
              </footer>
            </article>
          </div>
          <div v-else class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="alert"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <div v-if="view === 'alerts'" class="maint-body" id="maint-view-alerts" role="tabpanel" aria-labelledby="maint-tab-alerts" tabindex="0" data-od-id="maint-alerts">
          <div class="maint-alert-note">
            <app-icon name="info"></app-icon>
            <p>La supervisión detecta y recupera eventos. Un incidente se resuelve solo cuando alguien lo confirma: la recuperación de la conectividad no cierra nada por sí sola.</p>
          </div>
          <div v-if="alerts.length" class="maint-list maint-list--flush">
            <article v-for="alert in alerts" :key="alert.id" class="maint-alert" :class="['is-' + alert.state]" :data-od-id="'maint-alert-' + alert.id">
              <span class="maint-sev" :class="'is-' + alert.severity" :title="priorityMeta(alert.severity).label"></span>
              <div class="maint-alert__body">
                <div class="maint-row__title-line">
                  <strong>{{ alert.message }}</strong>
                  <span class="maint-status" :class="'is-' + alertStateMeta(alert.state).tone">{{ alertStateMeta(alert.state).label }}</span>
                </div>
                <p class="maint-row__meta">
                  <span class="mono">{{ alert.id }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ alertKindMeta(alert.kind).label }}</span>
                  <span aria-hidden="true">·</span>
                  <button type="button" class="maint-link" @click="openAsset(alert.assetId)">{{ assetName(alert.assetId) }}</button>
                  <span aria-hidden="true">·</span>
                  <span>Detectada el {{ fmtDateTime(alert.detectedAt) }}</span>
                  <span v-if="alert.recoveredAt" aria-hidden="true">·</span>
                  <span v-if="alert.recoveredAt">recuperada el {{ fmtDateTime(alert.recoveredAt) }}</span>
                </p>
                <p v-if="alert.suggestion && alert.recoveredAt" class="maint-alert__suggestion">
                  <app-icon name="info"></app-icon>
                  La recuperación está confirmada. Sugerencia: revisar {{ alert.incidentId }} y resolver el incidente si corresponde.
                </p>
              </div>
              <div class="maint-alert__actions">
                <button v-if="app.can('assets.edit') && alert.state !== 'converted' && alert.state !== 'linked'" type="button" class="btn btn--secondary btn--small" @click="convertAlert(alert)">Convertir en incidente</button>
                <button v-if="app.can('assets.edit') && alert.state !== 'converted' && alert.state !== 'linked'" type="button" class="btn btn--ghost btn--small" @click="openLink(alert)">Vincular</button>
                <button v-if="alert.incidentId" type="button" class="btn btn--ghost btn--small" @click="openIncident(alert.incidentId)">{{ alert.incidentId }}</button>
                <button v-if="alert.suggestion" type="button" class="text-button" @click="resolveSuggestion(alert)">Revisar resolución</button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state maint-empty">
            <span class="maint-empty__icon"><app-icon name="shield"></app-icon></span>
            <h3>{{ emptyMessage }}</h3>
            <button type="button" class="text-button" @click="clearFilters">Quitar filtros</button>
          </div>
        </div>

        <intervention-dialog :open="dialogs.intervention" :app="app" :asset-id="active.assetId"
                             :preset="active.preset || { type: 'preventivo', state: 'planned' }"
                             @close="dialogs.intervention = false; active.preset = null"
                             @saved="dialogs.intervention = false; active.preset = null"></intervention-dialog>
        <intervention-dialog :open="dialogs.complete" :app="app" mode="complete"
                             :intervention-id="active.interventionId"
                             @close="dialogs.complete = false"></intervention-dialog>
        <incident-dialog :open="dialogs.incident" :app="app" :primary-asset-id="active.incidentAsset"
                         :alert-id="active.alertId"
                         @close="dialogs.incident = false; active.alertId = ''; active.incidentAsset = ''"
                         @saved="incidentSaved"></incident-dialog>
        <postpone-dialog :open="dialogs.postpone" :app="app" :plan-id="active.planId" :label="active.planLabel"
                         @close="dialogs.postpone = false"></postpone-dialog>
        <link-alert-dialog :open="dialogs.link" :app="app" :alert-id="active.alertId"
                           @close="dialogs.link = false"></link-alert-dialog>
      </section>
    `
  };

  Views.IncidentDetail = {
    name: 'IncidentDetail',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog,
      ResolveDialog: window.AssetMaintDialogs.ResolveDialog
    },
    props: {
      app: { type: Object, required: true },
      incidentId: { type: String, default: '' }
    },
    data() {
      return {
        action: '',
        actionError: '',
        dialogs: { intervention: false, resolve: false, close: false },
        resolveMode: 'resolve'
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      incident() {
        return (this.maintenance.incidents || []).find((item) => item.id === this.incidentId) || null;
      },
      primary() {
        return this.incident ? Engine.assetOf(this.app.assets, this.incident.primaryAssetId) : null;
      },
      affected() {
        if (!this.incident) return [];
        return (this.incident.affectedIds || []).map((id) => Engine.assetOf(this.app.assets, id)).filter(Boolean);
      },
      interventions() {
        if (!this.incident) return [];
        const ids = this.incident.interventionIds || [];
        return (this.maintenance.interventions || [])
          .filter((item) => ids.indexOf(item.id) !== -1)
          .slice()
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      },
      alerts() {
        if (!this.incident) return [];
        return (this.maintenance.alerts || []).filter((item) => item.incidentId === this.incident.id);
      },
      suggestions() {
        return this.incident ? Engine.suggestionsFor(this.maintenance, this.incident.id) : [];
      },
      feed() {
        if (!this.incident) return [];
        return (this.incident.actions || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
      },
      people() {
        return (this.app.people || []).filter((person) => person.active);
      },
      isClosed() {
        return this.incident && this.incident.state === 'cerrado';
      },
      canEdit() {
        return this.app.can('assets.edit');
      }
    },
    methods: {
      fmtDay,
      fmtDateTime,
      money,
      plural,
      priorityMeta,
      incidentStateMeta,
      interventionStateMeta,
      alertStateMeta,
      alertKindMeta,
      incidentLabel() {
        return this.incident ? this.incident.id : 'Incidente';
      },
      technicianLabel(id) {
        return Engine.personName(this.app.people, id) || 'Sin asignar';
      },
      back() {
        this.app.setHash('#/mantenimiento');
      },
      openAsset(id) {
        this.app.setHash('#/activo/' + encodeURIComponent(id));
      },
      interventionCost(item) {
        return (item.parts || []).reduce((total, part) => total + (Number(part.cost) || 0) * (Number(part.qty) || 1), 0);
      },
      addAction() {
        if (!this.action.trim()) {
          this.actionError = 'Escribe la actuación realizada.';
          return;
        }
        const result = Engine.addIncidentAction(this.maintenance, this.app.assets, this.incident.id, this.action, {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador'
        });
        if (!result.ok) {
          this.actionError = result.errors[0];
          return;
        }
        this.action = '';
        this.actionError = '';
        this.app.showToast('Actuación registrada.');
      },
      openResolve(mode) {
        this.resolveMode = mode;
        this.dialogs.resolve = mode === 'resolve';
        this.dialogs.close = mode === 'close';
      }
    },
    template: `
      <section v-if="incident" class="page maint-page maint-incident-page" aria-labelledby="incident-title">
        <nav class="breadcrumbs" aria-label="Migas de pan">
          <a href="#/mantenimiento" @click.prevent="back">Mantenimiento</a>
          <app-icon name="chevron-right"></app-icon>
          <span aria-current="page">{{ incident.id }}</span>
        </nav>
        <button type="button" class="back-link" @click="back">
          <app-icon name="arrow-left"></app-icon> Volver a mantenimiento
        </button>

        <header class="maint-incident-head">
          <div class="maint-incident-head__copy">
            <div class="detail-eyebrow">
              <span class="maint-badge" :class="'is-' + priorityMeta(incident.priority).tone">{{ priorityMeta(incident.priority).label }}</span>
              <span class="maint-status" :class="'is-' + incidentStateMeta(incident.state).tone">{{ incidentStateMeta(incident.state).label }}</span>
              <span class="mono">{{ incident.id }}</span>
            </div>
            <h1 id="incident-title">{{ incident.title }}</h1>
            <p class="page-sub">{{ incident.description }}</p>
            <dl class="maint-incident-head__meta">
              <div><dt>Activo principal</dt><dd><button type="button" class="maint-link" @click="openAsset(primary.id)">{{ primary.name }}</button></dd></div>
              <div><dt>Responsable</dt><dd>{{ technicianLabel(incident.assigneeId) }}</dd></div>
              <div><dt>Apertura</dt><dd class="mono">{{ fmtDateTime(incident.openedAt) }}</dd></div>
              <div v-if="incident.resolvedAt"><dt>Resolución</dt><dd class="mono">{{ fmtDateTime(incident.resolvedAt) }}</dd></div>
            </dl>
          </div>
          <div class="maint-incident-head__actions">
            <button v-if="canEdit && !isClosed" type="button" class="btn btn--primary" data-od-id="incident-new-intervention" @click="dialogs.intervention = true">
              <app-icon name="plus"></app-icon> Registrar intervención
            </button>
            <button v-if="canEdit && incident.state !== 'resuelto' && !isClosed" type="button" class="btn btn--secondary" data-od-id="incident-resolve" @click="openResolve('resolve')">Resolver</button>
            <button v-if="canEdit && !isClosed" type="button" class="btn btn--ghost" @click="openResolve('close')">Cerrar</button>
          </div>
        </header>

        <div v-if="suggestions.length" class="maint-suggestion" role="status">
          <span class="maint-suggestion__icon"><app-icon name="info"></app-icon></span>
          <div class="maint-suggestion__copy">
            <strong>Recuperación detectada en la supervisión</strong>
            <p>{{ suggestions.map(a => a.id).join(', ') }} ya no reporta el problema desde el {{ fmtDateTime(suggestions[0].recoveredAt) }}. La resolución del incidente se confirma aparte.</p>
          </div>
          <button v-if="canEdit && !isClosed" type="button" class="btn btn--secondary btn--small" @click="openResolve('resolve')">Confirmar resolución</button>
        </div>

        <div class="maint-layout">
          <div class="maint-layout__main">
            <section class="maint-panel" aria-labelledby="incident-feed-title">
              <header class="maint-panel__head">
                <div>
                  <p class="eyebrow">Seguimiento</p>
                  <h2 id="incident-feed-title">Actuaciones</h2>
                </div>
                <span class="mono cell-muted">{{ plural(feed.length, 'registro', 'registros') }}</span>
              </header>

              <form v-if="canEdit && !isClosed" class="maint-action-form" @submit.prevent="addAction">
                <label class="field">
                  <span class="sr-only">Nueva actuación</span>
                  <textarea v-model="action" rows="2" maxlength="400" class="input-shell input-shell--plain" placeholder="Qué se comprobó, qué se hizo y qué queda pendiente."></textarea>
                </label>
                <div class="maint-action-form__foot">
                  <span v-if="actionError" class="form-error">{{ actionError }}</span>
                  <button type="submit" class="btn btn--secondary btn--small">
                    <app-icon name="plus"></app-icon> Añadir actuación
                  </button>
                </div>
              </form>

              <ol class="maint-feed">
                <li v-for="entry in feed" :key="entry.id" class="maint-feed__item">
                  <span class="maint-feed__dot" aria-hidden="true"></span>
                  <div class="maint-feed__body">
                    <div class="maint-feed__head">
                      <strong>{{ entry.actor }}</strong>
                      <span class="mono">{{ fmtDateTime(entry.at) }}</span>
                    </div>
                    <p class="maint-feed__text">{{ entry.text }}</p>
                  </div>
                </li>
              </ol>
            </section>

            <section class="maint-panel" aria-labelledby="incident-interventions-title">
              <header class="maint-panel__head">
                <div>
                  <p class="eyebrow">Trabajo técnico</p>
                  <h2 id="incident-interventions-title">Intervenciones vinculadas</h2>
                </div>
                <span class="mono cell-muted">{{ interventions.length }}</span>
              </header>
              <div v-if="interventions.length" class="maint-interventions">
                <article v-for="item in interventions" :key="item.id" class="maint-interventions__item">
                  <div class="maint-interventions__copy">
                    <div class="maint-row__title-line">
                      <strong>{{ item.title }}</strong>
                      <span class="maint-badge" :class="'is-' + (app.maintenance.types.find(t => t.id === item.type) || {}).tone">{{ (app.maintenance.types.find(t => t.id === item.type) || {}).label }}</span>
                    </div>
                    <p class="maint-row__meta">
                      <span class="mono">{{ item.id }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ fmtDay(item.date) }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ technicianLabel(item.technicianId) }}</span>
                      <template v-if="item.parts && item.parts.length">
                        <span aria-hidden="true">·</span>
                        <span>{{ item.parts.map(p => p.label).join(', ') }}</span>
                      </template>
                    </p>
                    <p v-if="item.notes" class="maint-row__note">{{ item.notes }}</p>
                  </div>
                  <div class="maint-interventions__side">
                    <span class="maint-status" :class="'is-' + interventionStateMeta(item.state).tone">{{ interventionStateMeta(item.state).label }}</span>
                    <span v-if="interventionCost(item)" class="mono maint-due__cost">{{ money(interventionCost(item)) }}</span>
                  </div>
                </article>
              </div>
              <div v-else class="maint-empty maint-empty--inline">
                <p>Todavía no hay intervenciones vinculadas a este incidente.</p>
                <button v-if="canEdit && !isClosed" type="button" class="text-button" @click="dialogs.intervention = true">Registrar la primera</button>
              </div>
            </section>
          </div>

          <aside class="maint-layout__aside">
            <section class="maint-panel" aria-labelledby="incident-assets-title">
              <header class="maint-panel__head">
                <div>
                  <p class="eyebrow">Alcance</p>
                  <h2 id="incident-assets-title">Dispositivos</h2>
                </div>
              </header>
              <article v-if="primary" class="maint-asset-card maint-asset-card--primary">
                <span class="maint-asset-card__icon"><app-icon name="alert"></app-icon></span>
                <div class="maint-asset-card__copy">
                  <span class="eyebrow">Activo principal</span>
                  <strong>{{ primary.name }}</strong>
                  <span class="mono">{{ primary.id }} · {{ primary.type }}</span>
                </div>
                <button type="button" class="icon-button" :aria-label="'Abrir ficha de ' + primary.name" @click="openAsset(primary.id)">
                  <app-icon name="chevron-right"></app-icon>
                </button>
              </article>
              <ul v-if="affected.length" class="maint-affected-list">
                <li v-for="asset in affected" :key="asset.id" class="maint-affected-list__item">
                  <span class="mono">{{ asset.id }}</span>
                  <span>{{ asset.name }}</span>
                  <button type="button" class="icon-button" :aria-label="'Abrir ficha de ' + asset.name" @click="openAsset(asset.id)">
                    <app-icon name="chevron-right"></app-icon>
                  </button>
                </li>
              </ul>
              <p v-else class="cell-muted maint-aside-note">Sin otros dispositivos afectados.</p>
            </section>

            <section class="maint-panel" aria-labelledby="incident-alerts-title">
              <header class="maint-panel__head">
                <div>
                  <p class="eyebrow">Supervisión</p>
                  <h2 id="incident-alerts-title">Alertas vinculadas</h2>
                </div>
              </header>
              <ul v-if="alerts.length" class="maint-mini-list">
                <li v-for="alert in alerts" :key="alert.id" class="maint-mini-list__item">
                  <span class="maint-sev" :class="'is-' + alert.severity"></span>
                  <div>
                    <strong>{{ alertKindMeta(alert.kind).label }}</strong>
                    <span class="maint-mini-list__meta mono">{{ alert.id }} · {{ alertStateMeta(alert.state).label }}</span>
                    <span v-if="alert.recoveredAt" class="maint-mini-list__meta">Recuperada el {{ fmtDay(alert.recoveredAt) }}</span>
                  </div>
                </li>
              </ul>
              <p v-else class="cell-muted maint-aside-note">Ninguna alerta de supervisión apunta a este incidente.</p>
            </section>
          </aside>
        </div>

        <intervention-dialog :open="dialogs.intervention" :app="app" :incident-id="incident.id" :asset-id="incident.primaryAssetId"
                             :preset="{ type: 'correctivo', state: 'planned', title: incident.title }"
                             @close="dialogs.intervention = false"></intervention-dialog>
        <resolve-dialog :open="dialogs.resolve" :app="app" :incident-id="incident.id" mode="resolve"
                        @close="dialogs.resolve = false"></resolve-dialog>
        <resolve-dialog :open="dialogs.close" :app="app" :incident-id="incident.id" mode="close"
                        @close="dialogs.close = false"></resolve-dialog>
      </section>
      <section v-else class="page maint-page">
        <div class="empty-state">
          <h1>Incidente no disponible</h1>
          <p>El incidente solicitado ya no existe en este prototipo.</p>
          <button type="button" class="btn btn--secondary" @click="back">Volver a mantenimiento</button>
        </div>
      </section>
    `
  };

  Views.helpers = { fmtDay, fmtDateTime, relLabel, money, plural, priorityMeta, incidentStateMeta, interventionStateMeta, alertStateMeta, alertKindMeta };
})();
