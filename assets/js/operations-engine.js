(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; a runtime-less module
  // falls back to the platform collation.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), undefined, options || { sensitivity: 'base' });
  }

  function runtime() {
    return typeof window !== 'undefined' ? window.ItsmI18n : null;
  }

  // Every visible string in this module is a stable key resolved at call time,
  // so a running session switches language without reloading the engine.
  function tr(key, params) {
    const api = runtime();
    return api ? api.t(key, params) : '';
  }

  const Schema = window.AssetSchema;
  const Data = window.AssetOpsData;
  const HISTORY_LIMIT = 200;

  function text(value, fallback) {
    return Schema.text(value, fallback);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function currency(value) {
    return window.ItsmI18n
      ? window.ItsmI18n.amount(value)
      : String(Number(value) || 0);
  }

  function findById(list, id) {
    const items = Array.isArray(list) ? list : [];
    return items.find(function (item) { return item && item.id === id; }) || null;
  }

  function siteLabel(sites, id) {
    const site = findById(sites, id);
    return site ? site.label : '';
  }

  function locationOf(sites, siteId, locationId) {
    const site = findById(sites, siteId);
    const locations = site && Array.isArray(site.locations) ? site.locations : [];
    return locations.find(function (item) { return item.id === locationId; }) || null;
  }

  function locationLabelOf(sites, siteId, locationId) {
    const location = locationOf(sites, siteId, locationId);
    return location ? location.label : '';
  }

  function personOf(people, id) {
    return findById(people, id);
  }

  function statusOf(admin, id) {
    const statuses = admin && Array.isArray(admin.statuses) ? admin.statuses : [];
    return statuses.find(function (item) { return item.id === id; }) || null;
  }

  function finalStatus(admin) {
    const statuses = admin && Array.isArray(admin.statuses) ? admin.statuses : [];
    return statuses.find(function (item) { return item.final; }) || statuses[statuses.length - 1] || null;
  }

  function openStatuses(admin) {
    const statuses = admin && Array.isArray(admin.statuses) ? admin.statuses : [];
    return statuses.filter(function (item) { return !item.final; });
  }

  function actorOf(app) {
    const user = app && app.currentUser ? app.currentUser : null;
    if (user && user.name) return user.name;
    return tr('ui.operations.actor.administrator');
  }

  function effectiveIso(value) {
    if (!value) return nowIso();
    const parsed = new Date(String(value) + 'T12:00:00');
    if (Number.isNaN(parsed.getTime())) return nowIso();
    return parsed.toISOString();
  }

  function entryFor(kind, title, detail, plan, movement, actor, effectiveAt) {
    const recordedAt = nowIso();
    const entry = Schema.historyEntry(kind, title, detail, {
      actor: actor,
      changes: plan.changes,
      movement: movement.type,
      effectiveAt: effectiveAt,
      recordedAt: recordedAt
    });
    entry.at = effectiveAt || recordedAt;
    return entry;
  }

  function planBase(asset, type) {
    return {
      ok: true,
      type: type,
      errors: [],
      warnings: [],
      changes: [],
      code: { from: asset.code, to: asset.code, changed: false },
      patch: {},
      statusId: asset.statusId
    };
  }

  function addChange(plan, field, label, before, after) {
    plan.changes.push({
      field: field,
      label: label,
      before: before === undefined || before === null ? '' : String(before),
      after: after === undefined || after === null ? '' : String(after)
    });
  }

  function guardRetired(asset, plan, type) {
    if (!asset.retired) return true;
    if (type === 'retired') {
      plan.errors.push(tr('ui.operations.error.retired_already'));
    } else {
      plan.errors.push(tr('ui.operations.error.retired_no_moves'));
    }
    return false;
  }

  function recalcCode(asset, plan, context, siteId) {
    const next = Schema.nextCode(context.assets, asset.category, siteId, context.admin, asset.id);
    if (!next) return;
    if (next !== asset.code) {
      plan.code = { from: asset.code, to: next, changed: true };
      plan.patch.code = next;
      addChange(plan, 'code', tr('ui.operations.field.quick_code'), asset.code, next);
    }
  }

  function planMovement(asset, movement, context) {
    const ctx = context || {};
    const type = movement && movement.type ? movement.type : '';
    const plan = planBase(asset, type);
    if (!asset) {
      plan.errors.push(tr('ui.operations.error.asset_missing'));
      plan.ok = false;
      return plan;
    }
    if (Data.MOVEMENTS.map(function (item) { return item.id; }).indexOf(type) === -1) {
      plan.errors.push(tr('ui.operations.error.unknown_type'));
      plan.ok = false;
      return plan;
    }

    if (type === 'transfer') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      const siteId = text(movement.site, asset.site);
      const site = findById(ctx.sites, siteId);
      const locationId = text(movement.locationId, '');
      const location = site ? locationOf(ctx.sites, site.id, locationId) : null;
      if (!site) plan.errors.push(tr('ui.operations.error.choose_site'));
      if (!text(movement.reason, '')) plan.errors.push(tr('ui.operations.error.transfer_reason'));
      if (site && locationId && !location) plan.errors.push(tr('ui.operations.error.location_outside_site'));
      if (site && site.id === asset.site && (locationId || '') === (asset.locationId || '')) {
        plan.errors.push(tr('ui.operations.error.same_destination'));
      }
      if (site && site.id === asset.site) {
        plan.warnings.push(tr('ui.operations.warn.site_unchanged'));
      }
      if (site && !locationId) {
        plan.warnings.push(tr('ui.operations.warn.no_location', { site: site.label }));
      }
      if (site && asset.assigneeId && site.id !== asset.site) {
        plan.warnings.push(tr('ui.operations.warn.owner_kept'));
      }
      if (!plan.errors.length) {
        if (site.id !== asset.site) {
          addChange(plan, 'site', tr('ui.operations.field.site'), siteLabel(ctx.sites, asset.site), site.label);
          plan.patch.site = site.id;
          recalcCode(asset, plan, ctx, site.id);
        }
        if ((locationId || '') !== (asset.locationId || '')) {
          addChange(plan, 'locationId', tr('ui.operations.field.location'), asset.location || tr('ui.operations.value.no_location'), location ? location.label : tr('ui.operations.value.no_location'));
          plan.patch.locationId = location ? location.id : '';
          plan.patch.location = location ? location.label : '';
        }
      }
      return finish(plan);
    }

    if (type === 'assigned') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      const person = personOf(ctx.people, movement.personId);
      if (!person) plan.errors.push(tr('ui.operations.error.choose_person'));
      else if (!person.active) plan.errors.push(tr('ui.operations.error.person_inactive'));
      else if (person.id === asset.assigneeId) plan.errors.push(tr('ui.operations.error.already_assigned'));
      if (!text(movement.reason, '')) plan.errors.push(tr('ui.operations.error.assign_reason'));
      if (person && !plan.errors.length) {
        addChange(plan, 'assigneeId', tr('ui.operations.field.owner'), asset.assignee || tr('ui.operations.value.unassigned'), person.name);
        plan.patch.assigneeId = person.id;
        plan.patch.assignee = person.name;
        if (asset.statusId === 'resguardo') {
          plan.warnings.push(tr('ui.operations.warn.still_in_storage'));
        }
      }
      return finish(plan);
    }

    if (type === 'returned') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      if (!asset.assigneeId) plan.errors.push(tr('ui.operations.error.no_owner'));
      if (!text(movement.reason, '')) plan.errors.push(tr('ui.operations.error.return_reason'));
      const target = statusOf(ctx.admin, movement.statusId) || findById(openStatuses(ctx.admin), 'resguardo') || openStatuses(ctx.admin)[0];
      if (target && target.final) plan.errors.push(tr('ui.operations.error.final_status_return'));
      if (!plan.errors.length) {
        addChange(plan, 'assigneeId', tr('ui.operations.field.owner'), asset.assignee || tr('ui.operations.value.unassigned'), tr('ui.operations.value.unassigned'));
        plan.patch.assigneeId = '';
        plan.patch.assignee = '';
        if (target && target.id !== asset.statusId) {
          addChange(plan, 'statusId', tr('ui.operations.field.status'), asset.status, target.label);
          plan.patch.statusId = target.id;
          plan.patch.status = target.label;
          plan.patch.statusTone = target.tone;
        }
      }
      return finish(plan);
    }

    if (type === 'status') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      const target = statusOf(ctx.admin, movement.statusId);
      if (!target) plan.errors.push(tr('ui.operations.error.choose_status'));
      else if (target.final) plan.errors.push(tr('ui.operations.error.retire_use_retire'));
      else if (target.id === asset.statusId) plan.errors.push(tr('ui.operations.error.same_status'));
      if (!text(movement.reason, '')) plan.errors.push(tr('ui.operations.error.status_reason'));
      if (target && !plan.errors.length) {
        addChange(plan, 'statusId', tr('ui.operations.field.status'), asset.status, target.label);
        plan.patch.statusId = target.id;
        plan.patch.status = target.label;
        plan.patch.statusTone = target.tone;
      }
      return finish(plan);
    }

    // retired
    if (asset.retired) {
      plan.errors.push(tr('ui.operations.error.retired_already'));
      return finish(plan);
    }
    const target = finalStatus(ctx.admin);
    if (!text(movement.reason, '')) plan.errors.push(tr('ui.operations.error.retire_reason'));
    if (!movement.ack) plan.errors.push(tr('ui.operations.error.retire_ack'));
    if (!target) plan.errors.push(tr('ui.operations.error.no_final_status'));
    if (!plan.errors.length) {
      addChange(plan, 'statusId', tr('ui.operations.field.status'), asset.status, target.label);
      if (asset.assigneeId) {
        addChange(plan, 'assigneeId', tr('ui.operations.field.owner'), asset.assignee || tr('ui.operations.value.unassigned'), tr('ui.operations.value.unassigned'));
      }
      addChange(plan, 'retired', tr('ui.operations.field.conservation'), tr('ui.operations.value.operational_inventory'), tr('ui.operations.value.conservation_kept'));
      plan.patch.statusId = target.id;
      plan.patch.status = target.label;
      plan.patch.statusTone = target.tone;
      plan.patch.assigneeId = '';
      plan.patch.assignee = '';
      plan.patch.retired = {
        at: effectiveIso(movement.effective),
        reason: movement.reason,
        note: text(movement.note, '')
      };
    }
    return finish(plan);
  }

  function finish(plan) {
    plan.ok = plan.errors.length === 0;
    return plan;
  }

  function detailFor(type, movement, asset, plan, ctx) {
    const note = text(movement.note, '');
    const reason = text(movement.reason, '');
    let detail = reason || '';
    if (type === 'transfer') {
      const before = siteLabel(ctx.sites, asset.site) + (asset.location ? ' · ' + asset.location : '');
      const afterSite = plan.patch.site ? siteLabel(ctx.sites, plan.patch.site) : siteLabel(ctx.sites, asset.site);
      const afterLocation = plan.patch.location !== undefined ? plan.patch.location : asset.location;
      detail = before + ' → ' + afterSite + (afterLocation ? ' · ' + afterLocation : '') + '.';
      if (reason) detail += ' ' + reason + '.';
      if (plan.code.changed) detail += ' ' + tr('ui.operations.detail.code_changed', { from: plan.code.from, to: plan.code.to });
    } else if (type === 'assigned') {
      const person = personOf(ctx.people, plan.patch.assigneeId);
      detail = (asset.assignee || tr('ui.operations.value.unassigned')) + ' → ' + (person ? person.name : '') + '.';
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'returned') {
      detail = tr('ui.operations.detail.returned', { name: asset.assignee || tr('ui.operations.value.owner_unrecorded'), status: plan.patch.status || asset.status });
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'status') {
      detail = asset.status + ' → ' + (plan.patch.status || asset.status) + '.';
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'retired') {
      detail = tr('ui.operations.detail.retired', { reason: reason });
    }
    if (note) detail += ' ' + note;
    return detail;
  }

  function applyMovement(asset, movement, context) {
    const ctx = context || {};
    const plan = planMovement(asset, movement, ctx);
    if (!plan.ok) return { ok: false, errors: plan.errors, warnings: plan.warnings, plan: plan };
    const type = movement.type;
    const effectiveAt = effectiveIso(movement.effective);
    const detail = detailFor(type, movement, asset, plan, ctx);
    Object.assign(asset, plan.patch);
    asset.updatedAt = nowIso();
    const entry = entryFor(
      type === 'retired' ? 'retired' : type,
      Data.MOVEMENTS.find(function (item) { return item.id === type; }).title,
      detail,
      plan,
      { type: type },
      ctx.actor || tr('ui.operations.actor.administrator'),
      effectiveAt
    );
    asset.history.unshift(entry);
    asset.history = asset.history.slice(0, HISTORY_LIMIT);
    return { ok: true, plan: plan, entry: entry, changes: plan.changes, warnings: plan.warnings, code: plan.code };
  }

  // ------------------------------------------------------------------ bulk
  const CONTROL_TYPES = { select: 'select', number: 'number', boolean: 'boolean', date: 'date' };

  function bulkCatalog(context, assets) {
    const ctx = context || {};
    const fields = [
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
    const seen = {};
    const selected = Array.isArray(assets) ? assets : [];
    selected.forEach(function (asset) {
      const tech = Schema.techFields(ctx.admin, asset.category);
      tech.forEach(function (field) {
        if (seen[field.key]) return;
        seen[field.key] = true;
        fields.push({
          key: 'tech.' + field.key,
          label: field.label,
          control: CONTROL_TYPES[field.type] || 'text',
          group: 'technical',
          field: field,
          options: Array.isArray(field.options) ? field.options : []
        });
      });
    });
    return fields;
  }

  function parseTech(field, raw) {
    if (field.type === 'number') return Schema.number(raw, 0);
    if (field.type === 'boolean') return raw === true || raw === 'true';
    return text(raw, '');
  }

  function previewValue(value) {
    if (value === true) return tr('ui.operations.value.yes');
    if (value === false) return tr('ui.operations.value.no');
    if (value === '' || value === undefined || value === null) return tr('ui.operations.value.empty');
    return String(value);
  }

  function computeBulk(selected, values, context) {
    const ctx = context || {};
    const working = (Array.isArray(ctx.assets) ? ctx.assets : []).map(function (asset) {
      return { id: asset.id, code: asset.code, category: asset.category, site: asset.site };
    });
    const keys = Object.keys(values || {});

    return (Array.isArray(selected) ? selected : []).map(function (asset) {
      const row = { asset: asset, skipped: false, skipReason: '', changes: [], warnings: [], patch: {} };
      if (asset.retired) {
        row.skipped = true;
        row.skipReason = tr('ui.operations.bulk.skip_retired');
        return row;
      }
      const work = working.find(function (item) { return item.id === asset.id; });
      const has = function (key) { return keys.indexOf(key) !== -1; };

      // Sede y ubicación primero: el código rápido depende de la sede.
      const targetSiteId = has('site') ? values.site : asset.site;
      const targetSite = findById(ctx.sites, targetSiteId);
      if (has('site') && !targetSite) {
        row.warnings.push(tr('ui.operations.bulk.skip_site'));
        row.skipped = true;
        row.skipReason = tr('ui.operations.bulk.skip_invalid_site');
        return row;
      }
      const siteChanged = !!targetSite && targetSite.id !== asset.site;
      if (siteChanged) {
        row.patch.site = targetSite.id;
        row.changes.push({ field: 'site', label: tr('ui.operations.field.site'), before: siteLabel(ctx.sites, asset.site), after: targetSite.label });
      }

      let targetLocationId = has('locationId') ? values.locationId : asset.locationId;
      let targetLocation = targetLocationId ? locationOf(ctx.sites, targetSiteId, targetLocationId) : null;
      if (has('locationId') && values.locationId && !targetLocation) {
        row.warnings.push(tr('ui.operations.bulk.warn_location_outside'));
        targetLocationId = asset.locationId;
        targetLocation = targetLocationId ? locationOf(ctx.sites, targetSiteId, targetLocationId) : null;
      }
      if (siteChanged && !has('locationId') && asset.locationId && !targetLocation) {
        targetLocationId = '';
        targetLocation = null;
        row.warnings.push(tr('ui.operations.bulk.warn_no_location'));
      }
      if (targetLocationId !== asset.locationId) {
        row.patch.locationId = targetLocation ? targetLocation.id : '';
        row.patch.location = targetLocation ? targetLocation.label : '';
        row.changes.push({
          field: 'locationId',
          label: tr('ui.operations.field.location'),
          before: asset.location || tr('ui.operations.value.no_location'),
          after: targetLocation ? targetLocation.label : tr('ui.operations.value.no_location')
        });
      }

      if (siteChanged) {
        const nextCode = Schema.nextCode(working, asset.category, targetSite.id, ctx.admin, asset.id);
        if (nextCode && nextCode !== asset.code) {
          row.patch.code = nextCode;
          row.changes.push({ field: 'code', label: tr('ui.operations.field.quick_code'), before: asset.code, after: nextCode });
          work.code = nextCode;
        }
        work.site = targetSite.id;
      }

      if (has('statusId')) {
        const status = statusOf(ctx.admin, values.statusId);
        if (!status) {
          row.warnings.push(tr('ui.operations.bulk.warn_status_missing'));
        } else if (status.final) {
          row.warnings.push(tr('ui.operations.bulk.warn_final_status'));
        } else if (status.id !== asset.statusId) {
          row.patch.statusId = status.id;
          row.patch.status = status.label;
          row.patch.statusTone = status.tone;
          row.changes.push({ field: 'statusId', label: tr('ui.operations.field.status'), before: asset.status, after: status.label });
        }
      }

      if (has('assigneeId')) {
        const personId = values.assigneeId || '';
        const person = personId ? personOf(ctx.people, personId) : null;
        if (personId && !person) {
          row.warnings.push(tr('ui.operations.bulk.warn_person_missing'));
        } else if (person && !person.active) {
          row.warnings.push(tr('ui.operations.bulk.warn_person_inactive'));
        } else if ((person ? person.id : '') !== (asset.assigneeId || '')) {
          row.patch.assigneeId = person ? person.id : '';
          row.patch.assignee = person ? person.name : '';
          row.changes.push({
            field: 'assigneeId',
            label: tr('ui.operations.field.responsible'),
            before: asset.assignee || tr('ui.operations.value.unassigned'),
            after: person ? person.name : tr('ui.operations.value.unassigned')
          });
        }
      }

      ['brand', 'model', 'serial', 'ip'].forEach(function (key) {
        if (!has(key)) return;
        const next = text(values[key], '');
        if (next === text(asset[key], '')) return;
        row.patch[key] = next;
        row.changes.push({
          field: key,
          label: Schema.COMMON_FIELDS[key] ? Schema.COMMON_FIELDS[key].label : key,
          before: asset[key] || tr('ui.operations.value.empty'),
          after: next || tr('ui.operations.value.empty')
        });
      });

      if (has('cost')) {
        const next = Schema.number(values.cost, 0);
        if (next !== Schema.number(asset.cost, 0)) {
          row.patch.cost = next;
          row.changes.push({
            field: 'cost',
            label: tr('ui.operations.field.cost'),
            before: currency(asset.cost),
            after: currency(next)
          });
        }
      }

      const techPatch = {};
      keys.filter(function (key) { return key.indexOf('tech.') === 0; }).forEach(function (key) {
        const fieldKey = key.slice(5);
        const available = Schema.techFields(ctx.admin, asset.category).find(function (item) { return item.key === fieldKey; });
        const label = (bulkCatalog(ctx, [asset]).find(function (item) { return item.key === key; }) || {}).label || fieldKey;
        if (!available) {
          row.warnings.push(tr('ui.operations.bulk.warn_field_category', { field: label, name: asset.name }));
          return;
        }
        const next = parseTech(available, values[key]);
        const before = asset.tech ? asset.tech[fieldKey] : '';
        if (String(before === undefined ? '' : before) === String(next === undefined ? '' : next)) return;
        techPatch[fieldKey] = next;
        row.changes.push({
          field: key,
          label: label,
          before: previewValue(before),
          after: previewValue(next)
        });
      });
      if (Object.keys(techPatch).length) {
        row.patch.tech = Object.assign({}, asset.tech || {}, techPatch);
      }

      if (!row.changes.length && !row.warnings.length) {
        row.skipReason = tr('ui.operations.bulk.skip_unchanged');
      }
      return row;
    });
  }

  function applyBulk(rows, context) {
    const ctx = context || {};
    const applied = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || row.skipped || !row.changes.length) return;
      const asset = (ctx.assets || []).find(function (item) { return item.id === row.asset.id; });
      if (!asset) return;
      Object.assign(asset, row.patch);
      asset.updatedAt = nowIso();
      asset.history.unshift(Schema.historyEntry(
        'bulk',
        tr('ui.operations.kind.bulk'),
        tr('ui.operations.bulk.history_detail', { fields: row.changes.map(function (item) { return item.label; }).join(', ') }),
        {
          actor: ctx.actor || tr('ui.operations.actor.administrator'),
          changes: row.changes,
          movement: 'bulk',
          effectiveAt: nowIso(),
          recordedAt: nowIso()
        }
      ));
      asset.history = asset.history.slice(0, HISTORY_LIMIT);
      applied.push(asset.id);
    });
    return applied;
  }

  // ---------------------------------------------------------------- history
  function historyMatches(entry, filters) {
    const query = text(filters && filters.query, '').toLocaleLowerCase(runtime() ? runtime().activeLocale : undefined);
    const filter = filters && filters.filter ? filters.filter : 'all';
    const actor = filters && filters.actor ? filters.actor : 'all';
    const meta = Data.KIND_META[entry.kind] || null;
    const option = Data.HISTORY_FILTERS.find(function (item) { return item.id === filter; });
    if (option && option.kinds && option.kinds.indexOf(entry.kind) === -1) return false;
    if (actor !== 'all' && (entry.actor || tr('ui.operations.actor.system')) !== actor) return false;
    if (!query) return true;
    const haystack = [entry.title, entry.detail, entry.actor, meta ? meta.label : entry.kind]
      .concat((entry.changes || []).map(function (change) {
        return [change.label, change.before, change.after].join(' ');
      }))
      .join(' ')
      .toLocaleLowerCase(runtime() ? runtime().activeLocale : undefined);
    return haystack.indexOf(query) !== -1;
  }

  function filterHistory(entries, filters) {
    return (Array.isArray(entries) ? entries : []).filter(function (entry) {
      return historyMatches(entry, filters || {});
    });
  }

  function historyActors(entries) {
    const seen = {};
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      const name = entry.actor || tr('ui.operations.actor.system');
      seen[name] = true;
    });
    return Object.keys(seen).sort(function (a, b) { return compareText(a, b, { sensitivity: 'base' }); });
  }

  window.AssetOpsEngine = {
    HISTORY_LIMIT,
    actorOf,
    effectiveIso,
    planMovement,
    applyMovement,
    bulkCatalog,
    computeBulk,
    applyBulk,
    filterHistory,
    historyActors,
    openStatuses,
    finalStatus,
    statusOf,
    siteLabel,
    locationOf,
    locationLabelOf,
    personOf
  };
})();
