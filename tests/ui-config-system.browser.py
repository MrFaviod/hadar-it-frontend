#!/usr/bin/env python3
"""Bounded READ-only browser proof of `#/configuracion/sistema` (U12, T3/S3).

The observation this proof resolves is a provenance conflict, not a visual
preference: `sistema` is absent from `CONFIG_SECTIONS` in `assets/js/methods.js`,
so the shared hash parser reports `section: 'general'` for
`#/configuracion/sistema`. Anything that trusts the parsed section alone would
show (and be captured as) the General settings page while claiming to prove the
System section. This proof therefore refuses to treat a General fallback as
Sistema: it asserts the actual mounted owner and aborts instead of capturing.

Actual owner chain asserted here (read-only source lookup):

* `assets/js/methods.js` `CONFIG_SECTIONS` has no `sistema` entry, so the shared
  parser falls back to `general`;
* `assets/js/app.js` `parseRoute` then applies
  `AssetSystemViews.routeOverride` from `assets/js/system-operations.js:68`,
  which restores `section: 'sistema'` for the exact hash;
* `index.html:1162` mounts `<system-operations v-if="route.section === 'sistema'">`;
* `assets/js/access.js` `CONFIG_PERMISSION_BY_SECTION.sistema = 'system.view'`
  gates the section route.

Read-only on purpose:

* one fresh isolated installation (own SQLite file, loopback API + Vite,
  process environment only, no `.env`, no provider or device access);
* two cells only, `es` 1440 light and `en` 390 dark, both the System section;
* the route is opened through the real application and its canonical settings
  reads are awaited before anything is measured;
* no Vue injection, no route mock, no mocked authentication, no `localStorage`
  seeding, no template or preference write;
* no module enable/disable, no provider selection, no installation, no backup,
  no update or deploy, no export/import, no save and no security change.

Run: `python tests/ui-config-system.browser.py`
"""
from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

