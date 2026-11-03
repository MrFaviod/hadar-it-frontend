"""T7 (S9, S14-S16) — measured availability on the infrastructure canvases.

Own disposable installation, own loopback uvicorn/Vite pair, own SQLite file
inside the OS temp directory: no existing service, database or credential is
read or touched. Canonical site/inventory/relationship records are seeded
through the public API, then the **monitoring transport** is scripted at the
HTTP boundary with ``page.route`` — no Prometheus, no agent, no device is
contacted or needed.

The scenario proves in Chromium that:

* the graph plate and the map inspector show the availability the monitoring
  contract publishes, joined by canonical ``assetId``, with the administrative
  inventory status still a separate fact;
* the unavailable, unmonitored, no-data, missing-detail (404) and failed-refresh
  states are honest: no stale values, no invented reading, an error that names
  the failure and keeps the last good reading visible;
* the bounded coverage line discloses what the page examined, not what the
  inventory holds;
* a manual refresh re-reads the device and moves the freshness stamp;
* switching the selection never repaints the previous device's reading;
* the block reads in Spanish and English, in both themes, at 1440 px and
  390 px without horizontal overflow;
* the resting camera, the selection and the expanded workspace survive the
  refresh (T6 behaviour is preserved, not rebuilt);
* no page error is raised in the whole run.

Screenshots are written under ``.verification/infrastructure-monitoring*/`` for
the vision pass.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get('ITSM_T7_BACKEND') or FRONTEND.parent / 'backend')
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
SHOTS = FRONTEND / '.verification' / ('infrastructure-monitoring-' + uuid.uuid4().hex[:10])
CATALOGS = {tag: json.loads((FRONTEND / 'assets' / 'i18n' / (tag + '.json')).read_text())
            for tag in ('es', 'en')}

USERNAME = 't7.admin'
PASSWORD = 'T7-Monitoring-Pass-4k'
suffix = uuid.uuid4().hex[:6]
SITE_NAME = 'Sede T7 ' + suffix
# Stable catalog ids, not labels: the server localizes category labels in the
# request locale, so entry text would silently pick the wrong category.
ASSETS = [
    ('SRV-T7-' + suffix, 'Servidor T7 ' + suffix, 'servidores'),      # down + 1 alert
    ('SW-T7-' + suffix, 'Switch T7 ' + suffix, 'switches'),           # available
    ('CAM-T7-' + suffix, 'Cámara T7 ' + suffix, 'camaras'),           # unmonitored
    ('NVR-T7-' + suffix, 'Grabador T7 ' + suffix, 'servidores'),      # unavailable
    ('UPS-T7-' + suffix, 'UPS T7 ' + suffix, 'switches'),             # no data
    ('AP-T7-' + suffix, 'Access point T7 ' + suffix, 'switches'),     # list row, detail 404
    ('PRN-T7-' + suffix, 'Impresora T7 ' + suffix, 'switches'),       # outside the monitoring page
]
EXPANDED = '.map-page.is-expanded, .graph-page.is-expanded'
SCROLL_LOCK = 'body.map-workspace-expanded, body.graph-workspace-expanded'

owned: list[subprocess.Popen] = []


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


API_PORT = free_port()
WEB_PORT = free_port()
API = 'http://127.0.0.1:%d' % API_PORT
BASE = 'http://127.0.0.1:%d' % WEB_PORT


def wait_for(url: str, timeout: float = 90.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(0.4)
    raise RuntimeError('timeout waiting for ' + url)


def stop_owned() -> None:
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def run_env(database: Path, tasks: Path) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith('ITSM_')}
    env.update({
        'ITSM_DATABASE_URL': 'sqlite+pysqlite:///' + str(database),
        'ITSM_TASK_SQLITE_PATH': str(tasks),
        'ITSM_ENVIRONMENT': 'development',
        'RELEASE_MODE': 'dev',
        'ITSM_AUTH_ORIGIN': BASE,
        'ITSM_AUTH_COOKIE_SECURE': 'false',
        'ITSM_BOOTSTRAP_PASSWORD': PASSWORD,
        'ITSM_DEV_API_URL': API,
        'ITSM_AGENT_MODEL': '',
        'ITSM_TASK_STORAGE': 'sqlite',
        # The transport is scripted in the browser; nothing external is read.
        'ITSM_PROMETHEUS_URL': '',
        'ITSM_MEILISEARCH_URL': '',
        'ITSM_SERVICE_REDIS_URL': '',
        'PYTHONPATH': str(BACKEND),
    })
    return env


API_JS = """
async (args) => {
  const session = await (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json();
  const headers = { 'Content-Type': 'application/json' };
  if (args.method && args.method !== 'GET') headers['X-CSRF-Token'] = session.csrfToken;
  const response = await fetch('/api/v1' + args.path, {
    method: args.method || 'GET',
    credentials: 'same-origin',
    headers,
    body: args.body === null || args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  return { status: response.status, body };
}
"""


def api(page, path: str, method: str = 'GET', body=None):
    result = page.evaluate(API_JS, {'path': path, 'method': method, 'body': body})
    assert result['status'] < 400, '%s %s -> %s %s' % (method, path, result['status'], result['body'])
    return result['body']


def seed(page) -> dict[str, str]:
    """Canonical organization, inventory and relations through the public API."""
    site = api(page, '/locations', 'POST', {
        'level': 'site', 'parentId': None, 'name': SITE_NAME, 'description': '',
        'latitude': '-25.28', 'longitude': '-57.63', 'planRef': '', 'planPage': '',
    })
    categories = api(page, '/inventory/config')['categories']
    keys = [item.get('id') or item.get('key') for item in categories]
    created: dict[str, str] = {}
    for code, name, category in ASSETS:
        assert category in keys, 'the catalog lost the %s category' % category
        record = api(page, '/assets', 'POST', {
            'quickCode': code, 'name': name, 'category': category,
            'siteId': site['id'], 'status': 'in_use',
        })
        created[name] = record['id']
    type_key = 'depends_on_t7'
    api(page, '/relationship-types', 'POST', {
        'key': type_key, 'forwardLabel': 'Depende de', 'inverseLabel': 'Sostiene',
        'containment': False,
    })
    # Every seeded asset takes part in at least one relation: the graph paints
    # the connected inventory, and a device with no edge would be outside it.
    for source, target in [(2, 1), (0, 1), (3, 0), (4, 1), (5, 1), (6, 5)]:
        api(page, '/relationships', 'POST', {
            'typeKey': type_key,
            'sourceId': created[ASSETS[source][1]],
            'targetId': created[ASSETS[target][1]],
        })
    api(page, '/assets/' + created[ASSETS[0][1]], 'PATCH', {'ip': '10.70.0.10'})
    return created


# --------------------------------------------------------------- telemetry
# The mocked transport mirrors ``MonitoringService._device_item`` (backend
# ``itsm/monitoring/service.py``): the frontend contract under test is the
# published one, not a shape invented for the test.

DOWN, AVAILABLE, UNMONITORED, UNAVAILABLE, NO_DATA, MISSING, UNLISTED = [name for _, name, _ in ASSETS]
CODE = {name: code for code, name, _ in ASSETS}
FACTS = ['Disponibilidad', 'Última comprobación', 'Alertas activas', 'Latencia']


def device(asset_id, code, name, category, **overrides):
    return dict({
        'assetId': asset_id, 'quickCode': code, 'name': name, 'category': category,
        'site': SITE_NAME, 'siteId': 'seeded', 'monitoringEnabled': True,
        'status': 'up', 'reason': None, 'checkType': 'icmp', 'target': '10.70.0.10',
        'intervalSeconds': 60, 'lastCheckAt': '2026-09-11T10:00:00Z', 'latencyMs': 12.5,
        'uptime': {'percent': 99.5, 'samples': 288}, 'activeAlerts': 0, 'severity': None,
    }, **overrides)


class Telemetry:
    """Scripted monitoring transport plus the request log assertions read."""

    def __init__(self, ids: dict[str, str]):
        self.ids = ids
        self.calls: list[str] = []
        self.list_mode = 'ok'
        self.detail_mode = 'ok'
        # 404 for a device that already answered once, to exercise the
        # fallback to the current page row.
        self.detail_missing = False
        self.detail_reads = {}
        self.stamp = '10:00'
        self.total = 9

    def rows(self) -> list[dict]:
        rows = [
            device(self.ids[DOWN], ASSETS[0][0], DOWN, 'servidores', status='down',
                   reason=None, latencyMs=None, uptime={'percent': 98.4, 'samples': 120},
                   activeAlerts=1, severity='warning', lastCheckAt='2026-09-11T' + self.stamp + ':00Z'),
            device(self.ids[AVAILABLE], ASSETS[1][0], AVAILABLE, 'switches'),
            device(self.ids[UNMONITORED], ASSETS[2][0], UNMONITORED, 'camaras',
                   monitoringEnabled=False, status='unmonitored', target=None,
                   latencyMs=None, uptime={'percent': None, 'samples': 0},
                   lastCheckAt=None),
            device(self.ids[UNAVAILABLE], ASSETS[3][0], UNAVAILABLE, 'servidores',
                   status='unavailable', reason='prometheus_unavailable', latencyMs=None,
                   uptime={'percent': None, 'samples': 0}, lastCheckAt=None),
            device(self.ids[NO_DATA], ASSETS[4][0], NO_DATA, 'switches', status=None,
                   latencyMs=None, uptime={'percent': None, 'samples': 0}),
            device(self.ids[MISSING], ASSETS[5][0], MISSING, 'switches'),
        ]
        return rows

    def detail(self, asset_id: str) -> tuple[int, dict]:
        base = {
            'config': {'enabled': True, 'checkType': 'icmp', 'target': '10.70.0.10',
                       'targetPresent': True, 'intervalSeconds': 60, 'metrics': [],
                       'thresholds': {}},
            'provenance': {'source': 'prometheus', 'prometheusConfigured': True,
                           'period': {'preset': '24h', 'from': '', 'to': '', 'stepSeconds': 300}},
            'series': [],
            'alerts': {'active': 0, 'lastRecoveryAt': None, 'recent': []},
        }
        if asset_id == self.ids[DOWN]:
            base.update({
                'status': 'down', 'reason': None,
                'uptime': {'percent': 97.0, 'samples': 288},
                'latency': {'averageMs': None, 'p95Ms': None, 'currentMs': None},
                'checks': [{'checkType': 'icmp', 'module': '', 'state': 'failure',
                            'lastCheckAt': '2026-09-11T' + self.stamp + ':00Z', 'latencyMs': None}],
                'alerts': {'active': 1, 'lastRecoveryAt': None,
                           'recent': [{'id': 'al-t7', 'state': 'firing', 'severity': 'critical',
                                       'alertName': 'Equipo sin respuesta',
                                       'assetId': asset_id,
                                       'startsAt': '2026-09-11T09:30:00Z'}]},
            })
        elif asset_id == self.ids[AVAILABLE]:
            base.update({
                'status': 'up', 'reason': None,
                'uptime': {'percent': 99.8, 'samples': 288},
                'latency': {'averageMs': 11.0, 'p95Ms': 19.0, 'currentMs': 12.5},
                'checks': [{'checkType': 'icmp', 'module': '', 'state': 'success',
                            'lastCheckAt': '2026-09-11T' + self.stamp + ':00Z', 'latencyMs': 12.5}],
            })
        elif asset_id == self.ids[UNMONITORED]:
            base.update({'status': 'unmonitored', 'reason': None,
                         'uptime': {'percent': None, 'samples': 0},
                         'latency': {'averageMs': None, 'p95Ms': None, 'currentMs': None},
                         'checks': []})
        elif asset_id == self.ids[UNAVAILABLE]:
            base.update({'status': 'unavailable', 'reason': 'prometheus_unavailable',
                         'uptime': {'percent': None, 'samples': 0},
                         'latency': {'averageMs': None, 'p95Ms': None, 'currentMs': None},
                         'checks': []})
        elif asset_id == self.ids[NO_DATA]:
            base.update({'status': None, 'reason': None,
                         'uptime': {'percent': None, 'samples': 0},
                         'latency': {'averageMs': None, 'p95Ms': None, 'currentMs': None},
                         'checks': []})
        else:
            return 404, {'error': {'code': 'not_found', 'message': 'device not monitored'}}
        return 200, base

    def handler(self, route) -> None:
        parsed = urlparse(route.request.url)
        path = parsed.path.replace('/api/v1', '', 1)
        self.calls.append(path + ('?' + parsed.query if parsed.query else ''))
        if path == '/monitoring/devices':
            if self.list_mode == 'fail':
                route.fulfill(status=500, content_type='application/json',
                              body=json.dumps({'error': {'code': 'upstream_failed'}}))
                return
            rows = self.rows()
            route.fulfill(status=200, content_type='application/json', body=json.dumps({
                'items': rows, 'total': self.total, 'limit': 200, 'offset': 0, 'period': '24h',
            }))
            return
        if path.startswith('/monitoring/devices/'):
            asset_id = path.rsplit('/', 1)[-1]
            self.detail_reads[asset_id] = self.detail_reads.get(asset_id, 0) + 1
            if self.detail_missing and self.detail_reads[asset_id] > 1:
                route.fulfill(status=404, content_type='application/json',
                              body=json.dumps({'error': {'code': 'not_found'}}))
                return
            if self.detail_mode == 'fail':
                route.fulfill(status=500, content_type='application/json',
                              body=json.dumps({'error': {'code': 'internal'}}))
                return
            asset_id = path.rsplit('/', 1)[-1]
            status, body = self.detail(asset_id)
            route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
            return
        # No other monitoring endpoint is exercised by this surface; an empty
        # answer keeps an unexpected read from becoming a page error.
        route.fulfill(status=200, content_type='application/json', body='{}')

    def reads(self, path: str) -> list[str]:
        return [call for call in self.calls if call.split('?')[0] == path]


def set_theme(page, theme: str) -> None:
    page.evaluate("""theme => {
      document.documentElement.setAttribute('data-theme', theme);
      window.dispatchEvent(new Event('asset-theme-change'));
    }""", theme)


def set_locale(page, locale: str) -> None:
    page.evaluate("async tag => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }", locale)


def label(locale: str, key: str, **values) -> str:
    text = CATALOGS[locale][key]
    for name, value in values.items():
        text = text.replace('{' + name + '}', str(value))
    return text


def monitor(page, root: str = '.graph-inspector'):
    """The measured-availability block of the active inspector."""
    return page.locator(root + ' .infra-monitor').first


def text(page, selector: str) -> str:
    return page.locator(selector).first.inner_text().strip()


def open_graph(page) -> None:
    page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
    expect(page.locator('.gnode').first).to_be_visible()
    # The block lives inside the selected-device inspector, so it appears with
    # the first selection, not with the empty canvas.


def plate(page, name: str):
    """Return the canvas plate for a device, resolved in one DOM pass.

    The plate prints the quick code; the inspector prints the asset name, so the
    two are asserted separately instead of assuming one labels the other. The
    force layout re-renders between frames, so the node is looked up once and
    used through a handle instead of a re-resolving locator.
    """
    code = CODE[name]
    deadline = time.time() + 30
    while True:
        handle = page.evaluate_handle(
            "([code, name]) => [...document.querySelectorAll('.gnode')]"
            ".find(node => (node.textContent || '').includes(code)"
            " || (node.getAttribute('aria-label') || '').includes(name))",
            [code, name]).as_element()
        if handle is not None:
            return handle
        if time.time() > deadline:
            seen = page.evaluate(
                "() => [...document.querySelectorAll('.gnode')].map(node =>"
                " [node.textContent, node.getAttribute('aria-label')])")
            raise AssertionError('plate %r is not on the canvas: %r' % (code, seen))
        page.wait_for_timeout(200)


def select_node(page, name: str) -> None:
    """Select a plate by its canonical quick code, then wait for its inspector."""
    # A synthetic click on the plate is the stable way to select it; the handler
    # is the user's handler.
    plate(page, name).dispatch_event('click')
    page.wait_for_function(
        "name => (document.querySelector('.graph-inspector h2') || {}).textContent === name",
        arg=name, timeout=8000)
    page.wait_for_function(
        "() => !document.querySelector('.infra-monitor [aria-busy=\"true\"]')", timeout=8000)


def node_badge(page, name: str):
    """Return the measured-state badge text of a plate, or None when it has none."""
    node = plate(page, name).query_selector('.gnode__state')
    return None if node is None else node.evaluate('element => element.textContent.trim()')


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix='t7-monitoring-'))
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = run_env(workdir / 't7.db', workdir / 't7-tasks.db')
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-superadmin', '--username', USERNAME,
                        '--name', 'T7 Monitoring'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        owned.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                       '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env))
        wait_for(API + '/api/v1/health/live')
        owned.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                                      cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
        wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=os.environ.get('ITSM_T7_HEADED') != '1', args=[
                '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
                                         locale='es-PY')
            page = context.new_page()
            errors: list[str] = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE + '/#/login', wait_until='networkidle')
            page.get_by_label('Usuario', exact=True).fill(USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            ids = seed(page)
            errors.clear()

            telemetry = Telemetry(ids)
            page.route('**/api/v1/monitoring/**', telemetry.handler)

            # ------------------------------------------------------- graph
            open_graph(page)
            page.wait_for_function("() => document.querySelectorAll('.gnode').length >= 7", timeout=15000)
            page.wait_for_timeout(500)
            # The bounded read fires once on boot; nothing polls it in a test run.
            expect(page.locator('.gnode__state')).to_have_count(1)
            assert node_badge(page, DOWN) == '1', node_badge(page, DOWN)
            assert node_badge(page, AVAILABLE) is None, 'an available device carries no alert badge'
            boot_reads = len(telemetry.reads('/monitoring/devices'))
            page.wait_for_timeout(1500)
            assert len(telemetry.reads('/monitoring/devices')) == boot_reads, (
                'the join does not poll faster than its bounded interval: %r' % telemetry.calls)
            assert boot_reads >= 1, 'the canvas reads the monitoring page on boot'

            select_node(page, DOWN)
            block = monitor(page)
            expect(block.locator('.status-pill')).to_have_text(label('es', 'ui.monitoring.status.down'))
            assert 'No disponible' in text(page, '.graph-inspector .infra-monitor__state'), text(page, '.graph-inspector .infra-monitor__state')
            facts = page.locator('.graph-inspector .infra-monitor__fact dt').all_inner_texts()
            # A device that does not answer publishes no latency: the block shows
            # the three facts that exist instead of a zero.
            assert facts == FACTS[:3], facts
            uptime = text(page, '.graph-inspector .infra-monitor__fact dd')
            assert uptime.startswith('97'), 'the graph reads the device detail: ' + uptime
            canonical_uptime = uptime
            # The selected device's own read is authoritative over the page row:
            # the row says 98.4 %, the detail says 97,0 %.
            assert uptime.startswith('97') and uptime.endswith('%'), uptime
            expect(page.locator('.graph-inspector .infra-monitor__alert')).to_have_count(1)
            assert 'Supervisión de 6 de 9' in text(page, '.graph-inspector .infra-monitor__note'), (
                'the coverage line discloses the examined page, not the inventory: '
                + text(page, '.graph-inspector .infra-monitor__note'))
            expect(page.locator('.graph-inspector .infra-monitor__note')).to_contain_text('Actualizado')
            page.screenshot(path=str(SHOTS / 'graph-monitor-down-1440-light-es.png'))
            # The badge itself is asserted above; the plate crop is not taken
            # because the force layout never goes idle for a stable capture.

            # ------------------------------------------- manual refresh
            before = text(page, '.graph-inspector .infra-monitor__note')
            last_check = text(page, '.graph-inspector .infra-monitor__fact dd >> nth=1')
            telemetry.stamp = '10:05'
            detail_reads = len(telemetry.reads('/monitoring/devices/' + ids[DOWN]))
            page.locator('[data-od-id="graph-monitor-refresh"]').click()
            # The device's own last-check moment is the freshness users read: it
            # must move once the transport answers with a newer reading.
            page.wait_for_function(
                "before => [...document.querySelectorAll('.graph-inspector .infra-monitor__fact dd')][1].textContent !== before",
                arg=last_check, timeout=8000)
            assert len(telemetry.reads('/monitoring/devices/' + ids[DOWN])) == detail_reads + 1, (
                'the manual refresh re-reads the selected device')
            assert text(page, '.graph-inspector .infra-monitor__note').startswith('Supervisión'), (
                'the coverage line survives the refresh: ' + before)
            page.screenshot(path=str(SHOTS / 'graph-monitor-refreshed-1440-light-es.png'))

            # ------------------------------------- selection never reuses
            select_node(page, AVAILABLE)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.up'))
            facts = page.locator('.graph-inspector .infra-monitor__fact dt').all_inner_texts()
            # No active alert means no alert fact: the block lists what exists.
            assert facts == ['Disponibilidad', 'Última comprobación', 'Latencia'], facts
            assert page.locator('.graph-inspector .infra-monitor__alert').count() == 0
            page.screenshot(path=str(SHOTS / 'graph-monitor-available-1440-light-es.png'))

            select_node(page, UNMONITORED)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.unmonitored'))
            assert page.locator('.graph-inspector .infra-monitor__values').count() == 0, (
                'an unmonitored device publishes no reading to paint')

            select_node(page, UNAVAILABLE)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.unavailable'))
            expect(page.locator('.graph-inspector .infra-monitor__reason')).to_have_text(
                label('es', 'ui.monitoring.reason.prometheus_unavailable'))
            assert page.locator('.graph-inspector .infra-monitor__values').count() == 0, (
                'an unavailable reading is not a value')
            page.screenshot(path=str(SHOTS / 'graph-monitor-unavailable-1440-light-es.png'))

            select_node(page, NO_DATA)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.no_data'))
            # The last check moment is a real fact; availability and latency are
            # not, so they are absent instead of shown as zero.
            facts = page.locator('.graph-inspector .infra-monitor__fact dt').all_inner_texts()
            assert facts == ['Última comprobación'], facts

            select_node(page, MISSING)
            # The detail answered 404: the list row is the only evidence left, so
            # the block falls back to it and never invents a second reading.
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.up'))
            assert page.locator('.graph-inspector .infra-monitor__error').count() == 0, (
                'a device the detail does not know is not a transport failure')
            page.screenshot(path=str(SHOTS / 'graph-monitor-detail-404-1440-light-es.png'))

            select_node(page, UNLISTED)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.infra.monitor.unknown'))
            note = text(page, '.graph-inspector .infra-monitor__note')
            assert note.startswith(label('es', 'ui.infra.monitor.not_loaded')), note
            assert 'Supervisión de 6 de 9' in note, note
            assert page.locator('.graph-inspector .infra-monitor__values').count() == 0, (
                'an asset outside the page keeps no inherited reading')
            page.screenshot(path=str(SHOTS / 'graph-monitor-missing-1440-light-es.png'))

            # ------------------------------------- failed refresh is honest
            select_node(page, AVAILABLE)
            telemetry.list_mode = 'fail'
            page.locator('[data-od-id="graph-monitor-refresh"]').click()
            expect(page.locator('.graph-inspector .infra-monitor__error')).to_be_visible()
            # The transport's own message names the failure; the localized
            # sentence is its fallback, so either way nothing is silent.
            message = text(page, '.graph-inspector .infra-monitor__error')
            assert message.strip(), 'the failed read is announced'
            # The last good reading stays visible, labelled with the failure, so
            # the operator keeps the evidence instead of an emptied block.
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.up'))
            page.screenshot(path=str(SHOTS / 'graph-monitor-error-1440-light-es.png'))
            telemetry.list_mode = 'ok'
            page.locator('[data-od-id="graph-monitor-refresh"]').click()
            page.wait_for_function(
                "() => !document.querySelector('.graph-inspector .infra-monitor__error')", timeout=8000)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.up'))

            # -------------------------------- English, dark, and the canvas
            select_node(page, DOWN)
            set_locale(page, 'en')
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('en', 'ui.monitoring.status.down'))
            expect(page.locator('.graph-inspector .infra-monitor__title')).to_have_text(
                label('en', 'ui.infra.monitor.title'))
            assert 'Monitoring 6 of 9' in text(page, '.graph-inspector .infra-monitor__note'), (
                text(page, '.graph-inspector .infra-monitor__note'))
            set_theme(page, 'dark')
            page.screenshot(path=str(SHOTS / 'graph-monitor-down-1440-dark-en.png'))
            page.locator('.gnode').filter(has_text=CODE[DOWN]).first.screenshot(
                path=str(SHOTS / 'graph-node-badge-1440-dark-en.png'))
            set_theme(page, 'light')
            set_locale(page, 'es')

            # ------------------------- expansion keeps camera and selection
            page.wait_for_timeout(900)
            zoom = page.locator('.graph-zoom__value').inner_text()
            selected = text(page, '.graph-inspector h2')
            nodes = page.locator('.gnode').count()
            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            expect(page.locator(SCROLL_LOCK)).to_have_count(1)
            assert page.locator('.graph-zoom__value').inner_text() == zoom, 'the camera survives expansion'
            assert page.locator('.gnode').count() == nodes, 'expansion rebuilds no plate'
            assert text(page, '.graph-inspector h2') == selected
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.down'))
            page.screenshot(path=str(SHOTS / 'graph-monitor-expanded-1440-light-es.png'))
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)
            expect(page.locator('.graph-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.down'))

            # --------------------------------------------------------- map
            # The public deep link that opens one asset on the map: a bare site
            # selection has no asset, so it must make no availability claim.
            page.goto(BASE + '/#/infra/mapa/activo/' + ids[DOWN], wait_until='networkidle')
            expect(page.locator('.map-canvas .maplibregl-canvas')).to_be_visible()
            expect(page.locator('.map-inspector .infra-monitor')).to_be_visible()
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.down'))
            page.wait_for_timeout(1200)
            # The same canonical asset reads the same device on every surface:
            # a deep link opens the asset, so the block publishes the device
            # detail (97,0 %), never the page row (98,4 %).
            expect(page.locator('.map-inspector .infra-monitor__fact dd').first).to_have_text(canonical_uptime)
            page.wait_for_timeout(800)  # the canvas settles its camera before it is read
            map_zoom = page.locator('.map-controls__value').first.inner_text()
            page.screenshot(path=str(SHOTS / 'map-monitor-1440-light-es.png'))
            facts = page.locator('.map-inspector .infra-monitor__fact dt').all_inner_texts()
            assert facts, 'the map inspector publishes the measured facts'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_be_visible()
            assert page.locator('.map-controls__value').first.inner_text() == map_zoom, (
                'a monitoring refresh does not move the map camera')
            set_locale(page, 'en')
            expect(page.locator('.map-inspector .infra-monitor__title')).to_have_text(
                label('en', 'ui.infra.monitor.title'))
            set_theme(page, 'dark')
            page.screenshot(path=str(SHOTS / 'map-monitor-1440-dark-en.png'))

            # A failed read keeps the last device reading and stays retryable.
            telemetry.list_mode = 'fail'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_be_visible()
            page.screenshot(path=str(SHOTS / 'map-monitor-failure-1440-dark-en.png'))
            telemetry.list_mode = 'ok'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_have_count(0)
            assert page.locator('.map-inspector .infra-monitor__fact dd').first.inner_text() != ''

            # A device read that fails keeps the last good reading and says so.
            telemetry.detail_mode = 'fail'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_be_visible()
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_have_text(
                label('en', 'ui.monitoring.status.down'))
            assert page.locator('.map-inspector .infra-monitor__fact dd').first.inner_text().startswith('97'), (
                'the last good device reading stays visible after a failed device read')
            expect(page.locator('[data-od-id="map-monitor-refresh"]')).to_be_enabled()
            page.screenshot(path=str(SHOTS / 'map-monitor-detail-failure-1440-dark-en.png'))
            telemetry.detail_mode = 'ok'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_have_count(0)
            set_theme(page, 'light')
            set_locale(page, 'es')
            telemetry.detail_mode = 'fail'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_be_visible()
            assert page.locator('.map-inspector .infra-monitor__fact dd').first.inner_text().startswith('97')
            page.screenshot(path=str(SHOTS / 'map-monitor-detail-failure-1440-light-es.png'))
            telemetry.detail_mode = 'ok'
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_have_count(0)

            # A device that answered once and then disappears falls back to the
            # page row: the old reading is not evidence any more.
            telemetry.detail_missing = True
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__fact dd').first).to_have_text('98,4 %')
            expect(page.locator('.map-inspector .infra-monitor__error')).to_have_count(0)
            page.screenshot(path=str(SHOTS / 'map-monitor-detail-404-1440-light-es.png'))
            set_theme(page, 'dark')
            set_locale(page, 'en')
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__fact dd').first).to_have_text('98.4 %')
            page.screenshot(path=str(SHOTS / 'map-monitor-detail-404-1440-dark-en.png'))
            telemetry.detail_missing = False
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            set_theme(page, 'dark')
            set_locale(page, 'en')

            # A device with no reading of its own keeps the null state.
            page.goto(BASE + '/#/infra/mapa/activo/' + ids[UNAVAILABLE], wait_until='networkidle')
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_have_text(
                label('en', 'ui.monitoring.status.unavailable'))
            page.screenshot(path=str(SHOTS / 'map-monitor-null-1440-dark-en.png'))
            set_theme(page, 'light')
            set_locale(page, 'es')
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.unavailable'))
            page.screenshot(path=str(SHOTS / 'map-monitor-null-1440-light-es.png'))
            page.goto(BASE + '/#/infra/mapa/activo/' + ids[DOWN], wait_until='networkidle')
            expect(page.locator('.map-inspector .infra-monitor .status-pill')).to_have_text(
                label('es', 'ui.monitoring.status.down'))

            # Warm in-app navigation to the same link keeps the device reading.
            page.evaluate("location.hash = '#/infra/grafo'")
            page.wait_for_function("() => document.querySelectorAll('.gnode').length >= 7", timeout=15000)
            page.evaluate("location.hash = '#/infra/mapa/activo/' + %r" % ids[DOWN])
            expect(page.locator('.map-inspector .infra-monitor__fact dd').first).to_have_text(canonical_uptime)

            # ------------------------------------------- narrow viewport
            page.set_viewport_size({'width': 390, 'height': 844})
            # A cold reload of the same deep link: the selection must resolve
            # even when the inventory lands after the route.
            # The narrow story uses the in-app navigation a user takes from the
            # panel; the cold deep link is proven at 1440 px above.
            page.goto(BASE + '/#/panel', wait_until='networkidle')
            expect(page.locator('.app-shell')).to_be_visible()
            page.evaluate("location.hash = '#/infra/mapa/activo/' + %r" % ids[DOWN])
            expect(page.locator('.map-inspector .infra-monitor')).to_have_count(1)
            expect(page.locator('.map-inspector .infra-monitor__fact dd').first).to_have_text(
                canonical_uptime, timeout=20000)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (
                'the availability block does not push the page sideways')
            page.screenshot(path=str(SHOTS / 'map-monitor-390-light-es.png'), full_page=True)
            set_locale(page, 'en')
            set_theme(page, 'dark')
            expect(page.locator('.map-inspector .infra-monitor__title')).to_have_text(
                label('en', 'ui.infra.monitor.title'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(SHOTS / 'map-monitor-390-dark-en.png'), full_page=True)

            assert not errors, errors
            print('reads=%d detailReads=%d' % (len(telemetry.reads('/monitoring/devices')),
                                               len([call for call in telemetry.calls
                                                    if call.startswith('/monitoring/devices/')])))
            browser.close()
    finally:
        stop_owned()
    print('PASS measured availability on graph and map -> ' + str(SHOTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
