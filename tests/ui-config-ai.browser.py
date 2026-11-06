#!/usr/bin/env python3
"""Bounded READ-only browser proof of `#/configuracion/ia` (U12, T3/S3).

The observation this proof resolves is route provenance, not visual taste:
`ia` is absent from `CONFIG_SECTIONS` in `assets/js/methods.js`, so the shared
hash parser reports `section: 'general'` for `#/configuracion/ia`. Anything that
trusts the parsed section alone would show (and be captured as) the General
settings page while claiming to prove the AI section. This proof therefore
refuses to treat a General fallback as IA: it asserts the actual mounted owner
and aborts instead of capturing.

Actual owner chain asserted here (bounded read-only source lookup):

* `assets/js/methods.js` `CONFIG_SECTIONS` has no `ia` entry, so the shared
  parser falls back to `general` and `hashFor` normalises the hash;
* `assets/js/app.js` `parseRoute` applies `AssetAgentViews.routeOverride` and
  `hashFor` keeps `#/configuracion/ia`;
* `assets/js/agent-integrations.js:419` `routeOverride` restores
  `section: 'ia'` for the exact hash; the same file owns the section component
  with root `section.config-section.agent-ia[aria-labelledby="agent-ia-title"]`;
* `index.html:1189` mounts
  `<agent-integrations-settings v-else-if="route.section === 'ia'">`;
* the settings nav entry `ia` is gated by `system.providers` in
  `assets/js/access.js`.

Read-only on purpose:

* one fresh isolated installation (own SQLite file, loopback API + Vite,
  process environment only, no `.env`);
* two cells only, `es` 1440 light and `en` 390 dark, both the IA section;
* the route is opened through the real application and its canonical settings
  reads are awaited before anything is measured;
* no Vue injection, no route mock, no mocked authentication, no `localStorage`
  seeding, no template or preference write;
* no AI provider is contacted, no credential is read or written, no model is
  enabled or disabled, no integration instance or installation is created, no
  quota policy is saved, no settings save occurs and no security change is made.

Run: `/usr/bin/python3 tests/ui-config-ai.browser.py`
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
SCRATCH = FRONTEND / ".verification" / ("ui-config-ai-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

ROUTE = "#/configuracion/ia"
STATE = "config-ia"
MARKER = ".config-page"

# Cells named by the review: the Spanish desktop light cell and the English
# mobile dark cell, both on the same section. `v.SETTINGS_CELLS` is the shared
# settings cell list, reused rather than redefined.
CELLS = v.SETTINGS_CELLS

# Canonical copy is read from the shipped catalogs, never from the DOM it is
# supposed to verify.
CANON_KEYS = {
    "heading": "ui.agents.settings_title",
    "nav": "ui.shell.config_section_ia",
    "loading": "ui.agents.settings_loading",
    "engines_loading": "ui.agents.loading_engines",
    "providers_loading": "ui.agents.providers_loading",
    "quota_loading": "ui.agents.quota_policy_loading",
}
# Panels the IA section always mounts for an authorized administrator. Quota
# panels are permission-dependent, so their presence is recorded, not required.
PANEL_IDS = (
    "agent-engine-title",
    "agent-providers-title",
    "agent-instances-title",
)
AI_READS = (
    "/api/v1/agent/engines",
    "/api/v1/agent/providers",
    "/api/v1/agent/integrations",
    "/api/v1/agent/integrations/catalog",
)
OWNERS = (
    "assets/js/methods.js CONFIG_SECTIONS (no `ia`, shared parser -> general)",
    "assets/js/app.js parseRoute -> AssetAgentViews.routeOverride",
    "assets/js/agent-integrations.js:419 routeOverride (restores section ia)",
    "index.html:1189 <agent-integrations-settings v-if=\"route.section === 'ia'\">",
    "assets/js/access.js settings nav entry ia = system.providers",
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
    """The IA route did not mount the AI section; never capture it."""


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
            pickerValue: (document.querySelector('#config-section-select') || {}).value || '',
            generalHeadings: all('#config-general-title').length,
            generalStacks: all('.config-general-stack').length,
            aiRoots: all('.config-content .agent-ia'
              + '[aria-labelledby="agent-ia-title"]').length,
            aiHeading: all('#agent-ia-title').map((item) => item.textContent.trim()),
            rootTag: (document.querySelector('#agent-ia-title') || {}).tagName || '',
            h2Ids: all('.config-content h2').map((item) => item.id || '(no id)'),
            panels: %s.map((id) => [id, all('#' + id).length]),
            panelTitles: all('.config-content [id$="-title"]').map((item) => item.id),
            statusNotes: all('.agent-ia [role="status"]').map((item) => item.textContent.trim()),
            alerts: all('.agent-ia [role="alert"]').map((item) =>
              ({ text: item.textContent.trim(), inEngine: !!item.closest('.agent-engine') })),
            wizard: all('.agent-wizard').length,
            providerCards: all('.agent-providers .agent-provider-card, .agent-providers li').length,
            body: document.body.innerText
          };
        }""" % json.dumps(list(PANEL_IDS))
    )


