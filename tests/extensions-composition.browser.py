"""Bounded real-browser fixture for SDK v2 UI composition.

It serves this checkout over loopback, loads the shipped Vue runtime,
extension-views.js, ui-composition.js and extensions.js unchanged, and stubs only
the extension catalogue/operation network boundary. No backend, database,
provider or .env is involved. It proves that declarative additions render with
host components, that `hide` restores with the core surface, and that no module
script is inserted, without claiming the full authenticated journey.
"""
import functools
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DIGEST = 'a' * 64
PERMISSION = 'ext_registry.records_read'


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    try:
        base = 'http://127.0.0.1:%d' % server.server_address[1]
        html = """
<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Composición</title>
<link rel="stylesheet" href="/assets/css/app.css"></head>
<body><div id="app"></div>
<script src="/assets/vendor/vue.global.prod.js"></script>
<script src="/assets/js/icons.js"></script>
<script src="/assets/js/components.js"></script>
<script src="/assets/js/extension-frame.js"></script>
<script src="/assets/js/extension-views.js"></script>
<script src="/assets/js/ui-composition.js"></script>
<script src="/assets/js/extensions.js"></script>
<script>
(function () {
  window.AssetAccess = { request: function (vm, path) {
    if (String(path).indexOf('/invoke/list_records') !== -1) {
      return Promise.resolve({ items: [{ id: 'r-1', name: 'Fila de la extensión' }], total: 1, limit: 10, offset: 0 });
    }
    return Promise.resolve({});
  } };
  var permission = '%(permission)s';
  var app = {
    authenticated: true,
    serverPermissions: [permission, 'system.modules'],
    can: function (code) { return this.serverPermissions.indexOf(code) !== -1; }
  };
  app.extensions = window.AssetExtensions.data().extensions;
  var view = { table: { operation: 'list_records', columns: [{ field: 'name', label: 'Nombre' }] } };
  var manifest = {
    sdkVersion: 2, id: 'registry', name: 'Registro', version: '2.0.0', schemaVersion: 1,
    runtime: 'declarative', capabilities: [], storage: { engine: 'sqlite' },
    permissions: [{ code: permission, label: 'Leer', description: 'Consulta el registro.' }],
    operations: [{ name: 'list_records', description: 'Lista', permission: permission, mutation: false, kind: 'list' }],
    frontend: {
      pages: [],
      assetPanels: [],
      widgets: [],
      actions: [],
      contributions: [
        { id: 'summary', label: 'Resumen', target: 'page.inventory', mode: 'add', permission: permission, view: view },
        { id: 'alerts', label: 'Alertas', target: 'widget.alerts', mode: 'add', permission: permission, view: view },
        { id: 'hide-reports', label: 'Ocultar reportes', target: 'nav.reports', mode: 'hide', permission: permission },
        { id: 'denied', label: 'Denegada', target: 'page.inventory', mode: 'add', permission: 'ext_registry.secret', view: view }
      ]
    }
  };
  window.AssetExtensions.sync(app, { sdkVersion: 2, items: [{
    manifest: manifest, digest: '%(digest)s', version: '2.0.0', revision: 1, enabled: true,
    schemaVersion: 1, status: 'installed', frontendUrl: null, operations: manifest.operations
  }] });
  window.APP = Vue.reactive(app);
  window.mountAssetApp = function (target) {
    var root = Vue.createApp({
      components: {
        ItsmTable: window.ItsmTable,
        ItsmError: window.ItsmError,
        ExtensionView: window.ExtensionViews.components.ExtensionView,
        CompositionBoundary: window.UIComposition.components.CompositionBoundary,
        CompositionNavItem: window.UIComposition.components.CompositionNavItem,
        CompositionWidgets: window.UIComposition.components.CompositionWidgets
      },
      template: '<main><composition-nav-item :app="app" target="nav.reports"><a class="core-nav" href="#/reportes">Reportes del núcleo</a></composition-nav-item>'
        + '<composition-boundary :app="app" target="page.inventory"><p class="core">Inventario del núcleo</p></composition-boundary>'
        + '<composition-widgets :app="app"></composition-widgets></main>',
      data: function () { return { app: window.APP }; }
    });
    if (window.AppIcon) root.component('AppIcon', window.AppIcon);
    return root.mount(target);
  };
  window.mountAssetApp('#app');
})();
</script>
</body></html>
""" % {'digest': DIGEST, 'permission': PERMISSION}

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append('console:' + message.text) if message.type == 'warning' else None)
            page.goto(base + '/tests/', wait_until='domcontentloaded')
            page.set_content(html, wait_until='load')
            expect(page.locator('.core')).to_have_text('Inventario del núcleo')
            expect(page.locator('.extension-view table')).to_have_count(2)
            expect(page.locator('.extension-view table tbody tr')).to_have_count(2)
            expect(page.locator('.extension-view table tbody tr').first).to_contain_text('Fila de la extensión')
            expect(page.locator('.core-nav')).to_have_count(0)
            expect(page.get_by_text('Denegada')).to_have_count(0)
            assert page.locator('script[src*="/extensions/"]').count() == 0
            page.evaluate('window.AssetExtensions.stop(window.APP)')
            expect(page.locator('.core')).to_have_text('Inventario del núcleo')
            expect(page.locator('.core-nav')).to_have_text('Reportes del núcleo')
            expect(page.locator('.extension-view table')).to_have_count(0)
            assert not errors, errors
            browser.close()
        print('PASS declarative additions render with host components, hide restores the core, denied contributions stay absent and no module script is created')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
