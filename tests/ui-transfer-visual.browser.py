#!/usr/bin/env python3
"""Bounded browser verification for the transfer (import/export) views.

Disposable fixture: one uniquely named SQLite install, loopback ports, test-only
credentials, no .env, no live providers, no device access. Every state is
captured through the real application in the ordinary (non-demo) install and
asserted in the same pass, so a screenshot can never claim more than the checks
that ran beside it.

Usage: python3 tests/ui-transfer-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent


def _load_fixture():
    spec = importlib.util.spec_from_file_location(
        "transfer_fixture", Path(__file__).with_name("demo-indicator.browser.py")
    )
    assert spec and spec.loader, "the shared disposable fixture must be importable"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()

SCRATCH = FRONTEND / ".verification" / ("ui-transfer-visual-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH  # process logs and isolated state land in this run

BACKEND = fixture.BACKEND
PYTHON = fixture.PYTHON
PASSWORD = "Transfer-View-Pass-9k2"
USERNAME = "transfer.admin"
VIEWPORTS = ((1440, 1000), (390, 844))
THEMES = ("light", "dark")
LOCALES = ("es", "en")

ROUTE_IMPORT = "#/datos/importar"
ROUTE_EXPORT = "#/datos/exportar"
PAGE_MARKER = '[data-od-id="data-transfer"]'

FOOT_CHOOSE = {"es": "Elige un archivo para continuar.", "en": "Choose a file to continue."}
FOOT_SHEET = {"es": "Selecciona al menos una hoja.", "en": "Select at least one sheet."}
PREVIEW_EMPTY = {
    "es": "El inventario cargado no tiene activos para previsualizar.",
    "en": "The loaded inventory has no assets to preview.",
}
PROTOTYPE_IDS = ("AM-1042", "AM-1043", "AM-1044")
SHEET_BOUNDS = {
    "es": ("2 filas", "4 columnas"),
    "en": ("2 rows", "4 columns")
}
SELECT_FILE = {
    "es": "Seleccionar archivo Excel o CSV",
    "en": "Select an Excel or CSV file"
}
# The format controls are UI copy: every label has to follow the selected locale
# while the values sent to the server stay symbols ("," / ";").
SEPARATOR_OPTIONS = {
    "es": ("Punto y coma (;)", "Coma (,)"),
    "en": ("Semicolon (;)", "Comma (,)")
}
FORMAT_COPY = {
    "es": {
        "label": "Separador de columnas",
        "checks": ("Incluir fila de encabezados", "Incluir columnas sin datos", "Compatible con Excel en español"),
        "foreign": ("Semicolon (;)", "Comma (,)", "Column separator", "Include a header row"),
    },
    "en": {
        "label": "Column separator",
        "checks": ("Include a header row", "Include columns without data", "Compatible with Spanish Excel"),
        "foreign": ("Punto y coma (;)", "Coma (,)", "Separador de columnas", "Incluir fila de encabezados"),
    },
}
SEEDED = (
    {"name": "Router de borde", "serial": "SN-EDGE-1", "quickCode": "TX-0001"},
    {"name": "Notebook de guardia", "serial": "SN-NOTE-2", "quickCode": "TX-0002"},
)
BULK_CONFLICT = (
    "Actualizar todas con la coincidencia principal",
    "Update all with the main match",
)
FORMAT_NOTE = (
    "El servidor aplica el separador, los encabezados, el BOM y las columnas vacías",
    "server applies the separator, the headers, the BOM and the empty columns",
)
RECENT_EXPORTS = ("Exportaciones recientes", "Recent exports")
RECENT_IMPORTS = ("Historial reciente", "Recent history")

SAMPLE_CSV = (
    "nombre,serie,ip,sede\n"
    "Router de borde,SN-EDGE-1,10.20.0.1,Central\n"
    "Notebook nueva,SN-NEW-9,10.20.0.2,Central\n"
)

RESULTS: list[str] = []
FAILURES: list[str] = []


def record(line: str) -> None:
    RESULTS.append(line)
    print(line, flush=True)


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"FAIL {message}", flush=True)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def absent(text: str, needles: tuple[str, ...], label: str) -> None:
    for needle in needles:
        require(needle not in text, f"{label}: unexpected copy present {needle!r}")


def present(text: str, needles: tuple[str, ...], label: str) -> None:
    for needle in needles:
        require(needle in text, f"{label}: expected copy missing {needle!r}")


def set_locale(page, tag: str) -> None:
    """Switch locale through the product's own i18n API, one bundle load per tag."""
    page.evaluate(
        """async (tag) => {
          window.__transferBundles = window.__transferBundles || {};
          if (!window.__transferBundles[tag]) {
            await window.ItsmI18n.loadBundle(tag);
            window.__transferBundles[tag] = true;
          }
          window.ItsmI18n.setLocale(tag);
        }""",
        tag,
    )