_spec = importlib.util.spec_from_file_location(
    "documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py"))
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)
fixture, PYTHON, BACKEND, FRONTEND = v.fixture, v.PYTHON, v.BACKEND, v.FRONTEND
USERNAME, PASSWORD = v.USERNAME, v.PASSWORD
SCRATCH = FRONTEND / ".verification" / ("ui-config-system-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

ROUTE = "#/configuracion/sistema"
STATE = "config-sistema"
MARKER = ".config-page"

# Cells named by the review: the Spanish desktop light cell and the English
# mobile dark cell, both on the same section. `v.SETTINGS_CELLS` is the shared
# settings cell list, reused rather than redefined.
CELLS = v.SETTINGS_CELLS

# Canonical copy is read from the shipped catalogs, never from the DOM it is
# supposed to verify.
CANON_KEYS = {
    "heading": "ui.system.title",
    "nav": "ui.shell.config_section_sistema",
    "status_loading": "ui.system.status.loading",
    "modules_loading": "ui.system.modules.loading",
    "refresh_loading": "ui.system.status.loading_short",
}
PANEL_IDS = (
    "system-status-title",
    "system-config-title",
    "system-providers-title",
    "system-modules-title",
    "system-operations-panel-title",
)
SYSTEM_READS = (
    "/api/v1/system/status",
    "/api/v1/system/configuration",
    "/api/v1/system/providers",
    "/api/v1/system/modules",
)
OWNERS = (
    "assets/js/methods.js CONFIG_SECTIONS (no `sistema`, shared parser -> general)",
    "assets/js/app.js parseRoute -> AssetSystemViews.routeOverride",
    "assets/js/system-operations.js:68 routeOverride (restores section sistema)",
    "index.html:1162 <system-operations v-if=\"route.section === 'sistema'\">",
    "assets/js/access.js CONFIG_PERMISSION_BY_SECTION.sistema = system.view",
)

CATALOGS: dict[str, dict] = {}


def canon(locale: str, key: str) -> str:
    if locale not in CATALOGS:
        path = FRONTEND / "assets" / "i18n" / f"{locale}.json"
        CATALOGS[locale] = json.loads(path.read_text(encoding="utf-8"))
    payload = CATALOGS[locale]
    value = payload.get(key)
    assert isinstance(value, str) and value, f"catalog {locale} has no {key}"
    return value


def path_of(url: str) -> str:
    return urlsplit(url).path


LEDGER: dict[str, object] = {"requests": [], "responses": []}
PHASE = ["login"]


class RoutingDefect(RuntimeError):
    """The Sistema route did not mount the System section; never capture it."""


def attach_ledger(page) -> None:
    requests: list[dict] = LEDGER["requests"]  # type: ignore[assignment]
    responses: list[dict] = LEDGER["responses"]  # type: ignore[assignment]

    def on_request(request) -> None:
        requests.append({"method": request.method, "url": request.url, "phase": PHASE[0]})

    def on_response(response) -> None:
        responses.append({"status": response.status, "url": response.url, "phase": PHASE[0]})

    page.on("request", on_request)
    page.on("response", on_response)


def route_state(page) -> dict:
    return page.evaluate(
        """() => {
          const all = (selector) => Array.from(document.querySelectorAll(selector));
          const nav = all('.config-nav__item');
          const active = nav.filter((item) => item.classList.contains('is-active'));
          const label = (item) => {
            const strong = item.querySelector('strong');
            return strong ? strong.textContent.trim() : '';
          };
          return {
            hash: window.location.hash,
            lang: document.documentElement.lang || '',
            theme: document.documentElement.dataset.theme || '',
            navCount: nav.length,
            activeHrefs: active.map((item) => item.getAttribute('href')),
            activeCurrent: active.map((item) => item.getAttribute('aria-current')),
            activeLabels: active.map(label),
            generalHeadings: all('#config-general-title').length,
            generalStacks: all('.config-general-stack').length,
            systemRoots: all('.config-content .system-operations'
              + '[aria-labelledby="system-operations-title"]').length,
            systemHeading: all('#system-operations-title').map((item) => item.textContent.trim()),
            systemH2Count: all('.config-content h2').length,
            panels: %s.map((id) => [id, all('#' + id).length]),
            statusNotes: all('.system-operations [role="status"]').map((item) => item.textContent.trim()),
            providerSelects: all('#system-provider').length,
            statusRows: all('.system-operations #system-classification').length,
            body: document.body.innerText
          };
        }""" % json.dumps(list(PANEL_IDS))
    )


def check_system_cell(page, locale, theme, width):
    """Assert one real System cell: owner, active selection, settled catalog."""
    state = route_state(page)
    label = f"{locale} {width} {theme}"
    headings = {name: canon(locale, key) for name, key in CANON_KEYS.items()}

    # Route identity: the exact hash, never normalised to `general`.
    v.require(state["hash"] == ROUTE, f"{label}: hash is {state['hash']!r}, expected {ROUTE!r}")

    # Routing defect detector. The shared parser would render General here, so a
    # General mount is a real routing defect in the owner chain, reported with
    # its owners instead of being captured as Sistema.
    if state["generalHeadings"] or state["generalStacks"]:
        message = (
            f"{label}: ROUTING DEFECT {ROUTE} mounted the General section "
            f"(#config-general-title={state['generalHeadings']}, "
            f".config-general-stack={state['generalStacks']}); no Sistema evidence captured. "
            "Owners: " + "; ".join(OWNERS)
        )
        v.fail(message)
        raise RoutingDefect(message)

    # Actual owner: the System operations component and its single root heading.
    v.require(state["systemRoots"] == 1,
              f"{label}: expected 1 mounted .system-operations root, got {state['systemRoots']}")
    v.require(state["systemHeading"] == [headings["heading"]],
              f"{label}: root heading {state['systemHeading']!r} != "
              f"catalog {headings['heading']!r}")
    v.require(state["systemH2Count"] == 1,
              f"{label}: .config-content has {state['systemH2Count']} h2 headings, expected 1 root")

    # Active configuration selection: exactly the Sistema entry.
    v.require(state["activeHrefs"] == [ROUTE],
              f"{label}: active config nav {state['activeHrefs']!r} != [{ROUTE!r}]")
    v.require(state["activeCurrent"] == ["page"],
              f"{label}: active nav aria-current {state['activeCurrent']!r} != ['page']")
    v.require(state["activeLabels"] == [headings["nav"]],
              f"{label}: active nav label {state['activeLabels']!r} != "
              f"catalog {headings['nav']!r}")

    # Panels of the section itself, each mounted once.
    missing = [name for name, count in state["panels"] if count != 1]
    v.require(not missing, f"{label}: panels not mounted exactly once: {missing!r}")
    v.require(state["providerSelects"] == 1,
              f"{label}: provider select count {state['providerSelects']} != 1")
    v.require(state["statusRows"] == 1,
              f"{label}: deployment classification select count {state['statusRows']} != 1")

    # Settled: canonical reads finished, no loading placeholder left. A
    # role="status" note is not by itself a loading state here: the operations
    # panel states the factual "no external executor" boundary, which must
    # survive, so only the loading copy is treated as unsettled.
    loading_copy = (headings["status_loading"], headings["modules_loading"])
    loading_hits = [text for text in state["statusNotes"] if text in loading_copy]
    v.require(not loading_hits,
              f"{label}: loading placeholders still present {loading_hits!r}")
    for key in ("status_loading", "modules_loading", "refresh_loading"):
        v.require(headings[key] not in state["body"],
                  f"{label}: settled catalog still shows loading copy {headings[key]!r}")
    for text in state["statusNotes"]:
        v.record(f"SYSTEM_NOTE {label} factual status note kept: {text!r}")

    # Active theme and locale are the requested ones.
    v.require(state["theme"] == theme,
              f"{label}: effective theme {state['theme']!r} != {theme!r}")
    v.require(state["lang"].split("-")[0] == locale,
              f"{label}: document lang {state['lang']!r} != {locale!r}")

    detail = (
        f"owner=system-operations heading={headings['heading']!r} "
        f"nav={headings['nav']!r} panels={len(state['panels'])} settled=yes"
    )
    v.record(f"SYSTEM {label} route={state['hash']} {detail}")
    return detail


def band_crops(source: Path) -> list[str]:
    """Split a whole-content capture into three readable bands for inspection."""
    from PIL import Image

    produced: list[str] = []
    with Image.open(source) as image:
        count = 3
        for index in range(count):
            top = index * image.height // count
            bottom = image.height if index == count - 1 else (index + 1) * image.height // count
            dest = source.with_name(source.stem + f"-band{index + 1}.png")
            image.crop((0, top, image.width, bottom)).save(dest)
            produced.append(f"{dest.name} {image.width}x{bottom - top}")
    return produced


def ledger_check() -> None:
    requests: list[dict] = LEDGER["requests"]  # type: ignore[assignment]
    responses: list[dict] = LEDGER["responses"]  # type: ignore[assignment]
    writes = [item for item in requests if item["method"] not in ("GET", "HEAD", "OPTIONS")]
    setup = [item for item in writes if item["phase"] == "login"]
    runtime = [item for item in writes if item["phase"] != "login"]
    workspace_puts = [item for item in runtime if item["method"] == "PUT" and "/workspace" in item["url"]]
    system_writes = [item for item in requests
                     if item["method"] not in ("GET", "HEAD", "OPTIONS")
                     and path_of(item["url"]).startswith("/api/v1/system")]
    other_writes = [item for item in runtime if item not in workspace_puts]
    failed = [item for item in responses
              if item["status"] >= 400 and item["phase"] != "login"
              and path_of(item["url"]).startswith("/api/v1")]

    v.record(f"LEDGER requests={len(requests)} setup_writes={len(setup)} "
             f"runtime_writes={len(runtime)} workspace_PUT={len(workspace_puts)} "
             f"system_writes={len(system_writes)} api_errors={len(failed)}")
    for item in setup:
        v.record(f"LEDGER setup write {item['method']} {path_of(item['url'])}")
    for item in workspace_puts:
        v.record(f"LEDGER separate workspace write PUT {path_of(item['url'])} phase={item['phase']}")
    v.record("LEDGER domain writes other than workspace: "
             + (str(len(other_writes)) if other_writes else "0"))
    for item in other_writes:
        v.fail(f"LEDGER unexpected write {item['method']} {path_of(item['url'])} phase={item['phase']}")
    for item in system_writes:
        v.fail(f"LEDGER System write {item['method']} {path_of(item['url'])} phase={item['phase']}")
    for item in failed:
        v.fail(f"LEDGER api error {item['status']} {path_of(item['url'])} phase={item['phase']}")

    for needle in SYSTEM_READS:
        hits = [item for item in responses
                if path_of(item["url"]).startswith(needle) and item["status"] == 200]
        v.require(bool(hits), f"LEDGER canonical read {needle} never returned 200")
    v.record("LEDGER canonical reads settled: " + ", ".join(SYSTEM_READS))


def scenario(browser, shots: Path) -> None:
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    attach_ledger(page)
    try:
        fixture.login(page, BASE, USERNAME, PASSWORD)
        PHASE[0] = "read"
        v.record("PROVENANCE real hash route, real login form, no Vue injection, no route mock")
        v.capture(page, shots, STATE, ROUTE, MARKER, CELLS, check_system_cell)

        for image in sorted(shots.glob(f"{STATE}-*.png")):
            if "-band" in image.stem:
                continue
            for line in band_crops(image):
                v.record(f"BAND {line}")

        v.require(not errors, f"page errors: {errors}")
        PHASE[0] = "ledger"
        ledger_check()
        v.record("SYSTEM_PROOF pageerrors=0")
    finally:
        context.close()


def main() -> int:
    global BASE
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ROUTE {ROUTE} cells={CELLS}")
    print(f"OWNERS {'; '.join(OWNERS)}")
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
             "--username", USERNAME, "--name", "UI system install"],
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
    print(f"rows={len(RESULTS)} failures={len(FAILURES)} screenshots={len(list(shots.glob('*.png')))}")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    if FAILURES:
        print("FAILURES:")
        for item in FAILURES:
            print(f"- {item}")
        return 1
    print("RESULT System section proof passed: route owner is the System section, not the General fallback")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
