#!/usr/bin/env python3
"""Bounded readiness proof for the document surfaces (U9 diagnostic).

This is deliberately narrow. It answers one open question left by the timed-out
U9 pass and by the read-only exploration:

* are the blank mobile report/label previews a *capture* artifact of the
  full-page screenshot (the sandboxed ``srcdoc`` iframe sits outside the
  viewport while the capture runs), or does the preview really paint nothing at
  390 px?

The proof therefore records, per viewport, the preview response status and the
server document length, the iframe's outer box, the inner document geometry
(text bounding boxes, scroll size, font readiness, scale), and then captures the
same state in three modes -- element, scrolled viewport, full page -- and
measures the painted pixels of each PNG. A non-empty box or a non-empty
``srcdoc`` is never accepted as proof on its own.

It also re-proves the warranty editor dialog (visible modal, finished
transition, stable form box, Escape focus return) and, when supported, one real
anonymous public share with its invalid and revoked states. The capability token
is never printed or stored in a log line.

The bounded job path is covered too: one report job and one label job run on
the owned local Huey worker, the downloaded PDF is checked for its MIME type,
page count and page size, and page one is rasterised with the local poppler
tools and inspected as an image.

Deliberately out of scope: the full inherited matrix, non-default locale/theme
cells, other share field sets, other job kinds and every other U9 state. Those
stay open until a pass that renders them.

Usage: python3 tests/ui-documents-readiness.browser.py
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import re
import shutil
import subprocess
import sys
import time
import traceback
import uuid
from pathlib import Path

from PIL import Image, ImageChops

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

SCRATCH = FRONTEND / ".verification" / ("ui-documents-readiness-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH  # process logs and isolated state land in this run

BACKEND = fixture.BACKEND
PYTHON = fixture.PYTHON
USERNAME = "readiness.admin"
PASSWORD = "Readiness-Proof-9k2"
VIEWPORTS = ((1440, 1000), (390, 844))

MARKER_REPORTS = '[data-od-id="reports-center"]'
MARKER_LABELS = '[data-od-id="labels-center"]'
MARKER_WARRANTY = '[data-od-id="asset-warranty-panel"]'
MARKER_PUBLIC = '[data-od-id="qr-asset-report"]'
# es catalog label for the seeded `in_use` asset (ui.inventory.status.in_use).
PUBLIC_STATUS_LABEL = "Asignado"

SEEDED = (
    {"name": "Router de borde", "serial": "SN-RDY-1", "quickCode": "RD-0001",
     "brand": "Mikrotik", "model": "CCR2004", "ip": "10.40.0.1",
     "site": "Central", "location": "Sala de red", "responsible": "Ana Torres"},
    {"name": "Notebook de guardia", "serial": "SN-RDY-2", "quickCode": "RD-0002",
     "brand": "Lenovo", "model": "T14", "ip": "10.40.0.11",
     "site": "Central", "location": "Piso 2", "responsible": "Luis Benítez"},
    {"name": "Access point de taller", "serial": "SN-RDY-3", "quickCode": "RD-0003",
     "brand": "Ubiquiti", "model": "U6-Pro", "ip": "10.40.0.31",
     "site": "Taller", "location": "Taller", "responsible": "Luis Benítez"},
)

# A printed document only has to show ink once, so the painted-pixel floor is
# low: it exists to separate "text was rasterised" from "the box stayed white".
MIN_INK_PIXELS = 400
MIN_INK_WIDTH_RATIO = 0.20
MIN_INK_HEIGHT_RATIO = 0.08

CAPABILITY = re.compile(r"share=[^&\s\"'<>]+")
CAPABILITY_PATH = re.compile(r"(/api/v1/reports/public/)[^/?#\s\"'<>]+")
# Synthetic only: the probe below proves the diagnostic sinks strip a capability
# shape without ever holding a real share token.
SYNTHETIC_CAPABILITY = "synthetic-capability-6b1d0c4e"
# The generated print document ships its own scripts; `sandbox=""` blocks them
# by design, so this one console line is a documented expectation, not a fault.
ERROR_NOISE = re.compile(
    r"Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed"
)
RESULTS: list[str] = []
FAILURES: list[str] = []
BASE = ""


def redact(value: object) -> str:
    """Strip any share capability before a line can reach stdout or a log file."""
    text = CAPABILITY.sub("share=<redacted>", str(value))
    return CAPABILITY_PATH.sub(r"\1<redacted>", text)


def record(line: str) -> None:
    text = redact(line)
    RESULTS.append(text)
    print(text, flush=True)

def exception_report(exc: BaseException) -> str:
    """The traceback a failure prints, kept as one redactable diagnostic."""
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return redact(text)

def log_tail_report(owner) -> str:
    """Owned process log tails, kept as one redactable diagnostic."""
    return redact(owner.log_tails(30))


def fail(message: str) -> None:
    text = redact(message)
    FAILURES.append(text)
    print(f"FAIL {text}", flush=True)


def require(condition: bool, message: str) -> bool:
    if not condition:
        fail(message)
    return bool(condition)


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


def settle(page, label: str) -> None:
    """Wait for the app's own route/entry motion, never for a fixed sleep."""
    page.wait_for_function(
        "() => !document.querySelector("
        "'.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active')",
        timeout=15000,
    )
    try:
        page.wait_for_function(
            "() => document.getAnimations().every((item) => item.playState !== 'running')",
            timeout=8000,
        )
    except Exception as exc:  # bounded, but never silently swallowed
        fail(f"{label}: animations never settled ({type(exc).__name__})")


def open_route(page, route: str, marker: str, label: str) -> None:
    page.goto("about:blank")
    page.goto(BASE + "/" + route)
    page.wait_for_selector(marker, timeout=30000)
    settle(page, label)


def me(page) -> dict:
    return page.evaluate(
        "async () => (await (await fetch('/api/v1/auth/me', {credentials: 'same-origin'})).json())"
    )


def csrf(page) -> str:
    payload = me(page)
    token = payload.get("csrfToken") or (payload.get("session") or {}).get("csrfToken")
    assert token, redact(payload)
    return token


def request(page, path: str, body: dict | None = None, method: str = "POST") -> dict:
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


# ------------------------------------------------------------------- inventory

def seed_assets(page) -> list[dict]:
    created: list[dict] = []
    for spec in SEEDED:
        result = request(page, "/assets", spec)
        if not require(result["status"] == 201, f"seed asset {spec['name']}: {result['status']}"):
            continue
        asset = result["body"] or {}
        if require(bool(asset.get("id")), f"seed asset {spec['name']}: no id"):
            created.append(asset)
            record(f"SEED asset id={asset['id']} quickCode={asset.get('quickCode')} name={asset.get('name')}")
    return created


def seed_warranty(page, asset_id: str) -> None:
    payload = {"supplier": "Redes del Sur", "purchaseDate": "2023-02-10",
               "expiresOn": "2027-06-30", "status": "active", "notes": "Contrato anual"}
    result = request(page, f"/assets/{asset_id}/warranty", payload, method="PUT")
    require(result["status"] in (200, 201), f"seed warranty: {result['status']}")
    record(f"SEED warranty asset={asset_id} status={payload['status']} expires={payload['expiresOn']}")


# ------------------------------------------------------------------- previews

OUTER_GEOMETRY = """() => {
  const rect = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom};
  };
  const frame = document.querySelector('.doc-pages iframe');
  const pages = document.querySelector('.doc-pages');
  const area = document.querySelector('.doc-preview-area');
  return {
    frame: rect(frame),
    pages: rect(pages),
    area: rect(area),
    srcdocLength: frame ? (frame.getAttribute('srcdoc') || '').length : 0,
    sandbox: frame ? frame.getAttribute('sandbox') : null,
    frameTitle: frame ? frame.getAttribute('title') : null,
    frameStyle: frame ? frame.getAttribute('style') : null,
    viewport: {width: window.innerWidth, height: window.innerHeight},
    scrollY: window.scrollY,
    page: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
}"""

INNER_READINESS = """() => {
  const target = document.querySelector('h1.doc-title, .doc-title, .label-cell');
  const rect = target ? target.getBoundingClientRect() : null;
  const fonts = document.fonts ? document.fonts.status : 'unsupported';
  const body = document.body;
  const doc = document.documentElement;
  return {
    ready: document.readyState === 'complete' && fonts !== 'loading'
      && !!rect && rect.width > 8 && rect.height > 4,
    readyState: document.readyState,
    fonts: fonts,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    bodyScrollWidth: body.scrollWidth,
    bodyScrollHeight: body.scrollHeight,
    docScrollWidth: doc.scrollWidth,
    docScrollHeight: doc.scrollHeight,
    scale: window.visualViewport ? window.visualViewport.scale : null,
    bodyZoom: getComputedStyle(body).zoom,
    bodyTransform: getComputedStyle(body).transform,
    target: target ? (target.className || target.tagName) : null,
    rect: rect ? {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                  right: rect.right, bottom: rect.bottom} : null,
    fontSize: target ? getComputedStyle(target).fontSize : null,
    fontFamily: target ? getComputedStyle(target).fontFamily : null,
    text: target ? (target.textContent || '').trim().slice(0, 120) : null,
    blocks: document.querySelectorAll('table.doc-table').length,
    cells: document.querySelectorAll('.label-cell').length,
    cellsOutside: Array.from(document.querySelectorAll('.label-cell'))
      .filter((cell) => cell.getBoundingClientRect().right > window.innerWidth + 1).length,
    overflowing: Array.from(document.querySelectorAll('body *'))
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((node) => (node.tagName.toLowerCase() + '.' + (node.className || '')).slice(0, 56)
        + ' right=' + Math.round(node.getBoundingClientRect().right)),
    paragraphs: document.querySelectorAll('p, td, th, dd, dt').length
  };
}"""


