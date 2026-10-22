(function () {
  'use strict';

  const Engine = window.AssetRelations;
  const RelationsData = window.AssetRelationsData;
  const TYPE_ICONS = ['network', 'layers', 'building', 'battery', 'activity', 'refresh', 'box', 'server', 'package'];
  const TONES = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
  const GROUPS = [
    { id: 'category', label: 'Categoría' },
    { id: 'site', label: 'Sede' },
    { id: 'none', label: 'Sin agrupar' }
  ];

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
          if (!this.selectedType) return 'Cada tipo describe el sentido del vínculo y aparece en el historial de ambos activos.';
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
          this.app.showToast('Relación creada con ' + (target ? target.name : 'el activo') + '.');
        },
        confirmRemove(row) {
          const result = Engine.removeLink(this.app, row.id);
          this.pendingRemove = '';
          if (!result.ok) {
            this.app.showToast(result.error || 'No se pudo eliminar el vínculo.', 'error');
            return;
          }
          this.app.showToast('Vínculo con ' + row.other.name + ' eliminado.');
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
          return site ? site.label : 'Sin sede';
        }
      },
      template: `
        <section class="operations-panel relations-panel" aria-labelledby="relations-title" data-od-id="asset-relations">
          <header class="panel-head">
            <div>
              <p class="eyebrow">Infraestructura</p>
              <h2 id="relations-title">Relaciones</h2>
              <p class="relations-panel__lead">Vínculos con otros activos: alojamiento, red, energía y dependencias.</p>
            </div>
            <div class="relations-panel__actions">
              <button type="button" class="btn btn--ghost btn--small" @click="openGraph">
                <app-icon name="network"></app-icon> Ver en el grafo
              </button>
              <button v-if="canEdit" type="button" class="btn btn--primary btn--small" data-od-id="add-relation" @click="openDialog">
                <app-icon name="plus"></app-icon> Añadir relación
              </button>
            </div>
          </header>

          <p v-if="asset.retired && rows.length" class="relations-panel__note">
            <app-icon name="info"></app-icon>
            El activo está dado de baja: sus vínculos se conservan como registro histórico y no admiten cambios.
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
                  <button type="button" class="btn btn--danger btn--small" @click="confirmRemove(row)">Eliminar vínculo</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="pendingRemove = ''">Cancelar</button>
                </template>
                <template v-else>
                  <button type="button" class="icon-button icon-button--small" :aria-label="'Abrir ficha de ' + row.other.name" @click="openAsset(row.other)">
                    <app-icon name="arrow-up-right"></app-icon>
                  </button>
                  <button v-if="canEdit" type="button" class="icon-button icon-button--small icon-button--danger"
                          :aria-label="'Eliminar vínculo con ' + row.other.name" @click="pendingRemove = row.id">
                    <app-icon name="trash"></app-icon>
                  </button>
                </template>
              </div>
            </li>
          </ul>

          <div v-else class="relations-empty">
            <span class="relations-empty__icon"><app-icon name="network"></app-icon></span>
            <div>
              <h3>Sin relaciones registradas</h3>
              <p>Vincula este activo con el host que lo aloja, el switch al que se conecta o la UPS que lo protege.</p>
              <button v-if="canEdit" type="button" class="text-button" @click="openDialog">
                <app-icon name="plus"></app-icon> Crear la primera relación
              </button>
            </div>
          </div>
        </section>

        <modal-shell :open="open" title="Añadir relación" eyebrow="Vínculos entre activos" @close="closeDialog">
          <form id="relation-form" class="form-stack" @submit.prevent="submit" novalidate>
            <p class="form-intro"><strong>{{ asset.name }}</strong> <span class="mono">{{ asset.code }}</span>. El vínculo se registra en el historial de ambos activos.</p>

            <div class="field" :class="{ 'field--invalid': errors.type }">
              <label for="relation-type">Tipo de relación</label>
              <div class="select-shell">
                <select id="relation-type" v-model="draft.typeId" :aria-describedby="'relation-type-hint'" :aria-invalid="!!errors.type">
                  <option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }} / {{ type.inverse }}</option>
                </select>
              </div>
              <p id="relation-type-hint" class="field__hint">{{ typeHint }}</p>
              <p v-if="errors.type" class="field__error">{{ errors.type }}</p>
            </div>

            <div class="field" :class="{ 'field--invalid': errors.target }">
              <label for="relation-search">Activo relacionado</label>
              <div class="input-shell input-shell--plain">
                <app-icon name="search"></app-icon>
                <input id="relation-search" v-model="search" type="search" placeholder="Filtrar por nombre o código" autocomplete="off">
              </div>
              <div class="select-shell">
                <select id="relation-target" v-model="draft.targetId" size="6" :aria-invalid="!!errors.target" aria-describedby="relation-target-hint">
                  <option v-for="candidate in filteredCandidates" :key="candidate.id" :value="candidate.id">
                    {{ candidate.name }} · {{ candidate.code }} · {{ siteLabel(candidate.site) }}
                  </option>
                </select>
              </div>
              <p id="relation-target-hint" class="field__hint">
                {{ filteredCandidates.length }} {{ filteredCandidates.length === 1 ? 'activo disponible' : 'activos disponibles' }} para este tipo.
              </p>
              <p v-if="errors.target" class="field__error">{{ errors.target }}</p>
            </div>

            <div class="field">
              <label for="relation-note">Nota <span class="field__optional">(opcional)</span></label>
              <textarea id="relation-note" v-model="draft.note" rows="2" maxlength="240"
                        placeholder="Ej. Puerto 12 · VLAN producción"></textarea>
              <p class="field__hint">Máximo 240 caracteres.</p>
            </div>

            <p v-if="errors.general" class="form-error" role="alert">{{ errors.general }}</p>
          </form>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeDialog">Cancelar</button>
            <button type="submit" form="relation-form" class="btn btn--primary">Crear relación</button>
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
            toneLabel: RelationsData.TONE_LABELS[type.tone] || 'Red'
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
        submitType() {
          const result = Engine.saveType(this.app, this.draft);
          if (!result.ok) {
            this.typeErrors = result.errors;
            return;
          }
          this.open = false;
          this.app.showToast(this.draft.id ? 'Tipo de relación actualizado.' : 'Tipo de relación creado.');
        },
        requestRemoveType(row) {
          this.blockedMessage = '';
          if (row.usage) {
            this.blockedMessage = '«' + row.type.label + '» tiene ' + row.usage
              + (row.usage === 1 ? ' vínculo activo.' : ' vínculos activos.') + ' Elimínalos antes de borrar el tipo.';
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
          this.app.showToast('Tipo de relación eliminado.');
        },
        restoreTypes() {
          const result = Engine.restoreTypes(this.app);
          this.blockedMessage = '';
          this.app.showToast('Tipos predeterminados restaurados.');
          if (result.removedLinks) {
            this.app.showToast('Se quitaron ' + result.removedLinks + ' vínculos de tipos eliminados.', 'error');
          }
        },
        savePrefs() {
          Engine.savePrefs(this.app, this.prefsDraft);
          this.app.showToast('Preferencias del grafo guardadas.');
        },
        usageLabel(value) {
          return value + (value === 1 ? ' vínculo' : ' vínculos');
        }
      },
      template: `
        <section class="config-section" aria-labelledby="config-relations-title" data-od-id="config-relations">
          <header class="config-section__head">
            <div>
              <p class="eyebrow">Infraestructura</p>
              <h2 id="config-relations-title">Relaciones y grafo</h2>
              <p>Define los tipos de vínculo y cómo se abre el explorador. Los tipos en uso no se pueden eliminar.</p>
            </div>
            <button type="button" class="btn btn--primary btn--small" @click="openTypeDialog()">
              <app-icon name="plus"></app-icon> Nuevo tipo
            </button>
          </header>

          <div class="config-team-summary">
            <span><strong>{{ counts.types }}</strong> {{ counts.types === 1 ? 'tipo' : 'tipos' }}</span>
            <span><strong>{{ counts.links }}</strong> {{ counts.links === 1 ? 'vínculo' : 'vínculos' }}</span>
            <span><strong>{{ counts.linkedAssets }}</strong> activos con relaciones</span>
            <span><strong>{{ counts.isolatedAssets }}</strong> sin vínculos</span>
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
                <span class="mono">{{ row.toneLabel }} · {{ row.type.directed === false ? 'sin dirección' : 'dirigido' }} · {{ usageLabel(row.usage) }}</span>
                <p v-if="row.type.description">{{ row.type.description }}</p>
              </div>
              <div class="config-row-actions">
                <template v-if="pendingType === row.type.id">
                  <button type="button" class="btn btn--danger btn--small" @click="confirmRemoveType(row)">Eliminar tipo</button>
                  <button type="button" class="btn btn--ghost btn--small" @click="pendingType = ''">Cancelar</button>
                </template>
                <template v-else>
                  <button type="button" class="config-icon-action" :aria-label="'Editar ' + row.type.label" title="Editar tipo" @click="openTypeDialog(row.type)">
                    <app-icon name="pencil"></app-icon>
                  </button>
                  <button type="button" class="config-icon-action config-icon-action--danger" :aria-label="'Eliminar ' + row.type.label" title="Eliminar tipo" @click="requestRemoveType(row)">
                    <app-icon name="trash"></app-icon>
                  </button>
                </template>
              </div>
            </article>
          </div>

          <div class="relations-config-actions">
            <button type="button" class="text-button" @click="restoreTypes">
              <app-icon name="restore"></app-icon> Restaurar tipos predeterminados
            </button>
            <p class="config-note"><app-icon name="info"></app-icon> Restaurar recupera los tipos de fábrica y conserva los personalizados.</p>
          </div>

          <form class="form-stack relation-prefs" @submit.prevent="savePrefs" novalidate>
            <h3>Explorador por defecto</h3>
            <div class="relation-prefs__grid">
              <div class="field">
                <label for="graph-mode-pref">Modo inicial</label>
                <div class="select-shell">
                  <select id="graph-mode-pref" v-model="prefsDraft.mode">
                    <option value="global">Vista global</option>
                    <option value="focus">Enfocado (requiere abrir desde un activo)</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="graph-depth-pref">Profundidad del foco</label>
                <div class="select-shell">
                  <select id="graph-depth-pref" v-model="prefsDraft.depth">
                    <option :value="1">1 salto</option>
                    <option :value="2">2 saltos</option>
                    <option :value="3">3 saltos</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="graph-group-pref">Agrupación inicial</label>
                <div class="select-shell">
                  <select id="graph-group-pref" v-model="prefsDraft.group">
                    <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.label }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="graph-toggle">
                  <input type="checkbox" v-model="prefsDraft.showLabels">
                  <span>Mostrar nombres junto al código</span>
                </label>
                <label class="graph-toggle">
                  <input type="checkbox" v-model="prefsDraft.animate">
                  <span>Animar la disposición del grafo</span>
                </label>
              </div>
            </div>
            <div class="config-form-foot">
              <p class="config-form-foot__note">Se aplica la próxima vez que abras el grafo. El modo enfocado siempre usa el activo de origen.</p>
              <button type="submit" class="btn btn--primary" :disabled="!canEdit">Guardar preferencias</button>
            </div>
          </form>

          <modal-shell :open="open" :title="draft.id ? 'Editar tipo de relación' : 'Nuevo tipo de relación'"
                       eyebrow="Catálogo de vínculos" @close="closeTypeDialog">
            <form id="relation-type-form" class="form-stack" @submit.prevent="submitType" novalidate>
              <div class="field" :class="{ 'field--invalid': typeErrors.label }">
                <label for="type-label">Etiqueta</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="network"></app-icon>
                  <input id="type-label" v-model="draft.label" type="text" maxlength="42" placeholder="Ej. Alojado en"
                         :aria-invalid="!!typeErrors.label">
                </div>
                <p class="field__hint">Cómo se lee el vínculo desde el activo de origen.</p>
                <p v-if="typeErrors.label" class="field__error">{{ typeErrors.label }}</p>
              </div>

              <div class="field">
                <label for="type-inverse">Lectura inversa</label>
                <div class="input-shell input-shell--plain">
                  <app-icon name="refresh"></app-icon>
                  <input id="type-inverse" v-model="draft.inverse" type="text" maxlength="42" placeholder="Ej. Aloja">
                </div>
                <p class="field__hint">Cómo se lee desde el activo relacionado. Si queda vacío se usa la misma etiqueta.</p>
              </div>

              <div class="relation-type-grid">
                <div class="field">
                  <label for="type-icon">Icono</label>
                  <div class="select-shell">
                    <select id="type-icon" v-model="draft.icon">
                      <option v-for="icon in types" :key="icon" :value="icon">{{ icon }}</option>
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label for="type-tone">Familia de color</label>
                  <div class="select-shell">
                    <select id="type-tone" v-model="draft.tone">
                      <option v-for="tone in tones" :key="tone" :value="tone">{{ tone }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="field">
                <label for="type-description">Descripción</label>
                <textarea id="type-description" v-model="draft.description" rows="2" maxlength="160"
                          placeholder="Cuándo conviene usar este tipo de relación."></textarea>
              </div>

              <div class="relation-switch">
                <label class="switch">
                  <input type="checkbox" v-model="draft.directed">
                  <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                  <span class="switch__text">{{ draft.directed ? 'Dirigido' : 'Simétrico' }}</span>
                </label>
                <p>Un tipo simétrico se dibuja sin flecha y no distingue origen de destino.</p>
              </div>

              <p v-if="typeErrors.general" class="form-error" role="alert">{{ typeErrors.general }}</p>
            </form>
            <template #footer>
              <button type="button" class="btn btn--ghost" @click="closeTypeDialog">Cancelar</button>
              <button type="submit" form="relation-type-form" class="btn btn--primary">{{ draft.id ? 'Guardar tipo' : 'Crear tipo' }}</button>
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
      }
    },
    methods: {
      reload() {
        if (!this.asset || !this.asset.id) return;
        this.app.loadOrganizationRelations(this.asset.id);
        this.app.loadOrganizationRelationTypes();
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
          this.formError = 'No tienes permiso para modificar relaciones.';
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
          this.error = 'No tienes permiso para eliminar relaciones.';
          return;
        }
        const ok = await this.app.removeOrganizationRelation(edge);
        if (!ok) this.error = this.app.organization.relations.error || 'No se pudo eliminar la relación.';
      },
      timestamp(value) {
        return this.app.formatServerTimestamp(value);
      }
    },
    template: `
      <section class="panel relations-panel" aria-labelledby="server-relations-title">
        <header class="panel__head">
          <div>
            <h2 id="server-relations-title">Relaciones</h2>
            <p>{{ state.total }} relaciones del servidor</p>
          </div>
          <button v-if="canEdit" type="button" class="btn btn--secondary btn--small" @click="openCreate">
            <app-icon name="plus" /> Añadir relación
          </button>
        </header>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="!canEdit" class="cell-note">Solo lectura: tu rol no permite modificar relaciones.</p>

        <form v-if="formOpen" class="relation-form" @submit.prevent="save">
          <div class="field">
            <label for="server-relation-type">Tipo</label>
            <span class="input-shell">
              <select id="server-relation-type" v-model="typeKey">
                <option v-for="type in typeChoices" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </span>
          </div>
          <div v-if="mode === 'create'" class="field">
            <label for="server-relation-target">Activo relacionado</label>
            <span class="input-shell">
              <input id="server-relation-target" v-model="search" type="search" placeholder="Buscar por nombre o código" autocomplete="off">
            </span>
            <span class="field__hint">Se usa el identificador del activo que devuelve el servidor.</span>
            <span class="input-shell">
              <select id="server-relation-target-select" v-model="targetId">
                <option value="">Selecciona un activo</option>
                <option v-for="asset in targetOptions" :key="asset.id" :value="asset.id">{{ asset.name || asset.code }}</option>
              </select>
            </span>
          </div>
          <div class="field">
            <label for="server-relation-reason">Motivo</label>
            <span class="input-shell"><input id="server-relation-reason" v-model="reason" type="text" maxlength="500"></span>
          </div>
          <div class="field">
            <label for="server-relation-notes">Notas</label>
            <span class="input-shell"><input id="server-relation-notes" v-model="notes" type="text" maxlength="500"></span>
          </div>
          <div class="field">
            <label for="server-relation-effective">Fecha efectiva</label>
            <span class="input-shell"><input id="server-relation-effective" v-model="effectiveAt" type="datetime-local"></span>
            <span class="field__hint">Opcional. Se registra junto al momento en que el servidor guardó el cambio.</span>
          </div>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <div class="relation-form__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="close">Cancelar</button>
            <button type="submit" class="btn btn--primary btn--small" :disabled="busy || !targetId && mode === 'create'">Guardar relación</button>
          </div>
        </form>

        <modal-shell :open="hostDialog.open" title="Cambiar host" eyebrow="Alojamiento" size="wide" @close="closeHostMove">
          <div class="form-stack host-move">
            <div class="assign-context">
              <span class="assign-context__icon"><app-icon name="layers" /></span>
              <div>
                <strong>{{ hostDialog.childName || hostDialog.childId }}</strong>
                <span class="mono">{{ hostDialog.childId }}</span>
              </div>
              <span class="cell-note">Activo que cambia de host</span>
            </div>

            <div class="field">
              <label for="server-host-search">Nuevo host</label>
              <span class="input-shell">
                <input id="server-host-search" v-model="hostDialog.search" type="search" placeholder="Buscar por nombre o código" autocomplete="off" aria-describedby="server-host-search-hint">
              </span>
              <span id="server-host-search-hint" class="field__hint">Búsqueda acotada al servidor; el identificador que se envía es el suyo.</span>
            </div>

            <div v-if="hostOptions.length" class="assign-options" role="group" aria-label="Hosts disponibles">
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
            <p v-else-if="!app.organization.assetSearch.loading" class="assign-empty">No hay activos que coincidan con la búsqueda.</p>
            <p v-if="app.organization.assetSearch.error" class="form-error" role="alert">{{ app.organization.assetSearch.error }}</p>

            <div class="field">
              <label for="server-host-reason">Motivo</label>
              <span class="input-shell"><input id="server-host-reason" v-model="hostDialog.reason" type="text" maxlength="500" aria-describedby="server-host-reason-hint"></span>
              <span id="server-host-reason-hint" class="field__hint">Obligatorio. El servidor exige al menos 4 caracteres.</span>
            </div>
            <div class="field">
              <label for="server-host-notes">Notas</label>
              <span class="input-shell"><input id="server-host-notes" v-model="hostDialog.notes" type="text" maxlength="500"></span>
            </div>
            <div class="field">
              <label for="server-host-effective">Fecha efectiva</label>
              <span class="input-shell"><input id="server-host-effective" v-model="hostDialog.effectiveAt" type="datetime-local" aria-describedby="server-host-effective-hint"></span>
              <span id="server-host-effective-hint" class="field__hint">Opcional. Se envía con la zona horaria del navegador.</span>
            </div>

            <p v-if="hostDialog.error" class="form-error" role="alert">{{ hostDialog.error }}</p>
          </div>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeHostMove">Cancelar</button>
            <button type="button" class="btn btn--primary" :disabled="hostDialog.busy || !hostDialog.newHostId" @click="submitHostMove">
              {{ hostDialog.busy ? 'Guardando…' : 'Guardar cambio de host' }}
            </button>
          </template>
        </modal-shell>

        <div v-if="outgoing.length" class="relation-group">
          <h3>Salientes</h3>
          <ul class="relation-list">
            <li v-for="edge in outgoing" :key="edge.id" class="relation-list__item" :class="'tone--' + (edge.tone || 'network')">
              <div>
                <strong>{{ typeLabel(edge) }}</strong>
                <span class="cell-note">{{ otherLabel(edge) }} · {{ timestamp(edge.recordedAt || edge.createdAt) }}</span>
                <p v-if="edge.reason" class="cell-note">Motivo: {{ edge.reason }}</p>
              </div>
              <div class="quick-actions">
                <button v-if="canEdit" type="button" class="quick-action" @click="openEdit(edge)"><app-icon name="pencil" /><span>Editar</span></button>
                <button v-if="canEdit && edge.typeKey === 'hosted_in'" type="button" class="quick-action" @click="openHostMove(edge)"><app-icon name="layers" /><span>Cambiar host</span></button>
                <button v-if="canEdit" type="button" class="quick-action quick-action--danger" @click="remove(edge)"><app-icon name="trash" /><span>Eliminar</span></button>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="incoming.length" class="relation-group">
          <h3>Entrantes</h3>
          <ul class="relation-list">
            <li v-for="edge in incoming" :key="edge.id" class="relation-list__item" :class="'tone--' + (edge.tone || 'network')">
              <div>
                <strong>{{ typeLabel(edge) }}</strong>
                <span class="cell-note">{{ otherLabel(edge) }}</span>
              </div>
            </li>
          </ul>
        </div>

        <p v-if="!outgoing.length && !incoming.length && !state.loading" class="cell-note">Sin relaciones registradas.</p>
      </section>
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
            <h2 id="server-types-title">Tipos de relación</h2>
            <p>Vocabulario administrado por el servidor.</p>
          </div>
          <button v-if="canConfigure" type="button" class="btn btn--secondary btn--small" @click="create">
            <app-icon name="plus" /> Nuevo tipo
          </button>
        </header>

        <p v-if="!canConfigure" class="cell-note">Solo lectura: necesitas el permiso de configuración general.</p>
        <p v-if="app.organization.types.error" class="form-error" role="alert">{{ app.organization.types.error }}</p>

        <div v-if="types.length" class="table-panel">
          <table class="asset-table">
            <caption class="sr-only">Tipos de relación disponibles</caption>
            <thead>
              <tr><th scope="col">Clave</th><th scope="col">Directa</th><th scope="col">Inversa</th><th scope="col">Contención</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="type in types" :key="type.key" class="asset-row">
                <td data-label="Clave"><span class="mono">{{ type.key }}</span></td>
                <td data-label="Directa"><span class="cell-strong">{{ type.label }}</span></td>
                <td data-label="Inversa"><span class="cell-strong">{{ type.inverse }}</span></td>
                <td data-label="Contención"><span class="type-tag">{{ type.containment ? 'Sí' : 'No' }}</span></td>
                <td data-label="Estado"><span class="status-pill" :class="type.active ? 'status-pill--online' : 'status-pill--retired'">{{ type.active ? 'Activo' : 'Inactivo' }}</span></td>
                <td data-label="Acciones">
                  <button v-if="canConfigure" type="button" class="quick-action" @click="edit(type)"><app-icon name="pencil" /><span>Editar</span></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="!app.organization.types.loading" class="cell-note">Sin tipos configurados.</p>

        <modal-shell :open="dialog.open" title="Tipo de relación" eyebrow="Configuración" @close="close">
          <form id="server-type-form" class="field-stack" @submit.prevent="save">
            <label class="field">
              <span class="field__label">Clave</span>
              <input v-model="dialog.key" type="text" :disabled="dialog.mode === 'edit'" maxlength="48" pattern="[a-z0-9_]+" required>
              <span class="field__hint">Minúsculas, números y guion bajo. No se puede cambiar después.</span>
            </label>
            <label class="field">
              <span class="field__label">Etiqueta directa</span>
              <input v-model="dialog.forwardLabel" type="text" maxlength="80" required>
            </label>
            <label class="field">
              <span class="field__label">Etiqueta inversa</span>
              <input v-model="dialog.inverseLabel" type="text" maxlength="80" required>
            </label>
            <label class="field field--inline">
              <input v-model="dialog.containment" type="checkbox">
              <span>Semántica de contención (rechaza ciclos de alojamiento)</span>
            </label>
            <label v-if="dialog.mode === 'edit'" class="field field--inline">
              <input v-model="dialog.active" type="checkbox">
              <span>Tipo activo</span>
            </label>
            <p v-if="dialog.error" class="form-error" role="alert">{{ dialog.error }}</p>
          </form>
          <template #footer>
            <button type="button" class="btn btn--ghost" @click="close">Cancelar</button>
            <button type="submit" form="server-type-form" class="btn btn--primary" :disabled="dialog.busy">Guardar tipo</button>
          </template>
        </modal-shell>
      </section>
    `
  };
})();
