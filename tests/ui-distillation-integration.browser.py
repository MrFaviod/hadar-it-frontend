"""T8 (S1-S16) — integration: the chat entry and the infrastructure canvases.

Own disposable installation, own loopback uvicorn/Vite pair, own SQLite file
inside the OS temp directory: no existing service, database, credential,
Prometheus instance, agent or device is read or touched. Canonical
site/inventory/relationship records are seeded through the public API, and the
monitoring transport is left unconfigured on purpose — this unit is about
placement and occlusion, not about availability.

First bounded T8 unit. It proves in Chromium that:

* the conversation entry belongs to the app chrome: it never sits on top of the
  selected map or graph inspector, at 1440x1000 or at 390, resting, expanded or
  with the compact panel open;
* the entry stays an accessible control (name, disclosure state, 44 px target),
  the compact panel keeps its focus/Escape contract and the full ``#/conversacion``
  route still owns the expanded surface;
* expansion, camera, selection and scroll lock survive a chat open/close;
* the sticky top bar is an opaque occluder, so the graph legend pill cannot
  ghost through it while the page scrolls underneath;
* neither surface overflows horizontally and no page error is raised.

Screenshots are written under ``.verification/ui-distillation*/`` for the vision
pass; the whole point of the unit is that a person must look at it.
"""

from __future__ import annotations

import io
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

from PIL import Image, ImageChops
from playwright.sync_api import expect, sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get('ITSM_T8_BACKEND') or FRONTEND.parent / 'backend')
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
SHOTS = FRONTEND / '.verification' / ('ui-distillation-' + uuid.uuid4().hex[:10])
CATALOGS = {tag: json.loads((FRONTEND / 'assets' / 'i18n' / (tag + '.json')).read_text())
            for tag in ('es', 'en')}

USERNAME = 't8.admin'
PASSWORD = 'T8-Distillation-Pass-9k'
suffix = uuid.uuid4().hex[:6]
SITE_NAME = 'Sede T8 ' + suffix
ASSETS = [
    ('SRV-T8-' + suffix, 'Servidor T8 ' + suffix, 'servidores'),
    ('SW-T8-' + suffix, 'Switch T8 ' + suffix, 'switches'),
    ('CAM-T8-' + suffix, 'Cámara T8 ' + suffix, 'camaras'),
    ('NVR-T8-' + suffix, 'Grabador T8 ' + suffix, 'servidores'),
]
SELECTED = ASSETS[0][1]
EXPANDED = '.map-page.is-expanded, .graph-page.is-expanded'
SCROLL_LOCK = 'body.map-workspace-expanded, body.graph-workspace-expanded'
OPENER = '#conversation-opener'
INSPECTOR = {'map': '.map-inspector', 'graph': '.graph-inspector'}
# The chat entry, its lane and the bar must agree: a control that does not fit
# its own lane is the same defect in a new place.
MIN_TARGET = 44
MIN_LANE_GAP = 8

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
        # Nothing external is read: no Prometheus, no agent, no device.
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
    type_key = 'depends_on_t8'
    api(page, '/relationship-types', 'POST', {
        'key': type_key, 'forwardLabel': 'Depende de', 'inverseLabel': 'Sostiene',
        'containment': False,
    })
    for source, target in [(1, 0), (2, 0), (3, 0)]:
        api(page, '/relationships', 'POST', {
            'typeKey': type_key,
            'sourceId': created[ASSETS[source][1]],
            'targetId': created[ASSETS[target][1]],
        })
    return created


# ------------------------------------------------------------------- geometry

