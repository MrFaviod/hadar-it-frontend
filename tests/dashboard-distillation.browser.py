"""Operational dashboard presentation against a disposable installation."""
import importlib.util
import json
import re
from pathlib import Path
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('dashboard_fixture', Path(__file__).with_name('demo-indicator.browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')
# Service identifiers the dashboard model must resolve to shipped catalog copy.
MAINTENANCE = {
    'overdue': {'es': 'Vencido', 'en': 'Overdue', 'tone': 'status--down'},
    'upcoming': {'es': 'Próximos', 'en': 'Upcoming', 'tone': 'status--warn'},
    'pending': {'es': 'Pendiente', 'en': 'Pending', 'tone': 'status--hold'},
}
EMPTY_COPY = {
    'es': {'title': 'Panel', 'activity': 'Sin eventos de este tipo en el período seleccionado.', 'retry': 'Reintentar'},
    'en': {'title': 'Dashboard', 'activity': 'No events of this kind in the selected period.', 'retry': 'Retry'},
}
# A truthful empty installation: canonical zero aggregates and no rows.
EMPTY_SUMMARY = {
    'generatedAt': '2026-11-01T10:00:00Z',
    'stats': {'total': 0, 'monitored': 0, 'up': 0, 'degraded': 0, 'down': 0, 'unmonitored': 0, 'unknown': 0, 'criticalAlerts': 0, 'unacknowledged': 0, 'activeIncidents': 0},
    'availability': {'current': None, 'configured': False, 'samples': [], 'samplesCount': 0, 'lastCheckAt': ''},
    'latency': {'current': None},
    'distribution': [],
    'severity': [],
    'activeAlerts': [],
    'rows': [],
    'activity': [],
    'maintenance': [],
    'warranties': [],
    'inventory': {'total': 0, 'active': 0, 'unassigned': 0, 'attention': []},
    'incidents': [],
}
WIDTHS = [(1440, 1000), (390, 844)]
THEMES = ['light', 'dark']
LOCALES = ['es', 'en']


def set_locale(page, tag):
    # Both bundles are fetched once per document. `loadBundle` always issues a
    # request, so re-loading it for every matrix cell would trip the API rate
    # limit and leave the page in a retry loop instead of the state under test.
    page.evaluate(
        """async tag => {
            window.__distillationBundles = window.__distillationBundles || {};
            if (!window.__distillationBundles[tag]) {
                await window.ItsmI18n.loadBundle(tag);
                window.__distillationBundles[tag] = true;
            }
            window.ItsmI18n.setLocale(tag);
        }""",
        tag,
    )


def settle(page):
    page.wait_for_function("() => !document.querySelector('.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active')")


def matrix(page, label, state, shots, assert_screen):
    """Every rendered state is inspected in both locales, themes and widths."""
    for width, height in WIDTHS:
        page.set_viewport_size({'width': width, 'height': height})
        for theme in THEMES:
            fixture.set_theme(page, theme)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            for locale in LOCALES:
                set_locale(page, locale)
                expect(page.locator('#dashboard-title')).to_have_text(EMPTY_COPY[locale]['title'])
                # The screenshot is captured before the assertions so a failing
                # state still leaves the rendered evidence that explains it.
                page.screenshot(path=str(shots / f'dashboard-{label}-{state}-{locale}-{width}-{theme}.png'), full_page=True)
                assert_screen(page, locale, width)
                text = page.locator('.noc').inner_text()
                assert not RAW_KEY.search(text), (state, locale, RAW_KEY.search(text).group(0))


def assert_maintenance(page, locale, width):
    widget = page.locator('[data-od-id="dashboard-widget-maintenance"]')
    if widget.count() == 0:
        return 0
    rows = widget.locator('.noc-work')
    for index in range(rows.count()):
        row = rows.nth(index)
        state = row.get_attribute('data-status')
        if state in MAINTENANCE:
            pill = row.locator('.status-pill')
            expect(pill).to_have_text(MAINTENANCE[state][locale])
            classes = pill.get_attribute('class') or ''
            assert MAINTENANCE[state]['tone'] in classes, (state, classes)
    # Raw identifiers never reach the UI. Compare exactly: the English labels
    # capitalise the identifier ('Overdue'), so case-folding would flag correct copy.
    shown = [text.strip() for text in widget.locator('.status-pill').all_inner_texts()]
    assert not ({'overdue', 'upcoming', 'pending'} & set(shown)), shown
    # Every planning state the demo can emit has a localized label; a stray
    # value here means a pill kept another locale or a raw token.
    expected = {item[locale] for item in MAINTENANCE.values()}
    assert set(shown) <= expected, (locale, shown, sorted(expected))
    return rows.count()


def assert_infrastructure(page, locale, width):
    widget = page.locator('[data-od-id="dashboard-widget-infrastructure"]')
    if widget.count() == 0:
        return
    links = widget.locator('.noc-group')
    if links.count() == 0:
        # A zero installation keeps the panel but shows its own empty copy.
        expect(widget.locator('.noc-empty')).to_be_visible()
        return
    groups = widget.locator('[data-od-id="dashboard-groups"]')
    expect(groups).to_have_count(1)
    assert groups.get_attribute('tabindex') == '0', 'the bounded list is a keyboard stop'
    assert groups.get_attribute('aria-label'), 'the bounded list is named'
    total = links.count()
    metrics = groups.evaluate('el => ({ client: el.clientHeight, scroll: el.scrollHeight })')
    if width > 700 and total > 4:
        # A long category list is bounded: it scrolls inside the panel instead
        # of stretching its grid row, and every entry stays reachable.
        assert metrics['scroll'] > metrics['client'] + 1, metrics
        # Bounded to the visible rows plus the panel's own link, never the
        # full category list.
        assert widget.bounding_box()['height'] <= 480, widget.bounding_box()
        # A bounded list still leads to the complete breakdown.
        open_link = widget.locator('.noc-text-link')
        expect(open_link).to_be_visible()
        assert open_link.get_attribute('href') == '#/supervision', open_link.get_attribute('href')
        # Reset first: the matrix reuses one page, so a previous cell may have
        # left the list scrolled.
        groups.evaluate('el => { el.scrollTop = 0; }')
        groups.focus()
        assert groups.evaluate('el => document.activeElement === el')
        assert groups.evaluate('el => el.scrollTop') <= 1
        # The continuation link does not excuse the keyboard: the bounded list
        # itself must scroll by key and reach the last category.
        page.keyboard.press('End')
        page.wait_for_timeout(120)
        page.keyboard.press('End')
        page.wait_for_timeout(120)
        scrolled, limit = groups.evaluate('el => [el.scrollTop, el.scrollHeight - el.clientHeight]')
        assert scrolled > 0, 'a key scrolls the bounded list'
        assert scrolled >= limit - 1, (scrolled, limit)
        container = groups.bounding_box()
        last_label = links.last.locator('span').bounding_box() or links.last.bounding_box()
        assert last_label['y'] + last_label['height'] <= container['y'] + container['height'] + 1, (last_label, container)
        peak = groups.evaluate('el => el.scrollTop')
        page.keyboard.press('PageUp')
        page.wait_for_timeout(120)
        assert groups.evaluate('el => el.scrollTop') < peak, 'a key scrolls the bounded list back'
        # Leave the matrix in its natural state: the next locale switches on the
        # same page, and its screenshot should show the list from the top.
        groups.evaluate('el => { el.scrollTop = 0; el.blur(); }')
    else:
        assert metrics['scroll'] <= metrics['client'] + 1, metrics
    assert links.count() == total, 'bounded overflow never drops a category'


ENUMS = {
    # Known system enumerations. The dashboard service sends its own Spanish
    # display label beside each identifier, so these rows are the place where a
    # locale switch used to leave Spanish copy inside the English UI.
    'distribution': {
        'es': {'Disponibles', 'Degradados', 'Fuera de línea', 'Sin supervisión', 'Sin datos'},
        'en': {'Available', 'Degraded', 'Offline', 'Unmonitored', 'No data'},
    },
    'severity': {
        'es': {'Crítica', 'Alta', 'Media', 'Baja'},
        'en': {'Critical', 'High', 'Medium', 'Low'},
    },
}


def assert_enumerations(page, locale):
    """Known device states and severities follow the selected catalog."""
    rows = page.locator('[data-od-id="dashboard-widget-distribution"] .noc-state-row > span')
    labels = [text.strip() for text in rows.all_inner_texts()]
    other = 'en' if locale == 'es' else 'es'
    assert set(labels) <= ENUMS['distribution'][locale], (locale, labels)
    assert not (set(labels) & (ENUMS['distribution'][other] - ENUMS['distribution'][locale])), (locale, labels)
    chips = page.locator('[data-od-id="dashboard-widget-alerts"] .noc-severity a > span')
    severities = [text.strip() for text in chips.all_inner_texts()]
    assert set(severities) == ENUMS['severity'][locale], (locale, severities)


def assert_grid_rows(page, locale, width):
    """A short panel never fills the height of a taller neighbour with blank space.

    The reported defect was a stretched grid: a long list made its row tall and
    the shorter cards in that row grew into empty card interiors. The check is
    the painted gap between a panel's content and its own edge, so it holds for
    any neighbour mix instead of comparing unrelated panel heights.
    """
    if width <= 700:
        return
    assert page.eval_on_selector('.noc-grid', "el => getComputedStyle(el).alignItems") != 'stretch'
    panels = page.eval_on_selector_all(
        '.noc-widget',
        """els => els.map(el => {
            const head = el.querySelector('.noc-widget-head');
            const body = el.querySelector('.noc-widget-body');
            return {
                id: el.getAttribute('data-od-id'),
                gap: Math.round(el.clientHeight - (head ? head.offsetHeight : 0) - (body ? body.offsetHeight : 0)),
            };
        })""",
    )
    for panel in panels:
        assert panel['gap'] <= 12, panel


def populated(page, locale, width, plans):
    expect(page.locator('.noc-kpis')).to_be_visible()
    rows = assert_maintenance(page, locale, width)
    if plans:
        # The demo installation plans maintenance in known states, so the matrix
        # below proves their labels and tones instead of skipping every row.
        assert rows >= 3, 'demo maintenance plans render'
    else:
        # An ordinary installation has no plans, so nothing may be invented.
        assert rows == 0, rows
    assert_enumerations(page, locale)
    assert_infrastructure(page, locale, width)
    assert_grid_rows(page, locale, width)


def empty(page, locale, width):
    expect(page.locator('.noc-kpis')).to_be_visible()
    expect(page.locator('[data-od-id="dashboard-widget-activity"] .noc-empty')).to_have_text(EMPTY_COPY[locale]['activity'])
    assert_enumerations(page, locale)
    assert_maintenance(page, locale, width)


def error(page, locale, width):
    expect(page.locator('.noc-error')).to_be_visible()
    expect(page.get_by_role('button', name=EMPTY_COPY[locale]['retry'])).to_be_visible()


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        fixture.login(page, base, username, password)
        page.goto(base + '/#/panel', wait_until='networkidle')
        expect(page.locator('#dashboard-title')).to_be_visible()
        settle(page)
        expect(page.locator('[data-od-id="dashboard-quick-actions"]')).to_have_count(0)
        expect(page.locator('.noc-widget-head p')).to_have_count(0)
        expect(page.locator('.noc-footer')).to_have_count(0)
        expect(page.locator('[data-od-id="dashboard-reports"]')).to_be_visible()
        heading = page.locator('#dashboard-title').bounding_box()
        actions = page.locator('.noc-header-actions').bounding_box()
        assert abs(heading['y'] - actions['y']) < 20, (heading, actions)
        page.locator('[data-od-id="dashboard-reports"]').click()
        expect(page.locator('[data-od-id="dashboard-report-panel"]')).to_be_visible()
        page.locator('[data-od-id="dashboard-reports"]').click()
        matrix(page, label, 'populated', shots, lambda p, l, w: populated(p, l, w, label == 'marked'))

        # A canonical zero installation shows honest empty copy, not invented data.
        page.route('**/api/v1/dashboard?*', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(EMPTY_SUMMARY)))
        page.route('**/api/v1/dashboard', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(EMPTY_SUMMARY)))
        page.reload(wait_until='networkidle')
        settle(page)
        matrix(page, label, 'empty', shots, empty)

        # A failed read must expose retry instead of fabricated operational values.
        page.route('**/api/v1/dashboard?*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"detail":"Dashboard temporarily unavailable"}'))
        page.route('**/api/v1/dashboard', lambda route: route.fulfill(status=503, content_type='application/json', body='{"detail":"Dashboard temporarily unavailable"}'))
        page.reload(wait_until='networkidle')
        settle(page)
        matrix(page, label, 'error', shots, error)

        page.unroute('**/api/v1/dashboard?*')
        page.unroute('**/api/v1/dashboard')
        # Recovery is proven by the painted dashboard, not by network idleness:
        # a transient retry keeps connections open after the data is back.
        page.reload()
        expect(page.locator('.noc-kpis')).to_be_visible()
        expect(page.locator('.noc-error')).to_have_count(0)
        settle(page)
        expect(page.locator('.noc-widget').first).to_be_visible()
        assert not errors, errors
        page.evaluate("async () => { await window.ItsmI18n.loadBundle('es'); window.ItsmI18n.setLocale('es'); }")
        expect(page.locator('#dashboard-title')).to_have_text('Panel')
        fixture.logout(page)
        return [label]
    finally:
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
