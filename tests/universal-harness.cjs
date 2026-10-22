'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(entry='index.html'){
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const c=vm.createContext({console,Date,URL,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,AbortController,AbortSignal,localStorage:storage,sessionStorage:storage,location:{hash:'#/panel'},history:{replaceState(){}},navigator:{},addEventListener(){},removeEventListener(){}});c.window=c;
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
 // Domain rendering tests use an explicit authorized fixture, never prototype login seeds.
 const app=Vue.reactive(Object.assign({},c.AssetAccess.data(),c.options.data()));app.security.users=[{id:'domain-fixture',name:'Domain fixture',roleId:'fixture',active:true}];app.activeUserId='domain-fixture';app.authenticated=true;app.serverPermissions=c.AssetAccess.catalog.flatMap(group=>group.permissions.map(permission=>permission.id));app.can=()=>true;app.showToast=m=>{app.lastToast=m;};
 for(const [key,fn] of Object.entries(c.options.methods))app[key]=fn.bind(app);
 app.can=()=>true;app.showToast=m=>{app.lastToast=m;};app.setHash=h=>{app.lastHash=h;};
 for(const [key,fn] of Object.entries(Object.assign({},c.AssetAccess.computed,c.options.computed)))Object.defineProperty(app,key,{get:()=>fn.call(app),configurable:true});
 const errors=[];
 const host={createElement:tag=>({tag,tagName:tag.toUpperCase(),props:{},children:[],parent:null,style:{},// Native listeners (including the v-model directives) are kept so a mounted
 // template can be driven through the same input/change events a browser sends.
 addEventListener(type,handler){(this.listeners||(this.listeners={}))[type]=handler;},removeEventListener(type){if(this.listeners)delete this.listeners[type];},get options(){return this.children;},get value(){return this.props.value;},set value(v){this.props.value=v;},selected:false,multiple:false}),createText:text=>({tag:'#text',text,children:[]}),createComment:text=>({tag:'#comment',text,children:[]}),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},patchProp:(n,k,o,v)=>{n.props[k]=v;},insert(n,p,a){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}const i=a?p.children.indexOf(a):-1;if(i>=0)p.children.splice(i,0,n);else p.children.push(n);n.parent=p;},remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}},parentNode:n=>n.parent,nextSibling(n){return n.parent?n.parent.children[n.parent.children.indexOf(n)+1]||null:null;}};
 function mount(name,props={}){
  const source=c.options.components[name];assert.ok(source, name+' is registered');
  // Replace only DOM-only modal/transition infrastructure with transparent test components.
  function adapt(comp){if(!comp||typeof comp!=='object')return comp;const out={...comp,components:{...(comp.components||{})}};if(out.template)out.template=out.template.replace(/<transition name="fade">/g,'<template>').replace(/<\/transition>/g,'</template>');for(const [key,value] of Object.entries(out.components))out.components[key]=key==='ModalShell'?{props:['open'],template:'<div v-if="open"><slot></slot><slot name="footer"></slot></div>'}:adapt(value);return out;}
  const root={children:[]},r=Vue.createRenderer(host),a=r.createApp(adapt(source),{app,...props});a.config.errorHandler=e=>errors.push(e);const instance=a.mount(root);return {instance,root,unmount:()=>a.unmount()};
 }
 return {c,app,html,mount,errors,tick:Vue.nextTick};
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
