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

test('panel.css (dashboard legacy, unused) stays deleted', ()=>{
 assert.equal(fs.existsSync(path.join(cssDir,'panel.css')),false,'panel.css has no users; delete it');
});