def frame_handle(page):
    node = page.query_selector(".doc-pages iframe")
    if node is None:
        return None
    return node.content_frame()


def same_layout(first: dict, second: dict, tolerance: float = 0.5) -> bool:
    if first.get("ready") != second.get("ready"):
        return False
    for key in ("docScrollWidth", "docScrollHeight", "innerWidth", "innerHeight"):
        if abs((first.get(key) or 0) - (second.get(key) or 0)) > tolerance:
            return False
    left, right = first.get("rect") or {}, second.get("rect") or {}
    return all(abs((left.get(key) or 0) - (right.get(key) or 0)) <= tolerance
               for key in ("x", "y", "width", "height"))


def wait_preview_ready(page, label: str, deadline: float = 45.0) -> dict:
    """Bounded readiness: parsed document, settled fonts, stable laid-out text."""
    end = time.monotonic() + deadline
    last: dict = {"error": "no iframe element"}
    while time.monotonic() < end:
        frame = frame_handle(page)
        if frame is not None:
            try:
                first = frame.evaluate(INNER_READINESS)
            except Exception as exc:  # frame detached while srcdoc swapped
                first = {"error": type(exc).__name__}
            if first.get("ready"):
                page.wait_for_timeout(120)
                try:
                    second = frame.evaluate(INNER_READINESS)
                except Exception as exc:
                    last = {"error": type(exc).__name__}
                else:
                    if same_layout(first, second):
                        # Parsed, fonts loaded, and two samples 120 ms apart
                        # agree: the sandboxed document has settled.
                        return second
                    last = {"error": "layout still moving", "first": first, "second": second}
            else:
                last = first
        page.wait_for_timeout(120)
    fail(f"preview {label}: not ready within {deadline:.0f}s ({redact(last)})")
    return last


