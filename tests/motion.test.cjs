'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{setup}=require('./universal-harness.cjs');

const html=fs.readFileSync('index.html','utf8');
const motionPath='assets/css/motion.css';
const motion=()=>fs.existsSync(motionPath)?fs.readFileSync(motionPath,'utf8'):'';
// Strip comments, then split the stylesheet into its top-level @media blocks.
function topLevelBlocks(css){
 css=css.replace(/\/\*[\s\S]*?\*\//g,'');const out=[];let depth=0,start=0,head='';
 for(let i=0;i<css.length;i++){if(css[i]==='{'){if(depth===0){head=css.slice(start,i).trim();start=i+1;}depth++;}else if(css[i]==='}'){depth--;if(depth===0){out.push({head,body:css.slice(start,i)});start=i+1;}}}
 return out;
}

test('M1 login and app shell swap through one Vue auth transition (out-in)',()=>{
 const open=html.indexOf('<transition name="auth" mode="out-in">');
 assert.ok(open>0,'auth transition wraps the login/app swap');
 const login=html.indexOf('<section v-if="route.name === \'login\'" class="login"'),shell=html.indexOf('<div v-else class="app-shell"');
 const close=html.indexOf('</transition>',shell);
 assert.ok(open<login&&login<shell&&shell<close,'login and app shell are the two branches of the auth transition');
 assert.ok(html.includes('<link rel="stylesheet" href="assets/css/motion.css">'),'motion stylesheet is loaded');
});

test('M2 motion.css animates only opacity and transform, and only without reduced-motion preference',()=>{
 const css=motion();assert.ok(css.length,'motion.css exists');
 for(const [,props] of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\}\s*)\}/g))
  for(const [,prop] of props.matchAll(/([a-z-]+)\s*:/g))assert.ok(['opacity','transform'].includes(prop),'keyframes animate '+prop);
 for(const [,value] of css.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g))
  for(const part of value.split(','))assert.match(part.trim(),/^(opacity|transform|color|border-color|box-shadow|background-color)\b/,'transition '+part.trim());
 for(const block of topLevelBlocks(css)){
  if(/animation\s*:/.test(block.body))assert.match(block.head,/prefers-reduced-motion:\s*no-preference/,'animations are opt-in by motion preference: '+block.head);
 }
 assert.match(css,/prefers-reduced-motion:\s*reduce[\s\S]*auth-/,'reduced motion neutralises the auth transition');
});

test('M3 login entrance staggers the brand and the form, and validation messages ease in',()=>{
 const css=motion();
 for(const sel of ['.login__brand','.login__form-wrap > ','.login-form .field__error','.login-form .form-alert'])assert.ok(css.includes(sel),sel+' is animated');
 assert.match(css,/animation-delay/,'login entrance uses a temporal progression');
});

test('M4 Dashboard entrance plays once on access and is not replayed by ordinary interactions',async()=>{
 const s=setup();s.app.route={name:'panel'};
 const P=s.c.AssetPanel;assert.equal(typeof P.ENTRANCE_MS,'number','entrance window is a named constant');
 assert.ok(P.ENTRANCE_MS>0&&P.ENTRANCE_MS<=900,'entrance stays brief');
 assert.match(P.PanelOverview.template,/:class="\{ 'noc--entering': entering \}"/,'root carries the entering class');
 const m=s.mount('PanelOverview');
 assert.equal(m.instance.entering,true,'entrance active on access');
 await new Promise(r=>setTimeout(r,P.ENTRANCE_MS+40));
 assert.equal(m.instance.entering,false,'entrance window closes');
 m.instance.filters.period='7d';m.instance.customize=true;await s.tick();m.instance.customize=false;await s.tick();
 assert.equal(m.instance.entering,false,'filters and customisation do not replay the entrance');
 m.unmount();
 const again=s.mount('PanelOverview');assert.equal(again.instance.entering,true,'returning to the Dashboard is a new access');
 again.unmount();
 const css=motion();
 assert.ok(css.includes('.noc--entering'),'stagger is gated by the entering class');
 assert.match(css,/\.page\.noc\s*\{\s*animation:\s*none;?\s*\}/,'the generic page fade never replays when the entering class is removed');
 assert.doesNotMatch(fs.readFileSync('assets/css/dashboard.css','utf8'),/noc-reveal/,'the ungated widget reveal is superseded by the gated entrance');
 assert.deepEqual(s.errors,[]);
});

