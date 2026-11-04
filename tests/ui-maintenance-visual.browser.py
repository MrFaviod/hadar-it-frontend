"""U5: individual visual pass over maintenance and incidents.

Covers the maintenance center (agenda, interventions, incidents and the demo
alert preview), its KPIs, tabs, server filters, pager, loading/error/empty
states, the four safe dialogs (open and cancelled, never confirmed) and the
incident detail page in every documented state.

Reuses ``demo-indicator.browser.py`` exactly like ``ui-access-visual.browser.py``,
``ui-dashboard-visual.browser.py`` and ``ui-inventory-visual.browser.py``: two
sequential scenarios, each with its own disposable backend and loopback
API/Vite pair.

* ``marked``   -- demo installation, whose canonical services seed maintenance
                  plans in every lifecycle state, interventions, incidents in
                  every documented state and synthetic alert fixtures.
* ``ordinary`` -- migrations plus ``bootstrap-superadmin``: a genuinely empty
                  installation, so the empty maintenance states and the missing
                  incident detail are served by the API.

Every rendered state is captured as its own PNG (route, state, locale, theme and
viewport in the file name) so a human can open one image at a time. Dialogs are
opened and cancelled; no plan, intervention, incident or catalog write is
confirmed, and the cancel path asserts that no write request was sent.
Nothing here touches an existing installation, Docker service, device or
provider.

Run: cd frontend && python3 tests/ui-maintenance-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    'maintenance_fixture', Path(__file__).with_name('demo-indicator.browser.py')
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')

COPY = {
    'es': {
        'title': 'Mantenimiento e incidentes',
        'agenda': 'Agenda',
        'interventions': 'Intervenciones',
        'incidents': 'Incidentes',
        'alerts': 'Vista previa de alertas',
        'empty_plans': 'Todavía no hay trabajos preventivos programados.',
        'empty_interventions': 'Todavía no hay intervenciones registradas.',
        'empty_incidents': 'Todavía no hay incidentes registrados.',
        'empty_filtered_plans': 'No hay trabajos preventivos con estos filtros.',
        'empty_filtered_incidents': 'Ningún incidente coincide con los filtros activos.',
        'clear': 'Limpiar filtros',
        'load_more': 'Cargar más',
        'costs': 'Coste acumulado',
        'acknowledge': 'Reconocer',
        'close': 'Cerrar incidente',
        'prepare': 'Preparar resolución',
        'resolve': 'Resolver sin preparación',
        'back_to_maintenance': 'Volver a mantenimiento',
        'missing_title': 'Incidente no disponible',
        'missing_body': 'El incidente solicitado no existe en este prototipo.',
        'errors_forbidden': 'No tienes permisos para realizar esta acción.',
        'errors_conflict': 'La operación no se puede completar con el estado actual.',
        'error_retryable': 'No se pudo cargar el incidente. Vuelve a intentarlo.',
        'retry': 'Reintentar',
        'errors_unavailable': 'El motor no está disponible en este momento.',
        'new_intervention': 'Registrar intervención',
        'new_incident': 'Nuevo incidente',
    },
    'en': {
        'title': 'Maintenance and incidents',
        'agenda': 'Schedule',
        'interventions': 'Interventions',
        'incidents': 'Incidents',
        'alerts': 'Alert preview',
        'empty_plans': 'No preventive work has been scheduled yet.',
        'empty_interventions': 'No interventions have been recorded yet.',
        'empty_incidents': 'No incidents have been recorded yet.',
        'empty_filtered_plans': 'No preventive work matches these filters.',
        'empty_filtered_incidents': 'No incident matches the active filters.',
        'clear': 'Clear filters',
        'load_more': 'Load more',
        'costs': 'Accumulated cost',
        'acknowledge': 'Acknowledge',
        'close': 'Close incident',
        'prepare': 'Prepare resolution',
        'resolve': 'Resolve without preparation',
        'back_to_maintenance': 'Back to maintenance',
        'missing_title': 'Incident unavailable',
        'missing_body': 'The requested incident does not exist in this prototype.',
        'errors_forbidden': 'You do not have permission to perform this action.',
        'errors_conflict': 'The operation cannot be completed in the current state.',
        'error_retryable': 'The incident could not be loaded. Try again.',
        'retry': 'Retry',
        'errors_unavailable': 'The engine is not available right now.',
        'new_intervention': 'Log intervention',
        'new_incident': 'New incident',
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


def goto_hash(page, target):
    """In-app navigation keeps the shell mounted instead of paying a boot."""
    page.evaluate("hash => { if (location.hash !== hash) location.hash = hash; }", target)
    page.wait_for_function("hash => location.hash === hash", arg=target)
    settle(page)


FAILURES: list[str] = []


def fail(label, state, locale, width, theme, message):
    text = f'FAIL {label} {state} {locale} {width} {theme}: {message}'
    FAILURES.append(text)
    print(text)
    return text


def cell(page, shots, label, state, locale, width, theme, note, assertions=None, rows=False, viewport_only=False):
    """Capture one cell, then assert. The image survives a failing assertion.

    Failures are recorded per state and the pass continues, so one run exposes
    every reachable defect instead of stopping at the first one.
    """
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)
    base = f'{label}-{state}-{locale}-{width}-{theme}'
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(80)
    if viewport_only:
        # A dialog is a fixed overlay: a full-page capture repeats it at every
        # viewport boundary and misrepresents what a person sees. Capture the
        # viewport at every width for those states.
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
                "() => { const node = document.querySelector('.maint-list, .maint-detail-grid, .empty-state');"
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
        leaked = RAW_KEY.search(visible_main(page))
        assert not leaked, (state, locale, leaked.group(0))
        overflow = page.evaluate('document.documentElement.scrollWidth - innerWidth')
        assert overflow <= 1, (state, locale, width, overflow)
    except AssertionError as error:
        detail = fail(label, state, locale, width, theme, str(error))
    row = (f'SHOT {label} {state} {locale} {width}x{"844" if width < 700 else "1000"} {theme} '
           f'route={page.evaluate("location.hash")} file={path} note={note} {detail}')
    print(row)
    return row


# --------------------------------------------------------------------- reads

def open_maintenance(page, locale, recover=True):
    goto_hash(page, '#/mantenimiento')
    page.locator('#maint-title').wait_for(state='visible')
    expect(page.locator('#maint-title')).to_have_text(COPY[locale]['title'])
    wait_list(page)
    # A demo install that answers its first reads before the deployment identity is
    # ready leaves an estate count unknown. That failure is reported, and leaving and
    # re-entering the route is the retry a person already has, because the adapter
    # only treats the overview as loaded when every count arrived. One explicit
    # re-entry with its own evidence line, never a hidden loop.
    if recover and '—' in kpi_values(page):
        # The demo install resets on a fixed boundary and rejects reads for about a
        # second while it rewrites its data. One bounded re-entry after that window
        # is the retry a person already has; the failed count is still reported in
        # the meantime instead of being replaced by another number.
        print('NOTE estate counts unknown on entry: re-entering #/mantenimiento once after the reset window')
        page.wait_for_timeout(1200)
        goto_hash(page, '#/panel')
        goto_hash(page, '#/mantenimiento')
        page.locator('#maint-title').wait_for(state='visible')
        wait_list(page)
        print(f'NOTE estate counts after one re-entry: {kpi_values(page)}')


def wait_list(page):
    """Wait for a painted list, empty surface or error region, never a guess."""
    page.wait_for_function(
        "() => !!document.querySelector('.maint-group, .maint-incident, "
        ".maint-row--intervention, .maint-row--alert, .maint-empty, .form-alert')",
        timeout=30000,
    )
    page.wait_for_timeout(120)


def wait_filter_reload(page):
    page.wait_for_timeout(320)
    wait_list(page)


def select_view(page, view):
    page.locator(f'[data-maint-tab="{view}"]').click()
    expect(page.locator(f'[data-maint-tab="{view}"]')).to_have_attribute('aria-selected', 'true')
    wait_filter_reload(page)


def api_get(page, path):
    return page.evaluate(
        """async path => {
            const response = await fetch(path, {credentials: 'same-origin', headers: {accept: 'application/json'}});
            return {status: response.status, body: await response.json()};
        }""",
        path,
    )


def demo_incidents(page):
    payload = api_get(page, '/api/v1/incidents?limit=50')
    assert payload['status'] == 200, payload
    items = payload['body']['items']
    by_state = {}
    for item in items:
        by_state.setdefault(item['status'], item)
    for state in ('open', 'in_progress', 'resolved', 'closed'):
        assert state in by_state, (state, [item['status'] for item in items])
    return by_state


def kpi_values(page):
    return [value.strip() for value in page.locator('.maint-kpi__value').all_inner_texts()]


def tab_counts(page):
    return {key: value.strip() for key, value in zip(
        ('agenda', 'interventions', 'incidents', 'alerts'),
        page.locator('.maint-tab__count').all_inner_texts(),
    )}


def agenda_groups(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.maint-group')).map(group => ({
            title: group.querySelector('.maint-group__title').innerText.replace(/\\s+/g, ' ').trim(),
            hint: group.querySelector('.maint-group__head p').innerText.trim(),
            rows: group.querySelectorAll('.maint-row--plan').length,
            due: Array.from(group.querySelectorAll('.maint-row__due')).map(el => el.innerText.replace(/\\s+/g, ' ').trim()),
        }))"""
    )


