(function () {
  'use strict';

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
      fovCone() {
        const asset = this.selectedAsset;
        const view = this.camera;
        if (!asset || !view || !view.angle) return '';
        const position = this.maps.positions[asset.id];
        if (!position || position.floor !== this.activeFloorId) return '';
        const length = 440;
        const half = (view.angle / 2) * (Math.PI / 180);
        const bearing = ((view.bearing || 0) * Math.PI) / 180;
        const points = [];
        const steps = 18;
        for (let index = 0; index <= steps; index += 1) {
          const angle = bearing - half + (2 * half * index) / steps;
          points.push([
            (position.x + Math.sin(angle) * length).toFixed(1),
            (position.y - Math.cos(angle) * length).toFixed(1)
          ]);
        }
        return 'M ' + position.x + ' ' + position.y + ' L ' + points.map((point) => point.join(' ')).join(' L ') + ' Z';
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
          this.announce = 'Plano abierto: ' + floor.name + ', ' + Engine.buildingById(this.source, floor.building).name + '.';
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
        this.announce = 'Vista de mapa restaurada.';
      },
      selectRoom(roomId, floorId) {
        if (floorId && floorId !== this.activeFloorId) this.openFloor(floorId, { silent: true });
        this.selectedRoom = roomId;
        this.selectedId = '';
        const room = Engine.roomById(this.source, roomId);
        this.announce = 'Sala ' + (room ? room.name : '') + ' seleccionada.';
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
        const rect = this.$refs.paper.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * Engine.PLAN_W;
        const y = ((event.clientY - rect.top) / rect.height) * Engine.PLAN_H;
        Engine.setPosition(this.source, this.drag.id, this.activeFloorId, x, y);
      },
      onMarkerUp() {
        if (this.drag) {
          const asset = (this.source.assets || []).find((item) => item.id === this.drag.id);
          this.announce = 'Posición de ' + (asset ? asset.name : 'activo') + ' actualizada en el plano.';
          this.persistServerPosition(this.drag.id, this.activeFloorId);
        }
        this.drag = null;
        window.removeEventListener('pointermove', this.onMarkerMove);
        window.removeEventListener('pointerup', this.onMarkerUp);
      },
      clearPosition(assetId) {
        Engine.removePosition(this.source, assetId);
        this.announce = 'Posición individual eliminada; el activo vuelve a su sala.';
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
        this.announce = 'Posición de ' + marker.asset.name + ' ajustada.';
        event.preventDefault();
      },
      // ------------------------------------------------------------ map layers,
      togglePlan(plan) {
        Engine.setPlan(this.app, plan.id, { visible: !plan.visible });
        this.announce = 'Plano ' + plan.name + (plan.visible ? ' oculto' : ' visible') + '.';
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
