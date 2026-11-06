#!/usr/bin/env python3
"""Bounded browser verification for the document surfaces (U9).

Covers the reachable views owned by the document family: the reports centre
(prepare / jobs), report settings, the warranty centre and its asset panel, the
label centre with its print composition, and the anonymous public share page.

Disposable fixture: one uniquely named SQLite installation, loopback ports,
test-only credentials, a real local Huey worker, no `.env`, no provider/device
access. Every state is captured through the real application and asserted in the
same pass, so a screenshot can never claim more than the checks that ran beside
it.

Usage: python3 tests/ui-documents-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import unquote

FRONTEND = Path(__file__).resolve().parent.parent


def _load_fixture():
    spec = importlib.util.spec_from_file_location(
        "documents_fixture", Path(__file__).with_name("demo-indicator.browser.py")
    )
    assert spec and spec.loader, "the shared disposable fixture must be importable"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()

SCRATCH = FRONTEND / ".verification" / ("ui-documents-visual-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH  # process logs and isolated state land in this run

BACKEND = fixture.BACKEND
PYTHON = fixture.PYTHON
PASSWORD = "Documents-View-Pass-4m7"
USERNAME = "documents.admin"
VIEWPORTS = ((1440, 1000), (390, 844))
THEMES = ("light", "dark")
LOCALES = ("es", "en")

MARKER_REPORTS = '[data-od-id="reports-center"]'
MARKER_LABELS = '[data-od-id="labels-center"]'
MARKER_WARRANTIES = '[data-od-id="warranties-center"]'
MARKER_SETTINGS = '[data-od-id="report-settings"]'
MARKER_QR_SETTINGS = '[data-od-id="qr-settings"]'
MARKER_LABEL_SETTINGS = '[data-od-id="label-settings"]'
MARKER_PUBLIC = '[data-od-id="qr-asset-report"]'

SEEDED = (
    {"name": "Router de borde", "serial": "SN-EDGE-1", "quickCode": "DC-0001",
     "brand": "Mikrotik", "model": "CCR2004", "ip": "192.0.2.1",
     "site": "Central", "location": "Sala de red", "responsible": "Ana Torres"},
    {"name": "Notebook de guardia", "serial": "SN-NOTE-2", "quickCode": "DC-0002",
     "brand": "Lenovo", "model": "T14", "ip": "192.0.2.11",
     "site": "Central", "location": "Piso 2", "responsible": "Luis Benítez"},
    {"name": "Impresora de depósito", "serial": "SN-PRNT-3", "quickCode": "DC-0003",
     "brand": "HP", "model": "M404", "ip": "192.0.2.21",
     "site": "Depósito", "location": "Depósito", "responsible": "Ana Torres"},
    {"name": "Access point de taller", "serial": "SN-AP-4", "quickCode": "DC-0004",
     "brand": "Ubiquiti", "model": "U6-Pro", "ip": "192.0.2.31",
     "site": "Taller", "location": "Taller", "responsible": "Luis Benítez"},
)

COPY = {
    "es": {
        "no_assets": "Ningún activo coincide con los filtros.",
        "preview_empty": "Sin vista previa",
        "generate_asset_error": "Selecciona al menos un activo.",
        "no_jobs": "No hay trabajos de reportes.",
        "no_documents": "Todavía no hay documentos generados.",
        "editor": "Editar composición",
        "editor_title": "Editor de plantilla",
        "jobs_tab": "Trabajos y documentos",
        "prepare_tab": "Preparar",
        "job_completed": "Completado",
        "color_error": "Usa un color hexadecimal de seis dígitos.",
        "settings_saved": "Configuración guardada",
        "warranty_empty": "Sin garantías cargadas.",
        "labels_empty": "Sin vista previa",
        "public_unavailable": "Este enlace público no está disponible",
        "public_fields": "campos visibles",
        "stale": "Actualiza la vista previa antes de generar.",
    },
    "en": {
        "no_assets": "No asset matches the filters.",
        "preview_empty": "No preview",
        "generate_asset_error": "Select at least one asset.",
        "no_jobs": "There are no report jobs.",
        "no_documents": "No documents have been generated yet.",
        "editor": "Edit composition",
        "editor_title": "Template editor",
        "jobs_tab": "Jobs and documents",
        "prepare_tab": "Prepare",
        "job_completed": "Completed",
        "color_error": "Use a six-digit hexadecimal color.",
        "settings_saved": "Settings saved",
        "warranty_empty": "No warranties loaded.",
        "labels_empty": "No preview",
        "public_unavailable": "This public link is not available",
        "public_fields": "visible fields",
        "stale": "Refresh the preview before generating.",
    },
}

RESULTS: list[str] = []
FAILURES: list[str] = []
BASE = ""


def record(line: str) -> None:
    RESULTS.append(line)
    print(line, flush=True)


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"FAIL {message}", flush=True)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def body_text(page) -> str:
    return page.evaluate("() => document.body.innerText")


def present(page, needles, label: str) -> None:
    text = body_text(page)
    for needle in needles:
        require(needle in text, f"{label}: expected copy missing {needle!r}")


def absent(page, needles, label: str) -> None:
    text = body_text(page)
    for needle in needles:
        require(needle not in text, f"{label}: unexpected copy present {needle!r}")


def overflow(page) -> int:
    return page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )


def set_locale(page, tag: str) -> None:
    """Switch locale through the product's own i18n API, one bundle load per tag."""
    page.evaluate(
        """async (tag) => {
          window.__documentBundles = window.__documentBundles || {};
          if (!window.__documentBundles[tag]) {
            await window.ItsmI18n.loadBundle(tag);
            window.__documentBundles[tag] = true;
          }
          window.ItsmI18n.setLocale(tag);
        }""",
        tag,
    )