def row_actions(page, selector='.maint-row__actions .btn'):
    return page.evaluate(
        """sel => Array.from(document.querySelectorAll(sel)).map(el => ({
            text: el.innerText.replace(/\\s+/g, ' ').trim(),
            height: Math.round(el.getBoundingClientRect().height),
            width: Math.round(el.getBoundingClientRect().width),
        }))""",
        selector,
    )


def sentence_case_check(page):
    """Record the computed size of the dense maintenance micro labels."""
    return page.evaluate(
        """() => {
            const pick = (sel) => {
                const el = document.querySelector(sel);
                if (!el || !el.getClientRects().length) return null;
                return {sel, size: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10};
            };
            return [
                pick('.maint-kpi__label'), pick('.maint-kpi__hint'), pick('.maint-tab'),
                pick('.maint-row__meta'), pick('.maint-badge'), pick('.maint-incident__description'),
                pick('.maint-group__head p'), pick('.maint-pager .cell-muted'), pick('.maint-cost-strip')
            ].filter(Boolean);
        }"""
    )


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


def contrast_report(page, selectors):
    rows = []
    for selector in selectors:
        value = painted_contrast(page, selector)
        if value:
            rows.append(f'{selector}={value["ratio"]}')
            assert value['ratio'] >= 4.5, (selector, value)
    return 'contrast ' + ' '.join(rows)


# ---------------------------------------------------------------- assertions

def assert_estate_kpis(page, expected):
    """A view filter must not rewrite counts that describe the whole estate.

    An em dash means the server never delivered that estate count: the card is
    unknown, which is honest. A number that differs from the pre-filter reading is
    the defect this guards, because it is the filtered list being passed off as
    the estate total.
    """
    current = kpi_values(page)
    for before, after in zip(expected, current):
        assert after == before or after == '—', f'KPI cards followed the filter: {expected} -> {current}'
    return f'kpis_before={expected} kpis_after={current}'


def assert_estate_unknown(page, locale):
    """A failed estate count is marked unknown and reported, never invented.

    The count that never arrived is an em dash and the surface says the counts are
    unavailable; the list panel keeps its own state, so an empty agenda still shows
    its empty copy instead of being replaced by a count failure.
    """
    values = kpi_values(page)
    assert len(values) == 4, values
    assert '—' in values, f'the failed count is not marked unknown: {values}'
    alert = page.locator('.maint-page .form-alert[role="alert"]').first
    text = alert.inner_text().strip()
    assert COPY[locale]['errors_unavailable'] in text, (COPY[locale]['errors_unavailable'], text)
    assert 'upstream' not in text, 'raw server text is not painted'
    assert page.locator('.maint-empty').count() == 1, 'the list keeps its own empty state'
    return f'kpis={values} alert={text}'


def assert_agenda(page, locale):
    groups = agenda_groups(page)
    assert groups, 'no agenda group painted'
    for group in groups:
        count = int(group['title'].split(' ')[-1])
        assert count == group['rows'], group
        assert group['hint'], group
    values = kpi_values(page)
    assert len(values) == 4, values
    assert all(value == '—' or (len(value) == 2 and value.isdigit()) for value in values), values
    counts = tab_counts(page)
    assert counts['agenda'].isdigit(), counts
    sizes = sentence_case_check(page)
    assert sizes, 'no maintenance label measured'
    return (f'groups={[group["title"] for group in groups]} kpis={values} '
            f'tabs={counts} sizes={[(item["sel"], item["size"]) for item in sizes]}')


