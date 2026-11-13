(function(){
  'use strict';
  const W=window.AssetWorkspace,S=window.AssetSearch;
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }
  const routes=['inventory','map','graph','panel','reports'];
  const statusOf=(app,id)=>(app.assetAdmin.statuses||[]).find(s=>s.id===id)?.label||id;
  // Shared explorer state is authoritative only once the user has opened an
  // explorer this session or a target navigation populated it. On reload the
  // saved last view is the only source, so empty defaults must not erase it.
  function explorerShared(app){const f=(app&&app.explorerFilters)||{};return ['categories','sites','states','locations'].some(k=>Array.isArray(f[k])&&f[k].length>0)||!!f.search||!!(app&&app.explorerSelection);}
  // One public unwrap protocol: the deferred wrapper exposes its mounted child
  // through AssetLoader.realView, while a static entry returns the view itself.
  function childFor(app){const ref=app.$refs?.workspaceView;return window.AssetLoader?.realView?window.AssetLoader.realView(ref):ref;}
  // Field schemas are static data, not a consequence of the component having
  // arrived: a saved view restored before its bundle loads must keep its
  // snapshot. Installation still happens when the definition appears.
  const viewFields={
    map:['filters','level','activeSiteId','activeFloorId','selectedId','selectedRoom','floorZoom'],
    graph:['filters','view','hiddenIds','selectedId'],
    panel:['filters'],
    reports:['tab','family','templateId','template','filters','ids','explicit','group','from','to','event','warrantyFilter','output']
  };
  function ownFields(source, fields){const out={};if(!source||typeof source!=='object'||Array.isArray(source))return out;fields.forEach(key=>{if(Object.hasOwn(source,key)&&source[key]!==undefined)out[key]=W.clone(source[key]);});return out;}
  function restorableSnapshot(route,source){
    if(route==='inventory')return {
      prefs:ownFields(source?.prefs,['category','site','search','view','sort']),
      inventory:ownFields(source?.inventory,['status','location','columns']),
      selection:Array.isArray(source?.selection)?W.clone(source.selection):[],
      ...(source&&Object.hasOwn(source,'filters')?{filters:ownFields(source.filters,['query','category','status'])}:{})
    };
    return ownFields(source,viewFields[route]||[]);
  }
  function snapshotChild(component){return ownFields(component.$data||component,component.$options.workspaceFields||[]);}
  function installMemory(component,route,fields){
    viewFields[route]=fields;
    component.workspaceFields=fields;
    const originalCreated=component.created;
    component.created=function(){
      originalCreated?.call(this);
      const a=this.app;if(!a.workspaceState)return;
      const pending=a.workspacePending?.route===route;
      const snapshot=pending?a.workspacePending.snapshot:W.user(a.workspaceState,a.workspaceUserId).lastViews[route];
      const freshDocument=route==='reports'&&a.documentContext.workspaceFresh;
      if(freshDocument)a.documentContext.workspaceFresh=false;
      if(snapshot&&!freshDocument)Object.assign(this,ownFields(snapshot,fields.filter(k=>Object.hasOwn(this.$data||this,k))));
      // The explorer's shared filters and selection take precedence on map/graph
      // switches; a reload restores the saved last view instead.
      if(['map','graph'].includes(route)&&!pending&&(a.explorerActive||explorerShared(a))){this.filters=Object.assign({},this.filters,W.clone(a.explorerFilters));this.selectedId=a.explorerSelection||'';}
      if(pending)a.workspacePending=null;
    };
    component.mixins=[...(component.mixins||[]),{
      mounted(){if(this.app.workspaceState)this.app.workspaceRevision+=1;if(['map','graph'].includes(route))this.app.explorerActive=true;},
      beforeUnmount(){const a=this.app;if(a.workspaceState){const snapshot=snapshotChild(this);W.rememberView(a.workspaceState,a.workspaceUserId,route,snapshot);if(a.authenticated&&a.phase10RememberLastView)a.phase10RememberLastView(route,snapshot);}}
    }];
  }
  // Operational view bundles are demand-loaded: when this runtime evaluates
  // before a domain bundle, remember the wiring and apply it as soon as the
  // view registers. The eager computed/methods surface is never deferred.
  const pendingViews = [];
  function installWhenReady(resolve, route, fields) {
    const admitted = fields || viewFields[route] || [];
    const component = resolve();
    if (component) { installMemory(component, route, admitted); return; }
    pendingViews.push(() => {
      const late = resolve();
      if (late && !late.workspaceFields) installMemory(late, route, admitted);
    });
  }
  installWhenReady(() => window.AssetMapViews?.MapExplorer,'map');
  installWhenReady(() => window.AssetGraphView,'graph');
  installWhenReady(() => window.AssetPanel?.PanelOverview,'panel');
  installWhenReady(() => window.AssetReportViews?.ReportsCenter,'reports');

  function attachMaintenance() {
    const maintenance = window.AssetMaintViews?.MaintenanceCenter;
    if (!maintenance || maintenance.workspaceHooked) return;
    const maintenanceCreated = maintenance.created;
    maintenance.workspaceHooked = true;
    maintenance.created = function(){maintenanceCreated?.call(this);const id=this.app.workspaceMaintenanceId;if(!id)return;this.loadPlanDetail(id);this.view='agenda';};
  }
  attachMaintenance();
  function wirePendingViews() {
    attachMaintenance();
    pendingViews.forEach((wire) => wire());
  }
  const computed={
    workspaceUserId(){return String(this.currentUser?.id||'');},
    workspaceFavorites(){return W.user(this.workspaceState,this.workspaceUserId).favorites;},
    workspaceUsage(){return W.user(this.workspaceState,this.workspaceUserId).usage;},
    workspaceViews(){return W.visibleViews(this.workspaceState,this.workspaceUserId);},
    universalRecords(){return this.workspaceFavorites.slice();},
    workspaceFavoriteKeys(){return this.workspaceFavorites.map(f=>f.key);},
    workspaceCanSave(){return routes.includes(this.route.name);},
    currentWorkspaceTarget(){if(this.currentAsset)return S.record('asset',this.currentAsset.id,this.currentAsset.name,[this.currentAsset.code,this.currentAsset.id].filter(Boolean).join(' · '),'box',[],{kind:'asset',id:this.currentAsset.id});if(this.currentPerson)return S.record('person',this.currentPerson.id,this.currentPerson.name,this.currentPerson.role||tr('ui.workspace.record_person'),'user',[],{kind:'person',id:this.currentPerson.id});if(this.route.name==='config')return S.record('section','config-'+this.route.section,this.configSectionLabel,tr('ui.workspace.record_config'),'sliders',[],{kind:'section',route:{name:'config',section:this.route.section}});return S.record('section',this.route.name,this.pageLabel||this.route.name,tr('ui.workspace.record_section'),'activity',[],{kind:'section',route:{name:this.route.name}});},
    workspaceLocations(){return this.sites.flatMap(s=>(s.locations||[]).map(l=>({...l,siteId:s.id,fullLabel:s.label+' · '+l.label})));},
    workspaceFilters(){void this.workspaceRevision;const child=childFor(this),name=this.route.name;if(name==='inventory')return {category:this.prefs.category,site:this.prefs.site,status:this.workspaceInventory.status,location:this.workspaceInventory.location,search:this.prefs.search};if(name==='map'||name==='graph')return {category:this.explorerFilters.categories[0]||'all',site:this.explorerFilters.sites[0]||'all',status:this.explorerFilters.states[0]||'all',location:this.explorerFilters.locations?.[0]||'all',search:this.explorerFilters.search};if(child?.filters)return {category:child.filters.category||'all',site:child.filters.site||'all',status:child.filters.status||'all',location:child.filters.location||'all',search:child.filters.search||''};return {category:'all',site:'all',status:'all',location:'all',search:''};},
    workspaceChips(){const f=this.workspaceFilters,rows=[],multi=['map','graph'].includes(this.route.name),add=(kind,id,label)=>{if(id&&id!=='all')rows.push({kind,id,label});};if(multi){this.explorerFilters.categories.forEach(id=>add('category',id,this.categoryLabel(id)));this.explorerFilters.sites.forEach(id=>add('site',id,this.siteLabel(id)));this.explorerFilters.states.forEach(id=>add('status',id,statusOf(this,id)));(this.explorerFilters.locations||[]).forEach(id=>add('location',id,this.workspaceLocations.find(l=>l.id===id)?.label||id));}else{add('category',f.category,this.categoryLabel(f.category));add('site',f.site,this.siteLabel(f.site));add('status',f.status,statusOf(this,f.status));add('location',f.location,this.workspaceLocations.find(l=>l.id===f.location)?.label||f.location);}if(f.search)add('search',f.search,tr('ui.workspace.search_chip',{term:f.search}));return rows;},
    // Inventory renders the canonical server filters, which do not include the
    // restored workspace status/location. Keep those visible and clearable here
    // instead of letting them narrow filteredAssets and the export invisibly.
    workspaceInventoryChips(){
      if(!this.route||this.route.name!=='inventory')return[];
      const inventory=this.workspaceInventory||{},locations=this.workspaceLocations||[],rows=this.inventoryItems||[],statuses=this.inventoryStatusChoices||[],out=[];
      const add=(kind,id,label)=>{const value=String(id||'');if(value&&value!=='all')out.push({kind,id:value,label});};
      const locationLabel=(id)=>locations.find(l=>l.id===id)?.label||rows.find(a=>a&&a.locationId===id&&a.location)?.location||(this.organization?.locations?.items||[]).find(l=>l.id===id)?.name||id;
      const statusLabel=(id)=>id?statuses.find(s=>s.value===id)?.label||statusOf(this,id):'';
      const filters=this.serverInventory?this.inventoryFilters||null:null;
      // The legacy status field never filters the server list, so painting it as a chip
      // would describe a filter that is not applied. The canonical state wins instead,
      // and removing the chip clears both so no hidden value survives the removal.
      if(!filters)add('status',inventory.status,statusLabel(inventory.status));
      add('location',inventory.location,locationLabel(inventory.location));
      if(filters){
        const query=String(filters.query||'').trim();
        if(query)out.push({kind:'search',id:query,label:query});
        const category=String(filters.category||'all');
        if(category!=='all')out.push({kind:'category',id:category,label:this.inventoryCategoryText(category)});
        const status=String(filters.status||'all');
        if(status!=='all')out.push({kind:'status',id:status,label:statusLabel(status)});
      }
      const seen=new Set();
      return out.filter(chip=>{const key=chip.kind+':'+chip.id;if(seen.has(key))return false;seen.add(key);return true;});
    }
  };
  const methods={
    openUniversalSearch(){if(!this.authenticated)return;this.universalOpen=true;this.userMenuOpen=false;this.mobileNavOpen=false;},
    toggleWorkspaceFavorite(record){if(!record||!this.workspaceUserId)return;const user=W.user(this.workspaceState,this.workspaceUserId);const before=user.favorites.slice();const added=W.toggleFavorite(this.workspaceState,this.workspaceUserId,record);this.showToast(tr(added?'ui.workspace.favorite_added':'ui.workspace.favorite_removed'));const patch={favorites:user.favorites.slice()};const save=this.patchWorkspaceState?this.patchWorkspaceState(patch):window.AssetPhase10Api.patchState(this,patch);return Promise.resolve(save).then(result=>{if(result&&result.ok===false){user.favorites=before;this.showToast(result.error||tr('ui.workspace.favorites_save_failed'));}return result;}).catch(()=>{user.favorites=before;this.showToast(tr('ui.workspace.favorites_save_failed'));return null;});},
    workspaceViewRecord(view){return S.record('view',view.id,view.name,tr(view.scope==='shared'?'ui.workspace.shared_view':'ui.workspace.personal_view'),'table',[],{kind:'view',id:view.id});},
    captureWorkspaceView(){if(this.route.name==='inventory')return {prefs:{category:this.prefs.category,site:this.prefs.site,search:this.prefs.search,view:this.prefs.view,sort:this.prefs.sort},inventory:W.clone(this.workspaceInventory),selection:this.bulk.ids.slice(),filters:{query:String((this.inventoryFilters||{}).query||''),category:String((this.inventoryFilters||{}).category||'all'),status:String((this.inventoryFilters||{}).status||'all')}};const child=childFor(this);return child?snapshotChild(child):{filters:W.clone(this.explorerFilters),selectedId:this.explorerSelection};},
    rememberWorkspaceInventory(){const snapshot=this.captureWorkspaceView();W.rememberView(this.workspaceState,this.workspaceUserId,'inventory',snapshot);const save=this.patchWorkspaceState?this.patchWorkspaceState({lastViews:{inventory:snapshot}}):window.AssetPhase10Api.patchState(this,{lastViews:{inventory:snapshot}});Promise.resolve(save).catch(()=>null);},
    saveWorkspaceView(draft){const body={...draft,route:this.route.name,snapshot:this.captureWorkspaceView()};const save=this.saveWorkspaceViewServer?this.saveWorkspaceViewServer(body):window.AssetPhase10Api.saveView(this,body);return Promise.resolve(save).then(result=>{if(result&&result.ok){const key='view:'+result.view.id;Object.values(this.workspaceState.users).forEach(u=>{u.favorites=u.favorites.map(f=>f.key===key?this.workspaceViewRecord(result.view):f);});this.showToast(tr(draft.id?'ui.workspace.view_updated':'ui.workspace.view_saved'));}else if(result)this.showToast(result.error||tr('ui.workspace.error_save'));return result;}).catch(()=>{this.showToast(tr('ui.workspace.error_save'));return {ok:false,error:tr('ui.workspace.error_save')};});},
    restoreWorkspaceView(view){if(!view||!routes.includes(view.route))return;const snapshot=restorableSnapshot(view.route,view.snapshot);if(this.route.name==='inventory')this.rememberWorkspaceInventory();if(view.route==='inventory'){Object.assign(this.prefs,snapshot.prefs||{});if(snapshot.inventory)this.workspaceInventory=W.clone(snapshot.inventory);this.bulk.ids=(snapshot.selection||[]).filter(id=>this.assets.some(a=>a.id===id));if(this.serverInventory&&this.inventoryFilters){const f=this.inventoryFilters,saved=snapshot.filters||null;if(saved){f.query=String(saved.query||'');f.category=String(saved.category||'all');f.status=String(saved.status||'all');}else{f.query=String((snapshot.prefs&&snapshot.prefs.search)||'');const legacyStatus=snapshot.inventory&&snapshot.inventory.status;f.status=String(legacyStatus&&legacyStatus!=='all'?legacyStatus:'all');}this.inventory.offset=0;}}else{if(['map','graph'].includes(view.route)){const f=snapshot.filters||{};this.explorerFilters={categories:f.categories||[],sites:f.sites||[],states:f.states||[],locations:f.locations||[],search:f.search||''};this.explorerSelection=snapshot.selectedId||'';}if(this.route.name===view.route&&childFor(this)){const child=childFor(this);Object.assign(child,ownFields(snapshot,(viewFields[view.route]||[]).filter(k=>Object.hasOwn(child.$data||child,k))));}else this.workspacePending={route:view.route,snapshot};}W.rememberView(this.workspaceState,this.workspaceUserId,view.route,snapshot);const viewed={[view.route]:snapshot};const save=this.patchWorkspaceState?this.patchWorkspaceState({lastViews:viewed}):window.AssetPhase10Api.patchState(this,{lastViews:viewed});Promise.resolve(save).catch(()=>null);this.navigateWorkspace({name:view.route});this.showToast(tr('ui.workspace.view_restored',{name:view.name}));},
    removeWorkspaceView(view){if(!view)return Promise.resolve({ok:false});const remove=this.deleteWorkspaceViewServer?this.deleteWorkspaceViewServer(view.id):window.AssetPhase10Api.deleteView(this,view.id);return Promise.resolve(remove).then(result=>{this.showToast(result&&result.ok?tr('ui.workspace.view_deleted'):(result&&result.error)||tr('ui.workspace.error_delete'));return result;}).catch(()=>{this.showToast(tr('ui.workspace.error_delete'));return {ok:false};});},
    navigateWorkspace(route){const next=this.accessRoute?this.accessRoute(route):route;this.setHash(this.hashFor(next));},
    openWorkspaceTarget(record){if(!record)return;this.universalOpen=false;const u=W.user(this.workspaceState,this.workspaceUserId);u.usage[record.key]=(u.usage[record.key]||0)+1;const usageSave=this.patchWorkspaceState?this.patchWorkspaceState({usage:u.usage}):window.AssetPhase10Api.patchState(this,{usage:u.usage});Promise.resolve(usageSave).catch(()=>null);const t=record.target||{},asset=this.assets.find(a=>a.id===t.id);if(t.kind==='view'){this.restoreWorkspaceView(this.workspaceViews.find(v=>v.id===t.id));return;}if(t.kind==='asset'){this.navigateWorkspace({name:'detail',assetId:t.id});return;}if(t.kind==='person'){this.navigateWorkspace({name:'person',personId:t.id});return;}if(t.kind==='section'){this.navigateWorkspace(t.route);return;}if(t.kind==='site'||t.kind==='location'){this.explorerFilters={categories:[],sites:[t.siteId||t.id],states:[],locations:t.kind==='location'?[t.id]:[],search:''};this.explorerSelection='';const snapshot={filters:W.clone(this.explorerFilters),level:'geo',activeSiteId:t.siteId||t.id,activeFloorId:'',selectedId:'',selectedRoom:''};if(this.route.name==='map'&&childFor(this))Object.assign(childFor(this),snapshot);else this.workspacePending={route:'map',snapshot};this.navigateWorkspace({name:'map'});return;}if(t.kind==='incident'){this.navigateWorkspace({name:'incident',incidentId:t.id});return;}if(t.kind==='intervention'){if(!this.maintenanceEditable){this.navigateWorkspace({name:'maintenance'});return;}this.quickDialog={type:'intervention',assetId:'',interventionId:t.id};return;}if(t.kind==='plan'){this.workspaceMaintenanceId=t.id;this.navigateWorkspace({name:'maintenance'});return;}if(t.kind==='report'){this.documentContext={ids:[],category:'all',site:'all',search:'',templateId:t.id,workspaceFresh:true};this.workspacePending=null;delete u.lastViews.reports;const child=childFor(this);if(this.route.name==='reports'&&child){child.chooseTemplate(t.id);child.family=child.template.family;}this.navigateWorkspace({name:'reports'});return;}if(t.kind!=='action')return;const action=t.action;if(action==='create-asset'){this.openAssetCreate();return;}if(action==='intervention'||action==='incident'){if(this.maintenanceEditable)this.quickDialog={type:action,assetId:t.id||'',interventionId:''};return;}if(action.startsWith('remote-')){if(asset)this.openRemote(asset,action==='remote-anydesk'?'anydesk':'rmm');return;}if(action==='consult'){if(asset)this.navigateWorkspace({name:'detail',assetId:asset.id});return;}if(action==='map'||action==='graph'){if(asset)this.explorerSelection=asset.id;this.navigateWorkspace({name:action,focusId:asset?.id||''});return;}this.navigateWorkspace({name:action});},
    setWorkspaceFilter(key,value){const name=this.route.name,child=childFor(this),empty=value==='all'?'':value;if(name==='inventory'){if(key==='category'||key==='site')this.prefs[key]=value;else if(key==='search')this.prefs.search=value;else this.workspaceInventory[key]=value;}else if(name==='map'||name==='graph'){const field={category:'categories',site:'sites',status:'states',location:'locations'}[key];if(field)this.explorerFilters[field]=empty?[empty]:[];else this.explorerFilters.search=value;}else if(child?.filters)child.filters[key]=name==='panel'?empty:value;},
    removeWorkspaceFilter(chip){if(this.route.name==='inventory'&&this.serverInventory&&this.inventoryFilters&&['search','category','status'].includes(chip.kind)){const f=this.inventoryFilters;if(chip.kind==='search'){f.query='';if(this.prefs)this.prefs.search='';}else if(chip.kind==='category'){f.category='all';if(this.prefs)this.prefs.category='all';}else{f.status='all';if(this.workspaceInventory)this.workspaceInventory.status='all';}this.inventory.offset=0;return;}if(['map','graph'].includes(this.route.name)&&chip.kind!=='search'){const key={category:'categories',site:'sites',status:'states',location:'locations'}[chip.kind];this.explorerFilters[key]=this.explorerFilters[key].filter(id=>id!==chip.id);}else this.setWorkspaceFilter(chip.kind,chip.kind==='search'?'':'all');},
    resetWorkspaceFilters(){['category','site','status','location'].forEach(k=>this.setWorkspaceFilter(k,'all'));this.setWorkspaceFilter('search','');if(this.route&&this.route.name==='inventory'&&this.serverInventory&&this.inventoryFilters){const f=this.inventoryFilters;f.query='';f.category='all';f.status='all';this.inventory.offset=0;}},
    handleWorkspaceRoute(next,previous){this.universalOpen=false;if(previous?.name==='inventory'&&next.name!=='inventory'){const snapshot={prefs:{category:this.prefs.category,site:this.prefs.site,search:this.prefs.search,view:this.prefs.view,sort:this.prefs.sort},inventory:W.clone(this.workspaceInventory),selection:this.bulk.ids.slice(),filters:{query:String((this.inventoryFilters||{}).query||''),category:String((this.inventoryFilters||{}).category||'all'),status:String((this.inventoryFilters||{}).status||'all')}};W.rememberView(this.workspaceState,this.workspaceUserId,'inventory',snapshot);if(this.authenticated&&this.phase10RememberLastView)this.phase10RememberLastView('inventory',snapshot);}// Inventory state already lives on the root: keep explicit navigation filters intact.
}
  };
  window.AssetWorkspaceRuntime={computed,methods,wirePendingViews};
})();
