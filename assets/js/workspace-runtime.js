(function(){
  'use strict';
  const W=window.AssetWorkspace,S=window.AssetSearch;
  const routes=['inventory','map','graph','panel','reports'];
  const statusOf=(app,id)=>(app.assetAdmin.statuses||[]).find(s=>s.id===id)?.label||id;
  function childFor(app){return app.$refs?.workspaceView;}
  function snapshotChild(component){const keys=component.$options.workspaceFields||[];const out={};keys.forEach(key=>{if(component[key]!==undefined)out[key]=W.clone(component[key]);});return out;}
  function installMemory(component,route,fields){
    component.workspaceFields=fields;
    const originalCreated=component.created;
    component.created=function(){
      originalCreated?.call(this);
      const a=this.app;if(!a.workspaceState)return;
      const pending=a.workspacePending?.route===route;
      const snapshot=pending?a.workspacePending.snapshot:W.user(a.workspaceState,a.workspaceUserId).lastViews[route];
      const freshDocument=route==='reports'&&a.documentContext.workspaceFresh;
      if(freshDocument)a.documentContext.workspaceFresh=false;
      if(snapshot&&!freshDocument)fields.forEach(k=>{if(snapshot[k]!==undefined)this[k]=W.clone(snapshot[k]);});
      // The explorer's shared filters and selection take precedence on map/graph switches.
      if(['map','graph'].includes(route)&&!pending){this.filters=Object.assign({},this.filters,W.clone(a.explorerFilters));this.selectedId=a.explorerSelection||'';}
      if(pending)a.workspacePending=null;
    };
    component.mixins=[...(component.mixins||[]),{
      mounted(){if(this.app.workspaceState)this.app.workspaceRevision+=1;},
      beforeUnmount(){if(this.app.workspaceState)W.rememberView(this.app.workspaceState,this.app.workspaceUserId,route,snapshotChild(this));}
    }];
  }
  installMemory(window.AssetMapViews.MapExplorer,'map',['filters','level','activeSiteId','activeFloorId','selectedId','selectedRoom','floorZoom']);
  installMemory(window.AssetGraphView,'graph',['filters','view','hiddenIds','selectedId']);
  installMemory(window.AssetPanel.PanelOverview,'panel',['filters']);
  installMemory(window.AssetReportViews.ReportsCenter,'reports',['tab','family','templateId','template','filters','ids','explicit','group','from','to','event','warrantyFilter','output']);

  const maintenance=window.AssetMaintViews.MaintenanceCenter;
  const maintenanceCreated=maintenance.created;
  maintenance.created=function(){maintenanceCreated?.call(this);const id=this.app.workspaceMaintenanceId;if(!id)return;const row=this.app.maintenance.plans.find(p=>p.id===id);if(row){this.view='agenda';this.filters.query=row.assetId||'';}this.app.workspaceMaintenanceId='';};
  const computed={
    workspaceUserId(){return String(this.currentUser?.id||'demo');},
    workspaceFavorites(){return W.user(this.workspaceState,this.workspaceUserId).favorites;},
    workspaceUsage(){return W.user(this.workspaceState,this.workspaceUserId).usage;},
    workspaceViews(){return W.visibleViews(this.workspaceState,this.workspaceUserId);},
    universalRecords(){const records=S.buildIndex(this);this.workspaceViews.forEach(v=>records.push(this.workspaceViewRecord(v)));return records;},
    workspaceFavoriteKeys(){return this.workspaceFavorites.map(f=>f.key);},
    workspaceCanSave(){return routes.includes(this.route.name);},
    currentWorkspaceTarget(){if(this.currentAsset)return this.universalRecords.find(r=>r.key==='asset:'+this.currentAsset.id);if(this.currentPerson)return this.universalRecords.find(r=>r.key==='person:'+this.currentPerson.id);if(this.route.name==='config')return this.universalRecords.find(r=>r.key==='section:config-'+this.route.section);return this.universalRecords.find(r=>r.key==='section:'+this.route.name);},
    workspaceLocations(){return this.sites.flatMap(s=>(s.locations||[]).map(l=>({...l,siteId:s.id,fullLabel:s.label+' · '+l.label})));},
    workspaceFilters(){void this.workspaceRevision;const child=childFor(this),name=this.route.name;if(name==='inventory')return {category:this.prefs.category,site:this.prefs.site,status:this.workspaceInventory.status,location:this.workspaceInventory.location,search:this.prefs.search};if(name==='map'||name==='graph')return {category:this.explorerFilters.categories[0]||'all',site:this.explorerFilters.sites[0]||'all',status:this.explorerFilters.states[0]||'all',location:this.explorerFilters.locations?.[0]||'all',search:this.explorerFilters.search};if(child?.filters)return {category:child.filters.category||'all',site:child.filters.site||'all',status:child.filters.status||'all',location:child.filters.location||'all',search:child.filters.search||''};return {category:'all',site:'all',status:'all',location:'all',search:''};},
    workspaceChips(){const f=this.workspaceFilters,rows=[],multi=['map','graph'].includes(this.route.name),add=(kind,id,label)=>{if(id&&id!=='all')rows.push({kind,id,label});};if(multi){this.explorerFilters.categories.forEach(id=>add('category',id,this.categoryLabel(id)));this.explorerFilters.sites.forEach(id=>add('site',id,this.siteLabel(id)));this.explorerFilters.states.forEach(id=>add('status',id,statusOf(this,id)));(this.explorerFilters.locations||[]).forEach(id=>add('location',id,this.workspaceLocations.find(l=>l.id===id)?.label||id));}else{add('category',f.category,this.categoryLabel(f.category));add('site',f.site,this.siteLabel(f.site));add('status',f.status,statusOf(this,f.status));add('location',f.location,this.workspaceLocations.find(l=>l.id===f.location)?.label||f.location);}if(f.search)add('search',f.search,'Búsqueda: '+f.search);return rows;}
  };
  const methods={
    openUniversalSearch(){if(!this.authenticated)return;this.universalOpen=true;this.userMenuOpen=false;this.mobileNavOpen=false;},
    toggleWorkspaceFavorite(record){if(!record)return;const added=W.toggleFavorite(this.workspaceState,this.workspaceUserId,record);this.showToast(added?'Añadido a favoritos.':'Eliminado de favoritos.');},
    workspaceViewRecord(view){return S.record('view',view.id,view.name,view.scope==='shared'?'Vista compartida':'Vista personal','table',[],{kind:'view',id:view.id});},
    captureWorkspaceView(){if(this.route.name==='inventory')return {prefs:{category:this.prefs.category,site:this.prefs.site,search:this.prefs.search,view:this.prefs.view,sort:this.prefs.sort},inventory:W.clone(this.workspaceInventory),selection:this.bulk.ids.slice()};const child=childFor(this);return child?snapshotChild(child):{filters:W.clone(this.explorerFilters),selectedId:this.explorerSelection};},
    rememberWorkspaceInventory(){W.rememberView(this.workspaceState,this.workspaceUserId,'inventory',this.captureWorkspaceView());},
    saveWorkspaceView(draft){const result=W.saveView(this.workspaceState,this.workspaceUserId,{...draft,route:this.route.name,snapshot:this.captureWorkspaceView()});if(result.ok){const key='view:'+result.view.id;Object.values(this.workspaceState.users).forEach(u=>{u.favorites=u.favorites.map(f=>f.key===key?this.workspaceViewRecord(result.view):f);});this.showToast(draft.id?'Vista actualizada.':'Vista guardada.');}return result;},
    restoreWorkspaceView(view){if(!view)return;const snapshot=W.clone(view.snapshot);if(this.route.name==='inventory')this.rememberWorkspaceInventory();if(view.route==='inventory'){Object.assign(this.prefs,snapshot.prefs||{});if(snapshot.inventory)this.workspaceInventory=W.clone(snapshot.inventory);this.bulk.ids=(snapshot.selection||[]).filter(id=>this.assets.some(a=>a.id===id));}else{if(['map','graph'].includes(view.route)){const f=snapshot.filters||{};this.explorerFilters={categories:f.categories||[],sites:f.sites||[],states:f.states||[],locations:f.locations||[],search:f.search||''};this.explorerSelection=snapshot.selectedId||'';}if(this.route.name===view.route&&childFor(this)){const child=childFor(this);Object.keys(snapshot).forEach(k=>{if(k in child)child[k]=W.clone(snapshot[k]);});}else this.workspacePending={route:view.route,snapshot};}W.rememberView(this.workspaceState,this.workspaceUserId,view.route,snapshot);this.navigateWorkspace({name:view.route});this.showToast('Vista «'+view.name+'» recuperada.');},
    removeWorkspaceView(view){const result=W.removeView(this.workspaceState,this.workspaceUserId,view.id);this.showToast(result.ok?'Vista eliminada.':result.error);},
    navigateWorkspace(route){const next=this.accessRoute?this.accessRoute(route):route;this.setHash(this.hashFor(next));},
    openWorkspaceTarget(record){if(!record)return;this.universalOpen=false;const u=W.user(this.workspaceState,this.workspaceUserId);u.usage[record.key]=(u.usage[record.key]||0)+1;const t=record.target||{},asset=this.assets.find(a=>a.id===t.id);if(t.kind==='view'){this.restoreWorkspaceView(this.workspaceViews.find(v=>v.id===t.id));return;}if(t.kind==='asset'){this.navigateWorkspace({name:'detail',assetId:t.id});return;}if(t.kind==='person'){this.navigateWorkspace({name:'person',personId:t.id});return;}if(t.kind==='section'){this.navigateWorkspace(t.route);return;}if(t.kind==='site'||t.kind==='location'){this.explorerFilters={categories:[],sites:[t.siteId||t.id],states:[],locations:t.kind==='location'?[t.id]:[],search:''};this.explorerSelection='';const snapshot={filters:W.clone(this.explorerFilters),level:'geo',activeSiteId:t.siteId||t.id,activeFloorId:'',selectedId:'',selectedRoom:''};if(this.route.name==='map'&&childFor(this))Object.assign(childFor(this),snapshot);else this.workspacePending={route:'map',snapshot};this.navigateWorkspace({name:'map'});return;}if(t.kind==='incident'){this.navigateWorkspace({name:'incident',incidentId:t.id});return;}if(t.kind==='intervention'){if(!this.can('assets.edit')){this.navigateWorkspace({name:'maintenance'});return;}const row=this.maintenance.interventions.find(r=>r.id===t.id);this.quickDialog={type:'intervention',assetId:row?.assetId||'',intervention:row};return;}if(t.kind==='plan'){this.workspaceMaintenanceId=t.id;this.navigateWorkspace({name:'maintenance'});this.$nextTick?.(()=>{const center=this.$refs.maintenanceCenter,row=this.maintenance.plans.find(p=>p.id===t.id);if(center&&row){center.view='agenda';center.filters.query=row.assetId||'';this.workspaceMaintenanceId='';}});return;}if(t.kind==='report'){this.documentContext={ids:[],category:'all',site:'all',search:'',templateId:t.id,workspaceFresh:true};this.workspacePending=null;delete u.lastViews.reports;const child=childFor(this);if(this.route.name==='reports'&&child){child.chooseTemplate(t.id);child.family=child.template.family;}this.navigateWorkspace({name:'reports'});return;}if(t.kind!=='action')return;const action=t.action;if(action==='create-asset'){this.openAssetCreate();return;}if(action==='intervention'||action==='incident'){if(this.can('assets.edit'))this.quickDialog={type:action,assetId:t.id||'',intervention:null};return;}if(action.startsWith('remote-')){if(asset)this.openRemote(asset,action==='remote-anydesk'?'anydesk':'rmm');return;}if(action==='consult'){if(asset)this.navigateWorkspace({name:'detail',assetId:asset.id});return;}if(action==='map'||action==='graph'){if(asset)this.explorerSelection=asset.id;this.navigateWorkspace({name:action,focusId:asset?.id||''});return;}this.navigateWorkspace({name:action});},
    setWorkspaceFilter(key,value){const name=this.route.name,child=childFor(this),empty=value==='all'?'':value;if(name==='inventory'){if(key==='category'||key==='site')this.prefs[key]=value;else if(key==='search')this.prefs.search=value;else this.workspaceInventory[key]=value;}else if(name==='map'||name==='graph'){const field={category:'categories',site:'sites',status:'states',location:'locations'}[key];if(field)this.explorerFilters[field]=empty?[empty]:[];else this.explorerFilters.search=value;}else if(child?.filters)child.filters[key]=name==='panel'?empty:value;},
    removeWorkspaceFilter(chip){if(['map','graph'].includes(this.route.name)&&chip.kind!=='search'){const key={category:'categories',site:'sites',status:'states',location:'locations'}[chip.kind];this.explorerFilters[key]=this.explorerFilters[key].filter(id=>id!==chip.id);}else this.setWorkspaceFilter(chip.kind,chip.kind==='search'?'':'all');},
    resetWorkspaceFilters(){['category','site','status','location'].forEach(k=>this.setWorkspaceFilter(k,'all'));this.setWorkspaceFilter('search','');},
    handleWorkspaceRoute(next,previous){this.universalOpen=false;if(previous?.name==='inventory'&&next.name!=='inventory'){const snapshot={prefs:{category:this.prefs.category,site:this.prefs.site,search:this.prefs.search,view:this.prefs.view,sort:this.prefs.sort},inventory:W.clone(this.workspaceInventory),selection:this.bulk.ids.slice()};W.rememberView(this.workspaceState,this.workspaceUserId,'inventory',snapshot);}// Inventory state already lives on the root: keep explicit navigation filters intact.
}
  };
  window.AssetWorkspaceRuntime={computed,methods};
})();
