(function () {
  'use strict';

  // Geographic base and physical layout of the demo organisation. Coordinates
  // are simulated, deterministic and expressed in WGS84 so MapLibre can place
  // them without a geocoding service. Floor plans share one 1600 x 1000 space,
  // which keeps asset positions portable between the plan drawing and the
  // interior view.
  const PLAN_WIDTH = 1600;
  const PLAN_HEIGHT = 1000;

  const sites = {
    central: {
      lat: -25.2820, lng: -57.6350, city: 'Asunción', region: 'Central',
      address: 'Av. Mariscal López 1420', radius: 340
    },
    dc: {
      lat: -25.3092, lng: -57.5871, city: 'Asunción', region: 'Central',
      address: 'Parque Tecnológico, Lote 7', radius: 260
    },
    norte: {
      lat: -23.4090, lng: -57.4340, city: 'Concepción', region: 'Concepción',
      address: 'Ruta PY05, km 3', radius: 300
    },
    sur: {
      lat: -27.3360, lng: -55.8660, city: 'Encarnación', region: 'Itapúa',
      address: 'Parque Industrial, Etapa 2', radius: 420
    }
  };

  const buildings = [
    { id: 'central-edificio', site: 'central', name: 'Edificio Central', kind: 'Oficinas', address: 'Av. Mariscal López 1420', year: 2014 },
    { id: 'norte-edificio', site: 'norte', name: 'Edificio Norte', kind: 'Oficinas y atención', address: 'Ruta PY05, km 3', year: 2009 },
    { id: 'sur-nave1', site: 'sur', name: 'Nave 1', kind: 'Industrial', address: 'Parque Industrial, Etapa 2', year: 2011 },
    { id: 'sur-nave2', site: 'sur', name: 'Nave 2', kind: 'Producción', address: 'Parque Industrial, Etapa 2', year: 2011 },
    { id: 'dc-edificio', site: 'dc', name: 'Edificio Técnico', kind: 'Data center', address: 'Parque Tecnológico, Lote 7', year: 2019 }
  ];

  const floors = [
    { id: 'central-p2', building: 'central-edificio', site: 'central', name: 'Piso 2', level: 2, area: 620 },
    { id: 'central-p3', building: 'central-edificio', site: 'central', name: 'Piso 3', level: 3, area: 620 },
    { id: 'central-p4', building: 'central-edificio', site: 'central', name: 'Piso 4', level: 4, area: 540 },
    { id: 'norte-pb', building: 'norte-edificio', site: 'norte', name: 'Planta baja', level: 0, area: 480 },
    { id: 'norte-p1', building: 'norte-edificio', site: 'norte', name: 'Piso 1', level: 1, area: 420 },
    { id: 'sur-n1-pb', building: 'sur-nave1', site: 'sur', name: 'Planta baja · Nave 1', level: 0, area: 900 },
    { id: 'sur-n2-pb', building: 'sur-nave2', site: 'sur', name: 'Planta baja · Nave 2', level: 0, area: 1240 },
    { id: 'dc-pb', building: 'dc-edificio', site: 'dc', name: 'Sala técnica', level: 0, area: 310 }
  ];

  // Rooms reuse the location ids already present in the inventory, so every
  // asset lands in the physical tree without touching its record.
  const rooms = [
    { id: 'administracion', site: 'central', floor: 'central-p2', name: 'Administración', x: 120, y: 190, w: 520, h: 430, area: 180 },
    { id: 'diseno', site: 'central', floor: 'central-p3', name: 'Diseño', x: 120, y: 190, w: 700, h: 470, area: 210 },
    { id: 'direccion', site: 'central', floor: 'central-p4', name: 'Dirección', x: 120, y: 190, w: 620, h: 430, area: 160 },
    { id: 'recepcion', site: 'norte', floor: 'norte-pb', name: 'Recepción', x: 140, y: 220, w: 640, h: 400, area: 150 },
    { id: 'soporte', site: 'norte', floor: 'norte-p1', name: 'Soporte técnico', x: 160, y: 210, w: 520, h: 360, area: 120 },
    { id: 'comunicaciones', site: 'sur', floor: 'sur-n1-pb', name: 'Sala de comunicaciones', x: 180, y: 230, w: 460, h: 380, area: 140 },
    { id: 'produccion', site: 'sur', floor: 'sur-n2-pb', name: 'Producción', x: 120, y: 180, w: 900, h: 520, area: 620 },
    { id: 'operaciones', site: 'sur', floor: 'sur-n2-pb', name: 'Operaciones', x: 1080, y: 180, w: 400, h: 520, area: 260 },
    { id: 'zona-fria-a', site: 'dc', floor: 'dc-pb', name: 'Zona fría A', x: 100, y: 170, w: 600, h: 660, area: 96 },
    { id: 'zona-fria-b', site: 'dc', floor: 'dc-pb', name: 'Zona fría B', x: 740, y: 170, w: 460, h: 660, area: 78 },
    { id: 'sala-comunicaciones', site: 'dc', floor: 'dc-pb', name: 'Sala de comunicaciones', x: 1240, y: 170, w: 280, h: 660, area: 54 }
  ];

  const plans = [
    {
      id: 'plan-central-p2', site: 'central', building: 'central-edificio', floor: 'central-p2',
      name: 'Administración', kind: 'Planta de oficinas', src: 'assets/svg/plans/central-piso2.svg',
      width: PLAN_WIDTH, height: PLAN_HEIGHT, format: 'svg', visible: true, opacity: 1,
      updated: '2026-01-12'
    },
    {
      id: 'plan-central-p3', site: 'central', building: 'central-edificio', floor: 'central-p3',
      name: 'Diseño', kind: 'Planta de oficinas', src: 'assets/svg/plans/central-piso3.svg',
      width: PLAN_WIDTH, height: PLAN_HEIGHT, format: 'svg', visible: true, opacity: 1,
      updated: '2026-01-12'
    },
    {
      id: 'plan-norte-pb', site: 'norte', building: 'norte-edificio', floor: 'norte-pb',
      name: 'Recepción y acceso', kind: 'Planta de atención', src: 'assets/svg/plans/norte-planta-baja.svg',
      width: PLAN_WIDTH, height: PLAN_HEIGHT, format: 'svg', visible: true, opacity: 1,
      updated: '2026-02-03'
    },
    {
      id: 'plan-sur-n2', site: 'sur', building: 'sur-nave2', floor: 'sur-n2-pb',
      name: 'Producción y operaciones', kind: 'Planta industrial', src: 'assets/svg/plans/sur-nave2.svg',
      width: PLAN_WIDTH, height: PLAN_HEIGHT, format: 'svg', visible: true, opacity: 1,
      updated: '2026-02-18'
    },
    {
      id: 'plan-dc-pb', site: 'dc', building: 'dc-edificio', floor: 'dc-pb',
      name: 'Sala técnica · racks', kind: 'Planta técnica', src: 'assets/svg/plans/dc-sala-fria.svg',
      width: PLAN_WIDTH, height: PLAN_HEIGHT, format: 'svg', visible: true, opacity: 1,
      updated: '2026-03-02'
    }
  ];

  // Optional placements. Assets without an entry stay attached to their room
  // and appear grouped by zone in the interior view.
  const positions = {
    'AM-1044': { floor: 'central-p2', x: 350, y: 340 },
    'AM-1048': { floor: 'central-p2', x: 1125, y: 773 },
    'AM-1066': { floor: 'central-p2', x: 1425, y: 300 },
    'AM-1042': { floor: 'central-p3', x: 1120, y: 340 },
    'AM-1052': { floor: 'central-p3', x: 420, y: 335 },
    'AM-1055': { floor: 'central-p3', x: 478, y: 345 },
    'AM-1049': { floor: 'norte-pb', x: 921, y: 584 },
    'AM-1053': { floor: 'norte-pb', x: 1041, y: 584 },
    'AM-1065': { floor: 'norte-pb', x: 530, y: 600 },
    'AM-1064': { floor: 'norte-pb', x: 1395, y: 300 },
    'AM-1057': { floor: 'norte-pb', x: 260, y: 210 },
    'AM-1045': { floor: 'sur-n2-pb', x: 520, y: 480 },
    'AM-1056': { floor: 'sur-n2-pb', x: 1270, y: 635 },
    'AM-1061': { floor: 'sur-n2-pb', x: 820, y: 260 },
    'AM-1046': { floor: 'dc-pb', x: 640, y: 390 },
    'AM-1058': { floor: 'dc-pb', x: 525, y: 596 },
    'AM-1059': { floor: 'dc-pb', x: 640, y: 450 },
    'AM-1067': { floor: 'dc-pb', x: 150, y: 760 },
    'AM-1047': { floor: 'dc-pb', x: 990, y: 390 },
    'AM-1062': { floor: 'dc-pb', x: 925, y: 596 },
    'AM-1063': { floor: 'dc-pb', x: 1055, y: 596 },
    'AM-1060': { floor: 'dc-pb', x: 970, y: 735 },
    'AM-1050': { floor: 'dc-pb', x: 1323, y: 410 }
  };

  // Camera coverage images are independent from the device photograph.
  const cameraViews = {
    'AM-1057': {
      src: 'assets/svg/camera-fov.svg', floor: 'norte-pb',
      caption: 'Recepción · acceso principal y mostrador',
      heading: 'Hacia el acceso norte', range: '18 m', angle: 110, bearing: 145,
      alt: 'Vista cenital de la recepción con el cono de cobertura de la cámara sobre el acceso y el mostrador.'
    },
    'AM-1067': {
      src: 'assets/svg/camera-fov-dc.svg', floor: 'dc-pb',
      caption: 'Zona fría A · pasillo de racks',
      heading: 'Hacia el pasillo A-04', range: '11 m', angle: 96, bearing: 92,
      alt: 'Vista cenital de la zona fría A con el cono de cobertura de la cámara sobre el pasillo de racks.'
    }
  };

  const mapLabels = [
    { name: 'Asunción', lat: -25.2637, lng: -57.5759, kind: 'city' },
    { name: 'Concepción', lat: -23.4090, lng: -57.4340, kind: 'city' },
    { name: 'Encarnación', lat: -27.3360, lng: -55.8660, kind: 'city' },
    { name: 'Ciudad del Este', lat: -25.5097, lng: -54.6111, kind: 'city' },
    { name: 'Central', lat: -25.4700, lng: -57.3800, kind: 'region' },
    { name: 'Concepción', lat: -23.1500, lng: -57.1000, kind: 'region' },
    { name: 'Itapúa', lat: -27.0500, lng: -55.7000, kind: 'region' },
    { name: 'Alto Paraná', lat: -25.4000, lng: -54.9000, kind: 'region' },
    { name: 'Boquerón', lat: -21.5000, lng: -60.5000, kind: 'region' },
    { name: 'Presidente Hayes', lat: -23.6000, lng: -58.8000, kind: 'region' }
  ];

  const prefs = {
    base: 'esquema',
    labels: true,
    clusters: true,
    animations: true,
    showRetired: false,
    showPlans: true,
    planOpacity: 1,
    zoom: 6.2,
    center: { lat: -25.1500, lng: -57.2500 }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeMaps(stored, assets, siteList) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const validSites = (siteList || []).map(function (site) { return site.id; });
    const validAssets = {};
    (assets || []).forEach(function (asset) { validAssets[asset.id] = asset; });
    const validFloors = {};
    floors.forEach(function (floor) { validFloors[floor.id] = floor; });

    const geo = {};
    Object.keys(sites).forEach(function (id) {
      const base = sites[id];
      const candidate = source.geo && source.geo[id] ? source.geo[id] : null;
      const lat = candidate && Number.isFinite(Number(candidate.lat)) ? Number(candidate.lat) : base.lat;
      const lng = candidate && Number.isFinite(Number(candidate.lng)) ? Number(candidate.lng) : base.lng;
      geo[id] = {
        lat: Math.max(-90, Math.min(90, lat)),
        lng: Math.max(-180, Math.min(180, lng)),
        address: typeof candidate?.address === 'string' && candidate.address ? candidate.address : base.address
      };
    });
    validSites.forEach(function (id) {
      if (!geo[id]) geo[id] = { lat: -25.28, lng: -57.63, address: '' };
    });

    const storedPlans = Array.isArray(source.plans) ? source.plans : [];
    const mergedPlans = clone(plans).map(function (plan) {
      const match = storedPlans.find(function (item) { return item && item.id === plan.id; });
      if (!match) return plan;
      return Object.assign({}, plan, {
        visible: match.visible !== false,
        opacity: clampNumber(match.opacity, 0.2, 1, plan.opacity),
        name: typeof match.name === 'string' && match.name ? match.name : plan.name
      });
    });
    const allPlans = mergedPlans;
    storedPlans.forEach(function (plan) {
      if (!plan || typeof plan.id !== 'string') return;
      if (allPlans.some(function (item) { return item.id === plan.id; })) return;
      if (!validFloors[plan.floor] || typeof plan.src !== 'string' || !plan.src) return;
      allPlans.push({
        id: plan.id,
        site: validFloors[plan.floor].site,
        building: validFloors[plan.floor].building,
        floor: plan.floor,
        name: typeof plan.name === 'string' && plan.name ? plan.name : 'Plano',
        kind: typeof plan.kind === 'string' && plan.kind ? plan.kind : 'custom',
        src: plan.src,
        width: PLAN_WIDTH,
        height: PLAN_HEIGHT,
        format: 'svg',
        visible: plan.visible !== false,
        opacity: clampNumber(plan.opacity, 0.2, 1, 1),
        updated: typeof plan.updated === 'string' ? plan.updated : ''
      });
    });

    // Without a stored map the seeded placements are the starting point, so the
    // first run shows the same picture the documentation describes.
    const storedPositions = source.positions && typeof source.positions === 'object' ? source.positions : null;
    const positionSource = storedPositions && Object.keys(storedPositions).length ? storedPositions : positions;
    const nextPositions = {};
    Object.keys(positionSource).forEach(function (assetId) {
      if (!validAssets[assetId]) return;
      const entry = positionSource[assetId];
      if (!entry || !validFloors[entry.floor]) return;
      const x = Number(entry.x);
      const y = Number(entry.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      nextPositions[assetId] = {
        floor: entry.floor,
        x: Math.round(Math.max(0, Math.min(PLAN_WIDTH, x))),
        y: Math.round(Math.max(0, Math.min(PLAN_HEIGHT, y)))
      };
    });

    const storedPrefs = source.prefs && typeof source.prefs === 'object' ? source.prefs : {};
    const center = storedPrefs.center && Number.isFinite(Number(storedPrefs.center.lat))
      ? { lat: Number(storedPrefs.center.lat), lng: Number(storedPrefs.center.lng) }
      : clone(prefs.center);

    return {
      geo,
      buildings: clone(buildings),
      floors: clone(floors),
      rooms: clone(rooms),
      plans: allPlans,
      positions: nextPositions,
      cameraViews: clone(cameraViews),
      labels: clone(mapLabels),
      prefs: {
        base: storedPrefs.base === 'detalle' ? 'detalle' : 'esquema',
        labels: storedPrefs.labels !== false,
        clusters: storedPrefs.clusters !== false,
        animations: storedPrefs.animations !== false,
        showRetired: storedPrefs.showRetired === true,
        showPlans: storedPrefs.showPlans !== false,
        planOpacity: clampNumber(storedPrefs.planOpacity, 0.2, 1, 1),
        zoom: clampNumber(storedPrefs.zoom, 4, 14, prefs.zoom),
        center
      }
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  window.AssetMapData = {
    PLAN_WIDTH,
    PLAN_HEIGHT,
    sites,
    buildings,
    floors,
    rooms,
    plans,
    positions,
    cameraViews,
    mapLabels,
    prefs,
    normalizeMaps,
    clone
  };
})();
