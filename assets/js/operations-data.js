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

  function dayFrom(base, days) {
    return base + days * 86400000;
  }

  function actorAt(people, index) {
    const list = Array.isArray(people) ? people : [];
    if (!list.length) return translate('ui.operations.actor.administrator');
    const person = list[index % list.length];
    return person && person.name ? person.name : translate('ui.operations.actor.administrator');
  }

  // Deterministic demo timeline built from the asset's own values: no invented
  // asset names, IPC or costs, only events that match the current record.
  function seedDemoHistory(asset, index, context) {
    if (!asset || !asset.id) return [];
    const people = context && context.people ? context.people : [];
    const sites = context && context.sites ? context.sites : [];
    const created = Date.parse(asset.createdAt) || Date.now();
    const now = Date.now();
    const actor = actorAt(people, index);
    const entries = [];
    let offset = 0;

    const push = function (kind, title, detail, changes, days) {
      offset += 1;
      const at = new Date(Math.min(dayFrom(created, days), now - 3600000)).toISOString();
      entries.push({
        id: 'demo-' + asset.id + '-' + offset,
        at: at,
        kind: kind,
        title: title,
        detail: detail || '',
        actor: actor,
        changes: changes || [],
        effectiveAt: at,
        recordedAt: at,
        movement: kind
      });
    };

    if (asset.assigneeId && asset.assignee) {
      push(
        'assigned',
        translate('ui.operations.demo.assigned.title'),
        translate('ui.operations.demo.assigned.detail', { name: asset.assignee }),
        [{
          field: 'assigneeId',
          label: translate('ui.operations.field.owner'),
          before: translate('ui.operations.value.unassigned'),
          after: asset.assignee
        }],
        3
      );
    }

    if (asset.locationId) {
      const site = sites.find(function (item) { return item.id === asset.site; });
      const locations = site && Array.isArray(site.locations) ? site.locations : [];
      const other = locations.find(function (item) { return item.id !== asset.locationId; });
      if (other) {
        push(
          'transfer',
          translate('ui.operations.demo.transfer.title'),
          translate('ui.operations.demo.transfer.detail', { site: site.label }),
          [
            { field: 'locationId', label: translate('ui.operations.field.location'), before: other.label, after: asset.location || asset.locationId },
            { field: 'site', label: translate('ui.operations.field.site'), before: site.label, after: site.label }
          ],
          9
        );
      }
    }

    if (asset.statusId === 'mantenimiento') {
      push(
        'status',
        translate('ui.operations.demo.maintenance.title'),
        translate('ui.operations.demo.maintenance.detail'),
        [{
          field: 'statusId',
          label: translate('ui.operations.field.status'),
          before: translate('ui.operations.value.assigned'),
          after: translate('ui.operations.value.maintenance')
        }],
        14
      );
    } else if (asset.statusId === 'resguardo' && !asset.retired) {
      push(
        'status',
        translate('ui.operations.demo.storage.title'),
        translate('ui.operations.demo.storage.detail'),
        [
          {
            field: 'statusId',
            label: translate('ui.operations.field.status'),
            before: translate('ui.operations.value.assigned'),
            after: translate('ui.operations.value.storage')
          },
          {
            field: 'assigneeId',
            label: translate('ui.operations.field.owner'),
            before: asset.assignee || translate('ui.operations.value.unassigned'),
            after: translate('ui.operations.value.unassigned')
          }
        ],
        7
      );
    }

    return entries.filter(function (entry) {
      return Date.parse(entry.at) <= Date.parse(entry.recordedAt) && Date.parse(entry.at) >= created;
    });
  }

  function enrich(assets, context) {
    if (!Array.isArray(assets)) return assets;
    assets.forEach(function (asset, index) {
      if (!asset || !Array.isArray(asset.history)) return;
      if (asset.history.length > 1) return;
      const demo = seedDemoHistory(asset, index, context);
      if (!demo.length) return;
      const merged = asset.history.concat(demo).sort(function (a, b) {
        return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
      });
      asset.history = merged;
    });
    return assets;
  }

  window.AssetOpsData = {
    MOVEMENTS,
    KIND_META,
    HISTORY_FILTERS,
    reasonList,
    seedDemoHistory,
    enrich
  };
})();
