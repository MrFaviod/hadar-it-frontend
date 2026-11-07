'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));

function reportsFixture(t) {
  const { c, app, mount } = harness.setup();
  app.phase9LoadTemplates = async () => false;
  app.phase9LoadSelection = async () => false;
  app.phase9LoadJobs = async () => false;
  const mounted = mount('ReportsCenter', { app });
  t.after(() => mounted.unmount());
  return { c, app, view: mounted.instance };
}

test('report request sends canonical family fields, actor filter and top-level group', (t) => {
  const { c, view } = reportsFixture(t);
  const engine = c.AssetReportEngine;

  view.family = 'history';
  view.draft = engine.createTemplate('history');
  view.group = 'site';
  view.filters.actor = 'Ana Canónica';
  view.explicit = true;
  view.ids = ['5a1e0c10-0001-4f10-9a10-000000000001'];

  const request = view.request('pdf');
  assert.deepEqual(plain(request.fields), [
    'quickCode', 'action', 'actor', 'effectiveAt', 'entityType', 'changes', 'notes'
  ]);
  assert.equal(request.group, 'site');
  assert.equal(request.filters.actor, 'Ana Canónica');
  assert.equal(request.template.family, 'history');
  assert.equal(request.template.fields.includes('action'), true);
  assert.equal(request.template.fields.includes('purchaseCost'), false);

  view.family = 'warranty';
  view.draft = engine.createTemplate('warranty');
  const warranty = view.request('xlsx');
  assert.deepEqual(plain(warranty.fields), [
    'quickCode', 'name', 'category', 'site', 'supplier', 'purchaseDate',
    'expiresOn', 'coverage', 'receiptId', 'notes'
  ]);
  assert.equal(warranty.output, 'xlsx');
  assert.equal(warranty.group, 'site');
});

test('family field options stay inside the server allowlist and preserve group list', (t) => {
  const { c, view } = reportsFixture(t);
  const engine = c.AssetReportEngine;

  view.draft = engine.createTemplate('history');
  assert.deepEqual(plain(view.fieldOptions.map((field) => field.key)), plain(engine.HISTORY_FIELDS.map((field) => field.key)));
  assert.deepEqual(plain(view.groupOptions.map((item) => item.value)), ['none', 'category', 'site', 'responsible', 'location', 'status']);

  view.draftFamilyChanged = view.draftFamilyChanged.bind(view);
  view.draft.family = 'warranty';
  view.draftFamilyChanged();
  assert.deepEqual(plain(view.draft.fields), plain(engine.familyFields('warranty')));

  const normalized = engine.normalizeTemplate({
    family: 'history', name: 'Historial', blocks: [{ id: 'b1', type: 'table' }],
    fields: ['action', 'purchaseCost', 'actor']
  });
  assert.deepEqual(plain(normalized.fields), ['action', 'actor']);
});

test('label options use the server vocabulary and do not send label fields as report fields', (t) => {
  const { c, view } = reportsFixture(t);
  const label = c.AssetLabelEngine;
  assert.deepEqual(plain(label.LABEL_FIELDS.map((field) => field.key)), [
    'logo', 'name', 'id', 'code', 'qr', 'site', 'location', 'serial'
  ]);
  assert.deepEqual(plain(label.defaultLabelOptions({}).fields), ['logo', 'name', 'code', 'qr']);
  const wire = label.wireLabelOptions({ fields: ['name', 'code'], columns: 3, rows: 8 });
  assert.deepEqual(plain(wire.fields), ['name', 'code']);
  assert.equal(wire.columns, 3);
  assert.equal('rows' in wire, false);

  const component = c.AssetLabelViews.LabelsCenter;
  const labelView = { label: label.defaultLabelOptions({}), explicit: false, ids: [], filters: {} };
  const request = component.methods.request.call(labelView);
  assert.deepEqual(plain(request.fields), []);
  assert.deepEqual(plain(request.labels.fields), ['logo', 'name', 'code', 'qr']);
  assert.match(component.template, /max="50"/);
  assert.doesNotMatch(component.template, /max="200"/);
  assert.doesNotMatch(component.template, /max="20"/);
});

test('private and public report reads use canonical routes and server field authority', async () => {
  const { c, app } = harness.setup();
  const calls = [];
  c.AssetAccess.request = async (vm, path) => {
    calls.push(path);
    if (path.indexOf('/public/') === 0) {
      return {
        asset: { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Router público' },
        fields: ['quickCode', 'purchaseCost', 'name', 'status'],
        expiresAt: '2026-12-01T00:00:00Z'
      };
    }
    return {
      asset: { id: '5a1e0c10-0001-4f10-9a10-000000000001', name: 'Router' },
      fields: ['quickCode', 'purchaseCost', 'technical', 'secret', 'action']
    };
  };

  const loaded = await app.phase9LoadPrivateReport('5a1e0c10-0001-4f10-9a10-000000000001');
  assert.equal(loaded, true);
  assert.equal(calls[0], '/reports/assets/5a1e0c10-0001-4f10-9a10-000000000001');
  assert.deepEqual(plain(app.phase9.privateReport.fields), ['quickCode', 'purchaseCost', 'technical']);

  const token = 'share-token-0123456789abcdef';
  const anonymous = await app.phase9LoadPublicReport(token);
  assert.equal(anonymous, true);
  assert.equal(calls[1], '/public/' + token);
  assert.deepEqual(plain(app.phase9.publicReport.fields), ['quickCode', 'name', 'status']);
  assert.equal(app.phase9.publicReport.asset.name, 'Router público');
});

test('request builder references pristine server templates and never inlines reserved builtin ids', (t) => {
  const { c, app, view } = reportsFixture(t);
  const engine = c.AssetReportEngine;
  const builtin = engine.normalizeTemplate({
    id: 'inventory-list',
    builtin: true,
    name: 'Inventario · listado',
    family: 'inventory',
    mode: 'list',
    format: 'A4',
    fields: engine.familyFields('inventory'),
    logo: true,
    images: false,
    version: 1,
    blocks: [{ id: 'table', type: 'table', label: 'Activos' }]
  });
  app.phase9.templates.items = [builtin];
  view.chooseTemplate('inventory-list');

  const pristine = view.request('pdf');
  assert.equal(pristine.templateId, 'inventory-list');
  assert.equal(pristine.template, null);

  view.draft.name = 'Copia editada';
  const edited = view.request('pdf');
  assert.equal(edited.templateId, null);
  assert.notEqual(edited.template.id, 'inventory-list');
  assert.match(edited.template.id, /^custom-/);
  assert.equal(edited.template.name, 'Copia editada');

  view.newTemplate();
  const unsaved = view.request('pdf');
  assert.equal(unsaved.templateId, null);
  assert.match(unsaved.template.id, /^custom-/);
  assert.notEqual(unsaved.template.id, edited.template.id);
});
