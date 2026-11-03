"""T6 (S8, S9, S13-S16) — map and graph as expansive infrastructure workspaces.

Own disposable installation, own loopback uvicorn/Vite pair, own SQLite
database inside the OS temp directory: no existing service, database or
credential is read or touched. The scenario seeds canonical organization,
inventory and relationship records through the public API, then proves in
Chromium that:

* both canvases are larger than the previous fixed caps at a desktop viewport;
* the expand control opens an in-app full-window workspace (an honest layout
  state, not the browser Fullscreen API), keeps the MapLibre zoom, the graph
  zoom, the selection and the active filters, and never rebuilds them;
* Escape leaves the workspace, restores focus to its trigger and keeps the
  selection, and the page scroll lock is released;
* the expanded workspace fits a 390 px viewport without horizontal overflow in
  both themes and both locales, with a translated accessible name;
* the built-in family legend chips read in the active locale on both canvases;
* no page error is raised in the whole run.

Screenshots are written under ``.verification/infrastructure-expansion*/`` for
the vision pass.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get('ITSM_T6_BACKEND') or FRONTEND.parent / 'backend')
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
SHOTS = FRONTEND / '.verification' / ('infrastructure-expansion-' + uuid.uuid4().hex[:10])

USERNAME = 't6.admin'
PASSWORD = 'T6-Expansion-Pass-9v'
suffix = uuid.uuid4().hex[:6]
SITE_NAME = 'Sede T6 ' + suffix
# Stable catalog ids, not labels: the server renders category labels in the
# request locale, so matching text would silently pick the wrong category when
# the browser asks for a different language.
ASSETS = [
    ('SRV-T6-' + suffix, 'Servidor T6 ' + suffix, 'servidores'),
    ('SW-T6-' + suffix, 'Switch T6 ' + suffix, 'switches'),
    ('CAM-T6-' + suffix, 'Cámara T6 ' + suffix, 'camaras'),
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


def seed(page) -> None:
    """Canonical organization, inventory and relations through the public API."""
    site = api(page, '/locations', 'POST', {
        'level': 'site', 'parentId': None, 'name': SITE_NAME, 'description': '',
        'latitude': '-25.28', 'longitude': '-57.63', 'planRef': '', 'planPage': '',
    })
    categories = api(page, '/inventory/config')['categories']
    keys = [item.get('id') or item.get('key') for item in categories]
    assert len(keys) >= len(ASSETS), 'the server catalog exposed too few categories'
    created = []
    for index, (code, name, category) in enumerate(ASSETS):
        # The category must match the name so a screenshot cannot show, for
        # example, a camera label on a server.
        assert category in keys, 'the catalog lost the %s category' % category
        record = api(page, '/assets', 'POST', {
            'quickCode': code, 'name': name, 'category': category,
            'siteId': site['id'], 'status': 'in_use',
        })
        stored = api(page, '/assets/' + record['id'])
        assert stored.get('category') == category, 'the server stored another category: %r' % stored.get('category')
        created.append(record)
    type_key = 'depends_on_t6'
    api(page, '/relationship-types', 'POST', {
        'key': type_key, 'forwardLabel': 'Depende de', 'inverseLabel': 'Sostiene',
        'containment': False,
    })
    api(page, '/relationships', 'POST', {
        'typeKey': type_key, 'sourceId': created[0]['id'], 'targetId': created[1]['id'],
    })
    api(page, '/relationships', 'POST', {
        'typeKey': type_key, 'sourceId': created[2]['id'], 'targetId': created[1]['id'],
    })
    api(page, '/assets/' + created[0]['id'], 'PATCH', {'ip': '10.60.0.10'})


def set_theme(page, theme: str) -> None:
    page.evaluate("""theme => {
      document.documentElement.setAttribute('data-theme', theme);
      window.dispatchEvent(new Event('asset-theme-change'));
    }""", theme)


def set_locale(page, locale: str) -> None:
    page.evaluate("async tag => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }", locale)


def legend_texts(page, container: str) -> list[str]:
    """Chip labels of a rendered family legend, in document order.

    The built-in family ids are a frontend enum, so their label must follow the
    active catalog instead of the Spanish-only prototype table.
    """
    return [text.strip() for text in
            page.locator(container).first.locator('.map-legend__item, .graph-legend__item').all_inner_texts()]


def assert_legend(page, container: str, expected: list[str], label: str) -> None:
    """The chip text is the contract; the order of first appearance is not.

    The legend lists one chip per family met while iterating assets/nodes, so
    two runs can meet the same families in a different order.
    """
    chips = legend_texts(page, container)
    assert sorted(chips) == sorted(expected), '%s: %s' % (label, chips)


def settle_size(page, selector: str, minimum: int) -> None:
    """Wait for the real layout to finish; a measured mid-frame is not evidence."""
    page.wait_for_function(
        "([selector, minimum]) => { const node = document.querySelector(selector);"
        " return !!node && node.getBoundingClientRect().height >= minimum; }",
        arg=[selector, minimum], timeout=8000)


def box(page, selector: str) -> dict:
    return page.locator(selector).first.bounding_box()


def paint_stats(png: bytes) -> dict:
    """Describe what the compositor actually painted inside a canvas element.

    A DOM assertion cannot prove the basemap exists: an empty WebGL canvas and a
    missing one look identical from the element tree. The element screenshot is
    the composited frame, so its pixels are the public evidence.
    """
    from io import BytesIO
    from PIL import Image, ImageStat

    image = Image.open(BytesIO(png)).convert('RGB')
    colours = image.getcolors(maxcolors=1 << 24) or []
    statistics = ImageStat.Stat(image)
    return {
        'size': image.size,
        'colours': len(colours),
        'dominant': max(colours)[0] / float(image.size[0] * image.size[1]) if colours else 0.0,
        'rms': round(sum(statistics.rms) / 3.0, 2),
    }


# The basemap's own paint, from AssetMapEngine.mapColors(): the map surface is
# proven by any of its layer colours, not by one luckily dominant shade.
MAP_PALETTE = {
    'light': ((238, 245, 243), (227, 237, 234), (248, 251, 250), (234, 243, 240)),
    'dark': ((8, 26, 34), (15, 40, 49), (18, 48, 56), (23, 57, 63)),
}


def surface_share(page, selector: str, palette, shot: Path) -> tuple[float, tuple[int, int]]:
    """Share of the composited page area that carries the map's own paint.

    The stage behind the map is plain white, so a white region over the basemap is
    exactly what a user sees when MapLibre never drew. Counting the basemap
    backdrop colour in the page screenshot separates the user-visible surface from
    a canvas element that merely exists.
    """
    from io import BytesIO
    from PIL import Image

    rect = page.locator(selector).first.bounding_box()
    png = page.screenshot(clip={'x': rect['x'], 'y': rect['y'], 'width': rect['width'],
                                'height': rect['height']}, path=str(shot))
    image = Image.open(BytesIO(png)).convert('RGB')
    pixels = list(image.getdata())
    near = 0
    for pixel in pixels:
        for rgb in palette:
            if max(abs(pixel[0] - rgb[0]), abs(pixel[1] - rgb[1]), abs(pixel[2] - rgb[2])) <= 6:
                near += 1
                break
    return near / float(len(pixels)), image.size


def assert_surface(page, selector: str, theme: str, label: str, shot: Path) -> float:
    share, size = surface_share(page, selector, MAP_PALETTE[theme], shot)
    assert share > 0.4, '%s: the visible surface is not the basemap (%0.4f of %s)' % (label, share, size)
    return share


def canvas_report(page, selector: str, shot: Path | None = None) -> dict:
    node = page.locator(selector).first
    rect = node.bounding_box()
    png = node.screenshot(path=str(shot) if shot else None)
    report = paint_stats(png)
    report['rect'] = rect
    report['dom'] = page.evaluate("""selector => {
      const canvas = document.querySelector(selector);
      if (!canvas) return { missing: true };
      const stage = canvas.closest('.map-stage, .graph-canvas-wrap');
      const style = getComputedStyle(canvas);
      return {
        backing: [canvas.width, canvas.height],
        css: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
        inline: canvas.getAttribute('style') || '',
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        stage: stage ? [stage.getBoundingClientRect().width, stage.getBoundingClientRect().height] : null,
      };
    }""", selector)
    return report


def assert_container_fill(page, stage: str, container: str) -> list[float]:
    """The MapLibre container must occupy the stage, not collapse in normal flow.

    A container with no height is what made the basemap invisible: MapLibre then
    renders a 0 px viewport inside a 300 px default canvas while the stage's white
    background shows through the rest.
    """
    sizes = page.evaluate("""([stage, container]) => {
      const outer = document.querySelector(stage);
      const inner = document.querySelector(container).getBoundingClientRect();
      return [inner.width, inner.height, outer.clientWidth, outer.clientHeight];
    }""", [stage, container])
    assert abs(sizes[0] - sizes[2]) < 2 and abs(sizes[1] - sizes[3]) < 2, (
        'the map container does not fill its stage: %s' % sizes)
    return sizes


def assert_painted(page, selector: str, label: str, shot: Path | None = None) -> dict:
    """RED-able proof that the canvas surface itself carries the drawing."""
    report = canvas_report(page, selector, shot)
    problems = []
    if not report['rect'] or report['rect']['width'] < 200 or report['rect']['height'] < 200:
        problems.append('canvas element has no usable box')
    if report['colours'] < 3:
        problems.append('only %d painted colour(s)' % report['colours'])
    if report['dominant'] > 0.999:
        problems.append('the surface is a flat fill')
    if report['rms'] < 1.0:
        problems.append('almost no tonal variation (rms %s)' % report['rms'])
    assert not problems, '%s: %s | %s' % (label, ', '.join(problems), report)
    return report


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix='t6-expansion-'))
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = run_env(workdir / 't6.db', workdir / 't6-tasks.db')
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-superadmin', '--username', USERNAME,
                        '--name', 'T6 Expansion'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        owned.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                       '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env))
        wait_for(API + '/api/v1/health/live')
        owned.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                                      cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
        wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            # Software WebGL keeps the MapLibre canvas painted in headless runs.
            browser = playwright.chromium.launch(headless=os.environ.get('ITSM_T6_HEADED') != '1', args=[
                '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            # Pin the browser locale: the UI assertions are Spanish-first and the
            # Accept-Language header also decides which catalog labels the API
            # returns, so an inherited LANG must not change what is rendered.
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
            seed(page)
            errors.clear()

            # ---------------------------------------------------------- map
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            expect(page.locator('.map-canvas .maplibregl-canvas')).to_be_visible()
            expect(page.locator('.map-marker').first).to_be_visible()
            # Frame every seeded site from the canvas control: a resting camera
            # is what the expansion must preserve.
            page.locator('.map-controls [aria-label="Ver todas las sedes"]').click()
            page.wait_for_timeout(400)
            collapsed = box(page, '.map-stage')
            assert collapsed['height'] > 760, 'the map canvas is no longer capped at 760 px: %s' % collapsed
            zoom = page.locator('.map-controls__value').first.inner_text()
            markers = page.locator('.map-marker').count()
            # The built-in family ids are a frontend enum: the chips must read in
            # the active locale instead of the Spanish-only prototype table.
            spanish_legend = ['Servidores y almacenamiento', 'Red y vigilancia']
            english_legend = ['Servers and storage', 'Network and surveillance']
            assert_legend(page, '.map-legend', spanish_legend,
                          'the map legend names the built-in families in Spanish')
            page.locator('.map-legend').first.screenshot(path=str(SHOTS / 'map-legend-1440-light-es.png'))
            assert_container_fill(page, '.map-stage', '.map-canvas')
            assert_painted(page, '.map-canvas .maplibregl-canvas', 'resting map basemap',
                           SHOTS / 'map-canvas-collapsed-1440-light-es.png')
            collapsed_share = assert_surface(page, '.map-stage', 'light', 'resting map surface',
                                             SHOTS / 'map-surface-collapsed-1440-light-es.png')

            # A filter and a selection exist before expanding.
            page.locator('[data-od-id="map-filters-toggle"]').click()
            page.locator('.map-filters .graph-check input').first.click()
            page.locator('.map-marker').first.click()
            expect(page.locator('.map-inspector h2')).to_be_visible()
            selected = page.locator('.map-inspector h2').first.inner_text()
            badge = page.locator('.map-badge').inner_text()
            page.screenshot(path=str(SHOTS / 'map-collapsed-1440-light-es.png'), full_page=False)

            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            expect(page.locator(SCROLL_LOCK)).to_have_count(1)
            settle_size(page, '.map-stage', 860)
            expanded = box(page, '.map-stage')
            assert expanded['height'] > collapsed['height'], (collapsed, expanded)
            assert expanded['height'] >= 860, 'the expanded map fills the window: %s' % expanded
            assert expanded['width'] > collapsed['width'] and expanded['width'] >= 1000, (
                'the expanded map takes the window minus its inspector: %s' % expanded)
            assert page.locator('.map-controls__value').first.inner_text() == zoom, 'the map zoom survives expansion'
            assert page.locator('.map-marker').count() == markers, 'no site marker is lost when expanding'
            assert page.locator('.map-inspector h2').first.inner_text() == selected, 'the selection survives expansion'
            assert page.locator('.map-badge').inner_text() == badge, 'the active filter survives expansion'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.wait_for_timeout(700)
            assert_container_fill(page, '.map-stage', '.map-canvas')
            assert_painted(page, '.map-canvas .maplibregl-canvas', 'expanded map basemap',
                           SHOTS / 'map-canvas-expanded-1440-light-es.png')
            expanded_share = assert_surface(page, '.map-stage', 'light', 'expanded map surface',
                                            SHOTS / 'map-surface-expanded-1440-light-es.png')
            print('map basemap share collapsed=%.4f expanded=%.4f' % (collapsed_share, expanded_share))
            page.screenshot(path=str(SHOTS / 'map-expanded-1440-light-es.png'), full_page=False)

            # Escape leaves the workspace without dropping what the user had.
            page.locator('[data-od-id="map-expand"]').focus()
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)
            expect(page.locator(SCROLL_LOCK)).to_have_count(0)
            assert page.locator('[data-od-id="map-expand"]').get_attribute('aria-pressed') == 'false'
            assert page.evaluate("document.activeElement.getAttribute('data-od-id')") == 'map-expand', 'focus returns to the trigger'
            assert page.locator('.map-inspector h2').first.inner_text() == selected, 'the selection survives exiting'
            page.wait_for_function(
                "() => getComputedStyle(document.querySelector('.map-layout')).position !== 'fixed'", timeout=8000)
            settle_size(page, '.map-stage', 700)
            restored = box(page, '.map-stage')
            assert abs(restored['height'] - collapsed['height']) < 2, (
                'the canvas returns to its resting size: %s vs %s' % (restored, collapsed))

            # Desktop dark + English, expanded. The category filter hides families
            # from the legend, so it is cleared first: the contract under test is
            # the label of every built-in family, not of the filtered subset.
            page.locator('.map-filters__foot .text-button').click()
            expect(page.locator('.map-badge')).to_have_count(0)
            set_theme(page, 'dark')
            set_locale(page, 'en')
            expect(page.locator('[data-od-id="map-expand"]')).to_have_attribute(
                'aria-label', 'Expand the map to the full window')
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            expect(page.locator('[data-od-id="map-expand"]')).to_have_attribute(
                'aria-label', 'Exit the expanded map')
            assert_legend(page, '.map-legend', english_legend,
                          'the map legend follows the active locale')
            page.locator('.map-legend').first.screenshot(path=str(SHOTS / 'map-legend-1440-dark-en.png'))
            page.wait_for_timeout(700)
            page.screenshot(path=str(SHOTS / 'map-expanded-1440-dark-en.png'), full_page=False)
            assert_surface(page, '.map-stage', 'dark', 'expanded dark map surface',
                           SHOTS / 'map-surface-expanded-1440-dark-en.png')
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)
            set_theme(page, 'light')
            set_locale(page, 'es')
            assert_legend(page, '.map-legend', spanish_legend,
                          'the map legend returns to Spanish with the locale')
            page.locator('.map-legend').first.screenshot(path=str(SHOTS / 'map-legend-1440-light-es.png'))

            # -------------------------------------------------------- graph
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.graph-canvas')).to_be_visible()
            expect(page.locator('.gnode').first).to_be_visible()
            graph_collapsed = box(page, '.graph-canvas')
            assert graph_collapsed['height'] > 720, 'the graph canvas is no longer capped at 720 px: %s' % graph_collapsed
            nodes = page.locator('.gnode').count()
            assert nodes >= 3, 'the graph renders the seeded assets: %r' % page.locator('.graph-status').inner_text()
            page.locator('.gnode').filter(has_text=ASSETS[0][0]).first.click()
            expect(page.locator('.graph-inspector h2')).to_be_visible()
            graph_selected = page.locator('.graph-inspector h2').first.inner_text()
            graph_eyebrow = page.locator('.graph-inspector .eyebrow').first.inner_text()
            assert graph_eyebrow == 'SERVIDORES', 'the inspector names the server category: %r' % graph_eyebrow
            graph_status = page.locator('.graph-inspector__meta .status-pill').first.inner_text()
            assert graph_status == 'Asignado', 'the graph inspector localizes the same state: %r' % graph_status
            set_locale(page, 'en')
            english_status = page.locator('.graph-inspector__meta .status-pill').first.inner_text()
            assert english_status == 'Assigned', 'the state follows the active locale: %r' % english_status
            assert_legend(page, '.graph-legend', english_legend,
                          'the graph legend follows the active locale')
            page.locator('.graph-legend').first.screenshot(path=str(SHOTS / 'graph-legend-1440-light-en.png'))
            set_locale(page, 'es')
            assert_legend(page, '.graph-legend', spanish_legend,
                          'the graph legend returns to Spanish with the locale')
            page.locator('.graph-legend').first.screenshot(path=str(SHOTS / 'graph-legend-1440-light-es.png'))
            assert page.locator('.gnode.is-dimmed').count() >= 1, 'unrelated plates recede around the selection'
            # Let the force layout and the inspector layout settle before
            # reading the camera: the resting state is what expansion must keep.
            page.wait_for_timeout(1200)
            graph_zoom = page.locator('.graph-zoom__value').inner_text()
            page.screenshot(path=str(SHOTS / 'graph-collapsed-1440-light-es.png'), full_page=False)

            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            expect(page.locator(SCROLL_LOCK)).to_have_count(1)
            page.wait_for_timeout(400)
            graph_expanded = box(page, '.graph-canvas')
            assert graph_expanded['height'] > graph_collapsed['height'], (
                graph_collapsed, graph_expanded,
                page.locator('.graph-canvas').evaluate(
                    "el => [el.getBoundingClientRect().height, getComputedStyle(el).height,"
                    " getComputedStyle(el.parentElement).display, getComputedStyle(el.parentElement).height,"
                    " getComputedStyle(el.parentElement).gridTemplateRows, el.parentElement.children.length]"))
            assert graph_expanded['width'] > graph_collapsed['width'] and graph_expanded['width'] >= 1000, (
                'the expanded graph takes the window minus its inspector: %s' % graph_expanded)
            assert page.locator('.graph-zoom__value').inner_text() == graph_zoom, 'the graph zoom survives expansion'
            assert page.locator('.gnode').count() == nodes, 'no node is rebuilt by expanding'
            assert page.locator('.graph-inspector h2').first.inner_text() == graph_selected
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.wait_for_timeout(400)
            assert_painted(page, '.graph-canvas', 'expanded graph canvas',
                           SHOTS / 'graph-canvas-expanded-1440-light-es.png')
            page.screenshot(path=str(SHOTS / 'graph-expanded-1440-light-es.png'), full_page=False)

            page.locator('[data-od-id="graph-expand"]').focus()
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)
            expect(page.locator(SCROLL_LOCK)).to_have_count(0)
            settle_size(page, '.graph-canvas', 560)
            assert page.evaluate("document.activeElement.getAttribute('data-od-id')") == 'graph-expand'
            assert page.locator('.graph-inspector h2').first.inner_text() == graph_selected, 'Escape keeps the selection'

            set_theme(page, 'dark')
            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            page.screenshot(path=str(SHOTS / 'graph-expanded-1440-dark-es.png'), full_page=False)
            page.keyboard.press('Escape')
            set_theme(page, 'light')

            # ------------------------------------------------ narrow viewport
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            expect(page.locator('.map-marker').first).to_be_visible()
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            settle_size(page, '.map-stage', 700)
            narrow = box(page, '.map-stage')
            assert narrow['width'] <= 390 and narrow['height'] >= 640, narrow
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow when expanded'
            page.wait_for_timeout(700)
            page.screenshot(path=str(SHOTS / 'map-expanded-390-light-es.png'), full_page=False)
            # English is the longer copy on the narrow canvas: the chips must still
            # fit without pushing the page sideways.
            set_locale(page, 'en')
            assert_legend(page, '.map-legend', english_legend,
                          'the narrow expanded map legend is translated')
            page.locator('.map-legend').first.screenshot(path=str(SHOTS / 'map-legend-390-light-en.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            set_locale(page, 'es')
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)

            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow in the expanded graph'
            page.screenshot(path=str(SHOTS / 'graph-expanded-390-light-es.png'), full_page=False)
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)

            assert not errors, errors
            browser.close()
    finally:
        stop_owned()
    print('PASS map/graph expansive workspace, expand, Escape, state preservation -> ' + str(SHOTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
