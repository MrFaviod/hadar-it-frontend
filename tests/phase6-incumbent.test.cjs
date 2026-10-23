const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

test('the incumbent five-step importer inspects server sheets then previews and confirms a fixed import', async (t) => {
  const { c, app, mount } = harness.setup();
  t.after(() => app.clearPhase6State());
  const calls = [];
  c.fetch = async (url, init) => {
    calls.push({url, init});
    const payload = url.includes('inspectOnly') ? {sheets: []} : {};
    return {ok: true,status: 200,json: async () => payload};
  };
  // Stub only the adapter boundary; the mounted incumbent owns the five steps.
  app.inspectImportFile = async () => ({ok:true,sheets:[{id:'North',name:'North',columns:['name','category'],rows:[['Imported','switch']]}]});
  app.analyzeImport = async (_, options) => {
    calls.push({options});
    app.phase6.operation = {id:'op',state:'preview',rows:[{index:0,sheet:'North',line:2,values:{name:'Imported',category:'switch'},classification:'new',action:'create',errors:[],candidates:[]}],summary:{created:0,modified:0,omitted:0,failed:0}};
    return {ok:true};
  };
  const order=[];
  app.approvePhase6Operation=async()=>{order.push('approve');return {ok:true};};
  app.executePhase6Operation=async()=>{order.push('execute');app.phase6.operation.state='complete';app.phase6.operation.summary.created=1;return {ok:true};};
  const view=mount('DataTransfer');
  c.options.components.TransferImport = c.AssetTransferViews.TransferImport;
  const importer=mount('TransferImport');
  t.after(()=>{view.unmount();importer.unmount();});
  assert.match(c.AssetTransferViews.TransferImport.template,/transfer-step-/);
  assert.equal(importer.instance.steps.length,5);
  await importer.instance.chooseSource({target:{files:[{name:'real.csv',arrayBuffer:async()=>new ArrayBuffer(1)}]}});
  assert.equal(importer.instance.file.name,'real.csv');
  await importer.instance.nextStep();
  await importer.instance.nextStep();
  assert.equal(importer.instance.step,3);
  assert.equal(importer.instance.rows[0].display.name,'Imported');
  importer.instance.openConfirm();
  assert.equal(importer.instance.confirmOpen,true);
  await importer.instance.applyImport();
  assert.deepEqual(order,['approve','execute']);
  assert.equal(importer.instance.applied.counts.created,1);
  assert.deepEqual(Array.from(calls.find(call => call.options).options.selectedSheets),['North']);
});
