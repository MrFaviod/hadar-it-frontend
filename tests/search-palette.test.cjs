'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./universal-harness.cjs');
function palette(s){
 const def=s.c.AssetSearchViews.SearchPalette,events=[];
 const instance=Object.assign(def.data.call({}),{$root:s.app,$emit:(...args)=>events.push(args),$nextTick:fn=>fn&&fn(),$refs:{}});
 for(const [key,fn] of Object.entries(def.methods))instance[key]=fn.bind(instance);
 for(const [key,fn] of Object.entries(def.computed))Object.defineProperty(instance,key,{get:()=>fn.call(instance),configurable:true});
 return {instance,events};
}
test('S6 palette resolves canonical search records, groups by type and keeps keyboard selection',async()=>{
 const s=setup(),app=s.app,methods=s.c.AssetSearchViews.SearchPalette.methods;
 app.authenticated=true;app.activeUserId='domain-fixture';app.route={name:'panel'};
 s.server.items=[
  {key:'asset:canonical-1',type:'asset',id:'canonical-1',label:'Puesto Canónico',subtitle:'AM-CANON · 10.0.0.9',icon:'box',target:{kind:'asset',id:'canonical-1'}},
  {key:'person:canonical-2',type:'person',id:'canonical-2',label:'Ana Canónica',subtitle:'Analista',icon:'user',target:{kind:'person',id:'canonical-2'}},
  {key:'section:inventory',type:'section',id:'inventory',label:'Inventario',subtitle:'Sección',icon:'inventory',target:{kind:'section',route:{name:'inventory'}}}
 ];
 const {instance:p,events}=palette(s);
 const searches=()=>s.server.calls.filter(call=>call.url.startsWith('/search')).length;
 await methods.runSearch.call(p,'AM-CANON');await s.tick();
 assert.deepEqual(Array.from(p.results.filter(row=>row.target.kind==='asset'),row=>row.key),['asset:canonical-1'],'the permanent ID resolves through GET /search, not app.assets');
 assert.equal(p.total,1);assert.equal(p.error,'');assert.equal(p.loading,false);
 assert.ok(p.groups.some(group=>group.label==='Activos'),'the canonical asset keeps its type group');
 const first=searches();
 await methods.runSearch.call(p,'Canónica');await s.tick();
 assert.deepEqual(Array.from(p.results.filter(row=>row.target.kind==='person'),row=>row.key),['person:canonical-2'],'a new query replaces prior remote rows');
 assert.equal(searches(),first+1);
 const person=p.results.findIndex(row=>row.key==='person:canonical-2');
 p.active=p.results.length-1;
 methods.onKey.call(p,{key:'ArrowDown',preventDefault(){},isComposing:false});
 assert.equal(p.active,0,'arrows wrap across grouped quick actions and canonical rows');
 p.active=person;
 methods.onKey.call(p,{key:'Enter',target:{tagName:'INPUT'},preventDefault(){},isComposing:false});
 assert.equal(events.at(-1)[0],'select');assert.equal(events.at(-1)[1].key,'person:canonical-2');
 methods.onKey.call(p,{key:'Escape',preventDefault(){},isComposing:false});
 assert.equal(events.at(-1)[0],'close');
 assert.ok(p.groups.some(group=>group.label==='Personas'),'the canonical person keeps its type group');
});
test('S6 local scopes never call the search endpoint and an empty canonical response announces no matches',async()=>{
 const s=setup(),app=s.app,methods=s.c.AssetSearchViews.SearchPalette.methods;
 app.authenticated=true;app.activeUserId='domain-fixture';app.route={name:'panel'};
 s.server.items=[];
 const {instance:p}=palette(s);
 const searches=()=>s.server.calls.filter(call=>call.url.startsWith('/search')).length;
 p.scope='actions';
 await methods.runSearch.call(p,'crear');await s.tick();
 assert.equal(searches(),0,'quick actions stay local');
 assert.ok(p.results.some(row=>row.target&&row.target.action==='create-asset'));
 app.can=()=>true;
 p.scope='views';
 await methods.runSearch.call(p,'no-existe');await s.tick();
 assert.deepEqual(Array.from(p.results),[]);assert.equal(p.total,0);assert.equal(p.loading,false);assert.equal(p.error,'');
 assert.equal(p.emptyText,'No hay coincidencias');
});
