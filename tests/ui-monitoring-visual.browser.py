"""U6: individual visual pass over monitoring and notifications.

Covers the monitoring center (estado, dispositivos, alertas and their
loading/error/empty/selection states), the device page, the alert page, the
notification inbox and bell, and the three monitoring settings surfaces
(supervision, alertas, notificaciones), including the two safe dialogs
(silence, link-to-maintenance) opened and cancelled, never confirmed.

Reuses ``demo-indicator.browser.py`` exactly like the earlier visual units: two
sequential scenarios, each with its own disposable backend and loopback
API/Vite pair.

* ``marked``   -- the demo installation, which seeds canonical assets,
                  monitoring configuration, synthetic alerts and inbox rows.
* ``ordinary`` -- migrations plus ``bootstrap-superadmin``: a genuinely empty
                  installation, so the empty and missing states are served by
                  the API.

Operational readings (up/degraded/down/no-data, series, checks and the alert
states that need a firing alert) are scripted **only** at the monitoring HTTP
boundary with ``page.route``, on top of the real inventory rows the API returns:
no Prometheus, no Alertmanager, no agent, no device and no provider is
contacted. The unconfigured-Prometheus state, the empty states and the 404s are
the real API answers. Every value injected by the boundary is a fixture value
documented in ``docs/development.md``; nothing is invented as a reading.

Every rendered state is its own PNG (route, state, locale, theme and viewport in
the file name) so a human can open one image at a time. Dialogs are opened and
cancelled, and the run asserts that cancelling produced no write request.

Run: cd frontend && python3 tests/ui-monitoring-visual.browser.py
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import re
import urllib.parse
import uuid
from pathlib import Path

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    'monitor_fixture', Path(__file__).with_name('demo-indicator.browser.py')
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

CATALOGS = {
    tag: json.loads((Path(__file__).resolve().parent.parent / 'assets' / 'i18n' / (tag + '.json')).read_text())
    for tag in ('es', 'en')
}
RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')
UNKNOWN_ID = '11111111-1111-4111-8111-111111111111'
FAILURES: list[str] = []
WRITES: dict[int, list[tuple[str, str]]] = {}


def tr(tag, key, **values):
    """Resolve a catalog message with the same ``{name}`` placeholders Vue uses."""
    message = CATALOGS[tag].get(key)
    if message is None:
        raise KeyError(key)
    if ' | ' in message:
        # vue-i18n plural message: two forms are enough for the keys asserted here.
        count = values.get('count', 0)
        variants = [item.strip() for item in message.split(' | ')]
        message = variants[0] if count == 1 else variants[min(1, len(variants) - 1)]
    for name, value in values.items():
        message = message.replace('{' + name + '}', str(value))
    return message


def iso(minutes):
    moment = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=minutes)
    return moment.replace(microsecond=0).isoformat().replace('+00:00', 'Z')


# ------------------------------------------------------------------- helpers

def set_locale(page, tag):
    page.evaluate(
        """async tag => {
            window.__visualBundles = window.__visualBundles || {};
            if (!window.__visualBundles[tag]) {
                await window.ItsmI18n.loadBundle(tag);
                window.__visualBundles[tag] = true;
            }
            window.ItsmI18n.setLocale(tag);
        }""",
        tag,
    )


def wait_mounted(page):
    page.wait_for_function("() => !!document.querySelector('[data-v-app]')", timeout=30000)
    page.locator('[data-v-app] .app-shell').first.wait_for(state='attached')


def settle(page):
    try:
        page.wait_for_function(
            "() => !document.querySelector('.page-enter-active,.page-leave-active,"
            ".view-enter-active,.view-leave-active,.fade-enter-active,.dropdown-enter-active')",
            timeout=5000,
        )
    except Exception as error:  # a lingering transition class must not hide the cell
        print(f'NOTE transition check: {error}')
    page.wait_for_timeout(120)


def visible_main(page):
    return page.evaluate("() => (document.querySelector('main') || document.body).innerText") or ''


def goto_hash(page, target):
    page.evaluate("hash => { if (location.hash !== hash) location.hash = hash; }", target)
    page.wait_for_function("hash => location.hash === hash", arg=target)
    settle(page)


def fail(label, state, locale, width, theme, message):
    text = f'FAIL {label} {state} {locale} {width} {theme}: {message}'
    FAILURES.append(text)
    print(text)
    return text


def cell(page, shots, label, state, locale, width, theme, note, assertions=None, rows=False,
         viewport_only=False, prepare=None):
    """Capture one cell, then assert. The image survives a failing assertion.

    Theme, locale and viewport changes close transient overlays (the theme
    toggle is an outside pointer target for the notification panel), so a
    caller that captures an overlay passes `prepare` to reopen it afterwards.
    """
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)
    if prepare:
        prepare()
        settle(page)
    base = f'{label}-{state}-{locale}-{width}-{theme}'
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(80)
    if viewport_only:
        path = shots / f'{base}.png'
        page.screenshot(path=str(path), full_page=False)
    elif width > 700:
        path = shots / f'{base}.png'
        page.screenshot(path=str(path), full_page=True)
    else:
        path = shots / f'{base}-top.png'
        page.screenshot(path=str(path), full_page=False)
        if rows:
            scrolled = page.evaluate(
                "() => { const node = document.querySelector('.mon-table-wrap, .mon-alert-list, "
                ".mon-settings__list, .mon-inbox__list, .mon-grid');"
                " if (!node) return false; node.scrollIntoView({block: 'start'}); return true; }"
            )
            page.wait_for_timeout(90)
            if scrolled:
                page.screenshot(path=str(shots / f'{base}-rows.png'), full_page=False)
            else:
                print(f'NOTE {base}: no rows container to scroll into view')
    detail = ''
    try:
        detail = assertions() if assertions else ''
        leaked = page.evaluate(LEAK_SCRIPT)
        assert leaked is None, (state, locale, leaked)
        overflow = page.evaluate('document.documentElement.scrollWidth - innerWidth')
        assert overflow <= 1, (state, locale, width, overflow)
    except AssertionError as error:
        detail = fail(label, state, locale, width, theme, str(error))
    row = (f'SHOT {label} {state} {locale} {width}x{"844" if width < 700 else "1000"} {theme} '
           f'route={page.evaluate("location.hash")} file={path} note={note} {detail}')
    print(row)
    return row


LEAK_SCRIPT = """() => {
  const main = document.querySelector('main');
  if (!main) return null;
  const pattern = /\\bui\\.[a-z_]+\\.[a-z_]+\\b/;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const source = node.textContent || '';
    const hit = pattern.exec(source);
    if (!hit) continue;
    const element = node.parentElement;
    return {
      key: hit[0],
      tag: element ? element.tagName : '',
      cls: element ? String(element.className) : '',
      text: source.trim().slice(0, 140)
    };
  }
  return null;
}"""


def visible_text(page, selector):
    locator = page.locator(selector)
    return locator.first.inner_text().strip() if locator.count() else ''


def assert_text(page, selector, expected, label=''):
    actual = visible_text(page, selector)
    assert expected in actual, f'{label}{selector}={actual[:160]!r} lacks {expected!r}'
    return actual[:90]


def reset_view(page, locale='es', theme='light', width=1440):
    """Return to the section baseline so label lookups match the locale."""
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)


def open_center(page, tab_index=0):
    goto_hash(page, '#/supervision')
    page.locator('#mon-title').wait_for(state='visible')
    select_center_tab(page, tab_index)


def select_center_tab(page, index):
    page.locator('.mon-page .mon-tabs .mon-tab').nth(index).click()
    expect(page.locator('.mon-page .mon-tabs .mon-tab').nth(index)).to_have_attribute('aria-selected', 'true')
    page.wait_for_timeout(150)


def wait_center(page):
    page.wait_for_function(
        "() => !!document.querySelector('.mon-page .mon-kpi, .mon-page .mon-notice, "
        ".mon-page .empty-state')",
        timeout=30000,
    )
    page.wait_for_timeout(120)


def wait_device(page):
    page.locator('#mon-device-title').wait_for(state='attached')
    page.wait_for_function(
        "() => !!document.querySelector('.mon-device .mon-metric, .mon-device .mon-notice, "
        ".mon-device .mon-progress__text')",
        timeout=30000,
    )
    page.wait_for_timeout(120)


def wait_alert(page):
    try:
        page.wait_for_function(
            "() => !!document.querySelector('.mon-alert-page .mon-notice, "
            ".mon-alert-page .mon-alert-head, #mon-alert-title')",
            timeout=30000,
        )
    except Exception:
        # A component that throws while rendering paints nothing at all, so the
        # diagnostic records what the page actually held when the wait expired.
        print('DIAG wait_alert expired:', page.evaluate(
            """() => ({
                hash: location.hash,
                page: !!document.querySelector('.mon-alert-page'),
                text: (document.querySelector('main') || {}).innerText || '',
                console: window.__U6_CONSOLE__ || []
            })"""
        ))
        raise
    page.wait_for_timeout(120)


def wait_inbox(page):
    page.wait_for_function(
        "() => !!document.querySelector('.mon-inbox .empty-state, .mon-inbox .mon-inbox__item, "
        ".mon-inbox .mon-notice, #inbox-title')",
        timeout=30000,
    )
    page.wait_for_timeout(120)


def record_requests(page):
    WRITES.setdefault(id(page), [])

    def handler(request):
        if request.method != 'GET':
            WRITES[id(page)].append((request.method, request.url))

    page.on('request', handler)


def write_count(page, needles=()):
    entries = WRITES.get(id(page), [])
    if not needles:
        return len(entries)
    return len([entry for entry in entries if any(needle in entry[1] for needle in needles)])


def dialog_state(page):
    return {
        'count': page.locator('.modal[role="dialog"]').count(),
        'label': page.evaluate(
            """() => {
                const dialog = document.querySelector('.modal[role="dialog"]');
                if (!dialog) return '';
                const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
                return title ? title.innerText.trim() : '';
            }"""
        ),
        'fields': page.locator('.modal select, .modal input, .modal textarea').count(),
        'footer': [item.strip() for item in page.locator('.modal__foot .btn').all_inner_texts()],
        'scroll': page.evaluate(
            """() => {
                const body = document.querySelector('.modal__body');
                if (!body) return null;
                const dialog = body.closest('.modal');
                return {
                    overflow: body.scrollWidth - body.clientWidth,
                    dialog: Math.round(dialog.getBoundingClientRect().width),
                    viewport: innerWidth
                };
            }"""
        ),
    }


def assert_dialog(page, expected_title, expected_footer):
    state = dialog_state(page)
    assert state['count'] == 1, state
    assert state['label'] == expected_title, (state['label'], expected_title)
    assert state['footer'] == expected_footer, state['footer']
    assert state['fields'] >= 1, state
    layout = state['scroll']
    assert layout and layout['overflow'] <= 1, layout
    assert layout['dialog'] <= layout['viewport'], layout
    return f'dialog={state["label"]} fields={state["fields"]} width={layout["dialog"]} footer={state["footer"]}'


def cancel_dialog(page):
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.querySelector('.modal[role=\"dialog\"]')")
    page.wait_for_timeout(80)


SPANISH_TAGS = re.compile(r'\b(Crítica|Crítico|Activa|Silenciada|Recuperada|Media|Alta|Baja|Pendiente)\b')
RAW_ALERT_STATE = re.compile(r'\b(pending|firing|resolved)\b')
API_KEY_NAME = re.compile(r'\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z][A-Za-z]+\b')


def head_subs(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.mon-head .page-sub, .mon-head .mon-panel__sub'))
            .map((node) => node.textContent.trim())"""
    )


