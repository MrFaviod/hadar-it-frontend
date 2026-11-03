"""U2: individual visual pass over the operational dashboard, its filters,
reports panel and dashboard preferences.

Reuses ``demo-indicator.browser.py`` exactly like ``ui-access-visual.browser.py``:
two sequential scenarios, each with its own disposable backend and loopback
API/Vite pair.

* ``marked``   -- demo installation (fictional infrastructure, real telemetry,
                  sites, categories, plans and warranties).
* ``ordinary`` -- migrations plus ``bootstrap-superadmin``: a genuinely empty
                  installation, so zero aggregates and missing samples are
                  served by the API instead of being mocked in the browser.

Every rendered cell is captured as its own PNG (route, state, locale, theme and
viewport in the file name) so a human can inspect one image at a time. Nothing
here touches an existing installation, Docker service, device or provider.

Run: cd frontend && python3 tests/ui-dashboard-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import time
from pathlib import Path

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    'dashboard_fixture', Path(__file__).with_name('demo-indicator.browser.py')
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')
WIDTHS = [(1440, 1000), (390, 844)]
THEMES = ['light', 'dark']
LOCALES = ['es', 'en']

# Canonical zero payload of the dashboard service: the same shape the API
# returns for an installation with no monitored devices. Used only in the demo
# installation, to prove the browser renders an honest zero rather than
# inventing operational values. ``ordinary`` proves the same shape end to end.
EMPTY_SUMMARY = {
    'generatedAt': '2026-11-01T10:00:00Z',
    'stats': {'total': 0, 'monitored': 0, 'up': 0, 'degraded': 0, 'down': 0, 'unmonitored': 0,
              'unknown': 0, 'criticalAlerts': 0, 'unacknowledged': 0, 'activeIncidents': 0},
    'availability': {'current': None, 'configured': False, 'samples': [], 'samplesCount': 0, 'lastCheckAt': ''},
    'latency': {'current': None},
    'distribution': [], 'severity': [], 'activeAlerts': [], 'rows': [], 'activity': [],
    'maintenance': [], 'warranties': [],
    'inventory': {'total': 0, 'active': 0, 'unassigned': 0, 'attention': []},
    'incidents': [],
}

COPY = {
    'es': {
        'title': 'Panel',
        'loading': 'Cargando datos operativos…',
        'error': 'No se pudo cargar',
        'retry': 'Reintentar',
        'period_current': 'Actual',
        'period': {'24h': '24 horas', '7d': '7 días', '30d': '30 días'},
        'reports': 'Reportes',
        'download': 'Descargar CSV',
        'download_filename': 'informe-operativo.csv',
        'clear': 'Limpiar filtros',
        'temporary': 'widget temporal',
        'activity_empty': 'Sin eventos de este tipo en el período seleccionado.',
        # Warranty rows are either a countdown, today, or an elapsed-time label;
        # a truncated or negative label is a defect, so the pattern is strict.
        'warranty': r'(?:En -?\d+ días|Hoy|Vencida hace \d+ días?)',
        'distribution_empty': 'Sin equipos inventariados para esta selección.',
    },
    'en': {
        'title': 'Dashboard',
        'loading': 'Loading operational data…',
        'error': 'The dashboard could not be loaded',
        'retry': 'Retry',
        'period_current': 'Current',
        'period': {'24h': '24 hours', '7d': '7 days', '30d': '30 days'},
        'reports': 'Reports',
        'download': 'Download CSV',
        'download_filename': 'operational-report.csv',
        'clear': 'Clear filters',
        'temporary': 'temporary widget',
        'activity_empty': 'No events of this kind in the selected period.',
        'warranty': r'(?:In -?\d+ days|Today|Expired \d+ days? ago)',
        'distribution_empty': 'No assets inventoried for this selection.',
    },
}

MAINTENANCE = {
    'overdue': {'es': 'Vencido', 'en': 'Overdue', 'tone': 'status--down'},
    'upcoming': {'es': 'Próximos', 'en': 'Upcoming', 'tone': 'status--warn'},
    'pending': {'es': 'Pendiente', 'en': 'Pending', 'tone': 'status--hold'},
}
STATUS_LABELS = {
    'es': {'Disponibles', 'Degradados', 'Fuera de línea', 'Sin supervisión', 'Sin datos'},
    'en': {'Available', 'Degraded', 'Offline', 'Unmonitored', 'No data'},
}
SEVERITY_LABELS = {
    'es': ['Crítica', 'Alta', 'Media', 'Baja'],
    'en': ['Critical', 'High', 'Medium', 'Low'],
}


def set_locale(page, tag):
    # Both bundles load once per document; reloading them for every matrix cell
    # trips the API rate limit and leaves the page retrying.
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
    page.wait_for_function(
        "() => !document.querySelector('.page-enter-active,.page-leave-active,"
        ".view-enter-active,.view-leave-active,.fade-enter-active')"
    )


def visible_main(page):
    return page.evaluate("() => (document.querySelector('main') || document.body).innerText") or ''


def cell(page, shots, label, state, locale, width, theme, note, assertions=None):
    """Capture one cell, then assert. The image survives a failing assertion."""
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)
    path = shots / f'{label}-{state}-{locale}-{width}-{theme}.png'
    # A full-page capture keeps the sticky shell header where the viewport was
    # scrolled to; return to the top so the image matches the document.
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(60)
    page.screenshot(path=str(path), full_page=True)
    detail = assertions() if assertions else ''
    leaked = RAW_KEY.search(visible_main(page))
    assert not leaked, (state, locale, leaked.group(0))
    overflow = page.evaluate('document.documentElement.scrollWidth - innerWidth')
    assert overflow <= 1, (state, locale, width, overflow)
    row = (f'SHOT {label} {state} {locale} {width}x{"844" if width < 700 else "1000"} {theme} '
           f'route={page.evaluate("location.hash")} file={path} note={note} {detail}')
    print(row)
    return row


def request_wait(page, requests, needle, start, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(needle in url for url in requests[start:]):
            return
        page.wait_for_timeout(120)
    raise AssertionError(f'no dashboard request matching {needle!r} after #{start}: {requests[start:][:4]}')


def report_count(page):
    """Record count painted by the operational report panel."""
    button = page.locator('[data-od-id="dashboard-reports"]')
    opened = button.get_attribute('aria-expanded') == 'true'
    if not opened:
        button.click()
        expect(page.locator('[data-od-id="dashboard-report-panel"]')).to_be_visible()
    meta = page.locator('[data-od-id="dashboard-report-panel"] p').inner_text()
    match = re.search(r'\d+', meta)
    assert match, meta
    if not opened:
        button.click()
        expect(page.locator('[data-od-id="dashboard-report-panel"]')).to_have_count(0)
    return int(match.group(0)), meta


def ensure_preferences(page, open_panel=True):
    """Open or close the inline preferences without guessing the current state."""
    toggle = page.locator('[data-od-id="dashboard-customize"]')
    panel = page.locator('[data-od-id="dashboard-preferences"]')
    if (toggle.get_attribute('aria-expanded') == 'true') != open_panel:
        toggle.click()
        settle(page)
    if open_panel:
        expect(panel).to_be_visible()
    else:
        expect(panel).to_have_count(0)


def saved_widgets(page):
    """The layout the workspace state actually stores, read back from the API."""
    return page.evaluate(
        """async () => {
            const response = await fetch('/api/v1/workspace/state', {credentials: 'same-origin'});
            const body = await response.json();
            const state = body.state && typeof body.state === 'object' ? body.state : body;
            return Array.isArray(state.widgets) ? state.widgets : null;
        }"""
    )


def small_label_metrics(page):
    """Painted font sizes of the dashboard's smallest labels."""
    return page.evaluate(
        """() => {
            const pick = (selector) => {
                const node = document.querySelector(selector);
                if (!node) return null;
                return { size: parseFloat(getComputedStyle(node).fontSize) };
            };
            return {
                widgetPeriod: pick('.noc-widget-period'),
                kpiLabel: pick('.noc-kpi > span'),
                stateShare: pick('.noc-state-row small'),
                severityLabel: pick('.noc-severity span'),
                groupCount: pick('.noc-group small'),
                logTime: pick('.noc-log time'),
            };
        }"""
    )


