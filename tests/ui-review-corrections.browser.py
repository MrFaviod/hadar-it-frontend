"""Focused browser proof for the three review corrections (JD-S1, JD-I1, JD-I2).

Own disposable installation: a temporary SQLite database, a loopback uvicorn API
and the Vite dev server, both started and stopped by this script. The checks use
only public UI behaviour plus the HTTP payload the export screen really sends.

Covered defects:
  JD-S1  Enter/Space on the graph expand control must expand the canvas instead
         of navigating to the selected asset; the canvas keeps its own Enter.
  JD-I1  the favorite control keeps its 44 px target and reset chrome, with a
         visible keyboard focus ring, in light and dark themes.
  JD-I2  a restored inventory location/status stays visible as a clearable chip,
         and clearing it changes the next export request.

Run: python3 tests/ui-review-corrections.browser.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

SCRIPT_FRONTEND = Path(__file__).resolve().parent.parent
FRONTEND = Path(os.environ.get('ITSM_UI_REVIEW_FRONTEND') or SCRIPT_FRONTEND).resolve()
BACKEND = Path(os.environ.get('ITSM_T6_BACKEND') or SCRIPT_FRONTEND.parent / 'backend')
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
SHOTS = Path(os.environ.get('ITSM_UI_REVIEW_SHOTS') or FRONTEND / '.verification' / ('ui-review-corrections-' + uuid.uuid4().hex[:10]))
USERNAME = 'review.corrections'
PASSWORD = 'Review-Corrections-Pass-9v'
SUFFIX = uuid.uuid4().hex[:6].upper()
SITE_NAME = 'Sede revision ' + SUFFIX
LOCATION_NAME = 'Sala revision ' + SUFFIX
ASSET_A = ('SRV-RV-' + SUFFIX, 'Servidor revision ' + SUFFIX, 'servidores')
ASSET_B = ('SW-RV-' + SUFFIX, 'Switch revision ' + SUFFIX, 'switches')
EXPANDED = '.graph-page.is-expanded'
SCROLL_LOCK = 'body.graph-workspace-expanded'

owned = []
API_PORT = 0
WEB_PORT = 0
API = ''
BASE = ''


def free_port():
    import socket
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_for(url, timeout=90):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001 - readiness polling
            last = exc
        time.sleep(0.3)
    raise RuntimeError('timed out waiting for %s (%s)' % (url, last))


def stop_owned():
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def run_env(database, tasks):
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
        'ITSM_PROMETHEUS_URL': '',
        'ITSM_MEILISEARCH_URL': '',
        'ITSM_SERVICE_REDIS_URL': '',
        'PYTHONPATH': str(BACKEND)
    })
    return env


API_JS = """
async path => {
  const session = await (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json();
  return session;
}
"""


def api(page, path, method='GET', body=None):
    result = page.evaluate(
        """async ([path, method, body]) => {
          const me = await (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json();
          const response = await fetch('/api/v1' + path, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken },
            body: body === null ? undefined : JSON.stringify(body)
          });
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : null };
        }""",
        [path, method, body]
    )
    if result['status'] >= 400:
        raise AssertionError('%s %s -> %s %s' % (method, path, result['status'], json.dumps(result['body'])[:300]))
    return result['body']


def set_theme(page, theme):
    page.evaluate(
        """theme => {
          document.documentElement.setAttribute('data-theme', theme);
          window.dispatchEvent(new CustomEvent('asset-theme-change', { detail: { theme } }));
        }""",
        theme
    )
    page.wait_for_timeout(120)


def set_locale(page, locale):
    page.evaluate(
        """tag => window.ItsmI18n.loadBundle(tag).then(() => window.ItsmI18n.setLocale(tag))""",
        locale
    )
    page.wait_for_timeout(200)


def settle(page):
    page.wait_for_function("""() => !document.querySelector('.page-enter-active,.page-leave-active')""")
    page.wait_for_timeout(120)


def visit(page, route, heading):
    page.goto(BASE + '/#/' + route, wait_until='networkidle')
    expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
    settle(page)


def seed(page):
    site = api(page, '/locations', 'POST', {'level': 'site', 'name': SITE_NAME})
    location = api(page, '/locations', 'POST', {'level': 'building', 'parentId': site['id'], 'name': LOCATION_NAME})
    config = api(page, '/inventory/config')
    categories = {item['id'] for item in config['categories']}
    category_a = 'servidores' if 'servidores' in categories else sorted(categories)[0]
    category_b = 'switches' if 'switches' in categories else sorted(categories)[-1]
    assets = []
    for (code, name, default_category), placing in ((ASSET_A, True), (ASSET_B, False)):
        category = category_a if placing else category_b
        body = {'quickCode': code, 'name': name, 'category': category, 'siteId': site['id'], 'status': 'in_use'}
        if placing:
            body['locationId'] = location['id']
        assets.append(api(page, '/assets', 'POST', body))
    type_key = 'depends_on_rv' + SUFFIX.lower()
    api(page, '/relationship-types', 'POST', {
        'key': type_key,
        'forwardLabel': 'Depende de',
        'inverseLabel': 'Sostiene',
        'containment': False
    })
    api(page, '/relationships', 'POST', {
        'sourceId': assets[0]['id'],
        'targetId': assets[1]['id'],
        'typeKey': type_key
    })
    view = api(page, '/workspace/views', 'POST', {
        'name': 'Planta ' + SUFFIX,
        'route': 'inventory',
        'scope': 'personal',
        'snapshot': {
            'prefs': {'category': 'all', 'site': 'all', 'search': '', 'view': 'table', 'sort': 'name-asc'},
            'inventory': {
                'status': 'all',
                'location': location['id'],
                'columns': ['model', 'location', 'assignee', 'ip', 'remote']
            },
            'selection': []
        }
    })
    labels = {item['id']: item.get('label', item['id']) for item in config['categories']}
    return {'site': site, 'location': location, 'assets': assets, 'view': view,
            'category_a': category_a, 'category_a_label': labels.get(category_a, category_a),
            'category_b': category_b}


def measure(page, selector):
    return page.eval_on_selector(selector, """el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        width: Math.round(rect.width), height: Math.round(rect.height),
        borderRadius: style.borderRadius, backgroundColor: style.backgroundColor,
        fontSize: style.fontSize, outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle, outlineColor: style.outlineColor,
        display: style.display
      };
    }""")


def scroll_state(page):
    return page.evaluate("() => ({ width: document.documentElement.scrollWidth, inner: window.innerWidth })")


def shot(page, name):
    path = SHOTS / (name + '.png')
    page.screenshot(path=str(path), full_page=False)
    return str(path)


def graph_scenario(page, shots, failures):
    """JD-S1: the graph control keeps Enter/Space; the canvas keeps its Enter."""
    try:
        visit(page, 'infra/grafo', 'Grafo de relaciones')
        node = page.locator('.gnode').first
        expect(node).to_be_visible()
        node.click()
        settle(page)
        record = page.locator('.graph-inspector h2').first.inner_text()
        assert page.evaluate('() => location.hash') == '#/infra/grafo', 'selecting a node stays on the graph'

        toggle = page.locator('[data-od-id="graph-expand"]')
        toggle.focus()
        assert page.evaluate("() => document.activeElement.getAttribute('data-od-id')") == 'graph-expand'
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        if page.locator(EXPANDED).count() != 1:
            failures.append('JD-S1 Enter on the expand control did not expand the graph (hash=%s)'
                            % page.evaluate('() => location.hash'))
            shot(page, 's1-red-graph-enter-navigated-1440-light-es')
            return
        assert page.evaluate('() => location.hash') == '#/infra/grafo', 'expanding the graph does not open the selected asset'
        assert page.locator(SCROLL_LOCK).count() == 1, 'the expanded workspace locks the page scroll'
        assert page.locator('.graph-inspector h2').first.inner_text() == record, 'the selection survives the expansion'
        shots.append(shot(page, 's1-graph-expanded-enter-1440-light-es'))

        # Enter again leaves the expanded workspace.
        toggle.focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 0, 'Enter on the focused control leaves the expanded workspace'
        assert page.evaluate('() => location.hash') == '#/infra/grafo'

        # Space activates the same native control.
        toggle.focus()
        page.keyboard.press('Space')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 1, 'Space on the focused control expands the workspace'
        page.keyboard.press('Space')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 0, 'Space on the focused control leaves the workspace'

        # Escape still leaves the expanded workspace and keeps the selection.
        toggle.focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 1
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 0, 'Escape leaves the expanded graph'
        assert page.locator('.graph-inspector h2').first.inner_text() == record, 'Escape keeps the selection'
        assert page.evaluate("() => document.activeElement.getAttribute('data-od-id')") == 'graph-expand', 'Escape returns focus to the expand control'

        # The canvas keeps its own Enter shortcut for the selected asset.
        page.locator('.graph-canvas').focus()
        assert page.evaluate("() => document.activeElement.getAttribute('data-od-id')") is None
        canvas_target = page.evaluate("() => document.activeElement.className")
        assert 'graph-canvas' in canvas_target, 'the canvas owns the keyboard focus'
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)
        assert page.evaluate('() => location.hash').startswith('#/activo/'), 'canvas Enter opens the selected asset'
        shots.append(shot(page, 's1-graph-canvas-enter-opens-1440-light-es'))

        # Dark theme and 390 px keep the control usable and the page inside the viewport.
        page.go_back()
        visit(page, 'infra/grafo', 'Grafo de relaciones')
        page.locator('.gnode').first.click()
        set_theme(page, 'dark')
        page.locator('[data-od-id="graph-expand"]').focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)
        assert page.locator(EXPANDED).count() == 1, 'Enter still expands in the dark theme'
        shots.append(shot(page, 's1-graph-expanded-enter-1440-dark-es'))
        set_theme(page, 'light')

        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('[data-od-id="graph-expand"]').focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 0, 'Enter leaves the narrow expanded workspace'
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)
        assert page.locator(EXPANDED).count() == 1, 'Enter still expands at 390 px'
        assert scroll_state(page)['width'] <= scroll_state(page)['inner'], 'the expanded graph does not overflow horizontally at 390 px'
        shots.append(shot(page, 's1-graph-expanded-enter-390-light-es'))
        set_locale(page, 'en')
        shots.append(shot(page, 's1-graph-expanded-enter-390-light-en'))
        set_locale(page, 'es')
        page.locator('[data-od-id="graph-expand"]').focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        assert page.locator(EXPANDED).count() == 0, 'the workspace is left before the next view'
        page.set_viewport_size({'width': 1440, 'height': 1000})
    except Exception as exc:  # noqa: BLE001 - collect and continue with the other defects
        failures.append('JD-S1 %s: %s' % (type(exc).__name__, exc))
        try:
            shot(page, 's1-red-error')
        except Exception:  # noqa: BLE001
            pass


def favorite_scenario(page, shots, failures):
    """JD-I1: the current-view favorite keeps its 44 px reset chrome and focus."""
    try:
        visit(page, 'inventario', 'Inventario de activos')
        selector = '[data-od-id="favorite-current"]'
        expect(page.locator(selector)).to_have_count(1)
        metrics = measure(page, selector)
        assert metrics['width'] == 44 and metrics['height'] == 44, 'the favorite control keeps its 44 px target: %s' % metrics
        assert metrics['borderRadius'] == '6px', 'the reset keeps the 6 px radius: %s' % metrics
        assert metrics['backgroundColor'] == 'rgba(0, 0, 0, 0)', 'the reset keeps no button background: %s' % metrics
        assert metrics['fontSize'] == '24px', 'the reset keeps the 24 px icon size: %s' % metrics
        assert metrics['display'] != 'inline', 'the control is laid out as a button: %s' % metrics

        page.locator(selector).focus()
        focused = measure(page, selector)
        assert focused['outlineStyle'] == 'solid' and float(focused['outlineWidth'].replace('px', '')) >= 2, \
            'the keyboard focus ring is visible: %s' % focused
        shots.append(shot(page, 's2-favorite-focused-1440-light-es'))

        shots.append(shot(page, 's2-favorite-control-1440-light-es'))
        set_theme(page, 'dark')
        dark = measure(page, selector)
        assert dark['width'] == 44 and dark['height'] == 44, 'the target holds in the dark theme: %s' % dark
        assert dark['backgroundColor'] == 'rgba(0, 0, 0, 0)', 'the dark reset keeps no button background: %s' % dark
        shots.append(shot(page, 's2-favorite-control-1440-dark-es'))

        page.set_viewport_size({'width': 390, 'height': 844})
        narrow = measure(page, selector)
        assert narrow['width'] == 44 and narrow['height'] == 44, 'the target holds at 390 px: %s' % narrow
        shots.append(shot(page, 's2-favorite-control-390-dark-es'))
        set_theme(page, 'light')
        shots.append(shot(page, 's2-favorite-control-390-light-es'))
        assert scroll_state(page)['width'] <= scroll_state(page)['inner'], 'the inventory page does not overflow at 390 px'
        page.set_viewport_size({'width': 1440, 'height': 1000})
    except Exception as exc:  # noqa: BLE001
        failures.append('JD-I1 %s: %s' % (type(exc).__name__, exc))
        try:
            shot(page, 's2-red-error')
        except Exception:  # noqa: BLE001
            pass


def open_inventory_view(page, view_name):
    visit(page, 'inventario', 'Inventario de activos')
    page.locator('[data-od-id="open-saved-views"]').click()
    panel = page.locator('#workspace-views-panel')
    expect(panel).to_be_visible()
    panel.locator('button.workspace-popover__open', has_text=view_name).click()
    settle(page)


def export_filters(page, requests):
    page.goto(BASE + '/#/datos/exportar', wait_until='networkidle')
    expect(page.get_by_role('heading', name='Importar y exportar', exact=True)).to_be_visible()
    generate = page.locator('[data-od-id="export-generate"]')
    expect(generate).to_be_enabled()
    before = len(requests)
    generate.click()
    page.wait_for_function("() => true")
    deadline = time.time() + 20
    while len(requests) == before and time.time() < deadline:
        page.wait_for_timeout(150)
    assert len(requests) > before, 'the export request reached the API'
    return requests[-1]


def inventory_filter_scenario(page, data, requests, shots, failures):
    """JD-I2: a restored inventory filter is visible, clearable and real."""
    try:
        open_inventory_view(page, 'Planta ' + SUFFIX)
        # The mechanism of the defect: the restored location already narrows the
        # export before anything on screen names it.
        body = export_filters(page, requests)
        filters = body.get('filters') or {}
        assert filters.get('location_id') == data['location']['id'], 'the restored location narrows the export: %s' % body
        visit(page, 'inventario', 'Inventario de activos')
        surface = page.locator('[data-od-id="inventory-restored-filters"]')
        if surface.count() == 0:
            failures.append('JD-I2 the restored location narrows the export (location_id=%s) '
                            'while inventory shows no visible filter or reset action' % data['location']['id'])
            shots.append(shot(page, 's3-restored-location-invisible'))
            return
        expect(surface).to_be_visible()
        chips = page.locator('[data-od-id="inventory-restored-filters"] button[aria-label]')
        assert LOCATION_NAME in ' '.join(chips.all_inner_texts()), \
            'the restored location is named with its catalog label: %s' % chips.all_inner_texts()
        assert page.locator('#inventory-status-filter').count() == 1, 'the canonical status select still renders'
        assert len(chips.all_inner_texts()) == 1, 'one restored filter, one chip: %s' % chips.all_inner_texts()
        shots.append(shot(page, 's3-inventory-restored-location-1440-light-es'))

        # Ordinary canonical filters stay independent of the restored chip.
        visit(page, 'inventario', 'Inventario de activos')
        page.locator('#inventory-status-filter').select_option('in_use')
        page.locator('.category-rail .chip', has_text=data['category_a_label']).first.click()
        settle(page)
        body = export_filters(page, requests)
        filters = body.get('filters') or {}
        assert filters.get('status') == 'in_use', 'the canonical status filter still reaches the export: %s' % body
        assert filters.get('category') == data['category_a'], 'the canonical category filter still reaches the export: %s' % body
        assert filters.get('location_id') == data['location']['id'], 'the restored location still applies alongside canonical filters: %s' % body
        shots.append(shot(page, 's3-inventory-canonical-filters-1440-light-es'))

        # Clearing the visible chip removes it from the applied export filter.
        open_inventory_view(page, 'Planta ' + SUFFIX)
        page.locator('[data-od-id="inventory-restored-filters"] button[aria-label]', has_text=LOCATION_NAME).first.click()
        settle(page)
        remaining = page.locator('[data-od-id="inventory-restored-filters"] button[aria-label]').all_inner_texts()
        assert LOCATION_NAME not in ' '.join(remaining), 'clearing the chip removes the location: %s' % remaining
        body = export_filters(page, requests)
        filters = body.get('filters') or {}
        assert 'location_id' not in filters, 'the cleared location no longer narrows the export: %s' % body
        assert filters.get('status') == 'in_use', 'the canonical status survives clearing the restored chip: %s' % body

        # Responsive, dark and translated states keep the surface usable.
        open_inventory_view(page, 'Planta ' + SUFFIX)
        set_theme(page, 'dark')
        shots.append(shot(page, 's3-inventory-restored-location-1440-dark-es'))
        page.set_viewport_size({'width': 390, 'height': 844})
        chips = page.locator('[data-od-id="inventory-restored-filters"] button[aria-label]')
        assert chips.count() >= 1, 'the restored filter stays visible at 390 px'
        assert scroll_state(page)['width'] <= scroll_state(page)['inner'], 'the inventory page does not overflow at 390 px'
        shots.append(shot(page, 's3-inventory-restored-location-390-dark-es'))
        set_theme(page, 'light')
        shots.append(shot(page, 's3-inventory-restored-location-390-light-es'))
        set_locale(page, 'en')
        shots.append(shot(page, 's3-inventory-restored-location-390-light-en'))
        set_locale(page, 'es')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.locator('[data-od-id="inventory-restored-filters"] .text-button').first.click()
        settle(page)
        assert page.locator('[data-od-id="inventory-restored-filters"]').count() == 0, \
            'the reset action clears the surfaced filters'
    except Exception as exc:  # noqa: BLE001
        failures.append('JD-I2 %s: %s' % (type(exc).__name__, exc))
        try:
            shot(page, 's3-red-error')
        except Exception:  # noqa: BLE001
            pass


def main():
    global API_PORT, WEB_PORT, API, BASE
    API_PORT = free_port()
    WEB_PORT = free_port()
    API = 'http://127.0.0.1:%d' % API_PORT
    BASE = 'http://127.0.0.1:%d' % WEB_PORT
    SHOTS.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix='ui-review-corrections-'))
    env = run_env(workdir / 'review.db', workdir / 'review-tasks.db')

    shots = []
    failures = []
    requests = []

    subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env,
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-superadmin',
                    '--username', USERNAME, '--name', 'Review Corrections'],
                   cwd=BACKEND, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    owned.append(subprocess.Popen(
        [str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1', '--port', str(API_PORT), '--log-level', 'warning'],
        cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
    try:
        wait_for(API + '/api/v1/health/live')
        owned.append(subprocess.Popen(
            ['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
            cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
        wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=os.environ.get('ITSM_REVIEW_HEADED') != '1',
                args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce', locale='es-PY')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def capture_export(route, request):
                try:
                    requests.append(json.loads(request.post_data or '{}'))
                except Exception:  # noqa: BLE001 - the payload is JSON by contract
                    requests.append({})
                route.fulfill(status=200, content_type='text/csv', body='id,name\n')

            page.route('**/api/v1/assets/export', capture_export)

            page.goto(BASE + '/#/login', wait_until='networkidle')
            page.get_by_label('Usuario', exact=True).fill(USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            data = seed(page)
            errors.clear()

            graph_scenario(page, shots, failures)
            favorite_scenario(page, shots, failures)
            inventory_filter_scenario(page, data, requests, shots, failures)

            if not failures:
                assert not errors, errors
            browser.close()
            context.close()
    finally:
        stop_owned()

    print('covered: JD-S1, JD-I1, JD-I2')
    print('location: %s (%s)' % (data['location']['name'], data['location']['id']))
    print('exports observed: %d' % len(requests))
    print('screenshots (%d):' % len(shots))
    for path in shots:
        print(' - ' + path)
    if errors:
        print('page errors: ' + json.dumps(errors))
    if failures:
        print('FAIL')
        for failure in failures:
            print(' - ' + failure)
        return 1
    print('PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