def assert_interventions(page, locale):
    text = visible_main(page)
    assert COPY[locale]['costs'] in text, (COPY[locale]['costs'], text[:160])
    rows = page.locator('.maint-row--intervention').count()
    assert rows >= 1, rows
    statuses = [item.strip() for item in page.locator('.maint-row--intervention .maint-status').all_inner_texts()]
    costs = [item.strip() for item in page.locator('.maint-row--intervention .maint-row__due strong').all_inner_texts()]
    assert all(costs), costs
    return f'rows={rows} statuses={statuses} costs={costs}'


def assert_incidents(page, locale):
    cards = page.locator('.maint-incident').count()
    assert cards >= 1, cards
    ids = [item.strip() for item in page.locator('.maint-incident__head .mono').all_inner_texts()]
    priorities = [item.strip() for item in page.locator('.maint-incident__head .maint-badge').all_inner_texts()]
    statuses = [item.strip() for item in page.locator('.maint-incident__head .maint-status').all_inner_texts()]
    assert len(ids) == cards, (ids, cards)
    return f'cards={cards} ids={ids} priorities={priorities} statuses={statuses}'


def assert_empty(page, locale, expected, action):
    text = page.locator('.maint-empty').inner_text()
    assert expected in text, (expected, text)
    assert page.locator('.maint-pager').count() == 0, 'pager range contradicts the empty state'
    buttons = [item.strip() for item in page.locator('.maint-empty .text-button').all_inner_texts()]
    if action:
        assert buttons, 'filtered empty state offers no way back'
    else:
        assert not buttons, buttons
    return f'empty="{text.splitlines()[0]}" actions={buttons}'


def assert_detail_missing(page, locale):
    """The incident detail fallback names the missing record and offers a way back."""
    panel = page.locator('.maint-page .empty-state')
    assert panel.count() == 1, panel.count()
    title = panel.locator('h3').inner_text().strip()
    body = panel.locator('p').first.inner_text().strip()
    # A rate-limited read is a retryable state, not a missing record, so this only
    # reads the closing action and separately proves no retry is offered.
    back = panel.locator('.btn').last.inner_text().strip()
    assert title == COPY[locale]['missing_title'], (title, COPY[locale]['missing_title'])
    assert body, 'missing incident paints no explanation'
    assert back == COPY[locale]['back_to_maintenance'], back
    assert COPY[locale]['retry'] not in panel.inner_text(), 'a missing record must not offer a retry'
    return f'missing="{title}" body="{body[:60]}" back="{back}"'


def assert_error(page, locale):
    alert = page.locator('.form-alert[role="alert"]').first
    message = alert.inner_text().strip()
    assert message, 'empty error region'
    assert 'ui.' not in message, message
    assert page.locator('.maint-empty').count() == 0, 'error surface also claims an empty list'
    return f'error="{message[:80]}"'


def assert_loading(page, locale):
    """A reachable loading state has to be announced, not a blank list."""
    texts = page.locator('.maint-page [role="status"]').all_inner_texts()
    busy = page.evaluate(
        """() => Array.from(document.querySelectorAll('.maint-page .maint-body'))
            .map(el => el.getAttribute('aria-busy'))"""
    )
    assert texts and texts[0].strip(), f'no announced loading state; aria-busy={busy}'
    # Previous rows may stay painted during a reload, but the body must say it is
    # busy and no empty state may claim there is no data yet.
    assert busy == ['true'], f'body not announced busy; aria-busy={busy}'
    assert page.locator('.maint-empty').count() == 0, 'empty state painted while loading'
    return f'loading="{texts[0].strip()}" aria-busy={busy}'


def assert_phone_layout(page):
    """A phone row stacks the record above its due date, never squeezes it."""
    measured = page.evaluate(
        """() => Array.from(document.querySelectorAll('.maint-page .maint-row')).map(row => {
            const name = row.querySelector('.maint-row__name');
            const main = row.querySelector('.maint-row__main');
            const due = row.querySelector('.maint-row__due');
            const box = main.getBoundingClientRect();
            const dueBox = due.getBoundingClientRect();
            const style = name ? getComputedStyle(name) : null;
            const lineHeight = style ? parseFloat(style.lineHeight) || parseFloat(style.fontSize) : 0;
            return {
                width: Math.round(box.width),
                stacked: dueBox.top >= box.bottom - 2,
                lines: name && lineHeight ? Math.round(name.getBoundingClientRect().height / lineHeight) : 0
            };
        })"""
    )
    assert measured, 'no row measured'
    narrow = [item for item in measured if item['width'] < 220]
    assert not narrow, f'record column squeezed: {narrow}'
    overlap = [item for item in measured if not item['stacked']]
    assert not overlap, f'due date painted beside the record instead of below it: {overlap}'
    tall = [item for item in measured if item['lines'] > 3]
    assert not tall, f'row name wrapped beyond three lines: {tall}'
    return (
        f'rows={len(measured)} record_width={measured[0]["width"]}'
        f' name_lines={max(item["lines"] for item in measured)}'
    )


def assert_tabs_within_view(page):
    """Every tab is reachable without a hidden horizontal strip."""
    measured = page.evaluate(
        """() => Array.from(document.querySelectorAll('.maint-page .maint-tab')).map(tab => {
            const box = tab.getBoundingClientRect();
            return {
                text: tab.textContent.trim().slice(0, 22),
                left: Math.round(box.left),
                right: Math.round(box.right),
                visible: box.width > 0 && box.height > 0
            };
        })"""
    )
    assert measured, 'no tab measured'
    hidden = [item for item in measured if not item['visible']]
    assert not hidden, f'tab collapsed: {hidden}'
    clipped = [item for item in measured if item['right'] > page.viewport_size['width'] + 1 or item['left'] < -1]
    assert not clipped, f'tab sits outside the viewport: {clipped}'
    return f'tabs={[item["text"] for item in measured]}'


def wait_ready(base, label, timeout=90.0):
    """Wait for the API's own readiness endpoint, not for a guessed delay.

    ``GET /api/v1/health/ready`` answers 200 only when the database, the
    migration head and the task storage are usable, which is exactly the state
    the first maintenance read needs. Anything else is retried with the actual
    readiness condition, never with a blind timeout, and a backend that never
    reaches it fails loudly.
    """
    url = base.rstrip('/') + '/api/v1/health/ready'
    deadline = time.monotonic() + timeout
    attempts = 0
    last = 'no probe completed'
    while time.monotonic() < deadline:
        attempts += 1
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                payload = json.loads(response.read().decode('utf-8') or '{}')
                print(f'READY {label}: health/ready 200 after {attempts} probe(s) '
                      f'status={payload.get("status")}')
                return attempts
        except urllib.error.HTTPError as error:
            last = f'HTTP {error.code}'
        except (urllib.error.URLError, OSError, ValueError) as error:
            last = type(error).__name__
        time.sleep(0.4)
    raise AssertionError(f'{label}: health/ready never reported ready ({last}) after {attempts} probes')