def analyze_image(image: Image.Image, floor: int = 8) -> dict:
    """Painted pixels: ink ratio, ink box and dark-text pixels of a real capture."""
    width, height = image.size
    difference = ImageChops.difference(image, Image.new("RGB", image.size, (255, 255, 255)))
    mask = difference.convert("L").point(lambda value: 255 if value > floor else 0)
    bbox = mask.getbbox()
    ink = mask.histogram()[255]
    luminance = image.convert("L")
    dark = sum(count for value, count in enumerate(luminance.histogram()) if value < 128)
    area = width * height
    ink_box = None
    if bbox:
        ink_box = {"x": bbox[0], "y": bbox[1],
                   "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]}
    return {
        "size": f"{width}x{height}",
        "area": area,
        "ink": ink,
        "inkRatio": ink / area if area else 0.0,
        "dark": dark,
        "darkRatio": dark / area if area else 0.0,
        "box": ink_box,
    }


def analyze_png(path: Path, floor: int = 8) -> dict:
    with Image.open(path) as raw:
        return analyze_image(raw.convert("RGB"), floor)


def analyze_region(path: Path, box: dict, floor: int = 8) -> dict:
    """Ink inside one page region of a full-page capture."""
    with Image.open(path) as raw:
        image = raw.convert("RGB")
    left = max(0, int(round(box["x"])))
    top = max(0, int(round(box["y"])))
    crop = image.crop((left, top, left + int(round(box["width"])),
                       top + int(round(box["height"]))))
    return analyze_image(crop, floor)


def stats_line(name: str, stats: dict) -> str:
    box = stats["box"]
    covered = "none" if not box else (
        f"{box['width'] / max(1, int(stats['size'].split('x')[0])):.2f}x"
        f"{box['height'] / max(1, int(stats['size'].split('x')[1])):.2f}")
    return (f"{name} size={stats['size']} ink={stats['ink']}px "
            f"ratio={stats['inkRatio']:.4f} dark={stats['dark']}px "
            f"darkRatio={stats['darkRatio']:.4f} inkbox={box} covered={covered}")


def assert_painted(path: Path, label: str) -> dict:
    stats = analyze_png(path)
    record(f"PIXELS {label} {stats_line(path.name, stats)}")
    box = stats["box"]
    width, height = (int(value) for value in stats["size"].split("x"))
    require(stats["dark"] >= MIN_INK_PIXELS,
            f"{label}: only {stats['dark']} dark pixels, the capture is blank")
    require(bool(box) and box["width"] >= MIN_INK_WIDTH_RATIO * width,
            f"{label}: ink does not span the capture width ({box})")
    require(bool(box) and box["height"] >= MIN_INK_HEIGHT_RATIO * height,
            f"{label}: ink does not span the capture height ({box})")
    return stats


def element_shot(page, shots: Path, selector: str, name: str) -> Path | None:
    path = shots / f"{name}.png"
    target = page.locator(selector).first
    box = target.bounding_box()
    try:
        target.screenshot(path=str(path))
        record(f"SHOT {path.name} selector={selector} mode=element box={box}")
        return path
    except Exception as exc:  # element capture unsupported for this node
        record(f"SHOT {path.name} selector={selector} mode=element-unavailable "
               f"reason={type(exc).__name__}")
    if not box:
        fail(f"{name}: no bounding box for {selector}")
        return None
    try:
        page.screenshot(path=str(path), clip=box)
        record(f"SHOT {path.name} selector={selector} mode=clip box={box}")
        return path
    except Exception as exc:
        fail(f"{name}: clip capture failed ({type(exc).__name__}: {exc})")
        return None


def assert_region_painted(path: Path, box: dict, label: str) -> dict:
    """Ink inside the frame region of a capture, not merely somewhere on screen."""
    stats = analyze_region(path, box)
    record(f"PIXELS {label} region={box} {stats_line(path.name + ':region', stats)}")
    width = int(round(box.get("width", 1)))
    height = int(round(box.get("height", 1)))
    require(stats["dark"] >= MIN_INK_PIXELS,
            f"{label}: only {stats['dark']} dark pixels inside the frame region")
    ink_box = stats["box"]
    require(bool(ink_box) and ink_box["width"] >= MIN_INK_WIDTH_RATIO * width,
            f"{label}: the frame region ink does not span its width ({ink_box})")
    require(bool(ink_box) and ink_box["height"] >= MIN_INK_HEIGHT_RATIO * height,
            f"{label}: the frame region ink does not span its height ({ink_box})")
    return stats


def capture_modes(page, shots: Path, name: str) -> dict:
    """Element, scrolled-viewport and full-page captures of one preview."""
    iframe = page.locator(".doc-pages iframe").first
    iframe.scroll_into_view_if_needed()
    page.wait_for_function(
        """() => {
          const frame = document.querySelector('.doc-pages iframe');
          if (!frame) return false;
          const r = frame.getBoundingClientRect();
          return r.top < window.innerHeight - 8 && r.bottom > 8;
        }""",
        timeout=10000,
    )
    # A scroll that lands here hands Chromium a new compositing position: its
    # frames have to run before the viewport capture can show the iframe at all.
    page.evaluate("""() => new Promise((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
    })""")
    scroll = page.evaluate("() => window.scrollY")
    box = iframe.bounding_box() or {}
    record(f"VISIBLE {name} frameBox={box} scrollY={scroll}")

    # The element captures run first: they force the document to paint before the
    # viewport capture reads the same region.
    iframe_path = element_shot(page, shots, ".doc-pages iframe", f"{name}-iframe")
    pages_path = element_shot(page, shots, ".doc-pages", f"{name}-pages")
    viewport_path = shots / f"{name}-viewport.png"
    page.screenshot(path=str(viewport_path))
    record(f"SHOT {viewport_path.name} mode=viewport scrollY={page.evaluate('() => window.scrollY')}")
    full_path = shots / f"{name}-full.png"
    page.screenshot(path=str(full_path), full_page=True)
    record(f"SHOT {full_path.name} mode=full_page")

    element_stats = assert_painted(iframe_path, f"{name} element") if iframe_path else None
    if pages_path:
        analyze_png(pages_path)
    if box:
        assert_region_painted(viewport_path, box, f"{name} viewport")

    # The same frame, in page coordinates, inside the full-page capture.
    region = {"x": box.get("x", 0), "y": box.get("y", 0) + scroll,
              "width": box.get("width", 1), "height": box.get("height", 1)}
    region_stats = analyze_region(full_path, region)
    record(f"PIXELS {name} full_page_region={region} "
           f"{stats_line('region', region_stats)}")
    element_ink = (element_stats or {}).get("dark", 0)
    if element_ink < MIN_INK_PIXELS:
        verdict = "blank-content"
    elif region_stats["dark"] >= MIN_INK_PIXELS:
        verdict = "painted-parity"
    else:
        verdict = "capture-artifact"
    record(f"CAPTURE-MODE {name} elementInk={element_ink}px "
           f"fullPageRegionInk={region_stats['dark']}px verdict={verdict}")
    return {"box": box, "region": region, "verdict": verdict,
            "elementInk": element_ink, "regionInk": region_stats["dark"]}


# The generated report document declares its own page size. The preview is
# measured against the document that is on screen, never against a draft, a
# template record or a guessed width.
PAGE_RULE = re.compile(r"@page\s*\{[^}]*?\bsize:\s*([a-z0-9.]+)", re.I)
PAGE_MM = {"a4": 210.0, "letter": 215.9, "legal": 215.9}
PAGE_DPI = 96.0
MM_PER_INCH = 25.4


def rendered_page_mm(html: str) -> float:
    """Physical page width the server declared in the document it generated."""
    match = PAGE_RULE.search(html or "")
    if not match:
        return 0.0
    token = match.group(1).lower()
    if token in PAGE_MM:
        return PAGE_MM[token]
    try:
        return float(token.removesuffix("mm"))
    except ValueError:
        return 0.0

def set_locale(page, tag: str) -> None:
    """Switch the running bundle to a shipped catalog and prove it applied."""
    page.evaluate(
        """async (tag) => {
          if (window.ItsmI18n && window.ItsmI18n.loadBundle) {
            try { await window.ItsmI18n.loadBundle(tag); } catch (error) {}
            window.ItsmI18n.setLocale(tag);
          }
        }""", tag)
    page.wait_for_function("(tag) => document.documentElement.lang === tag", arg=tag, timeout=20000)
    current = page.evaluate("() => document.documentElement.lang")
    record(f"LOCALE requested={tag} effective={current!r}")
    require(current == tag, f"locale stayed at {current!r} instead of {tag!r}")


def set_theme(page, mode: str) -> None:
    page.evaluate("(mode) => { if (window.AssetTheme) window.AssetTheme.set(mode); }", mode)
    page.wait_for_function(
        "(mode) => document.documentElement.dataset.theme === mode", arg=mode, timeout=20000)
    current = page.evaluate("() => document.documentElement.dataset.theme")
    record(f"THEME-CHANGE requested={mode} effective={current!r}")
    require(current == mode, f"theme stayed at {current!r} instead of {mode!r}")


def count_light(path: Path, threshold: int = 190) -> int:
    """Pixels lighter than the threshold: light text painted on a dark surface."""
    with Image.open(path) as raw:
        histogram = raw.convert("L").histogram()
    return sum(histogram[threshold + 1:])


def report_preview(page, shots: Path, width: int, height: int, suffix: str = "",
                   locale: str = "", theme: str = "", page_format: str = "") -> dict:
    """Ask for one report preview and measure what actually painted."""
    axes = f"{width}{suffix}"
    kind = f"reports-{axes}"
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, "#/reportes", MARKER_REPORTS, f"reports {axes}")
    # The route load restores the stored axes, so the requested locale and theme
    # are applied to the running document and asserted at capture time.
    if locale:
        set_locale(page, locale)
    if theme:
        set_theme(page, theme)
    # A different supported page size must be requested through the public
    # builder control, so the fit follows the document the server composes.
    if page_format:
        css = f'select:has(option[value="{page_format}"])'
        if page.locator(css).count() == 0:
            # The paper select lives in the template editor: open it first.
            page.locator('button.text-button:has-text("omposi")').first.click()
        control = page.locator(css).first
        control.wait_for(state="visible", timeout=15000)
        control.select_option(page_format)
        chosen = control.input_value()
        record(f"FORMAT reports {axes} requested={page_format} chosen={chosen}")
        require(chosen == page_format, f"reports {axes}: page format control did not accept {page_format}")

    trigger = page.locator(".doc-preview-toolbar .btn").first
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/reports/preview"), timeout=60000
    ) as info:
        trigger.click()
    response = info.value
    status = response.status
    payload: dict = {}
    try:
        payload = response.json()
    except Exception as exc:
        fail(f"reports {axes}: preview payload is not JSON ({type(exc).__name__})")
    html = payload.get("html") or ""
    record(f"PREVIEW reports width={axes} theme={page.evaluate('document.documentElement.dataset.theme')!r} "
           f"locale={page.evaluate('document.documentElement.lang')!r} format={page_format or 'default'} "
           f"status={status} "
           f"contentType={response.headers.get('content-type')} htmlBytes={len(html)}")

    page.wait_for_selector(".doc-pages iframe", timeout=30000)
    outer_before = page.evaluate(OUTER_GEOMETRY)
    inner = wait_preview_ready(page, f"reports {axes}")
    outer = page.evaluate(OUTER_GEOMETRY)

    frame_box = outer["frame"] or {}
    pages_box = outer["pages"] or {}
    before_box = outer_before["frame"] or {}
    below_fold = bool(before_box) and before_box["top"] > outer_before["viewport"]["height"]
    clipped = inner.get("docScrollWidth", 0) - inner.get("innerWidth", 0)
    record(
        f"GEOMETRY reports width={axes} iframe={frame_box} pages={pages_box} "
        f"srcdoc={outer['srcdocLength']}B sandbox={outer['sandbox']!r} "
        f"belowFoldBefore={below_fold} scrollYBefore={outer_before['scrollY']} "
        f"scrollYAfter={outer['scrollY']}"
    )
    record(
        f"INNER reports width={axes} target={(inner.get('target') or '')[:40]!r} "
        f"rect={inner.get('rect')} inner={inner.get('innerWidth')}x{inner.get('innerHeight')} "
        f"scroll={inner.get('docScrollWidth')}x{inner.get('docScrollHeight')} "
        f"horizontalClip={clipped}px scale={inner.get('scale')} zoom={inner.get('bodyZoom')!r} "
        f"transform={inner.get('bodyTransform')!r} fonts={inner.get('fonts')} "
        f"fontSize={inner.get('fontSize')} fontFamily={(inner.get('fontFamily') or '')[:48]!r} "
        f"blocks={inner.get('blocks')} paragraphs={inner.get('paragraphs')}"
    )

    page_mm = rendered_page_mm(html)
    page_px = round(page_mm * PAGE_DPI / MM_PER_INCH, 2)
    column = page.evaluate(
        """() => {
          const pages = document.querySelector('.doc-pages');
          if (!pages) return 0;
          const style = getComputedStyle(pages);
          return Math.round(pages.clientWidth
            - (parseFloat(style.paddingLeft) || 0)
            - (parseFloat(style.paddingRight) || 0));
        }"""
    )
    frame_width = frame_box.get("width") or 0
    inner_width = inner.get("innerWidth") or 0
    scale = round(frame_width / inner_width, 4) if inner_width else 0
    record(f"PAGE-FIT reports width={axes} pageMm={page_mm} pagePx={page_px} "
           f"column={column} frameWidth={frame_width} innerWidth={inner_width} "
           f"scale={scale} clipped={clipped}px")

    require(status == 200, f"reports {axes}: preview status {status}")
    require(len(html) > 200, f"reports {axes}: server document only {len(html)} bytes")
    require(page_mm > 0, f"reports {axes}: the document declares no page size")
    require(bool(frame_box) and frame_box["width"] > 100 and frame_box["height"] > 100,
            f"reports {axes}: iframe box {frame_box} is not a usable preview area")
    require(bool(inner.get("rect")) and inner["rect"]["width"] > 4
            and inner["rect"]["height"] > 4,
            f"reports {axes}: title box {inner.get('rect')} is not laid out")
    require(inner.get("docScrollHeight", 0) > 200,
            f"reports {axes}: document height {inner.get('docScrollHeight')} has no body")
    # The document keeps its physical page layout: a narrower viewport reflows
    # the print table and pushes its right-hand columns out of reach.
    require(abs(inner_width - page_px) <= 2,
            f"reports {axes}: document lays out at {inner_width}px instead of its "
            f"{page_px}px page width")
    require(clipped <= 2,
            f"reports {axes}: document is clipped by {clipped}px inside its page width")
    # The fitted preview fills the column it lives in, so the whole page is on
    # screen instead of overflowing the panel.
    require(column > 0 and frame_width <= column + 1,
            f"reports {axes}: preview is {frame_width}px wide in a {column}px column")
    require(column > 0 and frame_width >= column - 2,
            f"reports {axes}: preview only fills {frame_width}px of a {column}px column")

    capture = capture_modes(page, shots, kind)
    require(outer["srcdocLength"] == len(html),
            f"reports {axes}: srcdoc {outer['srcdocLength']}B != server html {len(html)}B")
    # The rightmost column is what the old fluid layout pushed out of the frame.
    # Require it inside the page and painted in the element capture: a box in the
    # DOM is not a rendered table.
    frame = frame_handle(page)
    cell = frame.evaluate(
        """() => {
          const row = document.querySelector('table.doc-table thead tr')
            || document.querySelector('table.doc-table tr');
          if (!row) return null;
          const cells = Array.from(row.querySelectorAll('th,td'));
          const cell = cells[cells.length - 1];
          if (!cell) return null;
          const r = cell.getBoundingClientRect();
          return {
            text: (cell.textContent || '').trim().slice(0, 40),
            x: r.x, y: r.y, width: r.width, height: r.height, right: r.right,
            innerWidth: window.innerWidth
          };
        }"""
    )
    if not cell:
        fail(f"reports {axes}: the generated document has no table row")
    else:
        inside = cell["right"] <= cell["innerWidth"] + 1
        record(f"RIGHTMOST reports width={axes} text={cell['text']!r} "
               f"right={round(cell['right'], 2)} innerWidth={cell['innerWidth']} "
               f"inside={inside}")
        require(inside, f"reports {axes}: the rightmost column ends at "
                        f"{round(cell['right'], 2)}px in a {cell['innerWidth']}px document")
        region = {
            "x": round(cell["x"] * scale, 1),
            "y": round(cell["y"] * scale, 1),
            "width": max(1, round(cell["width"] * scale, 1)),
            "height": max(1, round(cell["height"] * scale, 1)),
        }
        stats = analyze_region(shots / f"{kind}-iframe.png", region)
        record(f"PIXELS reports width={axes} rightmost={region} "
               f"{stats_line('rightmost', stats)}")
        require(stats["dark"] >= 12, f"reports {axes}: the rightmost column carries "
                                     f"only {stats['dark']} dark pixels")
    return {"outer": outer, "inner": inner, "capture": capture, "clipped": clipped}


