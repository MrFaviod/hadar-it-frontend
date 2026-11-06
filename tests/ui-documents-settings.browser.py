#!/usr/bin/env python3
"""Bounded browser evidence for the three document settings editors (U9).

Routes and their real owners, verified in the generic config router:

  #/configuracion/reportes  -> route.section 'reportes'  -> <report-settings>  (ReportSettings, assets/js/report-views.js)
  #/configuracion/qr        -> route.section 'qr'        -> <qr-settings>      (QrSettings, assets/js/label-views.js)
  #/configuracion/etiquetas -> route.section 'etiquetas' -> <label-settings>   (LabelSettings, assets/js/label-views.js)

The only mocked traffic is the canonical settings READ, `GET /api/v1/reports/settings`:
it is paused to observe the loading state, refused to observe the failed first read, and
paused again to observe an edit typed while the read is in flight. No Vue state is
injected, no permission is weakened, no write is faked. The generic QR failure is a real
server rejection: the client accepts `?query`, the canonical API refuses it, nothing is
persisted.

Disposable fixture: one uniquely named SQLite installation, loopback ports, test-only
credentials, no `.env`, no provider, device or live service access.

Usage: python3 tests/ui-documents-settings.browser.py
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
        "settings_fixture", Path(__file__).with_name("demo-indicator.browser.py")
    )
    assert spec and spec.loader, "the shared disposable fixture must be importable"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()

SCRATCH = FRONTEND / ".verification" / ("ui-documents-settings-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH

BACKEND = fixture.BACKEND
PYTHON = fixture.PYTHON
USERNAME = "settings.admin"
PASSWORD = "Settings-View-Pass-6t2"

READ = "**/api/v1/reports/settings*"
READ_URL = "/api/v1/reports/settings"

EDITORS = (
    ("reportes", "#/configuracion/reportes", '[data-od-id="report-settings"]', "ui.reports.settings_load_error"),
    ("qr", "#/configuracion/qr", '[data-od-id="qr-settings"]', "ui.qr.settings.load_error"),
    ("etiquetas", "#/configuracion/etiquetas", '[data-od-id="label-settings"]', "ui.labels.settings.load_error"),
)
CELLS = (("es", 1440, 1000, "light"), ("en", 390, 844, "dark"))
LOADING = {"es": "Cargando\u2026", "en": "Loading\u2026"}
QR_URL_ERROR = {"es": "Introduce una URL http o https v\u00e1lida.", "en": "Enter a valid http or https URL."}

WARRANTY_ROUTE = "#/configuracion/garantias"
WARRANTY_MARKER = '[data-od-id="warranty-settings"]'
WARRANTY_READ = "**/api/v1/warranty-preferences*"

BASE = ""
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


def body_text(page) -> str:
    return page.evaluate("() => document.body.innerText")


def overflow(page) -> int:
    return page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )


def copy_for(locale: str, key: str) -> str:
    return page_copy[locale][key]


page_copy: dict[str, dict[str, str]] = {}


def load_copy(page) -> None:
    for locale in ("es", "en"):
        payload = page.evaluate(
            """async (tag) => {
              const response = await fetch('/assets/i18n/' + tag + '.json');
              return response.json();
            }""",
            locale,
        )
        page_copy[locale] = payload


def set_locale(page, tag: str) -> None:
    page.evaluate(
        """async (tag) => {
          window.__settingsBundles = window.__settingsBundles || {};
          if (!window.__settingsBundles[tag]) {
            await window.ItsmI18n.loadBundle(tag);
            window.__settingsBundles[tag] = true;
          }
          window.ItsmI18n.setLocale(tag, {persist: true});
        }""",
        tag,
    )
    require(
        page.evaluate("() => window.ItsmI18n.activeLocale") == tag,
        f"locale requested {tag} but the effective locale is not {tag}",
    )


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
        f"theme={theme} viewport={width}x{height} overflow={over}px {detail}"
    )
    return path


def open_route(page, route: str, marker: str) -> None:
    page.goto("about:blank")
    page.goto(BASE + "/" + route)
    page.wait_for_selector(marker, timeout=30000)
    settle(page)


def pause_reads(page) -> list:
    paused: list = []
    page.route(READ, lambda route: paused.append(route))
    return paused


def pause_writes(page, pattern: str) -> list:
    held: list = []

    def hold(route_handle) -> None:
        if route_handle.request.method == "PUT":
            held.append(route_handle)
        else:
            route_handle.continue_()

    page.route(pattern, hold)
    return held

def fulfill(route, status: int, payload: str) -> None:
    route.fulfill(status=status, content_type="application/json", body=payload)


def real_settings(page) -> str:
    payload = page.evaluate(
        """async (url) => {
          const response = await fetch(url, {credentials: 'same-origin'});
          return {status: response.status, text: await response.text()};
        }""",
        READ_URL,
    )
    require(payload["status"] == 200, f"canonical settings read status {payload['status']}")
    return payload["text"]


def editor(page, marker: str):
    return page.locator(f"{marker} form")


def submit(page, marker: str):
    return page.locator(f"{marker} button[type=submit]")


def first_input(page, marker: str):
    return page.locator(f"{marker} input:not([type=checkbox])").first


def save_enabled(page, marker: str) -> bool:
    return submit(page, marker).is_enabled()


ENABLED_ACTION: dict = {}


def rgb(value: str) -> tuple:
    numbers = [float(part) for part in value[value.find("(") + 1:value.rfind(")")].split(",")]
    return numbers[0], numbers[1], numbers[2]


def chroma(value: str) -> float:
    red, green, blue = rgb(value)
    return max(red, green, blue) - min(red, green, blue)


def luminance(value: str) -> float:
    def channel(part: float) -> float:
        part = part / 255
        return part / 12.92 if part <= 0.03928 else ((part + 0.055) / 1.055) ** 2.4

    red, green, blue = rgb(value)
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def contrast(foreground: str, background: str) -> float:
    high = max(luminance(foreground), luminance(background))
    low = min(luminance(foreground), luminance(background))
    return (high + 0.05) / (low + 0.05)


def action_style(page, marker: str) -> dict:
    # The button colours transition (--dur-fast, 160ms), so measure the settled state.
    page.wait_for_timeout(220)
    return page.evaluate(
        """(marker) => {
          const node = document.querySelector(marker + ' button[type=submit]');
          if (!node) return null;
          const style = getComputedStyle(node);
          return {disabled: node.disabled, background: style.backgroundColor,
                  color: style.color, cursor: style.cursor, shadow: style.boxShadow};
        }""",
        marker,
    )


def require_enabled_action(page, marker: str, theme: str, label: str) -> None:
    style = action_style(page, marker)
    require(bool(style), f"{label}: save control missing for the enabled action check")
    require(not style["disabled"], f"{label}: the primary save control is not enabled")
    require(
        chroma(style["background"]) >= 60,
        f"{label}: the enabled primary save control lost its accent treatment "
        f"(background {style['background']}, chroma {chroma(style['background'])})",
    )
    ENABLED_ACTION[(marker, theme)] = style["background"]
    record(
        f"ACTION enabled {label} background={style['background']} "
        f"chroma={chroma(style['background']):.0f} cursor={style['cursor']}"
    )


def require_inactive_action(page, marker: str, theme: str, label: str) -> None:
    style = action_style(page, marker)
    require(bool(style), f"{label}: save control missing for the inactive action check")
    require(style["disabled"], f"{label}: the inactive check found an enabled save control")
    enabled = ENABLED_ACTION.get((marker, theme))
    require(enabled is not None, f"{label}: no enabled save control was measured for {theme}")
    ratio = contrast(style["color"], style["background"])
    record(
        f"ACTION inactive {label} background={style['background']} color={style['color']} "
        f"chroma={chroma(style['background']):.0f} contrast={ratio:.2f} "
        f"cursor={style['cursor']} shadow={style['shadow']}"
    )
    require(
        style["background"] != enabled,
        f"{label}: the disabled save control keeps the enabled accent background "
        f"{style['background']}",
    )
    require(
        chroma(style["background"]) * 2 <= chroma(enabled),
        f"{label}: the disabled save control is still saturated "
        f"(chroma {chroma(style['background']):.0f} against {chroma(enabled):.0f})",
    )
    require(
        ratio >= 4.5,
        f"{label}: the disabled save label contrast is {ratio:.2f}, below 4.5:1",
    )
    require(
        style["cursor"] == "not-allowed",
        f"{label}: the disabled save control does not use the not-allowed cursor",
    )
    require(
        enabled and style["shadow"] in ("none", ""),
        f"{label}: the disabled save control still carries a shadow {style['shadow']}",
    )


def record_targets(page, marker: str, label: str) -> None:
    sizes = page.evaluate(
        """(marker) => {
          const root = document.querySelector(marker);
          if (!root) return null;
          const measure = (node) => {
            const box = node.getBoundingClientRect();
            return {tag: node.tagName.toLowerCase(), height: Math.round(box.height),
                    width: Math.round(box.width)};
          };
          return {
            save: measure(root.querySelector('button[type=submit]')),
            field: measure(root.querySelector('input:not([type=checkbox]), select')),
            outline: (() => {
              const node = root.querySelector('button[type=submit]');
              node.focus();
              const style = getComputedStyle(node);
              const value = style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor;
              node.blur();
              return value;
            })()
          };
        }""",
        marker,
    )
    require(bool(sizes), f"{label}: editor root missing for target measurement")
    if sizes:
        record(
            f"TARGETS {label} save={sizes['save']['height']}px field={sizes['field']['height']}px "
            f"focus-outline={sizes['outline']}"
        )


def check_loaded(page, marker: str, label: str, theme: str) -> None:
    form = editor(page, marker)
    require(form.count() == 1, f"{label}: settings form missing")
    require(form.first.get_attribute("aria-busy") == "false", f"{label}: form still busy")
    require(save_enabled(page, marker), f"{label}: save disabled after a successful read")
    require_enabled_action(page, marker, theme, label)
    require(
        page.locator(f"{marker} .doc-error[role=alert]").count() == 0,
        f"{label}: load error shown after a successful read",
    )
    require(
        page.locator(f"{marker} [role=status]").count() == 0,
        f"{label}: loading status still shown",
    )


def capture_loaded(page, shots: Path) -> None:
    for slug, route, marker, _key in EDITORS:
        for locale, width, height, theme in CELLS:
            page.set_viewport_size({"width": width, "height": height})
            open_route(page, route, marker)
            set_locale(page, locale)
            fixture.set_theme(page, theme)
            settle(page)
            check_loaded(page, marker, f"{slug} loaded {locale} {width}", theme)
            record_targets(page, marker, f"{slug} {locale} {width}")
            shot(page, shots, f"{slug}-loaded", route, locale, width, height, theme,
                 "successful canonical read, save enabled")


def capture_loading(page, shots: Path, payload: str) -> None:
    cells = {"reportes": ("es", 1440, 1000, "light"),
             "qr": ("en", 390, 844, "dark"),
             "etiquetas": ("es", 1440, 1000, "light")}
    for slug, route, marker, _key in EDITORS:
        locale, width, height, theme = cells[slug]
        page.set_viewport_size({"width": width, "height": height})
        paused = pause_reads(page)
        try:
            page.goto("about:blank")
            page.goto(BASE + "/" + route)
            page.wait_for_selector(marker, timeout=30000)
            set_locale(page, locale)
            fixture.set_theme(page, theme)
            status = page.locator(f"{marker} [role=status]")
            require(status.count() == 1, f"{slug} loading: no loading status")
            if status.count():
                require(LOADING[locale] in status.first.inner_text(),
                        f"{slug} loading: unexpected status copy")
            require(not save_enabled(page, marker), f"{slug} loading: save enabled while reading")
            require_inactive_action(page, marker, theme, f"{slug} loading {locale} {width}")
            shot(page, shots, f"{slug}-loading", route, locale, width, height, theme,
                 "canonical read paused, loading status visible, save disabled")
        finally:
            needs_fulfil = paused
            for route_handle in needs_fulfil:
                try:
                    fulfill(route_handle, 200, payload)
                except Exception:
                    pass
            page.unroute(READ)
        page.wait_for_selector(f"{marker} [role=status]", state="detached", timeout=15000)
        check_loaded(page, marker, f"{slug} after loading", theme)


def capture_failed_first_read(page, shots: Path) -> None:
    cells = {"reportes": ("es", 1440, 1000, "light"),
             "qr": ("en", 390, 844, "dark"),
             "etiquetas": ("en", 390, 844, "dark")}
    for slug, route, marker, key in EDITORS:
        locale, width, height, theme = cells[slug]
        page.set_viewport_size({"width": width, "height": height})
        page.route(READ, lambda route: fulfill(route, 503, '{"error": "unavailable"}'))
        try:
            page.goto("about:blank")
            page.goto(BASE + "/" + route)
            page.wait_for_selector(marker, timeout=30000)
            set_locale(page, locale)
            fixture.set_theme(page, theme)
            # The load error string is stored at mount time, so the document is
            # reloaded after the locale switch to observe the localized copy.
            page.reload()
            page.wait_for_selector(marker, timeout=30000)
            settle(page)
            alert = page.locator(f"{marker} .doc-error[role=alert]")
            require(alert.count() == 1, f"{slug} first read failure: no alert")
            if alert.count():
                observed = alert.first.inner_text().strip()
                require(copy_for(locale, key) in observed,
                        f"{slug} first read failure: unexpected alert copy {observed[:120]!r}")
            require(not save_enabled(page, marker),
                    f"{slug} first read failure: save enabled without loaded settings")
            require(page.locator(f"{marker} [role=status]").count() == 0,
                    f"{slug} first read failure: loading status still shown")
            shot(page, shots, f"{slug}-read-failed", route, locale, width, height, theme,
                 "first canonical read refused, save disabled")
            require_inactive_action(page, marker, theme,
                                    f"{slug} read-failed {locale} {width}")
        finally:
            page.unroute(READ)


def capture_typed_during_read(page, shots: Path, payload: str) -> None:
    cells = {"reportes": ("es", 1440, 1000, "light"),
             "qr": ("en", 390, 844, "dark"),
             "etiquetas": ("es", 1440, 1000, "light")}
    typed_value = {"reportes": "https://typed.example.test/", "qr": "https://typed.example.test/"}
    for slug, route, marker, _key in EDITORS:
        locale, width, height, theme = cells[slug]
        page.set_viewport_size({"width": width, "height": height})
        paused = pause_reads(page)
        try:
            page.goto("about:blank")
            page.goto(BASE + "/" + route)
            page.wait_for_selector(marker, timeout=30000)
            set_locale(page, locale)
            fixture.set_theme(page, theme)
            field = first_input(page, marker)
            if slug == "etiquetas":
                field.fill("123")
                typed = "123"
            else:
                field.fill(typed_value[slug])
                typed = typed_value[slug]
            require(field.input_value() == typed, f"{slug} typing: field did not take the value")
            require(not save_enabled(page, marker), f"{slug} typing: save enabled during the read")
            for route_handle in paused:
                fulfill(route_handle, 200, payload)
            page.unroute(READ)
            page.wait_for_selector(f"{marker} [role=status]", state="detached", timeout=15000)
            page.wait_for_timeout(120)
            require(field.input_value() == typed,
                    f"{slug} typing: the in-flight edit was replaced by the response")
            require(save_enabled(page, marker),
                    f"{slug} typing: save disabled after the read completed")
            require_enabled_action(page, marker, theme, f"{slug} typed {locale} {width}")
            require(page.locator(f"{marker} .doc-error[role=alert]").count() == 0,
                    f"{slug} typing: unexpected alert after a successful read")
            shot(page, shots, f"{slug}-typed-during-read", route, locale, width, height, theme,
                 "value typed during the read kept after the response")
        finally:
            page.unroute(READ)


def capture_retained_refresh(page, shots: Path) -> None:
    route = "#/configuracion/reportes"
    marker = '[data-od-id="report-settings"]'
    locale, width, height, theme = ("es", 1440, 1000, "light")
    saved_url = "https://retained.example.test/"
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, route, marker)
    set_locale(page, locale)
    fixture.set_theme(page, theme)
    check_loaded(page, marker, "retained setup", theme)
    field = first_input(page, marker)
    field.fill(saved_url)
    submit(page, marker).click()
    page.wait_for_function(
        """(args) => {
          const button = document.querySelector(args.marker + ' button[type=submit]');
          return !!button && button.textContent.trim() === args.saved;
        }""",
        arg={"marker": marker, "saved": copy_for(locale, "ui.reports.saved")},
    )
    # The canonical API normalizes the URL, so the retained value is the one the
    # saved response put back into the draft, not the literal typed value.
    saved_value = field.input_value()
    record(f"SETUP retained base URL saved through the editor: {saved_value}")

    # Client-side navigation keeps the app state, so a remount still holds the
    # previously loaded settings while the refresh runs.
    page.evaluate("() => { location.hash = '#/configuracion/general'; }")
    page.wait_for_function(
        """(marker) => !document.querySelector(marker)""", arg=marker, timeout=15000
    )
    page.route(READ, lambda route_handle: fulfill(route_handle, 503, '{"error": "unavailable"}'))
    try:
        page.evaluate("() => { location.hash = '#/configuracion/reportes'; }")
        page.wait_for_selector(marker, timeout=30000)
        page.wait_for_selector(f"{marker} [role=status]", state="detached", timeout=15000)
        settle(page)
        require(field.input_value() == saved_value,
                f"retained refresh: the loaded value was lost after a refused refresh "
                f"(expected {saved_value!r}, observed {field.input_value()!r})")
        require(page.locator(f"{marker} .doc-error[role=alert]").count() == 0,
                "retained refresh: a refused refresh of loaded settings showed a load error")
        require(save_enabled(page, marker),
                "retained refresh: save disabled although settings were already loaded")
        shot(page, shots, "reportes-retained-read-failed", route, locale, width, height, theme,
             "loaded settings retained through a refused refresh, save enabled")
    finally:
        page.unroute(READ)


def capture_qr_errors(page, shots: Path) -> None:
    route = "#/configuracion/qr"
    marker = '[data-od-id="qr-settings"]'
    locale, width, height, theme = ("es", 1440, 1000, "light")
    page.set_viewport_size({"width": width, "height": height})
    open_route(page, route, marker)
    set_locale(page, locale)
    fixture.set_theme(page, theme)
    check_loaded(page, marker, "qr errors setup", theme)

    field = page.locator(f"{marker} input[type=url]")
    field.fill("ftp://activos.example.test/")
    submit(page, marker).click()
    page.wait_for_timeout(150)
    url_error = page.locator(f"{marker} #qr-base-url-error")
    require(url_error.count() == 1, "qr url error: the URL specific error is missing")
    if url_error.count():
        require(QR_URL_ERROR[locale] in url_error.first.inner_text(),
                "qr url error: unexpected URL error copy")
    require(field.get_attribute("aria-invalid") == "true", "qr url error: aria-invalid is not true")
    require(field.get_attribute("aria-describedby") == "qr-base-url-error",
            "qr url error: aria-describedby does not reference the field error")
    require(page.locator(f"{marker} .doc-error[role=alert]").count() == 0,
            "qr url error: a generic alert appeared for a client validation error")
    shot(page, shots, "qr-url-invalid", route, locale, width, height, theme,
         "client URL validation error associated with the field, no generic alert")

    # The client accepts a query string; the canonical API refuses it. This is a
    # real server rejection, nothing is persisted and no write is mocked.
    rejected = "https://activos.example.test/?probe=1"
    field.fill(rejected)
    submit(page, marker).click()
    page.wait_for_selector(f"{marker} .doc-error[role=alert]", timeout=20000)
    alert = page.locator(f"{marker} .doc-error[role=alert]")
    require(alert.count() == 1, "qr generic failure: no generic alert")
    if alert.count():
        require(alert.first.inner_text().strip() != "", "qr generic failure: empty alert copy")
    require(page.locator(f"{marker} #qr-base-url-error").count() == 0,
            "qr generic failure: a URL field error appeared for a server rejection")
    require(field.get_attribute("aria-invalid") != "true",
            "qr generic failure: the field was marked invalid by a server rejection")
    require(field.input_value() == rejected, "qr generic failure: the draft was cleared")
    shot(page, shots, "qr-server-rejected", route, locale, width, height, theme,
         "canonical server rejection shown as a generic alert, no URL field error")


def capture_warranty_settings(page, shots: Path) -> None:
    cells = (("es", 1440, 1000, "light"), ("en", 390, 844, "dark"))
    disabled_probe = """(marker) => {
      const button = document.querySelector(marker + ' button[type=submit]');
      return !!button && button.disabled;
    }"""
    enabled_probe = """(marker) => {
      const button = document.querySelector(marker + ' button[type=submit]');
      return !!button && !button.disabled;
    }"""
    for locale, width, height, theme in cells:
        label = f"garantias {locale} {width}"
        page.set_viewport_size({"width": width, "height": height})
        open_route(page, WARRANTY_ROUTE, WARRANTY_MARKER)
        set_locale(page, locale)
        fixture.set_theme(page, theme)
        settle(page)
        require(editor(page, WARRANTY_MARKER).count() == 1,
                f"{label}: the warranty settings form is missing")
        require(page.locator(f"{WARRANTY_MARKER} .doc-error[role=alert]").count() == 0,
                f"{label}: an error alert appeared after a successful preference read")
        require(save_enabled(page, WARRANTY_MARKER),
                f"{label}: save disabled on a loaded warranty editor")
        require_enabled_action(page, WARRANTY_MARKER, theme, f"{label} loaded")
        record_targets(page, WARRANTY_MARKER, label)
        shot(page, shots, "garantias-loaded", WARRANTY_ROUTE, locale, width, height, theme,
             "preference read complete, save enabled")

        held = pause_writes(page, WARRANTY_READ)
        try:
            submit(page, WARRANTY_MARKER).click()
            page.wait_for_function(disabled_probe, arg=WARRANTY_MARKER, timeout=15000)
            require_inactive_action(page, WARRANTY_MARKER, theme, f"{label} saving")
            require(len(held) >= 1, f"{label}: the save never reached the server")
            shot(page, shots, "garantias-saving", WARRANTY_ROUTE, locale, width, height, theme,
                 "server write in flight, save disabled by the busy state")
        finally:
            for route_handle in held:
                try:
                    route_handle.continue_()
                except Exception:
                    pass
            page.unroute(WARRANTY_READ)
        page.wait_for_function(enabled_probe, arg=WARRANTY_MARKER, timeout=20000)
        require(page.locator(f"{WARRANTY_MARKER} .doc-error[role=alert]").count() == 0,
                f"{label}: the write reported an error on a real save")
        require_enabled_action(page, WARRANTY_MARKER, theme, f"{label} saved")

        page.route(WARRANTY_READ,
                   lambda route_handle: fulfill(route_handle, 503, '{"error": "unavailable"}'))
        try:
            open_route(page, WARRANTY_ROUTE, WARRANTY_MARKER)
            set_locale(page, locale)
            fixture.set_theme(page, theme)
            page.wait_for_selector(f"{WARRANTY_MARKER} .doc-error[role=alert]", timeout=20000)
            alert = page.locator(f"{WARRANTY_MARKER} .doc-error[role=alert]")
            require(alert.first.inner_text().strip() != "",
                    f"{label}: empty preference read error copy")
            require(not save_enabled(page, WARRANTY_MARKER),
                    f"{label}: save must refuse preferences that never loaded")
            require_inactive_action(page, WARRANTY_MARKER, theme, f"{label} read failed")
            shot(page, shots, "garantias-read-failed", WARRANTY_ROUTE, locale, width, height, theme,
                 "refused initial preference read shown as an alert, save remains disabled")
        finally:
            page.unroute(WARRANTY_READ)


def scenario(browser, shots: Path) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    fixture.login(page, BASE, USERNAME, PASSWORD)
    record(f"LOGIN {USERNAME} at {BASE}")
    load_copy(page)
    payload = real_settings(page)
    record(f"READ canonical settings body={len(payload)} bytes")

    capture_loaded(page, shots)
    capture_loading(page, shots, payload)
    capture_failed_first_read(page, shots)
    capture_typed_during_read(page, shots, payload)
    capture_retained_refresh(page, shots)
    capture_qr_errors(page, shots)
    capture_warranty_settings(page, shots)

    for error in errors:
        fail(f"page error: {error}")
    record(f"PAGEERRORS {len(errors)}")
    context.close()


def main() -> int:
    global BASE
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    for path in (PYTHON, BACKEND, FRONTEND / "node_modules"):
        assert path.exists(), path

    owner, ports = fixture.Owned(), []
    try:
        database_dir = SCRATCH / "ordinary"
        database_dir.mkdir(parents=True, exist_ok=True)
        database = database_dir / "settings.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "U9 settings install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "settings", api_env)
        with fixture.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                scenario(browser, shots)
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - diagnostics, then re-raise
        print(f"EXCEPTION {type(exc).__name__}: {exc}")
        print("DIAGNOSTICS (owned process log tails):")
        print(owner.log_tails(30))
        raise
    finally:
        owner.stop()
        leaked = fixture.open_ports(ports)
        if leaked:
            print(f"CLEANUP LEAKED ports {leaked}")
            FAILURES.append(f"ports still open: {leaked}")
        else:
            print(f"CLEANUP owned processes stopped, ports {ports} released")

    print(f"SUMMARY shots={len(list(shots.glob('*.png')))} failures={len(FAILURES)}")
    for message in FAILURES:
        print(f"FAILURE {message}")
    print("RESULT " + ("PASS" if not FAILURES else "FAIL"))
    return 0 if not FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
