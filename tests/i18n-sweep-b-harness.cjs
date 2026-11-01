'use strict';
// Sweep B components live in the real app script chain, so the universal
// harness supplies their dependencies. The universal mount intentionally omits
// vue-i18n; sweep B views call $t, so this adapter registers the global plugin
// and the app components the same way app.js does before mounting.
const { setup } = require('./universal-harness.cjs');

function createHost() {
  return {
    createElement: (tag) => ({ tag, tagName: String(tag).toUpperCase(), props: {}, children: [], parent: null, style: {}, selected: false, multiple: false, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 560, width: 960, height: 560 }), focus() {}, blur() {}, querySelector() { return null; }, closest() { return null; } }),
    createText: (text) => ({ tag: '#text', text, children: [], get nodeValue() { return this.text; }, set nodeValue(value) { this.text = value; } }),
    createComment: (text) => ({ tag: '#comment', text, children: [] }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    patchProp: (node, key, _old, value) => { node.props[key] = value; },
    insert(node, parent, anchor) {
      if (node.parent) {
        const index = node.parent.children.indexOf(node);
        if (index >= 0) node.parent.children.splice(index, 1);
      }
      const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
      if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, node);
      else parent.children.push(node);
      node.parent = parent;
    },
    remove(node) {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      if (!node.parent) return null;
      return node.parent.children[node.parent.children.indexOf(node) + 1] || null;
    }
  };
}

function adapt(component) {
  if (!component || typeof component !== 'object') return component;
  const out = { ...component, components: { ...(component.components || {}) } };
  if (out.template) out.template = out.template.replace(/<transition name="fade">/g, '<template>').replace(/<\/transition>/g, '</template>');
  for (const [key, value] of Object.entries(out.components)) {
    out.components[key] = key === 'ModalShell'
      ? { props: ['open'], template: '<div v-if="open"><slot></slot><slot name="footer"></slot></div>' }
      : adapt(value);
  }
  return out;
}

function open() {
  const harness = setup();
  const c = harness.c;
  for (const [key, component] of Object.entries(c.options.components || {})) {
    if (!key || key === 'ModalShell') continue;
    c.Vue.createRenderer(createHost()).createApp({}).component(key, component);
  }
  function mount(name, props = {}) {
    const source = c.options.components[name];
    if (!source) throw new Error(name + ' is not registered');
    const app = c.Vue.createRenderer(createHost()).createApp(adapt(source), { app: harness.app, ...props });
    app.use(c.ItsmI18n.i18n);
    app.component('ModalShell', { props: ['open'], template: '<div v-if="open"><slot></slot><slot name="footer"></slot></div>' });
    for (const [key, component] of Object.entries(c.options.components || {})) {
      if (key === name) continue;
      app.component(key, adapt(component));
    }
    const root = { children: [] };
    const instance = app.mount(root);
    return { root, instance, unmount: () => app.unmount() };
  }
  return { ...harness, mount };
}

module.exports = { open };
