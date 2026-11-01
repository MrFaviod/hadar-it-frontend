(function () {
  'use strict';
  // Locale-aware collation comes from the i18n runtime; the Spanish literal is
  // the fallback for a module evaluated on its own.
  function compareText(left, right, options) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (runtime) return runtime.compare(left, right, options);
    return String(left).localeCompare(String(right), 'es', options || { sensitivity: 'base' });
  }

  const Store = window.AssetStore || {};
  const KEYS = Store.KEYS || {};
  const Data = window.AssetRelationsData || {};
  const Schema = window.AssetSchema || {};
  const HISTORY_LIMIT = (window.AssetOpsEngine && window.AssetOpsEngine.HISTORY_LIMIT) || 40;
  const RELATIONS_KEY = KEYS.relations || 'asset-manager.relations';
  const MAX_NOTE = 240;

  function nowIso() {
    return new Date().toISOString();
  }

  function actorOf(app) {
    const user = app && app.currentUser ? app.currentUser : null;
    return user && user.name ? user.name : 'Administrador';
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function assetList(app) {
    return Array.isArray(app && app.assets) ? app.assets : [];
  }

  function state(app) {
    if (!app) return { types: [], links: [], prefs: {} };
    if (!app.relations || typeof app.relations !== 'object') {
      app.relations = { types: [], links: [], prefs: {} };
    }
    if (!Array.isArray(app.relations.types)) app.relations.types = [];
    if (!Array.isArray(app.relations.links)) app.relations.links = [];
    if (!app.graphPrefs || typeof app.graphPrefs !== 'object') {
      app.graphPrefs = Store.normalizeGraphPrefs ? Store.normalizeGraphPrefs(app.relations.prefs) : {};
    }
    return app.relations;
  }

  function assetById(app, id) {
    return assetList(app).find(function (asset) { return asset.id === id; }) || null;
  }

  function typeById(app, id) {
    const types = state(app).types;
    return types.find(function (type) { return type.id === id; }) || null;
  }

  function typeLabel(type, outgoing) {
    if (!type) return 'Relación';
    if (!outgoing && type.inverse) return type.inverse;
    return type.label;
  }

  function familyOf(categoryId) {
    return Data.familyOf ? Data.familyOf(categoryId) : 'compute';
  }

  function linksOf(app, assetId) {
    return state(app).links.filter(function (link) {
      return link.from === assetId || link.to === assetId;
    });
  }

  function rowsFor(app, assetId) {
    const rows = linksOf(app, assetId).reduce(function (result, link) {
      const other = assetById(app, link.from === assetId ? link.to : link.from);
      const type = typeById(app, link.type);
      if (!other || !type) return result;
      const outgoing = link.from === assetId;
      result.push({
        id: link.id,
        link: link,
        type: type,
        other: other,
        outgoing: outgoing,
        label: typeLabel(type, outgoing),
        at: link.createdAt || ''
      });
      return result;
    }, []);
    return rows.sort(function (a, b) {
      const byLabel = compareText(a.label, b.label, { sensitivity: 'base' });
      if (byLabel) return byLabel;
      return compareText(a.other.name, b.other.name, { sensitivity: 'base' });
    });
  }

  function linkedIds(app) {
    const ids = new Set();
    state(app).links.forEach(function (link) {
      ids.add(link.from);
      ids.add(link.to);
    });
    return ids;
  }

  function counts(app) {
    const links = state(app).links.filter(function (link) {
      return assetById(app, link.from) && assetById(app, link.to);
    });
    const linked = new Set();
    links.forEach(function (link) {
      linked.add(link.from);
      linked.add(link.to);
    });
    const list = assetList(app);
    return {
      links: links.length,
      types: state(app).types.length,
      linkedAssets: linked.size,
      isolatedAssets: list.filter(function (asset) { return !linked.has(asset.id); }).length,
      assets: list.length
    };
  }

  function typeUsage(app, typeId) {
    return state(app).links.filter(function (link) { return link.type === typeId; }).length;
  }

  function matchesSearch(asset, query) {
    if (!query) return true;
    const needle = String(query).toLocaleLowerCase('es');
    return [asset.name, asset.code, asset.id, asset.ip, asset.brand, asset.model]
      .join(' ')
      .toLocaleLowerCase('es')
      .indexOf(needle) !== -1;
  }

  function filterAssets(app, filters) {
    const options = filters || {};
    const categories = Array.isArray(options.categories) ? options.categories : [];
    const sites = Array.isArray(options.sites) ? options.sites : [];
    const types = Array.isArray(options.types) ? options.types : [];
    const states = Array.isArray(options.states) ? options.states : [];
    const locations = Array.isArray(options.locations) ? options.locations : [];
    const linked = linkedIds(app);
    const typeIndex = {};
    state(app).links.forEach(function (link) {
      if (!typeIndex[link.type]) typeIndex[link.type] = new Set();
      typeIndex[link.type].add(link.from);
      typeIndex[link.type].add(link.to);
    });
    let allowed = null;
    if (types.length) {
      allowed = new Set();
      types.forEach(function (typeId) {
        const set = typeIndex[typeId];
        if (set) set.forEach(function (id) { allowed.add(id); });
      });
    }
    return assetList(app).filter(function (asset) {
      if (categories.length && categories.indexOf(asset.category) === -1) return false;
      if (sites.length && sites.indexOf(asset.site) === -1) return false;
      if (states.length && !states.includes(asset.statusId) && !states.includes(asset.status)) return false;
      if (locations.length && !locations.includes(asset.locationId)) return false;
      if (allowed && !allowed.has(asset.id)) return false;
      if (options.includeIsolated === false && !linked.has(asset.id)) return false;
      return matchesSearch(asset, options.search);
    });
  }

  function edgesWithin(app, nodeIds, filters) {
    const allowedTypes = filters && Array.isArray(filters.types) && filters.types.length
      ? new Set(filters.types)
      : null;
    return state(app).links.filter(function (link) {
      if (!nodeIds.has(link.from) || !nodeIds.has(link.to)) return false;
      if (allowedTypes && !allowedTypes.has(link.type)) return false;
      const type = typeById(app, link.type);
      return !!type;
    });
  }

  function graphData(app, filters) {
    const assets = filterAssets(app, filters);
    const nodeIds = new Set(assets.map(function (asset) { return asset.id; }));
    return {
      nodes: assets,
      edges: edgesWithin(app, nodeIds, filters).map(function (link) {
        return Object.assign({}, link, { relation: typeById(app, link.type) });
      })
    };
  }

  function focusData(app, focusId, depth, filters) {
    const limit = Math.min(3, Math.max(1, Number(depth) || 1));
    const origin = assetById(app, focusId);
    if (!origin) return { nodes: [], edges: [], levels: {} };
    const adjacency = {};
    state(app).links.forEach(function (link) {
      if (!assetById(app, link.from) || !assetById(app, link.to)) return;
      (adjacency[link.from] = adjacency[link.from] || []).push(link.to);
      (adjacency[link.to] = adjacency[link.to] || []).push(link.from);
    });
    const levels = {};
    levels[origin.id] = 0;
    let frontier = [origin.id];
    for (let step = 1; step <= limit; step += 1) {
      const next = [];
      frontier.forEach(function (id) {
        (adjacency[id] || []).forEach(function (neighbour) {
          if (levels[neighbour] !== undefined) return;
          levels[neighbour] = step;
          next.push(neighbour);
        });
      });
      if (!next.length) break;
      frontier = next;
    }
    const reachable = new Set(Object.keys(levels));
    const nodes = filterAssets(app, filters).filter(function (asset) {
      return reachable.has(asset.id);
    });
    const visible = new Set(nodes.map(function (asset) { return asset.id; }));
    return {
      nodes: nodes,
      edges: edgesWithin(app, visible, filters).map(function (link) {
        return Object.assign({}, link, { relation: typeById(app, link.type) });
      }),
      levels: levels
    };
  }

  function suggestTypes(app, asset) {
    const types = state(app).types.slice();
    if (!asset) return types;
    const used = new Set(rowsFor(app, asset.id).map(function (row) { return row.type.id; }));
    return types.sort(function (a, b) {
      const aUsed = used.has(a.id) ? 1 : 0;
      const bUsed = used.has(b.id) ? 1 : 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      return compareText(a.label, b.label, { sensitivity: 'base' });
    });
  }

  function candidates(app, sourceId, typeId) {
    const taken = new Set(
      state(app).links
        .filter(function (link) { return link.type === typeId; })
        .reduce(function (result, link) {
          if (link.from === sourceId) result.push(link.to);
          if (link.to === sourceId) result.push(link.from);
          return result;
        }, [])
    );
    return assetList(app)
      .filter(function (asset) {
        return asset.id !== sourceId && !asset.retired && !taken.has(asset.id);
      })
      .sort(function (a, b) {
        return compareText(a.name, b.name, { sensitivity: 'base' });
      });
  }

  function pushHistory(asset, entry) {
    if (!asset) return;
    asset.history = [entry].concat(Array.isArray(asset.history) ? asset.history : []).slice(0, HISTORY_LIMIT);
    asset.updatedAt = entry.recordedAt || entry.at;
  }

  function historyFor(app, asset, title, detail, other, counterpart) {
    if (!Schema.historyEntry) return null;
    const at = nowIso();
    return Schema.historyEntry('relation', title, detail, {
      actor: actorOf(app),
      changes: [{
        field: 'relations',
        label: 'Relación',
        before: counterpart ? counterpart.label : '—',
        after: other ? other.name + ' (' + other.code + ')' : '—'
      }],
      movement: 'relation',
      effectiveAt: at,
      recordedAt: at
    });
  }

  function validateDraft(app, sourceId, draft) {
    const errors = { type: '', target: '', general: '' };
    const source = assetById(app, sourceId);
    if (!source) {
      errors.general = 'El activo ya no está disponible.';
      return errors;
    }
    if (source.retired) {
      errors.general = 'Un activo dado de baja no admite vínculos nuevos.';
      return errors;
    }
    const type = typeById(app, draft && draft.typeId);
    if (!type) errors.type = 'Selecciona un tipo de relación.';
    const target = assetById(app, draft && draft.targetId);
    if (!draft || !draft.targetId) {
      errors.target = 'Selecciona el activo relacionado.';
    } else if (!target) {
      errors.target = 'El activo seleccionado ya no está disponible.';
    } else if (target.id === source.id) {
      errors.target = 'Un activo no puede relacionarse consigo mismo.';
    } else if (target.retired) {
      errors.target = 'No se puede vincular con un activo dado de baja.';
    } else if (type) {
      const duplicated = state(app).links.some(function (link) {
        if (link.type !== type.id) return false;
        return (link.from === source.id && link.to === target.id)
          || (link.from === target.id && link.to === source.id);
      });
      if (duplicated) {
        errors.target = 'Ya existe «' + type.label + '» con ' + target.name + '.';
      }
    }
    return errors;
  }

  function hasErrors(errors) {
    return !!(errors && (errors.type || errors.target || errors.general));
  }

  function persist(app) {
    const relations = state(app);
    relations.prefs = app.graphPrefs;
    return Store.writeJSON(window.localStorage, RELATIONS_KEY, {
      types: relations.types,
      links: relations.links,
      prefs: app.graphPrefs
    });
  }

  function createLink(app, sourceId, draft) {
    const errors = validateDraft(app, sourceId, draft);
    if (hasErrors(errors)) return { ok: false, errors: errors };
    const relations = state(app);
    const source = assetById(app, sourceId);
    const type = typeById(app, draft.typeId);
    const target = assetById(app, draft.targetId);
    const link = {
      id: 'rel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      from: source.id,
      to: target.id,
      type: type.id,
      note: typeof draft.note === 'string' ? draft.note.slice(0, MAX_NOTE) : '',
      createdAt: nowIso(),
      createdBy: actorOf(app)
    };
    relations.links = relations.links.concat([link]);
    pushHistory(source, historyFor(
      app, source, 'Relación creada',
      type.label + ' ' + target.name + ' (' + target.code + ').' + (link.note ? ' ' + link.note : ''),
      target, { label: 'Sin vínculo' }
    ));
    pushHistory(target, historyFor(
      app, target, 'Relación creada',
      typeLabel(type, false) + ' ' + source.name + ' (' + source.code + ').',
      source, { label: 'Sin vínculo' }
    ));
    persist(app);
    return { ok: true, link: link };
  }

  function removeLink(app, linkId) {
    const relations = state(app);
    const link = relations.links.find(function (item) { return item.id === linkId; });
    if (!link) return { ok: false, error: 'El vínculo ya no existe.' };
    const source = assetById(app, link.from);
    const target = assetById(app, link.to);
    const type = typeById(app, link.type);
    relations.links = relations.links.filter(function (item) { return item.id !== linkId; });
    if (source && target && type) {
      pushHistory(source, historyFor(
        app, source, 'Relación eliminada',
        type.label + ' ' + target.name + ' (' + target.code + ') desvinculado.',
        target, { label: 'Vínculo' }
      ));
      pushHistory(target, historyFor(
        app, target, 'Relación eliminada',
        typeLabel(type, false) + ' ' + source.name + ' (' + source.code + ') desvinculado.',
        source, { label: 'Vínculo' }
      ));
    }
    persist(app);
    return { ok: true };
  }

  function slugify(value) {
    if (Store.slugify) return Store.slugify(value, 'tipo');
    return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  }

  function saveType(app, draft) {
    // `hasErrors` below only knows about the link draft fields, so the type
    // form checks its own label error explicitly.
    const errors = { label: '', inverse: '', general: '' };
    const label = text(draft && draft.label, '');
    if (!label) errors.label = 'Escribe la etiqueta del tipo.';
    const types = state(app).types;
    const editingId = draft && draft.id;
    const tones = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
    const icons = ['network', 'layers', 'building', 'battery', 'activity', 'refresh', 'box', 'server', 'package'];
    if (editingId) {
      const index = types.findIndex(function (type) { return type.id === editingId; });
      if (index === -1) {
        errors.general = 'El tipo de relación ya no existe.';
        return { ok: false, errors: errors };
      }
      if (errors.label || errors.general) return { ok: false, errors: errors };
      const inverse = text(draft.inverse, label);
      const updated = Object.assign({}, types[index], {
        label: label,
        inverse: inverse,
        directed: draft.directed !== false,
        icon: icons.indexOf(draft.icon) !== -1 ? draft.icon : types[index].icon,
        tone: tones.indexOf(draft.tone) !== -1 ? draft.tone : types[index].tone,
        description: text(draft.description, '')
      });
      types[index] = updated;
      app.relations.types = types.slice();
      persist(app);
      return { ok: true, type: updated };
    }
    if (errors.label || errors.general) return { ok: false, errors: errors };
    let id = slugify(label);
    let counter = 2;
    while (types.some(function (type) { return type.id === id; })) {
      id = slugify(label) + '-' + counter;
      counter += 1;
    }
    const created = {
      id: id,
      label: label,
      inverse: text(draft.inverse, label),
      directed: draft.directed !== false,
      icon: icons.indexOf(draft.icon) !== -1 ? draft.icon : 'network',
      tone: tones.indexOf(draft.tone) !== -1 ? draft.tone : 'network',
      description: text(draft.description, '')
    };
    app.relations.types = types.concat([created]);
    persist(app);
    return { ok: true, type: created };
  }

  function removeType(app, typeId) {
    const usage = typeUsage(app, typeId);
    if (usage) {
      return {
        ok: false,
        error: 'El tipo tiene ' + usage + (usage === 1 ? ' vínculo activo' : ' vínculos activos') + '. Elimínalos antes de borrar el tipo.'
      };
    }
    app.relations.types = state(app).types.filter(function (type) { return type.id !== typeId; });
    persist(app);
    return { ok: true };
  }

  function restoreTypes(app) {
    const defaults = (Data.DEFAULT_TYPES || []).map(function (type) { return Object.assign({}, type); });
    const defaultIds = new Set(defaults.map(function (type) { return type.id; }));
    const custom = state(app).types.filter(function (type) { return !defaultIds.has(type.id); });
    const types = defaults.concat(custom);
    const validTypes = new Set(types.map(function (type) { return type.id; }));
    const removedLinks = state(app).links.filter(function (link) { return !validTypes.has(link.type); }).length;
    app.relations.types = types;
    app.relations.links = state(app).links.filter(function (link) { return validTypes.has(link.type); });
    persist(app);
    return { ok: true, types: types.length, removedLinks: removedLinks };
  }

  function updatePrefs(app, patch) {
    const merged = Object.assign({}, app.graphPrefs, patch);
    app.graphPrefs = Store.normalizeGraphPrefs ? Store.normalizeGraphPrefs(merged) : merged;
    persist(app);
    return app.graphPrefs;
  }

  function savePrefs(app, prefs) {
    return updatePrefs(app, prefs || {});
  }

  window.AssetRelations = {
    MAX_NOTE: MAX_NOTE,
    assetById: assetById,
    typeById: typeById,
    typeLabel: typeLabel,
    familyOf: familyOf,
    linksOf: linksOf,
    rowsFor: rowsFor,
    counts: counts,
    typeUsage: typeUsage,
    filterAssets: filterAssets,
    graphData: graphData,
    focusData: focusData,
    suggestTypes: suggestTypes,
    candidates: candidates,
    validateDraft: validateDraft,
    createLink: createLink,
    removeLink: removeLink,
    saveType: saveType,
    removeType: removeType,
    restoreTypes: restoreTypes,
    updatePrefs: updatePrefs,
    savePrefs: savePrefs,
    persist: persist
  };
})();
