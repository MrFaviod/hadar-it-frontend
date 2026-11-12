'use strict';
// MapLibre (803 KB script, 65 KB stylesheet) is used only by the map views, so
// the shell does not load it at boot; the first map mount loads it once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mapViews = fs.readFileSync(path.join(root, 'assets', 'js', 'map-views.js'), 'utf8');

test('the shell does not load MapLibre at boot', () => {
  assert.doesNotMatch(html, /<script src="assets\/vendor\/maplibre-gl\.js"/);
  assert.doesNotMatch(html, /<link rel="stylesheet" href="assets\/vendor\/maplibre-gl\.css"/);
});

test('map views load MapLibre on demand through one cached promise', () => {
  assert.match(mapViews, /function loadMapLibre\(\)/);
  assert.match(mapViews, /assets\/vendor\/maplibre-gl\.js/);
  assert.match(mapViews, /assets\/vendor\/maplibre-gl\.css/);
  assert.match(mapViews, /mapLibreReady = null;/, 'a failed load must clear the cached promise');
  assert.match(mapViews, /loadMapLibre\(\)\.then\(\(\) => this\.initMap\(\)/);
  assert.match(mapViews, /loadMapLibre\(\)\.then\(\(\) => this\.mountFloorMap\(\)/);
});
