(function () {
  'use strict';
  const KEY = 'asset-manager.documents';
  const clone = value => JSON.parse(JSON.stringify(value));
  const FIELDS = [
    {id:'id',label:'ID permanente'},{id:'code',label:'Código rápido'},{id:'name',label:'Nombre'},
    {id:'category',label:'Categoría'},{id:'site',label:'Sede'},{id:'location',label:'Ubicación'},
    {id:'assignee',label:'Responsable'},{id:'status',label:'Estado'},{id:'model',label:'Modelo'},
    {id:'serial',label:'Número de serie'},{id:'ip',label:'Dirección IP'}
  ];
  const BLOCKS = [
    {type:'heading',label:'Encabezado',icon:'file-text'}, {type:'text',label:'Texto',icon:'pencil'},
    {type:'asset',label:'Información del activo',icon:'box'}, {type:'table',label:'Tabla y listado',icon:'table'},
    {type:'photo',label:'Fotografías',icon:'camera'}, {type:'summary',label:'Gráfico y resumen',icon:'activity'},
    {type:'qr',label:'Código QR',icon:'grid'}, {type:'footer',label:'Pie de página',icon:'minus'}
  ];
  function block(type, index) { const meta=BLOCKS.find(b=>b.type===type);return {id:type+'-'+index,type,label:meta.label,text:type==='text'?'Registro de activos para consulta y seguimiento.':'',enabled:true}; }
  function defaults() {
    return [
      {id:'inventory-list',name:'Inventario consolidado',description:'Listado de equipos, cantidades y distribución.',family:'inventory',mode:'consolidated',format:'A4 horizontal',fields:['id','name','site','assignee','status'],logo:true,images:false,blocks:['heading','summary','table','footer'].map(block),builtin:true},
      {id:'asset-card',name:'Ficha técnica del activo',description:'Identificación, fotografía y especificaciones.',family:'inventory',mode:'individual',format:'A4 vertical',fields:['id','code','name','site','location','assignee','model','serial'],logo:true,images:true,blocks:['heading','photo','asset','qr','footer'].map(block),builtin:true},
      {id:'history-log',name:'Cambios e historial',description:'Trazabilidad de movimientos y acontecimientos.',family:'history',mode:'consolidated',format:'A4 vertical',fields:['id','name','site'],logo:true,images:false,blocks:['heading','table','footer'].map(block),builtin:true},
      {id:'warranty-list',name:'Vencimientos de garantías',description:'Proveedores, cobertura y comprobantes por activo.',family:'warranty',mode:'consolidated',format:'A4 horizontal',fields:['id','name','site'],logo:true,images:false,blocks:['heading','summary','table','footer'].map(block),builtin:true}
    ];
  }
  function createState() {
    const saved=window.AssetStore.readJSON(window.localStorage,KEY,{});
    const customs=Array.isArray(saved.templates)?saved.templates.filter(t=>t&&!t.builtin&&t.name&&Array.isArray(t.blocks)):[];
    return {templates:defaults().concat(customs),history:Array.isArray(saved.history)?saved.history:[],counter:Number(saved.counter)||0};
  }
  function persist(state) { return window.AssetStore.writeJSON(window.localStorage,KEY,state); }
  function selectAssets(assets,filters) {
    const f=filters||{}, ids=Array.isArray(f.ids)?new Set(f.ids):null;
    const term=String(f.search||'').trim().toLocaleLowerCase('es');
    return assets.filter(a=>(!ids||ids.has(a.id)) && (!f.category||f.category==='all'||a.category===f.category)
      && (!f.site||f.site==='all'||a.site===f.site) && (!f.responsible||f.responsible==='all'||a.assigneeId===f.responsible)
      && (!f.status||f.status==='all'||a.statusId===f.status)
      && (!f.location||f.location==='all'||a.locationId===f.location)
      && (!term||[a.id,a.code,a.name,a.model,a.assignee].join(' ').toLocaleLowerCase('es').includes(term)));
  }
  function groupAssets(assets,by) {
    const groups=new Map();
    assets.forEach(a=>{ const key=by==='none'?'Todos los activos':String(a[by]||'Sin especificar'); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a); });
    return Array.from(groups,([key,items])=>({key,assets:items,count:items.length}));
  }
  function historyRows(assets,filters) {
    const f=filters||{};
    return assets.flatMap(a=>(a.history||[]).map(h=>Object.assign({},h,{assetId:a.id,assetName:a.name})))
      .filter(h=>(!f.from||String(h.at).slice(0,10)>=f.from)&&(!f.to||String(h.at).slice(0,10)<=f.to)&&(!f.event||f.event==='all'||(f.event==='updated'?['updated','bulk'].includes(h.kind):f.event==='transfer'?['transfer','returned'].includes(h.kind):h.kind===f.event)))
      .sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  }
  function saveTemplate(state,template) {
    if(!template||!String(template.name||'').trim())return {ok:false,error:'Escribe un nombre para la plantilla.'};
    if(!Array.isArray(template.blocks)||!template.blocks.some(b=>b.enabled!==false))return {ok:false,error:'Incluye al menos un bloque visible.'};
    if(template.blocks.some(b=>!BLOCKS.some(meta=>meta.type===b.type)))return {ok:false,error:'El bloque no es compatible.'};
    const copy=clone(template);copy.name=copy.name.trim();copy.builtin=false;
    if(!copy.id||state.templates.some(t=>t.id===copy.id&&t.builtin))copy.id='custom-'+Date.now()+'-'+(state.templates.length+1);
    const i=state.templates.findIndex(t=>t.id===copy.id);if(i<0)state.templates.push(copy);else state.templates.splice(i,1,copy);
    persist(state);return {ok:true,template:copy};
  }
  function generate(state,assets,options) {
    if(!assets.length)return {ok:false,error:'Selecciona al menos un activo.'};
    const o=options||{};state.counter+=1;
    const document={id:'DOC-'+String(state.counter).padStart(4,'0'),name:o.name||'Reporte de activos',family:o.family||'inventory',format:o.format||'PDF',mode:o.mode||'consolidated',assets:assets.map(a=>a.id),pages:o.mode==='individual'?assets.length:Math.max(1,Math.ceil((o.family==='history'?(o.rows??0):assets.length)/18)),at:new Date().toISOString(),status:'Preparado',context:o.context?clone(o.context):null};
    state.history.unshift(document);state.history=state.history.slice(0,40);persist(state);return {ok:true,document};
  }
  window.AssetReportEngine={FIELDS,BLOCKS,defaults,createState,persist,selectAssets,groupAssets,historyRows,saveTemplate,generate,clone,block};
})();