def period_chips(page, locale):
    """Observed period copy per widget header, with the values that do not match
    the localized period label of the selected period."""
    observed, mismatched = {}, []
    for widget in page.locator('.noc-widget').all():
        widget_id = widget.get_attribute('data-od-id') or ''
        label = widget.locator('.noc-widget-period')
        if label.count() == 0:
            continue
        value = label.inner_text().strip()
        observed[widget_id.replace('dashboard-widget-', '')] = value
        expected = (COPY[locale]['period']['24h'] if widget_id in (
            'dashboard-widget-availability', 'dashboard-widget-activity', 'dashboard-widget-latency')
            else COPY[locale]['period_current'])
        if value != expected:
            mismatched.append(f'{widget_id}={value!r} expected {expected!r}')
    return observed, mismatched


def assert_populated(page, locale, width):
    expect(page.locator('.noc-kpis')).to_be_visible()
    status = page.locator('.noc-context span[role="status"]').inner_text()
    assert '·' in status and re.search(r'\d', status), status
    expect(page.locator('.noc-segment').first).to_have_attribute('role', 'group')
    expect(page.locator('[data-od-id="dashboard-period-24h"]')).to_have_attribute('aria-pressed', 'true')
    chips, chip_mismatches = period_chips(page, locale)
    # The selected period is named, never painted as the service id `24h`.
    assert not chip_mismatches, (locale, chips, chip_mismatches)
    kpi_label = page.locator('[data-od-id="kpi-availability"] > span').inner_text().strip()
    assert '24h' not in kpi_label, kpi_label
    rows = page.locator('[data-od-id="dashboard-widget-maintenance"] .noc-work')
    assert rows.count() >= 1, 'the demo installation plans maintenance'
    pills = []
    for index in range(rows.count()):
        row = rows.nth(index)
        state = row.get_attribute('data-status')
        pill = row.locator('.status-pill')
        if state in MAINTENANCE:
            expect(pill).to_have_text(MAINTENANCE[state][locale])
            assert MAINTENANCE[state]['tone'] in (pill.get_attribute('class') or '')
        pills.append(pill.inner_text().strip())
    assert not ({'overdue', 'upcoming', 'pending'} & set(pills)), pills
    states = [t.strip() for t in page.locator(
        '[data-od-id="dashboard-widget-distribution"] .noc-state-row > span').all_inner_texts()]
    assert set(states) <= STATUS_LABELS[locale], (locale, states)
    warranty_labels = [t.strip() for t in page.locator(
        '[data-od-id="dashboard-widget-warranties"] .noc-work strong').all_inner_texts()]
    for label in warranty_labels:
        assert re.fullmatch(COPY[locale]['warranty'], label), (locale, label)
        assert not re.search(r'-\d', label), (locale, label)
    severities = [t.strip() for t in page.locator(
        '[data-od-id="dashboard-widget-alerts"] .noc-severity a > span').all_inner_texts()]
    assert severities == SEVERITY_LABELS[locale], (locale, severities)
    # Monitoring samples may be absent in this fixture (no Prometheus/synthetic
    # node). The painted contract must then be honest: a dash and no chart, and
    # the widget named in the unavailable note instead of invented samples.
    availability = page.locator('[data-od-id="kpi-availability"] strong').inner_text().strip()
    chart = page.locator('[data-od-id="dashboard-widget-availability"]').count()
    note_text = ''
    if page.locator('.noc-empty[role="status"]').count():
        note_text = page.locator('.noc-empty[role="status"]').first.inner_text().strip()
    if '%' in availability:
        assert chart == 1, 'a percentage without its widget'
    else:
        assert availability == '—', availability
        assert chart == 0 and ('Disponibilidad' in note_text or 'Availability' in note_text), (chart, note_text)
    if width > 700:
        assert page.eval_on_selector('.noc-grid', 'el => getComputedStyle(el).alignItems') != 'stretch'
        gaps = page.eval_on_selector_all(
            '.noc-widget',
            """els => els.map(el => {
                const head = el.querySelector('.noc-widget-head');
                const body = el.querySelector('.noc-widget-body');
                return Math.round(el.clientHeight - head.offsetHeight - body.offsetHeight);
            })""",
        )
        assert max(gaps) <= 12, gaps
    groups = page.locator('[data-od-id="dashboard-groups"]')
    links = page.locator('[data-od-id="dashboard-groups"] .noc-group')
    total = links.count()
    assert total >= 1, 'the demo installation groups devices'
    bounded = 'flat'
    if width > 700 and total > 4:
        metrics = groups.evaluate('el => ({client: el.clientHeight, scroll: el.scrollHeight})')
        assert metrics['scroll'] > metrics['client'] + 1, metrics
        groups.evaluate('el => { el.scrollTop = 0; }')
        groups.focus()
        page.keyboard.press('End')
        page.wait_for_timeout(120)
        page.keyboard.press('End')
        page.wait_for_timeout(120)
        scrolled, limit = groups.evaluate('el => [el.scrollTop, el.scrollHeight - el.clientHeight]')
        assert scrolled >= limit - 1, (scrolled, limit)
        groups.evaluate('el => { el.scrollTop = 0; el.blur(); }')
        bounded = 'bounded'
    sizes = {key: value['size'] for key, value in small_label_metrics(page).items() if value}
    # Metadata that carries a value (period, share, group count, event time) is
    # not set in fine print: the corrected floor is 11px. The KPI and severity
    # labels stay at 10px uppercase mono as the intentional densest step.
    corrected = {key: sizes[key] for key in ('widgetPeriod', 'stateShare', 'groupCount', 'logTime') if key in sizes}
    assert min(corrected.values()) >= 11, sizes
    return (f'chips={chips} availability={availability!r} note={note_text[:40]!r} '
            f'pillLabels={len(pills)} groups={total}/{bounded} kpi={kpi_label!r} sizes={sizes}')


