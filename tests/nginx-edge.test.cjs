'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

const conf=fs.readFileSync('nginx.conf','utf8').replace(/#.*$/gm,'');
// Returns the body of the first `location <prefix>` block.
function location(prefix){
 const m=conf.match(new RegExp('location\\s+'+prefix.replace(/[/]/g,'\\/')+'\\s*\\{([^}]*)\\}'));
 assert.ok(m,'missing location '+prefix);
 return m[1];
}

test('edge proxy forwards the real client address to the API', ()=>{
 assert.match(location('/api/'),/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/);
});

test('edge proxy streams SSE and accepts attachment-sized bodies', ()=>{
 const api=location('/api/');
 assert.match(api,/proxy_buffering\s+off\s*;/);
 assert.match(api,/proxy_read_timeout\s+130s\s*;/);
 assert.match(conf,/client_max_body_size\s+12m\s*;/);
});

test('edge compresses text assets', ()=>{
 assert.match(conf,/gzip\s+on\s*;/);
 const types=(conf.match(/gzip_types\s+([^;]+);/)||[])[1]||'';
 for(const t of ['text/css','application/javascript','application/json','image/svg+xml','application/geo+json'])
  assert.ok(types.split(/\s+/).includes(t),'gzip_types missing '+t);
});

test('edge revalidates static assets instead of caching them blindly', ()=>{
 assert.match(location('/assets/'),/add_header\s+Cache-Control\s+"no-cache"\s*;/);
});

test('edge hides the nginx version', ()=>{
 assert.match(conf,/server_tokens\s+off\s*;/);
});

test('edge reports the app CSP without enforcing it', ()=>{
 const m=conf.match(/add_header\s+Content-Security-Policy-Report-Only\s+"([^"]+)"\s+always\s*;/);
 assert.ok(m,'report-only CSP missing');
 const directives=Object.fromEntries(m[1].split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const [name,...v]=d.split(/\s+/);return [name,v];}));
 assert.ok(directives['script-src'].includes("'unsafe-eval'"),'legacy runtime compiles templates in the browser');
 assert.ok(directives['worker-src'].includes('blob:'),'MapLibre worker runs from a blob URL');
 assert.doesNotMatch(conf,/add_header\s+Content-Security-Policy\s/,'CSP must stay report-only until browser-verified');
});
