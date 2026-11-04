"""U3: individual visual pass over the inventory surface.

Covers the inventory list (table and cards), search/category/status/columns
controls, the saved-view shortcuts, the empty/no-results/loading/error states,
the asset detail page and the asset editor plus lifecycle dialogs, and the real pager on a
seeded isolated installation.

Reuses ``demo-indicator.browser.py`` exactly like ``ui-access-visual.browser.py``
and ``ui-dashboard-visual.browser.py``: two sequential scenarios, each with its
own disposable backend and loopback API/Vite pair.

* ``marked``   -- demo installation (14 fictional assets, two sites, catalog
                  categories/statuses, saved-view and workspace state).
* ``ordinary`` -- migrations plus ``bootstrap-superadmin``: genuinely empty
                  installation, so the empty inventory is served by the API.

Every rendered state is captured as its own PNG (route, state, locale, theme and
viewport in the file name) so a human can open one image at a time. Dialogs are
opened and cancelled; no asset, lifecycle or catalog write is confirmed.
Nothing here touches an existing installation, Docker service, device or
provider.

Run: cd frontend && python3 tests/ui-inventory-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import re
import time
from pathlib import Path

from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    'inventory_fixture', Path(__file__).with_name('demo-indicator.browser.py')
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')

# Representative matrix: both locales, both themes and both widths are covered
# without paying for the full cartesian product.
# Representative, not a Cartesian product: two desktop, two phone, plus the two
# intermediate widths where the stacked table changes shape.
COMBOS = [
    ('es', 1440, 'light'),
    ('en', 1440, 'dark'),
    ('es', 768, 'light'),
    ('en', 640, 'dark'),
    ('es', 390, 'dark'),
    ('en', 390, 'light'),
]

COPY = {
    'es': {
        'inventory': 'Inventario de activos',
        'table': 'Tabla',
        'cards': 'Tarjetas',
        'columns': 'Columnas',
        'remote': 'Acceso remoto',
        'all': 'Todos los estados',
        'results': r'\d+ activos? en el servidor',
        'clear': 'Limpiar filtros',
        'empty_title': 'El inventario está vacío',
        'empty_filtered_title': 'No hay activos con estos filtros',
        'error_title': 'No se pudo cargar el inventario',
        'retry': 'Reintentar',
        'loading': 'Consultando el inventario del servidor…',
        'saved_views': 'Vistas guardadas',
        'save_view': 'Guardar vista',
        'detail_back': 'Volver al inventario',
    },
    'en': {
        'inventory': 'Asset inventory',
        'table': 'Table',
        'cards': 'Cards',
        'columns': 'Columns',
        'remote': 'Remote access',
        'all': 'All statuses',
        'results': r'\d+ assets? on the server',
        'clear': 'Clear filters',
        'empty_title': 'The inventory is empty',
        'empty_filtered_title': 'No assets match these filters',
        'error_title': 'Unable to load the inventory',
        'retry': 'Retry',
        'loading': 'Loading the server inventory…',
        'saved_views': 'Saved views',
        'save_view': 'Save view',
        'detail_back': 'Back to the inventory',
    },
}


def set_locale(page, tag):
    # Both bundles load once per document; reloading them for every matrix cell
    # trips the demo request budget and leaves the page retrying.
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


def cell(page, shots, label, state, locale, width, theme, note, assertions=None, rows=False):
    """Capture one cell, then assert. The image survives a failing assertion.

    A 5813px tall narrow page cannot be inspected after downscaling, so narrow
    viewports are captured as viewport images (top, and the list when useful)
    instead of one full-page montage.
    """
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)
    base = f'{label}-{state}-{locale}-{width}-{theme}'
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(60)
    if width > 700:
        path = shots / f'{base}.png'
        page.screenshot(path=str(path), full_page=True)
    else:
        path = shots / f'{base}-top.png'
        page.screenshot(path=str(path), full_page=False)
        if rows:
            page.evaluate("() => document.querySelector('.results-surface, .cards-grid, .empty-state')"
                          ".scrollIntoView({block: 'start'})")
            page.wait_for_timeout(90)
            page.screenshot(path=str(shots / f'{base}-rows.png'), full_page=False)
    detail = assertions() if assertions else ''
    leaked = RAW_KEY.search(visible_main(page))
    assert not leaked, (state, locale, leaked.group(0))
    overflow = page.evaluate('document.documentElement.scrollWidth - innerWidth')
    assert overflow <= 1, (state, locale, width, overflow)
    row = (f'SHOT {label} {state} {locale} {width}x{"844" if width < 700 else "1000"} {theme} '
           f'route={page.evaluate("location.hash")} file={path} note={note} {detail}')
    print(row)
    return row


def goto_hash(page, target):
    """In-app navigation keeps the shell mounted instead of paying a boot."""
    page.evaluate("hash => { if (location.hash !== hash) location.hash = hash; }", target)
    page.wait_for_function("hash => location.hash === hash", arg=target)
    settle(page)


SEARCH_URLS = {}


def network_search_urls(page):
    """Search URLs in request order, recorded from the network layer."""
    return list(SEARCH_URLS.get(id(page), ()))


def inventory_requests(page, needle='api/v1/assets'):
    return [url for url in page.evaluate('() => performance.getEntriesByType("resource").map(e => e.name)')
            if needle in url]


def wait_results(page):
    """A filter change paints the busy surface, so settle on that first."""
    page.wait_for_timeout(250)
    page.wait_for_function("() => !document.querySelector('.results-surface[aria-busy=\"true\"]')")
    page.wait_for_timeout(250)


def wait_inventory(page, locale):
    """Wait for the painted list, empty or error surface, not a spinner alone."""
    page.wait_for_function(
        """() => !!document.querySelector('.asset-table, .cards-grid, .empty-state')""",
        timeout=30000,
    )


def micro_metrics(page):
    """Computed sizes of the dense inventory labels, measured on the page."""
    return page.evaluate(
        """() => {
            const pick = (selector, pseudo) => {
                const el = document.querySelector(selector);
                if (!el || !el.getClientRects().length) return null;
                const style = getComputedStyle(el, pseudo || null);
                return { size: parseFloat(style.fontSize), content: style.content, color: style.color };
            };
            const firstCell = document.querySelector('.asset-table tbody td:first-child');
            const labels = firstCell ? getComputedStyle(firstCell, '::before') : null;
            return {
                th: pick('.asset-table th'),
                code: pick('.asset-code'),
                note: pick('.cell-note'),
                muted: pick('.cell-muted'),
                typeTag: pick('.asset-table .type-tag'),
                viewSwitch: pick('.view-switch button'),
                categoryChip: pick('.chip'),
                cardCategory: pick('.asset-card__category'),
                cardStatus: pick('.asset-card__status'),
                cardTitle: pick('.asset-card__title h2'),
                stackedLabel: labels ? { size: parseFloat(labels.fontSize), content: labels.content } : null,
            };
        }"""
    )


def table_column_count(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.asset-table thead th'))
            .map(th => th.textContent.trim())"""
    )


