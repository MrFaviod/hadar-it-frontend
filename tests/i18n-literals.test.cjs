'use strict';
// S10/D3 guard rail: the amount of human-visible hard-coded copy may only go
// down. Every localized region lowers this baseline; new literal copy fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanRepository, ROOT } = require('./i18n-literals-scanner.cjs');

const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/i18n-literals-baseline.json'), 'utf8'));

test('no file adds human-visible hard-coded copy beyond the baseline', () => {
  const current = scanRepository();
  for (const file of Object.keys(current.files)) {
    assert.ok(file in baseline.files, file + ' is not in tests/i18n-literals-baseline.json; add it with the current count');
  }
  const regressions = Object.keys(baseline.files)
    .filter((file) => (current.files[file] || 0) > baseline.files[file])
    .map((file) => file + ': ' + current.files[file] + ' > baseline ' + baseline.files[file]);
  assert.deepEqual(regressions, [], 'these files added untranslated copy');
});

test('the localized shell no longer contains literal copy in the covered regions', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const covered = [
    'Iniciar sesión', 'Nombre de usuario', 'Mostrar contraseña', 'Ocultar contraseña',
    'Saltar al contenido', 'Navegación principal', 'Espacio de trabajo', 'Modo demostración',
    'Datos del servidor', 'Datos de demostración', 'Buscar o ir a…', 'Abrir configuración'
  ];
  const shellStart = html.indexOf('<div id="app"');
  const shellEnd = html.indexOf('<script src="assets/vendor/', shellStart);
  const shell = html.slice(shellStart, shellEnd);
  // Only the shell regions translated in this task are asserted; other screens
  // keep their Spanish until their own sweep.
  const loginStart = shell.indexOf('route.name === \'login\'');
  const loginEnd = shell.indexOf('<div v-else class="app-shell"', loginStart);
  const login = shell.slice(loginStart, loginEnd);
  const topbarStart = shell.indexOf('<header class="topbar">');
  const topbarEnd = shell.indexOf('<main id="main-content"', topbarStart);
  const topbar = shell.slice(topbarStart, topbarEnd) + shell.slice(shell.lastIndexOf('<aside id="app-sidebar"'), topbarStart);
  for (const literal of ['Iniciar sesión', 'Nombre de usuario', 'Mostrar contraseña', 'Ocultar contraseña']) {
    assert.ok(!login.includes(literal), literal + ' is still hard-coded in the login screen');
  }
  for (const literal of ['Saltar al contenido', 'Navegación principal', 'Espacio de trabajo', 'Modo demostración', 'Datos del servidor', 'Datos de demostración', 'Buscar o ir a…', 'Abrir configuración']) {
    assert.ok(!topbar.includes(literal), literal + ' is still hard-coded in the shell navigation');
  }
  assert.ok(shell.includes('$t('), 'the shell uses catalog keys');
  assert.ok(!covered.some((literal) => shell.includes('>' + literal + '<')), 'shell text nodes are catalog-backed');
});

test('the committed baseline matches the current total or is higher', () => {
  const current = scanRepository();
  assert.ok(current.total <= baseline.total, 'literal copy grew: ' + current.total + ' > ' + baseline.total);
});