def settle(page) -> None:
    page.wait_for_function(
        """() => !document.querySelector(
          '.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active'
        )"""
    )
    # A theme switch animates colours on some surfaces and not others: capture
    # the settled frame, never the cross-fade.
    try:
        page.wait_for_function(
            "() => document.getAnimations().every((item) => item.playState !== 'running')",
            timeout=5000,
        )
    except Exception:
        pass


def open_route(page, base: str, route: str) -> None:
    # A same-URL navigation is a no-op in Chromium, so every state starts from a
    # real document load and re-reads the canonical inventory it must show.
    page.goto("about:blank")
    page.goto(base + "/" + route)
    page.wait_for_selector(PAGE_MARKER, state="visible")
    settle(page)


def wait_text(page, needle: str, timeout: int = 20000) -> None:
    page.wait_for_function(
        "(needle) => document.body.innerText.includes(needle)", arg=needle, timeout=timeout
    )


def body_text(page) -> str:
    return page.evaluate("() => document.body.innerText")


def overflow(page) -> float:
    return page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )


def shot(page, shots: Path, state: str, locale: str, width: int, theme: str, route: str) -> None:
    name = f"{state}-{locale}-{width}-{theme}.png"
    # A sticky shell header is captured where the page is scrolled: shoot from the top.
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(80)
    page.screenshot(path=str(shots / name), full_page=True)
    record(f"SHOT {name} route={route} locale={locale} theme={theme} viewport={width}")


# ---------------------------------------------------------------- state checks


def check_import_empty(page, locale: str, width: int) -> None:
    label = f"import-empty/{locale}/{width}"
    text = body_text(page)
    present(text, (FOOT_CHOOSE[locale],), label)
    absent(text, (FOOT_SHEET[locale],) + RECENT_IMPORTS, label)
    require(
        page.locator('[data-od-id="transfer-continue"]').first.is_disabled(),
        f"{label}: continue must stay disabled without a source file",
    )
    picker = page.evaluate(
        """() => {
          const input = document.querySelector('#tx-real-file');
          if (!input) return null;
          const field = input.closest('.field') || input.parentElement;
          const action = field && field.querySelector('label[for="tx-real-file"]');
          const box = input.getBoundingClientRect();
          const css = getComputedStyle(input);
          return {
            width: Math.round(box.width),
            height: Math.round(box.height),
            opacity: parseFloat(css.opacity),
            text: action ? action.textContent.replace(/\\s+/g, ' ').trim() : '',
            focusable: input.tabIndex >= 0 && !input.disabled
          };
        }"""
    )
    require(picker is not None, f"{label}: the real file input must exist")
    if picker:
        # The native control paints its own text in the browser locale, so it must not
        # be the visible action: its localized label is.
        require(picker["width"] <= 2 and picker["height"] <= 2,
                f"{label}: the OS file control is the visible action {picker}")
        require(picker["opacity"] <= 0.01, f"{label}: the OS file control is still painted {picker}")
        require(picker["text"] == SELECT_FILE[locale],
                f"{label}: the visible file action is not localized {picker}")
        require(picker["focusable"], f"{label}: the file input must stay keyboard reachable {picker}")
    ring = page.evaluate(
        """() => {
          const input = document.querySelector('#tx-real-file');
          if (!input) return null;
          input.focus();
          const action = (input.closest('.field') || input.parentElement).querySelector('label[for="tx-real-file"]');
          const css = getComputedStyle(action);
          return {focused: document.activeElement === input, outline: css.outlineStyle, width: css.outlineWidth};
        }"""
    )
    require(ring is not None, f"{label}: the file action must be measurable")
    if ring:
        require(ring["focused"], f"{label}: keyboard focus does not reach the file input {ring}")
        require(ring["outline"] != "none" and ring["width"] not in ("0px", "0"),
                f"{label}: the focused file action has no visible ring {ring}")
    chooser = []
    try:
        with page.expect_file_chooser(timeout=4000) as caught:
            page.locator('label[for="tx-real-file"]').first.click()
        chooser.append(caught.value)
    except Exception as error:  # noqa: BLE001 - reported as a failed requirement
        raise AssertionError(f"{label}: the visible file action opens no chooser: {error}")
    require(bool(chooser), f"{label}: the visible file action opens no chooser")
    footer = page.evaluate(
        """() => {
          const button = document.querySelector('[data-od-id="transfer-continue"]');
          const css = getComputedStyle(button);
          return {opacity: parseFloat(css.opacity), shadow: css.boxShadow};
        }"""
    )
    require(footer["opacity"] <= 0.55,
            f"{label}: the disabled action is not visibly inert {footer}")
    head_action(page, ".tx-panel", width, label)
    require(overflow(page) <= 1, f"{label}: horizontal overflow {overflow(page)}px")