def assert_provenance(page, locale):
    subs = head_subs(page)
    assert len(subs) == 2, subs
    assert subs[0].endswith('.'), subs
    assert '·' in subs[1], subs
    return f'provenance={subs[1][:60]!r}'


def assert_no_spanish_tags(page):
    tags = [item.strip() for item in page.locator('.mon-tag, .mon-pill').all_inner_texts()]
    wrong = [tag for tag in tags if SPANISH_TAGS.search(tag)]
    assert tags and not wrong, wrong
    return f'tags={len(tags)} localized=True'


RAW_TRANSITION = re.compile(r'\b(pending|firing|resolved)\b\s*→\s*\b(pending|firing|resolved)\b|\b(?:pending|firing|resolved)\b\s*→|→\s*\b(?:pending|firing|resolved)\b')


def assert_timeline(page):
    items = [item.strip() for item in page.locator('.mon-timeline__text').all_inner_texts()]
    assert items, 'no timeline entries'
    for item in items:
        assert not RAW_TRANSITION.search(item), item
        assert 'por por' not in item, item
    return f'events={len(items)} first={items[0][:46]!r}'


def assert_override_labels(page, locale):
    prefix = tr(locale, 'ui.monitoring.device.overrides').split('{')[0].strip()
    subs = [item.strip() for item in page.locator('.mon-device .mon-panel__sub').all_inner_texts()]
    line = next((item for item in subs if item.startswith(prefix)), '')
    assert line, (prefix, subs)
    assert not API_KEY_NAME.search(line), line
    return f'overrides={line[:58]!r}'


def assert_category_labels(page):
    names = [item.strip() for item in page.locator('.mon-settings-table__name').all_inner_texts()]
    assert names, 'no profiles listed'
    raw = [name for name in names if re.fullmatch(r'[a-z_]+', name)]
    assert not raw, raw
    options = page.locator('.mon-settings select').first.locator('option').count()
    assert options > 0, options
    return f'names={names[:3]} options={options}'


def assert_window_layout(page):
    metrics = page.evaluate(
        """() => {
            const form = document.querySelector('.mon-window-form');
            if (!form) return null;
            const box = form.getBoundingClientRect();
            const assets = form.querySelector('.mon-window-form__assets');
            const span = assets ? Math.round(assets.getBoundingClientRect().width) : 0;
            const overflow = Math.max(...Array.from(form.children).map(
                (node) => Math.round(node.getBoundingClientRect().right - box.right)));
            return {form: Math.round(box.width), assets: span, overflow};
        }"""
    )
    assert metrics, 'window form missing'
    assert metrics['overflow'] <= 1, metrics
    assert metrics['assets'] >= metrics['form'] * 0.8, metrics
    return f'form={metrics["form"]} assets={metrics["assets"]} overflow={metrics["overflow"]}'


def assert_retry(page, locale):
    button = page.locator('.mon-notice__actions .btn', has_text=tr(locale, 'ui.common.retry'))
    assert button.count() == 1, button.count()
    return 'retry=1'


def assert_empty_copy(page, locale, selector, key):
    text = visible_text(page, selector)
    expected = tr(locale, key)
    assert text == expected, (text, expected)
    return f'empty={text!r}'


def assert_pill_state(page):
    colors = page.evaluate(
        """() => Array.from(document.querySelectorAll('.mon-pill-button'))
            .map((node) => [node.getAttribute('aria-pressed'), getComputedStyle(node).backgroundColor])"""
    )
    pressed = {color for flag, color in colors if flag == 'true'}
    rest = {color for flag, color in colors if flag != 'true'}
    assert pressed and rest and pressed != rest, colors
    return f'pressed={sorted(pressed)} rest={sorted(rest)}'


INBOX_PAINT_SCRIPT = """
() => Array.from(document.querySelectorAll('.mon-inbox__item')).map((card, index) => {
  const style = getComputedStyle(card);
  const box = card.getBoundingClientRect();
  const contentRight = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
  const painted = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return Math.round(node.getBoundingClientRect().right);
    return Math.round(Math.max(...rects.map((rect) => rect.right)));
  };
  const runs = [];
  const add = (kind, node) => {
    if (!node) return;
    const text = (node.textContent || '').trim();
    if (!text) return;
    runs.push({kind, text: text.slice(0, 44), painted: painted(node)});
  };
  add('title', card.querySelector('.mon-inbox__title'));
  add('body', card.querySelector('.mon-inbox__text'));
  Array.from(card.querySelectorAll('.mon-inbox__head .mon-tag')).forEach((tag) => add('tag', tag));
  Array.from(card.querySelectorAll('.mon-inbox__meta > span')).forEach((span) => add('meta', span));
  return {
    index,
    contentRight: Math.round(contentRight),
    cardOverflow: card.scrollWidth - card.clientWidth,
    runs,
  };
})
"""


def assert_inbox_paint_fits(page):
    """Every painted text run must stay inside the card that owns it.

    The earlier check compared each meta span's own box with its row box, which
    passed while the glyphs were painted past the card edge: the body column is
    a grid track sized by its widest child, so the runs were 31 px outside the
    card. This measures the text ranges themselves.
    """
    cards = page.evaluate(INBOX_PAINT_SCRIPT)
    assert cards, 'no inbox cards rendered'
    overflowing = [
        (card['index'], run['kind'], run['text'], run['painted'], card['contentRight'])
        for card in cards
        for run in card['runs']
        if run['painted'] > card['contentRight'] + 1
    ]
    assert not overflowing, f'inbox text is painted past the card edge: {overflowing}'
    widest = max(
        (run['painted'] - card['contentRight'] for card in cards for run in card['runs']),
        default=0,
    )
    runs = sum(len(card['runs']) for card in cards)
    return f'paint_runs={runs} overflow={max(widest, 0)}px'


# ------------------------------------------------------------------ dataset

def api_json(page, path):
    return page.evaluate(
        """async path => {
            const response = await fetch(path, {credentials: 'same-origin', headers: {accept: 'application/json'}});
            const body = await response.json().catch(() => null);
            return {status: response.status, body};
        }""",
        path,
    )


def build_dataset(page):
    """Read the real canonical rows, then attach scripted operational readings.

    Assets, categories, sites, quick codes and alert ids stay the server's. Only
    the availability/latency/uptime numbers, the series, the checks and the alert
    states below are boundary fixtures, because the installation has no
    Prometheus or Alertmanager to measure them.
    """
    devices = api_json(page, '/api/v1/monitoring/devices?period=24h&limit=100&offset=0')
    assert devices['status'] == 200, devices
    rows = devices['body'].get('items') or []
    alerts = api_json(page, '/api/v1/monitoring/alerts?limit=100&offset=0')
    inbox = api_json(page, '/api/v1/notifications/inbox?limit=50&offset=0')
    config = api_json(page, '/api/v1/monitoring/config')
    assert alerts['status'] == 200, alerts
    assert inbox['status'] == 200, inbox
    assert config['status'] == 200, config
    return {
        'devices': rows,
        'alerts': (alerts['body'] or {}).get('items') or [],
        'inbox': (inbox['body'] or {}).get('items') or [],
        'config': config['body'] or {},
    }


STATUS_PLAN = (
    ('down', 812, 97.5, 2880, 2),
    ('degraded', 240, 99.2, 2880, 1),
    ('up', 14, 99.99, 2880, 0),
    ('no_data', None, None, 0, 0),
    ('unmonitored', None, None, None, 0),
)


def build_rows(data):
    rows = []
    sources = data['devices']
    for index, plan in enumerate(STATUS_PLAN):
        if index >= len(sources):
            break
        status, latency, uptime, samples, active = plan
        row = dict(sources[index])
        row.update({
            'status': status,
            'reason': None,
            'monitoringEnabled': status != 'unmonitored',
            'latencyMs': latency,
            'uptime': {'percent': uptime, 'samples': samples},
            'activeAlerts': active,
        })
        rows.append(row)
    return rows


