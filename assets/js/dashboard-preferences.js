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
    { id: 'latency', label: 'Tendencia de latencia', description: 'Métricas adicionales con datos', wide: true },
    { id: 'incidents', label: 'Incidencias activas', description: 'Intervenciones abiertas y su equipo', wide: true }
  ];
  const DEFAULTS = CATALOGUE.slice(0, 8).map(w => w.id);
  const ICONS = ['remote', 'server', 'network', 'camera', 'building', 'shield', 'activity', 'box'];
  const known = id => CATALOGUE.some(w => w.id === id);
  const key = id => String(id || '');
  function createState() { return window.AssetPhase10Api ? window.AssetPhase10Api.createDashboardState() : { widgets: null, layouts: {}, temporary: {}, links: [], nextLink: 1, summary: null, meta: { loading: false, error: '', loaded: false, epoch: 0, generatedAt: '' } }; }
  function layoutFor(state, userId) {
    if (Array.isArray(state.widgets)) return state.widgets.filter(known);
    const own = Object.hasOwn(state.layouts, key(userId));
    return (own ? state.layouts[key(userId)] : DEFAULTS).slice().filter(known);
  }
  function saveLayout(state, userId, layout) {
    if (Array.isArray(state.widgets)) state.widgets = layout.filter(known);
    else state.layouts[key(userId)] = layout.filter(known);
  }
  // Extension composition is a read-only overlay: hidden/replaced core widget
  // ids are filtered from rendering only, so the saved personal layout (and the
  // closed server catalogue) never receives extension ids. Disabling the
  // extension drops the overlay and the core widget returns untouched.
  function extensionWidgetIds(state, field) {
    const overlay = state && state.extensionComposition;
    return overlay && Array.isArray(overlay[field]) ? overlay[field] : [];
  }
  function visibleWidgets(state, userId) {
    const hidden = extensionWidgetIds(state, 'hiddenWidgets').concat(extensionWidgetIds(state, 'replacedWidgets'));
    return [...new Set(layoutFor(state, userId).concat(state.temporary[key(userId)] || []))].filter(known).filter(id => !hidden.includes(id));
  }
  function moveWidget(state, userId, id, delta) {
    const layout = layoutFor(state, userId), index = layout.indexOf(id), to = index + Math.sign(delta);
    if (index < 0 || to < 0 || to >= layout.length) return false;
    layout.splice(index, 1); layout.splice(to, 0, id); saveLayout(state, userId, layout); return true;
  }
  function setWidgetVisible(state, userId, id, visible) {
    if (!known(id)) return false;
    let list = layoutFor(state, userId);
    if (visible && !list.includes(id)) list.push(id);
    if (!visible) list = list.filter(w => w !== id);
    saveLayout(state, userId, list);
    state.temporary[key(userId)] = (state.temporary[key(userId)] || []).filter(w => w !== id);
    return true;
  }
  function addTemporary(state, userId, id) {
    if (!known(id) || visibleWidgets(state, userId).includes(id)) return false;
    state.temporary[key(userId)] = (state.temporary[key(userId)] || []).concat(id); return true;
  }
  function clearTemporary(state, userId) { state.temporary[key(userId)] = []; }
  function resetLayout(state, userId) { saveLayout(state, userId, DEFAULTS.slice()); clearTemporary(state, userId); }
  function linksFor(state, userId) { return (state.links || []).filter(l => l.scope === 'shared' || l.ownerId === key(userId)); }
  function editable(link, userId, shared) { return link.scope === 'shared' ? shared : link.ownerId === key(userId); }
  function normalizeShortcut(draft, links, userId, shared) {
    const existing = draft.id ? links.find(l => l.id === draft.id) : null;
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
    const shortcut = { id: existing ? existing.id : '', name, url: url.href, icon: ICONS.includes(draft.icon) ? draft.icon : 'remote', category: String(draft.category || '').trim().slice(0, 60), scope, ownerId: existing ? existing.ownerId : key(userId) };
    return { ok: true, shortcut };
  }
  function deleteLinkOptions(link, userId, shared) {
    if (!link || !editable(link, userId, shared)) return { ok: false, error: 'No puedes eliminar este acceso.' };
    return { ok: true };
  }
  const DashboardLinks = {
    components: { AppIcon: window.AppIcon }, props: ['app'],
    data() { return { formOpen: false, draft: {}, error: '', deleting: '', saving: false, removing: false }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || ''; },
      shared() { return !!this.app.can('config.general'); },
      links() { return linksFor(this.app.dashboard, this.userId); },
      icons() { return ICONS; }
    },
    methods: {
      canEdit(l) { return editable(l, this.userId, this.shared); },
      edit(link) { this.draft = link ? { ...link } : { name: '', url: '', icon: 'remote', category: '', scope: 'personal' }; this.error = ''; this.formOpen = true; },
      async save() {
        const checked = normalizeShortcut(this.draft, this.links, this.userId, this.shared);
        this.error = checked.error || '';
        if (!checked.ok) return;
        this.saving = true;
        try {
          const result = this.app.saveWorkspaceShortcut ? await this.app.saveWorkspaceShortcut(this.draft) : await window.AssetPhase10Api.saveShortcut(this.app, this.draft);
          if (result.ok) { this.formOpen = false; this.app.showToast('Acceso guardado.'); }
          else this.error = result.error || 'No se pudo guardar el acceso.';
        } finally { this.saving = false; }
      },
      async remove(id) {
        const link = this.links.find(item => item.id === id), checked = deleteLinkOptions(link, this.userId, this.shared);
        if (!checked.ok) { this.error = checked.error; return; }
        this.removing = true;
        try {
          const result = this.app.deleteWorkspaceShortcut ? await this.app.deleteWorkspaceShortcut(id) : await window.AssetPhase10Api.deleteShortcut(this.app, id);
          if (result.ok) this.deleting = ''; else this.error = result.error || 'No se pudo eliminar el acceso.';
        } finally { this.removing = false; }
      }
    },
    template: `<section class="noc-links" data-od-id="dashboard-custom-links"><header class="noc-section-head"><div><h2>Herramientas y servicios</h2><p>Accesos personales y compartidos · siempre en una pestaña nueva</p></div><button type="button" class="btn btn--secondary" @click="edit()" data-od-id="dashboard-add-link"><app-icon name="plus"></app-icon>Añadir acceso</button></header>
      <div v-if="links.length" class="noc-link-grid"><article v-for="link in links" :key="link.id" :data-od-id="'dashboard-link-'+link.id"><a :href="link.url" target="_blank" rel="noopener noreferrer"><app-icon :name="link.icon"></app-icon><span><b>{{ link.name }}</b><small>{{ link.category || 'Sin categoría' }} · {{ link.scope==='shared' ? 'Compartido' : 'Personal' }}</small><small>{{ link.url }}</small></span><app-icon name="arrow-up-right"></app-icon></a><div v-if="canEdit(link)" class="noc-link-actions"><button type="button" @click="edit(link)" :aria-label="'Editar '+link.name">Editar</button><button type="button" @click="deleting=link.id" :aria-label="'Eliminar '+link.name">Eliminar</button></div><div v-if="deleting===link.id" class="noc-link-confirm"><span>¿Eliminar este acceso?</span><button type="button" :disabled="removing" @click="remove(link.id)">{{ removing ? 'Eliminando…' : 'Confirmar' }}</button><button type="button" @click="deleting=''">Cancelar</button></div></article></div>
      <p v-else class="noc-empty">Sin accesos configurados.</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form v-if="formOpen" class="noc-link-form" @submit.prevent="save" data-od-id="dashboard-link-form"><h3>{{ draft.id ? 'Editar acceso' : 'Nuevo acceso' }}</h3><div class="noc-form-grid"><label>Nombre<input v-model="draft.name" required maxlength="70" placeholder="Consola de administración"></label><label>Dirección<input v-model="draft.url" required type="url" placeholder="https://servidor.local" autocomplete="url"></label><label>Icono<select v-model="draft.icon"><option v-for="icon in icons" :key="icon" :value="icon">{{ {remote:'Acceso remoto',server:'Servidor',network:'Red',camera:'Cámara',building:'Sede',shield:'Protección',database:'Almacenamiento',activity:'Actividad',box:'Aplicación'}[icon] }}</option></select></label><label>Categoría opcional<input v-model="draft.category" maxlength="60" placeholder="Infraestructura"></label><label>Visibilidad<select v-model="draft.scope"><option value="personal">Personal · solo para mí</option><option v-if="shared" value="shared">Compartido · todos los usuarios</option></select></label></div><div class="noc-form-actions"><button type="button" class="btn btn--ghost" @click="formOpen=false">Cancelar</button><button type="submit" class="btn btn--secondary" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar acceso' }}</button></div></form></section>`
  };
  const DashboardPreferences = {
    components: { AppIcon: window.AppIcon, DashboardLinks }, props: ['app'],
    data() { return { saving: false, error: '' }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || ''; },
      layout() { return layoutFor(this.app.dashboard, this.userId); },
      widgets() { return this.layout.map(id => CATALOGUE.find(w => w.id === id)); },
      hidden() { return CATALOGUE.filter(w => !this.layout.includes(w.id)); },
      temporary() { return this.app.dashboard.temporary[key(this.userId)] || []; }
    },
    methods: {
      async persist() {
        const dashboard = this.app.dashboard, widgets = layoutFor(dashboard, this.userId);
        this.saving = true; this.error = '';
        try {
          if (this.app.patchWorkspaceState) await this.app.patchWorkspaceState({ widgets });
          else await window.AssetPhase10Api.patchState(this.app, { widgets });
        } catch (error) { this.error = error.message || 'No se pudo guardar la distribución.'; }
        finally { this.saving = false; }
      },
      move(id, delta) { if (moveWidget(this.app.dashboard, this.userId, id, delta)) this.persist(); },
      visible(id, value) { if (setWidgetVisible(this.app.dashboard, this.userId, id, value)) this.persist(); },
      add(id) { addTemporary(this.app.dashboard, this.userId, id); },
      clear() { clearTemporary(this.app.dashboard, this.userId); },
      async reset() { resetLayout(this.app.dashboard, this.userId); await this.persist(); this.app.showToast('Distribución predeterminada restaurada.'); }
    },
    template: `<section class="config-section noc-preferences" data-od-id="dashboard-preferences"><header class="config-section__head"><div><p class="eyebrow">Inicio y operaciones</p><h2>Dashboard</h2><p>Widgets y accesos personales. Los umbrales se configuran en Supervisión.</p></div><a class="btn btn--secondary" href="#/panel">Volver al Dashboard</a></header><div class="noc-preference-intro"><h3>Distribución habitual</h3><p>El orden se aplica de izquierda a derecha. Estos ajustes son personales y se guardan en tu cuenta.</p></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <ol class="noc-layout-list"><li v-for="(widget,index) in widgets" :key="widget.id" :data-od-id="'dashboard-preference-'+widget.id"><span class="mono">{{ String(index+1).padStart(2,'0') }}</span><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><div class="noc-layout-actions"><button type="button" @click="move(widget.id,-1)" :disabled="index===0||saving" :aria-label="'Subir '+widget.label"><app-icon name="chevron-up"></app-icon></button><button type="button" @click="move(widget.id,1)" :disabled="index===widgets.length-1||saving" :aria-label="'Bajar '+widget.label"><app-icon name="chevron-down"></app-icon></button><button type="button" @click="visible(widget.id,false)" :disabled="saving" :aria-label="'Ocultar '+widget.label">Ocultar</button></div></li></ol>
      <p v-if="!widgets.length" class="noc-empty">No hay widgets en tu distribución. Añade uno o restaura la distribución inicial.</p><div class="noc-hidden-widgets"><article v-for="widget in hidden" :key="widget.id"><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><button type="button" class="btn btn--secondary" @click="visible(widget.id,true)" :disabled="saving">Añadir</button><button type="button" class="btn btn--ghost" @click="add(widget.id)" :disabled="temporary.includes(widget.id)">{{ temporary.includes(widget.id) ? 'Temporal añadido' : 'Solo temporalmente' }}</button></article></div>
      <div class="noc-form-actions"><button type="button" class="btn btn--secondary" @click="reset" :disabled="saving" data-od-id="dashboard-reset-layout">Restaurar distribución inicial</button><button v-if="temporary.length" type="button" class="btn btn--ghost" @click="clear">Quitar widgets temporales ({{ temporary.length }})</button></div><dashboard-links :app="app"></dashboard-links></section>`
  };
  window.AssetDashboardPrefs = { CATALOGUE, DEFAULTS, createState, layoutFor, visibleWidgets, moveWidget, setWidgetVisible, addTemporary, clearTemporary, resetLayout, linksFor, editable, normalizeShortcut, DashboardPreferences, DashboardLinks };
})();
