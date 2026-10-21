(function () {
  'use strict';

  // A relation type is a reusable edge definition. `label` reads from the source
  // asset, `inverse` reads from the target; `directed: false` renders a plain
  // undirected edge and never stores a direction preference.
  const DEFAULT_TYPES = [
    {
      id: 'conectado-a',
      label: 'Conectado a',
      inverse: 'Conectado desde',
      directed: true,
      icon: 'network',
      tone: 'network',
      description: 'Enlace de red o cable: del equipo al switch, del periférico al puesto.'
    },
    {
      id: 'alojado-en',
      label: 'Alojado en',
      inverse: 'Aloja',
      directed: true,
      icon: 'layers',
      tone: 'virtual',
      description: 'Máquinas virtuales y contenedores que se ejecutan sobre un host físico.'
    },
    {
      id: 'instalado-en',
      label: 'Instalado en',
      inverse: 'Alberga',
      directed: true,
      icon: 'building',
      tone: 'physical',
      description: 'Equipo montado en un espacio físico: rack, sala o armario.'
    },
    {
      id: 'protegido-por',
      label: 'Protegido por',
      inverse: 'Protege',
      directed: true,
      icon: 'battery',
      tone: 'power',
      description: 'Alimentación respaldada por una UPS o un PDU.'
    },
    {
      id: 'depende-de',
      label: 'Depende de',
      inverse: 'Sirve a',
      directed: true,
      icon: 'activity',
      tone: 'dependency',
      description: 'Dependencia operativa: un servicio que necesita otro para funcionar.'
    },
    {
      id: 'enlazado-con',
      label: 'Enlazado con',
      inverse: 'Enlazado con',
      directed: false,
      icon: 'refresh',
      tone: 'link',
      description: 'Vínculo simétrico: troncales entre switches, pares de alta disponibilidad.'
    }
  ];

  // Two families share a hue; the icon and label keep them distinguishable. Each
  // family maps to a token declared in assets/css/graph.css.
  const FAMILIES = [
    {
      id: 'compute',
      label: 'Puestos y periféricos',
      categories: ['computadoras', 'notebooks', 'monitores', 'impresoras', 'otros']
    },
    {
      id: 'server',
      label: 'Servidores y almacenamiento',
      categories: ['servidores']
    },
    {
      id: 'network',
      label: 'Red y vigilancia',
      categories: ['switches', 'camaras']
    },
    {
      id: 'virtual',
      label: 'Virtualización',
      categories: ['virtualizacion', 'contenedores']
    },
    {
      id: 'power',
      label: 'Energía',
      categories: ['ups']
    }
  ];

  const CATEGORY_FAMILY = FAMILIES.reduce(function (result, family) {
    family.categories.forEach(function (category) {
      result[category] = family.id;
    });
    return result;
  }, {});

  const CATEGORY_LABELS = {
    computadoras: 'Computadoras',
    notebooks: 'Notebooks',
    servidores: 'Servidores',
    impresoras: 'Impresoras',
    switches: 'Switches',
    monitores: 'Monitores',
    camaras: 'Cámaras',
    ups: 'UPS',
    virtualizacion: 'Virtualización',
    contenedores: 'Contenedores',
    otros: 'Otros'
  };

  const TONE_LABELS = {
    network: 'Red',
    virtual: 'Virtual',
    physical: 'Físico',
    power: 'Energía',
    dependency: 'Dependencia',
    link: 'Enlace'
  };

  const DEFAULT_PREFS = {
    mode: 'global',
    depth: 2,
    group: 'category',
    showLabels: true,
    showIsolated: true,
    animate: true,
    search: ''
  };

  function link(from, to, type, note) {
    return {
      id: 'rel-' + from.toLowerCase() + '-' + to.toLowerCase() + '-' + type,
      from: from,
      to: to,
      type: type,
      note: note || '',
      createdAt: '2025-11-04T10:20:00.000Z'
    };
  }

  // Deterministic demo topology. Every link is coherent with the site and the
  // technical fields of the seeded assets: no invented hostnames or VLANs.
  const DEFAULT_LINKS = [
    link('AM-1059', 'AM-1046', 'alojado-en', 'VM 311 del hipervisor ProLiant.'),
    link('AM-1060', 'AM-1062', 'alojado-en', 'Contenedor desplegado en docker-01.'),
    link('AM-1060', 'AM-1059', 'depende-de', 'La API usa la base de datos de facturación.'),
    link('AM-1059', 'AM-1047', 'depende-de', 'Copia nocturna en el servidor de respaldo.'),
    link('AM-1046', 'AM-1058', 'protegido-por', 'Alimentación del rack A.'),
    link('AM-1047', 'AM-1058', 'protegido-por', ''),
    link('AM-1062', 'AM-1058', 'protegido-por', ''),
    link('AM-1063', 'AM-1058', 'protegido-por', ''),
    link('AM-1063', 'AM-1047', 'depende-de', 'Replica los respaldos del NAS.'),
    link('AM-1046', 'AM-1050', 'conectado-a', 'Uplink 10 GbE al switch de núcleo.'),
    link('AM-1047', 'AM-1050', 'conectado-a', ''),
    link('AM-1062', 'AM-1050', 'conectado-a', ''),
    link('AM-1063', 'AM-1050', 'conectado-a', ''),
    link('AM-1050', 'AM-1051', 'enlazado-con', 'Troncal hacia la Planta Sur.'),
    link('AM-1050', 'AM-1064', 'enlazado-con', 'Troncal hacia la Sede Norte.'),
    link('AM-1050', 'AM-1066', 'enlazado-con', 'Troncal hacia la Sede Central.'),
    link('AM-1051', 'AM-1045', 'conectado-a', 'Puerto 12 · VLAN producción.'),
    link('AM-1051', 'AM-1056', 'conectado-a', 'PoE, puerto 24.'),
    link('AM-1064', 'AM-1057', 'conectado-a', 'PoE, puerto 8.'),
    link('AM-1064', 'AM-1049', 'conectado-a', ''),
    link('AM-1064', 'AM-1065', 'conectado-a', ''),
    link('AM-1053', 'AM-1065', 'conectado-a', 'HDMI y alimentación del puesto.'),
    link('AM-1066', 'AM-1044', 'conectado-a', ''),
    link('AM-1066', 'AM-1048', 'conectado-a', ''),
    link('AM-1066', 'AM-1054', 'conectado-a', ''),
    link('AM-1055', 'AM-1052', 'conectado-a', 'DisplayPort del dock.'),
    link('AM-1042', 'AM-1055', 'conectado-a', 'USB-C del puesto 3B.'),
    link('AM-1043', 'AM-1064', 'conectado-a', 'Wi-Fi corporativa de la Sede Norte.')
  ];

  function familyOf(categoryId) {
    return CATEGORY_FAMILY[categoryId] || 'compute';
  }

  function familyLabel(familyId) {
    const family = FAMILIES.find(function (item) { return item.id === familyId; });
    return family ? family.label : 'Puestos y periféricos';
  }

  function categoryLabel(categoryId) {
    return CATEGORY_LABELS[categoryId] || 'Otros';
  }

  window.AssetRelationsData = {
    DEFAULT_TYPES: DEFAULT_TYPES,
    DEFAULT_LINKS: DEFAULT_LINKS,
    DEFAULT_PREFS: DEFAULT_PREFS,
    FAMILIES: FAMILIES,
    CATEGORY_FAMILY: CATEGORY_FAMILY,
    CATEGORY_LABELS: CATEGORY_LABELS,
    TONE_LABELS: TONE_LABELS,
    familyOf: familyOf,
    familyLabel: familyLabel,
    categoryLabel: categoryLabel
  };
})();