def assert_empty(page, locale, width):
    expect(page.locator('.noc-kpis')).to_be_visible()
    # Labels resolved by the dashboard model must follow the active language,
    # not the language that happened to be active when it was first built.
    # A zero installation gets an explanation, not a zero-width bar with four
    # rows of "0 / 0 %" that read like a broken chart.
    distribution = page.locator('[data-od-id="dashboard-widget-distribution"]')
    assert distribution.locator('.noc-distribution').count() == 0, 'the empty state still paints a bar'
    empty_copy = distribution.locator('.noc-empty')
    expect(empty_copy).to_have_count(1)
    assert empty_copy.inner_text().strip() == COPY[locale]['distribution_empty'], empty_copy.inner_text()
    assert distribution.locator('.noc-state-row').count() == 0, 'zero rows are still painted'
    empty_metric = page.locator('[data-od-id="kpi-availability"] strong').inner_text().strip()
    assert empty_metric == '—', empty_metric
    activity = page.locator('[data-od-id="dashboard-widget-activity"] .noc-empty').inner_text().strip()
    assert activity == COPY[locale]['activity_empty'], activity
    for widget in ('alerts', 'infrastructure', 'maintenance'):
        locator = page.locator(f'[data-od-id="dashboard-widget-{widget}"]')
        if locator.count():
            expect(locator.locator('.noc-empty').first).to_be_visible()
    severities = [t.strip() for t in page.locator(
        '[data-od-id="dashboard-widget-alerts"] .noc-severity a > span').all_inner_texts()]
    assert severities == SEVERITY_LABELS[locale], severities
    return f'widgets={page.locator(".noc-widget").count()} emptyNotes={page.locator(".noc .noc-empty").count()}'


