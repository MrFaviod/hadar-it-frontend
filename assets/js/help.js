(function () {
  'use strict';
  // Task guides are static documentation, never a second domain data source.
  const topics = [
    { id: 'inventory', title: 'Inventario', href: '#/inventario', permission: 'assets.view', steps: [
      'Registra cada equipo o servicio como un activo. Su identificador permanente no cambia; el código rápido facilita encontrarlo.',
      'Abre la ficha para consultar los datos, adjuntos e historial. Usa los filtros para acotar resultados; restablécelos para volver a la lista.',
      'Archivar conserva el registro. La eliminación definitiva depende de la política del servidor y requiere confirmación.'
    ] },
    { id: 'operations', title: 'Operaciones habituales', href: '#/inventario', permission: 'assets.view', steps: [
      'Prepara sedes, ubicaciones y personas antes de asignar equipos. Una persona del inventario no es una cuenta de acceso.',
      'Desde la ficha, asigna un responsable, registra una devolución o traslada el activo. Comprueba el destino antes de guardar.',
      'Relaciona máquinas virtuales con sus hosts y equipos con su infraestructura. Una relación describe la dependencia; no ejecuta acciones remotas.'
    ] },
    { id: 'incidents', title: 'Incidentes y mantenimiento', href: '#/mantenimiento', permission: 'assets.view', steps: [
      'Registra un incidente con el activo afectado y una descripción concreta. Actualiza su estado mientras lo investigas.',
      'Un plan de mantenimiento organiza trabajo previsto; una intervención registra el trabajo realizado y su resultado.',
      'Consulta la ficha del activo para mantener el contexto. Resolver una incidencia no implica que la telemetría se haya recuperado.'
    ] },
    { id: 'monitoring', title: 'Panel y supervisión', href: '#/panel', permission: 'assets.view', steps: [
      'El Panel resume la operación. Personaliza los widgets para priorizar lo que necesitas y revisa el período seleccionado.',
      'La supervisión consulta las integraciones del servidor. Sin muestras significa que no hay mediciones, no que el equipo esté disponible o caído.',
      'Una alerta, un incidente y una tarea de mantenimiento son registros distintos: revisa el origen y el activo antes de actuar.'
    ] },
    { id: 'warranties', title: 'Garantías y documentos', href: '#/garantias', permission: 'assets.view', steps: [
      'Registra la cobertura individual desde el activo y adjunta su comprobante. Comprueba las fechas y el proveedor.',
      'Consulta las próximas caducidades en el centro de garantías. Los filtros y el intervalo de aviso determinan qué registros ves.',
      'Desvincular un comprobante no elimina el archivo adjunto del activo.'
    ] },
    { id: 'reports', title: 'Reportes, etiquetas e intercambio', href: '#/reportes', permission: 'assets.view', steps: [
      'Prepara el reporte con los activos y campos que necesitas. Revisa la vista previa antes de imprimir o compartir.',
      'Las etiquetas permiten localizar la ficha del activo; no sustituyen los controles de acceso.',
      'En Datos puedes importar y exportar. Revisa los conflictos de una importación antes de aprobarla: cambiar la resolución invalida la aprobación anterior.'
    ] },
    { id: 'settings', title: 'Configuración e identidad', href: '#/configuracion/general', permission: 'config.general', steps: [
      'Las opciones disponibles dependen de tus permisos. Si falta una acción, consulta a quien administra la instalación.',
      'El nombre visible se edita en Configuración → Apariencia, en el campo «Nombre visible de la aplicación». La apariencia controla la presentación; no cambia los datos.',
      'El producto aún no tiene nombre definitivo. No necesitas sustituir la identidad actual para comenzar a utilizarlo.'
    ] },
    { id: 'agents', title: 'Agentes', href: '#/conversacion', permission: 'assets.view', steps: [
      'Explica qué necesitas y selecciona un activo cuando la consulta dependa de su ficha. Comprueba las respuestas antes de tomar decisiones.',
      'El agente utiliza herramientas autorizadas del servidor. No recibe permisos adicionales por conversar contigo.',
      'La disponibilidad depende de la configuración del proveedor y de las cuotas. No compartas contraseñas ni claves en el chat; las aprobaciones humanas siguen siendo humanas.'
    ] },
    { id: 'extensions', title: 'Extensiones', href: '#/configuracion/extensiones', permission: 'system.modules', steps: [
      'Una extensión incorpora funciones adicionales. Revisa su procedencia, permisos y versión antes de autorizar su instalación.',
      'Las extensiones nativas son código de confianza: no están aisladas como una aplicación hostil. Su interfaz no reemplaza la autorización del servidor.',
      'Desactivar una extensión retira sus contribuciones de la interfaz. Conserva un respaldo y revisa la compatibilidad antes de actualizar o restaurar una versión.'
    ] }
  ];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  function search(query) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return topics.filter(topic => {
      const text = normalize([topic.title].concat(topic.steps).join(' '));
      return words.every(word => text.includes(word));
    });
  }
  const HelpPage = {
    props: ['app'],
    data() { return { query: '' }; },
    computed: { topics() { return search(this.query); } },
    template: `<section class="page help-page" aria-labelledby="help-title">
      <header class="page-head"><div><h1 id="help-title">Ayuda</h1><p>Guías breves para las operaciones habituales.</p></div></header>
      <div class="help-search"><label for="help-search">Buscar en la ayuda</label><input id="help-search" type="search" v-model="query" placeholder="Por ejemplo: responsable o garantía" autocomplete="off"></div>
      <p role="status" aria-live="polite">{{ topics.length }} temas</p>
      <p v-if="!topics.length">No hay temas que coincidan. Prueba otro término o borra la búsqueda.</p>
      <div class="help-topics"><article v-for="topic in topics" :key="topic.id" class="help-topic" :aria-labelledby="'help-'+topic.id">
        <h2 :id="'help-'+topic.id">{{ topic.title }}</h2><ol><li v-for="step in topic.steps" :key="step">{{ step }}</li></ol>
        <a v-if="app.can(topic.permission)" :href="topic.href">Abrir sección: {{ topic.title }}</a>
        <p v-else class="muted">El acceso a esta sección depende de los permisos de tu cuenta.</p>
      </article></div>
    </section>`
  };
  window.AssetHelp = { search, HelpPage };
}());
