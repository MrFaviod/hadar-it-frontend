'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function setup() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const c = vm.createContext({console,Date,URL,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,location:{hash:'#/panel'},history:{replaceState(){}},navigator:{}}); c.window=c;
  vm.runInContext(fs.readFileSync(path.join(root,'assets/vendor/vue.global.prod.js'),'utf8'),c);
  const decode = text => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[entity] || String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1)))));
  c.document={ createElement(){return {children:[],set innerHTML(v){this.textContent=decode(v);this.children=[{getAttribute:()=>decode((v.match(/foo="([\s\S]*)"/)||[])[1]||'')}];}};}, title:'' };
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if(src.includes('/vendor/') || /theme|sidebar|app\.js/.test(src))continue;
    vm.runInContext(fs.readFileSync(path.join(root,src),'utf8'),c,{filename:src});
  }
  const realVue=c.Vue;
  c.Vue={...realVue,createApp(options){c.rootOptions=options;return {mount(){}};}};
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/app.js'),'utf8'),c);
  c.Vue=realVue;
  const app=realVue.reactive(c.rootOptions.data());
  app.currentUser={id:'admin'}; app.can=()=>true;app.showToast=message=>{app.lastToast=message;};app.openAssetCreate=()=>{app.createOpened=true;};app.openAsset=asset=>{app.openedAsset=asset.id;};
  for(const [name,fn] of Object.entries(c.rootOptions.computed))Object.defineProperty(app,name,{get:()=>fn.call(app),configurable:true});
  // Access state is owned by its existing mixin; no auth logic is replaced in production.
  const host={
    createElement:tag=>({tag,tagName:tag.toUpperCase(),props:{},children:[],parent:null,addEventListener(){},removeEventListener(){},get options(){return this.children;},get value(){return this.props.value;},set value(v){this.props.value=v;},selected:false,multiple:false}), createText:text=>({tag:'#text',text,children:[]}),createComment:text=>({tag:'#comment',text,children:[]}),
    setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},patchProp:(n,k,o,v)=>{n.props[k]=v;},
    insert(n,p,anchor){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}const i=anchor?p.children.indexOf(anchor):-1;if(i>=0)p.children.splice(i,0,n);else p.children.push(n);n.parent=p;},
    remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}},parentNode:n=>n.parent,nextSibling(n){if(!n.parent)return null;return n.parent.children[n.parent.children.indexOf(n)+1]||null;}
  };
  const container={children:[]};
  // Transition hooks use a DOM renderer; their visual behavior is checked by static motion rules, not emulated here.
  const component={...c.AssetPanel.PanelOverview,template:c.AssetPanel.PanelOverview.template.replace(/<transition name="fade">/g,'<template>').replace(/<\/transition>/g,'</template>')};
  const errors=[];
  const renderer=realVue.createRenderer(host), mountedApp=renderer.createApp(component,{app});
  mountedApp.config.errorHandler=error=>{errors.push(error);};
  const instance=mountedApp.mount(container);
  assert.deepEqual(errors,[], 'No component runtime errors');
  function all(predicate,node=container,out=[]){if(predicate(node))out.push(node);for(const child of node.children||[])all(predicate,child,out);return out;}
  const byId=id=>all(n=>n.props&&n.props['data-od-id']===id)[0];
  return {c,app,html,instance,all,byId,tick:realVue.nextTick};
}
test('all current component templates and root compile with the project Vue compiler',()=>{
  const s=setup();const seen=new Set();let count=0;
  function compile(comp){if(!comp||typeof comp!=='object'||seen.has(comp))return;seen.add(comp);if(comp.template){const f=s.c.Vue.compile(comp.template);assert.equal(typeof f,'function');count++;}for(const child of Object.values(comp.components||{}))compile(child);}
  for(const component of Object.values(s.c.rootOptions.components))compile(component);
  const start=s.html.indexOf('<div id="app"');const open=s.html.indexOf('>',start)+1; const end=s.html.lastIndexOf('</div>',s.html.indexOf('<script src="assets/vendor/vue'));
  assert.equal(typeof s.c.Vue.compile(s.html.slice(open,end)),'function');
  console.log('Compiled component templates:',count,'and root');
});
test('home interaction flow filters, switches period, explores samples and opens reports',async()=>{
  const s=setup();
  assert.ok(s.byId('dashboard-operativo'));assert.equal(s.all(n=>n.props&&String(n.props['data-od-id']||'').startsWith('dashboard-widget-')).length,8);
  s.byId('dashboard-new-asset').props.onClick(); assert.equal(s.app.createOpened,true);
  s.byId('dashboard-period-7d').props.onClick();await s.tick();assert.equal(s.instance.filters.period,'7d');
  s.instance.filters.category='not-found';await s.tick();assert.equal(s.instance.model.assets.length,0);
  s.instance.clearFilters();await s.tick();assert.equal(s.instance.model.assets.length,28);
  const sample=s.byId('dashboard-chart-sample');sample.props.onInput({target:{value:'0'}});await s.tick();
  s.byId('dashboard-reports').props.onClick();await s.tick();assert.ok(s.byId('dashboard-report-panel'));
});
test('personalization interaction adds temporary widget and saves a link with a new-tab destination',async()=>{
  const s=setup();
  s.byId('dashboard-customize').props.onClick();await s.tick();assert.ok(s.byId('dashboard-preferences'));
  s.c.AssetDashboardPrefs.addTemporary(s.app.dashboard,'admin','latency');await s.tick();assert.ok(s.byId('dashboard-widget-latency'));
  const saved=JSON.stringify(s.c.AssetDashboardPrefs.layoutFor(s.app.dashboard,'admin'));
  s.instance.clearTemporary();await s.tick();assert.equal(s.byId('dashboard-widget-latency'),undefined);assert.equal(JSON.stringify(s.c.AssetDashboardPrefs.layoutFor(s.app.dashboard,'admin')),saved);
  s.byId('dashboard-add-link').props.onClick();await s.tick();const form=s.byId('dashboard-link-form');assert.ok(form);
  const input=s.all(n=>n.tag==='input'&&n.props.placeholder==='Consola de administración')[0];input.props['onUpdate:modelValue']('Consola de prueba');
  const url=s.all(n=>n.tag==='input'&&n.props.type==='url')[0];url.props['onUpdate:modelValue']('https://example.com');
  form.props.onSubmit({preventDefault(){},stopPropagation(){}});await s.tick();
  assert.equal(s.app.dashboard.links.length,1);
  const link=s.all(n=>n.tag==='a'&&n.props.href==='https://example.com/')[0];assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');
});
