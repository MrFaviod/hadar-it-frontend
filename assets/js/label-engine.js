(function () {
  'use strict';
  const KEY='asset-manager.label-settings';
  const PUBLIC_FIELDS=[{id:'name',label:'Nombre'},{id:'id',label:'ID permanente'},{id:'code',label:'Código rápido'},{id:'type',label:'Tipo de equipo'},{id:'brand',label:'Marca'},{id:'model',label:'Modelo'},{id:'status',label:'Estado'}];
  const LABEL_FIELDS=[{id:'logo',label:'Logotipo'},{id:'name',label:'Identificación del activo'},{id:'id',label:'ID permanente'},{id:'code',label:'Código rápido actual'},{id:'qr',label:'Código QR'},{id:'site',label:'Sede'},{id:'location',label:'Ubicación'},{id:'serial',label:'Número de serie'}];
  const FORMATS=[{id:'a4-24',name:'A4 · 24 etiquetas',description:'70 × 37 mm · 3 columnas × 8 filas',width:70,height:37,columns:3,rows:8,sheet:'A4'},
    {id:'a4-21',name:'A4 · 21 etiquetas',description:'63,5 × 38,1 mm · 3 columnas × 7 filas',width:63.5,height:38.1,columns:3,rows:7,sheet:'A4'},
    {id:'adhesive-50',name:'Adhesiva · 50 × 30 mm',description:'Rollo · una etiqueta por página',width:50,height:30,columns:1,rows:1,sheet:'Rollo'},
    {id:'adhesive-80',name:'Adhesiva · 80 × 50 mm',description:'Rollo · una etiqueta por página',width:80,height:50,columns:1,rows:1,sheet:'Rollo'}];
  function createState(){const s=window.AssetStore.readJSON(window.localStorage,KEY,{});return {baseUrl:typeof s.baseUrl==='string'?s.baseUrl:'https://activos.organizacion.local/',access:s.access==='public'?'public':'private',publicFields:Array.isArray(s.publicFields)?s.publicFields.filter(f=>PUBLIC_FIELDS.some(p=>p.id===f)):['name','id','type','model','status'],fields:Array.isArray(s.fields)?s.fields.filter(f=>LABEL_FIELDS.some(p=>p.id===f)):['logo','name','id','code','qr'],format:FORMATS.some(f=>f.id===s.format)?s.format:'a4-24',templates:Array.isArray(s.templates)?s.templates:[],shared:s.shared&&typeof s.shared==='object'?s.shared:{}};}
  function persist(state){return window.AssetStore.writeJSON(window.localStorage,KEY,state);}
  function saveSettings(state,draft){
    let url;try{url=new URL(draft.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||draft.baseUrl.length>400)throw Error();}catch(e){return {ok:false,error:'Introduce una URL base HTTP o HTTPS válida, de hasta 400 caracteres.'};}
    url.hash='';url.search='';url.pathname=url.pathname.replace(/\/?$/,'/');
    state.baseUrl=url.href;if(draft.access)state.access=draft.access==='public'?'public':'private';
    if(Array.isArray(draft.publicFields))state.publicFields=draft.publicFields.filter(id=>PUBLIC_FIELDS.some(f=>f.id===id));persist(state);return {ok:true};
  }
  function assetUrl(state,asset){return state.baseUrl.replace(/\/?$/,'/')+'#/reporte/'+encodeURIComponent(asset.id);}
  function sharedUrl(state,asset){return assetUrl(state,asset)+'/publico';}
  function publicRecord(asset,fields){return (fields||[]).reduce((out,id)=>{if(PUBLIC_FIELDS.some(f=>f.id===id)&&asset[id]!==undefined)out[id]=asset[id];return out;},{});}
  function paginate(assets,format,offset){const size=Math.max(1,format.columns*format.rows);const all=Array(Math.max(0,Math.min(size-1,Number(offset)||0))).fill(null).concat(assets);const pages=[];for(let i=0;i<all.length;i+=size)pages.push(all.slice(i,i+size));return pages;}
  function qrMatrix(text){const qr=window.qrcode(0,'M');qr.addData(text,'Byte');qr.make();return Array.from({length:qr.getModuleCount()},(_,r)=>Array.from({length:qr.getModuleCount()},(_,c)=>qr.isDark(r,c)));}
  function qrPath(matrix){let path='';matrix.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)path+='M'+(c+4)+' '+(r+4)+'h1v1h-1z';}));return path;}
  window.AssetLabelEngine={createState,persist,saveSettings,assetUrl,sharedUrl,publicRecord,paginate,qrMatrix,qrPath,PUBLIC_FIELDS,LABEL_FIELDS,FORMATS};
})();