def scripted_alert(alert_id, row, **values):
    payload = {
        'id': alert_id,
        'fingerprint': 'fixture-' + alert_id[:8],
        'alertName': 'Latencia por encima del umbral',
        'severity': 'critical',
        'assetId': row['assetId'],
        'assetName': row['name'],
        'quickCode': row['quickCode'],
        'state': 'firing',
        'silenced': False,
        'acknowledged': False,
        'notes': '',
        'startsAt': iso(-40),
        'endsAt': None,
        'lastSeenAt': iso(-2),
        'source': 'alertmanager',
        'groupKey': 'fixture:' + row['assetId'],
        'summary': 'La comprobación supera el umbral crítico configurado.',
        'description': 'Lectura del fixture de supervisión; no procede de Prometheus.',
        'incident': None,
        'maintenanceWindow': None,
        'labels': {'check': row.get('checkType') or 'icmp'},
        'annotations': {},
        'events': [],
        'silences': [],
    }
    payload.update(values)
    return payload


def build_alerts(rows, real):
    alerts = []
    down = rows[0]
    degraded = rows[1] if len(rows) > 1 else down
    up = rows[2] if len(rows) > 2 else down
    first = real[0]['id'] if real else str(uuid.UUID(int=11))
    second = real[1]['id'] if len(real) > 1 else str(uuid.UUID(int=12))
    third = real[2]['id'] if len(real) > 2 else str(uuid.UUID(int=13))
    fourth = real[3]['id'] if len(real) > 3 else str(uuid.UUID(int=14))
    alerts.append(scripted_alert(first, down))
    alerts.append(scripted_alert(
        second, degraded,
        alertName='CPU sostenida',
        severity='warning',
        state='pending',
        acknowledged=True,
        acknowledgedAt=iso(-20),
        acknowledgedBy='operadora',
        summary='El uso de CPU se mantiene por encima del umbral de aviso.',
    ))
    alerts.append(scripted_alert(
        third, down,
        alertName='Reinicio del servicio',
        severity='info',
        state='resolved',
        endsAt=iso(-10),
        lastSeenAt=iso(-11),
        summary='El servicio volvió a responder tras el reinicio.',
        incident={'id': 'INC-FIXTURE-1', 'status': 'in_progress', 'suggestedClose': True},
        silences=[{
            'id': 'silence-fixture-1', 'assetId': down['assetId'], 'alertId': third,
            'comment': 'Ventana de trabajo', 'startsAt': iso(-120), 'endsAt': iso(120),
            'source': 'web', 'nativeId': 'native-1', 'active': True,
        }],
    ))
    alerts.append(scripted_alert(
        fourth, up,
        alertName='Latido intermitente',
        severity='info',
        silenced=True,
        summary='Avisos silenciados durante la ventana de mantenimiento.',
        silences=[{
            'id': 'silence-fixture-2', 'assetId': up['assetId'], 'alertId': fourth,
            'comment': 'Silencio del fixture', 'startsAt': iso(-60), 'endsAt': iso(60),
            'source': 'web', 'nativeId': 'native-2', 'active': True,
        }],
    ))
    return alerts


def build_events(alert):
    return [
        {'id': alert['id'] + '-e1', 'action': 'opened', 'fromState': '', 'toState': 'pending',
         'actor': '', 'note': '', 'source': 'alertmanager', 'createdAt': iso(-40)},
        {'id': alert['id'] + '-e2', 'action': 'fired', 'fromState': 'pending', 'toState': 'firing',
         'actor': '', 'note': '', 'source': 'alertmanager', 'createdAt': iso(-39)},
        {'id': alert['id'] + '-e3', 'action': 'silenced', 'fromState': 'firing', 'toState': 'firing',
         'actor': 'operadora', 'note': 'Ventana de trabajo', 'source': 'web', 'createdAt': iso(-30)},
    ]


def build_series(row, period):
    points = 12
    latency = []
    for index in range(points):
        moment = iso(-int((points - index) * (1440 / points)))
        value = round((row['latencyMs'] or 20) / 1000 * (0.8 + (index % 4) * 0.12), 3)
        latency.append({'at': moment, 'value': value})
    availability = [
        {'at': iso(-1440), 'value': row['uptime']['percent'] or 100},
        {'at': iso(-720), 'value': row['uptime']['percent'] or 100},
        {'at': iso(-60), 'value': row['uptime']['percent'] or 100},
    ]
    cpu = [
        {'at': iso(-1440 + index * 120), 'value': 18 + (index % 5) * 6}
        for index in range(points)
    ]
    series = [
        {'metric': 'latency', 'unit': 'seconds', 'points': latency, 'pointCount': len(latency)},
        {'metric': 'availability', 'unit': 'percent', 'points': availability, 'pointCount': len(availability)},
        {'metric': 'cpu', 'unit': 'percent', 'points': cpu, 'pointCount': len(cpu)},
    ]
    return series


def build_detail(row, row_alerts, period):
    status = row['status']
    monitored = status != 'unmonitored'
    checks = []
    if status not in ('unmonitored',):
        checks.append({'checkType': row.get('checkType') or 'icmp', 'module': 'icmp',
                       'state': 'up' if status in ('up', 'degraded') else 'down',
                       'lastCheckAt': iso(-2), 'latencyMs': row['latencyMs']})
    if status in ('down', 'degraded', 'up'):
        checks.append({'checkType': 'http', 'module': 'http_2xx', 'state': 'up',
                       'lastCheckAt': iso(-2), 'latencyMs': 34})
    detail = {
        'asset': {
            'id': row['assetId'], 'quickCode': row['quickCode'], 'name': row['name'],
            'category': row.get('category'), 'site': row.get('site'), 'siteId': row.get('siteId'),
        },
        'config': {
            'enabled': monitored,
            'checkType': row.get('checkType') or 'icmp',
            'target': row.get('target') or '10.0.0.10',
            'targetPresent': bool(row.get('target')),
            'intervalSeconds': row.get('intervalSeconds') or 60,
            'metrics': ['latency', 'cpu'],
            'thresholds': {'latency': {'warning': 150, 'critical': 300}},
            'minimumDurationSeconds': 300,
            'exporterId': 'blackbox-icmp',
            'snmpModule': None,
            'snmpAuthRef': None,
            'profileCategory': row.get('category') or '',
            'overridden': [],
        },
        'status': status,
        'reason': None,
        'provenance': {
            'source': 'prometheus',
            'prometheusConfigured': True,
            'period': {'preset': period, 'from': iso(-1440), 'to': iso(0), 'stepSeconds': 300},
        },
        'uptime': row['uptime'],
        'latency': (None if row['latencyMs'] is None else
                    {'averageMs': row['latencyMs'], 'p95Ms': row['latencyMs'] + 90,
                     'currentMs': row['latencyMs']}),
        'series': build_series(row, period) if monitored and status != 'no_data' else [],
        'checks': checks,
        'alerts': {
            'active': len([item for item in row_alerts if item['state'] in ('firing', 'pending')]),
            'lastRecoveryAt': iso(-600),
            'recent': row_alerts,
        },
    }
    return detail


def build_inbox(data, rows, alerts):
    real = data['inbox']
    if real:
        items = []
        for index, item in enumerate(real[:5]):
            copy = dict(item)
            copy['unread'] = bool(index < 2)
            copy['readAt'] = None if copy['unread'] else (copy.get('readAt') or iso(-30))
            items.append(copy)
        return items
    down = rows[0]
    return [
        {'id': str(uuid.UUID(int=21)), 'alertId': alerts[0]['id'], 'eventKey': 'firing',
         'eventType': 'firing', 'severity': 'critical', 'assetId': down['assetId'],
         'title': down['quickCode'] + ' · latencia alta',
         'body': 'La comprobación supera el umbral crítico configurado.',
         'url': '', 'createdAt': iso(-3), 'readAt': None, 'unread': True},
        {'id': str(uuid.UUID(int=22)), 'alertId': alerts[1]['id'], 'eventKey': 'firing',
         'eventType': 'firing', 'severity': 'warning', 'assetId': down['assetId'],
         'title': down['quickCode'] + ' · CPU sostenida',
         'body': 'El uso de CPU se mantiene por encima del umbral de aviso.',
         'url': '', 'createdAt': iso(-25), 'readAt': None, 'unread': True},
        {'id': str(uuid.UUID(int=23)), 'alertId': alerts[2]['id'], 'eventKey': 'resolved',
         'eventType': 'resolved', 'severity': 'info', 'assetId': down['assetId'],
         'title': down['quickCode'] + ' · recuperado',
         'body': 'El servicio volvió a responder tras el reinicio.',
         'url': '', 'createdAt': iso(-90), 'readAt': iso(-80), 'unread': False},
        {'id': str(uuid.UUID(int=24)), 'alertId': alerts[3]['id'], 'eventKey': 'silenced',
         'eventType': 'silenced', 'severity': 'info', 'assetId': down['assetId'],
         'title': down['quickCode'] + ' · silenciado',
         'body': 'Avisos silenciados durante la ventana de mantenimiento.',
         'url': '', 'createdAt': iso(-150), 'readAt': iso(-140), 'unread': False},
    ]


# ------------------------------------------------------------------ routing

def query_of(route):
    parsed = urllib.parse.urlparse(route.request.url)
    return {key: values[0] for key, values in urllib.parse.parse_qs(parsed.query).items()}


def json_route(body, status=200):
    def handler(route):
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
    return handler


def paged(items, query):
    limit = int(query.get('limit') or len(items) or 1)
    offset = int(query.get('offset') or 0)
    window = items[offset:offset + limit]
    return {'items': window, 'total': len(items), 'limit': limit, 'offset': offset}


