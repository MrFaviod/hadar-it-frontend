'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./universal-harness.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const nodes = (root, predicate) => {
  const result = [];
  const visit = node => { if (predicate(node)) result.push(node); for (const child of node.children || []) visit(child); };
  visit(root); return result;
};
const text = node => (node.text || '') + (node.children || []).map(text).join('');

test('transfer renders named accessible steps without a subtitle for each step', async () => {
  const ui = setup();
  ui.c.options.components.TransferImport = ui.c.AssetTransferViews.TransferImport;
  const mounted = ui.mount('TransferImport');
  await ui.settle();
  const steps = nodes(mounted.root, node => node.tag === 'button' && String(node.props['data-od-id'] || '').startsWith('transfer-step-'));
  assert.equal(steps.length, 5);
  assert.ok(steps.every(node => node.props['aria-label'] && text(node).trim()));
  assert.equal(nodes(mounted.root, node => node.tag === 'small' && node.parent && String(node.parent.props.class || '').includes('tx-step__text')).length, 0);
  assert.equal(nodes(mounted.root, node => node.tag === 'p' && !String(node.props.class || '').includes('eyebrow') && node.parent && String(node.parent.parent?.props.class || '').includes('tx-panel__head')).length, 0);
  mounted.unmount();
  assert.deepEqual(ui.errors, []);
});

test('movement and bulk step navigators use labels without explanatory subtitles', () => {
  assert.doesNotMatch(read('assets/js/operations-views.js'), /<small>\{\{ item\.hint \}\}<\/small>/);
  assert.match(read('assets/js/operations-views.js'), /:aria-current="step === item.id \? 'step' : null"/);
});

test('configuration and routine headings do not repeat the action in a paragraph', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<small>\{\{ section\.hint \}\}<\/small>|\$t\('ui\.shell\.config_lead'\)|\$t\('ui\.catalog\.general\.body'\)/);
  const appearance = read('assets/js/appearance-views.js');
  for (const key of ['settings.lead', 'settings.presets_lead', 'settings.preview_lead']) assert.ok(!appearance.includes("$t('ui.appearance." + key + "')"));
  assert.match(appearance, /restorePrompt/);
  assert.match(appearance, /role="alert"/);
});

test('AI guidance keeps actionable failures and security scope, not a technical essay above every section', () => {
  const source = read('assets/js/agent-integrations.js');
  assert.ok(!source.includes("$t('ui.agents.settings_lead')"));
  assert.ok(!source.includes("$t('ui.agents.wizard_receipt_hint')"));
  assert.match(source, /role="alert"/);
  assert.match(source, /provider-key-help/);
  assert.match(source, /wizard_remote_request/);
  assert.match(read('assets/js/transfer-views.js'), /ui.transfer.confirm.lead/);
});