MEASURE_JS = """
([inspector]) => {
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y),
             w: Math.round(rect.width), h: Math.round(rect.height),
             bottom: Math.round(rect.bottom), right: Math.round(rect.right) };
  };
  const label = (element) => element.getAttribute('aria-label') ||
    element.getAttribute('title') || (element.textContent || '').trim().slice(0, 48);
  const opener = document.querySelector('#conversation-opener');
  const surface = document.querySelector('#conversation-surface');
  const bar = document.querySelector('.topbar');
  const cluster = document.querySelector('.topbar__right');
  const target = document.querySelector(inspector);
  const openerBox = box(opener);
  const inspectorBox = box(target);
  const hits = (one, two) => !!one && !!two &&
    !(one.right <= two.x || one.x >= two.right || one.bottom <= two.y || one.y >= two.bottom);
  const controls = target
    ? [...target.querySelectorAll('button, a[href], select, input, textarea, summary, [role="button"]')]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => ({ label: label(element), box: box(element) }))
    : [];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    bar: box(bar),
    cluster: box(cluster),
    opener: openerBox,
    openerLabel: opener ? opener.getAttribute('aria-label') : null,
    openerControls: opener ? opener.getAttribute('aria-controls') : null,
    openerControlsSurface: !!(opener && surface &&
      opener.getAttribute('aria-controls') === surface.id),
    openerExpanded: opener ? opener.getAttribute('aria-expanded') : null,
    openerTitle: opener ? opener.getAttribute('title') : null,
    surfaceHidden: surface ? surface.hasAttribute('hidden') : null,
    surfaceCompact: surface ? surface.classList.contains('conversation--compact') : null,
    inspector: inspectorBox,
    inspectorOverlap: hits(openerBox, inspectorBox),
    controlOverlap: controls.filter((control) => hits(openerBox, control.box)),
    clusterOverlap: hits(openerBox, box(cluster)),
    chromeOverflow: bar ? bar.scrollWidth - bar.clientWidth : null,
    scrollWidth: document.documentElement.scrollWidth,
    focused: document.activeElement
      ? (document.activeElement.id || document.activeElement.tagName) : null,
  };
}
"""


def measure(page, surface: str) -> dict:
    return page.evaluate(MEASURE_JS, [INSPECTOR[surface]])


def shot(page, name: str, full: bool = False) -> None:
    page.screenshot(path=str(SHOTS / (name + '.png')), full_page=full)


def bar_band(page) -> Image.Image:
    """The top bar exactly as rendered, for occlusion comparisons."""
    box = page.evaluate("""() => {
      const rect = document.querySelector('.topbar').getBoundingClientRect();
      return { x: Math.round(rect.x), y: 0,
               width: Math.round(rect.width), height: Math.round(rect.bottom) };
    }""")
    return Image.open(io.BytesIO(page.screenshot(clip=box))).convert('RGB')


def changed_pixels(one: Image.Image, two: Image.Image) -> tuple[int, int]:
    diff = ImageChops.difference(one, two)
    box = diff.getbbox()
    count = sum(1 for pixel in diff.getdata() if max(pixel) > 2)
    return count, 0 if box is None else max(max(pixel) for pixel in diff.getdata())


THEME_FACTS_JS = r"""
() => {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const channels = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (value) => {
    const [r, g, b] = channels(value).map((channel) => {
      const unit = channel / 255;
      return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (one, two) => {
    const [high, low] = [luminance(one), luminance(two)].sort((left, right) => right - left);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  };
  // A transparent control sits on its container's surface: resolve upwards so a
  // chip is measured against the paint it actually shows.
  const surfaceOf = (element) => {
    let node = element;
    while (node) {
      const value = getComputedStyle(node).backgroundColor;
      if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const paint = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element);
    const surface = surfaceOf(element);
    return { bg: surface, color: style.color,
             own: style.backgroundColor,
             lum: Math.round(luminance(surface) * 1000) / 1000,
             contrast: contrast(style.color, surface) };
  };
  return {
    theme: root.dataset.theme,
    preference: root.dataset.themePreference,
    branding: root.dataset.branding,
    density: root.dataset.density,
    colorScheme: rootStyle.colorScheme,
    tokens: {
      bg: rootStyle.getPropertyValue('--bg').trim(),
      paper: rootStyle.getPropertyValue('--paper').trim(),
      text: rootStyle.getPropertyValue('--text').trim()
    },
    // Origin evidence: the appearance runtime may write its tokens inline on
    // the root element, which outranks the stylesheet theme variables.
    inlineTokens: [...root.style].filter((name) => name.startsWith('--')).length,
    tabs: paint('.infra-tabs'),
    tab: paint('.infra-tab:not(.is-active)'),
    active: paint('.infra-tab.is-active')
  };
}
"""

