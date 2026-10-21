(function () {
  'use strict';

  const Engine = window.AssetMaintEngine;
  const Data = window.ASSET_MAINT;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function toInput(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fromInput(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  // Dates render through the shared view helpers once that module is loaded; the
  // fallback keeps the dialogs self-contained for isolated rendering.
  function fmtDay(value) {
    const helpers = window.AssetMaintViews && window.AssetMaintViews.helpers;
    if (helpers && helpers.fmtDay) return helpers.fmtDay(value);
    return value || '';
  }

  const baseProps = {
    open: { type: Boolean, default: false },
    app: { type: Object, required: true }
  };

  const Dialogs = window.AssetMaintDialogs = window.AssetMaintDialogs || {};

  Dialogs.InterventionDialog = {
    name: 'InterventionDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      mode: { type: String, default: 'create' },
      assetId: { type: String, default: '' },
      interventionId: { type: String, default: '' },
      preset: { type: Object, default: null }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: { assetId: '', type: 'preventivo', title: '', description: '', date: '', technicianId: '', state: 'planned', notes: '', partLabel: '', partQty: 1, partCost: '', attachmentName: '' },
        errors: [],
        error: ''
      };
    },
    computed: {
      isComplete() {
        return this.mode === 'complete';
      },
      maintenance() {
        return this.app.maintenance;
      },
      targets() {
        return (this.app.assets || []).filter((asset) => !asset.retired || asset.id === this.form.assetId);
      },
      types() {
        return (this.maintenance.types || []).filter((type) => !this.isComplete || type.id === this.form.type || true);
      },
      people() {
        return (this.app.people || []).filter((person) => person.active);
      },
      intervention() {
        return (this.maintenance.interventions || []).find((item) => item.id === this.interventionId) || null;
      },
      technicianName() {
        return Engine.personName(this.app.people, this.form.technicianId) || 'Sin asignar';
      },
      assetLabel() {
        const asset = (this.app.assets || []).find((item) => item.id === this.form.assetId);
        return asset ? asset.name : 'el activo';
      }
    },
    watch: {
      open(value) {
        if (value) this.reset();
      }
    },
    methods: {
      reset() {
        const ctx = this.preset || {};
        const assetId = this.assetId || (this.intervention ? this.intervention.assetId : ((this.app.assets[0] || {}).id || ''));
        const user = this.app.currentUser || {};
        this.errors = [];
        this.error = '';
        if (this.isComplete && this.intervention) {
          this.form = {
            assetId: this.intervention.assetId,
            type: this.intervention.type,
            title: this.intervention.title,
            description: this.intervention.description,
            date: toInput(this.intervention.date),
            technicianId: this.intervention.technicianId,
            state: 'done',
            notes: this.intervention.notes,
            partLabel: '',
            partQty: 1,
            partCost: '',
            attachmentName: ''
          };
          return;
        }
        this.form = {
          assetId: assetId,
          type: ctx.type || 'preventivo',
          title: ctx.title || '',
          description: ctx.description || '',
          date: toInput(null),
          technicianId: ctx.technicianId || user.personId || '',
          state: ctx.state || 'planned',
          notes: '',
          partLabel: '',
          partQty: 1,
          partCost: '',
          attachmentName: ''
        };
      },
      fieldError(name) {
        return this.errors.some((message) => message.toLowerCase().indexOf(name) !== -1);
      },
      partsPayload() {
        if (!this.form.partLabel.trim()) return [];
        return [{
          label: this.form.partLabel.trim(),
          qty: Number(this.form.partQty) || 1,
          cost: Number(this.form.partCost) || 0
        }];
      },
      attachmentsPayload() {
        const name = this.form.attachmentName.trim();
        return name ? [{ name: name, size: '—', kind: 'adjunto' }] : [];
      },
      close() {
        this.$emit('close');
      },
      save() {
        const ctx = {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador',
          actorId: (this.app.currentUser && this.app.currentUser.personId) || '',
          people: this.app.people
        };
        this.errors = [];
        this.error = '';
        let result;
        if (this.isComplete) {
          result = Engine.completeIntervention(this.maintenance, this.app.assets, this.interventionId, {
            completedAt: fromInput(this.form.date),
            notes: this.form.notes,
            parts: this.partsPayload(),
            attachments: this.attachmentsPayload()
          }, ctx);
        } else {
          result = Engine.saveIntervention(this.maintenance, this.app.assets, {
            assetId: this.form.assetId,
            type: this.form.type,
            title: this.form.title,
            description: this.form.description,
            date: fromInput(this.form.date) || new Date().toISOString(),
            technicianId: this.form.technicianId,
            state: this.form.state,
            notes: this.form.notes,
            parts: this.partsPayload(),
            attachments: this.attachmentsPayload()
          }, ctx);
        }
        if (!result.ok) {
          this.errors = result.errors;
          this.error = result.errors[0] || 'No se pudo guardar la intervención.';
          return;
        }
        this.app.showToast(this.isComplete ? 'Intervención completada.' : 'Intervención registrada.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="isComplete ? 'Completar intervención' : 'Registrar intervención'"
                   :eyebrow="isComplete ? 'Cierre de trabajo' : 'Trabajo técnico'" size="wide" @close="close">
        <div v-if="isComplete && intervention" class="maint-modal-context">
          <span class="maint-modal-context__icon"><app-icon :name="(types.find(t => t.id === form.type) || {}).icon || 'activity'"></app-icon></span>
          <div>
            <strong>{{ intervention.title }}</strong>
            <span class="mono">{{ intervention.id }} · {{ assetLabel }}</span>
          </div>
        </div>

        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>

        <div class="form-grid form-grid--two">
          <label v-if="!isComplete" class="field">
            <span class="field__label">Activo <em>*</em></span>
            <span class="select-field">
              <select v-model="form.assetId">
                <option v-for="asset in targets" :key="asset.id" :value="asset.id">{{ asset.id }} · {{ asset.name }}</option>
              </select>
            </span>
          </label>
          <label v-if="!isComplete" class="field">
            <span class="field__label">Tipo de trabajo <em>*</em></span>
            <span class="select-field">
              <select v-model="form.type">
                <option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </span>
          </label>
          <label v-if="!isComplete" class="field">
            <span class="field__label">Estado inicial</span>
            <span class="select-field">
              <select v-model="form.state">
                <option value="planned">Planificada</option>
                <option value="in_progress">En curso</option>
                <option value="done">Completada</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">{{ isComplete ? 'Fecha de cierre' : 'Fecha' }}</span>
            <input v-model="form.date" type="datetime-local" class="input-shell input-shell--plain">
          </label>
          <label class="field">
            <span class="field__label">Técnico responsable</span>
            <span class="select-field">
              <select v-model="form.technicianId">
                <option value="">Sin asignar</option>
                <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
              </select>
            </span>
          </label>
          <label v-if="!isComplete" class="field field--span">
            <span class="field__label">Asunto <em>*</em></span>
            <input v-model="form.title" type="text" maxlength="120" class="input-shell input-shell--plain" placeholder="Revisión trimestral, sustitución de disco, ajuste de firmware…">
          </label>
          <label v-if="!isComplete" class="field field--span">
            <span class="field__label">Descripción <em>*</em></span>
            <textarea v-model="form.description" rows="3" maxlength="600" class="input-shell input-shell--plain" placeholder="Qué se revisa, qué se ha encontrado y qué se ha hecho."></textarea>
          </label>
          <label class="field field--span">
            <span class="field__label">{{ isComplete ? 'Observaciones del cierre' : 'Observaciones' }}</span>
            <textarea v-model="form.notes" rows="2" maxlength="600" class="input-shell input-shell--plain" placeholder="Detalles que conviene conservar en el historial del activo."></textarea>
          </label>
        </div>

        <fieldset class="maint-fieldset">
          <legend>Repuestos y coste <span class="cell-muted">(opcional)</span></legend>
          <div class="maint-part-row">
            <label class="field">
              <span class="field__label">Repuesto</span>
              <input v-model="form.partLabel" type="text" maxlength="80" class="input-shell input-shell--plain" placeholder="Batería, disco, latiguillo…">
            </label>
            <label class="field maint-part-row__qty">
              <span class="field__label">Cantidad</span>
              <input v-model="form.partQty" type="number" min="1" max="99" class="input-shell input-shell--plain">
            </label>
            <label class="field maint-part-row__cost">
              <span class="field__label">Coste (€)</span>
              <input v-model="form.partCost" type="number" min="0" step="0.01" class="input-shell input-shell--plain" placeholder="0,00">
            </label>
          </div>
        </fieldset>

        <label class="field maint-attachment">
          <span class="field__label">Archivo adjunto <span class="cell-muted">(simulado)</span></span>
          <input v-model="form.attachmentName" type="text" maxlength="120" class="input-shell input-shell--plain" placeholder="informe-tecnico.pdf">
          <span class="field__hint">El prototipo guarda el nombre del archivo, no su contenido.</span>
        </label>

        <template #footer>
          <span class="modal-foot__note">{{ isComplete ? 'El cierre queda registrado en el historial del activo.' : 'La intervención queda vinculada a la ficha del activo.' }}</span>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" data-od-id="intervention-save" @click="save">
            <app-icon name="check"></app-icon> {{ isComplete ? 'Completar' : 'Registrar' }}
          </button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.IncidentDialog = {
    name: 'IncidentDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({
      primaryAssetId: { type: String, default: '' },
      alertId: { type: String, default: '' }
    }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: { title: '', description: '', priority: 'media', primaryAssetId: '', affectedIds: [], assigneeId: '', note: '' },
        error: ''
      };
    },
    computed: {
      maintenance() {
        return this.app.maintenance;
      },
      assets() {
        return (this.app.assets || []).filter((asset) => !asset.retired);
      },
      people() {
        return (this.app.people || []).filter((person) => person.active);
      },
      priorities() {
        return Data.PRIORITIES;
      },
      affected() {
        return this.assets.filter((asset) => asset.id !== this.form.primaryAssetId);
      },
      alert() {
        return (this.maintenance.alerts || []).find((item) => item.id === this.alertId) || null;
      },
      heading() {
        return this.alert ? 'Convertir alerta en incidente' : 'Nuevo incidente';
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        const user = this.app.currentUser || {};
        const alert = (this.maintenance.alerts || []).find((item) => item.id === this.alertId) || null;
        this.error = '';
        this.form = {
          title: alert ? alert.message : '',
          description: alert ? alert.message : '',
          priority: alert ? alert.severity : 'media',
          primaryAssetId: alert ? alert.assetId : (this.primaryAssetId || ((this.app.assets[0] || {}).id || '')),
          affectedIds: [],
          assigneeId: user.personId || '',
          note: ''
        };
      }
    },
    methods: {
      close() {
        this.$emit('close');
      },
      toggleAffected(id) {
        const index = this.form.affectedIds.indexOf(id);
        if (index === -1) this.form.affectedIds.push(id);
        else this.form.affectedIds.splice(index, 1);
      },
      save() {
        const context = {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador',
          actorId: (this.app.currentUser && this.app.currentUser.personId) || '',
          origin: 'el módulo de mantenimiento'
        };
        const payload = {
          title: this.form.title,
          description: this.form.description,
          priority: this.form.priority,
          affectedIds: this.form.affectedIds,
          assigneeId: this.form.assigneeId,
          note: this.form.note
        };
        const result = this.alert
          ? Engine.createFromAlert(this.maintenance, this.app.assets, this.alert.id, payload, context)
          : Engine.createIncident(this.maintenance, this.app.assets, Object.assign({ primaryAssetId: this.form.primaryAssetId }, payload), context);
        if (!result.ok) {
          this.error = result.errors[0];
          return;
        }
        this.app.showToast(this.alert
          ? 'Alerta convertida en ' + result.incident.id + '.'
          : 'Incidente ' + result.incident.id + ' registrado.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="heading" eyebrow="Operación técnica" size="wide" @close="close">
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <div class="form-grid form-grid--two">
          <label class="field">
            <span class="field__label">Activo principal <em>*</em></span>
            <span class="select-field">
              <select v-model="form.primaryAssetId">
                <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.id }} · {{ asset.name }}</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">Prioridad</span>
            <span class="select-field">
              <select v-model="form.priority">
                <option v-for="priority in priorities" :key="priority.id" :value="priority.id">{{ priority.label }}</option>
              </select>
            </span>
          </label>
          <label class="field field--span">
            <span class="field__label">Título <em>*</em></span>
            <input v-model="form.title" type="text" maxlength="140" class="input-shell input-shell--plain" placeholder="Pérdida de conectividad, servicio caído, equipo sin arrancar…">
          </label>
          <label class="field field--span">
            <span class="field__label">Descripción</span>
            <textarea v-model="form.description" rows="3" maxlength="800" class="input-shell input-shell--plain" placeholder="Síntoma, alcance y primeras comprobaciones."></textarea>
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

        <fieldset class="maint-fieldset">
          <legend>Otros dispositivos afectados</legend>
          <div class="maint-affected">
            <label v-for="asset in affected" :key="asset.id" class="maint-affected__item" :class="{ 'is-selected': form.affectedIds.indexOf(asset.id) !== -1 }">
              <input type="checkbox" :checked="form.affectedIds.indexOf(asset.id) !== -1" @change="toggleAffected(asset.id)">
              <span class="mono">{{ asset.id }}</span>
              <span>{{ asset.name }}</span>
            </label>
          </div>
          <span class="field__hint">{{ form.affectedIds.length }} dispositivos adicionales marcados.</span>
        </fieldset>

        <template #footer>
          <span class="modal-foot__note">El incidente aparece en el historial de cada activo afectado.</span>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" data-od-id="incident-save" @click="save">
            <app-icon name="plus"></app-icon> Abrir incidente
          </button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.PostponeDialog = {
    name: 'PostponeDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({ planId: { type: String, default: '' }, label: { type: String, default: '' } }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return { days: 7, note: '', error: '' };
    },
    computed: {
      plan() {
        return (this.app.maintenance.plans || []).find((item) => item.id === this.planId) || null;
      },
      currentDue() {
        return this.plan ? Engine.dueOf(this.plan) : '';
      },
      newDue() {
        return this.currentDue ? Engine.addDays(Engine.daysUntil(this.currentDue) < 0 ? Engine.today() : this.currentDue, this.days) : '';
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        this.days = 7;
        this.note = '';
        this.error = '';
      }
    },
    methods: {
      fmtDay,
      close() {
        this.$emit('close');
      },
      save() {
        const result = Engine.postponePlan(this.app.maintenance, this.app.assets, this.planId, Number(this.days), { note: this.note }, {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador'
        });
        if (!result.ok) {
          this.error = result.errors[0];
          return;
        }
        this.app.showToast('Preventivo aplazado hasta el ' + fmtDay(this.newDue) + '.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Posponer preventivo" eyebrow="Plan de mantenimiento" @close="close">
        <p class="maint-dialog-lead">{{ label || 'Plan preventivo' }}. El vencimiento actual es el <strong class="mono">{{ fmtDay(currentDue) }}</strong>.</p>
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <label class="field">
          <span class="field__label">Aplazar</span>
          <span class="select-field">
            <select v-model.number="days">
              <option :value="3">3 días</option>
              <option :value="7">1 semana</option>
              <option :value="14">2 semanas</option>
              <option :value="30">1 mes</option>
            </select>
          </span>
        </label>
        <label class="field">
          <span class="field__label">Motivo <span class="cell-muted">(opcional)</span></span>
          <input v-model="note" type="text" maxlength="160" class="input-shell input-shell--plain" placeholder="Ventana ocupada, pieza pendiente de recibir…">
        </label>
        <div class="maint-due-preview">
          <span>Nuevo vencimiento</span>
          <strong class="mono">{{ fmtDay(newDue) }}</strong>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" data-od-id="postpone-confirm" @click="save">Posponer</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.LinkAlertDialog = {
    name: 'LinkAlertDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({ alertId: { type: String, default: '' } }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return { incidentId: '', error: '' };
    },
    computed: {
      alert() {
        return (this.app.maintenance.alerts || []).find((item) => item.id === this.alertId) || null;
      },
      incidents() {
        return (this.app.maintenance.incidents || []).filter((item) => item.state !== 'cerrado');
      },
      asset() {
        return this.alert ? (this.app.assets || []).find((item) => item.id === this.alert.assetId) : null;
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        this.incidentId = this.alert && this.alert.incidentId ? this.alert.incidentId : ((this.incidents[0] || {}).id || '');
        this.error = '';
      }
    },
    methods: {
      close() {
        this.$emit('close');
      },
      save() {
        const result = Engine.linkAlert(this.app.maintenance, this.app.assets, this.alertId, this.incidentId, {
          actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador'
        });
        if (!result.ok) {
          this.error = result.errors[0];
          return;
        }
        this.app.showToast('Alerta vinculada a ' + this.incidentId + '.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Vincular alerta a un incidente" eyebrow="Supervisión" @close="close">
        <div v-if="alert" class="maint-alert-context">
          <span class="maint-alert-context__icon"><app-icon name="alert"></app-icon></span>
          <div>
            <strong>{{ alert.message }}</strong>
            <span class="mono">{{ alert.id }} · {{ asset ? asset.name : alert.assetId }}</span>
          </div>
        </div>
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <label class="field">
          <span class="field__label">Incidente</span>
          <span class="select-field">
            <select v-model="incidentId">
              <option v-for="incident in incidents" :key="incident.id" :value="incident.id">{{ incident.id }} · {{ incident.title }}</option>
            </select>
          </span>
        </label>
        <p class="form-note">Si la alerta ya se recuperó, el incidente mostrará la sugerencia de confirmar su resolución. Nada se cierra automáticamente.</p>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" @click="save">Vincular</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.ResolveDialog = {
    name: 'ResolveDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({ incidentId: { type: String, default: '' }, mode: { type: String, default: 'resolve' } }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return { note: '', error: '' };
    },
    computed: {
      incident() {
        return (this.app.maintenance.incidents || []).find((item) => item.id === this.incidentId) || null;
      },
      isClose() {
        return this.mode === 'close';
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        this.note = '';
        this.error = '';
      }
    },
    methods: {
      close() {
        this.$emit('close');
      },
      save() {
        const ctx = { actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador' };
        const result = this.isClose
          ? Engine.closeIncident(this.app.maintenance, this.app.assets, this.incidentId, { note: this.note }, ctx)
          : Engine.resolveIncident(this.app.maintenance, this.app.assets, this.incidentId, { note: this.note }, ctx);
        if (!result.ok) {
          this.error = result.errors[0];
          return;
        }
        this.app.showToast(this.isClose ? 'Incidente cerrado.' : 'Incidente marcado como resuelto.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" :title="isClose ? 'Cerrar incidente' : 'Confirmar resolución'"
                   :eyebrow="isClose ? 'Archivo' : 'Resolución'" @close="close">
        <p class="maint-dialog-lead">{{ isClose ? 'El incidente se archiva y deja de aparecer entre los abiertos. Su historial se conserva.' : 'Confirma que el problema está resuelto. La recuperación de la supervisión no cierra el incidente por sí sola.' }}</p>
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <label class="field">
          <span class="field__label">{{ isClose ? 'Nota de cierre' : 'Nota de resolución' }}</span>
          <textarea v-model="note" rows="3" maxlength="400" class="input-shell input-shell--plain" placeholder="Qué se hizo y cómo se verificó."></textarea>
        </label>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" @click="save">{{ isClose ? 'Cerrar incidente' : 'Confirmar resolución' }}</button>
        </template>
      </modal-shell>
    `
  };

  Dialogs.PlanDialog = {
    name: 'PlanDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: Object.assign({ assetId: { type: String, default: '' } }, baseProps),
    emits: ['close', 'saved'],
    data() {
      return {
        form: { templateId: '', intervalMonths: 6, lastCompletedAt: '', note: '', paused: false, tasksText: '' },
        error: ''
      };
    },
    computed: {
      asset() {
        return (this.app.assets || []).find((item) => item.id === this.assetId) || null;
      },
      plan() {
        return (this.app.maintenance.plans || []).find((item) => item.assetId === this.assetId) || null;
      },
      templates() {
        return this.app.maintenance.templates || [];
      },
      dueAt() {
        return this.form.lastCompletedAt ? Engine.addMonths(this.form.lastCompletedAt, Number(this.form.intervalMonths) || 6) : '';
      }
    },
    watch: {
      open(value) {
        if (!value) return;
        const plan = this.plan;
        const template = plan
          ? this.templates.find((item) => item.id === plan.templateId)
          : this.templates.find((item) => this.asset && item.category === this.asset.category);
        this.error = '';
        this.form = {
          templateId: plan ? plan.templateId : (template ? template.id : ''),
          intervalMonths: plan ? plan.intervalMonths : (template ? template.intervalMonths : 6),
          lastCompletedAt: plan ? plan.lastCompletedAt : '',
          note: plan ? plan.note : '',
          paused: plan ? plan.paused : false,
          tasksText: (plan ? plan.tasks : (template ? template.tasks : [])).join('\n')
        };
      }
    },
    methods: {
      fmtDay,
      close() {
        this.$emit('close');
      },
      onTemplate() {
        const template = this.templates.find((item) => item.id === this.form.templateId);
        if (!template) return;
        this.form.intervalMonths = template.intervalMonths;
        this.form.tasksText = template.tasks.join('\n');
      },
      save() {
        const result = Engine.savePlan(this.app.maintenance, this.app.assets, {
          assetId: this.assetId,
          templateId: this.form.templateId,
          intervalMonths: Number(this.form.intervalMonths),
          lastCompletedAt: this.form.lastCompletedAt,
          note: this.form.note,
          paused: this.form.paused,
          tasks: this.form.tasksText.split('\n')
        }, { actor: (this.app.currentUser && this.app.currentUser.name) || 'Administrador' });
        if (!result.ok) {
          this.error = result.errors[0];
          return;
        }
        this.app.showToast('Plan preventivo actualizado.');
        this.$emit('saved', result);
        this.$emit('close');
      }
    },
    template: `
      <modal-shell :open="open" title="Plan preventivo" eyebrow="Configuración del activo" size="wide" @close="close">
        <div v-if="asset" class="maint-modal-context">
          <span class="maint-modal-context__icon"><app-icon name="refresh"></app-icon></span>
          <div>
            <strong>{{ asset.name }}</strong>
            <span class="mono">{{ asset.id }} · {{ asset.type }}</span>
          </div>
        </div>
        <div v-if="error" class="form-alert" role="alert">{{ error }}</div>
        <div class="form-grid form-grid--two">
          <label class="field">
            <span class="field__label">Plantilla</span>
            <span class="select-field">
              <select v-model="form.templateId" @change="onTemplate">
                <option value="">Sin plantilla</option>
                <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.label }}</option>
              </select>
            </span>
          </label>
          <label class="field">
            <span class="field__label">Intervalo (meses)</span>
            <input v-model.number="form.intervalMonths" type="number" min="1" max="60" class="input-shell input-shell--plain">
          </label>
          <label class="field">
            <span class="field__label">Último preventivo completado</span>
            <input v-model="form.lastCompletedAt" type="date" class="input-shell input-shell--plain">
          </label>
          <div class="field">
            <span class="field__label">Próximo vencimiento</span>
            <span class="maint-due-preview maint-due-preview--inline">
              <strong class="mono">{{ dueAt ? fmtDay(dueAt) : 'Sin programar' }}</strong>
            </span>
          </div>
          <label class="field field--span">
            <span class="field__label">Tareas del plan <span class="cell-muted">(una por línea)</span></span>
            <textarea v-model="form.tasksText" rows="5" class="input-shell input-shell--plain"></textarea>
          </label>
          <label class="field field--span">
            <span class="field__label">Excepción del dispositivo</span>
            <input v-model="form.note" type="text" maxlength="400" class="input-shell input-shell--plain" placeholder="Particularidades que no aplican al resto de la categoría.">
          </label>
          <label class="maint-switch field--span">
            <input v-model="form.paused" type="checkbox">
            <span><strong>Pausar el plan</strong><small>El activo deja de aparecer en la agenda hasta reactivarlo.</small></span>
          </label>
        </div>
        <template #footer>
          <span class="modal-foot__note">Los cambios no alteran la plantilla de la categoría.</span>
          <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn--primary" @click="save">Guardar plan</button>
        </template>
      </modal-shell>
    `
  };
})();
