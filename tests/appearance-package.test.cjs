'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const { bootAppearanceI18n } = require('./appearance-i18n.cjs');
function load(){const c=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa});c.window=c;bootAppearanceI18n(c);for(const file of ['assets/js/appearance-engine.js','assets/js/appearance-package.js'])if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),c);assert.ok(c.AssetAppearancePackage,'portable ZIP codec available');return {P:c.AssetAppearancePackage,E:c.AssetAppearanceEngine};}
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12"/></svg>');
test('S4/S6 ZIP roundtrip includes manifest, all graphics and both color modes without external dependencies',async()=>{
 const {P,E}=load(),p=E.createState().active;p.name='Identidad técnica';for(const k of ['logo','logoDark','logoCompact','favicon'])p.branding[k]=image;
 const bytes=await P.encode(p);assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);const imported=await P.decode(bytes);assert.equal(imported.preset.name,'Identidad técnica');assert.equal(imported.resources.length,4);assert.equal(imported.preset.colors.dark.secondary,'#62d4c7');for(const k of ['logo','logoDark','logoCompact','favicon'])assert.ok(imported.preset.branding[k].startsWith('data:image/svg+xml;base64,'));const again=await P.decode(await P.encode(imported.preset));assert.equal(again.resources.length,4);
});
test('S4 local graphics are actually embedded, missing graphics abort package preparation',async()=>{
 const {P,E}=load(),p=E.createState().active;const bytes=await P.encode(p,async path=>({bytes:new TextEncoder().encode('<svg/>'),type:'image/svg+xml'}));assert.equal((await P.decode(bytes)).resources.length,2);await assert.rejects(P.encode(p,async()=>{throw Error('missing');}),/recurso|missing/i);
});
test('S5 invalid ZIP, incomplete manifest and corrupted payload produce clear errors without input mutation',async()=>{
 const {P,E}=load(),p=E.createState().active;for(const k of ['logo','favicon'])p.branding[k]=image;const before=JSON.stringify(p);await assert.rejects(P.decode(new Uint8Array([1,2,3])),/ZIP/i);const bytes=await P.encode(p);bytes[40]^=1;await assert.rejects(P.decode(bytes),/dañado|integridad|ZIP/i);assert.equal(JSON.stringify(p),before);p.version=9;await assert.rejects(P.encode(p),/versión|incompatible/i);
});
