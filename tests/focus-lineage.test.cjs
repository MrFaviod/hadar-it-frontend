'use strict';
// Shared dialog focus lineage: ModalShell and SearchPalette must agree on the
// invoker to restore when an intermediate dialog owner disappears. The helper
// is loaded when present, so the same assertions also run against the pre-fix
// product (helper absent) as a RED witness.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

function load() {
  const doc = { activeElement: null, body: { style: { overflow: '' } }, contains: (target) => !target || target.connected !== false };
  const sandbox = { window: { AppIcon: {}, ItsmI18n: { t: (key) => key }, AssetSearch: {} }, document: doc, console, setTimeout, clearTimeout };
  for (const file of ['scroll-lock.js', 'dialog-focus.js', 'components.js', 'search-views.js']) {
    const full = path.join('assets', 'js', file);
    if (fs.existsSync(full)) vm.runInNewContext(fs.readFileSync(full, 'utf8'), sandbox);
  }
  return { modal: sandbox.window.ModalShell, palette: sandbox.window.AssetSearchViews.SearchPalette, lock: sandbox.window.AssetScrollLock, focus: sandbox.window.AssetDialogFocus, doc };
}

function focusable(doc, id, dialog) {
  return {
    id, connected: true, focusCount: 0,
    focus() { this.focusCount += 1; doc.activeElement = this; },
    blur() { doc.activeElement = doc.body; },
    closest(selector) { return selector === 'dialog' ? (dialog || null) : null; }
  };
}

function fakeDialog(doc) {
  return {
    open: false, input: null,
    showModal() { this.open = true; },
    close() { this.open = false; },
    setAttribute() { this.open = true; },
    removeAttribute() { this.open = false; },
    contains(target) { return target === this.input; },
    querySelector(selector) { return selector === '.modal__body' ? { querySelector: () => this.input } : this.input; },
    focus() { doc.activeElement = this; }
  };
}

function modalInstance(env, id) {
  const dialog = fakeDialog(env.doc);
  dialog.input = focusable(env.doc, id, dialog);
  const instance = Object.assign(env.modal.data(), { open: true, $refs: { dialog }, $emit() {}, $nextTick(fn) { if (fn) fn(); }, $slots: {} });
  for (const [key, fn] of Object.entries(env.modal.methods)) instance[key] = fn.bind(instance);
  return { instance, dialog };
}

function paletteInstance(env, id) {
  const panel = { open: false, input: null, showModal() { this.open = true; }, close() { this.open = false; }, setAttribute() { this.open = true; }, removeAttribute() { this.open = false; }, contains(target) { return target === this.input; }, querySelector: () => null };
  const input = focusable(env.doc, id, panel);
  panel.input = input;
  const instance = Object.assign(env.palette.data(), { $root: {}, $emit() {}, $nextTick(fn) { if (fn) fn(); }, $refs: { panel, input } });
  for (const [key, fn] of Object.entries(env.palette.methods)) instance[key] = fn.bind(instance);
  return { instance, panel, input };
}

test('unmounting a lower ModalShell under an open SearchPalette keeps focus and the final close restores the outside opener', () => {
  const env = load();
  const opener = focusable(env.doc, 'opener');
  env.doc.activeElement = opener;
  env.doc.body.style.overflow = 'clip';

  const { instance: shell, dialog: shellDialog } = modalInstance(env, 'nested-trigger');
  const nested = shellDialog.input;
  shell.activate();
  assert.equal(env.doc.activeElement, nested, 'ModalShell focuses its first control');
  const { instance: search, input: query } = paletteInstance(env, 'universal-query');
  search.activate();
  assert.equal(env.doc.activeElement, query, 'SearchPalette focuses its query input');

  nested.connected = false; // the lower dialog subtree leaves the document
  env.modal.beforeUnmount.call(shell);
  assert.equal(opener.focusCount, 0, 'closing the lower owner never steals focus from the open upper dialog');
  assert.equal(env.doc.activeElement, query, 'focus stays inside the top dialog');

  search.deactivate();
  assert.equal(env.doc.activeElement, opener, 'the final close restores the still-connected original opener');
  assert.equal(env.doc.body.style.overflow, 'clip', 'the shared lock restores the original overflow');
  assert.equal(env.lock.locks, 0);
  if (env.focus) assert.equal(env.focus.size, 0, 'no stale focus frame remains');
});

test('closing a lower same-type sibling via open=false does not steal focus, and the upper close still restores the opener', () => {
  const env = load();
  const opener = focusable(env.doc, 'opener');
  env.doc.activeElement = opener;
  const first = modalInstance(env, 'first-input');
  first.instance.activate();
  assert.equal(env.doc.activeElement, first.dialog.input);
  const second = modalInstance(env, 'second-input');
  second.instance.activate();
  assert.equal(env.doc.activeElement, second.dialog.input);

  first.instance.open = false;
  env.modal.watch.open.call(first.instance, false);
  assert.equal(opener.focusCount, 0, 'the lower shell does not pull focus out of the upper shell');
  assert.equal(env.doc.activeElement, second.dialog.input);

  second.instance.open = false;
  env.modal.watch.open.call(second.instance, false);
  assert.equal(env.doc.activeElement, opener, 'the last close returns the original opener');
});

test('closing the upper dialog first returns focus to the lower dialog, then to the opener', () => {
  const env = load();
  const opener = focusable(env.doc, 'opener');
  env.doc.activeElement = opener;
  const { instance: shell } = modalInstance(env, 'nested-trigger');
  shell.activate();
  const nested = shell.$refs.dialog.input;
  const { instance: search, input: query } = paletteInstance(env, 'universal-query');
  search.activate();
  assert.equal(env.doc.activeElement, query);

  search.deactivate();
  assert.equal(env.doc.activeElement, nested, 'the upper dialog returns to its invoker inside the lower dialog');
  env.modal.beforeUnmount.call(shell);
  assert.equal(env.doc.activeElement, opener, 'the lower dialog still returns to the opener');
});

test('removing the remembered opener never focuses a detached node or throws', () => {
  const env = load();
  const opener = focusable(env.doc, 'opener');
  env.doc.activeElement = opener;
  const { instance: shell, dialog: shellDialog } = modalInstance(env, 'nested-trigger');
  shell.activate();
  const { instance: search } = paletteInstance(env, 'universal-query');
  search.activate();
  opener.connected = false;
  shellDialog.input.connected = false;
  env.modal.beforeUnmount.call(shell);
  assert.doesNotThrow(() => search.deactivate());
  assert.equal(opener.focusCount, 0, 'a detached opener is never focused');
  assert.equal(env.doc.activeElement, env.doc.body, 'the documented fallback blurs the dead control; body is never focused explicitly');
});

test('repeated mixed open/close cycles leave no stale focus frame', () => {
  const env = load();
  const opener = focusable(env.doc, 'opener');
  env.doc.activeElement = opener;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const { instance: shell, dialog: shellDialog } = modalInstance(env, 'nested-' + cycle);
    shell.activate();
    const { instance: search, input: query } = paletteInstance(env, 'query-' + cycle);
    search.activate();
    shellDialog.input.connected = false;
    env.modal.beforeUnmount.call(shell);
    assert.equal(env.doc.activeElement, query, `cycle ${cycle} keeps focus in the top dialog`);
    search.deactivate();
    assert.equal(env.doc.activeElement, opener, `cycle ${cycle} restores the opener`);
  }
  assert.equal(opener.focusCount, 3, 'one restoration per completed cycle');
  if (env.focus) assert.equal(env.focus.size, 0, 'no frame survives the cycles');
});