def preview_teardown(page, shots: Path) -> None:
    """Leaving the view with a preview settling must not resurrect its observer."""
    open_route(page, "#/reportes", MARKER_REPORTS, "teardown reports")
    trigger = page.locator(".doc-preview-toolbar .btn").first
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/reports/preview"), timeout=60000
    ):
        trigger.click()
    # Leave before the queued observation runs: the detached preview must not be
    # observed or fitted after its view is gone, and nothing may throw.
    page.evaluate("() => { window.location.hash = '#/panel'; }")
    page.wait_for_function("() => window.location.hash === '#/panel'", timeout=15000)
    page.wait_for_timeout(1200)
    state = page.evaluate("""() => ({
      hash: window.location.hash,
      shell: document.querySelectorAll('.app-shell').length,
      previews: document.querySelectorAll('.doc-pages').length,
      iframes: document.querySelectorAll('.doc-pages iframe').length
    })""")
    record(f"TEARDOWN hash={state['hash']} shell={state['shell']} "
           f"previews={state['previews']} iframes={state['iframes']}")
    require(state["hash"] == "#/panel", "teardown: leaving the preview view did not land on the panel")
    require(state["shell"] == 1, "teardown: the shell did not survive leaving the preview view")
    require(state["previews"] == 0, "teardown: the detached preview container is still in the document")
    # The view still works afterwards: a fresh preview is fitted as before.
    report_preview(page, shots, 390, 844, suffix="-recovered")


def label_preview(page, shots: Path, width: int, height: int, suffix: str = "") -> dict:
    kind = f"labels-{width}{suffix}"
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, "#/etiquetas", MARKER_LABELS, f"labels {width}{suffix}")

    trigger = page.locator(".doc-preview-toolbar .btn").first
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/reports/preview"), timeout=60000
    ) as info:
        trigger.click()
    response = info.value
    status = response.status
    payload: dict = {}
    try:
        payload = response.json()
    except Exception as exc:
        fail(f"labels {width}: preview payload is not JSON ({type(exc).__name__})")
    html = payload.get("html") or ""
    record(f"PREVIEW labels width={width} status={status} "
           f"contentType={response.headers.get('content-type')} htmlBytes={len(html)}")

    page.wait_for_selector(".doc-pages iframe", timeout=30000)
    inner = wait_preview_ready(page, f"labels {width}")
    outer = page.evaluate(OUTER_GEOMETRY)

    frame_box = outer["frame"] or {}
    below_fold = bool(frame_box) and frame_box["top"] > outer["viewport"]["height"]
    clipped = inner.get("docScrollWidth", 0) - inner.get("innerWidth", 0)
    record(
        f"GEOMETRY labels width={width} iframe={frame_box} pages={outer['pages']} "
        f"srcdoc={outer['srcdocLength']}B sandbox={outer['sandbox']!r} "
        f"belowFold={below_fold} scrollY={outer['scrollY']}"
    )
    record(
        f"INNER labels width={width} target={(inner.get('target') or '')[:40]!r} "
        f"rect={inner.get('rect')} inner={inner.get('innerWidth')}x{inner.get('innerHeight')} "
        f"scroll={inner.get('docScrollWidth')}x{inner.get('docScrollHeight')} "
        f"horizontalClip={clipped}px scale={inner.get('scale')} zoom={inner.get('bodyZoom')!r} "
        f"fonts={inner.get('fonts')} fontSize={inner.get('fontSize')} "
        f"cells={inner.get('cells')} paragraphs={inner.get('paragraphs')}"
    )

    require(status == 200, f"labels {width}: preview status {status}")
    require(len(html) > 200, f"labels {width}: server document only {len(html)} bytes")
    require(bool(frame_box) and frame_box["width"] > 100 and frame_box["height"] > 100,
            f"labels {width}: iframe box {frame_box} is not a usable preview area")
    require(bool(inner.get("rect")) and inner["rect"]["width"] > 8
            and inner["rect"]["height"] > 4,
            f"labels {width}: label cell box {inner.get('rect')} is not laid out")
    require(inner.get("cells", 0) >= 1, f"labels {width}: no label cell inside the sheet")

    capture = capture_modes(page, shots, kind)
    column = page.evaluate(
        """() => {
          const pages = document.querySelector('.doc-pages');
          if (!pages) return 0;
          const style = getComputedStyle(pages);
          return pages.clientWidth - (parseFloat(style.paddingLeft) || 0)
            - (parseFloat(style.paddingRight) || 0);
        }"""
    )
    sheet = inner.get("docScrollWidth", 0)
    rendered = capture["box"].get("width", 0)
    record(f"LABEL-FIT labels width={width} sheet={sheet}px frame={inner.get('innerWidth')}px "
           f"column={round(column, 2)}px rendered={round(rendered, 2)}px "
           f"scale={round(rendered / sheet, 4) if sheet else None} "
           f"cellsOutside={inner.get('cellsOutside')}")

    # The sheet is generated at its real page width, so the preview must fit it
    # to the column: every label stays visible instead of the right-hand labels
    # being clipped out of view.
    require(clipped <= 2, f"labels {width}: document is {clipped}px wider than the frame")
    require(inner.get("cellsOutside", 0) == 0,
            f"labels {width}: {inner.get('cellsOutside')} label cells sit outside the frame")
    require(rendered <= column + 1,
            f"labels {width}: rendered sheet {rendered:.1f}px exceeds the "
            f"preview column {column:.1f}px")
    if sheet > column + 1:
        require(rendered >= column - 2,
                f"labels {width}: sheet is fitted to {rendered:.1f}px of a "
                f"{column:.1f}px column")

    # A draft edit must not re-fit a document that was already generated: the fit
    # is bound to the rendered HTML, so the frame keeps its renderer geometry
    # until a new preview replaces it.
    page.select_option(".doc-controls select", "custom")
    draft_input = page.locator('input[type="number"][min="20"][max="1000"]').first
    if draft_input.count() == 0:
        fail(f"labels {width}: no page width draft control")
    else:
        frame_style = """() => {
          const frame = document.querySelector('.doc-pages iframe');
          if (!frame) return null;
          const style = getComputedStyle(frame);
          return {width: style.width, transform: style.transform,
                  srcdoc: (frame.getAttribute('srcdoc') || '').length};
        }"""
        before_style = page.evaluate(frame_style)
        draft_input.fill("100")
        page.wait_for_timeout(400)
        after_style = page.evaluate(frame_style)
        draft = draft_input.input_value()
        draft_inner = wait_preview_ready(page, f"labels {width} draft")
        frame = frame_handle(page)
        rightmost = None
        if frame is not None:
            rightmost = frame.evaluate(
                """() => {
                  const cells = Array.from(document.querySelectorAll('.label-cell'));
                  if (!cells.length) return null;
                  return Math.max(...cells.map((cell) => cell.getBoundingClientRect().right));
                }""")
        draft_clipped = draft_inner.get("docScrollWidth", 0) - draft_inner.get("innerWidth", 0)
        html_kept = bool(before_style and after_style
                         and after_style["srcdoc"] == before_style["srcdoc"])
        fit_kept = bool(before_style and after_style
                        and after_style["transform"] == before_style["transform"])
        record(f"LABEL-DRAFT labels width={width} draft={draft}mm html={after_style} "
               f"htmlKept={html_kept} fitKept={fit_kept} "
               f"inner={draft_inner.get('innerWidth')}px sheet={draft_inner.get('docScrollWidth')}px "
               f"clipped={draft_clipped}px cellsOutside={draft_inner.get('cellsOutside')} "
               f"rightmostCell={round(rightmost, 2) if rightmost else rightmost}")
        require(draft == "100", f"labels {width}: the page width draft stayed at {draft!r}")
        require(html_kept, f"labels {width}: the preview document changed without a new request")
        require(fit_kept,
                f"labels {width}: the fitted frame followed the draft width instead of the document")
        require(draft_inner.get("cellsOutside", 0) == 0,
                f"labels {width}: {draft_inner.get('cellsOutside')} label cells sit outside the "
                f"rendered document after the draft edit")
        require(draft_clipped <= 2,
                f"labels {width}: the rendered document is {draft_clipped}px wider than its frame "
                f"after the draft edit")
        require(bool(rightmost) and rightmost <= draft_inner.get("innerWidth", 0) + 1,
                f"labels {width}: the rightmost label reaches {rightmost}px past "
                f"{draft_inner.get('innerWidth')}px")
        element_shot(page, shots, ".doc-pages iframe", f"{kind}-draft100")

    return {"outer": outer, "inner": inner, "capture": capture, "column": column}