def dialog_layout(page, width):
    """Measure the dialog form grid and its narrowest control."""
    return page.evaluate(
        """() => {
            const dialog = document.querySelector('.modal[role="dialog"]');
            if (!dialog) return { error: 'no dialog' };
            const grid = dialog.querySelector('.form-grid');
            const template = grid ? getComputedStyle(grid).gridTemplateColumns : '';
            const columns = template ? template.split(' ').filter(Boolean).length : 0;
            const controls = Array.from(dialog.querySelectorAll('.field, .maint-picker, .input-shell'))
                .map((node) => Math.round(node.getBoundingClientRect().width))
                .filter((value) => value > 0);
            const dialogBox = dialog.getBoundingClientRect();
            const overflow = Array.from(dialog.querySelectorAll('.field, .maint-picker, .input-shell'))
                .map((node) => Math.round(node.getBoundingClientRect().right))
                .filter((right) => right > dialogBox.right + 1).length;
            return {
                columns,
                template,
                narrowest: controls.length ? Math.min(...controls) : 0,
                controls: controls.length,
                overflow,
                dialogWidth: Math.round(dialogBox.width)
            };
        }"""
    )


def assert_dialog_layout(page, width):
    """A narrow dialog must stack its fields instead of squeezing the controls."""
    report = dialog_layout(page, width)
    assert 'error' not in report, report
    assert report['controls'] >= 2, report
    assert report['overflow'] == 0, f'control painted beyond the dialog: {report}'
    floor = 200 if width <= 720 else 220
    assert report['narrowest'] >= floor, f'narrowest control {report["narrowest"]}px: {report}'
    if width <= 720:
        assert report['columns'] == 1, f'two-column dialog grid at {width}px: {report}'
    return (f'dialog_width={report["dialogWidth"]} grid_columns={report["columns"]} '
            f'narrowest={report["narrowest"]}')


def assert_retryable_detail(page, locale, forbidden):
    """A failed incident read is localised, ownable and retryable."""
    panel = page.locator('.maint-page .empty-state')
    assert panel.count() == 1, panel.count()
    text = panel.inner_text()
    assert COPY[locale]['error_retryable'] in text, text[:200]
    for fragment in forbidden:
        assert fragment not in text, (fragment, text[:200])
    assert COPY[locale]['missing_title'] not in text, 'a 503 is not a missing record'
    assert COPY[locale]['missing_body'] not in text, 'a 503 does not paint the missing body'
    retry = panel.locator('[data-maint-action="retry"]')
    assert retry.count() == 1, retry.count()
    assert retry.inner_text().strip() == COPY[locale]['retry'], retry.inner_text()
    return f'retryable="{COPY[locale]["error_retryable"][:40]}" retry="{COPY[locale]["retry"]}"'


def wait_or_report(page, script, label, timeout=30000):
    """Wait for a public state, reporting what the page actually paints on failure."""
    try:
        page.wait_for_function(script, timeout=timeout)
    except Exception as error:
        diagnostics = page.evaluate(
            """() => ({
                hash: location.hash,
                panels: document.querySelectorAll('.maint-page').length,
                empty: document.querySelectorAll('.maint-page .empty-state').length,
                loading: document.querySelectorAll('.loading-state').length,
                retry: document.querySelectorAll('[data-maint-action="retry"]').length,
                alert: (document.querySelector('.maint-page .form-alert') || {}).innerText || '',
                body: ((document.querySelector('.maint-page .empty-state') || {}).innerText || '').slice(0, 120)
            })"""
        )
        print(f'DIAG {label}: {diagnostics}')
        raise AssertionError(f'{label} never appeared: {diagnostics}') from error


def fulfill_error(status, code, message):
    """Build a one-argument route handler that answers with a server error envelope.

    Playwright inspects a handler's arity and passes the request as a second
    argument, so the values are closed over by a factory instead of default
    parameters.
    """
    def handler(route):
        route.fulfill(
            status=status,
            content_type='application/json',
            body=json.dumps({'error': {'code': code, 'message': message}}),
        )
    return handler


def assert_failed_detail(page, locale, key, forbidden):
    """A denied or conflicting read explains itself without pretending the id is unknown.

    403 and 409 are facts about the caller and the record's state: retrying the same
    request unchanged cannot succeed, so the localized sentence stands alone with no
    retry action and no missing heading.
    """
    panel = page.locator('.maint-page .empty-state')
    assert panel.count() == 1, panel.count()
    text = panel.inner_text()
    assert COPY[locale][key] in text, (COPY[locale][key], text[:200])
    assert COPY[locale]['missing_title'] not in text, 'a non-missing failure paints the missing heading'
    assert COPY[locale]['missing_body'] not in text, 'a non-missing failure paints the missing body'
    for fragment in forbidden:
        assert fragment not in text, (fragment, text[:200])
    retry = panel.locator('[data-maint-action="retry"]')
    assert retry.count() == 0, 'a non-retryable failure offers no retry action'
    labels = [value.strip() for value in panel.locator('.btn').all_inner_texts()]
    assert labels and labels[-1] == COPY[locale]['back_to_maintenance'], f'last action must be back, got {labels}'
    assert COPY[locale]['retry'] not in labels, f'a non-retryable failure must not offer retry, got {labels}'
    return f'message="{COPY[locale][key][:40]}" actions={labels}'


def assert_mobile_targets(page):
    measured = row_actions(page)
    assert measured, 'no row action measured'
    tabs = [
        {'text': item.inner_text().strip(), 'height': round(item.bounding_box()['height'])}
        for item in page.locator('.maint-page .maint-tab').all()
        if item.bounding_box()
    ]
    all_targets = measured + tabs
    small = [item for item in all_targets if item['height'] < 44]
    assert not small, small
    return f'targets={[(item["text"][:18], item["height"]) for item in all_targets]}'


def assert_kpi_selected(page, expected):
    """The KPI that produced the current filter must paint as selected."""
    active = page.locator('.maint-kpi.is-active')
    pressed = page.evaluate(
        """() => Array.from(document.querySelectorAll('.maint-kpi'))
            .map(el => el.getAttribute('aria-pressed'))"""
    )
    state = page.locator('[data-maint-filter="state"]').first
    value = state.input_value() if state.count() else ''
    assert active.count() == expected, (active.count(), pressed, value)
    assert value in ('', 'overdue', 'upcoming', 'in_progress', 'open'), value
    assert pressed.count('true') == expected, pressed
    return f'active={active.count()} pressed={pressed} state={value}'


