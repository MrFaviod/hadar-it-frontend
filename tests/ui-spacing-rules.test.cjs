'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('index.html');

test('the operational composition layer follows the domain styles', () => {
  assert.ok(html.indexOf('assets/css/composition.css') > html.indexOf('assets/css/workspace.css'));
});

test('inventory gives query, presentation and results their own layout owners', () => {
  const inventory = html.slice(html.indexOf("route.name === 'inventory'"), html.indexOf('<!-- Conversación -->'));
  for (const name of ['inventory-page', 'inventory-query', 'inventory-presentation', 'inventory-results']) {
    assert.ok(inventory.includes(name), 'missing grouping ' + name);
  }
  assert.ok(inventory.indexOf('inventory-query') < inventory.indexOf('inventory-restored-filters'));
  assert.ok(inventory.indexOf('inventory-results') < inventory.indexOf('class="results-bar"'));
});

test('warranties keep filtering and result states together without changing bindings', () => {
  const source = read('assets/js/warranty-views.js');
  assert.match(source, /class="warranty-results"/);
  assert.match(source, /class="warranty-filters"/);
  for (const binding of ['v-model="search"', 'v-model="site"', 'v-model="category"', 'v-model="provider"', 'role="status"', 'role="alert"']) {
    assert.ok(source.includes(binding), 'lost ' + binding);
  }
});

test('reports group mode and family selection without touching document geometry', () => {
  assert.match(read('assets/js/report-views.js'), /class="report-selection"/);
  const css = read('assets/css/composition.css');
  assert.doesNotMatch(css, /\.doc-paper|\.doc-page\b|\bmm\b|!important/);
});