THEME_TOKENS = {
    'light': {'bg': '#f2f7f5', 'text': '#152b34', 'scheme': 'light'},
    'dark': {'bg': '#0a1820', 'text': '#e4f0f1', 'scheme': 'dark'},
}


def set_theme(page, theme: str) -> None:
    """Switch the theme through the product's own control, as a person would.

    `toggleTheme` runs the appearance repaint itself, so this path is the
    product authority for the resolved theme; the resolved attribute and the
    surface token are read back instead of assumed.
    """
    for _ in range(4):
        if page.evaluate("() => document.documentElement.dataset.theme") == theme:
            page.wait_for_timeout(250)
            return
        page.locator('.theme-toggle').click()
        page.wait_for_timeout(600)
    resolved = page.evaluate("() => document.documentElement.dataset.theme")
    raise AssertionError('the %r theme did not render (resolved %r)' % (theme, resolved))


def assert_theme_facts(page, theme: str) -> dict:
    """The rendered theme, its surface tokens and the infrastructure switch.

    The switch (.infra-tabs) is a surface: it must paint a surface-scale token in
    both themes, and its labels must stay readable on it.
    """
    facts = page.evaluate(THEME_FACTS_JS)
    expected = THEME_TOKENS[theme]
    where = json.dumps(facts, ensure_ascii=False, sort_keys=True)
    assert facts['theme'] == theme, 'the resolved theme is not %r (%s)' % (theme, where)
    assert facts['colorScheme'] == expected['scheme'], (
        'color-scheme does not match the %s theme (%s)' % (theme, where))
    assert facts['tokens']['bg'] == expected['bg'], (
        'the %s background token is %r, expected %r (%s)'
        % (theme, facts['tokens']['bg'], expected['bg'], where))
    assert facts['tokens']['text'] == expected['text'], (
        'the %s text token is %r, expected %r (%s)'
        % (theme, facts['tokens']['text'], expected['text'], where))
    assert facts['tabs'], 'the infrastructure switch is missing (%s)' % where
    surface = facts['tabs']['lum']
    if theme == 'dark':
        assert surface <= 0.16, (
            'the infrastructure switch paints a light track in the dark theme (luminance %s): %s'
            % (surface, where))
    else:
        assert surface >= 0.55, (
            'the infrastructure switch paints a dark track in the light theme (luminance %s): %s'
            % (surface, where))
    assert facts['tab']['contrast'] >= 4.5, (
        'an inactive switch label is below 4.5:1 in the %s theme (%s)' % (theme, where))
    assert facts['active']['contrast'] >= 4.5, (
        'the selected switch label is below 4.5:1 in the %s theme (%s)' % (theme, where))
    return facts


def set_locale(page, locale: str) -> None:
    page.evaluate("async tag => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }", locale)


def label(locale: str, key: str) -> str:
    return CATALOGS[locale][key]


def open_map(page, asset_id: str) -> None:
    page.goto(BASE + '/#/infra/mapa/activo/' + asset_id, wait_until='networkidle')
    expect(page.locator('.map-canvas .maplibregl-canvas').first).to_be_visible()
    expect(page.locator('.map-inspector h2').first).to_be_visible()


def open_graph(page) -> None:
    page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
    expect(page.locator('.gnode').first).to_be_visible()


