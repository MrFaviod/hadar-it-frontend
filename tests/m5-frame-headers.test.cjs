'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createSandbox,evaluate}=require('./extensions-support.cjs');
const {setup}=require('./universal-harness.cjs');

test('bridge ignores declared requests, resize and navigation until existing ready handshake', async()=>{
 const e=createSandbox();evaluate(e,'assets/js/extension-frame.js');
 const posts=[],requests=[],nav=[],sizes=[];const frame={contentWindow:{postMessage:(...a)=>posts.push(a)}};
 const bridge=e.window.ExtensionFrame.bridge({frame,item:{id:'license',operations:[{name:'list'}],pages:[{id:'own'}]},sdk:{request:(...a)=>{requests.push(a);return Promise.resolve({ok:true});}},navigate:p=>{nav.push(p);return p==='own';},onHeight:h=>sizes.push(h)});
 const send=data=>bridge.handleMessage({source:frame.contentWindow,data});
 assert.equal(send({type:'itsm:request',id:'before',operation:'list'}),false);
 assert.equal(send({type:'itsm:navigate',page:'own'}),false);
 assert.equal(send({type:'itsm:resize',height:300}),false);
 assert.deepEqual([requests.length,nav.length,sizes.length,posts.length,bridge.state.pending.size],[0,0,0,0,0]);
 assert.equal(send({type:'itsm:ready'}),true);
 assert.equal(send({type:'itsm:request',id:'after',operation:'list'}),true);
 assert.equal(send({type:'itsm:navigate',page:'own'}),true);
 assert.equal(send({type:'itsm:navigate',page:'#//evil'}),false);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(requests.length,1);assert.equal(nav[0],'own');
 assert.equal(posts[0][1],'*','opaque origin requires wildcard; not "null"');
 bridge.frameLoaded();bridge.frameLoaded();
 assert.equal(send({type:'itsm:request',id:'late',operation:'list'}),false);
 assert.equal(requests.length,1);assert.equal(bridge.state.disposed,true);
});

test('frame and installed SDK navigate only declared own pages or host-owned canonical hashes',()=>{
 const {c,app}=setup();
 // Use the public install-state hydrator / SDK path exercised by extension host tests.
 assert.equal(typeof c.AssetMethods.isDeclaredHash,'function');
 for(const hash of ['#/panel','#/inventario','#/activo/a-1','#/configuracion/apariencia','#/datos/exportar','#/infra/grafo/activo/a-1','#/mapa','#/grafo','#/supervision/estado'])assert.equal(c.AssetMethods.isDeclaredHash(hash),true,hash);
 for(const hash of ['#//evil','#/unknown','#/panel/extra','#/configuracion/unknown','#/extensiones/license/missing','#/inventario?unknown=1','https://example.test','#/panel\\bad'])assert.equal(c.AssetMethods.isDeclaredHash(hash),false,hash);
});

test('HTTP and TLS each emit one compatible Report-Only policy and TLS-only HSTS even on errors',()=>{
 const http=fs.readFileSync('nginx.conf','utf8'),tls=fs.readFileSync('../deploy/nginx-tls.conf','utf8');
 const headers=text=>Object.fromEntries([...text.matchAll(/add_header\s+([\w-]+)\s+"([^"]*)"\s+always;/g)].map(m=>[m[1],m[2]]));
 const a=headers(http),b=headers(tls);
 for(const h of ['X-Content-Type-Options','Referrer-Policy','X-Frame-Options','Content-Security-Policy-Report-Only']) {assert.ok(a[h],h);assert.equal(a[h],b[h],h);assert.match(tls,new RegExp('proxy_hide_header '+h+';'));}
 assert.equal(a['Strict-Transport-Security'],undefined);assert.equal(b['Strict-Transport-Security'],'max-age=31536000');
 assert.match(a['Content-Security-Policy-Report-Only'],/default-src 'self'/);
 assert.doesNotMatch(a['Content-Security-Policy-Report-Only'],/unsafe-eval/);
 assert.doesNotMatch(http+tls,/add_header Content-Security-Policy\s|proxy_hide_header Content-Security-Policy;/);
 assert.equal([...http.matchAll(/add_header Content-Security-Policy-Report-Only/g)].length,1);
 assert.equal([...tls.matchAll(/add_header Content-Security-Policy-Report-Only/g)].length,1);
 assert.match(http,/proxy_hide_header X-Content-Type-Options;/);
});
