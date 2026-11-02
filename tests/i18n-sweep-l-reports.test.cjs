'use strict';
// Sweep L follow-up: the report center resolves job-state labels, empty states,
// template notices and dates outside its Vue template. Those strings must come
// from `ui.reports.*` at render time, so the runtime and not a frozen module
// constant decides the language.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

async function inLocale(s, locale, run) {
  await s.c.ItsmI18n.loadBundle(locale);
  s.c.ItsmI18n.setLocale(locale);
  await s.tick();
  await s.settle();
  return run();
}

function reportsFixture(t) {
  const s = harness.setup();
  const { app, mount } = s;
  app.phase9LoadTemplates = async () => false;
  app.phase9LoadSelection = async () => false;
  app.phase9LoadJobs = async () => false;
  const mounted = mount('ReportsCenter', { app });
  t.after(() => mounted.unmount());
  return Object.assign(s, { view: mounted.instance });
}

test('report job-state labels follow the active locale', async (t) => {
  const s = reportsFixture(t);
  await inLocale(s, 'es', () => {
    assert.equal(s.view.jobLabel('queued'), 'En cola');
    assert.equal(s.view.jobLabel('running'), 'Generando');
    assert.equal(s.view.jobLabel('completed'), 'Completado');
    assert.equal(s.view.jobLabel('failed'), 'Con errores');
    assert.equal(s.view.jobLabel(''), 'Sin estado');
    // A status the server grows later is still shown verbatim, not translated.
    assert.equal(s.view.jobLabel('archived'), 'archived');
  });
  await inLocale(s, 'en', () => {
    assert.equal(s.view.jobLabel('queued'), 'Queued');
    assert.equal(s.view.jobLabel('running'), 'Generating');
    assert.equal(s.view.jobLabel('completed'), 'Completed');
    assert.equal(s.view.jobLabel('failed'), 'With errors');
    assert.equal(s.view.jobLabel(''), 'No status');
    assert.equal(s.view.jobLabel('archived'), 'archived');
  });
  s.c.ItsmI18n.setLocale('es');
});

test('report output names stay format names in both locales', async (t) => {
  const s = reportsFixture(t);
  await inLocale(s, 'en', () => {
    assert.equal(s.view.outputLabel('pdf'), 'PDF');
    assert.equal(s.view.outputLabel('csv'), 'CSV');
    assert.equal(s.view.outputLabel('xlsx'), 'Excel');
  });
  s.c.ItsmI18n.setLocale('es');
});

test('report dates and sizes follow the active locale', async (t) => {
  const s = reportsFixture(t);
  const stamp = '2026-11-01T12:00:00Z';
  await inLocale(s, 'es', () => {
    const formatted = s.view.date(stamp);
    assert.match(formatted, /nov/i);
    assert.match(s.view.size(2048), /^2[.,]0 KB$/);
  });
  await inLocale(s, 'en', () => {
    const formatted = s.view.date(stamp);
    assert.match(formatted, /nov/i);
    assert.match(formatted, /AM|PM/);
  });
  s.c.ItsmI18n.setLocale('es');
});

test('report template notices read from the catalog at call time', async (t) => {
  const s = reportsFixture(t);
  const engine = s.c.AssetReportEngine;
  const builtin = engine.createTemplate('inventory');
  builtin.id = 'builtin-1';
  builtin.builtin = true;
  s.app.phase9.templates.items = [builtin];
  s.view.templateId = 'builtin-1';
  s.view.draft = engine.clone(builtin);
  s.view.draftInlineId = 'custom-1';
  s.app.phase9SaveTemplate = async () => ({ ok: true, template: { id: 'custom-1' } });
  s.app.phase9LoadTemplates = async () => {
    s.app.phase9.templates.items = [builtin, Object.assign(engine.clone(builtin), { id: 'custom-1', builtin: false })];
    return true;
  };
  s.app.phase9DeleteTemplate = async () => ({ ok: true });
  await inLocale(s, 'en', async () => {
    await s.view.saveTemplate();
    assert.equal(s.view.notice, 'Template saved.');
    assert.equal(s.app.lastToast, 'Reports template saved.');
  });
  await inLocale(s, 'es', async () => {
    await s.view.saveTemplate();
    assert.equal(s.view.notice, 'Plantilla guardada.');
    assert.equal(s.app.lastToast, 'Plantilla de reportes guardada.');
  });
  await inLocale(s, 'en', async () => {
    s.view.templateId = 'custom-1';
    await s.view.removeTemplate();
    assert.equal(s.app.lastToast, 'Template deleted.');
  });
  s.c.ItsmI18n.setLocale('es');
});
