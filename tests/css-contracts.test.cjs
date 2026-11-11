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
