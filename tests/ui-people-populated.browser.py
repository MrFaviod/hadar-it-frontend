"""Bounded browser proof of the populated people directory.

Seeds one inventory person and one asset through the public API on a fresh
disposable SQLite installation, then captures the populated directory, the real
person record and the assignment sheet reached from the record.

The person is a responsibility record, not an access account. Nothing is saved
in the assignment sheet: it is opened and cancelled. No Vue state is injected,
no permission is widened and no non-loopback service is used.

Usage: python3 tests/ui-people-populated.browser.py
"""

import importlib.util
from pathlib import Path
import sys
import uuid

_spec = importlib.util.spec_from_file_location(
    "documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py")
)
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)

fixture, PYTHON, BACKEND, FRONTEND = v.fixture, v.PYTHON, v.BACKEND, v.FRONTEND
USERNAME, PASSWORD = v.USERNAME, v.PASSWORD
SCRATCH = FRONTEND / ".verification" / ("ui-people-populated-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""
ASSET_ID = ""
HISTORY_TITLES = {}

PERSON = {
    "name": "Ana Torres",
    "jobTitle": "Supervisora de red",
    "contactEmail": "ana.torres@example.test",
    "contactPhone": "+595 21 555 0101",
    "status": "active",
}
ASSET = {
    "name": "Notebook de guardia",
    "serial": "SN-NOTE-2",
    "quickCode": "DC-0002",
    "brand": "Lenovo",
    "model": "T14",
}
# The two proof cells: Spanish desktop light and English mobile dark.
CELLS = v.SETTINGS_CELLS


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

class PersonHistory:
    """Observe the canonical history GET the person record already issues."""

    def __init__(self, page):
        self.responses = []
        page.on("response", self._record)

    def _record(self, response):
        if response.request.method != "GET":
            return
        url = response.url.split("?", 1)[0]
        if "/people/" in url and url.endswith("/history"):
            self.responses.append(response)

    def payload(self):
        for response in reversed(self.responses):
            try:
                body = response.json()
            except Exception:
                continue
            if isinstance(body, dict) and isinstance(body.get("items"), list):
                return body
        return None

class AssetHistory:
    """Observe the canonical asset history GET issued by the asset record."""

    def __init__(self, page):
        self.responses = []
        page.on("response", self._record)

    def _record(self, response):
        if response.request.method != "GET":
            return
        url = response.url.split("?", 1)[0]
        if "/assets/" in url and url.endswith("/history"):
            self.responses.append(response)

    def payload(self):
        for response in reversed(self.responses):
            try:
                body = response.json()
            except Exception:
                continue
            if isinstance(body, dict) and isinstance(body.get("items"), list):
                return body
        return None


def workspace_state_write(entry):
    method, url = entry
    return method == "PUT" and url.split("?", 1)[0].endswith("/api/v1/workspace/state")


def seed(page):
    global ASSET_ID
    created = v.post(page, "/people", PERSON)
    v.require(created["status"] == 201, f"seed person: {created}")
    person = created["body"] or {}
    v.require(bool(person.get("id")), f"seed person: no id in {created}")
    v.record(
        f"SEED person id={person['id']} name={person.get('name')!r} "
        f"jobTitle={person.get('jobTitle')!r} status={person.get('status')!r}"
    )

    asset_payload = dict(ASSET, responsiblePersonId=person["id"])
    created_asset = v.post(page, "/assets", asset_payload)
    v.require(created_asset["status"] == 201, f"seed asset: {created_asset}")
    asset = created_asset["body"] or {}
    v.require(bool(asset.get("id")), f"seed asset: no id in {created_asset}")
    v.require(
        asset.get("responsiblePersonId") == person["id"],
        f"seed asset kept responsible={asset.get('responsiblePersonId')!r}",
    )
    ASSET_ID = asset["id"]
    v.record(
        f"SEED asset id={asset['id']} name={asset.get('name')!r} "
        f"quickCode={asset.get('quickCode')!r} responsiblePersonId={asset.get('responsiblePersonId')!r}"
    )

    linked = v.post(page, f"/people/{person['id']}/assets?limit=50&offset=0", method="GET")
    v.require(linked["status"] == 200, f"read person assets: {linked}")
    total = (linked["body"] or {}).get("total")
    v.require(total == 1, f"read person assets: expected 1 linked asset, got {total}")
    v.record(f"SEED link person_id={person['id']} assets_total={total}")
    return person, asset


def check_people(page, locale, theme, width):
    cat = v.CATALOG[locale]
    page.wait_for_function(
        """(name) => Array.from(document.querySelectorAll('.people-table a.asset-name'))
             .some((link) => link.textContent.trim() === name)""",
        arg=PERSON["name"],
        timeout=30000,
    )
    body = v.body_text(page)
    v.require(cat["ui.people.title"] in body, f"people {locale}/{width}: title missing")
    v.require(PERSON["name"] in body, f"people {locale}/{width}: seeded person missing")
    v.require(PERSON["jobTitle"] in body, f"people {locale}/{width}: seeded role missing")
    v.require(PERSON["contactEmail"] in body, f"people {locale}/{width}: seeded email missing")
    v.require(
        cat["ui.people.loading"] not in body,
        f"people {locale}/{width}: loading copy still visible",
    )
    v.require(
        page.locator(".people-page .form-error").count() == 0,
        f"people {locale}/{width}: error alert rendered",
    )
    v.require(
        page.locator(".people-table tbody tr").count() == 1,
        f"people {locale}/{width}: unexpected directory row count",
    )
    total = page.locator(".stats-strip .stat__value").first.inner_text().strip()
    v.require(total == "1", f"people {locale}/{width}: registered total {total!r}")
    labels = [text.strip() for text in page.locator(".stats-strip .stat__label").all_text_contents()]
    forms = {
        "total": cat["ui.people.stat_total"].split(" | "),
        "active": cat["ui.people.stat_active"].split(" | "),
    }
    v.require(len(forms["total"]) == 2, f"people {locale}/{width}: stat_total is not pluralized")
    v.require(len(forms["active"]) == 2, f"people {locale}/{width}: stat_active is not pluralized")
    v.require(
        labels[0] == forms["total"][0],
        f"people {locale}/{width}: total label {labels[0]!r} is not the singular form",
    )
    v.require(
        labels[1] == forms["active"][0],
        f"people {locale}/{width}: active label {labels[1]!r} is not the singular form",
    )
    stats = page.locator(".stats-strip .stat")
    for index, name in ((0, "total"), (1, "active")):
        cell = stats.nth(index).inner_text()
        v.require(
            cell.count("1") == 1,
            f"people {locale}/{width}: {name} stat repeats the count: {cell!r}",
        )
    placeholder = page.locator("#people-search").get_attribute("placeholder")
    v.require(
        placeholder == cat["ui.people.search_placeholder"],
        f"people {locale}/{width}: search placeholder {placeholder!r}",
    )
    v.require(
        v.effective_theme(page) == theme,
        f"people {locale}/{width}: theme {v.effective_theme(page)!r}",
    )
    return (
        f"rows=1 total={total} stat_labels={labels[0]!r}/{labels[1]!r} theme={theme}"
    )


def check_person(page, locale, theme, width):
    cat = v.CATALOG[locale]
    page.wait_for_function(
        """(name) => {
             const heading = document.querySelector('#person-title');
             return !!heading && heading.textContent.trim() === name;
           }""",
        arg=PERSON["name"],
        timeout=30000,
    )
    page.wait_for_selector(".person-assets .asset-name", timeout=30000)

    contact = page.locator(".person-contact").inner_text()
    v.require(cat["ui.people.contact_title"] in contact, f"person {locale}/{width}: contact title")
    v.require(PERSON["contactEmail"] in contact, f"person {locale}/{width}: email")
    v.require(PERSON["contactPhone"] in contact, f"person {locale}/{width}: phone")
    v.require(PERSON["jobTitle"] in contact or PERSON["jobTitle"] in page.locator(".person-head").inner_text(),
              f"person {locale}/{width}: role")

    assets = page.locator(".person-assets").inner_text()
    v.require(cat["ui.people.assets_title"] in assets, f"person {locale}/{width}: assets title")
    v.require(ASSET["name"] in assets, f"person {locale}/{width}: seeded asset missing")
    v.require(ASSET_ID in assets, f"person {locale}/{width}: seeded asset id missing")
    v.require(
        page.locator(".person-assets .asset-code").count() == 1,
        f"person {locale}/{width}: asset code cell count",
    )

    breadcrumb = page.locator(".breadcrumbs")
    v.require(
        breadcrumb.locator("a").inner_text().strip() == cat["ui.people.title"],
        f"person {locale}/{width}: breadcrumb directory label",
    )
    v.require(
        breadcrumb.locator("[aria-current=page]").inner_text().strip() == PERSON["name"],
        f"person {locale}/{width}: breadcrumb person label",
    )
    v.require(
        page.locator(".back-link").inner_text().strip() == cat["ui.people.back"],
        f"person {locale}/{width}: back link copy",
    )
    v.require(
        page.locator(".person-page .form-error").count() == 0,
        f"person {locale}/{width}: error alert rendered",
    )
    v.require(
        page.get_by_role("button", name=cat["ui.people.assign_asset"], exact=True).count() == 1,
        f"person {locale}/{width}: assign action missing",
    )
    v.require(
        v.effective_theme(page) == theme,
        f"person {locale}/{width}: theme {v.effective_theme(page)!r}",
    )
    HISTORY_TITLES[locale] = [
        title.strip() for title in page.locator(".person-history .history-list__item strong").all_inner_texts()
    ]
    v.record(f"HISTORY_RENDER {locale}/{width} titles={HISTORY_TITLES[locale]}")
    return f"person={PERSON['name']!r} assets=1 theme={theme}"


def asset_history_titles(page):
    return [title.strip() for title in page.locator(".asset-history .history-item strong").all_inner_texts()]

def wait_asset_history(page):
    page.wait_for_function(
        "() => document.querySelectorAll('.asset-history .history-item').length > 0",
        timeout=30000,
    )

def check_asset_history(page, locale, theme, width):
    cat = v.CATALOG[locale]
    wait_asset_history(page)
    v.require(
        page.locator(".asset-history .config-note[role=status]").count() == 0,
        f"asset history {locale}/{width}: loading copy still visible",
    )
    v.require(
        page.locator(".asset-history .history-item").count() == 1,
        f"asset history {locale}/{width}: unexpected row count",
    )
    titles = asset_history_titles(page)
    v.require(
        titles == [cat["ui.inventory.history.created"]],
        f"asset history {locale}/{width}: created title {titles!r}",
    )
    head = page.locator(".detail-head").inner_text()
    v.require(ASSET["name"] in head, f"asset history {locale}/{width}: server asset name missing")
    v.require(ASSET_ID in head, f"asset history {locale}/{width}: server asset id missing")
    v.require(
        v.effective_theme(page) == theme,
        f"asset history {locale}/{width}: theme {v.effective_theme(page)!r}",
    )
    return f"rows=1 title={titles[0]!r} asset={ASSET['name']!r} theme={theme}"

def check_asset_history_locale(page):
    """Switch the loaded asset history ES to EN to ES without reloading the document."""
    cat_es, cat_en = v.CATALOG["es"], v.CATALOG["en"]
    route = "#/activo/" + ASSET_ID
    page.set_viewport_size({"width": 1440, "height": 1000})
    v.open_route(page, route, ".detail-page")
    v.set_locale(page, "es")
    v.settle(page)
    wait_asset_history(page)
    page.evaluate("() => { window.__assetHistoryMarker = 'kept'; }")
    es_titles = asset_history_titles(page)
    actor_es = page.locator(".asset-history .history-item p span").first.inner_text().strip()
    v.require(es_titles == [cat_es["ui.inventory.history.created"]], f"asset history es title {es_titles!r}")

    v.set_locale(page, "en")
    v.settle(page)
    en_titles = asset_history_titles(page)
    actor_en = page.locator(".asset-history .history-item p span").first.inner_text().strip()
    v.require(en_titles == [cat_en["ui.inventory.history.created"]], f"asset history en title {en_titles!r}")
    v.require(
        page.evaluate("() => window.__assetHistoryMarker") == "kept",
        "asset history: the locale switch reloaded the document",
    )
    v.require(
        actor_es == actor_en,
        f"asset history: free actor text changed {actor_es!r} -> {actor_en!r}",
    )
    v.require(ASSET["name"] in page.locator(".detail-head").inner_text(), "asset history: free asset name changed")

    v.set_locale(page, "es")
    v.settle(page)
    es_again = asset_history_titles(page)
    v.require(es_again == [cat_es["ui.inventory.history.created"]], f"asset history es restored {es_again!r}")
    v.record(
        f"ASSET_HISTORY locale_switch es={es_titles} en={en_titles} es_again={es_again} "
        f"rows=1 reload=0 actor={actor_es!r} free_asset={ASSET['name']!r}"
    )

def capture_dialog(page, shots, person_id):
    """Open the real assignment sheet, capture it, then cancel without saving."""
    route = "#/persona/" + person_id
    for locale, width, height, theme in CELLS:
        cat = v.CATALOG[locale]
        page.set_viewport_size({"width": width, "height": height})
        v.open_route(page, route, ".person-page")
        v.set_locale(page, locale)
        v.set_theme(page, theme)
        v.settle(page)

        page.wait_for_function(
            """(name) => {
                 const heading = document.querySelector('#person-title');
                 return !!heading && heading.textContent.trim() === name;
               }""",
            arg=PERSON["name"],
            timeout=30000,
        )
        trigger = page.locator(".person-head__actions").get_by_role(
            "button", name=cat["ui.people.assign_asset"], exact=True
        )
        v.require(trigger.count() == 1, f"dialog {locale}/{width}: trigger count")
        trigger.click()

        dialog = page.locator(".modal[role=dialog]")
        dialog.wait_for(state="visible", timeout=15000)
        v.settle(page)

        title = dialog.locator(".modal__head h2").inner_text().strip()
        v.require(
            title == cat["ui.people.assign_asset"],
            f"dialog {locale}/{width}: title {title!r}",
        )
        eyebrow = dialog.locator(".modal__head .eyebrow").inner_text().strip()
        v.require(
            cat["ui.organization.config.assign_eyebrow"].casefold() in eyebrow.casefold(),
            f"dialog {locale}/{width}: eyebrow {eyebrow!r}",
        )
        context = dialog.locator(".assign-context").inner_text()
        v.require(PERSON["name"] in context, f"dialog {locale}/{width}: person context")
        v.require(PERSON["jobTitle"] in context, f"dialog {locale}/{width}: role context")
        options = dialog.locator(".assign-option").all_inner_texts()
        v.require(
            any(ASSET["name"] in option for option in options),
            f"dialog {locale}/{width}: seeded asset option missing",
        )
        reject_group = dialog.locator(".assign-options").get_attribute("aria-label")
        v.require(bool(reject_group), f"dialog {locale}/{width}: options group unlabelled")
        cancel = dialog.get_by_role("button", name=cat["ui.common.cancel"], exact=True)
        v.require(cancel.count() == 1, f"dialog {locale}/{width}: cancel missing")

        focus = page.evaluate(
            "() => document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : ''"
        )
        scroll = dialog.locator(".modal__body").evaluate(
            "(el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, "
            "scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })"
        )
        over = dialog.evaluate("(el) => el.scrollWidth - el.clientWidth")
        v.record(
            f"DIALOG {locale} {width} focus={focus!r} body_scroll={scroll['scrollHeight']}/"
            f"{scroll['clientHeight']} body_width={scroll['scrollWidth']}/{scroll['clientWidth']} "
            f"dialog_overflow={over}px"
        )
        v.require(over <= 1, f"dialog {locale}/{width}: horizontal overflow {over}px")

        path = shots / f"assignment-dialog-{locale}-{width}-{theme}.png"
        page.screenshot(path=str(path), full_page=True)
        v.record(
            f"SHOT {path.name} route={route} state=assignment-dialog locale={locale} "
            f"theme={v.effective_theme(page)} viewport={width}x{height} overflow={v.overflow(page)}px "
            f"dialog=open asset={ASSET['name']!r}"
        )

        cancel.click()
        dialog.wait_for(state="hidden", timeout=15000)
        page.wait_for_function(
            "() => document.querySelectorAll('.modal[role=dialog]').length === 0",
            timeout=15000,
        )
        v.record(f"DIALOG {locale} {width} cancelled=1 saved=0")


def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    fixture.login(page, BASE, USERNAME, PASSWORD)
    writes = Writes(page)
    history = PersonHistory(page)
    asset_history = AssetHistory(page)
    writes.take()  # login traffic is its own unit, not a fixture write
    person, asset = seed(page)
    fixture_writes = writes.take()
    v.record(
        "FIXTURE_WRITES "
        + " ".join(f"{method} {url.split('?', 1)[0]}" for method, url in fixture_writes)
    )
    v.require(
        len(fixture_writes) == 2,
        f"fixture writes: expected create person + create asset, got {fixture_writes}",
    )

    try:
        v.capture(page, shots, "people-populated", "#/personas", ".people-page", CELLS, check_people)
        v.capture(
            page, shots, "person-detail", "#/persona/" + person["id"], ".person-page", CELLS, check_person
        )
        capture_dialog(page, shots, person["id"])
        # Read the person payload while the person document is still the live
        # one: later navigations drop the body of an earlier response.
        payload = history.payload()
        v.require(payload is not None, "HISTORY canonical GET missing")
        check_asset_history_locale(page)
        v.capture(page, shots, "asset-history", "#/activo/" + ASSET_ID, ".detail-page", CELLS, check_asset_history)
        v.require(not errors, f"page errors: {errors}")

        actions = [item.get("action") for item in payload["items"] if isinstance(item, dict)]
        v.record(
            f"HISTORY canonical_get=1 items={len(actions)} total={payload.get('total')!r} "
            f"actions={actions}"
        )
        v.require(payload.get("total") == 1, f"HISTORY total {payload.get('total')!r}")
        v.require(actions == ["created"], f"HISTORY actions {actions!r}")
        es_title = v.CATALOG["es"]["ui.organization.history.person_created"]
        en_title = v.CATALOG["en"]["ui.organization.history.person_created"]
        es_titles = HISTORY_TITLES.get("es") or []
        en_titles = HISTORY_TITLES.get("en") or []
        v.record(
            f"HISTORY locale_switch es={es_titles} en={en_titles} "
            f"es_catalog={es_title!r} en_catalog={en_title!r}"
        )
        # Each settled cell must render the created event through the active
        # catalog, not the Spanish title captured when the list first loaded.
        v.require(es_titles == [es_title], f"HISTORY es created title {es_titles!r}")
        v.require(en_titles == [en_title], f"HISTORY en created title {en_titles!r}")

        asset_payload = asset_history.payload()
        v.require(asset_payload is not None, "ASSET_HISTORY canonical GET missing")
        asset_actions = [item.get("action") for item in asset_payload["items"] if isinstance(item, dict)]
        v.record(
            f"ASSET_HISTORY canonical_get=1 items={len(asset_actions)} "
            f"total={asset_payload.get('total')!r} actions={asset_actions}"
        )
        v.require(asset_payload.get("total") == 1, f"ASSET_HISTORY total {asset_payload.get('total')!r}")
        v.require(asset_actions == ["created"], f"ASSET_HISTORY actions {asset_actions!r}")

        capture_writes = writes.take()
        workspace_writes = [entry for entry in capture_writes if workspace_state_write(entry)]
        unexpected = [entry for entry in capture_writes if not workspace_state_write(entry)]
        v.record(
            f"CAPTURE_WRITES workspace_put={len(workspace_writes)} unexpected={len(unexpected)}"
        )
        v.require(
            not unexpected,
            "capture writes: unexpected non-read traffic "
            + ", ".join(f"{method} {url}" for method, url in unexpected),
        )
        v.record("PEOPLE_PROOF pageerrors=0 seeded_people=1 seeded_accounts=0 assignment_saved=0")
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
        database = database_dir / "people.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "UI people populated install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        BASE, ports = fixture.start_servers(owner, "people", api_env)
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
    print("RESULT all populated people checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