MICRO_FLOOR = 11.0


def column_picker_check(page):
    """The picker must name the columns the table paints, and nothing else."""
    remote = page.locator('.inventory-columns input[value="remote"]').count()
    assert remote == 0, 'the column picker still offers a column no row renders'
    labels = page.locator('.inventory-columns > div label').all_inner_texts()
    labels = [label.strip().upper() for label in labels]
    headers = [text.strip().upper() for text in table_column_count(page)]
    assert labels == headers[1:], (labels, headers)
    assert len(labels) == 4, labels
    return headers, labels


def type_floor(page, selectors):
    """Nothing in the dense inventory labelling may drop under the 11px floor."""
    measured = page.evaluate(
        """(selectors) => selectors.map(sel => {
            const el = document.querySelector(sel);
            if (!el || !el.getClientRects().length) return null;
            return { sel, size: parseFloat(getComputedStyle(el).fontSize) };
        })""",
        selectors,
    )
    small = [item for item in measured if item and item['size'] < MICRO_FLOOR]
    assert not small, small
    return [item for item in measured if item]


def stacked_labels(page):
    """Locale-independent stacked cards: no first-cell label, real labels after."""
    first = page.evaluate(
        """() => {
            const cell = document.querySelector('.asset-table tbody td:first-child');
            if (!cell) return null;
            const style = getComputedStyle(cell, '::before');
            return {
                content: style.content,
                display: style.display,
                size: parseFloat(style.fontSize),
            };
        }"""
    )
    assert first is not None, 'no stacked row to inspect'
    assert first['display'] == 'none', first
    size = page.evaluate(
        """() => {
            const cell = document.querySelector('.asset-table tbody td:nth-child(2)');
            if (!cell) return null;
            const style = getComputedStyle(cell, '::before');
            return { content: style.content, size: parseFloat(style.fontSize) };
        }"""
    )
    assert size and size['size'] >= MICRO_FLOOR, size
    return first, size


def code_not_clipped(page):
    """The permanent id has to stay readable, not silently cut at the cell edge."""
    boxes = page.evaluate(
        """() => Array.from(document.querySelectorAll('.asset-code')).slice(0, 4).map(el => ({
            text: el.innerText.replace(/\\s+/g, ' ').trim(),
            scroll: el.scrollWidth,
            client: el.clientWidth,
            whiteSpace: getComputedStyle(el).whiteSpace,
        }))"""
    )
    assert boxes, 'no asset code painted'
    clipped = [box for box in boxes if box['client'] and box['scroll'] > box['client'] + 1]
    assert not clipped, clipped
    return boxes[0]


def badge_state(page):
    """The shell counter is the inventory size, so an active filter hides it."""
    badge = page.locator('a[href="#/inventario"] .nav-link__count')
    return badge.count(), (badge.first.inner_text().strip() if badge.count() else '')


def open_inventory(page, locale):
    expect(page.locator('#inventory-title')).to_be_visible()
    wait_inventory(page, locale)