def assert_error(page, locale, width):
    expect(page.locator('.noc-error')).to_be_visible()
    error = page.locator('.noc-error').first.inner_text()
    assert COPY[locale]['error'] in error, error
    expect(page.get_by_role('button', name=COPY[locale]['retry'])).to_be_visible()
    assert page.locator('.noc-kpis').count() == 0, 'a failed first read paints no operational values'
    return f'errorCopy={error.splitlines()[-1][:70]!r}'


def assert_loading(page, locale, width):
    loading = page.locator('.noc-loading')
    expect(loading).to_be_visible()
    assert loading.inner_text().strip() == COPY[locale]['loading'], loading.inner_text()
    expect(loading).to_have_attribute('role', 'status')
    return 'pendingRead=1'


def serve_dashboard(page, status, body):
    for pattern in ('**/api/v1/dashboard?*', '**/api/v1/dashboard'):
        page.route(pattern, lambda route: route.fulfill(
            status=status, content_type='application/json', body=body))


def hold_dashboard(page):
    for pattern in ('**/api/v1/dashboard?*', '**/api/v1/dashboard'):
        page.route(pattern, lambda route: None)


def release_dashboard(page):
    for pattern in ('**/api/v1/dashboard?*', '**/api/v1/dashboard'):
        page.unroute(pattern)


def keyboard_ring_sweep(page, stops=14):
    """No keyboard stop in the dashboard is left without a visible ring."""
    page.locator('#dashboard-title').click()
    page.keyboard.press('Escape')
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    checked, missing = [], []
    for _ in range(stops):
        page.keyboard.press('Tab')
        info = page.evaluate(
            """() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                const style = getComputedStyle(el);
                const ring = parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none';
                return { tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40), ring };
            }"""
        )
        if not info:
            continue
        checked.append(info)
        if not info['ring']:
            missing.append(info)
    assert not missing, missing
    return f'keyboardStops={len(checked)}'


