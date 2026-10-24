'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(entry='index.html'){
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const c=vm.createContext({console,Date,URL,URLSearchParams,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,AbortController,AbortSignal,localStorage:storage,sessionStorage:storage,location:{hash:'#/panel'},history:{replaceState(){}},navigator:{},addEventListener(){},removeEventListener(){},
 // Reduced motion by default keeps graph mounting deterministic: no animation
 // loop survives a test, and the layout settles synchronously.
 matchMedia:q=>({matches:true,media:String(q||''),addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}),
 requestAnimationFrame:fn=>setTimeout(()=>fn(Date.now()),0),cancelAnimationFrame:id=>clearTimeout(id),
 ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}});c.window=c;
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
 // The real root mixins (access data/computed and the integrated lifecycle
 // slice) are merged the way Vue merges them: mixin data/methods/computed are
 // installed on the instance, with root definitions winning. Tests therefore
 // exercise the lifecycle the shipped watcher calls (identity, route, clear)
 // instead of only the root's own options.
 const mixins=(c.options.mixins||[]).filter(mixin=>mixin&&typeof mixin==='object');
 const mixinData=Object.assign({},...mixins.map(mixin=>typeof mixin.data==='function'?mixin.data():{}));
 // Domain rendering tests use an explicit authorized fixture, never prototype login seeds.
 const app=Vue.reactive(Object.assign({},c.AssetAccess.data(),mixinData,c.options.data()));app.security.users=[{id:'domain-fixture',name:'Domain fixture',roleId:'fixture',active:true}];app.activeUserId='domain-fixture';app.authenticated=true;app.serverPermissions=c.AssetAccess.catalog.flatMap(group=>group.permissions.map(permission=>permission.id));app.can=()=>true;app.showToast=m=>{app.lastToast=m;};
 for(const mixin of mixins)for(const [key,fn] of Object.entries(mixin.methods||{}))app[key]=fn.bind(app);
 for(const [key,fn] of Object.entries(c.options.methods))app[key]=fn.bind(app);
 app.can=()=>true;app.showToast=m=>{app.lastToast=m;};app.setHash=h=>{app.lastHash=h;};
 const computed=Object.assign({},...mixins.map(mixin=>mixin.computed||{}),c.AssetAccess.computed,c.options.computed);
 for(const [key,fn] of Object.entries(computed))Object.defineProperty(app,key,{get:()=>fn.call(app),configurable:true});
 // Canonical HTTP fixture: the suites configure `server` and every read/write
 // goes through the same AssetPhase10Api transport the application uses.
 const server={calls:[],state:{widgets:null,favorites:[],usage:{},lastViews:{},themeMode:'auto',shortcuts:[],views:[]},summary:null,items:[],integrations:{anydeskEnabled:false,anydeskUrl:'',rmmEnabled:false,rmmUrl:''}};
 const clone=value=>value===undefined?value:JSON.parse(JSON.stringify(value));
 let shortcutSeq=0,viewSeq=0;
 const respond=(payload,status=200)=>({ok:status<400,status,json:async()=>clone(payload),blob:async()=>new Blob([])});
 // Canonical HTTP fixture lives at the real browser boundary (`fetch`) so the
 // shared AssetAccess.request transport, CSRF and byte handling stay intact.
 // Per-test `stubFetch(c, ...)` overrides keep replacing `c.fetch` as before.
 c.fetch=async(url,init={})=>{
  const target=String(url).replace(/^\/api\/v1/,''),method=init.method||'GET';
  let body=init.body;
  if(typeof body==='string'&&body){try{body=JSON.parse(body);}catch(_){/* raw bytes keep their shape */}}
  server.calls.push({url:target,method,body,rawBody:init.body});
  const [path,query='']=target.split('?'),params=new URLSearchParams(query);
  if(path==='/workspace/state'){if(method==='PUT')server.state={...server.state,...clone(body||{})};return respond(server.state);}
  if(path==='/workspace/integrations'){if(method==='PUT')server.integrations={...server.integrations,...clone(body||{})};return respond(server.integrations);}
  if(path==='/workspace/shortcuts'&&method==='POST'){const shortcut={id:'shortcut-'+(++shortcutSeq),scope:'personal',ownerId:app.currentUser.id,...clone(body||{})};server.state.shortcuts=server.state.shortcuts.concat(shortcut);return respond({shortcut:clone(shortcut)});}
  if(path.startsWith('/workspace/shortcuts/')){const id=decodeURIComponent(path.split('/').pop());if(method==='DELETE'){server.state.shortcuts=server.state.shortcuts.filter(item=>item.id!==id);return respond({id,deleted:true});}const shortcut={...server.state.shortcuts.find(item=>item.id===id),...clone(body||{})};server.state.shortcuts=server.state.shortcuts.map(item=>item.id===id?shortcut:item);return respond({shortcut:clone(shortcut)});}
  if(path==='/workspace/views'&&method==='POST'){const view={id:'view-'+(++viewSeq),ownerId:app.currentUser.id,scope:'personal',...clone(body||{})};server.state.views=server.state.views.concat(view);return respond({view:clone(view)});}
  if(path.startsWith('/workspace/views/')){const id=decodeURIComponent(path.split('/').pop());if(method==='DELETE'){server.state.views=server.state.views.filter(item=>item.id!==id);return respond({id,deleted:true});}const view={...server.state.views.find(item=>item.id===id),...clone(body||{})};server.state.views=server.state.views.map(item=>item.id===id?view:item);return respond({view:clone(view)});}
  if(path==='/dashboard')return respond({summary:clone(server.summary)});
  if(path==='/search'){const q=(params.get('q')||'').toLocaleLowerCase('es'),kind=params.get('kind')||'';const items=clone(server.items).filter(item=>{const hay=(item.label+' '+item.subtitle+' '+item.key).toLocaleLowerCase('es');const type=item.type||(item.target&&item.target.kind)||'';return (!q||hay.includes(q))&&(!kind||type===kind);});return respond({items,total:items.length,limit:Number(params.get('limit'))||20,offset:Number(params.get('offset'))||0,engine:'sql',fallback:false});}
  return respond({error:{code:'not_found'},details:[]},404);
 };
 const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await Vue.nextTick();await new Promise(resolve=>setTimeout(resolve,0));await Vue.nextTick();};
 const errors=[];
 const host={createElement:tag=>({tag,tagName:tag.toUpperCase(),props:{},children:[],parent:null,style:{},// Native listeners (including the v-model directives) are kept so a mounted
 // template can be driven through the same input/change events a browser sends.
 addEventListener(type,handler){(this.listeners||(this.listeners={}))[type]=handler;},removeEventListener(type){if(this.listeners)delete this.listeners[type];},get options(){return this.children;},get value(){return this.props.value;},set value(v){this.props.value=v;},selected:false,multiple:false,
 getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:960,bottom:560,width:960,height:560}),
 focus(){},blur(){},querySelector(){return null;},closest(){return null;}}),createText:text=>({tag:'#text',text,children:[]}),createComment:text=>({tag:'#comment',text,children:[]}),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},patchProp:(n,k,o,v)=>{n.props[k]=v;},insert(n,p,a){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}const i=a?p.children.indexOf(a):-1;if(i>=0)p.children.splice(i,0,n);else p.children.push(n);n.parent=p;},remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}},parentNode:n=>n.parent,nextSibling:n=>n.parent?n.parent.children[n.parent.children.indexOf(n)+1]||null:null};
 function mount(name,props={}){
  const source=c.options.components[name];assert.ok(source, name+' is registered');
  // Replace only DOM-only modal/transition infrastructure with transparent test components.
  function adapt(comp){if(!comp||typeof comp!=='object')return comp;const out={...comp,components:{...(comp.components||{})}};if(out.template)out.template=out.template.replace(/<transition name="fade">/g,'<template>').replace(/<\/transition>/g,'</template>');for(const [key,value] of Object.entries(out.components))out.components[key]=key==='ModalShell'?{props:['open'],template:'<div v-if="open"><slot></slot><slot name="footer"></slot></div>'}:adapt(value);return out;}
  const root={children:[]},r=Vue.createRenderer(host),a=r.createApp(adapt(source),{app,...props});a.config.errorHandler=e=>errors.push(e);const instance=a.mount(root);return {instance,root,unmount:()=>a.unmount()};
 }
 return {c,app,html,mount,errors,server,settle,tick:Vue.nextTick};
}

