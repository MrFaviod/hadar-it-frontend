'use strict';
// T2 (S6): every monetary value the asset screens render goes through the
// installation currency of the i18n runtime. The server inventory DTO
// serializes cost as a decimal string ("1500000.00"), so the display must never
// leak that raw string in any language.
const test = require('node:test'), assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

const MARKET = {
  id: 'a7e4c1f0-0001-4f10-9a10-000000000001',
  name: 'Servidor Canónico',
  quickCode: 'SRV-001',
  status: 'in_use',
  statusTone: 'on',
  cost: '1500000.00'
};

// The economic group is authoritative production markup: it is sliced from the
// shipped entry template instead of copied, so the mounted component renders
// exactly what the browser renders.
function economicSection(html) {
  const start = html.indexOf('<section v-if="!serverAssetMode || currentAsset.cost" class="detail-group"');
  assert.ok(start >= 0, 'the economic detail group is present in index.html');
  const end = html.indexOf('</section>', start) + '</section>'.length;
  return html.slice(start, end);
}

function textOf(node) {
  if (!node) return '';
  const own = typeof node.text === 'string' ? node.text : '';
  return [own].concat((node.children || []).map(textOf)).filter(Boolean).join(' ');
}

function mountEconomicDetail(s) {
  // The root template owns the asset detail; registering the shipped group as a
  // component exercises its real bindings with the real formatter method.
  s.c.options.components.AssetEconomicDetailFixture = {
    template: economicSection(s.html),
    props: ['serverAssetMode', 'currentAsset', 'formatCurrency']
  };
  return s.mount('AssetEconomicDetailFixture', {
    serverAssetMode: true,
    currentAsset: MARKET,
    formatCurrency: s.app.formatCurrency
  });
}

test('the asset detail renders the server cost in the installation currency, never the raw decimal string', async () => {
  const s = setup();
  await s.settle();
  assert.equal(s.c.ItsmI18n.currency, 'PYG', 'the installation currency defaults to PYG');
  assert.equal(s.c.ItsmI18n.activeLocale, 'es');

  const es = mountEconomicDetail(s);
  await s.settle();
  const esText = textOf(es.root);
  assert.doesNotMatch(esText, /1500000/, 'Spanish never shows the raw server decimal');
  assert.match(esText, /1[.\u00a0]500[.\u00a0]000/, 'Spanish groups the amount with its own separators');
  assert.match(esText, /PYG|Gs\./, 'Spanish shows the installation currency code');
  es.unmount();

  s.c.ItsmI18n.setLocale('en');
  await s.settle();
  assert.equal(s.c.ItsmI18n.activeLocale, 'en');
  const en = mountEconomicDetail(s);
  await s.settle();
  const enText = textOf(en.root);
  assert.doesNotMatch(enText, /1500000/, 'English never shows the raw server decimal');
  assert.match(enText, /1,500,000/, 'English groups the amount with English separators');
  assert.match(enText, /PYG/, 'English shows the installation currency code');
  en.unmount();

  assert.deepEqual(s.errors, []);
});

function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

test('the asset editor keeps the raw numeric cost in the input and only labels the currency', async () => {
  const s = setup();
  await s.settle();
  const draft = { cost: '1500000.00', site: '', locationId: '', assigneeId: '', statusId: '', description: '', technical: {} };
  s.c.options.components.AssetCostField = s.c.AssetEditor.components.AssetCommonField;
  const field = s.mount('AssetCostField', { app: s.app, draft, fieldKey: 'cost', errors: {}, idPrefix: 'asset' });
  await s.settle();
  const input = findNode(field.root, node => node.tag === 'input');
  assert.ok(input, 'the cost control is an input');
  assert.equal(String(input.props.value), '1500000.00', 'a number input keeps the stable raw value');
  const labels = textOf(field.root);
  assert.match(labels, /PYG|Gs\./, 'the control states the installation currency');
  field.unmount();
  assert.deepEqual(s.errors, []);
});