def run_marked(page, base, shots):
    rows = []
    requests: list[str] = []
    page.on('request', lambda request: requests.append(request.url) if '/api/v1/dashboard' in request.url else None)
    state_writes: list[str] = []
    page.on('request', lambda request: state_writes.append(request.url)
            if request.url.endswith('/api/v1/workspace/state') and request.method == 'PUT' else None)
    fixture.login(page, base, 'demo.owner', fixture.DEMO_PASSWORD)
    page.goto(base + '/#/panel', wait_until='networkidle')
    wait_mounted(page)
    expect(page.locator('[data-v-app] #dashboard-title')).to_be_visible()
    expect(page.locator('[data-od-id="dashboard-quick-actions"]')).to_have_count(0)
    assert page.evaluate('location.hash') == '#/panel', page.evaluate('location.hash')
    baseline, meta = report_count(page)
    print(f'OBSERVED marked rows painted by the report panel: {baseline} meta={meta!r}')
    payload = page.evaluate(
        """async () => {
            const response = await fetch('/api/v1/dashboard?period=24h', {credentials: 'same-origin'});
            const body = await response.json();
            return {
                status: response.status,
                stats: body.stats,
                availability: body.availability,
                latency: body.latency,
                rows: (body.rows || []).length,
                distribution: body.distribution,
                byCategory: body.byCategory,
                warrantyDays: (body.warranties || []).map(row => [row.assetId, row.days, row.until]),
                alertSeverity: (body.activeAlerts || []).map(alert => [alert.id, alert.severity, alert.assetId]),
                rowIds: (body.rows || []).map(row => row.assetId),
            };
        }"""
    )
    print('OBSERVED dashboard payload: ' + json.dumps(payload, ensure_ascii=False)[:900])
    print('OBSERVED keyboard rings: ' + keyboard_ring_sweep(page))

    # 1. Populated dashboard: every locale, theme and viewport.
    for width, _height in WIDTHS:
        for theme in THEMES:
            for locale in LOCALES:
                rows.append(cell(page, shots, 'marked', 'populated', locale, width, theme,
                                 f'rows={baseline}',
                                 lambda: assert_populated(page, locale, width)))

    # 2. Reports panel: open, real CSV download, close.
    for locale, theme, width in (('es', 'light', 1440), ('en', 'dark', 390)):
        set_locale(page, locale)
        fixture.set_theme(page, theme)
        page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
        button = page.locator('[data-od-id="dashboard-reports"]')
        button.click()
        panel = page.locator('[data-od-id="dashboard-report-panel"]')
        expect(panel).to_be_visible()
        assert button.get_attribute('aria-expanded') == 'true'
        rows.append(cell(page, shots, 'marked', 'reports-open', locale, width, theme, 'panel=open'))
        if locale == 'es':
            with page.expect_download() as download_info:
                page.get_by_role('button', name=COPY['es']['download']).click()
            download = download_info.value
            target = shots / 'operational-report-es.csv'
            download.save_as(str(target))
            csv = target.read_text(encoding='utf-8-sig').splitlines()
            assert download.suggested_filename == COPY['es']['download_filename'], download.suggested_filename
            assert csv[0].startswith('"Activo";"Código";"Estado operativo"'), csv[0]
            assert len(csv) - 1 == baseline, (len(csv) - 1, baseline)
            print(f'OBSERVED csv name={download.suggested_filename} header={csv[0][:72]!r} rows={len(csv) - 1}')
        button.click()
        expect(panel).to_have_count(0)
        assert button.get_attribute('aria-expanded') == 'false'
    print('OBSERVED reports panel closes: aria-expanded=false, panel absent')

    # 3. Filters: a real read per change and a painted subset.
    for locale, theme, width, kind in (('es', 'light', 1440, 'site'),
                                       ('es', 'dark', 390, 'category'),
                                       ('en', 'dark', 1440, 'period')):
        set_locale(page, locale)
        fixture.set_theme(page, theme)
        page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
        if kind == 'period':
            start = len(requests)
            page.locator('[data-od-id="dashboard-period-7d"]').click()
            request_wait(page, requests, 'period=7d', start)
            expect(page.locator('[data-od-id="dashboard-period-7d"]')).to_have_attribute('aria-pressed', 'true')
            chip = page.locator('[data-od-id="dashboard-widget-activity"] .noc-widget-period').inner_text().strip()
            kpi = page.locator('[data-od-id="kpi-availability"] > span').inner_text().strip()
            _, period_meta = report_count(page)
            # Chip, KPI and report bar all name the period the same way.
            expected = COPY[locale]['period']['7d']
            assert chip == expected, (locale, chip, expected)
            # The KPI label is uppercased by CSS; compare the painted words.
            assert expected.lower() in kpi.lower(), (locale, kpi)
            assert expected in period_meta and '7d' not in period_meta, (locale, period_meta)
            print(f'OBSERVED period labels after 7d change: chip={chip!r} kpi={kpi!r} meta={period_meta!r}')
            rows.append(cell(page, shots, 'marked', 'filter-period-7d', locale, width, theme,
                             f'server read period=7d chip={chip!r}'))
            start = len(requests)
            page.locator('[data-od-id="dashboard-period-24h"]').click()
            request_wait(page, requests, 'period=24h', start)
            continue
        select = page.locator(f'[data-od-id="dashboard-{kind}-filter"]')
        options = select.locator('option')
        texts = [options.nth(index).inner_text().strip() for index in range(options.count())]
        values = [options.nth(index).get_attribute('value') for index in range(options.count())]
        print(f'OBSERVED {kind} filter options: {list(zip(values, texts))}')
        print('OBSERVED categories the service groups by: '
              f'{[group["id"] for group in payload["byCategory"]]}')
        # The control must offer what the service can filter by: directory sites
        # for the site select, the canonical catalogue for the category select.
        assert len(texts) > 1, (kind, texts)
        if kind == 'category':
            # Options come from the canonical catalogue, not the prototype list.
            catalog_ids = page.evaluate(
                """async () => {
                    const response = await fetch('/api/v1/inventory/config', {credentials: 'same-origin'});
                    const data = await response.json();
                    return (data.categories || []).map(item => item.id);
                }""")
            assert set(values) <= {'', *catalog_ids}, (values, catalog_ids)
            assert set(values) & set(catalog_ids), (values, catalog_ids)
        chosen_index = 1
        if kind == 'category':
            groups_order = [group['id'] for group in payload['byCategory']]
            chosen_index = values.index(groups_order[0])
        chosen = texts[chosen_index]
        start = len(requests)
        select.select_option(index=chosen_index)
        request_wait(page, requests, 'siteId=' if kind == 'site' else 'category=', start)
        filtered, filtered_meta = report_count(page)
        # A filter whose value the service knows narrows the painted rows instead
        # of emptying every widget.
        assert 0 < filtered <= baseline, (kind, chosen, filtered, baseline)
        rows.append(cell(page, shots, 'marked', f'filter-{kind}', locale, width, theme,
                         f'value={chosen!r} rows={filtered}/{baseline} meta={filtered_meta!r}'))
        expect(page.get_by_role('button', name=COPY[locale]['clear'])).to_be_visible()
        start = len(requests)
        page.get_by_role('button', name=COPY[locale]['clear']).click()
        request_wait(page, requests, 'period=24h', start)
        expect(page.get_by_role('button', name=COPY[locale]['clear'])).to_have_count(0)
        restored, _ = report_count(page)
        assert restored == baseline, (restored, baseline)
        print(f'OBSERVED {kind} filter: {chosen!r} -> {filtered} of {baseline} rows, clear restores')
    print(f'OBSERVED filters: site/category/period re-read from the service; clear restores {baseline} rows')

    def click_period(target):
        button = page.locator(f'[data-od-id="dashboard-period-{target}"]')
        if button.get_attribute('aria-pressed') != 'true':
            button.click()

    # 4. Loading: a pending read paints the loading state, not stale numbers.
    for locale, theme, width in (('es', 'light', 1440), ('en', 'dark', 390)):
        # Paint the locale first: the panel stores the translated failure text,
        # so a language switch after the failed read would not retranslate it.
        fixture.set_theme(page, theme)
        set_locale(page, locale)
        click_period('24h')
        expect(page.locator('.noc-kpis')).to_be_visible()
        hold_dashboard(page)
        page.locator('[data-od-id="dashboard-period-7d"]').click()
        expect(page.locator('.noc-loading')).to_be_visible()
        rows.append(cell(page, shots, 'marked', 'loading', locale, width, theme, 'held read',
                         lambda: assert_loading(page, locale, width)))
        release_dashboard(page)
        click_period('24h')
        expect(page.locator('.noc-kpis')).to_be_visible()

    # 5. Failed read, then recovery through the visible retry control. A failed
    # read drops the loaded summary (phase10 loadDashboard contract), so the
    # page-level error state is the honest state; the inline "stale" branch in
    # panel.js is unreachable while that contract stands.
    for locale, theme, width in (('es', 'light', 1440), ('en', 'dark', 390)):
        fixture.set_theme(page, theme)
        set_locale(page, locale)
        serve_dashboard(page, 503, '{"detail":"Dashboard temporarily unavailable"}')
        page.locator('[data-od-id="dashboard-period-7d"]').click()
        expect(page.locator('.noc-error')).to_be_visible()
        rows.append(cell(page, shots, 'marked', 'error', locale, width, theme, 'http503',
                         lambda: assert_error(page, locale, width)))
        print(f'OBSERVED failed refresh ({locale}): inlineStaleBranch='
              f'{page.locator(".noc-error--inline").count()} kpisKept={page.locator(".noc-kpis").count()}')
        release_dashboard(page)
        page.get_by_role('button', name=COPY[locale]['retry']).click()
        expect(page.locator('.noc-kpis')).to_be_visible()
        expect(page.locator('.noc-error')).to_have_count(0)
        click_period('24h')
        print(f'OBSERVED retry ({locale}) recovers the painted dashboard')

    # 7. Dashboard preferences: reversible, persisted, canonical data untouched.
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    customize = page.locator('[data-od-id="dashboard-customize"]')
    customize.click()
    panel = page.locator('[data-od-id="dashboard-preferences"]')
    ensure_preferences(page, True)
    assert customize.get_attribute('aria-expanded') == 'true'
    order = [t.strip() for t in panel.locator('.noc-layout-list li b').all_inner_texts()]
    assert len(order) == 8, order
    rows.append(cell(page, shots, 'marked', 'preferences-open', 'es', 1440, 'light',
                     f'widgets={len(order)} first={order[0]!r}'))
    rows.append(cell(page, shots, 'marked', 'preferences-open', 'en', 390, 'dark', 'narrow settings list'))
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    order_ids = [item.get_attribute('data-od-id').replace('dashboard-preference-', '')
                 for item in panel.locator('.noc-layout-list li').all()]
    first_id = order_ids[0]
    before_writes = len(state_writes)
    panel.locator(f'[data-od-id="dashboard-preference-{first_id}"] .noc-layout-actions button').nth(1).click()
    expect(panel.locator('.noc-layout-list li b').first).to_have_text(order[1])
    page.wait_for_timeout(900)
    print(f'OBSERVED workspace writes for one "move down": {len(state_writes) - before_writes}')
    assert len(state_writes) - before_writes >= 1, 'the layout change was not persisted'
    expect(page.locator('.noc-grid > section').first).to_have_attribute('data-od-id', 'dashboard-widget-alerts')
    stored = saved_widgets(page)
    print(f'OBSERVED workspace state after moving the first widget down: {stored}')
    assert stored and stored[0] == 'alerts', stored
    ensure_preferences(page, True)
    before_writes = len(state_writes)
    panel.locator(f'[data-od-id="dashboard-preference-{first_id}"] .noc-layout-actions button').nth(2).click()
    expect(page.locator(f'[data-od-id="dashboard-preference-{first_id}"]')).to_have_count(0)
    page.wait_for_timeout(900)
    print(f'OBSERVED workspace writes for one "hide": {len(state_writes) - before_writes}')
    assert len(state_writes) - before_writes >= 1, 'hiding a widget was not persisted'
    rows.append(cell(page, shots, 'marked', 'preferences-hidden', 'es', 1440, 'light', f'hidden={first_id}'))
    stored_hidden = saved_widgets(page)
    assert stored_hidden and first_id not in stored_hidden, (first_id, stored_hidden)
    print(f'OBSERVED workspace state after hiding {first_id}: {stored_hidden}')
    page.locator('[data-od-id="dashboard-reset-layout"]').click()
    expect(page.locator('.noc-layout-list li b').first).to_have_text(order[0])
    expect(page.locator(f'[data-od-id="dashboard-preference-{first_id}"]')).to_have_count(1)
    page.wait_for_timeout(600)
    # `availability` is back in the saved layout but has no server samples in
    # this fixture, so the first painted widget is the first available one.
    expect(page.locator('.noc-grid > section').first).to_have_attribute(
        'data-od-id', 'dashboard-widget-alerts')
    restored_layout = saved_widgets(page)
    print(f'OBSERVED workspace state after restoring the default layout: {restored_layout}')
    assert restored_layout and restored_layout[:8] == [
        'availability', 'alerts', 'distribution', 'infrastructure', 'activity',
        'maintenance', 'warranties', 'inventory'], restored_layout
    ensure_preferences(page, True)
    hidden = page.locator('.noc-hidden-widgets article')
    assert hidden.count() >= 1, 'the catalogue keeps widgets that are not in the layout'
    temporary_button = page.get_by_role('button', name=re.compile('^Solo temporalmente$')).first
    widget_label = temporary_button.locator('xpath=../div/b').inner_text().strip()
    temporary_button.click()
    note = page.locator('.noc-temporary')
    expect(note).to_be_visible()
    assert COPY['es']['temporary'] in note.inner_text(), note.inner_text()
    rows.append(cell(page, shots, 'marked', 'preferences-temporary', 'es', 1440, 'light',
                     f'temporary={widget_label!r}'))
    page.get_by_role('button', name=re.compile('^Finalizar vista temporal$')).click()
    expect(page.locator('.noc-temporary')).to_have_count(0)
    rows.append(cell(page, shots, 'marked', 'preferences-restored', 'es', 1440, 'light', 'layout=default'))
    print('OBSERVED temporary widget preview ends without changing the saved layout')

    # 8. The same preferences inside Configuración › General.
    page.wait_for_timeout(1500)
    page.goto(base + '/#/configuracion/general', wait_until='networkidle')
    settle(page)
    assert page.evaluate('location.hash') == '#/configuracion/general', page.evaluate('location.hash')
    expect(page.locator('[data-od-id="dashboard-preferences"]')).to_be_visible()
    expect(page.locator('[data-od-id="dashboard-custom-links"]')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'general-preferences', 'es', 1440, 'light', 'config=general'))
    rows.append(cell(page, shots, 'marked', 'general-preferences', 'en', 390, 'dark', 'config=general'))
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('[data-od-id="dashboard-add-link"]').click()
    form = page.locator('[data-od-id="dashboard-link-form"]')
    expect(form).to_be_visible()
    form.get_by_label('Nombre').fill('Consola interna')
    form.get_by_label('Dirección').fill('ftp://no-permitido')
    form.get_by_role('button', name='Guardar acceso').click()
    error = page.locator('[data-od-id="dashboard-custom-links"] .form-error')
    expect(error).to_be_visible()
    assert error.get_attribute('role') == 'alert'
    # The band is only helpful if the field it rejects is the field it describes.
    address = form.get_by_label('Dirección')
    assert address.get_attribute('aria-invalid') == 'true', 'the rejected address is not marked invalid'
    described_by = address.get_attribute('aria-describedby')
    assert described_by == 'dashboard-link-error', described_by
    assert page.locator('#' + described_by).inner_text().strip() == error.inner_text().strip()
    print('OBSERVED tools form: address aria-invalid=true describedby=dashboard-link-error')
    rows.append(cell(page, shots, 'marked', 'general-link-invalid', 'es', 1440, 'light',
                     f'validation={error.inner_text()!r}'))
    form.get_by_role('button', name='Cancelar').click()
    expect(form).to_have_count(0)
    print('OBSERVED shortcut form rejects a non-http address and keeps no link')
    fixture.logout(page)
    return rows


