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
  // The engines resolve visible copy through the runtime; the source catalog is
  // handed to it directly so the Spanish assertions keep running without a DOM.
  const source=JSON.parse(fs.readFileSync('assets/i18n/es.json','utf8'));
  c.ItsmI18n={t:(key)=>typeof source[key]==='string'?source[key]:''};
  for(const file of ['report-engine','warranty-engine','label-engine']) {
    const p='assets/js/'+file+'.js'; if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),c);
  }
  return c;
}
const assets=[{id:'AM-1',code:'PC-C-001',name:'Puesto uno',category:'pc',site:'central',assigneeId:'ana',statusId:'active',history:[{id:'h1',at:'2026-09-01T12:00:00Z',kind:'assigned',title:'Asignación'}],warranty:{provider:'Proveedor',until:'2026-10-01'}},{id:'AM-2',code:'SW-C-001',name:'Switch',category:'red',site:'central',statusId:'active',history:[],warranty:{until:'2026-08-01'}}];
test('report catalog exposes only canonical server fields and composition modes',()=>{
  const E=context().AssetReportEngine; assert.ok(E,'Public report API exists');
  assert.deepEqual(Array.from(E.FAMILIES,family=>family.id),['inventory','history','warranty']);
  assert.deepEqual(Array.from(E.fieldsForFamily('history'),field=>field.key),Array.from(E.HISTORY_FIELDS,field=>field.key));
  assert.deepEqual(Array.from(E.fieldsForFamily('warranty'),field=>field.key),Array.from(E.WARRANTY_FIELDS,field=>field.key));
  assert.equal(E.composeRequestMode({mode:'list'}),'consolidated');
  assert.equal(E.composeRequestMode({mode:'sheet'}),'individual');
});
test('report template normalization keeps allowlisted fields and blocks without mutating the source',()=>{
  const E=context().AssetReportEngine;assert.ok(E);
  const source={family:'warranty',name:'Garantías',mode:'sheet',format:'Legal',fields:['expiresOn','ip','desconocido'],blocks:[{id:'b1',type:'qr'},{id:'b2',type:'script',text:'x'}]};
  const before=JSON.stringify(source),template=E.normalizeTemplate(source);
  assert.equal(template.family,'warranty');
  assert.equal(template.mode,'sheet');
  assert.equal(template.format,'A4');
  assert.deepEqual(Array.from(template.fields),['expiresOn']);
  assert.deepEqual(Array.from(template.blocks,block=>block.type),['qr','text']);
  assert.equal(JSON.stringify(source),before);
});
test('report drafts are independent and keep the edited block order',()=>{
  const E=context().AssetReportEngine;assert.ok(E);
  const first=E.createTemplate('inventory'),second=E.createTemplate('inventory');
  assert.notEqual(first.blocks[0].id,second.blocks[0].id);
  first.blocks.reverse();
  assert.deepEqual(Array.from(first.blocks,block=>block.type),['footer','table','heading']);
  assert.deepEqual(Array.from(second.blocks,block=>block.type),['heading','table','footer']);
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
test('QR destination uses the configured base URL and the immutable asset ID',()=>{
  const E=context().AssetLabelEngine;assert.ok(E,'Public QR-label API exists');
  const id='5a1e0c10-0001-4f10-9a10-000000000001';
  assert.equal(E.assetUrl('https://activos.example/',id),'https://activos.example/#/reporte/'+id);
  assert.equal(E.assetUrl('  https://activos.example  ',id),'https://activos.example/#/reporte/'+id);
  assert.equal(E.assetUrl('',id),'');
  assert.equal(E.assetUrl('https://activos.example/',''),'');
  const token='share-token-0123456789abcdef';
  assert.equal(E.publicUrl('https://activos.example',id,token),'https://activos.example/#/reporte/'+id+'/publico?share='+token);
});
test('public report vocabulary never includes internal inventory fields',()=>{
  const E=context().AssetLabelEngine;assert.ok(E);
  assert.deepEqual(Array.from(E.PUBLIC_FIELDS,field=>field.key),['id','quickCode','name','category','site','location','status']);
  assert.equal(E.publicFieldOf('ip'),null);
  assert.equal(E.publicFieldOf('technical'),null);
  assert.equal(E.publicFieldOf('name').label,'Nombre');
});
test('label options serialize canonical geometry and paginate by sheet capacity',()=>{
  const E=context().AssetLabelEngine;assert.ok(E);
  const wire=E.wireLabelOptions({formatId:'a4-24',fields:['name','id','ip','qr'],columns:3,rows:8,offset:2});
  assert.deepEqual(Object.keys(wire).sort(),['columns','fields','formatId','gapXmm','gapYmm','heightMm','logo','marginBottomMm','marginLeftMm','marginRightMm','marginTopMm','offset','pageHeightMm','pageWidthMm','qr','widthMm']);
  assert.equal(Object.prototype.hasOwnProperty.call(wire,'rows'),false);
  assert.deepEqual(Array.from(wire.fields),['name','id','qr']);
  assert.equal(wire.columns,3);assert.equal(wire.offset,2);assert.equal(wire.widthMm,70);assert.equal(wire.heightMm,37);
  assert.equal(E.estimatedPages(25,{columns:3,rows:8,offset:2}),2);
  assert.equal(E.estimatedPages(0,{columns:3,rows:8}),0);
});
