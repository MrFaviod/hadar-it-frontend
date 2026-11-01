(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
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
      : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value) || 0);
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
    return 'Administrador';
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
      plan.errors.push('El activo ya está dado de baja.');
    } else {
      plan.errors.push('Un activo dado de baja no admite movimientos. Restáuralo primero.');
    }
    return false;
  }

  function recalcCode(asset, plan, context, siteId) {
    const next = Schema.nextCode(context.assets, asset.category, siteId, context.admin, asset.id);
    if (!next) return;
    if (next !== asset.code) {
      plan.code = { from: asset.code, to: next, changed: true };
      plan.patch.code = next;
      addChange(plan, 'code', 'Código rápido', asset.code, next);
    }
  }

  function planMovement(asset, movement, context) {
    const ctx = context || {};
    const type = movement && movement.type ? movement.type : '';
    const plan = planBase(asset, type);
    if (!asset) {
      plan.errors.push('No se encontró el activo.');
      plan.ok = false;
      return plan;
    }
    if (Data.MOVEMENTS.map(function (item) { return item.id; }).indexOf(type) === -1) {
      plan.errors.push('Tipo de movimiento no reconocido.');
      plan.ok = false;
      return plan;
    }

    if (type === 'transfer') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      const siteId = text(movement.site, asset.site);
      const site = findById(ctx.sites, siteId);
      const locationId = text(movement.locationId, '');
      const location = site ? locationOf(ctx.sites, site.id, locationId) : null;
      if (!site) plan.errors.push('Elige la sede de destino.');
      if (!text(movement.reason, '')) plan.errors.push('Indica el motivo del traslado.');
      if (site && locationId && !location) plan.errors.push('La ubicación elegida no pertenece a la sede de destino.');
      if (site && site.id === asset.site && (locationId || '') === (asset.locationId || '')) {
        plan.errors.push('El destino coincide con la ubicación actual del activo.');
      }
      if (site && site.id === asset.site) {
        plan.warnings.push('La sede no cambia: el código rápido se mantiene igual.');
      }
      if (site && !locationId) {
        plan.warnings.push('El activo queda sin ubicación dentro de ' + site.label + '.');
      }
      if (site && asset.assigneeId && site.id !== asset.site) {
        plan.warnings.push('El responsable actual se mantiene aunque cambie de sede.');
      }
      if (!plan.errors.length) {
        if (site.id !== asset.site) {
          addChange(plan, 'site', 'Sede', siteLabel(ctx.sites, asset.site), site.label);
          plan.patch.site = site.id;
          recalcCode(asset, plan, ctx, site.id);
        }
        if ((locationId || '') !== (asset.locationId || '')) {
          addChange(plan, 'locationId', 'Ubicación', asset.location || 'Sin ubicación', location ? location.label : 'Sin ubicación');
          plan.patch.locationId = location ? location.id : '';
          plan.patch.location = location ? location.label : '';
        }
      }
      return finish(plan);
    }

    if (type === 'assigned') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      const person = personOf(ctx.people, movement.personId);
      if (!person) plan.errors.push('Elige la persona responsable.');
      else if (!person.active) plan.errors.push('La persona está inactiva y no puede recibir asignaciones.');
      else if (person.id === asset.assigneeId) plan.errors.push('El activo ya está asignado a esa persona.');
      if (!text(movement.reason, '')) plan.errors.push('Indica el motivo de la asignación.');
      if (person && !plan.errors.length) {
        addChange(plan, 'assigneeId', 'Responsable', asset.assignee || 'Sin asignar', person.name);
        plan.patch.assigneeId = person.id;
        plan.patch.assignee = person.name;
        if (asset.statusId === 'resguardo') {
          plan.warnings.push('El activo sigue en «En resguardo». Cambia su estado en el movimiento «Cambiar estado».');
        }
      }
      return finish(plan);
    }

    if (type === 'returned') {
      if (!guardRetired(asset, plan, type)) return finish(plan);
      if (!asset.assigneeId) plan.errors.push('El activo no tiene un responsable asignado.');
      if (!text(movement.reason, '')) plan.errors.push('Indica el motivo de la devolución.');
      const target = statusOf(ctx.admin, movement.statusId) || findById(openStatuses(ctx.admin), 'resguardo') || openStatuses(ctx.admin)[0];
      if (target && target.final) plan.errors.push('Un estado final no es válido para una devolución.');
      if (!plan.errors.length) {
        addChange(plan, 'assigneeId', 'Responsable', asset.assignee || 'Sin asignar', 'Sin asignar');
        plan.patch.assigneeId = '';
        plan.patch.assignee = '';
        if (target && target.id !== asset.statusId) {
          addChange(plan, 'statusId', 'Estado', asset.status, target.label);
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
      if (!target) plan.errors.push('Elige el estado de destino.');
      else if (target.final) plan.errors.push('Para dar de baja usa el movimiento «Registrar baja».');
      else if (target.id === asset.statusId) plan.errors.push('El activo ya está en ese estado.');
      if (!text(movement.reason, '')) plan.errors.push('Indica el motivo del cambio de estado.');
      if (target && !plan.errors.length) {
        addChange(plan, 'statusId', 'Estado', asset.status, target.label);
        plan.patch.statusId = target.id;
        plan.patch.status = target.label;
        plan.patch.statusTone = target.tone;
      }
      return finish(plan);
    }

    // retired
    if (asset.retired) {
      plan.errors.push('El activo ya está dado de baja.');
      return finish(plan);
    }
    const target = finalStatus(ctx.admin);
    if (!text(movement.reason, '')) plan.errors.push('Indica el motivo de la baja.');
    if (!movement.ack) plan.errors.push('Confirma que el activo deja de estar operativo.');
    if (!target) plan.errors.push('No hay un estado final configurado para la baja.');
    if (!plan.errors.length) {
      addChange(plan, 'statusId', 'Estado', asset.status, target.label);
      if (asset.assigneeId) {
        addChange(plan, 'assigneeId', 'Responsable', asset.assignee || 'Sin asignar', 'Sin asignar');
      }
      addChange(plan, 'retired', 'Conservación', 'Inventario operativo', 'Ficha, adjuntos e historial conservados');
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
      if (plan.code.changed) detail += ' Código ' + plan.code.from + ' → ' + plan.code.to + '.';
    } else if (type === 'assigned') {
      const person = personOf(ctx.people, plan.patch.assigneeId);
      detail = (asset.assignee || 'Sin asignar') + ' → ' + (person ? person.name : '') + '.';
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'returned') {
      detail = 'Devuelto por ' + (asset.assignee || 'responsable sin registrar') + '. Estado «' + (plan.patch.status || asset.status) + '».';
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'status') {
      detail = asset.status + ' → ' + (plan.patch.status || asset.status) + '.';
      if (reason) detail += ' ' + reason + '.';
    } else if (type === 'retired') {
      detail = reason + '. La ficha, los adjuntos y el historial se conservan. Los activos relacionados no se modifican.';
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
      ctx.actor || 'Administrador',
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
      { key: 'statusId', label: 'Estado', control: 'status', group: 'Estado y responsable' },
      { key: 'assigneeId', label: 'Responsable', control: 'person', group: 'Estado y responsable' },
      { key: 'site', label: 'Sede', control: 'site', group: 'Ubicación' },
      { key: 'locationId', label: 'Ubicación', control: 'location', group: 'Ubicación' },
      { key: 'brand', label: 'Marca', control: 'text', group: 'Datos comunes' },
      { key: 'model', label: 'Modelo', control: 'text', group: 'Datos comunes' },
      { key: 'serial', label: 'Número de serie', control: 'text', group: 'Datos comunes' },
      { key: 'ip', label: 'Dirección IP', control: 'text', group: 'Datos comunes' },
      { key: 'cost', label: 'Coste', control: 'number', group: 'Datos comunes' }
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
          group: 'Campos técnicos',
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
    if (value === true) return 'Sí';
    if (value === false) return 'No';
    if (value === '' || value === undefined || value === null) return 'Sin valor';
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
        row.skipReason = 'Activo dado de baja: conserva su ficha pero no admite ediciones por lote.';
        return row;
      }
      const work = working.find(function (item) { return item.id === asset.id; });
      const has = function (key) { return keys.indexOf(key) !== -1; };

      // Sede y ubicación primero: el código rápido depende de la sede.
      const targetSiteId = has('site') ? values.site : asset.site;
      const targetSite = findById(ctx.sites, targetSiteId);
      if (has('site') && !targetSite) {
        row.warnings.push('La sede elegida no existe. Se omite el activo.');
        row.skipped = true;
        row.skipReason = 'Sede de destino inválida.';
        return row;
      }
      const siteChanged = !!targetSite && targetSite.id !== asset.site;
      if (siteChanged) {
        row.patch.site = targetSite.id;
        row.changes.push({ field: 'site', label: 'Sede', before: siteLabel(ctx.sites, asset.site), after: targetSite.label });
      }

      let targetLocationId = has('locationId') ? values.locationId : asset.locationId;
      let targetLocation = targetLocationId ? locationOf(ctx.sites, targetSiteId, targetLocationId) : null;
      if (has('locationId') && values.locationId && !targetLocation) {
        row.warnings.push('La ubicación elegida no pertenece a la sede de destino: no se aplica.');
        targetLocationId = asset.locationId;
        targetLocation = targetLocationId ? locationOf(ctx.sites, targetSiteId, targetLocationId) : null;
      }
      if (siteChanged && !has('locationId') && asset.locationId && !targetLocation) {
        targetLocationId = '';
        targetLocation = null;
        row.warnings.push('La ubicación anterior no existe en la sede destino: el activo queda sin ubicación.');
      }
      if (targetLocationId !== asset.locationId) {
        row.patch.locationId = targetLocation ? targetLocation.id : '';
        row.patch.location = targetLocation ? targetLocation.label : '';
        row.changes.push({
          field: 'locationId',
          label: 'Ubicación',
          before: asset.location || 'Sin ubicación',
          after: targetLocation ? targetLocation.label : 'Sin ubicación'
        });
      }

      if (siteChanged) {
        const nextCode = Schema.nextCode(working, asset.category, targetSite.id, ctx.admin, asset.id);
        if (nextCode && nextCode !== asset.code) {
          row.patch.code = nextCode;
          row.changes.push({ field: 'code', label: 'Código rápido', before: asset.code, after: nextCode });
          work.code = nextCode;
        }
        work.site = targetSite.id;
      }

      if (has('statusId')) {
        const status = statusOf(ctx.admin, values.statusId);
        if (!status) {
          row.warnings.push('El estado elegido no existe: no se aplica.');
        } else if (status.final) {
          row.warnings.push('El estado final no se aplica por lote: usa «Registrar baja».');
        } else if (status.id !== asset.statusId) {
          row.patch.statusId = status.id;
          row.patch.status = status.label;
          row.patch.statusTone = status.tone;
          row.changes.push({ field: 'statusId', label: 'Estado', before: asset.status, after: status.label });
        }
      }

      if (has('assigneeId')) {
        const personId = values.assigneeId || '';
        const person = personId ? personOf(ctx.people, personId) : null;
        if (personId && !person) {
          row.warnings.push('La persona elegida no existe: no se aplica.');
        } else if (person && !person.active) {
          row.warnings.push('La persona elegida está inactiva: no se aplica.');
        } else if ((person ? person.id : '') !== (asset.assigneeId || '')) {
          row.patch.assigneeId = person ? person.id : '';
          row.patch.assignee = person ? person.name : '';
          row.changes.push({
            field: 'assigneeId',
            label: 'Responsable',
            before: asset.assignee || 'Sin asignar',
            after: person ? person.name : 'Sin asignar'
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
          before: asset[key] || 'Sin valor',
          after: next || 'Sin valor'
        });
      });

      if (has('cost')) {
        const next = Schema.number(values.cost, 0);
        if (next !== Schema.number(asset.cost, 0)) {
          row.patch.cost = next;
          row.changes.push({
            field: 'cost',
            label: 'Coste',
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
          row.warnings.push('El campo «' + label + '» no aplica a la categoría de ' + asset.name + '.');
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
        row.skipReason = 'Sin cambios: los valores coinciden con la ficha.';
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
        'Edición masiva',
        'Campos actualizados: ' + row.changes.map(function (item) { return item.label; }).join(', ') + '.',
        {
          actor: ctx.actor || 'Administrador',
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
    const query = text(filters && filters.query, '').toLocaleLowerCase('es');
    const filter = filters && filters.filter ? filters.filter : 'all';
    const actor = filters && filters.actor ? filters.actor : 'all';
    const meta = Data.KIND_META[entry.kind] || null;
    const option = Data.HISTORY_FILTERS.find(function (item) { return item.id === filter; });
    if (option && option.kinds && option.kinds.indexOf(entry.kind) === -1) return false;
    if (actor !== 'all' && (entry.actor || 'Sistema') !== actor) return false;
    if (!query) return true;
    const haystack = [entry.title, entry.detail, entry.actor, meta ? meta.label : entry.kind]
      .concat((entry.changes || []).map(function (change) {
        return [change.label, change.before, change.after].join(' ');
      }))
      .join(' ')
      .toLocaleLowerCase('es');
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
      const name = entry.actor || 'Sistema';
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
