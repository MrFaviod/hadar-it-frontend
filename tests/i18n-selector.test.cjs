'use strict';
// S2: the language selector is one accessible control reused by the login
// screen, the demo notice and the user's profile menu. Anonymous choices are a
// local preference; a signed-in choice is saved by the root through the
// identity API, so the control itself never writes a user preference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, textOf } = require('./i18n-harness.cjs');

const ROOT = path.join(__dirname, '..');

test('S2 the control is a native select inside its own label', async () => {
  const { ItsmI18n, mount, textOf: render } = await setup();
  await ItsmI18n.ready;
  const ui = mount(ItsmI18n.LocaleSelect);

  assert.equal(ui.instance.label, 'Idioma', 'the control has a visible, translated label');
  assert.deepEqual(ui.instance.options.map((option) => option.tag), ['es', 'en'], 'the installed languages are offered');
  assert.deepEqual(ui.instance.options.map((option) => option.name), ['Español', 'English'], 'each option is named in its own language');
  assert.equal(ui.instance.active, 'es', 'the current locale is selected');

  const select = find(ui.root, (node) => node.tag === 'select');
  assert.ok(select, 'the control uses a native select');
  const label = find(ui.root, (node) => node.tag === 'label');
  assert.ok(label, 'the select is wrapped by a label');
  assert.ok(contains(label, select), 'the label wraps the select, so the accessible name is the visible text');
  assert.equal(select.props.tabindex, undefined, 'the control stays in the tab order');
  assert.match(render(ui.root), /Idioma/);
  ui.unmount();
});

test('S2 an anonymous change persists the preference and re-renders in place', async () => {
  const { ItsmI18n, mount, store } = await setup();
  await ItsmI18n.ready;
  const ui = mount(ItsmI18n.LocaleSelect);

  ui.instance.change({ target: { value: 'en' } });
  await sleep();

  assert.equal(store.get('itsm.locale'), 'en', 'the anonymous choice is kept as a preference');
  assert.equal(ItsmI18n.activeLocale, 'en');
  assert.equal(ui.instance.active, 'en', 'the control shows the new locale without a remount');
  assert.equal(ui.instance.label, 'Language', 'its label switches language too');
  ui.unmount();
});

test('S2 the signed-in control delegates the save to the root', async () => {
  const { ItsmI18n } = await setup();
  await ItsmI18n.ready;
  const roots = [];
  const root = {
    changeLocale(tag) {
      roots.push(tag);
    }
  };

  ItsmI18n.LocaleSelect.methods.change.call({ $root: root }, { target: { value: 'en' } });
  assert.deepEqual(roots, ['en'], 'the root owns the profile save, not the control');
  assert.equal(ItsmI18n.activeLocale, 'es', 'the control never mutates the locale by itself');

  // Without a root handler (anonymous shell) the control falls back to the
  // local preference instead of silently doing nothing.
  ItsmI18n.LocaleSelect.methods.change.call({ $root: {} }, { target: { value: 'en' } });
  assert.equal(ItsmI18n.activeLocale, 'en');
});

test('S2 the login screen, the demo notice and the profile menu mount the selector', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const login = slice(html, "route.name === 'login'", '<div v-else class="app-shell"');
  const topbar = slice(html, '<header class="topbar">', '<main id="main-content"');
  const sidebar = slice(html, '<aside id="app-sidebar"', '<header class="topbar">');

  assert.match(login, /<locale-select>/, 'the language can be changed before authenticating');
  assert.match(topbar, /<locale-select>/, 'the user profile menu holds the signed-in selector');
  assert.match(sidebar, /\$t\('ui\.shell\.nav_aria'\)/, 'the navigation is catalog-backed');

  const notice = /<p\b[^>]*v-if="demoMode"[^>]*>[\s\S]*?<\/p>/.exec(html);
  assert.ok(notice, 'the demo notice exists');
  assert.match(notice[0], /<locale-select/, 'the demo notice offers the selector without a session');
  assert.match(notice[0], /\$t\('ui\.shell\.demo_mode'\)/, 'its copy is catalog-backed');
});

function sleep() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function find(root, predicate) {
  let found = null;
  walk(root, (node) => {
    if (!found && predicate(node)) found = node;
  });
  return found;
}

function contains(root, target) {
  let found = false;
  walk(root, (node) => {
    if (node === target) found = true;
  });
  return found;
}

function slice(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from !== -1, 'missing start marker ' + start);
  const to = text.indexOf(end, from);
  assert.ok(to !== -1, 'missing end marker ' + end);
  return text.slice(from, to);
}