def painted_contrast(page, selector):
    """Composited contrast of the painted text over its real background stack."""
    return page.evaluate("""(sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const parse = (value) => {
            const m = value.match(/rgba?\\(([^)]+)\\)/);
            if (!m) return null;
            const parts = m[1].split(',').map((v) => parseFloat(v));
            return {r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1};
        };
        const over = (fg, bg) => ({
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
            a: 1,
        });
        const lum = (c) => {
            const lin = (v) => {
                const u = v / 255;
                return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        };
        const fg = parse(getComputedStyle(el).color);
        const stack = [];
        let node = el;
        while (node && node.nodeType === 1) {
            const bg = parse(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0) {
                stack.push(bg);
                if (bg.a >= 1) break;
            }
            node = node.parentElement;
        }
        let base = {r: 255, g: 255, b: 255, a: 1};
        for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
        const solid = over(fg, base);
        const ratio = (Math.max(lum(solid), lum(base)) + 0.05) / (Math.min(lum(solid), lum(base)) + 0.05);
        return {
            ratio: Math.round(ratio * 100) / 100,
            color: getComputedStyle(el).color,
            background: getComputedStyle(el).backgroundColor,
            text: el.textContent.trim().slice(0, 24),
        };
    }""", selector)


def assert_table(page, locale, width):
    rows = page.locator('.asset-table tbody tr').count()
    assert rows > 0, 'populated installation painted no rows'
    assert page.locator('.cards-grid').count() == 0, 'cards painted while table view is active'
    results = page.locator('.results-bar p').first.inner_text().strip()
    assert re.search(COPY[locale]['results'], results), results
    floor = type_floor(page, ['.asset-table th', '.asset-table .type-tag', '.asset-code', '.cell-note'])
    detail = f'rows={rows} results={results!r} floors={[f["size"] for f in floor]}'
    code = code_not_clipped(page)
    detail += f' code={code["text"][-12:]!r}'
    if width > 900:
        contrast = painted_contrast(page, '.asset-table th')
        print(f'OBSERVED header contrast {locale}/{width}: {contrast}')
        assert contrast and contrast['ratio'] >= 4.5, f'table header contrast {contrast}'
        detail += f" headerContrast={contrast['ratio']}"
    if width <= 900:
        stacked_labels(page)
        detail += ' stacked=ok'
    return detail


def assert_cards(page, locale, width):
    cards = page.locator('.asset-card').count()
    assert cards > 0, 'cards view painted no cards'
    assert page.locator('.asset-table').count() == 0, 'table painted while cards view is active'
    floor = type_floor(page, ['.asset-card__category', '.asset-card__status', '.asset-card__title span'])
    title = page.locator('.asset-card__title h2').first
    clamp = title.evaluate('el => getComputedStyle(el).webkitLineClamp')
    assert clamp == '2', f'the card title clamps to {clamp!r} lines'
    return f'cards={cards} floors={[f["size"] for f in floor]} titleClamp={clamp}'


def assert_filtered_empty(page, locale, width):
    expect(page.locator('.empty-state')).to_be_visible()
    expect(page.locator('.empty-state h2')).to_have_text(COPY[locale]['empty_filtered_title'])
    expect(page.locator('.empty-state .btn')).to_be_visible()
    assert page.locator('.asset-table tbody tr').count() == 0, 'filtered rows still painted'
    clears = page.get_by_role('button', name=COPY[locale]['clear']).count()
    assert clears == 1, f'the filtered empty state offers {clears} clear actions'
    return f'filteredEmpty=1 clearButtons={clears}'


def assert_plain_empty(page, locale, width):
    expect(page.locator('.empty-state')).to_be_visible()
    expect(page.locator('.empty-state h2')).to_have_text(COPY[locale]['empty_title'])
    assert page.get_by_role('button', name=COPY[locale]['clear']).count() == 0, \
        'an unfiltered empty inventory still offers "clear filters"'
    return 'emptyInstallation=1'


def assert_error(page, locale, width):
    expect(page.locator('.empty-state[role="alert"]')).to_be_visible()
    expect(page.locator('.empty-state h2')).to_have_text(COPY[locale]['error_title'])
    expect(page.get_by_role('button', name=COPY[locale]['retry'])).to_be_visible()
    assert page.locator('.asset-table tbody tr').count() == 0, 'a failed read painted rows'
    assert page.locator('.results-bar').count() == 0, 'a failed read still reported a result count'
    return 'errorState=1 bars=0'


def assert_loading(page, locale, width):
    surface = page.locator('.results-surface[aria-busy="true"]')
    expect(surface).to_be_visible()
    assert COPY[locale]['loading'] in surface.inner_text(), surface.inner_text()
    expect(surface).to_have_attribute('role', 'status')
    skeletons = page.locator('.results-surface .skeleton-row').count()
    assert skeletons >= 3, 'the loading state painted no list skeleton'
    return f'pendingRead=1 skeletons={skeletons}'


def open_dialog(page, trigger):
    trigger.click()
    page.locator('.modal-layer .modal').wait_for(state='visible')


def cancel_dialog(page):
    page.locator('.modal-layer .modal__foot .btn').first.click()
    page.wait_for_function("() => !document.querySelector('.modal-layer')")
    settle(page)