def dialog_state(page):
    modal = page.locator('.modal[role="dialog"]')
    return {
        'count': modal.count(),
        'label': page.evaluate(
            """() => {
                const dialog = document.querySelector('.modal[role="dialog"]');
                if (!dialog) return '';
                const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
                return title ? title.innerText.trim() : '';
            }"""
        ),
        'focused': page.evaluate(
            """() => {
                const active = document.activeElement;
                return active ? (active.className || active.tagName).toString().slice(0, 40) : '';
            }"""
        ),
        'fields': page.locator('.modal .input-shell, .modal select, .modal textarea').count(),
        'footer': [item.strip() for item in page.locator('.modal__foot .btn').all_inner_texts()],
    }


def cancel_dialog(page):
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.querySelector('.modal[role=\"dialog\"]')")
    page.wait_for_timeout(80)


WRITES = {}


def record_requests(page):
    WRITES.setdefault(id(page), [])

    def handler(request):
        if request.method != 'GET':
            WRITES[id(page)].append((request.method, request.url))

    page.on('request', handler)


def write_count(page, needles=()):
    """Non-GET requests, optionally only those matching one of the path needles."""
    entries = WRITES.get(id(page), [])
    if not needles:
        return len(entries)
    return len([entry for entry in entries if any(needle in entry[1] for needle in needles)])


# ---------------------------------------------------------------- scenarios

def run_agenda(page, base, shots):
    rows = []
    locale = 'es'
    open_maintenance(page, locale)
    rows.append(cell(
        page, shots, 'maint-agenda', 'default', 'es', 1440, 'light',
        'agenda with server plans grouped by due state',
        lambda: assert_agenda(page, 'es') + ' ' + contrast_report(page, [
            '.maint-kpi__label', '.maint-kpi__hint', '.maint-row__meta',
            '.maint-group__head p', '.maint-pager .cell-muted'
        ]),
    ))

    fixture.set_theme(page, 'dark')
    set_locale(page, 'en')
    rows.append(cell(
        page, shots, 'maint-agenda', 'default', 'en', 1440, 'dark',
        'same agenda in English dark theme',
        lambda: assert_agenda(page, 'en'),
    ))

    rows.append(cell(
        page, shots, 'maint-agenda', 'default', 'es', 390, 'dark',
        'phone agenda, rows after the header',
        lambda: assert_agenda(page, 'es') + ' ' + assert_phone_layout(page) + ' ' + contrast_report(page, [
            '.maint-kpi__hint', '.maint-row__meta'
        ]),
        rows=True,
    ))

    fixture.set_theme(page, 'light')
    set_locale(page, 'es')
    page.set_viewport_size({'width': 390, 'height': 844})
    rows.append(cell(
        page, shots, 'maint-agenda', 'actions', 'es', 390, 'light',
        'plan row actions on a phone: touch target sizes',
        lambda: assert_mobile_targets(page) + ' ' + assert_tabs_within_view(page) + ' ' + assert_phone_layout(page),
        rows=True,
    ))

    page.set_viewport_size({'width': 1440, 'height': 1000})
    # Read the estate counts immediately before the filter and compare them with
    # the painted cards immediately after it: the property under test is that a
    # view filter never rewrites counts that describe the whole estate.
    estate_kpis = kpi_values(page)
    assert len(estate_kpis) == 4, estate_kpis
    page.select_option('[data-maint-filter="planStatus"]', 'postponed')
    wait_filter_reload(page)
    rows.append(cell(
        page, shots, 'maint-agenda', 'postponed', 'es', 1440, 'light',
        'server plan-status filter keeps only the postponed plan',
        lambda: assert_agenda(page, 'es') + ' ' + (
            'filter=' + str(page.locator('[data-maint-filter="planStatus"]').input_value())
        ) + ' ' + assert_estate_kpis(page, estate_kpis),
    ))

    page.click('.maint-toolbar .text-button')
    wait_filter_reload(page)
    page.fill('[data-maint-filter="query"]', 'zzz')
    wait_filter_reload(page)
    rows.append(cell(
        page, shots, 'maint-agenda', 'filtered-empty', 'es', 1440, 'light',
        'no matching plan: filtered empty copy plus a way back',
        lambda: assert_empty(page, 'es', COPY['es']['empty_filtered_plans'], True),
    ))

    page.click('.maint-empty .text-button')
    wait_filter_reload(page)
    return rows


def run_kpi_selection(page, shots):
    """Selecting a KPI from another tab must keep the due/status filter."""
    rows = []
    select_view(page, 'incidents')
    rows.append(cell(
        page, shots, 'maint-incidents', 'default', 'es', 1440, 'light',
        'incident cards from the server',
        lambda: assert_incidents(page, 'es'),
    ))

    page.locator('.maint-kpi').first.click()
    wait_filter_reload(page)
    rows.append(cell(
        page, shots, 'maint-agenda', 'kpi-overdue', 'es', 1440, 'light',
        'overdue KPI selected from the incidents tab',
        lambda: assert_kpi_selected(page, 1) + ' ' + assert_agenda(page, 'es'),
    ))
    return rows


def run_interventions(page, shots):
    rows = []
    select_view(page, 'interventions')
    rows.append(cell(
        page, shots, 'maint-interventions', 'default', 'es', 1440, 'light',
        'interventions with the cost strip',
        lambda: assert_interventions(page, 'es') + ' ' + contrast_report(page, [
            '.maint-row__meta', '.maint-cost-strip', '.cell-muted'
        ]),
    ))

    fixture.set_theme(page, 'dark')
    set_locale(page, 'en')
    rows.append(cell(
        page, shots, 'maint-interventions', 'default', 'en', 1440, 'dark',
        'interventions in English dark theme',
        lambda: assert_interventions(page, 'en'),
    ))

    rows.append(cell(
        page, shots, 'maint-interventions', 'rows', 'es', 390, 'dark',
        'phone interventions, rows after the header',
        lambda: assert_interventions(page, 'es') + ' ' + assert_mobile_targets(page) + ' ' + assert_phone_layout(page),
        rows=True,
    ))

    fixture.set_theme(page, 'light')
    set_locale(page, 'es')
    page.select_option('[data-maint-filter="state"]', 'completed')
    wait_filter_reload(page)
    rows.append(cell(
        page, shots, 'maint-interventions', 'completed', 'es', 1440, 'light',
        'intervention status filter',
        lambda: assert_interventions(page, 'es') + ' ' + (
            'filter=' + str(page.locator('[data-maint-filter="state"]').input_value())
        ),
    ))

    page.click('.maint-toolbar .text-button')
    wait_filter_reload(page)
    return rows


