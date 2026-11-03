"""Isolated U1 visual coverage: login, access denied, users, user detail.

Every capture is a real Chromium render of the disposable installation that
``tests/demo-indicator.browser.py`` starts for the marked and ordinary
scenarios; this module only replaces that fixture's ``drive`` function.

Bounded scope, no production mutation:

* the login surface is exercised empty, with the password revealed, with one
  real rejected credential pair, and while a submit is in flight;
* the in-flight state is produced at the HTTP boundary with Chromium's network
  latency emulation (CDP), not by faking the component state, and the emulation
  is removed before the real login completes;
* the access-denied presentation is reached through its known hash route
  ``#/acceso-denegado`` so no account's permissions are weakened; the guard that
  redirects a non-authorized account is covered by unit tests, not by this
  visual pass;
* dialogs are opened and cancelled only, never submitted;
* the missing-user state uses a hash identifier that does not exist.

Assertions describe painted outcomes (visibility, focus, ARIA state, disabled
state, non-empty text, no horizontal overflow), never source or catalog text.
"""

import importlib.util
from pathlib import Path

from playwright.sync_api import expect

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("u1fixture", root / "tests/demo-indicator.browser.py")
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

MISSING_ACCOUNT = "00000000-0000-4000-8000-00000000dead"
NO_MATCH_QUERY = "zzz-sin-coincidencias-zzz"


def locale(page, tag):
    page.evaluate(
        "async (value) => { await ItsmI18n.loadBundle(value); ItsmI18n.setLocale(value); }",
        tag,
    )
    effective = page.evaluate(
        "() => { const engine = ItsmI18n.engine; const global = engine && engine.global;"
        " if (!global) return null; return typeof global.locale === 'string' ? global.locale : global.locale.value; }"
    )
    assert effective == tag, (effective, tag)


def theme_on(page, theme, scope):
    if page.evaluate("() => document.documentElement.dataset.theme") != theme:
        page.locator(f"{scope} .theme-toggle").first.click()
        page.wait_for_function(
            "(target) => document.documentElement.dataset.theme === target", arg=theme
        )
    assert page.evaluate("() => document.documentElement.dataset.theme") == theme, theme


def settle(page):
    page.wait_for_function(
        "() => !document.querySelector('.page-enter-active,.page-leave-active,.auth-enter-active')"
    )


def overlay_painted(page):
    """Wait until the teleported modal layer is fully painted.

    The layer enters with a 200ms opacity transition; under the reduced-motion
    context that duration collapses to 0.01ms, but the first painted frame can
    still carry ``modal-enter-from`` (opacity 0). Waiting for the enter classes
    to clear keeps a captured overlay from being an invisible frame.
    """
    page.wait_for_function(
        "() => { const layer = document.querySelector('.modal-layer');"
        " if (!layer) return false;"
        " if (layer.classList.contains('modal-enter-active') || layer.classList.contains('modal-enter-from')) return false;"
        " return getComputedStyle(layer).opacity === '1'; }"
    )


def assert_no_overflow(page, where):
    width = page.evaluate("() => window.innerWidth")
    scroll = page.evaluate("() => document.documentElement.scrollWidth")
    assert scroll <= width, ("horizontal-overflow", where, scroll, width)
    return width - scroll


def capture(page, shots, rows, name, note):
    path = shots / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    slack = assert_no_overflow(page, name)
    rows.append(f"SHOT {name} overflow-slack={slack}px {note} file={path}")
    print(rows[-1])
    return path


MASK_GLYPHS = "\u2022\u00b7\u25cf\u002a\u2731\u2732\u2733\u2734\u2735\u2736\u2737\u2738\u2739\u273a\u273b\u273c\u273d"


def assert_password_placeholder(page, tag):
    """An empty password field must not look pre-filled or masked.

    A placeholder made of bullet glyphs reads as existing input, so either a
    short localized label or no placeholder is acceptable; the field value must
    stay empty and the rendered text must come from the catalog.
    """
    data = page.evaluate(
        "() => { const el = document.querySelector('#login-password');"
        " return { value: el.value, type: el.type, masked: el.type === 'password',"
        "   placeholder: el.placeholder,"
        "   expected: ItsmI18n.t('ui.login.password_placeholder') }; }"
    )
    assert data["value"] == "", ("login-password-prefilled", tag, data)
    assert data["masked"], ("login-password-not-masked", tag, data)
    assert data["placeholder"] == data["expected"], ("login-password-placeholder-catalog", tag, data)
    awkward = [ch for ch in data["placeholder"] if ch in MASK_GLYPHS]
    assert not awkward, ("login-password-placeholder-masked", tag, data)
    assert len(data["placeholder"]) <= 32, ("login-password-placeholder-long", tag, data)