def submit_dialog(page):
    page.locator('.modal-layer .modal__foot .btn--primary').first.click()


def click_refresh(page):
    """Refresh is disabled while a read is in flight; wait for a settled button."""
    wait_results(page)
    page.wait_for_function(
        "() => { const b = document.querySelector('[data-od-id=\"inventory-refresh\"]');"
        " return !!b && !b.disabled; }")
    page.locator('[data-od-id="inventory-refresh"]').click()


HELD_ROUTES = {}


def hold_inventory(page):
    """Leave the inventory read pending so the busy surface can be photographed.

    The handler parks the route object instead of returning an unresolved future:
    the parked route is continued on release, so nothing is cancelled mid-flight.
    """
    HELD_ROUTES[id(page)] = []

    def park(route):
        HELD_ROUTES[id(page)].append(route)

    page.route('**/api/v1/assets/search*', park)


def release_inventory(page):
    for route in HELD_ROUTES.pop(id(page), []):
        try:
            route.continue_()
        except Exception as error:  # noqa: BLE001 - a closed page no longer owns the route
            print(f'RELEASE route: {error}')
    page.unroute_all(behavior='ignoreErrors')


def serve_inventory_error(page):
    body = '{"detail":"inventory unavailable"}'
    for pattern in ('**/api/v1/assets/search*',):
        page.route(pattern, lambda route: route.fulfill(
            status=503, content_type='application/json', body=body))


def restore_table_view(page, locale):
    switch = page.locator('.view-switch button').first
    if switch.get_attribute('aria-pressed') != 'true':
        switch.click()
        settle(page)


def last_search_url(page):
    urls = network_search_urls(page) or [url for url in inventory_requests(page, 'api/v1/assets/search')]
    return urls[-1] if urls else ''


def reset_filters(page):
    clear = page.get_by_role('button', name=COPY['es']['clear'])
    if clear.count():
        clear.first.click()
        wait_results(page)
        page.wait_for_function("() => !!document.querySelector('.asset-table tbody tr')")
        settle(page)
    search = page.locator('#inventory-search')
    if search.input_value():
        search.fill('')
        settle(page)


