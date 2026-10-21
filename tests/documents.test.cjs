'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function context() {
  const values = new Map();
  const storage = { getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,v) };
  const c = vm.createContext({console,Date,URL,localStorage:storage}); c.window=c;
  c.AssetStore={clone:v=>JSON.parse(JSON.stringify(v)),readJSON:(s,k,f)=>s.getItem(k)?JSON.parse(s.getItem(k)):f,writeJSON:(s,k,v)=>{s.setItem(k,JSON.stringify(v));return true;}};
  for(const file of ['report-engine','warranty-engine','label-engine']) {
    const p='assets/js/'+file+'.js'; if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),c);
  }
  return c;
}
const assets=[{id:'AM-1',code:'PC-C-001',name:'Puesto uno',category:'pc',site:'central',assigneeId:'ana',statusId:'active',history:[{id:'h1',at:'2026-09-01T12:00:00Z',kind:'assigned',title:'Asignación'}],warranty:{provider:'Proveedor',until:'2026-10-01'}},{id:'AM-2',code:'SW-C-001',name:'Switch',category:'red',site:'central',statusId:'active',history:[],warranty:{until:'2026-08-01'}}];
test('reports filter scope without modifying inventory or ignoring explicit empty selection',()=>{
  const c=context(); assert.ok(c.AssetReportEngine,'Public report API exists'); const E=c.AssetReportEngine;
  const before=JSON.stringify(assets);
  assert.equal(E.selectAssets(assets,{category:'pc',site:'central',responsible:'ana',status:'active'}).length,1);
  assert.equal(E.selectAssets(assets,{ids:[]}).length,0);
  assert.equal(E.selectAssets(assets,{ids:['AM-2']})[0].id,'AM-2');
  assert.equal(JSON.stringify(assets),before);
});
test('reports group by requested field and constrain history dates and kinds',()=>{
  const E=context().AssetReportEngine; assert.ok(E);
  assert.equal(E.groupAssets(assets,'site')[0].count,2);
  assert.equal(E.historyRows(assets,{from:'2026-09-01',to:'2026-09-01',event:'assigned'}).length,1);
  assert.equal(E.historyRows(assets,{from:'2026-09-02',event:'assigned'}).length,0);
  assert.equal(E.historyRows(assets,{event:'incident'}).length,0);
});
test('template customization reorders blocks and persists independently of defaults',()=>{
  const c=context(), E=c.AssetReportEngine; assert.ok(E); const state=E.createState();
  const template=JSON.parse(JSON.stringify(state.templates[0])); const original=JSON.stringify(state.templates[0]);
  template.name='Ficha de soporte';template.blocks.reverse();template.fields=['id','name'];
  assert.equal(E.saveTemplate(state,template).ok,true);
  assert.equal(JSON.stringify(state.templates[0]),original);
  assert.ok(E.createState().templates.some(t=>t.name==='Ficha de soporte'));
  const before=JSON.stringify(state);assert.equal(E.saveTemplate(state,{...template,name:' '}).ok,false);assert.equal(JSON.stringify(state),before);
});
test('generation records correct output scope and rejects empty reports unchanged',()=>{
  const E=context().AssetReportEngine;assert.ok(E);const s=E.createState();
  const b=JSON.stringify(s);assert.equal(E.generate(s,[],{name:'Vacío'}).ok,false);assert.equal(JSON.stringify(s),b);
  const out=E.generate(s,assets,{name:'Fichas',mode:'individual',format:'PDF',family:'inventory'});
  assert.equal(out.ok,true);assert.equal(out.document.assets.length,2);assert.equal(out.document.pages,2);assert.equal(s.history.length,1);
});
test('warranties classify today, threshold and expired dates inclusively',()=>{
  const E=context().AssetWarrantyEngine;assert.ok(E,'Public warranty API exists');
  assert.equal(E.status({until:'2026-09-12'},30,'2026-09-12').key,'expiring');
  assert.equal(E.status({until:'2026-10-12'},30,'2026-09-12').key,'expiring');
  assert.equal(E.status({until:'2026-10-13'},30,'2026-09-12').key,'active');
  assert.equal(E.status({until:'2026-09-11'},30,'2026-09-12').key,'expired');
  assert.equal(E.status(null,30,'2026-09-12').key,'missing');
});
test('warranty duration clamps month ends and rejects invalid data without mutation',()=>{
  const E=context().AssetWarrantyEngine;assert.ok(E);
  assert.equal(E.expiry('2026-01-31',1),'2026-02-28');
  const a=JSON.parse(JSON.stringify(assets[0])),before=JSON.stringify(a);
  assert.equal(E.save(a,{provider:'P',purchase:'2026-09-01',until:'2026-08-01',receipts:[]}).ok,false);assert.equal(JSON.stringify(a),before);
  assert.equal(E.save(a,{provider:'Nuevo',purchase:'2026-09-01',until:'2027-09-01',months:12,receipts:[{name:'Factura.pdf',size:2000,type:'application/pdf'}]}).ok,true);
  assert.equal(a.id,'AM-1');assert.equal(a.warranty.provider,'Nuevo');assert.equal(a.warranty.receipts[0].name,'Factura.pdf');
});
test('QR destination uses immutable ID only and rejects invalid base settings unchanged',()=>{
  const c=context(),E=c.AssetLabelEngine;assert.ok(E,'Public QR-label API exists');const s=E.createState();
  assert.equal(s.access,'private');const a={...assets[0]};const url=E.assetUrl(s,a);
  a.code='OTRO';a.site='sur';a.category='otro';assert.equal(E.assetUrl(s,a),url);assert.ok(url.includes('AM-1'));
  const before=JSON.stringify(s);assert.equal(E.saveSettings(s,{baseUrl:'javascript:alert(1)'}).ok,false);assert.equal(JSON.stringify(s),before);
});
test('public projection never inherits internal inventory fields',()=>{
  const E=context().AssetLabelEngine;assert.ok(E);const a={...assets[0],ip:'10.0.0.1',anydeskId:'secret',cost:100,tech:{password:'x'}};
  const publicRecord=E.publicRecord(a,['name','id','ip','anydeskId','tech','cost']);
  assert.deepEqual(Object.keys(publicRecord).sort(),['id','name']);assert.equal(publicRecord.name,a.name);
});
test('label formats paginate sheets with a starting offset and preserve saved customizations',()=>{
  const c=context(),E=c.AssetLabelEngine;assert.ok(E);const s=E.createState();
  const pages=E.paginate(Array.from({length:25},(_,i)=>({id:'A'+i})),{columns:3,rows:8},2);
  assert.equal(pages.length,2);assert.equal(pages[0][0],null);assert.equal(pages[0][2].id,'A0');assert.equal(pages[1].filter(Boolean).length,3);
  s.fields=['id','code','qr'];E.persist(s);assert.deepEqual(Array.from(E.createState().fields),['id','code','qr']);
});