def effective_theme(page) -> str:
    return page.evaluate("() => document.documentElement.dataset.theme || ''")


def set_theme(page, theme: str) -> str:
    """Reach the theme through the product's own theme store (shell or public page)."""
    if effective_theme(page) != theme:
        toggle = page.locator(".app-shell .theme-toggle")
        if toggle.count():
            toggle.first.click()
        else:
            page.evaluate("(value) => window.AssetTheme.set(value)", theme)
        page.wait_for_function(
            "(target) => document.documentElement.dataset.theme === target", arg=theme
        )
    resolved = effective_theme(page)
    require(resolved == theme, f"theme requested {theme} but the effective theme is {resolved!r}")
    return resolved


def settle(page) -> None:
    page.wait_for_function(
        """() => !document.querySelector(
          '.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active'
        )"""
    )
    try:
        page.wait_for_function(
            "() => document.getAnimations().every((item) => item.playState !== 'running')",
            timeout=5000,
        )
    except Exception:
        pass


def open_route(page, route: str, marker: str) -> None:
    # A same-URL navigation is a no-op in Chromium, so every state starts from a
    # real document load and re-reads the canonical data it must show.
    page.goto("about:blank")
    page.goto(BASE + "/" + route)
    page.wait_for_selector(marker, timeout=30000)
    settle(page)


def shot(page, shots: Path, state: str, route: str, locale: str, width: int,
         height: int, theme: str, detail: str) -> Path:
    over = overflow(page)
    require(over <= 1, f"{state} {locale} {width} {theme}: horizontal overflow {over}px")
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(80)
    path = shots / f"{state}-{locale}-{width}-{theme}.png"
    page.screenshot(path=str(path), full_page=True)
    record(
        f"SHOT {path.name} route={route} state={state} locale={locale} "
        f"theme={effective_theme(page)} viewport={width}x{height} overflow={over}px {detail}"
    )
    return path


def capture(page, shots: Path, state: str, route: str, marker: str, cells,
            check=None) -> None:
    """Open, localise, theme and assert one state per (locale, width, height, theme) cell."""
    for locale, width, height, theme in cells:
        page.set_viewport_size({"width": width, "height": height})
        open_route(page, route, marker)
        set_locale(page, locale)
        set_theme(page, theme)
        settle(page)
        detail = ""
        if check is not None:
            detail = check(page, locale, theme, width) or ""
        shot(page, shots, state, route, locale, width, height, theme, detail)


def me(page) -> dict:
    return page.evaluate(
        "async () => (await (await fetch('/api/v1/auth/me', {credentials: 'same-origin'})).json())"
    )


def csrf(page) -> str:
    payload = me(page)
    token = payload.get("csrfToken") or (payload.get("session") or {}).get("csrfToken")
    assert token, payload
    return token


def post(page, path: str, body: dict | None = None, method: str = "POST") -> dict:
    return page.evaluate(
        """async ({method, path, body, token}) => {
          const response = await fetch('/api/v1' + path, {
            method,
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Token': token},
            body: body === null ? undefined : JSON.stringify(body)
          });
          let payload = null;
          try { payload = await response.json(); } catch (_) { payload = null; }
          return {status: response.status, body: payload};
        }""",
        {"method": method, "path": path, "body": body, "token": csrf(page)},
    )


def seed_assets(page) -> list[dict]:
    created: list[dict] = []
    for spec in SEEDED:
        result = post(page, "/assets", spec)
        require(result["status"] == 201, f"seed asset {spec['name']}: {result}")
        # The canonical create adapter answers with the asset payload itself.
        asset = result["body"] or {}
        require(bool(asset.get("id")), f"seed asset {spec['name']}: no id in {result}")
        created.append(asset)
        record(f"SEED asset {asset.get('id')} quickCode={asset.get('quickCode')} name={asset.get('name')}")
    return created


def seed_warranty(page, asset_id: str, payload: dict) -> None:
    result = post(page, f"/assets/{asset_id}/warranty", payload, method="PUT")
    require(result["status"] in (200, 201), f"seed warranty {asset_id}: {result}")
    record(f"SEED warranty {asset_id} status={payload.get('status')} expires={payload.get('expiresOn')}")


def iframe_source(page, selector: str = ".doc-pages iframe") -> str:
    node = page.locator(selector)
    if not node.count():
        fail(f"missing preview iframe {selector}")
        return ""
    return node.first.get_attribute("srcdoc") or ""


