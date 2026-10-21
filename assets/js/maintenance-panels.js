(function () {
  'use strict';

  const Engine = window.AssetMaintEngine;
  const Data = window.ASSET_MAINT;
  const helpers = window.AssetMaintViews.helpers;

  const Panels = window.AssetMaintPanels = window.AssetMaintPanels || {};

  Panels.AssetMaintenancePanel = {
    name: 'AssetMaintenancePanel',
    components: {
      AppIcon: window.AppIcon,
      InterventionDialog: window.AssetMaintDialogs.InterventionDialog,
      PlanDialog: window.AssetMaintDialogs.PlanDialog,
      PostponeDialog: window.AssetMaintDialogs.PostponeDialog
    },
    props: {
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    data() {
      return {
        dialogs: { intervention: false, plan: false, postpone: false }
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      plan() {
        return Engine.planFor(this.maintenance, this.asset.id);
      },
      schedule() {
        if (!this.plan) return null;
        return Engine.scheduleRow(this.maintenance, this.plan, this.app.assets, Engine.today());
      },
      template() {
        return this.plan ? Engine.meta(this.maintenance.templates, this.plan.templateId) : null;
      },
      interventions() {
        return (this.maintenance.interventions || [])
          .filter((item) => item.assetId === this.asset.id)
          .slice()
          .sort((a, b) => {
            const rank = { in_progress: 0, planned: 1, done: 2, cancelled: 3 };
            const diff = (rank[a.state] === undefined ? 9 : rank[a.state]) - (rank[b.state] === undefined ? 9 : rank[b.state]);
            if (diff) return diff;
            return String(b.date).localeCompare(String(a.date));
          });
      },
      openInterventions() {
        return this.interventions.filter((item) => item.state === 'planned' || item.state === 'in_progress');
      },
      completedInterventions() {
        return this.interventions.filter((item) => item.state === 'done');
      },
      incidents() {
        return (this.maintenance.incidents || [])
          .filter((item) => item.primaryAssetId === this.asset.id || (item.affectedIds || []).indexOf(this.asset.id) !== -1)
          .slice()
          .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
      },
      openIncidents() {
        return this.incidents.filter((item) => item.state === 'abierto' || item.state === 'en_curso');
      },
      suggestions() {
        return this.openIncidents
          .map((incident) => ({ incident: incident, alerts: Engine.suggestionsFor(this.maintenance, incident.id) }))
          .filter((entry) => entry.alerts.length);
      },
      tasks() {
        return this.plan && Array.isArray(this.plan.tasks) ? this.plan.tasks : [];
      },
      canEdit() {
        return this.app.can('assets.edit');
      },
      statusLabel() {
        if (!this.schedule) return 'Sin plan';
        const meta = this.schedule.statusMeta;
        return meta ? meta.label : 'Programado';
      },
      statusTone() {
        if (!this.schedule) return 'neutral';
        if (this.schedule.status === 'overdue') return 'down';
        if (this.schedule.status === 'today' || this.schedule.status === 'in_progress' || this.schedule.status === 'soon') return 'warn';
        if (this.schedule.status === 'scheduled') return 'ok';
        return 'neutral';
      },
      nextLabel() {
        if (!this.schedule || !this.schedule.dueAt) return 'Sin programar';
        return helpers.fmtDay(this.schedule.dueAt) + ' · ' + helpers.relLabel(this.schedule.daysUntil);
      }
    },
    methods: {
      fmtDay: helpers.fmtDay,
      fmtDateTime: helpers.fmtDateTime,
      relLabel: helpers.relLabel,
      money: helpers.money,
      interventionStateMeta: helpers.interventionStateMeta,
      incidentStateMeta: helpers.incidentStateMeta,
      priorityMeta: helpers.priorityMeta,
      typeMeta(id) {
        return Engine.meta(this.maintenance.types, id) || { label: 'Intervención', icon: 'activity', tone: 'neutral' };
      },
      technicianLabel(id) {
        return Engine.personName(this.app.people, id) || 'Sin asignar';
      },
      interventionCost(item) {
        return (item.parts || []).reduce((total, part) => total + (Number(part.cost) || 0) * (Number(part.qty) || 1), 0);
      },
      openIncident(id) {
        this.app.setHash('#/mantenimiento/incidente/' + encodeURIComponent(id));
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

        <div v-if="plan" class="maint-plan">
          <div class="maint-plan__summary">
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Plan</span>
              <strong>{{ template ? template.label : 'Plan preventivo' }}</strong>
              <span class="maint-plan-cell__hint">Cada {{ plan.intervalMonths }} {{ plan.intervalMonths === 1 ? 'mes' : 'meses' }}</span>
            </div>
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Último preventivo</span>
              <strong class="mono">{{ plan.lastCompletedAt ? fmtDay(plan.lastCompletedAt) : 'Sin registro' }}</strong>
              <span class="maint-plan-cell__hint">{{ completedInterventions.length }} {{ completedInterventions.length === 1 ? 'completada' : 'completadas' }} en total</span>
            </div>
            <div class="maint-plan-cell maint-plan-cell--due">
              <span class="maint-plan-cell__label">Próximo vencimiento</span>
              <strong class="mono">{{ schedule && schedule.dueAt ? fmtDay(schedule.dueAt) : 'Sin programar' }}</strong>
              <span class="maint-plan-cell__hint">{{ schedule && schedule.dueAt ? relLabel(schedule.daysUntil) : 'Sin programar' }}</span>
            </div>
            <div class="maint-plan-cell">
              <span class="maint-plan-cell__label">Responsable</span>
              <strong>{{ schedule && schedule.technicianId ? technicianLabel(schedule.technicianId) : 'Equipo técnico' }}</strong>
              <span class="maint-plan-cell__hint">{{ openInterventions.length ? 'Trabajo abierto' : 'Sin trabajo abierto' }}</span>
            </div>
          </div>

          <div v-if="canEdit" class="maint-plan__actions">
            <button v-if="!plan.paused && !asset.retired" type="button" class="btn btn--secondary btn--small" data-od-id="asset-complete-preventive" @click="dialogs.intervention = true">
              <app-icon name="check"></app-icon> Completar preventivo
            </button>
            <button v-if="!plan.paused && !asset.retired" type="button" class="btn btn--ghost btn--small" @click="dialogs.postpone = true">Posponer</button>
            <span v-if="plan.paused" class="maint-plan__paused"><app-icon name="info"></app-icon> Plan en pausa</span>
          </div>

          <ul v-if="tasks.length" class="maint-plan__tasks">
            <li v-for="task in tasks" :key="task">
              <app-icon name="check"></app-icon>
              <span>{{ task }}</span>
            </li>
          </ul>
          <p v-if="plan.note" class="maint-plan__note">
            <app-icon name="info"></app-icon>
            <span><strong>Excepción del dispositivo.</strong> {{ plan.note }}</span>
          </p>
        </div>

        <div v-else class="maint-plan maint-plan--empty">
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
              <li v-for="item in openInterventions.slice(0, 4)" :key="item.id" class="maint-mini-list__item">
                <span class="maint-mini-list__icon"><app-icon :name="typeMeta(item.type).icon"></app-icon></span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <span class="maint-mini-list__meta mono">{{ item.id }} · {{ fmtDay(item.date) }}</span>
                  <span class="maint-mini-list__meta">{{ technicianLabel(item.technicianId) }} · {{ interventionStateMeta(item.state).label }}</span>
                </div>
              </li>
            </ul>
            <p v-else class="cell-muted maint-aside-note">No hay trabajos técnicos abiertos.</p>
          </div>

          <div class="maint-asset-panel__list">
            <h3>Incidentes <span class="mono">{{ openIncidents.length }} abiertos</span></h3>
            <ul v-if="incidents.length" class="maint-mini-list">
              <li v-for="item in incidents.slice(0, 4)" :key="item.id" class="maint-mini-list__item">
                <span class="maint-mini-list__icon maint-mini-list__icon--alert"><app-icon name="alert"></app-icon></span>
                <div>
                  <button type="button" class="maint-link maint-mini-list__title" @click="openIncident(item.id)">{{ item.title }}</button>
                  <span class="maint-mini-list__meta mono">{{ item.id }} · {{ priorityMeta(item.priority).label }} · {{ incidentStateMeta(item.state).label }}</span>
                  <span class="maint-mini-list__meta">Abierto el {{ fmtDay(item.openedAt) }}</span>
                </div>
              </li>
            </ul>
            <p v-else class="cell-muted maint-aside-note">Sin incidentes asociados a este activo.</p>
          </div>
        </div>

        <div v-if="suggestions.length" class="maint-suggestion maint-suggestion--compact" role="status">
          <span class="maint-suggestion__icon"><app-icon name="info"></app-icon></span>
          <div class="maint-suggestion__copy">
            <strong>Recuperación detectada</strong>
            <p>La supervisión ya no reporta el problema de {{ suggestions[0].alerts.map(a => a.id).join(', ') }}. El incidente {{ suggestions[0].incident.id }} sigue abierto hasta confirmar su resolución.</p>
          </div>
          <button type="button" class="text-button" @click="openIncident(suggestions[0].incident.id)">Revisar incidente</button>
        </div>

        <intervention-dialog :open="dialogs.intervention" :app="app" :asset-id="asset.id"
                             :preset="{ type: 'preventivo', state: 'done' }"
                             @close="dialogs.intervention = false"></intervention-dialog>
        <plan-dialog :open="dialogs.plan" :app="app" :asset-id="asset.id" @close="dialogs.plan = false"></plan-dialog>
        <postpone-dialog :open="dialogs.postpone" :app="app" :plan-id="plan ? plan.id : ''"
                         :label="asset.name + (template ? ' · ' + template.label : '')"
                         @close="dialogs.postpone = false"></postpone-dialog>
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
        typeForm: null,
        typeError: '',
        prefDraft: null,
        notice: ''
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      templates() {
        return (this.maintenance.templates || []).slice().sort((a, b) => String(a.category).localeCompare(String(b.category), 'es'));
      },
      types() {
        return this.maintenance.types || [];
      },
      categories() {
        return this.app.categories || [];
      },
      people() {
        return (this.app.people || []).filter((person) => person.active);
      },
      canEdit() {
        return this.app.can('assets.edit');
      },
      planCounts() {
        const counts = {};
        (this.maintenance.plans || []).forEach((plan) => {
          counts[plan.templateId] = (counts[plan.templateId] || 0) + 1;
        });
        return counts;
      },
      typeCounts() {
        const counts = {};
        (this.maintenance.interventions || []).forEach((item) => {
          counts[item.type] = (counts[item.type] || 0) + 1;
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
    },
    methods: {
      categoryLabel(id) {
        const category = this.categories.find((item) => item.id === id);
        return category ? category.label : id;
      },
      startTemplate(template) {
        this.templateError = '';
        if (template) {
          this.templateForm = Object.assign({}, template);
          this.templateTasks = (template.tasks || []).join('\n');
        } else {
          this.templateForm = {
            id: '',
            label: '',
            category: (this.categories[0] || {}).id || '',
            intervalMonths: 6,
            active: true
          };
          this.templateTasks = '';
        }
      },
      cancelTemplate() {
        this.templateForm = null;
        this.templateTasks = '';
        this.templateError = '';
      },
      saveTemplate() {
        const result = Engine.saveTemplate(this.maintenance, {
          id: this.templateForm.id,
          label: this.templateForm.label,
          category: this.templateForm.category,
          intervalMonths: Number(this.templateForm.intervalMonths),
          active: this.templateForm.active,
          tasks: this.templateTasks.split('\n')
        });
        if (!result.ok) {
          this.templateError = result.errors[0];
          return;
        }
        this.notice = 'Plantilla guardada.';
        this.cancelTemplate();
        this.app.showToast('Plantilla preventiva guardada.');
      },
      toggleTemplate(template) {
        const result = Engine.saveTemplate(this.maintenance, {
          id: template.id,
          label: template.label,
          category: template.category,
          intervalMonths: template.intervalMonths,
          active: !template.active,
          tasks: template.tasks
        });
        if (result.ok) this.app.showToast(template.active ? 'Plantilla desactivada.' : 'Plantilla activada.');
      },
      removeTemplate(template) {
        const result = Engine.deleteTemplate(this.maintenance, template.id);
        if (!result.ok) {
          this.templateError = result.errors[0];
          this.app.showToast(result.errors[0], 'error');
          return;
        }
        this.app.showToast('Plantilla eliminada.');
      },
      restoreTemplates() {
        Engine.restoreTemplates(this.maintenance);
        this.app.showToast('Plantillas predeterminadas restauradas.');
      },
      startType(type) {
        this.typeError = '';
        this.typeForm = type
          ? Object.assign({}, type)
          : { id: '', label: '', icon: 'activity', tone: 'neutral', resetsPreventive: false, hint: '' };
      },
      cancelType() {
        this.typeForm = null;
        this.typeError = '';
      },
      saveType() {
        const result = Engine.saveType(this.maintenance, this.typeForm);
        if (!result.ok) {
          this.typeError = result.errors[0];
          return;
        }
        this.cancelType();
        this.app.showToast('Tipo de intervención guardado.');
      },
      removeType(type) {
        const result = Engine.deleteType(this.maintenance, type.id);
        if (!result.ok) {
          this.app.showToast(result.errors[0], 'error');
          return;
        }
        this.app.showToast('Tipo eliminado.');
      },
      savePrefs() {
        Engine.savePrefs(this.maintenance, {
          rangeDays: Number(this.prefDraft.rangeDays),
          showCompleted: !!this.prefDraft.showCompleted,
          defaultView: this.prefDraft.defaultView,
          defaultAssigneeId: this.prefDraft.defaultAssigneeId
        });
        this.app.showToast('Preferencias de mantenimiento guardadas.');
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
            <p class="config-section__lead">Plantillas preventivas por categoría, tipos de intervención y preferencias de los trabajos técnicos.</p>
          </div>
          <span class="chip chip--muted">{{ templates.length }} plantillas · {{ types.length }} tipos</span>
        </header>

        <div v-if="!canEdit" class="config-lock">
          <app-icon name="lock"></app-icon>
          <p>Necesitas permiso de edición de activos para modificar la configuración de mantenimiento.</p>
        </div>

        <section class="maint-settings-block" aria-labelledby="maint-templates-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-templates-title">Plantillas preventivas</h3>
              <p>Definen tareas e intervalos por categoría. Un activo puede sobrescribir su intervalo sin tocar la plantilla.</p>
            </div>
            <div class="maint-settings-block__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="restoreTemplates">Restaurar predeterminadas</button>
              <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" data-od-id="maint-template-new" @click="startTemplate(null)">
                <app-icon name="plus"></app-icon> Nueva plantilla
              </button>
            </div>
          </header>

          <div v-if="templateError" class="form-alert" role="alert">{{ templateError }}</div>

          <div class="maint-config-table">
            <div class="maint-config-table__head">
              <span>Plantilla</span><span>Categoría</span><span>Intervalo</span><span>Planes</span><span>Estado</span><span></span>
            </div>
            <div v-for="template in templates" :key="template.id" class="maint-config-table__row" :class="{ 'is-inactive': !template.active }">
              <div class="maint-config-table__cell maint-config-table__cell--main">
                <strong>{{ template.label }}</strong>
                <span class="cell-muted">{{ (template.tasks || []).length }} tareas</span>
              </div>
              <div class="maint-config-table__cell">{{ categoryLabel(template.category) }}</div>
              <div class="maint-config-table__cell mono">{{ template.intervalMonths }} meses</div>
              <div class="maint-config-table__cell mono">{{ planCounts[template.id] || 0 }}</div>
              <div class="maint-config-table__cell">
                <span class="maint-status" :class="template.active ? 'is-scheduled' : 'is-paused'">{{ template.active ? 'Activa' : 'Inactiva' }}</span>
              </div>
              <div class="maint-config-table__cell maint-config-table__cell--actions">
                <button v-if="canEdit" type="button" class="text-button" @click="startTemplate(template)">Editar</button>
                <button v-if="canEdit" type="button" class="text-button text-button--quiet" @click="toggleTemplate(template)">{{ template.active ? 'Desactivar' : 'Activar' }}</button>
                <button v-if="canEdit" type="button" class="text-button text-button--quiet" @click="removeTemplate(template)">Eliminar</button>
              </div>
            </div>
          </div>

          <form v-if="templateForm" class="maint-config-form" @submit.prevent="saveTemplate">
            <div class="form-grid form-grid--two">
              <label class="field">
                <span class="field__label">Nombre <em>*</em></span>
                <input v-model="templateForm.label" type="text" maxlength="80" class="input-shell input-shell--plain">
              </label>
              <label class="field">
                <span class="field__label">Categoría</span>
                <span class="select-field">
                  <select v-model="templateForm.category">
                    <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option>
                  </select>
                </span>
              </label>
              <label class="field">
                <span class="field__label">Intervalo (meses)</span>
                <input v-model.number="templateForm.intervalMonths" type="number" min="1" max="60" class="input-shell input-shell--plain">
              </label>
              <label class="maint-switch">
                <input v-model="templateForm.active" type="checkbox">
                <span><strong>Activa</strong><small>Se propone al crear planes nuevos.</small></span>
              </label>
              <label class="field field--span">
                <span class="field__label">Tareas <span class="cell-muted">(una por línea)</span></span>
                <textarea v-model="templateTasks" rows="5" class="input-shell input-shell--plain"></textarea>
              </label>
            </div>
            <footer class="maint-config-form__foot">
              <button type="button" class="btn btn--ghost btn--small" @click="cancelTemplate">Cancelar</button>
              <button type="submit" class="btn btn--primary btn--small">Guardar plantilla</button>
            </footer>
          </form>
        </section>

        <section class="maint-settings-block" aria-labelledby="maint-types-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-types-title">Tipos de intervención</h3>
              <p>Clasifican el trabajo técnico. Solo los tipos marcados reinician el intervalo preventivo.</p>
            </div>
            <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="startType(null)">
              <app-icon name="plus"></app-icon> Nuevo tipo
            </button>
          </header>

          <div v-if="typeError" class="form-alert" role="alert">{{ typeError }}</div>

          <div class="maint-config-table maint-config-table--types">
            <div class="maint-config-table__head">
              <span>Tipo</span><span>Uso</span><span>Intervalo</span><span></span>
            </div>
            <div v-for="type in types" :key="type.id" class="maint-config-table__row">
              <div class="maint-config-table__cell maint-config-table__cell--main">
                <strong><app-icon :name="type.icon"></app-icon> {{ type.label }}</strong>
                <span class="cell-muted">{{ type.hint || 'Sin descripción' }}</span>
              </div>
              <div class="maint-config-table__cell mono">{{ typeCounts[type.id] || 0 }} intervenciones</div>
              <div class="maint-config-table__cell">
                <span class="maint-badge" :class="type.resetsPreventive ? 'is-ok' : 'is-neutral'">{{ type.resetsPreventive ? 'Reinicia' : 'No reinicia' }}</span>
              </div>
              <div class="maint-config-table__cell maint-config-table__cell--actions">
                <button v-if="canEdit" type="button" class="text-button" @click="startType(type)">Editar</button>
                <button v-if="canEdit" type="button" class="text-button text-button--quiet" @click="removeType(type)">Eliminar</button>
              </div>
            </div>
          </div>

          <form v-if="typeForm" class="maint-config-form" @submit.prevent="saveType">
            <div class="form-grid form-grid--two">
              <label class="field">
                <span class="field__label">Nombre <em>*</em></span>
                <input v-model="typeForm.label" type="text" maxlength="60" class="input-shell input-shell--plain">
              </label>
              <label class="field">
                <span class="field__label">Descripción</span>
                <input v-model="typeForm.hint" type="text" maxlength="240" class="input-shell input-shell--plain">
              </label>
              <label class="maint-switch">
                <input v-model="typeForm.resetsPreventive" type="checkbox">
                <span><strong>Reinicia el preventivo</strong><small>Al completar una intervención de este tipo, el plan vuelve a contar desde esa fecha.</small></span>
              </label>
            </div>
            <footer class="maint-config-form__foot">
              <button type="button" class="btn btn--ghost btn--small" @click="cancelType">Cancelar</button>
              <button type="submit" class="btn btn--primary btn--small">Guardar tipo</button>
            </footer>
          </form>
        </section>

        <section class="maint-settings-block" aria-labelledby="maint-prefs-title">
          <header class="maint-settings-block__head">
            <div>
              <h3 id="maint-prefs-title">Preferencias</h3>
              <p>Valores con los que se abre la sección de mantenimiento.</p>
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
                  <option value="alerts">Alertas</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Horizonte de la agenda</span>
              <span class="select-field">
                <select v-model.number="prefDraft.rangeDays">
                  <option :value="7">7 días</option>
                  <option :value="14">14 días</option>
                  <option :value="30">30 días</option>
                  <option :value="60">60 días</option>
                  <option :value="90">90 días</option>
                </select>
              </span>
            </label>
            <label class="field">
              <span class="field__label">Responsable por defecto</span>
              <span class="select-field">
                <select v-model="prefDraft.defaultAssigneeId">
                  <option value="">Sin asignar</option>
                  <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
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
