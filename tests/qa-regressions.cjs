'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./universal-harness.cjs');
// Exercise the real root setHash (the harness stubs it) against the harness location.
function realSetHash(s){const fn=s.c.options.methods.setHash;s.app.handleHashChange=()=>{s.app.reparsed=true;};return h=>fn.call(s.app,h);}

test('QA-1 setHash accepts route objects used by monitoring views and resolves them to real hashes',()=>{
 const s=setup(),go=realSetHash(s);
 const cases=[[{name:'monitorDevice',assetId:'AM-1047'},'#/supervision/activo/AM-1047'],[{name:'monitorAlert',alertId:'AL-1'},'#/supervision/alerta/AL-1'],[{name:'monitoring',section:'alertas'},'#/supervision/alertas'],[{name:'incident',incidentId:'INC-9'},'#/mantenimiento/incidente/INC-9'],[{name:'notifications'},'#/supervision/notificaciones']];
 for(const [route,hash] of cases){go(route);assert.equal(s.c.location.hash,hash);}
});
test('QA-1 setHash keeps string hashes unchanged and re-dispatches when the hash is already current',()=>{
 const s=setup(),go=realSetHash(s);go('#/inventario');assert.equal(s.c.location.hash,'#/inventario');s.app.reparsed=false;go('#/inventario');assert.equal(s.app.reparsed,true);
});
test('QA-2 monitoring "open asset" actions target the asset detail route, not an unknown route name',()=>{
 const src=require('node:fs').readFileSync('assets/js/monitoring-views.js','utf8');assert.equal(/name:\s*'asset'/.test(src),false);
});
test('QA-3 monitoring no longer sweeps or mutates alerts from a client timer',()=>{
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../assets/js/monitoring-views.js'),'utf8');
 assert.equal(/\brunSweep\b|\bsetInterval\s*\(/.test(src),false);
 const s=setup();
 assert.equal(typeof s.c.options.components.MonitoringCenter.methods.runSweep,'undefined');
});
const fsq=require('fs'),pq=require('path');
const hexL=h=>{const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]};
const ratio=(a,b)=>{const x=hexL(a),y=hexL(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
test('QA-4 light secondary text (--slate-500) reaches 4.5:1 on paper and page background, in CSS and generated presets',()=>{
 const css=fsq.readFileSync(pq.join(__dirname,'../assets/css/app.css'),'utf8');
 const slate=css.match(/--slate-500:\s*(#[0-9a-f]{6})/i)[1],paper=css.match(/--paper:\s*(#[0-9a-f]{6})/i)[1],bg=css.match(/--bg:\s*(#[0-9a-f]{6})/i)[1];
 assert.ok(ratio(slate,paper)>=4.5,`paper ${ratio(slate,paper)}`);assert.ok(ratio(slate,bg)>=4.5,`bg ${ratio(slate,bg)}`);
 const eng=fsq.readFileSync(pq.join(__dirname,'../assets/js/appearance-engine.js'),'utf8');
 assert.match(eng,new RegExp("'--slate-500': dark \\? '#8ca7aa' : '"+slate+"'"));
});
test('QA-4 inventory internal id text uses the readable secondary tone and the dark-logo empty label stays legible in both themes',()=>{
 const a=fsq.readFileSync(pq.join(__dirname,'../assets/css/assets-admin.css'),'utf8');
 assert.match(a,/\.asset-code__id \{\s*color: var\(--slate-500\)/);
 const ap=fsq.readFileSync(pq.join(__dirname,'../assets/css/appearance.css'),'utf8');
 assert.match(ap,/\.appearance-resource__preview\.is-dark>span \{[^}]*color: var\(--paper\)/);
});
test('QA-5 canonical maintenance plans appear in universal search with the readable server name instead of their internal id',()=>{
 const s=setup(),a=s.app,asset=a.assets.find(x=>x.id==='AM-1042'),plan={id:'plan-qa-1',assetId:asset.id,name:'Preventivo · '+asset.name,title:'Preventivo · '+asset.name,status:'active',maintenanceType:'preventive'};
 a.maintenanceApi.plans.items=[plan];
 const idx=s.c.AssetSearch.buildIndex(a),rec=s.c.AssetSearch.search(idx,'AM-1042').find(r=>r.key==='plan:'+plan.id);
 assert.ok(rec);assert.equal(rec.label,plan.name);assert.notEqual(rec.label,plan.id);
 assert.ok(s.c.AssetSearch.search(idx,'Preventivo').some(r=>r.key==='plan:'+plan.id));
});
test('QA-6 report block reorder buttons are announced with the block name, not its internal id',async()=>{
 const s=setup();
 s.app.phase9LoadTemplates=async()=>false;s.app.phase9LoadSelection=async()=>false;s.app.phase9LoadJobs=async()=>false;
 const m=s.mount('ReportsCenter');await s.tick();
 m.instance.editor=true;m.instance.draft=s.c.AssetReportEngine.createTemplate('inventory');await s.tick();
 const labels=[],walk=node=>{if(!node)return;const label=node.props&&node.props['aria-label'];if(label&&/^(Subir|Bajar) /.test(label))labels.push(label);(node.children||[]).forEach(walk);};walk(m.root);
 assert.ok(labels.length>=4,'reorder controls render');
 for(const label of labels){const name=label.replace(/^(Subir|Bajar) /,'');assert.ok(m.instance.draft.blocks.some(block=>block.label===name),`announces "${name}" instead of an internal id`);}
 m.unmount();
});
test('QA-7 an unknown route is normalised to #/panel instead of showing Panel under a foreign hash',()=>{
 const s=setup(),a=s.app,seen=[];a.authenticated=true;a.ensureHash=h=>seen.push(h);a.$nextTick=()=>{};
 s.c.location.hash='#/xyz';s.c.options.methods.handleHashChange.call(a);
 assert.equal(a.route.name,'panel');assert.deepEqual(seen,['#/panel']);
 seen.length=0;s.c.location.hash='#/inventario';s.c.options.methods.handleHashChange.call(a);
 assert.equal(a.route.name,'inventory');assert.deepEqual(seen,[]);
});
test('QA-9 interface copy uses one register (tú, es-ES); no voseo imperatives remain',()=>{
 const files=fsq.readdirSync(pq.join(__dirname,'../assets/js')).filter(f=>f.endsWith('.js')).map(f=>'assets/js/'+f).concat('index.html');
 const rx=/(?<![\wáéíóúñ])(Seleccioná|Elegí|elegí|Indicá|Cambiá|Usá|usá|Marcá|Escribí|Confirmá|Revisá|Probá|Planificá|Ingresá|Editá|desmarcá|dejá|Definí|Arrastrá|Ajustá|Activá|Podés|podés|Necesitás|querés)(?![\wáéíóúñ])/;
 const hits=files.filter(f=>rx.test(fsq.readFileSync(pq.join(__dirname,'..',f),'utf8')));
 assert.deepEqual(hits,[]);
});
