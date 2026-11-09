(function () {
  'use strict';

  const Engine = window.AssetOpsEngine;
  const Data = window.AssetOpsData;
  const Schema = window.AssetSchema;

  const Views = window.AssetOpsViews = window.AssetOpsViews || {};

  function runtime() { return typeof window !== 'undefined' ? window.ItsmI18n : null; }

  function tr(key, params) {
    return runtime() ? runtime().t(key, params) : '';
  }

  function lower(value) {
    const active = runtime() ? runtime().activeLocale : undefined;
    return String(value === null || value === undefined ? '' : value).toLocaleLowerCase(active);
  }

  function formatDay(value, options) {
    return runtime() ? runtime().formatDate(value, options) : '';
  }

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
    if (Number.isNaN(date.getTime())) return tr('ui.operations.value.no_date');
    const today = isoDate(new Date());
    const key = isoDate(date);
    if (key === today) return tr('ui.operations.value.today');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === isoDate(yesterday)) return tr('ui.operations.value.yesterday');
    return formatDay(date, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function timeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return runtime() ? runtime().time(date) : '';
  }

  function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatDay(date, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function kindMeta(kind) {
    return Data.KIND_META[kind] || { label: tr('ui.operations.kind.event'), icon: 'history', tone: 'neutral' };
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
        return entry.actor || this.$t('ui.operations.actor.system');
      },
      hasDiff(entry) {
        return Array.isArray(entry.changes) && entry.changes.length > 0;
      },
      diffValue(value) {
        return value === '' || value === undefined || value === null ? this.$t('ui.operations.value.empty') : value;
      },
      lower,
      time(entry) {
        return timeLabel(entry.at);
      },
      effective(entry) {
        if (!entry.effectiveAt) return '';
        if (dayKey(entry.effectiveAt) === dayKey(entry.recordedAt || entry.at)) return '';
        return this.$t('ui.operations.history.effective', { date: shortDate(entry.effectiveAt) });
      },
      recorded(entry) {
        if (!entry.recordedAt) return '';
        if (dayKey(entry.recordedAt) === dayKey(entry.at)) return '';
        return this.$t('ui.operations.history.recorded', { date: shortDate(entry.recordedAt) });
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
            <p class="eyebrow">{{ $t('ui.operations.history.eyebrow') }}</p>
            <h2 id="history-title">{{ $t('ui.operations.history.title') }}</h2>
          </div>
          <div class="history-summary">
            <span class="chip chip--muted">{{ $t('ui.operations.history.events', { count: history.length }) }}</span>
            <span v-if="hasFilters" class="chip">{{ $t('ui.operations.history.visible', { count: filtered.length }) }}</span>
          </div>
        </header>

        <div class="history-toolbar" data-od-id="history-filters">
          <div class="search-field history-search">
            <app-icon name="search"></app-icon>
            <label class="sr-only" :for="'history-search-' + asset.id">{{ $t('ui.operations.history.search_label') }}</label>
            <input :id="'history-search-' + asset.id" v-model="query" type="search" :placeholder="$t('ui.operations.history.search_placeholder')" autocomplete="off">
            <button v-if="query" class="search-clear" type="button" :aria-label="$t('ui.operations.history.clear_search')" @click="query = ''">
              <app-icon name="close"></app-icon>
            </button>
          </div>
          <div class="history-chips" role="group" :aria-label="$t('ui.operations.history.filter_group')">
            <button v-for="option in filters" :key="option.id" type="button" class="chip-filter"
                    :class="{ 'is-active': filter === option.id }" :aria-pressed="filter === option.id"
                    @click="filter = option.id">
              {{ option.label }}
              <span class="chip-filter__count mono">{{ countFor(option) }}</span>
            </button>
          </div>
          <div class="select-field history-actor">
            <app-icon name="user"></app-icon>
            <label class="sr-only" :for="'history-actor-' + asset.id">{{ $t('ui.operations.history.actor_filter') }}</label>
            <select :id="'history-actor-' + asset.id" v-model="actor">
              <option value="all">{{ $t('ui.operations.history.all_actors') }}</option>
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
          <strong>{{ history.length ? $t('ui.operations.history.empty_filtered') : $t('ui.operations.history.empty') }}</strong>
          <p>{{ history.length ? $t('ui.operations.history.empty_filtered_hint') : $t('ui.operations.history.empty_hint') }}</p>
          <button v-if="hasFilters" type="button" class="btn btn--ghost btn--small" @click="reset">{{ $t('ui.operations.history.clear_filters') }}</button>
        </div>

        <div v-if="remaining" class="history-foot">
          <button type="button" class="btn btn--ghost btn--small" @click="more">
            <app-icon name="chevron-down"></app-icon>
            {{ $t('ui.operations.history.more') }}
            <span class="mono history-foot__count">{{ $t('ui.operations.history.range', { shown: visibleEntries.length, total: filtered.length }) }}</span>
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
        return Data.reasonList(this.type);
      },
      plan() {
        return Engine.planMovement(this.asset, this.buildMovement(), this.context);
      },
      dialogTitle() {
        return this.definition ? this.definition.title : this.$t('ui.operations.move.generic');
      },
      currentSite() {
        return Engine.siteLabel(this.siteOptions, this.asset.site) || this.$t('ui.operations.value.no_site');
      },
      currentLocation() {
        return this.asset.location || this.$t('ui.operations.value.no_location');
      },
      steps() {
        return [
          { id: 1, label: this.$t('ui.operations.move.step_data'), hint: this.$t('ui.operations.move.step_data_hint') },
          { id: 2, label: this.$t('ui.operations.move.step_review'), hint: this.$t('ui.operations.move.step_review_hint') },
          { id: 3, label: this.$t('ui.operations.move.step_result'), hint: this.$t('ui.operations.move.step_result_hint') }
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
          reason: this.defaultReason(type),
          note: '',
          effective: isoDate(new Date()),
          ack: false
        };
      },
      defaultReason(type) {
        return Data.reasonList(type)[0];
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
        this.app.showToast(this.$t('ui.operations.move.recorded', { title: this.definition.title }));
        this.$emit('applied', outcome);
      },
      close() {
        this.$emit('close');
      },
      value(value) {
        return value === '' || value === undefined || value === null ? this.$t('ui.operations.value.empty') : value;
      },
      lower,
      effectiveLabel() {
        return this.form.effective ? shortDate(this.form.effective + 'T12:00:00') : this.$t('ui.operations.value.today');
      }
    },
    template: `
      <modal-shell :open="open" :title="dialogTitle" :eyebrow="$t('ui.operations.move.eyebrow')" size="wide" @close="close">
        <div class="flow">
          <ol class="flow-steps" :aria-label="$t('ui.operations.move.steps')">
            <li v-for="item in steps" :key="item.id" class="flow-step"
                :class="{ 'is-active': step === item.id, 'is-done': step > item.id }"
                :aria-current="step === item.id ? 'step' : null">
              <span class="flow-step__num">{{ step > item.id ? '✓' : item.id }}</span>
              <span class="flow-step__copy"><strong>{{ item.label }}</strong></span>
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
                <label :for="'move-site-' + asset.id">{{ $t('ui.operations.field.destination_site') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="building"></app-icon>
                  <select :id="'move-site-' + asset.id" v-model="form.site">
                    <option v-for="site in siteOptions" :key="site.id" :value="site.id">{{ site.label }}</option>
                  </select>
                </div>
              </div>

              <div v-if="type === 'transfer'" class="field">
                <label :for="'move-location-' + asset.id">{{ $t('ui.operations.field.location') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="map-pin"></app-icon>
                  <select :id="'move-location-' + asset.id" v-model="form.locationId">
                    <option value="">{{ $t('ui.operations.value.no_location') }}</option>
                    <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.label }}</option>
                  </select>
                </div>
                <p class="field__hint">{{ $t('ui.operations.move.locations_hint') }}</p>
              </div>

              <div v-if="type === 'assigned'" class="field field--span">
                <label :for="'move-person-' + asset.id">{{ $t('ui.operations.field.person') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="user"></app-icon>
                  <select :id="'move-person-' + asset.id" v-model="form.personId">
                    <option value="">{{ $t('ui.operations.move.choose_person') }}</option>
                    <option v-for="person in peopleOptions" :key="person.id" :value="person.id">{{ person.name }} · {{ person.role || $t('ui.operations.value.no_role') }}</option>
                  </select>
                </div>
                <p class="field__hint">{{ $t('ui.operations.move.current_owner', { name: asset.assignee || $t('ui.operations.value.unassigned') }) }}</p>
              </div>

              <div v-if="type === 'returned'" class="field field--span">
                <label :for="'move-return-status-' + asset.id">{{ $t('ui.operations.field.return_status') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="activity"></app-icon>
                  <select :id="'move-return-status-' + asset.id" v-model="form.statusId">
                    <option v-for="status in statusOptions" :key="status.id" :value="status.id">{{ status.label }}</option>
                  </select>
                </div>
                <p class="field__hint">{{ $t('ui.operations.move.return_hint', { name: asset.assignee || $t('ui.operations.value.the_asset') }) }}</p>
              </div>

              <div v-if="type === 'status'" class="field field--span">
                <label :for="'move-status-' + asset.id">{{ $t('ui.operations.field.target_status') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="activity"></app-icon>
                  <select :id="'move-status-' + asset.id" v-model="form.statusId">
                    <option v-for="status in statusOptions" :key="status.id" :value="status.id">{{ status.label }}</option>
                  </select>
                </div>
                <p class="field__hint">{{ $t('ui.operations.move.status_hint', { status: asset.status }) }}</p>
              </div>

              <div class="field">
                <label :for="'move-reason-' + asset.id">{{ $t('ui.operations.field.reason') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="info"></app-icon>
                  <select :id="'move-reason-' + asset.id" v-model="form.reason">
                    <option v-for="reason in reasons" :key="reason" :value="reason">{{ reason }}</option>
                  </select>
                </div>
              </div>

              <div class="field">
                <label :for="'move-date-' + asset.id">{{ $t('ui.operations.field.effective_date') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="history"></app-icon>
                  <input :id="'move-date-' + asset.id" v-model="form.effective" type="date">
                </div>
                <p class="field__hint">{{ $t('ui.operations.move.date_hint') }}</p>
              </div>

              <div class="field field--span">
                <label :for="'move-note-' + asset.id">{{ $t('ui.operations.field.notes') }}</label>
                <div class="input-shell input-shell--plain input-shell--area">
                  <app-icon name="pencil"></app-icon>
                  <textarea :id="'move-note-' + asset.id" v-model="form.note" rows="3" :placeholder="$t('ui.operations.move.note_placeholder')"></textarea>
                </div>
              </div>
            </div>

            <label v-if="type === 'retired'" class="switch flow-ack">
              <input v-model="form.ack" type="checkbox">
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">{{ $t('ui.operations.move.retire_ack') }}</span>
            </label>
            <p v-if="type === 'retired'" class="flow-note">
              <app-icon name="shield"></app-icon>
              {{ $t('ui.operations.move.retire_note') }}
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
              <h3>{{ $t('ui.operations.move.changes_title') }}</h3>
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
                <strong>{{ $t('ui.operations.move.code_recalculated') }}</strong>
                <p>{{ $t('ui.operations.move.code_recalculated_hint', { from: plan.code.from, to: plan.code.to }) }}</p>
              </div>
            </div>

            <dl class="review-summary">
              <div><dt>{{ $t('ui.operations.field.reason') }}</dt><dd>{{ form.reason }}</dd></div>
              <div><dt>{{ $t('ui.operations.field.effective_date') }}</dt><dd>{{ effectiveLabel() }}</dd></div>
              <div v-if="form.note"><dt>{{ $t('ui.operations.field.notes') }}</dt><dd>{{ form.note }}</dd></div>
              <div v-if="type === 'retired'"><dt>{{ $t('ui.operations.kind.retired') }}</dt><dd>{{ $t('ui.operations.move.retire_kept') }}</dd></div>
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
            <h3>{{ $t('ui.operations.move.result_title', { title: definition.title }) }}</h3>
            <p>{{ $t('ui.operations.move.result_lead', { name: asset.name }) }}</p>

            <dl class="review-list review-list--result">
              <div v-for="(change, index) in result.changes" :key="'result-' + index" class="review-row">
                <dt>{{ change.label }}</dt>
                <dd><span class="review-new">{{ value(change.after) }}</span></dd>
              </div>
            </dl>

            <p v-if="result.code.changed" class="flow-note">
              <app-icon name="layers"></app-icon>
              {{ $t('ui.operations.move.code_updated', { from: result.code.from, to: result.code.to }) }}
            </p>
            <p class="flow-note">
              <app-icon name="shield"></app-icon>
              {{ $t('ui.operations.move.id_kept', { id: asset.id }) }}
            </p>
          </div>
        </div>

        <template #footer>
          <template v-if="step === 1">
            <button type="button" class="btn btn--ghost" @click="close">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--primary" data-od-id="movement-continue" @click="next">{{ $t('ui.operations.move.continue') }}</button>
          </template>
          <template v-else-if="step === 2">
            <button type="button" class="btn btn--ghost" @click="back">{{ $t('ui.operations.move.back') }}</button>
            <button type="button" class="btn btn--primary" data-od-id="movement-confirm" @click="apply">{{ $t('ui.operations.move.confirm', { action: lower(definition.label) }) }}</button>
          </template>
          <template v-else>
            <button type="button" class="btn btn--primary" @click="close">{{ $t('ui.common.close') }}</button>
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
            <p class="eyebrow">{{ $t('ui.operations.movements.eyebrow') }}</p>
            <h2 id="movements-title">{{ $t('ui.operations.movements.title') }}</h2>
          </div>
          <span class="chip chip--muted mono">{{ asset.id }}</span>
        </header>
        <p class="movements-lead">{{ $t('ui.operations.movements.lead') }}</p>

        <div v-if="asset.retired" class="movements-retired">
          <span class="movements-retired__icon"><app-icon name="alert"></app-icon></span>
          <div>
            <strong>{{ $t('ui.operations.movements.retired_title') }}</strong>
            <p>{{ $t('ui.operations.movements.retired_detail', { reason: asset.retired.reason, date: asset.retired.at ? asset.retired.at.slice(0, 10) : '' }) }}</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" data-od-id="restore-asset-movement" @click="restore">
            <app-icon name="restore"></app-icon> {{ $t('ui.operations.movements.restore') }}
          </button>
        </div>

        <div v-else class="movement-grid">
          <article v-for="movement in movements" :key="movement.id" class="movement-card" :data-od-id="'movement-' + movement.id">
            <span class="movement-card__icon"><app-icon :name="movement.icon"></app-icon></span>
            <h3>{{ movement.label }}</h3>
            <p>{{ movement.hint }}</p>
            <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="open(movement.id)">{{ movement.action }}</button>
            <span v-else class="cell-muted">{{ $t('ui.operations.movements.permission') }}</span>
          </article>
        </div>

        <movement-dialog v-if="dialog" :open="true" :type="dialog" :asset="asset" :app="app" @close="close" @applied="applied"></movement-dialog>
      </section>
    `
  };

  const BULK_CONTROLS = { select: 'select', number: 'number', boolean: 'boolean', date: 'date' };
  const BULK_GROUPS = [
    { id: 'status', labelKey: 'ui.operations.bulk.group_status' },
    { id: 'location', labelKey: 'ui.operations.bulk.group_location' },
    { id: 'common', labelKey: 'ui.operations.bulk.group_common' },
    { id: 'technical', labelKey: 'ui.operations.bulk.group_technical' }
  ];
  const BULK_FIELDS = [
    { key: 'statusId', labelKey: 'ui.operations.field.status', control: 'status', group: 'status' },
    { key: 'assigneeId', labelKey: 'ui.operations.field.owner', control: 'person', group: 'status' },
    { key: 'site', labelKey: 'ui.operations.field.site', control: 'site', group: 'location' },
    { key: 'locationId', labelKey: 'ui.operations.field.location', control: 'location', group: 'location' },
    { key: 'brand', labelKey: 'ui.operations.field.brand', control: 'text', group: 'common' },
    { key: 'model', labelKey: 'ui.operations.field.model', control: 'text', group: 'common' },
    { key: 'serial', labelKey: 'ui.operations.field.serial', control: 'text', group: 'common' },
    { key: 'ip', labelKey: 'ui.operations.field.ip', control: 'text', group: 'common' },
    { key: 'cost', labelKey: 'ui.operations.field.cost', control: 'number', group: 'common' }
  ];

  function bulkField(source) {
    return {
      key: source.key,
      label: source.labelKey ? tr(source.labelKey) : source.label,
      control: source.control,
      group: source.group,
      options: source.options
    };
  }

  function bulkText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function bulkDisplay(value) {
    if (value === true) return tr('ui.operations.value.yes');
    if (value === false) return tr('ui.operations.value.no');
    const text = bulkText(value).trim();
    return text === '' ? tr('ui.operations.value.empty') : text;
  }

  /* La edición masiva conserva los cuatro pasos y los controles de siempre,
   * pero la vista previa y el resultado son los del servidor: primero se pide
   * la previsualización fija, después la aprueba una persona autorizada y solo
   * entonces se ejecuta. Ningún cambio se calcula ni se persiste en el navegador. */
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
        selection: (this.ids || []).slice(),
        query: '',
        fields: {},
        values: {},
        errors: {},
        rows: [],
        result: null,
        submitted: false,
        busy: false,
        message: ''
      };
    },
    computed: {
      // En una sesión autenticada la lista es la página canónica del
      // inventario: el conjunto de demostración del prototipo nunca se mezcla.
      serverMode() {
        return this.app.serverInventory === true;
      },
      context() {
        return {
          assets: this.assets,
          admin: this.app.assetAdmin,
          sites: this.app.sites,
          people: this.app.people,
          actor: Engine.actorOf(this.app)
        };
      },
      assets() {
        if (this.serverMode) {
          return Array.isArray(this.app.inventoryItems) ? this.app.inventoryItems : [];
        }
        return Array.isArray(this.app.assets) ? this.app.assets : [];
      },
      selectionAssets() {
        return this.selection.map((id) => {
          const found = this.assets.find((asset) => asset.id === id);
          return found || { id: id, name: id, code: '', serverAsset: true };
        });
      },
      visibleAssets() {
        const query = lower(this.query.trim());
        const list = this.assets.slice();
        if (!query) return list;
        return list.filter((asset) => {
          return [asset.name, asset.code, asset.id, asset.type, asset.site]
            .join(' ')
            .toLocaleLowerCase(runtime() ? runtime().activeLocale : undefined)
            .indexOf(query) !== -1;
        });
      },
      catalog() {
        if (!this.serverMode) return Engine.bulkCatalog(this.context, this.selectionAssets).map(bulkField);
        const fields = BULK_FIELDS.map(bulkField);
        const seen = {};
        this.selectionAssets.forEach((asset) => {
          this.techFieldsOf(asset).forEach((field) => {
            if (seen[field.key]) return;
            seen[field.key] = true;
            fields.push(field);
          });
        });
        return fields;
      },
      groups() {
        return BULK_GROUPS
          .map((group) => ({ name: tr(group.labelKey), fields: this.catalog.filter((field) => field.group === group.id) }))
          .filter((group) => group.fields.length);
      },
      selectedKeys() {
        return Object.keys(this.fields).filter((key) => this.fields[key]);
      },
      steps() {
        return [
          { id: 1, label: this.$t('ui.operations.bulk.step_assets'), hint: this.$t('ui.operations.bulk.step_assets_hint') },
          { id: 2, label: this.$t('ui.operations.bulk.step_fields'), hint: this.$t('ui.operations.bulk.step_fields_hint') },
          { id: 3, label: this.$t('ui.operations.bulk.step_preview'), hint: this.$t('ui.operations.bulk.step_preview_hint') },
          { id: 4, label: this.$t('ui.operations.bulk.step_summary'), hint: this.$t('ui.operations.bulk.step_summary_hint') }
        ];
      },
      commonSite() {
        const sites = this.selectionAssets.map((asset) => this.siteIdOf(asset));
        const first = sites[0] || '';
        return sites.length && sites.every((site) => site === first) ? first : '';
      },
      locationSourceSite() {
        return this.values.site || this.commonSite;
      },
      locationOptions() {
        const siteId = this.locationSourceSite;
        const site = (this.app.sites || []).find((item) => item.id === siteId);
        if (site && Array.isArray(site.locations) && site.locations.length) return site.locations;
        if (this.serverMode && typeof this.app.assetSiteLocations === 'function') {
          return this.app
            .assetSiteLocations(siteId)
            .map((location) => ({ id: location.id, label: location.label || location.name || location.id }));
        }
        return [];
      },
      counts() {
        const applied = this.rows.filter((row) => !row.skipped && row.changes.length);
        const unchanged = this.rows.filter((row) => !row.skipped && !row.changes.length);
        const skipped = this.rows.filter((row) => row.skipped);
        return { applied: applied.length, unchanged: unchanged.length, skipped: skipped.length };
      },
      statusOptions() {
        if (!this.serverMode) return Engine.openStatuses(this.app.assetAdmin);
        const choices = Array.isArray(this.app.inventoryStatusChoices) ? this.app.inventoryStatusChoices : [];
        return choices
          .filter((status) => !status.final)
          .map((status) => ({ id: status.value, label: status.label, final: false }));
      },
      peopleOptions() {
        if (this.serverMode) {
          const directory = this.app.organization && this.app.organization.people;
          const items = directory && Array.isArray(directory.items) ? directory.items : [];
          return items
            .filter((person) => person.active !== false)
            .map((person) => ({ id: person.id, name: person.name || person.label || person.id }));
        }
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
        this.busy = false;
        this.message = '';
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
      siteIdOf(asset) {
        if (!asset) return '';
        return this.serverMode ? (asset.siteId || '') : (asset.site || '');
      },
      siteLabel(value) {
        const id = bulkText(value);
        const sites = Array.isArray(this.app.sites) ? this.app.sites : [];
        const found = sites.find((site) => site.id === id);
        if (found) return found.label || found.name || '';
        return id || this.$t('ui.operations.value.no_site');
      },
      techFieldsOf(asset) {
        if (!this.serverMode) {
          return Schema.techFields(this.app.assetAdmin, asset ? asset.category : '').map((field) => ({
            key: 'tech.' + field.key,
            label: field.label,
            control: BULK_CONTROLS[field.type] || 'text',
            group: 'technical',
            options: Array.isArray(field.options) ? field.options : []
          }));
        }
        if (!asset || typeof this.app.inventoryTechnicalFields !== 'function') return [];
        return this.app.inventoryTechnicalFields(asset.category).map((field) => ({
          key: 'tech.' + field.key,
          label: field.label || field.key,
          control: BULK_CONTROLS[field.type] || 'text',
          group: 'technical',
          options: Array.isArray(field.options) ? field.options : []
        }));
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
        const first = this.selectionAssets[0] || {};
        if (field.control === 'status') {
          const status = this.statusOptions.find((item) => item.id !== first.statusId);
          return status ? status.id : '';
        }
        if (field.control === 'person') return '';
        if (field.control === 'site') return this.commonSite || (this.siteOptionsData[0] ? this.siteOptionsData[0].id : '');
        if (field.control === 'location') return '';
        if (field.control === 'boolean') return 'true';
        if (field.control === 'select') return field.options && field.options.length ? field.options[0] : '';
        return '';
      },
      setValue(key, value) {
        this.values = Object.assign({}, this.values, { [key]: value });
        if (key === 'site' && this.fields.locationId) {
          const site = (this.app.sites || []).find((item) => item.id === value);
          const locations = this.app.assetSiteLocations && this.serverMode
            ? this.app.assetSiteLocations(value)
            : (site && site.locations) || [];
          this.values = Object.assign({}, this.values, { locationId: locations.length ? locations[0].id : '' });
        }
      },
      validate() {
        const errors = {};
        this.selectedKeys.forEach((key) => {
          const field = this.catalog.find((item) => item.key === key);
          if (!field) return;
          const value = this.values[key];
          if (field.control === 'status' && !value) errors[key] = this.$t('ui.operations.bulk.error_status');
          if (field.control === 'site' && !value) errors[key] = this.$t('ui.operations.bulk.error_site');
          if ((field.control === 'text' || field.control === 'date' || field.control === 'number') && String(value === undefined ? '' : value).trim() === '') {
            errors[key] = this.$t('ui.operations.bulk.error_value');
          }
        });
        this.errors = errors;
        return Object.keys(errors).length === 0;
      },
      technicalValue(field, value) {
        if (!field) return value;
        if (field.control === 'boolean') return value === true || value === 'true';
        if (field.control === 'number') {
          const number = Number(bulkText(value).trim());
          return bulkText(value).trim() !== '' && Number.isFinite(number) ? number : value;
        }
        return value;
      },
      // Solo los campos marcados viajan al servidor, con su nombre canónico.
      canonicalChanges() {
        const changes = {};
        const technical = {};
        this.selectedKeys.forEach((key) => {
          const field = this.catalog.find((item) => item.key === key);
          const value = this.values[key];
          if (key === 'statusId') {
            if (value) changes.status = value;
          } else if (key === 'assigneeId') {
            changes.responsible_person_id = value === '' ? null : value;
          } else if (key === 'site') {
            if (value) changes.site_id = value;
          } else if (key === 'locationId') {
            changes.location_id = value === '' ? null : value;
          } else if (key.indexOf('tech.') === 0) {
            technical[key.slice(5)] = this.technicalValue(field, value);
          } else if (key === 'cost') {
            changes.cost = value === '' || value === undefined ? null : value;
          } else {
            changes[key] = value;
          }
        });
        if (Object.keys(technical).length) changes.technical = technical;
        return changes;
      },
      async toPreview() {
        if (this.busy) return;
        if (!this.selection.length) return;
        if (!this.selectedKeys.length) {
          this.errors = { general: this.$t('ui.operations.bulk.error_no_fields') };
          return;
        }
        if (!this.validate()) return;
        const changes = this.canonicalChanges();
        if (!Object.keys(changes).length) {
          this.errors = { general: this.$t('ui.operations.bulk.error_no_fields') };
          return;
        }
        if (typeof this.app.bulkPreviewPhase6 !== 'function') {
          this.errors = { general: this.$t('ui.operations.bulk.error_unavailable') };
          return;
        }
        const targets = this.selectionAssets
          .filter((asset) => !asset.retired && this.assets.some((loaded) => loaded.id === asset.id))
          .map((asset) => asset.id);
        this.busy = true;
        this.message = '';
        this.errors = {};
        try {
          if (targets.length) {
            const response = await this.app.bulkPreviewPhase6({ assetIds: targets, changes: changes, action: 'update' });
            if (!response || !response.ok) {
              this.errors = { general: (response && response.error) || this.$t('ui.operations.bulk.error_preview') };
              return;
            }
          }
          this.rows = this.projectRows(targets, changes);
          this.step = 3;
        } finally {
          this.busy = false;
        }
      },
      projectRows(targets, changes) {
        const operation = this.app.phase6 && this.app.phase6.operation ? this.app.phase6.operation.rows : [];
        const receipts = {};
        (Array.isArray(operation) ? operation : []).forEach((row, index) => {
          if (!row || !row.assetId) return;
          receipts[row.assetId] = Object.assign({ index: typeof row.index === 'number' ? row.index : index }, row);
        });
        return this.selectionAssets.map((asset) => {
          if (asset.retired) {
            return { asset: asset, skipped: true, skipReason: this.$t('ui.operations.bulk.skip_retired'), changes: [], warnings: [], classification: 'omitted', rowIndex: null };
          }
          if (targets.indexOf(asset.id) === -1) {
            return { asset: asset, skipped: true, skipReason: this.$t('ui.operations.bulk.skip_unloaded'), changes: [], warnings: [], classification: 'omitted', rowIndex: null };
          }
          const receipt = receipts[asset.id];
          if (!receipt) {
            return { asset: asset, skipped: true, skipReason: this.$t('ui.operations.bulk.skip_missing'), changes: [], warnings: [], classification: 'omitted', rowIndex: null };
          }
          const errors = Array.isArray(receipt.errors) ? receipt.errors : [];
          const skipped = receipt.classification === 'error' || receipt.classification === 'omitted' || errors.length > 0;
          return {
            asset: asset,
            skipped: skipped,
            skipReason: skipped ? (errors.join(' · ') || this.$t('ui.operations.bulk.skip_server')) : '',
            changes: skipped ? [] : this.changesFor(asset, changes),
            warnings: [],
            classification: receipt.classification,
            rowIndex: receipt.index
          };
        });
      },
      changesFor(asset, changes) {
        const list = [];
        const add = (field, label, before, after) => {
          if (bulkText(before) === bulkText(after)) return;
          list.push({ field: field, label: label, before: bulkDisplay(before), after: bulkDisplay(after) });
        };
        Object.keys(changes).forEach((key) => {
          const value = changes[key];
          if (key === 'status') {
            add('status', this.$t('ui.operations.field.status'), asset.status, this.statusName(value));
            return;
          }
          if (key === 'responsible_person_id') {
            add('assigneeId', this.$t('ui.operations.field.owner'), asset.responsible || asset.assignee, this.personName(value));
            return;
          }
          if (key === 'site_id') {
            add('site', this.$t('ui.operations.field.site'), asset.site, this.siteLabel(value));
            return;
          }
          if (key === 'location_id') {
            add('locationId', this.$t('ui.operations.field.location'), asset.location, this.locationName(changes.site_id || asset.siteId, value));
            return;
          }
          if (key === 'technical') {
            const technical = asset.tech && typeof asset.tech === 'object' ? asset.tech : {};
            Object.keys(value).forEach((name) => {
              add('tech.' + name, this.techLabel(name), technical[name], value[name]);
            });
            return;
          }
          const field = this.catalog.find((item) => item.key === key);
          add(key, field ? field.label : key, asset[key], value);
        });
        return list;
      },
      statusName(id) {
        const status = this.statusOptions.find((item) => item.id === id);
        return status ? status.label : id;
      },
      personName(id) {
        if (!bulkText(id)) return '';
        const person = this.peopleOptions.find((item) => item.id === id);
        return person ? person.name : id;
      },
      locationName(siteId, id) {
        if (!bulkText(id)) return '';
        const options = (this.app.sites || []).find((item) => item.id === siteId) && Array.isArray((this.app.sites || []).find((item) => item.id === siteId).locations)
          ? (this.app.sites || []).find((item) => item.id === siteId).locations
          : this.serverMode && typeof this.app.assetSiteLocations === 'function' ? this.app.assetSiteLocations(siteId) : [];
        const found = options.find((location) => location.id === id);
        return found ? (found.label || found.name || id) : id;
      },
      techLabel(key) {
        const field = this.catalog.find((item) => item.key === 'tech.' + key);
        return field ? field.label : key;
      },
      fail(message) {
        this.message = message || this.$t('ui.operations.bulk.error_rejected');
        if (this.app.showToast) this.app.showToast(this.message, 'error');
      },
      async apply() {
        if (this.busy) return;
        if (!this.counts.applied) return;
        if (typeof this.app.approvePhase6Operation !== 'function' || typeof this.app.executePhase6Operation !== 'function') {
          this.fail(this.$t('ui.operations.bulk.error_unavailable_apply'));
          return;
        }
        this.busy = true;
        this.message = '';
        try {
          // Las filas que el servidor marcó con error se omiten tal como se
          // muestran en la vista previa; sin esa resolución el servidor no
          // permite aprobar el lote.
          const errors = this.rows.filter((row) => row.classification === 'error' && typeof row.rowIndex === 'number');
          for (let index = 0; index < errors.length; index += 1) {
            const resolved = await this.app.resolvePhase6Row(errors[index].rowIndex, 'skip');
            if (!resolved || !resolved.ok) {
              this.fail((resolved && resolved.error) || this.$t('ui.operations.bulk.error_skip'));
              return;
            }
          }
          const approved = await this.app.approvePhase6Operation();
          if (!approved || !approved.ok) {
            this.fail((approved && approved.error) || this.$t('ui.operations.bulk.error_approve'));
            return;
          }
          const executed = await this.app.executePhase6Operation();
          if (!executed || !executed.ok) {
            this.fail((executed && executed.error) || this.$t('ui.operations.bulk.error_execute'));
            return;
          }
          this.finish();
        } finally {
          this.busy = false;
        }
      },
      finish() {
        const operation = this.app.phase6 && this.app.phase6.operation ? this.app.phase6.operation : { rows: [], summary: {} };
        const receipts = {};
        (Array.isArray(operation.rows) ? operation.rows : []).forEach((row) => {
          if (row && row.assetId) receipts[row.assetId] = row;
        });
        const applied = [];
        const failed = [];
        this.rows = this.rows.map((row) => {
          const receipt = receipts[row.asset.id];
          const state = receipt && receipt.result ? receipt.result : '';
          const next = Object.assign({}, row, {
            result: state,
            failed: state === 'failed',
            skipped: state === 'omitted' || (!state && row.skipped)
          });
          if (state === 'modified') applied.push(row.asset);
          if (state === 'failed') failed.push({ asset: row.asset, error: (receipt && receipt.error) || '' });
          return next;
        });
        const summary = operation.summary && typeof operation.summary === 'object'
          ? operation.summary
          : { created: 0, modified: applied.length, omitted: 0, failed: failed.length };
        this.result = { applied: applied, failed: failed, rows: this.rows, summary: summary };
        this.step = 4;
        if (this.app.showToast) {
          this.app.showToast(this.$t('ui.operations.bulk.toast', {
            modified: Number(summary.modified) || 0,
            created: Number(summary.created) || 0,
            omitted: Number(summary.omitted) || 0,
            failed: Number(summary.failed) || 0
          }));
        }
        if (typeof this.app.loadInventory === 'function') this.app.loadInventory({ resetOffset: true });
        this.$emit('applied', this.result);
      },
      back() {
        if (this.step > 1) this.step -= 1;
      },
      close() {
        this.$emit('close');
      },
      changeText(change) {
        return bulkDisplay(change.before) + ' → ' + bulkDisplay(change.after);
      },
      rowState(row) {
        if (row.failed) return this.$t('ui.operations.bulk.row_failed');
        if (row.skipped) return this.$t('ui.operations.bulk.row_skipped');
        return row.changes.length ? this.$t('ui.operations.bulk.row_updated') : this.$t('ui.operations.bulk.row_unchanged');
      }
    },
    template: `
      <modal-shell :open="open" :title="$t('ui.operations.bulk.title')" :eyebrow="$t('ui.operations.bulk.eyebrow')" size="xl" @close="close">
        <div class="flow">
          <ol class="flow-steps flow-steps--four" :aria-label="$t('ui.operations.bulk.steps')">
            <li v-for="item in steps" :key="item.id" class="flow-step"
                :class="{ 'is-active': step === item.id, 'is-done': step > item.id }"
                :aria-current="step === item.id ? 'step' : null">
              <span class="flow-step__num">{{ step > item.id ? '✓' : item.id }}</span>
              <span class="flow-step__copy"><strong>{{ item.label }}</strong></span>
            </li>
          </ol>

          <div v-if="step === 1" class="flow-body">
            <div class="bulk-head">
              <div>
                <strong>{{ $t('ui.operations.bulk.selected', { count: selectedCount }) }}</strong>
                <p>{{ $t('ui.operations.bulk.selected_hint') }}</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" @click="selectVisible">{{ allVisibleSelected() ? $t('ui.operations.bulk.deselect_visible') : $t('ui.operations.bulk.select_visible') }}</button>
            </div>

            <div class="search-field bulk-search">
              <app-icon name="search"></app-icon>
              <label class="sr-only" for="bulk-search">{{ $t('ui.operations.bulk.search_label') }}</label>
              <input id="bulk-search" v-model="query" type="search" :placeholder="$t('ui.operations.bulk.search_placeholder')" autocomplete="off">
              <button v-if="query" class="search-clear" type="button" :aria-label="$t('ui.operations.history.clear_search')" @click="query = ''">
                <app-icon name="close"></app-icon>
              </button>
            </div>

            <ul class="bulk-assets">
              <li v-for="asset in visibleAssets" :key="asset.id" class="bulk-asset" :class="{ 'is-selected': isSelected(asset.id), 'is-retired': asset.retired }">
                <label class="bulk-asset__check">
                  <input type="checkbox" :checked="isSelected(asset.id)" @change="toggleAsset(asset.id)" :aria-label="$t('ui.operations.bulk.include_asset', { name: asset.name })">
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
            <p class="bulk-lead">{{ $t('ui.operations.bulk.fields_lead') }}</p>
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
                        <option value="">{{ $t('ui.operations.value.no_owner') }}</option>
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
                        <option value="">{{ $t('ui.operations.value.no_location') }}</option>
                        <option v-for="location in locationOptions" :key="location.id" :value="location.id">{{ location.label }}</option>
                      </select>
                    </div>
                    <div v-else-if="field.control === 'boolean'" class="input-shell input-shell--plain">
                      <app-icon name="check"></app-icon>
                      <select :id="'bulk-' + field.key" :value="values[field.key]" @change="setValue(field.key, $event.target.value)">
                        <option value="true">{{ $t('ui.operations.value.yes') }}</option>
                        <option value="false">{{ $t('ui.operations.value.no') }}</option>
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
                             :placeholder="field.control === 'number' ? $t('ui.operations.bulk.amount_placeholder') : $t('ui.operations.bulk.value_placeholder')" @input="setValue(field.key, $event.target.value)">
                    </div>
                    <p v-if="errors[field.key]" class="field__error">{{ errors[field.key] }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="step === 3" class="flow-body">
            <div class="bulk-summary">
              <div><span class="bulk-summary__value mono">{{ rows.length }}</span><span>{{ $t('ui.operations.bulk.summary_assets') }}</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.applied }}</span><span>{{ $t('ui.operations.bulk.summary_updated') }}</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.unchanged }}</span><span>{{ $t('ui.operations.bulk.summary_unchanged') }}</span></div>
              <div><span class="bulk-summary__value mono">{{ counts.skipped }}</span><span>{{ $t('ui.operations.bulk.summary_skipped') }}</span></div>
            </div>

            <p v-if="message" class="form-error" role="alert">{{ message }}</p>

            <div class="bulk-preview">
              <div class="bulk-preview__head">
                <span>{{ $t('ui.operations.field.asset') }}</span>
                <span>{{ $t('ui.operations.bulk.changes') }}</span>
                <span>{{ $t('ui.operations.bulk.warnings') }}</span>
              </div>
              <div v-for="row in rows" :key="row.asset.id" class="bulk-preview__row" :class="{ 'is-skipped': row.skipped }">
                <div class="bulk-preview__asset">
                  <strong>{{ row.asset.name }}</strong>
                  <span class="mono">{{ row.asset.code }} · {{ row.asset.id }}</span>
                </div>
                <div class="bulk-preview__changes">
                  <p v-for="(change, index) in row.changes" :key="'pc-' + index">{{ change.label }}: <span class="review-old">{{ change.before }}</span> → <span class="review-new">{{ change.after }}</span></p>
                  <p v-if="row.skipped" class="cell-muted">{{ row.skipReason }}</p>
                  <p v-else-if="!row.changes.length" class="cell-muted">{{ row.skipReason || $t('ui.operations.bulk.row_unchanged') }}</p>
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
            <h3>{{ $t('ui.operations.bulk.result_title') }}</h3>
            <p>{{ $t('ui.operations.bulk.result_lead', { count: result.applied.length }) }}<span v-if="result.failed.length"> {{ $t('ui.operations.bulk.result_failed', { count: result.failed.length }) }}</span></p>

            <dl class="review-list review-list--result">
              <div v-for="row in result.rows" :key="'res-' + row.asset.id" class="review-row">
                <dt>{{ row.asset.name }}</dt>
                <dd>
                  <span v-if="row.failed" class="chip chip--muted">{{ $t('ui.operations.bulk.row_failed') }}</span>
                  <span v-else-if="row.skipped" class="chip chip--muted">{{ $t('ui.operations.bulk.row_skipped') }}</span>
                  <span v-else-if="!row.changes.length" class="chip chip--muted">{{ $t('ui.operations.bulk.row_unchanged') }}</span>
                  <span v-else class="timeline__new">{{ $t('ui.operations.bulk.result_fields', { count: row.changes.length }) }}</span>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <template #footer>
          <template v-if="step === 1">
            <span class="modal-foot__note">{{ $t('ui.operations.bulk.footer_count', { count: selectedCount }) }}</span>
            <button type="button" class="btn btn--ghost" @click="close">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--primary" :disabled="!selectedCount" data-od-id="bulk-continue" @click="step = 2">{{ $t('ui.operations.bulk.choose_fields') }}</button>
          </template>
          <template v-else-if="step === 2">
            <button type="button" class="btn btn--ghost" @click="back">{{ $t('ui.operations.move.back') }}</button>
            <button type="button" class="btn btn--primary" :disabled="busy" data-od-id="bulk-preview" @click="toPreview">{{ $t('ui.operations.bulk.preview') }}</button>
          </template>
          <template v-else-if="step === 3">
            <button type="button" class="btn btn--ghost" @click="back">{{ $t('ui.operations.move.back') }}</button>
            <button type="button" class="btn btn--primary" :disabled="busy || !counts.applied" data-od-id="bulk-apply" @click="apply">{{ $t('ui.operations.bulk.confirm') }}</button>
          </template>
          <template v-else>
            <button type="button" class="btn btn--primary" @click="close">{{ $t('ui.common.close') }}</button>
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