def run_marked(page, base, shots):
    rows = []
    fixture.login(page, base, 'demo.owner', fixture.DEMO_PASSWORD)
    page.goto(base + '/#/inventario', wait_until='networkidle')
    wait_mounted(page)
    expect(page.locator('#inventory-title')).to_be_visible()
    wait_inventory(page, 'es')

    # --- table and cards -----------------------------------------------------
    for locale, width, theme in COMBOS:
        restore_table_view(page, locale)
        set_locale(page, locale)
        settle(page)
        rows.append(cell(page, shots, 'marked', 'table', locale, width, theme,
                         'populated table', lambda: assert_table(page, locale, width), rows=True))
    for locale, width, theme in COMBOS:
        page.locator('.view-switch button').nth(1).click()
        settle(page)
        rows.append(cell(page, shots, 'marked', 'cards', locale, width, theme,
                         'populated cards', lambda: assert_cards(page, locale, width), rows=True))
        page.locator('.view-switch button').first.click()
        settle(page)

    # --- pagination ----------------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    wait_results(page)
    bar = page.locator('.results-bar').first.inner_text().strip()
    nav = page.locator('.inventory-pagination').count()
    print(f'OBSERVED pagination: nav={nav} bar={bar!r} limit=25')
    if nav:
        rows.append(cell(page, shots, 'marked', 'pagination', 'es', 1440, 'light',
                         'first page with pagination',
                         lambda: f'pages={page.locator(".inventory-pagination").count()}'))
        page.locator('.inventory-pagination .btn').nth(1).click()
        wait_results(page)
        rows.append(cell(page, shots, 'marked', 'pagination-page2', 'es', 1440, 'light',
                         'second page'))
        page.locator('.inventory-pagination .btn').first.click()
        wait_results(page)
    else:
        print('OBSERVED pagination prerequisite: the pager renders only above PAGE_LIMIT (25) and '
              'the demo seeds 16; the harness seeds the isolated installation through the supported '
              'batch endpoint and exercises the real pager further below.')

    # --- shell counter -------------------------------------------------------
    badge = badge_state(page)
    assert badge[0] == 1 and badge[1].isdigit(), badge
    print(f'OBSERVED shell badge, no filter: shown={badge[0]} text={badge[1]!r}')

    # --- micro-label measurements -------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    metrics = micro_metrics(page)
    print(f'OBSERVED desktop metrics {metrics}')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    stacked = micro_metrics(page)
    print(f'OBSERVED mobile metrics {stacked}')

    # --- columns disclosure --------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    page.locator('.inventory-columns summary').click()
    expect(page.locator('.inventory-columns > div')).to_be_visible()
    headers, picker = column_picker_check(page)
    print(f'OBSERVED column picker: headers {headers} picker {picker}')
    rows.append(cell(page, shots, 'marked', 'columns-open', 'es', 1440, 'light',
                     f'picker={picker}'))
    page.locator('.inventory-columns summary').click()

    set_locale(page, 'en')
    page.set_viewport_size({'width': 390, 'height': 844})
    fixture.set_theme(page, 'light')
    settle(page)
    page.locator('.inventory-columns summary').click()
    expect(page.locator('.inventory-columns > div')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'columns-open', 'en', 390, 'light',
                     'mobile column disclosure'))
    page.locator('.inventory-columns summary').click()

    # --- filters ------------------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    category = page.locator('.category-rail .chip').nth(1)
    category_label = category.inner_text().strip()
    category.click()
    settle(page)
    wait_results(page)
    category_url = last_search_url(page)
    sent_category = parse_qs(urlparse(category_url).query).get('category', [''])[0]
    category_rows = page.locator('.asset-table tbody tr').count()
    print(f'OBSERVED category request: {category_url} rows={category_rows}')
    assert sent_category, f'the category filter issued no category parameter ({category_url})'
    assert sent_category.isascii() and sent_category == sent_category.lower(), (
        f'the category filter sent {sent_category!r} for {category_label!r} instead of the stored '
        'category id; the search route compares the raw column, so accented or renamed categories '
        'return no rows')
    assert category_rows > 0, (
        f'{category_label!r} is listed by the server catalog but the filtered list is empty '
        f'({category_url})')
    rows.append(cell(page, shots, 'marked', 'category-filter', 'es', 1440, 'light',
                     f'category={category_label!r}',
                     lambda: f'chips={page.locator(".category-rail .chip.is-active").count()}'))
    category = page.locator('.category-rail .chip').first
    category.click()
    settle(page)

    status = page.locator('#inventory-status-filter')
    options = status.locator('option').evaluate_all('nodes => nodes.map(n => n.textContent.trim())')
    print(f'OBSERVED status options {options}')
    status.select_option(index=2)
    settle(page)
    wait_results(page)
    print(f'OBSERVED status request: {last_search_url(page)}')
    assert badge_state(page)[0] == 0, 'the shell counter followed the filtered result count'
    print(f'OBSERVED shell badge, filtered: {badge_state(page)}')
    rows.append(cell(page, shots, 'marked', 'status-filter', 'es', 1440, 'light',
                     f'status={options[2]!r}',
                     lambda: f'rows={page.locator(".asset-table tbody tr").count()} badge=hidden'))
    chips = page.locator('.universal-filter-strip__chips button')
    chip_labels = [chips.nth(i).inner_text().strip() for i in range(chips.count())]
    print(f'OBSERVED status chip: {chip_labels}')
    assert chip_labels, 'the status filter painted no chip'
    chips.first.click()
    wait_results(page)
    cleared = page.locator('#inventory-status-filter').input_value()
    rows_cleared = page.locator('.asset-table tbody tr').count()
    print(f'OBSERVED status chip removal: select={cleared!r} rows={rows_cleared} '
          f'chips={chips.count()} badge={badge_state(page)}')
    assert cleared == 'all', 'removing the status chip left a hidden server filter'
    assert rows_cleared == 16, f'removing the status chip left {rows_cleared} rows'
    assert chips.count() == 0, 'the status chip survived its own removal'
    rows.append(cell(page, shots, 'marked', 'status-chip-removed', 'es', 1440, 'light',
                     f'rows={rows_cleared}'))

    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    search = page.locator('#inventory-search')
    search.fill('hiper')
    settle(page)
    wait_results(page)
    print(f'OBSERVED search request: {last_search_url(page)}')
    rows.append(cell(page, shots, 'marked', 'search-active', 'en', 1440, 'dark',
                     'search term with results',
                     lambda: f'rows={page.locator(".asset-table tbody tr").count()}'))
    search.fill('zzzz-no-match')
    settle(page)
    page.wait_for_timeout(300)
    page.wait_for_function("() => !!document.querySelector('.empty-state')")
    rows.append(cell(page, shots, 'marked', 'no-results', 'en', 1440, 'dark',
                     'search without matches', lambda: assert_filtered_empty(page, 'en', 1440)))

    set_locale(page, 'es')
    page.set_viewport_size({'width': 390, 'height': 844})
    fixture.set_theme(page, 'dark')
    settle(page)
    rows.append(cell(page, shots, 'marked', 'no-results', 'es', 390, 'dark',
                     'mobile filtered empty', lambda: assert_filtered_empty(page, 'es', 390), rows=True))
    reset_filters(page)

    # --- loading and error --------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    hold_inventory(page)
    click_refresh(page)
    page.wait_for_function("() => !!document.querySelector('.results-surface[aria-busy=\"true\"]')")
    rows.append(cell(page, shots, 'marked', 'loading', 'es', 1440, 'light',
                     'held inventory read', lambda: assert_loading(page, 'es', 1440)))
    release_inventory(page)
    page.wait_for_function("() => !document.querySelector('.results-surface[aria-busy=\"true\"]')")

    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    serve_inventory_error(page)
    click_refresh(page)
    page.wait_for_function("() => !!document.querySelector('.empty-state[role=\"alert\"]')")
    rows.append(cell(page, shots, 'marked', 'error', 'en', 390, 'dark',
                     '503 inventory read', lambda: assert_error(page, 'en', 390), rows=True))
    release_inventory(page)
    click_refresh(page)
    page.wait_for_function("() => !!document.querySelector('.asset-table')")

    # --- saved views --------------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    page.locator('[data-od-id="save-current-view"]').click()
    expect(page.locator('#saved-view-name')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'save-view-dialog', 'es', 1440, 'light',
                     'save dialog, cancelled'))
    page.locator('#saved-view-name').press('Escape')
    settle(page)
    page.locator('[data-od-id="open-saved-views"]').click()
    expect(page.locator('#workspace-views-panel')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'saved-views-panel', 'es', 1440, 'light',
                     'saved views popover'))
    page.locator('#workspace-views-panel').press('Escape')

    # A saved inventory view is meant to restore the filters the user had. Record
    # what actually survives the round trip.
    page.locator('#inventory-search').fill('hiper')
    wait_results(page)
    queried = inventory_requests(page, '/assets/search')
    chips = page.locator('.universal-filter-strip--inventory button').evaluate_all(
        'nodes => nodes.map(n => n.textContent.trim())')
    rows_hiper = page.locator('.asset-table tbody tr').count()
    print(f'OBSERVED search request {queried[-1] if queried else None} rows={rows_hiper}')
    print(f'OBSERVED inventory chips with an active toolbar filter {chips}')
    assert chips, 'no chip reported the active server filter'
    assert any('hiper' in chip for chip in chips), chips
    page.locator('[data-od-id="save-current-view"]').click()
    expect(page.locator('#saved-view-name')).to_be_visible()
    page.locator('#saved-view-name').fill('Hipervisor view')
    rows.append(cell(page, shots, 'marked', 'save-view-filled', 'es', 1440, 'light',
                     'save dialog with a name'))
    submit_dialog(page)
    page.wait_for_timeout(700)
    page.locator('#inventory-search').fill('')
    wait_results(page)
    rows_before = page.locator('.asset-table tbody tr').count()
    page.locator('[data-od-id="open-saved-views"]').click()
    expect(page.locator('#workspace-views-panel')).to_be_visible()
    saved = page.locator('#workspace-views-panel .workspace-view-item__open, '
                          '#workspace-views-panel li button').first
    print(f'OBSERVED saved view entries {page.locator("#workspace-views-panel li").count()}')
    saved.click()
    page.wait_for_timeout(900)
    restore_query = [u for u in inventory_requests(page, '/assets/search')]
    rows_after = page.locator('.asset-table tbody tr').count()
    search_value = page.locator('#inventory-search').input_value()
    chips_after = page.locator('.universal-filter-strip--inventory button').evaluate_all(
        'nodes => nodes.map(n => n.textContent.trim())')
    last_restore = restore_query[-1] if restore_query else ''
    print(f'OBSERVED restore: rowsBefore={rows_before} rowsAfter={rows_after} '
          f'searchField={search_value!r} chips={chips_after} lastRequest={last_restore}')
    assert search_value == 'hiper', f'the restored view left the search field {search_value!r}'
    assert 'query=hiper' in last_restore, f'the restored view issued {last_restore!r}'
    assert rows_after == rows_hiper, f'the restored view shows {rows_after} rows, not {rows_hiper}'
    assert any('hiper' in chip for chip in chips_after), chips_after
    rows.append(cell(page, shots, 'marked', 'restored-view', 'es', 1440, 'light',
                     f'restored view: search={search_value!r} rows={rows_after}'))
    # Removing the chip must clear the same filter the request used.
    page.locator('.universal-filter-strip--inventory button').first.click()
    wait_results(page)
    cleared_value = page.locator('#inventory-search').input_value()
    cleared_rows = page.locator('.asset-table tbody tr').count()
    cleared_chips = page.locator('.universal-filter-strip--inventory button').count()
    print(f'OBSERVED chip removal: search={cleared_value!r} rows={cleared_rows} chips={cleared_chips}')
    assert cleared_value == '', 'removing the chip left the search term in place'
    assert cleared_rows == rows_before, f'the list shows {cleared_rows} rows after clearing, not {rows_before}'
    assert cleared_chips == 0, f'{cleared_chips} chips survived the reset'

    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    page.locator('#inventory-status-filter').select_option(index=1)
    wait_results(page)
    rows.append(cell(page, shots, 'marked', 'status-filter', 'en', 390, 'dark',
                     'mobile status filter', rows=True))
    page.locator('#inventory-status-filter').select_option(index=0)
    wait_results(page)

    # --- sibling callers of the shared workspace filter state ----------------
    # The inventory snapshot, chip removal and reset now also write the canonical
    # filters. Bounded differential check: the other routes that share those
    # helpers must keep painting and must not issue an inventory search.
    for route, target in (('panel', '#/panel'), ('map', '#/infra/mapa'),
                          ('graph', '#/infra/grafo'), ('reports', '#/reportes')):
        before = len(inventory_requests(page, '/assets/search'))
        goto_hash(page, target)
        settle(page)
        heading = page.locator('h1:visible, h2:visible').first
        expect(heading).to_be_visible()
        strip = page.locator('.universal-filter-strip')
        if strip.count():
            reset = strip.locator('.text-button').first
            if reset.count():
                reset.click()
                settle(page)
        wait_results(page)
        after = len(inventory_requests(page, '/assets/search'))
        chips = page.locator('.universal-filter-strip__chips button').count()
        expect(page.locator('h1:visible, h2:visible').first).to_be_visible()
        print(f'OBSERVED sibling {route}: heading={heading.inner_text().strip()!r} '
              f'inventoryRequests={after - before} chipsAfterReset={chips}')
        assert chips == 0, f'{route} kept {chips} filter chips after reset'
    goto_hash(page, '#/inventario')
    settle(page)
    restore_table_view(page, 'es')
    wait_results(page)

    # --- detail ------------------------------------------------------------
    asset_id = page.locator('.asset-card').first.get_attribute('href') if page.locator(
        '.asset-card').count() else None
    first_link = page.locator('.asset-table tbody .asset-name').first
    href = first_link.get_attribute('href')
    assert href and href.startswith('#/activo/'), href
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    page.locator('.asset-table tbody .asset-name').first.click()
    settle(page)
    expect(page.locator('#detail-title')).to_be_visible()
    page.wait_for_function("() => !!document.querySelector('.info-panel')")
    rows.append(cell(page, shots, 'marked', 'detail', 'es', 1440, 'light',
                     'server asset record',
                     lambda: f'actions={page.locator(".detail-head__actions .btn").count()}'))
    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    rows.append(cell(page, shots, 'marked', 'detail', 'en', 390, 'dark',
                     'mobile server asset record'))
    history = page.locator('#server-history-title').first.inner_text().strip()
    assert 'servidor' not in history.lower() and 'server' not in history.lower(), history
    affordances = page.locator('.detail-head__actions .btn').evaluate_all(
        'els => Array.from(new Set(els.map(el => el.classList.contains("btn--ghost") ? "ghost" : "solid")))')
    assert 'ghost' not in affordances, f'the action group mixes borderless buttons: {affordances}'
    print(f'OBSERVED detail history title: {history!r} affordances={affordances}')

    # --- editor dialogs ----------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    page.locator('[data-od-id="edit-asset"]').first.click()
    expect(page.locator('#asset-editor-form')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'editor-edit', 'es', 1440, 'light',
                     'edit dialog, cancelled',
                     lambda: f'sections={page.locator(".asset-editor .editor-section").count()}'))
    cancel_dialog(page)

    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    page.locator('[data-od-id="edit-asset"]').first.click()
    expect(page.locator('#asset-editor-form')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'editor-edit', 'en', 390, 'dark',
                     'mobile edit dialog, cancelled'))
    cancel_dialog(page)

    # --- lifecycle dialogs -------------------------------------------------
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    if page.locator('[data-od-id="archive-asset"]').count():
        page.locator('[data-od-id="archive-asset"]').first.click()
        expect(page.locator('#inventory-lifecycle-form')).to_be_visible()
        eyebrow = page.locator('.modal-layer .eyebrow').first.inner_text().strip()
        assert 'servidor' not in eyebrow.lower(), eyebrow
        ident = page.locator('#inventory-lifecycle-form .delete-identity .mono').first.inner_text().strip()
        assert not ident.endswith('·'), f'lifecycle identity ends with a dangling separator: {ident!r}'
        print(f'OBSERVED lifecycle eyebrow: {eyebrow!r} identity={ident!r}')
        rows.append(cell(page, shots, 'marked', 'lifecycle-archive', 'es', 1440, 'light',
                         f'archive dialog, cancelled eyebrow={eyebrow!r}'))
        cancel_dialog(page)
    if page.locator('[data-od-id="retire-asset"]').count():
        page.locator('[data-od-id="retire-asset"]').first.click()
        expect(page.locator('#inventory-lifecycle-form')).to_be_visible()
        rows.append(cell(page, shots, 'marked', 'lifecycle-retire', 'es', 1440, 'light',
                         'retire dialog, cancelled'))
        cancel_dialog(page)
    purge = page.locator('[data-od-id="delete-asset"]')
    print(f'OBSERVED purge entries {purge.count()}')

    set_locale(page, 'en')
    fixture.set_theme(page, 'dark')
    page.set_viewport_size({'width': 390, 'height': 844})
    settle(page)
    if purge.count():
        page.locator('[data-od-id="delete-asset"]').first.click()
        expect(page.locator('#inventory-lifecycle-form')).to_be_visible()
        rows.append(cell(page, shots, 'marked', 'lifecycle-purge', 'en', 390, 'dark',
                         'purge dialog, cancelled'))
        cancel_dialog(page)
        settle(page)

    # --- create dialog -----------------------------------------------------
    set_locale(page, 'en')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 390, 'height': 844})
    goto_hash(page, '#/inventario')
    wait_inventory(page, 'en')
    page.locator('[data-od-id="create-asset"]').click()
    expect(page.locator('#asset-editor-form')).to_be_visible()
    rows.append(cell(page, shots, 'marked', 'editor-create', 'en', 390, 'light',
                     'create dialog, cancelled'))
    cancel_dialog(page)

    set_locale(page, 'es')
    settle(page)

    # --- pagination on the isolated installation ----------------------------
    # The demo dataset holds 16 assets while PAGE_LIMIT is 25, so the pager is
    # unreachable without more rows. Seed them through the supported batch API of
    # this disposable installation (never production) and exercise the real pager.
    seeded = seed_pagination_assets(page, 12)
    print(f'OBSERVED pagination seed: {seeded}')
    click_refresh(page)
    wait_results(page)
    nav = page.locator('nav.inventory-pagination')
    expect(nav).to_be_visible()
    label_first = nav.inner_text().strip().replace('\n', ' ')
    total_first = page.locator('.results-bar p').first.inner_text().strip()
    print(f'OBSERVED pagination page 1: total={total_first!r} nav={label_first!r}')
    rows.append(cell(page, shots, 'marked', 'pagination', 'es', 1440, 'light',
                     f'page 1 of 2 {total_first!r}',
                     lambda: f'nav={page.locator("nav.inventory-pagination").count()}'))
    nav.locator('button').nth(1).click()
    wait_results(page)
    offsets = [parse_qs(urlparse(url).query).get('offset', [''])[0]
               for url in network_search_urls(page)]
    page2_rows = page.locator('.asset-table tbody tr').count()
    label_second = page.locator('nav.inventory-pagination').inner_text().strip().replace('\n', ' ')
    print(f'OBSERVED pagination page 2: rows={page2_rows} offsets={offsets} nav={label_second!r}')
    assert '25' in offsets, f'no search request asked for offset 25: {offsets}'
    assert page2_rows > 0, 'page 2 painted no rows'
    rows.append(cell(page, shots, 'marked', 'pagination-page2', 'es', 1440, 'light',
                     f'page 2 offset={offsets[-1]} rows={page2_rows}'))
    nav.locator('button').nth(0).click()
    wait_results(page)
    back_offsets = [parse_qs(urlparse(url).query).get('offset', [''])[0]
                    for url in network_search_urls(page)]
    back_offset = back_offsets[-1] if back_offsets else ''
    print(f'OBSERVED pagination back: lastOffset={back_offset!r} offsets={back_offsets}')
    assert back_offset == '0', f'returning to page 1 requested offset={back_offset!r}'

    fixture.logout(page)
    return rows


