/* Motor de importación y exportación — análisis, coincidencias y aplicación. */
(function () {
  'use strict';

  const Data = window.AssetTransferData;
  const Schema = window.AssetSchema;

  // Display copy comes from the ui.transfer.* catalog; ids, states and field
  // keys stay stable. Non-template messages (validation, previews, report CSV)
  // resolve through the same runtime.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const COMPARE_FIELDS = [
    { key: 'name', get label() { return tr('ui.transfer.field.name'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'category', get label() { return tr('ui.transfer.field.category'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'brand', get label() { return tr('ui.transfer.field.brand'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'model', get label() { return tr('ui.transfer.field.model'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'serial', get label() { return tr('ui.transfer.field.serial'); }, get group() { return tr('ui.transfer.group.identification'); } },
    { key: 'ip', get label() { return tr('ui.transfer.field.ip'); }, get group() { return tr('ui.transfer.group.network'); } },
    { key: 'site', get label() { return tr('ui.transfer.field.site'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'location', get label() { return tr('ui.transfer.field.location'); }, get group() { return tr('ui.transfer.group.location'); } },
    { key: 'assignee', get label() { return tr('ui.transfer.field.assignee'); }, get group() { return tr('ui.transfer.group.assignment'); } },
    { key: 'cost', get label() { return tr('ui.transfer.field.cost'); }, get group() { return tr('ui.transfer.group.financial'); } },
    { key: 'warrantyUntil', get label() { return tr('ui.transfer.field.warranty_until'); }, get group() { return tr('ui.transfer.group.warranty'); } }
  ];

  const STATE_LABELS = {
    get new() { return tr('ui.transfer.state.new'); },
    get update() { return tr('ui.transfer.state.update'); },
    get conflict() { return tr('ui.transfer.state.conflict'); },
    get duplicate() { return tr('ui.transfer.state.duplicate'); },
    get retired() { return tr('ui.transfer.state.retired'); },
    get incomplete() { return tr('ui.transfer.state.incomplete'); },
    get unchanged() { return tr('ui.transfer.state.unchanged'); },
    get error() { return tr('ui.transfer.state.error'); }
  };

  const STATE_TONES = {
    new: 'ok',
    update: 'info',
    conflict: 'warn',
    duplicate: 'hold',
    retired: 'down',
    incomplete: 'warn',
    unchanged: 'hold',
    error: 'down'
  };

  function personLabel(app, asset) {
    if (!asset) return '';
    if (asset.assigneeId) {
      const person = (app.people || []).find((item) => item.id === asset.assigneeId);
      if (person) return person.name;
    }
    return asset.assignee || '';
  }

  function categoryLabel(app, id) {
    return typeof app.categoryLabel === 'function' ? app.categoryLabel(id) : id;
  }

  function siteLabel(app, id) {
    return typeof app.siteLabel === 'function' ? app.siteLabel(id) : id;
  }

  function categoryImage(app, id) {
    const category = (app.categories || []).find((item) => item.id === id);
    return category ? category.image : 'assets/svg/devices/other.svg';
  }

  function statusFor(admin, hasAssignee) {
    const target = Schema.statusById(admin, hasAssignee ? 'asignado' : 'resguardo')
      || (admin.statuses && admin.statuses[0])
      || { id: 'asignado', get label() { return tr('ui.transfer.status.assigned'); }, tone: 'ok' };
    return target;
  }

  function emptyRow(key) {
    return {
      key,
      sheetKey: '',
      sheetName: '',
      rowNumber: 0,
      fileId: '',
      fileName: '',
      raw: [],
      data: {},
      mappedKeys: [],
      state: 'new',
      reasons: [],
      errors: [],
      warnings: [],
      candidates: [],
      primaryCandidateId: '',
      comparison: [],
      changes: [],
      defaultAction: 'create',
      matchedByName: false,
      duplicateOf: ''
    };
  }

  function buildComparison(app, existing, raw, display, data, categorySource, siteId) {
    return COMPARE_FIELDS.map((field) => {
      let current = '';
      if (existing) {
        if (field.key === 'category') current = categoryLabel(app, existing.category);
        else if (field.key === 'site') current = siteLabel(app, existing.site);
        else if (field.key === 'location') current = existing.location;
        else if (field.key === 'assignee') current = personLabel(app, existing);
        else if (field.key === 'cost') current = Data.formatNumber(existing.cost);
        else if (field.key === 'warrantyUntil') current = existing.warranty ? Data.formatDate(existing.warranty.until) : '';
        else current = existing[field.key] || '';
      }
      const imported = display[field.key] || '';
      const filled = !!raw[field.key]
        || (field.key === 'category' && !!categorySource)
        || (field.key === 'site' && !!raw.site)
        || (field.key === 'location' && !!raw.location);
      return {
        key: field.key,
        label: field.label,
        group: field.group,
        current: current,
        imported: imported,
        filled: filled,
        changed: filled && Data.norm(imported) !== Data.norm(current) && imported !== '',
        empty: filled && imported === ''
      };
    });
  }

  /* Análisis -------------------------------------------------------------- */

  function analyze(app, wizard) {
    const file = Data.FILES.find((item) => item.id === wizard.fileId) || null;
    if (!file) return { rows: [], sheets: [], file: null };

    const assets = app.assets || [];
    const people = app.people || [];
    const sites = app.sites || [];
    const selectedSheets = file.sheets.filter((sheet) => wizard.sheets[sheet.id]);
    const identification = Array.isArray(wizard.identification) ? wizard.identification : ['serial', 'ip', 'name'];
    const rows = [];

    selectedSheets.forEach((sheet) => {
      const mapping = wizard.mapping[sheet.id] || [];
      const sheetSite = wizard.sheetSite[sheet.id] || sheet.siteId || '';
      const sheetCategory = wizard.sheetCategory[sheet.id] || '';
      sheet.rows.forEach((rawRow, index) => {
        const rowKey = sheet.id + '-' + (index + 1);
        const row = emptyRow(rowKey);
        row.fileId = file.id;
        row.fileName = file.name;
        row.sheetKey = sheet.id;
        row.sheetName = sheet.name;
        row.rowNumber = index + 1;
        row.raw = rawRow;
        row.mappedKeys = mapping.filter(Boolean);

        const raw = {};
        mapping.forEach((key, columnIndex) => {
          if (!key) return;
          const value = String(rawRow[columnIndex] == null ? '' : rawRow[columnIndex]).trim();
          raw[key] = value;
        });
        row.rawMap = raw;

        const data = {};
        const display = {};

        // Nombre
        if (raw.name) {
          data.name = raw.name;
          display.name = raw.name;
        } else {
          row.errors.push(tr('ui.transfer.analysis.name_missing'));
        }

        // Tipo
        if (raw.type) {
          data.type = raw.type;
          display.type = raw.type;
        }

        // Marca y modelo
        ['brand', 'model'].forEach((key) => {
          if (raw[key]) {
            data[key] = raw[key];
            display[key] = raw[key];
          }
        });

        // Serie
        if (raw.serial) {
          data.serial = raw.serial;
          display.serial = raw.serial;
        }

        // IP
        if (raw.ip) {
          if (!Data.isValidIp(raw.ip)) {
            row.errors.push(tr('ui.transfer.analysis.ip_invalid', { value: raw.ip }));
          } else {
            data.ip = raw.ip;
            display.ip = raw.ip;
          }
        }

        if (raw.mac) data.mac = raw.mac;

        // Categoría
        const categorySource = raw.category || raw.type || sheetCategory || '';
        const categoryId = Data.categoryIdFromText(categorySource) || sheetCategory || Data.categoryIdFromText('otros');
        if (categoryId) {
          data.category = categoryId;
          display.category = categoryLabel(app, categoryId);
        }

        // Sede
        const siteFromRow = raw.site ? Data.siteIdFromText(raw.site) : '';
        if (raw.site && !siteFromRow) {
          row.errors.push(tr('ui.transfer.analysis.site_unknown', { value: raw.site }));
        }
        const siteId = siteFromRow || sheetSite || '';
        if (siteId) {
          data.site = siteId;
          display.site = siteLabel(app, siteId);
        } else {
          row.errors.push(tr('ui.transfer.analysis.site_undetermined'));
        }

        // Ubicación
        if (raw.location) {
          const site = sites.find((item) => item.id === siteId);
          const location = site && Array.isArray(site.locations)
            ? site.locations.find((item) => Data.norm(item.label) === Data.norm(raw.location) || item.id === Data.norm(raw.location))
            : null;
          if (location) {
            data.locationId = location.id;
            data.location = location.label;
            display.location = location.label;
          } else {
            row.warnings.push(tr('ui.transfer.analysis.location_outside_site', { value: raw.location, site: site ? site.label : tr('ui.transfer.analysis.the_site') }));
          }
        }

        // Responsable
        if (raw.assignee) {
          const person = people.find((item) => Data.norm(item.name) === Data.norm(raw.assignee));
          if (person) {
            data.assigneeId = person.id;
            data.assignee = person.name;
          } else {
            data.assignee = raw.assignee;
          }
          display.assignee = raw.assignee;
        }

        // Coste
        if (raw.cost) {
          const cost = Data.parseNumber(raw.cost);
          if (Number.isNaN(cost)) {
            row.errors.push(tr('ui.transfer.analysis.cost_invalid', { value: raw.cost }));
          } else {
            data.cost = cost;
            display.cost = Data.formatNumber(cost);
          }
        }

        // Garantía
        if (raw.warrantyUntil) {
          const until = Data.parseDate(raw.warrantyUntil);
          if (until === 'invalid') {
            row.errors.push(tr('ui.transfer.analysis.warranty_date_invalid', { value: raw.warrantyUntil }));
          } else {
            data.warrantyUntil = until;
            display.warrantyUntil = Data.formatDate(until);
          }
        }
        if (raw.warrantyProvider) {
          data.warrantyProvider = raw.warrantyProvider;
          display.warrantyProvider = raw.warrantyProvider;
        }

        // Campos técnicos y de acceso remoto
        ['os', 'cpu', 'ram'].forEach((key) => {
          if (raw[key]) {
            data['tech.' + key] = raw[key];
            display[key] = raw[key];
          }
        });
        ['anydeskId', 'rmmAgentId'].forEach((key) => {
          if (raw[key]) {
            data[key] = raw[key];
            display[key] = raw[key];
          }
        });

        row.data = data;
        row.display = display;

        // Coincidencias
        const strong = [];
        const strongSources = {};
        if (data.serial && identification.indexOf('serial') !== -1) {
          assets.filter((asset) => asset.serial && Data.norm(asset.serial) === Data.norm(data.serial))
            .forEach((asset) => {
              if (strong.indexOf(asset.id) === -1) strong.push(asset.id);
              strongSources[asset.id] = 'serie';
            });
        }
        if (data.ip && identification.indexOf('ip') !== -1) {
          assets.filter((asset) => asset.ip && Data.norm(asset.ip) === Data.norm(data.ip))
            .forEach((asset) => {
              if (strong.indexOf(asset.id) === -1) strong.push(asset.id);
              strongSources[asset.id] = strongSources[asset.id] || 'IP';
            });
        }
        const weak = data.name && identification.indexOf('name') !== -1
          ? assets.filter((asset) => Data.norm(asset.name) === Data.norm(data.name) && strong.indexOf(asset.id) === -1).map((asset) => asset.id)
          : [];

        const candidates = strong.slice();
        weak.forEach((id) => {
          if (candidates.indexOf(id) === -1) candidates.push(id);
        });
        row.candidates = candidates;

        const reasons = [];
        let primary = '';
        if (strong.length > 1) {
          reasons.push(tr('ui.transfer.conflict.serial_and_ip'));
          primary = strong[0];
        } else if (strong.length === 1 && weak.length) {
          reasons.push(tr('ui.transfer.conflict.strong_and_name', { strong: strong[0], weak: weak[0] }));
          primary = strong[0];
        } else if (strong.length === 1) {
          primary = strong[0];
        } else if (weak.length === 1) {
          reasons.push(tr('ui.transfer.conflict.name_only'));
          primary = weak[0];
          row.matchedByName = true;
        } else if (weak.length > 1) {
          reasons.push(tr('ui.transfer.conflict.name_multiple', { count: weak.length }));
          primary = weak[0];
        }

        row.strongCandidates = strong;
        row.weakCandidates = weak;
        row.primaryCandidateId = primary || '';
        row.reasons = reasons;
        row.candidates = candidates;

        const primaryAsset = assets.find((asset) => asset.id === primary) || null;
        if (primaryAsset && primaryAsset.retired) {
          row.isRetired = true;
          row.warnings.push(tr('ui.transfer.analysis.retired_match', { id: primaryAsset.id }));
        }
        if (!primaryAsset) {
          if (mapping.indexOf('assignee') !== -1 && !raw.assignee) {
            row.warnings.push(tr('ui.transfer.analysis.no_assignee'));
          }
          if (!data.serial && !data.ip) {
            row.warnings.push(tr('ui.transfer.analysis.no_serial_ip'));
          }
        }

        row.siteExplicit = !!raw.site;
        row.locationExplicit = !!raw.location;
        row.comparisons = {};
        candidates.forEach((candidateId) => {
          const candidate = assets.find((asset) => asset.id === candidateId);
          if (candidate) {
            row.comparisons[candidateId] = buildComparison(app, candidate, raw, display, data, categorySource, siteId);
          }
        });
        row.comparison = primaryAsset
          ? row.comparisons[primaryAsset.id]
          : buildComparison(app, null, raw, display, data, categorySource, siteId);
        row.changes = row.comparison.filter((field) => field.changed);

        // Estados
        if (row.errors.length) {
          row.state = 'error';
        } else if (row.isRetired) {
          row.state = 'retired';
        } else if (reasons.length) {
          row.state = 'conflict';
        } else if (primaryAsset) {
          row.state = row.changes.length ? 'update' : 'unchanged';
          if (!row.changes.length) row.warnings.push(tr('ui.transfer.analysis.no_new_values'));
        } else {
          row.state = row.warnings.length ? 'incomplete' : 'new';
        }

        if (row.state === 'incomplete' && wizard.rules && wizard.rules.flagIncomplete === false) {
          row.state = 'new';
        }

        // Decisiones por defecto
        if (row.state === 'error' || row.state === 'retired') row.defaultAction = 'review';
        else if (row.state === 'conflict') row.defaultAction = '';
        else if (row.state === 'incomplete') row.defaultAction = 'review';
        else if (row.state === 'update') row.defaultAction = 'update';
        else if (row.state === 'unchanged') row.defaultAction = 'skip';
        else row.defaultAction = 'create';

        rows.push(row);
      });
    });

    // Duplicados por número de serie dentro del mismo lote
    const seen = {};
    rows.forEach((row) => {
      const serial = row.data.serial ? Data.norm(row.data.serial) : '';
      if (!serial) return;
      if (!seen[serial]) {
        seen[serial] = row;
        return;
      }
      const first = seen[serial];
      row.duplicateOf = tr('ui.transfer.source_row', { sheet: first.sheetName, row: first.rowNumber });
      row.warnings.push(tr('ui.transfer.analysis.duplicate_serial', { serial: row.data.serial, where: row.duplicateOf }));
      if (row.state !== 'error' && row.state !== 'retired') {
        row.state = 'duplicate';
        row.defaultAction = 'skip';
      }
    });

    return { rows, sheets: selectedSheets, file, identification };
  }

  /* Decisiones ------------------------------------------------------------ */

  function decisionFor(row, decisions) {
    const stored = decisions && decisions[row.key] ? decisions[row.key] : null;
    let action = stored && stored.action !== undefined && stored.action !== null ? stored.action : row.defaultAction;
    let targetId = stored && stored.targetId ? stored.targetId : '';
    if (action === 'update') {
      targetId = targetId || row.primaryCandidateId;
      if (!targetId && row.candidates.length === 1) targetId = row.candidates[0];
      if (!targetId) action = '';
    }
    return { action: action || '', targetId };
  }

  function comparisonFor(row, targetId) {
    if (row.comparisons && targetId && row.comparisons[targetId]) return row.comparisons[targetId];
    return row.comparison || [];
  }

  function changesFor(row, targetId) {
    return comparisonFor(row, targetId).filter((field) => field.changed);
  }

  function actionsFor(row) {
    if (row.state === 'error') return ['review', 'skip'];
    if (row.state === 'retired') return ['skip', 'create', 'review'];
    if (row.state === 'duplicate') return ['skip', 'create', 'review'];
    if (row.state === 'conflict') return ['update', 'create', 'skip', 'review'];
    if (row.state === 'incomplete') return ['create', 'review', 'skip'];
    if (row.state === 'unchanged') return ['skip', 'review'];
    if (row.state === 'update') return ['update', 'skip', 'create', 'review'];
    return ['create', 'review', 'skip'];
  }

  function counts(rows, decisions) {
    const result = { total: rows.length, created: 0, updated: 0, skipped: 0, pending: 0, conflicts: 0, errors: 0 };
    rows.forEach((row) => {
      const decision = decisionFor(row, decisions);
      if (row.state === 'error') result.errors += 1;
      if (row.state === 'conflict' && !decision.action) result.conflicts += 1;
      if (decision.action === 'create') result.created += 1;
      else if (decision.action === 'update') {
        if (changesFor(row, decision.targetId).length) result.updated += 1;
        else result.skipped += 1;
      } else if (decision.action === 'skip') result.skipped += 1;
      else result.pending += 1;
    });
    return result;
  }

  /* Aplicación ------------------------------------------------------------ */

  function batch() {
    return { created: [], updated: [], skipped: [], pending: [] };
  }

  function findAsset(app, id) {
    return (app.assets || []).find((asset) => asset.id === id) || null;
  }

  function buildWarranty(row) {
    if (!row.data.warrantyUntil && !row.data.warrantyProvider) return null;
    return {
      until: row.data.warrantyUntil || '',
      provider: row.data.warrantyProvider || '',
      note: ''
    };
  }

  function applyValues(app, asset, row, isCreate) {
    const data = row.data;
    if (data.name) asset.name = data.name;
    if (data.type) asset.type = data.type;
    if (data.category) asset.category = data.category;
    if (data.brand) asset.brand = data.brand;
    if (data.model) asset.model = data.model;
    if (data.serial) asset.serial = data.serial;
    if (data.ip) asset.ip = data.ip;
    if (data.site && (isCreate || row.siteExplicit)) asset.site = data.site;
    if (data.locationId && (isCreate || row.locationExplicit)) {
      asset.locationId = data.locationId;
      asset.location = data.location || '';
    }
    if (data.assigneeId) {
      asset.assigneeId = data.assigneeId;
      asset.assignee = data.assignee || '';
    } else if (data.assignee) {
      asset.assignee = data.assignee;
    }
    if (typeof data.cost === 'number') asset.cost = data.cost;
    if (data.anydeskId) asset.anydeskId = data.anydeskId;
    if (data.rmmAgentId) {
      asset.rmmAgentId = data.rmmAgentId;
      asset.rmmOnline = true;
    }
    const tech = Object.assign({}, asset.tech || {});
    ['os', 'cpu', 'ram', 'mac'].forEach((key) => {
      if (data['tech.' + key]) tech[key] = data['tech.' + key];
    });
    asset.tech = tech;
    if (data.warrantyUntil || data.warrantyProvider) asset.warranty = buildWarranty(row);
    if (data.category) asset.image = categoryImage(app, data.category);
  }

  function createAsset(app, row) {
    const category = row.data.category || (app.categories[0] ? app.categories[0].id : 'otros');
    const site = row.data.site || '';
    const person = row.data.assigneeId
      ? (app.people || []).find((item) => item.id === row.data.assigneeId)
      : null;
    const status = statusFor(app.assetAdmin, !!(person || row.data.assignee));
    const id = Schema.nextPermanentId(app.assets, app.assetAdmin);
    const code = typeof app.assetNextCode === 'function' ? app.assetNextCode(category, site, '') : '';
    const now = new Date().toISOString();
    const form = typeof Schema.formFor === 'function' ? Schema.formFor(app.assetAdmin, category) : { get type() { return tr('ui.transfer.default_type'); } };
    const asset = Object.assign(Schema.newAsset(app.assetAdmin, app.categories), {
      id,
      code,
      name: row.data.name,
      type: row.data.type || form.type || 'Equipo',
      category,
      brand: row.data.brand || '',
      model: row.data.model || '',
      serial: row.data.serial || '',
      ip: row.data.ip || '',
      site,
      locationId: row.data.locationId || '',
      location: row.data.location || '',
      assigneeId: person ? person.id : '',
      assignee: person ? person.name : (row.data.assignee || ''),
      cost: typeof row.data.cost === 'number' ? row.data.cost : 0,
      statusId: status.id,
      status: status.label,
      statusTone: status.tone,
      image: categoryImage(app, category),
      hasOwnImage: false,
      fovImage: '',
      tech: {
        ...(row.data['tech.os'] ? { os: row.data['tech.os'] } : {}),
        ...(row.data['tech.cpu'] ? { cpu: row.data['tech.cpu'] } : {}),
        ...(row.data['tech.ram'] ? { ram: row.data['tech.ram'] } : {}),
        ...(row.data['tech.mac'] ? { mac: row.data['tech.mac'] } : {})
      },
      warranty: buildWarranty(row),
      retired: null,
      createdAt: now,
      updatedAt: now,
      history: [Schema.historyEntry('created', tr('ui.transfer.history.created'), row.fileName + ' · ' + tr('ui.transfer.source_row', { sheet: row.sheetName, row: row.rowNumber }))],
      anydeskId: row.data.anydeskId || '',
      rmmAgentId: row.data.rmmAgentId || '',
      rmmOnline: !!row.data.rmmAgentId
    });
    app.assets.unshift(asset);
    if (app.assetAdmin) {
      app.assetAdmin.sequence = Schema.number(id.replace(/\D/g, ''), app.assetAdmin.sequence);
    }
    return asset;
  }

  function applyRow(app, row, decision, target) {
    const result = target || batch();
    if (!decision || !decision.action) {
      result.pending.push({ row, reason: tr('ui.transfer.pending.no_decision') });
      return result;
    }
    if (decision.action === 'review') {
      result.pending.push({ row, reason: row.state === 'error' ? tr('ui.transfer.pending.errors') : tr('ui.transfer.pending.review') });
      return result;
    }
    if (decision.action === 'skip') {
      result.skipped.push({ row, reason: tr('ui.transfer.pending.skipped') });
      return result;
    }
    if (decision.action === 'update') {
      const asset = findAsset(app, decision.targetId || row.primaryCandidateId);
      if (!asset) {
        result.pending.push({ row, reason: tr('ui.transfer.pending.asset_missing') });
        return result;
      }
      const changed = changesFor(row, asset.id);
      if (!changed.length) {
        result.skipped.push({ row, reason: tr('ui.transfer.pending.unchanged') });
        return result;
      }
      const labels = changed.map((change) => change.label);
      applyValues(app, asset, row, false);
      asset.updatedAt = new Date().toISOString();
      asset.history = Array.isArray(asset.history) ? asset.history : [];
      asset.history.unshift(Schema.historyEntry(
        'updated',
        tr('ui.transfer.history.updated'),
        (labels.length ? tr('ui.transfer.history.fields', { fields: labels.join(', ') }) + ' ' : '') + row.fileName + ' · ' + tr('ui.transfer.source_row', { sheet: row.sheetName, row: row.rowNumber })
      ));
      result.updated.push({ row, assetId: asset.id, fields: labels, name: asset.name });
      return result;
    }
    // create
    const asset = createAsset(app, row);
    result.created.push({ row, assetId: asset.id, name: asset.name });
    return result;
  }

  function persist(app) {
    if (!app) return;
    if (typeof app.persistAssets === 'function') app.persistAssets();
    if (typeof app.persistAssignments === 'function') app.persistAssignments();
    if (typeof app.persistAssetAdmin === 'function') app.persistAssetAdmin();
  }

  function finish(app, result, context) {
    persist(app);
    const countsResult = {
      created: result.created.length,
      updated: result.updated.length,
      skipped: result.skipped.length,
      pending: result.pending.length
    };
    if (context && context.record) {
      Data.addHistory({
        at: new Date().toISOString(),
        fileName: context.fileName || '',
        fileId: context.fileId || '',
        profile: context.profile || '',
        sheets: context.sheets || 0,
        counts: countsResult
      });
    }
    return countsResult;
  }

  /* Exportación ----------------------------------------------------------- */

  function exportValue(app, asset, key) {
    if (key === 'category') return categoryLabel(app, asset.category);
    if (key === 'site') return siteLabel(app, asset.site);
    if (key === 'location') return asset.location || '';
    if (key === 'assignee') return personLabel(app, asset);
    if (key === 'status') return asset.status || '';
    if (key === 'cost') return asset.cost == null || asset.cost === '' ? '' : Number(asset.cost);
    if (key === 'warrantyUntil') return asset.warranty && asset.warranty.until ? Data.formatDate(asset.warranty.until) : '';
    if (key === 'warrantyProvider') return asset.warranty ? asset.warranty.provider || '' : '';
    if (key === 'mac' || key === 'os' || key === 'cpu' || key === 'ram') {
      return asset.tech && asset.tech[key] ? asset.tech[key] : '';
    }
    if (key === 'updatedAt') return asset.updatedAt ? Data.formatDateTime(asset.updatedAt) : '';
    return asset[key] == null ? '' : String(asset[key]);
  }

  function buildExport(app, options) {
    const assets = Array.isArray(options.assets) ? options.assets : [];
    let fields = (options.fields || []).filter((key) => Data.EXPORT_FIELDS.some((field) => field.key === key));
    const separator = options.separator || ';';
    let tableRows = assets.map((asset) => fields.map((key) => exportValue(app, asset, key)));

    if (!options.includeEmpty && fields.length) {
      const keep = fields.map((key, index) => tableRows.some((row) => String(row[index] || '').trim() !== ''));
      fields = fields.filter((key, index) => keep[index]);
      tableRows = tableRows.map((row) => row.filter((cell, index) => keep[index]));
    }

    const labels = fields.map((key) => {
      const field = Data.EXPORT_FIELDS.find((item) => item.key === key);
      return field ? field.label : key;
    });
    const header = options.headerRow === false ? [] : labels;
    const csv = Data.toCsv(header, tableRows, separator);
    const bom = options.bom ? '\ufeff' : '';
    const content = bom + csv;
    const profile = Data.profileById(options.profileId);
    const date = new Date().toISOString().slice(0, 10);
    // The file name is derived from the stable profile id, never from the
    // localized display name.
    const base = Data.slug(profile ? profile.id : 'inventario');
    return {
      fields,
      labels,
      rows: tableRows,
      csv: content,
      text: csv,
      fileName: base + '-' + date + (options.format === 'xlsx' ? '.xlsx' : '.csv'),
      size: new Blob([content]).size,
      format: options.format === 'xlsx' ? 'xlsx' : 'csv'
    };
  }

  // The report is a document: its header and state words follow the locale of
  // the user who downloads it.
  function reportCsv(result, extra) {
    const header = [
      tr('ui.transfer.report.status'), tr('ui.transfer.report.row'), tr('ui.transfer.report.sheet'),
      tr('ui.transfer.report.asset'), tr('ui.transfer.report.result_id'), tr('ui.transfer.report.fields')
    ];
    const rows = [];
    result.created.forEach((item) => rows.push([tr('ui.transfer.report.created'), item.row.rowNumber, item.row.sheetName, item.name, item.assetId, item.row.display.name || '']));
    result.updated.forEach((item) => rows.push([tr('ui.transfer.report.updated'), item.row.rowNumber, item.row.sheetName, item.name, item.assetId, item.fields.join(', ')]));
    result.skipped.forEach((item) => rows.push([tr('ui.transfer.report.skipped'), item.row.rowNumber, item.row.sheetName, item.row.display.name || '', '', tr('ui.transfer.report.skipped_review')]));
    result.pending.forEach((item) => rows.push([tr('ui.transfer.report.pending'), item.row.rowNumber, item.row.sheetName, item.row.display.name || '', '', item.reason]));
    const meta = extra ? [extra, ''] : [];
    return Data.toCsv(header, meta.concat(rows), ';');
  }

  window.AssetTransferEngine = {
    COMPARE_FIELDS,
    STATE_LABELS,
    STATE_TONES,
    analyze,
    counts,
    decisionFor,
    comparisonFor,
    changesFor,
    actionsFor,
    batch,
    applyRow,
    finish,
    persist,
    buildExport,
    reportCsv,
    exportValue
  };
})();