def head_action(page, section: str, width: int, label: str) -> None:
    """A panel head keeps its secondary action beside the title, never stretched."""
    tools = page.evaluate(
        """(section) => {
          const panel = document.querySelector(section);
          const head = panel && panel.querySelector('.tx-panel__head');
          const button = head && head.querySelector('.tx-panel__tools .btn');
          const title = head && head.querySelector('h2');
          if (!button || !title) return null;
          const box = button.getBoundingClientRect();
          const panelBox = panel.getBoundingClientRect();
          return {width: Math.round(box.width), right: Math.round(box.right),
                  panelRight: Math.round(panelBox.right),
                  offset: Math.round(box.top - title.getBoundingClientRect().top)};
        }""",
        section,
    )
    require(tools is not None, f"{label}: the profiles action must be reachable")
    if width >= 1000:
        require(tools["panelRight"] - tools["right"] <= 30,
                f"{label}: the head action is not aligned with the panel {tools}")
        require(abs(tools["offset"]) <= 40,
                f"{label}: the head action wrapped below the title {tools}")
    else:
        require(tools["width"] <= 220, f"{label}: the head action is stretched {tools}")


def check_format_copy(page, locale: str) -> None:
    """The delivery controls must be labelled in the active locale, values intact."""
    label = f"export-format/{locale}"
    data = page.evaluate(
        r"""() => {
          const select = document.querySelector('#tx-export-separator');
          if (!select) return null;
          const label = document.querySelector('label[for="tx-export-separator"]');
          const section = document.querySelector('[data-od-id="export-format"]');
          return {
            options: [...select.options].map((option) => option.textContent.trim()),
            value: select.value,
            label: label ? label.textContent.trim() : '',
            text: section ? section.innerText.replace(/\s+/g, ' ').trim() : ''
          };
        }"""
    )
    require(data is not None, f"{label}: the separator control is missing")
    require(
        tuple(data["options"]) == SEPARATOR_OPTIONS[locale],
        f"{label}: separator options are {data['options']}",
    )
    require(data["value"] == ",", f"{label}: the default separator value changed to {data['value']!r}")
    require(data["label"] == FORMAT_COPY[locale]["label"], f"{label}: label is {data['label']!r}")
    present(data["text"], FORMAT_COPY[locale]["checks"], label)
    absent(data["text"], FORMAT_COPY[locale]["foreign"], label)


def check_export_empty(page, locale: str, width: int) -> None:
    label = f"export-empty/{locale}/{width}"
    text = body_text(page)
    present(text, (PREVIEW_EMPTY[locale],), label)
    absent(text, PROTOTYPE_IDS + RECENT_EXPORTS + FORMAT_NOTE, label)
    require(
        page.locator("#tx-export-separator").count() == 1,
        f"{label}: the separator control is a real request option and must stay",
    )
    absent(text, ("separado por comas", "comma-separated CSV"),
           f"{label}: the lead contradicts the separator control")
    head_action(page, '[data-od-id="export-fields"]', width, label)
    check_format_copy(page, locale)
    require(overflow(page) <= 1, f"{label}: horizontal overflow {overflow(page)}px")


