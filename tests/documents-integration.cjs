'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(entry='index.html'){
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const c=vm.createContext({console,Date,URL,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,location:{hash:'#/panel'},history:{replaceState(){}},navigator:{}});c.window=c;
 vm.runInContext(fs.readFileSync('assets/vendor/vue.global.prod.js','utf8'),c);
 const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[e]||String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1)))));
 c.document={createElement(){return {children:[],set innerHTML(v){this.textContent=decode(v);this.children=[{getAttribute:()=>decode((v.match(/foo="([\s\S]*)"/)||[])[1]||'')}];}};},title:''};
 const html=fs.readFileSync(entry,'utf8');
 for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)){
  if((src.includes('/vendor/')&&!src.includes('report-qrcode'))||/theme|sidebar|app\.js/.test(src))continue;
  if(src==='assets/js/panel.js'&&!c.AssetDashboardViews)for(const name of ['dashboard-model','dashboard-preferences','dashboard-views'])vm.runInContext(fs.readFileSync('assets/js/'+name+'.js','utf8'),c);
  vm.runInContext(fs.readFileSync(src,'utf8'),c,{filename:src});
 }
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
  const root={children:[]},r=Vue.createRenderer(host),a=r.createApp(adapt(source),{app,...props});a.config.errorHandler=e=>errors.push(e);const instance=a.mount(root);return {instance,root,unmount:()=>a.unmount()};
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
test('report preparation, block editing, saved reuse and simulated generation work through Vue components',async()=>{
 const s=setup();const x=s.mount('ReportsCenter'),v=x.instance;assert.equal(v.selected.length,s.app.assets.length);
 v.filters.category=s.app.assets[0].category;await s.tick();assert.ok(v.selected.length>0);v.chooseFamily('history');v.from='2000-01-01';await s.tick();assert.ok(v.events.length>0);v.chooseFamily('inventory');v.editor=true;v.template.name='Ficha personalizada';v.addType='qr';v.addBlock();v.move(v.template.blocks.length-1,-1);v.save();await s.tick();assert.equal(v.saved,true);assert.ok(s.app.documents.templates.some(t=>t.name==='Ficha personalizada'));
 v.template.mode='individual';v.generate();await s.tick();assert.equal(v.generation.assets.length,v.selected.length);assert.equal(v.generation.pages,v.selected.length);
 for(const t of s.app.documents.templates.filter(t=>t.builtin)){v.family=t.family;v.chooseTemplate(t.id);await s.tick();}
 v.chooseFamily('inventory');v.template.mode='consolidated';v.templateId='inventory-list';v.group='category';v.generate();const saved=v.generation;v.filters.category='no-match';await s.tick();v.reopen(saved);await s.tick();assert.notEqual(v.filters.category,'all','recent document restores original category filter');assert.equal(v.group,'category');
 assert.deepEqual(s.errors,[]);x.unmount();
});
test('warranty and QR panels, label editing and public/private projections render without runtime errors',async()=>{
 const s=setup();const asset=s.app.assets[0];for(const name of ['WarrantyCenter','WarrantySettings','QrSettings','LabelSettings','AssetWarrantyPanel','AssetQrPanel']){const m=s.mount(name,{asset});await s.tick();m.unmount();}
 const labels=s.mount('LabelsCenter');labels.instance.explicit=true;labels.instance.ids=s.app.assets.slice(0,2).map(a=>a.id);labels.instance.fields=['name','id','qr'];labels.instance.generate();await s.tick();assert.equal(labels.instance.generated,true);assert.equal(labels.instance.selected.length,2);assert.ok(labels.instance.pages.length);labels.unmount();
 s.app.labelState.shared[asset.id]=true;s.app.labelState.publicFields=['name','id'];const report=s.mount('PublicAssetReport',{asset});report.instance.mode='public';await s.tick();assert.deepEqual(Array.from(report.instance.fields,f=>f.id),['name','id']);assert.equal(report.instance.allowed.ip,undefined);report.unmount();assert.deepEqual(s.errors,[]);
});
test('existing warranty normalization preserves extended metadata and legacy shapes',()=>{
 const s=setup();const E=s.c.AssetSchema;assert.deepEqual(JSON.parse(JSON.stringify(E.normalizeWarranty({until:'2027-01-01',provider:'P',note:'N'}))),{until:'2027-01-01',provider:'P',note:'N'});
 const extended=E.normalizeWarranty({until:'2027-01-01',provider:'P',purchase:'2026-01-01',months:12,receipts:[{name:'Factura.pdf',size:10,type:'application/pdf'}]});assert.equal(extended.purchase,'2026-01-01');assert.equal(extended.receipts[0].name,'Factura.pdf');
});
