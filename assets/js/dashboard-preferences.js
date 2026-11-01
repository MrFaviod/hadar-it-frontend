(function () {
  'use strict';
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  // Widget ids stay stable across languages; only the displayed label and the
  // one-line description come from the catalog, resolved when they are read.
  const WIDGETS = [
    { id: 'availability', wide: true },
    { id: 'alerts' },
    { id: 'distribution' },
    { id: 'infrastructure' },
    { id: 'activity', wide: true },
    { id: 'maintenance' },
    { id: 'warranties' },
    { id: 'inventory' },
    { id: 'latency', wide: true },
    { id: 'incidents', wide: true }
  ];
  const WIDGET_LABEL_KEYS = { availability: 'ui.dashboard.widget_availability', alerts: 'ui.dashboard.widget_alerts', distribution: 'ui.dashboard.widget_distribution', infrastructure: 'ui.dashboard.widget_infrastructure', activity: 'ui.dashboard.widget_activity', maintenance: 'ui.dashboard.widget_maintenance', warranties: 'ui.dashboard.widget_warranties', inventory: 'ui.dashboard.widget_inventory', latency: 'ui.dashboard.widget_latency', incidents: 'ui.dashboard.widget_incidents' };
  const WIDGET_DESCRIPTION_KEYS = { availability: 'ui.dashboard.widget_availability_desc', alerts: 'ui.dashboard.widget_alerts_desc', distribution: 'ui.dashboard.widget_distribution_desc', infrastructure: 'ui.dashboard.widget_infrastructure_desc', activity: 'ui.dashboard.widget_activity_desc', maintenance: 'ui.dashboard.widget_maintenance_desc', warranties: 'ui.dashboard.widget_warranties_desc', inventory: 'ui.dashboard.widget_inventory_desc', latency: 'ui.dashboard.widget_latency_desc', incidents: 'ui.dashboard.widget_incidents_desc' };
  const ICON_LABEL_KEYS = { remote: 'ui.shell.filter_column_remote', server: 'ui.dashboard.icon_server', network: 'ui.dashboard.icon_network', camera: 'ui.dashboard.icon_camera', building: 'ui.dashboard.icon_building', shield: 'ui.dashboard.icon_shield', database: 'ui.dashboard.icon_database', activity: 'ui.dashboard.icon_activity', box: 'ui.dashboard.icon_box' };
  const CATALOGUE = WIDGETS.map(widget => ({
    id: widget.id, wide: !!widget.wide,
    get label() { return tr(WIDGET_LABEL_KEYS[widget.id]); },
    get description() { return tr(WIDGET_DESCRIPTION_KEYS[widget.id]); }
  }));
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
    if (draft.id && !existing) return fail(tr('ui.dashboard.error_link_missing'));
    if (existing && !editable(existing, userId, shared)) return fail(tr('ui.dashboard.error_link_edit'));
    const name = String(draft.name || '').trim();
    if (!name || name.length > 70) return fail(tr('ui.workspace.error_name_range'));
    let url;
    try { url = new URL(String(draft.url || '').trim()); } catch (_) { return fail(tr('ui.dashboard.error_link_url')); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return fail(tr('ui.dashboard.error_link_protocol'));
    const scope = draft.scope === 'shared' ? 'shared' : 'personal';
    if (scope === 'shared' && !shared) return fail(tr('ui.dashboard.error_link_shared'));
    const shortcut = { id: existing ? existing.id : '', name, url: url.href, icon: ICONS.includes(draft.icon) ? draft.icon : 'remote', category: String(draft.category || '').trim().slice(0, 60), scope, ownerId: existing ? existing.ownerId : key(userId) };
    return { ok: true, shortcut };
  }
  function deleteLinkOptions(link, userId, shared) {
    if (!link || !editable(link, userId, shared)) return { ok: false, error: tr('ui.dashboard.error_link_delete') };
    return { ok: true };
  }
  const DashboardLinks = {
    components: { AppIcon: window.AppIcon }, props: ['app'],
    data() { return { formOpen: false, draft: {}, error: '', deleting: '', saving: false, removing: false }; },
    computed: {
      userId() { return (this.app.currentUser || {}).id || ''; },
      shared() { return !!this.app.can('config.general'); },
      links() { return linksFor(this.app.dashboard, this.userId); },
      icons() { return ICONS.map(icon => ({ id: icon, label: tr(ICON_LABEL_KEYS[icon] || ICON_LABEL_KEYS.remote) })); }
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
          if (result.ok) { this.formOpen = false; this.app.showToast(tr('ui.dashboard.toast_link_saved')); }
          else this.error = result.error || tr('ui.dashboard.error_link_save');
        } finally { this.saving = false; }
      },
      async remove(id) {
        const link = this.links.find(item => item.id === id), checked = deleteLinkOptions(link, this.userId, this.shared);
        if (!checked.ok) { this.error = checked.error; return; }
        this.removing = true;
        try {
          const result = this.app.deleteWorkspaceShortcut ? await this.app.deleteWorkspaceShortcut(id) : await window.AssetPhase10Api.deleteShortcut(this.app, id);
          if (result.ok) this.deleting = ''; else this.error = result.error || tr('ui.dashboard.error_link_delete_failed');
        } finally { this.removing = false; }
      }
    },
    template: `<section class="noc-links" data-od-id="dashboard-custom-links"><header class="noc-section-head"><div><h2>{{ $t('ui.dashboard.links_title') }}</h2><p>{{ $t('ui.dashboard.links_lead') }}</p></div><button type="button" class="btn btn--secondary" @click="edit()" data-od-id="dashboard-add-link"><app-icon name="plus"></app-icon>{{ $t('ui.dashboard.add_link') }}</button></header>
      <div v-if="links.length" class="noc-link-grid"><article v-for="link in links" :key="link.id" :data-od-id="'dashboard-link-'+link.id"><a :href="link.url" target="_blank" rel="noopener noreferrer"><app-icon :name="link.icon"></app-icon><span><b>{{ link.name }}</b><small>{{ link.category || $t('ui.dashboard.no_category') }} · {{ link.scope==='shared' ? $t('ui.dashboard.scope_shared') : $t('ui.dashboard.scope_personal') }}</small><small>{{ link.url }}</small></span><app-icon name="arrow-up-right"></app-icon></a><div v-if="canEdit(link)" class="noc-link-actions"><button type="button" @click="edit(link)" :aria-label="$t('ui.dashboard.edit_link_aria', { name: link.name })">{{ $t('ui.people.edit') }}</button><button type="button" @click="deleting=link.id" :aria-label="$t('ui.dashboard.delete_link_aria', { name: link.name })">{{ $t('ui.common.delete') }}</button></div><div v-if="deleting===link.id" class="noc-link-confirm"><span>{{ $t('ui.dashboard.confirm_delete_link') }}</span><button type="button" :disabled="removing" @click="remove(link.id)">{{ removing ? $t('ui.dashboard.deleting') : $t('ui.dashboard.confirm') }}</button><button type="button" @click="deleting=''">{{ $t('ui.common.cancel') }}</button></div></article></div>
      <p v-else class="noc-empty">{{ $t('ui.dashboard.links_empty') }}</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form v-if="formOpen" class="noc-link-form" @submit.prevent="save" data-od-id="dashboard-link-form"><h3>{{ draft.id ? $t('ui.dashboard.edit_link') : $t('ui.dashboard.new_link') }}</h3><div class="noc-form-grid"><label>{{ $t('ui.dashboard.field_name') }}<input v-model="draft.name" required maxlength="70" :placeholder="$t('ui.dashboard.name_placeholder')"></label><label>{{ $t('ui.dashboard.field_url') }}<input v-model="draft.url" required type="url" :placeholder="$t('ui.dashboard.url_placeholder')" autocomplete="url"></label><label>{{ $t('ui.dashboard.field_icon') }}<select v-model="draft.icon"><option v-for="icon in icons" :key="icon.id" :value="icon.id">{{ icon.label }}</option></select></label><label>{{ $t('ui.dashboard.field_optional_category') }}<input v-model="draft.category" maxlength="60" :placeholder="$t('ui.dashboard.category_placeholder')"></label><label>{{ $t('ui.dashboard.field_visibility') }}<select v-model="draft.scope"><option value="personal">{{ $t('ui.dashboard.visibility_personal') }}</option><option v-if="shared" value="shared">{{ $t('ui.dashboard.visibility_shared') }}</option></select></label></div><div class="noc-form-actions"><button type="button" class="btn btn--ghost" @click="formOpen=false">{{ $t('ui.common.cancel') }}</button><button type="submit" class="btn btn--secondary" :disabled="saving">{{ saving ? $t('ui.dashboard.saving') : $t('ui.dashboard.save_link') }}</button></div></form></section>`
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
        } catch (error) { this.error = error.message || tr('ui.dashboard.error_layout'); }
        finally { this.saving = false; }
      },
      move(id, delta) { if (moveWidget(this.app.dashboard, this.userId, id, delta)) this.persist(); },
      visible(id, value) { if (setWidgetVisible(this.app.dashboard, this.userId, id, value)) this.persist(); },
      add(id) { addTemporary(this.app.dashboard, this.userId, id); },
      clear() { clearTemporary(this.app.dashboard, this.userId); },
      async reset() { resetLayout(this.app.dashboard, this.userId); await this.persist(); this.app.showToast(tr('ui.dashboard.toast_layout_reset')); }
    },
    template: `<section class="config-section noc-preferences" data-od-id="dashboard-preferences"><header class="config-section__head"><div><p class="eyebrow">{{ $t('ui.dashboard.prefs_eyebrow') }}</p><h2>{{ $t('ui.dashboard.prefs_title') }}</h2><p>{{ $t('ui.dashboard.prefs_lead') }}</p></div><a class="btn btn--secondary" href="#/panel">{{ $t('ui.dashboard.prefs_back') }}</a></header><div class="noc-preference-intro"><h3>{{ $t('ui.dashboard.layout_title') }}</h3><p>{{ $t('ui.dashboard.layout_lead') }}</p></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <ol class="noc-layout-list"><li v-for="(widget,index) in widgets" :key="widget.id" :data-od-id="'dashboard-preference-'+widget.id"><span class="mono">{{ String(index+1).padStart(2,'0') }}</span><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><div class="noc-layout-actions"><button type="button" @click="move(widget.id,-1)" :disabled="index===0||saving" :aria-label="$t('ui.dashboard.move_up_aria', { label: widget.label })"><app-icon name="chevron-up"></app-icon></button><button type="button" @click="move(widget.id,1)" :disabled="index===widgets.length-1||saving" :aria-label="$t('ui.dashboard.move_down_aria', { label: widget.label })"><app-icon name="chevron-down"></app-icon></button><button type="button" @click="visible(widget.id,false)" :disabled="saving" :aria-label="$t('ui.dashboard.hide_aria', { label: widget.label })">{{ $t('ui.dashboard.hide') }}</button></div></li></ol>
      <p v-if="!widgets.length" class="noc-empty">{{ $t('ui.dashboard.layout_empty') }}</p><div class="noc-hidden-widgets"><article v-for="widget in hidden" :key="widget.id"><div><b>{{ widget.label }}</b><small>{{ widget.description }}</small></div><button type="button" class="btn btn--secondary" @click="visible(widget.id,true)" :disabled="saving">{{ $t('ui.dashboard.add_widget') }}</button><button type="button" class="btn btn--ghost" @click="add(widget.id)" :disabled="temporary.includes(widget.id)">{{ temporary.includes(widget.id) ? $t('ui.dashboard.temporary_added') : $t('ui.dashboard.temporary_only') }}</button></article></div>
      <div class="noc-form-actions"><button type="button" class="btn btn--secondary" @click="reset" :disabled="saving" data-od-id="dashboard-reset-layout">{{ $t('ui.dashboard.reset_layout') }}</button><button v-if="temporary.length" type="button" class="btn btn--ghost" @click="clear">{{ $t('ui.dashboard.clear_temporary', { count: temporary.length }) }}</button></div><dashboard-links :app="app"></dashboard-links></section>`
  };
  window.AssetDashboardPrefs = { CATALOGUE, DEFAULTS, createState, layoutFor, visibleWidgets, moveWidget, setWidgetVisible, addTemporary, clearTemporary, resetLayout, linksFor, editable, normalizeShortcut, DashboardPreferences, DashboardLinks };
})();
