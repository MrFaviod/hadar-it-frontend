(function () {
  'use strict';

  const DATA = window.ASSET_DATA;
  const KEYS = {
    session: 'asset-manager.session',
    prefs: 'asset-manager.prefs',
    settings: 'asset-manager.settings',
    config: 'asset-manager.config',
    overrides: 'asset-manager.overrides',
    people: 'asset-manager.people',
    assignments: 'asset-manager.assignments',
    assets: 'asset-manager.assets',
    assetAdmin: 'asset-manager.asset-admin',
    transfer: 'asset-manager.transfer',
    relations: 'asset-manager.relations',
    maps: 'asset-manager.maps',
    maintenance: 'asset-manager.maintenance',
    monitoring: 'asset-manager.monitoring',
    seedAssets: 'asset-manager.seed-assets'
  };

  function readJSON(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStored(storage, key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      /* Sin persistencia, la sesión sigue activa en memoria. */
    }
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function slugify(value, fallback) {
    const source = text(value, fallback || 'item')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return source || fallback || 'item';
  }

  function uniqueId(base, used) {
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = base + '-' + suffix;
      suffix += 1;
    }
    used.add(id);
    return id;
  }

  function normalizeCategories(value) {
    const list = Array.isArray(value) ? value : DATA.categories;
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label, '');
      if (!label) return result;
      const id = uniqueId(slugify(item.id || item.slug || label, 'categoria'), used);
      result.push({
        id,
        label,
        slug: id,
        icon: text(item.icon, 'package'),
        image: text(item.image, 'assets/svg/devices/other.svg'),
        description: text(item.description, '')
      });
      return result;
    }, []);
  }

  function normalizeLocations(value) {
    const list = Array.isArray(value) ? value : [];
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label, '');
      if (!label) return result;
      const id = uniqueId(slugify(item.id || label, 'ubicacion'), used);
      result.push({ id, label });
      return result;
    }, []);
  }

  function normalizeSites(value) {
    const list = Array.isArray(value) ? value : DATA.sites;
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label, '');
      if (!label) return result;
      const id = uniqueId(slugify(item.id || label, 'sede'), used);
      result.push({
        id,
        label,
        short: text(item.short, label),
        locations: normalizeLocations(item.locations)
      });
      return result;
    }, []);
  }

  function normalizeDepartments(value) {
    const list = Array.isArray(value) ? value : DATA.departments;
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label, '');
      if (!label) return result;
      const id = uniqueId(slugify(item.id || label, 'departamento'), used);
      result.push({ id, label });
      return result;
    }, []);
  }

  function normalizePeople(value, departments, sites) {
    const list = Array.isArray(value) ? value : DATA.people;
    const validDepartments = new Set(departments.map((item) => item.id));
    const validSites = new Set(sites.map((item) => item.id));
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const name = text(item.name, '');
      if (!name) return result;
      const id = uniqueId(slugify(item.id || name, 'persona'), used);
      const departmentId = validDepartments.has(item.departmentId) ? item.departmentId : '';
      const siteId = validSites.has(item.siteId) ? item.siteId : '';
      result.push({
        id,
        name,
        role: text(item.role, ''),
        departmentId,
        siteId,
        email: text(item.email, ''),
        phone: text(item.phone, ''),
        active: item.active !== false
      });
      return result;
    }, []);
  }

  function normalizeAssignments(value, people) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : DATA.assignments;
    const validPeople = new Set(people.map((person) => person.id));
    const validAssets = new Set(DATA.assets.map((asset) => asset.id));
    return Object.keys(source).reduce((result, assetId) => {
      if (!validAssets.has(assetId)) return result;
      const personId = source[assetId];
      if (typeof personId === 'string' && validPeople.has(personId)) {
        result[assetId] = personId;
      }
      return result;
    }, {});
  }

  function normalizeGeneral(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      organizationName: text(source.organizationName, DATA.defaultGeneral.organizationName),
      appName: text(source.appName, DATA.defaultGeneral.appName),
      logo: text(source.logo, DATA.defaultGeneral.logo)
    };
  }

  function normalizeIntegrations(value, legacySettings) {
    const source = value && typeof value === 'object' ? value : {};
    const legacy = legacySettings && typeof legacySettings === 'object' ? legacySettings : {};
    const anydesk = source.anydesk && typeof source.anydesk === 'object' ? source.anydesk : {};
    const rmm = source.rmm && typeof source.rmm === 'object' ? source.rmm : {};
    const legacyAnydesk = isHttpUrl(legacy.anydeskUrl) ? legacy.anydeskUrl : DATA.defaultSettings.anydeskUrl;
    const legacyRmm = isHttpUrl(legacy.rmmUrl) ? legacy.rmmUrl : DATA.defaultSettings.rmmUrl;

    return {
      anydesk: {
        enabled: typeof anydesk.enabled === 'boolean' ? anydesk.enabled : true,
        url: text(anydesk.url, legacyAnydesk)
      },
      rmm: {
        enabled: typeof rmm.enabled === 'boolean' ? rmm.enabled : true,
        url: text(rmm.url, legacyRmm)
      }
    };
  }

  function normalizeConfig(value, legacySettings) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      general: normalizeGeneral(source.general),
      categories: normalizeCategories(source.categories),
      sites: normalizeSites(source.sites),
      departments: normalizeDepartments(source.departments),
      integrations: normalizeIntegrations(source.integrations, legacySettings),
      seedVersion: Number(source.seedVersion) || 1
    };
  }

  // Relations live outside the configuration schema so existing browsers keep
  // their saved configuration untouched. Invalid references are dropped instead
  // of failing the whole load.
  function normalizeRelationTypes(value) {
    const RelationsData = window.AssetRelationsData || {};
    const defaults = Array.isArray(RelationsData.DEFAULT_TYPES) ? RelationsData.DEFAULT_TYPES : [];
    const list = Array.isArray(value) && value.length ? value : defaults;
    const tones = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
    const used = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const label = text(item.label, '');
      if (!label) return result;
      const id = uniqueId(slugify(item.id || label, 'tipo'), used);
      result.push({
        id: id,
        label: label,
        inverse: text(item.inverse, label),
        directed: item.directed !== false,
        icon: text(item.icon, 'network'),
        tone: tones.indexOf(item.tone) !== -1 ? item.tone : 'network',
        description: text(item.description, '')
      });
      return result;
    }, []);
  }

  function normalizeRelationLinks(value, assets, types) {
    const list = Array.isArray(value) ? value : [];
    const assetIds = new Set((assets || []).map((asset) => asset.id));
    const typeIds = new Set((types || []).map((type) => type.id));
    const seen = new Set();
    return list.reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const from = text(item.from, '');
      const to = text(item.to, '');
      const type = text(item.type, '');
      if (!assetIds.has(from) || !assetIds.has(to) || from === to) return result;
      if (!typeIds.has(type)) return result;
      const pairKey = type + '|' + [from, to].sort().join('|');
      if (seen.has(pairKey)) return result;
      seen.add(pairKey);
      result.push({
        id: text(item.id, 'rel-' + from.toLowerCase() + '-' + to.toLowerCase() + '-' + type),
        from: from,
        to: to,
        type: type,
        note: typeof item.note === 'string' ? item.note.slice(0, 240) : '',
        createdAt: text(item.createdAt, ''),
        createdBy: text(item.createdBy, '')
      });
      return result;
    }, []);
  }

  function normalizeGraphPrefs(value) {
    const RelationsData = window.AssetRelationsData || {};
    const defaults = RelationsData.DEFAULT_PREFS || {};
    const source = value && typeof value === 'object' ? value : {};
    const groups = ['category', 'site', 'none'];
    const depth = Number(source.depth);
    return {
      mode: source.mode === 'focus' ? 'focus' : 'global',
      depth: depth >= 1 && depth <= 3 ? Math.round(depth) : (defaults.depth || 2),
      group: groups.indexOf(source.group) !== -1 ? source.group : (defaults.group || 'category'),
      showLabels: typeof source.showLabels === 'boolean' ? source.showLabels : true,
      showIsolated: typeof source.showIsolated === 'boolean' ? source.showIsolated : true,
      animate: typeof source.animate === 'boolean' ? source.animate : true,
      search: typeof source.search === 'string' ? source.search.slice(0, 80) : ''
    };
  }

  function normalizeRelations(value, assets) {
    const source = value && typeof value === 'object' ? value : {};
    const RelationsData = window.AssetRelationsData || {};
    const types = normalizeRelationTypes(source.types);
    // A missing list means "never stored" and gets the demo topology; an empty
    // array is a real state (the user removed every link) and stays empty.
    const rawLinks = Array.isArray(source.links)
      ? source.links
      : (Array.isArray(RelationsData.DEFAULT_LINKS) ? RelationsData.DEFAULT_LINKS : []);
    return {
      types: types,
      links: normalizeRelationLinks(rawLinks, assets, types),
      prefs: normalizeGraphPrefs(source.prefs)
    };
  }

  // Categories introduced with the asset management module. Existing browsers only
  // receive them once, tracked by seedVersion, so a deliberate deletion stays deleted.
  const SEED_CATEGORIES_VERSION = 2;
  const SEED_CATEGORIES = ['camaras', 'ups', 'virtualizacion', 'contenedores'];

  function migrateCategories(config) {
    if (config.seedVersion >= SEED_CATEGORIES_VERSION) return config;
    SEED_CATEGORIES.forEach((id) => {
      if (config.categories.some((category) => category.id === id)) return;
      const seed = (DATA.categories || []).find((category) => category.id === id);
      if (seed) config.categories.push(clone(seed));
    });
    config.seedVersion = SEED_CATEGORIES_VERSION;
    writeJSON(window.localStorage, KEYS.config, config);
    return config;
  }

  function normalizePrefs(prefs, categories, sites, departments) {
    const validCategories = categories.map((category) => category.id);
    const validSites = sites.map((site) => site.id);
    const validDepartments = departments.map((department) => department.id);
    const validSorts = ['id-asc', 'name-asc', 'name-desc', 'site-asc', 'assignee-asc', 'type-asc'];
    const source = prefs && typeof prefs === 'object' ? prefs : {};
    const peopleSource = source.people && typeof source.people === 'object' ? source.people : {};
    return {
      search: typeof source.search === 'string' ? source.search : '',
      category: validCategories.indexOf(source.category) !== -1 ? source.category : 'all',
      site: validSites.indexOf(source.site) !== -1 ? source.site : 'all',
      sort: validSorts.indexOf(source.sort) !== -1 ? source.sort : 'id-asc',
      view: source.view === 'cards' ? 'cards' : 'table',
      people: {
        search: typeof peopleSource.search === 'string' ? peopleSource.search : '',
        site: validSites.indexOf(peopleSource.site) !== -1 ? peopleSource.site : 'all',
        department: validDepartments.indexOf(peopleSource.department) !== -1 ? peopleSource.department : 'all',
        status: peopleSource.status === 'active' || peopleSource.status === 'inactive' ? peopleSource.status : 'all'
      },
      personAssetsView: source.personAssetsView === 'cards' ? 'cards' : 'table'
    };
  }

  function settingsFromConfig(config) {
    return {
      anydeskUrl: config.integrations.anydesk.url,
      rmmUrl: config.integrations.rmm.url,
      anydeskEnabled: config.integrations.anydesk.enabled,
      rmmEnabled: config.integrations.rmm.enabled
    };
  }

  function buildAssets(overrides, assignments) {
    const stored = overrides && typeof overrides === 'object' ? overrides : {};
    const assigned = assignments && typeof assignments === 'object' ? assignments : DATA.assignments;
    return DATA.assets.map((asset) => {
      const override = stored[asset.id] && typeof stored[asset.id] === 'object' ? stored[asset.id] : {};
      return Object.assign({}, asset, {
        assigneeId: typeof assigned[asset.id] === 'string' ? assigned[asset.id] : '',
        anydeskId: typeof override.anydeskId === 'string' ? override.anydeskId : asset.anydeskId,
        rmmAgentId: typeof override.rmmAgentId === 'string' ? override.rmmAgentId : asset.rmmAgentId,
        rmmOnline: typeof override.rmmOnline === 'boolean' ? override.rmmOnline : asset.rmmOnline
      });
    });
  }

  // New infrastructure seeds are appended once, tracked by seedAssets, so a
  // browser that already stores its inventory still receives the topology that
  // the relations module needs.
  const SEED_ASSETS_VERSION = 4;
  const SEED_ASSET_IDS = ['AM-1062', 'AM-1063', 'AM-1064', 'AM-1065', 'AM-1066', 'AM-1067', 'AM-1068', 'AM-1069'];

  function mergeSeedAssets(assets, context) {
    const version = Number(readJSON(window.localStorage, KEYS.seedAssets, 1)) || 1;
    if (version >= SEED_ASSETS_VERSION) return assets;
    const existing = new Set(assets.map((asset) => asset.id));
    const seeds = window.AssetSchema.normalizeAssets(
      DATA.assets.filter((asset) => SEED_ASSET_IDS.indexOf(asset.id) !== -1),
      context
    );
    const merged = assets.concat(seeds.filter((asset) => !existing.has(asset.id)));
    writeJSON(window.localStorage, KEYS.seedAssets, SEED_ASSETS_VERSION);
    return merged;
  }

  const storedPrefs = readJSON(window.localStorage, KEYS.prefs, {});
  const storedSettings = readJSON(window.localStorage, KEYS.settings, {});
  const storedConfig = readJSON(window.localStorage, KEYS.config, null);

  const storedOverrides = readJSON(window.localStorage, KEYS.overrides, {});
  const storedPeople = readJSON(window.localStorage, KEYS.people, null);
  const storedAssignments = readJSON(window.localStorage, KEYS.assignments, null);
  const storedAssets = readJSON(window.localStorage, KEYS.assets, null);
  const storedAdmin = readJSON(window.localStorage, KEYS.assetAdmin, null);
  const config = migrateCategories(normalizeConfig(storedConfig, storedSettings));
  const people = normalizePeople(storedPeople, config.departments, config.sites);
  const assignments = normalizeAssignments(storedAssignments, people);
  const assetAdmin = window.AssetSchema.ensureForms(
    window.AssetSchema.normalizeAdmin(storedAdmin),
    config.categories
  );
  const assets = window.AssetOpsData.enrich(mergeSeedAssets(window.AssetSchema.normalizeAssets(
    Array.isArray(storedAssets) && storedAssets.length ? storedAssets : buildAssets(storedOverrides, assignments),
    { admin: assetAdmin, categories: config.categories, sites: config.sites, people }
  ), { admin: assetAdmin, categories: config.categories, sites: config.sites, people }), { sites: config.sites, people: people });
  const relations = normalizeRelations(readJSON(window.localStorage, KEYS.relations, null), assets);
  const maps = window.AssetMapData.normalizeMaps(
    readJSON(window.localStorage, KEYS.maps, null),
    assets,
    config.sites
  );
  const maintenance = window.AssetMaintEngine.normalize(
    readJSON(window.localStorage, KEYS.maintenance, null),
    assets,
    config.categories
  );
  const monitoring = window.AssetMonitorEngine.normalize(
    readJSON(window.localStorage, KEYS.monitoring, null),
    assets,
    config.categories,
    config.sites
  );

  window.AssetStore = {
    KEYS,
    categories: config.categories,
    sites: config.sites,
    readJSON,
    writeJSON,
    removeStored,
    isHttpUrl,
    clone,
    slugify,
    normalizePrefs,
    normalizeConfig,
    normalizePeople,
    normalizeAssignments,
    normalizeRelations,
    normalizeRelationTypes,
    normalizeRelationLinks,
    normalizeGraphPrefs,
    normalizeMaps: window.AssetMapData.normalizeMaps,
    settingsFromConfig,
    buildAssets,
    initialState() {
      return {
        config,
        categories: config.categories,
        sites: config.sites,
        departments: config.departments,
        people,
        assets,
        relations,
        graphPrefs: relations.prefs,
        maps,
        mapPrefs: maps.prefs,
        maintenance,
        monitoring,
        assetAdmin,
        settings: settingsFromConfig(config),
        prefs: normalizePrefs(storedPrefs, config.categories, config.sites, config.departments),
        authenticated: false
      };
    }
  };
})();