def install(page, data, *, devices=None, device=None, alerts=None, alert=None, history=None,
            inbox=None, config=None):
    """Install the scripted monitoring boundary.

    Each keyword is either ``None`` (scripted populated data), ``'error'`` (503),
    ``'empty'`` (an honest empty page) or a pending list used to hold the response
    open for the loading captures.
    """
    rows = build_rows(data)
    alert_rows = build_alerts(rows, data['alerts'])
    inbox_items = build_inbox(data, rows, alert_rows)
    config_body = dict(data['config'])
    config_body['prometheus'] = {'configured': True}
    config_body['alertmanager'] = {'configured': True}
    state = {
        'rows': rows, 'alerts': alert_rows, 'inbox': inbox_items,
        'config': config_body, 'pending': [],
    }

    def devices_handler(route):
        if devices == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'monitoring read failed upstream'}}))
            return
        if devices == 'delay':
            state['pending'].append(('devices', route))
            return
        items = [] if devices == 'empty' else rows
        query = query_of(route)
        if query.get('category'):
            items = [item for item in items if (item.get('category') or '') == query['category']]
        if query.get('siteId'):
            items = [item for item in items if (item.get('siteId') or '') == query['siteId']]
        body = paged(items, query)
        if devices == 'truncated':
            body['total'] = body['total'] + 120
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    def device_handler(route):
        asset_id = urllib.parse.unquote(urllib.parse.urlparse(route.request.url).path.rsplit('/', 1)[-1])
        if device == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'device read failed upstream'}}))
            return
        target = next((row for row in rows if row['assetId'] == asset_id), None)
        if target is None:
            route.fallback()
            return
        if device == 'delay':
            state['pending'].append(('device', route))
            return
        period = query_of(route).get('period', '24h')
        related = [item for item in alert_rows if item['assetId'] == asset_id]
        route.fulfill(status=200, content_type='application/json',
                      body=json.dumps(build_detail(target, related, period)))

    def alerts_handler(route):
        if alerts == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'alert read failed upstream'}}))
            return
        query = query_of(route)
        items = [] if alerts == 'empty' else alert_rows
        wanted = query.get('state')
        if wanted:
            items = [item for item in items if item['state'] == wanted]
        severity = query.get('severity')
        if severity:
            items = [item for item in items if item['severity'] == severity]
        asset_filter = query.get('assetId')
        if asset_filter:
            items = [item for item in items if item['assetId'] == asset_filter]
        route.fulfill(status=200, content_type='application/json',
                      body=json.dumps(paged(items, query)))

    def alert_handler(route):
        path = urllib.parse.urlparse(route.request.url).path
        if path.endswith('/history'):
            alert_id = path.split('/')[-2]
            target = next((item for item in alert_rows if item['id'] == alert_id), None)
            if target is None:
                route.fallback()
                return
            page_body = paged(build_events(target), query_of(route))
            route.fulfill(status=200, content_type='application/json', body=json.dumps(page_body))
            return
        alert_id = path.rsplit('/', 1)[-1]
        if alert == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'alert detail read failed upstream'}}))
            return
        target = next((item for item in alert_rows if item['id'] == alert_id), None)
        if target is None:
            route.fallback()
            return
        route.fulfill(status=200, content_type='application/json', body=json.dumps(target))

    def inbox_handler(route):
        if inbox == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'inbox read failed upstream'}}))
            return
        query = query_of(route)
        items = [] if inbox == 'empty' else inbox_items
        if query.get('unread') == 'true':
            items = [item for item in items if item.get('unread')]
        route.fulfill(status=200, content_type='application/json',
                      body=json.dumps(paged(items, query)))

    def config_handler(route):
        if config == 'error':
            route.fulfill(status=503, content_type='application/json',
                          body=json.dumps({'error': {'code': 'unavailable', 'message': 'config read failed upstream'}}))
            return
        route.fulfill(status=200, content_type='application/json', body=json.dumps(config_body))

    page.route('**/api/v1/monitoring/devices?*', devices_handler)
    page.route('**/api/v1/monitoring/devices/*', device_handler)
    page.route('**/api/v1/monitoring/alerts?*', alerts_handler)
    page.route('**/api/v1/monitoring/alerts/*/history?*', alert_handler)
    page.route('**/api/v1/monitoring/alerts/*', alert_handler)
    page.route('**/api/v1/notifications/inbox?*', inbox_handler)
    page.route('**/api/v1/monitoring/config', config_handler)
    return state


def release(state, kind, body_builder):
    """Answer the request held open for a loading capture."""
    held = [entry for entry in state['pending'] if entry[0] == kind]
    state['pending'] = [entry for entry in state['pending'] if entry[0] != kind]
    for _, route in held:
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body_builder(route)))


def error_route(page, pattern, status=503, message='read failed upstream'):
    def handler(route):
        route.fulfill(status=status, content_type='application/json',
                      body=json.dumps({'error': {'code': 'unavailable', 'message': message}}))
    page.route(pattern, handler)


# ------------------------------------------------------------------ marked

def run_center(page, shots, state):
    rows = []
    open_center(page, 0)
    wait_center(page)
    data = state['rows']
    rows.append(cell(
        page, shots, 'mon-overview', 'estado', 'es', 1440, 'light',
        'estado tab: KPIs, charts and active alerts over the scripted readings',
        lambda: (
            f'{assert_provenance(page, "es")}'
            f' kpis={page.locator(".mon-kpi").count()}'
            f' charts={page.locator(".mon-chart").count()}'
            f' alerts={page.locator(".mon-alert").count()}'
            f' attention={visible_text(page, ".mon-attention")[:40]}'
            f' total={data[0]["quickCode"] if data else "—"}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-overview', 'estado', 'en', 1440, 'dark',
        'estado tab in English dark: same counts, translated chrome only',
        lambda: (
            f'{assert_provenance(page, "en")}'
            f' {assert_no_spanish_tags(page)}'
            f' kpis={page.locator(".mon-kpi").count()}'
            f' title={visible_text(page, "#mon-title")}'
            f' alerts={page.locator(".mon-alert").count()}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-overview', 'estado', 'es', 390, 'dark',
        'estado tab on a phone: KPI grid and stacked charts',
        lambda: f'kpis={page.locator(".mon-kpi").count()} charts={page.locator(".mon-chart").count()}',
        rows=True,
    ))
    rows.append(cell(
        page, shots, 'mon-overview', 'estado', 'en', 390, 'light',
        'estado tab on a phone in English light',
        lambda: f'kpis={page.locator(".mon-kpi").count()}',
        rows=True,
    ))

    select_center_tab(page, 1)
    page.wait_for_function("() => !!document.querySelector('.mon-table__row, .mon-table-wrap .empty-state')")
    rows.append(cell(
        page, shots, 'mon-devices', 'populated', 'es', 1440, 'light',
        'devices tab: canonical rows with scripted status, latency and availability',
        lambda: (
            f'rows={page.locator(".mon-table__row").count()}'
            f' pills={page.locator(".mon-table .mon-pill").count()}'
            f' filter_button={page.locator(".text-button--quiet").count()}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-devices', 'populated', 'en', 390, 'dark',
        'devices table on a phone: horizontal scroll inside its own wrapper',
        lambda: (
            f'rows={page.locator(".mon-table__row").count()}'
            f' wrap={page.evaluate("() => { const n = document.querySelector(\'.mon-table-wrap\'); return n ? n.scrollWidth - n.clientWidth : -1; }")}'
        ),
        rows=True,
    ))

    # The site filter is the public path for the canonical site of a device.
    site_select = page.locator('.mon-toolbar select').nth(2)
    options = site_select.locator('option')
    labels = [item.strip() for item in options.all_inner_texts()]
    print(f'DIAG site options: {labels[:6]}')
    value = None
    for index in range(1, options.count()):
        option_value = options.nth(index).get_attribute('value')
        if option_value:
            value = option_value
            break
    expected = 0
    if value and state['rows']:
        expected = len([row for row in state['rows'] if (row.get('siteId') or '') == value])

    def assert_site_filter():
        labels_now = [item.strip() for item in site_select.locator('option').all_inner_texts()]
        blank = [index for index, label in enumerate(labels_now) if index and not label]
        painted = page.locator('.mon-table__row').count()
        assert not blank, f'blank site options at {blank}: {labels_now}'
        assert painted == expected, f'site filter painted {painted} rows, expected {expected}'
        return f'site_options={len(labels_now)} selected={labels_now[-1][:28]!r} rows={painted}'

    if value:
        site_select.select_option(value)
        page.wait_for_timeout(200)
        rows.append(cell(
            page, shots, 'mon-devices', 'site-filter', 'es', 1440, 'light',
            'site filter selected: the rows of that canonical site stay listed',
            assert_site_filter,
        ))
        site_select.select_option('all')
        page.wait_for_timeout(150)

    search = page.locator('.mon-toolbar input[type="search"]').first
    search.fill('zzz-sin-coincidencias')
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-devices', 'empty-filtered', 'es', 1440, 'light',
        'no device matches the typed query: filtered empty copy, not a blank table',
        lambda: assert_text(page, '.mon-table-wrap .empty-state', tr('es', 'ui.monitoring.devices.empty')),
    ))
    search.fill('')
    page.wait_for_timeout(150)

    # Truncated page: the scripted boundary reports more rows than it returned.
    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], devices='truncated')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-table__row')")
    rows.append(cell(
        page, shots, 'mon-devices', 'truncated', 'es', 1440, 'light',
        'server reports 125 devices for 5 returned rows: the load-more block states both numbers',
        lambda: (
            f'count={visible_text(page, ".mon-settings__actions .mon-panel__sub")}'
            f' button={visible_text(page, ".mon-settings__actions .btn")}'
        ),
    ))
    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], devices='error')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-page .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-devices', 'error', 'es', 1440, 'light',
        'devices read fails: alert copy instead of an empty table, refresh still available',
        lambda: (
            f'{assert_text(page, ".mon-page .mon-notice[role=\"alert\"]", tr("es", "ui.errors.unavailable"))}'
            f' refresh={page.locator(".mon-head__actions .btn").count()}'
        ),
    ))

    page.unroute_all(behavior='ignoreErrors')
    state2 = install(page, state['data'], devices='delay')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-progress__text')")
    rows.append(cell(
        page, shots, 'mon-devices', 'loading', 'es', 1440, 'light',
        'devices read in flight: announced loading, no empty state',
        lambda: (
            f'busy={page.evaluate("() => Array.from(document.querySelectorAll(\'.mon-page [role=tabpanel]\')).map(n => n.getAttribute(\'aria-busy\'))")}'
            f' status={visible_text(page, ".mon-progress__text")}'
        ),
    ))
    release(state2, 'devices', lambda route: paged(state2['rows'], query_of(route)))
    page.wait_for_function("() => !!document.querySelector('.mon-table__row')")
    page.wait_for_timeout(120)
    # The held handler would keep delaying every later read, so restore a
    # healthy boundary before the next capture.
    page.unroute_all(behavior='ignoreErrors')
    data = state['data']
    state = install(page, data)
    state['data'] = data

    select_center_tab(page, 2)
    page.wait_for_function("() => !!document.querySelector('.mon-alert, .mon-page .empty-state')")
    rows.append(cell(
        page, shots, 'mon-alerts', 'populated', 'es', 1440, 'light',
        'alerts tab: firing, acknowledged, resolved and silenced rows with their actions',
        lambda: (
            f'rows={page.locator(".mon-alert").count()}'
            f' tags={page.locator(".mon-alert .mon-tag").count()}'
            f' ack={page.locator(".mon-alert .text-button", has_text=tr("es", "ui.monitoring.action.acknowledge")).count()}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-alerts', 'populated', 'en', 1440, 'dark',
        'alerts tab in English dark',
        lambda: f'rows={page.locator(".mon-alert").count()} title={visible_text(page, ".mon-tab.is-active")}',
    ))
    alert_search = page.locator('.mon-toolbar input[type="search"]').first
    alert_search.fill('zzz-sin-coincidencias')
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-alerts', 'empty-filtered', 'es', 390, 'light',
        'no alert matches the typed query, including on a phone',
        lambda: assert_text(page, '.mon-page .empty-state', tr('es', 'ui.monitoring.alerts.empty')),
        rows=True,
    ))
    alert_search.fill('')
    page.wait_for_timeout(150)

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], alerts='error')
    goto_hash(page, '#/panel')
    open_center(page, 2)
    page.wait_for_function("() => !!document.querySelector('.mon-page .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-alerts', 'error', 'es', 1440, 'light',
        'alerts read fails: the alert notice replaces the list',
        lambda: (
            f'{assert_text(page, ".mon-page .mon-notice[role=\"alert\"]", tr("es", "ui.errors.unavailable"))}'
            f' refresh={page.locator(".mon-head__actions .btn").count()}'
        ),
    ))

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'])
    return rows


