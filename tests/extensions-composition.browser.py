"""Bounded real-browser fixture for runtime UI composition (SDK v1).

It serves this checkout over loopback, loads the shipped Vue runtime,
ui-composition.js and extensions.js unchanged, and stubs only the extension
catalogue/frontend.js network boundary. No backend, database, provider or .env
is involved, so it proves rendering of the composition wrappers in Chromium
without claiming that the full authenticated application journey was exercised.
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
<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Composición</title></head>
<body><div id="app"></div>
<script src="/assets/vendor/vue.global.prod.js"></script>
<script src="/assets/js/dashboard-preferences.js"></script>
<script src="/assets/js/ui-composition.js"></script>
<script src="/assets/js/extensions.js"></script>
<script>
  const marker = '%(digest)s';
  const permission = '%(permission)s';
  const dashboard = window.AssetDashboardPrefs.createState();
  dashboard.layouts = { fixture: ['alerts', 'activity'] };
  const app = Vue.reactive({
    extensions: window.AssetExtensions.data().extensions,
    serverPermissions: [], authenticated: true, dashboard, activeUserId: 'fixture',
    can: (code) => code === permission
  });
  window.AssetExtensions.sync(app, { sdkVersion: 1, items: [{
    manifest: { sdkVersion: 1, id: 'registry', name: 'Registro', version: '1.0.0', schemaVersion: 1,
      permissions: [{ code: permission, label: 'Leer' }],
      frontend: { entry: 'frontend.js', pages: [], assetPanels: [], contributions: [
        { id: 'summary', label: 'Resumen', target: 'page.inventory', mode: 'replace', permission: permission, component: 'RegistrySummary' },
        { id: 'hide-history', label: 'Ocultar historial', target: 'asset.panel.history', mode: 'hide', permission: permission },
        { id: 'edit', label: 'Editar activo', target: 'asset.action.edit', mode: 'replace', permission: permission, component: 'RegistryEdit' },
        { id: 'clone', label: 'Duplicar activo', target: 'asset.action.duplicate', mode: 'replace', permission: permission, component: 'RegistryDuplicate' },
        { id: 'added-note', label: 'Nota añadida', target: 'page.inventory', mode: 'add', permission: permission, component: 'RegistryNote', order: 1 },
        { id: 'reports', label: 'Reportes', target: 'nav.reports', mode: 'replace', permission: permission, component: 'RegistryReports' },
        { id: 'alerts', label: 'Alertas', target: 'widget.alerts', mode: 'replace', permission: permission, component: 'RegistryAlerts' },
        { id: 'activity', label: 'Actividad', target: 'widget.activity', mode: 'replace', permission: permission, component: 'BrokenActivity' }
      ] }
    },
    digest: marker, version: '1.0.0', revision: 1, enabled: true, schemaVersion: 1,
    frontendUrl: '/api/v1/extensions/registry/frontend.js?digest=' + marker, operations: []
  }] });
  window.APP = app;
  window.MOUNTED = Vue.createApp({
    components: { CompositionBoundary: window.UIComposition.components.CompositionBoundary,
                  CompositionSlot: window.UIComposition.components.CompositionSlot,
                  CompositionNavItem: window.UIComposition.components.CompositionNavItem,
                  CompositionNavAdditions: window.UIComposition.components.CompositionNavAdditions,
                  CompositionWidgets: window.UIComposition.components.CompositionWidgets },
    template: `<main>
      <composition-boundary :app="app" target="page.inventory"><p class="core">Inventario del núcleo</p></composition-boundary>
      <composition-slot :app="app" target="asset.panel.history"><p class="history-core">Historial del núcleo</p></composition-slot>
      <div class="asset-actions">
        <composition-slot :app="app" target="asset.action.edit" :permitted="editAllowed">
          <button v-if="editAllowed" class="core-edit">Editar activo del núcleo</button>
        </composition-slot>
        <composition-slot :app="app" target="asset.action.duplicate" :permitted="!serverAsset">
          <button v-if="!serverAsset" class="core-duplicate">Duplicar del prototipo</button>
        </composition-slot>
        <composition-slot :app="app" target="asset.action.duplicate" :permitted="serverAsset">
          <button v-if="serverAsset" class="core-duplicate">Duplicar del servidor</button>
        </composition-slot>
      </div>
      <nav>
        <composition-nav-item :app="app" target="nav.reports" :permitted="true">
          <a class="core-nav" href="#/reportes">Reportes del núcleo</a>
        </composition-nav-item>
        <composition-nav-additions :app="app"></composition-nav-additions>
      </nav>
      <section class="core-grid">
        <p v-for="id in coreWidgets" :key="id" class="core-widget">{{ id }}</p>
      </section>
      <composition-widgets :app="app"></composition-widgets>
    </main>`,
    data: () => ({ app: window.APP, editAllowed: false, serverAsset: true }),
    computed: { coreWidgets() { return window.AssetDashboardPrefs.visibleWidgets(this.app.dashboard, 'fixture'); } }
  }).mount('#app');
</script></body></html>
""" % {'digest': DIGEST, 'permission': PERMISSION}

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/api/v1/extensions/registry/frontend.js*', lambda route: route.fulfill(
                status=200,
                content_type='application/javascript',
                body="window.ITSMExtensions.register('registry', { components: {"
                     "RegistrySummary: { template: '<section class=\"extension-summary\">Resumen de la extensión</section>' },"
                     "RegistryReports: { template: '<a class=\"extension-nav\" href=\"#/reportes-extension\">Reportes de la extensión</a>' },"
                     "RegistryAlerts: { template: '<p class=\"extension-alerts\">Alertas de la extensión</p>' },"
                     "BrokenActivity: { template: '<p class=\"broken\">{{ missing.detail }}</p>' },"
                     "RegistryNote: { template: '<p class=\"extension-note\">Nota añadida por la extensión</p>' },"
                     "RegistryEdit: { template: '<button class=\"extension-edit\">Editar desde la extensión</button>' },"
                     "RegistryDuplicate: { template: '<button class=\"extension-duplicate\">Duplicar desde la extensión</button>' } } });",
            ))
            page.goto(base + '/tests/', wait_until='domcontentloaded')
            page.set_content(html, wait_until='load')
            expect(page.locator('.extension-summary')).to_have_text('Resumen de la extensión')
            expect(page.locator('.core')).to_have_count(0)
            expect(page.locator('.extension-note')).to_have_text('Nota añadida por la extensión')
            expect(page.locator('.history-core')).to_have_count(0)
            # A denied permission keeps the whole asset action absent, and the
            # duplicated action composes exactly one replacement.
            expect(page.locator('.extension-edit')).to_have_count(0)
            expect(page.locator('.core-edit')).to_have_count(0)
            expect(page.locator('.extension-duplicate')).to_have_text('Duplicar desde la extensión')
            expect(page.locator('.extension-duplicate')).to_have_count(1)
            expect(page.locator('.core-duplicate')).to_have_count(0)
            expect(page.locator('.extension-nav')).to_have_text('Reportes de la extensión')
            expect(page.locator('.core-nav')).to_have_count(0)
            expect(page.locator('.extension-alerts')).to_have_text('Alertas de la extensión')
            expect(page.locator('.core-widget', has_text='alerts')).to_have_count(0)
            # The throwing replacement is contained: its core widget returns and
            # the rest of the composition keeps rendering.
            expect(page.locator('.broken')).to_have_count(0)
            expect(page.locator('.core-widget', has_text='activity')).to_have_count(1)
            expect(page.locator('.extension-alerts')).to_have_text('Alertas de la extensión')
            page.evaluate('window.AssetExtensions.stop(window.APP)')
            expect(page.locator('.core')).to_have_text('Inventario del núcleo')
            expect(page.locator('.history-core')).to_have_text('Historial del núcleo')
            expect(page.locator('.extension-edit')).to_have_count(0)
            expect(page.locator('.extension-duplicate')).to_have_count(0)
            expect(page.locator('.core-duplicate', has_text='servidor')).to_have_count(1)
            expect(page.locator('.extension-summary')).to_have_count(0)
            expect(page.locator('.core-nav')).to_have_text('Reportes del núcleo')
            expect(page.locator('.extension-nav')).to_have_count(0)
            expect(page.locator('.extension-alerts')).to_have_count(0)
            expect(page.locator('.core-widget', has_text='alerts')).to_have_count(1)
            expect(page.locator('.core-widget', has_text='activity')).to_have_count(1)
            assert not errors, errors
            browser.close()
        print('PASS composition add/replace/hide for pages, nav, widgets and asset actions in Chromium; denied asset gates and a failing replacement restore the core')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
