'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(entry='index.html'){
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const c=vm.createContext({console,Date,URL,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,location:{hash:'#/panel'},history:{replaceState(){}},navigator:{}});c.window=c;
 vm.runInContext(fs.readFileSync('assets/vendor/vue.global.prod.js','utf8'),c);
 vm.runInContext(fs.readFileSync('assets/vendor/vue-i18n.global.prod.js','utf8'),c);
 const catalog=tag=>JSON.parse(fs.readFileSync('assets/i18n/'+tag+'.json','utf8'));
 c.__ITSM_I18N_CATALOGS__={catalogs:{es:catalog('es'),en:catalog('en')},context:catalog('context')};
 c.fetch=async()=>({ok:false,status:404,headers:{get:()=>null},json:async()=>({})});
 const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[e]||String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1)))));
 c.document={createElement(){return {children:[],set innerHTML(v){this.textContent=decode(v);this.children=[{getAttribute:()=>decode((v.match(/foo="([\s\S]*)"/)||[])[1]||'')}];}};},title:''};
 const html=fs.readFileSync(entry,'utf8');
 for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)){
  if((src.includes('/vendor/')&&!src.includes('report-qrcode'))||/theme|sidebar|app\.js/.test(src))continue;
  if(src==='assets/js/panel.js'&&!c.AssetDashboardViews)for(const name of ['dashboard-model','dashboard-preferences','dashboard-charts','dashboard-views'])vm.runInContext(fs.readFileSync('assets/js/'+name+'.js','utf8'),c);
  vm.runInContext(fs.readFileSync(src,'utf8'),c,{filename:src});
 }
 c.ItsmI18n.primeBundle('es');
 const Vue=c.Vue;c.Vue={...Vue,createApp(o){c.options=o;return {mount(){}};}};vm.runInContext(fs.readFileSync('assets/js/app.js','utf8'),c);c.Vue=Vue;
 const app=Vue.reactive(c.options.data());app.currentUser={id:'admin'};app.can=()=>true;app.showToast=m=>{app.lastToast=m;};
 for(const [key,fn] of Object.entries(c.options.methods))app[key]=fn.bind(app);
 app.can=()=>true;app.showToast=m=>{app.lastToast=m;};app.setHash=h=>{app.lastHash=h;};
 for(const [key,fn] of Object.entries(c.options.computed))Object.defineProperty(app,key,{get:()=>fn.call(app),configurable:true});
 const errors=[];
 const host={createElement:tag=>({tag,tagName:tag.toUpperCase(),props:{},children:[],parent:null,addEventListener(){},removeEventListener(){},get options(){return this.children;},get value(){return this.props.value;},set value(v){this.props.value=v;},selected:false,multiple:false}),createText:text=>({tag:'#text',text,children:[]}),createComment:text=>({tag:'#comment',text,children:[]}),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},patchProp:(n,k,o,v)=>{n.props[k]=v;},insert(n,p,a){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}const i=a?p.children.indexOf(a):-1;if(i>=0)p.children.splice(i,0,n);else p.children.push(n);n.parent=p;},remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}},parentNode:n=>n.parent,nextSibling(n){return n.parent?n.parent.children[n.parent.children.indexOf(n)+1]||null:null;}};
 function mount(name,props={}){
  const source=c.options.components[name];assert.ok(source, name+' is registered');
  // Replace only DOM-only modal/transition infrastructure with transparent test components.
  function adapt(comp){if(!comp||typeof comp!=='object')return comp;const out={...comp,components:{...(comp.components||{})}};if(out.template)out.template=out.template.replace(/<transition name="fade">/g,'<template>').replace(/<\/transition>/g,'</template>');for(const [key,value] of Object.entries(out.components))out.components[key]=key==='ModalShell'?{props:['open'],template:'<div v-if="open"><slot></slot><slot name="footer"></slot></div>'}:adapt(value);return out;}
  const root={children:[]},r=Vue.createRenderer(host),a=r.createApp(adapt(source),{app,...props});if(c.ItsmI18n)a.use(c.ItsmI18n.i18n);a.config.errorHandler=e=>errors.push(e);const instance=a.mount(root);return {instance,root,unmount:()=>a.unmount()};
 }
 return {c,app,html,mount,errors,tick:Vue.nextTick};
}
test('the canonical HTML entry registers document routes, settings and asset/bulk entry actions',()=>{
 for(const file of ['index.html']){const s=setup(file);for(const name of ['ReportsCenter','WarrantyCenter','LabelsCenter','PublicAssetReport','AssetWarrantyPanel','AssetQrPanel','ReportSettings','WarrantySettings','QrSettings','LabelSettings'])assert.ok(s.c.options.components[name],name+' in '+file);
 for(const id of ['reportes','garantias','qr','etiquetas'])assert.ok(s.app.configSections.some(x=>x.id===id));
 for(const name of ['reports','warranties','labels','reportAsset']){const route={name,assetId:s.app.assets[0].id};s.c.location.hash=s.app.hashFor(route);assert.equal(s.app.parseRoute().name,name);}
 const bulk=JSON.stringify(s.app.bulk),prefs=JSON.stringify(s.app.prefs);s.app.openDocuments('reports',[s.app.assets[0].id]);assert.equal(s.app.lastHash,'#/reportes');assert.equal(s.app.documentContext.ids.length,1);assert.equal(JSON.stringify(s.app.bulk),bulk);assert.equal(JSON.stringify(s.app.prefs),prefs);
 assert.ok(s.html.includes('data-od-id="inventory-reports"'));assert.ok(s.html.includes('<asset-qr-panel'));assert.ok(s.html.includes('<asset-warranty-panel'));}
});
test('report preparation, block editing, saved reuse and canonical job requests work through Vue components',async()=>{
 const s=setup(),engine=s.c.AssetReportEngine;s.app.authenticated=true;s.app.activeUserId='admin';s.app.currentUser={id:'admin',active:true};
 const builtin=engine.normalizeTemplate({id:'inventory-list',builtin:true,name:'Inventario · listado',family:'inventory',mode:'list',format:'A4',fields:engine.familyFields('inventory'),version:1,blocks:[{id:'heading',type:'heading',label:'Encabezado',text:'Inventario'},{id:'table',type:'table',label:'Tabla'},{id:'footer',type:'footer',label:'Pie de página'}]});
 s.app.phase9.templates.items=[builtin];
 let savedRequest=null,jobRequest=null;
 s.app.phase9LoadTemplates=async()=>{s.app.phase9.templates.items=savedRequest?[builtin,engine.normalizeTemplate(savedRequest)]:[builtin];return true;};
 s.app.phase9LoadSelection=async()=>false;s.app.phase9LoadJobs=async()=>false;
 s.app.phase9SaveTemplate=async draft=>{savedRequest=draft;return {ok:true,template:{...draft}};};
 s.app.phase9CreateJob=async request=>{jobRequest=request;return {ok:true,job:{id:'job-1',status:'queued',total:2,processed:0,errors:[],documents:[],createdAt:''}};};
 const x=s.mount('ReportsCenter'),v=x.instance;await v.initialize();await s.tick();
 assert.equal(v.templateId,'inventory-list');assert.equal(v.draft.builtin,true);
 v.chooseFamily('history');v.filters.from='2000-01-01';v.filters.to='2000-12-31';v.filters.actor='Ana Canónica';const history=v.request('pdf');
 assert.equal(history.template.family,'history');assert.equal(history.filters.from,'2000-01-01');assert.equal(history.filters.actor,'Ana Canónica');
 v.chooseFamily('inventory');v.editor=true;v.draft.name='Ficha personalizada';v.addType='qr';v.addBlock();v.moveBlock(v.draft.blocks.length-1,-1);
 assert.deepEqual(Array.from(v.draft.blocks,block=>block.type),['heading','table','qr','footer']);
 await v.saveTemplate();
 assert.ok(savedRequest);assert.match(savedRequest.id,/^custom-/);assert.equal(savedRequest.builtin,false);assert.equal(savedRequest.name,'Ficha personalizada');
 assert.deepEqual(Array.from(savedRequest.blocks,block=>block.type),['heading','table','qr','footer']);
 assert.equal(v.notice,'Plantilla guardada.');assert.equal(v.templateId,savedRequest.id);assert.equal(v.draft.builtin,false);
 v.explicit=true;v.ids=[];await v.generate();assert.equal(v.error,'Selecciona al menos un activo.');assert.equal(jobRequest,null);
 v.ids=s.app.assets.slice(0,2).map(asset=>asset.id);v.composition='individual';v.group='category';await v.generate();
 assert.ok(jobRequest);assert.equal(jobRequest.mode,'individual');assert.equal(jobRequest.group,'category');assert.deepEqual(Array.from(jobRequest.assetIds),Array.from(v.ids));
 assert.equal(jobRequest.templateId,savedRequest.id);assert.equal(jobRequest.template,null);assert.equal(v.tab,'jobs');
 assert.deepEqual(s.errors,[]);x.unmount();
});
test('warranty and QR panels, label editing and public/private projections use authorized server data',async()=>{
 const s=setup();const asset=s.app.assets[0];s.app.authenticated=true;s.app.activeUserId='admin';s.app.currentUser={id:'admin',active:true};
 s.app.phase9LoadSettings=async()=>false;s.app.phase9LoadSelection=async()=>false;s.app.phase9LoadJobs=async()=>false;
 s.app.phase9LoadQr=async id=>{s.app.phase9.qr.assetId=asset.id;s.app.phase9.qr.url='https://activos.example/#/reporte/'+encodeURIComponent(id);s.app.phase9.qr.svg='<svg></svg>';return true;};
 s.app.phase9LoadPrivateReport=async()=>{s.app.phase9.privateReport.asset={...asset};s.app.phase9.privateReport.fields=['id','name'];return true;};
 s.app.phase9LoadPublicReport=async()=>{s.app.phase9.publicReport.asset={id:asset.id,name:'Ficha pública',ip:'10.0.0.1'};s.app.phase9.publicReport.fields=['name','id'];s.app.phase9.publicReport.loaded=true;return true;};
 for(const name of ['WarrantyCenter','WarrantySettings','QrSettings','LabelSettings','AssetWarrantyPanel','AssetQrPanel']){const m=s.mount(name,{asset});await s.tick();m.unmount();}
 const labels=s.mount('LabelsCenter'),lv=labels.instance;await s.tick();lv.explicit=true;lv.ids=s.app.assets.slice(0,2).map(a=>a.id);lv.label.fields=['name','id','qr'];
 let labelRequest=null;s.app.phase9CreateJob=async request=>{labelRequest=request;return {ok:true,job:{id:'labels-1',status:'queued',total:2,processed:0,errors:[],documents:[],createdAt:''}};};
 await lv.generate();
 assert.equal(lv.error,'');assert.ok(labelRequest);assert.deepEqual(Array.from(labelRequest.assetIds),Array.from(lv.ids));assert.deepEqual(Array.from(labelRequest.labels.fields),['name','id','qr']);
 assert.equal(Object.prototype.hasOwnProperty.call(labelRequest.labels,'rows'),false);assert.deepEqual(Array.from(labelRequest.fields),[]);assert.equal(lv.pages,1);labels.unmount();
 s.app.route={name:'reportAsset',assetId:asset.id,section:'publico',shareToken:'token-123'};
 const report=s.mount('PublicAssetReport');await s.tick();
 assert.equal(report.instance.publicMode,true);assert.deepEqual(Array.from(report.instance.fields,field=>field.key),['name','id']);assert.equal(report.instance.fields.some(field=>field.key==='ip'),false);report.unmount();
 s.app.route={name:'reportAsset',assetId:asset.id,section:null};
 const privateReport=s.mount('PublicAssetReport');await s.tick();
 assert.equal(privateReport.instance.publicMode,false);assert.deepEqual(Array.from(privateReport.instance.fields,field=>field.key),['id','name']);assert.match(privateReport.instance.privateQr.url,new RegExp(asset.id));privateReport.unmount();
 assert.deepEqual(s.errors,[]);
});
test('existing warranty normalization preserves extended metadata and legacy shapes',()=>{
 const s=setup();const E=s.c.AssetSchema;assert.deepEqual(JSON.parse(JSON.stringify(E.normalizeWarranty({until:'2027-01-01',provider:'P',note:'N'}))),{until:'2027-01-01',provider:'P',note:'N'});
 const extended=E.normalizeWarranty({until:'2027-01-01',provider:'P',purchase:'2026-01-01',months:12,receipts:[{name:'Factura.pdf',size:10,type:'application/pdf'}]});assert.equal(extended.purchase,'2026-01-01');assert.equal(extended.receipts[0].name,'Factura.pdf');
});
