'use strict';
// Compile and execute scripts extracted from the REAL generated srcdoc. VM
// protocol/template checks are not a substitute for the independent browser gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSandbox, evaluate } = require('./extensions-support.cjs');

function generated(messages) {
  const host = createSandbox();
  evaluate(host, 'assets/js/extension-frame.js');
  const doc = host.window.ExtensionFrame.buildDocument({
    origin: 'https://itsm.example',
    vueSource: fs.readFileSync('assets/vendor/vue.global.prod.js', 'utf8'),
    moduleSource: 'window.ITSMExtension.register({components:{Sample:{render:function(){return Vue.h("p","sample")}}}});',
    messages
  });
  const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 3, 'exactly Vue, kit and declared module scripts');
  return { doc, scripts };
}

function execute(scripts) {
  const posts = [], listeners = {}, root = { innerHTML: '' };
  const parent = { postMessage: (message, origin) => posts.push({ message, origin }) };
  const c = vm.createContext({ console, document: {
    documentElement: { style: { setProperty() {} }, getBoundingClientRect: () => ({ height: 240 }) },
    createElement: () => ({}),
    getElementById: () => root
  }, parent, addEventListener: (name, fn) => { listeners[name] = fn; } });
  c.window = c;
  scripts.forEach((source, index) => vm.runInContext(source, c, { filename: 'generated-frame-' + index + '.js' }));
  return { c, posts, listeners, parent, root };
}

test('all generated buildDocument scripts compile and the real kit emits ready', () => {
  const { scripts } = generated();
  scripts.forEach((source, index) => assert.doesNotThrow(() => new Function(source), 'generated script ' + index));
  const { posts } = execute(scripts);
  assert.deepEqual(posts.map(({ message, origin }) => [message.type, origin]), [['itsm:ready', 'https://itsm.example']]);
});

test('generated sibling kit render functions retain translated labels and button emit', () => {
  const { scripts } = generated({ captionFallback: 'Caption', loadingData: 'Loading', emptyTable: 'Empty' });
  const { c, parent, listeners } = execute(scripts);
  const components = {};
  c.Vue.createApp = () => ({ component(name, component) { components[name] = component; }, mount() {} });
  listeners.message({ source: parent, origin: 'https://itsm.example', data: {
    type: 'itsm:init', component: 'Sample', extensionId: 'fictional', permissions: [], theme: {}
  } });
  assert.deepEqual(Object.keys(components), ['ItsmTable', 'ItsmField', 'ItsmStatus', 'ItsmButton']);
  for (const [name, component] of Object.entries(components)) {
    assert.equal(typeof component.render, 'function', name);
    assert.equal(component.template, undefined, name);
  }
  assert.equal(components.ItsmTable.methods.copy('captionFallback'), 'Caption');
  assert.equal(components.ItsmTable.methods.copy('loadingData'), 'Loading');
  assert.equal(components.ItsmTable.methods.copy('emptyTable'), 'Empty');
  let clicked = false;
  const button = components.ItsmButton.render.call({ $slots: {}, $emit: () => { clicked = true; } });
  button.props.onClick();
  assert.equal(clicked, true);
});

test('generated locale parameter regexp retains word escapes and HTML safety', () => {
  const { scripts } = generated({ missingComponent: '<Missing>', missingComponentName: 'Component {component} missing' });
  const { parent, listeners, root } = execute(scripts);
  listeners.message({ source: parent, origin: 'https://itsm.example', data: {
    type: 'itsm:init', component: '<Absent>', extensionId: 'fictional', theme: {}
  } });
  assert.match(root.innerHTML, /&lt;Missing&gt;/);
  assert.match(root.innerHTML, /Component &lt;Absent&gt; missing/);
  assert.doesNotMatch(root.innerHTML, /\{component\}|<Absent>/);
});

test('inlineScript keeps closing tags and HTML comments inside valid generated string payloads', () => {
  const host = createSandbox();
  evaluate(host, 'assets/js/extension-frame.js');
  const doc = host.window.ExtensionFrame.buildDocument({
    vueSource: '/* fictional source */',
    moduleSource: 'window.payload = "</script><!--<script>";'
  });
  const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 3);
  scripts.forEach(source => assert.doesNotThrow(() => new Function(source)));
  const c = vm.createContext({ window: {} });
  vm.runInContext(scripts[2], c);
  assert.equal(c.window.payload, '</script><!--<script>');
});
