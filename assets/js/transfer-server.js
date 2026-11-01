/* Bind the incumbent transfer templates to the canonical server workflow. */
(function () {
  'use strict';
  const V = window.AssetTransferViews;
  const D = window.AssetTransferData;
  const I = V.TransferImport;
  const aliases = { quickCode: 'quick_code', assignee: 'responsible', assigneeId: 'responsible_person_id', siteId: 'site_id', locationId: 'location_id' };
  const field = key => key.startsWith('tech.') ? 'technical.' + key.slice(5) : (aliases[key] || key);
  // Copy from the ui.transfer.* catalog; ids, classifications and API fields
  // stay stable.
  const tr = (key, params) => (window.ItsmI18n ? window.ItsmI18n.t(key, params) : '');
  // El servidor devuelve los perfiles predeterminados con su id estable y sin
  // marca de clase; los propios llevan `options.kind` cuando no son de importación.
  const BUILTIN_PROFILES = ['csv-standard', 'csv-spanish', 'xlsx-sites'];
  function profileKind(profile) { return profile && profile.options && profile.options.kind === 'export' ? 'export' : 'import'; }
  function serverProfiles(app, kind) {
    const page = app && app.phase6 && app.phase6.profiles ? app.phase6.profiles.items : null;
    return (Array.isArray(page) ? page : [])
      .filter(profile => !kind || profileKind(profile) === kind)
      .map(profile => Object.assign({}, profile, { builtin: BUILTIN_PROFILES.indexOf(profile.id) !== -1, description: profile.description || '' }));
  }
  function rows(view) {
    return view.app.phase6.operation.rows.map(r => {
      const values = r.values || {};
      const listed = Array.isArray(view.app.inventoryItems) ? view.app.inventoryItems : [];
      const target = listed.concat(Array.isArray(view.app.assets) ? view.app.assets : []).find(a => a.id === r.assetId) || {};
      const comparison = Object.keys(values).map(key => ({key,label:key,current:target[key],imported:values[key],filled:true,changed:target[key] !== values[key]}));
      return Object.assign({}, r, {key:String(r.index),rowNumber:r.line,sheetName:r.sheet,display:values,data:values,
        state:r.classification === 'possible_duplicate' ? 'conflict' : r.classification === 'safe' ? 'update' : r.classification === 'error' ? 'error' : 'new',
        primaryCandidateId:r.assetId || (r.candidates || [])[0] || '',defaultAction:r.classification === 'possible_duplicate' || r.classification === 'error' ? '' : r.action,
        comparison,comparisons:{},changes:comparison.filter(c=>c.changed),warnings:[],reasons:r.classification==='possible_duplicate'?[tr('ui.transfer.toast.import_conflict_decision')]:[]});
    });
  }
  I.data = function () { return {prefs:{confirmUpdates:true},step:1,source:null,sourceMeta:null,fileId:'',sheets:{},mapping:{},sheetSite:{},sheetCategory:{},identification:['serial','ip'],rules:{flagIncomplete:true},profileId:'',decisions:{},applied:null,historyTick:0,applying:false,progress:0,progressLabel:'',filter:'all',page:0,expanded:'',expandedUpdate:'',compareTarget:{},confirmOpen:false,profilesOpen:false,error:''}; };
  I.created = function () { this.app.loadImportProfiles(); };
  I.beforeUnmount = function () { this.app.stopPhase6Polling(); };
  Object.assign(I.computed, {
    files() { return this.sourceMeta ? [this.sourceMeta] : []; },
    file() { return this.sourceMeta; },
    activeProfile() { return serverProfiles(this.app, 'import').find(p=>p.id===this.profileId)||null; },
    profileOptions() { return serverProfiles(this.app, 'import'); },
    targets() { return D.TARGETS.filter(t=>!['warrantyUntil','warrantyProvider','anydeskId','rmmAgentId'].includes(t.key)).concat([{key:'id',get label(){return tr('ui.transfer.field.id');},get group(){return tr('ui.transfer.group.identification');}}]); },
    targetGroups() { return [...new Set(this.targets.map(t=>t.group))]; },
    identificationFields() { return D.IDENTIFICATION_FIELDS.filter(f=>['serial','ip'].includes(f.key)); },
    analysis() { return {rows:rows(this)}; },
    history() { return []; },
    canContinue() { if(this.applying)return false;if(this.step===1)return this.selectedSheets.length>0;if(this.step===2)return !!this.source;if(this.step===4)return this.rows.every(r=>r.classification!=='possible_duplicate'&&r.classification!=='error');return true; }
  });
  Object.assign(I.methods, {
    targetsByGroup(group) { return this.targets.filter(t=>t.group===group); },
    async chooseSource(event) {
      const file=event.target.files && event.target.files[0]; if(!file)return;
      this.error='';this.applying=true;
      try {
        const result=await this.app.inspectImportFile(file,{});if(!result.ok)return;
        this.source=file;this.sourceMeta={id:file.name,name:file.name,format:file.name.split('.').pop().toLowerCase(),origin:tr('ui.transfer.file.origin_selected'),size:D.formatBytes(file.size||0),sheets:result.sheets};
        this.fileId=file.name;this.sheets={};this.mapping={};this.sheetSite={};this.sheetCategory={};
        result.sheets.forEach(s=>{this.sheets[s.id]=true;this.mapping[s.id]=s.columns.map(c=>this.targets.some(t=>t.key===c)?c:(D.detectTarget(c)||''));});
        this.step=1;this.applied=null;
      } finally {this.applying=false;}
    },
    selectFile() {},
    importOptions() {
      const sheetMappings={},sheetSites={},sheetCategories={};
      this.selectedSheets.forEach(s=>{sheetMappings[s.name]={};s.columns.forEach((c,i)=>{sheetMappings[s.name][c]=field((this.mapping[s.id]||[])[i]||'');});if(this.sheetSite[s.id])sheetSites[s.name]=this.sheetSite[s.id];if(this.sheetCategory[s.id])sheetCategories[s.name]=this.sheetCategory[s.id];});
      return {selectedSheets:this.selectedSheets.map(s=>s.name),sheetMappings,sheetSites,sheetCategories,matchFields:this.identification};
    },
    async nextStep() {
      if(!this.canContinue)return;
      if(this.step===2){this.applying=true;try{const r=await this.app.analyzeImport(this.source,this.importOptions());if(!r.ok)return;}finally{this.applying=false;}}
      this.step=Math.min(5,this.step+1);
    },
    async setDecision(row,action) {
      if(action==='review')return;
      const id=this.compareTarget[row.key]||row.primaryCandidateId;
      const r=await this.app.resolvePhase6Row(row.index,action,action==='update'?{assetId:id}:{});
      if(r.ok)this.decisions={};
    },
    decisionFor(row) {return {action:row.defaultAction||'',targetId:row.assetId||row.primaryCandidateId};},
    async setCompareTarget(row,id) {this.compareTarget=Object.assign({},this.compareTarget,{[row.key]:id});},
    async bulkSkipUpdates() {for(const row of this.updates)await this.setDecision(row,'skip');},
    async resolveAllConflicts() {this.app.showToast(tr('ui.transfer.toast.resolve_conflicts'));},
    changedLabels(row) {return row.changes.map(c=>c.label).join(', ');},
    openConfirm() {if(this.canEdit)this.confirmOpen=true;},
    async applyImport() {
      if(this.applying)return;this.confirmOpen=false;this.applying=true;
      try {
        const approved=await this.app.approvePhase6Operation();if(!approved.ok)return;
        const r=this.rows.length>100 ? await this.app.enqueuePhase6Operation() : await this.app.executePhase6Operation();
        if(!r.ok)return;
        if(this.app.phase6.operation.state!=='complete'){this.app.startPhase6Polling();this.progressLabel=tr('ui.transfer.toast.job_progress',{id:this.app.phase6.operation.jobId});return;}
        this.finishServerImport();
      }finally{this.applying=false;}
    },
    finishServerImport() {
      const op=this.app.phase6.operation;const result={created:[],updated:[],skipped:[],pending:[]};
      this.rows.forEach(row=>{const item={assetId:row.createdAssetId||row.assetId,row,name:row.display.name,changes:row.changes};const key=row.result==='created'?'created':row.result==='modified'?'updated':row.result==='omitted'?'skipped':'pending';result[key].push(item);});
      const s=op.summary;this.applied={result,counts:{created:s.created,updated:s.modified,skipped:s.omitted,pending:s.failed},fileName:this.file.name,profile:this.activeProfile?this.activeProfile.name:tr('ui.transfer.profile_custom'),at:new Date().toISOString()};this.progress=100;
    },
    resetImport() {this.step=1;this.applied=null;this.app.stopPhase6Polling();},
    async saveProfile(name) {
      const options=Object.assign(this.importOptions(),{kind:'import'});
      const r=await this.app.saveImportProfile(name,options);
      if(r&&r.ok){this.profileId=this.app.phase6.profiles.items.find(p=>p.name===name)?.id||this.profileId;this.profilesOpen=false;}
      else this.app.showToast((r&&r.error)||tr('ui.transfer.toast.profile_save_failed'),'error');
    },
    applyProfile(profile) {const options=profile.options||{};this.profileId=profile.id;this.selectedSheets.forEach(s=>{const map=(options.sheetMappings||{})[s.name]||options.mapping||{};this.mapping[s.id]=s.columns.map(c=>{const k=map[c]||c;return this.targets.find(t=>field(t.key)===k)?.key||'';});});if(options.matchFields)this.identification=options.matchFields.slice();this.profilesOpen=false;}
  });
  I.watch['app.phase6.operation.state']=function(state){if(state==='complete'&&this.source)this.finishServerImport();};
  I.template=I.template.replace("<p class=\"tx-label\">{{ $t('ui.transfer.source_file') }}</p>","<p class=\"tx-label\">{{ $t('ui.transfer.source_file') }}</p><div class=\"field\"><label for=\"tx-real-file\">{{ $t('ui.transfer.select_file') }}</label><input id=\"tx-real-file\" type=\"file\" accept=\".xlsx,.csv\" :disabled=\"applying\" @change=\"chooseSource\"></div>")
    .replace("{{ $t('ui.transfer.demo_note') }}","{{ $t('ui.transfer.server_source_note') }}")
    .replace("{{ $t('ui.transfer.history_note_demo') }}","{{ $t('ui.transfer.history_note_server') }}")
    .replace('<transfer-profile-dialog :open="profilesOpen" kind="import"','<transfer-profile-dialog :app="app" :open="profilesOpen" kind="import"');
  const P=V.TransferProfileDialog;
  // transfer-export-views.js se evalúa antes que transfer-views.js, así que su
  // referencia local al diálogo quedó sin resolver y Vue lo renderizaba como
  // etiqueta nativa: la página Datos quedaba vacía. Aquí el diálogo ya existe,
  // así que se vuelve a enlazar el mismo componente en la exportación.
  V.TransferExport.components.TransferProfileDialog=P;
  P.props.app={type:Object,default:null};
  P.computed.profiles=function(){const kind=this.kind==='export'?'export':'import';return this.app?serverProfiles(this.app,kind):[];};
  // La ficha del perfil no guarda texto descriptivo: sus metadatos son los
  // criterios reales que el servidor aplica al importar o al exportar.
  // Los metadatos salen del perfil que se muestra, no de una propiedad propia
  // del diálogo: la lista pinta varios perfiles con esta misma función.
  P.methods.meta=function(profile){
    const options=profile&&profile.options&&typeof profile.options==='object'?profile.options:{};
    if(this.kind==='export'){
      const fields=Array.isArray(options.fields)?options.fields:[];
      return tr('ui.transfer.profile_meta.export',{count:fields.length});
    }
    const mappings=options.sheetMappings&&typeof options.sheetMappings==='object'?options.sheetMappings:null;
    let columns=0;
    if(mappings)columns=Object.keys(mappings).reduce((total,sheet)=>total+Object.keys(mappings[sheet]||{}).filter(column=>mappings[sheet][column]).length,0);
    else if(options.mapping&&typeof options.mapping==='object')columns=Object.keys(options.mapping).filter(column=>options.mapping[column]).length;
    const match=Array.isArray(options.matchFields)?options.matchFields.length:0;
    return tr('ui.transfer.profile_meta.columns',{count:columns})+' · '+(match?tr('ui.transfer.profile_meta.criteria',{count:match}):tr('ui.transfer.profile_meta.no_criteria'));
  };
  P.methods.remove=async function(profile){
    if(!this.app)return false;
    // Un perfil predeterminado es del servidor: el diálogo no intenta borrarlo.
    if(!profile||profile.builtin)return false;
    const result=await this.app.deleteImportProfile(profile.id);
    if(!result||result.ok!==true){this.app.showToast((result&&result.error)||tr('ui.transfer.toast.profile_delete_failed'),'error');return false;}
    this.app.showToast(tr('ui.transfer.toast.profile_deleted',{name:profile.name}));
    return true;
  };
  V.DataTransfer.computed.profileCount=function(){const page=this.app.phase6&&this.app.phase6.profiles;return page&&Array.isArray(page.items)?page.items.length:0;};
  V.DataTransfer.computed.customCount=function(){const page=this.app.phase6&&this.app.phase6.profiles;return page&&Array.isArray(page.items)?page.items.filter(p=>BUILTIN_PROFILES.indexOf(p.id)===-1).length:0;};
})();