test('M5 Dashboard entrance timer is cleared when leaving before it ends',()=>{
 const s=setup();s.app.route={name:'panel'};const m=s.mount('PanelOverview');
 const timer=m.instance.entranceTimer;assert.ok(timer,'timer tracked on the instance');
 m.unmount();
 assert.equal(m.instance.entranceTimer,null,'timer released on unmount');
});

const svgText=p=>fs.readFileSync(p,'utf8');
const svgStyle=p=>{const m=svgText(p).match(/<style>([\s\S]*?)<\/style>/);return m?m[1]:'';};
function assertGatedSvgMotion(p){
 const css=svgStyle(p);assert.ok(css.length,p+' carries its own animation styles');
 const blocks=topLevelBlocks(css);
 assert.ok(blocks.some(b=>/prefers-reduced-motion:\s*no-preference/.test(b.head)&&/animation\s*:/.test(b.body)),p+' animates only without reduced-motion preference');
 for(const b of blocks)if(/animation\s*:|@keyframes/.test(b.body))assert.match(b.head,/prefers-reduced-motion:\s*no-preference/,p+' ungated animation in '+b.head);
 assert.doesNotMatch(svgText(p),/<animate|<set\b/,p+' uses CSS, not SMIL, so the motion preference applies');
}

test('M6 device illustrations drop the floating decoration and keep their accessible title',()=>{
 const dir='assets/svg/devices';
 for(const f of fs.readdirSync(dir).filter(n=>n.endsWith('.svg'))){
  const svg=svgText(dir+'/'+f);
  assert.doesNotMatch(svg,/#8cb9b6|#a9d8d4/i,f+' has no floating dashes or outline rings');
  assert.doesNotMatch(svg,/<circle[^>]*fill="#d7edeb"/,f+' replaces the off-centre blob with a centred halo');
  assert.match(svg,/<title id="title">[^<]+<\/title>/,f+' keeps its title');
 }
});

test('M7 login topology animates packets and a hub pulse, gated by the motion preference',()=>{
 const p='assets/svg/login-topology.svg';assertGatedSvgMotion(p);
 const svg=svgText(p);
 assert.match(svg,/class="topo-packet/,'data packets travel along the links');
 assert.match(svg,/class="topo-pulse/,'the central hub pulses');
 assert.doesNotMatch(svg,/M80 610h96/,'corner filler lines are removed');
});

test('M8 empty-search illustration moves the lens lightly and drops the filler marks',()=>{
 const p='assets/svg/empty-search.svg';assertGatedSvgMotion(p);
 const svg=svgText(p);
 assert.match(svg,/class="empty-lens/,'the magnifier drifts');
 assert.doesNotMatch(svg,/#8cb9b6/,'floating dashes are removed');
});

test('M9 light motion reaches navigation, status, empty states, thumbnails and the login art',()=>{
 const css=motion();
 for(const sel of ['.nav-link.is-active::before','.side-category.is-active::before','.status-dot--down::after','.noc-alert-dot--critica::after','.empty-state','.asset-thumb img','.login__topology'])assert.ok(css.includes(sel),sel+' has a motion rule');
 assert.match(css,/@keyframes\s+motion-settle\s*\{\s*from\s*\{[^}]*translate\(-46%,\s*-52%\)/,'login art settles from its own resting translate');
 const gated=topLevelBlocks(css).filter(b=>/no-preference/.test(b.head)).map(b=>b.body).join('\n');
 for(const sel of ['.status-dot--down::after','.empty-state','.login__topology'])assert.ok(gated.includes(sel),sel+' animation is gated');
});
