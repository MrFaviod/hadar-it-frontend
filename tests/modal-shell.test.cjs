'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

function loadComponents(){
  const doc={activeElement:null,body:{style:{overflow:''}},contains:()=>true};
  const sandbox={window:{AppIcon:{},ItsmI18n:{t:key=>key}},document:doc,console};
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','dialog-focus.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','components.js'),'utf8'),sandbox);
  return {def:sandbox.window.ModalShell,doc,setDocument(next){sandbox.document=next;}};
}

function fakeDialog(){
  const input={focused:false,focus(){this.focused=true;}};
  const close={focused:false,focus(){this.focused=true;}};
  const body={querySelector:()=>input};
  return {
    open:false,showModalCount:0,closeCount:0,focused:false,
    showModal(){this.showModalCount+=1;this.open=true;},
    close(){this.closeCount+=1;this.open=false;},
    setAttribute(){this.open=true;},removeAttribute(){this.open=false;},
    querySelector(selector){if(selector==='.modal__body')return body;return close;},
    getBoundingClientRect(){return {left:100,top:100,right:500,bottom:400};},
    focus(){this.focused=true;},
    bodyInput:input,closeButton:close
  };
}

function instance(def,dialog){
  const events=[];
  const vm=Object.assign(def.data(),{
    open:true,
    $refs:{dialog},
    $emit:(...args)=>events.push(args),
    $nextTick:fn=>fn&&fn()
  });
  for(const [key,fn] of Object.entries(def.methods))vm[key]=fn.bind(vm);
  return {vm,events,dialog};
}

test('ModalShell renders a native dialog instead of a manual overlay', () => {
  const {def}=loadComponents();
  assert.match(def.template,/<dialog\b/,'the modal is a native <dialog>');
  assert.doesNotMatch(def.template,/modal-layer/,'the manual fixed overlay is gone');
  assert.doesNotMatch(def.template,/v-if="open"/,'the dialog is not conditionally mounted, so showModal can own the top layer');
});

test('an initially open modal calls showModal and focuses the first slot control', () => {
  const {def,doc}=loadComponents(),dialog=fakeDialog(),{vm}=instance(def,dialog);
  def.mounted.call(vm);
  assert.equal(dialog.showModalCount,1);
  assert.equal(vm.active,true);
  assert.equal(dialog.bodyInput.focused,true,'focus lands on the first control in the body, not the header close button');
  assert.equal(doc.body.style.overflow,'hidden');
});

test('the watcher activates false->true and closes true->false exactly once', () => {
  const {def,doc}=loadComponents(),dialog=fakeDialog(),{vm}=instance(def,dialog);
  vm.open=false;vm.active=false;
  const watcher=def.watch.open.bind(vm);
  watcher(true);
  assert.equal(dialog.showModalCount,1);
  watcher(false);
  assert.equal(dialog.closeCount,1);
  watcher(false);
  assert.equal(dialog.closeCount,1,'a repeated false does not close twice');
});

test('Escape cancels through the native cancel event and asks the parent to close', () => {
  const {def,doc}=loadComponents(),dialog=fakeDialog(),{vm,events}=instance(def,dialog);
  let prevented=0;
  vm.onCancel({preventDefault(){prevented+=1;}});
  assert.equal(prevented,1,'the native dialog must not close without the parent state');
  assert.deepEqual(events,[['close']]);
});

test('Escape keydown closes once and ignores keyboard auto-repeat', () => {
  const {def}=loadComponents(),dialog=fakeDialog(),{vm,events}=instance(def,dialog);
  let prevented=0,stopped=0;
  const event=(repeat)=>({repeat,preventDefault(){prevented+=1;},stopPropagation(){stopped+=1;}});
  vm.onEscape(event(false));
  vm.onEscape(event(true));
  assert.equal(prevented,2,'native close is cancelled for every Escape keydown');
  assert.equal(stopped,2,'the keydown does not reach an underlying shell');
  assert.deepEqual(events,[['close']],'holding Escape does not emit close repeatedly');
});

test('a backdrop mousedown asks to close, while a click inside the dialog does not', () => {
  const {def,doc}=loadComponents(),dialog=fakeDialog(),{vm,events}=instance(def,dialog);
  vm.onBackdrop({target:dialog,clientX:20,clientY:20});
  assert.deepEqual(events,[['close']]);
  vm.onBackdrop({target:dialog,clientX:200,clientY:200});
  assert.equal(events.length,1,'a click within the dialog rect is not a backdrop close');
});