# -------------------------------------------------------------------- warranty

DIALOG_STATE = """() => {
  const rect = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom};
  };
  const layer = document.querySelector('.modal-layer');
  const modal = document.querySelector('.modal');
  const form = document.querySelector('#warranty-edit-form');
  const style = (node) => (node ? getComputedStyle(node) : null);
  const modalStyle = style(modal);
  const layerStyle = style(layer);
  const active = document.activeElement;
  return {
    layer: rect(layer),
    modal: rect(modal),
    form: rect(form),
    layerOpacity: layerStyle ? layerStyle.opacity : null,
    modalOpacity: modalStyle ? modalStyle.opacity : null,
    modalTransform: modalStyle ? modalStyle.transform : null,
    modalVisibility: modalStyle ? modalStyle.visibility : null,
    modalDisplay: modalStyle ? modalStyle.display : null,
    role: modal ? modal.getAttribute('role') : null,
    ariaModal: modal ? modal.getAttribute('aria-modal') : null,
    labelledBy: modal ? modal.getAttribute('aria-labelledby') : null,
    title: modal && modal.getAttribute('aria-labelledby')
      ? ((document.getElementById(modal.getAttribute('aria-labelledby')) || {}).textContent || '').trim()
      : null,
    running: document.getAnimations()
      .filter((item) => item.playState === 'running')
      .map((item) => item.transitionProperty || item.animationName || 'unknown'),
    activeTag: active ? active.tagName : null,
    activeProbe: active && active.dataset ? (active.dataset.probeTrigger || null) : null,
    bodyOverflow: document.body.style.overflow,
    scrollY: window.scrollY,
    viewport: {width: window.innerWidth, height: window.innerHeight}
  };
}"""


def wait_dialog_ready(page, label: str, deadline: float = 15000.0) -> dict:
    """Modal is attached, painted, its transition finished and the form laid out."""
    page.wait_for_selector(".modal-layer .modal", timeout=deadline)
    page.wait_for_function(
        """() => {
          const layer = document.querySelector('.modal-layer');
          const modal = document.querySelector('.modal');
          if (!layer || !modal) return false;
          const modalStyle = getComputedStyle(modal);
          const layerStyle = getComputedStyle(layer);
          const r = modal.getBoundingClientRect();
          const identity = modalStyle.transform === 'none'
            || /^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(modalStyle.transform);
          return layerStyle.opacity === '1' && modalStyle.opacity === '1'
            && modalStyle.visibility === 'visible' && identity
            && r.width > 100 && r.height > 100
            && document.getAnimations().every((item) => item.playState !== 'running');
        }""",
        timeout=deadline,
    )
    first = page.evaluate(DIALOG_STATE)
    page.wait_for_function(
        "() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))",
        timeout=5000,
    )
    second = page.evaluate(DIALOG_STATE)
    first_box, second_box = first.get("modal") or {}, second.get("modal") or {}
    stable = all(abs(first_box.get(key, 0) - second_box.get(key, 0)) <= 0.5
                 for key in ("x", "y", "width", "height"))
    require(stable, f"{label}: form box moved between frames ({first_box} -> {second_box})")
    return second


def warranty_dialog(page, shots: Path, width: int, height: int, asset_id: str) -> dict:
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, f"#/activo/{asset_id}", MARKER_WARRANTY, f"warranty {width}")

    trigger = page.locator('[data-od-id="asset-warranty-panel"] button').first
    trigger.evaluate("(node) => { node.dataset.probeTrigger = 'warranty-edit'; }")
    trigger_box = trigger.bounding_box() or {}
    trigger_name = (trigger.get_attribute("aria-label") or trigger.inner_text()).strip()
    record(f"TRIGGER warranty width={width} role=button name={trigger_name!r} "
           f"box={trigger_box} minSide={min(trigger_box.get('width', 0), trigger_box.get('height', 0))}")
    require("Editar" in trigger_name or "Edit" in trigger_name,
            f"warranty {width}: the trigger is not the editor action ({trigger_name!r})")
    require(min(trigger_box.get("width", 0), trigger_box.get("height", 0)) >= 24,
            f"warranty {width}: trigger {trigger_box} is not a usable target")

    trigger.click()
    state = wait_dialog_ready(page, f"warranty {width}")
    record(
        f"DIALOG warranty width={width} role={state['role']} ariaModal={state['ariaModal']} "
        f"title={state['title']!r} layer={state['layer']} modal={state['modal']} "
        f"layerOpacity={state['layerOpacity']} modalOpacity={state['modalOpacity']} "
        f"transform={state['modalTransform']!r} running={state['running']} "
        f"bodyOverflow={state['bodyOverflow']!r} formBox={state['form']}"
    )

    modal_box = state["modal"] or {}
    require(state["role"] == "dialog" and state["ariaModal"] == "true",
            f"warranty {width}: modal lost role/aria-modal")
    require(bool(state["labelledBy"]) and bool(state["title"]),
            f"warranty {width}: dialog is not labelled ({state['labelledBy']!r})")
    require(bool(modal_box) and modal_box["top"] >= 0 and modal_box["bottom"] <= height + 1,
            f"warranty {width}: modal box {modal_box} leaves the {height}px viewport")
    require(bool(state["form"]) and (state["form"] or {}).get("height", 0) > 200,
            f"warranty {width}: the editor form is not laid out ({state['form']})")

    dialog_path = element_shot(page, shots, ".modal", f"warranty-dialog-{width}")
    context_path = shots / f"warranty-dialog-{width}-viewport.png"
    page.screenshot(path=str(context_path))
    record(f"SHOT {context_path.name} mode=viewport layer={state['layer']}")
    if dialog_path:
        assert_painted(dialog_path, f"warranty {width} dialog")

    # The 390 sheet scrolls its body: the receipt block reaches the reader by
    # scrolling, not by being present in the DOM.
    scroll = page.evaluate("""() => {
      const body = document.querySelector('.modal__body');
      if (!body) return null;
      const form = body.querySelector('#warranty-edit-form');
      const last = form ? form.lastElementChild : null;
      const style = getComputedStyle(body);
      const before = {scrollTop: body.scrollTop, scrollHeight: body.scrollHeight,
                      clientHeight: body.clientHeight, overflowY: style.overflowY};
      body.scrollTop = body.scrollHeight;
      const view = body.getBoundingClientRect();
      const lastBox = last ? last.getBoundingClientRect() : null;
      return {before, after: body.scrollTop,
              last: last ? (last.className || last.tagName) : null,
              lastBox: lastBox ? {top: lastBox.top, bottom: lastBox.bottom} : null,
              bodyBox: {top: view.top, bottom: view.bottom},
              reachable: lastBox ? lastBox.bottom <= view.bottom + 2 : false,
              visible: lastBox ? (lastBox.top >= view.top - 2 && lastBox.bottom <= view.bottom + 2) : false};
    }""")
    require(bool(scroll), f"warranty {width}: the dialog body is missing")
    before = scroll["before"]
    scrollable = before["scrollHeight"] > before["clientHeight"] + 2
    record(f"DIALOG body warranty width={width} overflowY={before['overflowY']} "
           f"scrollHeight={before['scrollHeight']} clientHeight={before['clientHeight']} "
           f"scrollTopBefore={before['scrollTop']} scrollTopAfter={scroll['after']} "
           f"last={scroll['last']!r} lastBox={scroll['lastBox']} bodyBox={scroll['bodyBox']} "
           f"scrollable={scrollable} reachable={scroll['reachable']}")
    require(before["overflowY"] in ("auto", "scroll"),
            f"warranty {width}: the dialog body is {before['overflowY']!r}, not scrollable")
    if scrollable:
        require(scroll["after"] > 0,
                f"warranty {width}: the dialog body did not scroll to its end")
        require(scroll["reachable"],
                f"warranty {width}: the last form block stays below the body after scrolling "
                f"({scroll['lastBox']} vs {scroll['bodyBox']})")
    else:
        require(scroll["visible"],
                f"warranty {width}: the last form block is not visible ({scroll['lastBox']})")
    element_shot(page, shots, ".modal", f"warranty-dialog-{width}-body-end")

    page.keyboard.press("Escape")
    page.wait_for_selector(".modal-layer", state="detached", timeout=15000)
    after = page.evaluate(DIALOG_STATE)
    record(
        f"ESCAPE warranty width={width} modal={after['modal']} activeTag={after['activeTag']} "
        f"activeProbe={after['activeProbe']} bodyOverflow={after['bodyOverflow']!r} "
        f"scrollY={after['scrollY']}"
    )
    require(after["modal"] is None, f"warranty {width}: dialog still mounted after Escape")
    require(after["activeProbe"] == "warranty-edit",
            f"warranty {width}: focus went to {after['activeTag']}/{after['activeProbe']} after Escape")
    require(after["bodyOverflow"] in ("", None),
            f"warranty {width}: body scroll stayed locked ({after['bodyOverflow']!r})")
    return state


