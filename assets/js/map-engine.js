(function () {
  'use strict';

  const Data = window.AssetMapData;
  const PLAN_W = Data.PLAN_WIDTH;
  const PLAN_H = Data.PLAN_HEIGHT;

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : (fallback || '');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mapsOf(app) {
    return app && app.maps && typeof app.maps === 'object' ? app.maps : Data.normalizeMaps(null, [], []);
  }

  function siteList(app) {
    return list(app && app.sites);
  }

  function siteById(app, id) {
    return siteList(app).find(function (site) { return site.id === id; }) || null;
  }

  function siteGeo(app, siteId) {
    const maps = mapsOf(app);
    const geo = maps.geo && maps.geo[siteId];
    return geo ? { lat: geo.lat, lng: geo.lng, address: geo.address } : null;
  }

  function buildingById(app, id) {
    return list(mapsOf(app).buildings).find(function (item) { return item.id === id; }) || null;
  }

  function floorById(app, id) {
    return list(mapsOf(app).floors).find(function (item) { return item.id === id; }) || null;
  }

  function roomById(app, id) {
    return list(mapsOf(app).rooms).find(function (item) { return item.id === id; }) || null;
  }

  function plansForFloor(app, floorId) {
    return list(mapsOf(app).plans).filter(function (plan) { return plan.floor === floorId; });
  }

  function primaryPlan(app, floorId) {
    const plans = plansForFloor(app, floorId);
    return plans.find(function (plan) { return plan.visible; }) || plans[0] || null;
  }

  function floorOfAsset(app, asset) {
    if (!asset) return null;
    const maps = mapsOf(app);
    const room = roomById(app, asset.locationId);
    if (room) return room.floor;
    // A device can be assigned to a floor/building/site, not only a room.
    // Walk the canonical ancestry before falling back to the site's first
    // floor, so an unpositioned device stays on its actual floor.
    const index = maps.locationIndex || {};
    let current = index[asset.locationId];
    let guard = 0;
    while (current && guard < 8) {
      if (current.level === 'floor') return current.id;
      current = index[current.parentId];
      guard += 1;
    }
    const floors = list(maps.floors).filter(function (floor) { return floor.site === asset.site; });
    return floors.length ? floors[0].id : '';
  }

  function roomOfAsset(app, asset) {
    if (!asset) return null;
    return roomById(app, asset.locationId);
  }

  function matchesSearch(asset, search) {
    const term = text(search).trim().toLocaleLowerCase('es');
    if (!term) return true;
    const haystack = [asset.name, asset.code, asset.ip, asset.serial, asset.brand, asset.model, asset.assignee, asset.location]
      .filter(Boolean).join(' ').toLocaleLowerCase('es');
    return haystack.indexOf(term) !== -1;
  }

  function filterAssets(app, filters) {
    const source = filters || {};
    const categories = list(source.categories);
    const sites = list(source.sites);
    const states = list(source.states);
    const locations = list(source.locations);
    const includeRetired = source.includeRetired === true || !!(mapsOf(app).prefs && mapsOf(app).prefs.showRetired);
    return list(app && app.assets).filter(function (asset) {
      if (asset.retired && !includeRetired) return false;
      if (categories.length && categories.indexOf(asset.category) === -1) return false;
      if (sites.length && sites.indexOf(asset.site) === -1) return false;
      if (states.length && states.indexOf(asset.status) === -1 && states.indexOf(asset.statusId) === -1) return false;
      if (locations.length && locations.indexOf(asset.locationId) === -1) return false;
      return matchesSearch(asset, source.search);
    });
  }

  function statusOptions(app) {
    const seen = [];
    list(app && app.assets).forEach(function (asset) {
      const status = text(asset.status);
      if (status && seen.indexOf(status) === -1) seen.push(status);
    });
    return seen;
  }

  function counts(app, filters) {
    const assets = filterAssets(app, filters);
    return {
      assets: assets.length,
      total: list(app && app.assets).length,
      sites: list(app && app.sites).length,
      buildings: list(mapsOf(app).buildings).length,
      floors: list(mapsOf(app).floors).length,
      rooms: list(mapsOf(app).rooms).length,
      plans: list(mapsOf(app).plans).length,
      cameras: assets.filter(function (asset) { return asset.category === 'camaras'; }).length
    };
  }

  function siteCount(app, filters, siteId) {
    return filterAssets(app, filters).filter(function (asset) { return asset.site === siteId; }).length;
  }

  // Screen-space clustering: the caller decides which coordinate space the
  // points live in (map pixels or plan units), so the same greedy rule serves
  // both the geographic markers and the interior devices.
  function clusterPoints(points, radius) {
    const clusters = [];
    const limit = Math.max(1, Number(radius) || 48);
    points.forEach(function (point) {
      let target = null;
      for (let index = 0; index < clusters.length; index += 1) {
        const cluster = clusters[index];
        const dx = cluster.x - point.x;
        const dy = cluster.y - point.y;
        if (Math.sqrt(dx * dx + dy * dy) <= limit) { target = cluster; break; }
      }
      if (!target) {
        target = { x: point.x, y: point.y, points: [] };
        clusters.push(target);
      }
      target.points.push(point);
      target.x = target.points.reduce(function (sum, item) { return sum + item.x; }, 0) / target.points.length;
      target.y = target.points.reduce(function (sum, item) { return sum + item.y; }, 0) / target.points.length;
    });
    return clusters.map(function (cluster) {
      return {
        id: cluster.points.map(function (point) { return point.id; }).sort().join('|'),
        x: cluster.x,
        y: cluster.y,
        points: cluster.points,
        count: cluster.points.length
      };
    });
  }

  function sitePoints(app, filters) {
    return siteList(app).map(function (site) {
      const geo = siteGeo(app, site.id);
      const assets = filterAssets(app, filters).filter(function (asset) { return asset.site === site.id; });
      const floors = list(mapsOf(app).floors).filter(function (floor) { return floor.site === site.id; });
      const rooms = list(mapsOf(app).rooms).filter(function (room) { return room.site === site.id; });
      return {
        id: site.id,
        site: site,
        lat: geo ? geo.lat : 0,
        lng: geo ? geo.lng : 0,
        count: assets.length,
        total: list(app.assets).filter(function (asset) { return asset.site === site.id; }).length,
        floors: floors.length,
        rooms: rooms.length,
        cameras: assets.filter(function (asset) { return asset.category === 'camaras'; }).length,
        categories: assets.map(function (asset) { return asset.category; }).filter(function (value, index, all) { return all.indexOf(value) === index; })
      };
    });
  }

  function floorAssets(app, filters, floorId) {
    return filterAssets(app, filters).filter(function (asset) { return floorOfAsset(app, asset) === floorId; });
  }

  function tree(app, filters) {
    const assets = filterAssets(app, filters);
    const maps = mapsOf(app);
    const bySite = {};
    assets.forEach(function (asset) {
      bySite[asset.site] = bySite[asset.site] || [];
      bySite[asset.site].push(asset);
    });
    return siteList(app).map(function (site) {
      const siteAssets = bySite[site.id] || [];
      const buildings = list(maps.buildings).filter(function (building) { return building.site === site.id; }).map(function (building) {
        const floors = list(maps.floors).filter(function (floor) { return floor.building === building.id; }).map(function (floor) {
          const floorDevices = siteAssets.filter(function (asset) { return floorOfAsset(app, asset) === floor.id; });
          const floorRooms = [];
          list(maps.rooms).filter(function (room) { return room.floor === floor.id; }).forEach(function (room) {
            floorRooms.push({
              id: room.id,
              name: room.name,
              floor: floor.id,
              area: room.area,
              count: floorDevices.filter(function (asset) { return asset.locationId === room.id; }).length
            });
          });
          const roomIds = floorRooms.map(function (room) { return room.id; });
          const loose = floorDevices.filter(function (asset) { return roomIds.indexOf(asset.locationId) === -1; });
          if (loose.length) {
            floorRooms.push({ id: floor.id + '-sin-sala', name: 'Sin sala asignada', floor: floor.id, area: 0, count: loose.length, loose: true });
          }
          return {
            id: floor.id,
            name: floor.name,
            level: floor.level,
            area: floor.area,
            count: floorDevices.length,
            rooms: floorRooms,
            plan: primaryPlan(app, floor.id),
            plans: plansForFloor(app, floor.id)
          };
        });
        return {
          id: building.id,
          name: building.name,
          kind: building.kind,
          year: building.year,
          floors: floors,
          count: floors.reduce(function (sum, floor) { return sum + floor.count; }, 0)
        };
      });
      return {
        id: site.id,
        name: site.label,
        short: site.short,
        city: site.geo ? site.geo.city : '',
        count: siteAssets.length,
        buildings: buildings
      };
    });
  }

  function floorView(app, filters, floorId) {
    const floor = floorById(app, floorId);
    if (!floor) return null;
    const building = buildingById(app, floor.building);
    const site = siteById(app, floor.site);
    const plan = primaryPlan(app, floorId);
    const assets = floorAssets(app, filters, floorId);
    const positions = mapsOf(app).positions || {};
    const placed = [];
    const loose = [];
    assets.forEach(function (asset) {
      const position = positions[asset.id];
      if (position && position.floor === floorId) {
        placed.push({ asset: asset, x: position.x, y: position.y, placed: true });
      } else {
        loose.push(asset);
      }
    });
    const roomGroups = list(mapsOf(app).rooms).filter(function (room) { return room.floor === floorId; }).map(function (room) {
      const roomAssets = loose.filter(function (asset) { return asset.locationId === room.id; });
      return {
        id: room.id,
        name: room.name,
        area: room.area,
        x: room.x,
        y: room.y,
        w: room.w,
        h: room.h,
        assets: roomAssets,
        count: roomAssets.length
      };
    });
    const roomIds = roomGroups.map(function (room) { return room.id; });
    const orphans = loose.filter(function (asset) { return roomIds.indexOf(asset.locationId) === -1; });
    return {
      floor: floor,
      building: building,
      site: site,
      plan: plan,
      plans: plansForFloor(app, floorId),
      placed: placed,
      rooms: roomGroups,
      orphans: orphans,
      assets: assets,
      count: assets.length,
      placedCount: placed.length
    };
  }

  function cameraView(app, asset) {
    if (!asset) return null;
    const views = mapsOf(app).cameraViews || {};
    const view = views[asset.id];
    if (view && view.src) {
      return {
        src: view.src,
        caption: view.caption || '',
        heading: view.heading || '',
        range: view.range || '',
        angle: Number(view.angle) || 0,
        bearing: Number(view.bearing) || 0,
        alt: view.alt || ('Campo de visión de ' + asset.name),
        floor: view.floor || floorOfAsset(app, asset)
      };
    }
    if (asset.fovImage) {
      const technical = asset.technical && typeof asset.technical === 'object' ? asset.technical : {};
      return {
        src: asset.fovImage,
        caption: 'Campo de visión registrado',
        heading: '',
        range: '',
        angle: Number(technical.fovAngle) || 0,
        bearing: 0,
        alt: 'Campo de visión de ' + asset.name,
        floor: floorOfAsset(app, asset)
      };
    }
    return null;
  }

  function setGeo(app, siteId, patch) {
    if (!app || !app.maps || !siteById(app, siteId)) return false;
    const current = app.maps.geo[siteId] || {};
    const lat = Number(patch && patch.lat);
    const lng = Number(patch && patch.lng);
    app.maps.geo[siteId] = {
      lat: Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : current.lat,
      lng: Number.isFinite(lng) ? Math.max(-180, Math.min(180, lng)) : current.lng,
      address: patch && typeof patch.address === 'string' ? patch.address : current.address
    };
    return true;
  }

  function setPrefs(app, patch) {
    if (!app || !app.maps) return false;
    app.maps.prefs = Object.assign({}, app.maps.prefs, patch || {});
    return true;
  }

  function setPlan(app, planId, patch) {
    if (!app || !app.maps) return false;
    const plan = list(app.maps.plans).find(function (item) { return item.id === planId; });
    if (!plan) return false;
    Object.assign(plan, patch || {});
    return true;
  }

  function addPlan(app, payload) {
    if (!app || !app.maps) return null;
    const floor = floorById(app, payload && payload.floor);
    if (!floor) return null;
    const src = text(payload && payload.src);
    if (!src) return null;
    const id = 'plan-' + floor.id + '-' + Date.now().toString(36);
    const plan = {
      id: id,
      site: floor.site,
      building: floor.building,
      floor: floor.id,
      name: text(payload && payload.name, 'Plano personalizado'),
      kind: text(payload && payload.kind, 'Plano personalizado'),
      src: src,
      width: PLAN_W,
      height: PLAN_H,
      format: /\.svg($|\?)/i.test(src) || /^data:image\/svg/i.test(src) ? 'svg' : 'imagen',
      visible: true,
      opacity: 1,
      updated: new Date().toISOString().slice(0, 10)
    };
    app.maps.plans.push(plan);
    return plan;
  }

  function removePlan(app, planId) {
    if (!app || !app.maps) return false;
    const index = list(app.maps.plans).findIndex(function (plan) { return plan.id === planId; });
    if (index === -1) return false;
    app.maps.plans.splice(index, 1);
    return true;
  }

  function setPosition(app, assetId, floorId, x, y) {
    if (!app || !app.maps) return false;
    const floor = floorById(app, floorId);
    if (!floor || !list(app.assets).some(function (asset) { return asset.id === assetId; })) return false;
    const px = Math.max(0, Math.min(PLAN_W, Number(x)));
    const py = Math.max(0, Math.min(PLAN_H, Number(y)));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    app.maps.positions[assetId] = { floor: floorId, x: Math.round(px), y: Math.round(py) };
    return true;
  }

  function removePosition(app, assetId) {
    if (!app || !app.maps || !app.maps.positions[assetId]) return false;
    delete app.maps.positions[assetId];
    return true;
  }

  function planById(app, planId) {
    return list(mapsOf(app).plans).find(function (plan) { return plan.id === planId; }) || null;
  }

  function percentX(value) {
    return (Number(value) / PLAN_W) * 100;
  }

  function percentY(value) {
    return (Number(value) / PLAN_H) * 100;
  }

  window.AssetMapEngine = {
    PLAN_W,
    PLAN_H,
    clone,
    mapsOf,
    siteById,
    siteGeo,
    buildingById,
    floorById,
    roomById,
    planById,
    plansForFloor,
    primaryPlan,
    floorOfAsset,
    roomOfAsset,
    filterAssets,
    statusOptions,
    counts,
    siteCount,
    sitePoints,
    floorAssets,
    tree,
    floorView,
    clusterPoints,
    cameraView,
    setGeo,
    setPrefs,
    setPlan,
    addPlan,
    removePlan,
    setPosition,
    removePosition,
    percentX,
    percentY
  };
})();
