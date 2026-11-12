'use strict';
// No-eval VM checks pin the generated kit, not real-browser CSP/DOM acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSandbox, evaluate } = require('./extensions-support.cjs');
function boot(moduleSource, locale = 'en') {
  const env = createSandbox(); env.window.ItsmI18n.setLocale(locale); evaluate(env, 'assets/js/extension-frame.js');
  const html = env.window.ExtensionFrame.buildDocument({ origin:'https://itsm.example',
    vueSource:fs.readFileSync('assets/vendor/vue.global.prod.js','utf8'),
    moduleSource:moduleSource || 'ITSMExtension.register({components:{Sample:{render:function(){return Vue.h("p","sample")}}}});' });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  const listeners={}, components={}, posts=[], root={innerHTML:''}; let mounts=0;
  const c=vm.createContext({ console, document:{createElement:()=>({}), documentElement:{style:{setProperty(){}},getBoundingClientRect:()=>({height:240})},getElementById:()=>root},
    parent:{postMessage:m=>posts.push(m)},addEventListener:(name,fn)=>{listeners[name]=fn;} },{codeGeneration:{strings:false,wasm:false}});
  c.window=c;
  scripts.forEach((s,i)=>vm.runInContext(s,c,{filename:'real-generated-'+i+'.js'}));
  c.Vue.createApp=()=>({component(name,value){components[name]=value;},mount(){mounts++;}});
  listeners.message({source:c.parent,origin:'https://itsm.example',data:{type:'itsm:init',component:'Sample',extensionId:'fictional',permissions:[],theme:{},messages:{...env.window.ExtensionFrame.frameMessages(),captionFallback:'Translated caption',loadingData:'Translated loading',emptyTable:'Translated empty',booleanTrue:'Yes',booleanFalse:'No'}}});
  return {c,components,posts,html,root,mounts};
}
const children = node => Array.isArray(node.children) ? node.children : [];
function flat(node) { return node && typeof node==='object' ? [node,...children(node).flatMap(flat)] : []; }
function text(node) { return typeof node==='string' ? node : !node ? '' : typeof node.children==='string' ? node.children : children(node).map(text).join(''); }
test('real generated kit renders table/loading/empty translated content without string code generation',()=>{
  const {components,posts,html}=boot();
  assert.ok(posts.some(x=>x.type==='itsm:ready'));
  assert.match(html,/script-src 'unsafe-inline'/); assert.doesNotMatch(html,/unsafe-eval|allow-same-origin/);
  for(const component of Object.values(components)) {
    assert.equal(typeof component.render,'function',component.name);
    assert.equal(component.template,undefined,component.name+' must not invoke runtime compiler');
  }
  const table=components.ItsmTable;
  const state={caption:'',empty:'',loading:false,columns:[{field:'value',label:'Value'}],rows:[{id:'x',value:42}],...table.methods};
  let nodes=flat(table.render.call(state));
  assert.equal(text(nodes.find(x=>x.type==='caption')),'Translated caption');
  assert.equal(text(nodes.find(x=>x.type==='td')),'42');
  state.loading=true; nodes=flat(table.render.call(state));
  assert.equal(text(nodes.find(x=>x.props&&x.props.role==='status')),'Translated loading');
  state.loading=false;state.rows=[];
  assert.match(text(table.render.call(state)),/Translated empty/);
  assert.equal(table.methods.cell({value:false},{field:'value'}),'No');
});
test('button event/slot, field accessibility/input and status survive no-eval render functions',()=>{
  const {components}=boot(), emitted=[];
  const b=components.ItsmButton.render.call({type:'button',classes:'kit-btn',disabled:false,label:'Own', $slots:{},$emit:(...v)=>emitted.push(v)});
  assert.equal(b.type,'button');assert.equal(text(b),'Own'); b.props.onClick();assert.deepEqual(emitted,[['click']]);
  const state={label:'Field',controlId:'field1',modelValue:'42',required:true,multiline:false,type:'text',invalid:'true',describedBy:'field1-error',errorId:'field1-error',hintId:'field1-hint',error:'Invalid',hint:'',onInput:e=>emitted.push(['input',e.target.value])};
  let nodes=flat(components.ItsmField.render.call(state));
  assert.equal(nodes.find(x=>x.type==='label').props.for,'field1');
  const input=nodes.find(x=>x.type==='input');assert.equal(input.props['aria-describedby'],'field1-error'); input.props.onInput({target:{value:'43'}});
  assert.deepEqual(emitted.at(-1),['input','43']);
  state.multiline=true;assert.ok(flat(components.ItsmField.render.call(state)).some(x=>x.type==='textarea'));
  const status=components.ItsmStatus.render.call({tone:'ok',label:'Available'});
  assert.equal(text(status),'Available');assert.match(status.props.class,/kit-status--ok/);
});
test('documented raw module template remains a detected compatibility blocker without unsafe-eval',()=>{
  const {c}=boot();
  assert.throws(()=>vm.runInContext('Vue.compile("<p>{{ assetId }}</p>")',c),/Code generation from strings disallowed/);
});


for (const [label, definition] of [
  ['root', '{Sample:{template:"<p>{{ assetId }}</p>"}}'],
  ['unused sibling', '{Sample:{render(){return Vue.h("p","ok")}},Sibling:{template:"<p>raw</p>"}}'],
  ['nested component', '{Sample:{render(){return Vue.h("p","ok")},components:{Nested:{template:"<p>raw</p>"}}}}'],
  ['mixin', '{Sample:{render(){return Vue.h("p","ok")},mixins:[{template:"<p>raw</p>"}]}}'],
  ['extends', '{Sample:{render(){return Vue.h("p","ok")},extends:{template:"<p>raw</p>"}}}'],
  ['render plus template', '{Sample:{render(){return Vue.h("p","ok")},template:"<p>raw</p>"}}'],
  ['missing render', '{Sample:{props:["assetId"]}}']
]) test('public init rejects '+label+' before mount with visible translated alert, not empty DOM',()=>{
  for (const locale of ['en','es']) {
    const result=boot('ITSMExtension.register({components:'+definition+'});',locale);
    assert.ok(result.posts.some(m=>m.type==='itsm:ready'),'ready is only protocol readiness');
    assert.equal(result.mounts,0,'rejected module never mounts');
    assert.match(result.root.innerHTML,/role="alert"/);
    assert.match(result.root.innerHTML,locale==='en'?/render function/:/función render/);
    assert.doesNotMatch(result.root.innerHTML,/\{component\}/);
    assert.ok(result.posts.some(m=>m.type==='itsm:resize'&&m.height>0));
  }
});
test('public init accepts render/precompiled siblings and cyclic local render registrations without eval',()=>{
  const result=boot('const S={render(){return Vue.h("p","42")}};S.components={Self:S};ITSMExtension.register({components:{Sample:S,Sibling:{render: function compiled(){return Vue.h("p","precompiled")}}}});');
  assert.equal(result.mounts,1);assert.equal(result.root.innerHTML,'');
});