# ------------------------------------------------------------------ share page

def console_error(message) -> str:
    """Real console failures; the sandboxed print document blocks its own scripts."""
    if message.type != "error":
        return ""
    text = redact(message.text)
    if ERROR_NOISE.search(text):
        return ""
    return text


def watch_page(page) -> dict:
    """Page, console and HTTP failures, with any capability redacted."""
    sink: dict = {"pageerror": [], "console": [], "warning": [], "http": []}

    def note_error(error) -> None:
        sink["pageerror"].append(redact(error))

    def note_console(message) -> None:
        if message.type == "warning":
            sink["warning"].append(redact(message.text)[:300])
            return
        text = console_error(message)
        if text:
            sink["console"].append(text)

    def note_http(response) -> None:
        if response.status >= 400:
            sink["http"].append(f"{response.status} {redact(response.url)}")

    page.on("pageerror", note_error)
    page.on("console", note_console)
    page.on("response", note_http)
    return sink


def report_failures(sink: dict, label: str) -> None:
    record(f"HTTP {label} errors={sink['http'] or 'none'}")
    record(f"CONSOLE {label} errors={sink['console'] or 'none'}")
    record(f"WARNINGS {label} count={len(sink['warning'])} first={sink['warning'][:2] or 'none'}")
    require(not sink["pageerror"], f"{label} page errors: {sink['pageerror'][:3]}")
    record(f"PAGEERRORS {label}=0")


PUBLIC_STATE = """() => {
  const text = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim();
  return {
    hash: window.location.hash,
    title: document.title,
    chars: text.length,
    text: text.slice(0, 220),
    ids: Array.from(document.querySelectorAll('[data-od-id]'))
      .map((node) => node.dataset.odId).slice(0, 12),
    forms: document.querySelectorAll('form').length,
    heading: (document.querySelector('h1, h2') || {}).textContent || null,
    appShell: document.querySelectorAll('.app-shell').length,
    qrEmpty: document.querySelectorAll('.qr-public-empty').length,
    qrEmptyBox: (function () {
      const node = document.querySelector('.qr-public-empty');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { w: Math.round(rect.width), h: Math.round(rect.height),
               display: style.display, visibility: style.visibility, opacity: style.opacity };
    })(),
    docEmpty: document.querySelectorAll('.doc-empty').length,
    qrRecord: document.querySelectorAll('.qr-record').length,
    panel: (document.querySelector('.login__panel')
      ? document.querySelector('.login__panel').innerHTML.replace(/\\s+/g, ' ').slice(0, 320)
      : null),
    views: window.AssetLabelViews ? Object.keys(window.AssetLabelViews) : null,
    qrCode: typeof window.AssetQrCode,
    html: (document.querySelector('#app') ? document.querySelector('#app').innerHTML : '')
      .replace(/\\s+/g, ' ').slice(0, 260)
  };
}"""


def expect_public(page, label: str) -> None:
    """Wait for the public report, recording what the page really shows."""
    try:
        page.wait_for_selector(MARKER_PUBLIC, timeout=20000)
    except Exception:
        record(f"PUBLIC-MISSING {label} state={redact(page.evaluate(PUBLIC_STATE))}")
        raise


def await_state(page, selector: str, label: str) -> None:
    """Wait for one public state, recording the painted page when it never comes."""
    try:
        page.wait_for_selector(selector, timeout=20000)
    except Exception:
        record(f"STATE-MISSING {label} selector={selector} "
               f"state={redact(page.evaluate(PUBLIC_STATE))}")
        raise


def fresh_navigation(page, url: str, label: str) -> None:
    """A real visitor opens the link: discard the previous document first."""
    page.goto("about:blank")
    page.goto(url, wait_until="networkidle")
    expect_public(page, label)
    settle(page, label)


def public_share(page, browser, shots: Path, asset: dict) -> None:
    """One real anonymous share, its invalid state and its revoked state."""
    created = request(page, f"/reports/assets/{asset['id']}/shares",
                      {"fields": ["name", "quickCode", "status"], "expiresInDays": 7})
    require(created["status"] == 201, f"create share: status {created['status']}")
    share = created["body"] or {}
    match = CAPABILITY.search(str(share.get("url") or ""))
    token = match.group(0).split("=", 1)[1] if match else ""
    require(bool(token), "create share: the response carried no capability parameter")
    record(f"SHARE created id={share.get('id')} expiresAt={share.get('expiresAt')} "
           f"capabilityBytes={len(token)} url={redact(share.get('url'))}")

    route = f"#/reporte/{asset['id']}/publico?share={token}"
    anonymous = browser.new_context(viewport={"width": 1440, "height": 1000})
    try:
        public = anonymous.new_page()
        sink = watch_page(public)

        for width, height in VIEWPORTS:
            public.set_viewport_size({"width": width, "height": height})
            fresh_navigation(public, f"{BASE}/{route}", f"public {width}")
            await_state(public, ".qr-record", f"public valid {width}")
            text = body_text(public)
            record(f"PUBLIC valid width={width} chars={len(text)} shell="
                   f"{public.locator('.app-shell').count()} sidebar={public.locator('.sidebar').count()}")
            present(public, (SEEDED[0]["name"], SEEDED[0]["quickCode"]), f"public {width}")
            absent(public, (SEEDED[0]["serial"], SEEDED[0]["ip"], SEEDED[0]["responsible"],
                            SEEDED[0]["location"]), f"public {width}")
            # A public field with a closed vocabulary prints its catalog label,
            # never the server enum or a guessed translation.
            present(public, (PUBLIC_STATUS_LABEL,), f"public {width} status label")
            absent(public, ("in_use",), f"public {width} raw status enum")
            require(public.locator(".app-shell").count() == 0,
                    f"public {width}: authenticated shell rendered")
            require(overflow(public) <= 1, f"public {width}: horizontal overflow {overflow(public)}px")
            path = shots / f"public-valid-{width}.png"
            public.screenshot(path=str(path), full_page=True)
            record(f"SHOT {path.name} mode=full_page state=valid")
            assert_painted(path, f"public {width} valid")

        # The changed presentation on its other axes: the status vocabulary is
        # locale-owned, and the record must stay legible on the dark sheet.
        public.set_viewport_size({"width": 390, "height": 844})
        set_locale(public, "en")
        set_theme(public, "dark")
        text = body_text(public)
        record(f"PUBLIC valid cell=390-en-dark chars={len(text)}")
        present(public, ("Assigned", "RD-0001"), "public en/dark")
        absent(public, ("in_use", "Asignado"), "public en/dark raw status enum")
        card = element_shot(public, shots, f"{MARKER_PUBLIC} .qr-record", "public-valid-390-en-dark")
        if card:
            stats = analyze_png(card)
            lights = count_light(card)
            record("PUBLIC card cell=390-en-dark "
                   f"{stats_line('public en/dark card', stats)} light={lights}")
            require(lights >= 100,
                    f"public en/dark: the record text carries no light pixels ({lights})")
        else:
            fail("public en/dark: the record element produced no capture")
        set_theme(public, "light")
        set_locale(public, "es")

        # The same tab can follow a stale or revoked link after a valid one.
        swap = f"#/reporte/{asset['id']}/publico?share=bogus-{uuid.uuid4().hex}"
        with public.expect_response(
                lambda response: "/api/v1/reports/public/" in response.url, timeout=15000) as swapped:
            public.goto(f"{BASE}/{swap}")
        record(f"TOKEN-SWAP response status={swapped.value.status}")
        settle(public, "token swap")
        try:
            public.wait_for_function(
                "() => document.querySelectorAll('.qr-record').length === 0", timeout=10000)
        except Exception:
            record(f"TOKEN-SWAP stale state={redact(public.evaluate(PUBLIC_STATE))}")
        remaining = public.locator(".qr-record").count()
        record(f"TOKEN-SWAP records={remaining}")
        require(remaining == 0, "token swap: the previous capability record stayed on screen")

        # Back to the first capability inside the same running document: the
        # valid record has to repaint before it can be revoked in place.
        with public.expect_response(
                lambda response: "/api/v1/reports/public/" in response.url, timeout=15000) as again:
            public.evaluate("(hash) => { window.location.hash = hash; }", route)
        remember = again.value.status
        await_state(public, ".qr-record", "public repaint")
        repainted = public.locator(".qr-record").count()
        record(f"TOKEN-SWAP back to first capability status={remember} records={repainted}")
        require(remember == 200, f"repaint: the valid capability answered {remember}")
        require(repainted == 1, "repaint: the valid capability did not paint its record")

        revoked = request(page, f"/reports/shares/{share['id']}", None, method="DELETE")
        require(revoked["status"] in (200, 204), f"revoke share: status {revoked['status']}")
        record(f"SHARE revoked id={share.get('id')} status={revoked['status']}")

        # Same capability, same running document, revoked on the server: the
        # incumbent record must not survive the failed read.
        public.set_viewport_size({"width": VIEWPORTS[0][0], "height": VIEWPORTS[0][1]})
        with public.expect_response(
                lambda response: "/api/v1/reports/public/" in response.url, timeout=20000) as reloaded:
            public.evaluate("(hash) => { window.location.hash = hash; }", "#/login")
            public.wait_for_function("(hash) => window.location.hash === hash", arg="#/login")
            settle(public, "public same-token detour")
            public.evaluate("(hash) => { window.location.hash = hash; }", route)
        reload_status = reloaded.value.status
        await_state(public, ".qr-public-empty", "public same token revoked")
        settle(public, "public same token revoked")
        inplace_records = public.locator(".qr-record").count()
        record(f"SAME-TOKEN status={reload_status} response={redact(reloaded.value.url)} "
               f"records={inplace_records} hash={redact(public.evaluate('location.hash'))}")
        require(reload_status in (401, 403, 404),
                f"same-token reload: the revoked capability answered {reload_status}")
        require(inplace_records == 0, "same-token reload kept the revoked record on screen")
        absent(public, (SEEDED[0]["name"], SEEDED[0]["quickCode"]),
               "public same token revoked")
        path = shots / "public-revoked-inplace-1440.png"
        public.screenshot(path=str(path), full_page=True)
        record(f"SHOT {path.name} mode=full_page state=revoked-inplace")
        assert_painted(path, "public same token revoked")

        bogus = f"#/reporte/{asset['id']}/publico?share=bogus-{uuid.uuid4().hex}"
        public.set_viewport_size({"width": 390, "height": 844})
        fresh_navigation(public, f"{BASE}/{bogus}", "public invalid")
        await_state(public, ".qr-public-empty", "public invalid")
        present(public, ("Este enlace no está disponible",), "public invalid")
        require(public.locator(".qr-record").count() == 0,
                "public invalid: a record rendered for an unknown capability")
        path = shots / "public-invalid-390.png"
        public.screenshot(path=str(path), full_page=True)
        record(f"SHOT {path.name} mode=full_page state=invalid")

        for width, height in VIEWPORTS:
            public.set_viewport_size({"width": width, "height": height})
            fresh_navigation(public, f"{BASE}/{route}", f"public revoked {width}")
            await_state(public, ".qr-public-empty", f"public revoked {width}")
            require(public.locator(".qr-record").count() == 0,
                    f"public revoked {width}: the revoked capability still rendered a record")
            path = shots / f"public-revoked-{width}.png"
            public.screenshot(path=str(path), full_page=True)
            record(f"SHOT {path.name} mode=full_page state=revoked")
    finally:
        report_failures(sink, "public")
        anonymous.close()