def wait_job_completed(page, selector: str, timeout: int = 90000) -> str:
    page.wait_for_function(
        """(selector) => {
          const text = (document.querySelector(selector) || {}).innerText || '';
          return /Completado|Completed|Con errores|With errors/.test(text);
        }""",
        arg=selector,
        timeout=timeout,
    )
    return page.locator(selector).first.inner_text()


# --------------------------------------------------------------------------- states

def check_reports_zero(page, locale, theme, width):
    copy = COPY[locale]
    present(page, (copy["no_assets"], copy["preview_empty"]), "reports empty")
    generate = page.locator('[data-od-id="generate-report"]')
    require(generate.is_disabled(), f"reports empty: generate enabled with no assets ({locale}/{width})")
    require(page.locator(".doc-asset-picker input[type=checkbox]").count() == 0,
            "reports empty: asset rows present without a match")
    require(page.locator(".doc-pages iframe").count() == 0, "reports empty: preview iframe rendered")
    return f"picker=0 preview=empty generate=disabled"


def open_preview(page, label: str, inner: str) -> None:
    """Ask the server for the preview and wait for the sandboxed document to paint."""
    button = page.locator(".doc-preview-toolbar .btn").first
    button.click()
    page.wait_for_selector(".doc-pages iframe", timeout=60000)
    frame = page.frame_locator(".doc-pages iframe")
    frame.locator(inner).first.wait_for(timeout=60000)
    # ``sandbox=""`` hides contentDocument from the app, so the paint barrier runs
    # inside the frame handle Playwright owns: two animation frames after load.
    end = time.monotonic() + 30
    painted = False
    while time.monotonic() < end and not painted:
        handle = page.query_selector(".doc-pages iframe")
        handle_frame = handle.content_frame() if handle else None
        if handle_frame is not None:
            try:
                handle_frame.evaluate(
                    "() => new Promise((done) => requestAnimationFrame("
                    "() => requestAnimationFrame(() => done(true))))"
                )
                painted = True
            except Exception:  # frame detached while the srcdoc loaded
                page.wait_for_timeout(100)
        else:
            page.wait_for_timeout(100)
    require(painted, f"PREVIEW {label}: the sandboxed document never reached a paint frame")
    record(f"PREVIEW {label}: server html rendered ({inner})")


def check_reports_preview(page, locale, theme, width):
    open_preview(page, f"reports {locale}/{width}/{theme}", ".doc-title")
    source = iframe_source(page)
    require("@page" in source, "reports preview: no print page rule in the server document")
    require("doc-paper" not in source, "reports preview: the app sheet markup leaked into the server html")
    require("doc-title" in source and "doc-table" in source,
            "reports preview: the server document lost its title or data table")
    for spec in SEEDED:
        require(spec["name"] in source, f"reports preview: {spec['name']!r} missing from the document")
    frame = page.frame_locator(".doc-pages iframe")
    require(frame.locator(".doc-title").count() >= 1, "reports preview: title not painted in the frame")
    require(frame.locator("table.doc-table").count() >= 1, "reports preview: table not painted in the frame")
    mask = page.locator(".doc-pages iframe").first.get_attribute("sandbox")
    require(mask is not None, "reports preview: iframe lost its sandbox attribute")
    present(page, (COPY[locale]["prepare_tab"],), "reports preview")
    absent(page, (COPY[locale]["stale"],), "reports preview")
    selected = page.locator(".doc-output-bar strong").first.inner_text()
    require("4" in selected, f"reports preview: footer count {selected!r} does not carry the selection")
    return f"assets=4 sandbox={mask!r} footer={selected!r}"


def check_reports_editor(page, locale, theme, width):
    page.get_by_role("button", name=COPY[locale]["editor"]).first.click()
    page.wait_for_selector(".doc-editor")
    present(page, (COPY[locale]["editor_title"],), "reports editor")
    rows = page.locator(".doc-block-row").count()
    fields = page.locator(".doc-field-options input[type=checkbox]").count()
    require(rows >= 3, f"reports editor: expected the template blocks, found {rows}")
    require(fields >= 8, f"reports editor: expected the field checkboxes, found {fields}")
    moves = page.locator(".doc-block-moves button").first
    box = moves.bounding_box() or {}
    require(box.get("width", 0) >= 44, f"reports editor: block move target {box.get('width')}px is under 44px")
    save = page.locator(".doc-editor .btn--primary").first
    require(save.is_enabled(), "reports editor: save is disabled for an administrator")
    return f"blocks={rows} fields={fields} move_target={box.get('width')}px"


def check_reports_no_selection(page, locale, theme, width):
    page.get_by_role("button", name="Vaciar" if locale == "es" else "Clear").first.click()
    generate = page.locator('[data-od-id="generate-report"]')
    require(generate.is_disabled(), "reports empty selection: generate stayed enabled")
    rows = page.locator(".doc-asset-picker input[type=checkbox]").count()
    require(rows == 4, f"reports empty selection: the picker lost its rows ({rows})")
    footer = page.locator(".doc-output-bar strong").first.inner_text()
    require("0" in footer, f"reports empty selection: footer count {footer!r}")
    return f"picker_rows={rows} footer={footer!r} generate=disabled"