def login_surface(browser_base, page, label, username, password, shots, rows):
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.goto(f"{browser_base}/#/login", wait_until="networkidle")
    theme_on(page, "light", ".login")
    locale(page, "es")
    expect(page.locator("#login-title")).to_be_visible()
    expect(page.locator(".app-shell")).to_have_count(0)
    assert_password_placeholder(page, "login-empty-1440-light-es")
    capture(page, shots, rows, f"{label}-login-empty-1440-light-es", "login, empty form")

    page.set_viewport_size({"width": 390, "height": 844})
    theme_on(page, "dark", ".login")
    locale(page, "en")
    assert_password_placeholder(page, "login-empty-390-dark-en")
    capture(page, shots, rows, f"{label}-login-empty-390-dark-en", "login, empty form, narrow")

    page.set_viewport_size({"width": 1440, "height": 1000})
    theme_on(page, "light", ".login")
    locale(page, "es")

    action = page.locator(".login-form .input-action")
    page.locator("#login-password").fill("valor-visible-temporal")
    expect(action).to_have_attribute("aria-pressed", "false")
    expect(page.locator("#login-password")).to_have_attribute("type", "password")
    action.click()
    expect(page.locator("#login-password")).to_have_attribute("type", "text")
    expect(action).to_have_attribute("aria-pressed", "true")
    capture(page, shots, rows, f"{label}-login-reveal-1440-light-es", "login, password revealed")
    action.click()
    expect(page.locator("#login-password")).to_have_attribute("type", "password")
    page.locator("#login-password").fill("")

    page.locator("#login-user").fill(username)
    page.locator("#login-password").fill("rejected-credential-probe")
    page.locator(".login-submit").click()
    alert = page.locator(".login-form .form-alert[role='alert']")
    expect(alert).to_be_visible()
    assert alert.inner_text().strip(), "rejected login must explain itself"
    expect(page.locator("#login-title")).to_be_visible()
    expect(page.locator(".app-shell")).to_have_count(0)
    capture(page, shots, rows, f"{label}-login-invalid-1440-light-es", "login, rejected credentials")

    page.goto(f"{browser_base}/#/login", wait_until="networkidle")
    theme_on(page, "light", ".login")
    locale(page, "es")
    page.locator("#login-user").fill(username)
    page.locator("#login-password").fill(password)
    client = page.context.new_cdp_session(page)
    client.send("Network.enable")
    client.send(
        "Network.emulateNetworkConditions",
        {"offline": False, "latency": 1500, "downloadThroughput": -1, "uploadThroughput": -1},
    )
    try:
        page.locator(".login-submit").click()
        submit = page.locator(".login-submit")
        expect(submit).to_be_disabled()
        expect(page.locator(".login-submit .spinner")).to_be_visible()
        assert page.locator(".login-submit").inner_text().strip(), "busy label"
        capture(page, shots, rows, f"{label}-login-busy-1440-light-es", "login, submit in flight (CDP latency 1500ms)")
    finally:
        client.send(
            "Network.emulateNetworkConditions",
            {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1},
        )
    expect(page.locator(".app-shell")).to_be_visible()
    rows.append(f"LOGIN {label}: busy state released by the real session, shell visible")
    print(rows[-1])


def assert_actions_inside_cell(page, tag):
    """Action buttons may wrap but must never clip outside their own cell.

    The users table is a six-column fixed layout; three labelled actions do not
    fit the 15% actions column at 1440, and widening it would starve the data
    columns. ``.quick-actions`` wraps by design system contract, so the painted
    requirement is containment, not a single line.
    """
    metrics = page.evaluate(
        "() => { const rows = Array.from(document.querySelectorAll('.access-users-table tbody tr'));"
        " const cells = rows.map((row) => row.querySelector('.access-actions')).filter(Boolean);"
        " if (!cells.length) return null;"
        " const cell = cells.sort((a, b) => b.querySelectorAll('button').length - a.querySelectorAll('button').length)[0];"
        " const cluster = cell.querySelector('.quick-actions');"
        " const box = cell.getBoundingClientRect();"
        " const buttons = Array.from(cluster.children).map((el) => el.getBoundingClientRect());"
        " return { buttons: buttons.length,"
        "   cellWidth: Math.round(box.width), need: Math.round(cluster.scrollWidth),"
        "   overflow: Math.round(Math.max(0, ...buttons.map((b) => b.right - box.right))),"
        "   escape: Math.round(Math.max(0, ...buttons.map((b) => box.left - b.left))) }; }"
    )
    assert metrics and metrics["buttons"] >= 2, ("users-actions-missing", tag, metrics)
    assert metrics["need"] <= metrics["cellWidth"] + 1, ("users-actions-overflow", tag, metrics)
    assert metrics["overflow"] <= 2 and metrics["escape"] <= 2, ("users-actions-clipped", tag, metrics)


