/* Server-authoritative organization adapter (phase 5).
 *
 * One state object owns the bounded server reads and writes for the directory
 * (people, departments, locations), the typed relations, the infrastructure
 * graph and the organizational map. The prototype collections (`this.people`,
 * `this.config.sites`, `this.relations`, `this.maps`, localStorage) stay
 * untouched for the modules that still run on demo data; in server mode every
 * view reads this adapter instead, and nothing here writes localStorage.
 *
 * Every resource keeps a monotonic epoch and aborts its own request, so a late
 * response cannot revive data after logout or report a false success.
 */
(function () {
  'use strict';

  const PAGE_LIMIT = 50;
  const MAX_LIMIT = 200;
  const HISTORY_LIMIT = 25;
  const GRAPH_NODE_LIMIT = 200;
  const TYPE_SUGGESTION_LIMIT = 50;
  const DEFAULT_PLAN = { width: 1600, height: 1000 };
  const STATUS_ACTIVE = 'active';
  const STATUS_INACTIVE = 'inactive';
  const LEVELS = ['site', 'building', 'floor', 'room_zone'];
  const LEVEL_LABELS = {
    site: 'Sede',
    building: 'Edificio',
    floor: 'Piso',
    room_zone: 'Sala o zona'
  };
  // Visual vocabulary for the six default server types. Unknown custom types get
  // the neutral network tone; the icon is never invented from a label.
  const TYPE_VISUALS = {
    connected_to: { icon: 'network', tone: 'network' },
    installed_in: { icon: 'building', tone: 'physical' },
    hosted_in: { icon: 'layers', tone: 'virtual' },
    protected_by: { icon: 'battery', tone: 'power' },
    depends_on: { icon: 'activity', tone: 'dependency' },
    associated_with: { icon: 'refresh', tone: 'link' }
  };
  const HISTORY_TITLES = {
    created: 'Persona creada',
    updated: 'Persona actualizada',
    activated: 'Persona reactivada',
    deactivated: 'Persona desactivada',
    location_created: 'Ubicación creada',
    location_updated: 'Ubicación actualizada',
    department_created: 'Departamento creado',
    department_updated: 'Departamento actualizado',
    assigned: 'Responsable asignado',
    returned: 'Responsable devuelto',
    transferred: 'Activo trasladado',
    relationship_created: 'Relación creada',
    relationship_updated: 'Relación modificada',
    relationship_removed: 'Relación eliminada',
    host_moved: 'Host cambiado'
  };

  // Monotonic epoch: never reset, so a cleared session can never match a late
  // response. One counter is shared by every resource of this adapter.
  let responseEpoch = 0;

  function nextEpoch() {
    responseEpoch += 1;
    return responseEpoch;
  }

  // Trusted client session of this adapter. It advances only when the session
  // ends and the canonical state is cleared, so a write that resolves after a
  // logout can never present itself as part of the next session. The server may
  // already have committed that write: nothing here cancels or rewrites it.
  let sessionEpoch = 0;

  function nextSessionEpoch() {
    sessionEpoch += 1;
    return sessionEpoch;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /* The prototype people computeds live in app.js; delegating keeps one
   * definition of the demo filters instead of a drifting copy. */
  function peopleComputed(name, vm) {
    const table = window.AssetAppPeopleComputed;
    if (table && typeof table[name] === 'function') return table[name].call(vm);
    return null;
  }

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function copy(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function makeController() {
    if (typeof AbortController === 'function') return new AbortController();
    return null;
  }

  function pageState(limit) {
    return {
      items: [],
      total: 0,
      limit: limit || PAGE_LIMIT,
      offset: 0,
      loading: false,
      loaded: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function detailState() {
    return { id: '', record: null, loading: false, error: '', epoch: nextEpoch(), controller: null };
  }

  function treeState() {
    return {
      roots: [],
      nodeCount: 0,
      depth: 2,
      truncated: false,
      loaded: false,
      loading: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function typesState() {
    return { items: [], loaded: false, loading: false, error: '', epoch: nextEpoch(), controller: null };
  }

  function graphState() {
    return {
      rootId: '',
      assetIds: [],
      depth: 2,
      direction: 'both',
      typeKey: '',
      nodes: [],
      edges: [],
      total: 0,
      limit: GRAPH_NODE_LIMIT,
      offset: 0,
      truncated: false,
      nodesTruncated: false,
      edgesTruncated: false,
      depthTruncated: false,
      loaded: false,
      loading: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function mapState() {
    return {
      siteId: '',
      sites: [],
      positions: [],
      // Canonical assets for the same authorization scope. Positions only carry
      // placed equipment, so this bounded pool keeps unpositioned devices
      // associated with their room/floor instead of dropping them from the map.
      assets: [],
      assetsTruncated: false,
      limit: PAGE_LIMIT,
      offset: 0,
      truncated: false,
      loaded: false,
      loading: false,
      error: '',
      epoch: nextEpoch(),
      controller: null
    };
  }

  function createDialogs() {
    return {
      assign: { open: false, mode: 'person', assetId: '', personId: '', selectedId: '', reason: '', notes: '', effectiveAt: '', error: '', busy: false },
      transfer: { open: false, assetId: '', assetName: '', siteId: '', locationId: '', originalSiteId: '', originalLocationId: '', reason: '', notes: '', effectiveAt: '', error: '', fieldErrors: {}, busy: false },
      relation: { open: false, mode: 'create', id: '', sourceId: '', targetId: '', typeKey: '', reason: '', notes: '', effectiveAt: '', error: '', busy: false },
      hostMove: { open: false, childId: '', childName: '', search: '', newHostId: '', reason: '', notes: '', effectiveAt: '', error: '', busy: false },
      type: { open: false, mode: 'create', key: '', forwardLabel: '', inverseLabel: '', containment: false, active: true, error: '', busy: false },
      // Site → building → floor → room/zone. The level is immutable after
      // creation; the parent is validated against the level above it.
      location: {
        open: false,
        mode: 'create',
        id: '',
        level: 'site',
        parentId: '',
        name: '',
        description: '',
        latitude: '',
        longitude: '',
        planRef: '',
        planPage: '',
        active: true,
        error: '',
        fieldErrors: {},
        busy: false
      }
    };
  }

  /* ------------------------------------------------------------ DTO mapping */

  function mapDepartment(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.id)) return null;
    return {
      id: text(payload.id),
      name: text(payload.name),
      label: text(payload.name),
      active: payload.active !== false,
      serverRecord: true
    };
  }

  function mapPerson(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.id)) return null;
    const active = text(payload.status) !== STATUS_INACTIVE;
    const name = text(payload.name);
    const jobTitle = text(payload.jobTitle);
    return {
      id: text(payload.id),
      name,
      // The existing views read role/email/phone/active. The canonical server
      // fields are kept beside them instead of being thrown away.
      role: jobTitle,
      email: text(payload.contactEmail),
      phone: text(payload.contactPhone),
      active,
      status: active ? STATUS_ACTIVE : STATUS_INACTIVE,
      statusLabel: active ? 'Activa' : 'Inactiva',
      departmentId: text(payload.departmentId),
      siteId: text(payload.siteId),
      label: text(payload.label) || (jobTitle ? name + ' (' + jobTitle + ')' : name),
      serverRecord: true
    };
  }

  function mapLocation(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.id)) return null;
    const level = text(payload.level);
    return {
      id: text(payload.id),
      level: LEVELS.indexOf(level) === -1 ? text(payload.level) : level,
      levelLabel: LEVEL_LABELS[level] || text(payload.level),
      parentId: text(payload.parentId),
      name: text(payload.name),
      label: text(payload.name),
      description: text(payload.description),
      latitude: payload.latitude === null || payload.latitude === undefined ? null : number(payload.latitude, null),
      longitude: payload.longitude === null || payload.longitude === undefined ? null : number(payload.longitude, null),
      planRef: text(payload.planRef),
      planPage: text(payload.planPage),
      active: payload.active !== false,
      serverRecord: true
    };
  }

  /* The site records the prototype views expect. A site is a `site`-level
   * location; coordinates come from the same record, never from a demo fixture. */
  function mapSite(locations) {
    return (locations || [])
      .filter(function (location) { return location && location.level === 'site'; })
      .map(function (location) {
        return {
          id: location.id,
          label: location.name,
          short: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          active: location.active,
          serverRecord: true
        };
      });
  }

  function mapLocationTree(node) {
    if (!node || typeof node !== 'object') return null;
    const mapped = mapLocation(node);
    if (!mapped) return null;
    mapped.children = (Array.isArray(node.children) ? node.children : [])
      .map(mapLocationTree)
      .filter(Boolean);
    return mapped;
  }

  /* Graph/map views read prototype-shaped assets. The mapping is explicit and
   * keeps the permanent UUID as the only identity. */
  function mapAsset(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.id)) return null;
    const status = text(payload.status);
    const category = text(payload.category) || 'otros';
    const images = payload.images && typeof payload.images === 'object' ? payload.images : {};
    const technical = payload.technical && typeof payload.technical === 'object' ? payload.technical : {};
    const fov = text(images.fov);
    return {
      id: text(payload.id),
      code: text(payload.quickCode),
      name: text(payload.name),
      category,
      type: text(payload.type) || category,
      brand: text(payload.brand),
      model: text(payload.model),
      serial: text(payload.serial),
      ip: text(payload.ip),
      site: text(payload.siteId),
      siteId: text(payload.siteId),
      location: text(payload.location),
      locationId: text(payload.locationId),
      responsible: text(payload.responsibleLabel) || text(payload.responsible),
      responsiblePersonId: text(payload.responsiblePersonId),
      assigneeId: text(payload.responsiblePersonId),
      assignee: text(payload.responsibleLabel),
      status,
      statusId: status,
      statusLabel: status,
      retired: status === 'retired',
      archived: !!payload.archived,
      positionX: text(payload.positionX),
      positionY: text(payload.positionY),
      images,
      technical,
      tech: technical,
      fovUrl: fov,
      fovImage: fov,
      serverAsset: true
    };
  }

  function mapRelationType(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.key)) return null;
    const key = text(payload.key);
    const visuals = TYPE_VISUALS[key] || { icon: 'network', tone: 'network' };
    return {
      id: key,
      key,
      label: text(payload.forwardLabel) || key,
      inverse: text(payload.inverseLabel) || text(payload.forwardLabel) || key,
      directed: true,
      containment: !!payload.containment,
      active: payload.active !== false,
      icon: visuals.icon,
      tone: visuals.tone,
      serverRecord: true
    };
  }

  function mapLink(payload) {
    if (!payload || typeof payload !== 'object' || !text(payload.id)) return null;
    const sourceId = text(payload.sourceId);
    const targetId = text(payload.targetId);
    if (!sourceId || !targetId) return null;
    return {
      id: text(payload.id),
      from: sourceId,
      to: targetId,
      // `type` is the historical alias this panel already renders; `typeKey` is
      // the canonical key the mounted host action compares against.
      type: text(payload.typeKey),
      typeKey: text(payload.typeKey),
      note: text(payload.notes) || text(payload.reason),
      reason: text(payload.reason),
      notes: text(payload.notes),
      effectiveAt: text(payload.effectiveAt),
      createdAt: text(payload.createdAt),
      direction: text(payload.direction),
      label: text(payload.label),
      typeActive: payload.typeActive !== false,
      serverLink: true
    };
  }

  function mapHistoryItem(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return {
      id: text(payload.id),
      entityType: text(payload.entityType) || 'asset',
      entityId: text(payload.entityId),
      assetId: text(payload.assetId),
      action: text(payload.action),
      title: HISTORY_TITLES[text(payload.action)] || 'Cambio registrado',
      actorId: text(payload.actorId),
      actorUsername: text(payload.actorUsername),
      source: text(payload.source),
      recordedAt: text(payload.createdAt),
      effectiveAt: text(payload.effectiveAt),
      reason: text(payload.reason),
      notes: text(payload.notes),
      changes: payload.changes && typeof payload.changes === 'object' ? copy(payload.changes) : {},
      quickCodeOld: text(payload.quickCodeOld),
      quickCodeNew: text(payload.quickCodeNew),
      statusOld: text(payload.statusOld),
      statusNew: text(payload.statusNew)
    };
  }

  /* Relative <-> canvas position. The server stores canonical 0..1 decimals;
   * the existing canvas renders pixels inside the plan bounds. Nothing infers a
   * position that the server did not send. */
  /* A null, undefined, blank, non-finite or incomplete coordinate is absent
   * data. `Number(null)` is 0, so the value is inspected before conversion: an
   * unpositioned asset never becomes an origin placement the server did not
   * send, while an explicit numeric 0 is still a real position. */
  function measurement(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp01(value) {
    const parsed = measurement(value);
    if (parsed === null) return null;
    return Math.min(1, Math.max(0, parsed));
  }

  function canonicalFromPixels(px, py, bounds) {
    const box = Object.assign({}, DEFAULT_PLAN, bounds || {});
    const rawX = measurement(px);
    const rawY = measurement(py);
    if (rawX === null || rawY === null || !(box.width > 0) || !(box.height > 0)) return null;
    const x = clamp01(rawX / box.width);
    const y = clamp01(rawY / box.height);
    if (x === null || y === null) return null;
    return { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) };
  }

  function pixelsFromCanonical(x, y, bounds) {
    const box = Object.assign({}, DEFAULT_PLAN, bounds || {});
    const relX = clamp01(x);
    const relY = clamp01(y);
    if (relX === null || relY === null) return null;
    return { x: Math.round(relX * box.width), y: Math.round(relY * box.height) };
  }

  /* Maps one bounded `/map` payload onto the prototype map shape the existing
   * canvas reads. Floors/rooms come from the location tree; the plan file is
   * never claimed because the API stores only planRef/planPage metadata. */
  function mapPayloadToMaps(payload, context) {
    const sites = Array.isArray(payload && payload.sites) ? payload.sites : [];
    const positions = Array.isArray(payload && payload.positions) ? payload.positions : [];
    const locations = Array.isArray(context && context.locations) ? context.locations : [];
    const byId = {};
    const locationIndex = {};
    locations.forEach(function (location) {
      byId[location.id] = location;
      locationIndex[location.id] = { id: location.id, parentId: location.parentId || '', level: location.level || '' };
    });
    const buildings = locations
      .filter(function (location) { return location.level === 'building'; })
      .map(function (location) {
        return { id: location.id, site: location.parentId, name: location.name, kind: LEVEL_LABELS.building, address: '' };
      });
    const rootSiteOf = function (location) {
      let current = location;
      let guard = 0;
      while (current && current.level !== 'site' && guard < 8) {
        current = byId[current.parentId] || null;
        guard += 1;
      }
      return current || null;
    };
    const floors = locations
      .filter(function (location) { return location.level === 'floor'; })
      .map(function (location) {
        const site = rootSiteOf(location);
        return {
          id: location.id,
          building: location.parentId,
          site: site ? site.id : '',
          name: location.name,
          level: 0,
          area: 0,
          planRef: location.planRef,
          planPage: location.planPage
        };
      });
    const rooms = locations
      .filter(function (location) { return location.level === 'room_zone'; })
      .map(function (location) {
        return { id: location.id, floor: location.parentId, name: location.name, kind: 'room', zone: '' };
      });
    const plans = floors
      .filter(function (floor) { return floor.planRef || floor.planPage; })
      .map(function (floor) {
        return {
          id: 'plan-ref-' + floor.id,
          site: floor.site,
          building: floor.building,
          floor: floor.id,
          name: floor.planRef || 'Plano sin referencia',
          kind: 'Referencia del servidor',
          // No plan file is uploaded or fetched: the reference stays metadata.
          src: '',
          width: DEFAULT_PLAN.width,
          height: DEFAULT_PLAN.height,
          format: '',
          visible: true,
          opacity: 1,
          illustrative: false
        };
      });
    const geo = {};
    sites.forEach(function (site) {
      const lat = number(site.latitude, null);
      const lng = number(site.longitude, null);
      if (lat === null || lng === null) return;
      geo[site.id] = { lat, lng, address: '' };
    });
    const placements = {};
    positions.forEach(function (position) {
      const location = byId[position.locationId] || null;
      const floorLocation = (function () {
        let current = location;
        let guard = 0;
        while (current && current.level !== 'floor' && guard < 8) {
          current = byId[current.parentId] || null;
          guard += 1;
        }
        return current;
      })();
      if (!floorLocation) return;
      const pixels = pixelsFromCanonical(position.x, position.y, {});
      if (!pixels) return;
      placements[position.assetId] = { floor: floorLocation.id, x: pixels.x, y: pixels.y };
    });
    return {
      sites: sites.map(function (site) { return { id: text(site.id), label: text(site.name) }; }),
      buildings,
      floors,
      rooms,
      plans,
      positions: placements,
      locationIndex,
      geo,
      serverMap: true
    };
  }

  /* ---------------------------------------------------------------- adapter */

  window.AssetOrganization = {
    PAGE_LIMIT,
    MAX_LIMIT,
    HISTORY_LIMIT,
    LEVELS,
    LEVEL_LABELS,
    DEFAULT_PLAN,
    mapDepartment,
    mapPerson,
    mapLocation,
    mapSite,
    mapLocationTree,
    mapAsset,
    mapRelationType,
    mapLink,
    mapHistoryItem,
    pixelsFromCanonical,
    canonicalFromPixels,
    mapPayloadToMaps,

    data() {
      return {
        organization: {
          people: pageState(),
          peopleTotals: { total: 0, active: 0, loaded: false, error: '', epoch: nextEpoch() },
          departments: pageState(MAX_LIMIT),
          locations: pageState(MAX_LIMIT),
          tree: treeState(),
          personDetail: detailState(),
          personAssets: pageState(),
          personHistory: pageState(HISTORY_LIMIT),
          personAssetHistory: pageState(HISTORY_LIMIT),
          entityHistory: pageState(HISTORY_LIMIT),
          types: typesState(),
          relations: pageState(),
          graph: graphState(),
          map: mapState(),
          assetSearch: pageState(),
          dialogs: createDialogs(),
          peopleSearchTimer: null,
          assetSearchTimer: null,
          saveBusy: false,
          sessionEpoch: nextSessionEpoch()
        }
      };
    },

    computed: {
      /* Authority comes from the authenticated session, capability from each
       * permission. An asset-only role must still reach the real map, graph and
       * location tree, and a config-only role must administer the hierarchy
       * without inheriting extra authority. */
      serverOrganizationMode() {
        return !!this.authenticated;
      },
      organizationDirectoryMode() {
        return this.serverOrganizationMode && !!(this.can && this.can('people.view'));
      },
      organizationAssetsMode() {
        return this.serverOrganizationMode && !!(this.can && this.can('assets.view'));
      },
      organizationSitesConfigMode() {
        return this.serverOrganizationMode && !!(this.can && this.can('config.sites'));
      },
      organizationDepartmentsConfigMode() {
        return this.serverOrganizationMode && !!(this.can && this.can('config.departments'));
      },
      organizationDenied() {
        return this.serverOrganizationMode && !this.organizationDirectoryMode;
      },
      organizationPeople() {
        return this.organization.people.items;
      },
      organizationPeopleTotal() {
        return this.organization.people.total;
      },
      organizationActivePeopleTotal() {
        return this.organization.peopleTotals.active;
      },
      organizationPersonRecord() {
        if (this.route && this.route.name === 'person' && this.organization.personDetail.record) {
          return this.organization.personDetail.record;
        }
        return null;
      },
      organizationDepartments() {
        return this.organization.departments.items;
      },
      organizationLocations() {
        return this.organization.locations.items;
      },
      organizationServerSites() {
        return mapSite(this.organization.locations.items);
      },
      organizationTreeRoots() {
        return this.organization.tree.roots;
      },
      /* Parent choices for the location dialog: a building belongs to a site, a
       * floor to a building and a room to a floor. Cross-level parents never
       * appear, so an impossible containment is not offered as a choice. */
      organizationParentChoices() {
        const levels = { building: 'site', floor: 'building', room_zone: 'floor' };
        const items = this.organization.locations.items;
        return function (level, excludeId) {
          const parentLevel = levels[text(level)];
          if (!parentLevel) return [];
          const excluded = text(excludeId);
          return items.filter(function (item) {
            return item.level === parentLevel && item.active && item.id !== excluded;
          });
        }.bind(this);
      },
      organizationTypeChoices() {
        return this.organization.types.items;
      },
      organizationRelationsPage() {
        return this.organization.relations;
      },
      // Canonical hierarchy used by the configuration section. Inactive levels
      // stay listed so an administrator can reactivate them.
      organizationConfigSites() {
        return this.organization.locations.items
          .filter((item) => item.level === 'site')
          .slice()
          .sort((left, right) => String(left.name).localeCompare(String(right.name)));
      },
      transferDialog() {
        return this.organization.dialogs.transfer;
      },
      transferLocations() {
        const dialog = this.organization.dialogs.transfer;
        return this.assetSiteLocations(dialog.siteId);
      },
      transferSites() {
        return this.organizationServerSites.filter((site) => site.active !== false);
      },
      organizationGraphView() {
        return this.organization.graph;
      },
      organizationMapView() {
        return this.organization.map;
      },
      organizationGraphSource() {
        const state = this.organization.graph;
        const assets = state.nodes.map(mapAsset).filter(Boolean);
        const links = state.edges.map(mapLink).filter(Boolean);
        return {
          assets,
          relations: { types: this.organization.types.items, links },
          sites: this.organizationServerSites,
          categories: (this.categories || []).slice(),
          graphPrefs: this.graphPrefs
        };
      },
      organizationMapSource() {
        const state = this.organization.map;
        // Placed assets come from `/map`; the bounded asset pool adds the
        // canonical record (category/status/images) and every unpositioned
        // device that is still associated with a room or floor.
        const pooled = state.assets.map(mapAsset).filter(Boolean);
        const placed = {};
        state.positions.forEach(function (position) { placed[text(position.assetId)] = position; });
        const assets = pooled.length
          ? pooled
          : state.positions.map(function (position) {
            return {
              id: text(position.assetId),
              code: text(position.quickCode),
              name: text(position.name),
              category: 'otros',
              type: '',
              site: text(position.siteId),
              siteId: text(position.siteId),
              locationId: text(position.locationId),
              location: '',
              status: 'in_use',
              statusId: 'in_use',
              positionX: position.x === null || position.x === undefined ? '' : String(position.x),
              positionY: position.y === null || position.y === undefined ? '' : String(position.y),
              archived: false,
              serverAsset: true
            };
          });
        assets.forEach(function (asset) {
          const position = placed[asset.id];
          if (!position) return;
          asset.positionX = position.x === null || position.x === undefined ? '' : String(position.x);
          asset.positionY = position.y === null || position.y === undefined ? '' : String(position.y);
        });
        return {
          assets,
          sites: this.organizationServerSites,
          maps: mapPayloadToMaps(state, { locations: this.organization.locations.items }),
          categories: (this.categories || []).slice(),
          assetAdmin: this.assetAdmin
        };
      },

      /* The server directory replaces the prototype collections only while the
       * canonical API is authoritative. Prototype/demo modules keep their own
       * data when the session has no directory permission. */
      serverPeopleMode() {
        return this.organizationDirectoryMode && this.route && this.route.name === 'people';
      },
      serverRelationsMode() {
        return this.organizationAssetsMode && this.route &&
          (this.route.name === 'config' ? this.route.section === 'relaciones' : true);
      },
      serverGraphMode() {
        return this.serverOrganizationMode && this.route && this.route.name === 'graph';
      },
      serverMapMode() {
        return this.serverOrganizationMode && this.route && this.route.name === 'map';
      },
      /* An authenticated session reads the server hierarchy only. While the
       * canonical read has not answered, or when it failed, the collections are
       * empty: prototype sites and departments are demo data for demo modules,
       * never a fallback under server authority. */
      sites() {
        if (!this.serverOrganizationMode) return this.config.sites;
        return this.organization.locations.loaded ? this.organizationServerSites : [];
      },
      departments() {
        if (!this.serverOrganizationMode) return this.config.departments;
        return this.organization.departments.loaded ? this.organizationDepartments : [];
      },
      filteredPeople() {
        if (!this.organizationDirectoryMode) return [];
        return this.organization.people.items;
      },
      currentPerson() {
        if (!this.organizationDirectoryMode) return null;
        if (!this.route || this.route.name !== 'person' || !this.route.personId) return null;
        const detail = this.organization.personDetail;
        if (detail.record && detail.record.id === this.route.personId) return detail.record;
        return this.organizationPersonById(this.route.personId);
      },
      personAssets() {
        if (!this.organizationDirectoryMode) return [];
        if (!this.currentPerson) return [];
        return this.organization.personAssets.items;
      },
      assignContextAsset() {
        if (!this.organizationDirectoryMode) return null;
        if (!this.assignDialog.assetId) return null;
        return {
          id: this.assignDialog.assetId,
          name: this.assignDialog.assetLabel || this.assignDialog.assetId,
          code: this.assignDialog.assetLabel || ''
        };
      },
      assignTargetPerson() {
        if (!this.organizationDirectoryMode) return null;
        if (!this.assignDialog.personId) return null;
        return this.organizationPersonById(this.assignDialog.personId);
      },
      assignPeople() {
        if (!this.organizationDirectoryMode) return [];
        const term = text(this.assignDialog.search).toLocaleLowerCase('es');
        const currentId = this.assignDialog.mode === 'person' ? this.assignDialog.personId : '';
        return this.organization.people.items
          .filter(function (person) { return person.active || person.id === currentId; })
          .filter(function (person) {
            if (!term) return true;
            return [person.name, person.role, person.label].join(' ').toLocaleLowerCase('es').indexOf(term) !== -1;
          });
      },
      assignAssets() {
        if (!this.organizationDirectoryMode) return [];
        return this.organization.assetSearch.items;
      },
      peopleFilterCount() {
        if (!this.organizationDirectoryMode) return 0;
        const filters = (this.prefs && this.prefs.people) || {};
        return ['search', 'department', 'site', 'status'].filter(function (key) {
          return !!text(filters[key]);
        }).length;
      },
      peopleFilterDescription() {
        if (!this.organizationDirectoryMode) return '';
        const filters = (this.prefs && this.prefs.people) || {};
        const parts = [];
        if (text(filters.search)) parts.push('"' + text(filters.search) + '"');
        if (text(filters.department)) parts.push(this.departmentLabel(filters.department));
        if (text(filters.site)) parts.push(this.siteLabel(filters.site));
        if (filters.status === 'active') parts.push('Solo activas');
        if (filters.status === 'inactive') parts.push('Solo inactivas');
        return parts.join(' · ');
      },
      /* Universal search keeps its prototype records only for demo sessions. Under
       * server authority the index carries the canonical directory and hierarchy
       * records and never a prototype person, site or location. */
      universalRecords() {
        const base = window.AssetWorkspaceRuntime.computed.universalRecords.call(this);
        if (!this.serverOrganizationMode) return base;
        const prefix = function (record) { return text(record && record.key).split(':')[0]; };
        const demoKinds = ['person', 'site', 'location'];
        const kept = base.filter(function (record) { return demoKinds.indexOf(prefix(record)) === -1; });
        const search = window.AssetSearch;
        if (!search || typeof search.record !== 'function') return kept;
        if (this.organizationDirectoryMode) {
          this.organization.people.items.forEach(function (person) {
            kept.push(search.record('person', person.id, person.label, person.role || 'Persona del directorio', 'user', [person.name, person.role]));
          });
        }
        if (this.organizationAssetsMode) {
          this.organizationServerSites.forEach(function (site) {
            kept.push(search.record('site', site.id, site.label, 'Sede · Mapa', 'building', [site.short]));
          });
          this.organization.locations.items.forEach(function (location) {
            if (location.level === 'site') return;
            // A location opens the map by its site, so the record keeps the
            // composite key but carries the real location id and the nearest
            // canonical site ancestor. Without a known site the row would
            // focus the explorer on an id that is not a site, so it stays out
            // of the index instead of inventing one.
            const siteId = this.organizationSiteAncestorId(location);
            if (!siteId) return;
            const parent = this.organizationLocationById(location.parentId);
            kept.push(search.record('location', location.parentId + ':' + location.id, location.name, parent ? parent.name : location.levelLabel, 'map-pin', [location.name, location.levelLabel], { kind: 'location', id: location.id, siteId: siteId }));
          }.bind(this));
        }
        return kept;
      }
    },

    methods: {
      /* ----------------------------------------------------------- helpers */
      organizationAvailable(permission) {
        return !!(this.authenticated && this.can && this.can(permission));
      },
      /* Every write captures the trusted client session before it awaits and
       * re-checks it before touching client state. A completion that belongs to
       * an ended session reports no success, keeps no row, dialog or toast and
       * performs no follow-up read. */
      organizationWriteToken() {
        return {
          session: this.organization ? this.organization.sessionEpoch : 0,
          authenticated: this.authenticated === true
        };
      },
      organizationWriteOpen(token) {
        return !!token &&
          this.authenticated === true &&
          !!this.organization &&
          this.organization.sessionEpoch === token.session;
      },
      organizationPersonById(id) {
        const key = text(id);
        if (!key) return null;
        if (this.serverOrganizationMode) {
          const record = this.organizationPersonRecord;
          if (record && record.id === key) return record;
          return this.organization.people.items.find(function (person) { return person.id === key; }) || null;
        }
        return (this.people || []).find(function (person) { return person.id === key; }) || null;
      },
      organizationDepartmentById(id) {
        const key = text(id);
        if (!key) return null;
        return this.organization.departments.items.find(function (department) { return department.id === key; }) || null;
      },
      organizationLocationById(id) {
        const key = text(id);
        if (!key) return null;
        return this.organization.locations.items.find(function (location) { return location.id === key; }) || null;
      },
      /* Nearest 'site' in the canonical parent chain. The loaded page can be
       * partial, so a missing parent, a cycle or a branch with no site above it
       * returns '' and the caller decides without inventing a level. */
      organizationSiteAncestorId(location) {
        if (!location) return '';
        if (location.level === 'site') return location.id;
        const seen = {};
        let parentId = text(location.parentId);
        while (parentId && !seen[parentId]) {
          seen[parentId] = true;
          const parent = this.organizationLocationById(parentId);
          if (!parent) return '';
          if (parent.level === 'site') return parent.id;
          parentId = text(parent.parentId);
        }
        return '';
      },
      organizationLocationLabel(id) {
        const location = this.organizationLocationById(id);
        return location ? location.name : '';
      },
      organizationRelationTypeLabel(key) {
        const type = this.organization.types.items.find(function (item) { return item.id === key; });
        return type ? type.label : text(key);
      },
      organizationHistoryHasMore(page) {
        if (!page) return false;
        return page.offset + page.items.length < page.total;
      },
      organizationPlanBounds(floorId) {
        if (!floorId) return Object.assign({}, DEFAULT_PLAN);
        const floors = (this.maps && this.maps.plans) || [];
        const plan = floors.find(function (item) { return item.floor === floorId; });
        if (plan && plan.width && plan.height) return { width: plan.width, height: plan.height };
        return Object.assign({}, DEFAULT_PLAN);
      },
      organizationShowError(error, fallback) {
        const message = (error && error.message) || fallback;
        if (this.showToast) this.showToast(message, 'error');
        return message;
      },
      organizationFieldErrors(error) {
        const fields = (error && error.fieldErrors) || {};
        return Object.keys(fields).map(function (key) { return key + ': ' + fields[key]; }).join(' · ');
      },

      /* ------------------------------------------------------- departments */
      async loadOrganizationDepartments(options) {
        const page = this.organization.departments;
        if (!this.organizationAvailable('people.view')) {
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = 'No tienes permiso para leer el directorio de personas.';
          return false;
        }
        const limit = Math.min(MAX_LIMIT, number(options && options.limit, MAX_LIMIT));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.loading = true;
        page.error = '';
        try {
          const payload = await window.AssetAccess.request(this, '/departments?limit=' + limit + '&offset=0', {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapDepartment).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          if (error && error.status === 401) return false;
          page.items = [];
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudieron cargar los departamentos del servidor.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      async loadOrganizationLocations(options) {
        const page = this.organization.locations;
        if (!this.organizationAvailable('assets.view')) {
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = 'No tienes permiso para leer las ubicaciones del servidor.';
          return false;
        }
        const epoch = nextEpoch();
        if (page.controller) page.controller.abort();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.loading = true;
        page.error = '';
        try {
          const levels = Array.isArray(options && options.levels) ? options.levels : LEVELS;
          const payload = await window.AssetAccess.request(
            this,
            '/locations?limit=' + MAX_LIMIT + '&offset=0',
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== page.epoch || !this.authenticated) return false;
          const items = (Array.isArray(payload.items) ? payload.items : []).map(mapLocation).filter(Boolean);
          page.items = items.filter(function (location) { return levels.indexOf(location.level) !== -1; });
          page.total = number(payload.total, items.length);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudieron cargar las ubicaciones del servidor.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      async loadOrganizationTree(options) {
        const tree = this.organization.tree;
        if (!this.organizationAvailable('assets.view')) {
          tree.roots = [];
          tree.nodeCount = 0;
          tree.loaded = false;
          tree.error = 'No tienes permiso para leer la estructura de ubicaciones.';
          return false;
        }
        const rootId = text(options && options.rootId);
        const depth = Math.min(4, Math.max(1, number(options && options.depth, tree.depth || 2)));
        const maxNodes = Math.min(500, Math.max(1, number(options && options.maxNodes, 200)));
        if (tree.controller) tree.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        tree.epoch = epoch;
        tree.controller = controller;
        tree.loading = true;
        tree.error = '';
        try {
          let path = '/locations/tree?depth=' + depth + '&maxNodes=' + maxNodes;
          if (rootId) path += '&rootId=' + encodeURIComponent(rootId);
          const payload = await window.AssetAccess.request(this, path, {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== tree.epoch || !this.authenticated) return false;
          tree.roots = (Array.isArray(payload.roots) ? payload.roots : []).map(mapLocationTree).filter(Boolean);
          tree.nodeCount = number(payload.nodeCount, 0);
          tree.depth = number(payload.depth, depth);
          tree.truncated = !!payload.truncated;
          tree.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== tree.epoch || (error && error.name === 'AbortError')) return false;
          tree.roots = [];
          tree.loaded = false;
          tree.error = (error && error.message) || 'No se pudo cargar el árbol de ubicaciones.';
          return false;
        } finally {
          if (epoch === tree.epoch) tree.loading = false;
        }
      },

      /* ------------------------------------------------------------ people */
      organizationPeopleQuery(options) {
        const filters = (options && options.filters) || (this.prefs && this.prefs.people) || {};
        const parts = ['limit=' + PAGE_LIMIT, 'offset=' + number(options && options.offset, 0)];
        const search = text(filters.search);
        if (search) parts.push('query=' + encodeURIComponent(search));
        if (filters.department && filters.department !== 'all') parts.push('departmentId=' + encodeURIComponent(filters.department));
        if (filters.site && filters.site !== 'all') parts.push('siteId=' + encodeURIComponent(filters.site));
        if (filters.status === 'active') parts.push('status=' + STATUS_ACTIVE);
        if (filters.status === 'inactive') parts.push('status=' + STATUS_INACTIVE);
        return '/people?' + parts.join('&');
      },
      async loadOrganizationPeople(options) {
        if (!this.organizationAvailable('people.view')) {
          const page = this.organization.people;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = 'No tienes permiso para leer el directorio de personas.';
          return false;
        }
        const page = this.organization.people;
        const offset = Math.max(0, number(options && options.offset, page.offset));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.loading = true;
        page.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            this.organizationPeopleQuery({ offset, filters: options && options.filters }),
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapPerson).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.limit = number(payload.limit, PAGE_LIMIT);
          page.offset = number(payload.offset, offset);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudieron cargar las personas del servidor.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      async loadOrganizationPeopleTotals() {
        if (!this.organizationAvailable('people.view')) {
          const totals = this.organization.peopleTotals;
          totals.total = 0;
          totals.active = 0;
          totals.loaded = false;
          totals.error = 'No tienes permiso para leer el directorio de personas.';
          return false;
        }
        const totals = this.organization.peopleTotals;
        const epoch = nextEpoch();
        totals.epoch = epoch;
        totals.error = '';
        try {
          const results = await Promise.all([
            window.AssetAccess.request(this, '/people?limit=1&offset=0'),
            window.AssetAccess.request(this, '/people?limit=1&offset=0&status=' + STATUS_ACTIVE)
          ]);
          if (epoch !== totals.epoch || !this.authenticated) return false;
          totals.total = number(results[0] && results[0].total, 0);
          totals.active = number(results[1] && results[1].total, 0);
          totals.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== totals.epoch) return false;
          totals.loaded = false;
          totals.error = (error && error.message) || 'No se pudieron contar las personas del servidor.';
          return false;
        }
      },
      /* Debounced directory read bound to the real filters. `options.query`
       * lets the assignment sheet search people without rewriting the directory
       * filter, and a new term always restarts at offset 0. */
      scheduleOrganizationPeopleSearch(options) {
        const state = this.organization;
        const overrides = options || {};
        if (state.peopleSearchTimer) clearTimeout(state.peopleSearchTimer);
        state.peopleSearchTimer = setTimeout(() => {
          state.peopleSearchTimer = null;
          if (!this.authenticated) return;
          const filters = typeof overrides.query === 'string'
            ? Object.assign({}, (this.prefs && this.prefs.people) || {}, { search: overrides.query })
            : undefined;
          this.loadOrganizationPeople({ offset: 0, filters: filters });
        }, 250);
      },
      /* A pending typed search belongs to the surface that started it: a route
       * change or the end of the session cancels it instead of letting it read
       * or write the next screen. */
      cancelOrganizationSearchTimers() {
        const state = this.organization;
        if (!state) return false;
        if (state.peopleSearchTimer) clearTimeout(state.peopleSearchTimer);
        if (state.assetSearchTimer) clearTimeout(state.assetSearchTimer);
        state.peopleSearchTimer = null;
        state.assetSearchTimer = null;
        return true;
      },
      nextOrganizationPeoplePage() {
        const page = this.organization.people;
        const next = page.offset + page.limit;
        if (next >= page.total) return false;
        return this.loadOrganizationPeople({ offset: next });
      },
      prevOrganizationPeoplePage() {
        const page = this.organization.people;
        if (page.offset <= 0) return false;
        return this.loadOrganizationPeople({ offset: Math.max(0, page.offset - page.limit) });
      },
      async loadOrganizationPerson(id) {
        const personId = text(id);
        if (!personId) return false;
        if (!this.organizationAvailable('people.view')) {
          const detail = this.organization.personDetail;
          detail.id = personId;
          detail.record = null;
          detail.loading = false;
          detail.error = 'No tienes permiso para consultar esta persona.';
          return false;
        }
        const detail = this.organization.personDetail;
        if (detail.controller) detail.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        const cached = this.organization.people.items.find(function (person) { return person.id === personId; }) || null;
        this.organization.personDetail = {
          id: personId,
          record: cached,
          loading: true,
          error: '',
          epoch,
          controller
        };
        try {
          const payload = await window.AssetAccess.request(this, '/people/' + encodeURIComponent(personId), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== this.organization.personDetail.epoch || !this.authenticated) return false;
          const person = mapPerson(payload);
          if (!person) throw new Error('El servidor no devolvió la persona solicitada.');
          this.organization.personDetail.record = person;
          return true;
        } catch (error) {
          if (epoch !== this.organization.personDetail.epoch) return false;
          if (error && error.name === 'AbortError') return false;
          this.organization.personDetail.record = error && error.status === 404 ? null : this.organization.personDetail.record;
          this.organization.personDetail.error = error && error.status === 404
            ? 'La persona solicitada ya no está disponible en el servidor.'
            : (error && error.message) || 'No se pudo cargar la persona desde el servidor.';
          return false;
        } finally {
          if (epoch === this.organization.personDetail.epoch) this.organization.personDetail.loading = false;
        }
      },
      async loadOrganizationPersonAssets(id, options) {
        const personId = text(id);
        if (!personId) return false;
        if (!this.organizationAvailable('assets.view')) {
          const denied = this.organization.personAssets;
          denied.items = [];
          denied.total = 0;
          denied.loaded = false;
          denied.error = 'No tienes permiso para leer los activos del servidor.';
          return false;
        }
        const page = this.organization.personAssets;
        const offset = Math.max(0, number(options && options.offset, 0));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.loading = true;
        page.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/people/' + encodeURIComponent(personId) + '/assets?limit=' + PAGE_LIMIT + '&offset=' + offset,
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapAsset).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.limit = number(payload.limit, PAGE_LIMIT);
          page.offset = number(payload.offset, offset);
          page.id = personId;
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudieron cargar los activos de la persona.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },

      /* ---------------------------------------------------- entity history */
      async loadOrganizationHistory(entity, entityId, options) {
        const kind = text(entity);
        const id = text(entityId);
        if (!kind || !id) return false;
        const permission = kind === 'location' ? 'assets.view' : 'people.view';
        if (!this.organizationAvailable(permission)) return false;
        const page = this.organization.entityHistory;
        const offset = Math.max(0, number(options && options.offset, 0));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.id = kind + ':' + id;
        page.loading = true;
        page.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/' + kind + 's/' + encodeURIComponent(id) + '/history?limit=' + HISTORY_LIMIT + '&offset=' + offset,
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapHistoryItem).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.limit = number(payload.limit, HISTORY_LIMIT);
          page.offset = number(payload.offset, offset);
          page.entity = text(payload.entity) || kind;
          page.entityId = text(payload.entityId) || id;
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudo cargar el historial del servidor.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      organizationHistoryNextPage() {
        const page = this.organization.entityHistory;
        const next = page.offset + page.limit;
        if (next >= page.total || !page.id) return false;
        const parts = page.id.split(':');
        return this.loadOrganizationHistory(parts[0], parts.slice(1).join(':'), { offset: next });
      },
      async loadOrganizationPersonHistory(id, options) {
        const personId = text(id);
        if (!personId) return false;
        if (!this.organizationAvailable('people.view')) {
          const denied = this.organization.personHistory;
          denied.items = [];
          denied.total = 0;
          denied.loaded = false;
          denied.error = 'No tienes permiso para leer el historial de la persona.';
          return false;
        }
        const page = this.organization.personHistory;
        const offset = Math.max(0, number(options && options.offset, 0));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.loading = true;
        page.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            '/people/' + encodeURIComponent(personId) + '/history?limit=' + HISTORY_LIMIT + '&offset=' + offset,
            { signal: controller ? controller.signal : undefined }
          );
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapHistoryItem).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.limit = number(payload.limit, HISTORY_LIMIT);
          page.offset = number(payload.offset, offset);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudo cargar el historial de la persona.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      organizationPersonHistoryNextPage() {
        const page = this.organization.personHistory;
        const personId = this.route && this.route.personId;
        if (!personId) return false;
        const next = page.offset + page.limit;
        if (next >= page.total) return false;
        return this.loadOrganizationPersonHistory(personId, { offset: next });
      },
      /* A person page needs the assignment/movement trail of the assets the
       * directory returns. The directory history only carries person metadata,
       * so the trail is read from each asset's own structured history. No
       * event is synthesized when an asset has none. */
      async loadOrganizationPersonAssetHistory(personId, options) {
        const page = this.organization.personAssetHistory;
        const id = text(personId);
        if (!id) return false;
        if (!this.organizationDirectoryMode) {
          page.items = [];
          page.total = 0;
          page.error = 'No tienes permiso para leer el directorio de personas.';
          return false;
        }
        if (!this.organizationAvailable('assets.view')) {
          page.items = [];
          page.total = 0;
          page.error = 'No tienes permiso para leer el historial de activos.';
          return false;
        }
        if (!this.organization.personAssets.loaded || (this.organization.personAssets.id !== id)) {
          await this.loadOrganizationPersonAssets(id, options);
          this.organization.personAssets.id = id;
        }
        const assets = this.organization.personAssets.items.slice();
        const epoch = nextEpoch();
        page.epoch = epoch;
        page.loading = true;
        page.error = '';
        const movements = ['assigned', 'returned', 'transferred'];
        const collected = [];
        try {
          for (const asset of assets) {
            const payload = await window.AssetAccess.request(
              this,
              '/assets/' + encodeURIComponent(asset.id) + '/history?limit=' + HISTORY_LIMIT + '&offset=0'
            );
            if (epoch !== page.epoch || !this.authenticated) return false;
            (Array.isArray(payload.items) ? payload.items : []).forEach(function (item) {
              const mapped = mapHistoryItem(item);
              if (!mapped || movements.indexOf(mapped.action) === -1) return;
              mapped.assetName = text(asset.name);
              mapped.quickCode = text(asset.code) || mapped.quickCodeNew || mapped.quickCodeOld;
              collected.push(mapped);
            });
          }
          if (epoch !== page.epoch || !this.authenticated) return false;
          collected.sort(function (left, right) {
            return String(right.recordedAt).localeCompare(String(left.recordedAt));
          });
          page.items = collected;
          page.total = collected.length;
          page.limit = HISTORY_LIMIT;
          page.offset = 0;
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudo cargar el historial de activos de la persona.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },

      /* ------------------------------------------------- people mutations */
      async saveOrganizationPerson() {
        const dialog = this.personDialog || {};
        const editing = dialog.mode === 'edit';
        const permission = editing ? 'people.edit' : 'people.create';
        if (!this.organizationAvailable(permission)) {
          this.personErrors.general = 'No tienes permiso para guardar personas.';
          if (this.showToast) this.showToast('No tienes permiso para guardar personas.', 'error');
          return false;
        }
        const body = {
          name: text(dialog.name),
          jobTitle: text(dialog.role) || null,
          departmentId: text(dialog.departmentId) || null,
          siteId: text(dialog.siteId) || null,
          contactEmail: text(dialog.email) || null,
          contactPhone: text(dialog.phone) || null,
          status: dialog.active ? STATUS_ACTIVE : STATUS_INACTIVE
        };
        if (!body.name) {
          this.personErrors.name = 'Introduce el nombre de la persona.';
          return false;
        }
        const state = this.organization;
        if (state.saveBusy) return false;
        state.saveBusy = true;
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, editing ? '/people/' + encodeURIComponent(dialog.id) : '/people', {
            method: editing ? 'PATCH' : 'POST',
            body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const person = mapPerson(payload);
          if (!person) throw new Error('El servidor no devolvió la persona guardada.');
          if (editing) {
            const index = state.people.items.findIndex(function (item) { return item.id === person.id; });
            if (index !== -1) state.people.items.splice(index, 1, person);
            if (state.personDetail.record && state.personDetail.record.id === person.id) state.personDetail.record = person;
          } else {
            state.people.items.unshift(person);
            state.people.total += 1;
            state.peopleTotals.total += 1;
            if (person.active) state.peopleTotals.active += 1;
          }
          this.personDialog.open = false;
          if (this.showToast) this.showToast(editing ? 'Persona actualizada.' : 'Persona creada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.personErrors.general = (error && error.message) || 'No se pudo guardar la persona.';
          return false;
        } finally {
          state.saveBusy = false;
        }
      },
      async saveOrganizationDepartment() {
        const dialog = this.departmentDialog || {};
        if (!this.organizationAvailable('config.departments')) {
          this.departmentErrors.general = 'No tienes permiso para administrar departamentos.';
          return false;
        }
        const name = text(dialog.label);
        if (!name) {
          this.departmentErrors.label = 'Introduce un nombre para el departamento.';
          return false;
        }
        const editing = dialog.mode === 'edit';
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, editing ? '/departments/' + encodeURIComponent(dialog.id) : '/departments', {
            method: editing ? 'PATCH' : 'POST',
            body: { name }
          });
          if (!this.organizationWriteOpen(token)) return false;
          const department = mapDepartment(payload);
          if (!department) throw new Error('El servidor no devolvió el departamento guardado.');
          const page = this.organization.departments;
          if (editing) {
            const index = page.items.findIndex(function (item) { return item.id === department.id; });
            if (index !== -1) page.items.splice(index, 1, department);
          } else {
            page.items.push(department);
            page.total += 1;
          }
          this.departmentDialog.open = false;
          if (this.showToast) this.showToast(editing ? 'Departamento actualizado.' : 'Departamento creado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.departmentErrors.general = (error && error.message) || 'No se pudo guardar el departamento.';
          return false;
        }
      },
      async setOrganizationPersonActive(person, active) {
        if (!person || !this.organizationAvailable('people.edit')) {
          if (this.showToast) this.showToast('No tienes permiso para cambiar el estado de una persona.', 'error');
          return false;
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/people/' + encodeURIComponent(person.id), {
            method: 'PATCH',
            body: { status: active ? STATUS_ACTIVE : STATUS_INACTIVE }
          });
          if (!this.organizationWriteOpen(token)) return false;
          const updated = mapPerson(payload);
          if (!updated) throw new Error('El servidor no devolvió la persona actualizada.');
          const page = this.organization.people;
          const index = page.items.findIndex(function (item) { return item.id === updated.id; });
          if (index !== -1) page.items.splice(index, 1, updated);
          if (this.organization.personDetail.record && this.organization.personDetail.record.id === updated.id) {
            this.organization.personDetail.record = updated;
          }
          if (this.showToast) this.showToast(updated.active ? 'Persona reactivada.' : 'Persona desactivada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.organizationShowError(error, 'No se pudo cambiar el estado de la persona.');
          return false;
        }
      },
      /* -------------------------------------------------- location hierarchy */
      openOrganizationLocationDialog(options) {
        if (!this.organizationAvailable('config.sites')) {
          this.showToast('No tienes permiso para administrar ubicaciones.', 'error');
          return false;
        }
        const opts = options || {};
        const location = opts.location || null;
        const wanted = text(opts.level) || (location && text(location.level)) || 'site';
        const level = LEVELS.indexOf(wanted) === -1 ? 'site' : wanted;
        const editing = !!location;
        const latitude = editing ? location.latitude : null;
        const longitude = editing ? location.longitude : null;
        this.organization.dialogs.location = {
          open: true,
          mode: editing ? 'edit' : 'create',
          id: editing ? text(location.id) : '',
          level,
          parentId: editing ? text(location.parentId) : text(opts.parentId),
          name: editing ? text(location.name) : '',
          description: editing ? text(location.description) : '',
          latitude: latitude === null || latitude === undefined ? '' : String(latitude),
          longitude: longitude === null || longitude === undefined ? '' : String(longitude),
          planRef: editing ? text(location.planRef) : '',
          planPage: editing ? text(location.planPage) : '',
          active: editing ? location.active !== false : true,
          error: '',
          fieldErrors: {},
          busy: false
        };
        return true;
      },
      closeOrganizationLocationDialog() {
        this.organization.dialogs.location.open = false;
      },
      organizationLocationParentValid(level, parentId) {
        const levels = { building: 'site', floor: 'building', room_zone: 'floor' };
        const wanted = levels[text(level)];
        if (!wanted) return true;
        const parent = this.organizationLocationById(parentId);
        return !!parent && parent.level === wanted;
      },
      async saveOrganizationLocationDialog() {
        const dialog = this.organization.dialogs.location;
        dialog.error = '';
        dialog.fieldErrors = {};
        if (!this.organizationAvailable('config.sites')) {
          dialog.error = 'No tienes permiso para administrar ubicaciones.';
          return false;
        }
        if (dialog.busy) return false;
        const editing = dialog.mode === 'edit';
        const level = text(dialog.level) || 'site';
        const name = text(dialog.name);
        if (!name) {
          dialog.fieldErrors.name = 'Introduce un nombre para la ubicación.';
          dialog.error = dialog.fieldErrors.name;
          return false;
        }
        if (name.length > 120) {
          dialog.fieldErrors.name = 'El nombre no puede superar 120 caracteres.';
          dialog.error = dialog.fieldErrors.name;
          return false;
        }
        const parentId = text(dialog.parentId);
        if (level !== 'site' && !parentId) {
          dialog.fieldErrors.parentId = 'Selecciona la ubicación de nivel superior.';
          dialog.error = dialog.fieldErrors.parentId;
          return false;
        }
        if (level !== 'site' && !this.organizationLocationParentValid(level, parentId)) {
          const wanted = { building: 'una sede', floor: 'un edificio', room_zone: 'un piso' }[level] || 'un nivel superior';
          dialog.fieldErrors.parentId = 'La ubicación superior debe ser ' + wanted + '.';
          dialog.error = dialog.fieldErrors.parentId;
          return false;
        }
        const latitude = text(dialog.latitude);
        const longitude = text(dialog.longitude);
        if (latitude || longitude) {
          if (!latitude || !longitude) {
            dialog.fieldErrors.latitude = 'Indica latitud y longitud juntas, o deja ambas vacías.';
            dialog.error = dialog.fieldErrors.latitude;
            return false;
          }
          if (level !== 'site') {
            dialog.fieldErrors.latitude = 'Solo una sede lleva coordenadas geográficas.';
            dialog.error = dialog.fieldErrors.latitude;
            return false;
          }
          const lat = Number(latitude);
          const lng = Number(longitude);
          if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            dialog.fieldErrors.latitude = 'Las coordenadas no son válidas.';
            dialog.error = dialog.fieldErrors.latitude;
            return false;
          }
        }
        const planRef = text(dialog.planRef);
        const planPage = text(dialog.planPage);
        if (level === 'site' && (planRef || planPage)) {
          dialog.fieldErrors.planRef = 'El plano pertenece a un piso, no a una sede.';
          dialog.error = dialog.fieldErrors.planRef;
          return false;
        }
        if (planPage && !planRef) {
          dialog.fieldErrors.planRef = 'Indica la referencia del plano antes de la página.';
          dialog.error = dialog.fieldErrors.planRef;
          return false;
        }

        const body = { name, description: text(dialog.description) };
        if (level === 'site') {
          body.latitude = latitude ? Number(latitude) : null;
          body.longitude = longitude ? Number(longitude) : null;
        } else if (editing) {
          // The floor is the level that owns a plan reference; an empty value
          // clears it explicitly instead of keeping a stale reference.
          body.planRef = planRef;
          body.planPage = planPage;
        } else {
          if (planRef) body.planRef = planRef;
          if (planPage) body.planPage = planPage;
        }
        if (!editing) {
          body.level = level;
          if (level !== 'site') body.parentId = parentId;
        } else {
          const record = this.organizationLocationById(dialog.id);
          if (record && text(record.parentId) !== parentId && level !== 'site') body.parentId = parentId;
          body.active = dialog.active !== false;
        }

        dialog.busy = true;
        const token = this.organizationWriteToken();
        try {
          const path = editing ? '/locations/' + encodeURIComponent(dialog.id) : '/locations';
          const payload = await window.AssetAccess.request(this, path, {
            method: editing ? 'PATCH' : 'POST',
            body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const mapped = mapLocation(payload);
          if (!mapped) throw new Error('El servidor no devolvió la ubicación guardada.');
          const page = this.organization.locations;
          if (editing) {
            const index = page.items.findIndex(function (item) { return item.id === mapped.id; });
            if (index !== -1) page.items.splice(index, 1, mapped);
          } else {
            page.items.push(mapped);
            page.total += 1;
          }
          dialog.open = false;
          this.showToast(editing ? 'Ubicación actualizada.' : 'Ubicación creada.');
          if (!this.organizationWriteOpen(token)) return false;
          await this.loadOrganizationLocations();
          return true;
        } catch (error) {
          if (error && error.name === 'AbortError') return false;
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo guardar la ubicación.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },
      async setOrganizationLocationActive(location, active) {
        if (!location || !text(location.id) || !this.organizationAvailable('config.sites')) {
          this.showToast('No tienes permiso para cambiar el estado de una ubicación.', 'error');
          return false;
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/locations/' + encodeURIComponent(location.id), {
            method: 'PATCH',
            body: { active: !!active }
          });
          if (!this.organizationWriteOpen(token)) return false;
          const mapped = mapLocation(payload);
          if (!mapped) throw new Error('El servidor no devolvió la ubicación actualizada.');
          const page = this.organization.locations;
          const index = page.items.findIndex(function (item) { return item.id === mapped.id; });
          if (index !== -1) page.items.splice(index, 1, mapped);
          this.showToast(mapped.active ? 'Ubicación activada.' : 'Ubicación desactivada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.organizationShowError(error, 'No se pudo cambiar el estado de la ubicación.');
          return false;
        }
      },
      async setOrganizationDepartmentActive(department, active) {
        if (!department || !text(department.id) || !this.organizationAvailable('config.departments')) {
          this.showToast('No tienes permiso para cambiar el estado de un departamento.', 'error');
          return false;
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/departments/' + encodeURIComponent(department.id), {
            method: 'PATCH',
            body: { active: !!active }
          });
          if (!this.organizationWriteOpen(token)) return false;
          const mapped = mapDepartment(payload);
          if (!mapped) throw new Error('El servidor no devolvió el departamento actualizado.');
          const page = this.organization.departments;
          const index = page.items.findIndex(function (item) { return item.id === mapped.id; });
          if (index !== -1) page.items.splice(index, 1, mapped);
          this.showToast(mapped.active ? 'Departamento activado.' : 'Departamento desactivado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.organizationShowError(error, 'No se pudo cambiar el estado del departamento.');
          return false;
        }
      },
      /* The pre-existing configuration dialogs call saveSite()/saveLocation().
       * Under server authority both feed the hierarchy dialog contract above,
       * so the legacy flat layout and the canonical levels share one writer. */
      async saveOrganizationLocation(site, location) {
        if (!this.organizationAvailable('config.sites')) {
          this.showToast('No tienes permiso para administrar ubicaciones.', 'error');
          return false;
        }
        const record = location && text(location.id) ? this.organizationLocationById(location.id) : null;
        if (record) return this.setOrganizationLocationActive(record, record.active === false);
        const level = site ? 'building' : 'site';
        this.openOrganizationLocationDialog({ level, parentId: site ? text(site.id) : '' });
        return false;
      },

      /* --------------------------------------------- assignments/movements */
      async confirmOrganizationAssignment() {
        const dialog = this.organization.dialogs.assign;
        if (!this.organizationAvailable('assets.assign')) {
          dialog.error = 'No tienes permiso para asignar responsables.';
          return false;
        }
        if (!this.assetAccessReadyForWrite()) return false;
        const assetId = text(dialog.assetId);
        const personId = text(dialog.selectedId || dialog.personId);
        if (!assetId || !personId) {
          dialog.error = 'Selecciona un activo y una persona.';
          return false;
        }
        if (dialog.busy) return false;
        dialog.busy = true;
        dialog.error = '';
        const token = this.organizationWriteToken();
        try {
          const body = { personId, reason: text(dialog.reason) || null, notes: text(dialog.notes) || null };
          if (text(dialog.effectiveAt)) {
            const effective = this.organizationEffectiveIso(dialog.effectiveAt);
            if (!effective) {
              dialog.error = 'Indica una fecha efectiva válida con zona horaria.';
              return false;
            }
            body.effectiveAt = effective;
          }
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(assetId) + '/assign', {
            method: 'POST',
            body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const asset = mapAsset(payload);
          if (!asset) throw new Error('El servidor no devolvió el activo asignado.');
          await this.organizationAfterAssetChange(asset, personId);
          if (!this.organizationWriteOpen(token)) return false;
          dialog.open = false;
          this.showToast('Responsable actualizado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo asignar el responsable.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },
      async returnOrganizationAssignment(asset, options) {
        if (!asset || !this.organizationAvailable('assets.assign')) {
          this.showToast('No tienes permiso para devolver responsables.', 'error');
          return false;
        }
        const audit = options || {};
        const body = {};
        if (text(audit.reason)) body.reason = text(audit.reason);
        if (text(audit.notes)) body.notes = text(audit.notes);
        if (text(audit.effectiveAt)) {
          const effective = this.organizationEffectiveIso(audit.effectiveAt);
          if (!effective) {
            this.showToast('Indica una fecha efectiva válida.', 'error');
            return false;
          }
          body.effectiveAt = effective;
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(asset.id) + '/return', {
            method: 'POST',
            body: body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const updated = mapAsset(payload);
          if (!updated) throw new Error('El servidor no devolvió el activo actualizado.');
          await this.organizationAfterAssetChange(updated, '');
          if (!this.organizationWriteOpen(token)) return false;
          this.showToast('Activo sin responsable.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.organizationShowError(error, 'No se pudo devolver el activo.');
          return false;
        }
      },
      openOrganizationTransfer(asset) {
        if (!asset) return false;
        if (!this.organizationAvailable('assets.edit')) {
          this.showToast('No tienes permiso para trasladar activos.', 'error');
          return false;
        }
        const siteId = text(asset.siteId);
        const locationId = text(asset.locationId);
        this.organization.dialogs.transfer = {
          open: true,
          assetId: text(asset.id),
          assetName: text(asset.name),
          siteId,
          locationId,
          // The origin is kept to reject an unchanged transfer before the write.
          originalSiteId: siteId,
          originalLocationId: locationId,
          reason: '',
          notes: '',
          effectiveAt: '',
          error: '',
          fieldErrors: {},
          busy: false
        };
        return true;
      },
      closeOrganizationTransfer() {
        this.organization.dialogs.transfer.open = false;
      },
      async confirmOrganizationTransfer() {
        const dialog = this.organization.dialogs.transfer;
        if (!this.organizationAvailable('assets.edit')) {
          dialog.error = 'No tienes permiso para trasladar activos.';
          return false;
        }
        if (!this.assetAccessReadyForWrite()) return false;
        if (dialog.busy) return false;
        dialog.error = '';
        dialog.fieldErrors = {};
        const siteId = text(dialog.siteId);
        const locationId = text(dialog.locationId);
        if (!siteId && !locationId) {
          dialog.fieldErrors = { siteId: 'Elige la sede o la ubicación de destino.' };
          dialog.error = 'Selecciona la sede o la ubicación de destino.';
          return false;
        }
        if (siteId === text(dialog.originalSiteId) && locationId === text(dialog.originalLocationId)) {
          dialog.fieldErrors = { locationId: 'El activo ya está en ese destino.' };
          dialog.error = 'El activo ya está en esa ubicación.';
          return false;
        }
        const body = {
          siteId: siteId || null,
          locationId: locationId || null,
          reason: text(dialog.reason) || null,
          notes: text(dialog.notes) || null
        };
        if (text(dialog.effectiveAt)) {
          const effective = this.organizationEffectiveIso(dialog.effectiveAt);
          if (!effective) {
            dialog.error = 'Indica una fecha efectiva válida con zona horaria.';
            return false;
          }
          body.effectiveAt = effective;
        }
        // The server owns the quick code: a transfer may reallocate it. The
        // permanent UUID and the technical fields stay untouched.
        dialog.busy = true;
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(dialog.assetId) + '/transfer', {
            method: 'POST',
            body
          });
          if (!this.organizationWriteOpen(token) || this.organization.dialogs.transfer !== dialog) return false;
          const asset = mapAsset(payload);
          if (!asset) throw new Error('El servidor no devolvió el activo trasladado.');
          await this.organizationAfterAssetChange(asset, '');
          if (!this.organizationWriteOpen(token)) return false;
          if (this.inventoryDetail && this.inventoryDetail.id === asset.id && typeof this.loadInventoryDetail === 'function') {
            await this.loadInventoryDetail(asset.id);
            if (!this.organizationWriteOpen(token)) return false;
            if (typeof this.loadInventoryHistory === 'function') await this.loadInventoryHistory(asset.id);
          }
          dialog.open = false;
          if (this.showToast) this.showToast('Activo trasladado.');
          return true;
        } catch (error) {
          if (error && error.name === 'AbortError') return false;
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo trasladar el activo.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },
      organizationEffectiveIso(value) {
        const raw = text(value);
        if (!raw) return '';
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return '';
        // The server requires a timezone-aware timestamp; the browser sends the
        // instant it selected, never a naive local string.
        return parsed.toISOString();
      },
      assetAccessReadyForWrite() {
        if (!this.authenticated) return false;
        if (!this.csrfToken) {
          this.showToast('La sesión no está lista para escribir. Vuelve a iniciar sesión.', 'error');
          return false;
        }
        return true;
      },
      async organizationAfterAssetChange(asset, personId) {
        const id = text(asset && asset.id);
        if (!id) return false;
        // Refresh the bounded server views the change affects; no prototype or
        // localStorage collection is touched.
        const tasks = [];
        const route = this.route || {};
        if (route.name === 'person' && route.personId && (!personId || personId === route.personId)) {
          tasks.push(this.loadOrganizationPersonAssets(route.personId));
          tasks.push(this.loadOrganizationPersonHistory(route.personId));
          tasks.push(this.loadOrganizationPersonAssetHistory(route.personId));
        }
        if (this.organization.relations.assetId === id) tasks.push(this.loadOrganizationRelations(id));
        // A server asset change also refreshes the open detail sheet and its
        // structured history, so the header actions and the trail stay truthful.
        if (this.inventoryDetail && this.inventoryDetail.id === id) {
          tasks.push(this.loadInventoryDetail(id));
          tasks.push(this.loadInventoryHistory(id));
        }
        if (this.organization.graph.loaded) tasks.push(this.reloadOrganizationGraph());
        if (this.organization.map.loaded) tasks.push(this.loadOrganizationMap({ siteId: this.organization.map.siteId }));
        await Promise.all(tasks);
        return true;
      },

      /* ------------------------------------------------------- asset search */
      async searchOrganizationAssets(query, options) {
        if (!this.organizationAvailable('assets.view')) return false;
        const page = this.organization.assetSearch;
        const term = text(query);
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.query = term;
        page.loading = true;
        page.error = '';
        try {
          const params = ['limit=' + PAGE_LIMIT, 'offset=0'];
          if (term) params.push('query=' + encodeURIComponent(term));
          if (options && options.unassigned) params.push('responsiblePersonId=');
          const payload = await window.AssetAccess.request(this, '/assets/search?' + params.join('&'), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapAsset).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudo buscar en el inventario del servidor.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      /* Debounced inventory search. Typed text from a caller (the assignment
       * sheet or the relation target field) asks the server for a bounded page;
       * without an explicit term the assignment sheet's own field is used. */
      scheduleOrganizationAssetSearch(query) {
        const state = this.organization;
        const term = typeof query === 'string' ? query : text(this.organization.dialogs.assign.search);
        if (state.assetSearchTimer) clearTimeout(state.assetSearchTimer);
        state.assetSearchTimer = setTimeout(() => {
          state.assetSearchTimer = null;
          if (!this.authenticated) return;
          const page = state.assetSearch;
          // Opening a sheet already read the unbounded first page: repeating the
          // same term would spend a second request on the page on screen.
          if (page.loaded && page.query === text(term)) return;
          this.searchOrganizationAssets(term);
        }, 250);
      },

      /* -------------------------------------------------------- relations */
      async loadOrganizationRelationTypes(options) {
        const state = this.organization.types;
        if (!this.organizationAvailable('assets.view')) {
          state.items = [];
          state.loaded = false;
          state.error = 'No tienes permiso para leer los tipos de relación del servidor.';
          return false;
        }
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        state.epoch = epoch;
        state.controller = controller;
        state.loading = true;
        state.error = '';
        try {
          const includeInactive = options && options.includeInactive ? '?includeInactive=true' : '';
          const payload = await window.AssetAccess.request(this, '/relationship-types' + includeInactive, {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== state.epoch || !this.authenticated) return false;
          state.items = (Array.isArray(payload) ? payload : []).map(mapRelationType).filter(Boolean);
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.items = [];
          state.loaded = false;
          state.error = (error && error.message) || 'No se pudieron cargar los tipos de relación.';
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },
      async loadOrganizationRelations(assetId, options) {
        const id = text(assetId);
        if (!id || !this.organizationAvailable('assets.view')) return false;
        const page = this.organization.relations;
        const offset = Math.max(0, number(options && options.offset, 0));
        if (page.controller) page.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        page.epoch = epoch;
        page.controller = controller;
        page.assetId = id;
        page.loading = true;
        page.error = '';
        try {
          const params = ['assetId=' + encodeURIComponent(id), 'direction=' + ((options && options.direction) || 'both'), 'limit=' + PAGE_LIMIT, 'offset=' + offset];
          if (options && options.typeKey) params.push('typeKey=' + encodeURIComponent(options.typeKey));
          const payload = await window.AssetAccess.request(this, '/relationships?' + params.join('&'), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== page.epoch || !this.authenticated) return false;
          page.items = (Array.isArray(payload.items) ? payload.items : []).map(mapLink).filter(Boolean);
          page.total = number(payload.total, page.items.length);
          page.limit = number(payload.limit, PAGE_LIMIT);
          page.offset = number(payload.offset, offset);
          page.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== page.epoch || (error && error.name === 'AbortError')) return false;
          page.items = [];
          page.total = 0;
          page.loaded = false;
          page.error = (error && error.message) || 'No se pudieron cargar las relaciones del activo.';
          return false;
        } finally {
          if (epoch === page.epoch) page.loading = false;
        }
      },
      openOrganizationRelationCreate(asset, defaults) {
        if (!this.organizationAvailable('assets.edit')) {
          this.showToast('No tienes permiso para crear relaciones.', 'error');
          return;
        }
        const type = (defaults && defaults.typeKey) || (this.organization.types.items[0] && this.organization.types.items[0].id) || '';
        this.organization.dialogs.relation = {
          open: true,
          mode: 'create',
          id: '',
          sourceId: text(asset && asset.id),
          targetId: '',
          typeKey: type,
          reason: '',
          notes: '',
          effectiveAt: '',
          error: '',
          busy: false
        };
      },
      openOrganizationRelationEdit(edge) {
        if (!edge || !this.organizationAvailable('assets.edit')) return;
        this.organization.dialogs.relation = {
          open: true,
          mode: 'edit',
          id: text(edge.id),
          sourceId: text(edge.from),
          targetId: text(edge.to),
          typeKey: text(edge.type),
          reason: text(edge.reason),
          notes: text(edge.notes),
          effectiveAt: '',
          error: '',
          busy: false
        };
      },
      closeOrganizationRelation() {
        this.organization.dialogs.relation.open = false;
      },
      async saveOrganizationRelation() {
        const dialog = this.organization.dialogs.relation;
        if (!this.organizationAvailable('assets.edit')) {
          dialog.error = 'No tienes permiso para guardar relaciones.';
          return false;
        }
        if (dialog.busy) return false;
        dialog.busy = true;
        dialog.error = '';
        const token = this.organizationWriteToken();
        try {
          const body = { typeKey: text(dialog.typeKey) };
          if (text(dialog.reason)) body.reason = text(dialog.reason);
          if (text(dialog.notes)) body.notes = text(dialog.notes);
          if (text(dialog.effectiveAt)) {
            const effective = this.organizationEffectiveIso(dialog.effectiveAt);
            if (!effective) {
              dialog.error = 'Indica una fecha efectiva válida con zona horaria.';
              return false;
            }
            body.effectiveAt = effective;
          }
          if (dialog.mode === 'create') {
            body.sourceId = text(dialog.sourceId);
            body.targetId = text(dialog.targetId);
            if (!body.sourceId || !body.targetId) {
              dialog.error = 'Selecciona el activo de origen y el de destino.';
              return false;
            }
            if (body.sourceId === body.targetId) {
              dialog.error = 'Un activo no puede relacionarse consigo mismo.';
              return false;
            }
          }
          const path = dialog.mode === 'create' ? '/relationships' : '/relationships/' + encodeURIComponent(dialog.id);
          const payload = await window.AssetAccess.request(this, path, {
            method: dialog.mode === 'create' ? 'POST' : 'PATCH',
            body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const mapped = mapLink(payload);
          if (!mapped) throw new Error('El servidor no devolvió la relación guardada.');
          const page = this.organization.relations;
          if (dialog.mode === 'edit') {
            const index = page.items.findIndex(function (item) { return item.id === mapped.id; });
            if (index !== -1) page.items.splice(index, 1, mapped);
          }
          if (page.assetId) await this.loadOrganizationRelations(page.assetId);
          if (!this.organizationWriteOpen(token)) return false;
          if (this.organization.graph.loaded) await this.reloadOrganizationGraph();
          if (!this.organizationWriteOpen(token)) return false;
          dialog.open = false;
          this.showToast(dialog.mode === 'create' ? 'Relación creada.' : 'Relación actualizada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo guardar la relación.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },
      async removeOrganizationRelation(edge) {
        if (!edge || !this.organizationAvailable('assets.edit')) {
          this.showToast('No tienes permiso para eliminar relaciones.', 'error');
          return false;
        }
        const token = this.organizationWriteToken();
        try {
          await window.AssetAccess.request(this, '/relationships/' + encodeURIComponent(edge.id), {
            method: 'DELETE',
            body: {}
          });
          if (!this.organizationWriteOpen(token)) return false;
          const page = this.organization.relations;
          page.items = page.items.filter(function (item) { return item.id !== edge.id; });
          page.total = Math.max(0, page.total - 1);
          if (!this.organizationWriteOpen(token)) return false;
          if (this.organization.graph.loaded) await this.reloadOrganizationGraph();
          if (!this.organizationWriteOpen(token)) return false;
          this.showToast('Relación eliminada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.organizationShowError(error, 'No se pudo eliminar la relación.');
          return false;
        }
      },
      /* The host dialog may open before any asset page has been read, so the
       * child label comes from a server record already on screen: the open
       * detail, the bounded search page or the composed graph/map source. It
       * never comes from a prototype asset or from localStorage. */
      organizationAssetName(assetId) {
        const id = text(assetId);
        if (!id) return '';
        const detail = this.inventoryDetail;
        if (detail && text(detail.id) === id) {
          const asset = detail.asset;
          if (asset && text(asset.name)) return text(asset.name);
        }
        const pages = [this.organization.assetSearch.items];
        if (this.organization.graph.loaded) pages.push(this.organizationGraphSource.assets);
        for (const items of pages) {
          const hit = (items || []).find(function (item) { return text(item.id) === id; });
          if (hit) return text(hit.name) || text(hit.code);
        }
        return '';
      },
      openOrganizationHostMove(edge, options) {
        if (!edge || !this.organizationAvailable('assets.edit')) return;
        // The canonical payload is directed source -> target. `from` is the
        // hosted child in both views: the direction only changes the labels the
        // caller reads, never the endpoints.
        const childId = text(edge.from);
        this.organization.dialogs.hostMove = {
          open: true,
          childId,
          childName: text(options && options.childName) || this.organizationAssetName(childId),
          search: '',
          newHostId: '',
          reason: '',
          notes: '',
          effectiveAt: '',
          error: '',
          busy: false
        };
        // The destination list is a bounded server page. Opening the dialog
        // reads it once; later keystrokes replace it through the same query.
        this.searchOrganizationAssets('');
      },
      selectOrganizationHost(assetId) {
        const dialog = this.organization.dialogs.hostMove;
        if (!dialog.open) return;
        dialog.newHostId = text(assetId);
        dialog.error = '';
      },
      closeOrganizationHostMove() {
        this.organization.dialogs.hostMove.open = false;
      },
      async confirmOrganizationHostMove() {
        const dialog = this.organization.dialogs.hostMove;
        if (!this.organizationAvailable('assets.edit')) {
          dialog.error = 'No tienes permiso para mover hosts.';
          return false;
        }
        if (dialog.busy) return false;
        const childId = text(dialog.childId);
        if (!childId) {
          dialog.error = 'No se identificó el activo que cambia de host.';
          return false;
        }
        if (!text(dialog.newHostId)) {
          dialog.error = 'Selecciona el host de destino.';
          return false;
        }
        // The server requires a reason of at least four characters; the sheet
        // reports the same minimum instead of sending a request it knows the
        // server will reject.
        const reason = text(dialog.reason);
        if (reason.length < 4) {
          dialog.error = 'Escribe un motivo de al menos 4 caracteres.';
          return false;
        }
        dialog.busy = true;
        dialog.error = '';
        const token = this.organizationWriteToken();
        try {
          const body = { childId, newHostId: text(dialog.newHostId), reason, notes: text(dialog.notes) || null };
          if (text(dialog.effectiveAt)) {
            const effective = this.organizationEffectiveIso(dialog.effectiveAt);
            if (!effective) {
              dialog.error = 'Indica una fecha efectiva válida con zona horaria.';
              return false;
            }
            body.effectiveAt = effective;
          }
          const payload = await window.AssetAccess.request(this, '/relationships/host-move', { method: 'POST', body });
          if (!this.organizationWriteOpen(token)) return false;
          if (!payload || !payload.newRelationship) throw new Error('El servidor no devolvió el host actualizado.');
          const oldHostId = text(payload.oldRelationship && payload.oldRelationship.targetId);
          const newHostId = text(payload.newRelationship.targetId) || body.newHostId;
          const page = this.organization.relations;
          if (page.assetId) await this.loadOrganizationRelations(page.assetId);
          if (!this.organizationWriteOpen(token)) return false;
          if (this.organization.graph.loaded) await this.reloadOrganizationGraph();
          if (!this.organizationWriteOpen(token)) return false;
          // The move is recorded on the child and on both hosts, so an open
          // detail page shows its structured history without a manual reload.
          await this.refreshOrganizationHostHistory([childId, oldHostId, newHostId]);
          if (!this.organizationWriteOpen(token)) return false;
          dialog.open = false;
          this.showToast('Host actualizado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo mover el host.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },
      async refreshOrganizationHostHistory(assetIds) {
        const detail = this.inventoryDetail;
        const id = text(detail && detail.id);
        if (!id) return false;
        if ((assetIds || []).map(text).indexOf(id) === -1) return false;
        if (typeof this.loadInventoryDetail !== 'function') return false;
        await this.loadInventoryDetail(id);
        if (typeof this.loadInventoryHistory === 'function') await this.loadInventoryHistory(id);
        return true;
      },
      openOrganizationTypeDialog(type) {
        if (!this.organizationAvailable('config.general')) {
          this.showToast('No tienes permiso para configurar tipos de relación.', 'error');
          return;
        }
        this.organization.dialogs.type = type
          ? {
            open: true,
            mode: 'edit',
            key: text(type.key),
            forwardLabel: text(type.label),
            inverseLabel: text(type.inverse),
            containment: !!type.containment,
            active: type.active !== false,
            error: '',
            busy: false
          }
          : { open: true, mode: 'create', key: '', forwardLabel: '', inverseLabel: '', containment: false, active: true, error: '', busy: false };
      },
      closeOrganizationTypeDialog() {
        this.organization.dialogs.type.open = false;
      },
      async saveOrganizationType() {
        const dialog = this.organization.dialogs.type;
        if (!this.organizationAvailable('config.general')) {
          dialog.error = 'No tienes permiso para configurar tipos de relación.';
          return false;
        }
        if (dialog.busy) return false;
        dialog.busy = true;
        dialog.error = '';
        const token = this.organizationWriteToken();
        try {
          const editing = dialog.mode === 'edit';
          const body = {
            forwardLabel: text(dialog.forwardLabel),
            inverseLabel: text(dialog.inverseLabel),
            containment: !!dialog.containment
          };
          if (editing) body.active = dialog.active !== false;
          else body.key = text(dialog.key);
          if (!body.forwardLabel || !body.inverseLabel) {
            dialog.error = 'Indica la etiqueta directa y la inversa.';
            return false;
          }
          if (!editing && !body.key) {
            dialog.error = 'Indica la clave estable del tipo.';
            return false;
          }
          await window.AssetAccess.request(this, editing ? '/relationship-types/' + encodeURIComponent(dialog.key) : '/relationship-types', {
            method: editing ? 'PATCH' : 'POST',
            body
          });
          if (!this.organizationWriteOpen(token)) return false;
          await this.loadOrganizationRelationTypes({ includeInactive: true });
          if (!this.organizationWriteOpen(token)) return false;
          dialog.open = false;
          this.showToast('Tipo de relación guardado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo guardar el tipo de relación.';
          return false;
        } finally {
          dialog.busy = false;
        }
      },

      /* ------------------------------------------------------------ graph */
      async loadOrganizationGraph(options) {
        if (!this.organizationAvailable('assets.view')) return false;
        const state = this.organization.graph;
        const next = Object.assign({}, state, options || {});
        const rootId = text(next.rootId);
        const depth = Math.min(5, Math.max(1, number(next.depth, 2)));
        const direction = ['out', 'in', 'both'].indexOf(next.direction) === -1 ? 'both' : next.direction;
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        state.epoch = epoch;
        state.controller = controller;
        state.loading = true;
        state.error = '';
        try {
          const params = ['depth=' + depth, 'direction=' + direction, 'limit=' + GRAPH_NODE_LIMIT, 'offset=' + number(next.offset, 0)];
          if (rootId) params.push('rootId=' + encodeURIComponent(rootId));
          if (next.typeKey) params.push('typeKey=' + encodeURIComponent(next.typeKey));
          (Array.isArray(next.assetIds) ? next.assetIds : []).slice(0, 50).forEach(function (id) {
            params.push('assetIds=' + encodeURIComponent(id));
          });
          const payload = await window.AssetAccess.request(this, '/infrastructure/graph?' + params.join('&'), {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== state.epoch || !this.authenticated) return false;
          state.rootId = text(payload.rootId);
          state.depth = number(payload.depth, depth);
          state.direction = text(payload.direction) || direction;
          state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
          state.edges = Array.isArray(payload.edges) ? payload.edges : [];
          state.total = number(payload.total, state.edges.length);
          state.limit = number(payload.limit, GRAPH_NODE_LIMIT);
          state.offset = number(payload.offset, 0);
          state.truncated = !!payload.truncated;
          state.nodesTruncated = !!payload.nodesTruncated;
          state.edgesTruncated = !!payload.edgesTruncated;
          state.depthTruncated = !!payload.depthTruncated;
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.nodes = [];
          state.edges = [];
          state.loaded = false;
          state.error = (error && error.message) || 'No se pudo cargar el grafo de infraestructura.';
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },
      reloadOrganizationGraph() {
        const state = this.organization.graph;
        return this.loadOrganizationGraph({
          rootId: state.rootId,
          assetIds: state.assetIds,
          depth: state.depth,
          direction: state.direction,
          typeKey: state.typeKey
        });
      },

      /* -------------------------------------------------------------- map */
      /* The map needs every canonical asset to keep unpositioned equipment in
       * its room/floor group. `/assets/search` is read in bounded MAX_LIMIT
       * pages until the canonical total is covered; each page shares the map
       * request's abort signal, so a logout or newer map load stops the walk. */
      async loadOrganizationAssetPool(signal) {
        const items = [];
        let offset = 0;
        let total = 0;
        for (;;) {
          const payload = await window.AssetAccess.request(
            this,
            '/assets/search?limit=' + MAX_LIMIT + '&offset=' + offset,
            { signal }
          );
          const page = Array.isArray(payload && payload.items) ? payload.items : [];
          items.push.apply(items, page);
          total = Math.max(number(payload && payload.total, 0), items.length);
          const next = number(payload && payload.offset, offset) + page.length;
          if (!page.length || next <= offset || items.length >= total) {
            return { items, total, truncated: items.length < total };
          }
          offset = next;
        }
      },
      async loadOrganizationMap(options) {
        if (!this.organizationAvailable('assets.view')) return false;
        const state = this.organization.map;
        const siteId = text(options && options.siteId);
        const offset = Math.max(0, number(options && options.offset, 0));
        if (state.controller) state.controller.abort();
        const epoch = nextEpoch();
        const controller = makeController();
        state.epoch = epoch;
        state.controller = controller;
        state.loading = true;
        state.error = '';
        try {
          await this.loadOrganizationLocations();
          const params = ['limit=' + PAGE_LIMIT, 'offset=' + offset];
          if (siteId) params.push('siteId=' + encodeURIComponent(siteId));
          const [payload, pool] = await Promise.all([
            window.AssetAccess.request(this, '/map?' + params.join('&'), {
              signal: controller ? controller.signal : undefined
            }),
            // The pool is presentation context for unpositioned grouping. A
            // denied/failed secondary read leaves `/map` authoritative instead
            // of turning the whole explorer into a false error.
            this.loadOrganizationAssetPool(controller ? controller.signal : undefined)
              .catch(function () { return null; })
          ]);
          if (epoch !== state.epoch || !this.authenticated) return false;
          state.siteId = siteId;
          state.sites = Array.isArray(payload.sites) ? payload.sites : [];
          state.positions = Array.isArray(payload.positions) ? payload.positions : [];
          state.assets = pool && Array.isArray(pool.items) ? pool.items : [];
          state.assetsTruncated = pool ? Number(pool.total) > (Array.isArray(pool.items) ? pool.items.length : 0) : false;
          state.limit = number(payload.limit, PAGE_LIMIT);
          state.offset = number(payload.offset, offset);
          state.truncated = !!payload.truncated;
          state.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== state.epoch || (error && error.name === 'AbortError')) return false;
          state.sites = [];
          state.positions = [];
          state.assets = [];
          state.assetsTruncated = false;
          state.loaded = false;
          state.error = (error && error.message) || 'No se pudieron cargar los datos del mapa.';
          return false;
        } finally {
          if (epoch === state.epoch) state.loading = false;
        }
      },

      /* Canonical positions are relative decimals on the asset; the canvas keeps
       * its own pixel space, so the conversion happens here and never invents a
       * coordinate for an unpositioned asset. */
      async saveOrganizationPosition(assetId, floorId, x, y) {
        if (!this.organizationAvailable('assets.edit')) {
          this.showToast('No tienes permiso para editar activos.', 'error');
          return false;
        }
        const id = text(assetId);
        if (!id) return false;
        const asset = this.organizationMapSource.assets.find(function (item) { return item.id === id; });
        const locationId = text(asset && asset.locationId) || text(floorId);
        if (!locationId) {
          this.showToast('El activo necesita una ubicación antes de guardar una posición.', 'error');
          return false;
        }
        const body = { locationId: locationId, positionX: null, positionY: null };
        const point = this.organizationCanonicalPoint(x, y, floorId);
        if (point) {
          // An explicit 0 is a real coordinate; absent or blank input clears the
          // position instead of writing an origin the operator never chose.
          body.positionX = String(point.x);
          body.positionY = String(point.y);
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const updated = mapAsset(payload);
          if (updated) {
            const state = this.organization.map;
            state.positions = state.positions.map(function (item) {
              return item.assetId === updated.id
                ? Object.assign({}, item, {
                  locationId: updated.locationId,
                  x: updated.positionX === null || updated.positionX === '' ? null : Number(updated.positionX),
                  y: updated.positionY === null || updated.positionY === '' ? null : Number(updated.positionY)
                })
                : item;
            });
          }
          this.showToast('Posición guardada.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          this.showToast((error && error.message) || 'No se pudo guardar la posición.', 'error');
          return false;
        }
      },
      organizationCanonicalPoint(x, y, floorId) {
        const bounds = this.organizationPlanBounds(floorId);
        const width = bounds.width || DEFAULT_PLAN.width;
        const height = bounds.height || DEFAULT_PLAN.height;
        return canonicalFromPixels(x, y, { width: width, height: height });
      },

      /* --------------------------------------------------------- lifecycle */
      handleOrganizationRoute(next) {
        if (!this.authenticated || !next) return false;
        this.cancelOrganizationSearchTimers();
        if (next.name === 'people') {
          return Promise.all([
            this.loadOrganizationPeople({ offset: 0 }),
            this.loadOrganizationPeopleTotals(),
            this.loadOrganizationDepartments(),
            this.loadOrganizationLocations()
          ]);
        }
        if (next.name === 'person' && next.personId) {
          return Promise.all([
            this.loadOrganizationPerson(next.personId),
            this.loadOrganizationPersonAssets(next.personId),
            this.loadOrganizationPersonAssetHistory(next.personId),
            this.loadOrganizationPersonHistory(next.personId),
            this.loadOrganizationDepartments(),
            this.loadOrganizationLocations()
          ]);
        }
        if (next.name === 'detail' && next.assetId) {
          const tasks = [];
          if (this.can('people.view')) tasks.push(this.loadOrganizationRelationTypes());
          tasks.push(this.loadOrganizationRelations(next.assetId));
          return Promise.all(tasks);
        }
        if (next.name === 'graph') {
          const rootId = next.focusId || '';
          return Promise.all([
            this.loadOrganizationRelationTypes(),
            this.loadOrganizationGraph({ rootId })
          ]);
        }
        if (next.name === 'map') {
          return this.loadOrganizationMap({ siteId: '' });
        }
        if (next.name === 'config' && ['personas', 'sedes', 'mapas', 'relaciones'].indexOf(next.section) !== -1) {
          const tasks = [];
          if (this.can('people.view')) tasks.push(this.loadOrganizationDepartments());
          if (this.can('assets.view')) tasks.push(this.loadOrganizationLocations());
          if (next.section === 'mapas' && this.can('assets.view')) tasks.push(this.loadOrganizationTree({ depth: 4 }));
          if (next.section === 'relaciones' && this.can('assets.view')) tasks.push(this.loadOrganizationRelationTypes({ includeInactive: true }));
          return Promise.all(tasks);
        }
        return false;
      },
      clearOrganizationState() {
        const state = this.organization;
        [
          state.people,
          state.departments,
          state.locations,
          state.tree,
          state.personAssets,
          state.personHistory,
          state.personAssetHistory,
          state.entityHistory,
          state.types,
          state.relations,
          state.graph,
          state.map,
          state.assetSearch
        ].forEach(function (resource) {
          if (resource && resource.controller) resource.controller.abort();
        });
        Object.keys(state.dialogs).forEach(function (key) {
          state.dialogs[key].open = false;
        });
        this.cancelOrganizationSearchTimers();
        state.sessionEpoch = nextSessionEpoch();
        state.people = pageState();
        state.peopleTotals = { total: 0, active: 0, loaded: false, error: '', epoch: nextEpoch() };
        state.departments = pageState(MAX_LIMIT);
        state.locations = pageState(MAX_LIMIT);
        state.tree = treeState();
        state.personDetail = detailState();
        state.personAssets = pageState();
        state.personHistory = pageState(HISTORY_LIMIT);
        state.personAssetHistory = pageState(HISTORY_LIMIT);
        state.entityHistory = pageState(HISTORY_LIMIT);
        state.types = typesState();
        state.relations = pageState();
        state.graph = graphState();
        state.map = mapState();
        state.assetSearch = pageState();
        state.dialogs = createDialogs();
        state.saveBusy = false;
      },

      organizationLocationChildren(parentId, level) {
        const parent = text(parentId);
        if (!parent) return [];
        const wanted = text(level);
        return this.organization.locations.items
          .filter((item) => item.parentId === parent && (!wanted || item.level === wanted))
          .slice()
          .sort(function (left, right) {
            return String(left.name).localeCompare(String(right.name));
          });
      },
      organizationLevelName(level) {
        return LEVEL_LABELS[text(level)] || text(level);
      },
      // Old/new pairs straight from the structured history payload. Nothing is
      // inferred for a field the server did not report.
      organizationHistoryChanges(item) {
        const changes = item && item.changes;
        if (!changes || typeof changes !== 'object') return [];
        const labels = {
          site_id: 'Sede',
          location_id: 'Ubicación',
          responsible: 'Responsable',
          responsible_person_id: 'Responsable',
          status: 'Estado',
          quick_code: 'Código rápido',
          host: 'Host',
          name: 'Nombre',
          description: 'Descripción',
          parent_id: 'Ubicación superior',
          plan_ref: 'Plano',
          plan_page: 'Página del plano',
          latitude: 'Latitud',
          longitude: 'Longitud',
          active: 'Activo'
        };
        return Object.keys(changes).map(function (key) {
          const entry = changes[key] || {};
          return {
            key: key,
            label: labels[key] || key,
            old: entry.old === null || entry.old === undefined ? '—' : String(entry.old),
            new: entry.new === null || entry.new === undefined ? '—' : String(entry.new)
          };
        });
      },
      formatServerTimestamp(value) {
        const raw = text(value);
        if (!raw) return '';
        const date = new Date(raw);
        if (isNaN(date.getTime())) return raw;
        try {
          return new Intl.DateTimeFormat('es-PY', {
            dateStyle: 'medium', timeStyle: 'short'
          }).format(date);
        } catch (error) {
          return raw;
        }
      },
      personAssetCountLabel(person) {
        if (!this.serverOrganizationMode || !person) return this.personAssetCount(person && person.id);
        if (this.route && this.route.name === 'person' && this.route.personId === person.id) {
          return this.organization.personAssets.total;
        }
        return this.organization.personAssets.personId === person.id ? this.organization.personAssets.total : '—';
      },
      assetSiteLocations(siteId) {
        if (!this.serverOrganizationMode) return window.AssetAdminMethods.assetSiteLocations.call(this, siteId);
        const site = text(siteId);
        if (!site) return [];
        const list = this.organization.locations.items;
        const index = {};
        list.forEach(function (location) { index[location.id] = location; });
        function rootOf(location) {
          let current = location;
          let guard = 0;
          while (current && current.parentId && guard < 10) {
            const parent = index[current.parentId];
            if (!parent) break;
            current = parent;
            guard += 1;
          }
          return current ? current.id : '';
        }
        return list.filter(function (location) {
          return location.level !== 'site' && rootOf(location) === site;
        }).map(function (location) {
          return { id: location.id, label: location.levelLabel + ' · ' + location.name };
        });
      },
      assetActivePeople() {
        if (!this.serverOrganizationMode) return window.AssetAdminMethods.assetActivePeople.call(this);
        return this.organization.people.items.filter(function (person) { return person.active; })
          .map(function (person) { return { id: person.id, name: person.name, role: person.role }; });
      },
      siteLabel(siteId) {
        const key = text(siteId);
        if (!this.serverOrganizationMode) return window.AssetMethods.siteLabel.call(this, siteId);
        if (!key) return '';
        const site = this.organizationServerSites.find(function (item) { return item.id === key; });
        return site ? site.label : '';
      },
      locationLabel(asset) {
        if (!this.serverOrganizationMode) return window.AssetConfigMethods.locationLabel.call(this, asset);
        if (!asset) return '';
        const key = text(asset.locationId);
        if (key) {
          const location = this.organizationLocationById(key);
          if (location) return location.name;
        }
        return text(asset.location);
      },

      /* ------------------------- overrides of the prototype people surface */
      assetDisplayLabel(asset) {
        if (!asset) return '';
        const code = text(asset.code || asset.quickCode);
        const name = text(asset.name);
        if (code && name) return code + ' · ' + name;
        return code || name || text(asset.id);
      },
      personById(id) {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.personById.call(this, id);
        return this.organizationPersonById(id);
      },
      personAssetCount(id) {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.personAssetCount.call(this, id);
        if (this.route && this.route.name === 'person' && this.route.personId === id) {
          return this.organization.personAssets.total;
        }
        return 0;
      },
      activePeopleCount() {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.activePeopleCount.call(this);
        return this.organization.peopleTotals.active;
      },
      peopleWithAssetsCount() {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.peopleWithAssetsCount.call(this);
        return this.organization.peopleTotals.withAssets;
      },
      savePerson() {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.savePerson.call(this);
        return this.saveOrganizationPerson();
      },
      setPersonActive(person, active) {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.setPersonActive.call(this, person, active);
        return this.setOrganizationPersonActive(person, active);
      },
      saveDepartment() {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.saveDepartment.call(this);
        return this.saveOrganizationDepartment();
      },
      openAssignAsset(asset) {
        if (!this.serverOrganizationMode || !asset) return window.AssetPeopleMethods.openAssignAsset.call(this, asset);
        if (!this.organizationAvailable('assets.assign')) {
          this.showToast('No tienes permiso para asignar responsables.', 'error');
          return;
        }
        const currentId = text(asset.responsiblePersonId || asset.assigneeId);
        this.assignDialog = {
          open: true,
          mode: 'person',
          assetId: text(asset.id),
          assetLabel: this.assetDisplayLabel(asset),
          personId: currentId,
          selectedId: currentId,
          search: '',
          reason: '',
          notes: '',
          effectiveAt: '',
          error: ''
        };
        // The picker needs the server directory; the detail route does not load it.
        if (!this.organization.people.loaded) this.loadOrganizationPeople({ offset: 0 });
      },
      openAssignPerson(person) {
        if (!this.serverOrganizationMode || !person) return window.AssetPeopleMethods.openAssignPerson.call(this, person);
        if (!person.active) {
          this.showToast('Reactiva la persona antes de asignarle activos.', 'error');
          return;
        }
        if (!this.organizationAvailable('assets.assign')) {
          this.showToast('No tienes permiso para asignar activos.', 'error');
          return;
        }
        this.assignDialog = {
          open: true,
          mode: 'asset',
          assetId: '',
          assetLabel: '',
          personId: person.id,
          selectedId: '',
          search: '',
          reason: '',
          notes: '',
          effectiveAt: '',
          error: ''
        };
        this.searchOrganizationAssets('');
      },
      closeAssignDialog() {
        this.assignDialog = {
          open: false, mode: 'person', assetId: '', assetLabel: '', personId: '',
          selectedId: '', search: '', reason: '', notes: '', effectiveAt: '', error: ''
        };
      },
      selectAssignPerson(id) {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.selectAssignPerson.call(this, id);
        const person = this.organizationPersonById(id);
        const currentId = this.assignDialog.personId;
        if (person && !person.active && person.id !== currentId) return;
        this.assignDialog.selectedId = id || '';
      },
      confirmAssignment() {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.confirmAssignment.call(this);
        if (!this.organizationAvailable('assets.assign')) {
          this.assignDialog.error = 'No tienes permiso para cambiar responsables.';
          return false;
        }
        const dialog = this.assignDialog;
        const assetId = dialog.mode === 'asset' ? text(dialog.selectedId) : text(dialog.assetId);
        if (!assetId) {
          dialog.error = dialog.mode === 'asset'
            ? 'Selecciona un activo para asignar.'
            : 'El activo ya no está disponible.';
          return false;
        }
        const target = dialog.mode === 'asset' ? text(dialog.personId) : text(dialog.selectedId);
        if (!target) {
          // An empty selection is a canonical return: it keeps the reason,
          // notes and effective time the operator typed.
          return this.returnOrganizationAssignment({ id: assetId }, {
            reason: text(dialog.reason) || null,
            notes: text(dialog.notes) || null,
            effectiveAt: text(dialog.effectiveAt)
          }).then((ok) => { if (ok) this.closeAssignDialog(); return ok; });
        }
        return this.assignServerAsset(assetId, target, {
          reason: text(dialog.reason) || null,
          notes: text(dialog.notes) || null,
          effectiveAt: text(dialog.effectiveAt)
        }).then((ok) => { if (ok) this.closeAssignDialog(); return ok; });
      },
      removeAssignment(asset) {
        if (!this.serverOrganizationMode) return window.AssetPeopleMethods.removeAssignment.call(this, asset);
        if (!asset) return;
        this.openAssignAsset(asset);
        this.assignDialog.selectedId = '';
        this.assignDialog.personId = '';
      },
      async assignServerAsset(assetId, personId, options) {
        const dialog = this.assignDialog;
        const body = { personId: personId, reason: options.reason, notes: options.notes };
        if (options.effectiveAt) {
          const effective = this.organizationEffectiveIso(options.effectiveAt);
          if (!effective) {
            dialog.error = 'Indica una fecha efectiva válida con zona horaria.';
            return false;
          }
          body.effectiveAt = effective;
        }
        const token = this.organizationWriteToken();
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(assetId) + '/assign', {
            method: 'POST',
            body: body
          });
          if (!this.organizationWriteOpen(token)) return false;
          const asset = mapAsset(payload);
          if (!asset) throw new Error('El servidor no devolvió el activo asignado.');
          await this.organizationAfterAssetChange(asset, personId);
          if (!this.organizationWriteOpen(token)) return false;
          this.showToast('Activo asignado.');
          return true;
        } catch (error) {
          if (!this.organizationWriteOpen(token)) return false;
          dialog.error = (error && error.message) || 'No se pudo asignar el activo.';
          return false;
        }
      }
    }
  };
})();