# ------------------------------------------------------------------------- jobs

def run_tool(command: list[str], label: str) -> str:
    """Run one local, read-only tool. Never a shell, never a network call."""
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        fail(f"{label}: {type(exc).__name__}")
        return ""
    if done.returncode != 0:
        fail(f"{label}: exit {done.returncode} {done.stderr.strip()[:160]}")
    return done.stdout


def verify_pdf(payload: bytes, headers: dict, filename: str, shots: Path, name: str) -> dict:
    """A downloaded document is a real PDF with real rendered pages."""
    record(f"DOWNLOAD {name} bytes={len(payload)} type={headers.get('content-type')!r} "
           f"disposition={headers.get('content-disposition')!r} name={filename!r} "
           f"head={payload[:5]!r}")
    require(payload[:5] == b"%PDF-", f"{name}: payload does not start with %PDF-")
    require("application/pdf" in (headers.get("content-type") or ""),
            f"{name}: content type is {headers.get('content-type')!r}")
    require(not filename or filename.lower().endswith(".pdf"),
            f"{name}: download name {filename!r} is not a PDF")
    path = shots / f"{name}.pdf"
    path.write_bytes(payload)
    record(f"SHOT {path.name} mode=download bytes={len(payload)}")

    if not shutil.which("pdfinfo") or not shutil.which("pdftoppm"):
        record(f"PDFTOOLS {name} unavailable: poppler not installed, pages not rasterised")
        return {"pages": 0, "page": None}

    pages = 0
    width = height = 0.0
    for line in run_tool(["pdfinfo", str(path)], f"{name} pdfinfo").splitlines():
        if line.startswith("Pages:"):
            digits = re.search(r"\d+", line)
            pages = int(digits.group(0)) if digits else 0
        elif line.startswith("Page size:"):
            match = re.search(r"([0-9.]+) x ([0-9.]+) pts", line)
            if match:
                width, height = float(match.group(1)), float(match.group(2))
    record(f"PDFINFO {name} pages={pages} pagesize={width}x{height}pt")
    require(pages >= 1, f"{name}: the document has no pages")
    require(abs(width - 595.28) <= 2 and abs(height - 841.89) <= 2,
            f"{name}: page size {width}x{height}pt is not A4 (595.28x841.89pt)")

    prefix = shots / f"{name}-page"
    run_tool(["pdftoppm", "-png", "-r", "96", "-f", "1", "-l", "1", str(path), str(prefix)],
             f"{name} pdftoppm")
    rendered = sorted(shots.glob(f"{name}-page*.png"))
    if not rendered:
        fail(f"{name}: the PDF did not rasterise")
        return {"pages": pages, "page": None}
    stats = analyze_png(rendered[0])
    record(f"PDFPAGE {name} image={rendered[0].name} size={stats['size']} dark={stats['dark']}")
    assert_painted(rendered[0], f"{name} page 1")
    return {"pages": pages, "page": rendered[0]}


def download_document(page, shots: Path, name: str) -> None:
    """Click the job's real download control and verify what it returns."""
    button = page.get_by_role("button", name="Descargar").first
    try:
        button.wait_for(state="visible", timeout=180000)
    except Exception as exc:  # bounded wait: report the timeout, never hide it
        fail(f"{name}: no download control after the job ({type(exc).__name__})")
        return
    with page.expect_response(
            lambda response: "/download" in response.url, timeout=90000) as info:
        button.click()
    response = info.value
    record(f"DOWNLOAD {name} status={response.status}")
    require(response.status == 200, f"{name}: download status {response.status}")
    headers = {key.lower(): value for key, value in response.headers.items()}
    disposition = headers.get("content-disposition") or ""
    match = re.search(r"filename=\"?([^\";]+)", disposition)
    filename = match.group(1) if match else ""
    verify_pdf(response.body(), headers, filename, shots, name)


def report_job(page, shots: Path) -> None:
    page.set_viewport_size({"width": 1440, "height": 1000})
    open_route(page, "#/reportes", MARKER_REPORTS, "reports job")
    with page.expect_response(
            lambda response: response.url.endswith("/api/v1/reports/jobs")
            and response.request.method == "POST", timeout=60000) as info:
        page.click('[data-od-id="generate-report"]')
    created = info.value
    payload: dict = {}
    try:
        payload = created.json()
    except Exception:
        pass
    job = payload.get("job") if isinstance(payload.get("job"), dict) else payload
    record(f"JOB report status={created.status} id={job.get('id')} state={job.get('status')}")
    require(created.status in (200, 201, 202), f"report job: enqueue status {created.status}")
    page.wait_for_selector('[data-od-id="active-report-job"]', timeout=30000)
    record("JOB report queued on the owned worker")
    download_document(page, shots, "report-job")


def label_teardown(page, shots: Path, width: int, height: int) -> None:
    """Leaving the label view with a preview settling must not resurrect its observer."""
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, "#/etiquetas", MARKER_LABELS, f"labels teardown {width}")
    trigger = page.locator(".doc-preview-toolbar .btn").first
    with page.expect_response(
        lambda response: response.url.endswith("/api/v1/reports/preview"), timeout=60000
    ):
        trigger.click()
    page.evaluate("() => { window.location.hash = '#/panel'; }")
    page.wait_for_function("() => window.location.hash === '#/panel'", timeout=15000)
    page.wait_for_timeout(1200)
    state = page.evaluate("""() => ({
      hash: window.location.hash,
      shell: document.querySelectorAll('.app-shell').length,
      previews: document.querySelectorAll('.doc-pages').length,
      iframes: document.querySelectorAll('.doc-pages iframe').length
    })""")
    record(f"TEARDOWN labels width={width} hash={state['hash']} shell={state['shell']} "
           f"previews={state['previews']} iframes={state['iframes']}")
    require(state["hash"] == "#/panel",
            f"labels {width}: leaving the preview view did not land on the panel")
    require(state["shell"] == 1, f"labels {width}: the shell did not survive leaving the preview view")
    require(state["previews"] == 0,
            f"labels {width}: the detached preview container is still in the document")
    # The view still works afterwards: a fresh sheet is fitted as before.
    label_preview(page, shots, width, height, suffix="-recovered")


