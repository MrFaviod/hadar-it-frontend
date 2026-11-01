(function () {
  'use strict';

  const Engine = window.AssetRelations;
  const RelationsData = window.AssetRelationsData;
  const TYPE_ICONS = ['network', 'layers', 'building', 'battery', 'activity', 'refresh', 'box', 'server', 'package'];
  const TONES = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
  // Static keys per option: the label is resolved when it renders, so switching
  // the language relabels the grouping selector instead of freezing the copy.
  const GROUPS = [
    { id: 'category', key: 'ui.relations.group.category' },
    { id: 'site', key: 'ui.relations.group.site' },
    { id: 'none', key: 'ui.relations.group.none' }
  ];
  const TONE_KEYS = {
    network: 'ui.relations.tone.network',
    virtual: 'ui.relations.tone.virtual',
    physical: 'ui.relations.tone.physical',
    power: 'ui.relations.tone.power',
    dependency: 'ui.relations.tone.dependency',
    link: 'ui.relations.tone.link'
  };

  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  function toneLabel(tone) {
    const key = TONE_KEYS[tone];
    return key ? tr(key) : tone;
  }

  function blankDraft() {
    return { typeId: '', targetId: '', note: '' };
  }

  function blankType() {
    return { id: '', label: '', inverse: '', directed: true, icon: 'network', tone: 'network', description: '' };
  }

  window.AssetRelationViews = {
    AssetRelations: {
      name: 'AssetRelations',
      components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
      props: {
        asset: { type: Object, required: true },
        app: { type: Object, required: true }
      },
      data() {
        return {
          open: false,
          draft: blankDraft(),
          errors: { type: '', target: '', general: '' },
          search: '',
          pendingRemove: ''
        };
      },
      computed: {
        rows() {
          return Engine.rowsFor(this.app, this.asset.id);
        },
        types() {
          return Engine.suggestTypes(this.app, this.asset);
        },
        selectedType() {
          return Engine.typeById(this.app, this.draft.typeId);
        },
        typeHint() {
          if (!this.selectedType) return tr('ui.relations.type_hint_default');
          return this.selectedType.description || Engine.typeLabel(this.selectedType, true) + ' · ' + Engine.typeLabel(this.selectedType, false);
        },
        candidates() {
          if (!this.draft.typeId) return [];
          return Engine.candidates(this.app, this.asset.id, this.draft.typeId);
        },
        filteredCandidates() {
          const needle = this.search.trim().toLocaleLowerCase('es');
          if (!needle) return this.candidates;
          return this.candidates.filter((asset) => {
            return (asset.name + ' ' + asset.code + ' ' + asset.id).toLocaleLowerCase('es').indexOf(needle) !== -1;
          });
        },
        canEdit() {
          if (this.asset.retired) return false;
          return typeof this.app.can === 'function' ? this.app.can('assets.edit') : true;
        }
      },
      watch: {
        'asset.id'() {
          this.open = false;
          this.pendingRemove = '';
          this.draft = blankDraft();
          this.errors = { type: '', target: '', general: '' };
        }
      },
      methods: {
        openDialog() {
          this.draft = blankDraft();
          this.search = '';
          this.errors = { type: '', target: '', general: '' };
          const suggested = this.types.length ? this.types[0].id : '';
          this.draft.typeId = suggested;
          this.open = true;
        },
        closeDialog() {
          this.open = false;
        },
        submit() {
          const result = Engine.createLink(this.app, this.asset.id, this.draft);
          if (!result.ok) {
            this.errors = result.errors;
            return;
          }
          const target = Engine.assetById(this.app, result.link.to);
          this.open = false;
          this.app.showToast(target
            ? tr('ui.relations.toast.created_with', { name: target.name })
            : tr('ui.relations.toast.created_generic'));
        },
        confirmRemove(row) {
          const result = Engine.removeLink(this.app, row.id);
          this.pendingRemove = '';
          if (!result.ok) {
            this.app.showToast(result.error || tr('ui.relations.toast.remove_failed'), 'error');
            return;
          }
          this.app.showToast(tr('ui.relations.toast.removed_with', { name: row.other.name }));
        },
        openAsset(asset) {
          this.app.openAsset(asset);
        },
        openGraph() {
          this.app.setHash(this.app.hashFor({ name: 'graph', focusId: this.asset.id }));
        },
        categoryLabel(id) {
          return RelationsData.categoryLabel(id);
        },
        siteLabel(id) {
          const site = (this.app.sites || []).find((item) => item.id === id);
          return site ? site.label : tr('ui.relations.no_site');
        }
      },
      template: `
        <section class="operations-panel relations-panel" aria-labelledby="relations-title" data-od-id="asset-relations">
          <header class="panel-head">
            <div>
              <p class="eyebrow">{{ $t('ui.relations.eyebrow') }}</p>
              <h2 id="relations-title">{{ $t('ui.relations.panel.title') }}</h2>
              <p class="relations-panel__lead">{{ $t('ui.relations.panel.lead') }}</p>
            </div>
            <div class="relations-panel__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="openGraph">
                <app-icon name="network"></app-icon> {{ $t('ui.relations.panel.open_graph') }}
              </button>
              <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="add-relation" @click="openDialog">
                <app-icon name="plus"></app-icon> {{ $t('ui.relations.add') }}
              </button>
            </div>
          </header>

          <p v-if="asset.retired && rows.length" class="relations-panel__note">
            <app-icon name="info"></app-icon>
            {{ $t('ui.relations.panel.retired_note') }}
          </p>

          <ul v-if="rows.length" class="relations-list">
            <li v-for="row in rows" :key="row.id" class="relations-row" :class="{ 'is-confirming': pendingRemove === row.id }">
              <span class="relations-row__icon" :class="'relations-row__icon--' + row.type.tone">
                <app-icon :name="row.type.icon"></app-icon>
              </span>
              <div class="relations-row__copy">
                <span class="relations-row__type">{{ row.label }}</span>
                <button type="button" class="relations-row__name" @click="openAsset(row.other)">{{ row.other.name }}</button>
                <span class="mono relations-row__code">{{ row.other.code }} · {{ categoryLabel(row.other.category) }} · {{ siteLabel(row.other.site) }}</span>
                <p v-if="row.link.note" class="relations-row__note">{{ row.link.note }}</p>
              </div>
              <div class="relations-row__actions">
                <template v-if="pendingRemove === row.id">
                  <button type="button" class="btn btn--danger btn--small" @click="confirmRemove(row)">{{ $t('ui.relations.remove_link') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="pendingRemove = ''">{{ $t('ui.common.cancel') }}</button>
                </template>
                <template v-else>
                  <button type="button" class="icon-button icon-button--small" :aria-label="$t('ui.relations.open_asset_aria', { name: row.other.name })" @click="openAsset(row.other)">
                    <app-icon name="arrow-up-right"></app-icon>
                  </button>
                  <button v-if="canEdit" type="button" class="icon-button icon-button--small icon-button--danger"
                          :aria-label="$t('ui.relations.remove_link_aria', { name: row.other.name })" @click="pendingRemove = row.id">
                    <app-icon name="trash"></app-icon>
                  </button>
                </template>
              </div>
            </li>
          </ul>

          <div v-else class="relations-empty">
            <span class="relations-empty__icon"><app-icon name="network"></app-icon></span>
            <div>
              <h3>{{ $t('ui.relations.empty.title') }}</h3>
              <p>{{ $t('ui.relations.empty.body') }}</p>
              <button v-if="canEdit" type="button" class="text-button" @click="openDialog">
                <app-icon name="plus"></app-icon> {{ $t('ui.relations.empty.action') }}
              </button>
            </div>
          </div>
        </section>

        <modal-shell :open="open" :title="$t('ui.relations.add')" :eyebrow="$t('ui.relations.dialog.eyebrow')" @close="closeDialog">
          <form id="relation-form" class="form-stack" @submit.prevent="submit" novalidate>
            <p class="form-intro"><strong>{{ asset.name }}</strong> <span class="mono">{{ asset.code }}</span>. {{ $t('ui.relations.dialog.intro') }}</p>

            <div class="field" :class="{ 'field--invalid': errors.type }">
              <label for="relation-type">{{ $t('ui.relations.field.type') }}</label>
              <div class="select-shell">
                <select id="relation-type" v-model="draft.typeId" :aria-describedby="'relation-type-hint'" :aria-invalid="!!errors.type">
                  <option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }} / {{ type.inverse }}</option>
                </select>
              </div>
              <p id="relation-type-hint" class="field__hint">{{ typeHint }}</p>
              <p v-if="errors.type" class="field__error">{{ errors.type }}</p>
            </div>

            <div class="field" :class="{ 'field--invalid': errors.target }">
              <label for="relation-search">{{ $t('ui.relations.field.target') }}</label>
              <div class="input-shell input-shell--plain">
                <app-icon name="search"></app-icon>
                <input id="relation-search" v-model="search" type="search" :placeholder="$t('ui.relations.filter_placeholder')" autocomplete="off">
              </div>
              <div class="select-shell">
                <select id="relation-target" v-model="draft.targetId" size="6" :aria-invalid="!!errors.target" aria-describedby="relation-target-hint">
                  <option v-for="candidate in filteredCandidates" :key="candidate.id" :value="candidate.id">
                    {{ candidate.name }} · {{ candidate.code }} · {{ siteLabel(candidate.site) }}
                  </option>
                </select>
              </div>
              <p id="relation-target-hint" class="field__hint">
                {{ $t('ui.relations.available', { count: filteredCandidates.length }) }}
              </p>
              <p v-if="errors.target" class="field__error">{{ errors.target }}</p>
            </div>

            <div class="field">
              <label for="relation-note">{{ $t('ui.relations.field.note') }} <span class="field__optional">{{ $t('ui.relations.optional') }}</span></label>
              <textarea id="relation-note" v-model="draft.note" rows="2" maxlength="240"
                        :placeholder="$t('ui.relations.note_placeholder')"></textarea>
              <p class="field__hint">{{ $t('ui.relations.note_hint') }}</p>
            </div>

            <p v-if="errors.general" class="form-error" role="alert">{{ errors.general }}</p>
          </form>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeDialog">{{ $t('ui.common.cancel') }}</button>
            <button type="submit" form="relation-form" class="btn btn--primary">{{ $t('ui.relations.submit_create') }}</button>
          </template>
        </modal-shell>
      `
    },

    RelationsSettings: {
      name: 'RelationsSettings',
      components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
      props: {
        app: { type: Object, required: true }
      },
      data() {
        return {
          draft: blankType(),
          typeErrors: { label: '', inverse: '', general: '' },
          open: false,
          blockedMessage: '',
          pendingType: '',
          prefsDraft: {
            mode: 'global',
            depth: 2,
            group: 'category',
            showLabels: true,
            animate: true
          },
          types: TYPE_ICONS,
          tones: TONES,
          groups: GROUPS
        };
      },
      computed: {
        relationTypes() {
          return (this.app.relations && this.app.relations.types) || [];
        },
        counts() {
          return Engine.counts(this.app);
        },
        rows() {
          return this.relationTypes.map((type) => ({
            type: type,
            usage: Engine.typeUsage(this.app, type.id),
            toneLabel: toneLabel(type.tone)
          }));
        },
        canEdit() {
          return typeof this.app.can === 'function' ? this.app.can('assets.edit') : true;
        }
      },
      watch: {
        'app.graphPrefs': {
          deep: true,
          handler(prefs) {
            this.prefsDraft = {
              mode: prefs.mode === 'focus' ? 'focus' : 'global',
              depth: prefs.depth || 2,
              group: prefs.group || 'category',
              showLabels: prefs.showLabels !== false,
              animate: prefs.animate !== false
            };
          }
        }
      },
      mounted() {
        this.syncPrefs();
      },
      methods: {
        syncPrefs() {
          const prefs = this.app.graphPrefs || {};
          this.prefsDraft = {
            mode: prefs.mode === 'focus' ? 'focus' : 'global',
            depth: prefs.depth || 2,
            group: prefs.group || 'category',
            showLabels: prefs.showLabels !== false,
            animate: prefs.animate !== false
          };
        },
        openTypeDialog(type) {
          this.draft = type
            ? {
              id: type.id, label: type.label, inverse: type.inverse, directed: type.directed !== false,
              icon: type.icon, tone: type.tone, description: type.description || ''
            }
            : blankType();
          this.typeErrors = { label: '', inverse: '', general: '' };
          this.open = true;
        },
        closeTypeDialog() {
          this.open = false;
        },
        groupLabel(group) {
          return tr(group.key);
        },
        submitType() {
          const result = Engine.saveType(this.app, this.draft);
          if (!result.ok) {
            this.typeErrors = result.errors;
            return;
          }
          this.open = false;
          this.app.showToast(this.draft.id
            ? tr('ui.relations.toast.type_updated')
            : tr('ui.relations.toast.type_created'));
        },
        requestRemoveType(row) {
          this.blockedMessage = '';
          if (row.usage) {
            this.blockedMessage = tr('ui.relations.settings.blocked_type_in_use', { type: row.type.label, count: row.usage });
            return;
          }
          this.pendingType = row.type.id;
        },
        confirmRemoveType(row) {
          const result = Engine.removeType(this.app, row.type.id);
          this.pendingType = '';
          if (!result.ok) {
            this.blockedMessage = result.error;
            return;
          }
          this.app.showToast(tr('ui.relations.toast.type_removed'));
        },
        restoreTypes() {
          const result = Engine.restoreTypes(this.app);
          this.blockedMessage = '';
          this.app.showToast(tr('ui.relations.toast.types_restored'));
          if (result.removedLinks) {
            this.app.showToast(tr('ui.relations.toast.links_removed', { count: result.removedLinks }), 'error');
          }
        },
        savePrefs() {
          Engine.savePrefs(this.app, this.prefsDraft);
          this.app.showToast(tr('ui.relations.settings.prefs_saved'));
        },
        usageLabel(value) {
          return tr('ui.relations.usage', { count: value });
        }
      },
      template: `
        <section class="config-section" aria-labelledby="config-relations-title" data-od-id="config-relations">
          <header class="config-section__head">
            <div>
              <p class="eyebrow">{{ $t('ui.relations.eyebrow') }}</p>
              <h2 id="config-relations-title">{{ $t('ui.relations.settings.title') }}</h2>
              <p>{{ $t('ui.relations.settings.lead') }}</p>
            </div>
            <button type="button" class="btn btn--primary btn--small" @click="openTypeDialog()">
              <app-icon name="plus"></app-icon> {{ $t('ui.relations.settings.new_type') }}
            </button>
          </header>

          <div class="config-team-summary">
            <span><strong>{{ counts.types }}</strong> {{ $t('ui.relations.settings.types_word', { count: counts.types }) }}</span>
            <span><strong>{{ counts.links }}</strong> {{ $t('ui.relations.settings.links_word', { count: counts.links }) }}</span>
            <span><strong>{{ counts.linkedAssets }}</strong> {{ $t('ui.relations.settings.linked_assets') }}</span>
            <span><strong>{{ counts.isolatedAssets }}</strong> {{ $t('ui.relations.settings.isolated_assets') }}</span>
          </div>

          <div v-if="blockedMessage" class="form-alert" role="alert">
            <app-icon name="alert"></app-icon>
            <span>{{ blockedMessage }}</span>
          </div>

          <div class="relation-type-list">
            <article v-for="row in rows" :key="row.type.id" class="relation-type-row">
              <span class="relations-row__icon" :class="'relations-row__icon--' + row.type.tone">
                <app-icon :name="row.type.icon"></app-icon>
              </span>
              <div class="relation-type-row__copy">
                <strong>{{ row.type.label }} <span class="relation-type-row__inverse">/ {{ row.type.inverse }}</span></strong>
                <span class="mono">{{ row.toneLabel }} · {{ row.type.directed === false ? $t('ui.relations.settings.undirected') : $t('ui.relations.settings.directed') }} · {{ usageLabel(row.usage) }}</span>
                <p v-if="row.type.description">{{ row.type.description }}</p>
              </div>
              <div class="config-row-actions">
                <template v-if="pendingType === row.type.id">
                  <button type="button" class="btn btn--danger btn--small" @click="confirmRemoveType(row)">{{ $t('ui.relations.settings.remove_type') }}</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="pendingType = ''">{{ $t('ui.common.cancel') }}</button>
                </template>
                <template v-else>
                  <button type="button" class="config-icon-action" :aria-label="$t('ui.relations.settings.edit_type_aria', { type: row.type.label })" :title="$t('ui.relations.settings.edit_type')" @click="openTypeDialog(row.type)">
                    <app-icon name="pencil"></app-icon>
                  </button>
                  <button type="button" class="config-icon-action config-icon-action--danger" :aria-label="$t('ui.relations.settings.remove_type_aria', { type: row.type.label })" :title="$t('ui.relations.settings.remove_type')" @click="requestRemoveType(row)">
                    <app-icon name="trash"></app-icon>
                  </button>
                </template>
              </div>
            </article>
          </div>

          <div class="relations-config-actions">
            <button type="button" class="text-button" @click="restoreTypes">
              <app-icon name="restore"></app-icon> {{ $t('ui.relations.settings.restore') }}
            </button>
            <p class="config-note"><app-icon name="info"></app-icon> {{ $t('ui.relations.settings.restore_note') }}</p>
          </div>

          <form class="form-stack relation-prefs" @submit.prevent="savePrefs" novalidate>
            <h3>{{ $t('ui.relations.settings.explorer') }}</h3>
            <div class="relation-prefs__grid">
              <div class="field">
                <label for="graph-mode-pref">{{ $t('ui.relations.settings.mode') }}</label>
                <div class="select-shell">
                  <select id="graph-mode-pref" v-model="prefsDraft.mode">
                    <option value="global">{{ $t('ui.relations.settings.mode_global') }}</option>
                    <option value="focus">{{ $t('ui.relations.settings.mode_focus') }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="graph-depth-pref">{{ $t('ui.relations.settings.depth') }}</label>
                <div class="select-shell">
                  <select id="graph-depth-pref" v-model="prefsDraft.depth">
                    <option :value="1">{{ $t('ui.relations.settings.depth_1') }}</option>
                    <option :value="2">{{ $t('ui.relations.settings.depth_2') }}</option>
                    <option :value="3">{{ $t('ui.relations.settings.depth_3') }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="graph-group-pref">{{ $t('ui.relations.settings.grouping') }}</label>
                <div class="select-shell">
                  <select id="graph-group-pref" v-model="prefsDraft.group">
                    <option v-for="group in groups" :key="group.id" :value="group.id">{{ groupLabel(group) }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="graph-toggle">
                  <input type="checkbox" v-model="prefsDraft.showLabels">
                  <span>{{ $t('ui.relations.settings.show_labels') }}</span>
                </label>
                <label class="graph-toggle">
                  <input type="checkbox" v-model="prefsDraft.animate">
                  <span>{{ $t('ui.relations.settings.animate') }}</span>
                </label>
              </div>
            </div>
            <div class="config-form-foot">
              <p class="config-form-foot__note">{{ $t('ui.relations.settings.prefs_note') }}</p>
              <button type="submit" class="btn btn--primary" :disabled="!canEdit">{{ $t('ui.relations.settings.save_prefs') }}</button>
            </div>
          </form>

          <modal-shell :open="open" :title="draft.id ? $t('ui.relations.type_dialog.edit_title') : $t('ui.relations.type_dialog.create_title')"
                       :eyebrow="$t('ui.relations.type_dialog.eyebrow')" @close="closeTypeDialog">
            <form id="relation-type-form" class="form-stack" @submit.prevent="submitType" novalidate>
              <div class="field" :class="{ 'field--invalid': typeErrors.label }">
                <label for="type-label">{{ $t('ui.relations.type_dialog.label') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="network"></app-icon>
                  <input id="type-label" v-model="draft.label" type="text" maxlength="42" :placeholder="$t('ui.relations.type_dialog.label_placeholder')"
                         :aria-invalid="!!typeErrors.label">
                </div>
                <p class="field__hint">{{ $t('ui.relations.type_dialog.label_hint') }}</p>
                <p v-if="typeErrors.label" class="field__error">{{ typeErrors.label }}</p>
              </div>

              <div class="field">
                <label for="type-inverse">{{ $t('ui.relations.type_dialog.inverse') }}</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="refresh"></app-icon>
                  <input id="type-inverse" v-model="draft.inverse" type="text" maxlength="42" :placeholder="$t('ui.relations.type_dialog.inverse_placeholder')">
                </div>
                <p class="field__hint">{{ $t('ui.relations.type_dialog.inverse_hint') }}</p>
              </div>

              <div class="relation-type-grid">
                <div class="field">
                  <label for="type-icon">{{ $t('ui.relations.type_dialog.icon') }}</label>
                  <div class="select-shell">
                    <select id="type-icon" v-model="draft.icon">
                      <option v-for="icon in types" :key="icon" :value="icon">{{ icon }}</option>
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label for="type-tone">{{ $t('ui.relations.type_dialog.tone') }}</label>
                  <div class="select-shell">
                    <select id="type-tone" v-model="draft.tone">
                      <option v-for="tone in tones" :key="tone" :value="tone">{{ toneLabel(tone) }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="field">
                <label for="type-description">{{ $t('ui.relations.type_dialog.description') }}</label>
                <textarea id="type-description" v-model="draft.description" rows="2" maxlength="160"
                          :placeholder="$t('ui.relations.type_dialog.description_placeholder')"></textarea>
              </div>

              <div class="relation-switch">
                <label class="switch">
                  <input type="checkbox" v-model="draft.directed">
                  <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                  <span class="switch__text">{{ draft.directed ? $t('ui.relations.type_dialog.directed') : $t('ui.relations.type_dialog.symmetric') }}</span>
                </label>
                <p>{{ $t('ui.relations.type_dialog.symmetric_note') }}</p>
              </div>

              <p v-if="typeErrors.general" class="form-error" role="alert">{{ typeErrors.general }}</p>
            </form>
            <template #footer>
              <button type="button" class="btn btn--ghost" @click="closeTypeDialog">{{ $t('ui.common.cancel') }}</button>
              <button type="submit" form="relation-type-form" class="btn btn--primary">{{ draft.id ? $t('ui.relations.type_dialog.save') : $t('ui.relations.type_dialog.create') }}</button>
            </template>
          </modal-shell>
        </section>
      `
    }
  };

  /* Phase 5 server relationship surfaces. They read the canonical adapter state
   * (`app.organization`) and reuse the same vocabulary, tones and controls as
   * the prototype panel; nothing here invents an endpoint or a cycle rule. */
  window.AssetRelationViews.OrganizationRelations = {
    name: 'OrganizationRelations',
    components: { AppIcon: window.AppIcon, ModalShell: window.ModalShell },
    props: {
      asset: { type: Object, required: true },
      app: { type: Object, required: true }
    },
    data() {
      return {
        loading: false,
        error: '',
        formOpen: false,
        mode: 'create',
        id: '',
        sourceId: '',
        targetId: '',
        typeKey: '',
        direction: 'outgoing',
        reason: '',
        notes: '',
        effectiveAt: '',
        formError: '',
        busy: false,
        search: ''
      };
    },
    computed: {
      state() {
        return this.app.organization.relations;
      },
      types() {
        return this.app.organization.types.items.filter((type) => type.active || this.typeKey === type.key);
      },
      canEdit() {
        return typeof this.app.can === 'function' ? this.app.can('assets.edit') : false;
      },
      outgoing() {
        return this.state.items.filter((edge) => edge.direction !== 'incoming');
      },
      incoming() {
        return this.state.items.filter((edge) => edge.direction === 'incoming');
      },
      typeChoices() {
        return this.types.map((type) => ({ id: type.key, label: type.label }));
      },
      targetOptions() {
        // The server applies the typed term to its bounded page; the panel only
        // keeps the asset itself out of its own relation targets.
        return this.app.organization.assetSearch.items.filter((asset) => asset.id !== this.asset.id);
      },
      hostDialog() {
        return this.app.organization.dialogs.hostMove;
      },
      hostOptions() {
        // The bounded server page is the only destination source. Nothing is
        // filtered out here: the server decides whether a host is valid and its
        // message is what the operator reads.
        return this.app.organization.assetSearch.items;
      },
      redundancyState() {
        return this.app.redundancy.assetGroups;
      },
      redundancyDialog() {
        return this.app.redundancy.dialog;
      },
      redundancyGroups() {
        return this.redundancyState.items;
      },
      redundancyCanEdit() {
        // La escritura de grupos exige el permiso de edición de inventario; el
        // servidor vuelve a decidir sobre el grupo y cada activo implicado.
        return typeof this.app.can === 'function'
          ? this.app.can('assets.view') && this.app.can('assets.edit')
          : false;
      },
      redundancySearchOptions() {
        return this.app.redundancy.assetSearch.items.filter((item) => item.id !== this.asset.id);
      }
    },
    watch: {
      'asset.id': {
        immediate: true,
        handler() {
          this.reload();
        }
      },
      search(value) {
        // Typed target text asks the server for a bounded page instead of
        // filtering the single page the form opened with.
        if (!this.formOpen || this.mode !== 'create') return;
        if (typeof this.app.scheduleOrganizationAssetSearch !== 'function') return;
        this.app.scheduleOrganizationAssetSearch(value);
      },
      'hostDialog.search'(value) {
        // The destination search is a bounded server query, never a client
        // filter over the first page the dialog opened with.
        if (!this.hostDialog.open) return;
        if (typeof this.app.scheduleOrganizationAssetSearch !== 'function') return;
        this.app.scheduleOrganizationAssetSearch(value);
      },
      'redundancyDialog.search'(value) {
        // La búsqueda de réplicas también es una página acotada del servidor.
        if (!this.redundancyDialog.open) return;
        if (typeof this.app.scheduleRedundancyAssetSearch !== 'function') return;
        this.app.scheduleRedundancyAssetSearch(value);
      }
    },
    beforeUnmount() {
      // La ficha desmontada no deja un diálogo abierto ni una búsqueda en cola, y
      // una operación de panel que seguía en vuelo deja de ser suya: el cierre del
      // panel avanza la época de panel, así que su respuesta tardía no informa de
      // un éxito, no refresca y no escribe un error en el estado compartido.
      if (typeof this.app.closeRedundancyDialog === 'function') this.app.closeRedundancyDialog();
      if (typeof this.app.cancelRedundancySearchTimer === 'function') this.app.cancelRedundancySearchTimer();
      if (typeof this.app.redundancyBumpPanel === 'function') this.app.redundancyBumpPanel();
    },
    methods: {
      reload() {
        if (!this.asset || !this.asset.id) return;
        this.app.loadOrganizationRelations(this.asset.id);
        this.app.loadOrganizationRelationTypes();
        this.app.loadRedundancyGroupsForAsset(this.asset.id);
      },
      memberFacts(member) {
        return this.app.redundancyMemberFacts(member);
      },
      openRedundancy() {
        return this.app.openRedundancyCreate(this.asset);
      },
      editRedundancy(group) {
        return this.app.openRedundancyEdit(group);
      },
      closeRedundancy() {
        this.app.closeRedundancyDialog();
      },
      changeRedundancyMode(value) {
        this.app.setRedundancyDialogMode(value);
      },
      addRedundancyMember(asset) {
        return this.app.addRedundancyMember(asset);
      },
      removeRedundancyMember(assetId) {
        return this.app.removeRedundancyMember(assetId);
      },
      changeRedundancyShare(assetId, value) {
        return this.app.setRedundancyShare(assetId, value);
      },
      changeRedundancyRole(assetId, value) {
        return this.app.setRedundancyRole(assetId, value);
      },
      submitRedundancy() {
        return this.app.saveRedundancyGroup();
      },
      deactivateRedundancy(group) {
        return this.app.deactivateRedundancyGroup(group);
      },
      reactivateRedundancy(group) {
        return this.app.reactivateRedundancyGroup(group);
      },
      typeLabel(edge) {
        return edge.direction === 'incoming' ? edge.inverse || edge.label : edge.label || edge.typeKey;
      },
      otherLabel(edge) {
        const otherId = edge.direction === 'incoming' ? edge.from : edge.to;
        const hit = this.app.organization.assetSearch.items.find((item) => item.id === otherId);
        return hit ? hit.name || hit.code : otherId;
      },
      openCreate() {
        this.formOpen = true;
        this.mode = 'create';
        this.id = '';
        this.sourceId = this.asset.id;
        this.targetId = '';
        this.typeKey = this.types.length ? this.types[0].key : '';
        this.direction = 'outgoing';
        this.reason = '';
        this.notes = '';
        this.effectiveAt = '';
        this.formError = '';
        this.search = '';
        this.app.searchOrganizationAssets('');
      },
      openEdit(edge) {
        this.formOpen = true;
        this.mode = 'edit';
        this.id = edge.id;
        this.sourceId = edge.from;
        this.targetId = edge.to;
        this.typeKey = edge.typeKey || edge.type;
        this.reason = edge.reason || '';
        this.notes = edge.notes || '';
        this.effectiveAt = '';
        this.formError = '';
      },
      openHostMove(edge) {
        this.app.openOrganizationHostMove(edge, {
          // Only this panel's own server record may name the child. When the
          // edge points at another asset the dialog falls back to the id.
          childName: edge.from === this.asset.id ? this.asset.name : ''
        });
      },
      selectHost(assetId) {
        if (typeof this.app.selectOrganizationHost === 'function') this.app.selectOrganizationHost(assetId);
      },
      closeHostMove() {
        if (typeof this.app.closeOrganizationHostMove === 'function') this.app.closeOrganizationHostMove();
      },
      submitHostMove() {
        if (typeof this.app.confirmOrganizationHostMove === 'function') this.app.confirmOrganizationHostMove();
      },
      close() {
        this.formOpen = false;
      },
      async save() {
        if (!this.canEdit) {
          this.formError = tr('ui.relations.error.edit_forbidden');
          return;
        }
        this.formError = '';
        const dialog = this.app.organization.dialogs.relation;
        dialog.mode = this.mode;
        dialog.id = this.id;
        dialog.sourceId = this.sourceId;
        dialog.targetId = this.targetId;
        dialog.typeKey = this.typeKey;
        dialog.reason = this.reason;
        dialog.notes = this.notes;
        dialog.effectiveAt = this.effectiveAt;
        dialog.error = '';
        this.busy = true;
        const ok = await this.app.saveOrganizationRelation();
        this.busy = false;
        this.formError = dialog.error || this.app.organization.dialogs.relation.error || '';
        if (ok) this.formOpen = false;
      },
      async remove(edge) {
        if (!this.canEdit) {
          this.error = tr('ui.relations.error.remove_forbidden');
          return;
        }
        const ok = await this.app.removeOrganizationRelation(edge);
        if (!ok) this.error = this.app.organization.relations.error || tr('ui.relations.error.remove_failed');
      },
      timestamp(value) {
        return this.app.formatServerTimestamp(value);
      }
    },
    template: `
      <section class="panel relations-panel" aria-labelledby="server-relations-title">
        <header class="panel__head">
          <div>
            <h2 id="server-relations-title">{{ $t('ui.relations.panel.title') }}</h2>
            <p>{{ $t('ui.relations.server.count', { count: state.total }) }}</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="openCreate">
            <app-icon name="plus" /> {{ $t('ui.relations.add') }}
          </button>
        </header>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="!canEdit" class="cell-note">{{ $t('ui.relations.server.read_only') }}</p>

        <form v-if="formOpen" class="relation-form" @submit.prevent="save">
          <div class="field">
            <label for="server-relation-type">{{ $t('ui.relations.server.field_type') }}</label>
            <span class="input-shell">
              <select id="server-relation-type" v-model="typeKey">
                <option v-for="type in typeChoices" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </span>
          </div>
          <div v-if="mode === 'create'" class="field">
            <label for="server-relation-target">{{ $t('ui.relations.field.target') }}</label>
            <span class="input-shell">
              <input id="server-relation-target" v-model="search" type="search" :placeholder="$t('ui.relations.server.search_placeholder')" autocomplete="off">
            </span>
            <span class="field__hint">{{ $t('ui.relations.server.target_hint') }}</span>
            <span class="input-shell">
              <select id="server-relation-target-select" v-model="targetId">
                <option value="">{{ $t('ui.relations.server.target_placeholder') }}</option>
                <option v-for="asset in targetOptions" :key="asset.id" :value="asset.id">{{ asset.name || asset.code }}</option>
              </select>
            </span>
          </div>
          <div class="field">
            <label for="server-relation-reason">{{ $t('ui.relations.server.reason') }}</label>
            <span class="input-shell"><input id="server-relation-reason" v-model="reason" type="text" maxlength="500"></span>
          </div>
          <div class="field">
            <label for="server-relation-notes">{{ $t('ui.relations.server.notes') }}</label>
            <span class="input-shell"><input id="server-relation-notes" v-model="notes" type="text" maxlength="500"></span>
          </div>
          <div class="field">
            <label for="server-relation-effective">{{ $t('ui.relations.server.effective') }}</label>
            <span class="input-shell"><input id="server-relation-effective" v-model="effectiveAt" type="datetime-local"></span>
            <span class="field__hint">{{ $t('ui.relations.server.effective_hint') }}</span>
          </div>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <div class="relation-form__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="close">{{ $t('ui.common.cancel') }}</button>
            <button type="submit" class="btn btn--primary btn--small" :disabled="busy || !targetId && mode === 'create'">{{ $t('ui.relations.server.save') }}</button>
          </div>
        </form>

        <modal-shell :open="hostDialog.open" :title="$t('ui.relations.server.host_title')" :eyebrow="$t('ui.relations.server.host_eyebrow')" size="wide" @close="closeHostMove">
          <div class="form-stack host-move">
            <div class="assign-context">
              <span class="assign-context__icon"><app-icon name="layers" /></span>
              <div>
                <strong>{{ hostDialog.childName || hostDialog.childId }}</strong>
                <span class="mono">{{ hostDialog.childId }}</span>
              </div>
              <span class="cell-note">{{ $t('ui.relations.server.host_child') }}</span>
            </div>

            <div class="field">
              <label for="server-host-search">{{ $t('ui.relations.server.new_host') }}</label>
              <span class="input-shell">
                <input id="server-host-search" v-model="hostDialog.search" type="search" :placeholder="$t('ui.relations.server.search_placeholder')" autocomplete="off" aria-describedby="server-host-search-hint">
              </span>
              <span id="server-host-search-hint" class="field__hint">{{ $t('ui.relations.server.host_search_hint') }}</span>
            </div>

            <div v-if="hostOptions.length" class="assign-options" role="group" :aria-label="$t('ui.relations.server.hosts_aria')">
              <button v-for="asset in hostOptions" :key="asset.id" type="button" class="assign-option"
                      :class="{ 'is-selected': hostDialog.newHostId === asset.id }" :aria-pressed="hostDialog.newHostId === asset.id"
                      @click="selectHost(asset.id)">
                <span class="assign-option__thumb"><app-icon name="layers" /></span>
                <span>
                  <strong>{{ asset.name || asset.code }}</strong>
                  <small>{{ asset.id }}<template v-if="asset.code"> · {{ asset.code }}</template></small>
                </span>
                <app-icon v-if="hostDialog.newHostId === asset.id" name="check" />
              </button>
            </div>
            <p v-else-if="!app.organization.assetSearch.loading" class="assign-empty">{{ $t('ui.relations.server.no_matches') }}</p>
            <p v-if="app.organization.assetSearch.error" class="form-error" role="alert">{{ app.organization.assetSearch.error }}</p>

            <div class="field">
              <label for="server-host-reason">{{ $t('ui.relations.server.reason') }}</label>
              <span class="input-shell"><input id="server-host-reason" v-model="hostDialog.reason" type="text" maxlength="500" aria-describedby="server-host-reason-hint"></span>
              <span id="server-host-reason-hint" class="field__hint">{{ $t('ui.relations.server.host_reason_hint') }}</span>
            </div>
            <div class="field">
              <label for="server-host-notes">{{ $t('ui.relations.server.notes') }}</label>
              <span class="input-shell"><input id="server-host-notes" v-model="hostDialog.notes" type="text" maxlength="500"></span>
            </div>
            <div class="field">
              <label for="server-host-effective">{{ $t('ui.relations.server.effective') }}</label>
              <span class="input-shell"><input id="server-host-effective" v-model="hostDialog.effectiveAt" type="datetime-local" aria-describedby="server-host-effective-hint"></span>
              <span id="server-host-effective-hint" class="field__hint">{{ $t('ui.relations.server.host_effective_hint') }}</span>
            </div>

            <p v-if="hostDialog.error" class="form-error" role="alert">{{ hostDialog.error }}</p>
          </div>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeHostMove">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--primary" :disabled="hostDialog.busy || !hostDialog.newHostId" @click="submitHostMove">
              {{ hostDialog.busy ? $t('ui.relations.server.saving') : $t('ui.relations.server.save_host') }}
            </button>
          </template>
        </modal-shell>

        <div v-if="outgoing.length" class="relation-group">
          <h3>{{ $t('ui.relations.server.outgoing') }}</h3>
          <ul class="relation-list">
            <li v-for="edge in outgoing" :key="edge.id" class="relation-list__item" :class="'tone--' + (edge.tone || 'network')">
              <div>
                <strong>{{ typeLabel(edge) }}</strong>
                <span class="cell-note">{{ otherLabel(edge) }} · {{ timestamp(edge.recordedAt || edge.createdAt) }}</span>
                <p v-if="edge.reason" class="cell-note">{{ $t('ui.relations.server.reason_prefix', { reason: edge.reason }) }}</p>
              </div>
              <div class="quick-actions">
                <button v-if="canEdit" type="button" class="quick-action" @click="openEdit(edge)"><app-icon name="pencil" /><span>{{ $t('ui.relations.server.edit') }}</span></button>
                <button v-if="canEdit && edge.typeKey === 'hosted_in'" type="button" class="quick-action" @click="openHostMove(edge)"><app-icon name="layers" /><span>{{ $t('ui.relations.server.change_host') }}</span></button>
                <button v-if="canEdit" type="button" class="quick-action quick-action--danger" @click="remove(edge)"><app-icon name="trash" /><span>{{ $t('ui.relations.server.remove') }}</span></button>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="incoming.length" class="relation-group">
          <h3>{{ $t('ui.relations.server.incoming') }}</h3>
          <ul class="relation-list">
            <li v-for="edge in incoming" :key="edge.id" class="relation-list__item" :class="'tone--' + (edge.tone || 'network')">
              <div>
                <strong>{{ typeLabel(edge) }}</strong>
                <span class="cell-note">{{ otherLabel(edge) }}</span>
              </div>
            </li>
          </ul>
        </div>

        <p v-if="!outgoing.length && !incoming.length && !state.loading" class="cell-note">{{ $t('ui.relations.server.empty') }}</p>
      </section>

      <section class="panel redundancy-panel" aria-labelledby="server-redundancy-title">
        <header class="panel__head">
          <div>
            <h2 id="server-redundancy-title">{{ $t('ui.redundancy.panel_title') }}</h2>
            <span class="cell-note">{{ $t('ui.redundancy.panel_lead') }}</span>
          </div>
          <button v-if="redundancyCanEdit" type="button" class="btn btn--secondary btn--small" @click="openRedundancy">{{ $t('ui.redundancy.new_group') }}</button>
        </header>
        <p class="cell-note">{{ $t('ui.redundancy.disclaimer') }}</p>

        <p v-if="redundancyState.loading" class="cell-note" role="status">{{ $t('ui.redundancy.loading') }}</p>
        <p v-else-if="redundancyState.error" class="form-error" role="alert">{{ redundancyState.error }}</p>
        <template v-else>
          <ul v-if="redundancyGroups.length" class="redundancy-list">
            <li v-for="group in redundancyGroups" :key="group.id" class="redundancy-item">
              <div class="redundancy-item__head">
                <strong>{{ group.name }}</strong>
                <span class="status" :class="group.active ? 'status--ok' : 'status--hold'">{{ group.active ? $t('ui.redundancy.status_active') : $t('ui.redundancy.status_inactive') }}</span>
              </div>
              <span class="cell-note">{{ app.redundancyModeLabel(group.mode) }} · {{ $t('ui.redundancy.replicas', { count: group.memberCount }) }}</span>
              <p v-if="group.description" class="cell-note">{{ group.description }}</p>
              <ul class="redundancy-members">
                <li v-for="member in group.members" :key="member.assetId" :class="{ 'is-current': member.assetId === asset.id }">
                  <span>{{ member.name || member.assetId }}</span>
                  <span class="cell-note">{{ member.assetId === asset.id ? $t('ui.redundancy.current_member', { facts: memberFacts(member) }) : memberFacts(member) }}</span>
                </li>
              </ul>
              <div v-if="redundancyCanEdit" class="quick-actions">
                <button type="button" class="quick-action" @click="editRedundancy(group)"><app-icon name="pencil" /><span>{{ $t('ui.redundancy.edit') }}</span></button>
                <button v-if="group.active" type="button" class="quick-action quick-action--danger"
                        :disabled="app.redundancy.busyId === group.id" @click="deactivateRedundancy(group)">
                  <app-icon name="minus" /><span>{{ $t('ui.redundancy.deactivate') }}</span>
                </button>
                <button v-else type="button" class="quick-action" :disabled="app.redundancy.busyId === group.id" @click="reactivateRedundancy(group)">
                  <app-icon name="refresh" /><span>{{ $t('ui.redundancy.reactivate') }}</span>
                </button>
              </div>
            </li>
          </ul>
          <p v-else-if="redundancyState.truncated" class="cell-note">
            {{ $t('ui.redundancy.examined_none', { examined: redundancyState.examined, total: redundancyState.total }) }}
          </p>
          <p v-else-if="redundancyState.loaded" class="cell-note">{{ $t('ui.redundancy.empty') }}</p>
          <p v-if="redundancyState.truncated && redundancyGroups.length" class="cell-note">
            {{ $t('ui.redundancy.examined_more', { examined: redundancyState.examined, total: redundancyState.total }) }}
          </p>
          <p v-else-if="redundancyGroups.length && redundancyState.loaded" class="cell-note">{{ $t('ui.redundancy.examined', { examined: redundancyState.examined, total: redundancyState.total }) }}</p>
        </template>
        <p v-if="!redundancyCanEdit && redundancyGroups.length" class="cell-note">{{ $t('ui.redundancy.read_only') }}</p>
      </section>

      <modal-shell :open="redundancyDialog.open" :title="$t('ui.redundancy.dialog.title')" :eyebrow="$t('ui.redundancy.dialog.eyebrow')" size="wide" @close="closeRedundancy">
        <div class="form-stack redundancy-form">
          <div class="field">
            <label for="redundancy-name">{{ $t('ui.redundancy.dialog.name') }}</label>
            <span class="input-shell"><input id="redundancy-name" v-model="redundancyDialog.name" type="text" maxlength="160"></span>
          </div>
          <div class="field">
            <label for="redundancy-description">{{ $t('ui.redundancy.dialog.description') }}</label>
            <span class="input-shell">
              <input id="redundancy-description" v-model="redundancyDialog.description" type="text" maxlength="1000" aria-describedby="redundancy-description-hint">
            </span>
            <span id="redundancy-description-hint" class="field__hint">{{ $t('ui.redundancy.dialog.description_hint') }}</span>
          </div>
          <div class="field">
            <label for="redundancy-mode">{{ $t('ui.redundancy.dialog.mode') }}</label>
            <span class="input-shell">
              <select id="redundancy-mode" :value="redundancyDialog.groupMode" @change="changeRedundancyMode($event.target.value)">
                <option value="active_active">{{ $t('ui.redundancy.dialog.mode_active_active') }}</option>
                <option value="active_passive">{{ $t('ui.redundancy.dialog.mode_active_passive') }}</option>
              </select>
            </span>
            <span class="field__hint">{{ $t('ui.redundancy.dialog.mode_hint') }}</span>
          </div>

          <div class="field">
            <label for="redundancy-search">{{ $t('ui.redundancy.dialog.add_replica') }}</label>
            <span class="input-shell">
              <input id="redundancy-search" v-model="redundancyDialog.search" type="search" maxlength="120" aria-describedby="redundancy-search-hint">
            </span>
            <span id="redundancy-search-hint" class="field__hint">{{ $t('ui.redundancy.dialog.search_hint') }}</span>
          </div>
          <div v-if="redundancySearchOptions.length" class="assign-options" role="group" :aria-label="$t('ui.redundancy.dialog.found_aria')">
            <button v-for="asset in redundancySearchOptions" :key="asset.id" type="button" class="assign-option"
                    :data-redundancy-add="asset.id" @click="addRedundancyMember(asset)">
              <span class="assign-option__thumb"><app-icon name="server" /></span>
              <span>
                <strong>{{ asset.name || asset.quickCode || asset.id }}</strong>
                <small>{{ asset.id }}<template v-if="asset.quickCode"> · {{ asset.quickCode }}</template></small>
              </span>
              <app-icon name="plus" />
            </button>
          </div>
          <p v-else-if="!app.redundancy.assetSearch.loading" class="assign-empty">{{ $t('ui.relations.server.no_matches') }}</p>
          <p v-if="app.redundancy.assetSearch.error" class="form-error" role="alert">{{ app.redundancy.assetSearch.error }}</p>

          <ul v-if="redundancyDialog.members.length" class="redundancy-draft">
            <li v-for="member in redundancyDialog.members" :key="member.assetId" class="redundancy-draft__item">
              <div class="redundancy-draft__name">
                <strong>{{ member.name || member.quickCode || member.assetId }}</strong>
                <span class="cell-note mono">{{ member.assetId }}</span>
                <span v-if="member.archived" class="cell-note">{{ $t('ui.redundancy.dialog.archived') }}</span>
              </div>
              <div v-if="redundancyDialog.groupMode === 'active_passive'" class="field">
                <label :for="'redundancy-role-' + member.assetId">{{ $t('ui.redundancy.dialog.role') }}</label>
                <span class="input-shell">
                  <select :id="'redundancy-role-' + member.assetId" :data-redundancy-role="member.assetId"
                          :value="member.role" @change="changeRedundancyRole(member.assetId, $event.target.value)">
                    <option value="primary">{{ $t('ui.redundancy.dialog.role_primary') }}</option>
                    <option value="backup">{{ $t('ui.redundancy.dialog.role_backup') }}</option>
                  </select>
                </span>
              </div>
              <div v-else class="field">
                <label :for="'redundancy-share-' + member.assetId">{{ $t('ui.redundancy.dialog.share') }}</label>
                <span class="input-shell">
                  <input :id="'redundancy-share-' + member.assetId" :data-redundancy-share="member.assetId"
                         :value="member.share" inputmode="decimal" @input="changeRedundancyShare(member.assetId, $event.target.value)">
                </span>
              </div>
              <button type="button" class="quick-action quick-action--danger" :data-redundancy-remove="member.assetId"
                      :aria-label="$t('ui.redundancy.dialog.remove_aria', { name: member.name || member.assetId })" @click="removeRedundancyMember(member.assetId)">
                <app-icon name="trash" />
              </button>
            </li>
          </ul>
          <p class="cell-note">{{ app.redundancyDraftSummary() }}</p>
          <p class="cell-note">{{ $t('ui.redundancy.dialog.summary_note') }}</p>
          <p v-if="redundancyDialog.error" class="form-error" role="alert">{{ redundancyDialog.error }}</p>
        </div>
        <template #footer>
          <button type="button" class="btn btn--ghost" @click="closeRedundancy">{{ $t('ui.common.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="redundancyDialog.busy" @click="submitRedundancy">
            {{ redundancyDialog.busy ? $t('ui.redundancy.saving') : $t('ui.redundancy.dialog.save') }}
          </button>
        </template>
      </modal-shell>
    `
  };

  window.AssetRelationViews.OrganizationRelationTypes = {
    name: 'OrganizationRelationTypes',
    props: { app: { type: Object, required: true } },
    computed: {
      types() {
        return this.app.organization.types.items;
      },
      dialog() {
        return this.app.organization.dialogs.type;
      },
      canConfigure() {
        return typeof this.app.canConfig === 'function' ? this.app.canConfig('relaciones') : false;
      }
    },
    watch: {
      types() {
        if (!this.types.length) this.app.loadOrganizationRelationTypes({ includeInactive: true });
      }
    },
    created() {
      this.app.loadOrganizationRelationTypes({ includeInactive: true });
    },
    methods: {
      edit(type) {
        this.app.openOrganizationTypeDialog(type);
      },
      create() {
        this.app.openOrganizationTypeDialog(null);
      },
      close() {
        this.app.closeOrganizationTypeDialog();
      },
      async save() {
        await this.app.saveOrganizationType();
      }
    },
    template: `
      <section class="panel" aria-labelledby="server-types-title">
        <header class="panel__head">
          <div>
            <h2 id="server-types-title">{{ $t('ui.relations.types.title') }}</h2>
            <p>{{ $t('ui.relations.types.lead') }}</p>
          </div>
          <button v-if="canConfigure" type="button" class="btn btn--secondary btn--small" @click="create">
            <app-icon name="plus" /> {{ $t('ui.relations.types.new') }}
          </button>
        </header>

        <p v-if="!canConfigure" class="cell-note">{{ $t('ui.relations.types.read_only') }}</p>
        <p v-if="app.organization.types.error" class="form-error" role="alert">{{ app.organization.types.error }}</p>

        <div v-if="types.length" class="table-panel">
          <table class="asset-table">
            <caption class="sr-only">{{ $t('ui.relations.types.caption') }}</caption>
            <thead>
              <tr><th scope="col">{{ $t('ui.relations.types.col_key') }}</th><th scope="col">{{ $t('ui.relations.types.col_forward') }}</th><th scope="col">{{ $t('ui.relations.types.col_inverse') }}</th><th scope="col">{{ $t('ui.relations.types.col_containment') }}</th><th scope="col">{{ $t('ui.relations.types.col_status') }}</th><th scope="col"><span class="sr-only">{{ $t('ui.relations.types.col_actions') }}</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="type in types" :key="type.key" class="asset-row">
                <td :data-label="$t('ui.relations.types.col_key')"><span class="mono">{{ type.key }}</span></td>
                <td :data-label="$t('ui.relations.types.col_forward')"><span class="cell-strong">{{ type.label }}</span></td>
                <td :data-label="$t('ui.relations.types.col_inverse')"><span class="cell-strong">{{ type.inverse }}</span></td>
                <td :data-label="$t('ui.relations.types.col_containment')"><span class="type-tag">{{ type.containment ? $t('ui.relations.types.yes') : $t('ui.relations.types.no') }}</span></td>
                <td :data-label="$t('ui.relations.types.col_status')"><span class="status-pill" :class="type.active ? 'status-pill--online' : 'status-pill--retired'">{{ type.active ? $t('ui.relations.status_active') : $t('ui.relations.status_inactive') }}</span></td>
                <td :data-label="$t('ui.relations.types.col_actions')">
                  <button v-if="canConfigure" type="button" class="quick-action" @click="edit(type)"><app-icon name="pencil" /><span>{{ $t('ui.relations.server.edit') }}</span></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="!app.organization.types.loading" class="cell-note">{{ $t('ui.relations.types.empty') }}</p>

        <modal-shell :open="dialog.open" :title="$t('ui.relations.types.dialog_title')" :eyebrow="$t('ui.relations.types.dialog_eyebrow')" @close="close">
          <form id="server-type-form" class="field-stack" @submit.prevent="save">
            <label class="field">
              <span class="field__label">{{ $t('ui.relations.types.col_key') }}</span>
              <input v-model="dialog.key" type="text" :disabled="dialog.mode === 'edit'" maxlength="48" pattern="[a-z0-9_]+" required>
              <span class="field__hint">{{ $t('ui.relations.types.key_hint') }}</span>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.relations.types.forward_label') }}</span>
              <input v-model="dialog.forwardLabel" type="text" maxlength="80" required>
            </label>
            <label class="field">
              <span class="field__label">{{ $t('ui.relations.types.inverse_label') }}</span>
              <input v-model="dialog.inverseLabel" type="text" maxlength="80" required>
            </label>
            <label class="field field--inline">
              <input v-model="dialog.containment" type="checkbox">
              <span>{{ $t('ui.relations.types.containment') }}</span>
            </label>
            <label v-if="dialog.mode === 'edit'" class="field field--inline">
              <input v-model="dialog.active" type="checkbox">
              <span>{{ $t('ui.relations.types.active') }}</span>
            </label>
            <p v-if="dialog.error" class="form-error" role="alert">{{ dialog.error }}</p>
          </form>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="close">{{ $t('ui.common.cancel') }}</button>
            <button type="submit" form="server-type-form" class="btn btn--primary" :disabled="dialog.busy">{{ $t('ui.relations.types.save') }}</button>
          </template>
        </modal-shell>
      </section>
    `
  };
})();
