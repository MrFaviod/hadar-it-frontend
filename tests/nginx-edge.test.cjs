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
  assert.match(location('/assets/'),/expires\s+epoch\s*;/);
  assert.doesNotMatch(location('/assets/'),/add_header/, 'add_header in a location drops inherited security headers');
});

test('edge resolves upstreams lazily so the UI boots without the API', ()=>{
  assert.match(conf,/resolver\s+127\.0\.0\.11[^;]*;/,'missing the Docker DNS resolver');
  assert.match(conf,/resolver\s+127\.0\.0\.11[^;]*ipv6=off/,'IPv6 AAAA answers stall a name that only exists on IPv4');
  assert.doesNotMatch(conf,/proxy_pass\s+https?:\/\/[a-z0-9.-]+:\d+/,'a literal upstream is resolved once at boot and never recovers');
  const setup=location('/api/setup/v1/');
  assert.match(setup,/proxy_pass\s+\$setup_upstream\$request_uri\s*;/,'setup keeps the full original URI and query');
  assert.match(setup,/set\s+\$setup_upstream\s+http:\/\/setup:8100\s*;/);
  const api=location('/api/');
  assert.match(api,/proxy_pass\s+\$api_upstream\$request_uri\s*;/,'the API keeps the full original URI and query');
  assert.match(api,/set\s+\$api_upstream\s+http:\/\/backend:8000\s*;/);
});

test('edge hides the nginx version', ()=>{
 assert.match(conf,/server_tokens\s+off\s*;/);
});

test('edge reports the app CSP without enforcing it', ()=>{
 const m=conf.match(/add_header\s+Content-Security-Policy-Report-Only\s+"([^"]+)"\s+always\s*;/);
 assert.ok(m,'report-only CSP missing');
 const directives=Object.fromEntries(m[1].split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const [name,...v]=d.split(/\s+/);return [name,v];}));
 assert.ok(!directives['script-src'].includes("'unsafe-eval'"),'host CSP stays without unsafe-eval; eval violations are reported, not allowed');
 assert.ok(directives['worker-src'].includes('blob:'),'MapLibre worker runs from a blob URL');
 assert.doesNotMatch(conf,/add_header\s+Content-Security-Policy\s/,'CSP must stay report-only until browser-verified');
});
