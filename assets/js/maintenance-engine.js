(function () {
  'use strict';

  /* Display helpers for server maintenance DTOs.
   *
   * Phase 7 moved every read and write to the maintenance adapter. This module
   * only computes dates, labels, groups and filters over the rows the server
   * returned; it owns no collection and never falls back to prototype data. */

  const Data = window.ASSET_MAINT;
  const DAY = 86400000;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function T(key) {
    return window.ItsmI18n ? window.ItsmI18n.t(key) : '';
  }

  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function localDay(date) {
    const value = date instanceof Date ? date : new Date();
    if (Number.isNaN(value.getTime())) return '';
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return value.getFullYear() + '-' + month + '-' + day;
  }

  function today() {
    return localDay(new Date());
  }

  function toDay(value) {
    const raw = text(value);
    return raw ? raw.slice(0, 10) : '';
  }

  function dayMs(day) {
    const value = text(day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  }

  function validDay(day) {
    return Number.isFinite(dayMs(day));
  }

  function addMonths(day, months) {
    const value = toDay(day);
    const count = Number(months);
    if (!validDay(value) || !Number.isFinite(count)) return '';
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7)) - 1;
    const date = Number(value.slice(8, 10));
    const target = new Date(Date.UTC(year, month + count, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date, lastDay));
    return target.toISOString().slice(0, 10);
  }

  function addDays(day, count) {
    const value = toDay(day);
    const amount = Number(count);
    if (!validDay(value) || !Number.isFinite(amount)) return '';
    return new Date(dayMs(value) + amount * DAY).toISOString().slice(0, 10);
  }

  function daysUntil(day, reference) {
    const value = toDay(day);
    const base = toDay(reference) || today();
    if (!validDay(value) || !validDay(base)) return null;
    return Math.round((dayMs(value) - dayMs(base)) / DAY);
  }

  function maxDay(first, second) {
    const a = toDay(first);
    const b = toDay(second);
    if (!validDay(a)) return validDay(b) ? b : '';
    if (!validDay(b)) return a;
    return dayMs(a) >= dayMs(b) ? a : b;
  }

  const TYPE_ALIASES = { preventivo: 'preventive', correctivo: 'corrective', inspeccion: 'inspection', instalacion: 'installation', otro: 'other' };

  function typeMeta(id) {
    const key = TYPE_ALIASES[text(id)] || text(id);
    return Data.INTERVENTION_TYPES.find((item) => item.id === key) || Data.INTERVENTION_TYPES[Data.INTERVENTION_TYPES.length - 1];
  }

  function personName(people, id) {
    const personId = text(id);
    if (!personId) return '';
    const person = (people || []).find((item) => text(item.id) === personId);
    return person ? text(person.name) : '';
  }

  function siteLabel(sites, id) {
    const siteId = text(id);
    if (!siteId) return '';
    const site = (sites || []).find((item) => text(item.id) === siteId);
    return site ? text(site.label || site.name) : '';
  }

  function assetOf(assets, id) {
    const assetId = text(id);
    if (!assetId) return null;
    return (assets || []).find((item) => text(item.id) === assetId) || null;
  }

  const STATUS_META = {
    overdue: { id: 'overdue', get label() { return T('ui.maintenance.status.overdue'); }, tone: 'down', order: 0 },
    today: { id: 'today', get label() { return T('ui.maintenance.status.today'); }, tone: 'warn', order: 1 },
    soon: { id: 'soon', get label() { return T('ui.maintenance.status.soon'); }, tone: 'warn', order: 2 },
    scheduled: { id: 'scheduled', get label() { return T('ui.maintenance.status.scheduled'); }, tone: 'neutral', order: 3 }
  };

  function statusOf(days) {
    if (days === null || days === undefined) return 'scheduled';
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= 14) return 'soon';
    return 'scheduled';
  }

  /* A plan row is already the adapter view model: dueOn is authoritative and the
   * asset summary travels with it, so this helper never needs the prototype
   * asset collection to render a server plan. */
  function scheduleRow(state, plan, assets, reference) {
    const source = plan || {};
    const dueAt = toDay(source.dueOn || source.dueAt);
    const days = validDay(dueAt) ? daysUntil(dueAt, reference) : null;
    const status = statusOf(days);
    const asset = source.asset || assetOf(assets, source.assetId) || { id: text(source.assetId), name: text(source.assetName), category: text(source.assetCategory), quickCode: text(source.assetQuickCode) };
    return {
      planId: text(source.id),
      plan: source,
      asset,
      template: { id: text(source.maintenanceType), label: text(source.typeLabel) || typeMeta(source.maintenanceType).label },
      dueAt,
      daysUntil: days,
      status,
      statusMeta: STATUS_META[status],
      openIntervention: null,
      technicianId: text(source.responsiblePersonId),
      lastCompletedAt: toDay(source.lastCompletedOn)
    };
  }

  function agenda(state, assets, filters, reference) {
    const options = filters || {};
    const rows = ((state && state.plans) || [])
      .filter((plan) => text(plan.status) !== 'cancelled')
      .map((plan) => scheduleRow(state, plan, assets, reference));
    const query = text(options.query).toLowerCase();
    return rows
      .filter((row) => {
        if (options.status && options.status !== 'all' && row.status !== options.status) return false;
        if (options.planStatus && options.planStatus !== 'all' && text(row.plan.status) !== options.planStatus) return false;
        if (options.category && options.category !== 'all' && text(row.asset.category) !== options.category) return false;
        if (options.siteId && options.siteId !== 'all' && text(row.plan.siteId) !== options.siteId) return false;
        if (options.technicianId && options.technicianId !== 'all' && row.technicianId !== options.technicianId) return false;
        if (options.from && validDay(row.dueAt) && row.dueAt < options.from) return false;
        if (options.to && validDay(row.dueAt) && row.dueAt > options.to) return false;
        if (query) {
          const haystack = [row.asset.name, row.asset.id, row.asset.quickCode, row.plan.assetName, row.plan.assetQuickCode, row.plan.maintenanceType, row.template.label, row.statusMeta.label, row.plan.site, row.plan.responsibleLabel].join(' ').toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.statusMeta.order - b.statusMeta.order) || (a.daysUntil - b.daysUntil) || String(a.asset.id).localeCompare(String(b.asset.id)));
  }

  function stats(state, assets, reference) {
    const plans = (state && state.plans) || [];
    const rows = agenda(state, assets, {}, reference);
    const overview = (state && state.overview) || {};
    const interventions = (state && state.interventions) || [];
    const incidents = (state && state.incidents) || [];
    const alerts = (state && state.alerts) || [];
    return {
      overdue: Number.isFinite(overview.overdue) ? overview.overdue : rows.filter((row) => row.status === 'overdue').length,
      soon: Number.isFinite(overview.upcoming) ? overview.upcoming : rows.filter((row) => row.status === 'soon').length,
      inProgress: Number.isFinite(overview.inProgress) ? overview.inProgress : interventions.filter((item) => item.status === 'in_progress').length,
      planned: Number.isFinite(overview.openInterventions) ? overview.openInterventions : interventions.filter((item) => item.status === 'open').length,
      completed30: interventions.filter((item) => item.status === 'completed').length,
      openIncidents: Number.isFinite(overview.openIncidents) ? overview.openIncidents : incidents.filter((item) => ['open', 'in_progress'].includes(item.status)).length,
      criticalIncidents: Number.isFinite(overview.criticalIncidents) ? overview.criticalIncidents : incidents.filter((item) => ['open', 'in_progress'].includes(item.status) && item.priority === 'critical').length,
      activeAlerts: alerts.filter((alert) => alert.state === 'open').length,
      recoveredAlerts: alerts.filter((alert) => alert.state === 'recovered').length,
      plans: Number.isFinite(overview.plans) ? overview.plans : plans.length
    };
  }

  function interventionMatches(item, state, assets, people, filters) {
    const options = filters || {};
    const query = text(options.query).toLowerCase();
    if (options.status && options.status !== 'all' && item.status !== options.status) return false;
    if (options.type && options.type !== 'all' && item.type !== options.type) return false;
    if (options.category && options.category !== 'all' && text(item.assetCategory) !== options.category) return false;
    if (options.siteId && options.siteId !== 'all' && text(item.siteId) !== options.siteId) return false;
    if (options.assetId && item.assetId !== options.assetId) return false;
    if (options.technicianId && options.technicianId !== 'all' && item.technicianPersonId !== options.technicianId) return false;
    if (options.from && item.occurredOn && item.occurredOn < options.from) return false;
    if (options.to && item.occurredOn && item.occurredOn > options.to) return false;
    if (query) {
      const haystack = [item.id, item.description, item.notes, item.assetName, item.assetQuickCode, item.technicianName, typeMeta(item.type).label].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function incidentMatches(item, assets, people, filters) {
    const options = filters || {};
    const query = text(options.query).toLowerCase();
    if (options.status && options.status !== 'all' && item.status !== options.status) return false;
    if (options.priority && options.priority !== 'all' && item.priority !== options.priority) return false;
    if (options.category && options.category !== 'all' && text(item.primaryAssetCategory) !== options.category) return false;
    if (options.siteId && options.siteId !== 'all' && text(item.siteId) !== options.siteId) return false;
    if (options.assetId && item.primaryAssetId !== options.assetId && !(item.affectedAssetIds || []).includes(options.assetId)) return false;
    if (options.responsiblePersonId && options.responsiblePersonId !== 'all' && item.responsiblePersonId !== options.responsiblePersonId) return false;
    if (options.from && item.openedOn && item.openedOn < options.from) return false;
    if (options.to && item.openedOn && item.openedOn > options.to) return false;
    if (query) {
      const haystack = [item.id, item.description, item.primaryAssetName, item.primaryAssetQuickCode, item.responsibleName].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function alertMatches(item, assets, filters) {
    const options = filters || {};
    const query = text(options.query).toLowerCase();
    if (options.status && options.status !== 'all' && item.state !== options.status) return false;
    if (query) {
      const asset = assetOf(assets, item.assetId);
      const haystack = [item.id, item.message, item.assetId, asset ? asset.name : '', alertKindLabel(item.kind)].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function alertKindLabel(id) {
    const kind = Data.ALERT_KINDS.find((item) => item.id === id);
    return kind ? kind.label : T('ui.maintenance.type.fallback_kind');
  }

  /* Monitoring conversion belongs to the monitoring phase. Returning an honest
   * error keeps demo alerts out of the canonical incident collection. */
  function createFromAlert() {
    return { ok: false, errors: [T('ui.maintenance.alert_conversion_unavailable')], incident: null };
  }

  window.AssetMaintEngine = {
    DAY,
    DAY_MS: DAY,
    addDays,
    addMonths,
    agenda,
    alertKindLabel,
    alertMatches,
    assetOf,
    createFromAlert,
    daysUntil,
    incidentMatches,
    interventionMatches,
    localDay,
    maxDay,
    nowIso,
    personName,
    scheduleRow,
    siteLabel,
    stats,
    statusOf,
    STATUS_META,
    text,
    today,
    toDay,
    typeMeta,
    validDay,
    clone
  };
})();