def dialog_cell(page, shots, rows, state, locale, width, theme, note, opener, label='maint-dialog'):
    """Open one dialog at one width, measure its grid, then cancel it.

    Theme and locale are applied with the dialog closed: the modal owns the page
    while it is open, so its own toggle cannot be clicked underneath the overlay.
    """
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    fixture.set_theme(page, theme)
    set_locale(page, locale)
    opener()
    page.locator('.modal[role="dialog"]').wait_for(state='visible')
    rows.append(cell(
        page, shots, label, state, locale, width, theme, note,
        lambda w=width: f'dialog={dialog_state(page)} layout={assert_dialog_layout(page, w)}',
        viewport_only=True,
    ))
    cancel_dialog(page)


def run_dialog_cancel(page, shots, mark):
    rows = []
    before = write_count(page, ('/maintenance', '/interventions', '/incidents'))

    # Representative widths, not a Cartesian product: the intervention dialog is
    # the widest of the four, so its grid governs the shared form layout. The theme
    # and locale are switched with the dialog closed, because the modal owns the
    # page while it is open.
    for width, locale, theme, note in (
        (1440, 'es', 'light', 'intervention dialog opened, then cancelled with Escape'),
        (900, 'en', 'dark', 'dialog on a narrow desktop, both locales covered'),
        (768, 'es', 'light', 'dialog at the tablet breakpoint'),
        (640, 'en', 'dark', 'dialog below the form-grid collapse point'),
        (390, 'es', 'light', 'same dialog on a phone before cancelling'),
    ):
        if page.locator('.modal[role="dialog"]').count():
            cancel_dialog(page)
        page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
        fixture.set_theme(page, theme)
        set_locale(page, locale)
        page.locator('[data-od-id="maint-new-intervention"]').click()
        page.locator('.modal[role="dialog"]').wait_for(state='visible')
        rows.append(cell(
            page, shots, 'maint-dialog', 'new-intervention', locale, width, theme, note,
            lambda w=width: f'dialog={dialog_state(page)} layout={assert_dialog_layout(page, w)}',
            viewport_only=True,
        ))
    cancel_dialog(page)

    # Sibling dialogs at the widths where the shared grid changes shape. They all
    # use the same `.form-grid--two`, so a layout regression there affects every
    # one of them; the incident dialog is also checked in English dark.
    dialog_cell(page, shots, rows, 'new-incident', 'es', 1440, 'light',
                'incident dialog opened, then cancelled',
                lambda: page.locator('[data-od-id="maint-new-incident"]').click())
    dialog_cell(page, shots, rows, 'new-incident', 'es', 390, 'light',
                'incident dialog on a phone: fields stacked, pickers readable',
                lambda: page.locator('[data-od-id="maint-new-incident"]').click())
    dialog_cell(page, shots, rows, 'new-incident', 'en', 768, 'dark',
                'incident dialog at the tablet breakpoint in English dark',
                lambda: page.locator('[data-od-id="maint-new-incident"]').click())
    dialog_cell(page, shots, rows, 'complete-plan', 'es', 1440, 'light',
                'complete-preventive dialog opened, then cancelled',
                lambda: page.locator('[data-maint-action="complete"]').first.click())
    dialog_cell(page, shots, rows, 'complete-plan', 'es', 390, 'light',
                'complete-preventive dialog on a phone',
                lambda: page.locator('[data-maint-action="complete"]').first.click())
    dialog_cell(page, shots, rows, 'postpone', 'es', 1440, 'light',
                'postpone dialog opened, then cancelled',
                lambda: page.locator('[data-maint-action="postpone"]').first.click())
    dialog_cell(page, shots, rows, 'postpone', 'es', 640, 'light',
                'postpone dialog below the form-grid collapse point',
                lambda: page.locator('[data-maint-action="postpone"]').first.click())

    assert page.locator('.modal[role="dialog"]').count() == 0, 'dialog stayed open'
    # Only the records under test matter: switching theme, locale and viewport
    # legitimately persists workspace preferences, and that is not a maintenance
    # mutation. Nothing in the maintenance, intervention or incident paths may be
    # written by opening and cancelling a dialog.
    domain = ('/maintenance', '/interventions', '/incidents')
    after = write_count(page, domain)
    assert after == before, [item for item in WRITES[id(page)] if any(needle in item[1] for needle in domain)][before:after]
    print(f'DIALOGS cancelled: maintenance writes={after - before} '
          f'(workspace preference saves excluded: {write_count(page) - write_count(page, domain)})')
    rows.append(f'DIALOGS cancelled without maintenance writes: {after - before}')
    return rows


def run_loading(page, shots):
    """A real slow network, not a fabricated class: requests are in flight."""
    rows = []
    session = page.context.new_cdp_session(page)
    session.send('Network.enable')
    session.send('Network.emulateNetworkConditions', {
        'offline': False, 'latency': 1600, 'downloadThroughput': -1, 'uploadThroughput': -1,
    })
    try:
        goto_hash(page, '#/panel')
        page.evaluate("() => { location.hash = '#/mantenimiento'; }")
        page.wait_for_function("() => !!document.querySelector('.maint-page')", timeout=30000)
        page.wait_for_timeout(250)
        rows.append(cell(
            page, shots, 'maint-agenda', 'loading', 'es', 1440, 'light',
            'slow network: the announced loading state before rows arrive',
            lambda: assert_loading(page, 'es'),
        ))
    finally:
        session.send('Network.emulateNetworkConditions', {
            'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1,
        })
        session.detach()
    wait_list(page)
    return rows


def run_error(page, shots):
    rows = []
    page.route('**/api/v1/maintenance/plans?**', lambda route: route.fulfill(
        status=503,
        content_type='application/json',
        body='{"detail": "El servicio de mantenimiento no está disponible."}',
    ))
    page.route('**/api/v1/maintenance/plans', lambda route: route.fulfill(
        status=503,
        content_type='application/json',
        body='{"detail": "El servicio de mantenimiento no está disponible."}',
    ))
    try:
        page.click('[data-maint-tab="incidents"]')
        wait_filter_reload(page)
        page.click('[data-maint-tab="agenda"]')
        wait_filter_reload(page)
        rows.append(cell(
            page, shots, 'maint-agenda', 'error', 'es', 1440, 'light',
            'server failure surfaced as an alert instead of an empty agenda',
            lambda: assert_error(page, 'es'),
        ))
    finally:
        page.unroute_all(behavior='ignoreErrors')
    wait_list(page)
    return rows