def check_reports_jobs_zero(page, locale, theme, width):
    page.locator(".doc-tabs button").nth(1).click()
    page.wait_for_selector(".table-panel")
    present(page, (COPY[locale]["no_jobs"], COPY[locale]["no_documents"]), "reports jobs empty")
    require(page.locator('[data-od-id="active-report-job"]').count() == 0,
            "reports jobs empty: an active job block is present without a job")
    return "jobs=0 documents=0 active=none"


def check_reports_jobs_completed(page, locale, theme, width):
    page.locator(".doc-tabs button").nth(1).click()
    page.wait_for_selector('[data-od-id="active-report-job"]')
    text = wait_job_completed(page, '[data-od-id="active-report-job"]')
    require(COPY[locale]["job_completed"] in text,
            f"reports job: state {text.splitlines()[0]!r} is not the completed state")
    row = page.locator('[data-od-id="active-report-job"] tbody tr').first
    mime = row.locator("td").nth(1).inner_text().strip()
    require(mime == "application/pdf", f"reports job: document mime {mime!r}")
    return f"mime={mime} rows={page.locator('[data-od-id=\"active-report-job\"] tbody tr').count()}"


def check_report_settings(page, locale, theme, width):
    base = page.locator('[data-od-id="report-settings"] input[type=url]')
    require(base.count() == 1, "report settings: no base URL field")
    require(base.first.get_attribute("placeholder") == "https://activos.organizacion.example/",
            "report settings: base URL example changed")
    save = page.locator('[data-od-id="report-settings"] button[type=submit]')
    require(save.is_enabled(), "report settings: save disabled for an administrator")
    return f"base_url=type:{base.first.get_attribute('type')} save=enabled"


def check_report_settings_invalid(page, locale, theme, width):
    form = page.locator('[data-od-id="report-settings"] form')
    primary = form.locator('input[placeholder="#0d766e"]')
    primary.fill("12")
    base = form.locator('input[type=url]')
    base.fill("not-a-url")
    form.locator('button[type=submit]').click()
    page.wait_for_selector('[data-od-id="report-settings"] .doc-error', timeout=15000)
    present(page, (COPY[locale]["color_error"],), "report settings invalid")
    described = primary.get_attribute("aria-describedby")
    invalid = primary.get_attribute("aria-invalid")
    url_invalid = base.get_attribute("aria-invalid")
    url_described = base.get_attribute("aria-describedby")
    require(invalid == "true", f"report settings invalid: color input aria-invalid={invalid!r}")
    require(bool(described), "report settings invalid: color input has no aria-describedby")
    require(url_invalid == "true", f"report settings invalid: url input aria-invalid={url_invalid!r}")
    require(bool(url_described), "report settings invalid: url input has no aria-describedby")
    return f"color aria-invalid={invalid} describedby={described} url aria-invalid={url_invalid}"

