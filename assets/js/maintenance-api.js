(function () {
  'use strict';

  /* Phase 7 maintenance adapter.
   *
   * The server is the only authority for templates, plans, interventions and
   * incidents. Two monotonic counters protect this state:
   * - each resource has an epoch, so a superseded response can never overwrite
   *   a newer read (filters, pagination, asset change or remount);
   * - a session epoch plus the active user id is captured in a token, so a read
   *   or write that finishes after logout, 401, identity rotation or unmount
   *   stays inert instead of resurrecting data or toasts.
   *
   * Monitoring alerts are intentionally outside this adapter: they remain the
   * explicitly demo collection owned by the monitoring phase. */

  const Data = window.ASSET_MAINT;
  const Engine = window.AssetMaintEngine;
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;
  const SEARCH_LIMIT = 20;
  const FALLBACK_ERROR = 'No se pudo completar la solicitud de mantenimiento.';

  let responseEpoch = 0;
  let sessionEpoch = 0;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function count(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, count(value, minimum)));
  }

  function makeController() {
    return typeof AbortController === 'function' ? new AbortController() : null;
  }

  function nextEpoch() {
    responseEpoch += 1;
    return responseEpoch;
  }

  function nextSessionEpoch() {
    sessionEpoch += 1;
    return sessionEpoch;
  }

  function copy(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function page() {
    return { items: [], total: 0, limit: DEFAULT_LIMIT, offset: 0, loaded: false, loading: false, error: '', epoch: nextEpoch(), controller: null };
  }

  function single() {
    return { id: '', record: null, loaded: false, loading: false, error: '', missing: false, epoch: nextEpoch(), controller: null, prepare: null };
  }

  function createState() {
    return {
      identity: '',
      session: 0,
      writeVersion: 0,
      alerts: Data.seedAlerts(),
      prefs: Object.assign({}, Data.PREFS),
      templates: page(),
      plans: page(),
      planFilters: { state: '', status: '', category: '', siteId: '', assetId: '', maintenanceType: '', dueFrom: '', dueTo: '', completedFrom: '', completedTo: '', upcomingDays: '' },
      interventions: page(),
      interventionFilters: { status: '', type: '', assetId: '', category: '', siteId: '', occurredFrom: '', occurredTo: '', incidentId: '', planId: '' },
      incidents: page(),
      incidentFilters: { status: '', priority: '', assetId: '', responsiblePersonId: '', category: '', siteId: '', openedFrom: '', openedTo: '' },
      planDetail: single(),
      interventionDetail: single(),
      incidentDetail: single(),
      costs: { record: null, loading: false, error: '', epoch: nextEpoch(), controller: null },
      overview: {
        loading: false,
        loaded: false,
        error: '',
        epoch: nextEpoch(),
        controller: null,
        overdue: null,
        upcoming: null,
        inProgress: null,
        openInterventions: null,
        openIncidents: null,
        criticalIncidents: null,
        plans: null
      },
      assetWork: {
        assetId: '',
        epoch: nextEpoch(),
        controllers: [],
        plans: page(),
        interventions: page(),
        incidents: page(),
        history: page(),
        loaded: false,
        loading: false,
        error: ''
      }
    };
  }

  function moneyValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function assetSummary(source) {
    const dto = source && typeof source === 'object' ? source : {};
    const id = text(dto.id || dto.assetId);
    if (!id) return null;
    return {
      id,
      name: text(dto.name || dto.assetName),
      quickCode: text(dto.quickCode || dto.assetQuickCode),
      code: text(dto.quickCode || dto.assetQuickCode),
      category: text(dto.category || dto.assetCategory),
      categoryText: text(dto.category || dto.assetCategory),
      site: text(dto.site),
      siteId: text(dto.siteId),
      serverAsset: true
    };
  }

  function mapAssetChoice(dto) {
    const asset = assetSummary(dto);
    if (!asset) return null;
    asset.status = text(dto.status);
    asset.statusLabel = text(dto.statusLabel);
    return asset;
  }

  function mapPersonChoice(dto) {
    const id = text(dto && dto.id);
    if (!id) return null;
    const name = text(dto.name);
    const role = text(dto.role || dto.roleLabel || dto.department);
    return { id, name, label: role ? name + ' · ' + role : name, role };
  }

  function mapTaskList(value) {
    return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean);
  }

  function mapTemplate(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const maintenanceType = text(source.maintenanceType) || 'preventivo';
    return {
      id: text(source.id),
      category: text(source.category),
      categoryText: text(source.category),
      maintenanceType,
      typeLabel: Engine.typeMeta(maintenanceType).label,
      label: Engine.typeMeta(maintenanceType).label,
      intervalMonths: count(source.intervalMonths, 0),
      tasks: mapTaskList(source.tasks),
      responsiblePersonId: text(source.responsiblePersonId),
      responsibleLabel: text(source.responsibleLabel),
      active: source.active !== false,
      source: text(source.source)
    };
  }

  function mapPlan(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const maintenanceType = text(source.maintenanceType) || 'preventivo';
    const type = Engine.typeMeta(maintenanceType);
    const asset = assetSummary(source.asset) || { id: text(source.assetId), name: text(source.assetName), quickCode: text(source.assetQuickCode), category: text(source.assetCategory), serverAsset: true };
    const record = {
      id: text(source.id),
      assetId: text(source.assetId),
      assetQuickCode: text(source.assetQuickCode),
      assetName: text(source.assetName),
      assetCategory: text(source.assetCategory),
      siteId: text(source.siteId),
      site: text(source.site),
      maintenanceType,
      typeLabel: type.label,
      label: type.label,
      name: type.label + (text(source.assetName) ? ' · ' + text(source.assetName) : ''),
      title: type.label + (text(source.assetName) ? ' · ' + text(source.assetName) : ''),
      intervalMonths: count(source.intervalMonths, 0),
      tasks: mapTaskList(source.tasks),
      responsiblePersonId: text(source.responsiblePersonId),
      responsibleLabel: text(source.responsibleLabel),
      status: text(source.status) || 'active',
      scheduledOn: Engine.toDay(source.scheduledOn),
      lastCompletedOn: Engine.toDay(source.lastCompletedOn),
      dueOn: Engine.toDay(source.dueOn),
      persisted: source.persisted !== false,
      createdAt: text(source.createdAt),
      updatedAt: text(source.updatedAt),
      asset,
      templateId: maintenanceType,
      lastCompletedAt: Engine.toDay(source.lastCompletedOn),
      dueAt: Engine.toDay(source.dueOn),
      daysUntil: Engine.daysUntil(Engine.toDay(source.dueOn), Engine.today())
    };
    return record;
  }

  function mapPart(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    return {
      name: text(source.name),
      quantity: count(source.quantity, 0),
      unitCost: text(source.unitCost),
      unitCostValue: moneyValue(source.unitCost)
    };
  }

  function mapAttachment(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    return { id: text(source.id), filename: text(source.filename), category: text(source.category), name: text(source.filename) };
  }

  function mapIntervention(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const type = Engine.typeMeta(source.type);
    const description = text(source.description);
    const record = {
      id: text(source.id),
      assetId: text(source.assetId),
      assetName: text(source.assetName),
      assetQuickCode: text(source.assetQuickCode),
      assetCategory: text(source.assetCategory),
      type: text(source.type) || 'other',
      typeLabel: type.label,
      label: type.label,
      description,
      title: description || type.label,
      technicianPersonId: text(source.technicianPersonId),
      technicianName: text(source.technicianName),
      occurredOn: Engine.toDay(source.occurredOn),
      date: Engine.toDay(source.occurredOn),
      status: text(source.status) || 'open',
      state: text(source.status) || 'open',
      notes: text(source.notes),
      parts: (Array.isArray(source.parts) ? source.parts : []).map(mapPart),
      laborCost: text(source.laborCost),
      laborCostValue: moneyValue(source.laborCost),
      partsCost: text(source.partsCost),
      partsCostValue: moneyValue(source.partsCost),
      totalCost: text(source.totalCost),
      totalCostValue: moneyValue(source.totalCost),
      attachmentIds: (Array.isArray(source.attachmentIds) ? source.attachmentIds : []).map((id) => text(id)).filter(Boolean),
      attachments: (Array.isArray(source.attachments) ? source.attachments : []).map(mapAttachment),
      incidentId: text(source.incidentId),
      planId: text(source.planId),
      createdBy: text(source.createdBy),
      createdAt: text(source.createdAt),
      updatedAt: text(source.updatedAt),
      asset: { id: text(source.assetId), name: text(source.assetName), quickCode: text(source.assetQuickCode), category: text(source.assetCategory), serverAsset: true }
    };
    return record;
  }

  function eventLabel(action) {
    const labels = {
      created: 'Incidente creado',
      acknowledged: 'Incidente reconocido',
      status_changed: 'Estado actualizado',
      assets_updated: 'Activos afectados actualizados',
      intervention_linked: 'Intervención vinculada',
      resolution_prepared: 'Resolución preparada',
      resolution_confirmed: 'Resolución confirmada',
      resolved: 'Incidente resuelto',
      closed: 'Incidente cerrado'
    };
    const key = text(action);
    return labels[key] || key || 'Actuación registrada';
  }

  function mapEvent(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const changes = source.changes && typeof source.changes === 'object' ? copy(source.changes) : null;
    const note = text(source.note);
    const label = eventLabel(source.action);
    const transition = text(source.fromStatus) && text(source.toStatus) ? ' · ' + text(source.fromStatus) + ' → ' + text(source.toStatus) : '';
    return {
      id: text(source.id),
      action: text(source.action),
      at: text(source.createdAt),
      actor: text(source.actorUsername) || text(source.actorId),
      text: note || label + transition,
      label,
      changes
    };
  }

  function mapCosts(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      total: moneyValue(source.totalCost),
      count: Number(source.countedInterventions) || 0
    };
  }

  function mapIncident(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const description = text(source.description);
    const status = text(source.status) || 'open';
    return {
      id: text(source.id),
      description,
      title: description || 'Incidente técnico',
      status,
      state: status,
      priority: text(source.priority) || 'normal',
      primaryAssetId: text(source.primaryAssetId),
      primaryAssetName: text(source.primaryAssetName),
      primaryAssetQuickCode: text(source.primaryAssetQuickCode),
      primaryAssetCategory: text(source.primaryAssetCategory),
      siteId: text(source.siteId),
      responsiblePersonId: text(source.responsiblePersonId),
      responsibleName: text(source.responsibleName),
      openedOn: Engine.toDay(source.openedOn),
      openedAt: Engine.toDay(source.openedOn),
      resolvedAt: text(source.resolvedAt),
      closedAt: text(source.closedAt),
      revision: count(source.revision, 0),
      affectedAssetIds: (Array.isArray(source.affectedAssetIds) ? source.affectedAssetIds : (Array.isArray(source.affectedAssets) ? source.affectedAssets.map((item) => text(item.id)) : [])).filter(Boolean),
      affectedAssets: (Array.isArray(source.affectedAssets) ? source.affectedAssets : []).map(assetSummary).filter(Boolean),
      events: (Array.isArray(source.events) ? source.events : []).map(mapEvent),
      interventions: (Array.isArray(source.interventions) ? source.interventions : []).map(mapIntervention),
      interventionsTotal: count(source.interventionsTotal, Array.isArray(source.interventions) ? source.interventions.length : 0),
      costs: mapCosts(source.costs),
      resolution: source.resolution && typeof source.resolution === 'object'
        ? { preparedAt: text(source.resolution.preparedAt), preparedBy: text(source.resolution.preparedBy), revision: count(source.resolution.revision, 0) }
        : (text(source.resolutionPreparedAt) ? { preparedAt: text(source.resolutionPreparedAt), preparedBy: text(source.resolutionPreparedBy), revision: count(source.revision, 0) } : null),
      createdAt: text(source.createdAt),
      updatedAt: text(source.updatedAt)
    };
  }

  const TECHNICAL_EVENT_LABELS = {
    incident_opened: 'Incidencia abierta',
    incident_acknowledged: 'Incidencia reconocida',
    incident_resolved: 'Incidencia resuelta',
    incident_closed: 'Incidencia cerrada',
    incident_assets_updated: 'Activos afectados actualizados',
    incident_resolution_prepared: 'Resolución preparada',
    incident_resolution_confirmed: 'Resolución confirmada',
    intervention_logged: 'Intervención registrada',
    intervention_completed: 'Intervención completada',
    intervention_updated: 'Intervención actualizada',
    intervention_linked: 'Intervención vinculada',
    maintenance_plan_created: 'Plan preventivo creado',
    maintenance_plan_updated: 'Plan preventivo actualizado',
    maintenance_completed: 'Mantenimiento completado',
    maintenance_postponed: 'Mantenimiento pospuesto',
    maintenance_cancelled: 'Mantenimiento cancelado'
  };

  function mapTechnicalHistory(dto) {
    const source = dto && typeof dto === 'object' ? dto : {};
    const at = text(source.occurredAt) || text(source.recordedAt) || text(source.createdAt);
    const action = text(source.action);
    return {
      id: text(source.id),
      title: text(source.title) || TECHNICAL_EVENT_LABELS[action] || action || text(source.kind) || text(source.type) || 'Trabajo técnico',
      detail: text(source.description) || text(source.summary) || text(source.notes),
      at,
      kind: text(source.kind) || text(source.type) || action,
      reference: text(source.interventionId) || text(source.incidentId) || text(source.entityId),
      raw: copy(source)
    };
  }

  function applyPage(target, payload, mapper, append) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const items = (Array.isArray(source.items) ? source.items : []).map(mapper).filter(Boolean);
    target.items = append ? target.items.concat(items) : items;
    target.total = count(source.total, target.items.length);
    target.limit = count(source.limit, target.limit);
    target.offset = count(source.offset, target.offset);
    target.loaded = true;
    target.error = '';
  }

  function queryString(params) {
    const url = new URL('http://maintenance.local/');
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value === null || value === undefined || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.search;
  }

  function filterParams(filters, aliases) {
    const out = {};
    Object.keys(filters || {}).forEach((key) => {
      const value = filters[key];
      if (value === '' || value === 'all' || value === null || value === undefined) return;
      out[(aliases && aliases[key]) || key] = value;
    });
    return out;
  }

  /* Callers pass the complete active filter object. Replacing every stored key
   * prevents a previously selected value from leaking into the next request
   * after the user clears it. */
  function syncFilters(target, filters) {
    const source = filters && typeof filters === 'object' ? filters : {};
    Object.keys(target).forEach((key) => {
      target[key] = text(source[key]);
    });
  }

  function errorMessage(error) {
    return (error && (error.message || error.detail)) || FALLBACK_ERROR;
  }

  window.AssetMaintenanceApi = {
    data() {
      return { maintenanceApi: createState() };
    },

    computed: {
      maintenanceAvailable() {
        return !!(this.authenticated && this.can && this.can('assets.view'));
      },
      maintenanceEditable() {
        return !!(this.authenticated && this.can && this.can('assets.edit'));
      },
      maintenanceConfigurable() {
        return !!(this.authenticated && this.can && this.can('config.general'));
      },
      maintenanceTemplates() {
        return this.maintenanceApi ? this.maintenanceApi.templates.items : [];
      },
      maintenancePlans() {
        return this.maintenanceApi ? this.maintenanceApi.plans.items : [];
      },
      maintenanceInterventions() {
        return this.maintenanceApi ? this.maintenanceApi.interventions.items : [];
      },
      maintenanceIncidents() {
        return this.maintenanceApi ? this.maintenanceApi.incidents.items : [];
      },
      maintenancePlanning() {
        const api = this.maintenanceApi || {};
        return {
          types: Data.INTERVENTION_TYPES,
          templates: api.templates ? api.templates.items : [],
          plans: api.plans ? api.plans.items : [],
          interventions: api.interventions ? api.interventions.items : [],
          incidents: api.incidents ? api.incidents.items : [],
          alerts: api.alerts || [],
          prefs: api.prefs || Object.assign({}, Data.PREFS),
          overview: api.overview || {},
          loading: !!(api.plans && api.plans.loading),
          errors: {
            templates: api.templates ? api.templates.error : '',
            plans: api.plans ? api.plans.error : '',
            interventions: api.interventions ? api.interventions.error : '',
            incidents: api.incidents ? api.incidents.error : ''
          },
          totals: {
            templates: api.templates ? api.templates.total : 0,
            plans: api.plans ? api.plans.total : 0,
            interventions: api.interventions ? api.interventions.total : 0,
            incidents: api.incidents ? api.incidents.total : 0
          }
        };
      },
      maintenanceDetail() {
        return this.maintenanceApi ? this.maintenanceApi.incidentDetail : null;
      },
      maintenanceAssetWork() {
        return this.maintenanceApi ? this.maintenanceApi.assetWork : null;
      },
      maintenanceCosts() {
        return this.maintenanceApi && this.maintenanceApi.costs ? this.maintenanceApi.costs.record : null;
      }
    },

    methods: {
      maintenanceToken() {
        return {
          session: this.maintenanceApi ? this.maintenanceApi.session : -1,
          identity: this.authenticated ? text(this.activeUserId) : '',
          active: this.authenticated ? text(this.activeUserId) : ''
        };
      },
      maintenanceTokenOpen(token) {
        if (!token || !this.maintenanceApi || !this.authenticated) return false;
        return this.maintenanceApi.session === token.session && text(this.activeUserId) === token.identity;
      },
      maintenanceOwns(target, token) {
        return !!target && this.maintenanceTokenOpen(token);
      },
      maintenanceAbort(target) {
        if (target && target.controller) target.controller.abort();
        if (target) target.controller = null;
      },
      maintenanceInvalidate() {
        if (!this.maintenanceApi) return;
        this.maintenanceApi.writeVersion += 1;
      },
      maintenanceVersion() {
        return this.maintenanceApi ? this.maintenanceApi.writeVersion : 0;
      },
      async maintenanceRead(target, path, options, apply) {
        if (!this.maintenanceAvailable) return false;
        const token = this.maintenanceToken();
        const epoch = nextEpoch();
        const version = this.maintenanceVersion();
        target.epoch = epoch;
        this.maintenanceAbort(target);
        const controller = makeController();
        target.controller = controller;
        target.loading = true;
        target.error = '';
        try {
          const payload = await window.AssetAccess.request(this, path, Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined }));
          if (epoch !== target.epoch || version !== this.maintenanceVersion() || !this.maintenanceOwns(target, token)) return false;
          apply(payload);
          return true;
        } catch (error) {
          if (epoch !== target.epoch || !this.maintenanceTokenOpen(token)) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) {
            this.clearMaintenanceState();
            return false;
          }
          target.error = errorMessage(error);
          return false;
        } finally {
          if (epoch === target.epoch && this.maintenanceTokenOpen(token) && target.controller === controller) {
            target.loading = false;
            target.controller = null;
          }
        }
      },
      async maintenanceWrite(token, request) {
        if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
        try {
          const payload = await request();
          if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
          this.maintenanceInvalidate();
          return { ok: true, payload };
        } catch (error) {
          if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
          if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
          if (error && error.status === 401) {
            this.clearMaintenanceState();
            return { ok: false, cancelled: true };
          }
          return { ok: false, error: errorMessage(error), fieldErrors: (error && error.fieldErrors) || null };
        }
      },
      maintenanceAnnounce(result) {
        if (result && result.error && this.showToast) this.showToast(result.error, 'error');
      },

      /* ------------------------------------------------------------ templates */
      async loadMaintenanceTemplates(options) {
        if (!this.maintenanceAvailable) return false;
        const state = this.maintenanceApi.templates;
        const opts = options || {};
        if (opts.reset) state.offset = 0;
        if (opts.category !== undefined) state.category = text(opts.category);
        const params = { limit: state.limit, offset: state.offset };
        if (state.category) params.category = state.category;
        return this.maintenanceRead(state, '/maintenance/templates' + queryString(params), {}, (payload) => applyPage(state, payload, mapTemplate, !!opts.append));
      },
      async saveMaintenanceTemplate(id, payload) {
        if (!this.maintenanceConfigurable) return { ok: false, error: 'No tienes permiso para configurar mantenimiento.' };
        const token = this.maintenanceToken();
        const path = id ? '/maintenance/templates/' + encodeURIComponent(id) : '/maintenance/templates';
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, path, { method: id ? 'PATCH' : 'POST', body: payload }));
        if (result.ok) {
          this.maintenanceApi.templates.loaded = false;
          await Promise.all([this.loadMaintenanceTemplates({ reset: true }), this.maintenanceApi.plans.loaded ? this.loadMaintenancePlans() : true]);
        }
        return Object.assign(result, { template: result.ok ? mapTemplate(result.payload) : null });
      },
      async deleteMaintenanceTemplate(id) {
        if (!this.maintenanceConfigurable) return { ok: false, error: 'No tienes permiso para configurar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/templates/' + encodeURIComponent(id), { method: 'DELETE' }));
        if (result.ok) {
          this.maintenanceApi.templates.loaded = false;
          await Promise.all([this.loadMaintenanceTemplates({ reset: true }), this.maintenanceApi.plans.loaded ? this.loadMaintenancePlans() : true]);
        }
        return result;
      },

      /* ---------------------------------------------------------------- plans */
      async loadMaintenancePlans(options) {
        if (!this.maintenanceAvailable) return false;
        const opts = options || {};
        const pageState = this.maintenanceApi.plans;
        if (opts.reset) pageState.offset = 0;
        if (opts.filters) syncFilters(this.maintenanceApi.planFilters, opts.filters);
        const params = filterParams(this.maintenanceApi.planFilters);
        params.limit = pageState.limit;
        params.offset = pageState.offset;
        return this.maintenanceRead(pageState, '/maintenance/plans' + queryString(params), {}, (payload) => {
          applyPage(pageState, payload, mapPlan, !!opts.append);
        });
      },
      async loadMoreMaintenancePlans() {
        const state = this.maintenanceApi.plans;
        if (state.loading || state.offset + state.items.length >= state.total) return false;
        state.offset = state.items.length;
        return this.loadMaintenancePlans({ append: true });
      },
      async loadMaintenanceOverview() {
        if (!this.maintenanceAvailable) return false;
        const overview = this.maintenanceApi.overview;
        const token = this.maintenanceToken();
        const epoch = nextEpoch();
        overview.epoch = epoch;
        this.maintenanceAbort(overview);
        const controller = makeController();
        overview.controller = controller;
        overview.loading = true;
        overview.error = '';
        const signal = controller ? controller.signal : undefined;
        const requests = [
          ['overdue', '/maintenance/plans?state=overdue&limit=1'],
          ['upcoming', '/maintenance/plans?state=upcoming&upcomingDays=14&limit=1'],
          ['plans', '/maintenance/plans?limit=1'],
          ['inProgress', '/interventions?status=in_progress&limit=1'],
          ['openInterventions', '/interventions?status=open&limit=1'],
          ['openIncidents', '/incidents?status=open&limit=1'],
          ['criticalIncidents', '/incidents?status=open&priority=critical&limit=1']
        ];
        try {
          const results = await Promise.allSettled(requests.map((entry) => window.AssetAccess.request(this, entry[1], { signal })));
          if (epoch !== overview.epoch || !this.maintenanceTokenOpen(token)) return false;
          const unauthorized = results.find((result) => result.status === 'rejected' && result.reason && result.reason.status === 401);
          if (unauthorized) {
            this.clearMaintenanceState();
            return false;
          }
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') return;
            overview[requests[index][0]] = count(result.value && result.value.total, 0);
          });
          overview.loaded = true;
          return true;
        } finally {
          if (epoch === overview.epoch && this.maintenanceTokenOpen(token) && overview.controller === controller) {
            overview.loading = false;
            overview.controller = null;
          }
        }
      },
      async loadMaintenancePlan(id) {
        const planId = text(id);
        if (!planId) return false;
        const target = this.maintenanceApi.planDetail;
        const ok = await this.maintenanceRead(target, '/maintenance/plans/' + encodeURIComponent(planId), {}, (payload) => {
          target.id = planId;
          target.record = mapPlan(payload);
          target.loaded = true;
          target.missing = false;
        });
        if (!ok && target.error && !target.loading) target.missing = true;
        return ok;
      },
      async saveMaintenancePlan(payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/plans', { method: 'POST', body: payload }));
        return this.maintenancePlanWriteResult(result, payload.assetId);
      },
      async updateMaintenancePlan(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/plans/' + encodeURIComponent(id), { method: 'PATCH', body: payload }));
        return this.maintenancePlanWriteResult(result);
      },
      maintenancePlanWriteResult(result, assetId) {
        if (!result.ok) return result;
        const plan = mapPlan(result.payload);
        if (this.maintenanceApi.planDetail.id === plan.id) {
          this.maintenanceApi.planDetail.record = plan;
          this.maintenanceApi.planDetail.loaded = true;
        }
        return this.maintenanceRefreshAfterWrite({ assetId: assetId || plan.assetId, plan: plan, result });
      },
      async completeMaintenancePlan(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/plans/' + encodeURIComponent(id) + '/complete', { method: 'POST', body: payload || {} }));
        return this.maintenancePlanWriteResult(result);
      },
      async postponeMaintenancePlan(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/plans/' + encodeURIComponent(id) + '/postpone', { method: 'POST', body: payload || {} }));
        return this.maintenancePlanWriteResult(result);
      },
      async cancelMaintenancePlan(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar mantenimiento.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/maintenance/plans/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: payload || {} }));
        return this.maintenancePlanWriteResult(result);
      },

      /* --------------------------------------------------------- interventions */
      async loadMaintenanceInterventions(options) {
        if (!this.maintenanceAvailable) return false;
        const opts = options || {};
        const state = this.maintenanceApi.interventions;
        if (opts.reset) state.offset = 0;
        if (opts.filters) syncFilters(this.maintenanceApi.interventionFilters, opts.filters);
        const params = filterParams(this.maintenanceApi.interventionFilters, {
          occurredFrom: 'from',
          occurredTo: 'to'
        });
        params.limit = state.limit;
        params.offset = state.offset;
        return this.maintenanceRead(state, '/interventions' + queryString(params), {}, (payload) => {
          applyPage(state, payload, mapIntervention, !!opts.append);
        });
      },
      async loadMoreMaintenanceInterventions() {
        const state = this.maintenanceApi.interventions;
        if (state.loading || state.offset + state.items.length >= state.total) return false;
        state.offset = state.items.length;
        return this.loadMaintenanceInterventions({ append: true });
      },
      async loadMaintenanceIntervention(id) {
        const interventionId = text(id);
        if (!interventionId) return false;
        const target = this.maintenanceApi.interventionDetail;
        const ok = await this.maintenanceRead(target, '/interventions/' + encodeURIComponent(interventionId), {}, (payload) => {
          target.id = interventionId;
          target.record = mapIntervention(payload);
          target.loaded = true;
          target.missing = false;
        });
        if (!ok && target.error && !target.loading) target.missing = true;
        return ok;
      },
      async saveMaintenanceIntervention(payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para registrar intervenciones.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/interventions', { method: 'POST', body: payload }));
        if (!result.ok) return result;
        const intervention = mapIntervention(result.payload);
        return this.maintenanceRefreshAfterWrite({ assetId: payload.assetId, intervention, result });
      },
      async updateMaintenanceIntervention(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para editar intervenciones.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/interventions/' + encodeURIComponent(id), { method: 'PATCH', body: payload }));
        if (!result.ok) return result;
        const intervention = mapIntervention(result.payload);
        return this.maintenanceRefreshAfterWrite({ assetId: intervention.assetId, intervention, result });
      },
      async loadMaintenanceCosts(options) {
        if (!this.maintenanceAvailable) return false;
        const target = this.maintenanceApi.costs;
        const params = filterParams((options && options.filters) || this.maintenanceApi.interventionFilters, {
          occurredFrom: 'from',
          occurredTo: 'to'
        });
        return this.maintenanceRead(target, '/interventions/costs' + queryString(params), {}, (payload) => {
          target.record = mapCosts(payload);
        });
      },

      /* ------------------------------------------------------------- incidents */
      async loadMaintenanceIncidents(options) {
        if (!this.maintenanceAvailable) return false;
        const opts = options || {};
        const state = this.maintenanceApi.incidents;
        if (opts.reset) state.offset = 0;
        if (opts.filters) syncFilters(this.maintenanceApi.incidentFilters, opts.filters);
        const params = filterParams(this.maintenanceApi.incidentFilters, {
          openedFrom: 'from',
          openedTo: 'to'
        });
        params.limit = state.limit;
        params.offset = state.offset;
        return this.maintenanceRead(state, '/incidents' + queryString(params), {}, (payload) => {
          applyPage(state, payload, mapIncident, !!opts.append);
        });
      },
      async loadMoreMaintenanceIncidents() {
        const state = this.maintenanceApi.incidents;
        if (state.loading || state.offset + state.items.length >= state.total) return false;
        state.offset = state.items.length;
        return this.loadMaintenanceIncidents({ append: true });
      },
      async loadMaintenanceIncident(id) {
        const incidentId = text(id);
        if (!incidentId) return false;
        const target = this.maintenanceApi.incidentDetail;
        return this.maintenanceRead(target, '/incidents/' + encodeURIComponent(incidentId), {}, (payload) => {
          target.id = incidentId;
          target.record = mapIncident(payload);
          target.loaded = true;
          target.missing = false;
          target.prepare = null;
        });
      },
      async createMaintenanceIncident(payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para crear incidentes.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/incidents', { method: 'POST', body: payload }));
        if (!result.ok) return result;
        const incident = mapIncident(result.payload);
        return this.maintenanceRefreshAfterWrite({ assetId: payload.primaryAssetId, incident, result });
      },
      async incidentCommand(id, action, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para actualizar incidentes.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/incidents/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: payload || {} }));
        if (!result.ok) return result;
        const incident = mapIncident(result.payload);
        return this.maintenanceRefreshAfterWrite({ incidentId: id, incident, result });
      },
      acknowledgeMaintenanceIncident(id, payload) {
        return this.incidentCommand(id, 'acknowledge', payload);
      },
      resolveMaintenanceIncident(id, payload) {
        return this.incidentCommand(id, 'resolve', payload);
      },
      closeMaintenanceIncident(id, payload) {
        return this.incidentCommand(id, 'close', payload);
      },
      async prepareMaintenanceIncident(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para actualizar incidentes.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/incidents/' + encodeURIComponent(id) + '/resolution/prepare', { method: 'POST', body: payload || {} }));
        if (!result.ok) return result;
        const prepared = result.payload && typeof result.payload === 'object' ? result.payload : {};
        if (this.maintenanceApi.incidentDetail.id === text(id)) {
          this.maintenanceApi.incidentDetail.prepare = {
            token: text(prepared.token),
            revision: count(prepared.revision, 0),
            preparedAt: text(prepared.preparedAt)
          };
        }
        return Object.assign(result, { prepared: this.maintenanceApi.incidentDetail.prepare });
      },
      async confirmMaintenanceIncident(id, payload) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para actualizar incidentes.' };
        const target = this.maintenanceApi.incidentDetail;
        const prepared = target.id === text(id) ? target.prepare : null;
        if (!prepared || !prepared.token) return { ok: false, error: 'Prepara la resolución antes de confirmarla.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/incidents/' + encodeURIComponent(id) + '/resolution/confirm', {
          method: 'POST',
          body: { token: prepared.token, note: text((payload || {}).note) || undefined }
        }));
        if (!result.ok) return result;
        target.prepare = null;
        return this.maintenanceRefreshAfterWrite({ incidentId: id, result });
      },
      async updateMaintenanceIncidentAssets(id, affectedAssetIds) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para actualizar incidentes.' };
        const token = this.maintenanceToken();
        const result = await this.maintenanceWrite(token, () => window.AssetAccess.request(this, '/incidents/' + encodeURIComponent(id) + '/affected-assets', {
          method: 'PATCH',
          body: { affectedAssetIds: (affectedAssetIds || []).map((value) => text(value)).filter(Boolean) }
        }));
        if (!result.ok) return result;
        return this.maintenanceRefreshAfterWrite({ incidentId: id, result });
      },

      /* ---------------------------------------------------------- asset work */
      async loadAssetMaintenanceWork(assetId) {
        const id = text(assetId);
        if (!id || !this.maintenanceAvailable) return false;
        const work = this.maintenanceApi.assetWork;
        const token = this.maintenanceToken();
        const epoch = nextEpoch();
        work.controllers.forEach((controller) => controller.abort());
        const controller = makeController();
        work.assetId = id;
        work.epoch = epoch;
        work.controllers = controller ? [controller] : [];
        work.plans = page();
        work.interventions = page();
        work.incidents = page();
        work.history = page();
        work.loaded = false;
        work.loading = true;
        work.error = '';
        const signal = controller ? controller.signal : undefined;
        const requests = [
          ['plans', '/maintenance/plans' + queryString({ assetId: id, limit: MAX_LIMIT }), (payload) => applyPage(work.plans, payload, mapPlan, false)],
          ['interventions', '/interventions' + queryString({ assetId: id, limit: MAX_LIMIT }), (payload) => applyPage(work.interventions, payload, mapIntervention, false)],
          ['incidents', '/incidents' + queryString({ assetId: id, limit: MAX_LIMIT }), (payload) => applyPage(work.incidents, payload, mapIncident, false)],
          ['history', '/assets/' + encodeURIComponent(id) + '/technical-history' + queryString({ limit: MAX_LIMIT }), (payload) => applyPage(work.history, payload, mapTechnicalHistory, false)]
        ];
        try {
          const results = await Promise.allSettled(requests.map((entry) => window.AssetAccess.request(this, entry[1], { signal })));
          if (epoch !== work.epoch || !this.maintenanceTokenOpen(token)) return false;
          const unauthorized = results.find((result) => result.status === 'rejected' && result.reason && result.reason.status === 401);
          if (unauthorized) {
            this.clearMaintenanceState();
            return false;
          }
          const errors = [];
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              requests[index][2](result.value);
              return;
            }
            if (result.reason && result.reason.name === 'AbortError') return;
            errors.push(requests[index][0]);
            work[requests[index][0]].error = errorMessage(result.reason);
          });
          work.loaded = true;
          work.error = errors.length ? 'No se pudo cargar ' + errors.join(', ') + '.' : '';
          return true;
        } finally {
          if (epoch === work.epoch && this.maintenanceTokenOpen(token)) {
            work.loading = false;
            work.controllers = [];
          }
        }
      },
      async loadMoreAssetTechnicalHistory() {
        const work = this.maintenanceApi.assetWork;
        const history = work.history;
        if (!work.assetId || history.loading || history.offset + history.items.length >= history.total) return false;
        const token = this.maintenanceToken();
        const epoch = work.epoch;
        const controller = makeController();
        work.controllers = controller ? [controller] : [];
        history.loading = true;
        history.error = '';
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(work.assetId) + '/technical-history' + queryString({ limit: history.limit, offset: history.items.length }), { signal: controller ? controller.signal : undefined });
          if (epoch !== work.epoch || !this.maintenanceTokenOpen(token)) return false;
          applyPage(history, payload, mapTechnicalHistory, true);
          return true;
        } catch (error) {
          if (epoch !== work.epoch || !this.maintenanceTokenOpen(token)) return false;
          history.error = errorMessage(error);
          return false;
        } finally {
          if (epoch === work.epoch && this.maintenanceTokenOpen(token)) {
            history.loading = false;
            work.controllers = [];
          }
        }
      },

      /* --------------------------------------------------------- catalog picks */
      async searchMaintenanceAssets(query) {
        if (!this.maintenanceAvailable) return [];
        const token = this.maintenanceToken();
        const payload = await window.AssetAccess.request(this, '/assets/search' + queryString({ query: text(query), limit: SEARCH_LIMIT, offset: 0 }));
        if (!this.maintenanceTokenOpen(token)) return [];
        return (Array.isArray(payload && payload.items) ? payload.items : []).map(mapAssetChoice).filter(Boolean);
      },
      async searchMaintenancePeople(query) {
        if (!this.maintenanceAvailable) return [];
        const token = this.maintenanceToken();
        const payload = await window.AssetAccess.request(this, '/people' + queryString({ query: text(query), status: 'active', limit: SEARCH_LIMIT, offset: 0 }));
        if (!this.maintenanceTokenOpen(token)) return [];
        return (Array.isArray(payload && payload.items) ? payload.items : []).map(mapPersonChoice).filter(Boolean);
      },
      async uploadMaintenanceAttachment(assetId, file) {
        if (!this.maintenanceEditable) return { ok: false, error: 'No tienes permiso para subir archivos.' };
        const id = text(assetId);
        if (!id || !file || typeof file.arrayBuffer !== 'function') return { ok: false, error: 'Selecciona un archivo para adjuntar.' };
        const token = this.maintenanceToken();
        const filename = text(file.name) || 'documento';
        try {
          const bytes = await file.arrayBuffer();
          if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(id) + '/attachments' + queryString({ filename, category: 'document' }), { method: 'POST', body: bytes });
          if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
          return { ok: true, attachment: mapAttachment(payload) };
        } catch (error) {
          if (!this.maintenanceTokenOpen(token)) return { ok: false, cancelled: true };
          if (error && error.status === 401) {
            this.clearMaintenanceState();
            return { ok: false, cancelled: true };
          }
          return { ok: false, error: errorMessage(error) };
        }
      },

      /* ------------------------------------------------------------- refresh */
      async maintenanceRefreshAfterWrite(context) {
        const ctx = context || {};
        const assetId = text(ctx.assetId) || (ctx.incident ? text(ctx.incident.primaryAssetId) : '');
        const tasks = [];
        if (this.maintenanceApi.plans.loaded) tasks.push(this.loadMaintenancePlans());
        if (this.maintenanceApi.interventions.loaded) tasks.push(this.loadMaintenanceInterventions());
        if (this.maintenanceApi.incidents.loaded) tasks.push(this.loadMaintenanceIncidents());
        if (this.maintenanceApi.overview.loaded) tasks.push(this.loadMaintenanceOverview());
        if (ctx.incidentId && this.maintenanceApi.incidentDetail.id === text(ctx.incidentId)) tasks.push(this.loadMaintenanceIncident(ctx.incidentId));
        if (ctx.plan && this.maintenanceApi.planDetail.id === ctx.plan.id) tasks.push(this.loadMaintenancePlan(ctx.plan.id));
        if (assetId && this.maintenanceApi.assetWork.assetId === assetId) {
          tasks.push(this.loadAssetMaintenanceWork(assetId));
          if (this.loadInventoryHistory && this.inventoryHistory && this.inventoryHistory.id === assetId) tasks.push(this.loadInventoryHistory(assetId));
        }
        if (tasks.length) await Promise.all(tasks);
        return Object.assign({}, ctx.result, { ok: true, plan: ctx.plan || null, intervention: ctx.intervention || null, incident: ctx.incident || null });
      },

      /* --------------------------------------------------------------- route */
      handleMaintenanceRoute(next) {
        if (!this.authenticated) {
          this.clearMaintenanceState();
          return;
        }
        if (!next) return;
        if (next.name === 'maintenance') {
          const tasks = [];
          if (!this.maintenanceApi.templates.loaded) tasks.push(this.loadMaintenanceTemplates());
          if (!this.maintenanceApi.plans.loaded) tasks.push(this.loadMaintenancePlans());
          if (!this.maintenanceApi.interventions.loaded) tasks.push(this.loadMaintenanceInterventions());
          if (!this.maintenanceApi.incidents.loaded) tasks.push(this.loadMaintenanceIncidents());
          if (!this.maintenanceApi.overview.loaded) tasks.push(this.loadMaintenanceOverview());
          return Promise.all(tasks);
        }
        if (next.name === 'incident' && next.incidentId) {
          if (this.maintenanceApi.incidentDetail.id !== next.incidentId || this.maintenanceApi.incidentDetail.error) {
            return this.loadMaintenanceIncident(next.incidentId);
          }
          return true;
        }
        if (next.name === 'config' && next.section === 'mantenimiento') {
          if (!this.maintenanceApi.templates.loaded) return this.loadMaintenanceTemplates();
          return true;
        }
        if (next.name === 'detail' && next.assetId) {
          if (this.maintenanceApi.assetWork.assetId !== next.assetId) return this.loadAssetMaintenanceWork(next.assetId);
          return true;
        }
        this.maintenanceAbort(this.maintenanceApi.plans);
        this.maintenanceAbort(this.maintenanceApi.interventions);
        this.maintenanceAbort(this.maintenanceApi.incidents);
        this.maintenanceAbort(this.maintenanceApi.templates);
        if (next.name !== 'incident') this.maintenanceApi.incidentDetail = single();
        if (next.name !== 'detail') this.maintenanceApi.assetWork = createState().assetWork;
        return true;
      },

      clearMaintenanceState() {
        if (!this.maintenanceApi) return;
        nextSessionEpoch();
        [
          this.maintenanceApi.templates,
          this.maintenanceApi.plans,
          this.maintenanceApi.interventions,
          this.maintenanceApi.incidents,
          this.maintenanceApi.planDetail,
          this.maintenanceApi.interventionDetail,
          this.maintenanceApi.incidentDetail,
          this.maintenanceApi.costs,
          this.maintenanceApi.overview
        ].forEach((target) => this.maintenanceAbort(target));
        this.maintenanceApi.assetWork.controllers.forEach((controller) => controller.abort());
        const fresh = createState();
        this.maintenanceApi.identity = text(this.activeUserId);
        this.maintenanceApi.session = nextSessionEpoch();
        this.maintenanceApi.writeVersion = fresh.writeVersion;
        this.maintenanceApi.templates = fresh.templates;
        this.maintenanceApi.plans = fresh.plans;
        this.maintenanceApi.planFilters = fresh.planFilters;
        this.maintenanceApi.interventions = fresh.interventions;
        this.maintenanceApi.interventionFilters = fresh.interventionFilters;
        this.maintenanceApi.incidents = fresh.incidents;
        this.maintenanceApi.incidentFilters = fresh.incidentFilters;
        this.maintenanceApi.planDetail = fresh.planDetail;
        this.maintenanceApi.interventionDetail = fresh.interventionDetail;
        this.maintenanceApi.incidentDetail = fresh.incidentDetail;
        this.maintenanceApi.costs = fresh.costs;
        this.maintenanceApi.overview = fresh.overview;
        this.maintenanceApi.assetWork = fresh.assetWork;
        this.maintenanceApi.prefs = Object.assign({}, Data.PREFS);
        this.maintenanceApi.alerts = Data.seedAlerts();
        this.maintenanceApi.identity = text(this.activeUserId);
      },
      maintainMaintenanceIdentity() {
        if (!this.maintenanceApi) return;
        if (!this.authenticated) {
          this.clearMaintenanceState();
          return;
        }
        const identity = text(this.activeUserId);
        if (this.maintenanceApi.identity && this.maintenanceApi.identity !== identity) this.clearMaintenanceState();
        this.maintenanceApi.identity = identity;
      }
    }
  };
})();