def run_devices(page, shots, state):
    rows = []
    reset_view(page)
    down = state['rows'][0]
    up = state['rows'][2] if len(state['rows']) > 2 else down
    goto_hash(page, '#/supervision/activo/' + down['assetId'])
    wait_device(page)
    rows.append(cell(
        page, shots, 'mon-device', 'populated', 'es', 1440, 'light',
        'device page: status, metrics, provenance, checks, effective config, series and alerts',
        lambda: (
            f'{assert_override_labels(page, "es")}'
            f' metrics={page.locator(".mon-device .mon-metric").count()}'
            f' checks={page.locator(".mon-checks-list__item").count()}'
            f' facts={page.locator(".mon-facts__row").count()}'
            f' charts={page.locator(".mon-chart").count()}'
            f' alerts={page.locator(".mon-device .mon-alert").count()}'
            f' provenance={visible_text(page, ".mon-device .mon-panel__sub")[:44]}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-device', 'populated', 'en', 390, 'dark',
        'device page on a phone in English dark: metric and panel stack',
        lambda: (
            f'metrics={page.locator(".mon-device .mon-metric").count()}'
            f' charts={page.locator(".mon-chart").count()}'
        ),
        rows=True,
    ))

    if len(state['rows']) > 4:
        goto_hash(page, '#/supervision/activo/' + state['rows'][4]['assetId'])
        wait_device(page)
        rows.append(cell(
            page, shots, 'mon-device', 'unmonitored', 'es', 1440, 'light',
            'an unmonitored asset explains the exclusion and offers configuration',
            lambda: assert_text(page, '.mon-device .mon-notice__title',
                                tr('es', 'ui.monitoring.device.not_monitored_title'))
            + ' empty_checks=' + str(page.locator('.mon-device .empty-state').count()),
        ))

    # The canonical device page for an unknown id is a real 404.
    page.unroute_all(behavior='ignoreErrors')
    goto_hash(page, '#/supervision/activo/' + UNKNOWN_ID)
    page.wait_for_function("() => !!document.querySelector('.mon-device .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-device', 'missing', 'es', 1440, 'light',
        'unknown asset id: the real 404 paints the unavailable copy, not a blank page',
        lambda: assert_text(page, '.mon-device .mon-notice[role="alert"]', tr('es', 'ui.monitoring.device.missing')),
    ))

    install(page, state['data'], device='error')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/activo/' + down['assetId'])
    page.wait_for_function("() => !!document.querySelector('.mon-device .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-device', 'error', 'es', 1440, 'light',
        'device read fails with 503: the alert notice is painted, no record',
        lambda: (
            f'{assert_retry(page, "es")}'
            f' notice={visible_text(page, ".mon-device .mon-notice")[:60]}'
            f' metrics={page.locator(".mon-device .mon-metric").count()}'
        ),
    ))

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], device='delay')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/activo/' + down['assetId'])
    page.wait_for_function("() => !!document.querySelector('.mon-progress__text')")
    rows.append(cell(
        page, shots, 'mon-device', 'loading', 'es', 1440, 'light',
        'device read in flight: status line announced, no half-painted record',
        lambda: f'status={visible_text(page, ".mon-progress__text")} metrics={page.locator(".mon-metric").count()}',
    ))

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'])
    return rows


def run_real_unconfigured(page, shots):
    """The installation's own devices page, with no Prometheus configured."""
    rows = []
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-table__row, .mon-table-wrap .empty-state')")
    rows.append(cell(
        page, shots, 'mon-devices', 'real-unconfigured', 'es', 1440, 'light',
        'real API without Prometheus: honest availability state and reason per row',
        lambda: (
            f'rows={page.locator(".mon-table__row").count()}'
            f' states={sorted(set(page.locator(".mon-table__row td:nth-child(2) .mon-table__meta").all_inner_texts()))}'
        ),
    ))
    first = page.locator('.mon-table__device').first
    if first.count():
        first.click()
        wait_device(page)
        rows.append(cell(
            page, shots, 'mon-device', 'real-unconfigured', 'es', 1440, 'light',
            'real device page without Prometheus: no invented series, origin disclosed',
            lambda: (
                f'notice={visible_text(page, ".mon-device .mon-panel__sub")[:70]}'
                f' charts={page.locator(".mon-chart").count()}'
                f' reason_ok={assert_device_reason(page)}'
            ),
        ))
    return rows


def assert_device_reason(page):
    reason = visible_text(page, '.mon-device .mon-panel__sub')
    assert reason == tr('es', 'ui.monitoring.reason.prometheus_not_configured'), f'reason={reason!r}'
    return True


def run_alert_page(page, shots, state):
    rows = []
    reset_view(page)
    alert = state['alerts'][0]
    goto_hash(page, '#/supervision/alerta/' + alert['id'])
    wait_alert(page)
    rows.append(cell(
        page, shots, 'mon-alert-page', 'firing', 'es', 1440, 'light',
        'alert page: severity head, metrics, history, asset, silences and maintenance panels',
        lambda: (
            f'{assert_timeline(page)}'
            f' title={visible_text(page, "#mon-alert-title")}'
            f' metrics={page.locator(".mon-alert-page .mon-metric").count()}'
            f' events={page.locator(".mon-timeline__item").count()}'
            f' panels={page.locator(".mon-alert-page .mon-panel").count()}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-alert-page', 'firing', 'en', 390, 'dark',
        'alert page on a phone in English dark',
        lambda: (
            f'{assert_timeline(page)}'
            f' {assert_no_spanish_tags(page)}'
            f' events={page.locator(".mon-timeline__item").count()}'
            f' actions={page.locator(".mon-alert-head__actions .btn").count()}'
        ),
        rows=True,
    ))
    resolved = state['alerts'][2]
    goto_hash(page, '#/supervision/alerta/' + resolved['id'])
    wait_alert(page)
    rows.append(cell(
        page, shots, 'mon-alert-page', 'resolved', 'es', 1440, 'light',
        'resolved and silenced alert: recovered label, assisted close notice, no acknowledge',
        lambda: (
            f'copy={visible_text(page, ".mon-alert-head__tags")[:60]}'
            f' notice={visible_text(page, ".mon-notice--warn .mon-notice__title")}'
            f' ack={page.locator(".mon-alert-head__actions .btn", has_text=tr("es", "ui.monitoring.action.acknowledge")).count()}'
        ),
    ))
    page.unroute_all(behavior='ignoreErrors')
    goto_hash(page, '#/supervision/alerta/' + UNKNOWN_ID)
    page.wait_for_function("() => !!document.querySelector('.mon-alert-page .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-alert-page', 'missing', 'es', 1440, 'light',
        'unknown alert id: real 404, localized unavailable copy',
        lambda: assert_text(page, '.mon-alert-page .mon-notice[role="alert"]', tr('es', 'ui.monitoring.alert.missing')),
    ))
    install(page, state['data'], alert='error')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/alerta/' + alert['id'])
    page.wait_for_function("() => !!document.querySelector('.mon-alert-page .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-alert-page', 'error', 'es', 1440, 'light',
        'alert read fails: the notice replaces the head, no stale record',
        lambda: (
            f'{assert_retry(page, "es")}'
            f' notice={visible_text(page, ".mon-alert-page .mon-notice")[:60]}'
            f' heads={page.locator(".mon-alert-head").count()}'
        ),
    ))
    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'])
    return rows