def check_export_populated(page, locale: str, width: int) -> None:
    label = f"export-populated/{locale}/{width}"
    text = body_text(page)
    for spec in SEEDED:
        require(spec["name"] in text, f"{label}: preview must list {spec['name']!r}")
    absent(text, PROTOTYPE_IDS + RECENT_EXPORTS, label)
    require(overflow(page) <= 1, f"{label}: horizontal overflow {overflow(page)}px")


def capture_matrix(page, shots: Path, state: str, route: str, ready: dict, base: str, check) -> None:
    for locale in LOCALES:
        for width, height in VIEWPORTS:
            for theme in THEMES:
                page.set_viewport_size({"width": width, "height": height})
                open_route(page, base, route)
                set_locale(page, locale)
                wait_text(page, ready[locale])
                fixture.set_theme(page, theme)
                settle(page)
                check(page, locale, width)
                shot(page, shots, state, locale, width, theme, route)
    page.set_viewport_size({"width": 1440, "height": 1000})


# ---------------------------------------------------------------- import flow


def click_checked(page, selector: str, label: str, shots: Path) -> None:
    """Click, and on failure record what blocked the pointer instead of guessing."""
    try:
        page.locator(selector).first.click()
    except Exception:
        diagnostic = page.evaluate(
            """(selector) => {
              const nodes = Array.from(document.querySelectorAll(selector));
              const node = nodes[0] || null;
              const rect = node ? node.getBoundingClientRect() : null;
              const centre = rect ? document.elementFromPoint(
                Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)) : null;
              return {
                count: nodes.length,
                disabled: node ? node.disabled === true : null,
                box: rect ? [rect.x, rect.y, rect.width, rect.height] : null,
                viewport: [window.innerWidth, window.innerHeight],
                scroll: [window.scrollX, window.scrollY],
                centre: centre ? (centre.tagName + '.' + centre.className).slice(0, 120) : null,
                centreText: centre ? (centre.textContent || '').trim().slice(0, 80) : null
              };
            }""",
            selector,
        )
        record(f"DIAG click-{label} {diagnostic}")
        page.screenshot(path=str(shots / f"debug-click-{label}.png"), full_page=False)
        raise


def reskin(page, locale: str, theme: str, width: int, height: int,
           overlay_open: bool = False) -> None:
    """Re-render the current state in another locale/theme/viewport.

    An open modal layer intercepts the pointer, so the theme toggle is driven
    through the same button handler instead of a click on the shell.
    """
    page.set_viewport_size({"width": width, "height": height})
    set_locale(page, locale)
    current = page.evaluate("() => document.documentElement.dataset.theme")
    if current != theme:
        if overlay_open:
            page.evaluate("() => document.querySelector('.app-shell .theme-toggle').click()")
        else:
            fixture.set_theme(page, theme)
        page.wait_for_function("(theme) => document.documentElement.dataset.theme === theme",
                               arg=theme, timeout=10000)
    settle(page)