def run_ordinary(page, base, shots):
    rows = []
    fixture.login(page, base, 'ordinary.admin', fixture.DEMO_PASSWORD)
    page.goto(base + '/#/panel', wait_until='networkidle')
    wait_mounted(page)
    expect(page.locator('[data-v-app] #dashboard-title')).to_be_visible()
    for width, _height in WIDTHS:
        for theme in THEMES:
            locale = 'es' if theme == 'light' else 'en'
            rows.append(cell(page, shots, 'ordinary', 'empty', locale, width, theme,
                             'zero installation', lambda: assert_empty(page, locale, width)))
    set_locale(page, 'es')
    settle(page)
    page.wait_for_timeout(150)
    panel = page.locator('[data-od-id="dashboard-widget-distribution"]')
    if panel.count():
        body = panel.locator('.noc-widget-body').inner_text().strip()
        rows.append(cell(page, shots, 'ordinary', 'distribution-zero', 'es', 1440, 'light',
                         f'emptyCopy={body[:60]!r}'))
        print(f'OBSERVED zero distribution: paintedText={body[:80]!r}')
    # A saved widget whose server metric is missing: honest note, no zeros.
    page.locator('[data-od-id="dashboard-customize"]').click()
    expect(page.locator('[data-od-id="dashboard-preferences"]')).to_be_visible()
    # An empty installation legitimately keeps availability and latency in the
    # unavailable note; remember the baseline so reset can be compared to it.
    baseline_note = (page.locator('.noc-empty[role="status"]').first.inner_text().strip()
                     if page.locator('.noc-empty[role="status"]').count() else '')
    page.get_by_role('button', name=re.compile('^Añadir$')).first.click()
    page.wait_for_timeout(600)
    note = page.locator('.noc-empty[role="status"]')
    if note.count():
        text = note.first.inner_text().strip()
        assert 'Sin datos disponibles' in text, text
        rows.append(cell(page, shots, 'ordinary', 'unavailable-widget', 'es', 1440, 'light',
                         'server null metric'))
        print(f'OBSERVED unavailable widget note={text!r}')
    page.locator('[data-od-id="dashboard-reset-layout"]').click()
    page.wait_for_timeout(600)
    after_note = (page.locator('.noc-empty[role="status"]').first.inner_text().strip()
                  if page.locator('.noc-empty[role="status"]').count() else '')
    assert after_note == baseline_note, (baseline_note, after_note)
    print(f'OBSERVED reset removes the unavailable-widget note; '
          f'stored layout={saved_widgets(page)}')
    fixture.logout(page)
    return rows


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
                                  accept_downloads=True)
    errors = []
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        rows = run_marked(page, base, shots) if label == 'marked' else run_ordinary(page, base, shots)
        assert not errors, f'{label} page errors: {errors}'
        print(f'PAGEERRORS {label}: 0')
        return rows
    finally:
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
