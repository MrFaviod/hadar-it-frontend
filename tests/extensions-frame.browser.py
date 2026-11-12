"""R3-F5 real-browser proof: a navigated isolated frame is terminal.

Serves this checkout over loopback and drives the shipped `extension-frame.js`
unchanged. The module document (opaque origin) completes the handshake, asks for
a declared operation, and then replaces itself with a second document that
repeats the handshake and asks again. The host must have answered `itsm:ready`
once, must never deliver the asset record, and must stop responding after the
frame loads another document.

No backend, database, provider or `.env` is involved; only the frozen frame
document and the host bridge are exercised. The probe page is served from
memory so the checkout is not written to.
"""
import functools
import http.server
import json
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

ATTACKER = """
<!doctype html><html lang="es"><head><meta charset="utf-8"><title>otro</title></head>
<body><p>otro documento</p><script>
parent.postMessage({type: 'itsm:ready'}, '*');
setTimeout(function () {
  parent.postMessage({type: 'itsm:request', id: 'evil', operation: 'report_init', args: {}}, '*');
}, 150);
</script></body></html>
"""

MODULE = """
(function () {
  'use strict';
  var inits = 0;
  window.ITSMExtension.register({ components: { Panel: { props: ['assetId', 'sdk'], render: function () { return Vue.h('p', this.assetId); } } } });
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type !== 'itsm:init') return;
    inits += 1;
    window.parent.postMessage({
      type: 'itsm:request',
      id: 'init-' + inits,
      operation: 'report_init',
      args: { assetId: typeof data.assetId === 'string' ? data.assetId : '', hasAsset: Object.prototype.hasOwnProperty.call(data, 'asset') }
    }, '*');
    if (inits === 1) {
      setTimeout(function () {
        location.replace('data:text/html;charset=utf-8,' + encodeURIComponent(ATTACKER_SOURCE));
      }, 100);
    }
  });
})();
""".replace('ATTACKER_SOURCE', json.dumps(ATTACKER))

VUE_STUB = """
window.Vue = {
  createApp: function () {
    return { component: function () {}, mount: function (root) { root.innerHTML = '<p>vista</p>'; } };
  },
  h: function () { return {}; }
};
"""

HOST = """
(function () {
  var frameApi = window.ExtensionFrame;
  var requests = [];
  var terminations = 0;
  var item = { id: 'license', operations: [{ name: 'report_init' }], pages: [] };
  var frame = document.createElement('iframe');
  frame.setAttribute('sandbox', frameApi.SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', 'Vista aislada de prueba');
  frame.setAttribute('srcdoc', frameApi.buildDocument({
    title: 'Vista aislada de prueba',
    vueSource: VUE_SOURCE,
    moduleSource: MODULE_SOURCE,
    theme: {},
    origin: window.location.origin
  }));
  var bridge = frameApi.bridge({
    frame: frame,
    item: item,
    component: 'Panel',
    assetId: 'asset-uuid-1',
    asset: { id: 'asset-uuid-1', name: 'Servidor', serial: 'SN-SECRET-1' },
    permissions: ['ext_license.read'],
    getTheme: function () { return {}; },
    onHeight: function () {},
    onTerminated: function () { terminations += 1; },
    sdk: {
      id: 'license',
      request: function (operation, args) {
        requests.push({ operation: operation, args: args });
        return Promise.resolve({ secret: 'SN-SECRET-1' });
      }
    }
  });
  frame.addEventListener('load', function () { bridge.frameLoaded(); });
  window.addEventListener('message', function (event) { bridge.handleMessage(event); });
  document.body.appendChild(frame);
  window.__probe = function () {
    return {
      requests: requests,
      terminations: terminations,
      disposed: bridge.state.disposed,
      sandbox: frame.getAttribute('sandbox')
    };
  };
})();
""".replace('VUE_SOURCE', json.dumps(VUE_STUB)).replace('MODULE_SOURCE', json.dumps(MODULE))

HTML = """
<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Marco aislado</title></head>
<body><div id="host"></div>
<script src="/assets/js/extension-frame.js"></script>
<script>__HOST__</script>
</body></html>
""".replace('__HOST__', HOST.replace('</', '<\\/'))


class Probe(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.split('?')[0] == '/frame-probe.html':
            body = HTML.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def serve():
    handler = functools.partial(Probe, directory=str(ROOT))
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    try:
        base = 'http://127.0.0.1:%d' % server.server_address[1]
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page()
            errors = []
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/frame-probe.html', wait_until='load')
            try:
                page.wait_for_function('() => window.__probe && window.__probe().requests.length >= 1', timeout=5000)
            except Exception:
                print('console:', errors)
                print('diagnostics:', page.evaluate('''() => {
                    var frame = document.querySelector('iframe');
                    return {
                        hasProbe: typeof window.__probe === 'function',
                        srcdocLength: frame ? frame.getAttribute('srcdoc').length : 0,
                        sandbox: frame ? frame.getAttribute('sandbox') : null,
                        probe: typeof window.__probe === 'function' ? window.__probe() : null
                    };
                }'''))
                raise
            page.wait_for_timeout(900)
            probe = page.evaluate('() => window.__probe()')
            browser.close()

        assert probe['sandbox'] == 'allow-scripts', probe
        requests = probe['requests']
        assert [entry['operation'] for entry in requests] == ['report_init'], requests
        assert requests[0]['args'] == {'assetId': 'asset-uuid-1', 'hasAsset': False}, requests
        assert probe['terminations'] == 1, probe
        assert probe['disposed'] is True, probe
        assert errors == [], errors
        print('PASS R3-F5 browser: one init without asset data; navigation terminates the bridge')
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