def drive_import(page, base: str, sample: Path, shots: Path, width: int, height: int,
                 apply: bool, locale: str = "es", theme: str = "light") -> None:
    """Walk the real import steps; only the last pass applies the operation."""
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, base, ROUTE_IMPORT)
    set_locale(page, locale)
    fixture.set_theme(page, theme)
    page.set_input_files("#tx-real-file", str(sample))
    page.wait_for_selector(".tx-sheet", state="visible")
    settle(page)
    sheet_text = page.locator(".tx-source__sheets").inner_text().replace("\n", " | ")
    record(f"STATE import-sheets viewport={width} sheets={sheet_text}")
    # A CSV reports its own format as the sheet name and the parsed bounds beside it.
    rows_label, columns_label = SHEET_BOUNDS[locale]
    require(rows_label in sheet_text and columns_label in sheet_text,
            f"import/{locale}/{width}: the detected sheet does not report its bounds: {sheet_text}")
    shot(page, shots, "import-sheets", locale, width, theme, ROUTE_IMPORT)

    page.locator('[data-od-id="transfer-continue"]').click()
    page.wait_for_selector('[data-od-id="transfer-step-panel-2"]', state="visible")
    settle(page)
    columns = page.locator(".tx-map select").count()
    tracks = page.evaluate(
        """() => {
          const row = document.querySelector('.tx-map__entry');
          return row ? getComputedStyle(row).gridTemplateColumns.split(' ').length : 0;
        }"""
    )
    record(f"STATE import-mapping columns={columns} grid_tracks={tracks} viewport={width}")
    require(columns == 4, f"import/{width}: mapping shows {columns} columns, expected 4")
    require(tracks == (4 if width > 820 else 1),
            f"import/{width}: the mapping row uses {tracks} grid tracks")
    shot(page, shots, "import-mapping", locale, width, theme, ROUTE_IMPORT)

    page.locator('[data-od-id="transfer-continue"]').click()
    page.wait_for_selector(".tx-table__row", state="visible")
    settle(page)
    rows = page.locator(".tx-table__row").count()
    record(f"STATE import-analysis rows={rows} viewport={width}")
    require(rows == 2, f"import/{width}: analysis shows {rows} rows, expected 2")
    shot(page, shots, "import-analysis", locale, width, theme, ROUTE_IMPORT)

    page.locator('[data-od-id="transfer-continue"]').click()
    page.wait_for_selector(".tx-conflict", state="visible")
    settle(page)
    conflicts = page.locator(".tx-conflict").count()
    record(f"STATE import-conflicts rows={conflicts} viewport={width}")
    require(conflicts == 1, f"import/{width}: {conflicts} conflicts, expected 1")
    absent(body_text(page), BULK_CONFLICT, f"import-conflicts/{width}")
    shot(page, shots, "import-conflicts", locale, width, theme, ROUTE_IMPORT)

    try:
        page.locator(".tx-conflict .tx-choice").first.click()
    except Exception:
        record("DIAG conflict-choices=" + str(page.locator(".tx-conflict .tx-choice").all_inner_texts()))
        record("DIAG conflict-box=" + str(page.locator(".tx-conflict .tx-choice").first.bounding_box()))
        record("DIAG footer-box=" + str(page.locator(".tx-foot").bounding_box()))
        record("DIAG toasts=" + " | ".join(page.locator(".toast").all_inner_texts()))
        record("DIAG errors=" + str(page.evaluate("() => (window.__pageErrors || []).slice(-3)")))
        page.screenshot(path=str(SCRATCH / f"debug-conflict-{locale}-{width}.png"), full_page=True)
        raise
    page.wait_for_function(
        """() => {
          const next = document.querySelector('[data-od-id="transfer-continue"]');
          return next && !next.disabled;
        }"""
    )
    click_checked(page, '[data-od-id="transfer-continue"]', f"continue-{locale}-{width}", shots)
    page.wait_for_selector('[data-od-id="transfer-final-review"]', state="visible")
    settle(page)
    shot(page, shots, "import-review", locale, width, theme, ROUTE_IMPORT)
    if not apply:
        return

    click_checked(page, '[data-od-id="transfer-apply"]', f"apply-{locale}-{width}", shots)
    page.wait_for_selector('[data-od-id="transfer-confirm-apply"]', state="visible")
    settle(page)
    shot(page, shots, "import-confirm", locale, width, theme, ROUTE_IMPORT)
    reskin(page, "en", "dark", 390, 844, overlay_open=True)
    shot(page, shots, "import-confirm", "en", 390, "dark", ROUTE_IMPORT)
    reskin(page, locale, theme, width, height, overlay_open=True)
    click_checked(page, '[data-od-id="transfer-confirm-apply"]', f"confirm-{locale}-{width}", shots)
    try:
        page.wait_for_selector(".tx-result", state="visible", timeout=60000)
    except Exception:
        record("DIAG body=" + body_text(page)[-1200:].replace("\n", " | "))
        record("DIAG toasts=" + " | ".join(
            page.locator(".toast, .form-error, .tx-progress").all_inner_texts()).replace("\n", " / "))
        for error in page.context.pages[0].evaluate("() => window.__pageErrors || []"):
            record(f"DIAG pageerror={error}")
        raise
    settle(page)
    reskin(page, locale, theme, width, height)
    summary = page.locator(".tx-kpis--result").inner_text().replace("\n", " | ")
    record(f"STATE import-summary viewport={width} kpis={summary}")
    shot(page, shots, "import-summary", locale, width, theme, ROUTE_IMPORT)
    reskin(page, "en", "dark", 390, 844)
    shot(page, shots, "import-summary", "en", 390, "dark", ROUTE_IMPORT)
    reskin(page, locale, theme, width, height)


# ---------------------------------------------------------------- scenario


