(function () {
  'use strict';

  const Engine = window.AssetRelations;
  const Layout = window.AssetGraphLayout;
  const RelationsData = window.AssetRelationsData;

  // Human-visible copy comes from the shared catalog; the runtime is resolved at
  // call time so the component still loads in a harness without i18n.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }
  const TONES = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
  const GROUPS = [
    { id: 'category', key: 'ui.graph.group.category' },
    { id: 'site', key: 'ui.graph.group.site' },
    { id: 'none', key: 'ui.graph.group.none' }
  ];

  function unique(list) {
    return list.filter(function (item, index) { return list.indexOf(item) === index; });
  }

  function sameList(a, b) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) return false;
    return left.every(function (item, index) { return item === right[index]; });
  }

  window.AssetGraphView = {
    name: 'GraphExplorer',
    components: { AppIcon: window.AppIcon },
    // Measured availability is joined from the existing monitoring reads; the
    // administrative inventory status rendered in the inspector stays apart.
    mixins: [window.AssetInfrastructureMonitoring],
    props: {
      app: { type: Object, required: true },
      focusId: { type: String, default: '' }
    },
    data() {
      const shared = this.app.explorerFilters || {};
      return {
        redundancyOpen: true,
        filters: {
          categories: (shared.categories || []).slice(),
          sites: (shared.sites || []).slice(),
          states: (shared.states || []).slice(),
          locations: (shared.locations || []).slice(),
          types: [],
          includeIsolated: true,
          search: shared.search || ''
        },
        view: { x: 0, y: 0, k: 1 },
        size: { w: 960, h: 560 },
        frame: 0,
        selectedId: this.app.explorerSelection || '',
        hiddenIds: [],
        dragging: null,
        panning: null,
        filtersOpen: false,
        announce: '',
        // The canvas can take the whole window without leaving the route: the
        // running simulation, the camera and the selection stay mounted.
        expanded: false,
        ready: false
      };
    },
    computed: {
      prefs() {
        return this.app.graphPrefs || {};
      },
      /** Only blame the filters when assets exist but the filters hide them. */
      emptyMessage() {
        const source = this.source || {};
        const assets = Array.isArray(source.assets) ? source.assets : [];
        return assets.length ? 'ui.graph.empty.no_match' : 'ui.graph.empty.no_assets';
      },
      source() {
        const app = this.app;
        if (!app || !app.serverGraphMode) return app;
        const org = app.organizationGraphSource;
        if (this._sourceFor === org) return this._source;
        const proxy = new Proxy(app, {
          get(target, prop) {
            if (prop === 'assets') return org.assets;
            if (prop === 'sites') return org.sites;
            if (prop === 'relations') return org.relations;
            if (prop === 'categories') return org.categories;
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
        this._source = proxy;
        this._sourceFor = org;
        return proxy;
      },
      assets() {
        const list = this.source && this.source.assets;
        return Array.isArray(list) ? list : [];
      },
      categories() {
        return Array.isArray(this.source.categories) ? this.source.categories : [];
      },
      sites() {
        return Array.isArray(this.source.sites) ? this.source.sites : [];
      },
      types() {
        return this.source.relations && Array.isArray(this.source.relations.types) ? this.source.relations.types : [];
      },
      activeFocusId() {
        return this.focusId || '';
      },
      focusAsset() {
        return this.activeFocusId ? Engine.assetById(this.source, this.activeFocusId) : null;
      },
      mode() {
        return this.focusAsset ? 'focus' : 'global';
      },
      groupOptions() {
        return GROUPS.map(function (option) { return { id: option.id, label: tr(option.key) }; });
      },
      depth() {
        return this.prefs.depth || 2;
      },
      filterHint() {
        // The canonical global payload is derived from relationship edges, so it
        // cannot contain an asset without relationships. Say where that boundary
        // is instead of implying the toggle reaches the whole inventory.
        return this.app && this.app.serverGraphMode
          ? 'ui.graph.filter.hint_server'
          : 'ui.graph.filter.hint';
      },
      baseData() {
        const engineFilters = {
          categories: this.filters.categories,
          sites: this.filters.sites,
          states: this.filters.states,
          locations: this.filters.locations,
          types: this.filters.types,
          includeIsolated: this.filters.includeIsolated,
          search: this.filters.search
        };
        if (this.mode === 'focus' && this.focusAsset) {
          return Engine.focusData(this.source, this.focusAsset.id, this.depth, engineFilters);
        }
        return Engine.graphData(this.source, engineFilters);
      },
      baseNodes() {
        return this.baseData.nodes || [];
      },
      baseEdges() {
        return this.baseData.edges || [];
      },
      visibleNodes() {
        const hidden = this.hiddenIds;
        return this.baseNodes.filter(function (node) { return hidden.indexOf(node.id) === -1; });
      },
      visibleNodeIds() {
        return this.visibleNodes.map(function (node) { return node.id; });
      },
      visibleEdges() {
        const visible = this.visibleNodeIds;
        return this.baseEdges.filter(function (edge) {
          return visible.indexOf(edge.from) !== -1 && visible.indexOf(edge.to) !== -1;
        });
      },
      nodeViews() {
        // `frame` is read on purpose: positions live in a non-reactive simulation.
        const frame = this.frame;
        const sim = this.sim;
        if (!sim) return [];
        return this.visibleNodes.map(function (asset) {
          const node = sim.nodeById(asset.id);
          const level = this.mode === 'focus' ? (this.baseData.levels || {})[asset.id] : 0;
          return {
            id: asset.id,
            asset: asset,
            x: node ? node.x : 0,
            y: node ? node.y : 0,
            level: level === undefined ? 0 : level,
            family: RelationsData.familyOf(asset.category),
            icon: this.categoryIcon(asset),
            label: this.shortName(asset),
            hiddenCount: this.hiddenCount(asset.id),
            selected: this.selectedId === asset.id,
            dimmed: !this.isRelated(asset.id),
            redundancy: this.redundancyMembership[asset.id] || null,
            monitoring: this.infraMonitorStatus(asset.id),
            isFocus: this.mode === 'focus' && asset.id === this.activeFocusId,
            frame: frame
          };
        }, this);
      },
      edgeViews() {
        // Reading `frame` keeps this computed invalidated while the simulation
        // animates; node positions themselves are intentionally non-reactive.
        const frame = this.frame;
        const sim = this.sim;
        if (!sim) return [];
        const selected = this.selectedId;
        return this.visibleEdges.map(function (edge) {
          const source = sim.nodeById(edge.from);
          const target = sim.nodeById(edge.to);
          if (!source || !target) return null;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / distance;
          const uy = dy / distance;
          const start = { x: source.x + ux * 26, y: source.y + uy * 26 };
          const end = { x: target.x - ux * 32, y: target.y - uy * 32 };
          const related = selected && (edge.from === selected || edge.to === selected);
          return {
            id: edge.id,
            tone: edge.relation ? edge.relation.tone : 'network',
            directed: edge.relation ? edge.relation.directed !== false : true,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            highlighted: !!related,
            dimmed: !!selected && !related,
            label: related && edge.relation ? edge.relation.label : '',
            lx: (start.x + end.x) / 2,
            ly: (start.y + end.y) / 2,
            frame: frame
          };
        }, this).filter(Boolean);
      },
      graphTransform() {
        return 'translate(' + this.view.x + ' ' + this.view.y + ') scale(' + this.view.k + ')';
      },
      zoomLabel() {
        return Math.round(this.view.k * 100) + '%';
      },
      selectedAsset() {
        return this.selectedId ? Engine.assetById(this.source, this.selectedId) : null;
      },
      selectedRows() {
        return this.selectedAsset ? Engine.rowsFor(this.source, this.selectedAsset.id) : [];
      },
      selectedHidden() {
        return this.selectedAsset ? this.hiddenIds.filter((id) => this.neighbourIds(this.selectedAsset.id).indexOf(id) !== -1) : [];
      },
      legend() {
        const seen = [];
        this.visibleNodes.forEach((asset) => {
          const family = RelationsData.familyOf(asset.category);
          if (seen.indexOf(family) === -1) seen.push(family);
        });
        return seen.map((id) => ({ id, label: RelationsData.familyLabel(id) }));
      },
      stats() {
        return {
          nodes: this.visibleNodes.length,
          edges: this.visibleEdges.length,
          hidden: this.hiddenIds.length,
          total: this.baseNodes.length
        };
      },
      totalRelations() {
        return Engine.counts(this.source);
      },
      hasFilters() {
        return !!(this.filters.categories.length || this.filters.sites.length || this.filters.types.length
          || this.filters.search || !this.filters.includeIsolated);
      },
      showLabels() {
        return this.prefs.showLabels !== false;
      },
      canEdit() {
        return typeof this.app.can === 'function' ? this.app.can('assets.edit') : true;
      },
      mapHref() {
        const id = this.focusId || this.selectedId;
        return id ? '#/infra/mapa/activo/' + encodeURIComponent(id) : '#/infra/mapa';
      },
      // Los grupos vienen de la misma página acotada que la ficha del activo.
      // El grafo no pide nodos ni aristas de redundancia al servidor.
      redundancyGroups() {
        if (!this.app.serverGraphMode || !this.app.redundancy) return [];
        return this.app.redundancy.groups.items;
      },
      redundancyMembership() {
        return (this.app.redundancyMembership) || {};
      },
      redundancyLoaded() {
        return !!(this.app.redundancy && this.app.redundancy.groups.loaded);
      },
      redundancyTotal() {
        return this.app.redundancy ? this.app.redundancy.groups.total : 0;
      },
      redundancyTruncated() {
        return this.redundancyGroups.length < this.redundancyTotal;
      },
      showRedundancy() {
        return !!(this.redundancyOpen && this.app.serverGraphMode);
      },
      // Sólo los grupos con algún miembro visible: el panel nunca presenta un
      // grupo como si sus réplicas estuvieran en este grafo cuando no lo están.
      redundancyOptions() {
        const ids = this.visibleNodeIds || [];
        return this.redundancyGroups.filter(function (group) {
          return group.members.some(function (member) { return ids.indexOf(member.assetId) !== -1; });
        });
      },
      selectedRedundancy() {
        if (!this.selectedAsset) return [];
        return this.redundancyGroupsFor(this.selectedAsset.id);
      }
    },
    watch: {
      focusId(value) {
        if (value) {
          this.selectedId = Engine.assetById(this.source, value) ? value : '';
          this.hiddenIds = [];
          this.$nextTick(() => {
            this.measure();
            this.rebuild(true);
          });
        } else {
          this.hiddenIds = [];
          this.$nextTick(() => {
            this.measure();
            this.rebuild(true);
          });
        }
      },
      'prefs.group'() {
        this.rebuild(true);
      },
      'prefs.depth'() {
        this.hiddenIds = [];
        this.rebuild(true);
      },
      'prefs.showLabels'() {
        this.frame += 1;
      },
      filters: {
        deep: true,
        handler() {
          const shared = this.app.explorerFilters;
          if (shared) {
            if (!sameList(shared.categories, this.filters.categories)) shared.categories = this.filters.categories.slice();
            if (!sameList(shared.sites, this.filters.sites)) shared.sites = this.filters.sites.slice();
            if (!sameList(shared.states, this.filters.states)) shared.states = this.filters.states.slice();
            if (!sameList(shared.locations, this.filters.locations)) shared.locations = this.filters.locations.slice();
            if ((shared.search || '') !== this.filters.search) shared.search = this.filters.search;
          }
          this.hiddenIds = [];
          this.rebuild(true);
        }
      },
      selectedId(value) {
        if (this.app.explorerSelection !== value) this.app.explorerSelection = value || '';
      },
      'app.explorerSelection'(value) {
        const next = value || '';
        if (next === this.selectedId) return;
        if (next && !Engine.assetById(this.source, next)) return;
        this.selectedId = next;
      },
      'app.explorerFilters': {
        deep: true,
        handler(value) {
          if (!value) return;
          if (!sameList(value.categories, this.filters.categories)) this.filters.categories = (value.categories || []).slice();
          if (!sameList(value.sites, this.filters.sites)) this.filters.sites = (value.sites || []).slice();
          if (!sameList(value.states, this.filters.states)) this.filters.states = (value.states || []).slice();
          if (!sameList(value.locations, this.filters.locations)) this.filters.locations = (value.locations || []).slice();
          if ((value.search || '') !== this.filters.search) this.filters.search = value.search || '';
        }
      },
      baseData() {
        if (this.activeFocusId && this.focusAsset) this.selectedId = this.activeFocusId;
        this.rebuild(true);
      },
      'app.relations.links.length'() {
        this.rebuild(true);
      },
      'app.assets.length'() {
        this.rebuild(true);
      }
    },
    mounted() {
      this.hiddenPreference = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.measure();
      this.rebuild(true);
      if (typeof window.ResizeObserver === 'function' && this.$refs.canvas) {
        this.observer = new window.ResizeObserver(() => this.handleResize());
        this.observer.observe(this.$refs.canvas);
      }
      window.addEventListener('resize', this.handleResize);
      const canvas = this.$refs.canvas;
      if (canvas) canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.ready = true;
    },
    beforeUnmount() {
      this.stopLoop();
      if (this.observer) this.observer.disconnect();
      window.removeEventListener('resize', this.handleResize);
      window.removeEventListener('pointermove', this.onDragMove);
      window.removeEventListener('pointerup', this.onDragEnd);
      if (this.expandFrame) window.cancelAnimationFrame(this.expandFrame);
      if (this.expandTimer) window.clearTimeout(this.expandTimer);
      this.lockPageScroll(false);
      const canvas = this.$refs.canvas;
      if (canvas) canvas.removeEventListener('wheel', this.onWheel);
    },
    methods: {
      // ------------------------------------------------------------ geometry
      measure() {
        const element = this.$refs.canvas;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const width = Math.max(320, Math.round(rect.width));
        const height = Math.max(360, Math.round(rect.height));
        const changed = width !== this.size.w || height !== this.size.h;
        this.size = { w: width, h: height };
        if (changed && this.sim) this.sim.resize(width, height);
        if (changed) this.frame += 1;
      },
      handleResize() {
        // Keep the current zoom level: re-fitting on every resize (opening the
        // inspector narrows the canvas) would rescale the graph under the user.
        const element = this.$refs.canvas;
        const rect = element ? element.getBoundingClientRect() : null;
        // Anchor on the world point the user was looking at: the centre of the
        // canvas *before* this change, not the centre of the new frame. That is
        // what keeps the camera still when the workspace expands or exits.
        const anchor = rect ? this.toWorld(rect.left + this.size.w / 2, rect.top + this.size.h / 2) : null;
        this.measure();
        if (this.sim) {
          this.sim.reheat(0.4);
          this.scheduleLoop();
        }
        if (anchor) {
          // Never zoom in on resize, but always zoom out enough to keep the
          // whole graph inside the new frame (narrow viewports, split layout).
          // Expanding or exiting keeps the user's zoom exactly; a genuine
          // container resize may only zoom out enough to keep the whole graph.
          const k = this.keepZoom ? this.view.k : Math.min(this.view.k, this.sim ? this.fitScale() : this.view.k);
          this.view = {
            k: k,
            x: this.size.w / 2 - anchor.x * k,
            y: this.size.h / 2 - anchor.y * k
          };
          this.frame += 1;
        }
      },
      toWorld(clientX, clientY) {
        const element = this.$refs.canvas;
        const rect = element ? element.getBoundingClientRect() : { left: 0, top: 0 };
        return {
          x: (clientX - rect.left - this.view.x) / this.view.k,
          y: (clientY - rect.top - this.view.y) / this.view.k
        };
      },
      // --------------------------------------------------------------- graph
      groupOf(asset) {
        if (this.prefs.group === 'none') return 'all';
        if (this.prefs.group === 'site') return asset.site || 'sin-sede';
        return RelationsData.familyOf(asset.category);
      },
      rebuild(fitAfter) {
        const nodes = this.visibleNodes;
        const previous = {};
        if (this.sim) {
          this.sim.nodes.forEach((node) => { previous[node.id] = { x: node.x, y: node.y }; });
        }
        const width = this.size.w;
        const height = this.size.h;
        const groupOf = (asset) => this.groupOf(asset);
        this.sim = Layout.create({
          nodes: nodes.map((asset) => ({ id: asset.id, category: asset.category, site: asset.site })),
          links: this.visibleEdges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
          width: width,
          height: height,
          groupOf: groupOf
        });
        Object.keys(previous).forEach((id) => {
          const node = this.sim.nodeById(id);
          if (!node) return;
          node.x = previous[id].x;
          node.y = previous[id].y;
          node.vx = 0;
          node.vy = 0;
        });
        this.sim.settle(this.shouldAnimate() ? 220 : 420);
        this.frame += 1;
        if (fitAfter) this.fit();
        this.fitPending = true;
        if (this.shouldAnimate()) this.scheduleLoop();
        else this.finishLayout();
        if (this.selectedId && !this.visibleNodeIds.includes(this.selectedId)) {
          this.selectedId = '';
        }
      },
      shouldAnimate() {
        if (this.hiddenPreference) return false;
        return this.prefs.animate !== false;
      },
      scheduleLoop() {
        if (this.raf) return;
        if (!this.shouldAnimate()) {
          if (this.sim) this.sim.settle(140);
          this.finishLayout();
          return;
        }
        const loop = () => {
          if (!this.sim) { this.raf = null; return; }
          const alpha = this.sim.step();
          this.frame += 1;
          if (alpha > 0.012) {
            this.raf = window.requestAnimationFrame(loop);
          } else {
            this.raf = null;
            this.finishLayout();
          }
        };
        this.raf = window.requestAnimationFrame(loop);
      },
      finishLayout() {
        // Once the simulation stops, re-fit so the final positions still keep
        // every plate and label inside the canvas frame.
        if (this.sim) this.sim.settle(40);
        this.frame += 1;
        if (!this.fitPending) return;
        this.fitPending = false;
        this.fit();
      },
      stopLoop() {
        if (this.raf) {
          window.cancelAnimationFrame(this.raf);
          this.raf = null;
        }
      },
      redundancyGroupsFor(assetId) {
        const id = String(assetId || '');
        if (!id) return [];
        return this.redundancyGroups.filter(function (group) {
          return group.members.some(function (member) { return member.assetId === id; });
        });
      },
      memberFacts(member) {
        return typeof this.app.redundancyMemberFacts === 'function' ? this.app.redundancyMemberFacts(member) : '';
      },
      selectedMemberFacts(group) {
        if (!this.selectedAsset || !group) return '';
        const asset = this.selectedAsset;
        const member = group.members.find(function (item) { return item.assetId === asset.id; });
        return member ? this.memberFacts(member) : '';
      },
      resetLayout() {
        if (!this.sim) return;
        this.hiddenIds = [];
        this.rebuild(false);
        this.fit();
        this.announce = tr('ui.graph.announce.relayout');
      },
      // Zoom level that keeps every plate and label inside the canvas frame.
      fitScale() {
        const bounds = this.sim.bounds();
        // Reserve room for the labels that hang below each node.
        const marginX = 56;
        const marginTop = 34;
        const marginBottom = 78;
        const availW = Math.max(140, this.size.w - marginX * 2);
        const availH = Math.max(140, this.size.h - marginTop - marginBottom);
        const scale = Math.min(availW / bounds.width, availH / bounds.height, 1.5);
        return Math.max(0.32, Math.round(scale * 100) / 100);
      },
      fit() {
        if (!this.sim) return;
        const bounds = this.sim.bounds();
        const marginX = 56;
        const marginTop = 34;
        const marginBottom = 78;
        const availW = Math.max(140, this.size.w - marginX * 2);
        const availH = Math.max(140, this.size.h - marginTop - marginBottom);
        const k = this.fitScale();
        this.view = {
          x: marginX + (availW - bounds.width * k) / 2 - bounds.x * k,
          y: marginTop + (availH - bounds.height * k) / 2 - bounds.y * k,
          k: k
        };
        this.frame += 1;
      },
      centerOn(id) {
        if (!this.sim) return;
        const node = this.sim.nodeById(id);
        if (!node) return;
        this.view = {
          x: this.size.w / 2 - node.x * this.view.k,
          y: this.size.h / 2 - node.y * this.view.k,
          k: this.view.k
        };
        this.frame += 1;
      },
      zoomAt(factor, clientX, clientY) {
        const rect = this.$refs.canvas ? this.$refs.canvas.getBoundingClientRect() : { left: 0, top: 0, width: this.size.w, height: this.size.h };
        const px = clientX === undefined ? rect.left + rect.width / 2 : clientX;
        const py = clientY === undefined ? rect.top + rect.height / 2 : clientY;
        const nextK = Math.min(2.2, Math.max(0.35, this.view.k * factor));
        const worldX = (px - rect.left - this.view.x) / this.view.k;
        const worldY = (py - rect.top - this.view.y) / this.view.k;
        this.view = {
          x: px - rect.left - worldX * nextK,
          y: py - rect.top - worldY * nextK,
          k: Math.round(nextK * 100) / 100
        };
        this.frame += 1;
      },
      zoomBy(factor) {
        this.zoomAt(factor);
      },
      // ----------------------------------------------------------- expanded,
      // Expanding only re-measures the mounted canvas. The layout object and
      // the camera anchor survive, so nodes do not jump on enter or exit.
      toggleExpand() {
        this.expanded = !this.expanded;
        this.lockPageScroll(this.expanded);
        this.syncCanvasSize();
      },
      collapseExpand() {
        if (!this.expanded) return;
        this.expanded = false;
        this.lockPageScroll(false);
        this.syncCanvasSize();
      },
      lockPageScroll(locked) {
        const body = typeof document !== 'undefined' ? document.body : null;
        if (!body || !body.classList) return;
        body.classList.toggle('graph-workspace-expanded', !!locked);
      },
      syncCanvasSize() {
        // Keep the user's zoom for the whole layout settle: the observer may
        // report the growing frame more than once, and a queued re-fit would
        // rescale the graph the user was reading.
        this.fitPending = false;
        this.keepZoom = true;
        if (this.expandTimer) window.clearTimeout(this.expandTimer);
        this.expandTimer = window.setTimeout(() => {
          this.expandTimer = 0;
          this.keepZoom = false;
        }, 320);
        this.$nextTick(() => {
          this.handleResize();
          if (this.expandFrame) window.cancelAnimationFrame(this.expandFrame);
          this.expandFrame = window.requestAnimationFrame(() => {
            this.expandFrame = 0;
            this.handleResize();
          });
        });
      },
      // A selection mutes what it does not relate to; the relation data itself
      // is untouched, so every edge keeps its canonical type and direction.
      isRelated(id) {
        if (!this.selectedId) return true;
        if (id === this.selectedId) return true;
        return this.neighbourIds(this.selectedId).indexOf(id) !== -1;
      },
      onWheel(event) {
        event.preventDefault();
        this.zoomAt(event.deltaY > 0 ? 0.9 : 1.1, event.clientX, event.clientY);
      },
      // --------------------------------------------------------------- nodes
      categoryIcon(asset) {
        const category = this.categories.find((item) => item.id === asset.category);
        return category && category.icon ? category.icon : 'package';
      },
      glyph(icon) {
        const paths = window.AppIconPaths || {};
        return paths[icon] || paths.package || '';
      },
      shortName(asset) {
        const name = String(asset.name || '');
        return name.length > 16 ? name.slice(0, 15) + '…' : name;
      },
      neighbourIds(id) {
        const ids = [];
        this.baseEdges.forEach((edge) => {
          if (edge.from === id) ids.push(edge.to);
          if (edge.to === id) ids.push(edge.from);
        });
        return unique(ids);
      },
      hiddenCount(id) {
        const visible = this.visibleNodeIds;
        return this.neighbourIds(id).filter((neighbour) => visible.indexOf(neighbour) === -1).length;
      },
      selectNode(id, options) {
        if (!id) return;
        this.selectedId = id;
        this.infraMonitorSelect(id);
        const asset = Engine.assetById(this.source, id);
        const options2 = options || {};
        this.announce = asset
          ? tr('ui.graph.announce.node', { name: asset.name, category: RelationsData.categoryLabel(asset.category), count: Engine.rowsFor(this.source, id).length })
          : '';
        if (options2.center) this.centerOn(id);
      },
      focusOn(id) {
        this.hiddenIds = [];
        this.app.setHash(this.app.hashFor({ name: 'graph', focusId: id }));
        this.announce = tr('ui.graph.announce.focus');
      },
      leaveFocus() {
        this.app.setHash('#/infra/grafo');
        this.selectedId = '';
        this.announce = tr('ui.graph.announce.global');
      },
      openAsset(id) {
        const asset = Engine.assetById(this.source, id);
        if (asset) this.app.openAsset(asset);
      },
      expandNode(id) {
        const hiddenNeighbours = this.hiddenIds.filter((item) => this.neighbourIds(id).indexOf(item) !== -1);
        if (!hiddenNeighbours.length) {
          this.announce = tr('ui.graph.announce.no_hidden', { name: this.shortName(Engine.assetById(this.source, id) || { name: tr('ui.graph.this_asset') }) });
          return;
        }
        this.hiddenIds = this.hiddenIds.filter((item) => hiddenNeighbours.indexOf(item) === -1);
        this.announce = tr('ui.graph.announce.expanded');
        this.rebuild(false);
      },
      collapseNode(id) {
        const asset = Engine.assetById(this.source, id);
        if (!asset) return;
        const visible = this.visibleNodeIds;
        const leaves = this.neighbourIds(id).filter((neighbour) => {
          if (visible.indexOf(neighbour) === -1) return false;
          const others = this.neighbourIds(neighbour).filter((candidate) => candidate !== id && visible.indexOf(candidate) !== -1);
          return !others.length;
        });
        if (!leaves.length) {
          this.app.showToast(tr('ui.graph.announce.no_leaves_toast', { name: asset.name }));
          this.announce = tr('ui.graph.announce.no_leaves');
          return;
        }
        this.hiddenIds = unique(this.hiddenIds.concat(leaves));
        this.announce = tr('ui.graph.announce.collapsed', { count: leaves.length });
        this.rebuild(false);
      },
      expandAll() {
        if (!this.hiddenIds.length) {
          this.app.showToast(tr('ui.graph.announce.all_visible_toast'));
          return;
        }
        this.hiddenIds = [];
        this.rebuild(false);
        this.announce = tr('ui.graph.announce.all_visible');
      },
      // ----------------------------------------------------------- pointer
      startPan(event) {
        if (event.button !== 0) return;
        this.panning = { x: event.clientX, y: event.clientY, ox: this.view.x, oy: this.view.y };
        window.addEventListener('pointermove', this.onPanMove);
        window.addEventListener('pointerup', this.onPanEnd);
      },
      onPanMove(event) {
        if (!this.panning) return;
        this.view = {
          x: this.panning.ox + (event.clientX - this.panning.x),
          y: this.panning.oy + (event.clientY - this.panning.y),
          k: this.view.k
        };
        this.frame += 1;
      },
      onPanEnd() {
        this.panning = null;
        window.removeEventListener('pointermove', this.onPanMove);
        window.removeEventListener('pointerup', this.onPanEnd);
      },
      startDrag(node, event) {
        if (event.button !== undefined && event.button !== 0) return;
        if (!this.sim) return;
        event.stopPropagation();
        const world = this.toWorld(event.clientX, event.clientY);
        this.dragging = { id: node.id, moved: false, x: event.clientX, y: event.clientY };
        this.sim.pin(node.id, world.x, world.y);
        this.selectNode(node.id);
        window.addEventListener('pointermove', this.onDragMove);
        window.addEventListener('pointerup', this.onDragEnd);
      },
      onDragMove(event) {
        if (!this.dragging || !this.sim) return;
        if (Math.abs(event.clientX - this.dragging.x) + Math.abs(event.clientY - this.dragging.y) > 3) {
          this.dragging.moved = true;
        }
        const world = this.toWorld(event.clientX, event.clientY);
        this.sim.pin(this.dragging.id, world.x, world.y);
        this.sim.reheat(0.5);
        this.frame += 1;
        this.scheduleLoop();
      },
      onDragEnd() {
        if (this.dragging && this.sim) this.sim.release(this.dragging.id);
        this.dragging = null;
        window.removeEventListener('pointermove', this.onDragMove);
        window.removeEventListener('pointerup', this.onDragEnd);
        this.scheduleLoop();
      },
      // ---------------------------------------------------------- keyboard
      moveSelection(direction) {
        const nodes = this.visibleNodes;
        if (!nodes.length) return;
        if (!this.selectedId || !this.sim) {
          this.selectNode(nodes[0].id, { center: true });
          return;
        }
        const current = this.sim.nodeById(this.selectedId);
        if (!current) {
          this.selectNode(nodes[0].id, { center: true });
          return;
        }
        let best = null;
        let bestScore = Infinity;
        nodes.forEach((asset) => {
          if (asset.id === this.selectedId) return;
          const node = this.sim.nodeById(asset.id);
          if (!node) return;
          const dx = node.x - current.x;
          const dy = node.y - current.y;
          const forward = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
          if (forward <= 6) return;
          const lateral = direction === 'right' || direction === 'left' ? Math.abs(dy) : Math.abs(dx);
          const score = forward + lateral * 2.2;
          if (score < bestScore) {
            bestScore = score;
            best = asset.id;
          }
        });
        if (best) this.selectNode(best, { center: true });
      },
      // A focused control inside the canvas owns Enter and Space: the browser
      // turns them into a click on that control. The canvas must not also act on
      // the same keystroke and open the selected asset behind it.
      eventFromControl(event) {
        let node = event && event.target;
        while (node) {
          const tag = String(node.tagName || node.tag || '').toLowerCase();
          const role = (typeof node.getAttribute === 'function' && node.getAttribute('role')) || (node.props && node.props.role) || '';
          if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary' || role === 'button') return true;
          node = node.parentNode || node.parent;
        }
        return false;
      },
      onKeydown(event) {
        const key = event.key;
        if ((key === 'Enter' || key === ' ' || key === 'Spacebar') && this.eventFromControl(event)) return;
        if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowUp' || key === 'ArrowDown') {
          event.preventDefault();
          this.moveSelection(key === 'ArrowRight' ? 'right' : key === 'ArrowLeft' ? 'left' : key === 'ArrowDown' ? 'down' : 'up');
          return;
        }
        if (key === 'Enter' && this.selectedId) {
          event.preventDefault();
          this.openAsset(this.selectedId);
          return;
        }
        if (key === '+' || key === '=') {
          event.preventDefault();
          this.zoomBy(1.15);
          return;
        }
        if (key === '-') {
          event.preventDefault();
          this.zoomBy(0.87);
          return;
        }
        if (key === 'f' || key === 'F') {
          event.preventDefault();
          this.fit(true);
          return;
        }
        if (key === 'e' || key === 'E') {
          if (this.selectedId) this.expandNode(this.selectedId);
          return;
        }
        if (key === 'c' || key === 'C') {
          if (this.selectedId) this.collapseNode(this.selectedId);
          return;
        }
        if (key === 'Escape') {
          // Leaving the expanded workspace is not clearing the selection.
          if (this.expanded) {
            event.preventDefault();
            this.collapseExpand();
            const trigger = this.$refs.expandToggle;
            if (trigger && typeof trigger.focus === 'function') trigger.focus();
            return;
          }
          this.selectedId = '';
        }
      },
      // ----------------------------------------------------------- filters
      toggleList(list, value) {
        const index = list.indexOf(value);
        if (index === -1) list.push(value);
        else list.splice(index, 1);
      },
      siteLabel(id) {
        const site = this.sites.find((item) => item.id === id);
        return site ? site.label : tr('ui.graph.no_site');
      },
      clearFilters() {
        this.filters = { categories: [], sites: [], states: [], locations: [], types: [], includeIsolated: true, search: '' };
      },
      setGroup(group) {
        Engine.updatePrefs(this.app, { group });
      },
      toggleLabels() {
        Engine.updatePrefs(this.app, { showLabels: !this.showLabels });
      },
      updatePrefs(patch) {
        Engine.updatePrefs(this.app, patch);
      },
      // Categories are server data: use the catalog label the server exposes and
      // only fall back to the imported prototype table (Spanish-only placeholders)
      // for ids that predate the server catalog.
      categoryLabel(id) {
        const category = this.categories.find((item) => item.id === id);
        if (category && category.label) return category.label;
        return RelationsData.categoryLabel(id);
      },
      statusTone(asset) {
        return 'status-pill status--' + (asset.statusTone || 'hold');
      },
      // Administrative inventory state, not device availability: the server
      // catalog owns the label so custom statuses keep their configured text and
      // only the four built-in ids resolve through the shared catalog.
      statusLabel(asset) {
        const status = asset && asset.status ? String(asset.status) : '';
        if (!status) return '';
        const admin = (this.app && this.app.assetAdmin) || null;
        const configured = admin && Array.isArray(admin.statuses) ? admin.statuses : [];
        const match = configured.find((entry) => entry && (entry.id === status || entry.label === status));
        if (match && match.label) return match.label;
        const key = 'ui.inventory.status.' + status;
        const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
        if (runtime && typeof runtime.te === 'function' && runtime.te(key)) return tr(key);
        return status;
      }
    },
    template: `
      <div class="graph-page" :class="{ 'is-expanded': expanded }" data-od-id="graph-explorer">
        <header class="page-head graph-page__head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> {{ $t('ui.graph.explorer.eyebrow') }}</p>
            <h1 id="graph-title">{{ $t('ui.graph.explorer.title') }}</h1>
            <p class="page-sub">{{ $t('ui.graph.explorer.lead') }}</p>
          </div>
          <div class="page-head__meta">
            <!-- The plural messages already carry the count, so no bare number is printed next to them. -->
            <span>{{ $t('ui.graph.status.edges', { count: totalRelations.links }) }}</span>
            <span>{{ $t('ui.graph.status.isolated', { count: totalRelations.isolatedAssets }) }}</span>
          </div>
        </header>

        <nav class="infra-tabs" :aria-label="$t('ui.graph.aria.tabs')" data-od-id="graph-infra-tabs">
          <a class="infra-tab" :href="mapHref">
            <app-icon name="map-pin"></app-icon> {{ $t('ui.map.tab.map') }}
          </a>
          <span class="infra-tab is-active" aria-current="page">
            <app-icon name="network"></app-icon> {{ $t('ui.map.tab.graph') }}
          </span>
        </nav>

        <div class="graph-toolbar">
          <div class="graph-mode" role="group" :aria-label="$t('ui.graph.aria.mode')">
            <button type="button" class="graph-mode__button" :class="{ 'is-active': mode === 'global' }"
                    :aria-pressed="mode === 'global'" @click="leaveFocus">{{ $t('ui.graph.mode.global') }}</button>
            <button type="button" class="graph-mode__button" :class="{ 'is-active': mode === 'focus' }"
                    :aria-pressed="mode === 'focus'" :disabled="!focusAsset" @click="focusAsset && focusOn(focusAsset.id)">
              {{ $t('ui.graph.mode.focus') }}{{ focusAsset ? ' · ' + focusAsset.code : '' }}
            </button>
          </div>

          <div class="graph-toolbar__group" role="group" :aria-label="$t('ui.graph.aria.grouping')">
            <span class="graph-toolbar__label">{{ $t('ui.graph.group.label') }}</span>
            <div class="graph-segmented">
              <button v-for="option in groupOptions" :key="option.id" type="button"
                      class="graph-segmented__button" :class="{ 'is-active': prefs.group === option.id }"
                      :aria-pressed="prefs.group === option.id" @click="setGroup(option.id)">{{ option.label }}</button>
            </div>
          </div>

          <div v-if="mode === 'focus'" class="graph-toolbar__group" role="group" :aria-label="$t('ui.graph.aria.depth')">
            <span class="graph-toolbar__label">{{ $t('ui.graph.depth') }}</span>
            <div class="graph-segmented">
              <button v-for="level in [1, 2, 3]" :key="level" type="button" class="graph-segmented__button"
                      :class="{ 'is-active': depth === level }" :aria-pressed="depth === level"
                      :aria-label="$t('ui.graph.depth_aria', { level: level })" @click="updatePrefs({ depth: level })">{{ level }}</button>
            </div>
          </div>

          <div class="graph-toolbar__spacer"></div>

          <button type="button" class="btn btn--secondary btn--small graph-filters-toggle" :aria-expanded="filtersOpen"
                  @click="filtersOpen = !filtersOpen">
            <app-icon name="sliders"></app-icon> {{ $t('ui.graph.toolbar.filters') }}
          </button>
          <button type="button" class="btn btn--ghost btn--small" @click="expandAll">
            <app-icon name="layers"></app-icon> {{ $t('ui.graph.toolbar.expand_all') }}
          </button>
          <button type="button" class="btn btn--ghost btn--small" @click="resetLayout">
            <app-icon name="refresh"></app-icon> {{ $t('ui.graph.toolbar.relayout') }}
          </button>
          <button v-if="app.serverGraphMode" type="button" class="btn btn--ghost btn--small"
                  :aria-pressed="redundancyOpen" @click="redundancyOpen = !redundancyOpen">
            <app-icon name="layers"></app-icon> {{ $t('ui.graph.toolbar.redundancy') }}
          </button>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" @click="app.goToConfig('relaciones')">
            <app-icon name="sliders"></app-icon> {{ $t('ui.graph.toolbar.types') }}
          </button>
        </div>

        <div class="graph-layout" :class="{ 'graph-layout--panel': !!selectedAsset }">
          <aside class="graph-filters" :class="{ 'is-open': filtersOpen }" data-od-id="graph-filters" :aria-label="$t('ui.graph.aria.filters')">
            <div class="graph-filters__head">
              <h2>{{ $t('ui.graph.toolbar.filters') }}</h2>
              <button type="button" class="text-button" @click="clearFilters">{{ $t('ui.graph.filter.clear') }}</button>
            </div>

            <div class="field graph-filters__search">
              <label for="graph-search">{{ $t('ui.graph.filter.search') }}</label>
              <div class="input-shell">
                <app-icon name="search"></app-icon>
                <input id="graph-search" v-model="filters.search" type="search" :placeholder="$t('ui.graph.filter.search_placeholder')">
              </div>
            </div>

            <fieldset class="graph-filter-group">
              <legend>{{ $t('ui.graph.filter.category') }}</legend>
              <label v-for="category in categories" :key="category.id" class="graph-check">
                <input type="checkbox" :checked="filters.categories.includes(category.id)"
                       @change="toggleList(filters.categories, category.id)">
                <span>{{ category.label }}</span>
              </label>
            </fieldset>

            <fieldset class="graph-filter-group">
              <legend>{{ $t('ui.graph.filter.site') }}</legend>
              <label v-for="site in sites" :key="site.id" class="graph-check">
                <input type="checkbox" :checked="filters.sites.includes(site.id)"
                       @change="toggleList(filters.sites, site.id)">
                <span>{{ site.label }}</span>
              </label>
            </fieldset>

            <fieldset class="graph-filter-group">
              <legend>{{ $t('ui.graph.filter.type') }}</legend>
              <label v-for="type in types" :key="type.id" class="graph-check graph-check--tone">
                <input type="checkbox" :checked="filters.types.includes(type.id)"
                       @change="toggleList(filters.types, type.id)">
                <span class="graph-swatch" :class="'graph-swatch--' + type.tone" aria-hidden="true"></span>
                <span>{{ type.label }}</span>
              </label>
            </fieldset>

            <label class="graph-toggle">
              <input type="checkbox" v-model="filters.includeIsolated">
              <span>{{ $t('ui.graph.filter.include_isolated') }}</span>
            </label>

            <p class="graph-filters__hint"><app-icon name="info"></app-icon> {{ $t(filterHint) }}</p>
          </aside>

          <div class="graph-canvas-wrap">
            <div ref="canvas" class="graph-canvas" tabindex="0" role="group"
                 :class="{ 'is-expanded': expanded }"
                 :aria-label="$t('ui.graph.aria.canvas', { nodes: stats.nodes, edges: stats.edges })"
                 @keydown="onKeydown">
              <button ref="expandToggle" type="button" class="icon-button graph-expand-toggle"
                      data-od-id="graph-expand" :aria-pressed="expanded ? 'true' : 'false'"
                      :aria-label="expanded ? $t('ui.graph.aria.collapse_canvas') : $t('ui.graph.aria.expand_canvas')"
                      @click="toggleExpand">
                <app-icon :name="expanded ? 'chevron-down' : 'arrow-up-right'"></app-icon>
              </button>
              <svg class="graph-canvas__svg" :width="size.w" :height="size.h" aria-hidden="true">
                <defs>
                  <marker v-for="tone in ['network', 'virtual', 'physical', 'power', 'dependency', 'link']" :key="tone"
                          :id="'garrow-' + tone" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                          orient="auto-start-reverse">
                    <path d="M0 1 L9 5 L0 9 z" :class="'gedge-fill--' + tone"></path>
                  </marker>
                </defs>
                <rect class="graph-canvas__bg" x="0" y="0" :width="size.w" :height="size.h" @pointerdown="startPan"></rect>
                <g :transform="graphTransform">
                  <g class="graph-edges">
                    <g v-for="edge in edgeViews" :key="edge.id">
                      <line class="gedge" :class="['gedge--' + edge.tone, { 'is-active': edge.highlighted, 'is-dimmed': edge.dimmed, 'gedge--dashed': !edge.directed }]"
                            :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2"
                            :marker-end="edge.directed ? 'url(#garrow-' + edge.tone + ')' : null"></line>
                      <text v-if="edge.label" class="gedge__label" :x="edge.lx" :y="edge.ly" text-anchor="middle">{{ edge.label }}</text>
                    </g>
                  </g>
                  <g class="graph-nodes">
                    <g v-for="node in nodeViews" :key="node.id" class="gnode"
                       :class="['gnode--' + node.family, { 'is-selected': node.selected, 'is-focus': node.isFocus, 'is-dimmed': node.dimmed, 'is-level': mode === 'focus' && node.level === 0 }]"
                       :transform="'translate(' + node.x + ' ' + node.y + ')'"
                       role="button" tabindex="0" :aria-pressed="node.selected"
                       :aria-label="$t('ui.graph.aria.node', { name: node.asset.name, category: categoryLabel(node.asset.category), site: siteLabel(node.asset.site) }) + (node.monitoring ? ' — ' + $t('ui.infra.monitor.title') + ': ' + node.monitoring.label : '')"
                       @pointerdown="startDrag(node, $event)" @click.stop="selectNode(node.id)"
                       @keydown.enter.prevent="selectNode(node.id)" @keydown.space.prevent="selectNode(node.id)">
                      <circle class="gnode__halo" r="32"></circle>
                      <circle class="gnode__plate" r="23"></circle>
                      <g v-if="node.redundancy" class="gnode__redundancy"
                         :aria-label="$t('ui.graph.aria.node_redundancy', { count: node.redundancy.count })">
                        <circle r="6" cx="-19" cy="-19"></circle>
                      </g>
                      <svg class="gnode__glyph" x="-11" y="-11" width="22" height="22" viewBox="0 0 24 24"
                           fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                           stroke-linejoin="round" v-html="glyph(node.icon)"></svg>
                      <g v-if="node.hiddenCount" class="gnode__more" role="button" tabindex="0"
                         :aria-label="$t('ui.graph.aria.expand_hidden', { count: node.hiddenCount })"
                         @pointerdown.stop @click.stop="expandNode(node.id)" @keydown.enter.prevent.stop="expandNode(node.id)">
                        <circle r="11" cx="20" cy="-20"></circle>
                        <text x="20" y="-20" text-anchor="middle" dominant-baseline="central">+{{ node.hiddenCount }}</text>
                      </g>
                      <g v-if="node.monitoring" class="gnode__state"
                         :class="'gnode__state--' + node.monitoring.tone" aria-hidden="true">
                        <circle r="7" cx="17" cy="17"></circle>
                        <text x="17" y="17" text-anchor="middle" dominant-baseline="central">{{ node.monitoring.alerts ? node.monitoring.alerts : '!' }}</text>
                      </g>
                      <text v-if="view.k >= 0.8" class="gnode__code" y="46" text-anchor="middle">{{ node.asset.code }}</text>
                      <text v-if="showLabels && view.k >= 0.8" class="gnode__label" y="63" text-anchor="middle">{{ node.label }}</text>
                    </g>
                  </g>
                </g>
              </svg>

              <div class="graph-zoom" role="group" :aria-label="$t('ui.graph.aria.zoom')">
                <button type="button" class="icon-button" :aria-label="$t('ui.graph.aria.zoom_out')" @click="zoomBy(0.87)"><app-icon name="minus"></app-icon></button>
                <span class="graph-zoom__value mono">{{ zoomLabel }}</span>
                <button type="button" class="icon-button" :aria-label="$t('ui.graph.aria.zoom_in')" @click="zoomBy(1.15)"><app-icon name="plus"></app-icon></button>
                <button type="button" class="icon-button" :aria-label="$t('ui.graph.aria.center')" @click="fit(true)"><app-icon name="grid"></app-icon></button>
              </div>

              <p v-if="legend.length" class="graph-legend" :aria-label="$t('ui.graph.aria.legend')">
                <span v-for="item in legend" :key="item.id" class="graph-legend__item">
                  <span class="graph-swatch" :class="'graph-swatch--' + item.id" aria-hidden="true"></span>{{ item.label }}
                </span>
              </p>

              <p v-if="!nodeViews.length" class="graph-empty">
                <app-icon name="search"></app-icon>
                <span>{{ $t(emptyMessage) }}</span>
                <button v-if="emptyMessage === 'ui.graph.empty.no_match'" type="button" class="text-button" @click="clearFilters">{{ $t('ui.graph.empty.clear') }}</button>
              </p>

              <p v-if="stats.hidden" class="graph-hidden-note">
                <app-icon name="layers"></app-icon>
                {{ $t('ui.graph.hidden.note', { count: stats.hidden }) }}
                <button type="button" class="text-button" @click="expandAll">{{ $t('ui.graph.toolbar.expand_all') }}</button>
              </p>
            </div>

            <div class="graph-status">
              <!-- The count lives inside the plural message, so no number is repeated. -->
              <span v-if="stats.total !== stats.nodes" class="mono">{{ stats.nodes }} / {{ stats.total }}</span>
              <span>{{ $t('ui.graph.status.nodes', { count: stats.nodes }) }}</span>
              <span class="graph-status__sep" aria-hidden="true">·</span>
              <span>{{ $t('ui.graph.status.edges', { count: stats.edges }) }}</span>
              <span class="graph-status__hint">{{ $t('ui.graph.keys_hint') }}</span>
            </div>
            <p class="sr-only" aria-live="polite">{{ announce }}</p>

            <section v-if="showRedundancy" class="panel graph-redundancy" aria-labelledby="graph-redundancy-title">
              <header class="graph-redundancy__head">
                <div>
                  <h2 id="graph-redundancy-title">{{ $t('ui.graph.redundancy.title') }}</h2>
                  <span class="cell-note">{{ $t('ui.graph.redundancy.note') }}</span>
                </div>
                <button type="button" class="icon-button" :aria-label="$t('ui.graph.redundancy.close_aria')" @click="redundancyOpen = false">
                  <app-icon name="close"></app-icon>
                </button>
              </header>
              <p v-if="app.redundancy && app.redundancy.groups.error" class="form-error" role="alert">{{ app.redundancy.groups.error }}</p>
              <p v-else-if="!redundancyOptions.length" class="cell-note">{{ $t('ui.graph.redundancy.empty') }}</p>
              <ul v-else class="redundancy-list redundancy-list--graph">
                <li v-for="group in redundancyOptions" :key="group.id" class="redundancy-item">
                  <div class="redundancy-item__head">
                    <strong>{{ group.name }}</strong>
                    <span class="cell-note">{{ app.redundancyModeLabel(group.mode) }} · {{ group.active ? $t('ui.redundancy.status_active') : $t('ui.redundancy.status_inactive') }}</span>
                  </div>
                  <ul class="redundancy-members">
                    <li v-for="member in group.members" :key="member.assetId">
                      <button type="button" class="text-button" @click="selectNode(member.assetId, { center: true })">
                        {{ member.name || member.assetId }}
                      </button>
                      <span class="cell-note">{{ memberFacts(member) }}</span>
                    </li>
                  </ul>
                </li>
              </ul>
              <p v-if="redundancyTruncated" class="cell-note">
                {{ $t('ui.graph.redundancy.truncated', { loaded: redundancyGroups.length, total: redundancyTotal }) }}
              </p>
            </section>
          </div>


          <aside v-if="selectedAsset" class="graph-inspector" data-od-id="graph-inspector" :aria-label="$t('ui.graph.inspector.aria')">
            <header class="graph-inspector__head">
              <div>
                <p class="eyebrow">{{ categoryLabel(selectedAsset.category) }}</p>
                <h2>{{ selectedAsset.name }}</h2>
                <p class="mono graph-inspector__code">{{ selectedAsset.code }} · {{ siteLabel(selectedAsset.site) }}</p>
              </div>
              <button type="button" class="icon-button" :aria-label="$t('ui.graph.inspector.close_aria')" @click="selectedId = ''">
                <app-icon name="close"></app-icon>
              </button>
            </header>

            <div class="graph-inspector__meta">
              <span :class="statusTone(selectedAsset)">{{ statusLabel(selectedAsset) }}</span>
              <span v-if="selectedAsset.ip" class="mono graph-inspector__ip">{{ selectedAsset.ip }}</span>
            </div>

            <section class="infra-monitor" data-od-id="graph-monitor" :aria-label="$t('ui.infra.monitor.title')">
              <header class="infra-monitor__head">
                <h3 class="infra-monitor__title">{{ $t('ui.infra.monitor.title') }}</h3>
                <button type="button" class="btn btn--ghost btn--small" data-od-id="graph-monitor-refresh"
                        :disabled="infraMonitorPane.loading" :aria-busy="infraMonitorPane.loading ? 'true' : 'false'"
                        @click="refreshSelectedMonitoring">
                  <app-icon name="refresh" :class="{ 'infra-monitor__spin': infraMonitorPane.loading }"></app-icon>
                  {{ infraMonitorPane.loading ? $t('ui.monitoring.action.refreshing') : $t('ui.monitoring.action.refresh') }}
                </button>
              </header>
              <p class="infra-monitor__state">
                <span class="status-pill" :class="'status--' + infraMonitorPane.tone">{{ infraMonitorPane.known ? infraMonitorPane.statusLabel : $t('ui.infra.monitor.unknown') }}</span>
                <span v-if="infraMonitorPane.known && infraMonitorPane.reasonLabel" class="infra-monitor__reason">{{ infraMonitorPane.reasonLabel }}</span>
              </p>
              <p v-if="infraMonitorPane.error" class="infra-monitor__error" role="alert">{{ infraMonitorPane.error }}</p>
              <dl v-if="infraMonitorPane.values.length" class="infra-monitor__values">
                <div v-for="fact in infraMonitorPane.values" :key="fact.key" class="infra-monitor__fact">
                  <dt>{{ fact.label }}</dt>
                  <dd class="mono">{{ fact.value }}</dd>
                </div>
              </dl>
              <ul v-if="infraMonitorPane.recent.length" class="infra-monitor__alerts" :aria-label="$t('ui.monitoring.center.active_alerts')">
                <li v-for="alert in infraMonitorPane.recent" :key="alert.id" class="infra-monitor__alert">
                  <app-icon name="alert"></app-icon>
                  <span>{{ alert.label }}</span>
                </li>
              </ul>
              <p class="infra-monitor__note">{{ infraMonitorPane.note }}</p>
            </section>

            <div class="graph-inspector__actions">
              <button type="button" class="btn btn--primary btn--small" @click="openAsset(selectedAsset.id)">
                <app-icon name="file-text"></app-icon> {{ $t('ui.graph.action.open_asset') }}
              </button>
              <button v-if="!selectedAsset.retired" type="button" class="btn btn--secondary btn--small"
                      @click="focusOn(selectedAsset.id)">
                <app-icon name="network"></app-icon> {{ $t('ui.graph.action.focus_here') }}
              </button>
            </div>

            <div class="graph-inspector__subhead">
              <h3>{{ $t('ui.graph.inspector.relations') }}</h3>
              <span class="mono">{{ selectedRows.length }}</span>
            </div>

            <ul v-if="selectedRows.length" class="graph-relations">
              <li v-for="row in selectedRows" :key="row.id" class="graph-relations__row">
                <button type="button" class="graph-relations__link" @click="selectNode(row.other.id, { center: true })">
                  <span class="graph-relations__type">
                    <app-icon :name="row.type.icon"></app-icon> {{ row.label }}
                  </span>
                  <span class="graph-relations__name">{{ row.other.name }}</span>
                  <span class="mono graph-relations__code">{{ row.other.code }}</span>
                </button>
                <button type="button" class="icon-button icon-button--small" :aria-label="$t('ui.graph.action.open_asset_aria', { name: row.other.name })"
                        @click="openAsset(row.other.id)">
                  <app-icon name="arrow-up-right"></app-icon>
                </button>
              </li>
            </ul>
            <p v-else class="graph-inspector__empty">{{ $t('ui.graph.inspector.relations_empty') }}</p>

            <div v-if="selectedRedundancy.length" class="graph-inspector__redundancy">
              <div class="graph-inspector__subhead">
                <h3>{{ $t('ui.graph.redundancy.title') }}</h3>
                <span class="mono">{{ selectedRedundancy.length }}</span>
              </div>
              <ul class="redundancy-members">
                <li v-for="group in selectedRedundancy" :key="group.id">
                  <strong>{{ group.name }}</strong>
                  <span class="cell-note">{{ app.redundancyModeLabel(group.mode) }} · {{ selectedMemberFacts(group) }}</span>
                </li>
              </ul>
              <p class="cell-note">{{ $t('ui.graph.inspector.hosting_note') }}</p>
            </div>

            <div class="graph-inspector__foot">
              <button type="button" class="btn btn--ghost btn--small" :disabled="!selectedHidden.length"
                      @click="expandNode(selectedAsset.id)">
                <app-icon name="plus"></app-icon> {{ $t('ui.graph.action.expand') }}
              </button>
              <button type="button" class="btn btn--ghost btn--small" @click="collapseNode(selectedAsset.id)">
                <app-icon name="minus"></app-icon> {{ $t('ui.graph.action.collapse_leaves') }}
              </button>
            </div>
          </aside>
        </div>
      </div>
    `
  };
})();