def open_graph_warm(page) -> None:
    """In-app navigation: no reload, so the rendered theme stays settled."""
    page.evaluate("() => { location.hash = '#/infra/grafo'; }")
    page.wait_for_timeout(900)
    expect(page.locator('.gnode').first).to_be_visible()


def select_node(page, name: str) -> None:
    page.evaluate("""name => {
      const node = [...document.querySelectorAll('.gnode')]
        .find(item => (item.getAttribute('aria-label') || '').includes(name));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }""", name)
    page.wait_for_function(
        "name => (document.querySelector('.graph-inspector h2') || {}).textContent === name",
        arg=name, timeout=15000)


def reveal_inspector(page, surface: str) -> None:
    page.evaluate("selector => document.querySelector(selector)"
                  ".scrollIntoView({ block: 'end', behavior: 'instant' })", INSPECTOR[surface])
    page.wait_for_timeout(250)


HEADER_CONTROLS_JS = """
() => [...document.querySelectorAll('.topbar button, .topbar a[href], .topbar select')]
  .filter((element) => element.getBoundingClientRect().width > 0)
  .map((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rect.x + rect.width / 2),
                                          Math.round(rect.y + rect.height / 2));
    return {
      label: (element.getAttribute('aria-label') || element.getAttribute('title') ||
        (element.textContent || '').trim()).slice(0, 40),
      x: Math.round(rect.x), w: Math.round(rect.width), h: Math.round(rect.height),
      right: Math.round(rect.right),
      // The control must own its own centre: a squeezed or covered control fails here.
      reachable: !!(hit && (hit === element || element.contains(hit)))
    };
  });
"""

MIN_HEADER_TARGET = 44
MIN_HEADER_GAP = 4


def assert_header_targets(page, width: int) -> list[dict]:
    """Every chrome control keeps a usable target and font at a narrow width."""
    controls = page.evaluate(HEADER_CONTROLS_JS)
    where = '%d px: %s' % (width, json.dumps(controls, ensure_ascii=False))
    assert controls, 'the top bar has no controls at %d px' % width
    for item in controls:
        assert item['w'] >= MIN_HEADER_TARGET and item['h'] >= MIN_HEADER_TARGET, (
            'header control %r is %dx%d, below the %d px target (%s)'
            % (item['label'], item['w'], item['h'], MIN_HEADER_TARGET, where))
        assert item['x'] >= 0 and item['right'] <= width, (
            'header control %r is pushed out of the viewport (%s)' % (item['label'], where))
        assert item['reachable'], (
            'the centre of header control %r is covered by another element (%s)'
            % (item['label'], where))
    ordered = sorted(controls, key=lambda control: control['x'])
    for previous, following in zip(ordered, ordered[1:]):
        assert following['x'] - previous['right'] >= MIN_HEADER_GAP, (
            'header controls %r and %r are too close (%d px) (%s)'
            % (previous['label'], following['label'],
               following['x'] - previous['right'], where))
    return controls


