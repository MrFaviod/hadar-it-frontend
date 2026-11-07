(function () {
  'use strict';

  const Engine = window.AssetMapEngine;
  const Data = window.AssetMapData;
  const FloorLogic = window.AssetMapFloorLogic || { computed: {}, methods: {} };

  // The canonical map payload carries organization geometry only. Cartographic
  // preferences (base, labels, clusters, camera) are local presentation state
  // persisted in `app.maps.prefs`, so they are composed for reads when the
  // active map model has none. Nothing is written to either side.
  function mapsWithPrefs(maps, app) {
    if (!maps || maps.prefs) return maps;
    const local = Engine.mapsOf(app);
    if (!local || !local.prefs) return maps;
    return Object.assign({}, maps, { prefs: local.prefs });
  }

  // The explorer keeps the geographic view and the interior floor view in one
  // component so filters, selection and the location tree survive when the
  // manager moves between them. MapLibre is instantiated once and only hidden
  // while a floor is open, which keeps pan/zoom state intact.
  const MapExplorer = {
    name: 'MapExplorer',
    props: {
      app: { type: Object, required: true },
      focusId: { type: String, default: '' }
    },
    data() {
      const shared = (this.app && this.app.explorerFilters) || {};
      return {
        filters: {
          categories: Array.isArray(shared.categories) ? shared.categories.slice() : [],
          sites: Array.isArray(shared.sites) ? shared.sites.slice() : [],
          states: (shared.states || []).slice(),
          locations: (shared.locations || []).slice(),
          search: shared.search || ''
        },
        level: 'geo',
        activeSiteId: '',
        activeFloorId: '',
        openSiteId: '',
        openBuildingId: '',
        selectedId: (this.app && this.app.explorerSelection) || '',
        selectedRoom: '',
        floorZoom: 1,
        filtersOpen: false,
        layersOpen: false,
        screenClusters: [],
        screenLabels: [],
        mapZoom: 0,
        mapReady: false,
        mapError: '',
        reduced: false,
        announce: '',
        drag: null,
        resizeObserver: null,
        syncFrame: 0,
        // Authenticated floor plan + selected asset detail. The plan image is a
        // revoked object URL, never a filesystem path or unauthenticated URL.
        floorPlanState: 'idle',
        floorPlanMeta: null,
        floorPlanSrc: '',
        floorPlanError: '',
        floorPlanVisible: true,
        floorViewport: null,
        selectedDetail: null
      };
    },
    computed: Object.assign({}, FloorLogic.computed, {
      source() {
        const app = this.app;
        if (!app || !app.serverMapMode) return app;
        const org = app.organizationMapSource;
        if (this._sourceFor === org) return this._source;
        const proxy = new Proxy(app, {
          get(target, prop) {
            if (prop === 'assets') return org.assets;
            if (prop === 'sites') return org.sites;
            if (prop === 'maps') return mapsWithPrefs(org.maps, target);
            if (prop === 'categories') return org.categories;
            if (prop === 'assetAdmin') return org.assetAdmin;
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
        this._source = proxy;
        this._sourceFor = org;
        return proxy;
      },
      maps() {
        return Engine.mapsOf(this.source);
      },
      prefs() {
        return this.maps.prefs;
      },
      categories() {
        return this.app.categories || [];
      },
      sites() {
        return this.app.sites || [];
      },
      statuses() {
        return Engine.statusOptions(this.source);
      },
      canEdit() {
        return typeof this.app.can === 'function' ? this.app.can('assets.edit') : true;
      },
      counts() {
        return Engine.counts(this.source, this.filters);
      },
      tree() {
        return Engine.tree(this.source, this.filters);
      },
      sitePoints() {
        return Engine.sitePoints(this.source, this.filters);
      },
      serverMapMode() {
        return !!(this.app && this.app.serverMapMode);
      },
      plan() {
        if (!this.serverMapMode) return this.floorView ? this.floorView.plan : null;
        const meta = this.floorPlanMeta;
        if (!meta || !this.floorPlanSrc) return null;
        return {
          id: 'plan-' + this.activeFloorId,
          floor: this.activeFloorId,
          name: meta.planRef || meta.planPage || (this.floorContext && this.floorContext.floorName) || 'Plano de planta',
          src: this.floorPlanSrc,
          width: Number(meta.width) || Engine.PLAN_W,
          height: Number(meta.height) || Engine.PLAN_H,
          format: meta.contentType || '',
          visible: this.floorPlanVisible,
          opacity: Number(this.prefs.planOpacity) || 1
        };
      },
      availablePlans() {
        if (!this.serverMapMode) return this.maps.plans;
        return this.plan ? [this.plan] : [];
      },
      selectedAsset() {
        if (!this.selectedId) return null;
        const base = (this.source.assets || []).find((asset) => asset.id === this.selectedId) || null;
        if (!base || !this.selectedDetail || this.selectedDetail.id !== base.id) return base;
        const mapped = window.AssetOrganization && window.AssetOrganization.mapAsset
          ? window.AssetOrganization.mapAsset(this.selectedDetail)
          : null;
        if (!mapped) return base;
        // The detail read enriches category, technical FOV metadata and images;
        // the map position still comes from the canonical map payload.
        return Object.assign({}, base, mapped, {
          positionX: base.positionX,
          positionY: base.positionY
        });
      },
      roomChips() {
        const chips = FloorLogic.computed.roomChips.call(this);
        if (!this.serverMapMode) return chips;
        // Directory rooms carry no canvas geometry. A chip needs finite plan
        // coordinates; coordinate-less rooms stay in the grouped list below.
        return chips.filter((chip) => Number.isFinite(chip.x) && Number.isFinite(chip.y));
      },
      floorLooseGroups() {
        if (!this.floorView) return [];
        const onCanvas = {};
        this.roomChips.forEach((room) => { onCanvas[room.id] = true; });
        const groups = this.floorView.rooms
          .filter((room) => room.count > 0 && !onCanvas[room.id])
          .map((room) => ({ id: room.id, name: room.name, assets: room.assets }));
        if (this.floorView.orphans.length) {
          groups.push({
            id: 'floor-orphans',
            name: 'Sin sala asignada en esta planta',
            assets: this.floorView.orphans
          });
        }
        return groups.filter((group) => group.assets.length);
      },
      activeSite() {
        return this.activeSiteId ? Engine.siteById(this.source, this.activeSiteId) : null;
      },
      activeSiteGeo() {
        return this.activeSiteId ? Engine.siteGeo(this.source, this.activeSiteId) : null;
      },
      activeSiteStats() {
        if (!this.activeSiteId) return null;
        return this.sitePoints.find((point) => point.id === this.activeSiteId) || null;
      },
      activeFilterCount() {
        return this.filters.categories.length + this.filters.sites.length + this.filters.states.length + (this.filters.locations || []).length;
      },
      graphHref() {
        const base = '#/infra/grafo';
        return this.selectedId ? base + '/activo/' + encodeURIComponent(this.selectedId) : base;
      },
      mapZoomLabel() {
        return Math.round(this.mapZoom * 100) + '%';
      },
      legend() {
        const families = [];
        (this.source.assets || []).forEach((asset) => {
          if (this.filters.categories.length && this.filters.categories.indexOf(asset.category) === -1) return;
          const family = window.AssetRelationsData ? window.AssetRelationsData.familyOf(asset.category) : 'network';
          if (!families.some((item) => item.id === family)) {
            families.push({ id: family, label: window.AssetRelationsData ? window.AssetRelationsData.familyLabel(family) : family });
          }
        });
        return families;
      }
    }),
    watch: {
      filters: {
        deep: true,
        handler(value) {
          this.app.explorerFilters = {
            categories: value.categories.slice(),
            sites: value.sites.slice(),
            states: value.states.slice(),
            locations: (value.locations || []).slice(),
            search: value.search
          };
          this.selectedRoom = '';
          this.scheduleSync();
        }
      },
      'app.explorerFilters': {
        deep: true,
        handler(value) {
          if (!value) return;
          if (sameList(value.categories, this.filters.categories)
            && sameList(value.sites, this.filters.sites)
            && sameList(value.states, this.filters.states)
            && sameList(value.locations, this.filters.locations)
            && (value.search || '') === this.filters.search) return;
          this.filters = {
            categories: (value.categories || []).slice(),
            sites: (value.sites || []).slice(),
            states: (value.states || []).slice(),
            locations: (value.locations || []).slice(),
            search: value.search || ''
          };
        }
      },
      'app.explorerSelection'(value) {
        if (!value || value === this.selectedId) return;
        this.selectedId = value;
      },
      'prefs.labels'() {
        this.syncScreen();
      },
      'prefs.clusters'() {
        this.scheduleSync();
      },
      'prefs.base'() {
        this.applyMapColors();
      },
      'prefs.showPlans'() {
        this.applyFloorPlanStyle();
      },
      'prefs.planOpacity'() {
        this.applyFloorPlanStyle();
      },
      activeFloorId(value) {
        this.loadFloorPlan(value);
      },
      focusId(value) {
        if (!value) return;
        const asset = (this.source.assets || []).find((item) => item.id === value);
        if (!asset) return;
        this.selectedId = asset.id;
        const floorId = Engine.floorOfAsset(this.source, asset);
        if (floorId) this.openFloor(floorId, { keepSelection: true });
      },
      selectedId(value) {
        this.app.explorerSelection = value || '';
        this.loadAssetDetail(value);
      }
    },
    mounted() {
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const initial = this.focusId || this.selectedId;
      if (initial) {
        const asset = (this.source.assets || []).find((item) => item.id === initial);
        if (asset) {
          this.selectedId = initial;
          const floorId = Engine.floorOfAsset(this.source, asset);
          if (floorId) this.openFloor(floorId, { keepSelection: true, silent: true });
        }
      } else if (this.app.explorerSelection) {
        this.selectedId = this.app.explorerSelection;
      }
      if (!this.activeSiteId && this.activeFloorId) {
        const floor = Engine.floorById(this.source, this.activeFloorId);
        if (floor) this.activeSiteId = floor.site;
      }
      if (!this.openSiteId) {
        const first = this.tree[0];
        this.openSiteId = this.activeSiteId || (first ? first.id : '');
      }
      if (!this.openBuildingId) {
        const floor = this.activeFloorId ? Engine.floorById(this.source, this.activeFloorId) : null;
        const site = this.tree.find((item) => item.id === this.openSiteId);
        const building = floor && floor.building
          ? floor.building
          : (site && site.buildings[0] ? site.buildings[0].id : '');
        if (building) this.openBuildingId = building;
      }
      this.$nextTick(() => {
        this.initMap();
        this.loadFloorPlan(this.activeFloorId);
        this.loadAssetDetail(this.selectedId);
      });
      window.addEventListener('asset-theme-change', this.applyMapColors);
      window.addEventListener('resize', this.syncScreen);
      if (typeof window.ResizeObserver === 'function' && this.$refs.stage) {
        this.resizeObserver = new window.ResizeObserver(() => this.syncScreen());
        this.resizeObserver.observe(this.$refs.stage);
      }
    },
    beforeUnmount() {
      window.removeEventListener('asset-theme-change', this.applyMapColors);
      window.removeEventListener('resize', this.syncScreen);
      window.removeEventListener('pointermove', this.onMarkerMove);
      window.removeEventListener('pointerup', this.onMarkerUp);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
      this.releaseFloorPlan();
      this.releaseAssetDetail();
    },
    methods: Object.assign({}, FloorLogic.methods, {
      mapColors() {
        const root = document.documentElement;
        const dark = !!root && root.getAttribute('data-theme') === 'dark';
        return dark
          ? { bg: '#081a22', country: '#0f2831', region: '#123038', line: '#2c4a52', regionLine: '#3a5b62', detail: '#17393f' }
          : { bg: '#eef5f3', country: '#e3edea', region: '#f8fbfa', line: '#c2d5d1', regionLine: '#a6c2bd', detail: '#eaf3f0' };
      },
      mapStyle() {
        const colors = this.mapColors();
        const prefs = this.maps.prefs;
        return {
          version: 8,
          sources: {
            base: { type: 'geojson', data: 'assets/geo/basemap.geojson' }
          },
          layers: [
            { id: 'infra-bg', type: 'background', paint: { 'background-color': colors.bg } },
            {
              id: 'infra-country-fill', type: 'fill', source: 'base',
              filter: ['==', ['get', 'kind'], 'country'],
              paint: { 'fill-color': colors.country }
            },
            {
              id: 'infra-region-fill', type: 'fill', source: 'base',
              filter: ['==', ['get', 'kind'], 'region'],
              paint: { 'fill-color': colors.region, 'fill-opacity': prefs.base === 'detalle' ? 1 : 0.6 }
            },
            {
              id: 'infra-region-line', type: 'line', source: 'base',
              filter: ['==', ['get', 'kind'], 'region'],
              paint: { 'line-color': colors.regionLine, 'line-width': 0.8, 'line-dasharray': [3, 3], 'line-opacity': prefs.base === 'detalle' ? 0.9 : 0.5 }
            },
            {
              id: 'infra-country-line', type: 'line', source: 'base',
              filter: ['==', ['get', 'kind'], 'country'],
              paint: { 'line-color': colors.line, 'line-width': 1.6 }
            }
          ]
        };
      },
      initMap() {
        if (this.map || !this.$refs.mapCanvas) return;
        if (!window.maplibregl) {
          this.mapError = 'El motor del mapa no está disponible en este navegador.';
          return;
        }
        try {
          this.map = new window.maplibregl.Map({
            container: this.$refs.mapCanvas,
            style: this.mapStyle(),
            center: [this.maps.prefs.center.lng, this.maps.prefs.center.lat],
            zoom: this.maps.prefs.zoom,
            minZoom: 4,
            maxZoom: 12,
            dragRotate: false,
            pitchWithRotate: false,
            attributionControl: false,
            fadeDuration: 0
          });
        } catch (error) {
          this.mapError = 'No se pudo iniciar el mapa. La estructura de ubicaciones sigue disponible.';
          return;
        }
        this.map.on('load', () => {
          this.mapReady = true;
          this.mapZoom = this.map.getZoom();
          this.syncScreen();
          this.focusActiveSite(false);
        });
        this.map.on('error', (event) => {
          if (event && event.error && !this.mapReady) {
            this.mapError = 'No se pudo dibujar la base cartográfica.';
          }
        });
        this.map.on('move', this.syncScreen);
        this.map.on('zoom', () => { this.mapZoom = this.map.getZoom(); });
        this.map.on('moveend', () => {
          const center = this.map.getCenter();
          Engine.setPrefs(this.app, {
            zoom: Math.round(this.map.getZoom() * 100) / 100,
            center: { lat: center.lat, lng: center.lng }
          });
        });
      },
      mapCameraDuration() {
        return this.reduced || !this.prefs.animations ? 0 : 620;
      },
      applyMapColors() {
        if (!this.map || !this.mapReady) return;
        const colors = this.mapColors();
        try {
          this.map.setPaintProperty('infra-bg', 'background-color', colors.bg);
          this.map.setPaintProperty('infra-country-fill', 'fill-color', colors.country);
          this.map.setPaintProperty('infra-region-fill', 'fill-color', colors.region);
          this.map.setPaintProperty('infra-region-fill', 'fill-opacity', this.prefs.base === 'detalle' ? 1 : 0.6);
          this.map.setPaintProperty('infra-region-line', 'line-color', colors.regionLine);
          this.map.setPaintProperty('infra-region-line', 'line-opacity', this.prefs.base === 'detalle' ? 0.9 : 0.5);
          this.map.setPaintProperty('infra-country-line', 'line-color', colors.line);
        } catch (error) {
          // Style not ready yet; the next theme event retries.
        }
      },
      scheduleSync() {
        if (!this.map) return;
        if (this.syncFrame) return;
        this.syncFrame = window.requestAnimationFrame(() => {
          this.syncFrame = 0;
          this.syncScreen();
        });
      },
      syncScreen() {
        if (!this.map || !this.mapReady) {
          this.screenClusters = [];
          return;
        }
        const clusters = Engine.clusterPoints(this.sitePoints.map((point) => {
          const projected = this.map.project([point.lng, point.lat]);
          return { id: point.id, x: projected.x, y: projected.y, point: point };
        }), this.prefs.clusters ? 74 : 1);

        this.screenClusters = clusters.map((cluster) => {
          const points = cluster.points.map((item) => item.point);
          return {
            id: cluster.id,
            x: cluster.x,
            y: cluster.y,
            count: points.reduce((sum, point) => sum + point.count, 0),
            sites: points,
            title: points.length === 1 ? points[0].site.label : points.length + ' sedes',
            empty: points.every((point) => !point.count)
          };
        });

        this.screenLabels = this.prefs.labels ? (this.maps.labels || []).map((label) => {
          const projected = this.map.project([label.lng, label.lat]);
          return { name: label.name, kind: label.kind, x: projected.x, y: projected.y };
        }).filter((label) => label.x > -40 && label.y > -20) : [];
      },
      activateCluster(cluster) {
        if (cluster.sites.length > 1) {
          const bounds = new window.maplibregl.LngLatBounds();
          cluster.sites.forEach((point) => bounds.extend([point.lng, point.lat]));
          this.map.fitBounds(bounds, { padding: 90, maxZoom: 11, duration: this.mapCameraDuration() });
          this.announce = 'Agrupación de ' + cluster.sites.length + ' sedes ampliada.';
          return;
        }
        this.selectSite(cluster.sites[0].id);
      },
      zoomMap(factor) {
        if (!this.map) return;
        this.map.easeTo({ zoom: this.map.getZoom() * factor, duration: this.mapCameraDuration() });
      },
      fitSites() {
        if (!this.map || !this.sitePoints.length) return;
        const bounds = new window.maplibregl.LngLatBounds();
        this.sitePoints.forEach((point) => bounds.extend([point.lng, point.lat]));
        this.map.fitBounds(bounds, { padding: 90, maxZoom: 11, duration: this.mapCameraDuration() });
      },
      focusActiveSite(animate) {
        if (!this.map || !this.activeSiteGeo || !this.activeSiteId) return;
        this.map.easeTo({
          center: [this.activeSiteGeo.lng, this.activeSiteGeo.lat],
          zoom: Math.max(this.map.getZoom(), 9.2),
          duration: animate === false ? 0 : this.mapCameraDuration()
        });
      },
      toggleBase() {
        Engine.setPrefs(this.app, { base: this.prefs.base === 'detalle' ? 'esquema' : 'detalle' });
        this.announce = 'Base cartográfica: ' + (this.prefs.base === 'detalle' ? 'detalle departamental' : 'esquema general') + '.';
      },
      // ------------------------------------------------------------ navigation,
      selectSite(siteId, options) {
        const site = Engine.siteById(this.app, siteId);
        if (!site) return;
        this.activeSiteId = siteId;
        this.openSiteId = siteId;
        this.level = 'geo';
        this.selectedRoom = '';
        if (!options || options.keepSelection !== true) this.selectedId = '';
        this.selectSiteBuildings(siteId);
        const geo = Engine.siteGeo(this.app, siteId);
        if (this.map && geo) {
          this.map.easeTo({
            center: [geo.lng, geo.lat],
            zoom: Math.max(this.map.getZoom(), 9.4),
            duration: this.mapCameraDuration()
          });
        }
        this.announce = site.label + ' seleccionada, ' + Engine.siteCount(this.app, this.filters, siteId) + ' activos.';
      },
      selectSiteBuildings(siteId) {
        const site = Engine.siteById(this.app, siteId);
        this.openSiteId = siteId;
        this.openBuildingId = '';
        const tree = this.tree.find((item) => item.id === siteId);
        if (tree && tree.buildings.length === 1) this.openBuildingId = tree.buildings[0].id;
      },
      toggleSite(siteId) {
        this.openSiteId = this.openSiteId === siteId ? '' : siteId;
      },
      toggleBuilding(buildingId) {
        this.openBuildingId = this.openBuildingId === buildingId ? '' : buildingId;
      },
      isSiteOpen(siteId) {
        return this.openSiteId === siteId;
      },
      isBuildingOpen(buildingId) {
        return this.openBuildingId === buildingId;
      },
      openAsset(id) {
        const asset = (this.source.assets || []).find((item) => item.id === id);
        if (asset) this.app.openAsset(asset);
      },
      selectAsset(id) {
        const asset = (this.source.assets || []).find((item) => item.id === id);
        if (!asset) return;
        this.selectedId = id;
        this.selectedRoom = '';
        const floorId = Engine.floorOfAsset(this.source, asset);
        if (floorId && (this.level === 'floor' || this.activeFloorId === floorId)) {
          this.activeFloorId = floorId;
          this.activeSiteId = asset.site;
        }
        const category = this.app.categories.find((item) => item.id === asset.category);
        this.announce = asset.name + ', ' + (category ? category.label : asset.category) + ', ' + (this.app.sites.find((item) => item.id === asset.site) || {}).label + '.';
      },
      openGraph() {
        this.app.setHash(this.graphHref);
      },
      goToConfig() {
        this.layersOpen = false;
        this.app.goToConfig('mapas');
      },
      // --------------------------------------------------------------- filters,
      toggleList(list, value) {
        const index = list.indexOf(value);
        if (index === -1) list.push(value);
        else list.splice(index, 1);
      },
      clearFilters() {
        this.filters = { categories: [], sites: [], states: [], locations: [], search: '' };
        this.announce = 'Filtros del explorador restablecidos.';
      },
      siteCount(siteId) {
        return Engine.siteCount(this.app, this.filters, siteId);
      },
      // ------------------------------------------------------------- floor view,
      setPref(key, value) {
        const patch = {};
        patch[key] = value;
        Engine.setPrefs(this.app, patch);
      },
      iconFor(category) {
        return iconFor(category);
      },
      // --------------------------------------------------- authenticated plan,
      async loadFloorPlan(floorId) {
        if (!floorId || !this.serverMapMode) {
          this.releaseFloorPlan();
          return;
        }
        if (this._planFloor === floorId && (this.floorPlanState === 'loading' || this.floorPlanState === 'ready')) return;
        this.releaseFloorPlan();
        this._planFloor = floorId;
        const serial = this._planSerial;
        const controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
        this._planController = controller;
        this.floorPlanState = 'loading';
        this.floorPlanError = '';
        try {
          const location = encodeURIComponent(floorId);
          const signal = controller ? controller.signal : undefined;
          const meta = await window.AssetAccess.request(this, '/locations/' + location + '/plan/meta', { signal });
          if (serial !== this._planSerial) return;
          const blob = await window.AssetAccess.request(this, '/locations/' + location + '/plan', {
            responseType: 'blob',
            signal
          });
          if (serial !== this._planSerial) return;
          if (!blob || typeof blob.size !== 'number' || !blob.size) throw new Error('El plano no contiene una imagen.');
          this.floorPlanMeta = meta;
          this.floorPlanSrc = URL.createObjectURL(blob);
          this.floorPlanState = 'ready';
          this.floorPlanVisible = true;
          await this.$nextTick();
          if (serial === this._planSerial) this.mountFloorMap();
        } catch (error) {
          if (serial !== this._planSerial) return;
          if (error && error.name === 'AbortError') return;
          this.floorPlanState = error && error.status === 404 ? 'empty' : 'error';
          this.floorPlanError = (error && error.message) || 'No se pudo cargar el plano de la planta.';
        }
      },
      releaseFloorPlan() {
        this._planSerial = (this._planSerial || 0) + 1;
        if (this._planController) {
          this._planController.abort();
          this._planController = null;
        }
        this.destroyFloorMap();
        if (this.floorPlanSrc) URL.revokeObjectURL(this.floorPlanSrc);
        this.floorPlanSrc = '';
        this.floorPlanMeta = null;
        this.floorPlanState = 'idle';
        this.floorPlanError = '';
        this.floorPlanVisible = true;
        this.floorViewport = null;
        this._planFloor = '';
        this._floorFitZoom = null;
      },
      destroyFloorMap() {
        if (!this._floorMap) return;
        try { this._floorMap.remove(); } catch (error) { /* already gone */ }
        this._floorMap = null;
        this._floorMapReady = false;
      },
      mountFloorMap() {
        const canvas = this.$refs.floorCanvas;
        if (!canvas || !this.floorPlanSrc) return;
        if (!window.maplibregl) {
          this.floorPlanState = 'error';
          this.floorPlanError = 'MapLibre no está disponible para dibujar el plano.';
          return;
        }
        this.destroyFloorMap();
        const map = new window.maplibregl.Map({
          container: canvas,
          style: {
            version: 8,
            sources: {},
            layers: [{ id: 'floor-background', type: 'background', paint: { 'background-color': this.mapColors().bg } }]
          },
          bounds: [[0, 0], [Engine.PLAN_W / Engine.PLAN_H, 1]],
          fitBoundsOptions: { padding: 0, duration: 0 },
          minZoom: 0,
          maxZoom: 6,
          dragRotate: false,
          pitchWithRotate: false,
          attributionControl: false,
          renderWorldCopies: false,
          fadeDuration: 0
        });
        this._floorMap = map;
        map.on('load', () => {
          if (this._floorMap !== map) return;
          try {
            map.addSource('floor-plan', {
              type: 'image',
              url: this.floorPlanSrc,
              // Synthetic plan pixels. MapLibre places the image by its four
              // corners; the original map coordinate system is untouched.
              coordinates: [
                [0, 1],
                [Engine.PLAN_W / Engine.PLAN_H, 1],
                [Engine.PLAN_W / Engine.PLAN_H, 0],
                [0, 0]
              ]
            });
            map.addLayer({
              id: 'floor-plan-layer',
              type: 'raster',
              source: 'floor-plan',
              paint: { 'raster-opacity': Number(this.prefs.planOpacity) || 1 }
            });
            this._floorMapReady = true;
            this.applyFloorPlanStyle();
            map.fitBounds([[0, 0], [Engine.PLAN_W / Engine.PLAN_H, 1]], { padding: 0, duration: 0 });
            this.syncFloorViewport();
          } catch (error) {
            this.floorPlanState = 'error';
            this.floorPlanError = 'No se pudo dibujar la imagen del plano.';
          }
        });
        map.on('move', this.syncFloorViewport);
        map.on('idle', () => {
          if (this._floorMap !== map) return;
          if (this._floorFitZoom === null) {
            this._floorFitZoom = map.getZoom();
            this.floorZoom = 1;
          }
        });
        map.on('error', () => {
          if (this._floorMap === map && !this._floorMapReady && this.floorPlanState === 'ready') {
            this.floorPlanError = 'No se pudo cargar la imagen del plano.';
          }
        });
      },
      syncFloorViewport() {
        const map = this._floorMap;
        if (!map || !this._floorMapReady) return;
        const topLeft = map.project([0, 1]);
        const bottomRight = map.project([Engine.PLAN_W / Engine.PLAN_H, 0]);
        const left = Math.min(topLeft.x, bottomRight.x);
        const top = Math.min(topLeft.y, bottomRight.y);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        if (!(width > 0 && height > 0)) return;
        this.floorViewport = { left, top, width, height };
        if (this._floorFitZoom !== null) {
          const ratio = Math.pow(2, map.getZoom() - this._floorFitZoom);
          this.floorZoom = Math.max(0.75, Math.min(3, Math.round(ratio * 100) / 100));
        }
      },
      applyFloorPlanStyle() {
        const map = this._floorMap;
        if (!map || !this._floorMapReady) return;
        const visible = this.prefs.showPlans !== false && this.floorPlanVisible;
        try {
          map.setLayoutProperty('floor-plan-layer', 'visibility', visible ? 'visible' : 'none');
          map.setPaintProperty('floor-plan-layer', 'raster-opacity', Math.max(0.2, Math.min(1, Number(this.prefs.planOpacity) || 1)));
        } catch (error) {
          // Layer not ready; the load callback applies the current state.
        }
      },
      floorPaperStyle() {
        return this.serverMapMode ? { width: '100%' } : { width: Math.round(this.floorZoom * 100) + '%' };
      },
      floorOverlayStyle() {
        if (!this.serverMapMode || !this.floorViewport) return null;
        return {
          left: this.floorViewport.left + 'px',
          top: this.floorViewport.top + 'px',
          width: this.floorViewport.width + 'px',
          height: this.floorViewport.height + 'px'
        };
      },
      floorTop(value) {
        return this.percentY(Number(value) || 0);
      },
      togglePlan(plan) {
        if (!this.serverMapMode) {
          FloorLogic.methods.togglePlan.call(this, plan);
          return;
        }
        this.floorPlanVisible = !this.floorPlanVisible;
        this.applyFloorPlanStyle();
        this.announce = 'Plano ' + (plan.name || '') + (this.floorPlanVisible ? ' visible.' : ' oculto.');
      },
      setPlanOpacity(value) {
        if (!this.serverMapMode) {
          FloorLogic.methods.setPlanOpacity.call(this, value);
          return;
        }
        const opacity = Math.max(0.2, Math.min(1, Number(value) || 1));
        Engine.setPrefs(this.app, { planOpacity: opacity });
        this.applyFloorPlanStyle();
      },
      openPlan(planId) {
        if (!this.serverMapMode) {
          FloorLogic.methods.openPlan.call(this, planId);
          return;
        }
        const plan = this.availablePlans.find((item) => item.id === planId);
        if (plan) this.openFloor(plan.floor);
      },
      zoomFloor(factor) {
        if (!this.serverMapMode || !this._floorMap) {
          FloorLogic.methods.zoomFloor.call(this, factor);
          return;
        }
        if (factor > 1) this._floorMap.zoomIn({ duration: this.reduced ? 0 : 180 });
        else this._floorMap.zoomOut({ duration: this.reduced ? 0 : 180 });
      },
      resetFloorZoom() {
        if (!this.serverMapMode || !this._floorMap) {
          FloorLogic.methods.resetFloorZoom.call(this);
          return;
        }
        this._floorFitZoom = null;
        this._floorMap.fitBounds([[0, 0], [Engine.PLAN_W / Engine.PLAN_H, 1]], { padding: 0, duration: 0 });
        this.floorZoom = 1;
        this.syncFloorViewport();
      },
      // ----------------------------------------------------- selected detail,
      async loadAssetDetail(assetId) {
        if (!assetId || !this.serverMapMode) {
          this.releaseAssetDetail();
          return;
        }
        if (this.selectedDetail && this.selectedDetail.id === assetId) return;
        this.releaseAssetDetail();
        const serial = (this._assetSerial = (this._assetSerial || 0) + 1);
        const controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
        this._assetController = controller;
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(assetId), {
            signal: controller ? controller.signal : undefined
          });
          if (serial !== this._assetSerial || this.selectedId !== assetId) return;
          this.selectedDetail = payload && payload.id === assetId ? payload : null;
        } catch (error) {
          if (serial !== this._assetSerial) return;
          this.selectedDetail = null;
        }
      },
      releaseAssetDetail() {
        this._assetSerial = (this._assetSerial || 0) + 1;
        if (this._assetController) {
          this._assetController.abort();
          this._assetController = null;
        }
        this.selectedDetail = null;
      },
      categoryLabel(id) {
        const category = this.app.categories.find((item) => item.id === id);
        return category ? category.label : id;
      },
      siteLabel(id) {
        const site = Engine.siteById(this.app, id);
        return site ? site.label : id;
      },
      statusTone(asset) {
        return asset && asset.statusTone ? 'tone tone--' + asset.statusTone : 'tone';
      },
      progressWidth(count) {
        const total = Math.max(1, this.counts.total);
        return Math.max(4, Math.round((count / total) * 100));
      }
    }),
    template: `
      <div class="map-page" data-od-id="infra-explorer">
        <header class="map-page__head">
          <div class="map-page__titles">
            <p class="eyebrow">Infraestructura</p>
            <h1 id="infra-title">Explorador de infraestructura</h1>
            <p class="map-page__meta mono">
              {{ counts.assets }} activos · {{ counts.sites }} sedes · {{ counts.floors }} plantas · {{ counts.plans }} planos
            </p>
          </div>
          <nav class="infra-tabs" aria-label="Modo de visualización">
            <a class="infra-tab is-active" href="#/infra/mapa" aria-current="page">
              <app-icon name="map-pin"></app-icon> Mapa
            </a>
            <a class="infra-tab" :href="graphHref">
              <app-icon name="network"></app-icon> Grafo
            </a>
          </nav>
        </header>

        <div class="map-toolbar-wrap">
        <div class="map-toolbar" data-od-id="map-toolbar">
          <label class="map-search">
            <app-icon name="search"></app-icon>
            <input type="search" v-model="filters.search" placeholder="Buscar activo, código, IP o responsable"
                   aria-label="Buscar activos en el explorador">
          </label>
          <div class="map-toolbar__actions">
            <button type="button" class="btn btn--ghost btn--small" :aria-expanded="filtersOpen ? 'true' : 'false'"
                    data-od-id="map-filters-toggle" @click="filtersOpen = !filtersOpen">
              <app-icon name="sliders"></app-icon> Filtros
              <span v-if="activeFilterCount" class="map-badge mono">{{ activeFilterCount }}</span>
            </button>
            <button type="button" class="btn btn--ghost btn--small" :aria-expanded="layersOpen ? 'true' : 'false'"
                    data-od-id="map-layers-toggle" @click="layersOpen = !layersOpen">
              <app-icon name="layers"></app-icon> Capas
            </button>
            <button v-if="level === 'floor'" type="button" class="btn btn--secondary btn--small"
                    data-od-id="map-back-geo" @click="backToGeo">
              <app-icon name="map-pin"></app-icon> Volver al mapa
            </button>
          </div>
        </div>

        <section v-if="filtersOpen" class="map-filters" data-od-id="map-filters" aria-label="Filtros del explorador">
          <fieldset class="graph-filter-group">
            <legend>Categoría</legend>
            <label v-for="category in categories" :key="category.id" class="graph-check">
              <input type="checkbox" :checked="filters.categories.includes(category.id)"
                     @change="toggleList(filters.categories, category.id)">
              <span>{{ category.label }}</span>
            </label>
          </fieldset>
          <fieldset class="graph-filter-group">
            <legend>Sede</legend>
            <label v-for="site in sites" :key="site.id" class="graph-check">
              <input type="checkbox" :checked="filters.sites.includes(site.id)"
                     @change="toggleList(filters.sites, site.id)">
              <span>{{ site.label }}</span>
            </label>
          </fieldset>
          <fieldset class="graph-filter-group">
            <legend>Estado</legend>
            <label v-for="status in statuses" :key="status" class="graph-check">
              <input type="checkbox" :checked="filters.states.includes(status) || filters.states.includes((app.assetAdmin.statuses.find(s=>s.label===status)||{}).id)"
                     @change="toggleList(filters.states, (app.assetAdmin.statuses.find(s=>s.label===status)||{}).id || status)">
              <span>{{ status }}</span>
            </label>
          </fieldset>
          <div class="map-filters__foot">
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showRetired" @change="setPref('showRetired', $event.target.checked)">
              <span>Incluir activos dados de baja</span>
            </label>
            <button type="button" class="text-button" @click="clearFilters">Limpiar filtros</button>
          </div>
        </section>

        <section v-if="layersOpen" class="map-popover" data-od-id="map-layers" aria-label="Capas y planos">
          <header class="map-popover__head">
            <h2>Capas y planos</h2>
            <button type="button" class="icon-button" aria-label="Cerrar capas" @click="layersOpen = false">
              <app-icon name="close"></app-icon>
            </button>
          </header>
          <div class="map-popover__body">
            <fieldset class="map-layers__group">
              <legend>Base cartográfica</legend>
              <label class="map-radio">
                <input type="radio" name="map-base" value="esquema" :checked="prefs.base === 'esquema'"
                       @change="setPref('base', 'esquema')">
                <span>Esquema general</span>
              </label>
              <label class="map-radio">
                <input type="radio" name="map-base" value="detalle" :checked="prefs.base === 'detalle'"
                       @change="setPref('base', 'detalle')">
                <span>Detalle departamental</span>
              </label>
            </fieldset>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.labels !== false" @change="setPref('labels', $event.target.checked)">
              <span>Etiquetas de ciudades</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.clusters !== false" @change="setPref('clusters', $event.target.checked)">
              <span>Agrupar marcadores próximos</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showPlans !== false" @change="setPref('showPlans', $event.target.checked)">
              <span>Mostrar planos de planta</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.animations !== false" @change="setPref('animations', $event.target.checked)">
              <span>Transiciones animadas</span>
            </label>
            <label class="map-range">
              <span>Opacidad del plano <span class="mono">{{ Math.round(prefs.planOpacity * 100) }}%</span></span>
              <input type="range" min="0.2" max="1" step="0.05" :value="prefs.planOpacity" @input="setPlanOpacity($event.target.value)">
            </label>
            <h3 class="map-popover__subhead">Planos disponibles</h3>
            <ul class="map-plan-list">
              <li v-for="plan in availablePlans" :key="plan.id" class="map-plan-list__row">
                <label class="map-check">
                  <input type="checkbox" :checked="plan.visible" @change="togglePlan(plan)">
                  <span>{{ plan.name }}</span>
                </label>
                <span class="mono map-plan-list__floor">{{ floorLabel(plan.floor) }}</span>
                <button type="button" class="text-button" @click="openPlan(plan.id)">Abrir</button>
              </li>
            </ul>
            <button type="button" class="btn btn--secondary btn--small map-popover__cta" @click="goToConfig">
              <app-icon name="sliders"></app-icon> Administrar en Configuración
            </button>
          </div>
        </section>

        </div>

        <div class="map-layout" :class="'map-layout--' + level">
          <aside class="map-tree" data-od-id="map-locations" aria-label="Ubicaciones">
            <header class="map-tree__head">
              <h2>Ubicaciones</h2>
              <span class="mono">{{ counts.rooms }} salas</span>
            </header>
            <ul class="loc-tree">
              <li v-for="site in tree" :key="site.id" class="loc-tree__site">
                <div class="loc-tree__row" :class="{ 'is-active': activeSiteId === site.id }">
                  <button type="button" class="loc-tree__toggle" :aria-expanded="isSiteOpen(site.id) ? 'true' : 'false'"
                          :aria-label="'Expandir ' + site.name" @click="toggleSite(site.id)">
                    <app-icon :name="isSiteOpen(site.id) ? 'chevron-down' : 'chevron-right'"></app-icon>
                  </button>
                  <button type="button" class="loc-tree__label" @click="selectSite(site.id)">
                    <span class="loc-tree__dot" aria-hidden="true"></span>
                    <span class="loc-tree__name">{{ site.name }}</span>
                    <span class="mono loc-tree__count">{{ site.count }}</span>
                  </button>
                </div>
                <ul v-if="isSiteOpen(site.id)" class="loc-tree__buildings">
                  <li v-for="building in site.buildings" :key="building.id">
                    <button type="button" class="loc-tree__building" :aria-expanded="isBuildingOpen(building.id) ? 'true' : 'false'"
                            @click="toggleBuilding(building.id)">
                      <app-icon :name="isBuildingOpen(building.id) ? 'chevron-down' : 'chevron-right'"></app-icon>
                      <app-icon name="building"></app-icon>
                      <span>{{ building.name }}</span>
                      <span class="mono loc-tree__count">{{ building.count }}</span>
                    </button>
                    <ul v-if="isBuildingOpen(building.id)" class="loc-tree__floors">
                      <li v-for="floor in building.floors" :key="floor.id">
                        <button type="button" class="loc-tree__floor" :class="{ 'is-active': activeFloorId === floor.id }"
                                :aria-current="activeFloorId === floor.id ? 'true' : null" @click="openFloor(floor.id)">
                          <span class="loc-tree__floor-name">{{ floor.name }}</span>
                          <span v-if="floor.plan" class="loc-tree__plan" title="Plano disponible">
                            <app-icon name="layers"></app-icon>
                          </span>
                          <span class="mono loc-tree__count">{{ floor.count }}</span>
                        </button>
                        <ul v-if="activeFloorId === floor.id" class="loc-tree__rooms">
                          <li v-for="room in floor.rooms" :key="room.id">
                            <button type="button" class="loc-tree__room" :class="{ 'is-active': selectedRoom === room.id }"
                                    @click="selectRoom(room.id, floor.id)">
                              <span>{{ room.name }}</span>
                              <span class="mono loc-tree__count">{{ room.count }}</span>
                            </button>
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
            <p class="map-tree__foot">Los activos sin posición individual se agrupan por sala o zona.</p>
          </aside>

          <div ref="stage" class="map-stage-wrap">
            <div v-show="level === 'geo'" class="map-stage" data-od-id="map-geo">
              <div ref="mapCanvas" class="map-canvas" role="application"
                   aria-label="Mapa de sedes con marcadores agrupados"></div>
              <div class="map-overlay" aria-hidden="true">
                <span v-for="label in screenLabels" :key="'label-' + label.name + label.kind"
                      class="map-label" :class="'map-label--' + label.kind"
                      :style="{ left: label.x + 'px', top: label.y + 'px' }">{{ label.name }}</span>
                <button v-for="cluster in screenClusters" :key="cluster.id" type="button"
                        class="map-marker" :class="{ 'is-empty': cluster.empty, 'is-cluster': cluster.sites.length > 1, 'is-selected': activeSiteId && cluster.sites.length === 1 && cluster.sites[0].id === activeSiteId }"
                        :style="{ left: cluster.x + 'px', top: cluster.y + 'px' }"
                        :aria-label="cluster.title + ', ' + cluster.count + ' activos'"
                        @click="activateCluster(cluster)">
                  <span class="map-marker__dot" aria-hidden="true"></span>
                  <span class="map-marker__body">
                    <span class="map-marker__count mono">{{ cluster.count }}</span>
                    <span class="map-marker__label">{{ cluster.title }}</span>
                  </span>
                </button>
              </div>
              <div class="map-controls" role="group" aria-label="Controles del mapa">
                <button type="button" class="icon-button" aria-label="Acercar el mapa" @click="zoomMap(1.4)">
                  <app-icon name="plus"></app-icon>
                </button>
                <button type="button" class="icon-button" aria-label="Alejar el mapa" @click="zoomMap(0.7)">
                  <app-icon name="minus"></app-icon>
                </button>
                <span class="map-controls__value mono">{{ mapZoomLabel }}</span>
                <button type="button" class="icon-button" aria-label="Ver todas las sedes" @click="fitSites">
                  <app-icon name="grid"></app-icon>
                </button>
                <button type="button" class="icon-button" :aria-pressed="prefs.base === 'detalle' ? 'true' : 'false'"
                        aria-label="Alternar detalle cartográfico" @click="toggleBase">
                  <app-icon name="layers"></app-icon>
                </button>
              </div>
              <p class="map-legend" aria-label="Familias de categorías visibles">
                <span v-for="item in legend" :key="item.id" class="map-legend__item">
                  <span class="graph-swatch" :class="'graph-swatch--' + item.id" aria-hidden="true"></span>{{ item.label }}
                </span>
              </p>
              <p class="map-attribution">Base cartográfica: Natural Earth · geoBoundaries (CC BY 4.0)</p>
              <p v-if="mapError" class="map-error" role="alert">
                <app-icon name="alert"></app-icon> {{ mapError }}
              </p>
              <p v-if="!sitePoints.length" class="map-empty">No hay sedes registradas.</p>
            </div>

            <div v-show="level === 'floor'" class="map-stage map-stage--floor" data-od-id="map-floor">
              <header class="floor-head">
                <div>
                  <p class="eyebrow">{{ floorContext.siteName }} · {{ floorContext.buildingName }}</p>
                  <h2>{{ floorContext.floorName }}</h2>
                </div>
                <p class="mono floor-head__meta">
                  {{ floorView ? floorView.count : 0 }} activos · {{ floorView ? floorView.placedCount : 0 }} posicionados
                </p>
              </header>
              <div class="floor-scroll">
                <div ref="paper" class="floor-paper" :style="floorPaperStyle()">
                  <template v-if="serverMapMode">
                    <div ref="floorCanvas" class="floor-map" aria-hidden="true"></div>
                    <div v-if="floorPlanState === 'loading'" class="floor-noplan" role="status">
                      <app-icon name="layers"></app-icon>
                      <p>Cargando el plano de la planta…</p>
                    </div>
                    <div v-else-if="floorPlanState === 'empty'" class="floor-noplan">
                      <app-icon name="layers"></app-icon>
                      <p>Esta planta no tiene un plano asociado. Los activos se agrupan por sala.</p>
                    </div>
                    <div v-else-if="floorPlanState === 'error'" class="floor-noplan floor-noplan--error" role="alert">
                      <app-icon name="alert"></app-icon>
                      <p>{{ floorPlanError }}</p>
                      <button type="button" class="text-button" @click="loadFloorPlan(activeFloorId)">Reintentar</button>
                    </div>
                  </template>
                  <img v-else-if="plan && prefs.showPlans !== false" :src="plan.src" class="floor-plan"
                       :alt="'Plano de ' + floorContext.buildingName + ', ' + floorContext.floorName"
                       :style="{ opacity: plan.opacity }">
                  <div v-else-if="!serverMapMode" class="floor-noplan">
                    <app-icon name="layers"></app-icon>
                    <p>Esta planta no tiene un plano asociado. Los activos se agrupan por sala.</p>
                  </div>
                  <div class="floor-overlay" :class="{ 'floor-overlay--map': serverMapMode }" :style="floorOverlayStyle()">
                    <button v-for="room in roomChips" :key="room.id" type="button" class="floor-room"
                            :class="{ 'is-active': selectedRoom === room.id }"
                            :style="{ left: percentX(room.x) + '%', top: floorTop(room.y) + '%' }"
                            :aria-label="room.name + ': ' + room.count + ' activos agrupados'"
                            @click="selectRoom(room.id, activeFloorId)">
                      <span class="floor-room__name">{{ room.name }}</span>
                      <span class="floor-room__count mono">+{{ room.count }}</span>
                    </button>
                    <button v-for="marker in floorMarkers" :key="marker.id" type="button"
                            class="floor-marker" :class="['floor-marker--' + marker.family, { 'is-selected': marker.selected, 'is-cluster': marker.count > 1 }]"
                            :style="{ left: percentX(marker.x) + '%', top: floorTop(marker.y) + '%' }"
                            :aria-label="marker.count > 1 ? marker.count + ' activos agrupados' : marker.asset.name + ', ' + categoryLabel(marker.asset.category)"
                            @pointerdown="startMarkerDrag(marker, $event)"
                            @keydown="startMarkerKey($event, marker)"
                            @click="marker.count > 1 ? zoomFloor(1.35) : selectAsset(marker.asset.id)">
                      <app-icon :name="marker.icon" class="floor-marker__icon"></app-icon>
                      <span v-if="marker.count > 1" class="floor-marker__count mono">{{ marker.count }}</span>
                      <span v-else class="floor-marker__code mono">{{ marker.asset.code }}</span>
                    </button>
                    <p v-if="floorView && !floorView.count" class="floor-empty">
                      Ningún activo coincide con los filtros en esta planta.
                    </p>
                  </div>
                </div>
              </div>
              <section v-if="floorLooseGroups.length" class="floor-groups" aria-label="Activos sin posición individual">
                <header class="floor-groups__head">
                  <h3>Sin posición individual</h3>
                  <p>Estos equipos siguen asociados a su sala o planta.</p>
                </header>
                <details v-for="group in floorLooseGroups" :key="group.id" class="floor-group">
                  <summary class="floor-group__summary">
                    <span>{{ group.name }}</span>
                    <span class="mono">{{ group.assets.length }}</span>
                  </summary>
                  <ul class="floor-group__list">
                    <li v-for="asset in group.assets" :key="asset.id">
                      <button type="button" class="floor-group__asset" @click="selectAsset(asset.id)">
                        <span>{{ asset.name }}</span>
                        <span class="mono">{{ asset.code }}</span>
                      </button>
                    </li>
                  </ul>
                </details>
              </section>
              <div class="floor-controls" role="group" aria-label="Controles del plano">
                <button type="button" class="icon-button" aria-label="Acercar el plano" @click="zoomFloor(1.25)">
                  <app-icon name="plus"></app-icon>
                </button>
                <span class="floor-controls__value mono">{{ Math.round(floorZoom * 100) }}%</span>
                <button type="button" class="icon-button" aria-label="Alejar el plano" @click="zoomFloor(0.8)">
                  <app-icon name="minus"></app-icon>
                </button>
                <button type="button" class="icon-button" aria-label="Ajustar el plano" @click="resetFloorZoom">
                  <app-icon name="grid"></app-icon>
                </button>
                <button v-if="plan" type="button" class="icon-button" :aria-pressed="plan.visible ? 'true' : 'false'"
                        aria-label="Mostrar u ocultar el plano" @click="togglePlan(plan)">
                  <app-icon name="eye"></app-icon>
                </button>
              </div>
              <p class="map-legend" aria-label="Familias de categorías visibles">
                <span v-for="item in legend" :key="item.id" class="map-legend__item">
                  <span class="graph-swatch" :class="'graph-swatch--' + item.id" aria-hidden="true"></span>{{ item.label }}
                </span>
                <span class="map-legend__hint">Arrastra un marcador para ubicarlo; las salas conservan sus activos agrupados.</span>
              </p>
            </div>
          </div>

          <aside class="map-inspector" data-od-id="map-inspector" aria-label="Detalle de la selección">
            <template v-if="selectedAsset">
              <header class="map-inspector__head">
                <div>
                  <p class="eyebrow">{{ categoryLabel(selectedAsset.category) }}</p>
                  <h2>{{ selectedAsset.name }}</h2>
                  <p class="mono map-inspector__code">{{ selectedAsset.code }}</p>
                </div>
                <button type="button" class="icon-button" aria-label="Cerrar selección" @click="selectedId = ''">
                  <app-icon name="close"></app-icon>
                </button>
              </header>
              <p class="map-inspector__path">
                <app-icon name="map-pin"></app-icon> {{ selectedPath }}
              </p>
              <div class="map-inspector__meta">
                <span :class="statusTone(selectedAsset)">{{ selectedAsset.status }}</span>
                <span v-if="selectedAsset.ip" class="mono">{{ selectedAsset.ip }}</span>
                <span v-if="selectedAsset.assignee">{{ selectedAsset.assignee }}</span>
              </div>

              <section v-if="camera" class="map-camera" data-od-id="map-camera-fov">
                <header class="map-camera__head">
                  <h3><app-icon name="camera"></app-icon> Campo de visión</h3>
                  <span class="mono">{{ camera.range }}</span>
                </header>
                <img :src="camera.src" :alt="camera.alt" class="map-camera__image" width="640" height="400">
                <p class="map-camera__caption">{{ camera.caption }}</p>
                <p class="map-camera__meta mono">{{ camera.heading }}<span v-if="camera.angle"> · {{ camera.angle }}° horizontales</span></p>
              </section>

              <div class="map-inspector__actions">
                <button type="button" class="btn btn--primary btn--small" data-od-id="map-open-asset" @click="openAsset(selectedAsset.id)">
                  <app-icon name="file-text"></app-icon> Abrir ficha
                </button>
                <button type="button" class="btn btn--secondary btn--small" data-od-id="map-open-graph" @click="openGraph">
                  <app-icon name="network"></app-icon> Ver en grafo
                </button>
              </div>
              <div class="map-inspector__actions map-inspector__actions--ghost">
                <button type="button" class="btn btn--ghost btn--small" @click="showAssetFloor">
                  <app-icon name="layers"></app-icon> Ver en planta
                </button>
                <button v-if="canEdit && maps.positions[selectedAsset.id]" type="button" class="btn btn--ghost btn--small"
                        @click="clearPosition(selectedAsset.id)">
                  <app-icon name="restore"></app-icon> Quitar posición
                </button>
              </div>
              <dl class="map-facts">
                <div><dt>Sede</dt><dd>{{ siteLabel(selectedAsset.site) }}</dd></div>
                <div><dt>Ubicación</dt><dd>{{ selectedAsset.location }}</dd></div>
                <div><dt>Planta</dt><dd>{{ floorLabel(activeFloorId) || 'Sin planta' }}</dd></div>
                <div><dt>Posición</dt><dd>{{ maps.positions[selectedAsset.id] ? 'Individual en el plano' : 'Agrupada por sala' }}</dd></div>
              </dl>
            </template>

            <template v-else-if="selectedRoomData">
              <header class="map-inspector__head">
                <div>
                  <p class="eyebrow">Sala</p>
                  <h2>{{ selectedRoomData.room.name }}</h2>
                  <p class="mono map-inspector__code">{{ floorContext.floorName }}</p>
                </div>
                <button type="button" class="icon-button" aria-label="Cerrar sala" @click="selectedRoom = ''">
                  <app-icon name="close"></app-icon>
                </button>
              </header>
              <p class="map-inspector__note">
                {{ selectedRoomData.assets.length }} activos sin posición individual. Aparecen agrupados en esta sala.
              </p>
              <ul class="map-asset-list">
                <li v-for="asset in selectedRoomData.assets" :key="asset.id">
                  <button type="button" class="map-asset-list__row" @click="selectAsset(asset.id)">
                    <span class="map-asset-list__name">{{ asset.name }}</span>
                    <span class="mono">{{ asset.code }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="!selectedRoomData.assets.length" class="map-inspector__note">Esta sala no tiene activos con los filtros activos.</p>
            </template>

            <template v-else-if="activeSite">
              <header class="map-inspector__head">
                <div>
                  <p class="eyebrow">Sede</p>
                  <h2>{{ activeSite.label }}</h2>
                  <p class="mono map-inspector__code">{{ activeSiteGeo ? activeSiteGeo.lat.toFixed(4) + ', ' + activeSiteGeo.lng.toFixed(4) : '' }}</p>
                </div>
                <button type="button" class="icon-button" aria-label="Quitar selección" @click="activeSiteId = ''">
                  <app-icon name="close"></app-icon>
                </button>
              </header>
              <p class="map-inspector__note">{{ activeSiteGeo ? activeSiteGeo.address : '' }}</p>
              <div class="map-metrics">
                <div class="map-metrics__item">
                  <span class="mono">{{ activeSiteStats ? activeSiteStats.count : 0 }}</span>
                  <span>activos con filtros</span>
                </div>
                <div class="map-metrics__item">
                  <span class="mono">{{ activeSiteStats ? activeSiteStats.total : 0 }}</span>
                  <span>en el inventario</span>
                </div>
                <div class="map-metrics__item">
                  <span class="mono">{{ activeSiteStats ? activeSiteStats.floors : 0 }}</span>
                  <span>plantas</span>
                </div>
                <div class="map-metrics__item">
                  <span class="mono">{{ activeSiteStats ? activeSiteStats.cameras : 0 }}</span>
                  <span>cámaras</span>
                </div>
              </div>
              <h3 class="map-inspector__subhead">Plantas y planos</h3>
              <ul class="map-plan-list">
                <li v-for="floor in activeSiteFloors"
                    :key="floor.id" class="map-plan-list__row">
                  <span class="map-plan-list__name">{{ floor.name }}</span>
                  <span class="mono map-plan-list__floor">{{ floor.count }} activos</span>
                  <button type="button" class="text-button" @click="openFloor(floor.id)">Abrir</button>
                </li>
              </ul>
              <div class="map-inspector__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="focusActiveSite(true)">
                  <app-icon name="map-pin"></app-icon> Centrar en el mapa
                </button>
              </div>
            </template>

            <template v-else>
              <header class="map-inspector__head">
                <div>
                  <p class="eyebrow">Explorador</p>
                  <h2>Infraestructura</h2>
                </div>
              </header>
              <p class="map-inspector__note">
                Selecciona una sede en el mapa o una planta en el árbol de ubicaciones para recorrer el interior del edificio.
              </p>
              <ul class="map-per-site">
                <li v-for="site in sitePoints" :key="site.id">
                  <button type="button" class="map-per-site__row" @click="selectSite(site.id)">
                    <span class="map-per-site__name">{{ site.site.label }}</span>
                    <span class="map-per-site__bar" aria-hidden="true">
                      <span :style="{ width: progressWidth(site.count) + '%' }"></span>
                    </span>
                    <span class="mono">{{ site.count }}</span>
                  </button>
                </li>
              </ul>
              <dl class="map-facts">
                <div><dt>Plantas</dt><dd>{{ counts.floors }}</dd></div>
                <div><dt>Planos</dt><dd>{{ counts.plans }}</dd></div>
                <div><dt>Salas</dt><dd>{{ counts.rooms }}</dd></div>
                <div><dt>Cámaras</dt><dd>{{ counts.cameras }}</dd></div>
              </dl>
            </template>
          </aside>
        </div>
        <p class="sr-only" aria-live="polite">{{ announce }}</p>
      </div>
    `
  };

  function iconFor(category) {
    const map = {
      computadoras: 'desktop',
      notebooks: 'laptop',
      servidores: 'server',
      impresoras: 'printer',
      switches: 'network',
      monitores: 'display',
      camaras: 'camera',
      ups: 'battery',
      virtualizacion: 'box',
      contenedores: 'package'
    };
    return map[category] || 'box';
  }

  function sameList(a, b) {
    const left = a || [];
    const right = b || [];
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  window.AssetMapViews = window.AssetMapViews || {};
  window.AssetMapViews.MapExplorer = MapExplorer;
  window.AssetMapViews.IconFor = iconFor;
})();
