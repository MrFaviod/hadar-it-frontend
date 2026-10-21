(function () {
  'use strict';

  const MOVEMENTS = [
    {
      id: 'transfer',
      label: 'Trasladar',
      action: 'Trasladar activo',
      title: 'Traslado de activo',
      icon: 'map-pin',
      hint: 'Cambia la sede o la ubicación. El código rápido se recalcula y conserva el anterior.'
    },
    {
      id: 'assigned',
      label: 'Asignar responsable',
      action: 'Asignar responsable',
      title: 'Responsable actualizado',
      icon: 'user',
      hint: 'Vincula el activo a una persona activa del directorio sin abrir la ficha completa.'
    },
    {
      id: 'returned',
      label: 'Registrar devolución',
      action: 'Registrar devolución',
      title: 'Devolución registrada',
      icon: 'restore',
      hint: 'Devuelve el equipo al inventario operativo sin responsable y con su estado destino.'
    },
    {
      id: 'status',
      label: 'Cambiar estado',
      action: 'Cambiar estado',
      title: 'Estado actualizado',
      icon: 'activity',
      hint: 'Mueve el activo entre estados operativos sin tocar el resto de la ficha.'
    },
    {
      id: 'retired',
      label: 'Registrar baja',
      action: 'Registrar baja',
      title: 'Activo dado de baja',
      icon: 'minus',
      hint: 'Saca el equipo del inventario operativo y conserva ficha, adjuntos e historial.'
    }
  ];

  const KIND_META = {
    created: { label: 'Alta', icon: 'plus', tone: 'ok' },
    updated: { label: 'Ficha', icon: 'pencil', tone: 'neutral' },
    assigned: { label: 'Asignación', icon: 'user', tone: 'ok' },
    status: { label: 'Estado', icon: 'activity', tone: 'warn' },
    code: { label: 'Código', icon: 'layers', tone: 'warn' },
    retired: { label: 'Baja', icon: 'minus', tone: 'down' },
    restored: { label: 'Restauración', icon: 'restore', tone: 'ok' },
    transfer: { label: 'Traslado', icon: 'map-pin', tone: 'ok' },
    returned: { label: 'Devolución', icon: 'restore', tone: 'neutral' },
    bulk: { label: 'Edición masiva', icon: 'layers', tone: 'neutral' },
    relation: { label: 'Relación', icon: 'network', tone: 'neutral' },
    maintenance: { label: 'Mantenimiento', icon: 'refresh', tone: 'ok' },
    incident: { label: 'Incidente', icon: 'alert', tone: 'warn' },
    monitoring: { label: 'Supervisión', icon: 'activity', tone: 'warn' }
  };

  const HISTORY_FILTERS = [
    { id: 'all', label: 'Todos', kinds: null },
    { id: 'movements', label: 'Movimientos', kinds: ['transfer', 'assigned', 'returned'] },
    { id: 'status', label: 'Estado', kinds: ['status', 'restored'] },
    { id: 'fields', label: 'Ficha', kinds: ['created', 'updated', 'bulk'] },
    { id: 'code', label: 'Código', kinds: ['code'] },
    { id: 'relations', label: 'Relaciones', kinds: ['relation'] },
    { id: 'maintenance', label: 'Mantenimiento', kinds: ['maintenance'] },
    { id: 'incidents', label: 'Incidentes', kinds: ['incident'] },
    { id: 'monitoring', label: 'Supervisión', kinds: ['monitoring'] },
    { id: 'retired', label: 'Bajas', kinds: ['retired'] }
  ];

  const TRANSFER_REASONS = [
    'Reubicación de puesto',
    'Nuevo puesto de trabajo',
    'Cambio de sede',
    'Reorganización del área',
    'Otro motivo'
  ];

  const ASSIGN_REASONS = [
    'Nuevo puesto',
    'Reasignación de equipo',
    'Cobertura temporal',
    'Otro motivo'
  ];

  const RETURN_REASONS = [
    'Cambio de equipo',
    'Fin de asignación',
    'Licencia del responsable',
    'Baja del puesto',
    'Otro motivo'
  ];

  const STATUS_REASONS = [
    'Revisión preventiva',
    'Falla reportada',
    'Equipo en resguardo',
    'Reparación finalizada',
    'Otro motivo'
  ];

  const RETIRE_REASONS = [
    'Fin de vida útil',
    'Avería irreparable',
    'Robo o extravío',
    'Sustitución por renovación',
    'Otro motivo'
  ];

  function dayFrom(base, days) {
    return base + days * 86400000;
  }

  function actorAt(people, index) {
    const list = Array.isArray(people) ? people : [];
    if (!list.length) return 'Administrador';
    const person = list[index % list.length];
    return person && person.name ? person.name : 'Administrador';
  }

  // Deterministic demo timeline built from the asset's own values: no invented
  // asset names, IPC or costs, only events that match the current record.
  function seedDemoHistory(asset, index, context) {
    if (!asset || !asset.id) return [];
    const people = context && context.people ? context.people : [];
    const sites = context && context.sites ? context.sites : [];
    const created = Date.parse(asset.createdAt) || Date.now();
    const now = Date.now();
    const actor = actorAt(people, index);
    const entries = [];
    let offset = 0;

    const push = function (kind, title, detail, changes, days) {
      offset += 1;
      const at = new Date(Math.min(dayFrom(created, days), now - 3600000)).toISOString();
      entries.push({
        id: 'demo-' + asset.id + '-' + offset,
        at: at,
        kind: kind,
        title: title,
        detail: detail || '',
        actor: actor,
        changes: changes || [],
        effectiveAt: at,
        recordedAt: at,
        movement: kind
      });
    };

    if (asset.assigneeId && asset.assignee) {
      push(
        'assigned',
        'Responsable asignado',
        'El equipo queda a cargo de ' + asset.assignee + '.',
        [{ field: 'assigneeId', label: 'Responsable', before: 'Sin asignar', after: asset.assignee }],
        3
      );
    }

    if (asset.locationId) {
      const site = sites.find(function (item) { return item.id === asset.site; });
      const locations = site && Array.isArray(site.locations) ? site.locations : [];
      const other = locations.find(function (item) { return item.id !== asset.locationId; });
      if (other) {
        push(
          'transfer',
          'Ubicación actualizada',
          'Reubicación dentro de ' + site.label + ' por reorganización del área.',
          [
            { field: 'locationId', label: 'Ubicación', before: other.label, after: asset.location || asset.locationId },
            { field: 'site', label: 'Sede', before: site.label, after: site.label }
          ],
          9
        );
      }
    }

    if (asset.statusId === 'mantenimiento') {
      push(
        'status',
        'Envío a mantenimiento',
        'Revisión preventiva programada por soporte técnico.',
        [{ field: 'statusId', label: 'Estado', before: 'Asignado', after: 'Mantenimiento' }],
        14
      );
    } else if (asset.statusId === 'resguardo' && !asset.retired) {
      push(
        'status',
        'Equipo en resguardo',
        'Sin responsable activo: el equipo queda disponible en depósito.',
        [
          { field: 'statusId', label: 'Estado', before: 'Asignado', after: 'En resguardo' },
          { field: 'assigneeId', label: 'Responsable', before: asset.assignee || 'Sin asignar', after: 'Sin asignar' }
        ],
        7
      );
    }

    return entries.filter(function (entry) {
      return Date.parse(entry.at) <= Date.parse(entry.recordedAt) && Date.parse(entry.at) >= created;
    });
  }

  function enrich(assets, context) {
    if (!Array.isArray(assets)) return assets;
    assets.forEach(function (asset, index) {
      if (!asset || !Array.isArray(asset.history)) return;
      if (asset.history.length > 1) return;
      const demo = seedDemoHistory(asset, index, context);
      if (!demo.length) return;
      const merged = asset.history.concat(demo).sort(function (a, b) {
        return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
      });
      asset.history = merged;
    });
    return assets;
  }

  window.AssetOpsData = {
    MOVEMENTS,
    KIND_META,
    HISTORY_FILTERS,
    TRANSFER_REASONS,
    ASSIGN_REASONS,
    RETURN_REASONS,
    STATUS_REASONS,
    RETIRE_REASONS,
    seedDemoHistory,
    enrich
  };
})();
