'use strict';
// The add-plan dialog is modal: Escape must close it and focus must start inside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'map-config-views.js'), 'utf8');

test('plan dialog closes on Escape', () => {
  assert.match(src, /class="map-dialog" role="dialog" aria-modal="true"[^>]*@keydown\.esc="closePlanDialog"/);
});

test('plan dialog moves focus to its first field on open', () => {
  assert.match(src, /v-model="planDialog\.name" type="text" autofocus/);
});