def run_inbox(page, shots, state):
    rows = []
    reset_view(page)
    goto_hash(page, '#/supervision/notificaciones')
    wait_inbox(page)
    rows.append(cell(
        page, shots, 'mon-inbox', 'populated', 'es', 1440, 'light',
        'notification inbox: unread rows, kind and severity tags, dates',
        lambda: (
            f'{assert_inbox_paint_fits(page)}'
            f' rows={page.locator(".mon-inbox__item").count()}'
            f' unread={page.locator(".mon-inbox__item.is-unread").count()}'
            f' pills={page.locator(".mon-pill-button").count()}'
            f' title={visible_text(page, "#inbox-title")}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-inbox', 'populated', 'en', 390, 'dark',
        'inbox on a phone in English dark',
        lambda: (
            f'{assert_inbox_paint_fits(page)}'
            f' rows={page.locator(".mon-inbox__item").count()}'
        ),
        rows=True,
    ))
    page.locator('.mon-pill-button').nth(1).click()
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-inbox', 'unread-filter', 'es', 390, 'light',
        'unread filter narrows the list to the rows the server marked unread',
        lambda: (
            f'{assert_pill_state(page)}'
            f' {assert_inbox_paint_fits(page)}'
            f' rows={page.locator(".mon-inbox__item").count()}'
            f' pressed={page.locator(".mon-pill-button").nth(1).get_attribute("aria-pressed")}'
        ),
        rows=True,
    ))
    page.locator('.mon-pill-button').nth(0).click()
    page.wait_for_timeout(120)

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], inbox='empty')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/notificaciones')
    page.wait_for_function("() => !!document.querySelector('.mon-inbox .empty-state')")
    rows.append(cell(
        page, shots, 'mon-inbox', 'empty', 'es', 1440, 'light',
        'empty inbox with no filter: the installation copy, not the filtered one',
        lambda: assert_text(page, '.mon-inbox .empty-state', tr('es', 'ui.notifications.empty_install')),
    ))

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'], inbox='error')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/notificaciones')
    page.wait_for_function("() => !!document.querySelector('.mon-inbox .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-inbox', 'error', 'es', 1440, 'light',
        'inbox read fails: alert copy instead of an empty inbox',
        lambda: f'notice={visible_text(page, ".mon-inbox .mon-notice")[:60]}',
    ))

    page.unroute_all(behavior='ignoreErrors')
    install(page, state['data'])
    return rows


def open_bell(page):
    """Open the notification panel if a theme or locale change closed it."""
    trigger = page.locator('.notif__trigger')
    trigger.wait_for(state='visible')
    if not page.locator('.notif__panel').count():
        trigger.click()
    page.wait_for_function("() => !!document.querySelector('.notif__panel')")
    page.wait_for_timeout(140)


def bell_box(page):
    return page.evaluate(
        "() => { const node = document.querySelector('.notif__panel');"
        " if (!node) return null; const r = node.getBoundingClientRect();"
        " return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; }"
    )


def run_bell(page, shots, state):
    rows = []
    expected = sum(1 for item in state['inbox'] if item.get('unread'))
    # The inbox owns the unread count: refreshing it re-reads the badge from the
    # scripted boundary instead of the count cached before the boundary existed.
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/notificaciones')
    page.wait_for_function("() => !!document.querySelector('.mon-inbox__item')")
    page.locator('.mon-head__actions .btn').click()
    page.wait_for_timeout(220)
    open_bell(page)
    rows.append(cell(
        page, shots, 'mon-bell', 'open', 'es', 1440, 'light',
        'notification bell open: latest five with unread marks and the way to the inbox',
        lambda: (
            f'items={page.locator(".notif__item").count()}'
            f' expanded={page.locator(".notif__trigger").get_attribute("aria-expanded")}'
            f' label={page.locator(".notif__trigger").get_attribute("aria-label")}'
            + (f' badge_ok={expected}' if assert_bell_count(page, expected) else '')
        ),
        viewport_only=True,
        prepare=lambda: open_bell(page),
    ))
    rows.append(cell(
        page, shots, 'mon-bell', 'open', 'en', 390, 'dark',
        'bell panel on a phone: fixed panel above the bottom edge',
        lambda: (
            f'items={page.locator(".notif__item").count()}'
            f' box={bell_box(page)}'
        ),
        viewport_only=True,
        prepare=lambda: open_bell(page),
    ))
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.querySelector('.notif__panel')")
    assert page.evaluate("() => document.activeElement && document.activeElement.classList.contains('notif__trigger')"), \
        'Escape did not return focus to the bell'
    return rows


def assert_bell_count(page, expected):
    label = page.locator('.notif__trigger').get_attribute('aria-label') or ''
    digits = re.findall(r'\d+', label)
    assert digits and int(digits[0]) == expected, f'bell aria-label={label!r} lacks the unread count {expected}'
    return True


def dialog_opener(page, selector, text):
    """Open a dialog after the cell has applied theme, locale and viewport.

    A modal layer intercepts the theme toggle, so an open dialog must be the
    last thing that happens before the capture.
    """
    def run():
        page.locator(selector, has_text=text).first.click()
        page.locator('.modal[role="dialog"]').wait_for(state='visible')
        page.wait_for_timeout(140)
    return run


def run_dialogs(page, shots, state):
    rows = []
    reset_view(page)
    before = write_count(page, ('/monitoring', '/notifications', '/maintenance'))

    goto_hash(page, '#/supervision/alertas')
    page.wait_for_function("() => !!document.querySelector('.mon-alert')")
    rows.append(cell(
        page, shots, 'mon-dialog', 'silence', 'es', 1440, 'light',
        'silence dialog over the alert list: duration, reason, footer',
        lambda: assert_dialog(page, tr('es', 'ui.monitoring.silence.title'),
                              [tr('es', 'ui.common.cancel'), tr('es', 'ui.monitoring.silence.submit')]),
        viewport_only=True,
        prepare=dialog_opener(page, '.mon-alert .text-button', tr('es', 'ui.monitoring.silence.submit')),
    ))
    cancel_dialog(page)

    rows.append(cell(
        page, shots, 'mon-dialog', 'silence', 'en', 390, 'dark',
        'silence dialog on a phone in English dark',
        lambda: assert_dialog(page, tr('en', 'ui.monitoring.silence.title'),
                              [tr('en', 'ui.common.cancel'), tr('en', 'ui.monitoring.silence.submit')]),
        viewport_only=True,
        prepare=dialog_opener(page, '.mon-alert .text-button', tr('en', 'ui.monitoring.silence.submit')),
    ))
    cancel_dialog(page)

    goto_hash(page, '#/supervision/alerta/' + state['alerts'][0]['id'])
    wait_alert(page)
    rows.append(cell(
        page, shots, 'mon-dialog', 'convert', 'en', 1440, 'light',
        'link-to-maintenance dialog: canonical incident choices loaded from the real API',
        lambda: assert_dialog(page, tr('en', 'ui.monitoring.convert.title'),
                              [tr('en', 'ui.common.cancel'), tr('en', 'ui.monitoring.convert.create')])
        + f' options={page.locator(".modal select option").count()}',
        viewport_only=True,
        prepare=dialog_opener(page, '.mon-alert-head__actions .btn', tr('en', 'ui.monitoring.action.link_incident')),
    ))
    cancel_dialog(page)

    goto_hash(page, '#/supervision/alerta/' + state['alerts'][0]['id'])
    wait_alert(page)
    rows.append(cell(
        page, shots, 'mon-dialog', 'convert', 'es', 390, 'light',
        'link-to-maintenance dialog on a phone',
        lambda: assert_dialog(page, tr('es', 'ui.monitoring.convert.title'),
                              [tr('es', 'ui.common.cancel'), tr('es', 'ui.monitoring.convert.create')]),
        viewport_only=True,
        prepare=dialog_opener(page, '.mon-alert-head__actions .btn', tr('es', 'ui.monitoring.action.link_incident')),
    ))
    cancel_dialog(page)

    after = write_count(page, ('/monitoring', '/notifications', '/maintenance'))
    assert after == before, f'dialogs sent writes: {WRITES[id(page)][before:]}'
    print(f'DIALOGS cancelled: monitoring writes={after - before}')
    return rows


