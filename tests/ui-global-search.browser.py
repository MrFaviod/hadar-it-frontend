#!/usr/bin/env python3
"""Bounded browser proof of the global header search (remaining U11).

Opens the real search palette from the shell trigger and from the existing
Ctrl K shortcut on a fresh disposable SQLite installation, seeds one asset and
one person through the public API, and captures the open empty-query state, the
populated results and the unmatched state in two proof cells: Spanish desktop
light and English mobile dark.

Every screenshot is asserted beside the capture: canonical record identity from
the server item, settled results instead of the loading copy, localized copy,
effective theme, viewport, and no unexpected non-read traffic. One asset result
is opened after the captures to confirm the destination record. No Vue state is
injected, no authentication is mocked and no search payload is fabricated.

Usage: python3 tests/ui-global-search.browser.py
"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location(
    "documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py")
)
assert _spec and _spec.loader, "the shared browser fixture must be importable"
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)

fixture = v.fixture
PYTHON = v.PYTHON
BACKEND = v.BACKEND
RESULTS, FAILURES = v.RESULTS, v.FAILURES

SCRATCH = FRONTEND / ".verification" / ("ui-global-search-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH

USERNAME = "search.proof.admin"
PASSWORD = "Global-Search-Proof-9q2"
BASE = ""

TRIGGER = '[data-od-id="universal-search-trigger"]'
PALETTE = ".search-palette"
QUERY = "#universal-query"
CELLS = v.SETTINGS_CELLS

ASSET = {
    "name": "Notebook Busqueda Global",
    "serial": "SN-GS-0001",
    "quickCode": "GS-0001",
    "brand": "Lenovo",
    "model": "T14",
}
PERSON = {
    "name": "Rosa Busqueda Global",
    "jobTitle": "Analista de red",
    "contactEmail": "rosa.busqueda@example.test",
    "contactPhone": "+595 21 555 0202",
    "status": "active",
}
ASSET_ID = ""
PERSON_ID = ""
TRAFFIC = None
UNMATCHED = "zz-no-global-search-match-999"


class Writes:
    """Record non-read traffic so fixture writes stay apart from UI side effects."""

    def __init__(self, page):
        self.items = []
        page.on("request", self._record)

    def _record(self, request):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        self.items.append((request.method, request.url))

    def take(self):
        items, self.items = self.items, []
        return items


class SearchTraffic:
    """Observe the real search GETs so local-only states stay provable."""

    def __init__(self, page):
        self.urls = []
        page.on("request", self._record)

    def _record(self, request):
        if request.method == "GET" and "/api/v1/search" in request.url:
            self.urls.append(request.url)

    def take(self):
        urls, self.urls = self.urls, []
        return urls


def workspace_state_write(entry):
    method, url = entry
    return method == "PUT" and url.split("?", 1)[0].endswith("/api/v1/workspace/state")


def audit(writes, stage):
    entries = writes.take()
    workspace = [entry for entry in entries if workspace_state_write(entry)]
    unexpected = [entry for entry in entries if not workspace_state_write(entry)]
    v.record(f"WRITES {stage} workspace_put={len(workspace)} unexpected={len(unexpected)}")
    v.require(
        not unexpected,
        f"{stage}: unexpected non-read traffic "
        + ", ".join(f"{method} {url}" for method, url in unexpected),
    )
    return workspace


def seed(page):
    global ASSET_ID, PERSON_ID
    seed_writes = Writes(page)
    created = v.post(page, "/people", PERSON)
    v.require(created["status"] == 201, f"seed person: {created}")
    person = created["body"] or {}
    v.require(bool(person.get("id")), f"seed person: no id in {created}")
    PERSON_ID = person["id"]
    v.record(
        f"SEED person id={person['id']} name={person.get('name')!r} "
        f"jobTitle={person.get('jobTitle')!r} status={person.get('status')!r}"
    )

    asset_payload = dict(ASSET, responsiblePersonId=person["id"])
    created_asset = v.post(page, "/assets", asset_payload)
    v.require(created_asset["status"] == 201, f"seed asset: {created_asset}")
    asset = created_asset["body"] or {}
    v.require(bool(asset.get("id")), f"seed asset: no id in {created_asset}")
    ASSET_ID = asset["id"]
    v.record(
        f"SEED asset id={asset['id']} name={asset.get('name')!r} "
        f"quickCode={asset.get('quickCode')!r} responsiblePersonId={asset.get('responsiblePersonId')!r}"
    )

    entries = seed_writes.take()
    methods = sorted(method for method, _url in entries)
    v.record(f"SEED writes={len(entries)} methods={methods}")
    v.require(methods == ["POST", "POST"], f"seed writes: expected two creates, got {entries}")
    return person, asset


def close_palette(page):
    if page.locator(PALETTE).count():
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('.search-layer')", timeout=15000)


def open_palette(page, width):
    """Open the palette through the real shell trigger and report the opener."""
    close_palette(page)
    trigger = page.locator(TRIGGER)
    v.require(
        trigger.count() == 1,
        f"global search: expected one shell trigger, found {trigger.count()}",
    )
    v.require(
        trigger.is_visible(),
        f"global search: the shell trigger is not visible at width {width}",
    )
    trigger.click()
    page.wait_for_selector(PALETTE, timeout=15000)
    v.settle(page)
    v.require(
        trigger.get_attribute("aria-expanded") == "true",
        "global search: trigger did not report the open palette",
    )
    return "trigger-click"


def wait_settled(page, locale, expect_results):
    cat = v.CATALOG[locale]
    page.wait_for_function(
        """({searching, expect, empty}) => {
          const count = document.querySelector('.search-palette__count');
          if (count && (count.textContent || '').includes(searching)) return false;
          const options = document.querySelectorAll('#universal-results [role="option"]');
          if (expect) return options.length > 0;
          const block = document.querySelector('.search-empty');
          if (!block) return false;
          return options.length === 0 && (block.textContent || '').includes(empty);
        }""",
        arg={
            "searching": cat["ui.search.searching"],
            "expect": expect_results,
            "empty": cat["ui.search.empty_matches"],
        },
        timeout=30000,
    )
    v.settle(page)


def require_count_line(page, label, needles):
    """Assert the count/status line is actually rendered, not only in the DOM."""
    count = page.locator(".search-palette__count")
    v.require(count.count() == 1, f"{label}: count/status paragraph missing or duplicated")
    v.require(count.is_visible(), f"{label}: count/status paragraph is not visible")
    box = count.bounding_box()
    v.require(
        box is not None and box["width"] > 0 and box["height"] >= 12,
        f"{label}: count/status line has no usable layout box {box}",
    )
    text = count.text_content() or ""
    for needle in needles:
        v.require(needle in text, f"{label}: {needle!r} missing from {text!r}")
    spans = page.locator(".search-palette__count span")
    v.require(spans.count() >= 1, f"{label}: no count/status span is rendered")
    for index in range(spans.count()):
        span = spans.nth(index)
        state = span.evaluate(
            "el => { const s = getComputedStyle(el); return [s.display, s.visibility, s.opacity]; }"
        )
        visible = span.is_visible()
        v.require(
            visible and state[0] != "none" and state[1] != "hidden" and float(state[2]) > 0,
            f"{label}: status span {index} is not announced/rendered (is_visible={visible} style={state})",
        )
        span_box = span.bounding_box()
        v.require(
            span_box is not None and span_box["width"] > 0 and span_box["height"] > 0,
            f"{label}: status span {index} has no layout box {span_box}",
        )
    v.require(
        page.evaluate(
            "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"
        ),
        f"{label}: the palette overflows horizontally",
    )
    v.record(f"STATUS_LINE {label}: visible=True height={round(box['height'], 1)}px text={text!r}")
    return box


def check_open_empty(page, locale, theme, width):
    cat = v.CATALOG[locale]
    opener = open_palette(page, width)
    v.require(page.locator(PALETTE).count() == 1, "open empty: palette missing")
    v.require(
        page.evaluate("() => document.activeElement && document.activeElement.id") == "universal-query",
        f"open empty {locale}/{width}: the real query input is not focused",
    )
    status = page.locator(".search-palette__count").text_content() or ""
    require_count_line(
        page, f"open empty {locale}/{width}", [cat["ui.search.hint_prefix"]]
    )
    v.require(
        page.locator("#search-favorite").count() == 0,
        f"open empty {locale}/{width}: a quick action row offers a favorite control",
    )
    v.require(
        cat["ui.search.searching"] not in status,
        f"open empty {locale}/{width}: loading copy visible in {status!r}",
    )
    # An empty query never reaches the server; the palette lists the usual
    # local actions until a query is typed.
    v.require(
        page.locator("#universal-query").input_value() == "",
        f"open empty {locale}/{width}: query input is not empty",
    )
    options = page.locator('#universal-results [role="option"]').count()
    if TRAFFIC is not None:
        urls = TRAFFIC.take()
        v.require(not urls, f"open empty {locale}/{width}: unexpected search request {urls}")
    v.require(
        page.evaluate("() => document.documentElement.lang") == locale,
        f"open empty {locale}/{width}: document lang is not {locale}",
    )
    v.require(
        v.effective_theme(page) == theme,
        f"open empty {locale}/{width}: effective theme is not {theme}",
    )

    # The existing Ctrl K shortcut must open the palette and focus the real input.
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('.search-layer')", timeout=15000)
    page.keyboard.press("Control+k")
    page.wait_for_selector(PALETTE, timeout=15000)
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.id === 'universal-query'",
        timeout=15000,
    )
    v.record(f"SHORTCUT {locale}/{width}: Ctrl K opened the palette, focus=universal-query")
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('.search-layer')", timeout=15000)
    v.record(f"ESCAPE {locale}/{width}: palette closed from the keyboard")

    open_palette(page, width)
    return (
        f"opener={opener} shortcut=ctrl-k focus=universal-query escape=closed "
        f"local_options={options} server_requests=0 hint=localized"
    )


def check_results(page, locale, theme, width):
    open_palette(page, width)
    page.locator(QUERY).fill(ASSET["quickCode"])
    wait_settled(page, locale, expect_results=True)
    option = page.locator(f'[data-od-id="search-result-asset-{ASSET_ID}"]')
    v.require(
        option.count() == 1,
        f"results {locale}/{width}: canonical asset option asset:{ASSET_ID} missing",
    )
    text = option.inner_text()
    v.require(ASSET["name"] in text, f"results {locale}/{width}: asset label missing from {text!r}")
    v.require(
        ASSET["quickCode"] in text,
        f"results {locale}/{width}: asset quick code missing from {text!r}",
    )
    options = page.locator('#universal-results [role="option"]')
    v.require(
        options.count() >= 1,
        f"results {locale}/{width}: no selectable option rendered",
    )
    status = page.locator(".search-palette__count").text_content() or ""
    require_count_line(page, f"results {locale}/{width}", ["1"])
    favorite = page.locator("#search-favorite")
    v.require(
        favorite.count() == 1,
        f"results {locale}/{width}: the real asset does not offer a favorite control",
    )
    v.require(favorite.is_visible(), f"results {locale}/{width}: favorite control not visible")
    favorite_label = favorite.get_attribute("aria-label") or ""
    expected_prefix = v.CATALOG[locale]["ui.workspace.favorite"].replace("{label}", "").strip()
    v.require(
        expected_prefix in favorite_label,
        f"results {locale}/{width}: favorite label {favorite_label!r} lacks {expected_prefix!r}",
    )
    v.require(
        favorite.get_attribute("aria-pressed") == "false",
        f"results {locale}/{width}: unexpected favorite pressed state",
    )
    v.record(
        f"FAVORITE {locale}/{width}: asset control visible label={favorite_label!r} pressed=false"
    )
    v.require(
        cat_searching(locale) not in status,
        f"results {locale}/{width}: loading copy still visible in {status!r}",
    )
    if TRAFFIC is not None:
        urls = TRAFFIC.take()
        matching = [url for url in urls if "q=" + ASSET["quickCode"] in url]
        v.require(
            len(matching) == 1,
            f"results {locale}/{width}: expected one server search for the query, got {urls}",
        )
        v.record(f"SEARCH_GET {locale}/{width}: {matching[0]}")
    v.record(
        f"RESULTS {locale}/{width}: canonical asset:{ASSET_ID} option text={text!r} status={status!r}"
    )
    return f"opener=trigger-click query={ASSET['quickCode']!r} canonical=asset:{ASSET_ID}"


def cat_searching(locale):
    return v.CATALOG[locale]["ui.search.searching"]


def check_no_match(page, locale, theme, width):
    cat = v.CATALOG[locale]
    open_palette(page, width)
    page.locator(QUERY).fill(UNMATCHED)
    wait_settled(page, locale, expect_results=False)
    empty = page.locator(".search-empty")
    v.require(empty.count() == 1, f"no match {locale}/{width}: localized empty block missing")
    text = empty.text_content() or ""
    v.require(
        cat["ui.search.empty_matches"] in text,
        f"no match {locale}/{width}: localized empty heading missing from {text!r}",
    )
    v.require(
        cat["ui.search.empty_body"] in text,
        f"no match {locale}/{width}: localized recovery copy missing from {text!r}",
    )
    v.require(
        page.locator(".search-result").count() == 0,
        f"no match {locale}/{width}: results rendered for an unmatched query",
    )
    require_count_line(page, f"no match {locale}/{width}", ["0"])
    v.record(f"NO_MATCH {locale}/{width}: query={UNMATCHED!r} localized empty state")
    return f"opener=trigger-click query={UNMATCHED!r} results=0"


def check_person(page, locale):
    """Read-only extra query: the seeded person must resolve by canonical id."""
    open_palette(page, 1440)
    page.locator(QUERY).fill(PERSON["name"])
    page.wait_for_function(
        """(id) => !!document.querySelector('[data-od-id="search-result-person-' + id + '"]')""",
        arg=PERSON_ID,
        timeout=30000,
    )
    option = page.locator(f'[data-od-id="search-result-person-{PERSON_ID}"]')
    text = option.inner_text()
    v.require(PERSON["name"] in text, f"person result: label missing from {text!r}")
    v.require(PERSON["jobTitle"] in text, f"person result: role missing from {text!r}")
    v.record(f"PERSON_RESULT {locale}: canonical person:{PERSON_ID} text={text!r}")
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('.search-layer')", timeout=15000)


def check_destination(page, locale):
    """Open one real asset result and assert the destination record."""
    before = page.evaluate("() => location.hash")
    open_palette(page, 1440)
    page.locator(QUERY).fill(ASSET["quickCode"])
    wait_settled(page, locale, expect_results=True)
    page.locator(f'[data-od-id="search-result-asset-{ASSET_ID}"] .search-result__open').click()
    page.wait_for_function("() => !document.querySelector('.search-layer')", timeout=15000)
    page.wait_for_function(
        "(id) => location.hash.includes(id)", arg=ASSET_ID, timeout=30000
    )
    page.wait_for_function(
        "(name) => document.body.innerText.includes(name)",
        arg=ASSET["name"],
        timeout=30000,
    )
    v.settle(page)
    after = page.evaluate("() => location.hash")
    body = v.body_text(page)
    v.require(ASSET["name"] in body, f"destination {locale}: asset name missing")
    v.require(ASSET["quickCode"] in body, f"destination {locale}: asset quick code missing")
    v.require(ASSET_ID in after, f"destination {locale}: hash {after!r} has no asset id")
    v.require(after != before, f"destination {locale}: hash did not change from {before!r}")
    v.record(f"DESTINATION {locale}: {before!r} -> {after!r} asset={ASSET['name']!r}")


def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    fixture.login(page, BASE, USERNAME, PASSWORD)
    try:
        person, asset = seed(page)
        v.require(asset["id"] == ASSET_ID, "seed asset id mismatch")

        global TRAFFIC
        TRAFFIC = SearchTraffic(page)
        writes = Writes(page)
        v.capture(
            page, shots, "search-open-empty", "#/panel", TRIGGER, CELLS, check_open_empty
        )
        v.capture(page, shots, "search-results", "#/panel", TRIGGER, CELLS, check_results)
        v.capture(page, shots, "search-no-match", "#/panel", TRIGGER, CELLS, check_no_match)
        audit(writes, "captures")

        check_person(page, "es")
        audit(writes, "person-query")

        check_destination(page, "es")
        workspace = audit(writes, "destination")
        v.require(
            len(workspace) >= 1,
            f"destination: expected the workspace state write, got {workspace}",
        )
        v.record(f"DESTINATION_WRITES workspace_put={len(workspace)}")

        assert not errors, errors
        v.record(
            f"SEARCH_PROOF pageerrors=0 seeded_assets=1 seeded_people=1 "
            f"seeded_accounts=0 results_opened=1"
        )
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
        database = database_dir / "search.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "UI global search install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "search", api_env)
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
    print("RESULT all global search checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
