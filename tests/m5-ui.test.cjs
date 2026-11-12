'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');
const plain = v => JSON.parse(JSON.stringify(v));
function nodes(root, predicate) { const out=[]; const walk=n=>{if(predicate(n))out.push(n);(n.children||[]).forEach(walk);};walk(root);return out; }

test('shortcuts from API are revalidated without editing dashboard preferences', async () => {
  const { c, app, server, mount } = setup();
  server.state.shortcuts = [
    { id:'ok', name:'Console', url:'https://example.test', scope:'shared', ownerId:'other' },
    { id:'bad', name:'Bad', url:'javascript:alert(1)', scope:'personal', ownerId:app.currentUser.id },
    { id:'credentials', name:'Bad', url:'https://u:p@example.test', scope:'personal', ownerId:app.currentUser.id }
  ];
  await c.AssetPhase10Api.loadWorkspace(app);
  assert.deepEqual(plain(app.dashboard.links).map(x=>[x.id,x.url,x.ownerId]), [['ok','https://example.test/','other']]);
  c.options.components.DashboardLinks=c.AssetDashboardPrefs.DashboardLinks;
  const view=mount('DashboardLinks');
  assert.deepEqual(nodes(view.root,n=>n.tag==='a').map(n=>n.props.href),['https://example.test/']);
  view.unmount();
});

test('new account defaults to an assignable role and rejects stale/forged selection before transport', async () => {
  const { app, server, mount } = setup();
  app.security.roles=[{id:'admin',name:'Admin',permissions:['roles.manage']},{id:'reader',name:'Reader',permissions:['assets.view']}];
  app.can=p=>['users.create','users.view','assets.view'].includes(p);
  const view=mount('AccessUsers');
  view.instance.openCreate();
  assert.equal(view.instance.draft.roleId,'reader');
  Object.assign(view.instance.draft,{username:'new',name:'New',password:'fictional-password',roleId:'admin'});
  view.instance.save();
  await Promise.resolve();
  assert.ok(view.instance.errors.roleId);
  assert.equal(server.calls.length,0);
  // The app adapter rechecks a role even when called without a mounted form.
  const rejected=await app.saveUser(view.instance.draft);
  assert.equal(rejected.ok,false);
  assert.equal(server.calls.length,0);
  Object.assign(view.instance.draft,{roleId:'reader'});
  let saved;
  app.saveUser=draft=>{saved=draft;return {ok:true};};
  view.instance.save();
  assert.equal(saved.roleId,'reader');
  assert.equal(view.instance.dialog.open,false);
  view.unmount();
});

test('appearance mutation with missing or denied evaluator sends no request', async () => {
  const { c, app, server }=setup();
  for (const can of [undefined,()=>false]) {
    app.can=can;
    await assert.rejects(c.AssetAppearanceApi.restore(app),e=>e.status===403);
    assert.equal(server.calls.length,0);
  }
});

test('local configuration hides denied mutations and wrappers leave state unchanged', async () => {
  const { app, mount, c }=setup();
  app.authenticated=false; app.can=()=>false;
  const before=JSON.stringify(app.assetAdmin);
  for(const name of ['AssetFieldsPanel','AssetFormsPanel','AssetStatusesPanel','AssetIdentityPanel']) {
    const view=mount(name);
    assert.equal(view.instance.canEdit,false,name);
    assert.equal(nodes(view.root,n=>n.tag==='button'&&/icon-button--danger/.test(n.props.class||'')).length,0,name);
    view.unmount();
  }
  app.requestDeleteAssetField(app.assetAdmin.fields[0]);
  assert.equal(JSON.stringify(app.assetAdmin),before);
  assert.equal(app.confirmDialog.open,false);
  app.can=p=>p==='assets.edit';
  const view=mount('AssetFieldsPanel');
  assert.equal(view.instance.canEdit,true);
  view.unmount();
  c.AssetAdminMethods.requestDeleteAssetField.call(app,app.assetAdmin.fields[0]);
  assert.equal(app.confirmDialog.open,true,'existing destructive confirmation remains');
  assert.equal(JSON.stringify(app.assetAdmin),before,'request does not mutate data');
});

test('snapshot restores only own admitted data fields, not root prefs, methods or child controls', () => {
  const { app, c }=setup();
  const methods=c.AssetWorkspaceRuntime.methods;
  app.route={name:'panel'};
  const filters={period:'7d',search:'safe'};
  const child={$options:c.AssetPanel.PanelOverview,filters:{period:'24h'},customize:false,reports:false};
  app.$refs={workspaceView:child};
  const before=methods.restoreWorkspaceView;
  methods.restoreWorkspaceView.call(app,{name:'Saved',route:'panel',snapshot:JSON.parse('{"filters":{"period":"7d","search":"safe"},"customize":true,"reports":true,"downloadReport":"owned","__proto__":{"x":1}}')});
  assert.deepEqual(plain(child.filters),filters);
  assert.equal(child.customize,false);assert.equal(child.reports,false);
  assert.equal(Object.hasOwn(child,'downloadReport'),false);
  assert.equal(methods.restoreWorkspaceView,before);
  const u=c.AssetWorkspace.user(app.workspaceState,app.workspaceUserId);
  assert.deepEqual(Object.keys(u.lastViews.panel),['filters']);
  app.route={name:'inventory'};
  const prefsBefore=app.prefs.theme;
  methods.restoreWorkspaceView.call(app,{name:'Inventory',route:'inventory',snapshot:{prefs:{search:'legitimate',category:'all',theme:'forged',__proto__:{x:1}},inventory:{status:'all',location:'loc',unexpected:1},selection:[]}});
  assert.equal(app.prefs.search,'legitimate');assert.equal(app.prefs.theme,prefsBefore);
  assert.deepEqual(plain(app.workspaceInventory),{status:'all',location:'loc'});
});

test('local deletion keeps existing dialog with production-only typed reason, not a new workflow', () => {
  const { app, c }=setup();
  app.authenticated=false;
  app.assets=[{id:'fictional-1',name:'Fixture',tech:{}}];
  const before=JSON.stringify(app.assets);
  c.AssetAdminMethods.openDeleteAsset.call(app,app.assets[0]);
  assert.equal(app.deleteDialog.open,true);
  assert.equal(JSON.stringify(app.assets),before);
  assert.equal(app.deleteDialog.typed,'');
  assert.equal(c.AssetAdminMethods.deleteAssetIsProtected.call(app),false);
  app.assetAdmin.operations.mode='production';
  assert.equal(c.AssetAdminMethods.deleteAssetIsProtected.call(app),true);
  c.AssetAdminMethods.confirmDeleteAsset.call(app);
  assert.equal(JSON.stringify(app.assets),before);
  assert.ok(app.deleteDialogError);
});