def run_incident_detail(page, base, shots):
    rows = []
    by_state = demo_incidents(page)
    print(f'INCIDENTS server states: {sorted(by_state)}')

    for state, locale, width, theme, note, expected in (
        ('open', 'es', 1440, 'light', 'open incident: acknowledge and log intervention', ['acknowledge']),
        ('in_progress', 'en', 1440, 'dark', 'in-progress incident: resolution panel', ['prepare']),
        ('resolved', 'es', 1440, 'light', 'resolved incident: close action', ['close']),
        ('closed', 'en', 390, 'light', 'closed incident on a phone: read-only', []),
    ):
        conflict = by_state[state]
        goto_hash(page, '#/mantenimiento/incidente/' + conflict['id'])
        page.locator('#incident-title').wait_for(state='visible')
        page.wait_for_function("() => !document.querySelector('.loading-state')")

        def assertions(item=conflict, locale=locale, expected=expected, state=state):
            text = visible_main(page)
            assert item['description'] in text, (item['description'], text[:200])
            painted = page.locator('.maint-head__actions .btn').all_inner_texts()
            painted = [value.strip() for value in painted if value.strip()]
            resolution = page.locator('.maint-panel__actions .btn').all_inner_texts()
            resolution = [value.strip() for value in resolution if value.strip()]
            for label in expected:
                assert COPY[locale][label] in painted + resolution, (label, painted, resolution)
            assert COPY[locale]['back_to_maintenance'] not in painted, painted
            events = page.locator('.maint-timeline__item').count()
            return (
                f'state={state} actions={painted} resolution={resolution} events={events}'
            )

        rows.append(cell(
            page, shots, 'incident-detail', state, locale, width, theme, note, assertions,
            rows=(width < 700),
        ))

    # A server failure is a retryable read, never a missing record and never the
    # previous incident; the retry action is the only way out besides going back.
    previous = by_state['open']['description']
    failed_id = by_state['resolved']['id']
    page.route(
        '**/api/v1/incidents/*',
        lambda route: route.fulfill(
            status=503,
            content_type='application/json',
            body=json.dumps({'error': {'code': 'unavailable', 'message': 'maintenance read failed upstream'}}),
        ),
    )
    goto_hash(page, '#/mantenimiento/incidente/' + failed_id)
    page.wait_for_function(
        "() => !!document.querySelector('.maint-page .empty-state [data-maint-action=\"retry\"]')",
        timeout=30000,
    )
    rows.append(cell(
        page, shots, 'incident-detail', 'retryable', 'es', 1440, 'light',
        '503 read: localised retryable state, no raw server text, no stale record',
        lambda: assert_retryable_detail(page, 'es', [previous, 'maintenance read failed upstream']),
    ))
    page.unroute_all(behavior='ignoreErrors')
    page.locator('[data-maint-action="retry"]').click()
    page.locator('#incident-title').wait_for(state='visible')
    page.wait_for_function("() => !document.querySelector('.loading-state')")
    rows.append(cell(
        page, shots, 'incident-detail', 'retry-recovered', 'es', 1440, 'light',
        'the retry action refetches and paints the record it asked for',
        lambda: (
            'title=' + page.locator('#incident-title').inner_text().strip()[:40]
            + ' retry=' + str(page.locator('[data-maint-action="retry"]').count())
        ),
    ))

    # A routed incident is only read when the hash actually changes, so every routed
    # cell below leaves the detail route first instead of re-assigning the same hash.
    # The failure cells use an id this page never loaded: a same-id failure keeps
    # painting the record already on screen (stale-while-failed), so the empty outcome
    # is only observable on a cold record.
    cold_id = '11111111-1111-4111-8111-111111111111'

    def fresh_incident_cell(incident_id):
        goto_hash(page, '#/mantenimiento')
        page.locator('#maint-title').wait_for(state='visible')
        wait_list(page)
        goto_hash(page, '#/mantenimiento/incidente/' + incident_id)

    # A denied or conflicting read is not a record that does not exist: the status the
    # server sent keeps its own localized explanation, and no retry is offered because
    # repeating the same request unchanged cannot succeed (F1).
    for state, locale, width, theme, status, key, code in (
        ('forbidden', 'es', 1440, 'light', 403, 'errors_forbidden', 'forbidden'),
        ('conflict', 'en', 390, 'dark', 409, 'errors_conflict', 'conflict'),
    ):
        page.route('**/api/v1/incidents/*', fulfill_error(status, code, 'policy denied the read'))
        fresh_incident_cell(cold_id)
        wait_or_report(
            page,
            "() => !!document.querySelector('.maint-page .empty-state')"
            " && !document.querySelector('.loading-state')",
            f'{status} denied-or-conflicting read state',
        )
        rows.append(cell(
            page, shots, 'incident-detail', state, locale, width, theme,
            f'{status} read: the localized explanation, no missing record, no retry',
            lambda locale=locale, key=key: assert_failed_detail(page, locale, key, [previous, 'policy denied the read']),
            rows=(width < 700),
        ))
        page.unroute_all(behavior='ignoreErrors')

    # A fresh failure classification replaces the old one: the same id that answered
    # 404 must not keep the missing state when the next read answers 500 (F2).
    attempts = {'count': 0}

    def flaky_incident(route):
        attempts['count'] += 1
        if attempts['count'] == 1:
            route.fulfill(
                status=404,
                content_type='application/json',
                body=json.dumps({'error': {'code': 'not_found', 'message': 'incident not found'}}),
            )
            return
        route.fulfill(
            status=500,
            content_type='application/json',
            body=json.dumps({'error': {'code': 'internal_error', 'message': 'internal failure upstream'}}),
        )

    page.route('**/api/v1/incidents/*', flaky_incident)
    fresh_incident_cell(cold_id)
    wait_or_report(
        page,
        "() => !!document.querySelector('.maint-page .empty-state')"
        " && !document.querySelector('[data-maint-action=\"retry\"]')",
        'missing read state after a 404',
    )
    goto_hash(page, '#/mantenimiento')
    page.locator('#maint-title').wait_for(state='visible')
    wait_list(page)
    goto_hash(page, '#/mantenimiento/incidente/' + failed_id)
    wait_or_report(
        page,
        "() => !!document.querySelector('[data-maint-action=\"retry\"]')",
        'retryable read state after a 500 on the same id',
    )
    rows.append(cell(
        page, shots, 'incident-detail', 'missing-then-retryable', 'es', 1440, 'light',
        '404 then 500 on the same id: the fresh failure wins, no missing copy survives',
        lambda: assert_retryable_detail(page, 'es', [previous, 'internal failure upstream'])
        + f' requests={attempts["count"]}',
    ))
    page.unroute_all(behavior='ignoreErrors')

    # The read is stubbed: the live answer for a malformed id (422) and the request
    # budget (429) are truthful states of their own, but neither is the missing record
    # this row exists to show. The server mapping stays proven by the component test.
    page.route('**/api/v1/incidents/*', fulfill_error(404, 'not_found', 'incident not found'))
    goto_hash(page, '#/mantenimiento/incidente/incidente-inexistente')
    # A rejected id must not keep painting the previously opened incident.
    page.wait_for_timeout(900)
    rows.append(cell(
        page, shots, 'incident-detail', 'missing', 'es', 1440, 'light',
        'unknown incident id: unavailable copy, no painted record, way back',
        lambda: assert_detail_missing(page, 'es'),
    ))
    page.unroute_all(behavior='ignoreErrors')
    return rows


