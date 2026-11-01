(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }

  const Engine = window.AssetMaintEngine;
  const Data = window.ASSET_MAINT;
  const helpers = window.AssetMaintViews ? window.AssetMaintViews.helpers : {};

  const Panels = window.AssetMaintPanels = window.AssetMaintPanels || {};

  function fmtDay(value) {
    return helpers.fmtDay ? helpers.fmtDay(value) : (Engine.toDay(value) || 'Sin fecha');
  }

  function money(value) {
    return helpers.money ? helpers.money(value) : (value || '—');
  }

  Panels.AssetMaintenancePanel = {
    name: 'AssetMaintenancePanel',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog,
      PlanDialog: window.AssetMaintDialogs.PlanDialog,
      PostponeDialog: window.AssetMaintDialogs.PostponeDialog,
      PlanCompleteDialog: window.AssetMaintDialogs.PlanCompleteDialog
    },
    props: {
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    data() {
      return { dialogs: { intervention: false, plan: false, postpone: false, complete: false }, planId: '', planLabel: '' };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      work() {
        const work = this.app.maintenanceAssetWork;
        return work && work.assetId === this.asset.id ? work : null;
      },
      plans() {
        return this.work ? this.work.plans.items.filter((plan) => plan.status !== 'cancelled') : [];
      },
      plan() {
        return this.plans.find((item) => item.status === 'active') || this.plans[0] || null;
      },
      schedule() {
        if (!this.plan) return null;
        return Engine.scheduleRow(this.maintenance, this.plan, this.app.assets, Engine.today());
      },
      typeMeta() {
        return this.plan ? Engine.typeMeta(this.plan.maintenanceType) : null;
      },
      interventions() {
        const items = this.work ? this.work.interventions.items : [];
        return items
          .filter((item) => item.assetId === this.asset.id)
          .slice()
          .sort((a, b) => String(b.occurredOn).localeCompare(String(a.occurredOn)));
      },
      openInterventions() {
        return this.interventions.filter((item) => item.status === 'open' || item.status === 'in_progress');
      },
      completedInterventions() {
        return this.interventions.filter((item) => item.status === 'completed');
      },
      incidents() {
        const items = this.work ? this.work.incidents.items : [];
        return items
          .filter((item) => item.primaryAssetId === this.asset.id || (item.affectedAssetIds || []).indexOf(this.asset.id) !== -1)
          .slice()
          .sort((a, b) => String(b.openedOn).localeCompare(String(a.openedOn)));
      },
      openIncidents() {
        return this.incidents.filter((item) => item.status === 'open' || item.status === 'in_progress');
      },
      history() {
        return this.work ? this.work.history.items : [];
      },
      tasks() {
        return this.plan && Array.isArray(this.plan.tasks) ? this.plan.tasks : [];
      },
      canEdit() {
        return this.app.can('assets.edit');
      },
      loading() {
        return !!(this.work && this.work.loading) || !this.app.maintenanceAvailable;
      },
      statusLabel() {
        if (!this.plan) return 'Sin plan';
        if (this.plan.status === 'postponed') return 'Pospuesto';
        const meta = this.schedule && this.schedule.statusMeta;
        return meta ? meta.label : 'Programado';
      },
      statusTone() {
        if (!this.plan) return 'neutral';
        if (this.plan.status === 'postponed') return 'warn';
        if (!this.schedule) return 'neutral';
        if (this.schedule.status === 'overdue') return 'down';
        if (this.schedule.status === 'today' || this.schedule.status === 'soon') return 'warn';
        return this.schedule.status === 'scheduled' ? 'ok' : 'neutral';
      },
      nextLabel() {
        if (!this.schedule || !this.schedule.dueAt) return 'Sin programar';
        return fmtDay(this.schedule.dueAt) + ' · ' + (helpers.relLabel ? helpers.relLabel(this.schedule.daysUntil) : '');
      }
    },
    watch: {
      'asset.id': {
        immediate: true,
        handler(id) {
          if (!id || !this.app.authenticated) return;
          const work = this.app.maintenanceAssetWork;
          if (!work || work.assetId !== id) this.app.loadAssetMaintenanceWork(id);
        }
      }
    },
    methods: {
      fmtDay,
      money,
      relLabel: helpers.relLabel,
      interventionStateMeta: helpers.interventionStateMeta,
      incidentStateMeta: helpers.incidentStateMeta,
      priorityMeta: helpers.priorityMeta,
      technicianLabel(id, fallback) {
        return Engine.personName(this.app.people, id) || fallback || 'Sin asignar';
      },
      typeIcon(item) {
        return Engine.typeMeta(item.type).icon || 'activity';
      },
      historyWhen(value) {
        return helpers.fmtDateTime ? helpers.fmtDateTime(value) : (value || 'Sin fecha');
      },
      openIncident(id) {
        this.app.setHash('#/mantenimiento/incidente/' + encodeURIComponent(id));
      },
      openComplete() {
        if (!this.plan) return;
        this.planId = this.plan.id;
        this.planLabel = this.asset.name + (this.typeMeta ? ' · ' + this.typeMeta.label : '');
        this.dialogs.complete = true;
      },
      openPostpone() {
        if (!this.plan) return;
        this.planId = this.plan.id;
        this.planLabel = this.asset.name + (this.typeMeta ? ' · ' + this.typeMeta.label : '');
        this.dialogs.postpone = true;
      },
      saved() {
        this.app.loadAssetMaintenanceWork(this.asset.id);
      }
    },
    template: `
      <section class="maint-asset-panel" aria-labelledby="maint-asset-title" data-od-id="asset-maintenance">
        <header class="panel-head maint-asset-panel__head">
          <div>
            <p class="eyebrow">Servicio</p>
            <h2 id="maint-asset-title">Mantenimiento</h2>
          </div>
          <div class="maint-asset-panel__actions">
            <span class="maint-status" :class="'is-' + statusTone">{{ statusLabel }}</span>
            <button v-if="canEdit" type="button" class="btn btn--ghost btn--small" data-od-id="asset-plan-edit" @click="dialogs.plan = true">
              <app-icon name="sliders"></app-icon> {{ plan ? 'Plan' : 'Crear plan' }}
            </button>
            <button v-if="canEdit && !asset.retired" type="button" class="btn btn--secondary btn--small" data-od-id="asset-new-intervention" @click="dialogs.intervention = true">
              <app-icon name="plus"></app-icon> Registrar intervención
            </button>
          </div>
        </header>

        <div v-if="loading && !work" class="cell-muted maint-aside-note">Cargando mantenimiento…</div>
        <div v-else-if="work && work.error" class="form-alert" role="alert">{{ work.error }}</div>

        <div v-if="plan" class="maint-plan">
          <div class="maint-plan__summary">
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Plan</span>
              <strong>{{ typeMeta ? typeMeta.label : 'Plan preventivo' }}</strong>
              <span class="maint-plan-cell__hint">Cada {{ plan.intervalMonths }} {{ plan.intervalMonths === 1 ? 'mes' : 'meses' }}</span>
            </div>
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Último preventivo</span>
              <strong class="mono">{{ plan.lastCompletedOn ? fmtDay(plan.lastCompletedOn) : 'Sin registro' }}</strong>
              <span class="maint-plan-cell__hint">{{ completedInterventions.length }} {{ completedInterventions.length === 1 ? 'completada' : 'completadas' }} en total</span>
            </div>
            <div class="maint-plan-cell maint-plan-cell--due">
              <span class="maint-plan-cell__label">Próximo vencimiento</span>
              <strong class="mono">{{ schedule && schedule.dueAt ? fmtDay(schedule.dueAt) : 'Sin programar' }}</strong>
              <span class="maint-plan-cell__hint">{{ nextLabel }}</span>
            </div>
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Responsable</span>
              <strong>{{ plan.responsiblePersonId ? technicianLabel(plan.responsiblePersonId, plan.responsibleLabel) : 'Equipo técnico' }}</strong>
              <span class="maint-plan-cell__hint">{{ openInterventions.length ? 'Trabajo abierto' : 'Sin trabajo abierto' }}</span>
            </div>
          </div>

          <div v-if="canEdit" class="maint-plan__actions">
            <button v-if="plan.status !== 'postponed' && !asset.retired" type="button" class="btn btn--secondary btn--small" data-od-id="asset-complete-preventive" @click="openComplete">
              <app-icon name="check"></app-icon> Completar preventivo
            </button>
            <button v-if="plan.status !== 'postponed' && !asset.retired" type="button" class="btn btn--ghost btn--small" @click="openPostpone">Posponer</button>
            <span v-if="plan.status === 'postponed'" class="maint-plan__paused"><app-icon name="info"></app-icon> Plan pospuesto</span>
          </div>

          <ul v-if="tasks.length" class="maint-plan__tasks">
            <li v-for="task in tasks" :key="task"><app-icon name="check"></app-icon><span>{{ task }}</span></li>
          </ul>
        </div>

        <div v-else-if="!loading" class="maint-plan maint-plan--empty">
          <div>
            <strong>Este activo no tiene plan preventivo.</strong>
            <p>Puedes crearlo desde la plantilla de su categoría y ajustar el intervalo solo para este equipo.</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="dialogs.plan = true">Crear plan</button>
        </div>

        <div class="maint-asset-panel__lists">
          <div class="maint-asset-panel__list">
            <h3>Intervenciones abiertas <span class="mono">{{ openInterventions.length }}</span></h3>
            <ul v-if="openInterventions.length" class="maint-mini-list">
              <li v-for="item in openInterventions.slice(0, 4)" :key="item.id" class="maint-mini-list__item" :data-asset-intervention="item.id">
                <span class="maint-mini-list__icon"><app-icon :name="typeIcon(item)"></app-icon></span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <span class="maint-mini-list__meta mono">{{ item.id }} · {{ fmtDay(item.occurredOn) }}</span>
                  <span class="maint-mini-list__meta">{{ technicianLabel(item.technicianPersonId, item.technicianName) }} · {{ interventionStateMeta ? interventionStateMeta(item.status).label : item.status }}</span>
                </div>
              </li>
            </ul>
            <p v-else class="cell-muted maint-aside-note">No hay trabajos técnicos abiertos.</p>
          </div>

          <div class="maint-asset-panel__list">
            <h3>Incidentes <span class="mono">{{ openIncidents.length }} abiertos</span></h3>
            <ul v-if="incidents.length" class="maint-mini-list">
              <li v-for="item in incidents.slice(0, 4)" :key="item.id" class="maint-mini-list__item" :data-asset-incident="item.id">
                <span class="maint-mini-list__icon maint-mini-list__icon--alert"><app-icon name="alert"></app-icon></span>
                <div>
                  <button type="button" class="maint-link maint-mini-list__title" @click="openIncident(item.id)">{{ item.title }}</button>
                  <span class="maint-mini-list__meta mono">{{ item.id }} · {{ priorityMeta ? priorityMeta(item.priority).label : item.priority }} · {{ incidentStateMeta ? incidentStateMeta(item.status).label : item.status }}</span>
                  <span class="maint-mini-list__meta">Abierto el {{ fmtDay(item.openedOn) }}</span>
                </div>
              </li>
            </ul>
            <p v-else class="cell-muted maint-aside-note">Sin incidentes asociados a este activo.</p>
          </div>
        </div>

        <div class="maint-asset-panel__list" data-od-id="asset-technical-history">
          <h3>Historial técnico <span class="mono">{{ history.length }}</span></h3>
          <ol v-if="history.length" class="maint-timeline maint-timeline--compact">
            <li v-for="event in history" :key="event.id" class="maint-timeline__item">
              <span class="maint-timeline__dot"></span>
              <div>
                <strong>{{ event.title }}</strong>
                <span class="mono cell-muted">{{ historyWhen(event.at) }}</span>
                <p v-if="event.detail">{{ event.detail }}</p>
              </div>
            </li>
          </ol>
          <p v-else class="cell-muted maint-aside-note">Todavía no hay historial técnico para este activo.</p>
          <button v-if="work && work.history.items.length < work.history.total" type="button" class="text-button" data-maint-history-more @click="app.loadMoreAssetTechnicalHistory()">Cargar más historial</button>
        </div>

        <intervention-dialog :open="dialogs.intervention" :app="app" :asset-id="asset.id" :preset="{ assetId: asset.id, assetName: asset.name, assetQuickCode: asset.quickCode || asset.code || '', assetCategory: asset.category }" @close="dialogs.intervention = false" @saved="saved"></intervention-dialog>
        <plan-dialog :open="dialogs.plan" :app="app" :asset-id="asset.id" :preset="{ assetId: asset.id, assetName: asset.name, assetQuickCode: asset.quickCode || asset.code || '', assetCategory: asset.category }" @close="dialogs.plan = false" @saved="saved"></plan-dialog>
        <plan-complete-dialog :open="dialogs.complete" :app="app" :plan-id="planId" :label="planLabel" @close="dialogs.complete = false" @saved="saved"></plan-complete-dialog>
        <postpone-dialog :open="dialogs.postpone" :app="app" :plan-id="planId" :label="planLabel" @close="dialogs.postpone = false" @saved="saved"></postpone-dialog>
      </section>
    `
  };

  Panels.MaintenanceSettings = {
    name: 'MaintenanceSettings',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        templateForm: null,
        templateTasks: '',
        templateError: '',
        notice: '',
        prefDraft: null,
        responsible: null,
        personQuery: '',
        personResults: [],
        personLoading: false,
        personTimer: null
      };
    },
    beforeUnmount() {
      if (this.personTimer) window.clearTimeout(this.personTimer);
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      templatesPage() {
        return this.app.maintenanceApi ? this.app.maintenanceApi.templates : null;
      },
      templates() {
        return (this.templatesPage ? this.templatesPage.items : []).slice().sort((a, b) => compareText(a.category, b.category, { sensitivity: 'variant' }));
      },
      types() {
        return this.maintenance.types || [];
      },
      categories() {
        return this.app.categories || [];
      },
      canEdit() {
        return this.app.can('config.general');
      },
      canRead() {
        return this.app.can('assets.view');
      },
      typeCounts() {
        const counts = {};
        (this.app.maintenanceInterventions || []).forEach((item) => {
          const type = Engine.typeMeta(item.type).id;
          counts[type] = (counts[type] || 0) + 1;
        });
        return counts;
      },
      prefs() {
        return this.maintenance.prefs || Data.PREFS;
      }
    },
    watch: {
      maintenance: {
        deep: true,
        handler() {
          if (!this.prefDraft) this.prefDraft = Object.assign({}, this.prefs);
        }
      }
    },
    created() {
      this.prefDraft = Object.assign({}, this.prefs);
      if (this.canRead && (!this.templatesPage || !this.templatesPage.loaded)) this.app.loadMaintenanceTemplates({ reset: true });
    },
    methods: {
      categoryLabel(id) {
        const category = this.categories.find((item) => item.id === id);
        return category ? category.label : id;
      },
      typeLabel(id) {
        return Engine.typeMeta(id).label;
      },
      responsibleName() {
        if (!this.responsible) return '';
        return this.responsible.label || this.responsible.name || this.responsible.id;
      },
      searchPeople() {
        const query = this.personQuery.trim();
        if (query.length < 2) {
          this.personResults = [];
          return;
        }
        if (this.personTimer) window.clearTimeout(this.personTimer);
        this.personTimer = window.setTimeout(async () => {
          this.personTimer = null;
          this.personLoading = true;
          try {
            this.personResults = await this.app.searchMaintenancePeople(query);
          } catch (error) {
            this.personResults = [];
          } finally {
            this.personLoading = false;
          }
        }, 250);
      },
      choosePerson(person) {
        this.responsible = person;
        this.templateForm.responsiblePersonId = person.id;
        this.personQuery = '';
        this.personResults = [];
      },
      clearPerson() {
        this.responsible = null;
        this.templateForm.responsiblePersonId = '';
        this.personQuery = '';
        this.personResults = [];
      },
      startTemplate(template) {
        this.templateError = '';
        this.personQuery = '';
        this.personResults = [];
        if (template) {
          this.templateForm = Object.assign({}, template);
          this.templateTasks = (template.tasks || []).join('\n');
          this.responsible = template.responsiblePersonId
            ? { id: template.responsiblePersonId, label: template.responsibleLabel || template.responsiblePersonId }
            : null;
        } else {
          this.templateForm = {
            id: '',
            category: (this.categories[0] || {}).id || '',
            maintenanceType: 'preventivo',
            intervalMonths: 6,
            active: true,
            responsiblePersonId: ''
          };
          this.responsible = null;
          this.templateTasks = '';
        }
      },
      cancelTemplate() {
        this.templateForm = null;
        this.templateTasks = '';
        this.templateError = '';
        this.personQuery = '';
        this.personResults = [];
        this.responsible = null;
      },
      async saveTemplate() {
        if (!this.templateForm) return;
        if (!this.templateForm.category) {
          this.templateError = 'Selecciona la categoría de la plantilla.';
          return;
        }
        if (!this.templateForm.intervalMonths || this.templateForm.intervalMonths < 1) {
          this.templateError = 'El intervalo debe ser al menos de un mes.';
          return;
        }
        const payload = {
          intervalMonths: Number(this.templateForm.intervalMonths),
          tasks: this.templateTasks.split('\n').map((line) => line.trim()).filter(Boolean),
          responsiblePersonId: this.templateForm.responsiblePersonId || null,
          active: !!this.templateForm.active
        };
        if (!this.templateForm.id) {
          payload.category = this.templateForm.category;
          payload.maintenanceType = this.templateForm.maintenanceType || 'preventivo';
        }
        const result = await this.app.saveMaintenanceTemplate(this.templateForm.id || '', payload);
        if (!result.ok) {
          this.templateError = result.error || 'No se pudo guardar la plantilla.';
          return;
        }
        this.notice = 'Plantilla guardada.';
        this.cancelTemplate();
        this.app.showToast('Plantilla preventiva guardada.');
      },
      async toggleTemplate(template) {
        const result = await this.app.saveMaintenanceTemplate(template.id, { active: !template.active });
        if (!result.ok) {
          this.templateError = result.error || 'No se pudo actualizar la plantilla.';
          return;
        }
        this.app.showToast(template.active ? 'Plantilla desactivada.' : 'Plantilla activada.');
      },
      async removeTemplate(template) {
        const result = await this.app.deleteMaintenanceTemplate(template.id);
        if (!result.ok) {
          this.templateError = result.error || 'No se pudo eliminar la plantilla.';
          this.app.showToast(this.templateError, 'error');
          return;
        }
        this.app.showToast('Plantilla eliminada.');
      },
      savePrefs() {
        this.app.maintenanceApi.prefs = Object.assign({}, this.prefDraft);
        this.app.showToast('Preferencias de mantenimiento guardadas para esta sesión.');
      },
      resetPrefs() {
        this.prefDraft = Object.assign({}, Data.PREFS);
        this.savePrefs();
      }
    },
    template: `
      <section class="config-section maint-settings" aria-labelledby="config-maint-title" data-od-id="maint-settings">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">Operación técnica</p>
            <h2 id="config-maint-title">Mantenimiento</h2>
            <p class="config-section__lead">Plantillas preventivas por categoría y preferencias de los trabajos técnicos.</p>
          </div>
          <span class="chip chip--muted">{{ templates.length }} plantillas · {{ types.length }} tipos</span>
        </header>

        <div v-if="!canRead" class="config-lock">
          <app-icon name="lock"></app-icon>
          <p>Necesitas permiso para consultar activos y su mantenimiento.</p>
        </div>
        <div v-else-if="templatesPage && templatesPage.error" class="form-alert" role="alert">{{ templatesPage.error }}</div>

        <section class="maint-settings-block" aria-labelledby="maint-templates-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-templates-title">Plantillas preventivas</h3>
              <p>Definen tareas e intervalos por categoría. Un activo puede sobrescribir su intervalo sin tocar la plantilla.</p>
            </div>
            <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" data-od-id="maint-template-new" @click="startTemplate(null)">
              <app-icon name="plus"></app-icon> Nueva plantilla
            </button>
          </header>

          <div v-if="templateError" class="form-alert" role="alert">{{ templateError }}</div>

          <div class="maint-config-table">
            <div class="maint-config-table__head">
              <span>Plantilla</span><span>Categoría</span><span>Intervalo</span><span>Estado</span><span></span>
            </div>
            <div v-for="template in templates" :key="template.id" class="maint-config-table__row" :class="{ 'is-inactive': !template.active }" :data-maint-template="template.id">
              <div class="maint-config-table__cell maint-config-table__cell--main">
                <strong>{{ template.typeLabel || typeLabel(template.maintenanceType) }}</strong>
                <span class="cell-muted">{{ (template.tasks || []).length }} tareas</span>
              </div>
              <div class="maint-config-table__cell">{{ categoryLabel(template.category) }}</div>
              <div class="maint-config-table__cell mono">{{ template.intervalMonths }} meses</div>
              <div class="maint-config-table__cell">
                <span class="maint-status" :class="template.active ? 'is-scheduled' : 'is-paused'">{{ template.active ? 'Activa' : 'Inactiva' }}</span>
              </div>
              <div class="maint-config-table__cell maint-config-table__cell--actions">
                <button v-if="canEdit" type="button" class="text-button" @click="startTemplate(template)">Editar</button>
                <button v-if="canEdit" type="button" class="text-button text-button--quiet" @click="toggleTemplate(template)">{{ template.active ? 'Desactivar' : 'Activar' }}</button>
                <button v-if="canEdit" type="button" class="text-button text-button--quiet" @click="removeTemplate(template)">Eliminar</button>
              </div>
            </div>
            <p v-if="!templates.length" class="cell-muted maint-aside-note">No hay plantillas configuradas.</p>
          </div>

          <form v-if="templateForm" class="maint-config-form" @submit.prevent="saveTemplate">
            <div class="form-grid form-grid--two">
              <label class="field">
                <span class="field__label">Tipo</span>
                <input :value="typeLabel(templateForm.maintenanceType)" type="text" class="input-shell input-shell--plain" disabled>
              </label>
              <label class="field">
                <span class="field__label">Categoría</span>
                <span class="select-field">
                  <select v-model="templateForm.category" :disabled="!!templateForm.id">
                    <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Intervalo (meses)</span>
                <input v-model.number="templateForm.intervalMonths" type="number" min="1" max="60" class="input-shell input-shell--plain">
              </label>
              <label class="field">
                <span class="field__label">Responsable</span>
                <div class="maint-picker" data-maint-picker="responsible">
                  <input v-model="personQuery" type="search" class="input-shell input-shell--plain maint-picker__search" placeholder="Buscar en el directorio" data-maint-template-field="responsible" @input="searchPeople">
                  <span v-if="responsible" class="maint-picker__value">{{ responsibleName() }}</span>
                  <span v-else class="maint-picker__value">Sin asignar</span>
                  <button v-if="responsible" type="button" class="text-button text-button--quiet" @click="clearPerson">Quitar</button>
                  <ul v-if="personResults.length" class="maint-picker__results">
                    <li v-for="person in personResults" :key="person.id">
                      <button type="button" class="maint-picker__option" @click="choosePerson(person)">{{ person.label || person.name }}</button>
                    </li>
                  </ul>
                  <span v-if="personLoading" class="cell-muted">Buscando…</span>
                </div>
              </label>
              <label class="maint-switch">
                <input v-model="templateForm.active" type="checkbox">
                <span><strong>Activa</strong><small>Se propone al crear planes nuevos.</small></span>
              </label>
              <label class="field field--span">
                <span class="field__label">Tareas <span class="cell-muted">(una por línea)</span></span>
                <textarea v-model="templateTasks" rows="5" class="input-shell input-shell--plain" data-maint-template-field="tasks"></textarea>
              </label>
            </div>
            <footer class="maint-config-form__foot">
              <button type="button" class="btn btn--ghost btn--small" @click="cancelTemplate">Cancelar</button>
              <button type="submit" class="btn btn--primary btn--small" data-od-id="maint-template-save">Guardar plantilla</button>
            </footer>
          </form>
        </section>

        <section class="maint-settings-block" aria-labelledby="maint-types-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-types-title">Tipos de intervención</h3>
              <p>Clasificación común del trabajo técnico. Los tipos son parte del contrato de la API y no se editan desde esta pantalla.</p>
            </div>
          </header>
          <div class="maint-config-table maint-config-table--types">
            <div class="maint-config-table__head"><span>Tipo</span><span>Uso</span><span>Efecto</span></div>
            <div v-for="type in types" :key="type.id" class="maint-config-table__row">
              <div class="maint-config-table__cell maint-config-table__cell--main"><strong><app-icon :name="type.icon"></app-icon> {{ type.label }}</strong><span class="cell-muted">{{ type.hint || 'Sin descripción' }}</span></div>
              <div class="maint-config-table__cell mono">{{ typeCounts[type.id] || 0 }} intervenciones</div>
              <div class="maint-config-table__cell"><span class="maint-badge" :class="type.resetsPreventive ? 'is-ok' : 'is-neutral'">{{ type.resetsPreventive ? 'Reinicia' : 'No reinicia' }}</span></div>
            </div>
          </div>
        </section>

        <section class="maint-settings-block" aria-labelledby="maint-prefs-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-prefs-title">Preferencias</h3>
              <p>Valores con los que se abre la sección de mantenimiento en esta sesión.</p>
            </div>
          </header>
          <div class="form-grid form-grid--two">
            <label class="field">
              <span class="field__label">Vista inicial</span>
              <span class="select-field">
                <select v-model="prefDraft.defaultView">
                  <option value="agenda">Agenda preventiva</option>
                  <option value="interventions">Intervenciones</option>
                  <option value="incidents">Incidentes</option>
                  <option value="alerts">Vista previa de alertas</option>
                </select>
              </span>
            </label>
            <label class="maint-switch">
              <input v-model="prefDraft.showCompleted" type="checkbox">
              <span><strong>Mostrar completados</strong><small>Incluye el trabajo cerrado en los listados por defecto.</small></span>
            </label>
          </div>
          <footer class="maint-config-form__foot">
            <button type="button" class="btn btn--ghost btn--small" @click="resetPrefs">Restaurar valores</button>
            <button type="button" class="btn btn--primary btn--small" data-od-id="maint-prefs-save" @click="savePrefs">Guardar preferencias</button>
          </footer>
        </section>
      </section>
    `
  };
})();