test('unmount closes an open dialog and restores focus only when the trigger is still connected', () => {
  const {def,doc}=loadComponents(),dialog=fakeDialog();
  let connected=true,focusCount=0;
  const trigger={focus(){focusCount+=1;}};
  doc.activeElement=trigger;
  doc.contains=()=>connected;
  const {vm}=instance(def,dialog);
  vm.activate();
  connected=false;
  def.beforeUnmount.call(vm);
  assert.equal(focusCount,0,'a trigger removed from the document is not focused');
  assert.equal(dialog.closeCount,1,'an open dialog closes on unmount');
  connected=true;
  const second=fakeDialog(),other=instance(def,second);
  other.vm.activate();
  def.beforeUnmount.call(other.vm);
  assert.equal(focusCount,1,'a still-connected trigger is focused exactly once');
});

function loadMixed(){
  const doc={activeElement:null,body:{style:{overflow:''}},contains:()=>true};
  const sandbox={window:{AppIcon:{},ItsmI18n:{t:key=>key},AssetSearch:{}},document:doc,console,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','scroll-lock.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','dialog-focus.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','components.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join('assets','js','search-views.js'),'utf8'),sandbox);
  return {modal:sandbox.window.ModalShell,palette:sandbox.window.AssetSearchViews.SearchPalette,lock:sandbox.window.AssetScrollLock,doc};
}

function paletteInstance(def){
  const events=[];
  const panel={open:false,showModal(){this.open=true;},close(){this.open=false;},setAttribute(){this.open=true;},removeAttribute(){this.open=false;},querySelector:()=>null};
  const vm=Object.assign(def.data(),{$root:{},$emit:(...args)=>events.push(args),$nextTick:fn=>fn&&fn(),$refs:{panel,input:{focus(){}}}});
  for(const [key,fn] of Object.entries(def.methods))vm[key]=fn.bind(vm);
  return {vm,events};
}

test('mixed ModalShell and SearchPalette share one body lock and restore it in either teardown order', () => {
  for(const order of ['modal-first','search-first']){
    const {modal,palette,lock,doc}=loadMixed();
    doc.body.style.overflow='scroll';
    const shell=instance(modal,fakeDialog()),search=paletteInstance(palette);
    shell.vm.activate();
    search.vm.activate();
    assert.equal(doc.body.style.overflow,'hidden','two open surfaces lock the body once');
    assert.equal(lock.locks,2);
    if(order==='modal-first')modal.beforeUnmount.call(shell.vm);else palette.beforeUnmount.call(search.vm);
    assert.equal(doc.body.style.overflow,'hidden','the remaining open surface keeps the body locked');
    assert.equal(lock.locks,1);
    if(order==='modal-first')palette.beforeUnmount.call(search.vm);else modal.beforeUnmount.call(shell.vm);
    assert.equal(doc.body.style.overflow,'scroll','the original overflow returns exactly once ('+order+')');
    assert.equal(lock.locks,0);
  }
});

test('repeat open/close cycles and an initial-open shell leave no stale lock', () => {
  const {modal,palette,lock,doc}=loadMixed();
  doc.body.style.overflow='auto';
  for(let cycle=0;cycle<3;cycle+=1){
    const shell=instance(modal,fakeDialog()),search=paletteInstance(palette);
    shell.vm.activate();
    search.vm.activate();
    palette.beforeUnmount.call(search.vm);
    modal.beforeUnmount.call(shell.vm);
    assert.equal(doc.body.style.overflow,'auto',`cycle ${cycle} restores the original value`);
    assert.equal(lock.locks,0,`cycle ${cycle} leaves no lock`);
  }
  doc.body.style.overflow='clip';
  const initial={...modal.data(),open:true,$refs:{dialog:fakeDialog()},$emit(){},$nextTick:fn=>fn&&fn()};
  for(const [key,fn] of Object.entries(modal.methods))initial[key]=fn.bind(initial);
  modal.mounted.call(initial);
  assert.equal(doc.body.style.overflow,'hidden');
  modal.beforeUnmount.call(initial);
  assert.equal(doc.body.style.overflow,'clip','initial-open unmount restores the original value');
  assert.equal(lock.locks,0);
});
