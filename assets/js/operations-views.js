(function () {
  'use strict';

  const Engine = window.AssetOpsEngine;
  const Data = window.AssetOpsData;
  const Schema = window.AssetSchema;

  const Views = window.AssetOpsViews = window.AssetOpsViews || {};

  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function isoDate(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return value.getFullYear() + '-' + month + '-' + day;
  }

  function dayKey(value) {
    return String(value || '').slice(0, 10);
  }

  function dayLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    const today = isoDate(new Date());
    const key = isoDate(date);
    if (key === today) return 'Hoy';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === isoDate(yesterday)) return 'Ayer';
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function timeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function kindMeta(kind) {
    return Data.KIND_META[kind] || { label: 'Evento', icon: 'history', tone: 'neutral' };
  }

  Views.AssetHistory = {
    name: 'AssetHistory',
    components: { AppIcon: window.AppIcon },
    props: {
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    data() {
      return { query: '', filter: 'all', actor: 'all', visible: 6 };
    },
    computed: {
      history() {
        return Array.isArray(this.asset.history) ? this.asset.history : [];
      },
      filters() {
        return Data.HISTORY_FILTERS;
      },
      actors() {
        return Engine.historyActors(this.history);
      },
      baseEntries() {
        return Engine.filterHistory(this.history, { query: this.query, filter: 'all', actor: this.actor });
      },
      filtered() {
        return Engine.filterHistory(this.history, { query: this.query, filter: this.filter, actor: this.actor });
      },
      visibleEntries() {
        return this.filtered.slice(0, this.visible);
      },
      groups() {
        const order = [];
        const map = {};
        this.visibleEntries.forEach((entry) => {
          const key = dayKey(entry.at);
          if (!map[key]) {
            map[key] = { id: key, label: dayLabel(entry.at), entries: [] };
            order.push(map[key]);
          }
          map[key].entries.push(entry);
        });
        return order;
      },
      hasFilters() {
        return !!this.query || this.filter !== 'all' || this.actor !== 'all';
      },
      remaining() {
        return Math.max(0, this.filtered.length - this.visible);
      }
    },
    watch: {
      query() { this.visible = 6; },
      filter() { this.visible = 6; },
      actor() { this.visible = 6; }
    },
    methods: {
      countFor(option) {
        if (!option.kinds) return this.baseEntries.length;
        return this.baseEntries.filter((entry) => option.kinds.indexOf(entry.kind) !== -1).length;
      },
      meta(kind) {
        return kindMeta(kind);
      },
      entryActor(entry) {
        return entry.actor || 'Sistema';
      },
      hasDiff(entry) {
        return Array.isArray(entry.changes) && entry.changes.length > 0;
      },
      diffValue(value) {
        return value === '' || value === undefined || value === null ? 'Sin valor' : value;
      },
      time(entry) {
        return timeLabel(entry.at);
      },
      effective(entry) {
        if (!entry.effectiveAt) return '';
        if (dayKey(entry.effectiveAt) === dayKey(entry.recordedAt || entry.at)) return '';
        return 'Efectivo ' + shortDate(entry.effectiveAt);
      },
      recorded(entry) {
        if (!entry.recordedAt) return '';
        if (dayKey(entry.recordedAt) === dayKey(entry.at)) return '';
        return 'Registrado ' + shortDate(entry.recordedAt);
      },
      reset() {
        this.query = '';
        this.filter = 'all';
        this.actor = 'all';
        this.visible = 6;
      },
      more() {
        this.visible += 8;
      }
    },
    template: `
      <section class="history-panel history-panel--timeline" aria-labelledby="history-title" data-od-id="asset-history">
        <header class="panel-head">
          <div>
            <p class="eyebrow">Trazabilidad</p>
            <h2 id="history-title">Historial del activo</h2>
          </div>
          <div class="history-summary">
            <span class="chip chip--muted">{{ history.length }} eventos</span>
            <span v-if="hasFilters" class="chip">{{ filtered.length }} visibles</span>
          </div>
        </header>

        <div class="history-toolbar" data-od-id="history-filters">
          <div class="search-field history-search">
            <app-icon name="search"></app-icon>
            <label class="sr-only" :for="'history-search-' + asset.id">Buscar en el historial</label>
            <input :id="'history-search-' + asset.id" v-model="query" type="search" placeholder="Buscar evento, responsable o valor" autocomplete="off">
            <button v-if="query" class="search-clear" type="button" aria-label="Borrar búsqueda" @click="query = ''">
              <app-icon name="close"></app-icon>
            </button>
          </div>
          <div class="history-chips" role="group" aria-label="Filtrar por tipo de evento">
            <button v-for="option in filters" :key="option.id" type="button" class="chip-filter"
                    :class="{ 'is-active': filter === option.id }" :aria-pressed="filter === option.id"
                    @click="filter = option.id">
              {{ option.label }}
              <span class="chip-filter__count mono">{{ countFor(option) }}</span>
            </button>
          </div>
          <div class="select-field history-actor">
            <app-icon name="user"></app-icon>
            <label class="sr-only" :for="'history-actor-' + asset.id">Filtrar por responsable</label>
            <select :id="'history-actor-' + asset.id" v-model="actor">
              <option value="all">Todo el equipo</option>
              <option v-for="name in actors" :key="name" :value="name">{{ name }}</option>
            </select>
            <app-icon name="chevron-down"></app-icon>
          </div>
        </div>

        <ol v-if="visibleEntries.length" class="timeline">
          <li v-for="group in groups" :key="group.id" class="timeline__group">
            <p class="timeline__day mono">{{ group.label }}</p>
            <ol class="timeline__list">
              <li v-for="entry in group.entries" :key="entry.id" class="timeline__item" :class="'timeline__item--' + meta(entry.kind).tone">
                <span class="timeline__mark" aria-hidden="true"><app-icon :name="meta(entry.kind).icon"></app-icon></span>
                <div class="timeline__body">
                  <div class="timeline__head">
                    <strong>{{ entry.title }}</strong>
                    <span class="timeline__kind">{{ meta(entry.kind).label }}</span>
                  </div>
                  <p v-if="entry.detail" class="timeline__detail">{{ entry.detail }}</p>
                  <dl v-if="hasDiff(entry)" class="timeline__diff">
                    <div v-for="(change, index) in entry.changes" :key="entry.id + '-change-' + index" class="timeline__diff-row">
                      <dt>{{ change.label }}</dt>
                      <dd>
                        <span class="timeline__old">{{ diffValue(change.before) }}</span>
                        <span class="timeline__arrow" aria-hidden="true">→</span>
                        <span class="timeline__new">{{ diffValue(change.after) }}</span>
                      </dd>
                    </div>
                  </dl>
                  <p class="timeline__meta">
                    <span class="timeline__actor"><app-icon name="user"></app-icon>{{ entryActor(entry) }}</span>
                    <span class="mono">{{ time(entry) }}</span>
                    <span v-if="effective(entry)" class="mono">{{ effective(entry) }}</span>
                    <span v-if="recorded(entry)" class="mono">{{ recorded(entry) }}</span>
                  </p>
                </div>
              </li>
            </ol>
          </li>
        </ol>

        <div v-else class="history-empty">
          <span class="history-empty__icon"><app-icon name="history"></app-icon></span>
          <strong>{{ history.length ? 'Ningún evento coincide con los filtros' : 'Todavía no hay eventos registrados' }}</strong>
          <p>{{ history.length ? 'Prueba con otra búsqueda, tipo de evento o responsable.' : 'Los movimientos y las ediciones aparecerán aquí con su responsable y sus valores anteriores.' }}</p>
          <button v-if="hasFilters" type="button" class="btn btn--ghost btn--small" @click="reset">Limpiar filtros</button>
        </div>

        <div v-if="remaining" class="history-foot">
          <button type="button" class="btn btn--ghost btn--small" @click="more">
            <app-icon name="chevron-down"></app-icon>
            Ver más eventos
            <span class="mono history-foot__count">{{ visibleEntries.length }} de {{ filtered.length }}</span>
          </button>
        </div>
      </section>
    `
  };

  Views.MovementDialog = {
    name: 'MovementDialog',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      type: { type: String, required: true },
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    emits: ['close', 'applied'],
    data() {
      return {
        step: 1,
        form: this.blankForm(this.type),
        errors: [],
        result: null
      };
    },
    computed: {
      definition() {
        return Data.MOVEMENTS.find((item) => item.id === this.type) || Data.MOVEMENTS[0];
      },
      context() {
        return {
          assets: this.app.assets,
          admin: this.app.assetAdmin,
          sites: this.app.sites,
          people: this.app.people,
          actor: Engine.actorOf(this.app)
        };
      },
      siteOptions() {
        return Array.isArray(this.app.sites) ? this.app.sites : [];
      },
      locationOptions() {
        const site = this.siteOptions.find((item) => item.id === this.form.site);
        return site && Array.isArray(site.locations) ? site.locations : [];
      },
      peopleOptions() {
        const people = Array.isArray(this.app.people) ? this.app.people : [];
        return people.filter((person) => person.active);
      },
      statusOptions() {
        return Engine.openStatuses(this.app.assetAdmin);
      },
      reasons() {
        if (this.type === 'transfer') return Data.TRANSFER_REASONS;
        if (this.type === 'assigned') return Data.ASSIGN_REASONS;
        if (this.type === 'returned') return Data.RETURN_REASONS;
        if (this.type === 'status') return Data.STATUS_REASONS;
        return Data.RETIRE_REASONS;
      },
      plan() {
        return Engine.planMovement(this.asset, this.buildMovement(), this.context);
      },
      dialogTitle() {
        return this.definition ? this.definition.title : 'Movimiento';
      },
      currentSite() {
        return Engine.siteLabel(this.siteOptions, this.asset.site) || 'Sin sede';
      },
      currentLocation() {
        return this.asset.location || 'Sin ubicación';
      },
      steps() {
        return [
          { id: 1, label: 'Datos', hint: 'Motivo, destino y fecha' },
          { id: 2, label: 'Revisión', hint: 'Cambios y código' },
          { id: 3, label: 'Resultado', hint: 'Registro aplicado' }
        ];
      }
    },
    watch: {
      type() {
        this.reset();
      },
      open(value) {
        if (value) this.reset();
      }
    },
    methods: {
      blankForm(type) {
        const statuses = Engine.openStatuses(this.app.assetAdmin);
        const preferred = statuses.find((status) => status.id === 'resguardo') || statuses[0];
        const nextStatus = statuses.find((status) => status.id !== this.asset.statusId) || statuses[0];
        return {
          type: type,
          site: this.asset.site || (this.app.sites[0] ? this.app.sites[0].id : ''),
          locationId: this.asset.locationId || '',
          personId: '',
          statusId: type === 'returned' ? (preferred ? preferred.id : '') : (nextStatus ? nextStatus.id : ''),
          reason: type === 'retired' ? Data.RETIRE_REASONS[0] : this.defaultReason(type),
          note: '',
          effective: isoDate(new Date()),
          ack: false
        };
      },
      defaultReason(type) {
        if (type === 'transfer') return Data.TRANSFER_REASONS[0];
        if (type === 'assigned') return Data.ASSIGN_REASONS[0];
        if (type === 'returned') return Data.RETURN_REASONS[0];
        if (type === 'status') return Data.STATUS_REASONS[0];
        return Data.RETIRE_REASONS[0];
      },
      buildMovement() {
        return {
          type: this.type,
          site: this.form.site,
          locationId: this.form.locationId,
          personId: this.form.personId,
          statusId: this.form.statusId,
          reason: this.form.reason,
          note: this.form.note,
          effective: this.form.effective,
          ack: this.form.ack
        };
      },
      reset() {
        this.step = 1;
        this.form = this.blankForm(this.type);
        this.errors = [];
        this.result = null;
      },
      validate() {
        const errors = [];
        const plan = this.plan;
        this.errors = plan.errors.slice();
        return plan.ok && !errors.length;
      },
      next() {
        if (!this.validate()) return;
        this.step = 2;
      },
      back() {
        if (this.step > 1) this.step -= 1;
      },
      apply() {
        const outcome = Engine.applyMovement(this.asset, this.buildMovement(), this.context);
        if (!outcome.ok) {
          this.errors = outcome.errors;
          this.step = 1;
          return;
        }
        this.app.persistAssets();
        this.app.persistAssignments();
        this.result = outcome;
        this.step = 3;
        this.errors = [];
        this.app.showToast(this.definition.title + ' registrado.');
        this.$emit('applied', outcome);
      },
      close() {
        this.$emit('close');
      },
      value(value) {
        return value === '' || value === undefined || value === null ? 'Sin valor' : value;
      },
      effectiveLabel() {
        return this.form.effective ? shortDate(this.form.effective + 'T12:00:00') : 'Hoy';
      }
    },
    template: `
      <modal-shell :open="open" :title="dialogTitle" eyebrow="Movimiento" size="wide" @close="close">
        <div class="flow">
          <ol class="flow-steps" aria-label="Pasos del movimiento">
            <li v-for="item in steps" :key="item.id" class="flow-step"
                :class="{ 'is-active': step === item.id, 'is-done': step > item.id }"
                :aria-current="step === item.id ? 'step' : null">
              <span class="flow-step__num">{{ step > item.id ? '✓' : item.id }}</span>
              <span class="flow-step__copy"><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></span>
            </li>
          </ol>

          <div v-if="step === 1" class="flow-body">
            <div class="flow-context">
              <span class="flow-context__icon"><app-icon :name="definition.icon"></app-icon></span>
              <div>
                <strong>{{ asset.name }}</strong>
                <span class="mono">{{ asset.code }} · {{ asset.id }}</span>
              </div>
              <span class="flow-context__meta">{{ currentSite }} · {{ currentLocation }}</span>
            </div>

            <div v-if="errors.length" class="flow-errors" role="alert">
              <app-icon name="alert"></app-icon>
              <ul>
                <li v-for="message in errors" :key="message">{{ message }}</li>
              </ul>
            </div>

            <div class="form-grid form-grid--two">
              <div v-if="type === 'transfer'" class="field">
                <label :for="'move-site-' + asset.id">Sede de destino</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="building"></app-icon>
                  <select :id="'move-site-' + asset.id" v-model="form.site">
                    <option v-for="site in siteOptions" :key="site.id" :value="site.id">{{ site.label }}</option>
                  </select>
                </div>
              </div>

              <div v-if="type === 'transfer'" class="field">
                <label :for="'move-location-' + asset.id">Ubicación</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="map-pin"></app-icon>
                  <select :id="'move-location-' + asset.id" v-model="form.locationId">
                    <option value="">Sin ubicación</option>
                    <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.label }}</option>
                  </select>
                </div>
                <p class="field__hint">Solo se listan las ubicaciones de la sede elegida.</p>
              </div>

              <div v-if="type === 'assigned'" class="field field--span">
                <label :for="'move-person-' + asset.id">Persona responsable</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="user"></app-icon>
                  <select :id="'move-person-' + asset.id" v-model="form.personId">
                    <option value="">Elige una persona</option>
                    <option v-for="person in peopleOptions" :key="person.id" :value="person.id">{{ person.name }} · {{ person.role || 'Sin cargo' }}</option>
                  </select>
                </div>
                <p class="field__hint">Responsable actual: {{ asset.assignee || 'sin asignar' }}.</p>
              </div>

              <div v-if="type === 'returned'" class="field field--span">
                <label :for="'move-return-status-' + asset.id">Estado al ingresar</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="activity"></app-icon>
                  <select :id="'move-return-status-' + asset.id" v-model="form.statusId">
                    <option v-for="status in statusOptions" :key="status.id" :value="status.id">{{ status.label }}</option>
                  </select>
                </div>
                <p class="field__hint">Devuelve {{ asset.assignee || 'el equipo' }} y quita el responsable actual.</p>
              </div>

              <div v-if="type === 'status'" class="field field--span">
                <label :for="'move-status-' + asset.id">Estado de destino</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="activity"></app-icon>
                  <select :id="'move-status-' + asset.id" v-model="form.statusId">
                    <option v-for="status in statusOptions" :key="status.id" :value="status.id">{{ status.label }}</option>
                  </select>
                </div>
                <p class="field__hint">Estado actual: «{{ asset.status }}». La baja se registra con su propio movimiento.</p>
              </div>

              <div class="field">
                <label :for="'move-reason-' + asset.id">Motivo</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="info"></app-icon>
                  <select :id="'move-reason-' + asset.id" v-model="form.reason">
                    <option v-for="reason in reasons" :key="reason" :value="reason">{{ reason }}</option>
                  </select>
                </div>
              </div>

              <div class="field">
                <label :for="'move-date-' + asset.id">Fecha efectiva</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="history"></app-icon>
                  <input :id="'move-date-' + asset.id" v-model="form.effective" type="date">
                </div>
                <p class="field__hint">Puede ser hoy o una fecha pasada dentro del ciclo del activo.</p>
              </div>

              <div class="field field--span">
                <label :for="'move-note-' + asset.id">Observaciones</label>
                <div class="input-shell input-shell--plain input-shell--area">
                  <app-icon name="pencil"></app-icon>
                  <textarea :id="'move-note-' + asset.id" v-model="form.note" rows="3" placeholder="Detalle opcional para el historial"></textarea>
                </div>
              </div>
            </div>

            <label v-if="type === 'retired'" class="switch flow-ack">
              <input v-model="form.ack" type="checkbox">
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">Confirmo que el activo deja de estar operativo</span>
            </label>
            <p v-if="type === 'retired'" class="flow-note">
              <app-icon name="shield"></app-icon>
              La baja conserva la ficha, los adjuntos y el historial completo. Los activos relacionados no se modifican.
            </p>
          </div>

          <div v-else-if="step === 2" class="flow-body">
            <div class="flow-context">
              <span class="flow-context__icon"><app-icon :name="definition.icon"></app-icon></span>
              <div>
                <strong>{{ definition.label }}</strong>
                <span class="mono">{{ asset.code }} · {{ asset.name }}</span>
              </div>
              <span class="flow-context__meta">{{ effectiveLabel() }}</span>
            </div>

            <div class="review-block">
              <h3>Cambios sobre el activo</h3>
              <dl class="review-list">
                <div v-for="(change, index) in plan.changes" :key="'change-' + index" class="review-row">
                  <dt>{{ change.label }}</dt>
                  <dd>
                    <span class="review-old">{{ value(change.before) }}</span>
                    <span class="review-arrow" aria-hidden="true">→</span>
                    <span class="review-new">{{ value(change.after) }}</span>
                  </dd>
                </div>
              </dl>
            </div>

            <div v-if="plan.code.changed" class="flow-banner">
              <app-icon name="layers"></app-icon>
              <div>
                <strong>Código rápido recalculado</strong>
                <p>{{ plan.code.from }} → {{ plan.code.to }}. El código anterior se conserva en el historial y el ID permanente no cambia.</p>
              </div>
            </div>

            <dl class="review-summary">
              <div><dt>Motivo</dt><dd>{{ form.reason }}</dd></div>
              <div><dt>Fecha efectiva</dt><dd>{{ effectiveLabel() }}</dd></div>
              <div v-if="form.note"><dt>Observaciones</dt><dd>{{ form.note }}</dd></div>
              <div v-if="type === 'retired'"><dt>Baja</dt><dd>Registro, adjuntos e historial conservados</dd></div>
            </dl>

            <div v-if="plan.warnings.length" class="flow-warnings">
              <app-icon name="alert"></app-icon>
              <ul>
                <li v-for="warning in plan.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>
          </div>

          <div v-else class="flow-body flow-body--result">
            <span class="flow-result__icon"><app-icon name="check"></app-icon></span>
            <h3>{{ definition.title }} registrado</h3>
            <p>El evento quedó en el historial de {{ asset.name }} con su responsable y sus valores anteriores.</p>

            <dl class="review-list review-list--result">
              <div v-for="(change, index) in result.changes" :key="'result-' + index" class="review-row">
                <dt>{{ change.label }}</dt>
                <dd><span class="review-new">{{ value(change.after) }}</span></dd>
              </div>
            </dl>

            <p v-if="result.code.changed" class="flow-note">
              <app-icon name="layers"></app-icon>
              Código rápido actualizado de {{ result.code.from }} a {{ result.code.to }}.
            </p>
            <p class="flow-note">
              <app-icon name="shield"></app-icon>
              El ID permanente {{ asset.id }} no se modifica.
            </p>
          </div>
        </div>

        <template #footer>
          <template v-if="step === 1">
            <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
            <button type="button" class="btn btn--primary" data-od-id="movement-continue" @click="next">Continuar</button>
          </template>
          <template v-else-if="step === 2">
            <button type="button" class="btn btn--ghost" @click="back">Volver</button>
            <button type="button" class="btn btn--primary" data-od-id="movement-confirm" @click="apply">Confirmar {{ definition.label.toLocaleLowerCase('es') }}</button>
          </template>
          <template v-else>
            <button type="button" class="btn btn--primary" @click="close">Cerrar</button>
          </template>
        </template>
      </modal-shell>
    `
  };

  Views.AssetMovements = {
    name: 'AssetMovements',
    components: { AppIcon: window.AppIcon, MovementDialog: Views.MovementDialog },
    props: {
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    data() {
      return { dialog: '' };
    },
    computed: {
      movements() {
        return Data.MOVEMENTS;
      },
      canEdit() {
        return this.app.can('assets.edit');
      }
    },
    methods: {
      open(id) {
        this.dialog = id;
      },
      close() {
        this.dialog = '';
      },
      applied() {
        // El diálogo permanece abierto en el paso de resultado; se cierra a mano.
      },
      restore() {
        this.app.restoreAsset(this.asset);
      }
    },
    template: `
      <section class="movements-panel" aria-labelledby="movements-title" data-od-id="asset-movements">
        <header class="panel-head">
          <div>
            <p class="eyebrow">Movimientos</p>
            <h2 id="movements-title">Operaciones del activo</h2>
          </div>
          <span class="chip chip--muted mono">{{ asset.id }}</span>
        </header>
        <p class="movements-lead">Cada movimiento registra responsable, fecha efectiva y motivo. El ID permanente nunca cambia y el código rápido conserva el valor anterior en el historial.</p>

        <div v-if="asset.retired" class="movements-retired">
          <span class="movements-retired__icon"><app-icon name="alert"></app-icon></span>
          <div>
            <strong>Activo dado de baja</strong>
            <p>{{ asset.retired.reason }} · {{ asset.retired.at ? asset.retired.at.slice(0, 10) : '' }}. La ficha, los adjuntos y el historial se conservan.</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" data-od-id="restore-asset-movement" @click="restore">
            <app-icon name="restore"></app-icon> Restaurar activo
          </button>
        </div>

        <div v-else class="movement-grid">
          <article v-for="movement in movements" :key="movement.id" class="movement-card" :data-od-id="'movement-' + movement.id">
            <span class="movement-card__icon"><app-icon :name="movement.icon"></app-icon></span>
            <h3>{{ movement.label }}</h3>
            <p>{{ movement.hint }}</p>
            <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="open(movement.id)">{{ movement.action }}</button>
            <span v-else class="cell-muted">Requiere permiso de edición de activos.</span>
          </article>
        </div>

        <movement-dialog v-if="dialog" :open="true" :type="dialog" :asset="asset" :app="app" @close="close" @applied="applied"></movement-dialog>
      </section>
    `
  };

  Views.BulkEditor = {
    name: 'BulkEditor',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      open: { type: Boolean, default: false },
      ids: { type: Array, default() { return []; } },
      app: { type: Object, required: true }
    },
    emits: ['close', 'applied'],
    data() {
      return {
        step: 1,
        selection: [],
        query: '',
        fields: {},
        values: {},
        errors: {},
        rows: [],
        result: null,
        submitted: false
      };
    },
    computed: {
      context() {
        return {
          assets: this.app.assets,
          admin: this.app.assetAdmin,
          sites: this.app.sites,
          people: this.app.people,
          actor: Engine.actorOf(this.app)
        };
      },
      assets() {
        return Array.isArray(this.app.assets) ? this.app.assets : [];
      },
      selectionAssets() {
        return this.selection.map((id) => this.assets.find((asset) => asset.id === id)).filter(Boolean);
      },
      visibleAssets() {
        const query = this.query.trim().toLocaleLowerCase('es');
        const list = this.assets.slice();
        if (!query) return list;
        return list.filter((asset) => {
          return [asset.name, asset.code, asset.id, asset.type, asset.site]
            .join(' ')
            .toLocaleLowerCase('es')
            .indexOf(query) !== -1;
        });
      },
      catalog() {
        return Engine.bulkCatalog(this.context, this.selectionAssets);
      },
      groups() {
        const order = ['Estado y responsable', 'Ubicación', 'Datos comunes', 'Campos técnicos'];
        return order
          .map((name) => ({ name: name, fields: this.catalog.filter((field) => field.group === name) }))
          .filter((group) => group.fields.length);
      },
      selectedKeys() {
        return Object.keys(this.fields).filter((key) => this.fields[key]);
      },
      steps() {
        return [
          { id: 1, label: 'Activos', hint: 'Qué se modifica' },
          { id: 2, label: 'Campos', hint: 'Valores a aplicar' },
          { id: 3, label: 'Vista previa', hint: 'Revisión por activo' },
          { id: 4, label: 'Resumen', hint: 'Resultado del lote' }
        ];
      },
      commonSite() {
        const sites = this.selectionAssets.map((asset) => asset.site);
        const first = sites[0] || '';
        return sites.every((site) => site === first) ? first : '';
      },
      locationSourceSite() {
        return this.values.site || this.commonSite;
      },
      locationOptions() {
        const site = (this.app.sites || []).find((item) => item.id === this.locationSourceSite);
        return site && Array.isArray(site.locations) ? site.locations : [];
      },
      counts() {
        const applied = this.rows.filter((row) => !row.skipped && row.changes.length);
        const unchanged = this.rows.filter((row) => !row.skipped && !row.changes.length);
        const skipped = this.rows.filter((row) => row.skipped);
        return { applied: applied.length, unchanged: unchanged.length, skipped: skipped.length };
      },
      statusOptions() {
        return Engine.openStatuses(this.app.assetAdmin);
      },
      peopleOptions() {
        const people = Array.isArray(this.app.people) ? this.app.people : [];
        return people.filter((person) => person.active);
      },
      siteOptionsData() {
        return Array.isArray(this.app.sites) ? this.app.sites : [];
      },
      selectedCount() {
        return this.selection.length;
      }
    },
    watch: {
      open(value) {
        if (value) this.reset();
      }
    },
    methods: {
      reset() {
        this.step = 1;
        this.selection = (this.ids || []).slice();
        this.query = '';
        this.fields = {};
        this.values = {};
        this.errors = {};
        this.rows = [];
        this.result = null;
        this.submitted = false;
      },
      isSelected(id) {
        return this.selection.indexOf(id) !== -1;
      },
      toggleAsset(id) {
        const index = this.selection.indexOf(id);
        if (index === -1) this.selection.push(id);
        else this.selection.splice(index, 1);
      },
      selectVisible() {
        const ids = this.visibleAssets.map((asset) => asset.id);
        const all = ids.every((id) => this.selection.indexOf(id) !== -1);
        if (all) {
          this.selection = this.selection.filter((id) => ids.indexOf(id) === -1);
        } else {
          ids.forEach((id) => {
            if (this.selection.indexOf(id) === -1) this.selection.push(id);
          });
        }
      },
      allVisibleSelected() {
        return this.visibleAssets.length > 0 && this.visibleAssets.every((asset) => this.selection.indexOf(asset.id) !== -1);
      },
      siteLabel(id) {
        return Engine.siteLabel(this.app.sites, id) || 'Sin sede';
      },
      imageOf(asset) {
        if (asset && this.app.assetImage) return this.app.assetImage(asset);
        return asset ? asset.image : '';
      },
      toggleField(key) {
        const enabled = !this.fields[key];
        this.fields = Object.assign({}, this.fields, { [key]: enabled });
        if (enabled && (this.values[key] === undefined || this.values[key] === '')) {
          this.values = Object.assign({}, this.values, { [key]: this.defaultValue(key) });
        }
        if (this.errors[key]) {
          const next = Object.assign({}, this.errors);
          delete next[key];
          this.errors = next;
        }
      },
      defaultValue(key) {
        const field = this.catalog.find((item) => item.key === key);
        if (!field) return '';
        if (field.control === 'status') {
          const status = Engine.openStatuses(this.app.assetAdmin).find((item) => item.id !== (this.selectionAssets[0] || {}).statusId);
          return status ? status.id : '';
        }
        if (field.control === 'person') return '';
        if (field.control === 'site') return this.commonSite || (this.app.sites[0] ? this.app.sites[0].id : '');
        if (field.control === 'location') return '';
        if (field.control === 'boolean') return 'true';
        if (field.control === 'select') return field.options && field.options.length ? field.options[0] : '';
        return '';
      },
      setValue(key, value) {
        this.values = Object.assign({}, this.values, { [key]: value });
        if (key === 'site' && this.fields.locationId) {
          const first = this.app.sites.find((item) => item.id === value);
          const location = first && first.locations && first.locations.length ? first.locations[0].id : '';
          this.values = Object.assign({}, this.values, { locationId: location });
        }
      },
      validate() {
        const errors = {};
        this.selectedKeys.forEach((key) => {
          const field = this.catalog.find((item) => item.key === key);
          if (!field) return;
          const value = this.values[key];
          if (field.control === 'status' && !value) errors[key] = 'Elige un estado.';
          if (field.control === 'site' && !value) errors[key] = 'Elige una sede.';
          if ((field.control === 'text' || field.control === 'date' || field.control === 'number') && String(value === undefined ? '' : value).trim() === '') {
            errors[key] = 'Ingresa un valor o desmarca el campo.';
          }
        });
        this.errors = errors;
        return Object.keys(errors).length === 0;
      },
      previewValues() {
        const values = {};
        this.selectedKeys.forEach((key) => {
          values[key] = this.values[key];
        });
        return values;
      },
      toPreview() {
        if (!this.selection.length) return;
        if (!this.selectedKeys.length) {
          this.errors = { general: 'Marca al menos un campo para modificar.' };
          return;
        }
        if (!this.validate()) return;
        this.errors = {};
        this.rows = Engine.computeBulk(this.selectionAssets, this.previewValues(), this.context);
        this.step = 3;
      },
      back() {
        if (this.step > 1) this.step -= 1;
      },
      apply() {
        const applied = Engine.applyBulk(this.rows, this.context);
        this.app.persistAssets();
        this.app.persistAssignments();
        this.result = { applied: applied, rows: this.rows };
        this.step = 4;
        this.app.showToast('Edición masiva aplicada en ' + applied.length + (applied.length === 1 ? ' activo.' : ' activos.'));
        this.$emit('applied', this.result);
      },
      close() {
        this.$emit('close');
      },
      changeText(change) {
        const before = change.before === '' || change.before === undefined ? 'Sin valor' : change.before;
        const after = change.after === '' || change.after === undefined ? 'Sin valor' : change.after;
        return before + ' → ' + after;
      },
      rowState(row) {
        if (row.skipped) return 'Omitido';
        return row.changes.length ? 'Se actualiza' : 'Sin cambios';
      }
    },
    template: `
      <modal-shell :open="open" title="Edición masiva" eyebrow="Operaciones por lote" size="xl" @close="close">
        <div class="flow">
          <ol class="flow-steps flow-steps--four" aria-label="Pasos de la edición masiva">
            <li v-for="item in steps" :key="item.id" class="flow-step"
                :class="{ 'is-active': step === item.id, 'is-done': step > item.id }"
                :aria-current="step === item.id ? 'step' : null">
              <span class="flow-step__num">{{ step > item.id ? '✓' : item.id }}</span>
              <span class="flow-step__copy"><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></span>
            </li>
          </ol>

          <div v-if="step === 1" class="flow-body">
            <div class="bulk-head">
              <div>
                <strong>{{ selectedCount }} {{ selectedCount === 1 ? 'activo seleccionado' : 'activos seleccionados' }}</strong>
                <p>Ajusta la selección antes de elegir los campos. Los activos dados de baja se omiten automáticamente.</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" @click="selectVisible">{{ allVisibleSelected() ? 'Quitar visibles' : 'Seleccionar visibles' }}</button>
            </div>

            <div class="search-field bulk-search">
              <app-icon name="search"></app-icon>
              <label class="sr-only" for="bulk-search">Buscar activos para el lote</label>
              <input id="bulk-search" v-model="query" type="search" placeholder="Buscar por nombre, código o sede" autocomplete="off">
              <button v-if="query" class="search-clear" type="button" aria-label="Borrar búsqueda" @click="query = ''">
                <app-icon name="close"></app-icon>
              </button>
            </div>

            <ul class="bulk-assets">
              <li v-for="asset in visibleAssets" :key="asset.id" class="bulk-asset" :class="{ 'is-selected': isSelected(asset.id), 'is-retired': asset.retired }">
                <label class="bulk-asset__check">
                  <input type="checkbox" :checked="isSelected(asset.id)" @change="toggleAsset(asset.id)" :aria-label="'Incluir ' + asset.name + ' en el lote'">
                  <span class="row-select__box" aria-hidden="true"><app-icon name="check"></app-icon></span>
                </label>
                <span class="bulk-asset__thumb"><img :src="imageOf(asset)" width="640" height="400" alt=""></span>
                <span class="bulk-asset__copy">
                  <strong>{{ asset.name }}</strong>
                  <span class="mono">{{ asset.code }} · {{ asset.id }}</span>
                </span>
                <span class="bulk-asset__meta">{{ siteLabel(asset.site) }}</span>
                <span class="status-pill" :class="'status--' + asset.statusTone">{{ asset.status }}</span>
              </li>
            </ul>
          </div>

          <div v-else-if="step === 2" class="flow-body">
            <p class="bulk-lead">Solo se modifican los campos marcados. Los valores vacíos no sobrescriben nada: si un campo queda vacío se muestra un error y puedes desmarcarlo.</p>
            <p v-if="errors.general" class="form-error" role="alert">{{ errors.general }}</p>

            <div v-for="group in groups" :key="group.name" class="bulk-group">
              <h3 class="bulk-group__title">{{ group.name }}</h3>
              <div class="bulk-fields">
                <div v-for="field in group.fields" :key="field.key" class="bulk-field" :class="{ 'is-enabled': fields[field.key] }">
                  <label class="bulk-field__toggle">
                    <input type="checkbox" :checked="!!fields[field.key]" @change="toggleField(field.key)">
                    <span>{{ field.label }}</span>
                  </label>
                  <div v-if="fields[field.key]" class="bulk-field__control">
                    <div v-if="field.control === 'status'" class="input-shell input-shell--plain">
                      <app-icon name="activity"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option v-for="status in statusOptions" :key="status.id" :value="status.id">{{ status.label }}</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'person'" class="input-shell input-shell--plain">
                      <app-icon name="user"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option value="">Sin responsable</option>
                        <option v-for="person in peopleOptions" :key="person.id" :value="person.id">{{ person.name }}</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'site'" class="input-shell input-shell--plain">
                      <app-icon name="building"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option v-for="site in siteOptionsData" :key="site.id" :value="site.id">{{ site.label }}</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'location'" class="input-shell input-shell--plain">
                      <app-icon name="map-pin"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option value="">Sin ubicación</option>
                        <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.label }}</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'boolean'" class="input-shell input-shell--plain">
                      <app-icon name="check"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'select'" class="input-shell input-shell--plain">
                      <app-icon name="sliders"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                      </select>
                    </div>
                    <div v-else class="input-shell input-shell--plain" :class="{ 'input-shell--invalid': errors[field.key] }">
                      <app-icon :name="field.control === 'number' ? 'package' : 'pencil'"></app-icon>
                      <input :id="'bulk-' + field.key" :value="values[field.key]" :type="field.control === 'number' ? 'number' : field.control === 'date' ? 'date' : 'text'"
                             :placeholder="field.control === 'number' ? 'Importe en euros' : 'Nuevo valor'" @input="setValue(field.key, $event.target.value)">
                    </div>
                    <p v-if="errors[field.key]" class="field__error">{{ errors[field.key] }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="step === 3" class="flow-body">
            <div class="bulk-summary">
              <div><span class="bulk-summary__value mono">{{ rows.length }}</span><span>activos en el lote</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.applied }}</span><span>se actualizan</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.unchanged }}</span><span>sin cambios</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.skipped }}</span><span>se omiten</span></div>
            </div>

            <div class="bulk-preview">
              <div class="bulk-preview__head">
                <span>Activo</span>
                <span>Cambios</span>
                <span>Avisos</span>
              </div>
              <div v-for="row in rows" :key="row.asset.id" class="bulk-preview__row" :class="{ 'is-skipped': row.skipped }">
                <div class="bulk-preview__asset">
                  <strong>{{ row.asset.name }}</strong>
                  <span class="mono">{{ row.asset.code }} · {{ row.asset.id }}</span>
                </div>
                <div class="bulk-preview__changes">
                  <p v-for="(change, index) in row.changes" :key="'pc-' + index">{{ change.label }}: <span class="review-old">{{ change.before }}</span> → <span class="review-new">{{ change.after }}</span></p>
                  <p v-if="row.skipped" class="cell-muted">{{ row.skipReason }}</p>
                  <p v-else-if="!row.changes.length" class="cell-muted">{{ row.skipReason || 'Sin cambios' }}</p>
                </div>
                <div class="bulk-preview__warnings">
                  <span v-for="warning in row.warnings" :key="warning" class="bulk-warning">{{ warning }}</span>
                  <span v-if="!row.warnings.length" class="cell-muted">—</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="flow-body flow-body--result">
            <span class="flow-result__icon"><app-icon name="check"></app-icon></span>
            <h3>Edición masiva aplicada</h3>
            <p>{{ result.applied.length }} {{ result.applied.length === 1 ? 'activo actualizado' : 'activos actualizados' }}. Cada cambio quedó registrado en el historial de su ficha con el responsable de la operación.</p>

            <dl class="review-list review-list--result">
              <div v-for="row in result.rows" :key="'res-' + row.asset.id" class="review-row">
                <dt>{{ row.asset.name }}</dt>
                <dd>
                  <span v-if="row.skipped" class="chip chip--muted">Omitido</span>
                  <span v-else-if="!row.changes.length" class="chip chip--muted">Sin cambios</span>
                  <span v-else class="timeline__new">{{ row.changes.length }} {{ row.changes.length === 1 ? 'campo actualizado' : 'campos actualizados' }}</span>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <template #footer>
          <template v-if="step === 1">
            <span class="modal-foot__note">{{ selectedCount }} en el lote</span>
            <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
            <button type="button" class="btn btn--primary" :disabled="!selectedCount" data-od-id="bulk-continue" @click="step = 2">Elegir campos</button>
          </template>
          <template v-else-if="step === 2">
            <button type="button" class="btn btn--ghost" @click="back">Volver</button>
            <button type="button" class="btn btn--primary" data-od-id="bulk-preview" @click="toPreview">Ver vista previa</button>
          </template>
          <template v-else-if="step === 3">
            <button type="button" class="btn btn--ghost" @click="back">Volver</button>
            <button type="button" class="btn btn--primary" :disabled="!counts.applied" data-od-id="bulk-apply" @click="apply">Confirmar y aplicar</button>
          </template>
          <template v-else>
            <button type="button" class="btn btn--primary" @click="close">Cerrar</button>
          </template>
        </template>
      </modal-shell>
    `
  };

  window.AssetOpsMethods = {
    assetBulkSelected(id) {
      return this.bulk.ids.indexOf(id) !== -1;
    },
    toggleBulkAsset(id) {
      const index = this.bulk.ids.indexOf(id);
      if (index === -1) this.bulk.ids.push(id);
      else this.bulk.ids.splice(index, 1);
    },
    bulkAllVisible() {
      const list = this.filteredAssets || [];
      return list.length > 0 && list.every((asset) => this.bulk.ids.indexOf(asset.id) !== -1);
    },
    bulkSomeVisible() {
      const list = this.filteredAssets || [];
      const selected = list.filter((asset) => this.bulk.ids.indexOf(asset.id) !== -1);
      return selected.length > 0 && selected.length < list.length;
    },
    toggleBulkVisible() {
      const list = this.filteredAssets || [];
      const ids = list.map((asset) => asset.id);
      if (this.bulkAllVisible()) {
        this.bulk.ids = this.bulk.ids.filter((id) => ids.indexOf(id) === -1);
      } else {
        ids.forEach((id) => {
          if (this.bulk.ids.indexOf(id) === -1) this.bulk.ids.push(id);
        });
      }
    },
    clearBulk() {
      this.bulk.ids = [];
    },
    openBulkEditor() {
      if (!this.bulk.ids.length) return;
      this.bulk.open = true;
    },
    closeBulkEditor() {
      this.bulk.open = false;
      this.bulk.ids = [];
    },
    handleBulkApplied() {
      this.bulk.ids = [];
    }
  };
})();
