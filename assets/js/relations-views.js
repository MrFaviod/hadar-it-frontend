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
})();
