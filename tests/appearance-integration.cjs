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
test('S1/S8 the canonical entry registers Appearance and preserve existing routes',()=>{
 for(const entry of ['index.html']){const s=setup(entry);assert.ok(s.c.options.components.AppearanceSettings);assert.ok(s.app.configSections.some(x=>x.id==='apariencia'));s.c.location.hash='#/configuracion/apariencia';assert.equal(s.app.parseRoute().section,'apariencia');assert.equal(s.app.hashFor({name:'config',section:'apariencia'}),'#/configuracion/apariencia');for(const route of ['panel','inventory','reports','warranties','labels']){s.c.location.hash=s.app.hashFor({name:route});assert.equal(s.app.parseRoute().name,route);}}
});
test('S1/S2/S3/S7 draft edits preview but apply synchronizes identity and discard restores draft',async()=>{
 const s=setup(),m=s.mount('AppearanceSettings'),v=m.instance,original=s.app.appName;
 v.select(s.app.appearance.presets[1]);v.draft.branding.appName='Inventario de prueba';await s.tick();assert.equal(s.app.appName,original);assert.ok(v.dirty);v.apply();await s.tick();assert.equal(s.app.appName,'Inventario de prueba');assert.equal(s.app.config.general.appName,'Inventario de prueba');v.draft.branding.appName='Sin aplicar';v.discard();assert.equal(v.draft.branding.appName,'Inventario de prueba');v.setMode('dark');assert.equal(s.app.themeMode,'dark');assert.equal(s.c.AssetAppearanceEngine.getUserMode(s.app.appearance,'admin'),'dark');v.restore();await s.tick();assert.equal(s.app.appName,'Asset Manager');assert.equal(v.draft.id,'generic');assert.deepEqual(s.errors,[]);m.unmount();
});
test('S3/S5 importing stages a preset and resolves name conflicts without applying',async()=>{
 const s=setup(),m=s.mount('AppearanceSettings'),v=m.instance,before=JSON.stringify(s.app.appearance.active),n=s.app.appearance.presets.length;
 v.imported({preset:s.c.AssetAppearanceEngine.clone(s.app.appearance.presets[1]),policy:'both'});await s.tick();assert.equal(s.app.appearance.presets.length,n+1);assert.equal(JSON.stringify(s.app.appearance.active),before);assert.ok(v.dirty);v.duplicate();assert.equal(s.app.appearance.presets.length,n+2);v.apply();assert.equal(s.app.appearance.active.id,v.draft.id);assert.deepEqual(s.errors,[]);m.unmount();
});

test('S1/S2 runtime applies branding, favicon, dark logo and isolates user mode changes',()=>{
 const s=setup(),a=s.app,props=new Map(),icon={},meta={},root={dataset:{},style:{setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k)}};
 s.c.document.documentElement=root;s.c.document.querySelector=q=>q.includes('icon')?icon:meta;meta.setAttribute=(k,v)=>{meta[k]=v;};
 let mode='light',pref='light';s.c.AssetTheme={getResolved:()=>mode,getPreference:()=>pref,set:m=>{pref=m;mode=m==='system'?'light':m;}};
 a.activeUserId='ana';const p=s.c.AssetAppearanceEngine.clone(a.appearance.presets[1]);p.branding.logoDark='data:image/png;base64,AA==';p.branding.logoCompact='data:image/png;base64,AQ==';a.applyAppearance(p);assert.equal(root.dataset.branding,'custom');assert.equal(icon.href,p.branding.favicon);assert.equal(props.get('--brand-button'),p.colors.light.secondary);assert.equal(a.brandCompactLogo,p.branding.logoCompact);
 a.setAppearanceMode('dark');assert.equal(a.brandLogo,p.branding.logoDark);a.activeUserId='luis';a.changeAppearanceUser();assert.equal(a.themeMode,'system');a.activeUserId='ana';a.changeAppearanceUser();assert.equal(a.themeMode,'dark');
 pref='system';mode='light';a.handleThemeChange({detail:{preference:'system',resolved:'light'}});assert.equal(a.brandLogo,p.branding.logo);mode='dark';a.handleThemeChange({detail:{preference:'system',resolved:'dark'}});assert.equal(a.brandLogo,p.branding.logoDark);
 a.applyAppearance(a.appearance.presets[0]);assert.equal(root.dataset.branding,'generic');assert.equal(props.size,0);
});
test('S5/S6 package dialog stages comparison, reports errors, and downloads a real portable ZIP',async()=>{
 const s=setup();s.c.options.components.AppearancePackageDialog=s.c.AssetAppearanceViews.AppearancePackageDialog;
 const p=s.c.AssetAppearanceEngine.clone(s.app.appearance.presets[1]);p.branding.logo='data:image/svg+xml;base64,PHN2Zy8+';p.branding.favicon=p.branding.logo;const bytes=await s.c.AssetAppearancePackage.encode(p),before=JSON.stringify(s.app.appearance.active);
 const m=s.mount('AppearancePackageDialog',{open:true,kind:'import',presets:s.app.appearance.presets,active:s.app.appearance.active,current:s.app.appearance.active}),v=m.instance;
 await v.read({name:'broken.zip',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3])});assert.match(v.error,/ZIP/);assert.equal(v.detected,null);await v.read({name:'preset.zip',size:bytes.length,arrayBuffer:async()=>bytes});await s.tick();assert.equal(v.detected.preset.name,p.name);assert.equal(v.collision.id,'blue');assert.equal(JSON.stringify(s.app.appearance.active),before);assert.equal(s.errors.length,0);
 let downloaded,blob,revoked=false;s.c.URL={createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL:()=>{revoked=true;}};s.c.setTimeout=fn=>fn();s.c.document.createElement=()=>({click(){downloaded={href:this.href,name:this.download};}});s.c.fetch=async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode('<svg/>').buffer,headers:{get:()=> 'image/svg+xml'}});
 v.filename='mi-identidad';await v.download();assert.equal(v.error,'');assert.equal(downloaded.name,'mi-identidad.zip');assert.equal(downloaded.href,'blob:test');assert.ok(revoked);const result=await s.c.AssetAppearancePackage.decode(await blob.arrayBuffer());assert.equal(result.preset.name,s.app.appearance.active.name);assert.ok(v.prepared);m.unmount();
});