def run_settings(page, shots, state):
    rows = []
    reset_view(page)
    goto_hash(page, '#/configuracion/supervision')
    page.locator('#mon-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-settings', 'supervision-categories', 'es', 1440, 'light',
        'monitoring settings: category profiles and the edit form',
        lambda: (
            f'{assert_category_labels(page)}'
            f' profiles={page.locator(".mon-settings__list li").count()}'
            f' toggles={page.locator(".mon-toggle").count()}'
            f' thresholds={page.locator(".mon-thresholds input").count()}'
            f' names={[item.strip() for item in page.locator(".mon-settings-table__name").all_inner_texts()][:3]}'
        ),
    ))
    rows.append(cell(
        page, shots, 'mon-settings', 'supervision-categories', 'en', 390, 'dark',
        'monitoring settings on a phone in English dark',
        lambda: f'profiles={page.locator(".mon-settings__list li").count()}',
        rows=True,
    ))
    page.locator('.mon-settings .mon-tab').nth(1).click()
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-settings', 'supervision-overrides', 'es', 1440, 'light',
        'per-asset exception form: canonical asset directory, target and credential hints',
        lambda: (
            f'options={page.locator("#mon-asset-options option").count()}'
            f' fields={page.locator(".mon-exception-form .field").count()}'
            f' submit={visible_text(page, ".mon-exception-form .btn--primary")}'
        ),
    ))
    page.locator('.mon-settings .mon-tab').nth(2).click()
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-settings', 'supervision-exporters', 'es', 1440, 'light',
        'exporter list and its create form; empty list keeps its own copy',
        lambda: (
            f'rows={page.locator(".mon-settings__list li").count()}'
            f' empty={visible_text(page, ".mon-settings .empty-state")[:40]}'
            f' submit={visible_text(page, ".mon-channel__form .btn--primary")}'
        ),
    ))

    goto_hash(page, '#/configuracion/alertas')
    page.locator('#alert-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'alert-settings', 'windows', 'es', 1440, 'light',
        'alert settings: maintenance windows form and list',
        lambda: (
            f'{assert_window_layout(page)}'
            f' rows={page.locator(".mon-settings__list li").count()}'
            f' empty={visible_text(page, ".mon-settings .empty-state")[:40]}'
            f' days={page.locator(".mon-window-form .mon-toggle").count()}'
        ),
    ))
    page.locator('.mon-settings .mon-tab').nth(1).click()
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'alert-settings', 'silences', 'en', 390, 'dark',
        'asset silence form on a phone in English dark',
        lambda: (
            f'fields={page.locator(".mon-exception-form--silence .field").count()}'
            f' submit={visible_text(page, ".mon-exception-form--silence .btn--primary")}'
        ),
        rows=True,
    ))

    goto_hash(page, '#/configuracion/notificaciones')
    page.locator('#notif-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'notif-settings', 'channels', 'es', 1440, 'light',
        'notification channels: configured state, credential references, no raw secrets',
        lambda: (
            f'rows={page.locator(".mon-settings__list li").count()}'
            f' empty={visible_text(page, ".mon-settings .empty-state")[:40]}'
            f' secret_inputs={page.locator(".mon-channel__form input").count()}'
        ),
    ))
    page.locator('.mon-settings .mon-tab').nth(1).click()
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'notif-settings', 'rules', 'es', 1440, 'light',
        'notification rules: builtin rule, recipients and schedule fields',
        lambda: (
            f'rows={page.locator(".mon-settings__list li").count()}'
            f' toggles={page.locator(".mon-toggle").count()}'
            f' submit={visible_text(page, ".mon-channel__form .btn--primary")}'
        ),
    ))
    return rows


CANONICAL_CATEGORIES = (
    {'id': 'network_core', 'label': 'Core — edificio A', 'active': True},
    {'id': 'servidores', 'label': 'Servidores canónicos', 'active': True},
)


def install_inventory_catalog(page, extra):
    """Script the server-owned inventory catalog.

    The authoritative category labels come from ``GET /inventory/config``; the
    boundary replaces two ids so a canonical label can be asserted, including a
    custom category the prototype configuration does not know at all.
    """
    real = api_json(page, '/api/v1/inventory/config')
    assert real['status'] == 200, real
    body = dict(real['body'] or {})
    replaced = {item['id'] for item in extra}
    kept = [item for item in (body.get('categories') or []) if item.get('id') not in replaced]
    body['categories'] = kept + list(extra)
    page.route('**/api/v1/inventory/config*', json_route(body))
    return body


def category_fixture(data):
    """Dataset with a custom canonical category, its profile and one asset on it."""
    fixture_data = dict(data)
    config = json.loads(json.dumps(data['config']))
    profiles = [item for item in (config.get('profiles') or []) if item.get('category') != 'network_core']
    profiles.insert(0, {
        'category': 'network_core', 'enabled': True, 'checkType': 'icmp', 'intervalSeconds': 60,
        'metrics': ['latency'], 'thresholds': {'latency': {'warning': 150, 'critical': 300}},
        'minimumDurationSeconds': 300, 'exporterId': None, 'snmpModule': None, 'snmpAuthRef': None,
    })
    config['profiles'] = profiles
    devices = [dict(item) for item in data['devices']]
    if devices:
        devices[0]['category'] = 'network_core'
    fixture_data['config'] = config
    fixture_data['devices'] = devices
    return fixture_data


def settings_category_names(page):
    return [item.strip() for item in page.locator('.mon-settings-table__name').all_inner_texts()]


def settings_category_options(page):
    select = page.locator('.mon-settings .mon-grid--split select').first
    return [item.strip() for item in select.locator('option').all_inner_texts()]


def assert_canonical_category(page, locale):
    """The canonical inventory label is shown and no fallback or local name wins."""
    names = settings_category_names(page)
    options = settings_category_options(page)
    print(f'DIAG category names ({locale}): {names[:4]} options={options[:4]}')
    assert any('Core — edificio A' in name for name in names), f'profile list lacks the canonical label: {names}'
    assert any('Servidores canónicos' in name for name in names), f'a prototype label won over the catalog: {names}'
    assert not any('Network core' in name for name in names), f'raw slug fallback painted for a known category: {names}'
    assert any('Core — edificio A' in item for item in options), f'category picker lacks the canonical label: {options}'
    assert not any(item == 'Servidores' for item in options), f'prototype category name survived: {options}'
    return f'names={len(names)} canonical=True options={len(options)}'


def population_text(page):
    return visible_text(page, '.mon-kpis + .mon-panel__sub') or visible_text(page, '.mon-panel__sub')


def assert_population_disclosure(page, locale, loaded, visible, total):
    """Counters describe the loaded page; the list may narrow it. Both are stated."""
    text = population_text(page)
    print(f'DIAG population ({locale}): {text}')
    assert text, 'no population disclosure painted'
    assert str(loaded) in text and str(total) in text, f'disclosure omits loaded/total: {text}'
    assert str(visible) in text, f'disclosure omits the visible count {visible}: {text}'
    if locale == 'es':
        assert 'ver todo' not in text and 'todo' not in text.split('servidor')[-1], f'copy still promises everything: {text}'
    else:
        assert 'see everything' not in text, f'copy still promises everything: {text}'
    return f'loaded={loaded} visible={visible} total={total}'


def phone_table_state(page):
    return page.evaluate("""() => {
      const wrap = document.querySelector('.mon-table-wrap');
      if (!wrap) return {missing: true};
      const lastCol = wrap.querySelector('.mon-table thead th:last-child');
      const action = wrap.querySelector('.mon-table__row:last-child .mon-table__actions .text-button');
      const wr = wrap.getBoundingClientRect();
      const cells = [...wrap.querySelectorAll('.mon-table thead th, .mon-table__row td, .mon-table__row .mon-pill')];
      return {
        missing: false,
        role: wrap.getAttribute('role'),
        tabindex: wrap.getAttribute('tabindex'),
        label: wrap.getAttribute('aria-label'),
        scrollLeft: Math.round(wrap.scrollLeft),
        maxScroll: Math.round(wrap.scrollWidth - wrap.clientWidth),
        lastRight: lastCol ? Math.round(lastCol.getBoundingClientRect().right) : null,
        wrapLeft: Math.round(wr.left),
        wrapRight: Math.round(wr.right),
        actionRight: action ? Math.round(action.getBoundingClientRect().right) : null,
        actionWidth: action ? Math.round(action.getBoundingClientRect().width) : 0,
        actionText: action ? action.innerText.trim() : '',
        clipped: cells.filter(node => node.scrollWidth - node.clientWidth > 1).length,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    }""")


def assert_phone_scroll(page, locale):
    """The table's scroll region is reachable by keyboard and pointer, and its
    last column plus the row action stay inside the region when scrolled."""
    wrap = page.locator('.mon-table-wrap')
    wrap.scroll_into_view_if_needed()
    wrap.focus()
    for _ in range(14):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(250)
    end = phone_table_state(page)
    print(f'DIAG phone table keyboard ({locale}): {end}')
    assert end.get('role') == 'region', f'table scroll area is not a labelled region: {end}'
    assert end.get('tabindex') == '0', f'table scroll area is not keyboard focusable: {end}'
    assert end.get('label'), 'table scroll area has no accessible name'
    assert end.get('maxScroll', 0) > 0, f'table does not overflow at phone width: {end}'
    assert end.get('scrollLeft', 0) >= end.get('maxScroll', 0) - 2, f'keyboard arrows did not reach the last column: {end}'
    assert (end.get('lastRight') or 0) <= end['wrapRight'] + 1, f'last column stays outside the region: {end}'
    assert end.get('actionWidth', 0) > 0, f'row action has no box: {end}'
    assert (end.get('actionRight') or 0) <= end['wrapRight'] + 1, f'row action stays outside the region: {end}'
    for _ in range(16):
        page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    home = phone_table_state(page)
    assert home.get('scrollLeft') == 0, f'arrows did not scroll the region back: {home}'
    page.mouse.move(end['wrapLeft'] + 160, 500)
    page.mouse.wheel(700, 0)
    page.wait_for_timeout(250)
    wheeled = phone_table_state(page)
    print(f'DIAG phone table pointer ({locale}): scrollLeft={wheeled.get("scrollLeft")} of {wheeled.get("maxScroll")}')
    assert wheeled.get('scrollLeft', 0) > 0, f'a horizontal wheel over the region does not scroll it: {wheeled}'
    assert end.get('clipped') == 0, f'{end.get("clipped")} table cells clip their own content: {end}'
    assert end.get('pageOverflow', 0) <= 1, f'the page overflows horizontally: {end}'
    return (f'max={end["maxScroll"]} reached={end["scrollLeft"]} back=0 wheel=ok '
            f'last_column_inside=True action_inside=True clipped=0')


