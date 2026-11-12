'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

const cssDir='assets/css';
const css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
const stripped=css.replace(/\/\*[\s\S]*?\*\//g,'');

// Tokens that were referenced but never declared anywhere in the repo (audit CSS, ALTA/MEDIA).
const undeclared=['amber-600','amber-900','surface','surface-muted','text-muted','warning','warning-soft','focus'];

test('css never references an undeclared brand token', ()=>{
 for(const name of undeclared){
  const re=new RegExp('var\\(\\s*--'+name+'\\b');
  assert.doesNotMatch(stripped,re,'var(--'+name+') is not a declared token');
 }
});

function rules(selector){
 const out=[];const re=new RegExp('(^|\\})\\s*'+selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}','g');
 let m;while((m=re.exec(stripped))) out.push(m[2]);
 return out;
}

test('graph nodes keep a visible keyboard focus ring', ()=>{
 for(const body of rules('.gnode')) assert.doesNotMatch(body,/outline\s*:\s*none/,'.gnode removes the focus outline');
 const focus=rules('.gnode:focus-visible');
 assert.ok(focus.some(b=>/outline\s*:\s*[^n]/.test(b)),'.gnode:focus-visible must draw an outline');
});

test('conversation textarea keeps a visible focus outline', ()=>{
 const block=rules('.conversation__form textarea:focus-visible');
 assert.ok(block.length>0,'rule present');
 for(const body of block) assert.doesNotMatch(body,/outline\s*:\s*none/,'textarea focus outline removed');
});

test('layout tokens have a single :root source', ()=>{
 for(const f of fs.readdirSync(cssDir).filter(f=>f.endsWith('.css'))){
  if(f==='app.css') continue;
  const text=fs.readFileSync(path.join(cssDir,f),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(text,/(^|\})\s*:root\s*\{[^}]*--(sidebar-w|topbar-h|page-max|radius-)/,f+' redefines :root layout tokens');
 }
});

test('panel.css (dashboard legacy, unused) is gone and unlinked', ()=>{
 assert.equal(fs.existsSync(path.join(cssDir,'panel.css')),false,'panel.css still exists');
 const html=fs.readFileSync(path.join(cssDir,'..','..','index.html'),'utf8');
 assert.doesNotMatch(html,/assets\/css\/panel\.css/,'index.html still links panel.css');
});


const px=(body,prop)=>{const m=body.match(new RegExp('(?:^|[;\\s{])'+prop+'\\s*:\\s*(\\d+(?:\\.\\d+)?)px'));return m?Number(m[1]):null;};

test('row checkboxes expose a 24px pointer target', ()=>{
 const blocks=rules('.row-select');
 assert.ok(blocks.length>0,'rule present');
 assert.ok(px(blocks.join(';'),'width')>=24,'row-select width below 24px');
 assert.ok(px(blocks.join(';'),'height')>=24,'row-select height below 24px');
});

test('switch labels expose a 24px pointer target', ()=>{
 const blocks=rules('.switch');
 assert.ok(blocks.length>0,'rule present');
 assert.ok(px(blocks.join(';'),'min-height')>=24,'switch label below 24px');
});

test('labels.css keeps no rules for label markup that no runtime renders', ()=>{
 const labels=fs.readFileSync(path.join(cssDir,'labels.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(labels,/label-(sheet|cell|pagination|preview-stage|offset|field-options|field-order)|inventory-label|qr-dialog-preview|--label-/,'dead label rule left in labels.css');
});
