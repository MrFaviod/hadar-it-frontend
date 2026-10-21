'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){const c=vm.createContext({console});c.window=c;const file='assets/js/appearance-engine.js';if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),c);assert.ok(c.AssetAppearanceEngine,'appearance engine available');return c.AssetAppearanceEngine;}
test('S1/S3 draft selection stays isolated until apply; restore preserves original identity',()=>{
 const E=load(),s=E.createState({appName:'Asset Manager',organizationName:'Operaciones TI',logo:'assets/svg/logo.svg'}),original=JSON.stringify(s.active),p=E.clone(s.presets[1]);p.branding.appName='Inventario corporativo';assert.equal(JSON.stringify(s.active),original);E.applyPreset(s,p);p.branding.appName='Otra';assert.equal(s.active.branding.appName,'Inventario corporativo');assert.equal(JSON.stringify(s.previous),original);E.restore(s);assert.equal(s.active.id,'generic');assert.equal(s.active.branding.appName,'Asset Manager');
});
test('S2 modes are per-user and button/token colors have readable foregrounds',()=>{
 const E=load(),s=E.createState();E.setUserMode(s,'ana','dark');E.setUserMode(s,'luis','light');assert.equal(E.getUserMode(s,'ana'),'dark');assert.equal(E.getUserMode(s,'luis'),'light');assert.equal(E.getUserMode(s,'new'),'system');for(const p of s.presets)for(const m of ['light','dark']){const t=E.tokens(p,m);assert.ok(E.contrast(t['--brand-button'],t['--brand-on-button'])>=4.5);assert.ok(E.contrast(t['--text'],t['--bg'])>=4.5);assert.ok(E.contrast(t['--muted'],t['--paper'])>=4.5);}
});
test('S3/S5 duplicates and import conflicts keep both or replace, leaving active draft untouched',()=>{
 const E=load(),s=E.createState(),before=JSON.stringify(s.active),p=E.clone(s.presets[1]);const copy=E.duplicate(s,p);assert.notEqual(copy.id,p.id);assert.notEqual(copy.name,p.name);const imported=E.clone(p);imported.branding.appName='Importado';const n=s.presets.length;E.savePreset(s,imported,'both');assert.equal(s.presets.length,n+1);E.savePreset(s,imported,'replace');assert.equal(s.presets.length,n+1);assert.equal(JSON.stringify(s.active),before);const generic=E.clone(s.presets[0]);generic.branding.appName='Reemplazo';E.savePreset(s,generic,'replace');E.restore(s);assert.equal(s.active.branding.appName,'Asset Manager');
});
test('S1 invalid branding/color is rejected without changing gallery or active appearance',()=>{
 const E=load(),s=E.createState(),before=JSON.stringify(s),p=E.clone(s.active);p.colors.dark.accent='not-a-color';assert.throws(()=>E.applyPreset(s,p),/color/i);assert.equal(JSON.stringify(s),before);p.colors.dark.accent='#ffffff';p.branding.appName=' ';assert.throws(()=>E.applyPreset(s,p),/nombre/i);assert.equal(JSON.stringify(s),before);
});

test('S4/S5 incomplete preferences cannot enter the gallery or change the active identity',()=>{const E=load(),state=E.createState(),p=E.clone(state.active),before=JSON.stringify(state);delete p.preferences;assert.throws(()=>E.savePreset(state,p,'both'),/preferencias|incompleto/i);assert.equal(JSON.stringify(state),before);});

test('S2 mid-tone brand buttons retain WCAG text contrast',()=>{const E=load(),p=E.createState().active;p.colors.light.secondary='#7b7b7b';const t=E.tokens(p,'light');assert.ok(E.contrast(t['--brand-button'],t['--brand-on-button'])>=4.5);});
