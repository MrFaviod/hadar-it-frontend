(function () {
  'use strict';

  const Engine = window.AssetRelations;
  const Layout = window.AssetGraphLayout;
  const RelationsData = window.AssetRelationsData;
  const TONES = ['network', 'virtual', 'physical', 'power', 'dependency', 'link'];
  const GROUPS = [
    { id: 'category', label: 'Categoría' },
    { id: 'site', label: 'Sede' },
    { id: 'none', label: 'Sin agrupar' }
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
    props: {
      app: { type: Object, required: true },
      focusId: { type: String, default: '' }
    },
    data() {
      const shared = this.app.explorerFilters || {};
      return {
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
        ready: false
      };
    },
    computed: {
      prefs() {
        return this.app.graphPrefs || {};
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
        return Array.isArray(this.app.categories) ? this.app.categories : [];
      },
      sites() {
        return Array.isArray(this.app.sites) ? this.app.sites : [];
      },
      types() {
        return this.app.relations && Array.isArray(this.app.relations.types) ? this.app.relations.types : [];
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
        return GROUPS;
      },
      depth() {
        return this.prefs.depth || 2;
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
        return this.selectedId ? Engine.assetById(this.app, this.selectedId) : null;
      },
      selectedRows() {
        return this.selectedAsset ? Engine.rowsFor(this.app, this.selectedAsset.id) : [];
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
        return Engine.counts(this.app);
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
      }
    },
    watch: {
      focusId(value) {
        if (value) {
          this.selectedId = Engine.assetById(this.app, value) ? value : '';
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
        if (next && !Engine.assetById(this.app, next)) return;
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
        const anchor = rect ? this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        this.measure();
        if (this.sim) {
          this.sim.reheat(0.4);
          this.scheduleLoop();
        }
        if (anchor) {
          // Never zoom in on resize, but always zoom out enough to keep the
          // whole graph inside the new frame (narrow viewports, split layout).
          const k = Math.min(this.view.k, this.sim ? this.fitScale() : this.view.k);
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
      resetLayout() {
        if (!this.sim) return;
        this.hiddenIds = [];
        this.rebuild(false);
        this.fit();
        this.announce = 'Disposición del grafo recalculada.';
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
        const asset = Engine.assetById(this.app, id);
        const options2 = options || {};
        this.announce = asset
          ? asset.name + ', ' + RelationsData.categoryLabel(asset.category) + ', ' + Engine.rowsFor(this.app, id).length + ' relaciones.'
          : '';
        if (options2.center) this.centerOn(id);
      },
      focusOn(id) {
        this.hiddenIds = [];
        this.app.setHash(this.app.hashFor({ name: 'graph', focusId: id }));
        this.announce = 'Modo enfocado activado.';
      },
      leaveFocus() {
        this.app.setHash('#/infra/grafo');
        this.selectedId = '';
        this.announce = 'Vista global del grafo.';
      },
      openAsset(id) {
        const asset = Engine.assetById(this.app, id);
        if (asset) this.app.openAsset(asset);
      },
      expandNode(id) {
        const hiddenNeighbours = this.hiddenIds.filter((item) => this.neighbourIds(id).indexOf(item) !== -1);
        if (!hiddenNeighbours.length) {
          this.announce = 'No hay relaciones contraídas en ' + (this.shortName(Engine.assetById(this.app, id) || { name: 'este activo' })) + '.';
          return;
        }
        this.hiddenIds = this.hiddenIds.filter((item) => hiddenNeighbours.indexOf(item) === -1);
        this.announce = 'Relaciones expandidas.';
        this.rebuild(false);
      },
      collapseNode(id) {
        const asset = Engine.assetById(this.app, id);
        if (!asset) return;
        const visible = this.visibleNodeIds;
        const leaves = this.neighbourIds(id).filter((neighbour) => {
          if (visible.indexOf(neighbour) === -1) return false;
          const others = this.neighbourIds(neighbour).filter((candidate) => candidate !== id && visible.indexOf(candidate) !== -1);
          return !others.length;
        });
        if (!leaves.length) {
          this.app.showToast('“' + asset.name + '” no tiene relaciones hoja para contraer.');
          this.announce = 'Sin relaciones hoja.';
          return;
        }
        this.hiddenIds = unique(this.hiddenIds.concat(leaves));
        this.announce = leaves.length + ' relaciones contraídas.';
        this.rebuild(false);
      },
      expandAll() {
        if (!this.hiddenIds.length) {
          this.app.showToast('Todas las relaciones ya están visibles.');
          return;
        }
        this.hiddenIds = [];
        this.rebuild(false);
        this.announce = 'Todas las relaciones visibles.';
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
      onKeydown(event) {
        const key = event.key;
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
        return site ? site.label : 'Sin sede';
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
      categoryLabel(id) {
        return RelationsData.categoryLabel(id);
      },
      statusTone(asset) {
        return 'status-pill status--' + (asset.statusTone || 'hold');
      }
    },
    template: `
      <div class="graph-page" data-od-id="graph-explorer">
        <header class="page-head graph-page__head">
          <div class="page-head__copy">
            <p class="eyebrow"><span class="eyebrow__line"></span> Infraestructura</p>
            <h1 id="graph-title">Grafo de relaciones</h1>
            <p class="page-sub">Arrastra para mover, rueda para acercar, clic en un nodo para ver su detalle.</p>
          </div>
          <div class="page-head__meta">
            <span class="mono">{{ totalRelations.links }}</span>
            <span>{{ totalRelations.links === 1 ? 'vínculo' : 'vínculos' }}</span>
            <span class="mono">{{ totalRelations.isolatedAssets }}</span>
            <span>{{ totalRelations.isolatedAssets === 1 ? 'activo aislado' : 'activos aislados' }}</span>
          </div>
        </header>

        <nav class="infra-tabs" aria-label="Modos del explorador" data-od-id="graph-infra-tabs">
          <a class="infra-tab" :href="mapHref">
            <app-icon name="map-pin"></app-icon> Mapa
          </a>
          <span class="infra-tab is-active" aria-current="page">
            <app-icon name="network"></app-icon> Grafo
          </span>
        </nav>

        <div class="graph-toolbar">
          <div class="graph-mode" role="group" aria-label="Modo del grafo">
            <button type="button" class="graph-mode__button" :class="{ 'is-active': mode === 'global' }"
                    :aria-pressed="mode === 'global'" @click="leaveFocus">Vista global</button>
            <button type="button" class="graph-mode__button" :class="{ 'is-active': mode === 'focus' }"
                    :aria-pressed="mode === 'focus'" :disabled="!focusAsset" @click="focusAsset && focusOn(focusAsset.id)">
              Enfocado{{ focusAsset ? ' · ' + focusAsset.code : '' }}
            </button>
          </div>

          <div class="graph-toolbar__group" role="group" aria-label="Agrupación">
            <span class="graph-toolbar__label">Agrupar</span>
            <div class="graph-segmented">
              <button v-for="option in groupOptions" :key="option.id" type="button"
                      class="graph-segmented__button" :class="{ 'is-active': prefs.group === option.id }"
                      :aria-pressed="prefs.group === option.id" @click="setGroup(option.id)">{{ option.label }}</button>
            </div>
          </div>

          <div v-if="mode === 'focus'" class="graph-toolbar__group" role="group" aria-label="Profundidad">
            <span class="graph-toolbar__label">Profundidad</span>
            <div class="graph-segmented">
              <button v-for="level in [1, 2, 3]" :key="level" type="button" class="graph-segmented__button"
                      :class="{ 'is-active': depth === level }" :aria-pressed="depth === level"
                      :aria-label="'Profundidad ' + level" @click="updatePrefs({ depth: level })">{{ level }}</button>
            </div>
          </div>

          <div class="graph-toolbar__spacer"></div>

          <button type="button" class="btn btn--secondary btn--small graph-filters-toggle" :aria-expanded="filtersOpen"
                  @click="filtersOpen = !filtersOpen">
            <app-icon name="sliders"></app-icon> Filtros
          </button>
          <button type="button" class="btn btn--ghost btn--small" @click="expandAll">
            <app-icon name="layers"></app-icon> Expandir todo
          </button>
          <button type="button" class="btn btn--ghost btn--small" @click="resetLayout">
            <app-icon name="refresh"></app-icon> Reacomodar
          </button>
          <button v-if="canEdit" type="button" class="btn btn--primary btn--small" @click="app.goToConfig('relaciones')">
            <app-icon name="sliders"></app-icon> Tipos
          </button>
        </div>

        <div class="graph-layout" :class="{ 'graph-layout--panel': !!selectedAsset }">
          <aside class="graph-filters" :class="{ 'is-open': filtersOpen }" data-od-id="graph-filters" aria-label="Filtros del grafo">
            <div class="graph-filters__head">
              <h2>Filtros</h2>
              <button type="button" class="text-button" @click="clearFilters">Limpiar</button>
            </div>

            <div class="field graph-filters__search">
              <label for="graph-search">Buscar activo</label>
              <div class="input-shell">
                <app-icon name="search"></app-icon>
                <input id="graph-search" v-model="filters.search" type="search" placeholder="Nombre, código o IP">
              </div>
            </div>

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
              <legend>Tipo de relación</legend>
              <label v-for="type in types" :key="type.id" class="graph-check graph-check--tone">
                <input type="checkbox" :checked="filters.types.includes(type.id)"
                       @change="toggleList(filters.types, type.id)">
                <span class="graph-swatch" :class="'graph-swatch--' + type.tone" aria-hidden="true"></span>
                <span>{{ type.label }}</span>
              </label>
            </fieldset>

            <label class="graph-toggle">
              <input type="checkbox" v-model="filters.includeIsolated">
              <span>Mostrar activos sin vínculos</span>
            </label>

            <p class="graph-filters__hint"><app-icon name="info"></app-icon> Los filtros se aplican al modo activo. Las relaciones contraídas se olvidan al cambiar de filtro.</p>
          </aside>

          <div class="graph-canvas-wrap">
            <div ref="canvas" class="graph-canvas" tabindex="0" role="group"
                 :aria-label="'Grafo con ' + stats.nodes + ' activos y ' + stats.edges + ' vínculos'"
                 @keydown="onKeydown">
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
                      <line class="gedge" :class="['gedge--' + edge.tone, { 'is-active': edge.highlighted, 'gedge--dashed': !edge.directed }]"
                            :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2"
                            :marker-end="edge.directed ? 'url(#garrow-' + edge.tone + ')' : null"></line>
                      <text v-if="edge.label" class="gedge__label" :x="edge.lx" :y="edge.ly" text-anchor="middle">{{ edge.label }}</text>
                    </g>
                  </g>
                  <g class="graph-nodes">
                    <g v-for="node in nodeViews" :key="node.id" class="gnode"
                       :class="['gnode--' + node.family, { 'is-selected': node.selected, 'is-focus': node.isFocus, 'is-level': mode === 'focus' && node.level === 0 }]"
                       :transform="'translate(' + node.x + ' ' + node.y + ')'"
                       role="button" tabindex="0" :aria-pressed="node.selected"
                       :aria-label="node.asset.name + ', ' + categoryLabel(node.asset.category) + ', ' + siteLabel(node.asset.site)"
                       @pointerdown="startDrag(node, $event)" @click.stop="selectNode(node.id)"
                       @keydown.enter.prevent="selectNode(node.id)" @keydown.space.prevent="selectNode(node.id)">
                      <circle class="gnode__halo" r="32"></circle>
                      <circle class="gnode__plate" r="23"></circle>
                      <svg class="gnode__glyph" x="-11" y="-11" width="22" height="22" viewBox="0 0 24 24"
                           fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                           stroke-linejoin="round" v-html="glyph(node.icon)"></svg>
                      <g v-if="node.hiddenCount" class="gnode__more" role="button" tabindex="0"
                         :aria-label="'Expandir ' + node.hiddenCount + ' relaciones'"
                         @pointerdown.stop @click.stop="expandNode(node.id)" @keydown.enter.prevent.stop="expandNode(node.id)">
                        <circle r="11" cx="20" cy="-20"></circle>
                        <text x="20" y="-20" text-anchor="middle" dominant-baseline="central">+{{ node.hiddenCount }}</text>
                      </g>
                      <text v-if="view.k >= 0.8" class="gnode__code" y="46" text-anchor="middle">{{ node.asset.code }}</text>
                      <text v-if="showLabels && view.k >= 0.8" class="gnode__label" y="63" text-anchor="middle">{{ node.label }}</text>
                    </g>
                  </g>
                </g>
              </svg>

              <div class="graph-zoom" role="group" aria-label="Zoom">
                <button type="button" class="icon-button" aria-label="Alejar" @click="zoomBy(0.87)"><app-icon name="minus"></app-icon></button>
                <span class="graph-zoom__value mono">{{ zoomLabel }}</span>
                <button type="button" class="icon-button" aria-label="Acercar" @click="zoomBy(1.15)"><app-icon name="plus"></app-icon></button>
                <button type="button" class="icon-button" aria-label="Centrar el grafo" @click="fit(true)"><app-icon name="grid"></app-icon></button>
              </div>

              <p class="graph-legend" aria-label="Familias de categorías">
                <span v-for="item in legend" :key="item.id" class="graph-legend__item">
                  <span class="graph-swatch" :class="'graph-swatch--' + item.id" aria-hidden="true"></span>{{ item.label }}
                </span>
              </p>

              <p v-if="!nodeViews.length" class="graph-empty">
                <app-icon name="search"></app-icon>
                <span>Ningún activo coincide con los filtros activos.</span>
                <button type="button" class="text-button" @click="clearFilters">Limpiar filtros</button>
              </p>

              <p v-if="stats.hidden" class="graph-hidden-note">
                <app-icon name="layers"></app-icon>
                {{ stats.hidden }} {{ stats.hidden === 1 ? 'activ hid' : 'activos ocultos' }} por relaciones contraídas.
                <button type="button" class="text-button" @click="expandAll">Expandir todo</button>
              </p>
            </div>

            <div class="graph-status">
              <span class="mono">{{ stats.nodes }} / {{ stats.total }}</span>
              <span>{{ stats.nodes === 1 ? 'nodo visible' : 'nodos visibles' }}</span>
              <span class="graph-status__sep" aria-hidden="true">·</span>
              <span class="mono">{{ stats.edges }}</span>
              <span>{{ stats.edges === 1 ? 'vínculo' : 'vínculos' }}</span>
              <span class="graph-status__hint">Tab y flechas para navegar · Enter abre la ficha · E expande · C contrae</span>
            </div>
            <p class="sr-only" aria-live="polite">{{ announce }}</p>
          </div>

          <aside v-if="selectedAsset" class="graph-inspector" data-od-id="graph-inspector" aria-label="Activo seleccionado">
            <header class="graph-inspector__head">
              <div>
                <p class="eyebrow">{{ categoryLabel(selectedAsset.category) }}</p>
                <h2>{{ selectedAsset.name }}</h2>
                <p class="mono graph-inspector__code">{{ selectedAsset.code }} · {{ siteLabel(selectedAsset.site) }}</p>
              </div>
              <button type="button" class="icon-button" aria-label="Cerrar selección" @click="selectedId = ''">
                <app-icon name="close"></app-icon>
              </button>
            </header>

            <div class="graph-inspector__meta">
              <span :class="statusTone(selectedAsset)">{{ selectedAsset.status }}</span>
              <span v-if="selectedAsset.ip" class="mono graph-inspector__ip">{{ selectedAsset.ip }}</span>
            </div>

            <div class="graph-inspector__actions">
              <button type="button" class="btn btn--primary btn--small" @click="openAsset(selectedAsset.id)">
                <app-icon name="file-text"></app-icon> Abrir ficha
              </button>
              <button v-if="!selectedAsset.retired" type="button" class="btn btn--secondary btn--small"
                      @click="focusOn(selectedAsset.id)">
                <app-icon name="network"></app-icon> Enfocar aquí
              </button>
            </div>

            <div class="graph-inspector__subhead">
              <h3>Relaciones</h3>
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
                <button type="button" class="icon-button icon-button--small" :aria-label="'Abrir ficha de ' + row.other.name"
                        @click="openAsset(row.other.id)">
                  <app-icon name="arrow-up-right"></app-icon>
                </button>
              </li>
            </ul>
            <p v-else class="graph-inspector__empty">Este activo todavía no tiene vínculos registrados.</p>

            <div class="graph-inspector__foot">
              <button type="button" class="btn btn--ghost btn--small" :disabled="!selectedHidden.length"
                      @click="expandNode(selectedAsset.id)">
                <app-icon name="plus"></app-icon> Expandir
              </button>
              <button type="button" class="btn btn--ghost btn--small" @click="collapseNode(selectedAsset.id)">
                <app-icon name="minus"></app-icon> Contraer hojas
              </button>
            </div>
          </aside>
        </div>
      </div>
    `
  };
})();
