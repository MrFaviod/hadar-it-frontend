"""Isolated visual proof of the asset configuration tabs.

Covers Forms, Statuses and Identification in the asset configuration section
only. The proof creates no catalog entries, saves no settings and never touches
a production or provider-backed installation.
"""
import importlib.util
from pathlib import Path
import re
import sys
import uuid

_spec = importlib.util.spec_from_file_location(
    "documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py"))
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)
fixture, PYTHON, BACKEND, FRONTEND = v.fixture, v.PYTHON, v.BACKEND, v.FRONTEND
USERNAME, PASSWORD = v.USERNAME, v.PASSWORD
SCRATCH = FRONTEND / ".verification" / ("ui-config-asset-tabs-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

ROUTE = "#/configuracion/activos"
PAGE_MARKER = '[data-od-id="config-asset-management"]'

TABS = (
    {
        "slug": "formularios",
        "panel": "config-asset-forms",
        "tab": {"es": "Formularios", "en": "Forms"},
        "title": {"es": "Formularios por categoría", "en": "Forms by category"},
    },
    {
        "slug": "estados",
        "panel": "config-asset-statuses",
        "tab": {"es": "Estados", "en": "Statuses"},
        "title": {"es": "Estados del activo", "en": "Asset statuses"},
    },
    {
        "slug": "identificacion",
        "panel": "config-asset-identity",
        "tab": {"es": "Identificación", "en": "Identification"},
        "title": {"es": "Identificación", "en": "Identification"},
    },
)

TABLIST_ARIA = {"es": "Configuración de activos", "en": "Asset configuration"}

RAW_COMMON_KEYS = ("locationId", "assigneeId", "statusId", "description")
COMMON_LABEL_KEYS = (
    "ui.asset.common.location",
    "ui.asset.common.responsible",
    "ui.asset.common.status",
    "ui.asset.common.description",
)
CONFIG_PUTS = []


def tab_metrics(page):
    return page.evaluate(
        """() => {
          const el = document.querySelector('.config-assets__tabs');
          if (!el) return null;
          const style = getComputedStyle(el);
          return {
            overflowX: style.overflowX,
            flexWrap: style.flexWrap,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            scrollLeft: el.scrollLeft,
            label: el.getAttribute('aria-label') || ''
          };
        }"""
    )


def asset_tab_check(tab):
    slug = tab["slug"]

    def check(page, locale, theme, width):
        lang = page.evaluate("() => document.documentElement.lang")
        v.require(lang == locale, f"{slug} {locale}: document lang is {lang!r}")
        tabs = page.locator(".config-assets__tabs")
        v.require(tabs.count() == 1, f"{slug} {locale} {width}: tablist missing")
        if tabs.count() != 1:
            return "tablist missing"
        metrics = tab_metrics(page)
        v.require(metrics is not None, f"{slug} {locale} {width}: tab metrics unavailable")
        if metrics is None:
            return "tab metrics unavailable"
        v.require(
            metrics["label"] == TABLIST_ARIA[locale],
            f"{slug} {locale}: tablist aria-label is {metrics['label']!r}",
        )

        target = page.get_by_role("tab", name=tab["tab"][locale], exact=True)
        v.require(target.count() == 1, f"{slug} {locale}: tab {tab['tab'][locale]!r} not unique")
        if target.count() != 1:
            return "tab missing"
        target.evaluate("el => el.scrollIntoView({block: 'nearest', inline: 'nearest'})")
        page.wait_for_timeout(80)
        box = target.bounding_box()
        reachable = bool(box) and box["x"] >= -0.5 and box["x"] + box["width"] <= width + 0.5
        v.require(
            reachable,
            f"{slug} {locale} {width}: tab not fully reachable horizontally "
            f"(box={box}, scrollWidth={metrics['scrollWidth']}, clientWidth={metrics['clientWidth']})",
        )

        if metrics["scrollWidth"] > metrics["clientWidth"] + 1:
            v.require(
                metrics["overflowX"] in ("auto", "scroll"),
                f"{slug} {locale} {width}: overflowing tablist is not scrollable "
                f"(overflow-x={metrics['overflowX']!r})",
            )
            page.eval_on_selector(
                ".config-assets__tabs",
                "el => { el.scrollLeft = el.scrollWidth; }",
            )
            page.wait_for_timeout(80)
            scrolled = tab_metrics(page)
            v.require(
                scrolled is not None and scrolled["scrollLeft"] > 0,
                f"{slug} {locale} {width}: tablist did not scroll horizontally",
            )
            box = target.bounding_box()
            v.require(
                bool(box) and box["x"] >= -0.5 and box["x"] + box["width"] <= width + 0.5,
                f"{slug} {locale} {width}: tab unreachable after scrolling to the end",
            )
            scroll_note = (
                f"scrollable overflow-x={metrics['overflowX']} "
                f"scrollWidth={metrics['scrollWidth']} clientWidth={metrics['clientWidth']}"
            )
        else:
            scroll_note = (
                f"fits scrollWidth={metrics['scrollWidth']} clientWidth={metrics['clientWidth']}"
            )

        target.click()
        page.wait_for_selector(f'[data-od-id="{tab["panel"]}"]', timeout=15000)
        v.settle(page)

        selected = page.locator(
            f'.config-assets__tab[aria-selected="true"]').all_inner_texts()
        v.require(
            len(selected) == 1 and tab["tab"][locale] in selected[0],
            f"{slug} {locale}: aria-selected tabs are {selected!r}",
        )
        for other in TABS:
            if other["slug"] == slug:
                continue
            v.require(
                page.locator(f'[data-od-id="{other["panel"]}"]').count() == 0,
                f"{slug} {locale}: unrelated panel {other['panel']} rendered",
            )
        heading = page.locator(f'[data-od-id="{tab["panel"]}"] h2').first.inner_text()
        v.require(
            heading.strip() == tab["title"][locale],
            f"{slug} {locale}: panel heading is {heading!r}, "
            f"expected {tab['title'][locale]!r}",
        )
        extra = ""
        panel = page.locator(f'[data-od-id="{tab["panel"]}"]')
        if slug == "formularios":
            labels = [text.strip() for text in panel.locator(".bucket-row__label").all_inner_texts()]
            v.require(labels, f"{slug} {locale}: no common-field rows rendered")
            raw = sorted(set(RAW_COMMON_KEYS) & set(labels))
            v.require(not raw, f"{slug} {locale}: raw common-field keys rendered {raw}")
            expected = page.evaluate(
                "(keys) => keys.map((key) => window.ItsmI18n.i18n.global.t(key))",
                list(COMMON_LABEL_KEYS),
            )
            missing = [label for label in expected if label not in labels]
            v.require(
                not missing,
                f"{slug} {locale}: missing localized labels {missing}; got {labels}",
            )
            text = panel.inner_text()
            prefix_hint = page.evaluate(
                "() => window.ItsmI18n.i18n.global.t('ui.catalog.forms.prefix_hint')")
            v.require(
                prefix_hint in text,
                f"{slug} {locale}: prefix hint missing {prefix_hint!r}",
            )
            lowered = text.lower()
            v.require(
                "-cen-001" not in lowered
                and "por ejemplo" not in lowered
                and "for example" not in lowered,
                f"{slug} {locale}: prefix hint still shows a fixed-order sample",
            )
            extra = f" common_labels={len(labels)} localized=4 raw=0 prefix_hint=neutral"
        if slug == "identificacion":
            text = panel.inner_text()
            env = page.evaluate(
                "() => window.ItsmI18n.i18n.global.t('ui.catalog.identity.environment')")
            hint = page.evaluate(
                "() => window.ItsmI18n.i18n.global.t('ui.catalog.identity.quick_example_hint')")
            v.require(
                text.count(env) == 1,
                f"{slug} {locale}: server environment heading appears {text.count(env)}x",
            )
            v.require(hint in text, f"{slug} {locale}: neutral quick-code hint missing {hint!r}")
            v.require(
                "Tipo · sede" not in text and "Type · site" not in text,
                f"{slug} {locale}: fixed-order caption still rendered",
            )
            preview = panel.locator(".identity-preview__cell").nth(1).locator("strong")
            before = preview.inner_text().strip()
            puts_before = len(CONFIG_PUTS)
            panel.locator("#rules-order").select_option("type-site")
            page.wait_for_timeout(150)
            after = preview.inner_text().strip()
            v.require(
                after != before and re.fullmatch(r"[A-Z]+-CEN-\d+", after) is not None,
                f"{slug} {locale}: draft order did not refresh the example "
                f"({before!r} -> {after!r})",
            )
            v.require(
                len(CONFIG_PUTS) == puts_before,
                f"{slug} {locale}: the local draft wrote to the inventory API",
            )
            panel.locator("#rules-order").select_option("site-type")
            page.wait_for_timeout(150)
            v.require(
                preview.inner_text().strip() == before,
                f"{slug} {locale}: the example did not return to the saved order",
            )
            extra = f" env_heading=1 hint=neutral preview={before!r}->{after!r} puts=0"
        return (
            f"tab={slug} panel={tab['panel']} heading={heading.strip()!r} "
            f"aria-selected=1 {scroll_note}{extra}"
        )

    return check


def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def track_config_writes(request):
        if request.method == "PUT" and "/api/v1/inventory/config" in request.url:
            CONFIG_PUTS.append(request.url)

    page.on("request", track_config_writes)
    fixture.login(page, BASE, USERNAME, PASSWORD)
    try:
        for tab in TABS:
            v.capture(
                page,
                shots,
                "config-asset-tabs-" + tab["slug"],
                ROUTE,
                PAGE_MARKER,
                v.SETTINGS_CELLS,
                asset_tab_check(tab),
            )
        assert not errors, errors
        print("ASSET_TABS_PROOF pageerrors=0")
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
             "--username", USERNAME, "--name", "UI asset tabs install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "documents", api_env)
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
    print(f"rows={len(RESULTS)} failures={len(FAILURES)} "
          f"screenshots={len(list(shots.glob('*.png')))}")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    if FAILURES:
        print("FAILURES:")
        for item in FAILURES:
            print(f"- {item}")
        return 1
    print("RESULT all asset-tab checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
