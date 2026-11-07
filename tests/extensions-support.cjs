'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function makeLocation(origin) {
  return {
    origin,
    hash: '',
    href: origin + '/',
    pathname: '/',
    search: '',
    assign(value) { this.href = value; },
    replace(value) { this.href = value; }
  };
}

function makeDocument() {
  const head = {
    children: [],
    appendChild(node) {
      node.parentNode = head;
      head.children.push(node);
      return node;
    },
    removeChild(node) {
      const index = head.children.indexOf(node);
      if (index !== -1) head.children.splice(index, 1);
      node.parentNode = null;
      return node;
    }
  };
  return {
    head,
    body: { appendChild() {} },
    documentElement: {},
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        dataset: {},
        attributes: {},
        parentNode: null,
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() {
          if (this.parentNode) this.parentNode.removeChild(this);
        }
      };
    },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createSandbox(options) {
  const origin = (options && options.origin) || 'https://itsm.example';
  const window = {
    location: makeLocation(origin),
    history: {
      replaceState(_state, _title, url) { window.location.hash = String(url).replace(/^.*?#/, '#'); }
    },
    localStorage: { removeItem() {}, getItem() { return null; }, setItem() {} },
    sessionStorage: { removeItem() {}, getItem() { return null; }, setItem() {} },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    console,
    URL,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    Error,
    Intl,
    Date,
    Math,
    JSON
  };
  window.window = window;
  window.self = window;
  window.document = makeDocument();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const sandbox = {
    window,
    document: window.document,
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Intl,
    Promise,
    Error,
    Date,
    Math,
    JSON
  };
  const context = vm.createContext(sandbox);
  return { window, context, sandbox };
}

function evaluate(env, relativePath, filename) {
  const absolute = path.join(ROOT, relativePath);
  const code = fs.readFileSync(absolute, 'utf8');
  return vm.runInContext(code, env.context, { filename: filename || relativePath });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function digest(fill) {
  return String(fill || 'a').repeat(64).slice(0, 64);
}

function mountThroughShell(c, component, props) {
  const Vue = c.Vue;
  const errors = [];
  const teleportRoot = { children: [] };
  const host = {
    createElement: (tag) => ({ tag, props: {}, children: [], parent: null, style: {},
      addEventListener() {}, removeEventListener() {}, focus() {} }),
    createText: (text) => ({ tag: '#text', text, children: [] }),
    createComment: (text) => ({ tag: '#comment', text, children: [] }),
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    patchProp(node, key, _old, value) { node.props[key] = value; },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node);
      node.parent = parent;
    },
    remove(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    querySelector: () => teleportRoot,
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent ? node.parent.children[node.parent.children.indexOf(node) + 1] || null : null
  };
  const root = { children: [] };
  const application = Vue.createRenderer(host).createApp(component, props || {});
  application.config.errorHandler = (error) => errors.push(error);
  const mount = application.mount.bind(application);
  let instance;
  application.mount = () => { instance = mount(root); return instance; };
  c.Vue = { ...Vue, createApp: () => application };
  try { c.mountAssetApp('#app'); } finally { c.Vue = Vue; }
  return { root, errors, instance, unmount: () => application.unmount() };
}

module.exports = { ROOT, createSandbox, evaluate, deferred, digest, mountThroughShell };