def run_alerts(page, shots):
    goto_hash(page, '#/mantenimiento')
    page.locator('#maint-title').wait_for(state='visible')
    wait_list(page)
    select_view(page, 'alerts')
    return [cell(
        page, shots, 'maint-alerts', 'preview', 'es', 1440, 'light',
        'monitoring alert preview, explicitly demo data in this phase',
        lambda: (
            'rows=' + str(page.locator('.maint-row--alert').count())
            + ' note=' + page.locator('.maint-note--preview strong').inner_text().strip()
        ),
    )]


def run_sibling_dialogs(page, shots):
    """Bounded sibling check for the shared ``.modal .form-grid--two`` collapse.

    The collapse lives in ``assets/css/operations.css`` and applies to every modal,
    not only the four maintenance dialogs. The only other modal that uses that grid is
    the operations movement dialog, so this opens it at 390 and measures it instead of
    claiming compatibility from Node tests alone.
    """
    rows = []
    assets = page.evaluate(
        """async () => {
            const response = await fetch('/api/v1/assets?limit=1', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) return [];
            const payload = await response.json();
            return (payload.items || []).map((item) => ({ id: item.id, name: item.name }));
        }"""
    )
    if not assets:
        print('UNAVAILABLE sibling movement dialog: the install exposes no asset to open')
        return rows
    goto_hash(page, '#/activo/' + assets[0]['id'])
    page.wait_for_timeout(900)
    trigger = page.locator('[data-od-id="asset-movements"] button')
    if trigger.count() == 0:
        print(
            'UNAVAILABLE sibling movement dialog: the prototype movements panel is'
            ' gated by v-if="!serverAssetMode", and this install is server-authoritative,'
            ' so no other modal uses the shared two-column grid here'
        )
        return rows

    def opener():
        trigger.first.click()
        page.locator('.modal[role="dialog"]').wait_for(state='visible')

    dialog_cell(
        page, shots, rows, 'movement-step1', 'es', 390, 'light',
        'sibling operations dialog under the shared modal grid collapse',
        opener, label='ops-dialog',
    )
    return rows


def run_marked(page, base, shots):
    rows = []
    rows += run_agenda(page, base, shots)
    rows += run_kpi_selection(page, shots)
    rows += run_interventions(page, shots)
    select_view(page, 'agenda')
    mark = write_count(page)
    rows += run_dialog_cancel(page, shots, mark)
    rows += run_loading(page, shots)
    rows += run_error(page, shots)
    rows += run_incident_detail(page, base, shots)
    rows += run_alerts(page, shots)
    rows += run_sibling_dialogs(page, shots)
    return rows


def run_ordinary(page, base, shots):
    rows = []
    open_maintenance(page, 'es')
    # This install never resets, so it is the safe place to force one failed estate
    # count with a fresh boot: the card must say it does not know, the surface must
    # say the counts are unavailable, and the empty list must keep its own copy.
    page.route('**/api/v1/maintenance/plans?state=upcoming**', lambda route: route.fulfill(
        status=503, content_type='application/json',
        body=json.dumps({'error': {'code': 'unavailable', 'message': 'maintenance read failed upstream'}})))
    page.reload()
    wait_mounted(page)
    set_locale(page, 'en')
    open_maintenance(page, 'en', recover=False)
    rows.append(cell(
        page, shots, 'maint-agenda', 'estate-unknown', 'en', 1440, 'light',
        'a failed estate count is marked unknown and reported; the empty list keeps its copy',
        lambda: assert_estate_unknown(page, 'en'),
    ))
    page.unroute_all(behavior='ignoreErrors')
    page.reload()
    wait_mounted(page)
    set_locale(page, 'es')
    open_maintenance(page, 'es')
    rows.append(cell(
        page, shots, 'maint-agenda', 'empty', 'es', 1440, 'light',
        'empty installation: no preventive plan scheduled yet',
        lambda: assert_empty(page, 'es', COPY['es']['empty_plans'], False),
    ))
    select_view(page, 'interventions')
    rows.append(cell(
        page, shots, 'maint-interventions', 'empty', 'en', 390, 'dark',
        'empty installation: no intervention recorded yet, phone dark',
        lambda: assert_empty(page, 'en', COPY['en']['empty_interventions'], False),
        rows=True,
    ))
    select_view(page, 'incidents')
    rows.append(cell(
        page, shots, 'maint-incidents', 'empty', 'es', 1440, 'light',
        'empty installation: no incident recorded yet',
        lambda: assert_empty(page, 'es', COPY['es']['empty_incidents'], False),
    ))
    # The read is stubbed so this state does not depend on the per-route request budget:
    # a live 422 or 429 is itself a truthful state, but neither is the missing record
    # this row exists to show. The server mapping stays proven by the component test.
    page.route('**/api/v1/incidents/*', fulfill_error(404, 'not_found', 'incident not found'))
    goto_hash(page, '#/mantenimiento/incidente/incidente-inexistente')
    page.wait_for_function("() => !document.querySelector('.loading-state')")
    rows.append(cell(
        page, shots, 'incident-detail', 'missing', 'en', 1440, 'light',
        'unknown incident id on an empty installation',
        lambda: assert_detail_missing(page, 'en'),
    ))
    page.unroute_all(behavior='ignoreErrors')
    return rows


def drive(browser, base, label, username, password, notice_expected, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    try:
        wait_ready(base, label)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
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
