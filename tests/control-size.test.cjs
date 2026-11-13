'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

const cssDir='assets/css';
const read=file=>fs.readFileSync(path.join(cssDir,file),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');

// Extract every declaration body for a selector from one stylesheet. The repo
// keeps several files minified on a single line, so brace matching is safer
// than line splitting.
function blocks(file, selector) {
  const source=read(file).replace(/\s+/g,' '),out=[];
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp('(^|\\})\\s*(?:[^{}]*,\\s*)?'+escaped+'(?=[,\\s{])[^{}]*\\{([^}]*)\\}','g');
  let match;
  while((match=re.exec(source))) out.push(match[2]);
  return out;
}

function fontSize(body) {
  const match=body.match(/font-size\s*:\s*([\d.]+)(px|rem)/);
  assert.ok(match,'rule declares a font-size: '+body.slice(0,120));
  return match[2]==='rem'?Number(match[1])*16:Number(match[1]);
}

function assertEditable(file, selector) {
  const found=blocks(file, selector);
  assert.ok(found.length,`${file}: ${selector} rule exists`);
  for(const body of found) assert.ok(fontSize(body)>=16,`${file}: ${selector} must not zoom on focus (>=16px)`);
}

test('editable controls stay at 16px or larger', () => {
  assertEditable('app.css','.input-shell input');
  assertEditable('assets-admin.css','.input-shell select, .input-shell textarea');
  assertEditable('views.css','.search-field input');
  assertEditable('views.css','.select-field select');
  assertEditable('relations.css','.select-shell select');
  assertEditable('composition.css','.config-section-picker select');
  assertEditable('mobile-responsive.css','.config-section-picker select');
  assertEditable('transfer.css','.tx-map__entry .input-shell select');
  assertEditable('monitoring.css','.mon-input');
  assertEditable('monitoring.css','.mon-settings .field input:not([type="checkbox"]):not([type="radio"]):not(.mon-input)');
  assertEditable('map.css','.map-search input');
  assertEditable('map-config.css','.map-field input, .map-field select');
  assertEditable('appearance.css','.appearance-colors input[type="text"]');
  assertEditable('workspace.css','.universal-filter-strip__controls>select');
  assertEditable('operational.css','.noc-filters select');
});

test('the mobile workspace override cannot shrink the select back below 16px', () => {
  const source=read('workspace.css');
  const rule=source.match(/@media\(max-width:520px\)\{[^@]*?\.universal-filter-strip__controls>select\{([^}]*)\}/);
  assert.ok(rule,'the mobile select override exists');
  assert.ok(fontSize(rule[1])>=16,'the later mobile override keeps 16px');
});

test('the locale selector meets the 44px touch target in every shell context', () => {
  const html=fs.readFileSync('index.html','utf8');
  const rule=html.match(/\.locale-select__control\s*\{([^}]*)\}/);
  assert.ok(rule,'index.html declares the locale control');
  const body=rule[1];
  const value=prop=>{const match=body.match(new RegExp(prop+'\\s*:\\s*(\\d+(?:\\.\\d+)?)px'));return match?Number(match[1]):0;};
  assert.ok(value('min-height')>=44,`locale min-height is ${value('min-height')}px`);
  assert.ok(value('min-width')>=44,`locale min-width is ${value('min-width')}px`);
  assert.doesNotMatch(html,/maximum-scale|user-scalable\s*=\s*['"]?no/i,'the viewport must not disable pinch zoom');
});
