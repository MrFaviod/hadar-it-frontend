(function(){
  'use strict';
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  // Saved-view routes are stable identifiers; only their displayed names live in
  // the catalog, so a route rename never depends on the active language.
  const ROUTE_LABEL_KEYS = {
    inventory: 'ui.workspace.route_inventory',
    map: 'ui.workspace.route_map',
    graph: 'ui.workspace.route_graph',
    panel: 'ui.workspace.route_panel',
    reports: 'ui.workspace.route_reports'
  };
  const WorkspaceShortcuts={
    components:{AppIcon:window.AppIcon,ModalShell:window.ModalShell},props:{app:Object},
    data(){return {panel:'',saveOpen:false,saving:false,name:'',scope:'personal',error:''};},
    computed:{target(){return this.app.currentWorkspaceTarget;},active(){return this.target&&this.app.workspaceFavorites.some(f=>f.key===this.target.key);},ownedViews(){return this.app.workspaceViews.filter(v=>v.ownerId===this.app.workspaceUserId&&v.route===this.app.route.name);}},
    methods:{
      tr,
      favoriteLabel(record){const on=this.app.workspaceFavorites.some(f=>f.key===record.key);return tr(on?'ui.workspace.unfavorite':'ui.workspace.favorite',{label:record.label});},
      routeLabel(route){const key=ROUTE_LABEL_KEYS[route];return key?tr(key):route;},
      scopeLabel(view){return tr(view.scope==='shared'?'ui.workspace.shared':'ui.workspace.personal');},
      isViewFavorite(view){return this.app.workspaceFavorites.some(f=>f.key==='view:'+view.id);},
      openSave(){this.name=tr('ui.workspace.default_name',{page:this.app.pageLabel||tr('ui.workspace.untitled')});this.scope='personal';this.error='';this.saveOpen=true;this.panel='';},
      save(){if(this.saving)return;if(!this.name.trim()){this.error=tr('ui.workspace.error_name');return;}this.saving=true;this.error='';return Promise.resolve(this.app.saveWorkspaceView({name:this.name.trim(),scope:this.scope})).then(r=>{if(r&&r.ok)this.saveOpen=false;else this.error=(r&&r.error)||tr('ui.workspace.error_save');}).finally(()=>{this.saving=false;});},
      update(view){return Promise.resolve(this.app.saveWorkspaceView({id:view.id,name:view.name,scope:view.scope}));},
      closeOutside(e){if(!this.$el.contains(e.target)){this.panel='';this.$el.open=false;}}
    },
    mounted(){document.addEventListener('pointerdown',this.closeOutside);},beforeUnmount(){document.removeEventListener('pointerdown',this.closeOutside);},
    template:`<details class="workspace-menu" @keydown.esc="$event.currentTarget.open=false"><summary :aria-label="$t('ui.workspace.saved_views')"><app-icon name="star"></app-icon><span>{{ $t('ui.workspace.saved_views') }}</span></summary><section class="workspace-shortcuts" :aria-label="$t('ui.workspace.aria')" data-od-id="workspace-shortcuts" @keydown.esc="panel=''">
      <div class="workspace-shortcuts__actions"><button v-if="target" type="button" class="workspace-favorite" :aria-pressed="!!active" :aria-label="favoriteLabel(target)" @click="app.toggleWorkspaceFavorite(target)" data-od-id="favorite-current"><app-icon name="star" aria-hidden="true"></app-icon></button><button type="button" class="workspace-shortcuts__button" :aria-expanded="panel==='favorites'" aria-controls="workspace-favorites-panel" @click="panel=panel==='favorites'?'':'favorites'" data-od-id="open-favorites">{{ $t('ui.workspace.favorites') }} <span class="mono">{{app.workspaceFavorites.length}}</span></button><button type="button" class="workspace-shortcuts__button" :aria-expanded="panel==='views'" aria-controls="workspace-views-panel" @click="panel=panel==='views'?'':'views'" data-od-id="open-saved-views">{{ $t('ui.workspace.saved_views') }} <app-icon name="chevron-down"></app-icon></button><button v-if="app.workspaceCanSave" type="button" class="workspace-shortcuts__button" @click="openSave" data-od-id="save-current-view"><app-icon name="plus"></app-icon>{{ $t('ui.workspace.save_view') }}</button></div>
      <div v-if="panel" :id="panel==='favorites'?'workspace-favorites-panel':'workspace-views-panel'" class="workspace-popover"><header><h2>{{panel==='favorites'?$t('ui.workspace.favorites'):$t('ui.workspace.saved_views')}}</h2><button type="button" class="icon-button" :aria-label="$t('ui.workspace.close_panel')" @click="panel=''"><app-icon name="close"></app-icon></button></header>
        <template v-if="panel==='favorites'"><p v-if="!app.workspaceFavorites.length" class="workspace-empty">{{ $t('ui.workspace.favorites_empty') }}</p><ul v-else><li v-for="r in app.workspaceFavorites" :key="r.key"><button class="workspace-popover__open" type="button" @click="app.openWorkspaceTarget(r);panel=''"><app-icon :name="r.icon"></app-icon><span><strong>{{r.label}}</strong><small>{{r.type}}</small></span></button><button class="icon-button" type="button" :aria-label="favoriteLabel(r)" @click="app.toggleWorkspaceFavorite(r)"><app-icon name="close"></app-icon></button></li></ul></template>
        <template v-else><p v-if="!app.workspaceViews.length" class="workspace-empty">{{ $t('ui.workspace.views_empty') }}</p><ul v-else><li v-for="v in app.workspaceViews" :key="v.id"><button type="button" class="workspace-popover__open" @click="app.restoreWorkspaceView(v);panel=''"><app-icon name="table"></app-icon><span><strong>{{v.name}}</strong><small>{{scopeLabel(v)}} · {{routeLabel(v.route)}}</small></span></button><button type="button" class="workspace-favorite" :aria-label="$t('ui.workspace.favorite_view', { name: v.name })" :aria-pressed="isViewFavorite(v)" @click="app.toggleWorkspaceFavorite(app.workspaceViewRecord(v))"><app-icon name="star" aria-hidden="true"></app-icon></button><template v-if="v.ownerId===app.workspaceUserId"><button v-if="v.route===app.route.name" type="button" class="icon-button" :aria-label="$t('ui.workspace.update_view', { name: v.name })" @click="update(v)"><app-icon name="refresh"></app-icon></button><button type="button" class="icon-button" :aria-label="$t('ui.workspace.delete_view', { name: v.name })" @click="app.removeWorkspaceView(v)"><app-icon name="trash"></app-icon></button></template></li></ul></template>
        <footer><button type="button" class="text-button" @click="app.openUniversalSearch();panel=''">{{ $t('ui.workspace.search_cta') }} <app-icon name="arrow-right"></app-icon></button></footer>
      </div>
      <modal-shell :open="saveOpen" :title="$t('ui.workspace.save_view')" @close="saveOpen=false"><form id="save-workspace-view" @submit.prevent="save"><label class="workspace-field" for="saved-view-name">{{ $t('ui.workspace.name_label') }}<input id="saved-view-name" v-model="name" maxlength="70" :aria-invalid="!!error" aria-describedby="saved-view-error" data-od-id="saved-view-name"></label><label class="workspace-field" for="saved-view-scope">{{ $t('ui.workspace.visibility_label') }}<select id="saved-view-scope" v-model="scope"><option value="personal">{{ $t('ui.workspace.personal_desc') }}</option><option value="shared">{{ $t('ui.workspace.shared_desc') }}</option></select></label><p id="saved-view-error" class="field__error" role="alert">{{error}}</p></form><template #footer><button type="button" class="btn btn--secondary" @click="saveOpen=false">{{ $t('ui.common.cancel') }}</button><button type="submit" form="save-workspace-view" class="btn btn--primary" :disabled="saving">{{saving?$t('ui.workspace.saving'):$t('ui.workspace.save_view')}}</button></template></modal-shell>
    </section></details>`
  };
  window.AssetWorkspaceViews={WorkspaceShortcuts};
})();