def label_job(page, shots: Path) -> None:
    page.set_viewport_size({"width": 1440, "height": 1000})
    open_route(page, "#/etiquetas", MARKER_LABELS, "labels job")
    with page.expect_response(
            lambda response: response.url.endswith("/api/v1/reports/jobs")
            and response.request.method == "POST", timeout=60000) as info:
        page.click('[data-od-id="prepare-labels"]')
    created = info.value
    record(f"JOB labels status={created.status}")
    require(created.status in (200, 201, 202), f"label job: enqueue status {created.status}")
    page.wait_for_selector('[data-od-id="active-label-job"]', timeout=30000)
    record("JOB labels queued on the owned worker")
    download_document(page, shots, "label-job")


# --------------------------------------------------------------------- scenario

def scenario(browser, shots: Path) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    try:
        page = context.new_page()
        sink = watch_page(page)
        fixture.login(page, BASE, USERNAME, PASSWORD)
        record(f"LOGIN {USERNAME} at {BASE}")
        record(f"THEME effective={page.evaluate('document.documentElement.dataset.theme')!r} "
               f"locale={page.evaluate('document.documentElement.lang')!r}")

        assets = seed_assets(page)
        if not require(len(assets) >= 3, f"seeded only {len(assets)} assets"):
            return
        seed_warranty(page, assets[0]["id"])

        for width, height in VIEWPORTS:
            try:
                report_preview(page, shots, width, height)
            except Exception as exc:  # keep the other cells observable
                fail(f"reports {width}: {type(exc).__name__}: {exc}")
            try:
                label_preview(page, shots, width, height)
            except Exception as exc:
                fail(f"labels {width}: {type(exc).__name__}: {exc}")
            try:
                warranty_dialog(page, shots, width, height, assets[0]["id"])
            except Exception as exc:
                fail(f"warranty {width}: {type(exc).__name__}: {exc}")

        # The report preview on the other axes at the narrow width: the fit and
        # the reachable rightmost column cannot depend on locale or theme.
        try:
            report_preview(page, shots, 390, 844, suffix="-en-dark", locale="en", theme="dark")
        except Exception as exc:
            fail(f"reports 390-en-dark: {type(exc).__name__}: {exc}")
        finally:
            set_theme(page, "light")
            set_locale(page, "es")

        # A second supported page size: Letter is 215.9 mm wide, so the fit has
        # to follow the document the server composed, not the previous A4 cell.
        for width, height in VIEWPORTS:
            try:
                report_preview(page, shots, width, height, suffix="-letter", page_format="Letter")
            except Exception as exc:
                fail(f"reports {width}-letter: {type(exc).__name__}: {exc}")

        # The fit lifecycle: the observer belongs to the mounted preview only.
        try:
            preview_teardown(page, shots)
        except Exception as exc:
            fail(f"teardown: {type(exc).__name__}: {exc}")

        # The label preview carries the same lifecycle and is guarded the same way.
        for width, height in VIEWPORTS:
            try:
                label_teardown(page, shots, width, height)
            except Exception as exc:
                fail(f"labels teardown {width}: {type(exc).__name__}: {exc}")

        for step in (report_job, label_job):
            try:
                step(page, shots)
            except Exception as exc:  # keep the other states observable
                fail(f"{step.__name__}: {type(exc).__name__}: {exc}")

        try:
            public_share(page, browser, shots, assets[0])
        except Exception as exc:
            fail(f"public share: {type(exc).__name__}: {exc}")

        report_failures(sink, "session")
    finally:
        context.close()


def main() -> int:
    global BASE
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ENV scrubbed {len(fixture.DROPPED_KEYS)} inherited keys")
    for path in (PYTHON, BACKEND, FRONTEND / "node_modules"):
        assert path.exists(), path

    owner, ports = fixture.Owned(), []
    try:
        database_dir = SCRATCH / "ordinary"
        database_dir.mkdir(parents=True, exist_ok=True)
        database = database_dir / "readiness.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "U9 readiness install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "readiness", api_env)
        worker_env = dict(api_env)
        owner.spawn(
            "readiness-worker",
            [str(PYTHON), "-m", "huey.bin.huey_consumer", "itsm.tasks.runtime.huey",
             "-w", "1", "-k", "thread"],
            BACKEND, worker_env,
        )
        print("WORKER owned huey consumer started")
        with fixture.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                scenario(browser, shots)
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - diagnostics, then a redacted failure
        print(f"EXCEPTION {type(exc).__name__}: {redact(exc)}")
        print(exception_report(exc).rstrip())
        print("DIAGNOSTICS (owned process log tails):")
        print(log_tail_report(owner).rstrip())
        raise SystemExit(1) from None
    finally:
        owner.stop()
        leaked = fixture.open_ports(ports)
        if leaked:
            print(f"CLEANUP LEAKED ports {leaked}")
        else:
            print(f"CLEANUP owned processes stopped, ports {ports} released")

    images = sorted(shots.glob("*.png"))
    print()
    print(f"rows={len(RESULTS)} failures={len(FAILURES)} screenshots={len(images)}")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    if FAILURES:
        print("FAILURES:")
        for item in FAILURES:
            print(f"- {item}")
        return 1
    print("RESULT readiness proof passed")
    return 0



# ------------------------------------------------- redaction self-check (sinks)

class _SyntheticConsole:
    def __init__(self, kind: str, text: str) -> None:
        self.type = kind
        self.text = text

class _SyntheticResponse:
    def __init__(self, status: int, url: str) -> None:
        self.status = status
        self.url = url

class _SyntheticPage:
    def __init__(self) -> None:
        self.handlers: dict = {}

    def on(self, event: str, handler) -> None:
        self.handlers[event] = handler

class _SyntheticOwner:
    def __init__(self, text: str) -> None:
        self.text = text

    def log_tails(self, limit: int) -> str:
        return self.text

def redaction_probe() -> int:
    """Prove every diagnostic sink strips a synthetic capability.

    The probe runs the real sink functions with a capability that never existed
    in this installation, so it needs no backend, browser or share. It also
    proves the shape survives redaction (the diagnostic still reads as a
    failure) instead of being deleted outright.
    """
    token = SYNTHETIC_CAPABILITY
    query = f"https://host.local/#/reporte/asset-1/publico?share={token}"
    path = f"https://host.local/api/v1/reports/public/{token}"
    both = f"{path}?share={token}"
    leaks: list[str] = []

    def clean(name: str, text: str) -> str:
        leaked = token in text
        if leaked:
            leaks.append(name)
        print(f"REDACTION {name} clean={not leaked}")
        return text

    plain_query = clean("query", redact(query))
    plain_path = clean("api-path", redact(path))
    plain_both = clean("api-path-query", redact(both))
    if "share=<redacted>" not in plain_query:
        leaks.append("query keeps its redaction marker")
    if "/api/v1/reports/public/<redacted>" not in plain_path:
        leaks.append("api-path keeps its redaction marker")
    if "share=<redacted>" not in plain_both:
        leaks.append("api-path-query keeps its redaction marker")

    results_before, failures_before = len(RESULTS), len(FAILURES)
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        record(f"probe share={token}")
        fail(f"probe {both}")
    del RESULTS[results_before:]
    del FAILURES[failures_before:]
    clean("stdout", stream.getvalue())

    console = console_error(_SyntheticConsole("error", f"failed {both}"))
    clean("console", console)
    if token in console or "reports/public" not in console:
        leaks.append("console diagnostic keeps a usable message")

    page = _SyntheticPage()
    sink = watch_page(page)
    try:
        raise RuntimeError(f"goto {query} failed")
    except RuntimeError as exc:
        page.handlers["pageerror"](exc)
        clean("exception", exception_report(exc))
    page.handlers["console"](_SyntheticConsole("warning", f"slow {query}"))
    page.handlers["console"](_SyntheticConsole("error", f"failed {path}"))
    page.handlers["response"](_SyntheticResponse(401, both))
    clean("pageerror", " ".join(sink["pageerror"]))
    clean("warning", " ".join(sink["warning"]))
    clean("console-sink", " ".join(sink["console"]))
    clean("http", " ".join(sink["http"]))
    if not any("/api/v1/reports/public/<redacted>" in line for line in sink["http"]):
        leaks.append("http keeps its redacted api-path")

    tail_stream = io.StringIO()
    failures_before = len(FAILURES)
    with contextlib.redirect_stdout(tail_stream):
        report_failures(sink, "probe")
    del FAILURES[failures_before:]
    clean("report-failures", tail_stream.getvalue())

    tail = log_tail_report(_SyntheticOwner(f"INFO GET /api/v1/reports/public/{token} 401\n"))
    clean("process-log", tail)

    print(f"REDACTION-CHECK multiple=True leaks={len(leaks)}")
    if leaks:
        print("REDACTION-FAILURES " + " | ".join(leaks))
        return 1
    print("RESULT redaction probe passed")
    return 0

if __name__ == "__main__":
    if "--redaction-check" in sys.argv[1:]:
        sys.exit(redaction_probe())
    sys.exit(main())
