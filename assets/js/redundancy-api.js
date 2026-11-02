/* Fase 5 — grupos de redundancia.
   Describe qué activos ya identificados se comportan como réplicas. No mueve,
   clona, mide, replica ni equilibra nada: el servidor guarda la configuración y
   este adaptador sólo la lee y la envía completa. */
(function () {
  'use strict';

  // Adapter copy (member labels, dialog summaries, validation, write failures)
  // is resolved at call time: the runtime and not a frozen literal decides the
  // language of the message.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const GROUP_PAGE_LIMIT = 200;
  const SEARCH_LIMIT = 50;
  const SEARCH_DEBOUNCE = 250;
  const MAX_MEMBERS = 50;
  const MIN_MEMBERS = 2;
  const MODES = ['active_active', 'active_passive'];
  const ROLES = ['primary', 'backup'];
  const SHARE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

  // Un epoch monotónico que nunca se reinicia: una respuesta tarde no puede
  // resucitar filas después de cerrar sesión ni reabrir un diálogo.
  let responseEpoch = 0;
  function nextEpoch() {
    responseEpoch += 1;
    return responseEpoch;
  }
  let sessionEpoch = 0;
  function nextSessionEpoch() {
    sessionEpoch += 1;
    return sessionEpoch;
  }
  // Interacciones: el diálogo abierto y la vista que lo contiene. Un cambio de
  // diálogo, de ruta o un desmontaje invalida lo que quedó en vuelo.
  let interactionEpoch = 0;
  function nextInteractionEpoch() {
    interactionEpoch += 1;
    return interactionEpoch;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function number(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function makeController() {
    return typeof AbortController === 'function' ? new AbortController() : null;
  }

  function pageState(limit) {
    return { items: [], total: 0, limit: limit, offset: 0, loading: false, loaded: false, error: '', epoch: 0, controller: null };
  }

  function assetGroupState() {
    return {
      assetId: '', items: [], total: 0, examined: 0, truncated: false,
      loading: false, loaded: false, error: '', epoch: 0, controller: null
    };
  }

  function blankDialog() {
    return {
      open: false, mode: 'create', id: '', name: '', description: '',
      groupMode: 'active_active', active: true, members: [],
      search: '', error: '', busy: false
    };
  }

  function mapHost(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const id = text(payload.id);
    if (!id) return null;
    return { id: id, name: text(payload.name) || id };
  }

  function mapMember(payload) {
    if (!payload || !text(payload.assetId)) return null;
    return {
      assetId: text(payload.assetId),
      name: text(payload.name),
      quickCode: text(payload.quickCode),
      archived: payload.archived === true,
      role: ROLES.indexOf(payload.role) === -1 ? '' : payload.role,
      share: typeof payload.share === 'string' ? payload.share : '',
      host: mapHost(payload.host)
    };
  }

  function mapGroup(payload) {
    if (!payload || !text(payload.id)) return null;
    const members = (Array.isArray(payload.members) ? payload.members : []).map(mapMember).filter(Boolean);
    return {
      id: text(payload.id),
      name: text(payload.name),
      description: text(payload.description),
      mode: MODES.indexOf(payload.mode) === -1 ? 'active_active' : payload.mode,
      active: payload.active !== false,
      createdAt: text(payload.createdAt),
      updatedAt: text(payload.updatedAt),
      memberCount: number(payload.memberCount, members.length),
      members: members
    };
  }

  function mapSearchAsset(payload) {
    if (!payload || !text(payload.id)) return null;
    return {
      id: text(payload.id),
      name: text(payload.name),
      quickCode: text(payload.quickCode),
      archived: payload.archived === true
    };
  }

  // Un porcentaje sólo es válido como texto decimal finito con dos decimales y
  // dentro de 0..100. Booleanos, NaN o Infinity nunca se convierten en números.
  function shareValue(share) {
    const value = text(share);
    if (!value || !SHARE_PATTERN.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
  }

  function cloneMember(member) {
    return {
      assetId: member.assetId,
      name: member.name,
      quickCode: member.quickCode,
      archived: member.archived === true,
      role: member.role,
      share: member.share,
      host: member.host ? { id: member.host.id, name: member.host.name } : null
    };
  }

  window.AssetRedundancy = {
    GROUP_PAGE_LIMIT: GROUP_PAGE_LIMIT,
    SEARCH_LIMIT: SEARCH_LIMIT,
    MAX_MEMBERS: MAX_MEMBERS,
    MIN_MEMBERS: MIN_MEMBERS,
    MODES: MODES,
    ROLES: ROLES,
    mapGroup: mapGroup,
    mapMember: mapMember,
    shareValue: shareValue,

    data() {
      return {
        redundancy: {
          groups: pageState(GROUP_PAGE_LIMIT),
          assetGroups: assetGroupState(),
          assetSearch: pageState(SEARCH_LIMIT),
          dialog: blankDialog(),
          sessionEpoch: nextSessionEpoch(),
          interactionEpoch: nextInteractionEpoch(),
          panelEpoch: nextInteractionEpoch(),
          searchTimer: null,
          busyId: '',
          error: ''
        }
      };
    },

    computed: {
      serverRedundancyMode() {
        return this.authenticated === true;
      },
      redundancyCanRead() {
        return !!(this.authenticated === true && typeof this.can === 'function' && this.can('assets.view'));
      },
      redundancyCanEdit() {
        return !!(this.authenticated === true && typeof this.can === 'function' && this.can('assets.edit'));
      },
      redundancyGroups() {
        return this.redundancy.groups.items;
      },
      // Asignación activo -> grupos cargados. Sólo describe la página pedida; la
      // interfaz declara el recorte en lugar de presentarla como inventario completo.
      redundancyMembership() {
        const map = {};
        this.redundancy.groups.items.forEach(function (group) {
          group.members.forEach(function (member) {
            if (!map[member.assetId]) map[member.assetId] = { count: 0, groups: [] };
            map[member.assetId].count += 1;
            map[member.assetId].groups.push({
              id: group.id,
              name: group.name,
              mode: group.mode,
              role: member.role,
              share: member.share
            });
          });
        });
        return map;
      }
    },

    methods: {
      /* ------------------------------------------------------- etiquetas */
      redundancyModeLabel(mode) {
        if (mode === 'active_passive') return tr('ui.redundancy.mode.active_passive');
        if (mode === 'active_active') return tr('ui.redundancy.mode.active_active');
        return text(mode);
      },
      redundancyRoleLabel(role) {
        if (role === 'primary') return tr('ui.redundancy.role.primary');
        if (role === 'backup') return tr('ui.redundancy.role.backup');
        return '';
      },
      redundancyShareLabel(member) {
        if (!member || member.role) return '';
        const value = text(member.share);
        return value ? tr('ui.redundancy.share_label', { share: value }) : '';
      },
      redundancyHostLabel(member) {
        const host = member && member.host;
        if (host && (host.name || host.id)) return tr('ui.redundancy.host_label', { host: text(host.name) || text(host.id) });
        return tr('ui.redundancy.host_none');
      },
      // Hechos de un miembro: nunca inventa un porcentaje donde el modo no lo tiene.
      redundancyMemberFacts(member) {
        const facts = [];
        const role = this.redundancyRoleLabel(member && member.role);
        if (role) facts.push(role);
        const share = this.redundancyShareLabel(member);
        if (share) facts.push(share);
        facts.push(this.redundancyHostLabel(member));
        return facts.join(' · ');
      },
      redundancyGroupsForAsset(assetId) {
        const id = text(assetId);
        if (!id) return [];
        return this.redundancy.groups.items.filter(function (group) {
          return group.members.some(function (member) { return member.assetId === id; });
        });
      },
      redundancyGroupForAsset(assetId) {
        return this.redundancyGroupsForAsset(assetId);
      },
      redundancyDialogMember(assetId) {
        const id = text(assetId);
        return this.redundancy.dialog.members.find(function (member) { return member.assetId === id; }) || null;
      },
      redundancyDraftSummary() {
        const dialog = this.redundancy.dialog;
        if (!dialog.members.length) return tr('ui.redundancy.draft.empty');
        if (dialog.groupMode === 'active_passive') {
          const primaries = dialog.members.filter(function (member) { return member.role === 'primary'; }).length;
          return tr('ui.redundancy.draft.summary_passive', { count: dialog.members.length, primaries: primaries });
        }
        return tr('ui.redundancy.draft.summary_active', { count: dialog.members.length });
      },

      /* ------------------------------------------- sesión y escritura */
      // Identidad efectiva de la sesión en uso. `applySession` puede reemplazar
      // usuario, permisos y CSRF dejando `authenticated` en true; una escritura
      // autorizada antes del reemplazo no puede completarse como si siguiera
      // siendo la misma sesión.
      redundancySessionIdentity() {
        const permissions = Array.isArray(this.serverPermissions) ? this.serverPermissions.slice().sort() : [];
        return text(this.activeUserId) + '|' + permissions.join(',');
      },
      redundancyReadOpen(identity) {
        return this.authenticated === true && identity === this.redundancySessionIdentity();
      },
      redundancyBumpInteraction() {
        this.redundancy.interactionEpoch = nextInteractionEpoch();
        return this.redundancy.interactionEpoch;
      },
      redundancyBumpPanel() {
        this.redundancy.panelEpoch = nextInteractionEpoch();
        return this.redundancy.panelEpoch;
      },
      // `scope: 'dialog'` ata la escritura al diálogo y a la interacción que la
      // inició; el panel usa un token de vista para que abrir o cerrar el
      // diálogo no cancele desactivar/reactivar.
      redundancyWriteToken(scope) {
        return {
          session: this.redundancy.sessionEpoch,
          identity: this.redundancySessionIdentity(),
          interaction: this.redundancy.interactionEpoch,
          panel: this.redundancy.panelEpoch,
          dialog: scope === 'dialog' ? this.redundancy.dialog : null,
          authenticated: this.authenticated === true
        };
      },
      redundancyWriteOpen(token) {
        if (!token || token.authenticated !== true || this.authenticated !== true) return false;
        if (token.session !== this.redundancy.sessionEpoch) return false;
        if (token.identity !== this.redundancySessionIdentity()) return false;
        if (token.panel !== this.redundancy.panelEpoch) return false;
        if (token.dialog) {
          if (this.redundancy.dialog !== token.dialog) return false;
          if (token.interaction !== this.redundancy.interactionEpoch) return false;
        }
        return true;
      },
      redundancyShowError(error, fallback) {
        const message = (error && error.message) || fallback;
        this.redundancy.error = message;
        if (typeof this.showToast === 'function') this.showToast(message, 'error');
        return message;
      },

      /* ------------------------------------------------------- lectura */
      async loadRedundancyGroupsForAsset(assetId, options) {
        const id = text(assetId);
        const state = this.redundancy.assetGroups;
        if (!id) return false;
        if (!this.redundancyCanRead) {
          state.items = [];
          state.loaded = false;
          state.error = tr('ui.redundancy.error.read_forbidden');
          return false;
        }
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        const offset = Math.max(0, number(options && options.offset, 0));
        state.epoch = epoch;
        state.controller = controller;
        state.assetId = id;
        state.loading = true;
        state.error = '';
        const identity = this.redundancySessionIdentity();
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/redundancy-groups?limit=' + GROUP_PAGE_LIMIT + '&offset=' + offset,
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== state.epoch || !this.redundancyReadOpen(identity)) return false;
          const all = (Array.isArray(payload.items) ? payload.items : []).map(mapGroup).filter(Boolean);
          state.items = all.filter(function (group) {
            return group.members.some(function (member) { return member.assetId === id; });
          });
          state.total = number(payload.total, all.length);
          state.examined = all.length;
          state.truncated = state.examined < state.total;
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.items = [];
          state.total = 0;
          state.examined = 0;
          state.truncated = false;
          state.loaded = false;
          state.error = (error && error.message) || tr('ui.redundancy.error.load_failed');
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },

      async loadRedundancyGroups(options) {
        const state = this.redundancy.groups;
        if (!this.redundancyCanRead) {
          state.items = [];
          state.loaded = false;
          state.error = tr('ui.redundancy.error.read_forbidden');
          return false;
        }
        const next = options || {};
        const identity = this.redundancySessionIdentity();
        const limit = Math.min(GROUP_PAGE_LIMIT, Math.max(1, number(next.limit, GROUP_PAGE_LIMIT)));
        const offset = Math.max(0, number(next.offset, 0));
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        state.epoch = epoch;
        state.controller = controller;
        state.loading = true;
        state.error = '';
        try {
          const params = ['limit=' + limit, 'offset=' + offset];
          const query = text(next.query);
          if (query) params.push('query=' + encodeURIComponent(query));
          if (next.active === true || next.active === false) params.push('active=' + (next.active ? 'true' : 'false'));
          if (MODES.indexOf(next.mode) !== -1) params.push('mode=' + next.mode);
          const payload = await window.AssetAccess.request(
            this,
            '/redundancy-groups?' + params.join('&'),
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== state.epoch || !this.redundancyReadOpen(identity)) return false;
          state.items = (Array.isArray(payload.items) ? payload.items : []).map(mapGroup).filter(Boolean);
          state.total = number(payload.total, state.items.length);
          state.limit = number(payload.limit, limit);
          state.offset = number(payload.offset, offset);
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.items = [];
          state.loaded = false;
          state.error = (error && error.message) || tr('ui.redundancy.error.load_failed');
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },

      async searchRedundancyAssets(query) {
        const state = this.redundancy.assetSearch;
        if (!this.redundancyCanRead) {
          state.items = [];
          state.error = tr('ui.redundancy.error.search_forbidden');
          return false;
        }
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        state.epoch = epoch;
        state.controller = controller;
        state.loading = true;
        state.error = '';
        const identity = this.redundancySessionIdentity();
        const interaction = this.redundancy.interactionEpoch;
        try {
          const term = text(query);
          const params = ['limit=' + SEARCH_LIMIT, 'offset=0'];
          if (term) params.push('query=' + encodeURIComponent(term));
          const payload = await window.AssetAccess.request(
            this,
            '/assets/search?' + params.join('&'),
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== state.epoch || !this.redundancyReadOpen(identity)) return false;
          if (interaction !== this.redundancy.interactionEpoch || !this.redundancy.dialog.open) return false;
          state.items = (Array.isArray(payload.items) ? payload.items : []).map(mapSearchAsset).filter(Boolean);
          state.total = number(payload.total, state.items.length);
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.items = [];
          state.loaded = false;
          state.error = (error && error.message) || tr('ui.redundancy.error.search_failed');
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },

      scheduleRedundancyAssetSearch(query) {
        this.cancelRedundancySearchTimer();
        const self = this;
        this.redundancy.searchTimer = setTimeout(function () {
          self.redundancy.searchTimer = null;
          self.searchRedundancyAssets(query);
        }, SEARCH_DEBOUNCE);
      },

      cancelRedundancySearchTimer() {
        if (this.redundancy.searchTimer) {
          clearTimeout(this.redundancy.searchTimer);
          this.redundancy.searchTimer = null;
        }
      },

      /* ------------------------------------------------------ diálogo */
      // Abrir el alta desde la ficha de un activo siembra ese activo: el panel
      // pertenece a esa ficha y un grupo creado ahí debe incluirla.
      openRedundancyCreate(seed) {
        if (!this.redundancyCanEdit) {
          if (typeof this.showToast === 'function') this.showToast(tr('ui.redundancy.error.create_forbidden'), 'error');
          return false;
        }
        this.redundancyBumpInteraction();
        const dialog = blankDialog();
        const assetId = text(seed && seed.id);
        if (assetId) {
          dialog.members = [{
            assetId: assetId,
            name: text(seed.name),
            quickCode: text(seed.quickCode),
            archived: seed.archived === true,
            role: '',
            share: ''
          }];
        }
        dialog.open = true;
        this.redundancy.dialog = dialog;
        this.searchRedundancyAssets('');
        return true;
      },

      openRedundancyEdit(group) {
        if (!this.redundancyCanEdit) {
          if (typeof this.showToast === 'function') this.showToast(tr('ui.redundancy.error.edit_forbidden'), 'error');
          return false;
        }
        if (!group || !text(group.id)) return false;
        this.redundancyBumpInteraction();
        this.redundancy.dialog = Object.assign(blankDialog(), {
          open: true,
          mode: 'edit',
          id: text(group.id),
          name: text(group.name),
          description: text(group.description),
          groupMode: group.mode === 'active_passive' ? 'active_passive' : 'active_active',
          active: group.active !== false,
          members: (group.members || []).map(cloneMember)
        });
        this.searchRedundancyAssets('');
        return true;
      },

      closeRedundancyDialog() {
        this.redundancyBumpInteraction();
        this.cancelRedundancySearchTimer();
        const search = this.redundancy.assetSearch;
        if (search.controller) search.controller.abort();
        this.redundancy.dialog.open = false;
      },

      setRedundancyDialogMode(mode) {
        const dialog = this.redundancy.dialog;
        const next = MODES.indexOf(mode) === -1 ? 'active_active' : mode;
        dialog.groupMode = next;
        dialog.error = '';
        dialog.members.forEach(function (member, index) {
          if (next === 'active_passive') {
            member.role = index === 0 ? 'primary' : 'backup';
            member.share = '';
          } else {
            member.role = '';
            member.share = text(member.share);
          }
        });
        return next;
      },

      addRedundancyMember(asset) {
        const dialog = this.redundancy.dialog;
        if (!dialog.open) return false;
        if (!asset || !text(asset.id)) return false;
        const id = text(asset.id);
        if (dialog.members.some(function (member) { return member.assetId === id; })) {
          dialog.error = tr('ui.redundancy.error.member_duplicate');
          return false;
        }
        if (dialog.members.length >= MAX_MEMBERS) {
          dialog.error = tr('ui.redundancy.error.max_members', { max: MAX_MEMBERS });
          return false;
        }
        dialog.members.push({
          assetId: id,
          name: text(asset.name),
          quickCode: text(asset.quickCode || asset.code),
          archived: asset.archived === true,
          role: dialog.groupMode === 'active_passive' ? (dialog.members.length === 0 ? 'primary' : 'backup') : '',
          share: '',
          host: asset.host && text(asset.host.id) ? mapHost(asset.host) : null
        });
        dialog.error = '';
        return true;
      },

      removeRedundancyMember(assetId) {
        const id = text(assetId);
        const dialog = this.redundancy.dialog;
        const before = dialog.members.length;
        dialog.members = dialog.members.filter(function (member) { return member.assetId !== id; });
        dialog.error = '';
        return dialog.members.length !== before;
      },

      setRedundancyShare(assetId, value) {
        const member = this.redundancyDialogMember(assetId);
        if (!member) return false;
        member.share = value === null || value === undefined ? '' : String(value);
        member.role = '';
        return true;
      },

      setRedundancyRole(assetId, role) {
        const member = this.redundancyDialogMember(assetId);
        if (!member) return false;
        if (ROLES.indexOf(role) === -1) return false;
        member.role = role;
        member.share = '';
        return true;
      },

      // Asistencia al servidor, no una segunda autoridad: el servidor vuelve a
      // validar modo, roles y reparto en la misma transacción.
      // Refleja las reglas del servidor por estado: un grupo activo exige dos
      // réplicas; un grupo inactivo puede quedar vacío o con una sola. Las reglas
      // de composición (suma 100, un Principal con Respaldo) aplican cuando la
      // lista está completa, que es cuando el servidor las aplica.
      validateRedundancyDialog() {
        const dialog = this.redundancy.dialog;
        const count = dialog.members.length;
        if (!text(dialog.name)) return tr('ui.redundancy.error.name_required');
        if (count > MAX_MEMBERS) return tr('ui.redundancy.error.max_members', { max: MAX_MEMBERS });
        const seen = {};
        for (let index = 0; index < count; index += 1) {
          const member = dialog.members[index];
          if (seen[member.assetId]) return tr('ui.redundancy.error.member_repeated');
          seen[member.assetId] = true;
        }
        if (count < MIN_MEMBERS) {
          if (dialog.mode === 'create') return tr('ui.redundancy.error.min_members', { min: MIN_MEMBERS });
          if (dialog.active !== false) return tr('ui.redundancy.error.min_members_active', { min: MIN_MEMBERS });
        }
        const complete = count >= MIN_MEMBERS;
        if (dialog.groupMode === 'active_active') {
          let cents = 0;
          for (let index = 0; index < count; index += 1) {
            const value = shareValue(dialog.members[index].share);
            if (value === null) {
              return tr('ui.redundancy.error.share_invalid');
            }
            cents += Math.round(value * 100);
          }
          if (complete && cents !== 10000) return tr('ui.redundancy.error.share_total');
          return '';
        }
        let primaries = 0;
        let backups = 0;
        for (let index = 0; index < count; index += 1) {
          const role = dialog.members[index].role;
          if (role === 'primary') primaries += 1;
          else if (role === 'backup') backups += 1;
          else return tr('ui.redundancy.error.role_required');
        }
        if (primaries > 1) return tr('ui.redundancy.error.one_primary');
        if (complete && primaries !== 1) return tr('ui.redundancy.error.one_primary');
        if (complete && backups < 1) return tr('ui.redundancy.error.backup_required');
        return '';
      },

      redundancyDialogPayload() {
        const dialog = this.redundancy.dialog;
        const description = text(dialog.description);
        const passive = dialog.groupMode === 'active_passive';
        return {
          name: text(dialog.name),
          description: description ? description : null,
          mode: dialog.groupMode,
          active: dialog.active !== false,
          members: dialog.members.map(function (member) {
            if (passive) return { assetId: member.assetId, role: member.role };
            return { assetId: member.assetId, share: text(member.share) };
          })
        };
      },

      async redundancyRefreshAfterWrite(token) {
        const state = this.redundancy;
        if (state.groups.loaded) {
          await this.loadRedundancyGroups({ offset: state.groups.offset });
          if (!this.redundancyWriteOpen(token)) return false;
        }
        if (state.assetGroups.assetId) {
          await this.loadRedundancyGroupsForAsset(state.assetGroups.assetId);
          if (!this.redundancyWriteOpen(token)) return false;
        }
        return true;
      },

      async saveRedundancyGroup() {
        const dialog = this.redundancy.dialog;
        if (!dialog.open) return false;
        if (!this.redundancyCanEdit) {
          dialog.error = tr('ui.redundancy.error.save_forbidden');
          return false;
        }
        if (dialog.busy) return false;
        const invalid = this.validateRedundancyDialog();
        if (invalid) {
          dialog.error = invalid;
          return false;
        }
        dialog.busy = true;
        dialog.error = '';
        this.redundancy.error = '';
        const token = this.redundancyWriteToken('dialog');
        const creating = dialog.mode === 'create';
        try {
          const body = this.redundancyDialogPayload();
          const path = creating
            ? '/redundancy-groups'
            : '/redundancy-groups/' + encodeURIComponent(dialog.id);
          const payload = await window.AssetAccess.request(this, path, {
            method: creating ? 'POST' : 'PATCH',
            body: body
          });
          if (!this.redundancyWriteOpen(token)) return false;
          const saved = mapGroup(payload);
          if (!saved) throw new Error(tr('ui.redundancy.error.server_group_missing'));
          dialog.open = false;
          this.cancelRedundancySearchTimer();
          await this.redundancyRefreshAfterWrite(token);
          if (!this.redundancyWriteOpen(token)) return false;
          if (typeof this.showToast === 'function') {
            this.showToast(creating ? tr('ui.redundancy.toast.created') : tr('ui.redundancy.toast.updated'));
          }
          return true;
        } catch (error) {
          if (!this.redundancyWriteOpen(token)) return false;
          if (this.redundancy.dialog !== dialog) return false;
          dialog.error = (error && error.message) || tr('ui.redundancy.error.save_failed');
          return false;
        } finally {
          if (this.redundancy.dialog === dialog) dialog.busy = false;
        }
      },

      async deactivateRedundancyGroup(group) {
        if (!group || !text(group.id)) return false;
        if (!this.redundancyCanEdit) {
          this.redundancy.error = tr('ui.redundancy.error.deactivate_forbidden');
          return false;
        }
        if (this.redundancy.busyId) return false;
        const token = this.redundancyWriteToken('panel');
        const self = this;
        this.redundancy.busyId = text(group.id);
        this.redundancy.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/redundancy-groups/' + encodeURIComponent(text(group.id)) + '/deactivate',
            { method: 'POST', body: {} }
          );
          if (!this.redundancyWriteOpen(token)) return false;
          if (!mapGroup(payload)) throw new Error(tr('ui.redundancy.error.server_deactivated_missing'));
          await this.redundancyRefreshAfterWrite(token);
          if (!this.redundancyWriteOpen(token)) return false;
          if (typeof this.showToast === 'function') this.showToast(tr('ui.redundancy.toast.deactivated'), 'ok');
          return true;
        } catch (error) {
          if (!this.redundancyWriteOpen(token)) return false;
          this.redundancyShowError(
            { message: (error && error.status === 409
              ? tr('ui.redundancy.error.deactivate_conflict')
              : (error && error.message)) },
            tr('ui.redundancy.error.deactivate_failed')
          );
          return false;
        } finally {
          if (self.redundancy.busyId === text(group.id)) self.redundancy.busyId = '';
        }
      },

      async reactivateRedundancyGroup(group) {
        if (!group || !text(group.id)) return false;
        if (!this.redundancyCanEdit) {
          this.redundancy.error = tr('ui.redundancy.error.reactivate_forbidden');
          return false;
        }
        if (this.redundancy.busyId) return false;
        const token = this.redundancyWriteToken('panel');
        const self = this;
        this.redundancy.busyId = text(group.id);
        this.redundancy.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/redundancy-groups/' + encodeURIComponent(text(group.id)),
            { method: 'PATCH', body: { active: true } }
          );
          if (!this.redundancyWriteOpen(token)) return false;
          if (!mapGroup(payload)) throw new Error(tr('ui.redundancy.error.server_reactivated_missing'));
          await this.redundancyRefreshAfterWrite(token);
          if (!this.redundancyWriteOpen(token)) return false;
          if (typeof this.showToast === 'function') this.showToast(tr('ui.redundancy.toast.reactivated'), 'ok');
          return true;
        } catch (error) {
          if (!this.redundancyWriteOpen(token)) return false;
          this.redundancyShowError(error, tr('ui.redundancy.error.reactivate_failed'));
          return false;
        } finally {
          if (self.redundancy.busyId === text(group.id)) self.redundancy.busyId = '';
        }
      },

      /* ------------------------------------------- rutas y limpieza */
      // Cualquier cambio de ruta abandona la interacción anterior: el diálogo se
      // cierra, su búsqueda se cancela y una escritura en vuelo deja de poder
      // completarse en la vista nueva. No se afirma cancelación en el servidor.
      handleRedundancyRoute(next) {
        if (!this.authenticated || !next) return false;
        this.redundancyBumpInteraction();
        this.redundancyBumpPanel();
        if (this.redundancy.dialog.open) this.closeRedundancyDialog();
        else this.cancelRedundancySearchTimer();
        if (next.name === 'graph') return this.loadRedundancyGroups({});
        return false;
      },

      clearRedundancyState() {
        const state = this.redundancy;
        [state.groups, state.assetGroups, state.assetSearch].forEach(function (resource) {
          if (resource && resource.controller) resource.controller.abort();
        });
        this.cancelRedundancySearchTimer();
        state.sessionEpoch = nextSessionEpoch();
        state.interactionEpoch = nextInteractionEpoch();
        state.panelEpoch = nextInteractionEpoch();
        state.groups = pageState(GROUP_PAGE_LIMIT);
        state.assetGroups = assetGroupState();
        state.assetSearch = pageState(SEARCH_LIMIT);
        state.dialog = blankDialog();
        state.busyId = '';
        state.error = '';
      }
    }
  };
})();