def dismiss_first_run_wizard(page) -> bool:
    """Close the auto-opened first-run wizard through its own control.

    A fresh installation has no integration instance, so the IA section opens
    its wizard by design. Dismissing it is a real user action with no save, and
    it is the only way to observe the section itself rather than the overlay.
    """
    button = page.locator('.agent-wizard button[aria-label]').first
    if page.locator(".agent-wizard").count() == 0:
        return False
    button.click()
    page.wait_for_selector(".agent-wizard", state="detached", timeout=10000)
    v.settle(page)
    return True


def check_ai_cell(page, locale, theme, width):
    """Assert one real IA cell: owner, active selection, settled catalog."""
    state = route_state(page)
    label = f"{locale} {width} {theme}"
    headings = {name: canon(locale, key) for name, key in CANON_KEYS.items()}

    # Route identity: the exact hash, never normalised to `general`.
    v.require(state["hash"] == ROUTE, f"{label}: hash is {state['hash']!r}, expected {ROUTE!r}")

    # Routing defect detector. The shared parser would render General here, so a
    # General mount is a real routing defect in the owner chain, reported with
    # its owners instead of being captured as IA.
    if state["generalHeadings"] or state["generalStacks"]:
        message = (
            f"{label}: ROUTING DEFECT {ROUTE} mounted the General section "
            f"(#config-general-title={state['generalHeadings']}, "
            f".config-general-stack={state['generalStacks']}); no IA evidence captured. "
            "Owners: " + "; ".join(OWNERS)
        )
        v.fail(message)
        raise RoutingDefect(message)

    # First-run overlay: the section auto-opens its wizard when no integration
    # instance exists. Record it, then dismiss it through its own control so the
    # captured page is the section, not the overlay.
    if state["wizard"]:
        v.record(f"AI_NOTE {label} first-run wizard auto-opened ({state['wizard']} overlay)")
        if dismiss_first_run_wizard(page):
            v.record(f"AI_NOTE {label} wizard dismissed via its own aria-label close control")
        state = route_state(page)
        v.require(state["wizard"] == 0, f"{label}: wizard overlay still mounted after dismissal")

    # Actual owner: the AI settings component and its single root heading.
    v.require(state["aiRoots"] == 1,
              f"{label}: expected 1 mounted .agent-ia root, got {state['aiRoots']}")
    v.require(state["aiHeading"] == [headings["heading"]],
              f"{label}: root heading {state['aiHeading']!r} != "
              f"catalog {headings['heading']!r}")
    v.require(state["rootTag"] == "H2",
              f"{label}: section root heading tag {state['rootTag']!r} != 'H2'")
    v.require(state["h2Ids"][:1] == ["agent-ia-title"],
              f"{label}: first .config-content h2 is {state['h2Ids'][:1]!r}, expected the section root")
    # The section is composed of sub-sections that carry their own h2 (the
    # engine picker), so the root heading is asserted by identity and order
    # rather than by an exact h2 count; the rest is recorded as evidence.
    v.require(state["h2Ids"].count("agent-ia-title") == 1,
              f"{label}: section root heading mounted {state['h2Ids'].count('agent-ia-title')} times")
    v.record(f"AI_H2 {label} headings={state['h2Ids']!r}")

    # Active configuration selection: exactly the IA entry.
    v.require(state["activeHrefs"] == [ROUTE],
              f"{label}: active config nav {state['activeHrefs']!r} != [{ROUTE!r}]")
    v.require(state["activeCurrent"] == ["page"],
              f"{label}: active nav aria-current {state['activeCurrent']!r} != ['page']")
    v.require(state["activeLabels"] == [headings["nav"]],
              f"{label}: active nav label {state['activeLabels']!r} != "
              f"catalog {headings['nav']!r}")
    v.require(state["pickerValue"] == "ia",
              f"{label}: section picker value {state['pickerValue']!r} != 'ia'")

    # Panels of the section itself, each mounted once.
    missing = [name for name, count in state["panels"] if count != 1]
    v.require(not missing, f"{label}: panels not mounted exactly once: {missing!r}")
    v.record(f"AI_PANELS {label} titles={sorted(set(state['panelTitles']))!r}")

    # Error banners: a section-level load/discovery failure is a defect. The
    # engine picker legitimately reports per-engine discovery errors (fresh
    # installation: no agent model configured), which are recorded as observed
    # state instead of being silently accepted or used as proof of health.
    foreign = [item for item in state["alerts"] if not item["inEngine"]]
    v.require(not foreign,
              f"{label}: section-level error alerts visible {foreign!r}")
    for item in state["alerts"]:
        v.record(f"AI_NOTE {label} engine discovery error kept: {item['text']!r}")

    # Settled: canonical reads finished, no loading placeholder left.
    loading_copy = (headings["loading"], headings["engines_loading"],
                    headings["providers_loading"], headings["quota_loading"])
    loading_hits = [text for text in state["statusNotes"] if text in loading_copy]
    v.require(not loading_hits,
              f"{label}: loading placeholders still present {loading_hits!r}")
    for key in ("loading", "engines_loading", "providers_loading"):
        v.require(headings[key] not in state["body"],
                  f"{label}: settled catalog still shows loading copy {headings[key]!r}")
    for text in state["statusNotes"]:
        v.record(f"AI_NOTE {label} factual status note kept: {text!r}")

    # Active theme and locale are the requested ones.
    v.require(state["theme"] == theme,
              f"{label}: effective theme {state['theme']!r} != {theme!r}")
    v.require(state["lang"].split("-")[0] == locale,
              f"{label}: document lang {state['lang']!r} != {locale!r}")

    detail = (
        f"owner=agent-ia heading={headings['heading']!r} "
        f"nav={headings['nav']!r} panels={len(state['panels'])} "
        f"providerCards={state['providerCards']} settled=yes"
    )
    v.record(f"AI {label} route={state['hash']} {detail}")
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
    ai_writes = [item for item in requests
                 if item["method"] not in ("GET", "HEAD", "OPTIONS")
                 and path_of(item["url"]).startswith("/api/v1/agent")]
    other_writes = [item for item in runtime if item not in workspace_puts]
    failed = [item for item in responses
              if item["status"] >= 400 and item["phase"] != "login"
              and path_of(item["url"]).startswith("/api/v1")]

    v.record(f"LEDGER requests={len(requests)} setup_writes={len(setup)} "
             f"runtime_writes={len(runtime)} workspace_PUT={len(workspace_puts)} "
             f"ai_writes={len(ai_writes)} api_errors={len(failed)}")
    for item in setup:
        v.record(f"LEDGER setup write {item['method']} {path_of(item['url'])}")
    for item in workspace_puts:
        v.record(f"LEDGER separate workspace write PUT {path_of(item['url'])} phase={item['phase']}")
    v.record("LEDGER domain writes other than workspace: "
             + (str(len(other_writes)) if other_writes else "0"))
    for item in other_writes:
        v.fail(f"LEDGER unexpected write {item['method']} {path_of(item['url'])} phase={item['phase']}")
    for item in ai_writes:
        v.fail(f"LEDGER AI write {item['method']} {path_of(item['url'])} phase={item['phase']}")
    for item in failed:
        v.fail(f"LEDGER api error {item['status']} {path_of(item['url'])} phase={item['phase']}")

    for needle in AI_READS:
        hits = [item for item in responses
                if path_of(item["url"]).startswith(needle) and item["status"] == 200]
        v.require(bool(hits), f"LEDGER canonical read {needle} never returned 200")
    seen = sorted({path_of(item["url"]) for item in requests
                   if path_of(item["url"]).startswith("/api/v1/agent")})
    v.record("LEDGER agent endpoints observed: " + (", ".join(seen) or "none"))
    v.record("LEDGER canonical reads settled: " + ", ".join(AI_READS))


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
        v.record("PROVENANCE no provider contact, no credential read, no model or instance write")
        v.capture(page, shots, STATE, ROUTE, MARKER, CELLS, check_ai_cell)

        for image in sorted(shots.glob(f"{STATE}-*.png")):
            if "-band" in image.stem:
                continue
            for line in band_crops(image):
                v.record(f"BAND {line}")

        v.require(not errors, f"page errors: {errors}")
        PHASE[0] = "ledger"
        ledger_check()
        v.record("AI_PROOF pageerrors=0")
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
             "--username", USERNAME, "--name", "UI ai install"],
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
    print("RESULT IA section proof passed: route owner is the AI settings section, not the General fallback")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