def assert_chrome_entry(page, surface: str, label_text: str,
                        min_lane_gap: int = MIN_LANE_GAP) -> dict:
    """The chat entry lives in the chrome and covers no inspector content."""
    data = measure(page, surface)
    where = '%s: %s' % (surface, json.dumps(data, ensure_ascii=False, sort_keys=True))
    assert data['opener'] is not None, '%s: the chat entry is missing (%s)' % (surface, where)
    assert data['openerLabel'], '%s: the chat entry has no accessible name (%s)' % (surface, where)
    assert data['openerControlsSurface'], '%s: the chat entry does not control the surface (%s)' % (surface, where)
    assert data['openerLabel'].strip() == label_text, (
        '%s: the chat entry name is untranslated (%r != %r)' % (surface, data['openerLabel'], label_text))
    assert data['opener']['w'] >= MIN_TARGET and data['opener']['h'] >= MIN_TARGET, (
        '%s: the chat entry is smaller than a target (%s)' % (surface, where))
    assert data['opener']['y'] >= data['bar']['y'] and data['opener']['bottom'] <= data['bar']['bottom'], (
        '%s: the chat entry does not sit in the top bar (%s)' % (surface, where))
    assert not data['clusterOverlap'], (
        '%s: the chat entry collides with the header controls (%s)' % (surface, where))
    assert data['cluster']['right'] <= data['opener']['x'] - min_lane_gap, (
        '%s: the reserved lane is too small for the header controls (%s)' % (surface, where))
    assert not data['inspectorOverlap'], (
        '%s: the chat entry overlaps the inspector card (%s)' % (surface, where))
    assert not data['controlOverlap'], (
        '%s: the chat entry covers inspector controls %r (%s)'
        % (surface, [control['label'] for control in data['controlOverlap']], where))
    assert data['openerTitle'], '%s: the icon-only entry offers no tooltip (%s)' % (surface, where)
    assert data['chromeOverflow'] == 0, '%s: the top bar overflows (%s)' % (surface, where)
    assert data['scrollWidth'] <= data['viewport']['w'], (
        '%s: the page overflows horizontally (%s)' % (surface, where))
    return data


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix='t8-distillation-'))
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = run_env(workdir / 't8.db', workdir / 't8-tasks.db')
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-superadmin', '--username', USERNAME,
                        '--name', 'T8 Distillation'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        owned.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                       '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env))
        wait_for(API + '/api/v1/health/live')
        owned.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                                      cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
        wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=os.environ.get('ITSM_T8_HEADED') != '1', args=[
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
            # Nothing must be hovered while the chrome is compared with itself.
            page.mouse.move(4, 700)

            # ---------------------------------------------------- map, 1440
            open_map(page, ids[SELECTED])
            page.wait_for_timeout(600)
            assert_chrome_entry(page, 'map', label('es', 'ui.chat.open_panel'))
            print('theme light: %s' % json.dumps(assert_theme_facts(page, 'light'), sort_keys=True))
            shot(page, 'map-1440-es-light')
            reveal_inspector(page, 'map')
            assert_chrome_entry(page, 'map', label('es', 'ui.chat.open_panel'))
            shot(page, 'map-1440-es-light-inspector-end')

            # Expansion keeps the entry reachable and the workspace intact.
            camera = page.locator('.map-controls__value').first.inner_text()
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            page.wait_for_timeout(400)
            assert_chrome_entry(page, 'map', label('es', 'ui.chat.open_panel'))
            assert page.locator('.map-controls__value').first.inner_text() == camera, (
                'expanding the map reset the camera')
            assert page.evaluate("() => document.querySelectorAll(%r).length" % SCROLL_LOCK) == 1, (
                'expanding the map did not lock the page scroll')
            shot(page, 'map-1440-es-light-expanded')
            page.keyboard.press('Escape')
            expect(page.locator(EXPANDED)).to_have_count(0)

            # The compact panel opens over the expanded workspace, not under it.
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_be_visible()
            page.locator(OPENER).click()
            expect(page.locator('#conversation-surface')).to_be_visible()
            page.wait_for_timeout(300)
            covered = page.evaluate("""() => {
              const surface = document.querySelector('#conversation-surface');
              const input = document.querySelector('#conversation-input');
              const box = input.getBoundingClientRect();
              const top = document.elementFromPoint(Math.round(box.x + box.width / 2),
                                                    Math.round(box.y + box.height / 2));
              return { top: top ? (top.id || top.className || top.tagName) : null,
                       inside: !!top && surface.contains(top),
                       visible: !!(surface.offsetWidth && surface.offsetHeight && box.height) };
            }""")
            assert covered['visible'], 'the compact chat is not laid out while the map is expanded'
            assert covered['inside'], (
                'the expanded workspace paints over the compact chat: %r' % (covered,))
            shot(page, 'map-1440-es-light-expanded-chat')
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            assert page.locator('#conversation-surface').is_hidden(), 'Escape did not close the compact chat'
            assert page.evaluate("() => document.activeElement.id") == 'conversation-opener', (
                'closing the compact chat did not return focus to its entry')
            assert page.locator(EXPANDED).count() == 1, 'closing the chat also left the expanded workspace'
            # Escape only reaches the workspace while focus is inside it, so the
            # expanded map is left through its own control here.
            page.locator('[data-od-id="map-expand"]').click()
            expect(page.locator(EXPANDED)).to_have_count(0)

            # ------------------------------------------------- graph, 1440
            open_graph(page)
            select_node(page, SELECTED)
            page.wait_for_timeout(600)
            page.mouse.move(4, 700)
            assert_chrome_entry(page, 'graph', label('es', 'ui.chat.open_panel'))
            assert_theme_facts(page, 'light')
            shot(page, 'graph-1440-es-light')
            reveal_inspector(page, 'graph')
            assert_chrome_entry(page, 'graph', label('es', 'ui.chat.open_panel'))
            shot(page, 'graph-1440-es-light-inspector-end')

            # The sticky chrome occludes the canvas legend while scrolling.
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(400)
            resting = bar_band(page)
            shot(page, 'graph-1440-es-light-top')
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(500)
            scrolled = bar_band(page)
            count, peak = changed_pixels(resting, scrolled)
            shot(page, 'graph-1440-es-light-scrolled')
            legend = page.evaluate("""() => {
              const element = document.querySelector('.graph-legend');
              const box = element.getBoundingClientRect();
              const bar = document.querySelector('.topbar').getBoundingClientRect();
              const inside = document.elementFromPoint(
                Math.round(box.x + 40), Math.min(Math.round(box.y + box.height / 2), Math.round(bar.bottom) - 2));
              return { y: Math.round(box.y), h: Math.round(box.height),
                       barBottom: Math.round(bar.bottom),
                       scrollY: Math.round(window.scrollY),
                       background: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
                       inside: inside ? (inside.className || inside.tagName) : null };
            }""")
            assert count <= 20 and peak <= 2, (
                'the sticky top bar bleeds the scrolling canvas through: %d changed pixels, peak %d '
                '(legend %r)' % (count, peak, legend))
            assert not ('.graph-legend' in (legend['inside'] or '')), (
                'the graph legend paints over the sticky header: %r' % (legend,))

            # -------------------------------------------------- graph, 390
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_timeout(600)
            page.mouse.move(4, 700)
            assert_chrome_entry(page, 'graph', label('es', 'ui.chat.open_panel'))
            shot(page, 'graph-390-es-light')
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(400)
            resting = bar_band(page)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(500)
            scrolled = bar_band(page)
            count, peak = changed_pixels(resting, scrolled)
            shot(page, 'graph-390-es-light-scrolled')
            assert count <= 20 and peak <= 2, (
                'the mobile sticky top bar bleeds the scrolling canvas through: %d changed pixels, '
                'peak %d' % (count, peak))
            reveal_inspector(page, 'graph')
            assert_chrome_entry(page, 'graph', label('es', 'ui.chat.open_panel'))
            shot(page, 'graph-390-es-light-inspector-end')

            # ---------------------------------------------------- map, 390
            page.evaluate("hash => { location.hash = hash; }", '#/infra/mapa/activo/' + ids[SELECTED])
            page.wait_for_timeout(900)
            expect(page.locator('.map-inspector h2').first).to_be_visible()
            reveal_inspector(page, 'map')
            assert_chrome_entry(page, 'map', label('es', 'ui.chat.open_panel'))
            assert_header_targets(page, 390)
            shot(page, 'map-390-es-light-inspector-end')

            # Compact chat at 390: the entry is a chrome toggle, the panel is
            # still the same compact surface and gives focus back.
            page.evaluate("() => window.scrollTo(0, 0)")
            page.locator(OPENER).click()
            expect(page.locator('#conversation-surface')).to_be_visible()
            page.wait_for_timeout(300)
            assert page.evaluate("() => document.activeElement.id") == 'conversation-input', (
                'opening the compact chat did not move focus into it')
            shot(page, 'map-390-es-light-chat')
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            assert page.locator('#conversation-surface').is_hidden(), 'Escape did not close the compact chat at 390'
            assert page.evaluate("() => document.activeElement.id") == 'conversation-opener', (
                'closing the compact chat at 390 did not return focus to its entry')

            # ------------------------------------------- narrow headers
            for width in (360, 320):
                page.set_viewport_size({'width': width, 'height': 780})
                page.wait_for_timeout(600)
                page.mouse.move(2, 700)
                # Six 44 px targets only fit a 320 px bar with a 4 px seam.
                assert_chrome_entry(page, 'map', label('es', 'ui.chat.open_panel'),
                                    min_lane_gap=4 if width <= 340 else MIN_LANE_GAP)
                print('bar %d: %s' % (width, json.dumps(page.evaluate("""() => {
                  const box = (element) => { const r = element.getBoundingClientRect();
                    return [Math.round(r.x), Math.round(r.right), Math.round(r.width)]; };
                  const bar = document.querySelector('.topbar');
                  const style = getComputedStyle(bar);
                  return { bar: box(bar), left: box(document.querySelector('.topbar__left')),
                           right: box(document.querySelector('.topbar__right')),
                           padLeft: style.paddingLeft, padRight: style.paddingRight,
                           gap: style.gap, justify: style.justifyContent,
                           rightGap: getComputedStyle(document.querySelector('.topbar__right')).gap };
                }"""), ensure_ascii=False)))
                controls = assert_header_targets(page, width)
                print('header %d: %s' % (width, json.dumps(controls, ensure_ascii=False)))
                shot(page, 'map-%d-es-light-header' % width)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_timeout(400)

            # ----------------------------------------------- locale and theme
            set_locale(page, 'en')
            set_theme(page, 'dark')
            page.wait_for_timeout(400)
            assert_chrome_entry(page, 'map', label('en', 'ui.chat.open_panel'))
            shot(page, 'map-390-en-dark')
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.wait_for_timeout(600)
            assert_chrome_entry(page, 'map', label('en', 'ui.chat.open_panel'))
            print('theme dark: %s' % json.dumps(assert_theme_facts(page, 'dark'), sort_keys=True))
            shot(page, 'map-1440-en-dark')
            # Narrow English dark header: the same six targets at 320 px.
            page.set_viewport_size({'width': 320, 'height': 780})
            page.wait_for_timeout(500)
            assert_chrome_entry(page, 'map', label('en', 'ui.chat.open_panel'), min_lane_gap=4)
            assert_header_targets(page, 320)
            shot(page, 'map-320-en-dark-header')
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.wait_for_timeout(400)
            # Warm navigation keeps the settled theme: a reload would let the
            # stored appearance preference repaint the shell after the test set it.
            open_graph_warm(page)
            select_node(page, SELECTED)
            page.wait_for_timeout(600)
            # Applied last: entering a route re-syncs the scoped appearance.
            set_theme(page, 'dark')
            page.mouse.move(4, 700)
            assert_chrome_entry(page, 'graph', label('en', 'ui.chat.open_panel'))
            assert_theme_facts(page, 'dark')
            shot(page, 'graph-1440-en-dark')
            set_theme(page, 'light')
            set_locale(page, 'es')

            # The full route keeps the expanded surface and drops the toggle.
            page.goto(BASE + '/#/conversacion', wait_until='networkidle')
            expect(page.locator('#conversation-surface')).to_be_visible()
            assert page.locator(OPENER).count() == 0, 'the full conversation route still renders the chrome entry'
            shot(page, 'conversation-1440-es-light')

            assert not errors, errors
            browser.close()
    finally:
        stop_owned()

    print('PASS chat entry in the chrome and opaque sticky canvas chrome -> ' + str(SHOTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
