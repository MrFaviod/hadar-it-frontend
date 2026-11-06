"""Isolated visual proof of the access, extensions and language settings sections.

Covers `#/configuracion/seguridad`, `#/configuracion/extensiones` and
`#/configuracion/idiomas` only. The proof reads the default views: it installs
no extension, connects no provider, creates no user, saves no policy and never
touches a production or provider-backed installation.
"""
import importlib.util
import json
import re
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit
import uuid

_spec = importlib.util.spec_from_file_location(
    "documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py"))
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)
fixture, PYTHON, BACKEND, FRONTEND = v.fixture, v.PYTHON, v.BACKEND, v.FRONTEND
USERNAME, PASSWORD = v.USERNAME, v.PASSWORD
SCRATCH = FRONTEND / ".verification" / ("ui-config-access-language-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

SECTIONS = (
    {
        "slug": "seguridad",
        "route": "#/configuracion/seguridad",
        "root": ".access-security",
        "nav": "seguridad",
        "title_key": "ui.access.security_title",
        "content": ".security-card",
    },
    {
        "slug": "extensiones",
        "route": "#/configuracion/extensiones",
        "root": ".extension-review",
        "nav": "extensiones",
        "title_key": "ui.extensions.review.title",
        "content": ".extension-review__grid",
    },
    {
        "slug": "idiomas",
        "route": "#/configuracion/idiomas",
        "root": ".translation-settings",
        "nav": "idiomas",
        "title_key": "ui.translations.title",
        "content": ".agent-panel",
    },
)

# The ledger separates three kinds of write so nothing is hidden:
#   navigation   the fixture's own locale/theme preference persistence;
#   registration the product's automatic ui-catalog registration, whose status
#                is asserted (200) instead of being filtered away;
#   mutations    every other domain write, which must stay empty.
NAVIGATION_WRITES = ("workspace/state",)
REGISTRATION_PATH = "i18n/sources/ui"
COVERAGE_PATH = "i18n/coverage"
REGISTRATIONS = []
COVERAGE = []
EXCLUDED = []
MUTATIONS = []


# The registration PUT completes before the coverage GET, so a cell that only
# waited for the registration screenshots a panel that is still loading: no
# revision, no source keys and empty locale selects. These predicates wait on
# rendered product state only. No Vue state is injected and no fixed sleep is
# used as a substitute for the product's own read.
IDIOMAS_SETTLED = """
() => {
  const root = document.querySelector('.translation-settings');
  if (!root) return false;
  if (root.querySelectorAll('.agent-panel p.agent-note[role="status"]').length) return false;
  if (!root.querySelectorAll('.translation-table tbody tr').length) return false;
  const selects = ['#translations-missing-locale', '#translations-export-locale', '#translations-import-locale'];
  return selects.every((id) => {
    const select = root.querySelector(id);
    return select !== null && select.options.length > 0;
  });
}
"""

IDIOMAS_STATE = """
() => {
  const root = document.querySelector('.translation-settings');
  if (!root) return {root: false};
  const notes = (selector) => Array.from(root.querySelectorAll(selector))
    .map((node) => node.textContent.trim());
  return {
    root: true,
    loading: notes('.agent-panel p.agent-note[role="status"]'),
    errors: notes('.agent-panel p.agent-note--error'),
    facts: notes('dl.access-facts dd'),
    rows: root.querySelectorAll('.translation-table tbody tr').length,
    localeOptionCounts: ['#translations-missing-locale', '#translations-export-locale', '#translations-import-locale']
      .map((id) => { const select = root.querySelector(id); return select ? select.options.length : -1; })
  };
}
"""

IDIOMAS_RENDERED = """
() => {
  const root = document.querySelector('.translation-settings');
  const facts = Array.from(root.querySelectorAll('dl.access-facts dd')).map((node) => node.textContent.trim());
  const select = root.querySelector('#translations-missing-locale');
  const notice = root.querySelector('.translation-result');
  return {
    revision: facts[0] || '',
    source: facts[1] || '',
    rows: root.querySelectorAll('.translation-table tbody tr').length,
    options: select ? select.options.length : -1,
    notice: notice ? notice.textContent.trim() : '',
    noticeRole: notice ? notice.getAttribute('role') || '' : '',
    noticeLive: notice ? notice.getAttribute('aria-live') || '' : ''
  };
}
"""

# The registration outcome is the only sentence the live region can announce
# once the panel settles. The registered form carries the key count and the
# revision; the unchanged form is a single sentence. Both are asserted in the
# active locale, so a frozen sentence from the previous locale fails the cell.
KNOWN_NOTICES = {
    "es": {
        "registered": ("Catálogo de la interfaz registrado:", "(revisión {revision})."),
        "unchanged": "El catálogo de la interfaz ya estaba registrado.",
        "foreign": "Interface catalog",
    },
    "en": {
        "registered": ("Interface catalog registered:", "(revision {revision})."),
        "unchanged": "The interface catalog was already registered.",
        "foreign": "Catálogo de la interfaz",
    },
}


def json_body(record):
    """Parse one tracked response body once; returns None when unavailable."""
    try:
        return record["response"].json()
    except Exception:  # noqa: BLE001 - diagnostics only
        try:
            return json.loads(record["response"].text())
        except Exception:  # noqa: BLE001 - diagnostics only
            return None


def canonical_coverage():
    """The coverage read without a locale filter, which the panel opens with."""
    for item in reversed(COVERAGE):
        if "locale" not in parse_qs(urlsplit(item["url"]).query):
            return item
    return None


def settle_idiomas(page, locale):
    """Wait for the product's own coverage read to finish rendering."""
    try:
        page.wait_for_function(IDIOMAS_SETTLED, timeout=30000)
        return True
    except Exception:  # noqa: BLE001 - bounded failure, never retried
        state = page.evaluate(IDIOMAS_STATE)
        if state.get("loading"):
            cause = "still showing a loading note"
        elif not state.get("rows"):
            cause = "settled without coverage rows"
        else:
            cause = "missing language options"
        v.require(False, f"idiomas {locale}: coverage never settled, {cause} {state}")
        return False


def check_idiomas_coverage(page, locale):
    """Compare the rendered coverage facts with the canonical coverage read."""
    record = canonical_coverage()
    v.require(record is not None, f"idiomas {locale}: no canonical coverage read was recorded")
    if record is None:
        return "coverage=none"
    v.require(
        record["status"] == 200,
        f"idiomas {locale}: canonical coverage status {record['status']}",
    )
    payload = json_body(record) or {}
    revision = payload.get("revision")
    source_total = (payload.get("source") or {}).get("total")
    v.require(
        isinstance(revision, int) and revision > 0,
        f"idiomas {locale}: coverage revision {revision!r} is not a positive integer",
    )
    v.require(
        isinstance(source_total, int) and source_total > 0,
        f"idiomas {locale}: coverage source total {source_total!r} is not positive",
    )
    rendered = page.evaluate(IDIOMAS_RENDERED)
    rendered_revision = "".join(ch for ch in rendered["revision"] if ch.isdigit())
    rendered_source = "".join(ch for ch in rendered["source"] if ch.isdigit())
    v.require(
        rendered_revision == str(revision),
        f"idiomas {locale}: rendered revision {rendered['revision']!r} is not coverage revision {revision!r}",
    )
    v.require(
        rendered_source == str(source_total),
        f"idiomas {locale}: rendered source {rendered['source']!r} is not coverage source total {source_total!r}",
    )
    v.require(
        rendered["options"] > 0,
        f"idiomas {locale}: missing-locale select has {rendered['options']} options",
    )
    for item in REGISTRATIONS:
        body = json_body(item) or {}
        if isinstance(body.get("revision"), int):
            v.require(
                body["revision"] == revision,
                f"idiomas {locale}: registration revision {body['revision']} is not coverage revision {revision}",
            )
    return (
        f"coverage revision={revision} source={source_total} "
        f"locales={len(payload.get('locales') or [])} rows={rendered['rows']} "
        f"options={rendered['options']} notice={rendered['notice']!r}"
    )

SECURITY_ROLE_LINE = re.compile(
    r"^(?P<permissions>\d+) (?P<permission_word>[a-záéíóúñ]+) · (?P<accounts>\d+) (?P<account_word>[a-záéíóúñ]+)$"
)

COUNT_WORDS = {
    "es": {"permission": ("permiso", "permisos"), "account": ("cuenta", "cuentas")},
    "en": {"permission": ("permission", "permissions"), "account": ("account", "accounts")},
}

TRANSLATIONS_COPY = {
    "es": "Consulta la cobertura por idioma, exporta o importa catálogos y revisa las traducciones personalizadas.",
    "en": "Check coverage per language, export or import catalogs and review custom translations.",
}

# The five languages copy keys the review found in voseo. The rendered section
# must not keep any of these sentences after the tú correction.
SUPERSEDED_VOSEO = (
    "Consultá la cobertura por idioma",
    "Necesitás el permiso system.view",
    "Elegí un idioma para ver sus claves faltantes",
    "Pegá o elegí un catálogo",
    "Elegí un idioma y pegá un catálogo",
)


def check_security_role_copy(page, locale):
    """Each role line pluralizes permissions and accounts against its own number."""
    words = COUNT_WORDS[locale]
    lines = page.eval_on_selector_all(
        ".security-card.security-roles .role-row__copy small",
        "nodes => nodes.map((node) => node.textContent.trim())",
    )
    v.require(lines, f"seguridad {locale}: no role line rendered")
    singular_accounts = 0
    for line in lines:
        match = SECURITY_ROLE_LINE.match(line)
        v.require(
            match is not None,
            f"seguridad {locale}: role line {line!r} left the count layout",
        )
        if match is None:
            continue
        checks = (
            (int(match.group("permissions")), match.group("permission_word"), words["permission"]),
            (int(match.group("accounts")), match.group("account_word"), words["account"]),
        )
        for count, word, forms in checks:
            expected = forms[0] if count == 1 else forms[1]
            v.require(
                word == expected,
                f"seguridad {locale}: role line {line!r} disagrees with count {count}",
            )
        if int(match.group("accounts")) == 1:
            singular_accounts += 1
    v.require(
        singular_accounts >= 1,
        f"seguridad {locale}: no role renders the single bootstrapped account",
    )
    return f"copy_roles={len(lines)} singular_accounts={singular_accounts}"


def check_idiomas_copy(page, locale):
    """The rendered languages copy carries the shipped lead and no superseded voseo."""
    text = page.eval_on_selector(
        ".translation-settings",
        "node => node.innerText || node.textContent || ''",
    )
    v.require(
        TRANSLATIONS_COPY[locale] in text,
        f"idiomas {locale}: the rendered lead does not carry the shipped copy",
    )
    if locale == "es":
        kept = [phrase for phrase in SUPERSEDED_VOSEO if phrase in text]
        v.require(not kept, f"idiomas es: rendered copy keeps the superseded voseo {kept}")
    return "copy=lead"


def check_idiomas_announcement(page, locale):
    """The live region must announce the known registration outcome in `locale`."""
    expectations = KNOWN_NOTICES.get(locale)
    v.require(expectations is not None, f"idiomas {locale}: no known registration notice for {locale!r}")
    if expectations is None:
        return ""
    record = canonical_coverage()
    payload = (json_body(record) or {}) if record is not None else {}
    revision = payload.get("revision")
    rendered = page.evaluate(IDIOMAS_RENDERED)
    v.require(
        rendered["noticeRole"] == "status" and rendered["noticeLive"] == "polite",
        f"idiomas {locale}: live region role={rendered['noticeRole']!r} "
        f"aria-live={rendered['noticeLive']!r}",
    )
    body = (json_body(REGISTRATIONS[-1]) if REGISTRATIONS else None) or {}
    notice = rendered["notice"]
    if body.get("changed") is False:
        v.require(
            notice == expectations["unchanged"],
            f"idiomas {locale}: live notice {notice!r} is not {expectations['unchanged']!r}",
        )
    else:
        head, tail = expectations["registered"]
        expected_tail = tail.format(revision=revision)
        v.require(
            notice.startswith(head) and notice.endswith(expected_tail),
            f"idiomas {locale}: live notice {notice!r} is not the registered form "
            f"{head!r} ... {expected_tail!r}",
        )
    v.require(
        expectations["foreign"] not in notice,
        f"idiomas {locale}: live notice {notice!r} keeps the other language",
    )
    return ""


def section_check(section):
    def check(page, locale, theme, width):
        slug = section["slug"]
        lang = page.evaluate("() => document.documentElement.lang")
        v.require(lang == locale, f"{slug} {locale}: document lang is {lang!r}")

        hash_value = page.evaluate("() => location.hash")
        v.require(
            hash_value == section["route"],
            f"{slug} {locale}: route hash is {hash_value!r}",
        )

        root = page.locator(section["root"])
        v.require(root.count() == 1, f"{slug} {locale}: {section['root']} count {root.count()}")
        if root.count() != 1:
            return "section missing"
        for other in SECTIONS:
            if other["slug"] == slug:
                continue
            v.require(
                page.locator(other["root"]).count() == 0,
                f"{slug} {locale}: unrelated section {other['root']} rendered",
            )

        title = page.evaluate(
            "(key) => window.ItsmI18n.i18n.global.t(key)", section["title_key"])
        heading = root.locator("h1, h2").first.inner_text().strip()
        v.require(
            heading == title,
            f"{slug} {locale}: heading is {heading!r}, expected {title!r}",
        )

        active = page.locator(".config-nav__item.is-active")
        v.require(active.count() == 1, f"{slug} {locale}: {active.count()} active nav items")
        if active.count() == 1:
            href = active.first.get_attribute("href") or ""
            current = active.first.get_attribute("aria-current")
            v.require(
                href.endswith("/" + section["nav"]) and current == "page",
                f"{slug} {locale}: active nav href={href!r} aria-current={current!r}",
            )

        content = root.locator(section["content"])
        v.require(
            content.count() > 0,
            f"{slug} {locale}: no {section['content']} content in the section",
        )

        copy_detail = ""
        if slug == "seguridad":
            copy_detail = " " + check_security_role_copy(page, locale)
        if slug == "idiomas":
            copy_detail = " " + check_idiomas_copy(page, locale)

        # The languages section reads its coverage after registering the catalog.
        # Asserting only the registration status accepts a panel that is still
        # loading, so wait for the product's own read to render and then compare
        # what the panel shows with what the canonical coverage response carried.
        coverage_detail = ""
        if slug == "idiomas":
            if settle_idiomas(page, locale):
                coverage_detail = " " + check_idiomas_coverage(page, locale)
                check_idiomas_announcement(page, locale)

        section_mutations = [url for url in MUTATIONS if url]
        v.require(
            not section_mutations,
            f"{slug} {locale}: the read-only view sent domain mutations {section_mutations}",
        )

        # The catalog registration is a product mutation, not navigation. It is
        # expected on the languages section and must succeed: a 403 here is the
        # defect this proof exists to catch, never something to filter out.
        attempted = [item for item in REGISTRATIONS]
        if slug == "idiomas":
            v.require(attempted, f"{slug} {locale}: the ui catalog registration was never attempted")
            v.require(
                all(item["status"] == 200 for item in attempted),
                f"{slug} {locale}: registration statuses {[item['status'] for item in attempted]}",
            )
        # A refused registration must show why: the FastAPI validation keys say
        # whether the body or the session guard was rejected. Only field
        # locations and error types are kept; no payload values, tokens or
        # cookies are ever written.
        reasons = []
        for item in attempted:
            if item["status"] == 200:
                continue
            detail = []
            try:
                body = json.loads(item["response"].text())
                for problem in body.get("detail") or []:
                    if isinstance(problem, dict):
                        loc = [str(part) for part in (problem.get("loc") or [])]
                        detail.append("/".join(loc) + ":" + str(problem.get("type")))
                if not detail and isinstance(body.get("error"), dict):
                    detail.append("error:" + str(body["error"].get("key")))
            except Exception as error:  # noqa: BLE001 - diagnostics only
                detail.append("unreadable:" + type(error).__name__)
            reasons.append(str(item["status"]) + "[" + ",".join(detail) + "]")
        registration = (
            "registration=" + ",".join(reasons or [str(item["status"]) for item in attempted])
            if attempted else "registration=none"
        )

        facts = root.locator("dl dd").count()
        buttons = root.locator("button").count()
        return (
            f"section={slug} root={section['root']} heading={heading!r} "
            f"nav=active content={section['content']} facts={facts} "
            f"buttons={buttons} mutations=0 navigation_writes={len(EXCLUDED)} "
            f"{registration}{coverage_detail}{copy_detail}"
        )

    return check


def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    collecting = {"on": False}

    pending = {}

    def track_mutations(request):
        if not collecting["on"]:
            return
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and "/api/v1/" in request.url:
            path = request.url.split("/api/v1/", 1)[-1]
            if path in NAVIGATION_WRITES:
                EXCLUDED.append(request.method + " " + path)
                return
            if path == REGISTRATION_PATH:
                REGISTRATIONS.append({"method": request.method, "url": request.url, "status": None})
                pending[request.url] = REGISTRATIONS[-1]
                return
            MUTATIONS.append(request.method + " " + path)

    def track_status(response):
        if not collecting["on"]:
            return
        record = pending.get(response.url)
        if record is not None:
            record["status"] = response.status
            record["response"] = response
            return
        if response.request.method == "GET" and "/api/v1/" + COVERAGE_PATH in response.url:
            COVERAGE.append({"url": response.url, "status": response.status, "response": response})

    page.on("request", track_mutations)
    page.on("response", track_status)
    fixture.login(page, BASE, USERNAME, PASSWORD)
    collecting["on"] = True
    try:
        for section in SECTIONS:
            v.capture(
                page,
                shots,
                "config-access-" + section["slug"],
                section["route"],
                section["root"],
                v.SETTINGS_CELLS,
                section_check(section),
            )
        assert not errors, errors
        print("ACCESS_LANGUAGE_PROOF pageerrors=0")
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
             "--username", USERNAME, "--name", "UI config access install"],
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
    print("RESULT all access/language section checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
