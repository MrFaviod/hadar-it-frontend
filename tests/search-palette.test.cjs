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

// ---------------------------------------------------------------- corrections
const fs=require('node:fs');
function mediaBlock(source, query) {
 const start=source.indexOf('@media('+query+')');
 if(start<0)return '';
 const open=source.indexOf('{',start);
 let depth=0;
 for(let index=open;index<source.length;index+=1){
  if(source[index]==='{')depth+=1;
  else if(source[index]==='}'){depth-=1;if(depth===0)return source.slice(open+1,index);}
 }
 return '';
}

test('S6 the mobile palette keeps the localized count and status line rendered',()=>{
 const css=fs.readFileSync('assets/css/search.css','utf8');
 const mobile=mediaBlock(css,'max-width:700px');
 assert.ok(mobile,'the mobile breakpoint exists');
 assert.ok(
  !/\.search-palette__count[^{}]*\{[^{}]*display\s*:\s*none/.test(mobile),
  'mobile rules must not hide the count/status spans from render and the accessibility tree'
 );
 assert.ok(
  !/\.search-palette__count\b[^{}]*span\s*\{[^{}]*display\s*:\s*none/.test(mobile),
  'mobile rules must not hide the count/status span children'
 );
 assert.match(css,/\.search-palette__count\{[^}]*font-size:12px/, 'the desktop count stays 12px');
});

test('S6 loading and failed searches keep a public status string',()=>{
 const s=setup(),{instance:p}=palette(s);
 p.loading=true;
 assert.equal(p.status,s.c.ItsmI18n.t('ui.search.searching'),'loading announces the localized searching copy');
 assert.equal(p.emptyText,s.c.ItsmI18n.t('ui.search.searching'),'loading keeps the localized empty body');
 p.loading=false;p.error='Fallo de red';
 assert.equal(p.status,'Fallo de red','the failure message is the status');
 assert.equal(p.emptyText,'Fallo de red','the alert keeps the failure message');
 p.error='';p.fallback=true;
 assert.equal(p.status,s.c.ItsmI18n.t('ui.search.fallback_sql'),'the fallback note is announced');
 p.fallback=false;
 assert.equal(p.status,'','a settled local state has no status string');
});

test('S6 only non-action records are favoritable in every locale',()=>{
 const s=setup(),app=s.app;
 app.authenticated=true;app.activeUserId='domain-fixture';app.route={name:'panel'};app.can=()=>true;
 const {instance:p,events}=palette(s);
 for(const locale of ['es','en']){
  s.c.ItsmI18n.setLocale(locale);
  p.scope='actions';p.query='';p.active=0;
  assert.equal(p.results[0].kind,'action','the first quick action is an action record');
  assert.equal(p.favoriteTarget,null,`${locale}: an action row is not offerable as a favorite`);
  methods_toggle(p,events,locale);
  p.remote=[s.c.AssetSearch.record('asset','fav-1','Equipo Favoritable','AM-FAV · 10.0.0.7','box',[],{kind:'asset',id:'fav-1'})];
  p.scope='views';p.active=0;
  assert.equal(p.favoriteTarget&&p.favoriteTarget.key,'asset:fav-1',`${locale}: a real asset stays favoritable`);
  assert.equal(p.favoriteTarget.type,s.c.AssetSearch.types.asset,`${locale}: the localized group label is unchanged`);
  p.favorites=[];
  p.toggleFavorite();
  assert.deepEqual(events.at(-1),['favorite',p.remote[0]],`${locale}: toggling a real asset emits the favorite event`);
 }
 s.c.ItsmI18n.setLocale('es');
});
function methods_toggle(instance, events, locale) {
 const before=events.length;
 instance.toggleFavorite();
 assert.equal(events.length,before,`${locale}: an action row emits no favorite event`);
}

// ---------------------------------------------------------------- IME guard
test('S6 Enter right after compositionend never selects a candidate (Safari sends keyCode 229 with isComposing=false)',()=>{
 const s=setup(),{instance:p,events}=palette(s);
 p.scope='views';p.active=0;p.remote=[{key:'asset:ime',type:'Activos',label:'Equipo IME',subtitle:'IME',icon:'box',target:{kind:'asset',id:'ime'}}];
 const enter=timeStamp=>({key:'Enter',target:{tagName:'INPUT'},preventDefault(){},isComposing:false,timeStamp});
 const selects=()=>events.filter(event=>event[0]==='select').length;
 p.compositionEnd({timeStamp:1000});
 methods_onKey(p,enter(1050));
 assert.equal(selects(),0,'an Enter 50ms after compositionend is part of the IME confirmation, not a palette selection');
 p.compositionEnd({timeStamp:2000});
 methods_onKey(p,enter(2200));
 assert.equal(selects(),1,'a later Enter selects normally after the 100ms guard interval');
 p.compositionEnd({timeStamp:3000});
 p.compositionStart();
 methods_onKey(p,enter(3005));
 assert.equal(selects(),2,'a new composition clears the stale marker, so its own Enter can select');
 const composing={...enter(4000),isComposing:true};
 p.compositionEnd({timeStamp:3900});
 methods_onKey(p,composing);
 assert.equal(selects(),2,'isComposing still suppresses selection');
});
function methods_onKey(instance,event){instance.onKey(event);}

// ---------------------------------------------------------------- clear query
test('S6 clearQuery resets the query and refocuses the template input',()=>{
 const s=setup(),methods=s.c.AssetSearchViews.SearchPalette.methods;
 const {instance:p}=palette(s);
 let focused=0;
 p.$refs.input={focus(){focused+=1;}};
 p.query='equipo';
 methods.clearQuery.call(p);
 assert.equal(p.query,'','the query is cleared');
 assert.equal(focused,1,'focus returns to the palette input through its ref');
 delete p.$refs.input;
 assert.doesNotThrow(()=>methods.clearQuery.call(p),'a missing ref cannot throw during teardown');
});