CATALOG = {
    locale: json.loads((FRONTEND / "assets" / "i18n" / f"{locale}.json").read_text(encoding="utf-8"))
    for locale in ("es", "en")
}
SETTINGS_CELLS = [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")]
SETTINGS_FAILURES = [
    ("report-settings-load-failed", "#/configuracion/reportes", MARKER_SETTINGS,
     "ui.reports.settings_load_error"),
    ("qr-settings-load-failed", "#/configuracion/qr", MARKER_QR_SETTINGS,
     "ui.qr.settings.load_error"),
    ("label-settings-load-failed", "#/configuracion/etiquetas", MARKER_LABEL_SETTINGS,
     "ui.labels.settings.load_error"),
]


def check_load_refusal(page, locale, key):
    page.wait_for_selector(".doc-settings .doc-error[role=alert]", timeout=15000)
    present(page, (CATALOG[locale][key],), f"settings load refusal {key}")
    submit = page.locator(".doc-settings button[type=submit]").first
    require(not submit.is_enabled(),
            "settings load refusal: save stayed enabled without loaded settings")
    box = submit.bounding_box()
    require(box and box["height"] >= 43.5,
            f"settings load refusal: save target {box and box['height']}px")
    return f"alert={key} save=disabled height={round(box['height'], 1)}px"


def capture_settings_failure(page, shots, state, route, marker, key):
    pattern = "**/api/v1/reports/settings*"

    def abort(intercepted):
        intercepted.abort()

    page.route(pattern, abort)
    try:
        capture(page, shots, state, route, marker, SETTINGS_CELLS,
                lambda p, loc, theme, width: check_load_refusal(p, loc, key))
    finally:
        page.unroute(pattern, abort)


def check_qr_settings(page, locale, theme, width):
    base = page.locator('[data-od-id="qr-settings"] input[type=url]')
    require(base.count() == 1, "qr settings: no base URL field")
    save = page.locator('[data-od-id="qr-settings"] button[type=submit]')
    require(save.is_enabled(), "qr settings: save disabled for an administrator")
    return f"url_field=type:{base.first.get_attribute('type')} save=enabled"


def check_label_settings(page, locale, theme, width):
    select = page.locator('[data-od-id="label-settings"] select')
    require(select.count() == 1, "label settings: no format selector")
    options = select.locator("option").count()
    require(options > 3, f"label settings: only {options} formats")
    width_input = page.locator('[data-od-id="label-settings"] input[type=number]').first
    require(width_input.count() == 1, "label settings: no width field")
    save = page.locator('[data-od-id="label-settings"] button[type=submit]')
    require(save.is_enabled(), "label settings: save disabled for an administrator")
    box = save.bounding_box()
    require(box and box["height"] >= 43.5, f"label settings: save target {box and box['height']}px")
    return (f"formats={options} width={width_input.input_value()} "
            f"height={round(box['height'], 1)}px save=enabled")


FAILED_JOB = {
    "id": "job-visual-failed",
    "status": "failed",
    "total": 1,
    "processed": 1,
    "errors": ["The renderer stopped before writing the PDF."],
    "documents": [],
    "createdAt": "2026-01-15T10:00:00Z",
}


def capture_job_failure(page, shots):
    list_pattern = "**/api/v1/reports/jobs?*"
    job_pattern = "**/api/v1/reports/jobs/job-visual-failed*"

    def stub_list(intercepted):
        intercepted.fulfill(status=200, content_type="application/json",
                            body=json.dumps({"items": [FAILED_JOB]}))

    def stub_job(intercepted):
        intercepted.fulfill(status=200, content_type="application/json",
                            body=json.dumps({"job": FAILED_JOB}))

    page.route(list_pattern, stub_list)
    page.route(job_pattern, stub_job)
    try:
        capture(page, shots, "reports-job-failed", "#/reportes", MARKER_REPORTS,
                SETTINGS_CELLS, check_job_failure)
    finally:
        page.unroute(list_pattern, stub_list)
        page.unroute(job_pattern, stub_job)


def check_job_failure(page, locale, theme, width):
    page.locator(".doc-tabs button").nth(1).click()
    queue = page.locator('[data-od-id="reports-center"] .table-panel').last
    queue.locator("tbody tr button").first.click()
    panel = page.wait_for_selector('[data-od-id="active-report-job"]')
    page.wait_for_selector('[data-od-id="active-report-job"] .doc-error[role=alert]',
                           timeout=15000)
    text = panel.inner_text()
    require(CATALOG[locale]["ui.reports.job_failed_state"] in text,
            "job failure: failure copy missing")
    require(CATALOG[locale]["ui.reports.document_pending"] not in text,
            "job failure: pending copy on a failed job")
    require(CATALOG[locale]["ui.reports.job_failed"] in text,
            "job failure: status label missing")
    return f"status={CATALOG[locale]['ui.reports.job_failed']!r} errors={len(FAILED_JOB['errors'])}"


def capture_download_failure(page, shots):
    pattern = "**/api/v1/documents/**/download"

    def abort(intercepted):
        intercepted.abort()

    page.route(pattern, abort)
    try:
        capture(page, shots, "reports-download-failed", "#/reportes", MARKER_REPORTS,
                SETTINGS_CELLS, check_download_failure)
    finally:
        page.unroute(pattern, abort)


def check_download_failure(page, locale, theme, width):
    page.reload()
    page.wait_for_selector(MARKER_REPORTS)
    page.locator(".doc-tabs button").nth(1).click()
    queue = page.locator('[data-od-id="reports-center"] .table-panel').last
    queue.locator("tbody tr button").first.click()
    page.wait_for_selector('[data-od-id="active-report-job"] tbody tr')
    require(page.locator(".doc-job-alert").count() == 0,
            "download failure: alert before any attempt")
    button = page.locator('[data-od-id="active-report-job"] tbody tr').first.locator("button")
    require(button.is_enabled(), "download failure: download button disabled before click")
    box = button.bounding_box()
    require(box and box["height"] >= 43.5, f"download failure: target {box and box['height']}px")
    button.click()
    alert = page.wait_for_selector(".doc-job-alert", timeout=15000)
    require(alert.get_attribute("role") == "alert", "download failure: alert role missing")
    require(button.is_enabled(), "download failure: button stayed disabled after the failure")
    return f"alert=visible height={round(box['height'], 1)}px button=enabled"


def check_warranties_zero(page, locale, theme, width):
    # The empty row is painted, but the copy it carries is reported as an
    # out-of-surface defect: with zero warranties the table blames the filters.
    rows = page.locator(".warranty-table tbody tr").count()
    require(rows == 1, f"warranties empty: expected the single empty row, found {rows}")
    empty = page.locator(".warranty-table tbody tr").first.inner_text().strip()
    metrics = page.locator(".warranty-metric strong").all_inner_texts()
    require(metrics and all(value.strip() == "0" for value in metrics),
            f"warranties empty: metrics {metrics} are not all zero")
    return f"rows=1 empty_copy={empty!r} metrics={metrics}"


def check_warranties_populated(page, locale, theme, width):
    page.wait_for_function(
        "() => document.querySelectorAll('.warranty-table tbody tr').length > 1", timeout=30000
    )
    rows = page.locator(".warranty-table tbody tr").count()
    require(rows == 4, f"warranties: expected the four seeded warranties, found {rows}")
    present(page, ("Vigente" if locale == "es" else "Active",), "warranties populated")
    return f"rows={rows}"


def check_warranty_panel(page, locale, theme, width):
    page.wait_for_selector('[data-od-id="asset-warranty-panel"]')
    present(page, ("Proveedor" if locale == "es" else "Vendor",), "warranty panel")
    return "panel=present"


def check_warranty_dialog(page, locale, theme, width):
    page.locator('[data-od-id="asset-warranty-panel"] .btn--secondary').first.click()
    page.wait_for_selector("#warranty-edit-form")
    present(page, ("Comprobante" if locale == "es" else "Receipt",), "warranty dialog")
    page.keyboard.press("Escape")
    page.wait_for_selector("#warranty-edit-form", state="detached", timeout=15000)
    return "dialog opened by the panel action and closed with Escape"


def check_labels_zero(page, locale, theme, width):
    present(page, (COPY[locale]["labels_empty"],), "labels empty")
    require(page.locator(".doc-pages iframe").count() == 0, "labels empty: preview iframe rendered")
    return "preview=empty"


def check_labels_preview(page, locale, theme, width):
    open_preview(page, f"labels {locale}/{width}/{theme}", ".label-cell")
    source = iframe_source(page)
    require("@page" in source, "labels preview: no print page rule in the server document")
    require("label-cell" in source, "labels preview: no label cell in the server document")
    require("DC-0001" in source, "labels preview: seeded quick code missing from the label sheet")
    present(page, ("mm",), "labels preview")
    return f"labels_html={len(source)}B"


def check_labels_custom(page, locale, theme, width):
    page.locator(".doc-controls select").first.select_option("custom")
    page.wait_for_selector(".doc-controls .doc-form-grid input[type=number]")
    numbers = page.locator(".doc-controls .doc-form-grid input[type=number]").count()
    require(numbers >= 8, f"labels custom: expected the geometry inputs, found {numbers}")
    return f"geometry_inputs={numbers}"


def check_labels_job(page, locale, theme, width):
    page.locator('[data-od-id="prepare-labels"]').click()
    page.wait_for_selector('[data-od-id="active-label-job"]')
    text = wait_job_completed(page, '[data-od-id="active-label-job"]')
    require(COPY[locale]["job_completed"] in text, f"labels job: {text.splitlines()[0]!r}")
    return f"job={text.splitlines()[0]!r}"


def check_public_valid(page, locale, theme, width):
    page.wait_for_selector(".qr-record")
    source = body_text(page)
    require(SEEDED[0]["name"] in source, "public share: asset name missing")
    require(SEEDED[0]["serial"] not in source, "public share: serial leaked outside the shared fields")
    require(SEEDED[0]["ip"] not in source, "public share: ip leaked outside the shared fields")
    require(COPY[locale]["public_fields"] in source, "public share: visible field count missing")
    require(page.locator(".app-shell").count() == 0, "public share: authenticated shell rendered")
    require(page.locator(".sidebar").count() == 0, "public share: sidebar rendered on the anonymous page")
    return "fields=name+quickCode+status only, no shell"


def check_public_invalid(page, locale, theme, width):
    page.wait_for_selector(".qr-public-empty")
    present(page, (COPY[locale]["public_unavailable"],), "public invalid")
    require(page.locator(".qr-record").count() == 0, "public invalid: a record rendered without a token")
    return "unavailable"


def check_public_revoked(page, locale, theme, width):
    page.wait_for_selector(".qr-public-empty")
    present(page, (COPY[locale]["public_unavailable"],), "public revoked")
    return "revoked token stays unavailable"


# --------------------------------------------------------------------------- download

def download_report_pdf(page, shots: Path) -> None:
    page.locator(".doc-tabs button").nth(1).click()
    page.locator('[data-od-id="active-report-job"] tbody tr').first.wait_for()
    with page.expect_response(lambda response: "/download" in response.url) as response_info:
        with page.expect_download() as download_info:
            page.locator('[data-od-id="active-report-job"] tbody tr').first.locator("button").click()
    response = response_info.value
    download = download_info.value
    name = download.suggested_filename
    saved = SCRATCH / "downloads" / name
    saved.parent.mkdir(parents=True, exist_ok=True)
    download.save_as(str(saved))
    head = saved.read_bytes()[:5]
    headers = response.headers
    require(head == b"%PDF-", f"report download: file head {head!r}")
    require(headers.get("content-type", "").startswith("application/pdf"),
            f"report download: content-type {headers.get('content-type')!r}")
    require("attachment" in headers.get("content-disposition", ""),
            f"report download: disposition {headers.get('content-disposition')!r}")
    require(name.endswith(".pdf"), f"report download: filename {name!r}")
    record(
        f"DOWNLOAD report name={name} bytes={saved.stat().st_size} head=%PDF- "
        f"content-type={headers.get('content-type')} disposition={headers.get('content-disposition')}"
    )


def download_label_pdf(page) -> None:
    with page.expect_response(lambda response: "/download" in response.url) as response_info:
        with page.expect_download() as download_info:
            page.locator('[data-od-id="active-label-job"] button').first.click()
    response = response_info.value
    download = download_info.value
    name = download.suggested_filename
    saved = SCRATCH / "downloads" / name
    saved.parent.mkdir(parents=True, exist_ok=True)
    download.save_as(str(saved))
    head = saved.read_bytes()[:5]
    headers = response.headers
    require(head == b"%PDF-", f"label download: file head {head!r}")
    require(headers.get("content-type", "").startswith("application/pdf"),
            f"label download: content-type {headers.get('content-type')!r}")
    require(name.endswith(".pdf"), f"label download: filename {name!r}")
    record(
        f"DOWNLOAD labels name={name} bytes={saved.stat().st_size} head=%PDF- "
        f"content-type={headers.get('content-type')} disposition={headers.get('content-disposition')}"
    )


# --------------------------------------------------------------------------- scenarios

def scenario(browser, shots: Path) -> list[str]:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    rows: list[str] = []
    try:
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        fixture.login(page, BASE, USERNAME, PASSWORD)
        record(f"LOGIN {USERNAME} at {BASE}")

        # ---- zero-data states, before anything is seeded through the API.
        capture(page, shots, "reports-zero", "#/reportes", MARKER_REPORTS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_reports_zero)
        capture(page, shots, "reports-jobs-zero", "#/reportes", MARKER_REPORTS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_reports_jobs_zero)
        capture(page, shots, "labels-zero", "#/etiquetas", MARKER_LABELS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_labels_zero)
        capture(page, shots, "warranties-zero", "#/garantias", MARKER_WARRANTIES,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_warranties_zero)

        # ---- seed the disposable inventory and its warranties through the real API.
        assets = seed_assets(page)
        seed_warranty(page, assets[0]["id"], {"supplier": "Redes del Sur", "purchaseDate": "2023-02-10",
                                              "expiresOn": "2027-06-30", "status": "active",
                                              "notes": "Contrato anual"})
        seed_warranty(page, assets[1]["id"], {"supplier": "Tecno Import", "purchaseDate": "2022-01-05",
                                              "expiresOn": "2025-01-05", "status": "active"})
        seed_warranty(page, assets[2]["id"], {"supplier": "Tecno Import", "purchaseDate": "2024-11-20",
                                              "durationMonths": 12, "status": "active"})
        undated = post(page, f"/assets/{assets[3]['id']}/warranty", {}, method="PUT")
        record(f"SEED warranty {assets[3]['id']} empty payload status={undated['status']}")

        # ---- populated report states, including a real render of the server document.
        capture(page, shots, "reports-preview", "#/reportes", MARKER_REPORTS,
                [(locale, width, height, theme) for locale in LOCALES
                 for width, height in VIEWPORTS for theme in THEMES],
                check_reports_preview)
        capture(page, shots, "reports-editor", "#/reportes", MARKER_REPORTS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_reports_editor)
        capture(page, shots, "reports-no-selection", "#/reportes", MARKER_REPORTS,
                [("es", 1440, 1000, "dark"), ("en", 390, 844, "light")], check_reports_no_selection)

        capture(page, shots, "warranties", "#/garantias", MARKER_WARRANTIES,
                [(locale, 1440, 1000, theme) for locale in LOCALES for theme in THEMES]
                + [(locale, 390, 844, theme) for locale in LOCALES for theme in THEMES],
                check_warranties_populated)
        capture(page, shots, "warranty-panel", f"#/activo/{assets[0]['id']}", '[data-od-id="asset-warranty-panel"]',
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_warranty_panel)
        capture(page, shots, "warranty-dialog", f"#/activo/{assets[0]['id']}", '[data-od-id="asset-warranty-panel"]',
                [("es", 1440, 1000, "dark"), ("en", 390, 844, "light")], check_warranty_dialog)

        # ---- labels and their print composition.
        capture(page, shots, "labels-preview", "#/etiquetas", MARKER_LABELS,
                [(locale, 1440, 1000, theme) for locale in LOCALES for theme in THEMES]
                + [("es", 390, 844, "dark"), ("en", 390, 844, "light")],
                check_labels_preview)
        capture(page, shots, "labels-custom", "#/etiquetas", MARKER_LABELS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_labels_custom)

        # ---- report settings and its invalid submission.
        capture(page, shots, "report-settings", "#/configuracion/reportes", MARKER_SETTINGS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_report_settings)
        capture(page, shots, "report-settings-invalid", "#/configuracion/reportes", MARKER_SETTINGS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")],
                check_report_settings_invalid)

        # ---- every settings editor, loaded and with its read refused.
        capture(page, shots, "qr-settings", "#/configuracion/qr", MARKER_QR_SETTINGS,
                SETTINGS_CELLS, check_qr_settings)
        capture(page, shots, "label-settings", "#/configuracion/etiquetas", MARKER_LABEL_SETTINGS,
                SETTINGS_CELLS, check_label_settings)
        for state, route, marker, key in SETTINGS_FAILURES:
            capture_settings_failure(page, shots, state, route, marker, key)

        # ---- a real report job through the real worker, then a real download.
        open_route(page, "#/reportes", MARKER_REPORTS)
        open_preview(page, "reports job source", ".doc-title")
        page.locator('[data-od-id="generate-report"]').click()
        page.wait_for_selector('[data-od-id="active-report-job"]', timeout=60000)
        text = wait_job_completed(page, '[data-od-id="active-report-job"]')
        record(f"JOB report completed: {text.splitlines()[0]!r}")
        download_report_pdf(page, shots)
        capture(page, shots, "reports-jobs-completed", "#/reportes", MARKER_REPORTS,
                [("es", 1440, 1000, "light"), ("en", 1440, 1000, "dark"),
                 ("es", 390, 844, "dark"), ("en", 390, 844, "light")],
                check_reports_jobs_completed)
        capture_download_failure(page, shots)
        capture_job_failure(page, shots)

        # ---- a real label job and its print PDF.
        open_route(page, "#/etiquetas", MARKER_LABELS)
        open_preview(page, "labels job source", ".label-cell")
        page.locator('[data-od-id="prepare-labels"]').click()
        page.wait_for_selector('[data-od-id="active-label-job"]', timeout=60000)
        text = wait_job_completed(page, '[data-od-id="active-label-job"]')
        record(f"JOB labels completed: {text.splitlines()[0]!r}")
        download_label_pdf(page)
        capture(page, shots, "labels-job", "#/etiquetas", MARKER_LABELS,
                [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_labels_job)

        # ---- a real public share, opened anonymously through its capability token.
        created = post(page, f"/assets/{assets[0]['id']}/shares",
                       {"fields": ["name", "quickCode", "status"], "expiresInDays": 7})
        require(created["status"] == 201, f"create share: {created}")
        share = created["body"] or {}
        # The capability only exists inside the returned link; it is never echoed alone.
        match = re.search(r"[?&]share=([^&]+)", share.get("url", ""))
        token = unquote(match.group(1)) if match else ""
        require(bool(token), f"create share: no capability token in {created}")
        record(f"SHARE created id={share.get('id')} expiresAt={share.get('expiresAt')} url={share.get('url')}")

        anonymous = browser.new_context(viewport={"width": 1440, "height": 1000})
        try:
            public = anonymous.new_page()
            public_errors: list[str] = []
            public.on("pageerror", lambda error: public_errors.append(str(error)))
            route = f"#/reporte/{assets[0]['id']}/publico?share={token}"
            capture(public, shots, "public-report", route, MARKER_PUBLIC,
                    [(locale, width, height, theme) for locale in LOCALES
                     for width, height in VIEWPORTS for theme in THEMES],
                    check_public_valid)
            bogus = f"#/reporte/{assets[0]['id']}/publico?share=bogus-{uuid.uuid4().hex}"
            capture(public, shots, "public-invalid", bogus, MARKER_PUBLIC,
                    [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")], check_public_invalid)
            revoked = post(page, f"/shares/{share['id']}", None, method="DELETE")
            require(revoked["status"] in (200, 204), f"revoke share: {revoked}")
            record(f"SHARE revoked id={share.get('id')} status={revoked['status']}")
            capture(public, shots, "public-revoked", route, MARKER_PUBLIC,
                    [("es", 1440, 1000, "dark"), ("en", 390, 844, "light")], check_public_revoked)
            require(not public_errors, f"public page errors: {public_errors}")
        finally:
            anonymous.close()

        require(not errors, f"page errors: {errors}")
        print(f"PAGEERRORS session: 0")
        return rows
    finally:
        context.close()


def main() -> int:
    global BASE
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ENV scrubbed {len(fixture.DROPPED_KEYS)} inherited keys: "
          f"{', '.join(sorted(fixture.DROPPED_KEYS)) or 'none'}")
    for path in (PYTHON, BACKEND, FRONTEND / "node_modules"):
        assert path.exists(), path

    owner, ports = fixture.Owned(), []
    failed = False
    try:
        database_dir = SCRATCH / "ordinary"
        database_dir.mkdir(parents=True, exist_ok=True)
        database = database_dir / "documents.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "U9 documents install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "documents", api_env)
        # The document surfaces render jobs asynchronously: the same real worker
        # the installation runs, on this disposable queue only.
        owner.spawn("documents-worker",
                    [str(PYTHON), "-m", "huey.bin.huey_consumer",
                     "itsm.tasks.runtime.huey", "-w", "1", "-k", "thread"],
                    cwd=BACKEND, env=dict(api_env))
        with fixture.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                scenario(browser, shots)
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - diagnostics, then re-raise
        failed = True
        print(f"EXCEPTION {type(exc).__name__}: {exc}")
        print("DIAGNOSTICS (owned process log tails):")
        print(owner.log_tails(30))
        raise
    finally:
        owner.stop()
        leaked = fixture.open_ports(ports)
        if leaked:
            print(f"CLEANUP LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                failed = True
        else:
            print(f"CLEANUP owned processes stopped, ports {ports} released")

    print()
    print(f"rows={len(RESULTS)} failures={len(FAILURES)} screenshots={len(list(shots.glob('*.png')))}")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    if FAILURES:
        print("FAILURES:")
        for item in FAILURES:
            print(f"- {item}")
        return 1
    print("RESULT all document checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
