(function () {
  'use strict';

  const Data = window.ASSET_MAINT;
  const DAY = Data.DAY;
  const HISTORY_LIMIT = 200;

  // ---------------------------------------------------------------- helpers
  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function localDay(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return value.getFullYear() + '-' + month + '-' + day;
  }

  function today() {
    return localDay(new Date());
  }

  function toDay(value) {
    return String(value || '').slice(0, 10);
  }

  function dayMs(day) {
    const parts = String(day || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return NaN;
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function validDay(day) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) && Number.isFinite(dayMs(day));
  }

  function addMonths(day, months) {
    if (!validDay(day)) return '';
    const parts = day.split('-').map(Number);
    const count = Number(months);
    if (!Number.isFinite(count)) return day;
    const base = new Date(Date.UTC(parts[0], parts[1] - 1 + count, 1));
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(parts[2], lastDay));
    return base.toISOString().slice(0, 10);
  }

  function addDays(day, days) {
    const ms = dayMs(day);
    if (!Number.isFinite(ms)) return day;
    return new Date(ms + Number(days) * DAY).toISOString().slice(0, 10);
  }

  function daysUntil(day, reference) {
    const ms = dayMs(toDay(day));
    if (!Number.isFinite(ms)) return null;
    const base = dayMs(reference || today());
    return Math.round((ms - base) / DAY);
  }

  function maxDay(a, b) {
    if (!validDay(a)) return validDay(b) ? b : '';
    if (!validDay(b)) return a;
    return dayMs(a) >= dayMs(b) ? a : b;
  }

  function nextId(prefix, list) {
    let max = 0;
    (Array.isArray(list) ? list : []).forEach((item) => {
      const match = String(item && item.id ? item.id : '').match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + '-' + String(max + 1);
  }

  function meta(list, id) {
    const found = (Array.isArray(list) ? list : []).find((item) => item.id === id);
    return found || null;
  }

  function personName(people, id) {
    const person = (Array.isArray(people) ? people : []).find((item) => item.id === id);
    return person ? person.name : '';
  }

  function siteLabel(sites, id) {
    const site = (Array.isArray(sites) ? sites : []).find((item) => item.id === id);
    return site ? (site.short || site.label) : id;
  }

  function assetOf(assets, id) {
    return (Array.isArray(assets) ? assets : []).find((asset) => asset.id === id) || null;
  }

  function pushHistory(asset, kind, title, detail, extra) {
    if (!asset || !window.AssetSchema) return null;
    const entry = window.AssetSchema.historyEntry(kind, title, detail, extra || {});
    asset.history = Array.isArray(asset.history) ? asset.history : [];
    asset.history.unshift(entry);
    if (asset.history.length > HISTORY_LIMIT) asset.history.length = HISTORY_LIMIT;
    return entry;
  }

  function change(label, before, after, field) {
    return {
      field: field || label,
      label: label,
      before: before === undefined || before === null || before === '' ? 'Sin registro' : String(before),
      after: after === undefined || after === null || after === '' ? 'Sin registro' : String(after)
    };
  }

  // ---------------------------------------------------------------- plan math
  function templateFor(state, category) {
    return (state.templates || []).find((template) => template.category === category && template.active !== false) || null;
  }

  function planFor(state, assetId) {
    return (state.plans || []).find((plan) => plan.assetId === assetId) || null;
  }

  function baseDue(plan) {
    return plan.lastCompletedAt ? addMonths(plan.lastCompletedAt, plan.intervalMonths) : '';
  }

  function dueOf(plan) {
    return maxDay(baseDue(plan), plan.postponedUntil || '');
  }

  function openPreventive(state, plan) {
    const ids = [];
    (state.interventions || []).forEach((item) => {
      if (item.assetId !== plan.assetId) return;
      if (item.state !== 'planned' && item.state !== 'in_progress') return;
      if (item.type !== 'preventivo') return;
      ids.push(item);
    });
    return ids.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  }

  function statusOf(days, paused) {
    if (paused) return 'paused';
    if (days === null) return 'unscheduled';
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= 14) return 'soon';
    return 'scheduled';
  }

  const STATUS_META = {
    overdue: { label: 'Vencido', tone: 'down', order: 0 },
    today: { label: 'Vence hoy', tone: 'warn', order: 1 },
    in_progress: { label: 'En curso', tone: 'warn', order: 2 },
    soon: { label: 'Próximo', tone: 'warn', order: 3 },
    scheduled: { label: 'Programado', tone: 'neutral', order: 4 },
    paused: { label: 'En pausa', tone: 'neutral', order: 5 },
    unscheduled: { label: 'Sin programar', tone: 'neutral', order: 6 }
  };

  function scheduleRow(state, plan, assets, reference) {
    const asset = assetOf(assets, plan.assetId);
    if (!asset) return null;
    const dueAt = dueOf(plan);
    const days = daysUntil(dueAt, reference);
    const open = openPreventive(state, plan);
    const paused = !!plan.paused || !!asset.retired;
    const status = open && !paused ? 'in_progress' : statusOf(days, paused);
    return {
      planId: plan.id,
      plan: plan,
      asset: asset,
      template: meta(state.templates, plan.templateId),
      dueAt: dueAt,
      daysUntil: days,
      status: status,
      statusMeta: STATUS_META[status] || STATUS_META.scheduled,
      openIntervention: open,
      technicianId: open ? open.technicianId : '',
      lastCompletedAt: plan.lastCompletedAt || ''
    };
  }

  function agenda(state, assets, filters, reference) {
    const options = filters || {};
    const query = text(options.query, '').toLocaleLowerCase('es');
    const rows = (state.plans || [])
      .map((plan) => scheduleRow(state, plan, assets, reference))
      .filter(Boolean)
      .filter((row) => {
        if (options.status && options.status !== 'all' && row.status !== options.status) return false;
        if (options.category && options.category !== 'all' && row.asset.category !== options.category) return false;
        if (options.site && options.site !== 'all' && row.asset.site !== options.site) return false;
        if (options.technicianId && options.technicianId !== 'all') {
          const technician = row.technicianId || ((planAssignee(state, row.plan) || {}).id || '');
          if (technician !== options.technicianId) return false;
        }
        if (options.from && row.dueAt && row.dueAt < options.from) return false;
        if (options.to && row.dueAt && row.dueAt > options.to) return false;
        if (!query) return true;
        const haystack = [
          row.asset.name, row.asset.id, row.asset.type,
          row.template ? row.template.label : '',
          row.statusMeta.label
        ].join(' ').toLocaleLowerCase('es');
        return haystack.indexOf(query) !== -1;
      });
    rows.sort((a, b) => {
      const order = (a.statusMeta.order - b.statusMeta.order) || (a.daysUntil - b.daysUntil);
      if (order) return order;
      return String(a.asset.id).localeCompare(String(b.asset.id), 'es', { numeric: true });
    });
    return rows;
  }

  function planAssignee(state, plan) {
    const open = openPreventive(state, plan);
    if (!open) return null;
    return { id: open.technicianId, name: '' };
  }

  function stats(state, assets, reference) {
    const rows = agenda(state, assets, {}, reference);
    const interventions = state.interventions || [];
    const incidents = state.incidents || [];
    const alerts = state.alerts || [];
    const limit = addDays(reference || today(), -30);
    return {
      overdue: rows.filter((row) => row.status === 'overdue').length,
      soon: rows.filter((row) => row.status === 'soon' || row.status === 'today').length,
      inProgress: interventions.filter((item) => item.state === 'in_progress').length,
      planned: interventions.filter((item) => item.state === 'planned').length,
      completed30: interventions.filter((item) => item.state === 'done' && toDay(item.completedAt || item.date) >= limit).length,
      openIncidents: incidents.filter((item) => item.state === 'abierto' || item.state === 'en_curso').length,
      criticalIncidents: incidents.filter((item) => item.priority === 'critica' && item.state !== 'cerrado' && item.state !== 'resuelto').length,
      activeAlerts: alerts.filter((item) => item.state === 'open').length,
      recoveredAlerts: alerts.filter((item) => item.state === 'recovered').length,
      plans: rows.length
    };
  }

  // ---------------------------------------------------------------- filters
  function interventionMatches(item, state, assets, people, filters) {
    const options = filters || {};
    const asset = assetOf(assets, item.assetId);
    if (!asset) return false;
    const query = text(options.query, '').toLocaleLowerCase('es');
    if (options.state && options.state !== 'all' && item.state !== options.state) return false;
    if (options.type && options.type !== 'all' && item.type !== options.type) return false;
    if (options.category && options.category !== 'all' && asset.category !== options.category) return false;
    if (options.site && options.site !== 'all' && asset.site !== options.site) return false;
    if (options.technicianId && options.technicianId !== 'all' && item.technicianId !== options.technicianId) return false;
    const day = toDay(item.date);
    if (options.from && day < options.from) return false;
    if (options.to && day > options.to) return false;
    if (!query) return true;
    const type = meta(state.types, item.type);
    return [
      item.title, item.description, item.notes, item.id, asset.name, asset.id,
      personName(people, item.technicianId), type ? type.label : ''
    ].join(' ').toLocaleLowerCase('es').indexOf(query) !== -1;
  }

  function incidentMatches(item, assets, people, filters) {
    const options = filters || {};
    const query = text(options.query, '').toLocaleLowerCase('es');
    const primary = assetOf(assets, item.primaryAssetId);
    if (!primary) return false;
    if (options.state && options.state !== 'all' && item.state !== options.state) return false;
    if (options.priority && options.priority !== 'all' && item.priority !== options.priority) return false;
    if (options.site && options.site !== 'all' && primary.site !== options.site) return false;
    if (options.assigneeId && options.assigneeId !== 'all' && item.assigneeId !== options.assigneeId) return false;
    if (!query) return true;
    const affected = (item.affectedIds || []).map((id) => {
      const asset = assetOf(assets, id);
      return asset ? asset.name + ' ' + asset.id : '';
    });
    return [
      item.title, item.description, item.id, primary.name, primary.id,
      personName(people, item.assigneeId)
    ].concat(affected).join(' ').toLocaleLowerCase('es').indexOf(query) !== -1;
  }

  function alertMatches(item, assets, filters) {
    const options = filters || {};
    const asset = assetOf(assets, item.assetId);
    if (!asset) return false;
    const query = text(options.query, '').toLocaleLowerCase('es');
    if (options.state && options.state !== 'all' && item.state !== options.state) return false;
    if (!query) return true;
    return [item.message, item.id, asset.name, asset.id, item.kind]
      .join(' ').toLocaleLowerCase('es').indexOf(query) !== -1;
  }

  // ---------------------------------------------------------------- normalization
  function normalizeTypes(value) {
    const seeds = Data.INTERVENTION_TYPES;
    const source = Array.isArray(value) ? value : seeds;
    const types = source.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = text(item.id).toLocaleLowerCase('es');
      if (!id) return null;
      const seed = meta(seeds, id);
      return {
        id: id,
        label: text(item.label, seed ? seed.label : id),
        icon: text(item.icon, seed ? seed.icon : 'activity'),
        tone: ['ok', 'warn', 'down', 'hold', 'neutral'].indexOf(item.tone) !== -1 ? item.tone : 'neutral',
        resetsPreventive: typeof item.resetsPreventive === 'boolean'
          ? item.resetsPreventive
          : !!(seed && seed.resetsPreventive),
        hint: text(item.hint, seed ? seed.hint : '')
      };
    }).filter(Boolean);
    return types.length ? types : clone(seeds);
  }

  function normalizeTemplates(value, validCategories) {
    const source = Array.isArray(value) ? value : Data.TEMPLATES;
    const seen = new Set();
    return source.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = text(item.id);
      const category = text(item.category);
      if (!id || !category || seen.has(id)) return null;
      if (validCategories.size && !validCategories.has(category)) return null;
      seen.add(id);
      const months = Number(item.intervalMonths);
      return {
        id: id,
        category: category,
        label: text(item.label, 'Plan preventivo'),
        intervalMonths: Number.isFinite(months) && months >= 1 && months <= 60 ? Math.round(months) : 6,
        active: item.active !== false,
        tasks: (Array.isArray(item.tasks) ? item.tasks : [])
          .map((task) => text(task))
          .filter(Boolean)
          .slice(0, 12)
      };
    }).filter(Boolean);
  }

  function normalizePlans(value, assets, templates) {
    const source = Array.isArray(value) ? value : Data.PLANS;
    const templateIds = new Set(templates.map((item) => item.id));
    const byAsset = new Map();
    source.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const asset = assetOf(assets, item.assetId);
      if (!asset || byAsset.has(item.assetId)) return;
      const template = meta(templates, item.templateId);
      const months = Number(item.intervalMonths);
      byAsset.set(item.assetId, {
        id: text(item.id, 'plan-' + item.assetId),
        assetId: item.assetId,
        templateId: template ? template.id : (templateIds.has(item.templateId) ? item.templateId : ''),
        intervalMonths: Number.isFinite(months) && months >= 1 && months <= 60 ? Math.round(months) : (template ? template.intervalMonths : 6),
        lastCompletedAt: validDay(toDay(item.lastCompletedAt)) ? toDay(item.lastCompletedAt) : '',
        tasks: (Array.isArray(item.tasks) ? item.tasks : (template ? template.tasks : []))
          .map((task) => text(task)).filter(Boolean).slice(0, 16),
        exceptions: (Array.isArray(item.exceptions) ? item.exceptions : [])
          .map((entry) => text(entry)).filter(Boolean).slice(0, 8),
        note: text(item.note),
        paused: item.paused === true,
        postponedUntil: validDay(toDay(item.postponedUntil)) ? toDay(item.postponedUntil) : ''
      });
    });
    return Array.from(byAsset.values());
  }

  function normalizeParts(value) {
    return (Array.isArray(value) ? value : []).map((part) => {
      if (!part || typeof part !== 'object') return null;
      const label = text(part.label);
      if (!label) return null;
      const qty = Number(part.qty);
      const cost = Number(part.cost);
      return {
        label: label.slice(0, 80),
        qty: Number.isFinite(qty) && qty > 0 ? Math.min(999, Math.round(qty)) : 1,
        cost: Number.isFinite(cost) && cost >= 0 ? Math.min(1000000, Math.round(cost * 100) / 100) : 0
      };
    }).filter(Boolean).slice(0, 10);
  }

  function normalizeAttachments(value) {
    return (Array.isArray(value) ? value : []).map((file) => {
      if (!file || typeof file !== 'object') return null;
      const name = text(file.name);
      if (!name) return null;
      return {
        name: name.slice(0, 120),
        size: text(file.size, '—').slice(0, 20),
        kind: text(file.kind, 'archivo').slice(0, 20)
      };
    }).filter(Boolean).slice(0, 8);
  }

  function normalizeInterventions(value, assets, types) {
    const source = Array.isArray(value) ? value : Data.INTERVENTIONS;
    const typeIds = new Set(types.map((item) => item.id));
    const states = ['planned', 'in_progress', 'done', 'cancelled'];
    return source.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const asset = assetOf(assets, item.assetId);
      if (!asset) return null;
      const id = text(item.id);
      if (!id) return null;
      const date = Number.isFinite(Date.parse(item.date)) ? new Date(item.date).toISOString() : nowIso();
      return {
        id: id,
        assetId: asset.id,
        type: typeIds.has(item.type) ? item.type : 'correctivo',
        title: text(item.title, 'Intervención técnica').slice(0, 120),
        description: text(item.description).slice(0, 600),
        date: date,
        state: states.indexOf(item.state) !== -1 ? item.state : 'planned',
        technicianId: text(item.technicianId),
        notes: text(item.notes).slice(0, 600),
        parts: normalizeParts(item.parts),
        attachments: normalizeAttachments(item.attachments),
        incidentId: text(item.incidentId),
        completedAt: Number.isFinite(Date.parse(item.completedAt)) ? new Date(item.completedAt).toISOString() : ''
      };
    }).filter(Boolean);
  }

  function normalizeIncidents(value, assets) {
    const source = Array.isArray(value) ? value : Data.INCIDENTS;
    const priorities = Data.PRIORITIES.map((item) => item.id);
    const states = Data.INCIDENT_STATES.map((item) => item.id);
    return source.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const primary = assetOf(assets, item.primaryAssetId);
      if (!primary) return null;
      const id = text(item.id);
      if (!id) return null;
      const affected = (Array.isArray(item.affectedIds) ? item.affectedIds : [])
        .filter((assetId, index, list) => assetId !== primary.id && list.indexOf(assetId) === index && !!assetOf(assets, assetId));
      return {
        id: id,
        title: text(item.title, 'Incidente técnico').slice(0, 140),
        description: text(item.description).slice(0, 800),
        priority: priorities.indexOf(item.priority) !== -1 ? item.priority : 'media',
        state: states.indexOf(item.state) !== -1 ? item.state : 'abierto',
        primaryAssetId: primary.id,
        affectedIds: affected,
        assigneeId: text(item.assigneeId),
        openedAt: Number.isFinite(Date.parse(item.openedAt)) ? new Date(item.openedAt).toISOString() : nowIso(),
        resolvedAt: Number.isFinite(Date.parse(item.resolvedAt)) ? new Date(item.resolvedAt).toISOString() : '',
        closedAt: Number.isFinite(Date.parse(item.closedAt)) ? new Date(item.closedAt).toISOString() : '',
        actions: (Array.isArray(item.actions) ? item.actions : []).map((action, index) => {
          if (!action || typeof action !== 'object') return null;
          return {
            id: text(action.id, 'act-' + index),
            at: Number.isFinite(Date.parse(action.at)) ? new Date(action.at).toISOString() : nowIso(),
            actor: text(action.actor, 'Sistema'),
            text: text(action.text).slice(0, 400)
          };
        }).filter(Boolean).slice(0, 40),
        interventionIds: (Array.isArray(item.interventionIds) ? item.interventionIds : []).map((id2) => text(id2)).filter(Boolean)
      };
    }).filter(Boolean);
  }

  function normalizeThreshold(value) {
    if (!value || typeof value !== 'object') return null;
    const checkId = text(value.checkId);
    if (!checkId) return null;
    const number = Number(value.value);
    const limit = Number(value.limit);
    return {
      checkId: checkId,
      value: Number.isFinite(number) ? number : 0,
      limit: Number.isFinite(limit) ? limit : 0,
      unit: text(value.unit).slice(0, 12)
    };
  }

  function normalizeEvents(value) {
    if (!Array.isArray(value)) return [];
    const types = ['detected', 'repeated', 'acknowledged', 'silenced', 'unsilenced', 'recovered', 'resolved', 'converted', 'notified'];
    return value.slice(0, 24).map((item) => {
      if (!item || typeof item !== 'object') return null;
      const at = Number.isFinite(Date.parse(item.at)) ? new Date(item.at).toISOString() : '';
      const message = text(item.text).slice(0, 240);
      if (!at || !message) return null;
      return {
        id: text(item.id) || ('ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        at: at,
        type: types.indexOf(item.type) !== -1 ? item.type : 'detected',
        text: message
      };
    }).filter(Boolean);
  }

  function normalizeAlerts(value, assets) {
    const source = Array.isArray(value) ? value : Data.ALERTS;
    const states = Data.ALERT_STATES.map((item) => item.id);
    const kinds = Data.ALERT_KINDS.map((item) => item.id);
    return source.map((item) => {
      if (!item || typeof item !== 'object') return null;
      if (!assetOf(assets, item.assetId)) return null;
      const id = text(item.id);
      if (!id) return null;
      const events = normalizeEvents(item.events);
      const detectedAt = Number.isFinite(Date.parse(item.detectedAt)) ? new Date(item.detectedAt).toISOString() : nowIso();
      const lastEventAt = events.reduce((latest, event) => (Date.parse(event.at) > Date.parse(latest) ? event.at : latest), detectedAt);
      return {
        id: id,
        assetId: item.assetId,
        checkId: text(item.checkId),
        kind: kinds.indexOf(item.kind) !== -1 ? item.kind : 'offline',
        severity: Data.PRIORITIES.some((priority) => priority.id === item.severity) ? item.severity : 'media',
        message: text(item.message).slice(0, 240),
        detectedAt: detectedAt,
        recoveredAt: Number.isFinite(Date.parse(item.recoveredAt)) ? new Date(item.recoveredAt).toISOString() : '',
        state: states.indexOf(item.state) !== -1 ? item.state : 'open',
        incidentId: text(item.incidentId),
        suggestion: item.suggestion === true,
        acknowledgedAt: Number.isFinite(Date.parse(item.acknowledgedAt)) ? new Date(item.acknowledgedAt).toISOString() : '',
        acknowledgedBy: text(item.acknowledgedBy).slice(0, 80),
        silencedUntil: Number.isFinite(Date.parse(item.silencedUntil)) ? new Date(item.silencedUntil).toISOString() : '',
        silenceReason: text(item.silenceReason).slice(0, 160),
        groupCount: Math.max(1, Math.min(999, Number(item.groupCount) || 1)),
        lastEventAt: lastEventAt,
        intermittent: item.intermittent === true,
        threshold: normalizeThreshold(item.threshold),
        events: events,
        resolvedAt: Number.isFinite(Date.parse(item.resolvedAt)) ? new Date(item.resolvedAt).toISOString() : '',
        resolvedBy: text(item.resolvedBy).slice(0, 80)
      };
    }).filter(Boolean);
  }

  function normalizePrefs(value) {
    const source = value && typeof value === 'object' ? value : {};
    const ranges = [7, 14, 30, 60, 90];
    return {
      rangeDays: ranges.indexOf(Number(source.rangeDays)) !== -1 ? Number(source.rangeDays) : Data.PREFS.rangeDays,
      showCompleted: source.showCompleted === true,
      defaultAssigneeId: text(source.defaultAssigneeId),
      defaultView: ['agenda', 'interventions', 'incidents', 'alerts'].indexOf(source.defaultView) !== -1
        ? source.defaultView
        : Data.PREFS.defaultView
    };
  }

  function normalize(value, assets, categories) {
    const seed = Data.seed();
    if (!value || typeof value !== 'object') value = seed;
    const categoryIds = new Set(
      (Array.isArray(categories) ? categories : []).map((category) => category.id)
        .concat((Array.isArray(assets) ? assets : []).map((asset) => asset.category))
    );
    const types = normalizeTypes(value.types);
    const templates = normalizeTemplates(value.templates, categoryIds);
    return {
      version: 1,
      types: types,
      templates: templates,
      plans: normalizePlans(value.plans, assets, templates),
      interventions: normalizeInterventions(value.interventions, assets, types),
      incidents: normalizeIncidents(value.incidents, assets),
      alerts: normalizeAlerts(value.alerts, assets),
      prefs: normalizePrefs(value.prefs)
    };
  }

  // ---------------------------------------------------------------- interventions
  function saveIntervention(state, assets, payload, context) {
    const ctx = context || {};
    const input = payload || {};
    const errors = [];
    const asset = assetOf(assets, input.assetId);
    if (!asset) errors.push('Selecciona un activo válido.');
    if (asset && asset.retired) errors.push('Un activo dado de baja no admite intervenciones. Restáuralo primero.');
    if (!meta(state.types, input.type)) errors.push('Selecciona un tipo de intervención.');
    if (!text(input.title)) errors.push('Escribe un asunto para la intervención.');
    if (!text(input.description)) errors.push('Describe el trabajo realizado o previsto.');
    const date = input.date ? new Date(input.date) : new Date();
    if (Number.isNaN(date.getTime())) errors.push('Indica una fecha válida.');
    if (errors.length) return { ok: false, errors: errors, intervention: null };

    const type = meta(state.types, input.type);
    const item = {
      id: nextId('INT', state.interventions),
      assetId: asset.id,
      type: type.id,
      title: text(input.title).slice(0, 120),
      description: text(input.description).slice(0, 600),
      date: date.toISOString(),
      state: ['planned', 'in_progress', 'done', 'cancelled'].indexOf(input.state) !== -1 ? input.state : 'planned',
      technicianId: text(input.technicianId, ctx.actorId || ''),
      notes: text(input.notes).slice(0, 600),
      parts: normalizeParts(input.parts),
      attachments: normalizeAttachments(input.attachments),
      incidentId: text(input.incidentId),
      completedAt: ''
    };
    if (item.state === 'done') item.completedAt = nowIso();
    state.interventions.unshift(item);

    const when = toDay(item.date);
    pushHistory(asset, 'maintenance',
      type.label + ' · ' + item.title,
      'Intervención ' + item.id + (item.technicianId ? ' · ' + personName(ctx.people, item.technicianId) : '') + ' · ' + when + '.',
      {
        actor: ctx.actor || 'Administrador',
        movement: 'maintenance',
        changes: [change('Estado', '', meta(Data.INTERVENTION_STATES, item.state).label)]
      }
    );

    if (item.state === 'done' && type.resetsPreventive) {
      applyPreventiveReset(state, assets, item, ctx);
    }
    if (item.incidentId) attachIntervention(state, item.incidentId, item.id);
    return { ok: true, errors: [], intervention: item };
  }

  function applyPreventiveReset(state, assets, item, context) {
    const ctx = context || {};
    const asset = assetOf(assets, item.assetId);
    let plan = planFor(state, item.assetId);
    if (!plan) {
      const template = templateFor(state, asset ? asset.category : '');
      if (!template) return null;
      plan = {
        id: 'plan-' + item.assetId,
        assetId: item.assetId,
        templateId: template.id,
        intervalMonths: template.intervalMonths,
        lastCompletedAt: '',
        tasks: template.tasks.slice(),
        exceptions: [],
        note: '',
        paused: false,
        postponedUntil: ''
      };
      state.plans.push(plan);
    }
    const beforeDue = dueOf(plan);
    const beforeLast = plan.lastCompletedAt || '';
    const day = toDay(item.completedAt || item.date);
    plan.lastCompletedAt = day;
    plan.postponedUntil = '';
    pushHistory(asset, 'maintenance', 'Preventivo completado',
      'Se reinicia el intervalo de ' + plan.intervalMonths + ' meses del plan preventivo.',
      {
        actor: ctx.actor || 'Administrador',
        movement: 'maintenance',
        changes: [
          change('Último preventivo', beforeLast, day),
          change('Próximo vencimiento', beforeDue, dueOf(plan))
        ]
      }
    );
    return plan;
  }

  function completeIntervention(state, assets, id, payload, context) {
    const ctx = context || {};
    const item = (state.interventions || []).find((entry) => entry.id === id);
    if (!item) return { ok: false, errors: ['La intervención ya no está disponible.'], intervention: null };
    if (item.state === 'done') return { ok: false, errors: ['La intervención ya está completada.'], intervention: item };
    const type = meta(state.types, item.type) || { label: 'Intervención', resetsPreventive: false };
    const before = meta(Data.INTERVENTION_STATES, item.state);
    const asset = assetOf(assets, item.assetId);
    const input = payload || {};
    item.state = 'done';
    item.completedAt = Number.isFinite(Date.parse(input.completedAt)) ? new Date(input.completedAt).toISOString() : nowIso();
    if (text(input.notes)) item.notes = text(input.notes).slice(0, 600);
    if (Array.isArray(input.parts)) item.parts = normalizeParts(input.parts);
    if (Array.isArray(input.attachments)) item.attachments = normalizeAttachments(input.attachments);

    pushHistory(asset, 'maintenance', type.label + ' completado · ' + item.title,
      'Intervención ' + item.id + ' cerrada el ' + toDay(item.completedAt) + '.',
      {
        actor: ctx.actor || 'Administrador',
        movement: 'maintenance',
        changes: [change('Estado', before ? before.label : '', 'Completada')]
      }
    );
    let plan = null;
    if (type.resetsPreventive) plan = applyPreventiveReset(state, assets, item, ctx);
    return { ok: true, errors: [], intervention: item, plan: plan };
  }

  function postponePlan(state, assets, planId, days, payload, context) {
    const ctx = context || {};
    const plan = (state.plans || []).find((entry) => entry.id === planId);
    if (!plan) return { ok: false, errors: ['El plan preventivo ya no está disponible.'], dueAt: '' };
    const count = Number(days);
    if (!Number.isFinite(count) || count < 1 || count > 90) {
      return { ok: false, errors: ['Elige un aplazamiento entre 1 y 90 días.'], dueAt: '' };
    }
    const asset = assetOf(assets, plan.assetId);
    const before = dueOf(plan);
    const from = maxDay(before, today());
    plan.postponedUntil = addDays(from, count);
    pushHistory(asset, 'maintenance', 'Preventivo pospuesto',
      'Aplazado ' + count + ' días' + (text((payload || {}).note) ? ' · ' + text((payload || {}).note) : '') + '.',
      {
        actor: ctx.actor || 'Administrador',
        movement: 'maintenance',
        changes: [change('Vencimiento', before, plan.postponedUntil)]
      }
    );
    return { ok: true, errors: [], dueAt: plan.postponedUntil, plan: plan };
  }

  function savePlan(state, assets, payload, context) {
    const ctx = context || {};
    const input = payload || {};
    const asset = assetOf(assets, input.assetId);
    if (!asset) return { ok: false, errors: ['Selecciona un activo válido.'], plan: null };
    const template = meta(state.templates, input.templateId);
    const months = Number(input.intervalMonths);
    if (template && !template.active) return { ok: false, errors: ['La plantilla está desactivada.'], plan: null };
    if (input.intervalMonths !== undefined && (!Number.isFinite(months) || months < 1 || months > 60)) {
      return { ok: false, errors: ['El intervalo debe estar entre 1 y 60 meses.'], plan: null };
    }
    let plan = planFor(state, asset.id);
    const isNew = !plan;
    if (!plan) {
      plan = {
        id: 'plan-' + asset.id,
        assetId: asset.id,
        templateId: template ? template.id : '',
        intervalMonths: template ? template.intervalMonths : 6,
        lastCompletedAt: '',
        tasks: template ? template.tasks.slice() : [],
        exceptions: [],
        note: '',
        paused: false,
        postponedUntil: ''
      };
      state.plans.push(plan);
    }
    const before = {
      interval: plan.intervalMonths,
      due: dueOf(plan),
      paused: plan.paused
    };
    if (template) {
      plan.templateId = template.id;
      plan.intervalMonths = Number.isFinite(months) && months >= 1 && months <= 60 ? Math.round(months) : template.intervalMonths;
      plan.tasks = template.tasks.slice();
    } else if (Number.isFinite(months) && months >= 1 && months <= 60) {
      plan.intervalMonths = Math.round(months);
    }
    if (Array.isArray(input.tasks)) {
      plan.tasks = input.tasks.map((task) => text(task)).filter(Boolean).slice(0, 16);
    }
    if (Array.isArray(input.exceptions)) {
      plan.exceptions = input.exceptions.map((entry) => text(entry)).filter(Boolean).slice(0, 8);
    }
    if (typeof input.note === 'string') plan.note = text(input.note).slice(0, 400);
    if (typeof input.paused === 'boolean') plan.paused = input.paused;
    if (typeof input.lastCompletedAt === 'string' && validDay(toDay(input.lastCompletedAt))) {
      plan.lastCompletedAt = toDay(input.lastCompletedAt);
      plan.postponedUntil = '';
    }
    pushHistory(asset, 'maintenance', isNew ? 'Plan preventivo creado' : 'Plan preventivo actualizado',
      'Intervalo de ' + plan.intervalMonths + ' meses · próximo vencimiento ' + (dueOf(plan) || 'sin programar') + '.',
      {
        actor: ctx.actor || 'Administrador',
        movement: 'maintenance',
        changes: [
          change('Intervalo', isNew ? '' : before.interval + ' meses', plan.intervalMonths + ' meses'),
          change('Vencimiento', isNew ? '' : before.due, dueOf(plan)),
          change('Estado', isNew ? '' : (before.paused ? 'En pausa' : 'Activo'), plan.paused ? 'En pausa' : 'Activo')
        ]
      }
    );
    return { ok: true, errors: [], plan: plan };
  }

  function removePlan(state, assets, planId, context) {
    const ctx = context || {};
    const index = (state.plans || []).findIndex((entry) => entry.id === planId);
    if (index === -1) return { ok: false, errors: ['El plan ya no está disponible.'] };
    const plan = state.plans[index];
    state.plans.splice(index, 1);
    pushHistory(assetOf(assets, plan.assetId), 'maintenance', 'Plan preventivo retirado',
      'El activo deja de tener mantenimiento periódico programado.',
      { actor: ctx.actor || 'Administrador', movement: 'maintenance' }
    );
    return { ok: true, errors: [] };
  }

  // ---------------------------------------------------------------- incidents
  function attachIntervention(state, incidentId, interventionId) {
    const incident = (state.incidents || []).find((entry) => entry.id === incidentId);
    if (!incident) return false;
    incident.interventionIds = Array.isArray(incident.interventionIds) ? incident.interventionIds : [];
    if (incident.interventionIds.indexOf(interventionId) === -1) incident.interventionIds.unshift(interventionId);
    const intervention = (state.interventions || []).find((entry) => entry.id === interventionId);
    if (intervention) intervention.incidentId = incident.id;
    return true;
  }

  function createIncident(state, assets, payload, context) {
    const ctx = context || {};
    const input = payload || {};
    const errors = [];
    const primary = assetOf(assets, input.primaryAssetId);
    if (!primary) errors.push('Selecciona el activo principal del incidente.');
    if (!text(input.title)) errors.push('Escribe un título para el incidente.');
    if (errors.length) return { ok: false, errors: errors, incident: null };
    const priorities = Data.PRIORITIES.map((item) => item.id);
    const affected = (Array.isArray(input.affectedIds) ? input.affectedIds : [])
      .filter((id, index, list) => id !== primary.id && list.indexOf(id) === index && !!assetOf(assets, id));
    const incident = {
      id: nextId('INC', state.incidents),
      title: text(input.title).slice(0, 140),
      description: text(input.description).slice(0, 800),
      priority: priorities.indexOf(input.priority) !== -1 ? input.priority : 'media',
      state: 'abierto',
      primaryAssetId: primary.id,
      affectedIds: affected,
      assigneeId: text(input.assigneeId, ctx.actorId || ''),
      openedAt: nowIso(),
      resolvedAt: '',
      closedAt: '',
      actions: [{
        id: 'act-' + Date.now().toString(36),
        at: nowIso(),
        actor: ctx.actor || 'Administrador',
        text: text(input.note, 'Incidente registrado desde ' + (ctx.origin || 'el módulo de mantenimiento') + '.')
      }],
      interventionIds: []
    };
    state.incidents.unshift(incident);
    const priority = meta(Data.PRIORITIES, incident.priority);
    const targets = [primary].concat(affected.map((id) => assetOf(assets, id)).filter(Boolean));
    targets.forEach((asset, index) => {
      pushHistory(asset, 'incident', 'Incidente abierto · ' + incident.title,
        incident.id + ' · prioridad ' + (priority ? priority.label.toLowerCase() : incident.priority) +
          (index === 0 ? ' · activo principal' : ' · activo afectado') + '.',
        {
          actor: ctx.actor || 'Administrador',
          movement: 'incident',
          changes: [change('Estado', '', 'Abierto'), change('Prioridad', '', priority ? priority.label : incident.priority)]
        }
      );
    });
    return { ok: true, errors: [], incident: incident };
  }

  function addIncidentAction(state, assets, incidentId, content, context) {
    const ctx = context || {};
    const incident = (state.incidents || []).find((entry) => entry.id === incidentId);
    if (!incident) return { ok: false, errors: ['El incidente ya no está disponible.'] };
    const body = text(content);
    if (!body) return { ok: false, errors: ['Escribe la actuación realizada.'] };
    incident.actions = Array.isArray(incident.actions) ? incident.actions : [];
    incident.actions.unshift({
      id: 'act-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      at: nowIso(),
      actor: ctx.actor || 'Administrador',
      text: body.slice(0, 400)
    });
    pushHistory(assetOf(assets, incident.primaryAssetId), 'incident', 'Actuación registrada · ' + incident.title,
      body.slice(0, 200),
      { actor: ctx.actor || 'Administrador', movement: 'incident' }
    );
    return { ok: true, errors: [], incident: incident };
  }

  function resolveIncident(state, assets, incidentId, payload, context) {
    const ctx = context || {};
    const incident = (state.incidents || []).find((entry) => entry.id === incidentId);
    if (!incident) return { ok: false, errors: ['El incidente ya no está disponible.'] };
    if (incident.state === 'cerrado') return { ok: false, errors: ['El incidente ya está cerrado.'] };
    const before = meta(Data.INCIDENT_STATES, incident.state);
    incident.state = 'resuelto';
    incident.resolvedAt = nowIso();
    incident.actions = Array.isArray(incident.actions) ? incident.actions : [];
    incident.actions.unshift({
      id: 'act-' + Date.now().toString(36),
      at: incident.resolvedAt,
      actor: ctx.actor || 'Administrador',
      text: text((payload || {}).note, 'Se confirma la resolución del incidente.')
    });
    const targets = [incident.primaryAssetId].concat(incident.affectedIds || []);
    targets.forEach((assetId) => {
      pushHistory(assetOf(assets, assetId), 'incident', 'Incidente resuelto · ' + incident.title,
        incident.id + ' · resolución confirmada manualmente.',
        {
          actor: ctx.actor || 'Administrador',
          movement: 'incident',
          changes: [change('Estado', before ? before.label : '', 'Resuelto')]
        }
      );
    });
    (state.alerts || []).forEach((alert) => {
      if (alert.incidentId === incident.id) alert.suggestion = false;
    });
    return { ok: true, errors: [], incident: incident };
  }

  function closeIncident(state, assets, incidentId, payload, context) {
    const ctx = context || {};
    const incident = (state.incidents || []).find((entry) => entry.id === incidentId);
    if (!incident) return { ok: false, errors: ['El incidente ya no está disponible.'] };
    if (incident.state === 'cerrado') return { ok: false, errors: ['El incidente ya está cerrado.'] };
    const before = meta(Data.INCIDENT_STATES, incident.state);
    if (incident.state !== 'resuelto') {
      incident.resolvedAt = incident.resolvedAt || nowIso();
    }
    incident.state = 'cerrado';
    incident.closedAt = nowIso();
    incident.actions = Array.isArray(incident.actions) ? incident.actions : [];
    incident.actions.unshift({
      id: 'act-' + Date.now().toString(36),
      at: incident.closedAt,
      actor: ctx.actor || 'Administrador',
      text: text((payload || {}).note, 'Incidente cerrado y archivado.')
    });
    const targets = [incident.primaryAssetId].concat(incident.affectedIds || []);
    targets.forEach((assetId) => {
      pushHistory(assetOf(assets, assetId), 'incident', 'Incidente cerrado · ' + incident.title,
        incident.id + ' · sin actuaciones pendientes.',
        {
          actor: ctx.actor || 'Administrador',
          movement: 'incident',
          changes: [change('Estado', before ? before.label : '', 'Cerrado')]
        }
      );
    });
    return { ok: true, errors: [], incident: incident };
  }

  function linkIntervention(state, incidentId, interventionId) {
    const intervention = (state.interventions || []).find((entry) => entry.id === interventionId);
    if (!intervention) return { ok: false, errors: ['La intervención ya no está disponible.'] };
    if (!(state.incidents || []).some((entry) => entry.id === incidentId)) {
      return { ok: false, errors: ['El incidente ya no está disponible.'] };
    }
    attachIntervention(state, incidentId, interventionId);
    return { ok: true, errors: [] };
  }

  // ---------------------------------------------------------------- alerts
  function createFromAlert(state, assets, alertId, payload, context) {
    const ctx = context || {};
    const alert = (state.alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: ['La alerta ya no está disponible.'], incident: null };
    if (alert.incidentId && (alert.state === 'converted' || alert.state === 'linked')) {
      return { ok: false, errors: ['La alerta ya está vinculada a ' + alert.incidentId + '.'], incident: null };
    }
    const input = payload || {};
    const asset = assetOf(assets, alert.assetId);
    const kind = meta(Data.ALERT_KINDS, alert.kind);
    const result = createIncident(state, assets, {
      title: text(input.title, asset ? asset.name + ' · ' + (kind ? kind.label.toLowerCase() : 'alerta') : 'Alerta de supervisión'),
      description: text(input.description, alert.message),
      priority: input.priority || alert.severity,
      primaryAssetId: alert.assetId,
      affectedIds: input.affectedIds || [],
      assigneeId: input.assigneeId,
      note: 'Incidente creado desde la alerta ' + alert.id + ' detectada el ' + toDay(alert.detectedAt) + '.'
    }, { actor: ctx.actor, actorId: ctx.actorId, origin: 'la alerta ' + alert.id });
    if (!result.ok) return result;
    alert.state = 'converted';
    alert.incidentId = result.incident.id;
    alert.suggestion = false;
    pushHistory(asset, 'incident', 'Alerta convertida en incidente',
      alert.id + ' → ' + result.incident.id + ' · ' + alert.message,
      {
        actor: ctx.actor || 'Administrador',
        movement: 'incident',
        changes: [change('Incidente', '', result.incident.id)]
      }
    );
    return result;
  }

  function linkAlert(state, assets, alertId, incidentId, context) {
    const ctx = context || {};
    const alert = (state.alerts || []).find((entry) => entry.id === alertId);
    const incident = (state.incidents || []).find((entry) => entry.id === incidentId);
    if (!alert) return { ok: false, errors: ['La alerta ya no está disponible.'] };
    if (!incident) return { ok: false, errors: ['Selecciona un incidente válido.'] };
    if (alert.incidentId && alert.incidentId !== incident.id) {
      return { ok: false, errors: ['La alerta ya está vinculada a ' + alert.incidentId + '.'] };
    }
    alert.state = 'linked';
    alert.incidentId = incident.id;
    alert.suggestion = !!alert.recoveredAt && (incident.state === 'abierto' || incident.state === 'en_curso');
    incident.actions = Array.isArray(incident.actions) ? incident.actions : [];
    incident.actions.unshift({
      id: 'act-' + Date.now().toString(36),
      at: nowIso(),
      actor: ctx.actor || 'Administrador',
      text: 'Alerta ' + alert.id + ' vinculada · ' + alert.message
    });
    pushHistory(assetOf(assets, alert.assetId), 'incident', 'Alerta vinculada a incidente',
      alert.id + ' → ' + incident.id,
      { actor: ctx.actor || 'Administrador', movement: 'incident' }
    );
    return { ok: true, errors: [], alert: alert, incident: incident };
  }

  function markAlertRecovered(state, assets, alertId, context) {
    const ctx = context || {};
    const alert = (state.alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: ['La alerta ya no está disponible.'] };
    if (alert.recoveredAt) return { ok: false, errors: ['La alerta ya figura como recuperada.'] };
    alert.recoveredAt = nowIso();
    alert.state = alert.state === 'open' ? 'recovered' : alert.state;
    const incident = (state.incidents || []).find((entry) => entry.id === alert.incidentId);
    alert.suggestion = !!incident && (incident.state === 'abierto' || incident.state === 'en_curso');
    pushHistory(assetOf(assets, alert.assetId), 'incident', 'Recuperación detectada',
      alert.id + ' · la supervisión deja de reportar el problema. La resolución del incidente se confirma aparte.',
      { actor: ctx.actor || 'Administrador', movement: 'incident' }
    );
    return { ok: true, errors: [], alert: alert };
  }

  function dismissSuggestion(state, alertId) {
    const alert = (state.alerts || []).find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, errors: ['La alerta ya no está disponible.'] };
    alert.suggestion = false;
    return { ok: true, errors: [] };
  }

  function suggestionsFor(state, incidentId) {
    return (state.alerts || []).filter((alert) => alert.incidentId === incidentId && alert.suggestion && alert.recoveredAt);
  }

  // ---------------------------------------------------------------- configuration
  function saveTemplate(state, payload) {
    const input = payload || {};
    const label = text(input.label);
    const category = text(input.category);
    const months = Number(input.intervalMonths);
    const errors = [];
    if (!label) errors.push('Escribe un nombre para la plantilla.');
    if (!category) errors.push('Selecciona una categoría.');
    if (!Number.isFinite(months) || months < 1 || months > 60) errors.push('El intervalo debe estar entre 1 y 60 meses.');
    if (errors.length) return { ok: false, errors: errors, template: null };
    let template = input.id ? meta(state.templates, input.id) : null;
    if (!template) {
      const base = 'tpl-' + (window.AssetStore ? window.AssetStore.slugify(label, category) : category);
      let id = base;
      let suffix = 2;
      while (meta(state.templates, id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      template = {
        id: id,
        category: category,
        label: label.slice(0, 80),
        intervalMonths: Math.round(months),
        active: input.active !== false,
        tasks: []
      };
      state.templates.push(template);
    }
    template.label = label.slice(0, 80);
    template.category = category;
    template.intervalMonths = Math.round(months);
    template.active = input.active !== false;
    template.tasks = (Array.isArray(input.tasks) ? input.tasks : template.tasks)
      .map((task) => text(task)).filter(Boolean).slice(0, 12);
    return { ok: true, errors: [], template: template };
  }

  function deleteTemplate(state, id) {
    const index = (state.templates || []).findIndex((entry) => entry.id === id);
    if (index === -1) return { ok: false, errors: ['La plantilla ya no está disponible.'] };
    const used = (state.plans || []).filter((plan) => plan.templateId === id).length;
    if (used) {
      return { ok: false, errors: ['No se puede eliminar: ' + used + (used === 1 ? ' plan la usa' : ' planes la usan') + '. Desactívala para dejar de proponerla.'] };
    }
    state.templates.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function restoreTemplates(state) {
    const existing = new Set((state.templates || []).map((template) => template.id));
    Data.TEMPLATES.forEach((template) => {
      if (!existing.has(template.id)) state.templates.push(clone(template));
    });
    state.templates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return { ok: true, errors: [], templates: state.templates };
  }

  function saveType(state, payload) {
    const input = payload || {};
    const label = text(input.label);
    const errors = [];
    if (!label) errors.push('Escribe un nombre para el tipo.');
    if (errors.length) return { ok: false, errors: errors, type: null };
    let type = input.id ? meta(state.types, input.id) : null;
    if (!type) {
      const base = 'type-' + (window.AssetStore ? window.AssetStore.slugify(label, 'trabajo') : 'trabajo');
      let id = base;
      let suffix = 2;
      while (meta(state.types, id)) {
        id = base + '-' + suffix;
        suffix += 1;
      }
      type = { id: id, label: label.slice(0, 60), icon: 'activity', tone: 'neutral', resetsPreventive: false, hint: '' };
      state.types.push(type);
    }
    type.label = label.slice(0, 60);
    type.icon = text(input.icon, type.icon);
    type.tone = ['ok', 'warn', 'down', 'hold', 'neutral'].indexOf(input.tone) !== -1 ? input.tone : type.tone;
    type.resetsPreventive = input.resetsPreventive === true;
    type.hint = text(input.hint, type.hint).slice(0, 240);
    return { ok: true, errors: [], type: type };
  }

  function deleteType(state, id) {
    const index = (state.types || []).findIndex((entry) => entry.id === id);
    if (index === -1) return { ok: false, errors: ['El tipo ya no está disponible.'] };
    const used = (state.interventions || []).filter((item) => item.type === id).length;
    if (used) return { ok: false, errors: ['No se puede eliminar: ' + used + ' intervenciones usan este tipo.'] };
    if (state.types.length <= 1) return { ok: false, errors: ['Debe quedar al menos un tipo de intervención.'] };
    state.types.splice(index, 1);
    return { ok: true, errors: [] };
  }

  function savePrefs(state, payload) {
    state.prefs = normalizePrefs(Object.assign({}, state.prefs, payload || {}));
    return { ok: true, errors: [], prefs: state.prefs };
  }

  // ---------------------------------------------------------------- exports
  window.AssetMaintEngine = {
    DAY,
    addMonths,
    addDays,
    daysUntil,
    today,
    toDay,
    localDay,
    validDay,
    nextId,
    meta,
    personName,
    siteLabel,
    assetOf,
    templateFor,
    planFor,
    baseDue,
    dueOf,
    statusOf,
    STATUS_META,
    scheduleRow,
    agenda,
    stats,
    interventionMatches,
    incidentMatches,
    alertMatches,
    suggestionsFor,
    normalize,
    saveIntervention,
    completeIntervention,
    postponePlan,
    savePlan,
    removePlan,
    createIncident,
    attachIntervention,
    linkIntervention,
    addIncidentAction,
    resolveIncident,
    closeIncident,
    createFromAlert,
    linkAlert,
    markAlertRecovered,
    dismissSuggestion,
    saveTemplate,
    deleteTemplate,
    restoreTemplates,
    saveType,
    deleteType,
    savePrefs
  };
})();