def seed_assets(page, specs) -> list[dict]:
    return page.evaluate(
        """async (specs) => {
          const me = await (await fetch('/api/v1/auth/me', {credentials: 'same-origin'})).json();
          const token = me.csrfToken || (me.session && me.session.csrfToken) || '';
          const out = [];
          for (const spec of specs) {
            const response = await fetch('/api/v1/assets', {
              method: 'POST',
              credentials: 'same-origin',
              headers: {'Content-Type': 'application/json', 'X-CSRF-Token': token},
              body: JSON.stringify(spec)
            });
            out.push({status: response.status, body: await response.json()});
          }
          return out;
        }""",
        specs,
    )


EXPORT_REQUEST: list[str] = []
EXPORT_RESPONSE: list[tuple[str, str]] = []


def scenario_transfer(shots: Path) -> None:
    db = SCRATCH / "ordinary" / "ordinary.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    api_env = fixture.isolated_state("ordinary")
    api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(db)
    api_env["RELEASE_MODE"] = "prod"
    api_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
    fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], api_env, "migrations")
    fixture.run_command(
        [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
         "--username", USERNAME, "--name", "U8 transfer install"],
        api_env, "bootstrap-superadmin",
    )
    record(f"SETUP ordinary migrations exit=0 bootstrap-superadmin exit=0 db={db}")

    owner = fixture.Owned()
    ports: list[int] = []
    try:
        base, ports = fixture.start_servers(owner, "ordinary", api_env)
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("window.__pageErrors = [];"
                                 " window.addEventListener('error', e => window.__pageErrors.push(String(e.message)));"
                                 " window.addEventListener('unhandledrejection', e => window.__pageErrors.push(String(e.reason)));")
            page.on("request", lambda request: EXPORT_REQUEST.append(request.post_data or "")
                    if request.url.endswith("/assets/export") else None)
            page.on("response", lambda response: EXPORT_RESPONSE.append((
                response.headers.get("content-type", ""),
                response.headers.get("content-disposition", "")))
                    if response.url.endswith("/assets/export") else None)
            fixture.login(page, base, USERNAME, PASSWORD)

            # 1. The two reproduced ordinary states: no assets, no source file.
            capture_matrix(page, shots, "import-empty", ROUTE_IMPORT, FOOT_CHOOSE,
                           base, check_import_empty)
            capture_matrix(page, shots, "export-empty", ROUTE_EXPORT, PREVIEW_EMPTY,
                           base, check_export_empty)

            # 2. Populated inventory through the product's own create endpoint.
            for entry in seed_assets(page, list(SEEDED)):
                record(f"SEED status={entry['status']} id={entry['body'].get('id', '')}")
                require(entry["status"] == 201, f"seeding returned {entry['status']}")

            seeded_name = {locale: SEEDED[0]["name"] for locale in LOCALES}
            capture_matrix(page, shots, "export-populated", ROUTE_EXPORT, seeded_name,
                           base, check_export_populated)

            # 3. Manual selection: still reads the host catalogue (recorded gap).
            page.set_viewport_size({"width": 1440, "height": 1000})
            open_route(page, base, ROUTE_EXPORT)
            set_locale(page, "es")
            fixture.set_theme(page, "light")
            page.locator('[data-od-id="export-scope"] .tx-scope__card').nth(2).click()
            page.wait_for_selector(".tx-picker", state="visible")
            settle(page)
            picker = page.locator(".tx-picker").inner_text()
            record("PICKER prototype_rows="
                   + str(any(pid in picker for pid in PROTOTYPE_IDS))
                   + " canonical_rows=" + str(sum(1 for spec in SEEDED if spec["name"] in picker)))
            require(not any(pid in picker for pid in PROTOTYPE_IDS),
                    f"export-selection: the picker paints the prototype catalogue: {picker[:200]}")
            for spec in SEEDED:
                require(spec["name"] in picker,
                        f"export-selection: the picker omits the seeded asset {spec['name']!r}")
            shot(page, shots, "export-selection", "es", 1440, "light", ROUTE_EXPORT)
            reskin(page, "en", "dark", 390, 844)
            shot(page, shots, "export-selection", "en", 390, "dark", ROUTE_EXPORT)
            reskin(page, "es", "light", 1440, 1000)

            # 4. A real CSV download through the public buttons.
            page.locator('[data-od-id="export-scope"] .tx-scope__card').nth(1).click()
            settle(page)
            with page.expect_download() as download_info:
                page.locator('[data-od-id="export-generate"]').click()
                page.wait_for_selector('[data-od-id="export-download"]', state="visible")
                page.locator('[data-od-id="export-download"]').click()
            download = download_info.value
            record(f"EXPORT request body={EXPORT_REQUEST[0] if EXPORT_REQUEST else 'missing'}")
            require(bool(EXPORT_REQUEST), "export: the request body was not observed")
            if EXPORT_REQUEST:
                body = json.loads(EXPORT_REQUEST[0])
                require(body.get("filters") == {"all": True},
                        f"export: the all-inventory scope sent {body.get('filters')!r}")
                require("assetIds" not in body, "export: the all-inventory scope sent asset ids")
                require(body.get("fields", [])[0] == "id", f"export: permanent id is not first: {body}")
            require(bool(EXPORT_RESPONSE), "export: the response was not observed")
            if EXPORT_RESPONSE:
                content_type, disposition = (part.lower() for part in EXPORT_RESPONSE[0])
                require(content_type.startswith("text/csv"),
                        f"export: content type is {content_type!r}, not text/csv")
                require("assets.csv" in disposition,
                        f"export: content disposition is {disposition!r}, not assets.csv")
            target = SCRATCH / "downloads" / (download.suggested_filename or "unnamed.csv")
            target.parent.mkdir(parents=True, exist_ok=True)
            download.save_as(str(target))
            payload = target.read_text(encoding="utf-8-sig")
            record(f"DOWNLOAD filename={download.suggested_filename} bytes={target.stat().st_size}")
            require(download.suggested_filename == "assets.csv",
                    f"download filename {download.suggested_filename!r} is not assets.csv")
            for spec in SEEDED:
                require(spec["name"] in payload, f"download payload is missing {spec['name']!r}")
            require(payload.splitlines()[0] == "id,name,category,status",
                    f"download header is {payload.splitlines()[0]!r}")
            require(len(payload.splitlines()) == len(SEEDED) + 1,
                    f"download has {len(payload.splitlines())} lines, expected {len(SEEDED) + 1}")
            shot(page, shots, "export-result", "es", 1440, "light", ROUTE_EXPORT)
            # A toast is transient copy from the locale that raised it, so it is
            # not expected to re-translate in place: let it clear before the
            # locale switch instead of photographing Spanish text in an English frame.
            try:
                page.wait_for_selector(".toast", state="detached", timeout=8000)
            except Exception:
                record("the download toast did not clear before the English result capture")
            reskin(page, "en", "dark", 390, 844)
            shot(page, shots, "export-result", "en", 390, "dark", ROUTE_EXPORT)
            reskin(page, "es", "light", 1440, 1000)

            # 5. Import: read-only walk at 390, then the one real execution at 1440.
            sample = SCRATCH / "samples" / "inventario.csv"
            sample.parent.mkdir(parents=True, exist_ok=True)
            sample.write_text(SAMPLE_CSV, encoding="utf-8")
            drive_import(page, base, sample, shots, 390, 844, apply=False)
            drive_import(page, base, sample, shots, 390, 844, apply=False, locale="en", theme="dark")
            drive_import(page, base, sample, shots, 1440, 1000, apply=True)

            for error in errors:
                fail(f"page error: {error}")
            context.close()
            browser.close()
    except Exception as exc:  # report the exact failing step, then stop
        fail(f"FAILED {type(exc).__name__}: {exc}")
        print("DIAGNOSTICS\n" + owner.log_tails(), flush=True)
    finally:
        owner.stop()
        print(f"CLEANUP leaked_ports={fixture.open_ports(ports) if ports else []}", flush=True)


def main() -> int:
    shots = SCRATCH / "screenshots"
    shots.mkdir(parents=True, exist_ok=False)
    print(f"scratch={SCRATCH}")
    assert PYTHON.exists(), f"missing backend venv python: {PYTHON}"

    scenario_transfer(shots)
    print("\n=== RESULT ===")
    print(f"rows={len(RESULTS)} failures={len(FAILURES)}")
    print(f"screenshots={shots}")
    print(f"logs={SCRATCH / 'logs'}")
    print("bounded scope: no npm test/build, no Docker, no Prometheus, no agent/provider calls")
    if FAILURES:
        print("FAIL transfer views")
        return 1
    print("PASS transfer views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