def seed_pagination_assets(page, count):
    """Seed the isolated installation through the public batch endpoint."""
    token = page.evaluate(
        "() => fetch('/api/v1/auth/me', {credentials: 'include'}).then((r) => r.json()).then((d) => d.csrfToken)")
    payload = {'create': [{'name': f'Pagination probe {index}', 'category': 'camaras', 'type': 'Cámara IP'}
                          for index in range(1, count + 1)]}
    result = page.evaluate("""async ([token, body]) => {
        const res = await fetch('/api/v1/assets/batch', {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Token': token},
            body: JSON.stringify(body),
        });
        return {status: res.status, body: (await res.text()).slice(0, 300)};
    }""", [token, payload])
    assert result['status'] in (200, 201), f'the isolated batch seed failed: {result}'
    return result['status']


def run_ordinary(page, base, shots):
    rows = []
    fixture.login(page, base, 'ordinary.admin', fixture.DEMO_PASSWORD)
    page.goto(base + '/#/inventario', wait_until='networkidle')
    wait_mounted(page)
    expect(page.locator('#inventory-title')).to_be_visible()
    wait_inventory(page, 'es')
    for locale, width, theme in COMBOS:
        set_locale(page, locale)
        settle(page)
        rows.append(cell(page, shots, 'ordinary', 'empty', locale, width, theme,
                         'zero installation', lambda: assert_plain_empty(page, locale, width), rows=True))

    # A search on an empty installation must not claim "no matches" differently
    # from the plain empty state unless the filter is really the reason.
    set_locale(page, 'es')
    fixture.set_theme(page, 'light')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    settle(page)
    page.locator('#inventory-search').fill('nada')
    settle(page)
    page.wait_for_timeout(500)
    rows.append(cell(page, shots, 'ordinary', 'no-results', 'es', 1440, 'light',
                     'filtered empty on a zero installation',
                     lambda: assert_filtered_empty(page, 'es', 1440)))
    fixture.logout(page)
    return rows


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
                                  accept_downloads=True)
    errors = []
    page = None
    try:
        page = context.new_page()
        SEARCH_URLS[id(page)] = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: SEARCH_URLS[id(page)].append(request.url)
                if '/api/v1/assets/search' in request.url else None)
        rows = run_marked(page, base, shots) if label == 'marked' else run_ordinary(page, base, shots)
        assert not errors, f'{label} page errors: {errors}'
        print(f'PAGEERRORS {label}: 0')
        return rows
    finally:
        try:
            if page is not None:
                page.unroute_all(behavior='ignoreErrors')
        except Exception as error:  # noqa: BLE001 - teardown must not mask the run result
            print(f'TEARDOWN unroute: {error}')
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
