(function () {
  'use strict';

  // Every label below is a catalog key resolved when it is read, so the same
  // movement definitions render in the active language without a reload.
  function translate(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  function localized(source) {
    const entry = {};
    Object.keys(source).forEach(function (key) {
      if (key === 'labelKey' || key === 'actionKey' || key === 'titleKey' || key === 'hintKey') {
        Object.defineProperty(entry, key.replace(/Key$/, ''), {
          enumerable: true,
          get: function () { return translate(source[key]); }
        });
        return;
      }
      entry[key] = source[key];
    });
    return entry;
  }

  const MOVEMENTS = [
    localized({
      id: 'transfer',
      labelKey: 'ui.operations.movement.transfer.label',
      actionKey: 'ui.operations.movement.transfer.action',
      titleKey: 'ui.operations.movement.transfer.title',
      hintKey: 'ui.operations.movement.transfer.hint',
      icon: 'map-pin'
    }),
    localized({
      id: 'assigned',
      labelKey: 'ui.operations.movement.assigned.label',
      actionKey: 'ui.operations.movement.assigned.action',
      titleKey: 'ui.operations.movement.assigned.title',
      hintKey: 'ui.operations.movement.assigned.hint',
      icon: 'user'
    }),
    localized({
      id: 'returned',
      labelKey: 'ui.operations.movement.returned.label',
      actionKey: 'ui.operations.movement.returned.action',
      titleKey: 'ui.operations.movement.returned.title',
      hintKey: 'ui.operations.movement.returned.hint',
      icon: 'restore'
    }),
    localized({
      id: 'status',
      labelKey: 'ui.operations.movement.status.label',
      actionKey: 'ui.operations.movement.status.action',
      titleKey: 'ui.operations.movement.status.title',
      hintKey: 'ui.operations.movement.status.hint',
      icon: 'activity'
    }),
    localized({
      id: 'retired',
      labelKey: 'ui.operations.movement.retired.label',
      actionKey: 'ui.operations.movement.retired.action',
      titleKey: 'ui.operations.movement.retired.title',
      hintKey: 'ui.operations.movement.retired.hint',
      icon: 'minus'
    })
  ];

  const KIND_META = {
    created: localized({ labelKey: 'ui.operations.kind.created', icon: 'plus', tone: 'ok' }),
    updated: localized({ labelKey: 'ui.operations.kind.updated', icon: 'pencil', tone: 'neutral' }),
    assigned: localized({ labelKey: 'ui.operations.kind.assigned', icon: 'user', tone: 'ok' }),
    status: localized({ labelKey: 'ui.operations.kind.status', icon: 'activity', tone: 'warn' }),
    code: localized({ labelKey: 'ui.operations.kind.code', icon: 'layers', tone: 'warn' }),
    retired: localized({ labelKey: 'ui.operations.kind.retired', icon: 'minus', tone: 'down' }),
    restored: localized({ labelKey: 'ui.operations.kind.restored', icon: 'restore', tone: 'ok' }),
    transfer: localized({ labelKey: 'ui.operations.kind.transfer', icon: 'map-pin', tone: 'ok' }),
    returned: localized({ labelKey: 'ui.operations.kind.returned', icon: 'restore', tone: 'neutral' }),
    bulk: localized({ labelKey: 'ui.operations.kind.bulk', icon: 'layers', tone: 'neutral' }),
    relation: localized({ labelKey: 'ui.operations.kind.relation', icon: 'network', tone: 'neutral' }),
    maintenance: localized({ labelKey: 'ui.operations.kind.maintenance', icon: 'refresh', tone: 'ok' }),
    incident: localized({ labelKey: 'ui.operations.kind.incident', icon: 'alert', tone: 'warn' }),
    monitoring: localized({ labelKey: 'ui.operations.kind.monitoring', icon: 'activity', tone: 'warn' })
  };

  const HISTORY_FILTERS = [
    localized({ id: 'all', labelKey: 'ui.operations.filter.all', kinds: null }),
    localized({ id: 'movements', labelKey: 'ui.operations.filter.movements', kinds: ['transfer', 'assigned', 'returned'] }),
    localized({ id: 'status', labelKey: 'ui.operations.filter.status', kinds: ['status', 'restored'] }),
    localized({ id: 'fields', labelKey: 'ui.operations.filter.fields', kinds: ['created', 'updated', 'bulk'] }),
    localized({ id: 'code', labelKey: 'ui.operations.filter.code', kinds: ['code'] }),
    localized({ id: 'relations', labelKey: 'ui.operations.filter.relations', kinds: ['relation'] }),
    localized({ id: 'maintenance', labelKey: 'ui.operations.filter.maintenance', kinds: ['maintenance'] }),
    localized({ id: 'incidents', labelKey: 'ui.operations.filter.incidents', kinds: ['incident'] }),
    localized({ id: 'monitoring', labelKey: 'ui.operations.filter.monitoring', kinds: ['monitoring'] }),
    localized({ id: 'retired', labelKey: 'ui.operations.filter.retired', kinds: ['retired'] })
  ];

  // The suggested reasons travel with the position they belong to; the form
  // stores the visible text the person accepted, exactly like any typed reason.
  const REASON_KEYS = {
    transfer: ['ui.operations.reason.transfer.relocation', 'ui.operations.reason.transfer.workstation', 'ui.operations.reason.transfer.site', 'ui.operations.reason.transfer.area', 'ui.operations.reason.other'],
    assigned: ['ui.operations.reason.assigned.position', 'ui.operations.reason.assigned.reassignment', 'ui.operations.reason.assigned.cover', 'ui.operations.reason.other'],
    returned: ['ui.operations.reason.returned.change', 'ui.operations.reason.returned.assignment_end', 'ui.operations.reason.returned.leave', 'ui.operations.reason.returned.position_end', 'ui.operations.reason.other'],
    status: ['ui.operations.reason.status.preventive', 'ui.operations.reason.status.fault', 'ui.operations.reason.status.storage', 'ui.operations.reason.status.repaired', 'ui.operations.reason.other'],
    retired: ['ui.operations.reason.retired.end_of_life', 'ui.operations.reason.retired.irreparable', 'ui.operations.reason.retired.loss', 'ui.operations.reason.retired.renewal', 'ui.operations.reason.other']
  };

  function reasonList(type) {
    const keys = REASON_KEYS[type] || REASON_KEYS.retired;
    return keys.map(function (key) { return translate(key); });
  }

  window.AssetOpsData = {
    MOVEMENTS,
    KIND_META,
    HISTORY_FILTERS,
    reasonList
  };
})();
