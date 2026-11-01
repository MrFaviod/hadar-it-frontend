(function () {
  'use strict';

  // Human-visible copy comes from the shared catalog; the runtime is optional so
  // the module still loads in a harness without i18n.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const Engine = window.AssetMapEngine;
  const Data = window.AssetMapData;

  /** Floor interior logic: plan geometry, room chips, markers and positioning. */
  window.AssetMapFloorLogic = {
    computed: {
      activeSiteFloors() {
        if (!this.activeSiteId) return [];
        const site = this.tree.find((item) => item.id === this.activeSiteId);
        if (!site) return [];
        return site.buildings.reduce((floors, building) => floors.concat(building.floors), []);
      },
      floorView() {
        if (!this.activeFloorId) return null;
        // `source` is the composed canonical model in server mode and the app
        // itself in prototype mode; geometry is always read from it.
        return Engine.floorView(this.source, this.filters, this.activeFloorId);
      },
      floor() {
        return this.floorView ? this.floorView.floor : null;
      },
      plan() {
        return this.floorView ? this.floorView.plan : null;
      },
      floorContext() {
        if (!this.floorView) return { siteName: '', buildingName: '', floorName: '', origin: '' };
        return {
          siteName: this.floorView.site ? this.floorView.site.label : '',
          buildingName: this.floorView.building ? this.floorView.building.name : '',
          floorName: this.floorView.floor.name,
          origin: (this.floorView.site ? this.floorView.site.label : '') + ' · ' + (this.floorView.building ? this.floorView.building.name : '')
        };
      },
      camera() {
        if (!this.selectedAsset || this.selectedAsset.category !== 'camaras') return null;
        return Engine.cameraView(this.source, this.selectedAsset);
      },
      floorMarkers() {
        if (!this.floorView) return [];
        const placed = this.floorView.placed;
        const positions = this.maps.positions;
        const sources = placed.map((item) => ({ id: item.asset.id, x: Number(item.x) || 0, y: Number(item.y) || 0 }));
        const grouped = this.prefs.clusters
          ? Engine.clusterPoints(sources, 90 / this.floorZoom)
          : sources.map((source) => ({ id: source.id, x: source.x, y: source.y, points: [source], count: 1 }));
        return grouped.map((cluster) => {
          const asset = (this.source.assets || []).find((item) => item.id === cluster.points[0].id) || null;
          if (!asset) return null;
          return {
            id: cluster.id,
            x: cluster.x,
            y: cluster.y,
            count: cluster.count,
            asset: asset,
            ids: cluster.points.map((point) => point.id),
            family: window.AssetRelationsData ? window.AssetRelationsData.familyOf(asset.category) : 'network',
            icon: this.iconFor(asset.category),
            selected: cluster.count === 1 && cluster.points[0].id === this.selectedId,
            positioned: positions[asset.id] && positions[asset.id].floor === this.activeFloorId
          };
        }).filter(Boolean);
      },
      roomChips() {
        if (!this.floorView) return [];
        return this.floorView.rooms.filter((room) => room.count > 0).map((room) => ({
          id: room.id,
          name: room.name,
          count: room.count,
          x: room.x + room.w / 2,
          y: room.y + room.h / 2
        }));
      },
      selectedRoomData() {
        if (!this.selectedRoom || !this.floorView) return null;
        const room = Engine.roomById(this.source, this.selectedRoom);
        if (!room) return null;
        const assets = this.floorView.assets.filter((asset) => asset.locationId === room.id);
        return { room: room, assets: assets };
      },
      selectedPath() {
        const asset = this.selectedAsset;
        if (!asset) return '';
        const room = Engine.roomOfAsset(this.source, asset);
        const floor = room ? Engine.floorById(this.source, room.floor) : null;
        const building = floor ? Engine.buildingById(this.source, floor.building) : null;
        const site = this.source.sites.find((item) => item.id === asset.site);
        return [site ? site.label : asset.site, building ? building.name : '', floor ? floor.name : '', room ? room.name : '']
          .filter(Boolean).join(' › ');
      },
    },
    methods: {
      openFloor(floorId, options) {
        const floor = Engine.floorById(this.source, floorId);
        if (!floor) return;
        this.level = 'floor';
        this.activeFloorId = floorId;
        this.activeSiteId = floor.site;
        this.openSiteId = floor.site;
        this.openBuildingId = floor.building;
        this.selectedRoom = '';
        this.floorZoom = 1;
        if (!options || options.keepSelection !== true) this.selectedId = '';
        if (!options || options.silent !== true) {
          this.announce = tr('ui.map.announce.floor_opened', { floor: floor.name, building: Engine.buildingById(this.source, floor.building).name });
        }
      },
      openPlan(planId) {
        const plan = Engine.planById(this.source, planId);
        if (plan) this.openFloor(plan.floor);
      },
      backToGeo() {
        this.level = 'geo';
        this.selectedRoom = '';
        this.floorZoom = 1;
        if (this.activeSiteId) this.focusActiveSite(true);
        this.announce = tr('ui.map.announce.map_restored');
      },
      selectRoom(roomId, floorId) {
        if (floorId && floorId !== this.activeFloorId) this.openFloor(floorId, { silent: true });
        this.selectedRoom = roomId;
        this.selectedId = '';
        const room = Engine.roomById(this.source, roomId);
        this.announce = tr('ui.map.announce.room_selected', { room: room ? room.name : '' });
      },
      showAssetFloor() {
        const asset = this.selectedAsset;
        if (!asset) return;
        const floorId = Engine.floorOfAsset(this.source, asset);
        if (floorId) this.openFloor(floorId, { keepSelection: true });
      },
      zoomFloor(factor) {
        this.floorZoom = Math.max(0.75, Math.min(3, Math.round(this.floorZoom * factor * 100) / 100));
      },
      resetFloorZoom() {
        this.floorZoom = 1;
      },
      startMarkerDrag(marker, event) {
        if (!this.canEdit || marker.count > 1) return;
        if (event.button !== undefined && event.button !== 0) return;
        const paper = this.$refs.paper;
        if (!paper) return;
        this.drag = { id: marker.asset.id };
        window.addEventListener('pointermove', this.onMarkerMove);
        window.addEventListener('pointerup', this.onMarkerUp);
        event.preventDefault();
      },
      onMarkerMove(event) {
        if (!this.drag || !this.$refs.paper) return;
        let x;
        let y;
        if (this.serverMapMode && this._floorMap && this.$refs.floorCanvas) {
          const canvas = this.$refs.floorCanvas.getBoundingClientRect();
          const point = this._floorMap.unproject([event.clientX - canvas.left, event.clientY - canvas.top]);
          x = point.lng * Engine.PLAN_H;
          y = (1 - point.lat) * Engine.PLAN_H;
        } else {
          const rect = this.$refs.paper.getBoundingClientRect();
          x = ((event.clientX - rect.left) / rect.width) * Engine.PLAN_W;
          y = ((event.clientY - rect.top) / rect.height) * Engine.PLAN_H;
        }
        Engine.setPosition(this.source, this.drag.id, this.activeFloorId, x, y);
      },
      onMarkerUp() {
        if (this.drag) {
          const asset = (this.source.assets || []).find((item) => item.id === this.drag.id);
          this.announce = tr('ui.map.announce.position_updated', { name: asset ? asset.name : '' });
          this.persistServerPosition(this.drag.id, this.activeFloorId);
        }
        this.drag = null;
        window.removeEventListener('pointermove', this.onMarkerMove);
        window.removeEventListener('pointerup', this.onMarkerUp);
      },
      clearPosition(assetId) {
        Engine.removePosition(this.source, assetId);
        this.announce = tr('ui.map.announce.position_removed');
        if (this.app.serverMapMode) {
          this.app.saveOrganizationPosition(assetId, '', null, null);
        }
      },
      persistServerPosition(assetId, floorId) {
        if (!this.app.serverMapMode) return;
        const position = this.maps.positions[assetId];
        if (!position) return;
        this.app.saveOrganizationPosition(assetId, floorId || position.floor, position.x, position.y);
      },
      startMarkerKey(event, marker) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        if (!this.canEdit || marker.count > 1) return;
        const step = event.shiftKey ? 40 : 12;
        const position = this.maps.positions[marker.asset.id];
        if (!position) return;
        const next = { x: position.x, y: position.y };
        if (event.key === 'ArrowLeft') next.x -= step;
        if (event.key === 'ArrowRight') next.x += step;
        if (event.key === 'ArrowUp') next.y -= step;
        if (event.key === 'ArrowDown') next.y += step;
        Engine.setPosition(this.source, marker.asset.id, this.activeFloorId, next.x, next.y);
        this.persistServerPosition(marker.asset.id, this.activeFloorId);
        this.announce = tr('ui.map.announce.position_adjusted', { name: marker.asset.name });
        event.preventDefault();
      },
      // ------------------------------------------------------------ map layers,
      togglePlan(plan) {
        Engine.setPlan(this.app, plan.id, { visible: !plan.visible });
        this.announce = plan.visible ? tr('ui.map.announce.plan_hidden', { name: plan.name }) : tr('ui.map.announce.plan_visible', { name: plan.name });
      },
      setPlanOpacity(value) {
        Engine.setPrefs(this.app, { planOpacity: Math.max(0.2, Math.min(1, Number(value))) });
        if (this.plan) Engine.setPlan(this.app, this.plan.id, { opacity: Number(value) });
      },
      floorLabel(floorId) {
        const floor = Engine.floorById(this.source, floorId);
        if (!floor) return '';
        const building = Engine.buildingById(this.source, floor.building);
        return (building ? building.name + ' · ' : '') + floor.name;
      },
      percentX(value) {
        return (Number(value) / Engine.PLAN_W) * 100;
      },
      percentY(value) {
        return (Number(value) / Engine.PLAN_H) * 100;
      },
    }
  };
}());