def run_corrections(page, shots, state):
    """Canonical category labels, truthful counter population and phone reachability."""
    rows = []
    fixture_data = category_fixture(state['data'])
    reset_view(page)
    install_inventory_catalog(page, CANONICAL_CATEGORIES)
    install(page, fixture_data)
    # The catalog is read once per session and cached by its owner, so the
    # scripted catalog only applies to a freshly mounted application.
    page.evaluate("() => { location.hash = '#/configuracion/supervision'; }")
    page.reload(wait_until='domcontentloaded')
    wait_mounted(page)
    goto_hash(page, '#/panel')
    goto_hash(page, '#/configuracion/supervision')
    page.locator('#mon-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !!document.querySelector('.mon-settings-table__name')")
    page.wait_for_timeout(200)
    rows.append(cell(
        page, shots, 'mon-settings', 'canonical-category', 'es', 1440, 'light',
        'category labels come from the inventory catalog; a custom label survives the profile merge',
        lambda: assert_canonical_category(page, 'es'),
    ))
    rows.append(cell(
        page, shots, 'mon-settings', 'canonical-category', 'en', 1440, 'dark',
        'the canonical category label is server data and stays intact in English dark',
        lambda: assert_canonical_category(page, 'en'),
    ))

    first = build_rows(fixture_data)[0]
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/activo/' + first['assetId'])
    wait_device(page)
    page.wait_for_timeout(200)
    rows.append(cell(
        page, shots, 'mon-device', 'canonical-category', 'es', 1440, 'light',
        'device page names the profile category by its canonical label, never a slug',
        lambda: assert_device_category(page, 'Core — edificio A'),
    ))

    page.unroute_all(behavior='ignoreErrors')
    install_inventory_catalog(page, CANONICAL_CATEGORIES)
    install(page, fixture_data, devices='truncated')
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-table__row')")
    site_select = page.locator('.mon-toolbar select').nth(2)
    options = site_select.locator('option')
    value = None
    for index in range(1, options.count()):
        option_value = options.nth(index).get_attribute('value')
        if option_value:
            value = option_value
            break
    visible = len(build_rows(fixture_data))
    if value:
        site_select.select_option(value)
        page.wait_for_timeout(200)
        visible = len([row for row in build_rows(fixture_data) if (row.get('siteId') or '') == value])
    rows.append(cell(
        page, shots, 'mon-devices', 'population-note', 'es', 1440, 'light',
        'counters describe the loaded page of a larger server total; the visible row count is separate',
        lambda: assert_population_disclosure(page, 'es', len(build_rows(fixture_data)), visible, 125),
    ))

    page.unroute_all(behavior='ignoreErrors')
    install_inventory_catalog(page, CANONICAL_CATEGORIES)
    install(page, fixture_data)
    goto_hash(page, '#/panel')
    goto_hash(page, '#/supervision/dispositivos')
    page.wait_for_function("() => !!document.querySelector('.mon-table__row')")
    rows.append(cell(
        page, shots, 'mon-devices', 'phone-scroll', 'en', 390, 'dark',
        'phone table: labelled scroll region reaches the last column and the row action by keyboard',
        lambda: assert_phone_scroll(page, 'en'),
        rows=True,
    ))
    return rows


def assert_device_category(page, expected):
    text = page.locator('.mon-device').inner_text()
    assert expected in text, f'device page lacks the canonical category label: {text[:200]}'
    assert 'Network core' not in text, 'device page painted the slug fallback for a known category'
    return f'category={expected!r} slug_absent=True'


def run_marked(page, base, shots):
    data = build_dataset(page)
    state = install(page, data)
    state['data'] = data
    print(f'DATASET marked: devices={len(state["rows"])} real_alerts={len(data["alerts"])} inbox={len(data["inbox"])}')
    rows = []
    rows += run_center(page, shots, state)
    rows += run_devices(page, shots, state)
    page.unroute_all(behavior='ignoreErrors')
    rows += run_real_unconfigured(page, shots)
    install(page, data)
    rows += run_alert_page(page, shots, state)
    rows += run_inbox(page, shots, state)
    rows += run_bell(page, shots, state)
    rows += run_dialogs(page, shots, state)
    rows += run_settings(page, shots, state)
    rows += run_corrections(page, shots, state)
    return rows


def run_ordinary(page, base, shots):
    rows = []
    goto_hash(page, '#/supervision')
    page.wait_for_function("() => !!document.querySelector('.mon-page .mon-kpi, .mon-page .mon-notice')")
    rows.append(cell(
        page, shots, 'mon-overview', 'empty', 'es', 1440, 'light',
        'empty installation: zero counts, charts with no points, no invented readings',
        lambda: (
            f'kpis={[item.strip() for item in page.locator(".mon-kpi__value").all_inner_texts()]}'
            f' charts={page.locator(".mon-chart").count()}'
            f' chart_empty={page.locator(".mon-chart__empty").count()}'
        ),
    ))
    select_center_tab(page, 1)
    page.wait_for_timeout(200)
    rows.append(cell(
        page, shots, 'mon-devices', 'empty', 'en', 1440, 'dark',
        'empty installation: the devices empty copy names the missing inventory, not a filter',
        lambda: assert_empty_copy(page, 'en', '.mon-table-wrap .empty-state', 'ui.monitoring.devices.empty_install'),
    ))
    select_center_tab(page, 2)
    page.wait_for_timeout(200)
    rows.append(cell(
        page, shots, 'mon-alerts', 'empty', 'es', 390, 'light',
        'empty installation: the alerts empty copy on a phone',
        lambda: assert_text(page, '.mon-page .empty-state', tr('es', 'ui.monitoring.alerts.empty')),
        rows=True,
    ))

    goto_hash(page, '#/supervision/activo/' + UNKNOWN_ID)
    page.wait_for_function("() => !!document.querySelector('.mon-device .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-device', 'missing-empty-install', 'en', 1440, 'light',
        'empty installation, unknown device: localized unavailable copy',
        lambda: assert_text(page, '.mon-device .mon-notice[role="alert"]', tr('en', 'ui.monitoring.device.missing')),
    ))
    goto_hash(page, '#/supervision/alerta/' + UNKNOWN_ID)
    page.wait_for_function("() => !!document.querySelector('.mon-alert-page .mon-notice[role=\"alert\"]')")
    rows.append(cell(
        page, shots, 'mon-alert-page', 'missing-empty-install', 'es', 1440, 'light',
        'empty installation, unknown alert: localized unavailable copy',
        lambda: assert_text(page, '.mon-alert-page .mon-notice[role="alert"]', tr('es', 'ui.monitoring.alert.missing')),
    ))

    goto_hash(page, '#/supervision/notificaciones')
    page.wait_for_function("() => !!document.querySelector('.mon-inbox .empty-state')")
    rows.append(cell(
        page, shots, 'mon-inbox', 'empty-real', 'es', 1440, 'light',
        'empty installation: the server answers an empty inbox',
        lambda: assert_empty_copy(page, 'es', '.mon-inbox .empty-state', 'ui.notifications.empty_install')
        + f' pills={[item.strip() for item in page.locator(".mon-pill-button").all_inner_texts()]}',
    ))
    page.locator('.notif__trigger').click()
    page.wait_for_function("() => !!document.querySelector('.notif__panel')")
    page.wait_for_timeout(120)
    rows.append(cell(
        page, shots, 'mon-bell', 'empty', 'es', 390, 'light',
        'empty installation: the bell panel says there are no notifications',
        lambda: assert_text(page, '.notif__empty', tr('es', 'ui.notifications.bell.empty')),
        viewport_only=True,
    ))
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.querySelector('.notif__panel')")

    goto_hash(page, '#/configuracion/supervision')
    page.locator('#mon-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'mon-settings', 'supervision-empty', 'es', 1440, 'light',
        'empty installation: no category profiles, form still explains the source',
        lambda: (
            f'profiles={page.locator(".mon-settings__list li").count()}'
            f' empty={visible_text(page, ".mon-settings .empty-state")[:60]}'
            f' submit={visible_text(page, ".mon-settings .btn--primary")}'
        ),
    ))
    goto_hash(page, '#/configuracion/alertas')
    page.locator('#alert-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'alert-settings', 'windows-empty', 'es', 1440, 'light',
        'empty installation: no maintenance windows and no invented list',
        lambda: assert_text(page, '.mon-settings .empty-state', tr('es', 'ui.alerts.window.empty')),
    ))
    goto_hash(page, '#/configuracion/notificaciones')
    page.locator('#notif-settings-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.mon-progress__text')")
    page.wait_for_timeout(150)
    rows.append(cell(
        page, shots, 'notif-settings', 'channels-default', 'es', 1440, 'light',
        'empty installation: the server still seeds the internal channel',
        lambda: (
            f'rows={page.locator(".mon-settings__list li").count()}'
            f' names={[item.strip()[:24] for item in page.locator(".mon-settings-table__name").all_inner_texts()]}'
        ),
    ))
    return rows


def drive(browser, base, label, username, password, notice_expected, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    try:
        fixture.wait_for(base + '/api/v1/health/live', timeout=180)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: page.evaluate(
            "text => { (window.__U6_CONSOLE__ = window.__U6_CONSOLE__ || []).push(text); }",
            f'{message.type}: {message.text}') if message.type in ('error', 'warning') else None)
        record_requests(page)
        fixture.login(page, base, username, password)
        wait_mounted(page)
        rows = run_marked(page, base, shots) if notice_expected else run_ordinary(page, base, shots)
        assert not errors, f'{label} page errors: {errors}'
        print(f'PAGEERRORS {label}: 0')
        print(f'FAILURES {label}: {len(FAILURES)}')
        for failure in FAILURES:
            print(failure)
        assert not FAILURES, FAILURES
        return rows
    finally:
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