def assert_results_plural(page, tag):
    """A single account must not be described with the plural form."""
    forms = page.evaluate(
        "() => [ItsmI18n.t('ui.access.results_count', { shown: 1, total: 1, count: 1 }),"
        "        ItsmI18n.t('ui.access.results_count', { shown: 1, total: 1, count: 2 })]"
    )
    assert forms[0] != forms[1], ("results-count-plural-forms", tag, forms)
    total = page.locator(".access-stat strong").first.inner_text().strip()
    assert total.isdigit(), ("results-count-total", tag, total)
    expected = page.evaluate(
        "(total) => ItsmI18n.t('ui.access.results_count', { shown: Number(total), total: Number(total), count: Number(total) })",
        total,
    )
    painted = page.locator(".access-results").inner_text().strip()
    assert painted == expected.strip(), ("results-count-rendered", tag, painted, expected)


def users_matrix(page, label, shots, rows):
    page.goto(page.evaluate("() => location.href").split("#")[0] + "#/usuarios", wait_until="networkidle")
    expect(page.locator("#access-users-title")).to_be_visible()
    settle(page)
    for width, height in [(1440, 1000), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        for theme in ["light", "dark"]:
            theme_on(page, theme, ".app-shell")
            for tag in ["es", "en"]:
                locale(page, tag)
                sizes = page.locator(".access-stat small").evaluate_all(
                    "(els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize))"
                )
                assert sizes and min(sizes) >= 11, ("summary-label-size", sizes)
                if width == 390:
                    box = page.locator(".access-stats").bounding_box()
                    assert box and box["height"] <= 100, ("mobile-summary-height", box)
                    columns = page.locator(".access-stats").evaluate(
                        "(el) => getComputedStyle(el).gridTemplateColumns.split(' ').length"
                    )
                    assert columns == 3, ("mobile-summary-columns", columns)
                    icon = page.locator(".access-users .access-stat__icon").first.evaluate(
                        "(el) => getComputedStyle(el).display"
                    )
                    assert icon == "none", ("mobile-summary-icon", icon)
                if width == 1440:
                    assert_actions_inside_cell(page, tag)
                    assert_results_plural(page, tag)
                capture(
                    page,
                    shots,
                    rows,
                    f"{label}-users-{width}-{theme}-{tag}",
                    "users list",
                )


def users_states(page, label, shots, rows):
    page.set_viewport_size({"width": 1440, "height": 1000})
    theme_on(page, "light", ".app-shell")
    locale(page, "es")
    search = page.locator(".access-toolbar .search-field input")
    search.fill(NO_MATCH_QUERY)
    empty = page.locator(".access-users .empty-state")
    expect(empty).to_be_visible()
    assert empty.inner_text().strip(), "no-results state must name itself"
    expect(page.locator(".access-users-table")).to_have_count(0)
    capture(page, shots, rows, f"{label}-users-no-results-1440-light-es", "users, filter without matches")

    page.set_viewport_size({"width": 390, "height": 844})
    theme_on(page, "dark", ".app-shell")
    locale(page, "en")
    expect(empty).to_be_visible()
    capture(page, shots, rows, f"{label}-users-no-results-390-dark-en", "users, filter without matches, narrow")
    search.fill("")
    expect(page.locator(".access-users-table")).to_be_visible()

    page.set_viewport_size({"width": 1440, "height": 1000})
    theme_on(page, "light", ".app-shell")
    locale(page, "es")
    dialog = page.locator(".modal-layer .modal[role='dialog']")
    page.locator(".access-users .page-head__actions button.btn--primary").click()
    dialog.wait_for(state="attached")
    overlay_painted(page)
    expect(dialog).to_be_visible()
    expect(dialog).to_have_attribute("aria-modal", "true")
    assert page.evaluate(
        "() => { const d = document.querySelector('.modal-layer .modal');"
        " return !!d && d.contains(document.activeElement); }"
    ), "dialog must own focus"
    capture(page, shots, rows, f"{label}-user-create-dialog-1440-light-es", "users, create dialog open")
    page.locator(".modal-layer .modal__foot .btn--ghost").click()
    expect(dialog).to_have_count(0)

    label_edit = page.evaluate("() => ItsmI18n.t('ui.people.edit')")
    editable = page.locator(".access-users-table tbody tr").filter(
        has=page.get_by_role("button", name=label_edit, exact=True)
    )
    if editable.count():
        editable.first.get_by_role("button", name=label_edit, exact=True).click()
        overlay_painted(page)
        expect(dialog).to_be_visible()
        capture(page, shots, rows, f"{label}-user-edit-dialog-1440-light-es", "users, edit dialog open")
        page.locator(".modal-layer .modal__foot .btn--ghost").click()
        expect(dialog).to_have_count(0)
    else:
        rows.append(f"UNAVAILABLE {label}: no editable account row in this installation")
        print(rows[-1])


def detail_states(page, base, label, shots, rows):
    page.set_viewport_size({"width": 1440, "height": 1000})
    theme_on(page, "light", ".app-shell")
    locale(page, "es")
    link = page.locator(".access-user-cell__name").first
    expect(link).to_be_visible()
    link.click()
    settle(page)
    page.wait_for_load_state("networkidle")
    expect(page.locator(".access-detail-grid")).to_be_visible()
    capture(page, shots, rows, f"{label}-user-detail-1440-light-es", "user detail")

    page.set_viewport_size({"width": 390, "height": 844})
    theme_on(page, "dark", ".app-shell")
    locale(page, "en")
    expect(page.locator(".access-detail-grid")).to_be_visible()
    capture(page, shots, rows, f"{label}-user-detail-390-dark-en", "user detail, narrow")

    page.goto(f"{base}/#/usuario/{MISSING_ACCOUNT}", wait_until="networkidle")
    settle(page)
    missing = page.locator(".access-empty-page .empty-state")
    expect(missing).to_be_visible()
    assert missing.inner_text().strip(), "missing-account state must name itself"
    expect(page.locator(".access-detail-grid")).to_have_count(0)
    capture(page, shots, rows, f"{label}-user-missing-390-dark-en", "user detail, unknown identifier")


def denied_state(page, base, label, shots, rows):
    page.goto(f"{base}/#/acceso-denegado", wait_until="networkidle")
    settle(page)
    title = page.locator("#access-denied-title")
    expect(title).to_be_visible()
    assert title.inner_text().strip(), "denied view must keep its heading"
    page.set_viewport_size({"width": 1440, "height": 1000})
    theme_on(page, "light", ".app-shell")
    locale(page, "es")
    capture(page, shots, rows, f"{label}-access-denied-1440-light-es", "access denied route")
    measure = page.evaluate(
        "() => { const page = document.querySelector('.access-denied');"
        " const button = page.querySelector('.btn');"
        " return { page: Math.round(page.getBoundingClientRect().width),"
        "          button: Math.round(button.getBoundingClientRect().width) }; }"
    )
    assert measure["button"] <= measure["page"] * 0.5, ("denied-button-stretch", measure)

    page.set_viewport_size({"width": 390, "height": 844})
    theme_on(page, "dark", ".app-shell")
    locale(page, "en")
    expect(title).to_be_visible()
    narrow = page.evaluate(
        "() => { const page = document.querySelector('.access-denied');"
        " const button = page.querySelector('.btn');"
        " return { page: Math.round(page.getBoundingClientRect().width),"
        "          button: Math.round(button.getBoundingClientRect().width) }; }"
    )
    assert narrow["button"] >= narrow["page"] * 0.7, ("denied-button-narrow", narrow)
    capture(page, shots, rows, f"{label}-access-denied-390-dark-en", "access denied route, narrow")


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    rows = []
    try:
        login_surface(base, page, label, username, password, shots, rows)
        users_matrix(page, label, shots, rows)
        users_states(page, label, shots, rows)
        detail_states(page, base, label, shots, rows)
        denied_state(page, base, label, shots, rows)

        page.set_viewport_size({"width": 1440, "height": 1000})
        theme_on(page, "light", ".app-shell")
        locale(page, "es")
        page.goto(f"{base}/#/usuarios", wait_until="networkidle")
        settle(page)
        f.logout(page)
        assert not errors, errors
        rows.append(f"PAGEERRORS {label}: 0")
        print(rows[-1])
        return rows
    finally:
        context.close()


f.drive = drive
raise SystemExit(f.main())
