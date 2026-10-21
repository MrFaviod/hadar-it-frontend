(function () {
  'use strict';
  const CATALOGUE = [
    { id: 'availability', label: 'Disponibilidad y uptime', description: 'Tendencia, caídas y recuperaciones', wide: true },
    { id: 'alerts', label: 'Alertas y problemas críticos', description: 'Severidad y atención pendiente' },
    { id: 'distribution', label: 'Dispositivos por estado', description: 'Supervisión y equipos sin datos' },
    { id: 'infrastructure', label: 'Infraestructura', description: 'Estado por categoría o sede' },
    { id: 'activity', label: 'Actividad y logs', description: 'Eventos operativos y del inventario', wide: true },
    { id: 'maintenance', label: 'Mantenimiento pendiente', description: 'Próximas revisiones y vencimientos' },
    { id: 'warranties', label: 'Garantías por vencer', description: 'Cobertura de los próximos 90 días' },
    { id: 'inventory', label: 'Resumen del inventario', description: 'Activos, asignaciones y contexto' },
    { id: 'latency', label: 'Tendencia de latencia', description: 'Métricas adicionales con datos', wide: true }
  ];
  const DEFAULTS = CATALOGUE.slice(0, 8).map(w => w.id);
  const ICONS = ['remote', 'server', 'network', 'camera', 'building', 'shield', 'activity', 'box'];
  const known = id => CATALOGUE.some(w => w.id === id);
  const key = id => String(id || 'demo');
  function createState() { return { layouts: {}, temporary: {}, links: [], nextLink: 1 }; }
  function layoutFor(state, userId) { const own = Object.hasOwn(state.layouts, key(userId)); return (own ? state.layouts[key(userId)] : DEFAULTS).slice(); }
  function visibleWidgets(state, userId) { return [...new Set(layoutFor(state, userId).concat(state.temporary[key(userId)] || []))].filter(known); }
  function moveWidget(state, userId, id, delta) {
    const layout = layoutFor(state, userId), index = layout.indexOf(id), to = index + Math.sign(delta);
    if (index < 0 || to < 0 || to >= layout.length) return false;
    layout.splice(index, 1); layout.splice(to, 0, id); state.layouts[key(userId)] = layout; return true;
  }
  function setWidgetVisible(state, userId, id, visible) {
    if (!known(id)) return false;
    let list = layoutFor(state, userId);
    if (visible && !list.includes(id)) list.push(id);
    if (!visible) list = list.filter(w => w !== id);
    state.layouts[key(userId)] = list;
    state.temporary[key(userId)] = (state.temporary[key(userId)] || []).filter(w => w !== id);
    return true;
  }
  function addTemporary(state, userId, id) {
    if (!known(id) || visibleWidgets(state, userId).includes(id)) return false;
    state.temporary[key(userId)] = (state.temporary[key(userId)] || []).concat(id); return true;
  }
  function clearTemporary(state, userId) { state.temporary[key(userId)] = []; }
  function resetLayout(state, userId) { state.layouts[key(userId)] = DEFAULTS.slice(); clearTemporary(state, userId); }
  function linksFor(state, userId) { return state.links.filter(l => l.scope === 'shared' || l.ownerId === key(userId)); }
  function editable(link, userId, shared) { return link.scope === 'shared' ? shared : link.ownerId === key(userId); }
  function saveLink(state, userId, shared, draft) {
    const existing = draft.id ? state.links.find(l => l.id === draft.id) : null;
    const fail = error => ({ ok: false, error });
    if (draft.id && !existing) return fail('El acceso ya no está disponible.');
    if (existing && !editable(existing, userId, shared)) return fail('No puedes modificar este acceso.');
    const name = String(draft.name || '').trim();
    if (!name || name.length > 70) return fail('Escribe un nombre de entre 1 y 70 caracteres.');
    let url;
    try { url = new URL(String(draft.url || '').trim()); } catch (_) { return fail('Escribe una dirección completa, por ejemplo https://servidor.local.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return fail('Utiliza una URL http o https sin credenciales.');
    const scope = draft.scope === 'shared' ? 'shared' : 'personal';
    if (scope === 'shared' && !shared) return fail('Los accesos compartidos se administran desde Configuración.');
    const link = { id: existing ? existing.id : 'link-' + state.nextLink, name, url: url.href, icon: ICONS.includes(draft.icon) ? draft.icon : 'remote', category: String(draft.category || '').trim().slice(0, 60), scope, ownerId: existing ? existing.ownerId : key(userId) };
    if (existing) state.links.splice(state.links.indexOf(existing), 1, link);
    else { state.links.push(link); state.nextLink += 1; }
    return { ok: true, link };
  }
  function removeLink(state, userId, shared, id) {
    const item = state.links.find(l => l.id === id);
    if (!item || !editable(item, userId, shared)) return { ok: false, error: 'No puedes eliminar este acceso.' };
    state.links.splice(state.links.indexOf(item), 1); return { ok: true };
  }
  const DashboardLinks = {
    components: { AppIcon: window.AppIcon }, props: ['app'],
    data() { return { formOpen: false, draft: {}, error: '', deleting: '' }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || 'demo'; },
      shared() { return !!this.app.can('config.general'); },
      links() { return linksFor(this.app.dashboard, this.userId); },
      icons() { return ICONS; }
    },
    methods: {
      canEdit(l) { return editable(l, this.userId, this.shared); },
      edit(link) { this.draft = link ? { ...link } : { name: '', url: '', icon: 'remote', category: '', scope: 'personal' }; this.error = ''; this.formOpen = true; },
      save() { const result = saveLink(this.app.dashboard, this.userId, this.shared, this.draft); this.error = result.error || ''; if (result.ok) { this.formOpen = false; this.app.showToast('Acceso guardado.'); } },
      remove(id) { const r = removeLink(this.app.dashboard, this.userId, this.shared, id); if (r.ok) this.deleting = ''; else this.error = r.error; }
    },
    template: `<section class="noc-links" data-od-id="dashboard-custom-links"><header class="noc-section-head"><div><h2>Herramientas y servicios</h2><p>Accesos personales y compartidos · siempre en una pestaña nueva</p></div><button type="button" class="btn btn--secondary" @click="edit()" data-od-id="dashboard-add-link"><app-icon name="plus"></app-icon>Añadir acceso</button></header>
      <div v-if="links.length" class="noc-link-grid"><article v-for="link in links" :key="link.id" :data-od-id="'dashboard-link-'+link.id"><a :href="link.url" target="_blank" rel="noopener noreferrer"><app-icon :name="link.icon"></app-icon><span><b>{{ link.name }}</b><small>{{ link.category || 'Sin categoría' }} · {{ link.scope==='shared' ? 'Compartido' : 'Personal' }}</small><small>{{ link.url }}</small></span><app-icon name="arrow-up-right"></app-icon></a><div v-if="canEdit(link)" class="noc-link-actions"><button type="button" @click="edit(link)" :aria-label="'Editar '+link.name">Editar</button><button type="button" @click="deleting=link.id" :aria-label="'Eliminar '+link.name">Eliminar</button></div><div v-if="deleting===link.id" class="noc-link-confirm"><span>¿Eliminar este acceso?</span><button type="button" @click="remove(link.id)">Confirmar</button><button type="button" @click="deleting=''">Cancelar</button></div></article></div>
      <p v-else class="noc-empty">Sin accesos configurados.</p>
      <form v-if="formOpen" class="noc-link-form" @submit.prevent="save" data-od-id="dashboard-link-form"><h3>{{ draft.id ? 'Editar acceso' : 'Nuevo acceso' }}</h3><div class="noc-form-grid"><label>Nombre<input v-model="draft.name" required maxlength="70" placeholder="Consola de administración"></label><label>Dirección<input v-model="draft.url" required type="url" placeholder="https://servidor.local" autocomplete="url"></label><label>Icono<select v-model="draft.icon"><option v-for="icon in icons" :key="icon" :value="icon">{{ {remote:'Acceso remoto',server:'Servidor',network:'Red',camera:'Cámara',building:'Sede',shield:'Protección',database:'Almacenamiento',activity:'Actividad',box:'Aplicación'}[icon] }}</option></select></label><label>Categoría opcional<input v-model="draft.category" maxlength="60" placeholder="Infraestructura"></label><label>Visibilidad<select v-model="draft.scope"><option value="personal">Personal · solo para mí</option><option v-if="shared" value="shared">Compartido · todos los usuarios</option></select></label></div><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="noc-form-actions"><button type="button" class="btn btn--ghost" @click="formOpen=false">Cancelar</button><button type="submit" class="btn btn--secondary">Guardar acceso</button></div></form></section>`
  };
  const DashboardPreferences = {
    components: { AppIcon: window.AppIcon, DashboardLinks }, props: ['app'],
    computed: {
      userId() { return (this.app.currentUser || {}).id || 'demo'; },
      layout() { return layoutFor(this.app.dashboard, this.userId); },
      widgets() { return this.layout.map(id => CATALOGUE.find(w => w.id === id)); },
      hidden() { return CATALOGUE.filter(w => !this.layout.includes(w.id)); },
      temporary() { return this.app.dashboard.temporary[key(this.userId)] || []; }
    },
    methods: {
      move(id, delta) { moveWidget(this.app.dashboard, this.userId, id, delta); },
      visible(id, value) { setWidgetVisible(this.app.dashboard, this.userId, id, value); },
      add(id) { addTemporary(this.app.dashboard, this.userId, id); },
      clear() { clearTemporary(this.app.dashboard, this.userId); },
      reset() { resetLayout(this.app.dashboard, this.userId); this.app.showToast('Distribución predeterminada restaurada.'); }
    },
    template: `<section class="config-section noc-preferences" data-od-id="dashboard-preferences"><header class="config-section__head"><div><p class="eyebrow">Inicio y operaciones</p><h2>Dashboard</h2><p>Widgets y accesos personales. Los umbrales se configuran en Supervisión.</p></div><a class="btn btn--secondary" href="#/panel">Volver al Dashboard</a></header><div class="noc-preference-intro"><h3>Distribución habitual</h3><p>El orden se aplica de izquierda a derecha. Estos ajustes son personales y se mantienen durante esta sesión del prototipo.</p></div>
      <ol class="noc-layout-list"><li v-for="(widget,index) in widgets" :key="widget.id" :data-od-id="'dashboard-preference-'+widget.id"><span class="mono">{{ String(index+1).padStart(2,'0') }}</span><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><div class="noc-layout-actions"><button type="button" @click="move(widget.id,-1)" :disabled="index===0" :aria-label="'Subir '+widget.label"><app-icon name="chevron-up"></app-icon></button><button type="button" @click="move(widget.id,1)" :disabled="index===widgets.length-1" :aria-label="'Bajar '+widget.label"><app-icon name="chevron-down"></app-icon></button><button type="button" @click="visible(widget.id,false)" :aria-label="'Ocultar '+widget.label">Ocultar</button></div></li></ol>
      <p v-if="!widgets.length" class="noc-empty">No hay widgets en tu distribución. Añade uno o restaura la distribución inicial.</p><div class="noc-hidden-widgets"><article v-for="widget in hidden" :key="widget.id"><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><button type="button" class="btn btn--secondary" @click="visible(widget.id,true)">Añadir</button><button type="button" class="btn btn--ghost" @click="add(widget.id)" :disabled="temporary.includes(widget.id)">{{ temporary.includes(widget.id) ? 'Temporal añadido' : 'Solo temporalmente' }}</button></article></div>
      <div class="noc-form-actions"><button type="button" class="btn btn--secondary" @click="reset" data-od-id="dashboard-reset-layout">Restaurar distribución inicial</button><button v-if="temporary.length" type="button" class="btn btn--ghost" @click="clear">Quitar widgets temporales ({{ temporary.length }})</button></div><dashboard-links :app="app"></dashboard-links></section>`
  };
  window.AssetDashboardPrefs = { CATALOGUE, DEFAULTS, createState, layoutFor, visibleWidgets, moveWidget, setWidgetVisible, addTemporary, clearTemporary, resetLayout, linksFor, saveLink, removeLink, DashboardPreferences, DashboardLinks };
})();