// Explicit canonical organization for authenticated suites. It seeds only the
// directory collections named here, so tree, relations, graph, map, types and
// history stay unloaded and the suites that do not call it still prove the
// no-fallback boundary. Nothing is copied from the prototype collections.
const canonicalIds={site:'5a1e0c10-0001-4f10-9a10-000000000001',building:'5a1e0c10-0002-4f10-9a10-000000000002',floor:'5a1e0c10-0003-4f10-9a10-000000000003',room:'5a1e0c10-0004-4f10-9a10-000000000004',person:'5a1e0c10-0005-4f10-9a10-000000000005',department:'5a1e0c10-0006-4f10-9a10-000000000006'};
function canonicalOrganization(app){
 const levels={site:'Sede',building:'Edificio',floor:'Piso',room_zone:'Sala o zona'};
 const location=(id,level,parentId,name)=>({id,level,parentId,name,description:'',latitude:null,longitude:null,planRef:'',planPage:'',active:true,levelLabel:levels[level]});
 const seed=(page,items)=>{page.items=items;page.total=items.length;page.loaded=true;page.loading=false;page.error='';};
 seed(app.organization.locations,[location(canonicalIds.site,'site',null,'Sede Canónica'),location(canonicalIds.building,'building',canonicalIds.site,'Edificio Canónico'),location(canonicalIds.floor,'floor',canonicalIds.building,'Piso Canónico'),location(canonicalIds.room,'room_zone',canonicalIds.floor,'Sala Canónica')]);
 seed(app.organization.people,[{id:canonicalIds.person,name:'Ana Canónica',label:'Ana Canónica (Analista)',role:'Analista',departmentId:canonicalIds.department,siteId:canonicalIds.site,active:true}]);
 seed(app.organization.departments,[{id:canonicalIds.department,name:'Departamento Canónico',active:true}]);
 return canonicalIds;
}

module.exports={setup,canonicalOrganization,canonicalIds};
