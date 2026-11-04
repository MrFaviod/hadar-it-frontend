"""U7 (S3): individual visual pass over the geography, floor and graph views.

The unit walks one rendered state at a time and writes one PNG per state, so a
human can open each image on its own instead of trusting a contact sheet:

* geography: empty installation, resting explorer, selected site, active filter,
  expanded workspace (desktop dark/English and 390 px);
* floor: ready plan with placed devices and room groups, selected device,
  selected room, filtered-empty floor, floor without plan, plan loading, plan
  failure and the retry that recovers it, narrow viewport;
* graph: resting global layout, selected device with its relation rows, focus
  mode reached by deep link, filtered-empty canvas, expanded dark/English and
  390 px.

The fixture is the disposable installation already used by
``infrastructure-expansion.browser.py`` (own OS-temp SQLite, own loopback
uvicorn/Vite pair, canonical records seeded through the public API). This unit
additionally owns the attachment root so a real raster floor plan can be
uploaded through ``PUT /locations/{id}/plan``; no existing service, database,
credential or stored file is read or touched.

Only external telemetry may be scripted: the single ``page.route`` in this file
turns a monitoring device read into a 503 so the inspector can show its real
error branch. Map, floor, graph, directory, inventory and plan answers always
come from the disposable backend. No Prometheus, Alertmanager, agent, device or
provider is contacted, and no write is confirmed beyond the fixture seeding.

Run: cd frontend && python3 tests/ui-infrastructure-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get('ITSM_U7_BACKEND') or FRONTEND.parent / 'backend')
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
SHOTS = FRONTEND / '.verification' / ('ui-infrastructure-visual-' + uuid.uuid4().hex[:10])

spec = importlib.util.spec_from_file_location(
    'expansion_fixture', Path(__file__).with_name('infrastructure-expansion.browser.py')
)
expansion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expansion)

USERNAME = 'u7.admin'
PASSWORD = 'U7-Visual-Pass-4k'
suffix = uuid.uuid4().hex[:6]
SITE = 'Sede U7 ' + suffix
BUILDING = 'Edificio U7 ' + suffix
FLOOR_A = 'Planta baja U7'
FLOOR_B = 'Planta alta U7'
FLOOR_EMPTY = 'Planta vacía U7'
ROOM_A = 'Sala de servidores'
ROOM_B = 'Oficina técnica'

# code, name, category, locationId, position (relative 0..1) or None
ASSETS = [
    ('SRV-U7-' + suffix, 'Servidor U7 ' + suffix, 'servidores', 'room-a', ('0.28', '0.32')),
    ('SW-U7-' + suffix, 'Switch U7 ' + suffix, 'switches', 'room-a', None),
    ('CAM-U7-' + suffix, 'Cámara U7 ' + suffix, 'camaras', 'room-b', None),
    ('MON-U7-' + suffix, 'Monitor U7 ' + suffix, 'monitores', 'room-b', ('0.70', '0.62')),
    ('NB-U7-' + suffix, 'Notebook U7 ' + suffix, 'notebooks', 'floor-a', None),
    ('PRN-U7-' + suffix, 'Impresora U7 ' + suffix, 'impresoras', 'floor-b', None),
]
TYPE_KEY = 'depends_on_u7'

owned: list[subprocess.Popen] = []
SHOT_INDEX: list[str] = []

API_PORT = expansion.free_port()
WEB_PORT = expansion.free_port()
API = 'http://127.0.0.1:%d' % API_PORT
BASE = 'http://127.0.0.1:%d' % WEB_PORT


def stop_owned() -> None:
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def run_env(workdir: Path) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith('ITSM_')}
    env.update({
        'ITSM_DATABASE_URL': 'sqlite+pysqlite:///' + str(workdir / 'u7.db'),
        'ITSM_TASK_SQLITE_PATH': str(workdir / 'u7-tasks.db'),
        'ITSM_ATTACHMENT_STORAGE_PATH': str(workdir / 'attachments'),
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


def shot(page, name: str, state: str) -> None:
    """One rendered state, one file: the name carries view, state and matrix.

    Two animation frames are awaited first: the expanded workspace moves a fixed
    container, and a capture taken mid-frame keeps the previous compositing
    offset, which shows up as clipped text at the frame's edge.
    """
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.screenshot(path=str(SHOTS / (name + '.png')), full_page=False)
    SHOT_INDEX.append(name + '.png  <- ' + state)


def set_theme(page, theme: str) -> None:
    page.evaluate("""theme => {
      document.documentElement.setAttribute('data-theme', theme);
      window.dispatchEvent(new Event('asset-theme-change'));
    }""", theme)


def set_locale(page, locale: str) -> None:
    page.evaluate("async tag => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }",
                  locale)


def plan_png() -> bytes:
    """A fixture floor plan: a real raster, drawn here, never fetched."""
    from io import BytesIO

    from PIL import Image, ImageDraw

    image = Image.new('RGB', (1600, 1000), (243, 247, 246))
    draw = ImageDraw.Draw(image)
    draw.rectangle([60, 60, 1560, 940], outline=(120, 140, 142), width=6)
    draw.rectangle([110, 110, 760, 620], outline=(120, 140, 142), width=4)
    draw.rectangle([840, 110, 1500, 620], outline=(120, 140, 142), width=4)
    draw.rectangle([110, 680, 1500, 890], outline=(120, 140, 142), width=4)
    draw.line([60, 650, 1560, 650], fill=(160, 176, 178), width=3)
    draw.text((150, 150), 'Sala de servidores', fill=(60, 80, 84))
    draw.text((880, 150), 'Oficina tecnica', fill=(60, 80, 84))
    draw.text((150, 730), 'Pasillo', fill=(60, 80, 84))
    buffer = BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def upload_plan(page, floor_id: str) -> None:
    """Real raster bytes through the canonical plan endpoint (CSRF, cookie)."""
    import base64

    payload = base64.b64encode(plan_png()).decode('ascii')
    result = page.evaluate("""async args => {
      const session = await (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json();
      const bytes = Uint8Array.from(atob(args.data), (value) => value.charCodeAt(0));
      const response = await fetch('/api/v1/locations/' + args.id + '/plan', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'image/png', 'X-CSRF-Token': session.csrfToken },
        body: bytes,
      });
      let body = null;
      try { body = await response.json(); } catch (error) { body = null; }
      return { status: response.status, body: body };
    }""", {'id': floor_id, 'data': payload})
    assert result['status'] == 200, 'the plan upload failed: %s' % result


def seed(page) -> dict[str, str]:
    site = expansion.api(page, '/locations', 'POST', {
        'level': 'site', 'parentId': None, 'name': SITE, 'description': '',
        'latitude': '-25.28', 'longitude': '-57.63', 'planRef': '', 'planPage': '',
    })
    building = expansion.api(page, '/locations', 'POST', {
        'level': 'building', 'parentId': site['id'], 'name': BUILDING, 'description': '',
    })
    floor_a = expansion.api(page, '/locations', 'POST', {
        'level': 'floor', 'parentId': building['id'], 'name': FLOOR_A, 'description': '',
    })
    floor_b = expansion.api(page, '/locations', 'POST', {
        'level': 'floor', 'parentId': building['id'], 'name': FLOOR_B, 'description': '',
    })
    floor_empty = expansion.api(page, '/locations', 'POST', {
        'level': 'floor', 'parentId': building['id'], 'name': FLOOR_EMPTY, 'description': '',
    })
    room_a = expansion.api(page, '/locations', 'POST', {
        'level': 'room_zone', 'parentId': floor_a['id'], 'name': ROOM_A, 'description': '',
    })
    room_b = expansion.api(page, '/locations', 'POST', {
        'level': 'room_zone', 'parentId': floor_a['id'], 'name': ROOM_B, 'description': '',
    })
    where = {'room-a': room_a['id'], 'room-b': room_b['id'], 'floor-a': floor_a['id'],
             'floor-b': floor_b['id']}
    created = {}
    for code, name, category, location, position in ASSETS:
        body = {
            'quickCode': code, 'name': name, 'category': category,
            'siteId': site['id'], 'locationId': where[location], 'status': 'in_use',
        }
        if position:
            body['positionX'] = position[0]
            body['positionY'] = position[1]
        record = expansion.api(page, '/assets', 'POST', body)
        created[code] = record
    expansion.api(page, '/assets/' + created['SRV-U7-' + suffix]['id'], 'PATCH', {'ip': '10.70.0.10'})
    expansion.api(page, '/relationship-types', 'POST', {
        'key': TYPE_KEY, 'forwardLabel': 'Depende de', 'inverseLabel': 'Sostiene', 'containment': False,
    })
    expansion.api(page, '/relationships', 'POST', {
        'typeKey': TYPE_KEY, 'sourceId': created['SRV-U7-' + suffix]['id'],
        'targetId': created['SW-U7-' + suffix]['id'],
    })
    expansion.api(page, '/relationships', 'POST', {
        'typeKey': TYPE_KEY, 'sourceId': created['CAM-U7-' + suffix]['id'],
        'targetId': created['SW-U7-' + suffix]['id'],
    })
    upload_plan(page, floor_a['id'])
    return {
        'site': site['id'], 'building': building['id'], 'floor_a': floor_a['id'],
        'floor_b': floor_b['id'], 'floor_empty': floor_empty['id'],
        'room_a': room_a['id'], 'room_b': room_b['id'],
        'server': created['SRV-U7-' + suffix]['id'], 'switch': created['SW-U7-' + suffix]['id'],
        'camera': created['CAM-U7-' + suffix]['id'], 'monitor': created['MON-U7-' + suffix]['id'],
    }


def open_floor(page, name: str) -> None:
    """Reach a floor through the location tree: site, building, floor."""
    tree = page.locator('.loc-tree')
    toggle = tree.locator('.loc-tree__toggle').first
    if toggle.get_attribute('aria-expanded') != 'true':
        toggle.click()
    building = tree.locator('.loc-tree__building').first
    if building.get_attribute('aria-expanded') != 'true':
        building.click()
    tree.locator('.loc-tree__floor').filter(has_text=name).first.click()


def select_marker(page, code: str) -> None:
    page.locator('.floor-marker').filter(has_text=code).first.click()


def map_filters_open(page) -> None:
    """The filter panel is a toggle: open it only when it is closed."""
    if page.locator('[data-od-id="map-filters"]').count() == 0:
        page.locator('[data-od-id="map-filters-toggle"]').click()
    expect(page.locator('[data-od-id="map-filters"]')).to_be_visible()


def set_category(page, label: str, checked: bool = True) -> None:
    map_filters_open(page)
    box = page.locator('.map-filters .graph-check').filter(has_text=label).first.locator('input')
    if box.is_checked() != checked:
        box.click()


def clear_map_filters(page) -> None:
    map_filters_open(page)
    page.locator('.map-filters__foot .text-button').click()
    expect(page.locator('.map-badge')).to_have_count(0)


def select_graph_node(page, code: str) -> None:
    """Select a graph node through its plate: the label text ignores pointers."""
    node = page.locator('.gnode').filter(has_text=code).first
    node.locator('.gnode__plate').click()


def settle_monitor(page, selector: str) -> None:
    """Wait for the monitoring pane to finish its read before capturing it."""
    page.wait_for_function(
        'selector => { const pane = document.querySelector(selector);'
        ' return pane && !pane.innerText.includes("Actualizando"); }',
        arg=selector)


def close_map_filters(page) -> None:
    if page.locator('[data-od-id="map-filters"]').count():
        page.locator('[data-od-id="map-filters-toggle"]').click()
        expect(page.locator('[data-od-id="map-filters"]')).to_have_count(0)


def assert_floor_overlays_clear(page, where: str) -> None:
    """The floating floor controls and legend must not sit over loose-group rows.

    Public geometry (intersection area between the floating overlays and each
    row or the drag hint) plus a hit test at the overlap centre, so an overlay
    that merely borders a row is fine while a real occlusion fails.
    """
    report = page.evaluate("""() => {
      const stage = document.querySelector('[data-od-id="map-floor"]');
      if (!stage) return {missing: true, rows: []};
      const overlays = ['.floor-controls', '.map-legend']
        .map((sel) => stage.querySelector(sel))
        .filter(Boolean)
        .map((el) => ({ name: String(el.className), el: el, r: el.getBoundingClientRect() }));
      const area = (a, b) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0 ? Math.round(w * h) : 0;
      };
      const targets = [];
      stage.querySelectorAll('.floor-group__summary, .floor-groups__head h3, .floor-groups__head p')
        .forEach((el) => targets.push([el, 'group:' + el.textContent.trim().slice(0, 40)]));
      const hint = stage.querySelector('.map-legend__hint');
      if (hint) targets.push([hint, 'hint']);
      const out = [];
      targets.forEach(([el, label]) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        overlays.forEach((ov) => {
          // The drag hint lives inside the legend, so the legend is not covering it.
          if (ov.el.contains(el)) return;
          const overlap = area(r, ov.r);
          if (!overlap) return;
          out.push({ label: label, overlay: ov.name, area: overlap });
        });
      });
      return { missing: false, rows: out };
    }""")
    covered = report['rows']
    assert not covered, '%s: the floor overlays cover loose-group content: %r' % (where, covered)


def settle_geo_canvas(page) -> None:
    """Wait until MapLibre's canvas matches the stage it fills.

    Expanding changes the stage height through CSS, and the canvas follows on a
    later frame; a capture taken before that shows a blank band under the map.
    """
    page.wait_for_function(
        """() => {
          const stage = document.querySelector('.map-stage');
          const canvas = stage && stage.querySelector('canvas.maplibregl-canvas');
          if (!canvas) return false;
          return Math.abs(canvas.clientHeight - stage.clientHeight) <= 2
            && Math.abs(canvas.clientWidth - stage.clientWidth) <= 2;
        }""",
        timeout=15000)


def no_overflow(page, label: str) -> None:
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (
        'horizontal overflow at ' + label)


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix='u7-visual-'))
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = run_env(workdir)
    plan_dir = workdir / 'attachments' / 'directory-plans'
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-superadmin', '--username', USERNAME,
                        '--name', 'U7 Visual'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        owned.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                       '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env))
        expansion.wait_for(API + '/api/v1/health/live')
        owned.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                                      cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.STDOUT))
        expansion.wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=os.environ.get('ITSM_U7_HEADED') != '1', args=[
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

            # ------------------------------------------- empty installation
            # Before seeding: the canonical reads answer with no locations and no
            # assets, so the empty branches are the real API answers.
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            expect(page.locator('.map-canvas .maplibregl-canvas')).to_be_visible()
            expect(page.locator('.map-empty')).to_be_visible()
            assert page.locator('.map-marker').count() == 0, 'an empty installation draws no marker'
            no_overflow(page, 'empty map 1440')
            shot(page, 'map-geo-empty-1440-light-es',
                 '#/infra/mapa empty installation, no sites, light, es, 1440x1000')
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.graph-empty')).to_be_visible()
            assert page.locator('.gnode').count() == 0, 'an empty installation draws no node'
            assert page.locator('.graph-empty span').first.inner_text() == (
                'Todavía no hay activos que representar.'), 'an empty inventory is not a filter mismatch'
            assert page.locator('.graph-empty .text-button').count() == 0, (
                'with no active filter there is nothing to clear')
            page.locator('.graph-empty').scroll_into_view_if_needed()
            shot(page, 'graph-empty-1440-light-es',
                 '#/infra/grafo empty installation, no assets, light, es, 1440x1000')

            ids = seed(page)
            errors.clear()

            # -------------------------------------------------- geography rest
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            expect(page.locator('.map-marker').first).to_be_visible()
            page.locator('.map-controls [aria-label="Ver todas las sedes"]').click()
            page.wait_for_timeout(400)
            expansion.assert_container_fill(page, '.map-stage', '.map-canvas')
            expansion.assert_painted(page, '.map-canvas .maplibregl-canvas', 'resting geography basemap',
                                     SHOTS / 'map-canvas-rest-1440-light-es.png')
            expansion.assert_surface(page, '.map-stage', 'light', 'resting geography surface',
                                     SHOTS / 'map-surface-rest-1440-light-es.png')
            assert page.locator('.map-inspector .map-per-site__row').count() >= 1, (
                'the resting inspector lists the sites of the installation')
            no_overflow(page, 'map rest 1440')
            shot(page, 'map-geo-rest-1440-light-es',
                 '#/infra/mapa resting explorer, no selection, light, es, 1440x1000')

            # ------------------------------------------------ geography select
            page.locator('.map-marker').first.click()
            expect(page.locator('.map-inspector h2')).to_have_text(SITE)
            expect(page.locator('.map-inspector .map-metrics')).to_be_visible()
            assert page.locator('.map-inspector .map-plan-list__row').count() >= 2, (
                'the site inspector lists both floors')
            shot(page, 'map-geo-selected-1440-light-es',
                 '#/infra/mapa selected site, metrics and floor list, light, es, 1440x1000')

            # ------------------------------------------------ geography filter
            page.locator('[data-od-id="map-filters-toggle"]').click()
            set_category(page, 'Servidores')
            expect(page.locator('.map-badge')).to_have_text('1')
            no_overflow(page, 'map filter 1440')
            shot(page, 'map-geo-filter-1440-light-es',
                 '#/infra/mapa active category filter, badge and panel, light, es, 1440x1000')

            # ---------------------------------------------- geography expanded
            zoom = page.locator('.map-controls__value').first.inner_text()
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator('.map-page.is-expanded')).to_be_visible()
            expansion.settle_size(page, '.map-stage', 860)
            settle_geo_canvas(page)
            assert page.locator('.map-controls__value').first.inner_text() == zoom, (
                'the filter and the camera survive the expansion')
            assert page.locator('.map-badge').inner_text() == '1'
            no_overflow(page, 'map expanded 1440')
            shot(page, 'map-geo-expanded-1440-light-es',
                 '#/infra/mapa expanded workspace, filter kept, light, es, 1440x1000')
            set_theme(page, 'dark')
            set_locale(page, 'en')
            page.wait_for_timeout(400)
            expansion.assert_surface(page, '.map-stage', 'dark', 'expanded dark geography surface',
                                     SHOTS / 'map-surface-expanded-1440-dark-en.png')
            shot(page, 'map-geo-expanded-1440-dark-en',
                 '#/infra/mapa expanded workspace, dark, en, 1440x1000')
            page.keyboard.press('Escape')
            expect(page.locator('.map-page.is-expanded')).to_have_count(0)
            set_theme(page, 'light')
            set_locale(page, 'es')
            clear_map_filters(page)
            close_map_filters(page)

            # --------------------------------------------------- floor ready
            open_floor(page, FLOOR_A)
            expect(page.locator('.floor-map .maplibregl-canvas')).to_be_visible()
            expect(page.locator('.floor-marker').first).to_be_visible()
            page.wait_for_timeout(600)
            expansion.assert_painted(page, '.floor-map .maplibregl-canvas', 'floor plan raster',
                                     SHOTS / 'floor-canvas-1440-light-es.png')
            assert page.locator('.floor-marker').count() == 2, (
                'both positioned devices are drawn on the plan')
            tree_fit = page.evaluate('''() => {
              const tree = document.querySelector('.map-tree');
              const rows = [...tree.querySelectorAll('*')].map((el) => {
                const box = el.getBoundingClientRect();
                return { cls: String(el.className || el.tagName).slice(0, 48), right: Math.round(box.right), width: Math.round(box.width) };
              }).sort((a, b) => b.right - a.right).slice(0, 4);
              return { client: tree.clientWidth, scroll: tree.scrollWidth, rows: rows };
            }''')
            assert tree_fit['scroll'] <= tree_fit['client'] + 1, (
                'the location tree fits its column without an inner horizontal scroll: %r'
                % (tree_fit,))
            chips = page.locator('.floor-room').evaluate_all(
                "nodes => nodes.map(node => [node.getAttribute('style'), node.getBoundingClientRect().x])")
            groups = page.locator('.floor-groups .floor-group__summary').all_inner_texts()
            assert chips == [], (
                'a directory room authors no plan geometry, so no chip is drawn at the origin')
            assert any(ROOM_A in text for text in groups), ('the server room keeps its own group: %r' % groups)
            assert any(ROOM_B in text for text in groups), ('the office keeps its own group: %r' % groups)
            assert_floor_overlays_clear(page, 'floor ready 1440')
            head_fit = page.evaluate(
                """() => {
                  const head = document.querySelector('.floor-head .eyebrow');
                  const meta = document.querySelector('.floor-head__meta');
                  const toggle = document.querySelector('[data-od-id="map-expand"]');
                  const rect = (el) => el ? el.getBoundingClientRect() : null;
                  return {
                    eyebrow: head ? {
                      client: head.clientWidth,
                      scroll: head.scrollWidth,
                      right: rect(head).right,
                      ok: head.scrollWidth <= head.clientWidth + 1,
                    } : null,
                    metaRight: meta ? rect(meta).right : null,
                    toggleLeft: toggle ? rect(toggle).left : null,
                  };
                }""")
            # A long location line wraps, so it never widens its own box and never
            # runs under the expand control that floats over the head's corner.
            assert head_fit['eyebrow']['ok'], (
                'the floor head keeps a long location line inside its box: %r' % head_fit)
            if head_fit['toggleLeft'] is not None and head_fit['metaRight'] is not None:
                assert head_fit['metaRight'] <= head_fit['toggleLeft'], (
                    'the floor head keeps its text out of the expand control: %r' % head_fit)
            no_overflow(page, 'floor ready 1440')
            shot(page, 'map-floor-ready-1440-light-es',
                 '#/infra/mapa floor ready, plan, placed devices, room groups, light, es, 1440x1000')
            print('ROOM CHIPS %r GROUPS %r' % (chips, groups))
            assert page.locator('[data-od-id="map-floor"] .map-legend').evaluate(
                'node => getComputedStyle(node).pointerEvents') == 'none', (
                'the floor legend is a reading aid and must not intercept clicks')

            # ------------------------------------------------ floor selection
            select_marker(page, 'SRV-U7-' + suffix)
            # Selecting a device is a read: a plain marker click must not write a
            # position or raise the "position saved" toast.
            expect(page.get_by_text('Posición guardada.')).to_have_count(0)
            settle_monitor(page, '.map-inspector .infra-monitor')
            expect(page.locator('.map-inspector h2')).to_have_text('Servidor U7 ' + suffix)
            administrative = page.locator('.map-inspector__meta .tone').first.inner_text()
            monitor_state = page.locator('.map-inspector .infra-monitor .status-pill').first.inner_text()
            assert administrative == 'Asignado', 'the inspector keeps the administrative status: %r' % administrative
            # The canonical device row exists but carries no measurement (no_data),
            # so the operational side stays "Sin datos" instead of a fabricated value.
            assert monitor_state == 'Sin datos', 'no measurement exists: %r' % monitor_state
            assert page.locator('.map-inspector .infra-monitor__values').count() == 0, (
                'a no-data reading shows no fabricated value')

            no_overflow(page, 'floor selected 1440')
            shot(page, 'map-floor-selected-1440-light-es',
                 '#/infra/mapa floor, selected device inspector, administrative status vs unknown monitoring, '
                 'light, es, 1440x1000')

            # ------------------------- floor marker: real pointer click and drag
            # The click/drag rule is a pointer rule, so it is proven with real
            # mouse events against the disposable public API, not with a stub.
            stored = expansion.api(page, '/assets/' + ids['server'])
            original = (stored['positionX'], stored['positionY'])
            writes: list[tuple[str, str]] = []
            page.on('request', lambda request: writes.append((request.method, request.url))
                    if request.method == 'PATCH' else None)
            marker = page.locator('.floor-marker').filter(has_text='SRV-U7-' + suffix).first
            marker.click()
            page.wait_for_timeout(700)
            assert writes == [], 'a marker click must not write a position: %r' % writes
            assert page.get_by_text('Posición guardada.').count() == 0, (
                'a marker click must not announce a saved position')
            same = expansion.api(page, '/assets/' + ids['server'])
            assert (same['positionX'], same['positionY']) == original, (
                'a marker click leaves the stored position untouched')

            # Expected geometry is derived from the public painted plan only: the
            # raster fills the paper frame, so a client point maps to a fraction by
            # dividing by that frame. No implementation helper forms the expectation.
            paper = page.locator('.floor-paper').first.bounding_box()
            assert paper and paper['width'] > 0 and paper['height'] > 0, paper
            box = marker.bounding_box()
            assert box, 'the selected marker has a rendered box'
            start_x = box['x'] + box['width'] / 2
            start_y = box['y'] + box['height'] / 2
            drop_x = start_x + 46
            drop_y = start_y + 26
            # Tolerances, physically justified: the plan raster is 1600x1000, so one
            # device pixel is 0.000625 of the width and 0.001 of the height; the
            # stored fraction is allowed 0.01 (16 px / 10 px) for pointer rounding,
            # and the marker centre is allowed 12 px because it is 30 px wide and
            # the drag starts within a pixel of its centre.
            FRACTION_TOLERANCE = 0.01
            CENTRE_TOLERANCE = 12.0
            expected_x = (drop_x - paper['x']) / paper['width']
            expected_y = (drop_y - paper['y']) / paper['height']
            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.mouse.move(drop_x, drop_y, steps=8)
            page.mouse.up()
            expect(page.get_by_text('Posición guardada.')).to_have_count(1)
            page.wait_for_timeout(900)
            patches = [entry for entry in writes if '/assets/' in entry[1]]
            assert len(patches) == 1, 'a real drag writes the position exactly once: %r' % writes
            moved = expansion.api(page, '/assets/' + ids['server'])
            assert (moved['positionX'], moved['positionY']) != original, (
                'the drag persists a new canonical position')
            stored_x = float(moved['positionX'])
            stored_y = float(moved['positionY'])
            for axis, value in (('positionX', stored_x), ('positionY', stored_y)):
                assert 0.0 <= value <= 1.0, 'canonical %s stays a fraction: %r' % (axis, value)
            assert abs(stored_x - expected_x) <= FRACTION_TOLERANCE, (
                'stored X matches the painted plan fraction of the drop point: '
                'stored %r expected %r (paper %r)' % (stored_x, expected_x, paper))
            assert abs(stored_y - expected_y) <= FRACTION_TOLERANCE, (
                'stored Y matches the painted plan fraction of the drop point: '
                'stored %r expected %r (paper %r)' % (stored_y, expected_y, paper))
            print('DRAG GEOMETRY stored %r expected %r tolerance %r'
                  % ((stored_x, stored_y), (expected_x, expected_y), FRACTION_TOLERANCE),
                  flush=True)
            settled = marker.bounding_box()
            assert settled, 'the marker is still rendered after the drag'
            centre_x = settled['x'] + settled['width'] / 2
            centre_y = settled['y'] + settled['height'] / 2
            assert abs(centre_x - drop_x) <= CENTRE_TOLERANCE, (
                'the rendered marker centre X follows the drop point: %r vs %r'
                % (centre_x, drop_x))
            assert abs(centre_y - drop_y) <= CENTRE_TOLERANCE, (
                'the rendered marker centre Y follows the drop point: %r vs %r'
                % (centre_y, drop_y))
            # The same stored pair must project back onto the same centre, which
            # proves the write and the paint describe one position.
            project_x = paper['x'] + stored_x * paper['width']
            project_y = paper['y'] + stored_y * paper['height']
            assert abs(centre_x - project_x) <= CENTRE_TOLERANCE, (
                'the marker centre equals the stored fraction of the paper: %r vs %r'
                % (centre_x, project_x))
            assert abs(centre_y - project_y) <= CENTRE_TOLERANCE, (
                'the marker centre equals the stored fraction of the paper: %r vs %r'
                % (centre_y, project_y))
            # Negative probe: the same comparison must reject a wrong drop point and
            # a wrong stored pair. This evaluates the check itself with isolated
            # input; it mutates no product state and is not a product RED.
            assert abs(centre_y - (drop_y + 40.0)) > CENTRE_TOLERANCE, (
                'the centre check detects an incorrect drop Y')
            assert abs((expected_y + 0.05) - stored_y) > FRACTION_TOLERANCE, (
                'the fraction check detects an incorrect expected pair')
            print('NEGATIVE PROBE rejected a 40 px Y shift and a 0.05 fraction shift',
                  flush=True)
            no_overflow(page, 'floor after drag 1440')
            shot(page, 'map-floor-drag-1440-light-es',
                 '#/infra/mapa floor after a real pointer drag, light, es, 1440x1000')


            # The confirmation toast is transient (3.6 s); wait for it to clear so
            # the next captures show the room state, not the previous drag.
            expect(page.get_by_text('Posición guardada.')).to_have_count(0, timeout=8000)

            # ----------------------------------------------------- floor room
            page.locator('.loc-tree__room').filter(has_text=ROOM_A).first.click()
            expect(page.locator('.map-inspector h2')).to_have_text(ROOM_A)
            room_name = page.locator('.map-inspector h2').first.inner_text()
            no_overflow(page, 'floor room 1440')
            shot(page, 'map-floor-room-1440-light-es',
                 '#/infra/mapa floor, selected room inspector (%s), light, es, 1440x1000' % room_name)

            # -------------------------------------------- floor filtered empty
            set_category(page, 'Impresoras')
            expect(page.locator('.floor-empty')).to_be_visible()
            assert page.locator('.floor-empty').inner_text() == (
                'Ningún activo coincide con los filtros en esta planta.'), 'the filtered floor keeps its copy'
            no_overflow(page, 'floor filtered empty 1440')
            shot(page, 'map-floor-empty-filter-1440-light-es',
                 '#/infra/mapa floor, category filter with no match, light, es, 1440x1000')
            clear_map_filters(page)
            expect(page.locator('.floor-empty')).to_have_count(0)

            # ------------------------------------------------ floor no plan
            open_floor(page, FLOOR_B)
            expect(page.locator('.floor-noplan')).to_be_visible()
            expect(page.locator('.floor-noplan')).to_contain_text('no tiene un plano')
            no_overflow(page, 'floor no plan 1440')
            shot(page, 'map-floor-noplan-1440-light-es',
                 '#/infra/mapa floor without plan (404 from the plan read), light, es, 1440x1000')

            # ------------------------------------------------- floor loading
            # Only the plan image request is delayed: the loading branch is a real
            # pending request against the fixture backend, never a fake answer.
            page.route('**/api/v1/locations/*/plan', delayed_plan)
            open_floor(page, FLOOR_A)
            expect(page.locator('.floor-noplan[role="status"]')).to_be_visible()
            # The tree must mark the floor the stage is loading, not the previous one.
            expect(page.locator('.loc-tree__floor[aria-current="true"] .loc-tree__floor-name')).to_have_text(FLOOR_A)
            print('FLOOR ACTIVE', page.locator('.loc-tree__floor[aria-current="true"] .loc-tree__floor-name').inner_text(),
                  '| HEAD', page.locator('.floor-head h2').inner_text(), flush=True)
            shot(page, 'map-floor-loading-1440-light-es',
                 '#/infra/mapa floor plan loading (test-only 1200 ms request delay), light, es, 1440x1000')
            expect(page.locator('.floor-map .maplibregl-canvas')).to_be_visible()
            page.unroute('**/api/v1/locations/*/plan')

            # --------------------------------------------------- floor error
            # The fixture's own plan directory becomes unreadable: the real
            # backend answers 503 and the UI must show its failure branch.
            plan_dir.chmod(0o000)
            open_floor(page, FLOOR_B)
            open_floor(page, FLOOR_A)
            expect(page.locator('.floor-noplan--error')).to_be_visible()
            expect(page.locator('.floor-noplan--error')).to_have_attribute('role', 'alert')
            no_overflow(page, 'floor error 1440')
            shot(page, 'map-floor-error-1440-light-es',
                 '#/infra/mapa floor plan failure (real 503 from an unreadable plan store), light, es, 1440x1000')
            plan_dir.chmod(0o700)
            page.locator('.floor-noplan--error .text-button').click()
            expect(page.locator('.floor-map .maplibregl-canvas')).to_be_visible()
            page.wait_for_timeout(600)
            shot(page, 'map-floor-retry-1440-light-es',
                 '#/infra/mapa floor plan retry after the store recovers, light, es, 1440x1000')

            # -------------------------------------------- telemetry failure
            def monitoring_failure(route):
                route.fulfill(status=503, content_type='application/json',
                              body='{"detail": "monitoring is unavailable"}')

            page.route('**/api/v1/monitoring/devices/*', monitoring_failure)
            select_marker(page, 'MON-U7-' + suffix)
            expect(page.locator('.map-inspector .infra-monitor__error')).to_be_visible()
            shot(page, 'map-floor-monitor-error-1440-light-es',
                 '#/infra/mapa floor, selected device, scripted monitoring 503, light, es, 1440x1000')
            page.unroute('**/api/v1/monitoring/devices/*')
            page.locator('[data-od-id="map-monitor-refresh"]').click()
            expect(page.locator('.map-inspector .infra-monitor__error')).to_have_count(0)

            # -------------------------------------- floors without drawn devices
            open_floor(page, FLOOR_B)
            expect(page.locator('.floor-empty')).to_have_count(0)
            assert page.locator('.floor-marker').count() == 0, 'an unpositioned asset draws no marker'
            assert page.locator('.floor-group').count() == 1, 'the printer groups under the loose panel'
            page.locator('.floor-group__summary').first.click()
            expect(page.locator('.floor-group__asset').first).to_be_visible()
            assert_floor_overlays_clear(page, 'floor unpositioned 1440')
            no_overflow(page, 'floor unpositioned 1440')
            shot(page, 'map-floor-unpositioned-1440-light-es',
                 '#/infra/mapa floor with one unpositioned asset, loose group open, light, es, 1440x1000')
            set_theme(page, 'dark')
            set_locale(page, 'en')
            page.wait_for_timeout(400)
            assert_floor_overlays_clear(page, 'floor unpositioned 1440 dark en')
            no_overflow(page, 'floor unpositioned 1440 dark en')
            shot(page, 'map-floor-unpositioned-1440-dark-en',
                 '#/infra/mapa floor with one unpositioned asset, loose group open, dark, en, 1440x1000')
            set_theme(page, 'light')
            set_locale(page, 'es')
            page.wait_for_timeout(400)
            open_floor(page, FLOOR_EMPTY)
            expect(page.locator('.floor-empty')).to_be_visible()
            assert page.locator('.floor-empty').inner_text() == (
                'Esta planta todavía no tiene activos.'), 'an empty floor is not a filter mismatch'
            assert page.locator('.floor-group').count() == 0, 'an empty floor offers no loose group'
            no_overflow(page, 'floor empty 1440')
            shot(page, 'map-floor-empty-1440-light-es',
                 '#/infra/mapa floor with no assets, empty state, light, es, 1440x1000')
            open_floor(page, FLOOR_A)
            expect(page.locator('.floor-marker').first).to_be_visible()

            # ------------------------------------------------ narrow floor
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(BASE + '/#/panel', wait_until='networkidle')
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            # The explorer keeps its level in app state, so returning from another
            # route can land on the floor stage. Leave it through the public control
            # instead of assuming a fresh mount.
            if page.locator('[data-od-id="map-back-geo"]').count():
                page.locator('[data-od-id="map-back-geo"]').click()
            expect(page.locator('.map-marker').first).to_be_visible()
            no_overflow(page, 'map rest 390')
            shot(page, 'map-geo-390-light-es',
                 '#/infra/mapa resting explorer, light, es, 390x844')
            open_floor(page, FLOOR_A)
            expect(page.locator('.floor-marker').first).to_be_visible()
            assert_floor_overlays_clear(page, 'floor 390')
            no_overflow(page, 'floor 390')
            shot(page, 'map-floor-390-light-es',
                 '#/infra/mapa floor ready, light, es, 390x844')
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator('.map-page.is-expanded')).to_be_visible()
            page.wait_for_timeout(800)
            assert_floor_overlays_clear(page, 'floor expanded 390')
            no_overflow(page, 'floor expanded 390')
            shot(page, 'map-floor-expanded-390-light-es',
                 '#/infra/mapa floor expanded workspace, light, es, 390x844')
            page.locator('.floor-head').screenshot(
                path=str(SHOTS / 'floor-head-expanded-390-light-es.png'))
            SHOT_INDEX.append(
                'floor-head-expanded-390-light-es.png  <- #/infra/mapa floor expanded, head element, '
                'light, es, 390x844')
            page.keyboard.press('Escape')
            expect(page.locator('.map-page.is-expanded')).to_have_count(0)

            # ------------------------------------- intermediate widths (layout)
            for width in (1024, 768):
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
                if page.locator('[data-od-id="map-back-geo"]').count():
                    page.locator('[data-od-id="map-back-geo"]').click()
                open_floor(page, FLOOR_A)
                expect(page.locator('.floor-marker').first).to_be_visible()
                assert_floor_overlays_clear(page, 'floor %d layout' % width)
                no_overflow(page, 'floor %d layout' % width)
                shot(page, 'map-floor-%d-light-es' % width,
                     '#/infra/mapa floor ready, light, es, %dx900' % width)


            # ----------------------- canonical graph payload (public read only)
            # Exact public repro of the backend contract this view sits on: the
            # global graph is built from relationship edges, so the six seeded
            # assets arrive as three nodes.
            asset_page = expansion.api(page, '/assets?limit=100')
            assert asset_page['total'] == 6, 'the fixture holds six assets'
            graph_payload = expansion.api(page, '/infrastructure/graph?limit=50')
            node_ids = sorted(node['id'] for node in graph_payload['nodes'])
            assert node_ids == sorted([ids['server'], ids['switch'], ids['camera']]), (
                'the global graph payload contains only assets in a relationship: %r' % node_ids)
            assert len(graph_payload['edges']) == 2, 'two seeded relationships'
            isolated = [asset['quickCode'] for asset in asset_page['items']
                        if asset['id'] not in node_ids]
            assert isolated, 'the payload really excludes the isolated assets: %r' % isolated

            # --------------------------------------------------- graph rest
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            page.wait_for_timeout(1200)
            expansion.assert_painted(page, '.graph-canvas', 'resting graph canvas',
                                     SHOTS / 'graph-canvas-rest-1440-light-es.png')
            assert page.locator('.gnode').count() >= 3, 'the graph draws the seeded assets'
            no_overflow(page, 'graph rest 1440')
            hint = page.locator('.graph-filters__hint').inner_text()
            assert 'solo incluye activos con relaciones' in hint, (
                'the filter panel states the server boundary: %r' % hint)
            shot(page, 'graph-rest-1440-light-es',
                 '#/infra/grafo resting global layout, default category grouping, light, es, 1440x1000')
            # Grouping collapses categories into one plate each, so switch to the flat
            # layout before selecting a device. The canonical global graph payload
            # carries the related assets of the installation; isolated assets never
            # reach it, so the flat layout draws those three and nothing is invented.
            page.get_by_role('group', name='Agrupación').get_by_role('button').nth(2).click()
            expect(page.locator('.gnode')).to_have_count(3)
            codes = page.locator('.gnode__code').all_text_contents()
            codes = [text or '' for text in codes]
            for code in ('SRV-U7-', 'SW-U7-', 'CAM-U7-'):
                assert any(code in text for text in codes), ('%s is drawn: %r' % (code, codes))

            # ----------------------------------------------- graph selection
            # The status bar states each count once ("3 nodos visibles · 2 vínculos").
            assert page.locator('.graph-status').inner_text().replace('\n', ' ').startswith('3 nodos visibles · 2 vínculos'), (
                'the status bar does not repeat the counts: ' + page.locator('.graph-status').inner_text())
            meta = page.locator('.graph-page__head .page-head__meta').inner_text().split('\n')
            assert meta == ['2 vínculos', '0 activos aislados'], (
                'the page summary prints each count once: %r' % (meta,))
            select_graph_node(page, 'SRV-U7-' + suffix)
            expect(page.locator('.graph-inspector h2')).to_be_visible()
            assert page.locator('.graph-relations__row').count() == 1, (
                'the inspector lists the canonical relation of the selected device')
            settle_monitor(page, '.graph-inspector .infra-monitor')
            graph_administrative = page.locator('.graph-inspector__meta .status-pill').first.inner_text()
            graph_monitor = page.locator('.graph-inspector .infra-monitor .status-pill').first.inner_text()
            assert graph_administrative == 'Asignado'
            assert graph_monitor == 'Sin datos'
            assert page.locator('.graph-inspector .infra-monitor__values').count() == 0
            no_overflow(page, 'graph selected 1440')
            shot(page, 'graph-selected-1440-light-es',
                 '#/infra/grafo ungrouped layout, selected device, relation row and unknown monitoring, light, es, 1440x1000')

            # ---------------------------------------------- graph focus mode
            page.goto(BASE + '/#/infra/grafo/activo/' + ids['server'], wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            assert page.locator('.graph-mode__button').nth(1).get_attribute('aria-pressed') == 'true', (
                'the deep link enters focus mode')
            expect(page.get_by_role('group', name='Profundidad')).to_be_visible()
            page.wait_for_timeout(900)

            # Real contract: a rooted traversal at one hop reports depth truncation
            # (nodes/edges truncation stay false). The notice must say that reason.
            rooted = expansion.api(
                page, '/infrastructure/graph?rootId=%s&depth=1&direction=both&limit=50' % ids['server'])
            assert rooted['truncated'] is True, 'one hop of a two-edge chain is a truncated result'
            assert rooted['depthTruncated'] is True and rooted['nodesTruncated'] is False
            assert rooted['edgesTruncated'] is False, 'a depth cut is not a node or edge cut'
            page.route('**/api/v1/infrastructure/graph?**', lambda route: route.fulfill(
                status=200,
                content_type='application/json',
                body=json.dumps(rooted)))
            # A hash-only goto stays in the same document and would keep the previous
            # payload, so the state is reloaded with the fixture payload in place.
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            page.reload(wait_until='networkidle')
            expect(page.locator('.server-notice')).to_be_visible()
            expect(page.locator('.server-notice')).to_contain_text('2 nodos')
            notice = page.locator('.server-notice').first.inner_text()
            print('DEPTH NOTICE %r' % notice, flush=True)
            assert 'Resultado limitado: .' not in notice, (
                'a depth-only truncation must name its reason, not leave the notice empty: %r' % notice)
            assert 'profundidad' in notice, (
                'the notice states the factual depth reason: %r' % notice)
            assert 'profundidad 1' in notice, (
                'the notice describes the depth-truncated payload it rendered: %r' % notice)
            assert '2 nodos y 1 relación.' in notice, (
                'the counts agree with the payload numbers: %r' % notice)
            no_overflow(page, 'graph depth notice 1440 es')
            shot(page, 'graph-depth-truncated-1440-light-es',
                 '#/infra/grafo depth-truncated payload, limited-result notice names the depth, '
                 'light, es, 1440x1000')

            set_locale(page, 'en')
            notice_en = page.locator('.server-notice').first.inner_text()
            print('DEPTH NOTICE EN %r' % notice_en, flush=True)
            assert 'Limited result:' in notice_en and 'requested depth' in notice_en, notice_en
            assert 'Limited result: .' not in notice_en, notice_en
            assert '2 nodes and 1 relationship.' in notice_en, (
                'the English counts agree with the payload numbers: %r' % notice_en)
            no_overflow(page, 'graph depth notice 1440 en')
            shot(page, 'graph-depth-truncated-1440-light-en',
                 '#/infra/grafo depth-truncated payload, limited-result notice names the depth, '
                 'light, en, 1440x1000')

            set_locale(page, 'es')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_timeout(400)
            no_overflow(page, 'graph depth notice 390')
            shot(page, 'graph-depth-truncated-390-light-es',
                 '#/infra/grafo depth-truncated payload, limited-result notice names the depth, '
                 'light, es, 390x844')
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.wait_for_timeout(400)
            page.unroute('**/api/v1/infrastructure/graph?**')
            page.goto(BASE + '/#/infra/grafo/activo/' + ids['server'], wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            page.wait_for_timeout(600)

            no_overflow(page, 'graph focus 1440')
            shot(page, 'graph-focus-1440-light-es',
                 '#/infra/grafo focus mode from a device deep link, light, es, 1440x1000')

            # ------------------------------------------- graph filter + empty
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            # The filters panel is open by default: only toggle it when closed.
            print('GRAPH TOOLBAR', page.evaluate(
                "() => Array.from(document.querySelectorAll('.graph-toolbar button'))"
                ".map(b => b.className)"), flush=True)
            if page.locator('[data-od-id="graph-filters"]').count() == 0:
                page.locator('.graph-filters-toggle').click(timeout=8000)
            page.locator('#graph-search').fill('sin-coincidencias-u7')
            expect(page.locator('.graph-empty')).to_be_visible()
            expect(page.locator('.graph-legend')).to_have_count(0)
            assert page.locator('.graph-empty span').first.inner_text() == (
                'Ningún activo coincide con los filtros activos.'), 'a filter mismatch keeps its own copy'
            assert page.locator('.graph-empty .text-button').count() == 1, (
                'a filter mismatch offers the clear action')
            page.locator('.graph-empty').scroll_into_view_if_needed()
            no_overflow(page, 'graph filtered empty 1440')
            shot(page, 'graph-empty-filter-1440-light-es',
                 '#/infra/grafo search filter with no match, light, es, 1440x1000')
            page.locator('.graph-empty .text-button').click()
            expect(page.locator('.gnode').first).to_be_visible()

            # ------------------------------------------------ graph expanded
            select_graph_node(page, 'SRV-U7-' + suffix)
            page.wait_for_timeout(400)
            graph_zoom = page.locator('.graph-zoom__value').inner_text()
            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator('.graph-page.is-expanded')).to_be_visible()
            page.wait_for_timeout(500)
            assert page.locator('.graph-zoom__value').inner_text() == graph_zoom, (
                'the graph camera survives the expansion')
            no_overflow(page, 'graph expanded 1440')
            shot(page, 'graph-expanded-1440-light-es',
                 '#/infra/grafo expanded workspace, selection kept, light, es, 1440x1000')
            set_theme(page, 'dark')
            set_locale(page, 'en')
            page.wait_for_timeout(400)
            meta_en = page.locator('.graph-page__head .page-head__meta').inner_text().split('\n')
            assert meta_en == ['2 links', '0 isolated assets'], (
                'the page summary prints each count once in English: %r' % (meta_en,))
            shot(page, 'graph-expanded-1440-dark-en',
                 '#/infra/grafo expanded workspace, dark, en, 1440x1000')
            page.keyboard.press('Escape')
            expect(page.locator('.graph-page.is-expanded')).to_have_count(0)
            set_theme(page, 'light')
            set_locale(page, 'es')

            # ------------------------------------------------ narrow graph
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible()
            page.wait_for_timeout(800)
            no_overflow(page, 'graph 390')
            shot(page, 'graph-390-light-es',
                 '#/infra/grafo resting global layout, light, es, 390x844')
            page.locator('[data-od-id="graph-expand"]').click()
            expect(page.locator('.graph-page.is-expanded')).to_be_visible()
            page.wait_for_timeout(500)
            no_overflow(page, 'graph expanded 390')
            legend = page.locator('.graph-canvas-wrap .graph-legend').bounding_box()
            toggle = page.locator('[data-od-id="graph-expand"]').bounding_box()
            assert legend and toggle and legend['x'] + legend['width'] <= toggle['x'] + 1, (
                'the legend keeps clear of the expand control at 390: %r / %r' % (legend, toggle))
            shot(page, 'graph-expanded-390-light-es',
                 '#/infra/grafo expanded workspace, light, es, 390x844')
            page.keyboard.press('Escape')
            expect(page.locator('.graph-page.is-expanded')).to_have_count(0)


            # --------------------------------- view-only account: denied writes
            # The documented boundary is the existing guard: an account with the
            # built-in read-only role may open the floor but must never persist a
            # position, even when the pointer performs a real drag.
            expansion.api(page, '/identity/users', 'POST', {
                'username': 'u7.viewer.' + suffix, 'name': 'U7 Lector ' + suffix,
                'roleId': 'user', 'password': PASSWORD, 'actorKind': 'human',
            })
            before_viewer = expansion.api(page, '/assets/' + ids['server'])
            viewer_context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                                 reduced_motion='reduce', locale='es-PY')
            viewer_page = viewer_context.new_page()
            viewer_page.on('pageerror', lambda error: errors.append('viewer: ' + str(error)))
            viewer_writes: list[tuple[str, str]] = []
            viewer_page.on('request', lambda request: viewer_writes.append((request.method, request.url))
                           if request.method == 'PATCH' else None)
            viewer_page.goto(BASE + '/#/login', wait_until='networkidle')
            viewer_page.get_by_label('Usuario', exact=True).fill('u7.viewer.' + suffix)
            viewer_page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            viewer_page.get_by_role('button', name='Entrar', exact=True).click()
            expect(viewer_page.locator('.app-shell')).to_be_visible()
            viewer_page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            open_floor(viewer_page, FLOOR_A)
            expect(viewer_page.locator('.floor-marker').first).to_be_visible()
            viewer_marker = viewer_page.locator('.floor-marker').filter(has_text='SRV-U7-' + suffix).first
            vbox = viewer_marker.bounding_box()
            assert vbox, 'the read-only account still sees the marker'
            viewer_page.mouse.move(vbox['x'] + vbox['width'] / 2, vbox['y'] + vbox['height'] / 2)
            viewer_page.mouse.down()
            viewer_page.mouse.move(vbox['x'] + vbox['width'] / 2 + 48,
                                   vbox['y'] + vbox['height'] / 2 + 28, steps=8)
            viewer_page.mouse.up()
            viewer_page.wait_for_timeout(900)
            assert viewer_writes == [], 'a read-only account never writes a position: %r' % viewer_writes
            assert viewer_page.get_by_text('Posición guardada.').count() == 0, (
                'a read-only account never announces a saved position')
            after_viewer = expansion.api(page, '/assets/' + ids['server'])
            assert (after_viewer['positionX'], after_viewer['positionY']) == (
                before_viewer['positionX'], before_viewer['positionY']), (
                'the stored position is untouched for a read-only account')
            no_overflow(viewer_page, 'floor read-only 1440')
            viewer_page.screenshot(path=str(SHOTS / 'map-floor-readonly-1440-light-es.png'), full_page=False)
            SHOT_INDEX.append('map-floor-readonly-1440-light-es.png  <- '
                              '#/infra/mapa floor as a read-only account after a real drag, light, es, 1440x1000')
            viewer_context.close()

            assert not errors, errors
            browser.close()
    finally:
        stop_owned()
    print('SHOTS ' + str(SHOTS))
    for line in SHOT_INDEX:
        print('  ' + line)
    return 0


def delayed_plan(route) -> None:
    """Delay only the plan image: the loading branch is a real pending request."""
    import time

    time.sleep(1.2)
    route.continue_()


if __name__ == '__main__':
    sys.exit(main())
